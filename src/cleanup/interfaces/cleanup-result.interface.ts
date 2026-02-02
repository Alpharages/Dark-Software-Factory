/**
 * Cleanup Result Interface
 * Story 23.2: Automated Container Cleanup
 */
export interface CleanupError {
  type: 'container' | 'workspace' | 'timeout';
  message: string;
}

export interface CleanupResult {
  executionId: string;
  containerRemoved: boolean;
  workspaceCleaned: boolean;
  bytesReclaimed: number;
  durationMs: number;
  errors: CleanupError[];
}
