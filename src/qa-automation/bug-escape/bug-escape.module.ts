import { Module, forwardRef } from '@nestjs/common';
import { BugEscapeService } from './bug-escape.service';
import { BugEscapeController } from './bug-escape.controller';
import { BugEscapeAnalyzer } from './bug-escape-analyzer.service';
import { BugEscapeConsumer } from './bug-escape.consumer';
import { AIDecisionLoggerModule } from '@/audit/ai-decision-logger.module';
import { DatabaseModule } from '@/database/database.module';
import { RabbitMQModule } from '@/rabbitmq/rabbitmq.module';
import { AppMetricsModule } from '@/common/metrics';
import { LoggerModule } from '@/common/logger';
import { CacheModule } from '@nestjs/cache-manager';
import { QaAutomationModule } from '../qa-automation.module';

@Module({
  imports: [
    DatabaseModule,
    AppMetricsModule,
    LoggerModule,
    AIDecisionLoggerModule,
    RabbitMQModule,
    CacheModule.register(),
    forwardRef(() => QaAutomationModule),
  ],
  controllers: [BugEscapeController],
  providers: [BugEscapeService, BugEscapeAnalyzer, BugEscapeConsumer],
  exports: [BugEscapeService], // Export service for direct usage if needed
})
export class BugEscapeModule {}
