import { InfrastructureException } from '@/common/exceptions/infrastructure.exception';

/**
 * Base Cleanup Exception
 * Story 23.2: Automated Container Cleanup
 */
export class CleanupException extends InfrastructureException {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}

/**
 * Container Cleanup Error
 */
export class ContainerCleanupError extends CleanupException {
  constructor(containerId: string, originalError: string) {
    super(`Failed to cleanup container ${containerId}: ${originalError}`, originalError);
  }
}

/**
 * Workspace Cleanup Error
 */
export class WorkspaceCleanupError extends CleanupException {
  constructor(workspacePath: string, originalError: string) {
    super(`Failed to cleanup workspace at ${workspacePath}: ${originalError}`, originalError);
  }
}

/**
 * Cleanup Timeout Error
 */
export class CleanupTimeoutError extends CleanupException {
  constructor(executionId: string) {
    super(`Cleanup timed out for execution ${executionId}`);
  }
}
