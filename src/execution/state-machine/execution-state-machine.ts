import { Injectable, Logger } from '@nestjs/common';
import { ExecutionStatus } from '@/prisma/client';
import {
  isValidTransition,
  isTerminalStatus,
  isRetryableStatus,
  STATUS_LABELS,
  VALID_TRANSITIONS,
} from '../enums';
import { IStateTransition } from '../interfaces';

// Map-based lookups for type-safe property access
const statusLabelsMap = new Map(Object.entries(STATUS_LABELS));
const transitionsMap = new Map(Object.entries(VALID_TRANSITIONS));

/**
 * Execution State Machine
 *
 * Enforces valid state transitions and provides transition metadata.
 * FR62: System monitors AI execution progress
 */
@Injectable()
export class ExecutionStateMachine {
  private readonly logger = new Logger(ExecutionStateMachine.name);

  /**
   * Validate and execute a state transition
   *
   * @param executionId - Execution ID
   * @param currentStatus - Current status
   * @param targetStatus - Desired new status
   * @param reason - Optional reason for transition
   * @returns State transition record or throws error
   */
  transition(
    executionId: string,
    currentStatus: ExecutionStatus,
    targetStatus: ExecutionStatus,
    reason?: string,
  ): IStateTransition {
    // Same state is a no-op
    if (currentStatus === targetStatus) {
      this.logger.debug(
        `[${executionId}] Status already ${statusLabelsMap.get(currentStatus)}, no transition needed`,
      );
      return {
        executionId,
        previousStatus: currentStatus,
        newStatus: targetStatus,
        reason: 'No change',
        transitionedAt: new Date(),
      };
    }

    // Validate transition
    if (!isValidTransition(currentStatus, targetStatus)) {
      const error = `Invalid transition: ${statusLabelsMap.get(currentStatus)} → ${statusLabelsMap.get(targetStatus)} `;
      this.logger.error(`[${executionId}] ${error} `);
      throw new InvalidStateTransitionError(executionId, currentStatus, targetStatus, error);
    }

    // Create transition record
    const transition: IStateTransition = {
      executionId,
      previousStatus: currentStatus,
      newStatus: targetStatus,
      reason,
      transitionedAt: new Date(),
    };

    this.logger.log(
      `[${executionId}] State transition: ${statusLabelsMap.get(currentStatus)} → ${statusLabelsMap.get(targetStatus)} ` +
        (reason ? ` (${reason})` : ''),
    );

    return transition;
  }

  /**
   * Check if execution can be started (QUEUED → IN_PROGRESS)
   */
  canStart(currentStatus: ExecutionStatus): boolean {
    return isValidTransition(currentStatus, ExecutionStatus.IN_PROGRESS);
  }

  /**
   * Check if execution can be completed
   */
  canComplete(currentStatus: ExecutionStatus): boolean {
    return isValidTransition(currentStatus, ExecutionStatus.COMPLETED);
  }

  /**
   * Check if execution can be failed
   */
  canFail(currentStatus: ExecutionStatus): boolean {
    return isValidTransition(currentStatus, ExecutionStatus.FAILED);
  }

  /**
   * Check if execution can be cancelled
   */
  canCancel(currentStatus: ExecutionStatus): boolean {
    return isValidTransition(currentStatus, ExecutionStatus.CANCELLED);
  }

  /**
   * Check if execution can be retried
   */
  canRetry(currentStatus: ExecutionStatus, retryCount: number, maxRetries: number): boolean {
    return isRetryableStatus(currentStatus) && retryCount < maxRetries;
  }

  /**
   * Check if status is terminal (no further transitions)
   */
  isTerminal(status: ExecutionStatus): boolean {
    return isTerminalStatus(status);
  }

  /**
   * Get human-readable status label
   */
  getStatusLabel(status: ExecutionStatus): string {
    return statusLabelsMap.get(status) ?? status;
  }

  /**
   * Get valid next states from current state
   */
  getValidNextStates(currentStatus: ExecutionStatus): ExecutionStatus[] {
    return (transitionsMap.get(currentStatus) as ExecutionStatus[]) ?? [];
  }
}

/**
 * Custom error for invalid state transitions
 */
export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly executionId: string,
    public readonly fromStatus: ExecutionStatus,
    public readonly toStatus: ExecutionStatus,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidStateTransitionError';
  }
}
