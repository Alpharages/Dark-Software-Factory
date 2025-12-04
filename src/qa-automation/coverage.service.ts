import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { PrismaService } from '../database/prisma.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { ErrorCategory, SENTRY_TAGS } from '../common/sentry/sentry.constants';
import { SentryService } from '../common/sentry/sentry.service';
import { ITestResult } from './interfaces/test-runner.interface';
import {
  ICoverageAnalysis,
  ICoverageData,
  ICoverageDelta,
  ICoverageOptions,
  DEFAULT_COVERAGE_THRESHOLD,
  COVERAGE_WEIGHTS,
} from './interfaces/coverage.interface';
import { CoverageFileParser } from './coverage-file.parser';
import { CoverageBaselineService } from './coverage-baseline.service';

@Injectable()
export class CoverageService {
  private readonly logger = new Logger(CoverageService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly sentry: SentryService,
    private readonly fileParser: CoverageFileParser,
    private readonly baselineService: CoverageBaselineService,
  ) {}

  /**
   * Analyze coverage from test execution
   */
  async analyzeCoverage(
    testResult: ITestResult,
    options: ICoverageOptions,
  ): Promise<ICoverageAnalysis> {
    const startTime = Date.now();
    const { executionId, correlationId, projectId, workspacePath } = options;

    try {
      this.logger.log(`Analyzing coverage for execution ${executionId}`);

      // 1. Get threshold (global or project override)
      const threshold = await this.getThreshold(projectId, options.thresholdOverride);

      // 2. Parse file-level coverage
      const parsedCoverage = await this.fileParser.parseCoverageSummary(workspacePath, threshold);

      // Use parsed aggregate if available (more accurate), otherwise fallback to testResult
      const currentCoverage: ICoverageData = parsedCoverage?.aggregate || {
        lines: testResult.coverage?.lines || 0,
        branches: testResult.coverage?.branches || 0,
        functions: testResult.coverage?.functions || 0,
        statements: testResult.coverage?.statements || 0,
      };

      // 3. Get baseline for comparison
      const baseline = await this.baselineService.getBaseline(projectId, options.baseBranch);

      // 4. Calculate delta
      const delta = this.calculateDelta(currentCoverage, baseline?.coverage);

      // 5. Determine pass/fail
      const failedFiles = parsedCoverage?.files.filter((f) => f.isBelowThreshold) || [];
      const isBelowThreshold =
        currentCoverage.lines < threshold ||
        currentCoverage.branches < threshold ||
        currentCoverage.functions < threshold ||
        currentCoverage.statements < threshold;

      // If enforcement is disabled, we always pass
      const enforceThreshold =
        options.enforceThreshold ?? this.configService.get('qa.coverageEnforcementEnabled', true);

      const passed = !enforceThreshold || (!isBelowThreshold && failedFiles.length === 0);

      // 6. Generate report path (assuming nyc generated it)
      const reportPath =
        options.generateHtmlReport !== false
          ? path.join(workspacePath, 'coverage', 'lcov-report', 'index.html')
          : undefined;

      const analysis: ICoverageAnalysis = {
        executionId,
        correlationId,
        current: currentCoverage,
        baseline: baseline?.coverage,
        delta,
        passed,
        threshold,
        failedFiles,
        summary: {
          totalFiles: parsedCoverage?.files.length || 0,
          filesBelowThreshold: failedFiles.length,
          avgLineCoverage: currentCoverage.lines,
        },
        reportPath,
        analyzedAt: new Date(),
      };

      // 7. Record metrics using MetricsService.recordQACheck()
      const duration = (Date.now() - startTime) / 1000;
      this.recordMetrics(analysis, projectId, duration);

      // 8. Save result and notify if failed
      await this.saveResult(analysis, projectId);

      if (!passed) {
        await this.handleFailure(analysis, options);
      }

      return analysis;
    } catch (error) {
      this.sentry.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: {
          [SENTRY_TAGS.EXECUTION_ID]: executionId,
          [SENTRY_TAGS.PROJECT_ID]: projectId,
        },
      });
      throw error;
    }
  }

  private async getThreshold(projectId: string, override?: number): Promise<number> {
    if (override !== undefined) return override;

    // Check for per-project threshold override
    const projectThreshold = await this.baselineService.getProjectThreshold(projectId);

    return (
      projectThreshold ??
      this.configService.get<number>('qa.coverageThreshold', DEFAULT_COVERAGE_THRESHOLD)
    );
  }

  private calculateDelta(current: ICoverageData, baseline?: ICoverageData): ICoverageDelta {
    if (!baseline) {
      return { lines: 0, branches: 0, functions: 0, statements: 0, overall: 0 };
    }

    const delta = {
      lines: current.lines - baseline.lines,
      branches: current.branches - baseline.branches,
      functions: current.functions - baseline.functions,
      statements: current.statements - baseline.statements,
    };

    const overall =
      delta.lines * COVERAGE_WEIGHTS.lines +
      delta.branches * COVERAGE_WEIGHTS.branches +
      delta.functions * COVERAGE_WEIGHTS.functions +
      delta.statements * COVERAGE_WEIGHTS.statements;

    return { ...delta, overall };
  }

  private recordMetrics(
    analysis: ICoverageAnalysis,
    projectId: string,
    durationSeconds: number,
  ): void {
    // Use MetricsService.recordQACheck() which is available in the current infrastructure
    this.metrics.recordQACheck({
      checkType: 'coverage',
      status: analysis.passed ? 'passed' : 'failed',
      duration: durationSeconds,
      projectId,
      coverage: analysis.current.lines,
    });

    // Log additional metrics for observability
    this.logger.debug(
      `Coverage metrics: lines=${analysis.current.lines.toFixed(1)}%, ` +
        `delta=${analysis.delta.lines >= 0 ? '+' : ''}${analysis.delta.lines.toFixed(1)}%, ` +
        `threshold=${analysis.threshold}%, passed=${analysis.passed}`,
    );
  }

  private async saveResult(analysis: ICoverageAnalysis, projectId: string): Promise<void> {
    this.logger.debug(`Coverage analysis completed: ${analysis.passed ? 'PASSED' : 'FAILED'}`);

    // 1. Upsert QAResult with coverage data
    const existingQaResult = await this.prisma.qAResult.findFirst({
      where: { execution_id: analysis.executionId },
    });

    if (existingQaResult) {
      await this.prisma.qAResult.update({
        where: { id: existingQaResult.id },
        data: {
          test_coverage: analysis.current.lines,
        },
      });
    } else {
      await this.prisma.qAResult.create({
        data: {
          execution_id: analysis.executionId,
          linting_passed: true, // Will be updated by linting check
          tests_passed: true, // Will be updated by test check
          test_coverage: analysis.current.lines,
          code_review_passed: false, // Pending review
          overall_passed: analysis.passed,
        },
      });
    }

    // 2. Create audit log entry with coverage details
    await this.prisma.auditLog.create({
      data: {
        entity_type: 'execution',
        entity_id: analysis.executionId,
        action: 'coverage_analyzed',
        actor_type: 'system',
        after_state: JSON.parse(
          JSON.stringify({
            current: analysis.current,
            baseline: analysis.baseline,
            delta: analysis.delta,
            passed: analysis.passed,
            threshold: analysis.threshold,
            failedFilesCount: analysis.failedFiles.length,
            reportPath: analysis.reportPath,
            correlationId: analysis.correlationId,
            projectId,
          }),
        ),
      },
    });
  }

  private async handleFailure(
    analysis: ICoverageAnalysis,
    options: ICoverageOptions,
  ): Promise<void> {
    // Log failure for PM notification
    this.logger.warn(
      `Coverage threshold failed for execution ${analysis.executionId}: ` +
        `${analysis.current.lines.toFixed(1)}% < ${analysis.threshold}% threshold. ` +
        `${analysis.failedFiles.length} files below threshold.`,
    );

    // Update ticket status to QA_FAILED
    await this.updateTicketStatusOnFailure(analysis, options);

    // TODO: When Story 10.1 (Socket.IO) is implemented, emit:
    // this.realtimeGateway.emit('quality-gate:coverage-failed', {
    //     executionId: analysis.executionId,
    //     projectId: options.projectId,
    //     failedFiles: analysis.failedFiles.slice(0, 5),
    //     currentCoverage: analysis.current,
    //     threshold: analysis.threshold,
    // });
  }

  /**
   * Mark ticket as QA_FAILED when coverage fails threshold
   */
  private async updateTicketStatusOnFailure(
    analysis: ICoverageAnalysis,
    _options: ICoverageOptions,
  ): Promise<void> {
    try {
      const execution = await this.prisma.execution.findUnique({
        where: { id: analysis.executionId },
      });

      if (execution) {
        await this.prisma.ticket.update({
          where: { id: execution.ticket_id },
          data: { status: 'QA_FAILED' },
        });

        this.logger.warn(
          `[${analysis.correlationId}] Ticket ${execution.ticket_id} marked as QA_FAILED: ` +
            `coverage ${analysis.current.lines.toFixed(1)}% below threshold ${analysis.threshold}%`,
        );
      }
    } catch (error) {
      // Log but don't fail - ticket update is secondary to coverage analysis
      this.logger.error(
        `Failed to update ticket status for execution ${analysis.executionId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Update baseline after successful merge to main branch
   * Called by GitHub integration (Story 4.x) after merge
   */
  async updateBaselineOnMerge(
    projectId: string,
    coverage: ICoverageData,
    branch: string = 'main',
  ): Promise<void> {
    await this.baselineService.saveBaseline(projectId, branch, coverage);
    this.logger.log(`Baseline updated for project ${projectId} after merge to ${branch}`);
  }
}
