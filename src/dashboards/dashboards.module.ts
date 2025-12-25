import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ObservabilityDashboardController } from './observability-dashboard.controller';
import { ObservabilityDashboardService } from './services/observability-dashboard.service';
import { PmDashboardController } from './pm-dashboard.controller';
import { PmDashboardService } from './services/pm-dashboard.service';
import { DashboardGateway } from './gateways/dashboard.gateway';
import { DatabaseModule } from '@/database/database.module';
import { RabbitMQModule } from '@/rabbitmq/rabbitmq.module';
import { AppMetricsModule } from '@/common/metrics';

@Module({
  imports: [
    DatabaseModule,
    RabbitMQModule,
    AppMetricsModule,
    CacheModule.register({
      ttl: 300, // 5 minutes
      max: 100, // Maximum items in cache
    }),
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [ObservabilityDashboardController, PmDashboardController],
  providers: [ObservabilityDashboardService, PmDashboardService, DashboardGateway],
  exports: [ObservabilityDashboardService, PmDashboardService, DashboardGateway],
})
export class DashboardsModule {}
