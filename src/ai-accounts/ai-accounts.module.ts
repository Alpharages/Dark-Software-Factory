import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { AiAccountsService } from './ai-accounts.service';
import { AiAccountsController } from './ai-accounts.controller';
import { AI_ACCOUNT_CLOCK, AiAccountSelectorService } from './account-selector.service';

// EncryptionModule is @Global — EncryptionService is injectable here with no explicit import.
@Module({
  imports: [DatabaseModule],
  controllers: [AiAccountsController],
  providers: [
    AiAccountsService,
    AiAccountSelectorService,
    { provide: AI_ACCOUNT_CLOCK, useValue: { now: () => new Date() } },
  ],
  exports: [AiAccountsService, AiAccountSelectorService], // selector for A6
})
export class AiAccountsModule {}
