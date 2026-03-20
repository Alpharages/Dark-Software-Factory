import { Module, forwardRef } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { ClickUpModule } from '@/clickup/clickup.module';
import { ProjectIntegrationService } from './project-integration.service';
import { ClickUpOAuthService } from './clickup-oauth.service';
import { ClickUpOAuthController } from './clickup-oauth.controller';
import { DatabaseModule } from '@/database/database.module';
import { EncryptionModule } from '@/common/encryption/encryption.module';
import { SentryModule } from '@/common/sentry';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { PMStatusService } from './pm-status.service';
import { BotAssignmentService } from './bot-assignment.service';
import { PMFieldPreCheckService } from './pm-field-pre-check.service';
import { PMFieldAutoFillService } from './pm-field-auto-fill.service';
import { PMVerificationCommentService } from './pm-verification-comment.service';
import { PMActionableFailureCommentService } from './pm-actionable-failure-comment.service';
import { PMExecutionStatusService } from './pm-execution-status.service';
import { AgentSkillsModule } from '@/ai-routing/agent-skills/agent-skills.module';

@Module({
  imports: [
    forwardRef(() => ClickUpModule),
    DatabaseModule,
    EncryptionModule,
    SentryModule,
    AgentSkillsModule,
  ],
  controllers: [IntegrationsController, ClickUpOAuthController],
  providers: [
    ProjectIntegrationService,
    ClickUpOAuthService,
    PMProviderFactory,
    PMStatusService,
    BotAssignmentService,
    PMFieldPreCheckService,
    PMFieldAutoFillService,
    PMVerificationCommentService,
    PMActionableFailureCommentService,
    PMExecutionStatusService,
  ],
  exports: [
    ProjectIntegrationService,
    ClickUpOAuthService,
    PMProviderFactory,
    PMStatusService,
    BotAssignmentService,
    PMFieldPreCheckService,
    PMFieldAutoFillService,
    PMVerificationCommentService,
    PMActionableFailureCommentService,
    PMExecutionStatusService,
  ],
})
export class IntegrationsModule {}
