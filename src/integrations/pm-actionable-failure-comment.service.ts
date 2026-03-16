import { Injectable, Logger } from '@nestjs/common';
import { ProjectIntegration } from '@/prisma/client';
import { PMProviderFactory } from '@/integrations/providers/pm-provider.factory';
import { SentryService } from '@/common/sentry/sentry.service';
import { NormalizedField } from '@/integrations/providers/dto/normalized-field.dto';

export interface ActionableFailureContext {
  targetStatus: string;
  failureReason: string;
  providerErrorCode?: string;
  providerErrorBody?: unknown;
  missingFields?: NormalizedField[];
}

@Injectable()
export class PMActionableFailureCommentService {
  private readonly logger = new Logger(PMActionableFailureCommentService.name);

  constructor(
    private readonly providerFactory: PMProviderFactory,
    private readonly sentry: SentryService,
  ) {}

  /**
   * Posts an actionable failure comment to the PM task when a sync fails permanently.
   * AC1, AC5: Best-effort implementation.
   */
  async postActionableFailureComment(
    integration: ProjectIntegration | null,
    taskId: string,
    context: ActionableFailureContext,
    correlationId: string,
  ): Promise<void> {
    if (!integration) {
      this.logger.debug(
        `[${correlationId}] CS3-3: null integration for task ${taskId} — skipping actionable failure comment`,
      );
      return;
    }

    const comment = this.buildComment(context);

    try {
      const provider = await this.providerFactory.getProvider(integration);
      await provider.addComment(taskId, comment);
      this.logger.log(
        `[${correlationId}] CS3-3: actionable failure comment posted for task ${taskId}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[${correlationId}] CS3-3: failed to post actionable failure comment for task ${taskId}: ${message}`,
      );
      this.sentry.captureException(error as Error);
    }
  }

  /**
   * AC2: Build the actionable failure comment following the specified template.
   */
  private buildComment(context: ActionableFailureContext): string {
    const providerMessage = this.extractProviderMessage(context.providerErrorBody);

    const lines: string[] = [
      '🚨 DSF Sync Failure — Action Required',
      '',
      'DSF has completed development on this task but could not update the status in the PM tool.',
      '',
      `**Target Status:** ${context.targetStatus}`,
      `**Failure Reason:** ${context.failureReason}`,
    ];

    if (context.providerErrorCode) {
      lines.push(`**Provider Error Code:** ${context.providerErrorCode}`);
    }

    if (providerMessage) {
      lines.push(`**Provider Message:** "${providerMessage}"`);
    }

    lines.push('');
    lines.push('**Manual Steps:**');
    lines.push('1. Open this task in your PM tool');
    lines.push(`2. Manually update the status to: ${context.targetStatus}`);

    if (context.missingFields && context.missingFields.length > 0) {
      lines.push('3. Fill in the following required fields:');
      for (const field of context.missingFields) {
        lines.push(`   • ${field.name} (type: ${field.type})`);
      }
    }

    lines.push('');
    lines.push('This task is marked as "Sync Pending" on the DSF dashboard.');

    return lines.join('\n');
  }

  /**
   * Dev Notes: Helper to extract verbatim message from provider error body.
   */
  private extractProviderMessage(body: unknown): string | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const b = body as Record<string, unknown>;
    if (typeof b.err === 'string') return b.err;
    if (typeof b.message === 'string') return b.message;
    return undefined;
  }
}
