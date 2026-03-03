import { Controller, ForbiddenException, Get, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../decorators/public.decorator';
import { register } from 'prom-client';
import { ApiExcludeController } from '@nestjs/swagger';

/**
 * Prometheus metrics controller
 * Exposes metrics at /metrics endpoint for Prometheus scraping.
 * In production this endpoint is restricted — only accessible when
 * METRICS_ENABLED=true is explicitly set (e.g. for an internal scraper).
 * This endpoint is excluded from the global 'api' prefix and versioning.
 */
@SkipThrottle()
@ApiExcludeController()
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class PrometheusMetricsController {
  /**
   * Prometheus metrics endpoint
   * Returns all registered metrics in Prometheus text format
   */
  @Public()
  @Get()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getMetrics(@Res({ passthrough: true }) response: any): Promise<string> {
    const isProduction = process.env.NODE_ENV === 'production';
    const metricsEnabled = process.env.METRICS_ENABLED === 'true';

    if (isProduction && !metricsEnabled) {
      throw new ForbiddenException('Metrics endpoint is disabled in production');
    }

    response.header('Content-Type', register.contentType);
    return register.metrics();
  }
}
