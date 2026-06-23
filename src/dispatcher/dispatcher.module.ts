import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@/database/database.module';
import { ApprovalGateModule } from '@/approval-gate/approval-gate.module';
import { OpenHarnessModule } from '@/openharness/openharness.module';
import { DispatcherService } from './dispatcher.service';

@Module({
  imports: [ConfigModule, DatabaseModule, OpenHarnessModule, forwardRef(() => ApprovalGateModule)],
  providers: [DispatcherService],
  exports: [DispatcherService],
})
export class DispatcherModule {}
