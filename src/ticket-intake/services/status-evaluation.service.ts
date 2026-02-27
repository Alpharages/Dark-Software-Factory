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

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

// Static status mappings for ClickUp (avoids rebuilding on each call)
// Exported for use by task-event.mapper (Story 20.2)
export const CLICKUP_STATUS_MAP: ReadonlyMap<string, InternalTaskStatus> = new Map([
  ['to do', 'QUEUED'],
  ['todo', 'QUEUED'],
  ['open', 'QUEUED'],
  ['backlog', 'QUEUED'],
  ['in progress', 'AI_PROCESSING'],
  ['inprogress', 'AI_PROCESSING'],
  ['ready for ai', 'AI_PROCESSING'],
  ['ai processing', 'AI_PROCESSING'],
  ['ready for dev', 'AI_PROCESSING'],
  ['review', 'QA_REVIEW'],
  ['in review', 'QA_REVIEW'],
  ['qa review', 'QA_REVIEW'],
  ['waiting', 'WAITING'],
  ['on hold', 'WAITING'],
  ['pending', 'WAITING'],
  ['blocked', 'BLOCKED_CIRCULAR'],
  ['blocked circular', 'BLOCKED_CIRCULAR'],
  ['validation failed', 'VALIDATION_FAILED'],
  ['failed', 'VALIDATION_FAILED'],
  ['done', 'COMPLETED'],
  ['completed', 'COMPLETED'],
  ['closed', 'COMPLETED'],
  ['cancelled', 'COMPLETED'],
  ['canceled', 'COMPLETED'],
  ['archived', 'COMPLETED'],
  ['deployed', 'DEPLOYED'],
  ['in production', 'DEPLOYED'],
]);

// Generic status mapping for unknown providers
const GENERIC_STATUS_MAP: ReadonlyMap<string, InternalTaskStatus> = new Map([
  ['open', 'QUEUED'],
  ['new', 'QUEUED'],
  ['todo', 'QUEUED'],
  ['in progress', 'AI_PROCESSING'],
  ['processing', 'AI_PROCESSING'],
  ['active', 'AI_PROCESSING'],
  ['review', 'QA_REVIEW'],
  ['waiting', 'WAITING'],
  ['blocked', 'BLOCKED_CIRCULAR'],
  ['done', 'COMPLETED'],
  ['completed', 'COMPLETED'],
  ['closed', 'COMPLETED'],
  ['cancelled', 'COMPLETED'],
]);

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
export class StatusEvaluationService implements OnModuleInit {
  private readonly logger = new Logger(StatusEvaluationService.name);

  // Status mappings from provider-specific to internal status
  private readonly actionableStatuses: Set<string>;
  private readonly nonActionableStatuses: Set<string>;

  constructor(private readonly configService: ConfigService) {
    // Load status lists from configuration
    const actionableList = this.configService.get<string[]>('webhooks.actionableStatuses', [
      'in progress',
      'ready for ai',
      'ai processing',
      'open',
    ]);

    const nonActionableList = this.configService.get<string[]>('webhooks.nonActionableStatuses', [
      'done',
      'closed',
      'blocked',
      'cancelled',
      'archived',
    ]);

    this.actionableStatuses = new Set(actionableList.map((s) => s.toLowerCase()));
    this.nonActionableStatuses = new Set(nonActionableList.map((s) => s.toLowerCase()));
  }

  /**
   * Validate configuration on module init
   * AC4: Configuration validation on application startup
   */
  onModuleInit(): void {
    this.logger.log(`Actionable statuses: [${Array.from(this.actionableStatuses).join(', ')}]`);
    this.logger.log(
      `Non-actionable statuses: [${Array.from(this.nonActionableStatuses).join(', ')}]`,
    );

    // Validate that actionable and non-actionable lists don't overlap
    const overlap = Array.from(this.actionableStatuses).filter((s) =>
      this.nonActionableStatuses.has(s),
    );
    if (overlap.length > 0) {
      this.logger.warn(
        `Status configuration warning: [${overlap.join(', ')}] appear in both actionable and non-actionable lists`,
      );
    }
  }

