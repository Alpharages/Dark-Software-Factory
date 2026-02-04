import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { ClickUpModule } from '@/clickup/clickup.module';
import { SystemConfigModule } from '@/system-settings/system-config.module';
import { SentryModule } from '@/common/sentry';
import { RabbitMQModule } from '@/rabbitmq/rabbitmq.module';
import { FixTicketService } from './fix-ticket.service';
import { FixTicketConsumer } from './fix-ticket.consumer';
import { FixTicketMetrics } from './fix-ticket.metrics';
import { ErrorContextService } from './error-context.service';
import { ErrorContextConsumer } from './error-context.consumer';
import { ProductionMonitoringController } from './production-monitoring.controller';

@Module({
  imports: [DatabaseModule, ClickUpModule, SystemConfigModule, SentryModule, RabbitMQModule],
  controllers: [ProductionMonitoringController],
  providers: [
    FixTicketService,
    FixTicketConsumer,
    FixTicketMetrics,
    // Story 9-U-4: Error Context Extraction
    ErrorContextService,
    ErrorContextConsumer,
  ],
  exports: [FixTicketService, ErrorContextService],
})
export class ProductionMonitoringModule {}
