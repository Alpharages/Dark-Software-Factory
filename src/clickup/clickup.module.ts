import { Module, forwardRef } from '@nestjs/common';
import { ClickUpService } from './clickup.service';
import { ClickUpPollingOrchestrator } from './clickup-polling-orchestrator.service';
import { ClickUpWebhookConsumer } from './clickup-webhook-consumer.service';
import { ClickUpTaskUpdateConsumer } from './clickup-task-update.consumer';
import { SentryModule } from '../common/sentry/sentry.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { LoggerModule } from '../common/logger/logger.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { DatabaseModule } from '../database/database.module';
import { AuditLogModule } from '../common/audit/audit-log.module';
import { IntegrationsModule } from '../integrations/integrations.module';

/**
 * ClickUp API Integration Module
 *
 * Hybrid Webhook & Polling Support:
 * - Webhooks: Real-time events (Business plan required)
 * - Polling: Fallback for free/personal plans
 * - Feature flag: CLICKUP_USE_WEBHOOKS toggles mode
 *
 * Services:
 * - ClickUpService: API client for status updates, comments, and task fetching
 * - ClickUpPollingOrchestrator: Polls lists for task changes
 * - ClickUpWebhookConsumer: Processes webhook events
 * - ClickUpWebhookController: REST endpoint for webhooks
 * - ClickUpTaskUpdateConsumer: Processes task updates from queue
 */
@Module({
  imports: [
    DatabaseModule,
    SentryModule,
    AppMetricsModule,
    LoggerModule,
    RabbitMQModule,
    AuditLogModule,
    forwardRef(() => IntegrationsModule),
  ],
  controllers: [],
  providers: [
    ClickUpService,
    ClickUpPollingOrchestrator,
    ClickUpWebhookConsumer,
    ClickUpTaskUpdateConsumer,
  ],
  exports: [ClickUpService, ClickUpPollingOrchestrator, ClickUpWebhookConsumer],
})
export class ClickUpModule {}
