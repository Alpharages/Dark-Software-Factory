import { Module } from '@nestjs/common';
import { PmPollingOrchestrator } from './pm-polling-orchestrator.service';
import { IntegrationsModule } from '../integrations.module';
import { DatabaseModule } from '@/database/database.module';
import { RabbitMQModule } from '@/rabbitmq/rabbitmq.module';
import { LoggerModule } from '@/common/logger';
import { AppMetricsModule } from '@/common/metrics';
import { SentryModule } from '@/common/sentry';
import { DevelopmentGateModule } from '@/ticket-intake/services/development-gate.module';

@Module({
  imports: [
    IntegrationsModule,
    DatabaseModule,
    RabbitMQModule,
    LoggerModule,
    AppMetricsModule,
    SentryModule,
    DevelopmentGateModule,
  ],
  providers: [PmPollingOrchestrator],
})
export class PmPollingModule {}
