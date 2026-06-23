/**
 * Per-attempt QA result captured during sandbox self-healing loop (WR-6.1)
 */
export interface QAAttempt {
  attemptNumber: number;
  lintStatus: 'passed' | 'failed' | 'skipped';
  lintErrors?: { count: number; details: unknown[] };
  testStatus: 'passed' | 'failed' | 'skipped';
  testResults?: { passed: number; failed: number; details: unknown[] };
  durationMs: number;
}

/**
 * Error codes retained for execution retry classification after ai-routing removal.
 */
export enum AIErrorCode {
  TIMEOUT = 'TIMEOUT',
  PROCESS_CRASH = 'PROCESS_CRASH',
  INVALID_PROMPT = 'INVALID_PROMPT',
  CLONE_FAILED = 'CLONE_FAILED',
  GIT_ERROR = 'GIT_ERROR',
  NO_CHANGES = 'NO_CHANGES',
  WORKSPACE_LIMIT = 'WORKSPACE_LIMIT',
  DISK_SPACE = 'DISK_SPACE',
  CLI_NOT_FOUND = 'CLI_NOT_FOUND',
  UNKNOWN = 'UNKNOWN',
}
