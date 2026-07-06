import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@/database/database.module';
import { ApprovalGateModule } from '@/approval-gate/approval-gate.module';
import { DependenciesModule } from '@/dependencies/dependencies.module';
import { OpenHarnessModule } from '@/openharness/openharness.module';
import { DependencyGateService } from './dependency-gate.service';
import { DependencyReleaseController } from './dependency-release.controller';
import { DispatcherService } from './dispatcher.service';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    DependenciesModule,
    OpenHarnessModule,
    forwardRef(() => ApprovalGateModule),
  ],
  controllers: [DependencyReleaseController],
  providers: [DispatcherService, DependencyGateService],
  exports: [DispatcherService],
})
export class DispatcherModule {}
