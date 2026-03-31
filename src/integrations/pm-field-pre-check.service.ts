import { Injectable, Logger } from '@nestjs/common';
import { ProjectIntegration } from '@prisma/client';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { SentryService } from '@/common/sentry/sentry.service';
import { NormalizedField } from '@/integrations/providers/dto/normalized-field.dto';
import { PMProviderClientError } from '@/integrations/providers/pm-provider-client.error';

export interface FieldPreCheckResult {
  missingFields: NormalizedField[];
  allFilled: boolean;
  preCheckFailed?: boolean;
}

/**
 * CS2.1: Required Field Pre-Check Service.
 * Identifies empty required fields on a task before status update.
 */
@Injectable()
export class PMFieldPreCheckService {
  private readonly logger = new Logger(PMFieldPreCheckService.name);

  private static readonly FAIL_OPEN: FieldPreCheckResult = {
    missingFields: [],
    allFilled: true,
    preCheckFailed: true,
  };

  constructor(
    private readonly providerFactory: PMProviderFactory,
    private readonly sentry: SentryService,
  ) {}

  /**
   * AC1: checkRequiredFields signature and logic.
   * Checks for missing required fields on a PM task.
   */
  async checkRequiredFields(
    integration: ProjectIntegration,
    taskId: string,
    containerId: string,
    correlationId: string,
  ): Promise<FieldPreCheckResult> {
    // AC8: Empty containerId guard
    if (!containerId) {
      this.logger.warn(
        `[${correlationId}] CS2-1: containerId not configured for integration ${integration.id} — skipping pre-check`,
      );
      return { ...PMFieldPreCheckService.FAIL_OPEN };
    }

    try {
      // getProvider() must be awaited first (handles token refresh)
      const provider = await this.providerFactory.getProvider(integration);

      // AC2: Parallel API calls via Promise.all
      const [requiredFields, task] = await Promise.all([
        provider.getRequiredFields(containerId),
        provider.getTask(taskId),
      ]);

      // AC4: Missing field detection logic
      const missingFields = requiredFields.filter((field) =>
        this.isFieldMissing(task.customFields, field.id),
      );

      const allFilled = missingFields.length === 0;

      // AC2: Debug log
      this.logger.debug(
        `[${correlationId}] CS2-1: pre-check for task ${taskId} in container ${containerId}: ${requiredFields.length} required fields found, ${missingFields.length} missing`,
      );

      return {
        missingFields,
        allFilled,
      };
    } catch (error) {
      // AC6: Fail-open on API error
      this.logger.warn(
        `[${correlationId}] CS2-1: pre-check failed for task ${taskId}: ${(error as Error).message} — failing open (status push will proceed)`,
      );
      // Skip Sentry for 4xx client errors (e.g. APP_001 list-not-found) — these are data/permission
      // issues, not code bugs. Only capture unexpected errors (5xx, network, etc.).
      if (!(error instanceof PMProviderClientError)) {
        this.sentry.captureException(error as Error);
      }
      return { ...PMFieldPreCheckService.FAIL_OPEN };
    }
  }

  /**
   * Helper to determine if a field is missing value on the task.
   * AC4: Present if non-null, non-undefined, non-empty-string, non-empty-array.
   * False and 0 are NOT missing.
   */
  private isFieldMissing(
    customFields: Record<string, unknown> | undefined,
    fieldId: string,
  ): boolean {
    if (!customFields) return true;

    // Key might be absent from customFields map if never set in PM tool
    if (!(fieldId in customFields)) return true;

    // eslint-disable-next-line security/detect-object-injection
    const val = customFields[fieldId];

    if (val === undefined || val === null || val === '') return true;

    if (Array.isArray(val) && val.length === 0) return true;

    return false;
  }
}
