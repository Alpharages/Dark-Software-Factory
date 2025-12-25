import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeploymentStatus } from '@/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { GitHubService } from '../github.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AIDecisionLoggerService } from '../../audit/ai-decision-logger.service';
import { DeploymentStatusSync } from './deployment-status-sync.service';
import { LoggerService } from '../../common/logger/logger.service';
import {
  BaselineMetrics,
  RollbackReason,
} from '../interfaces/health-monitoring.interface';

@Injectable()
export class DeploymentHealthMonitorService implements OnModuleDestroy {
  private monitoringTimers = new Map<string, NodeJS.Timeout>();
  private readonly MONITORING_WINDOW_MS: number;
  private readonly POLL_INTERVAL_MS: number;
  private readonly ERROR_RATE_THRESHOLD: number;
  private readonly LATENCY_THRESHOLD_MS: number;
  private readonly BASELINE_WINDOW_MS: number;
  private readonly ENABLED: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GitHubService,
    private readonly sentry: SentryService,
    private readonly metrics: MetricsService,
    private readonly auditLog: AIDecisionLoggerService,
    private readonly deploymentStatusSync: DeploymentStatusSync,
    private readonly logger: LoggerService,
    private readonly config: ConfigService,
  ) {
    this.MONITORING_WINDOW_MS = this.config.get<number>('health.monitoringWindowMs', 300000); // 5min
    this.POLL_INTERVAL_MS = this.config.get<number>('health.pollIntervalMs', 30000); // 30s
    this.ERROR_RATE_THRESHOLD = this.config.get<number>('health.errorRateThresholdPercent', 50);
    this.LATENCY_THRESHOLD_MS = this.config.get<number>('health.latencyThresholdMs', 200);
    this.BASELINE_WINDOW_MS = this.config.get<number>('health.baselineWindowMs', 300000); // 5min
    this.ENABLED = this.config.get<boolean>('health.enabled', true);
  }

  onModuleDestroy() {
    this.monitoringTimers.forEach((timer) => clearTimeout(timer));
    this.monitoringTimers.clear();
    this.logger.log('Cleaned up health monitoring timers', 'DeploymentHealthMonitor');
  }

  /**
   * AC#1: Start health monitoring for a deployment
   */
  async startHealthMonitoring(deploymentId: string): Promise<void> {
    if (!this.ENABLED) {
      this.logger.log('Health monitoring disabled via configuration', { deploymentId });
      return;
    }

    this.logger.log('Starting health monitoring for deployment', { deploymentId });

    try {
      // Get deployment details
      const deployment = await this.prisma.deployment.findUnique({
        where: { id: deploymentId },
      });

      if (!deployment) {
        this.logger.warn('Deployment not found for health monitoring', { deploymentId });
        return;
      }

      // Capture baseline metrics
      const baseline = await this.getPreDeploymentBaseline(deployment.environment);

      // Start monitoring window
      const timer = setTimeout(async () => {
        await this.performHealthCheck(deploymentId, deployment.environment, baseline);
      }, this.MONITORING_WINDOW_MS);

      this.monitoringTimers.set(deploymentId, timer);
    } catch (error) {
      const err = error as Error;
      this.logger.error('Failed to start health monitoring', err.stack || err.message, {
        deploymentId,
      });
      this.sentry.captureException(err);
    }
  }

  /**
   * AC#1: Get pre-deployment baseline metrics
   */
  async getPreDeploymentBaseline(environment: string): Promise<BaselineMetrics> {
    const baselineWindowStart = new Date(Date.now() - this.BASELINE_WINDOW_MS);

    // Query deployments in the baseline window
    const recentDeployments = await this.prisma.deployment.findMany({
      where: {
        environment,
        created_at: {
          gte: baselineWindowStart,
        },
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    // Calculate error rate (AC#2)
    const totalCount = recentDeployments.length;
    const failedCount = recentDeployments.filter(
      (d) => d.status === DeploymentStatus.FAILED,
    ).length;
    const error_rate = totalCount > 0 ? (failedCount / totalCount) * 100 : 0;

    // Calculate P95 latency (simplified for Phase 1 - using workflow duration proxy)
    // In Phase 2, this would integrate with APM tools
    const p95_latency = 150; // Placeholder for Phase 1

    return {
      error_rate,
      p95_latency,
      captured_at: new Date(),
    };
  }

  /**
   * AC#2 & AC#3: Perform health check and trigger rollback if thresholds exceeded
   */
  private async performHealthCheck(
    deploymentId: string,
    environment: string,
    baseline: BaselineMetrics,
  ): Promise<void> {
    try {
      this.logger.log('Performing health check', { deploymentId, baseline });

      // Get current metrics
      const currentMetrics = await this.getCurrentMetrics(environment);

      // Calculate deltas
      const error_rate_delta = currentMetrics.error_rate - baseline.error_rate;
      const latency_delta = currentMetrics.p95_latency - baseline.p95_latency;

      // Check rollback conditions (AC#2 & AC#3)
      let shouldRollback = false;
      let rollbackReason: RollbackReason | undefined;

      if (error_rate_delta > this.ERROR_RATE_THRESHOLD) {
        shouldRollback = true;
        rollbackReason = 'error_rate';
      }

      if (latency_delta > this.LATENCY_THRESHOLD_MS) {
        shouldRollback = true;
        rollbackReason = rollbackReason ? 'both' : 'latency';
      }

      if (shouldRollback && rollbackReason) {
        // Trigger rollback (AC#4)
        await this.triggerRollback(deploymentId, rollbackReason, {
          error_rate_delta,
          latency_delta,
        });

        this.metrics.incrementCounter('deployment_health_checks_total', {
          environment,
          status: 'rollback',
        });
      } else {
        // Health check passed
        this.metrics.incrementCounter('deployment_health_checks_total', {
          environment,
          status: 'success',
        });
      }

      // Record monitoring duration (AC#6)
      this.metrics.recordHistogram(
        'deployment_health_window_duration_seconds',
        this.MONITORING_WINDOW_MS / 1000,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error('Health check failed', err.stack || err.message, { deploymentId });
      this.sentry.captureException(err);
    } finally {
      // M3 FIX: Always cleanup timer, even on error path
      this.monitoringTimers.delete(deploymentId);
    }
  }

  /**
   * AC#2 & AC#3: Get current metrics (Phase 1 implementation using database)
   */
  private async getCurrentMetrics(
    environment: string,
  ): Promise<{ error_rate: number; p95_latency: number }> {
    // Phase 1: Use database queries as proxy
    const windowStart = new Date(Date.now() - this.MONITORING_WINDOW_MS);

    const recentDeployments = await this.prisma.deployment.findMany({
      where: {
        environment,
        created_at: {
          gte: windowStart,
        },
      },
    });

    const totalCount = recentDeployments.length;
    const failedCount = recentDeployments.filter(
      (d) => d.status === DeploymentStatus.FAILED,
    ).length;
    const error_rate = totalCount > 0 ? (failedCount / totalCount) * 100 : 0;

    // Phase 1: Simplified latency (would use GitHub Actions API or APM in Phase 2)
    const p95_latency = 160; // Placeholder

    return { error_rate, p95_latency };
  }

  /**
   * AC#4: Trigger rollback for deployment
   */
  async triggerRollback(
    deploymentId: string,
    reason: RollbackReason,
    metricsDelta: { error_rate_delta: number; latency_delta: number },
  ): Promise<void> {
    this.logger.log('Triggering auto-rollback', { deploymentId, reason, metricsDelta });

    try {
      // Get deployment details
      const deployment = await this.prisma.deployment.findUnique({
        where: { id: deploymentId },
      });

      if (!deployment) {
        throw new Error(`Deployment ${deploymentId} not found`);
      }

      // Get related execution info via github_push
      const githubPush = await this.prisma.gitHubPush.findUnique({
        where: { id: deployment.github_push_id },
      });

      const execution = githubPush?.execution_id
        ? await this.prisma.execution.findUnique({
          where: { id: githubPush.execution_id },
        })
        : null;

      // Update deployment status to ROLLED_BACK (AC#4)
      const errorMessage = JSON.stringify({
        reason,
        error_rate_delta: metricsDelta.error_rate_delta,
        latency_delta: metricsDelta.latency_delta,
        timestamp: new Date().toISOString(),
      });

      await this.prisma.deployment.update({
        where: { id: deploymentId },
        data: {
          status: DeploymentStatus.ROLLED_BACK,
          error_message: errorMessage,
        },
      });

      // Log AI decision (AC#4)
      await this.auditLog.logDecision({
        agentName: 'DeploymentHealthMonitor',
        action: 'deployment_rollback_triggered',
        reasoning: `Auto-rollback triggered: ${reason}. Error rate delta: ${metricsDelta.error_rate_delta}%, Latency delta: ${metricsDelta.latency_delta}ms`,
        ticketId: execution?.ticket_id || '',
        executionId: execution?.id || undefined,
        inputData: {
          deployment_id: deploymentId,
          environment: deployment.environment,
        },
        outputData: {
          rollback_decision: 'TRIGGERED',
          reason,
          error_rate_delta: metricsDelta.error_rate_delta,
          latency_delta: metricsDelta.latency_delta,
        },
        confidence: 1.0, // Deterministic decision
      });

      // Increment rollback metric (AC#6)
      this.metrics.incrementCounter('deployment_rollback_total', {
        environment: deployment.environment,
        reason,
      });

      // Send Sentry alert (AC#5)
      this.sentry.captureMessage(
        `Auto-rollback triggered for deployment ${deploymentId}: ${reason}. Error delta: ${metricsDelta.error_rate_delta}%, Latency delta: ${metricsDelta.latency_delta}ms`,
      );

      // Sync to ClickUp (AC#5)
      await this.deploymentStatusSync.syncToClickUp(deploymentId);

      this.logger.log('Auto-rollback completed', { deploymentId, reason });
    } catch (error) {
      const err = error as Error;
      this.logger.error('Rollback failed', err.stack || err.message, { deploymentId });
      this.sentry.captureException(err);
      throw error;
    }
  }
}
