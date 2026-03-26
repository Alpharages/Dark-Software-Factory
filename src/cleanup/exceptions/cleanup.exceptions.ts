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
 * Cleanup Timeout Error
 */
export class CleanupTimeoutError extends CleanupException {
  constructor(executionId: string) {
    super(`Cleanup timed out for execution ${executionId}`);
  }
}
