import { Module } from '@nestjs/common';
import { DevelopmentGateService } from './development-gate.service';
import { AppMetricsModule } from '@/common/metrics';
import { LoggerModule } from '@/common/logger';
import { OpenHarnessModule } from '@/openharness/openharness.module';

@Module({
  imports: [AppMetricsModule, LoggerModule, OpenHarnessModule],
  providers: [DevelopmentGateService],
  exports: [DevelopmentGateService],
})
export class DevelopmentGateModule {}
