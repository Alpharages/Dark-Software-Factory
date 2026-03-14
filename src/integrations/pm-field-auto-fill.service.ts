import { Injectable, Logger } from '@nestjs/common';
import { ProjectIntegration } from '@prisma/client';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { SentryService } from '@/common/sentry/sentry.service';
import {
  NormalizedField,
  NormalizedFieldType,
  FieldValue,
} from '@/integrations/providers/dto/normalized-field.dto';

export interface ExecutionContext {
  executionDurationMinutes?: number; // computed: (completed_at - started_at) / 60000 — undefined if either timestamp is null
  deployedAt?: Date | null; // Deployment.deployed_at
  prUrl?: string | null; // GitHubPush.pr_url
  branchName?: string | null; // GitHubPush.branch_name
}

export interface FactualFillResult {
  filledFields: Array<{ field: NormalizedField; value: FieldValue; source: string }>;
  remainingFields: NormalizedField[]; // fields with no matching factual pattern OR context value absent
  fillFailed?: boolean; // true only if a setFieldValue() call threw
}

@Injectable()
export class PMFieldAutoFillService {
  private readonly logger = new Logger(PMFieldAutoFillService.name);

  constructor(
    private readonly providerFactory: PMProviderFactory,
    private readonly sentry: SentryService,
  ) {}

  /**
   * AC1: fillFactualFields logic.
   * Automatically populates factual fields from execution context.
   */
  async fillFactualFields(
    integration: ProjectIntegration,
    taskId: string,
    missingFields: NormalizedField[],
    executionContext: ExecutionContext,
    correlationId: string,
  ): Promise<FactualFillResult> {
    // AC11: Empty missingFields fast-path
    if (missingFields.length === 0) {
      return { filledFields: [], remainingFields: [] };
    }

    const filledFields: Array<{ field: NormalizedField; value: FieldValue; source: string }> = [];
    const remainingFields: NormalizedField[] = [];
    let fillFailed = false;

    try {
      // Step 1: Resolve provider
      const provider = await this.providerFactory.getProvider(integration);

      // Step 2-3: Match and fill fields sequentially (AC9)
      for (const field of missingFields) {
        const match = this.matchField(field, executionContext, correlationId);

        if (!match) {
          remainingFields.push(field);
          continue;
        }

        try {
          // AC4-AC7: Set field value via provider
          await provider.setFieldValue(taskId, field.id, match.value);
          filledFields.push({ field, value: match.value, source: match.source });
        } catch (error) {
          // AC10: partial-fail on setFieldValue error
          this.logger.warn(
            `[${correlationId}] CS2-2: setFieldValue failed for field ${field.id} (${field.name}): ${(error as Error).message} — adding to remainingFields`,
          );
          this.sentry.captureException(error as Error);
          remainingFields.push(field);
          fillFailed = true;
        }
      }

      // AC1: Debug log
      this.logger.debug(
        `[${correlationId}] CS2-2: factual fill for task ${taskId}: ${missingFields.length} missing fields, ${filledFields.length} filled, ${remainingFields.length} remaining`,
      );

      return {
        filledFields,
        remainingFields,
        fillFailed: fillFailed || undefined,
      };
    } catch (error) {
      // Fail-open: if provider cannot be fetched, all fields remain
      this.logger.error(
        `[${correlationId}] CS2-2: factual fill failed for task ${taskId}: ${(error as Error).message}`,
      );
      this.sentry.captureException(error as Error);
      return {
        filledFields: [],
        remainingFields: missingFields,
        fillFailed: true,
      };
    }
  }

  /**
   * Helper to match a field against factual patterns.
   * AC4-AC8: Matching patterns implementation.
   */
  private matchField(
    field: NormalizedField,
    ctx: ExecutionContext,
    correlationId: string,
  ): { value: FieldValue; source: string } | null {
    const name = field.name.toLowerCase();

    // AC4: Duration fill rule
    if (field.type === NormalizedFieldType.NUMBER && /time|duration|estimate/.test(name)) {
      if (ctx.executionDurationMinutes !== undefined && isFinite(ctx.executionDurationMinutes)) {
        return { value: ctx.executionDurationMinutes, source: 'execution_duration' };
      }
      this.logMissingContext(field, 'executionDurationMinutes', correlationId);
      return null;
    }

    // AC5: Deployed-at date fill rule
    if (field.type === NormalizedFieldType.DATE && /completion|deployed|done/.test(name)) {
      if (ctx.deployedAt instanceof Date) {
        return { value: ctx.deployedAt.getTime(), source: 'deployed_at' };
      }
      this.logMissingContext(field, 'deployedAt', correlationId);
      return null;
    }

    // AC6: PR URL fill rule
    if (
      (field.type === NormalizedFieldType.URL || field.type === NormalizedFieldType.TEXT) &&
      /pr|pull[\s_-]?request/.test(name)
    ) {
      if (ctx.prUrl) {
        return { value: ctx.prUrl, source: 'pr_url' };
      }
      this.logMissingContext(field, 'prUrl', correlationId);
      return null;
    }

    // AC7: Branch name fill rule
    if (field.type === NormalizedFieldType.TEXT && /branch/.test(name)) {
      if (ctx.branchName) {
        return { value: ctx.branchName, source: 'branch_name' };
      }
      this.logMissingContext(field, 'branchName', correlationId);
      return null;
    }

    return null; // AC8: No match
  }

  private logMissingContext(field: NormalizedField, ctxKey: string, correlationId: string): void {
    this.logger.debug(
      `[${correlationId}] CS2-2: field "${field.name}" (${field.id}) matches factual pattern "${ctxKey}" but context value is absent — skipping`,
    );
  }
}
