/**
 * Cleanup Options Interface
 * Story 23.2: Automated Container Cleanup
 */
export interface CleanupOptions {
  /** Force kill container before removal */
  forceContainerRemove?: boolean;
  /** Cleanup timeout override in milliseconds */
  timeoutMs?: number;
}
