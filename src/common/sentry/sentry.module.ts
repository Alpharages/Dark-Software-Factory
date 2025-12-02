import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SentryService } from './sentry.service';
import { LoggerModule } from '../logger/logger.module';
import { AppMetricsModule } from '../metrics/metrics.module';

@Global()
@Module({
  imports: [ConfigModule, LoggerModule, AppMetricsModule],
  providers: [SentryService],
  exports: [SentryService],
})
export class SentryModule {}
