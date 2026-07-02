import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { AICostTrackerService } from './ai-cost-tracker.service';
import { CostDashboardService } from './cost-dashboard.service';
import { CostDashboardController } from './cost-dashboard.controller';
import { DatabaseModule } from '../database/database.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { SentryModule } from '../common/sentry/sentry.module';
import { LoggerModule } from '../common/logger/logger.module';

@Module({
  imports: [
    DatabaseModule,
    LoggerModule,
    AppMetricsModule,
    SentryModule,
    CacheModule.register({
      ttl: 3600, // 1 hour in seconds
      max: 100, // Maximum number of items in cache
    }),
  ],
  controllers: [CostDashboardController],
  providers: [AICostTrackerService, CostDashboardService],
  exports: [AICostTrackerService, CostDashboardService],
})
export class CostTrackingModule {}
