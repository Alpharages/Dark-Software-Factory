import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { FastifyRequest, FastifyReply } from 'fastify';
import { MetricsService } from '../metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const response = ctx.getResponse<FastifyReply>();

    const startTime = process.hrtime.bigint();

    return next.handle().pipe(
      tap(() => {
        this.recordMetrics(request, response, startTime);
      }),
      catchError((error) => {
        this.recordMetrics(request, response, startTime, error.status || 500);
        throw error;
      }),
    );
  }

  private recordMetrics(
    request: FastifyRequest,
    response: FastifyReply,
    startTime: bigint,
    errorStatus?: number,
  ): void {
    const duration = Number(process.hrtime.bigint() - startTime) / 1e9; // Convert to seconds
    const statusCode = errorStatus || response.statusCode;

    this.metricsService.recordHttpRequest({
      method: request.method,
      path: request.url,
      statusCode,
      duration,
    });
  }
}
