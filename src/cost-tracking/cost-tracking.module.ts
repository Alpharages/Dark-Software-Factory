import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { AICostTrackerService } from './ai-cost-tracker.service';
import { CostOptimizerService } from './cost-optimizer.service';
import { DatabaseModule } from '../database/database.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { SentryModule } from '../common/sentry/sentry.module';

@Module({
  imports: [
    DatabaseModule,
    AppMetricsModule,
    SentryModule,
    CacheModule.register({
      ttl: 3600, // 1 hour in seconds (service multiplies by 1000 for ms)
      max: 100, // Maximum number of items in cache
    }),
  ],
  providers: [AICostTrackerService, CostOptimizerService],
  exports: [AICostTrackerService, CostOptimizerService],
})
export class CostTrackingModule {}
