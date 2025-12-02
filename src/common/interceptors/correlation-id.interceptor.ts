import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { FastifyReply } from 'fastify';
import { getCorrelationId } from '../context';

/**
 * Correlation ID Interceptor
 *
 * Per NFR-O2: Logs must include correlation IDs to trace requests across systems
 *
 * This interceptor ensures the correlation ID is added to response headers.
 * The correlation ID is set by CorrelationIdMiddleware in async local storage.
 *
 * Works in conjunction with:
 * - CorrelationIdMiddleware: Sets up async context and generates correlation ID
 * - @CorrelationId() decorator: Extracts correlation ID in route handlers
 */
@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  private readonly CORRELATION_ID_HEADER = 'x-correlation-id';

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<FastifyReply>();

    // Get correlation ID from async local storage (set by middleware)
    const correlationId = getCorrelationId();

    return next.handle().pipe(
      tap(() => {
        // Ensure correlation ID is in response headers for client tracking
        // This is a safety net - middleware should have already set it
        if (correlationId && !response.hasHeader(this.CORRELATION_ID_HEADER)) {
          response.header(this.CORRELATION_ID_HEADER, correlationId);
        }
      }),
    );
  }
}
