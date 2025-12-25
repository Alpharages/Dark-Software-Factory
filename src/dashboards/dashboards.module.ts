import { Module } from '@nestjs/common';
import { ObservabilityDashboardController } from './observability-dashboard.controller';
import { ObservabilityDashboardService } from './services/observability-dashboard.service';
import { DatabaseModule } from '@/database/database.module';
import { RabbitMQModule } from '@/rabbitmq/rabbitmq.module';
import { AppMetricsModule } from '@/common/metrics';

@Module({
  imports: [DatabaseModule, RabbitMQModule, AppMetricsModule],
  controllers: [ObservabilityDashboardController],
  providers: [ObservabilityDashboardService],
  exports: [ObservabilityDashboardService],
})
export class DashboardsModule {}
