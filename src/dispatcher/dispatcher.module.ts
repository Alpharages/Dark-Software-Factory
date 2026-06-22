import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '@/database/database.module';
import { OpenHarnessModule } from '@/openharness/openharness.module';
import { DispatcherService } from './dispatcher.service';

@Module({
  imports: [ConfigModule, DatabaseModule, OpenHarnessModule],
  providers: [DispatcherService],
  exports: [DispatcherService],
})
export class DispatcherModule {}
