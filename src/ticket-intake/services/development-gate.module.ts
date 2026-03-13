import { Module } from '@nestjs/common';
import { DevelopmentGateService } from './development-gate.service';
import { AppMetricsModule } from '@/common/metrics';
import { LoggerModule } from '@/common/logger';

@Module({
  imports: [AppMetricsModule, LoggerModule],
  providers: [DevelopmentGateService],
  exports: [DevelopmentGateService],
})
export class DevelopmentGateModule {}
