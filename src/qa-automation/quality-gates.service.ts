import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { QA_METRICS } from '../common/metrics/metrics.constants';
import {
  IQualityGateResult,
  IQualityGateConfig,
  IQualityThresholds,
  IBlockingIssue,
  IWarningIssue,
  ICategoryScore,
  QualityGateStatus,
  QualityCategory,
  BlockerType,
  WarningType,
  QUALITY_SCORE_WEIGHTS,
  DEFAULT_THRESHOLDS,
} from './interfaces';
import { TicketStatus } from '@/prisma/client';

/**
 * Input type for QA results to be evaluated by quality gates
 */
export interface IQaResultInput {
  linting_passed: boolean;
  linting_errors: { errorCount: number; warningCount: number } | null;
  tests_passed: boolean;
  test_results: { passed: number; failed: number; skipped?: number } | null;
  test_coverage: number | null;
  code_review_passed: boolean;
  code_review_issues: {
    summary: { criticalCount: number; highCount: number; mediumCount?: number };
    complexityIssues?: { function: string; complexity: number }[];
  } | null;
}

// Sample QA results for testing
export const SAMPLE_QA_RESULT = {
  linting_passed: true,
  linting_errors: { errorCount: 0, warningCount: 2 },
  tests_passed: true,
  test_results: { passed: 50, failed: 0, skipped: 2 },
  test_coverage: 85.5,
  code_review_passed: true,
  code_review_issues: { summary: { criticalCount: 0, highCount: 0, mediumCount: 1 } },
};

export const SAMPLE_FAILING_QA_RESULT = {
  linting_passed: false,
  linting_errors: { errorCount: 3, warningCount: 5 },
  tests_passed: false,
  test_results: { passed: 45, failed: 5, skipped: 2 },
  test_coverage: 65.0,
  code_review_passed: false,
  code_review_issues: {
    summary: { criticalCount: 1, highCount: 2, mediumCount: 3 },
    complexityIssues: [{ function: 'processData', complexity: 25 }],
  },
};

import { QualityGateConfigService } from './quality-gate-config/quality-gate-config.service';
import { QaNotificationService } from './services/qa-notification.service';
import { GateType, QaFailureSeverity } from '@/realtime/realtime.types';

@Injectable()
export class QualityGatesService {
  private readonly logger = new Logger(QualityGatesService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly qualityGateConfigService: QualityGateConfigService,
    private readonly qaNotificationService: QaNotificationService,
    @InjectMetric(QA_METRICS.QUALITY_GATE_EVALUATIONS_TOTAL)
    private readonly evaluationsCounter: Counter<string>,
    @InjectMetric(QA_METRICS.QUALITY_GATE_DURATION)
    private readonly durationHistogram: Histogram<string>,
    @InjectMetric(QA_METRICS.QUALITY_SCORE_HISTOGRAM)
    private readonly scoreHistogram: Histogram<string>,
  ) {}

