import { SetMetadata, applyDecorators, UseInterceptors } from '@nestjs/common';
import { MetricsInterceptor } from '../interceptors/metrics.interceptor';

export const TRACK_METRIC_KEY = 'track_metric';

export interface TrackMetricOptions {
  /** Name of the metric to track */
  metricName?: string;
  /** Additional labels for the metric */
  labels?: Record<string, string>;
  /** Whether to track execution duration */
  trackDuration?: boolean;
}

/**
 * Decorator to explicitly track metrics for a method
 *
 * Usage:
 * @TrackMetric({ metricName: 'ai_execution', labels: { provider: 'cursor' } })
 * async executeAI() { ... }
 */
export function TrackMetric(options: TrackMetricOptions = {}) {
  return applyDecorators(
    SetMetadata(TRACK_METRIC_KEY, {
      trackDuration: true,
      ...options,
    }),
    UseInterceptors(MetricsInterceptor),
  );
}
