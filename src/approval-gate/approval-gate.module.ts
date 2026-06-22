import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AIDecisionLoggerModule } from '@/audit/ai-decision-logger.module';
import { DatabaseModule } from '@/database/database.module';
import { GitHubModule } from '@/github/github.module';
import { OpenHarnessModule } from '@/openharness/openharness.module';
import { RealtimeModule } from '@/realtime/realtime.module';
import { ApprovalGateController } from './approval-gate.controller';
import { ApprovalGateService } from './approval-gate.service';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RealtimeModule,
    OpenHarnessModule,
    AIDecisionLoggerModule,
    forwardRef(() => GitHubModule),
  ],
  controllers: [ApprovalGateController],
  providers: [ApprovalGateService],
  exports: [ApprovalGateService],
})
export class ApprovalGateModule {}
