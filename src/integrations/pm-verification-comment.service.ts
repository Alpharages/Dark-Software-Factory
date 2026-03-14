import { Injectable, Logger } from '@nestjs/common';
import { ProjectIntegration } from '@/prisma/client';
import { PMProviderFactory } from '@/integrations/providers/pm-provider.factory';
import { SentryService } from '@/common/sentry/sentry.service';
import { NormalizedField, FieldValue } from '@/integrations/providers/dto/normalized-field.dto';

@Injectable()
export class PMVerificationCommentService {
  private readonly logger = new Logger(PMVerificationCommentService.name);

  constructor(
    private readonly providerFactory: PMProviderFactory,
    private readonly sentry: SentryService,
  ) {}

  /**
   * Posts a verification comment to the PM task with a summary of auto-filled fields.
   */
  async postVerificationComment(
    integration: ProjectIntegration,
    taskId: string,
    factualFilled: Array<{ field: NormalizedField; value: FieldValue; source: string }>,
    inferredFilled: Array<{ field: NormalizedField; value: FieldValue; source: 'ai_inferred' }>,
    manualFields: NormalizedField[],
    correlationId: string,
  ): Promise<void> {
    this.logger.debug(
      `[${correlationId}] CS2-4: verification comment for task ${taskId}: ` +
        `${factualFilled.length} factual, ${inferredFilled.length} inferred, ${manualFields.length} manual fields`,
    );

    if (factualFilled.length === 0 && inferredFilled.length === 0) {
      this.logger.debug(
        `[${correlationId}] CS2-4: no fields were auto-filled for task ${taskId} — skipping verification comment`,
      );
      return;
    }

    const comment = this.buildComment(factualFilled, inferredFilled, manualFields);

    try {
      const provider = await this.providerFactory.getProvider(integration);
      await provider.addComment(taskId, comment);
      this.logger.log(`[${correlationId}] CS2-4: verification comment posted for task ${taskId}`);
    } catch (error) {
      this.logger.warn(
        `[${correlationId}] CS2-4: failed to post verification comment for task ${taskId}: ${(error as Error).message}`,
      );
      this.sentry.captureException(error as Error);
    }
  }

  private buildComment(
    factualFilled: Array<{ field: NormalizedField; value: FieldValue; source: string }>,
    inferredFilled: Array<{ field: NormalizedField; value: FieldValue; source: 'ai_inferred' }>,
    manualFields: NormalizedField[],
  ): string {
    const lines: string[] = [
      '📋 DSF Auto-Fill Summary',
      '',
      'Auto-filled by DSF — please verify before using for billing or reporting.',
    ];

    if (factualFilled.length > 0) {
      lines.push('');
      lines.push('✅ Factual fields (auto-filled from DSF execution data):');
      for (const { field, value, source } of factualFilled) {
        lines.push(`• ${field.name}: ${this.formatFieldValue(value, source)}`);
      }
    }

    if (inferredFilled.length > 0) {
      lines.push('');
      lines.push('🤖 AI-estimated fields (inferred by Claude — please verify):');
      for (const { field, value } of inferredFilled) {
        lines.push(`• ${field.name}: ${String(value)}`);
      }
    }

    if (manualFields.length > 0) {
      lines.push('');
      lines.push('⚠️ Fields requiring manual input:');
      for (const field of manualFields) {
        lines.push(`• ${field.name} (type: ${field.type})`);
      }
    }

    return lines.join('\n');
  }

  private formatFieldValue(value: FieldValue, source: string): string {
    if (source === 'execution_duration') {
      return `${value} min`;
    }
    if (source === 'deployed_at' && typeof value === 'number') {
      return new Date(value).toISOString();
    }
    return String(value);
  }
}
