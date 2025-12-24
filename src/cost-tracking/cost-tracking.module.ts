import { Module } from '@nestjs/common';
import { AICostTrackerService } from './ai-cost-tracker.service';
import { DatabaseModule } from '../database/database.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { SentryModule } from '../common/sentry/sentry.module';

@Module({
  imports: [DatabaseModule, AppMetricsModule, SentryModule],
  providers: [AICostTrackerService],
  exports: [AICostTrackerService],
})
export class CostTrackingModule {}
