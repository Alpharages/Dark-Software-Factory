import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { SentryService } from '../sentry.service';
import { FastifyRequest } from 'fastify';

interface AuthenticatedRequest extends FastifyRequest {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

@Injectable()
export class SentryInterceptor implements NestInterceptor {
  constructor(private readonly sentryService: SentryService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    // Set user context if available (from JWT guard)
    if (user) {
      this.sentryService.setUser({
        id: user.id,
        email: user.email,
        role: user.role,
        ipAddress: request.ip,
      });
    }

    // Set request context
    this.sentryService.setRequestContext({
      method: request.method,
      url: request.url,
      headers: request.headers as Record<string, string>,
      query: request.query as Record<string, string>,
      params: request.params as Record<string, string>,
      correlationId: request.headers['x-correlation-id'] as string,
    });

    return next.handle().pipe(
      tap({
        error: (exception) => {
          // Interceptor can capture errors that filter might miss or add extra context
          // But usually Filter handles the capture.
          // This is useful for breadcrumbs or specific transaction handling
        },
      }),
    );
  }
}
