import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { AiAccountsService } from './ai-accounts.service';
import { AiAccountsController } from './ai-accounts.controller';

// EncryptionModule is @Global — EncryptionService is injectable here with no explicit import.
@Module({
  imports: [DatabaseModule],
  controllers: [AiAccountsController],
  providers: [AiAccountsService],
  exports: [AiAccountsService], // getDecryptedCredentials seam for A5/A6
})
export class AiAccountsModule {}
