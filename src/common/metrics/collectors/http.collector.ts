import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Histogram, Counter } from 'prom-client';
import { HTTP_METRICS, LABELS } from '../metrics.constants';
import { HttpMetricData } from '../metrics.interface';

@Injectable()
export class HttpCollector {
  constructor(
    @InjectMetric(HTTP_METRICS.REQUEST_DURATION)
    private readonly httpRequestDuration: Histogram,

    @InjectMetric(HTTP_METRICS.REQUEST_TOTAL)
    private readonly httpRequestTotal: Counter,
  ) {}

  recordRequest(data: HttpMetricData): void {
    const labels = {
      [LABELS.METHOD]: data.method,
      [LABELS.PATH]: this.normalizePath(data.path),
      [LABELS.STATUS_CODE]: String(data.statusCode),
    };

    this.httpRequestDuration.observe(labels, data.duration);
    this.httpRequestTotal.inc(labels);
  }

  private normalizePath(path: string): string {
    // Normalize paths to prevent high cardinality
    // Replace UUIDs and numeric IDs with placeholders
    return path
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
      .replace(/\/\d+/g, '/:id')
      .replace(/\?.*/g, ''); // Remove query strings
  }
}
