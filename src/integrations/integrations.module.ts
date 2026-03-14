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

@Module({
  imports: [forwardRef(() => ClickUpModule), DatabaseModule, EncryptionModule, SentryModule],
  controllers: [IntegrationsController, ClickUpOAuthController],
  providers: [
    ProjectIntegrationService,
    ClickUpOAuthService,
    PMProviderFactory,
    PMStatusService,
    BotAssignmentService,
    PMFieldPreCheckService,
  ],
  exports: [
    ProjectIntegrationService,
    ClickUpOAuthService,
    PMProviderFactory,
    PMStatusService,
    BotAssignmentService,
    PMFieldPreCheckService,
  ],
})
export class IntegrationsModule {}
