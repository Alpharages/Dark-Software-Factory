import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { LoggerService } from '../logger';
import { getRequestContext } from '../context';
import { AUDIT_LOG_KEY, AuditLogOptions } from '../decorators/audit-log.decorator';

/**
 * Interceptor to process @AuditLog() decorator
 * Creates audit trail entries for methods marked with @AuditLog()
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: LoggerService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const auditOptions = this.reflector.get<AuditLogOptions>(AUDIT_LOG_KEY, context.getHandler());

    if (!auditOptions) {
      return next.handle();
    }

    const ctx = context.switchToHttp();
    const request = ctx.getRequest();
    const reqContext = getRequestContext();
    const startTime = Date.now();

    const auditContext = {
      action: auditOptions.action,
      resource: auditOptions.resource,
      userId: reqContext?.userId || 'anonymous',
      userRole: reqContext?.userRole,
      ip: request.ip,
      method: request.method,
      url: request.url,
    };

    this.logger.log(`[AUDIT] ${auditOptions.action} on ${auditOptions.resource}`, auditContext);

    return next.handle().pipe(
      tap({
        next: (result) => {
          const duration = Date.now() - startTime;
          this.logger.log(`[AUDIT] ${auditOptions.action} on ${auditOptions.resource} - SUCCESS`, {
            ...auditContext,
            duration,
            success: true,
          });
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          this.logger.error(
            `[AUDIT] ${auditOptions.action} on ${auditOptions.resource} - FAILED`,
            error.stack,
            { ...auditContext, duration, success: false, error: error.message },
          );
        },
      }),
    );
  }
}