  /**
   * Main evaluation method - evaluates all QA results against quality gates
   */
  async evaluate(
    executionId: string,
    correlationId: string,
    projectId: string,
    qaResult: IQaResultInput,
  ): Promise<IQualityGateResult> {
    const startTime = Date.now();
    const endTimer = this.durationHistogram.startTimer();

    this.logger.log(`[${correlationId}] Evaluating quality gates for execution ${executionId}`);

    try {
      // Load configuration (per-project or default)
      const config = await this.loadConfig(projectId);

      // Calculate category scores
      const categoryScores = this.calculateCategoryScores(qaResult, config.thresholds);

      // Calculate overall score (weighted average)
      const overallScore = this.calculateOverallScore(categoryScores);

      // Identify blocking issues
      const blockingIssues = this.determineBlockingIssues(qaResult, config.thresholds);

      // Identify warning issues
      const warningIssues = this.determineWarningIssues(qaResult, config.thresholds);

      // Determine status
      const passed = blockingIssues.length === 0;
      const status = this.determineStatus(passed, warningIssues.length);

      // Determine next action
      const nextAction = this.determineNextAction(passed, warningIssues);

      // Track metrics
      this.evaluationsCounter.inc({ status, project_id: projectId });
      this.scoreHistogram.observe({ project_id: projectId }, overallScore);

      // Prepare execution object for notification service
      // Note: We create a minimal object here sufficient for the service
      const executionContext = {
        id: executionId,
        ticketId: correlationId,
        ticket: { projectId, project: null }, // Project ID is sufficient for routing usually
      };

      // Notify on failures (Fire and forget)
      if (blockingIssues.length > 0) {
        this.notifyFailures(executionContext, blockingIssues).catch((err) =>
          this.logger.error(`Failed to notify failures: ${err.message}`),
        );
      }

      if (!passed) {
        // Emit blocked event
        const blockedBy = blockingIssues.map((issue) => this.mapBlockerToGateType(issue.type));
        this.qaNotificationService
          .emitGateBlocked(
            executionContext,
            [...new Set(blockedBy)], // Unique types
            config.allowOverride,
            ['LEAD_QA', 'ADMIN', 'MANAGER'], // Default override roles
          )
          .catch((err) => this.logger.error(`Failed to notify blocked gate: ${err.message}`));
      }

      const result: IQualityGateResult = {
        executionId,
        correlationId,
        status,
        overallScore,
        passed,
        categoryScores,
        blockingIssues,
        warningIssues,
        appliedConfig: config,
        evaluatedAt: new Date(),
        durationMs: Date.now() - startTime,
        nextAction,
        ticketStatusUpdate: passed ? TicketStatus.QA_REVIEW : TicketStatus.QA_FAILED,
      };

      this.logger.log(
        `[${correlationId}] Quality gate evaluation complete: ` +
          `score=${overallScore}, passed=${passed}, ` +
          `blockers=${blockingIssues.length}, warnings=${warningIssues.length}`,
      );

      return result;
    } finally {
      endTimer();
    }
  }

  /**
   * Load quality gate configuration
   */
  async loadConfig(projectId: string): Promise<IQualityGateConfig> {
    try {
      return await this.qualityGateConfigService.getEffectiveConfig(projectId);
    } catch (error) {
      this.logger.error(
        `Failed to load config for project ${projectId}`,
        error instanceof Error ? error.stack : String(error),
      );
      // Failsafe return defaults
      return {
        projectId: null,
        thresholds: DEFAULT_THRESHOLDS,
        enabledCategories: [
          QualityCategory.LINTING,
          QualityCategory.TESTING,
          QualityCategory.COVERAGE,
          QualityCategory.SECURITY,
        ],
        allowOverride: false,
        overrideRequiresApproval: true,
      };
    }
  }

  /**
   * Calculate score for each quality category
   */
  private calculateCategoryScores(
    qaResult: IQaResultInput,
    thresholds: IQualityThresholds,
  ): ICategoryScore[] {
    const scores: ICategoryScore[] = [];

    // Linting Score (15%)
    scores.push(this.calculateLintingScore(qaResult, thresholds));

    // Testing Score (35%)
    scores.push(this.calculateTestingScore(qaResult, thresholds));

    // Coverage Score (25%)
    scores.push(this.calculateCoverageScore(qaResult, thresholds));

    // Security Score (25%)
    scores.push(this.calculateSecurityScore(qaResult, thresholds));

    return scores;
  }

