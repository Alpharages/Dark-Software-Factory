import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { ClickUpModule } from '@/clickup/clickup.module';
import { SystemConfigModule } from '@/system-settings/system-config.module';
import { SentryModule } from '@/common/sentry';
import { RabbitMQModule } from '@/rabbitmq/rabbitmq.module';
import { FixTicketService } from './fix-ticket.service';
import { FixTicketConsumer } from './fix-ticket.consumer';
import { FixTicketMetrics } from './fix-ticket.metrics';

@Module({
  imports: [DatabaseModule, ClickUpModule, SystemConfigModule, SentryModule, RabbitMQModule],
  providers: [FixTicketService, FixTicketConsumer, FixTicketMetrics],
  exports: [FixTicketService],
})
export class ProductionMonitoringModule {}
