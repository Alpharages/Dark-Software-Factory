import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AIDecisionLoggerModule } from '@/audit/ai-decision-logger.module';
import { DatabaseModule } from '@/database/database.module';
import { DispatcherModule } from '@/dispatcher/dispatcher.module';
import { GitHubModule } from '@/github/github.module';
import { RealtimeModule } from '@/realtime/realtime.module';
import { ApprovalGateController } from './approval-gate.controller';
import { ApprovalGateService } from './approval-gate.service';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RealtimeModule,
    AIDecisionLoggerModule,
    forwardRef(() => GitHubModule),
    forwardRef(() => DispatcherModule),
  ],
  controllers: [ApprovalGateController],
  providers: [ApprovalGateService],
  exports: [ApprovalGateService],
})
export class ApprovalGateModule {}
