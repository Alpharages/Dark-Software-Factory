import { Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { DatabaseModule } from '../../database/database.module';
import { LoggerModule } from '../logger';

@Module({
  imports: [DatabaseModule, LoggerModule],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
