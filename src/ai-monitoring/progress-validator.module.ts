import { Module } from '@nestjs/common';
import { ProgressValidatorService } from './progress-validator.service';
import { DatabaseModule } from '@/database/database.module';
import { SentryModule } from '@/common/sentry/sentry.module';
import { AppMetricsModule } from '@/common/metrics/metrics.module';
import { AIDecisionLoggerModule } from '@/audit/ai-decision-logger.module';

@Module({
  imports: [
    DatabaseModule,
    SentryModule,
    AppMetricsModule,
    AIDecisionLoggerModule, // Import Story 11.2 service
  ],
  providers: [ProgressValidatorService],
  exports: [ProgressValidatorService], // Export for Story 13.3/13.4 integration
})
export class ProgressValidatorModule {}
