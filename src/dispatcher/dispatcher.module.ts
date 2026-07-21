import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@/database/database.module';
import { ApprovalGateModule } from '@/approval-gate/approval-gate.module';
import { DependenciesModule } from '@/dependencies/dependencies.module';
import { OpenHarnessModule } from '@/openharness/openharness.module';
import { SystemConfigModule } from '@/system-settings/system-config.module';
import { DependencyGateService } from './dependency-gate.service';
import { DependencyReleaseController } from './dependency-release.controller';
import { ExecutionRetryController } from './execution-retry.controller';
import { DispatcherService } from './dispatcher.service';
import { ExecutionConcurrencyGate } from './execution-concurrency.gate';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    DependenciesModule,
    OpenHarnessModule,
    SystemConfigModule,
    forwardRef(() => ApprovalGateModule),
  ],
  controllers: [DependencyReleaseController, ExecutionRetryController],
  providers: [DispatcherService, DependencyGateService, ExecutionConcurrencyGate],
  exports: [DispatcherService, ExecutionConcurrencyGate],
})
export class DispatcherModule {}
