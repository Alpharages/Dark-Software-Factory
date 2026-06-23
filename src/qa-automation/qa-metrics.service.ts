import { Injectable } from '@nestjs/common';
import { MetricsService } from '../common/metrics/metrics.service';
import { LoggerService } from '../common/logger/logger.service';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge, Histogram } from 'prom-client';
import { QA_METRICS } from '../common/metrics/metrics.constants';

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
    @InjectMetric(QA_METRICS.BUG_ESCAPES_TOTAL) public bugEscapesTotal: Counter<string>,
    @InjectMetric(QA_METRICS.BUG_ESCAPE_RATE_PERCENT) public bugEscapeRatePercent: Gauge<string>,
    @InjectMetric(QA_METRICS.BUG_ESCAPE_THRESHOLD_BREACHES_TOTAL)
    public bugEscapeThresholdBreachesTotal: Counter<string>,
    @InjectMetric(QA_METRICS.BUG_ESCAPE_RESOLUTION_TIME_HOURS)
    public bugEscapeResolutionTimeHours: Histogram<string>,
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
    } catch (_error) {
      this.logger.error(
        `Failed to record QA check metric: ${(_error as Error).message}`,
        (_error as Error).stack,
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
    } catch (_error) {
      this.logger.error(
        `Failed to record QA error metric: ${(_error as Error).message}`,
        (_error as Error).stack,
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
    } catch (_error) {
      this.logger.error(
        `Failed to record coverage metric: ${(_error as Error).message}`,
        (_error as Error).stack,
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
    } catch (_error) {
      this.logger.error(
        `Failed to record vulnerabilities metric: ${(_error as Error).message}`,
        (_error as Error).stack,
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
    } catch (_error) {
      this.logger.error(
        `Failed to record gate decision metric: ${(_error as Error).message}`,
        (_error as Error).stack,
        'QaMetricsService',
      );
    }
  }

  /**
   * Record Bug Escape
   * Story 8.5
   */
  recordBugEscape(category: string, projectId: string, aiProvider?: string): void {
    try {
      this.bugEscapesTotal.labels(category, projectId, aiProvider || 'unknown').inc();
    } catch (_error) {
      this.logger.error(
        `Failed to record bug escape metric: ${(_error as Error).message}`,
        (_error as Error).stack,
        'QaMetricsService',
      );
    }
  }

  /**
   * Update Bug Escape Rate
   * Story 8.5
   */
  updateEscapeRate(projectId: string, rate: number): void {
    try {
      this.bugEscapeRatePercent.labels(projectId).set(rate);
    } catch (_error) {
      this.logger.error(
        `Failed to update bug escape rate metric: ${(_error as Error).message}`,
        (_error as Error).stack,
        'QaMetricsService',
      );
    }
  }

  /**
   * Record Escape Threshold Breach
   * Story 8.5
   */
  recordEscapeThresholdBreach(projectId: string): void {
    try {
      this.bugEscapeThresholdBreachesTotal.labels(projectId).inc();
    } catch (_error) {
      this.logger.error(
        `Failed to record bug escape threshold breach: ${(_error as Error).message}`,
        (_error as Error).stack,
        'QaMetricsService',
      );
    }
  }

  /**
   * Record Resolution Time
   * Story 8.5
   */
  recordResolutionTime(hours: number): void {
    try {
      this.bugEscapeResolutionTimeHours.observe(hours);
    } catch (_error) {
      this.logger.error(
        `Failed to record bug escape resolution time: ${(_error as Error).message}`,
        (_error as Error).stack,
        'QaMetricsService',
      );
    }
  }
}