  private calculateLintingScore(
    qaResult: IQaResultInput,
    thresholds: IQualityThresholds,
  ): ICategoryScore {
    const errors = qaResult.linting_errors?.errorCount || 0;
    const warnings = qaResult.linting_errors?.warningCount || 0;

    // 100 if passed, deduct for errors/warnings
    let score = 100;
    if (!qaResult.linting_passed) score -= 50;
    score -= Math.min(errors * 10, 40); // -10 per error, max -40
    score -= Math.min(warnings * 2, 10); // -2 per warning, max -10
    score = Math.max(0, score);

    return {
      category: QualityCategory.LINTING,
      score,
      weight: QUALITY_SCORE_WEIGHTS[QualityCategory.LINTING],
      passed: qaResult.linting_passed && errors <= thresholds.maxLintingErrors,
      details: [
        { metric: 'errors', value: errors, threshold: thresholds.maxLintingErrors },
        { metric: 'warnings', value: warnings, threshold: thresholds.maxLintingWarnings },
      ],
    };
  }

  private calculateTestingScore(
    qaResult: IQaResultInput,
    thresholds: IQualityThresholds,
  ): ICategoryScore {
    const testResults = qaResult.test_results || { passed: 0, failed: 0, skipped: 0 };
    const total = testResults.passed + testResults.failed;
    const passRate = total > 0 ? (testResults.passed / total) * 100 : 100;

    // Score based on pass rate
    const score = Math.min(100, passRate);

    return {
      category: QualityCategory.TESTING,
      score,
      weight: QUALITY_SCORE_WEIGHTS[QualityCategory.TESTING],
      passed: qaResult.tests_passed && passRate >= thresholds.minTestPassRate,
      details: [
        { metric: 'pass_rate', value: passRate, threshold: thresholds.minTestPassRate },
        { metric: 'passed', value: testResults.passed, threshold: 0 },
        { metric: 'failed', value: testResults.failed, threshold: 0 },
      ],
    };
  }

  private calculateCoverageScore(
    qaResult: IQaResultInput,
    thresholds: IQualityThresholds,
  ): ICategoryScore {
    const coverage = qaResult.test_coverage ?? 0;

    // Score scaled between min and target coverage
    // Below min = 0, at target = 100, linear in between
    let score: number;
    if (coverage >= thresholds.targetCoverage) {
      score = 100;
    } else if (coverage < thresholds.minCoverage) {
      score = (coverage / thresholds.minCoverage) * 50; // 0-50 below minimum
    } else {
      // Between min and target: 50-100
      const range = thresholds.targetCoverage - thresholds.minCoverage;
      const progress = coverage - thresholds.minCoverage;
      score = 50 + (progress / range) * 50;
    }

    return {
      category: QualityCategory.COVERAGE,
      score: Math.round(score),
      weight: QUALITY_SCORE_WEIGHTS[QualityCategory.COVERAGE],
      passed: coverage >= thresholds.minCoverage,
      details: [
        { metric: 'coverage', value: coverage, threshold: thresholds.minCoverage },
        { metric: 'target', value: coverage, threshold: thresholds.targetCoverage },
      ],
    };
  }

  private calculateSecurityScore(
    qaResult: IQaResultInput,
    thresholds: IQualityThresholds,
  ): ICategoryScore {
    const issues = qaResult.code_review_issues?.summary ?? {
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
    };
    const criticalCount = issues.criticalCount || 0;
    const highCount = issues.highCount || 0;
    const mediumCount = issues.mediumCount || 0;

    // Deduct heavily for critical/high, less for medium
    let score = 100;
    score -= criticalCount * 30;
    score -= highCount * 15;
    score -= mediumCount * 5;
    score = Math.max(0, score);

    const passed =
      qaResult.code_review_passed &&
      (thresholds.blockOnCriticalSecurity ? criticalCount === 0 : true) &&
      (thresholds.blockOnHighSecurity ? highCount === 0 : true);

    return {
      category: QualityCategory.SECURITY,
      score,
      weight: QUALITY_SCORE_WEIGHTS[QualityCategory.SECURITY],
      passed,
      details: [
        { metric: 'critical', value: criticalCount, threshold: 0 },
        { metric: 'high', value: highCount, threshold: 0 },
        { metric: 'medium', value: mediumCount, threshold: 0 },
      ],
    };
  }

