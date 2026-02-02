/**
 * Cleanup Options Interface
 * Story 23.2: Automated Container Cleanup
 */
export interface CleanupOptions {
  /** Override debug mode - preserve workspace even if not in debug mode */
  preserveWorkspace?: boolean;
  /** Force kill container before removal */
  forceContainerRemove?: boolean;
  /** Cleanup timeout override in milliseconds */
  timeoutMs?: number;
}
