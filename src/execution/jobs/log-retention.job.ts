import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import { ExecutionLogRepository } from '../repositories/execution-log.repository';

@Injectable()
export class LogRetentionJob {
  private readonly logger = new Logger(LogRetentionJob.name);
  private readonly RETENTION_DAYS = 90;

  constructor(
    private readonly logRepository: ExecutionLogRepository,
    @InjectMetric('execution_logs_retention_deleted_total')
    private readonly logsDeletedCounter: Counter<string>,
  ) {}

  /**
   * Run daily at 2 AM
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanOldLogs() {
    this.logger.log(`Starting log retention cleanup (retention: ${this.RETENTION_DAYS} days)`);

    try {
      const deletedCount = await this.logRepository.deleteOlderThan(this.RETENTION_DAYS);

      this.logger.log(`Log retention cleanup completed. Deleted ${deletedCount} logs.`);
      this.logsDeletedCounter.inc(deletedCount);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      this.logger.error(`Log retention cleanup failed: ${error.message}`, error.stack);
    }
  }
}
