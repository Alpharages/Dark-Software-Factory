import { Module } from '@nestjs/common';
import { DatabaseModule } from '@/database/database.module';
import { AIDecisionLoggerModule } from '@/audit/ai-decision-logger.module';
import { AppMetricsModule } from '@/common/metrics/metrics.module';
import { FileLockManagerService } from './file-lock-manager.service';
import { FilePredictionProvider } from './file-prediction.provider';
import { FileLocksController } from './file-locks.controller';

@Module({
  imports: [DatabaseModule, AIDecisionLoggerModule, AppMetricsModule],
  controllers: [FileLocksController],
  providers: [FileLockManagerService, FilePredictionProvider],
  exports: [FileLockManagerService],
})
export class FileLocksModule {}


