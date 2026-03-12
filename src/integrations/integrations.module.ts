import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { ClickUpModule } from '../clickup/clickup.module';
import { ProjectIntegrationService } from './project-integration.service';
import { ClickUpOAuthService } from './clickup-oauth.service';
import { ClickUpOAuthController } from './clickup-oauth.controller';
import { DatabaseModule } from '../database/database.module';
import { EncryptionModule } from '../common/encryption/encryption.module';
import { PMProviderFactory } from './providers/pm-provider.factory';

@Module({
  imports: [ClickUpModule, DatabaseModule, EncryptionModule],
  controllers: [IntegrationsController, ClickUpOAuthController],
  providers: [ProjectIntegrationService, ClickUpOAuthService, PMProviderFactory],
  exports: [ProjectIntegrationService, ClickUpOAuthService, PMProviderFactory],
})
export class IntegrationsModule {}
