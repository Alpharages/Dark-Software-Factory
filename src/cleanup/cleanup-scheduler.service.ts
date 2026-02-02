import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Gauge } from 'prom-client';
import { PrismaService } from '@/database/prisma.service';
import { ExecutionStatus } from '@/prisma/client';
import { CleanupService } from './cleanup.service';

/**
 * Cleanup Scheduler Service
 * Story 23.2: Automated Container Cleanup
 *
 * Background job for cleaning up orphaned resources.
 * Runs every 5 minutes to find and clean executions that weren't properly cleaned.
 */
@Injectable()
export class CleanupSchedulerService {
  private readonly logger = new Logger(CleanupSchedulerService.name);

  constructor(
    private readonly cleanupService: CleanupService,
    private readonly prisma: PrismaService,
    @InjectMetric('cleanup_orphaned_resources')
    private readonly orphanedGauge: Gauge<string>,
  ) {}

  /**
   * Scheduled cleanup job - runs every 5 minutes
   * Finds executions with container_id still set but in terminal state
   */
  @Cron('0 */5 * * * *')
  async cleanupOrphanedResources(): Promise<void> {
    this.logger.debug('Running orphaned resource cleanup job');

    try {
      // Find executions with container_id set but execution is terminal
      const orphaned = await this.prisma.execution.findMany({
        where: {
          AND: [
            { container_id: { not: null } },
            { container_id: { not: '' } },
            {
              status: {
                in: [
                  ExecutionStatus.COMPLETED,
                  ExecutionStatus.FAILED,
                  ExecutionStatus.TIMEOUT,
                  ExecutionStatus.CANCELLED,
                ],
              },
            },
          ],
        },
        take: 10, // Process in batches
      });

      // Update orphaned resources gauge
      this.orphanedGauge.set(orphaned.length);

      if (orphaned.length === 0) {
        this.logger.debug('No orphaned resources found');
        return;
      }

      this.logger.log(`Found ${orphaned.length} orphaned executions to cleanup`);

      for (const execution of orphaned) {
        try {
          await this.cleanupService.cleanupAfterExecution(execution.id, {
            forceContainerRemove: execution.status === ExecutionStatus.TIMEOUT,
          });
          this.logger.log(`[${execution.id}] Orphaned resources cleaned successfully`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `[${execution.id}] Failed to clean orphaned resources: ${errorMessage}`,
          );
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Cleanup job failed: ${errorMessage}`);
    }
  }
}
