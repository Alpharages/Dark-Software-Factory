import { Injectable } from '@nestjs/common';
import { MetricsService } from '../common/metrics/metrics.service';
import { LoggerService } from '../common/logger/logger.service';

/**
 * QA Metrics Service - Convenience wrapper for QA automation module
 * Story 3.8: QA Metrics & Prometheus Integration
 *
 * Wraps MetricsService with QA-specific convenience methods.
 * All metrics flow through existing BusinessCollector.
 */
@Injectable()
export class QaMetricsService {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Record completion of a QA check
   * @param checkType - linting, testing, security, or coverage
   * @param passed - whether check passed
   * @param durationMs - duration in milliseconds
   * @param context - projectId, aiProvider, executionId
   */
  recordCheckComplete(
    checkType: 'linting' | 'testing' | 'security' | 'coverage',
    passed: boolean,
    durationMs: number,
    context: { projectId?: string; aiProvider?: string; executionId?: string } = {},
  ): void {
    try {
      // Validate non-empty strings to prevent invalid Prometheus labels
      const projectId =
        context.projectId && context.projectId.trim() ? context.projectId : undefined;
      const aiProvider =
        context.aiProvider && context.aiProvider.trim() ? context.aiProvider : undefined;

      this.metricsService.recordQACheck({
        checkType,
        status: passed ? 'passed' : 'failed',
        duration: durationMs / 1000, // Convert ms to seconds
        projectId,
        aiProvider,
      });

      this.logger.debug(
        `QA metric: ${checkType} ${passed ? 'passed' : 'failed'} in ${(durationMs / 1000).toFixed(2)}s`,
        'QaMetricsService',
      );
    } catch (error) {
      this.logger.error(
        `Failed to record QA check metric: ${(error as Error).message}`,
        (error as Error).stack,
        'QaMetricsService',
      );
    }
  }

  /**
   * Record check timeout or error
   */
  recordCheckError(
    checkType: 'linting' | 'testing' | 'security' | 'coverage',
    errorType: 'timeout' | 'error',
    durationMs: number,
    context: { projectId?: string; aiProvider?: string } = {},
  ): void {
    try {
      const projectId =
        context.projectId && context.projectId.trim() ? context.projectId : undefined;
      const aiProvider =
        context.aiProvider && context.aiProvider.trim() ? context.aiProvider : undefined;

      this.metricsService.recordQACheck({
        checkType,
        status: errorType,
        duration: durationMs / 1000,
        projectId,
        aiProvider,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record QA error metric: ${(error as Error).message}`,
        (error as Error).stack,
        'QaMetricsService',
      );
    }
  }

  /**
   * Set test coverage for a project
   */
  setCoverage(projectId: string, coveragePercent: number): void {
    try {
      const validProjectId = projectId && projectId.trim() ? projectId : 'unknown';

      this.metricsService.recordQACheck({
        checkType: 'coverage',
        status: 'passed',
        duration: 0,
        projectId: validProjectId,
        coverage: coveragePercent,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record coverage metric: ${(error as Error).message}`,
        (error as Error).stack,
        'QaMetricsService',
      );
    }
  }

  /**
   * Record security vulnerabilities
   */
  recordVulnerabilities(
    severity: 'critical' | 'high' | 'medium' | 'low',
    count: number,
    projectId?: string,
  ): void {
    if (count <= 0) return;

    try {
      const validProjectId = projectId && projectId.trim() ? projectId : undefined;
      this.metricsService.incrementVulnerabilities(severity, count, validProjectId);
    } catch (error) {
      this.logger.error(
        `Failed to record vulnerabilities metric: ${(error as Error).message}`,
        (error as Error).stack,
        'QaMetricsService',
      );
    }
  }

  /**
   * Record quality gate decision
   */
  recordGateDecision(
    passed: boolean,
    context: { projectId?: string; aiProvider?: string } = {},
  ): void {
    try {
      const projectId =
        context.projectId && context.projectId.trim() ? context.projectId : undefined;
      const aiProvider =
        context.aiProvider && context.aiProvider.trim() ? context.aiProvider : undefined;

      this.metricsService.recordQACheck({
        checkType: 'gate',
        status: passed ? 'passed' : 'failed',
        duration: 0,
        projectId,
        aiProvider,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record gate decision metric: ${(error as Error).message}`,
        (error as Error).stack,
        'QaMetricsService',
      );
    }
  }

  /**
   * Record self-healing trigger
   * Story 13.4: QA Self-Healing Integration
   */
  recordSelfHealingTrigger(ticketId: string, executionId: string): void {
    try {
      this.metricsService.incrementCounter('qa_self_healing_triggered_total', {
        ticket_id: ticketId,
        execution_id: executionId,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record self-healing trigger metric: ${(error as Error).message}`,
        (error as Error).stack,
        'QaMetricsService',
      );
    }
  }

  /**
   * Record self-healing duration
   * Story 13.4: QA Self-Healing Integration
   */
  recordSelfHealingDuration(
    outcome: 'SUCCESS' | 'ESCALATED' | 'MAX_ATTEMPTS',
    durationMs: number,
  ): void {
    try {
      this.metricsService.recordHistogram(
        'qa_orchestrator_self_healing_duration_seconds',
        durationMs / 1000, // Convert ms to seconds
        { outcome },
      );
    } catch (error) {
      this.logger.error(
        `Failed to record self-healing duration metric: ${(error as Error).message}`,
        (error as Error).stack,
        'QaMetricsService',
      );
    }
  }
}
