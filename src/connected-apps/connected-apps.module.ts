import { Module } from '@nestjs/common';
import { ConnectedAppsService } from './connected-apps.service';
import { ConnectedAppsController } from './connected-apps.controller';
import { DatabaseModule } from '@/database/database.module';
import { EncryptionModule } from '@/common/encryption/encryption.module';
import { IntegrationsModule } from '@/integrations/integrations.module';

@Module({
  imports: [DatabaseModule, EncryptionModule, IntegrationsModule],
  providers: [ConnectedAppsService],
  controllers: [ConnectedAppsController],
  exports: [ConnectedAppsService],
})
export class ConnectedAppsModule {}
