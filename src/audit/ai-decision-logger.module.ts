import { Module } from '@nestjs/common';
import { AIDecisionLoggerService } from './ai-decision-logger.service';
import { DatabaseModule } from '../database/database.module';
import { SentryModule } from '../common/sentry/sentry.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';

@Module({
  imports: [DatabaseModule, SentryModule, AppMetricsModule],
  providers: [AIDecisionLoggerService],
  exports: [AIDecisionLoggerService], // Export for Story 11.4 integration
})
export class AIDecisionLoggerModule {}
