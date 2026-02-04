import { Module } from '@nestjs/common';
import { BugEscapeService } from './bug-escape.service';
import { BugEscapeController } from './bug-escape.controller';
import { BugEscapeAnalyzer } from './bug-escape-analyzer.service';
import { BugEscapeConsumer } from './bug-escape.consumer';
import { AIDecisionLoggerModule } from '../../audit/ai-decision-logger.module';
import { DatabaseModule } from '../../database/database.module';
import { RabbitMQModule } from '../../rabbitmq/rabbitmq.module';
import { AppMetricsModule } from '../../common/metrics/metrics.module';
import { LoggerModule } from '../../common/logger/logger.module';
import { CacheModule } from '@nestjs/cache-manager';

@Module({
  imports: [
    DatabaseModule,
    AppMetricsModule,
    LoggerModule,
    AIDecisionLoggerModule,
    RabbitMQModule,
    CacheModule.register(),
  ],
  controllers: [BugEscapeController],
  providers: [BugEscapeService, BugEscapeAnalyzer, BugEscapeConsumer],
  exports: [BugEscapeService], // Export service for direct usage if needed
})
export class BugEscapeModule {}
