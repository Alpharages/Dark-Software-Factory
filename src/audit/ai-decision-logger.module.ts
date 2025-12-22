import { Module } from '@nestjs/common';
import { AIDecisionLoggerService } from './ai-decision-logger.service';
import { AuditController } from './audit.controller';
import { DatabaseModule } from '@/database/database.module';
import { AppMetricsModule } from '@/common/metrics/metrics.module';
import { LoggerModule } from '@/common/logger/logger.module';
import { SentryModule } from '@/common/sentry/sentry.module';

@Module({
  imports: [DatabaseModule, AppMetricsModule, LoggerModule, SentryModule],
  providers: [AIDecisionLoggerService],
  controllers: [AuditController],
  exports: [AIDecisionLoggerService],
})
export class AIDecisionLoggerModule {}
