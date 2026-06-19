import { Module } from '@nestjs/common';
import { OpenHarnessRunnerService } from './openharness-runner.service';
import { DatabaseModule } from '@/database/database.module';
import { ExecutionModule } from '@/execution/execution.module';

@Module({
  imports: [DatabaseModule, ExecutionModule],
  providers: [OpenHarnessRunnerService],
  exports: [OpenHarnessRunnerService],
})
export class OpenHarnessModule {}
