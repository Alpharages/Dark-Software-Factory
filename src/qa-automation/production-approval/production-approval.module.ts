import { Module } from '@nestjs/common';
import { ProductionApprovalController } from './production-approval.controller';
import { ProductionApprovalService } from './production-approval.service';
import { DatabaseModule } from '../../database/database.module';
import { GitHubModule } from '../../github/github.module';
import { ClickUpModule } from '../../clickup/clickup.module';
import { AIDecisionLoggerModule } from '../../audit/ai-decision-logger.module';
import { LoggerModule } from '../../common/logger/logger.module';

@Module({
  imports: [DatabaseModule, GitHubModule, ClickUpModule, AIDecisionLoggerModule, LoggerModule],
  controllers: [ProductionApprovalController],
  providers: [ProductionApprovalService],
  exports: [ProductionApprovalService],
})
export class ProductionApprovalModule {}
