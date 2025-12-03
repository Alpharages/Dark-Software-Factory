import { ExecutionStatus } from '@prisma/client';

/**
 * Valid state transitions for execution status
 *
 * State Machine:
 *                    ┌─────────────┐
 *                    │   QUEUED    │
 *                    └──────┬──────┘
 *                           │
 *                           ▼
 *                    ┌─────────────┐
 *        ┌───────────│ IN_PROGRESS │───────────┐
 *        │           └──────┬──────┘           │
 *        │                  │                  │
 *        ▼                  ▼                  ▼
 *   ┌─────────┐      ┌───────────┐      ┌─────────┐
 *   │ TIMEOUT │      │ COMPLETED │      │ FAILED  │
 *   └─────────┘      └───────────┘      └─────────┘
 *        │                                    │
 *        │          ┌───────────┐             │
 *        └─────────►│ CANCELLED │◄────────────┘
 *                   └───────────┘
 *
 * Note: CANCELLED can be reached from any non-terminal state
 */

/**
 * Map of valid transitions from each status
 */
export const VALID_TRANSITIONS: Record<ExecutionStatus, ExecutionStatus[]> = {
  [ExecutionStatus.QUEUED]: [ExecutionStatus.IN_PROGRESS, ExecutionStatus.CANCELLED],
  [ExecutionStatus.IN_PROGRESS]: [
    ExecutionStatus.COMPLETED,
    ExecutionStatus.FAILED,
    ExecutionStatus.TIMEOUT,
    ExecutionStatus.CANCELLED,
  ],
  [ExecutionStatus.COMPLETED]: [], // Terminal state
  [ExecutionStatus.FAILED]: [
    ExecutionStatus.QUEUED, // Allow retry → back to queue
    ExecutionStatus.CANCELLED,
  ],
  [ExecutionStatus.TIMEOUT]: [
    ExecutionStatus.QUEUED, // Allow retry → back to queue
    ExecutionStatus.CANCELLED,
  ],
  [ExecutionStatus.CANCELLED]: [], // Terminal state
};

/**
 * Terminal states that cannot transition
 */
export const TERMINAL_STATES: ExecutionStatus[] = [
  ExecutionStatus.COMPLETED,
  ExecutionStatus.CANCELLED,
];

/**
 * States that can be retried
 */
export const RETRYABLE_STATES: ExecutionStatus[] = [
  ExecutionStatus.FAILED,
  ExecutionStatus.TIMEOUT,
];

/**
 * Human-readable status labels
 */
export const STATUS_LABELS: Record<ExecutionStatus, string> = {
  [ExecutionStatus.QUEUED]: 'Queued',
  [ExecutionStatus.IN_PROGRESS]: 'In Progress',
  [ExecutionStatus.COMPLETED]: 'Completed',
  [ExecutionStatus.FAILED]: 'Failed',
  [ExecutionStatus.TIMEOUT]: 'Timed Out',
  [ExecutionStatus.CANCELLED]: 'Cancelled',
};

/**
 * Check if a transition is valid
 */
export function isValidTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Check if status is terminal
 */
export function isTerminalStatus(status: ExecutionStatus): boolean {
  return TERMINAL_STATES.includes(status);
}

/**
 * Check if status allows retry
 */
export function isRetryableStatus(status: ExecutionStatus): boolean {
  return RETRYABLE_STATES.includes(status);
}
