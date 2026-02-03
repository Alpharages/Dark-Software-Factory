/**
 * Story 20.1: Actionable Status Service
 * Story 20.2: Deprecated - Use StatusEvaluationService from ticket-intake instead
 *
 * @deprecated This service is now a facade delegating to StatusEvaluationService.
 * Use StatusEvaluationService from @/ticket-intake/services directly for new code.
 * This facade is maintained for backward compatibility only.
 *
 * Evaluates if a task status warrants AI processing.
 * Loads actionable/non-actionable status lists from configuration.
 *
 * AC3: Status-Based Routing - queue AI execution for actionable statuses
 * AC4: Non-Actionable Status Filtering - ignore done/closed/blocked
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalTaskStatus, TaskProviderType } from '../../ticket-intake/dto/task-event.dto';
import {
  StatusEvaluationService,
  StatusEvaluationResult,
} from '../../ticket-intake/services/status-evaluation.service';

export { StatusEvaluationResult };

/**
 * @deprecated Use StatusEvaluationService from @/ticket-intake/services instead.
 * This class is maintained as a facade for backward compatibility.
 *
 * ActionableStatusService delegates all operations to StatusEvaluationService.
 * See Story 20.2: Unified Intake Status Check for migration details.
 */
@Injectable()
export class ActionableStatusService implements OnModuleInit {
  private readonly logger = new Logger(ActionableStatusService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly statusEvaluationService: StatusEvaluationService,
  ) {}

  /**
   * Log deprecation warning on module init
   */
  onModuleInit(): void {
    this.logger.debug(
      'ActionableStatusService is deprecated. Delegating to StatusEvaluationService.',
    );
  }

  /**
   * Evaluate if a provider status is actionable for AI processing.
   *
   * @deprecated Use StatusEvaluationService.evaluateStatus() instead.
   *
   * @param providerStatus - Raw status string from provider
   * @param providerType - Type of provider (ClickUp, etc.)
   * @returns Evaluation result with internal status mapping
   */
  evaluateStatus(
    providerStatus: string,
    providerType: TaskProviderType = TaskProviderType.CLICKUP,
  ): StatusEvaluationResult {
    return this.statusEvaluationService.evaluateStatus(providerStatus, providerType);
  }

  /**
   * Check if an internal status is actionable.
   *
   * @deprecated Use StatusEvaluationService.isActionable() instead.
   *
   * @param internalStatus - Internal task status
   * @returns true if status should trigger AI processing
   */
  isActionableInternalStatus(internalStatus: InternalTaskStatus): boolean {
    return this.statusEvaluationService.isActionable(internalStatus);
  }

  /**
   * Get configured actionable statuses.
   *
   * @deprecated Use StatusEvaluationService.getActionableStatuses() instead.
   *
   * @returns Array of actionable status strings
   */
  getActionableStatuses(): string[] {
    return this.statusEvaluationService.getActionableStatuses();
  }

  /**
   * Get configured non-actionable statuses.
   *
   * @deprecated Use StatusEvaluationService.getNonActionableStatuses() instead.
   *
   * @returns Array of non-actionable status strings
   */
  getNonActionableStatuses(): string[] {
    return this.statusEvaluationService.getNonActionableStatuses();
  }
}
