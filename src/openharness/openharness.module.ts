import { Module } from '@nestjs/common';
import { OpenHarnessRunnerService } from './openharness-runner.service';
import { DatabaseModule } from '@/database/database.module';
import { ExecutionModule } from '@/execution/execution.module';
import { RealtimeModule } from '@/realtime/realtime.module';
import { OpenHarnessStreamAdapter } from './stream/openharness-stream.adapter';
import { OpenHarnessExecutionController } from './openharness-execution.controller';

@Module({
  imports: [DatabaseModule, ExecutionModule, RealtimeModule],
  controllers: [OpenHarnessExecutionController],
  providers: [OpenHarnessRunnerService, OpenHarnessStreamAdapter],
  exports: [OpenHarnessRunnerService, OpenHarnessStreamAdapter],
})
export class OpenHarnessModule {}
