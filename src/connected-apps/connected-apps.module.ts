import { Module } from '@nestjs/common';
import { ConnectedAppsService } from './connected-apps.service';
import { DatabaseModule } from '@/database/database.module';
import { EncryptionModule } from '@/common/encryption/encryption.module';

@Module({
  imports: [DatabaseModule, EncryptionModule],
  providers: [ConnectedAppsService],
  exports: [ConnectedAppsService],
})
export class ConnectedAppsModule {}
