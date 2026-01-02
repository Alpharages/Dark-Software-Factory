import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/database/prisma.service';
import { WorkloadService } from './workload.service';
import { MetricsService } from '@/common/metrics/metrics.service';

@Injectable()
export class WorkloadSchedulerService {
  private readonly logger = new Logger(WorkloadSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workloadService: WorkloadService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Daily cron job to take utilization snapshots for all PMs
   * Runs at midnight (00:00) every day
   * AC#6: Capacity trends over time displayed (requires daily snapshots)
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async takeUtilizationSnapshots(): Promise<void> {
    this.logger.log('Starting daily utilization snapshot job');
    const startTime = Date.now();

    try {
      // Get all PMs
      const pms = await this.prisma.user.findMany({
        where: { role: 'PM' },
        select: {
          id: true,
          name: true,
          max_tickets: true,
        },
      });

      this.logger.log(`Found ${pms.length} PMs for snapshot`);

      let successCount = 0;
      let errorCount = 0;

      // Create snapshot for each PM
      for (const pm of pms) {
        try {
          // Get current utilization
          const utilization = await this.workloadService.getPmUtilization(pm.id);

          // Create or update snapshot record (upsert to prevent duplicates)
          const snapshotDate = new Date();
          snapshotDate.setHours(0, 0, 0, 0); // Normalize to midnight for date comparison

          await this.prisma.utilizationHistory.upsert({
            where: {
              pm_id_snapshot_date: {
                pm_id: pm.id,
                snapshot_date: snapshotDate,
              },
            },
            create: {
              pm_id: pm.id,
              snapshot_date: snapshotDate,
              active_tickets: utilization.active_tickets,
              max_tickets: utilization.max_tickets,
              utilization_pct: utilization.utilization_pct,
            },
            update: {
              active_tickets: utilization.active_tickets,
              max_tickets: utilization.max_tickets,
              utilization_pct: utilization.utilization_pct,
            },
          });

          successCount++;
          this.logger.debug(
            `Snapshot created/updated for PM ${pm.name}: ${utilization.utilization_pct}% utilization`,
          );
        } catch (_error) {
          errorCount++;
          this.logger.error(
            `Failed to create snapshot for PM ${pm.id}`,
            _error instanceof Error ? _error.stack : String(_error),
          );
        }
      }

      const duration = (Date.now() - startTime) / 1000;
      this.logger.log(
        `Snapshot job completed: ${successCount} success, ${errorCount} errors in ${duration}s`,
      );

      // Record metrics
      this.metricsService.incrementCounter('workload_snapshot_job_total', {
        status: 'completed',
      });
      this.metricsService.recordHistogram('workload_snapshot_job_duration_seconds', duration);
      this.metricsService.setGauge('workload_snapshot_success_count', successCount);
      this.metricsService.setGauge('workload_snapshot_error_count', errorCount);
    } catch (_error) {
      this.logger.error(
        'Snapshot job failed',
        _error instanceof Error ? _error.stack : String(_error),
      );
      this.metricsService.incrementCounter('workload_snapshot_job_total', {
        status: 'failed',
      });
    }
  }

  /**
   * Check for burnout alerts every 15 minutes
   * AC#3: Alerts trigger when PM >80% utilization (notify PM, Manager, and leadership)
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkBurnoutAlerts(): Promise<void> {
    this.logger.log('Starting burnout alert check');

    try {
      // Get all PMs
      const pms = await this.prisma.user.findMany({
        where: { role: 'PM' },
        select: {
          id: true,
          name: true,
          email: true,
          managed_by_id: true,
        },
      });

      let alertsTriggered = 0;

      for (const pm of pms) {
        try {
          const isOverCapacity = await this.workloadService.checkBurnoutAlert(pm.id);

          if (isOverCapacity) {
            const utilization = await this.workloadService.getPmUtilization(pm.id);

            // Log the alert (actual notification service would be integrated here)
            this.logger.warn(
              `🚨 BURNOUT ALERT: PM ${pm.name} (${pm.email}) at ${utilization.utilization_pct}% utilization (${utilization.active_tickets}/${utilization.max_tickets} tickets)`,
            );

            // TODO: Integrate with notification service to send alerts to:
            // 1. PM themselves
            // 2. Their Manager (pm.managed_by_id)
            // 3. Leadership/Admin users
            // Example: await this.notificationService.sendBurnoutAlert(pm, utilization);

            alertsTriggered++;

            // Record metric for this specific PM
            this.metricsService.setGauge('pm_burnout_risk_total', 1, {
              pm_id: pm.id,
              pm_name: pm.name,
            });
          } else {
            // No burnout risk - set metric to 0
            this.metricsService.setGauge('pm_burnout_risk_total', 0, {
              pm_id: pm.id,
              pm_name: pm.name,
            });
          }
        } catch (_error) {
          this.logger.error(
            `Failed to check burnout alert for PM ${pm.id}`,
            _error instanceof Error ? _error.stack : String(_error),
          );
        }
      }

      if (alertsTriggered > 0) {
        this.logger.warn(`Triggered ${alertsTriggered} burnout alerts`);
      } else {
        this.logger.log('No burnout alerts triggered - all PMs within capacity');
      }

      // Record job completion metric
      this.metricsService.incrementCounter('workload_burnout_check_total', {
        status: 'completed',
      });
      this.metricsService.setGauge('workload_burnout_alerts_triggered', alertsTriggered);
    } catch (_error) {
      this.logger.error(
        'Burnout alert check failed',
        _error instanceof Error ? _error.stack : String(_error),
      );
      this.metricsService.incrementCounter('workload_burnout_check_total', {
        status: 'failed',
      });
    }
  }
}
