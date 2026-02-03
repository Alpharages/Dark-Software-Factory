import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AIDecisionLoggerModule } from '../../audit/ai-decision-logger.module';
import { QualityGateConfigService } from './quality-gate-config.service';
import { QualityGateConfigController } from './quality-gate-config.controller';

@Module({
  imports: [DatabaseModule, AIDecisionLoggerModule],
  providers: [QualityGateConfigService],
  controllers: [QualityGateConfigController],
  exports: [QualityGateConfigService],
})
export class QualityGateConfigModule {}
