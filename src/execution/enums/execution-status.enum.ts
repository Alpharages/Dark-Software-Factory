import { ExecutionStatus } from '@/prisma/client';
import { SafeMap } from '../../common/utils/safe-access.util';

/**
 * Valid state transitions for execution status
 *
 * State Machine:
 *                    ┌─────────────┐
 *                    │   QUEUED    │
 *                    └──────┬──────┘
 *                           │
 *              ┌────────────┼────────────┐
 *              │            │            │
 *              ▼            ▼            ▼
 *       ┌───────────┐ ┌─────────┐ ┌─────────────┐
 *       │  FAILED   │ │CANCELLED│ │ IN_PROGRESS │
 *       └───────────┘ └─────────┘ └──────┬──────┘
 *                                        │
 *                           ┌────────────┼────────────┐
 *              ┌────────────┤            │            │
 *              │            ▼            ▼            ▼
 *              │     ┌─────────┐  ┌───────────┐ ┌─────────┐
 *              │     │ TIMEOUT │  │ COMPLETED │ │ FAILED  │
 *              │     └─────────┘  └───────────┘ └─────────┘
 *              │            │            │            │
 *              │            │      ┌───────────┐      │
 *              │            └─────►│ CANCELLED │◄─────┘
 *              │                   └───────────┘      │
 *              │     ┌─────────┐                      │
 *              └──►  │ PAUSED  │ ◄────────────────────┘
 *                    └────┬────┘
 *                         │
 *              ┌──────────┼──────────┐
 *              ▼          ▼          ▼
 *       ┌──────────┐ ┌────────┐ ┌───────────┐
 *       │IN_PROGRESS│ │CANCELLED│ │EMERGENCY_STOPPED│
 *       └──────────┘ └────────┘ └───────────┘
 *
 * Note: CANCELLED can be reached from any non-terminal state
 * Note: FAILED can be reached from QUEUED (e.g., budget exceeded before execution starts)
 * Note: EMERGENCY_STOPPED is a terminal state - no transitions out
 */

/**
 * Map of valid transitions from each status
 */
export const VALID_TRANSITIONS: Record<ExecutionStatus, ExecutionStatus[]> = {
  [ExecutionStatus.QUEUED]: [
    ExecutionStatus.IN_PROGRESS,
    ExecutionStatus.FAILED, // Allow early failure (e.g., budget exceeded, validation failed)
    ExecutionStatus.CANCELLED,
  ],
  [ExecutionStatus.IN_PROGRESS]: [
    ExecutionStatus.COMPLETED,
    ExecutionStatus.FAILED,
    ExecutionStatus.TIMEOUT,
    ExecutionStatus.CANCELLED,
    ExecutionStatus.AWAITING_APPROVAL,
    ExecutionStatus.PAUSED, // Story 10-U-5: Manual pause
    ExecutionStatus.EMERGENCY_STOPPED, // Story 10-U-5: Emergency stop
    ExecutionStatus.QA_FAILED, // WR-4.1
  ],
  [ExecutionStatus.PAUSED]: [
    ExecutionStatus.IN_PROGRESS, // Resume
    ExecutionStatus.CANCELLED,
    ExecutionStatus.EMERGENCY_STOPPED, // Can emergency stop from paused
  ],
  [ExecutionStatus.COMPLETED]: [ExecutionStatus.AWAITING_APPROVAL],
  [ExecutionStatus.AWAITING_APPROVAL]: [
    ExecutionStatus.COMPLETED,
    ExecutionStatus.FAILED,
    ExecutionStatus.QUEUED, // For rework
    ExecutionStatus.CANCELLED,
    ExecutionStatus.PAUSED, // Story 10-U-5: Can pause while awaiting approval
    ExecutionStatus.EMERGENCY_STOPPED, // Story 10-U-5: Can emergency stop
  ],
  [ExecutionStatus.FAILED]: [
    ExecutionStatus.QUEUED, // Allow retry → back to queue
    ExecutionStatus.CANCELLED,
  ],
  [ExecutionStatus.TIMEOUT]: [
    ExecutionStatus.QUEUED, // Allow retry → back to queue
    ExecutionStatus.CANCELLED,
  ],
  [ExecutionStatus.CANCELLED]: [], // Terminal state
  [ExecutionStatus.EMERGENCY_STOPPED]: [], // Terminal state - Story 10-U-5
  [ExecutionStatus.QA_FAILED]: [
    ExecutionStatus.COMPLETED, // After open_pr action (WR-4.3)
    ExecutionStatus.FAILED, // After cancel action (WR-4.3)
  ],
};

/**
 * Terminal states that cannot transition
 */
export const TERMINAL_STATES: ExecutionStatus[] = [
  ExecutionStatus.COMPLETED,
  ExecutionStatus.CANCELLED,
  ExecutionStatus.EMERGENCY_STOPPED, // Story 10-U-5: Terminal state
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
  [ExecutionStatus.PAUSED]: 'Paused', // Story 10-U-5
  [ExecutionStatus.COMPLETED]: 'Completed',
  [ExecutionStatus.FAILED]: 'Failed',
  [ExecutionStatus.TIMEOUT]: 'Timed Out',
  [ExecutionStatus.CANCELLED]: 'Cancelled',
  [ExecutionStatus.AWAITING_APPROVAL]: 'Awaiting Approval',
  [ExecutionStatus.EMERGENCY_STOPPED]: 'Emergency Stopped', // Story 10-U-5
  [ExecutionStatus.QA_FAILED]: 'QA Failed', // WR-4.1
};

// Type-safe Map for transitions lookup
const transitionsMap = new SafeMap(VALID_TRANSITIONS);

/**
 * Check if a transition is valid
 */
export function isValidTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return transitionsMap.getOrDefault(from, []).includes(to);
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
