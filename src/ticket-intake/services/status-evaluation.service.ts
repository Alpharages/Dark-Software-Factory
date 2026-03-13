/**
 * Story 20.2: Unified Intake Status Check
 *
 * Centralized status evaluation service used by both Webhook and Sync paths.
 * Provides consistent "Ready for AI" determination regardless of how tasks enter the system.
 *
 * AC1: Centralized Status Service - single source of truth for status evaluation
 * AC2: Shared Module Architecture - located in ticket-intake, exported for webhooks
 * AC3: Consistent Status Mapping - same mappings for all entry points
 * AC4: Configuration-Driven Actionable Statuses - env var support
 */

import { Injectable, Logger } from '@nestjs/common';
import { InternalTaskStatus, TaskProviderType } from '../dto/task-event.dto';

/**
 * Result of status evaluation
 */
export interface StatusEvaluationResult {
  /** Whether this status should trigger AI processing */
  isActionable: boolean;
  /** Mapped internal status */
  internalStatus: InternalTaskStatus;
  /** Human-readable reason for the decision */
  reason: string;
}

// Status maps removed - replaced by runtime discovery (CS1-2)

/**
 * Unified status evaluation service
 *
 * This service provides centralized status evaluation logic that is used by:
 * - Webhook processing (directly)
 * - Manual sync processing (via task-event.mapper)
 *
 * Ensures consistent "Ready for AI" determination across all entry points.
 */
@Injectable()
export class StatusEvaluationService {
  private readonly logger = new Logger(StatusEvaluationService.name);

  constructor() {}

  /**
   * Evaluate if a provider status is actionable for AI processing.
   *
   * @param providerStatus - Raw status string from provider
   * @param _providerType - Type of provider (ClickUp, etc.)
   * @returns Evaluation result with internal status mapping
   */
  evaluateStatus(
    providerStatus: string,
    _providerType: TaskProviderType = TaskProviderType.CLICKUP,
  ): StatusEvaluationResult {
    // CS1-3: This method is replaced by ai_trigger_status gate in ProjectIntegration
    return {
      isActionable: false,
      internalStatus: 'QUEUED',
      reason: 'legacy status evaluation removed — pending CS1-3 ai_trigger_status gate',
    };
  }

  /**
   * Check if an internal status is actionable.
   *
   * AC1: Centralized actionability check
   *
   * @param internalStatus - Internal task status
   * @returns true if status should trigger AI processing
   */
  isActionable(internalStatus: InternalTaskStatus): boolean {
    const actionableInternalStatuses: InternalTaskStatus[] = [
      'AI_PROCESSING',
      'QUEUED',
      'VALIDATED',
    ];
    return actionableInternalStatuses.includes(internalStatus);
  }

  /**
   * Map provider-specific status to internal status.
   *
   * @param _providerStatus - Raw provider status string (will be normalized)
   * @param _providerType - Provider type for provider-specific mapping
   * @returns InternalTaskStatus
   */
  mapToInternalStatus(
    _providerStatus: string,
    _providerType: TaskProviderType = TaskProviderType.CLICKUP,
  ): InternalTaskStatus {
    // CS1-2: Replaced by IPMProvider.getStatuses() + ai_trigger_status gate
    return 'QUEUED';
  }
}
