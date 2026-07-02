import { Module } from '@nestjs/common';
import { OpenHarnessRunnerService } from './openharness-runner.service';
import { DatabaseModule } from '@/database/database.module';
import { ExecutionModule } from '@/execution/execution.module';
import { RealtimeModule } from '@/realtime/realtime.module';
import { OpenHarnessStreamAdapter } from './stream/openharness-stream.adapter';
import { OpenHarnessExecutionController } from './openharness-execution.controller';
import { StatusSkillMapService } from './status-skill-map.service';
import { SkillModelMapService } from './skill-model-map.service';
import { OpenHarnessRunGuardrailsService } from './run-guardrails.service';
import { ProjectWorkspaceService } from './project-workspace.service';
import { AiAccountsModule } from '@/ai-accounts/ai-accounts.module';
import { CostTrackingModule } from '@/cost-tracking/cost-tracking.module';

@Module({
  imports: [DatabaseModule, ExecutionModule, RealtimeModule, AiAccountsModule, CostTrackingModule],
  controllers: [OpenHarnessExecutionController],
  providers: [
    OpenHarnessRunnerService,
    OpenHarnessRunGuardrailsService,
    OpenHarnessStreamAdapter,
    StatusSkillMapService,
    SkillModelMapService,
    ProjectWorkspaceService,
  ],
  exports: [
    OpenHarnessRunnerService,
    OpenHarnessRunGuardrailsService,
    OpenHarnessStreamAdapter,
    StatusSkillMapService,
    SkillModelMapService,
    ProjectWorkspaceService,
  ],
})
export class OpenHarnessModule {}
