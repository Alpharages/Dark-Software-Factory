import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { SentryService } from '../sentry.service';
import { ErrorSeverity, ErrorCategory, IGNORED_ERRORS } from '../sentry.constants';
import { LoggerService } from '../../logger/logger.service';

@Catch()
@Injectable()
export class SentryExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly sentryService: SentryService,
    private readonly logger: LoggerService,
  ) {}

  catch(exception: Error, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    // Determine HTTP status
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // Get error details
    const errorResponse = this.getErrorResponse(exception, status);

    // Skip capturing ignored errors
    const shouldCapture = this.shouldCaptureError(exception, status);

    if (shouldCapture) {
      // Set request context
      this.sentryService.setRequestContext({
        method: request.method,
        url: request.url,
        headers: request.headers as Record<string, string>,
        query: request.query as Record<string, string>,
        params: request.params as Record<string, string>,
        correlationId: request.headers['x-correlation-id'] as string,
      });

      // Capture exception
      const eventId = this.sentryService.captureException(exception, {
        severity: this.getSeverity(status),
        category: this.getCategory(exception),
        tags: {
          status_code: String(status),
          method: request.method,
          path: this.normalizePath(request.url),
        },
        extra: {
          url: request.url,
          userAgent: request.headers['user-agent'],
        },
      });

      // Include event ID in response for support reference
      errorResponse.sentryEventId = eventId;
    }

    // Log the error
    this.logger.error(
      `[${status}] ${request.method} ${request.url} - ${exception.message}`,
      exception.stack,
      'SentryExceptionFilter',
    );

    // Send response
    response.status(status).send(errorResponse);
  }

  private getErrorResponse(exception: Error, status: number): Record<string, unknown> {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'object') {
        return {
          ...response,
          timestamp: new Date().toISOString(),
        };
      }
      return {
        statusCode: status,
        message: response,
        timestamp: new Date().toISOString(),
      };
    }

    return {
      statusCode: status,
      message: 'Internal server error',
      timestamp: new Date().toISOString(),
    };
  }

  private shouldCaptureError(exception: Error, status: number): boolean {
    // Skip 4xx client errors (except 400 with specific error types)
    if (status >= 400 && status < 500) {
      return false;
    }

    // Skip ignored error types
    if (IGNORED_ERRORS.includes(exception.constructor.name as never)) {
      return false;
    }

    // Capture all 5xx errors
    return status >= 500;
  }

  private getSeverity(status: number): ErrorSeverity {
    if (status >= 500) {
      return status === 503 ? ErrorSeverity.CRITICAL : ErrorSeverity.HIGH;
    }
    return ErrorSeverity.MEDIUM;
  }

  private getCategory(exception: Error): ErrorCategory {
    const name = exception.constructor.name;

    if (name.includes('Validation')) return ErrorCategory.VALIDATION;
    if (name.includes('Auth')) return ErrorCategory.AUTHENTICATION;
    if (name.includes('Forbidden')) return ErrorCategory.AUTHORIZATION;
    if (name.includes('Database') || name.includes('Prisma')) return ErrorCategory.DATABASE;
    if (name.includes('Timeout')) return ErrorCategory.TIMEOUT;

    return ErrorCategory.UNKNOWN;
  }

  private normalizePath(url: string): string {
    // Replace UUIDs and IDs with placeholders to reduce cardinality
    return url.replace(/[0-9a-f-]{36}/gi, ':uuid').replace(/\/\d+/g, '/:id');
  }
}
