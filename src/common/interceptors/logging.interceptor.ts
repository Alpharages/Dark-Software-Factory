import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { FastifyRequest, FastifyReply } from 'fastify';
import { LoggerService } from '../logger';
import { getRequestContext } from '../context';
import { redactSensitiveData } from '../logger/formatters';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const response = ctx.getResponse<FastifyReply>();

    const { method, url, ip } = request;
    const userAgent = request.headers['user-agent'] || 'unknown';
    const reqContext = getRequestContext();
    const startTime = reqContext?.startTime || Date.now();

    // Log request with optional body (redacted)
    const logContext: Record<string, unknown> = {
      method,
      url,
      ip: this.anonymizeIp(ip),
      userAgent,
      userId: reqContext?.userId,
    };

    // Log request body for non-GET requests (debugging)
    if (method !== 'GET' && request.body && Object.keys(request.body as object).length > 0) {
      logContext.body = redactSensitiveData(request.body);
    }

    this.logger.log('Request received', logContext);

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        this.logger.log('Request completed', {
          method,
          url,
          statusCode: response.statusCode,
          duration,
          userId: reqContext?.userId,
          timings: reqContext?.timings,
        });
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        this.logger.error('Request failed', error.stack, {
          method,
          url,
          statusCode: error.status || 500,
          duration,
          errorMessage: error.message,
          userId: reqContext?.userId,
        });
        throw error;
      }),
    );
  }

  private anonymizeIp(ip: string | undefined): string {
    if (!ip) return 'unknown';
    if (ip === '::1') return '::1';
    const parts = ip.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    return ip;
  }
}
