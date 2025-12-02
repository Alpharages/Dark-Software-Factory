import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookSignatureGuard } from './guards';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';

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
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookSignatureGuard],
  exports: [WebhooksService],
})
export class WebhooksModule {}