  /**
   * Evaluate if a provider status is actionable for AI processing.
   *
   * AC1: Centralized status evaluation with consistent interface
   * AC3, AC4: Check task status and determine if AI should process it
   *
   * @param providerStatus - Raw status string from provider
   * @param providerType - Type of provider (ClickUp, etc.)
   * @returns Evaluation result with internal status mapping
   */
  evaluateStatus(
    providerStatus: string,
    providerType: TaskProviderType = TaskProviderType.CLICKUP,
  ): StatusEvaluationResult {
    const normalizedStatus = providerStatus.toLowerCase().trim();

    // Map to internal status
    const internalStatus = this.mapToInternalStatus(normalizedStatus, providerType);

    // Check if explicitly actionable
    if (this.actionableStatuses.has(normalizedStatus)) {
      return {
        isActionable: true,
        internalStatus,
        reason: `Status '${providerStatus}' is in actionable list`,
      };
    }

    // Check if explicitly non-actionable
    if (this.nonActionableStatuses.has(normalizedStatus)) {
      return {
        isActionable: false,
        internalStatus,
        reason: `Status '${providerStatus}' is in non-actionable list`,
      };
    }

    // Default behavior: QUEUED and AI_PROCESSING statuses are actionable
    // Unknown statuses default to QUEUED to ensure no tasks are lost
    if (internalStatus === 'QUEUED' || internalStatus === 'AI_PROCESSING') {
      return {
        isActionable: true,
        internalStatus,
        reason: `Status '${providerStatus}' maps to actionable internal status '${internalStatus}'`,
      };
    }

    // Non-actionable internal statuses
    return {
      isActionable: false,
      internalStatus,
      reason: `Status '${providerStatus}' maps to non-actionable internal status '${internalStatus}'`,
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
   * AC3: Consistent status mapping across all entry points
   *
   * @param providerStatus - Raw provider status string (will be normalized)
   * @param providerType - Provider type for provider-specific mapping
   * @returns InternalTaskStatus
   */
  mapToInternalStatus(
    providerStatus: string,
    providerType: TaskProviderType = TaskProviderType.CLICKUP,
  ): InternalTaskStatus {
    const normalizedStatus = providerStatus.toLowerCase().trim();

    switch (providerType) {
      case TaskProviderType.CLICKUP:
        return this.mapClickUpStatus(normalizedStatus);
      case TaskProviderType.ASANA:
      case TaskProviderType.JIRA:
      default:
        // Default mapping for unknown providers
        return this.mapGenericStatus(normalizedStatus);
    }
  }

  /**
   * ClickUp-specific status mapping.
   *
   * @param normalizedStatus - Lowercase, trimmed status string
   * @returns InternalTaskStatus
   */
  private mapClickUpStatus(normalizedStatus: string): InternalTaskStatus {
    return CLICKUP_STATUS_MAP.get(normalizedStatus) || 'QUEUED';
  }

  /**
   * Generic status mapping for unknown providers.
   *
   * @param normalizedStatus - Lowercase, trimmed status string
   * @returns InternalTaskStatus
   */
  private mapGenericStatus(normalizedStatus: string): InternalTaskStatus {
    return GENERIC_STATUS_MAP.get(normalizedStatus) || 'QUEUED';
  }

  /**
   * Get configured actionable statuses.
   *
   * @returns Array of actionable status strings
   */
  getActionableStatuses(): string[] {
    return Array.from(this.actionableStatuses);
  }

  /**
   * Get configured non-actionable statuses.
   *
   * @returns Array of non-actionable status strings
   */
  getNonActionableStatuses(): string[] {
    return Array.from(this.nonActionableStatuses);
  }
}
