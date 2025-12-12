import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  PrometheusModule,
  makeCounterProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookSignatureGuard } from './guards';
import { DatabaseModule } from '@/database/database.module';
import { RabbitMQModule } from '@/rabbitmq/rabbitmq.module';
import { AppMetricsModule, WEBHOOK_METRICS, LABELS } from '@/common/metrics';

/**
 * Webhooks Module
 *
 * Handles incoming webhook events from ClickUp.
 *
 * Per architecture.md:
 * - webhooks/ - ClickUp webhook ingestion (FR56-59)
 * - webhooks.controller.ts - POST /webhooks/clickup
 * - webhooks.service.ts - Parse and validate webhook payloads
 * - Rate limit: 100 requests/minute (handled by global throttler)
 *
 * Per NFR-O5: System must expose Prometheus-compatible metrics
 * Metrics are provided by the global AppMetricsModule
 */
@Module({
  imports: [
    ConfigModule, // Required for WebhookSignatureGuard (CLICKUP_WEBHOOK_SECRET)
    DatabaseModule, // For audit logging
    RabbitMQModule, // For queue publishing
    PrometheusModule, // Required for @InjectMetric decorator
    AppMetricsModule, // For Prometheus metrics
  ],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhookSignatureGuard,
    // Webhook Metrics (Story 2.1 - NFR-O5)
    // Note: These metrics are also registered in AppMetricsModule, but @willsoto/nestjs-prometheus
    // requires providers to be in the same module where @InjectMetric is used
    makeCounterProvider({
      name: WEBHOOK_METRICS.RECEIVED_TOTAL,
      help: 'Total number of webhooks received',
      labelNames: ['event_type'],
    }),
    makeCounterProvider({
      name: WEBHOOK_METRICS.PROCESSED_TOTAL,
      help: 'Total number of webhooks successfully processed',
      labelNames: ['event_type', LABELS.STATUS],
    }),
    makeHistogramProvider({
      name: WEBHOOK_METRICS.PROCESSING_DURATION,
      help: 'Webhook processing duration in seconds',
      labelNames: ['event_type'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    }),
    makeCounterProvider({
      name: WEBHOOK_METRICS.ERRORS_TOTAL,
      help: 'Total number of webhook processing errors',
      labelNames: ['event_type', LABELS.ERROR_TYPE],
    }),
    makeCounterProvider({
      name: WEBHOOK_METRICS.DUPLICATES_TOTAL,
      help: 'Total number of duplicate webhooks detected',
      labelNames: ['event_type'],
    }),
  ],
  exports: [WebhooksService],
})
export class WebhooksModule {}
