import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { ClickUpModule } from '@/clickup/clickup.module';
import { SystemConfigModule } from '@/system-settings/system-config.module';
import { SentryModule } from '@/common/sentry';
import { RabbitMQModule } from '@/rabbitmq/rabbitmq.module';
import { RealtimeModule } from '@/realtime/realtime.module';
import { AppMetricsModule } from '@/common/metrics/metrics.module';
import { FixTicketService } from './fix-ticket.service';
import { FixTicketConsumer } from './fix-ticket.consumer';
import { FixTicketMetrics } from './fix-ticket.metrics';
import { ErrorContextService } from './error-context.service';
import { ErrorContextConsumer } from './error-context.consumer';
import { ProductionMonitoringController } from './production-monitoring.controller';
// Story 9-U-5: Production Error Dashboard
import { ProductionErrorDashboardController } from './production-error-dashboard.controller';
import { ProductionErrorDashboardService } from './production-error-dashboard.service';
import { ProductionErrorDashboardMetrics } from './production-error-dashboard.metrics';
import { ProductionErrorEventEmitter } from './production-error-event-emitter.service';

@Module({
  imports: [
    DatabaseModule,
    ClickUpModule,
    SystemConfigModule,
    SentryModule,
    RabbitMQModule,
    // Story 9-U-5: Real-time updates and metrics
    RealtimeModule,
    AppMetricsModule,
  ],
  controllers: [ProductionMonitoringController, ProductionErrorDashboardController],
  providers: [
    FixTicketService,
    FixTicketConsumer,
    FixTicketMetrics,
    // Story 9-U-4: Error Context Extraction
    ErrorContextService,
    ErrorContextConsumer,
    // Story 9-U-5: Production Error Dashboard
    ProductionErrorDashboardService,
    ProductionErrorDashboardMetrics,
    ProductionErrorEventEmitter,
  ],
  exports: [FixTicketService, ErrorContextService, ProductionErrorDashboardService],
})
export class ProductionMonitoringModule {}