  /**
   * Calculate overall weighted score
   */
  private calculateOverallScore(categoryScores: ICategoryScore[]): number {
    const weightedSum = categoryScores.reduce((sum, cat) => sum + cat.score * cat.weight, 0);
    const totalWeight = categoryScores.reduce((sum, cat) => sum + cat.weight, 0);
    return Math.round(weightedSum / totalWeight);
  }

  /**
   * Identify blocking issues that fail the gate
   */
  private determineBlockingIssues(
    qaResult: IQaResultInput,
    thresholds: IQualityThresholds,
  ): IBlockingIssue[] {
    const blockers: IBlockingIssue[] = [];

    // Test failures
    if (!qaResult.tests_passed) {
      const testResults = qaResult.test_results ?? { passed: 0, failed: 0, skipped: 0 };
      blockers.push({
        type: BlockerType.TEST_FAILURE,
        category: QualityCategory.TESTING,
        message: `${testResults.failed || 0} test(s) failed`,
        details: { testResults },
      });
    }

    // Linting errors (not warnings)
    if (!qaResult.linting_passed) {
      const errors = qaResult.linting_errors?.errorCount || 0;
      if (errors > thresholds.maxLintingErrors) {
        blockers.push({
          type: BlockerType.LINTING_ERROR,
          category: QualityCategory.LINTING,
          message: `${errors} linting error(s) found (max: ${thresholds.maxLintingErrors})`,
          details: { errors },
        });
      }
    }

    // Critical security vulnerabilities
    const securitySummary = qaResult.code_review_issues?.summary ?? {
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
    };
    if (thresholds.blockOnCriticalSecurity && securitySummary.criticalCount > 0) {
      blockers.push({
        type: BlockerType.CRITICAL_SECURITY,
        category: QualityCategory.SECURITY,
        message: `${securitySummary.criticalCount} critical security vulnerability(ies) found`,
        details: { criticalCount: securitySummary.criticalCount },
      });
    }

    // High security vulnerabilities (if configured to block)
    if (thresholds.blockOnHighSecurity && securitySummary.highCount > 0) {
      blockers.push({
        type: BlockerType.CRITICAL_SECURITY, // Using same type for blocker, but details differ
        category: QualityCategory.SECURITY,
        message: `${securitySummary.highCount} high-severity security vulnerability(ies) found`,
        details: { highCount: securitySummary.highCount },
      });
    }

    // Coverage below minimum
    const coverage = qaResult.test_coverage ?? 0;
    if (coverage < thresholds.minCoverage) {
      blockers.push({
        type: BlockerType.COVERAGE_BELOW_MINIMUM,
        category: QualityCategory.COVERAGE,
        message: `Coverage ${coverage.toFixed(1)}% is below minimum ${thresholds.minCoverage}%`,
        details: { coverage, minimum: thresholds.minCoverage },
      });
    }

    return blockers;
  }

