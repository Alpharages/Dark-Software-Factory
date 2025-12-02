import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { getCorrelationId } from '../context';

/**
 * Metadata key for correlation ID header
 */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Decorator to extract correlation ID from request context
 *
 * Per NFR-O2: Logs must include correlation IDs to trace requests across systems
 *
 * Usage:
 * @Get()
 * findAll(@CorrelationId() correlationId: string) {
 *   this.logger.log(`Processing request ${correlationId}`);
 * }
 */
export const CorrelationId = createParamDecorator(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (data: unknown, ctx: ExecutionContext): string => {
    // Get correlation ID from async local storage (set by middleware)
    // Falls back to 'unknown' if not available (should not happen with middleware)
    return getCorrelationId() || 'unknown';
  },
);
