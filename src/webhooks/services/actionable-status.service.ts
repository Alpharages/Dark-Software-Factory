/**
 * Story 20.1: Actionable Status Service
 *
 * Evaluates if a task status warrants AI processing.
 * Loads actionable/non-actionable status lists from configuration.
 *
 * AC3: Status-Based Routing - queue AI execution for actionable statuses
 * AC4: Non-Actionable Status Filtering - ignore done/closed/blocked
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InternalTaskStatus, TaskProviderType } from '../../ticket-intake/dto/task-event.dto';

export interface StatusEvaluationResult {
  isActionable: boolean;
  internalStatus: InternalTaskStatus;
  reason: string;
}

// Static status mappings for ClickUp (avoids rebuilding on each call)
const CLICKUP_STATUS_MAP: ReadonlyMap<string, InternalTaskStatus> = new Map([
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

@Injectable()
export class ActionableStatusService {
  private readonly logger = new Logger(ActionableStatusService.name);

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

    this.logger.log(`Actionable statuses: [${Array.from(this.actionableStatuses).join(', ')}]`);
    this.logger.log(
      `Non-actionable statuses: [${Array.from(this.nonActionableStatuses).join(', ')}]`,
    );
  }

  /**
   * Evaluate if a provider status is actionable for AI processing.
   *
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

    // Default behavior: QUEUED status is actionable for processing
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
   * @param internalStatus - Internal task status
   * @returns true if status should trigger AI processing
   */
  isActionableInternalStatus(internalStatus: InternalTaskStatus): boolean {
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
   * @param normalizedStatus - Lowercase, trimmed status string
   * @param providerType - Provider type for provider-specific mapping
   * @returns InternalTaskStatus
   */
  private mapToInternalStatus(
    normalizedStatus: string,
    providerType: TaskProviderType,
  ): InternalTaskStatus {
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
   */
  private mapClickUpStatus(normalizedStatus: string): InternalTaskStatus {
    return CLICKUP_STATUS_MAP.get(normalizedStatus) || 'QUEUED';
  }

  /**
   * Generic status mapping for unknown providers.
   */
  private mapGenericStatus(normalizedStatus: string): InternalTaskStatus {
    return GENERIC_STATUS_MAP.get(normalizedStatus) || 'QUEUED';
  }

  /**
   * Get configured actionable statuses.
   */
  getActionableStatuses(): string[] {
    return Array.from(this.actionableStatuses);
  }

  /**
   * Get configured non-actionable statuses.
   */
  getNonActionableStatuses(): string[] {
    return Array.from(this.nonActionableStatuses);
  }
}
