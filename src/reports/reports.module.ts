import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportsAggregatorService } from './reports-aggregator.service';
import { ReportsExporterService } from './reports-exporter.service';
import { DatabaseModule } from '../database/database.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { AuditLogModule } from '../common/audit/audit-log.module';
import { AIDecisionLoggerModule } from '../audit/ai-decision-logger.module';

@Module({
  imports: [DatabaseModule, AppMetricsModule, AuditLogModule, AIDecisionLoggerModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsAggregatorService, ReportsExporterService],
  exports: [ReportsService],
})
export class ReportsModule {}
