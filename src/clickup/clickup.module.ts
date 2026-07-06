import { Module, forwardRef } from '@nestjs/common';
import { ClickUpService } from './clickup.service';
import { ClickUpTaskUpdateConsumer } from './clickup-task-update.consumer';
import { SentryModule } from '../common/sentry/sentry.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { LoggerModule } from '../common/logger/logger.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { DatabaseModule } from '../database/database.module';
import { AuditLogModule } from '../common/audit/audit-log.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { DependenciesModule } from '@/dependencies/dependencies.module';

/**
 * ClickUp API Integration Module
 *
 * Services:
 * - ClickUpService: API client for status updates, comments, and task fetching (CS1-7: graceful degradation without API key)
 * - ClickUpTaskUpdateConsumer: Processes task updates from queue
 * Note: ClickUpPollingOrchestrator removed in CS1-7 — replaced by PmPollingOrchestrator (CS0-8)
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
    forwardRef(() => DependenciesModule),
  ],
  controllers: [],
  providers: [ClickUpService, ClickUpTaskUpdateConsumer],
  exports: [ClickUpService],
})
export class ClickUpModule {}