  /**
   * Identify warning issues (don't block but worth noting)
   */
  private determineWarningIssues(
    qaResult: IQaResultInput,
    thresholds: IQualityThresholds,
  ): IWarningIssue[] {
    const warnings: IWarningIssue[] = [];

    // Linting warnings (if above threshold)
    const warningCount = qaResult.linting_errors?.warningCount || 0;
    if (warningCount > thresholds.maxLintingWarnings) {
      warnings.push({
        type: WarningType.LINTING_WARNING,
        category: QualityCategory.LINTING,
        message: `${warningCount} linting warning(s) (threshold: ${thresholds.maxLintingWarnings})`,
        details: { warnings: warningCount },
      });
    }

    // Coverage below target (but above minimum)
    const coverage = qaResult.test_coverage ?? 0;
    if (coverage >= thresholds.minCoverage && coverage < thresholds.targetCoverage) {
      warnings.push({
        type: WarningType.COVERAGE_BELOW_TARGET,
        category: QualityCategory.COVERAGE,
        message: `Coverage ${coverage.toFixed(1)}% is below target ${thresholds.targetCoverage}%`,
        details: { coverage, target: thresholds.targetCoverage },
      });
    }

    // Medium/low security issues
    const securitySummary = qaResult.code_review_issues?.summary ?? {
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
    };
    const mediumCount = securitySummary.mediumCount ?? 0;
    if (mediumCount > 0) {
      warnings.push({
        type: WarningType.LOW_SEVERITY_VULN,
        category: QualityCategory.SECURITY,
        message: `${securitySummary.mediumCount} medium-severity issue(s) found`,
        details: { mediumCount: securitySummary.mediumCount },
      });
    }

    // Complexity issues
    const complexityIssues = qaResult.code_review_issues?.complexityIssues || [];
    if (complexityIssues.length > 0) {
      warnings.push({
        type: WarningType.HIGH_COMPLEXITY,
        category: QualityCategory.SECURITY,
        message: `${complexityIssues.length} high-complexity function(s) detected`,
        details: { count: complexityIssues.length },
      });
    }

    return warnings;
  }

  private determineStatus(passed: boolean, warningCount: number): QualityGateStatus {
    if (!passed) return QualityGateStatus.FAILED;
    if (warningCount > 0) return QualityGateStatus.WARNING;
    return QualityGateStatus.PASSED;
  }

  private determineNextAction(
    passed: boolean,
    warnings: IWarningIssue[],
  ): IQualityGateResult['nextAction'] {
    if (!passed) return 'notify_pm_failure';
    if (warnings.length > 5) return 'manual_review'; // Many warnings = human review
    return 'proceed_to_github';
  }

  /**
   * Helper to notify on blocking failures
   */
  private async notifyFailures(
    executionContext: {
      id: string;
      ticketId: string;
      ticket: { projectId: string; project: null };
    },
    blockingIssues: IBlockingIssue[],
  ): Promise<void> {
    if (blockingIssues.length === 1) {
      const issue = blockingIssues[0];
      const gateType = this.mapBlockerToGateType(issue.type);
      const severity = this.determineSeverity(issue);

      await this.qaNotificationService.emitGateFailed(
        executionContext,
        gateType,
        issue.details || {},
        severity,
      );
    } else {
      // Multiple failures
      const failedGates = blockingIssues.map((issue) => ({
        gateType: this.mapBlockerToGateType(issue.type),
        failureDetails: issue.details || {},
        severity: this.determineSeverity(issue),
      }));

      const summary = {
        totalFailures: blockingIssues.length,
        criticalCount: failedGates.filter((g) => g.severity === 'CRITICAL').length,
        highCount: failedGates.filter((g) => g.severity === 'HIGH').length,
        mediumCount: failedGates.filter((g) => g.severity === 'MEDIUM').length,
        lowCount: failedGates.filter((g) => g.severity === 'LOW').length,
      };

      await this.qaNotificationService.emitAllGatesFailed(executionContext, failedGates, summary);
    }
  }

  private mapBlockerToGateType(type: BlockerType): GateType {
    switch (type) {
      case BlockerType.LINTING_ERROR:
        return 'LINTING';
      case BlockerType.TEST_FAILURE:
        return 'TEST';
      case BlockerType.COVERAGE_BELOW_MINIMUM:
        return 'COVERAGE';
      case BlockerType.CRITICAL_SECURITY:
        return 'SECURITY';
      default:
        return 'CUSTOM';
    }
  }

  private determineSeverity(issue: IBlockingIssue): QaFailureSeverity {
    if (issue.type === BlockerType.CRITICAL_SECURITY) return 'CRITICAL';
    if (issue.type === BlockerType.TEST_FAILURE) return 'HIGH'; // Tests failing is high severity
    return 'MEDIUM'; // Linting/Coverage is usually medium
  }
}
