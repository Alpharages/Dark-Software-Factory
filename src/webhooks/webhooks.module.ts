import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  PrometheusModule,
  makeCounterProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { WebhooksController } from './webhooks.controller';
import { GitHubWebhooksController } from './github-webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookSignatureGuard, GitHubWebhookSignatureGuard } from './guards';
import { WebhookDeduplicationService, ActionableStatusService } from './services';
import { DatabaseModule } from '@/database/database.module';
import { RabbitMQModule } from '@/rabbitmq/rabbitmq.module';
// Story 20.2: Import TicketIntakeModule for StatusEvaluationService
import { TicketIntakeModule } from '@/ticket-intake/ticket-intake.module';
import { AppMetricsModule, WEBHOOK_METRICS, QUEUE_METRICS, LABELS } from '@/common/metrics';
import { FileLocksModule } from '@/file-locks/file-locks.module';

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
    // Story 20.2: Import TicketIntakeModule for unified StatusEvaluationService
    TicketIntakeModule,
    PrometheusModule, // Required for @InjectMetric decorator
    AppMetricsModule, // For Prometheus metrics
    FileLocksModule, // Story 12.3: Release locks on PR merge
  ],
  controllers: [WebhooksController, GitHubWebhooksController],
  providers: [
    WebhooksService,
    WebhookSignatureGuard,
    GitHubWebhookSignatureGuard,
    // Story 20.1: Webhook reliability services
    WebhookDeduplicationService,
    ActionableStatusService,
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
    // Story 20.1: Dead letter queue metric
    makeCounterProvider({
      name: QUEUE_METRICS.DEAD_LETTER_COUNT,
      help: 'Total number of messages sent to dead letter queue',
      labelNames: ['queue', 'reason'],
    }),
    // Story 20.1: Status filtering metrics
    makeCounterProvider({
      name: WEBHOOK_METRICS.FILTERED_TOTAL,
      help: 'Total number of webhooks filtered by status',
      labelNames: ['status', 'reason'],
    }),
    makeCounterProvider({
      name: WEBHOOK_METRICS.ACTIONABLE_TOTAL,
      help: 'Total number of actionable webhooks queued',
      labelNames: ['internal_status'],
    }),
  ],
  exports: [WebhooksService, WebhookDeduplicationService, ActionableStatusService],
})
export class WebhooksModule {}
