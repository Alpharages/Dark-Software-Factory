import { Module } from '@nestjs/common';
import { StartupChecksService } from './startup-checks.service';
import { DatabaseModule } from '@/database/database.module';
import { LoggerModule } from '@/common/logger/logger.module';

@Module({
  imports: [DatabaseModule, LoggerModule],
  providers: [StartupChecksService],
})
export class StartupChecksModule {}
