/**
 * Execution phases used by agent skills to determine the appropriate
 * PM tool status transition at each lifecycle point.
 */
export enum ExecutionPhase {
  /** AI has started coding */
  STARTED = 'STARTED',
  /** AI finished and a PR was created */
  COMPLETED = 'COMPLETED',
  /** Execution errored or was blocked */
  FAILED = 'FAILED',
}
