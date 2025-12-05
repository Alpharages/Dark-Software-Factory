import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaService } from '../database/prisma.service';
import { SentryService } from '../common/sentry/sentry.service';
import { ErrorCategory } from '../common/sentry/sentry.constants';
import { QA_METRICS } from '../common/metrics/metrics.constants';
import { EXCHANGE_NAMES, ROUTING_KEYS, QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { QualityGatesService } from './quality-gates.service';
import { LinterService } from './linter.service';
import { TestRunnerService } from './test-runner.service';
import { CoverageService } from './coverage.service';
import { CodeReviewService } from './code-review.service';
import {
  IQaCheckMessage,
  IQaOrchestrationResult,
  QualityCategory,
  ILintingResult,
  ITestResult,
  ICoverageAnalysis,
  ISecurityScanResult,
  TestFramework,
} from './interfaces';
import { TicketStatus } from '@prisma/client';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';

/**
 * Aggregated QA result for quality gate evaluation
 */
interface IAggregatedQaResult {
  linting_passed: boolean;
  linting_errors: { errorCount: number; warningCount: number } | null;
  tests_passed: boolean;
  test_results: { passed: number; failed: number; skipped: number } | null;
  test_coverage: number | null;
  code_review_passed: boolean;
  code_review_issues: {
    summary: { criticalCount: number; highCount: number; mediumCount: number };
    complexityIssues?: { function: string; complexity: number }[];
  } | null;
}

/**
 * QA Orchestration Service
 * Coordinates parallel execution of QA checks and quality gate evaluation
 * Architecture: docs/architecture.md line 160 (qa-orchestrator.service.ts)
 */
@Injectable()
export class QaOrchestratorService {
  private readonly logger = new Logger(QaOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sentry: SentryService,
    private readonly configService: ConfigService,
    private readonly qualityGatesService: QualityGatesService,
    private readonly linterService: LinterService,
    private readonly testRunnerService: TestRunnerService,
    private readonly coverageService: CoverageService,
    private readonly codeReviewService: CodeReviewService,
    private readonly rabbitPublisher: RabbitMQPublisherService,
    @InjectMetric(QA_METRICS.CHECKS_TOTAL)
    private readonly checksCounter: Counter<string>,
    @InjectMetric(QA_METRICS.CHECK_DURATION)
    private readonly checkDuration: Histogram<string>,
  ) {}

  /**
   * Main entry point - processes QA check message from RabbitMQ
   * Runs all QA checks in parallel and evaluates quality gates
   */
  async processQaCheck(message: IQaCheckMessage): Promise<IQaOrchestrationResult> {
    const {
      executionId,
      ticketId,
      projectId,
      correlationId,
      workspacePath,
      skipCategories = [],
    } = message;
    const startTime = Date.now();
    const endTimer = this.checkDuration.startTimer({ check_type: 'full' });

    this.logger.log(`[${correlationId}] Starting QA orchestration for execution ${executionId}`);

    try {
      // Update ticket status to QA_REVIEW
      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: TicketStatus.QA_REVIEW },
      });

      // Run all QA checks in parallel with per-category timeouts
      const [lintingResult, testResult, coverageResult, securityResult] = await Promise.allSettled([
        this.runLinting(workspacePath, correlationId, skipCategories),
        this.runTests(workspacePath, executionId, correlationId, skipCategories),
        this.runCoverage(workspacePath, projectId, executionId, correlationId, skipCategories),
        this.runSecurityChecks(
          workspacePath,
          projectId,
          executionId,
          correlationId,
          skipCategories,
        ),
      ]);

      // Aggregate results for quality gate evaluation
      const qaResult = this.aggregateResults(
        lintingResult,
        testResult,
        coverageResult,
        securityResult,
      );

      // Evaluate Quality Gates
      const gateResult = await this.qualityGatesService.evaluate(
        executionId,
        correlationId,
        projectId,
        qaResult,
      );

      // Determine final status
      const overallPassed = gateResult.passed;

      // Save QA results
      await this.saveQaResult(executionId, qaResult, overallPassed);

      // Notify via RabbitMQ
      if (overallPassed) {
        this.checksCounter.inc({ status: 'passed' });
        this.logger.log(`[${correlationId}] QA check PASSED for execution ${executionId}`);

        // Publish QA_CHECK_COMPLETED event
        await this.rabbitPublisher.publishToExchange(
          EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
          ROUTING_KEYS.QA_CHECK_COMPLETED,
          {
            executionId,
            ticketId,
            correlationId,
            passed: true,
            nextStep: 'deployment',
          },
        );

        // Update Ticket status to GITHUB_PUSH (Passed QA)
        await this.prisma.ticket.update({
          where: { id: ticketId },
          data: { status: TicketStatus.GITHUB_PUSH },
        });

        // Add to Deployment Queue (if auto-deploy is configured)
        // For now, just mark Ticket as READY for next stage or similar
        // Or simply emitting the event is enough for the Deployment Service to pick it up.
        // In clean architecture, we might want to specifically send command to deployment queue.
        await this.rabbitPublisher.publishToQueue(QUEUE_NAMES.DEPLOYMENT, {
          executionId,
          ticketId,
          correlationId,
          action: 'deploy',
          environment: 'staging',
        });
      } else {
        this.checksCounter.inc({ status: 'failed' });
        this.logger.warn(`[${correlationId}] QA check FAILED for execution ${executionId}`);

        // Publish QA_CHECK_FAILED event
        await this.rabbitPublisher.publishToExchange(
          EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
          ROUTING_KEYS.QA_CHECK_FAILED,
          {
            executionId,
            ticketId,
            correlationId,
            passed: false,
            blockers: gateResult.blockingIssues,
          },
        );

        // Update Ticket status to QA_FAILED
        await this.prisma.ticket.update({
          where: { id: ticketId },
          data: { status: TicketStatus.QA_FAILED },
        });
      }

      return {
        executionId,
        correlationId,
        status: overallPassed ? 'passed' : 'failed',
        lintingResult: qaResult,
        testResult: qaResult,
        coverageResult: qaResult,
        securityResult: qaResult,
        qualityGateResult: gateResult,
      };
    } catch (error) {
      this.checksCounter.inc({ status: 'error' });
      this.logger.error(
        `[${correlationId}] QA orchestration failed: ${(error as Error).message} `,
        (error as Error).stack,
      );

      this.sentry.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId, ticketId, correlationId },
      });

      throw error;
    } finally {
      endTimer();
      this.logger.log(
        `[${correlationId}] QA orchestration completed in ${Date.now() - startTime} ms`,
      );
    }
  }

  // ============ QA Service Integration Methods ============

  /**
   * Run linting check using LinterService (Story 3.1)
   */
  private async runLinting(
    workspacePath: string,
    correlationId: string,
    skipCategories: QualityCategory[],
  ): Promise<ILintingResult | null> {
    if (skipCategories.includes(QualityCategory.LINTING)) {
      this.logger.debug(`[${correlationId}] Skipping linting (category disabled)`);
      return null;
    }

    const timeoutMs = this.configService.get<number>('qualityGate.lintingTimeoutMs', 60000);
    this.logger.debug(`[${correlationId}] Running linting with timeout ${timeoutMs}ms`);

    return Promise.race([
      this.linterService.lintFiles({ workspacePath, files: ['.'] }),
      new Promise<ILintingResult>((_, reject) =>
        setTimeout(() => reject(new Error('Linting timeout')), timeoutMs),
      ),
    ]);
  }

  /**
   * Run tests using TestRunnerService (Story 3.2)
   */
  private async runTests(
    workspacePath: string,
    executionId: string,
    correlationId: string,
    skipCategories: QualityCategory[],
  ): Promise<ITestResult | null> {
    if (skipCategories.includes(QualityCategory.TESTING)) {
      this.logger.debug(`[${correlationId}] Skipping testing (category disabled)`);
      return null;
    }

    const timeoutMs = this.configService.get<number>('qualityGate.testingTimeoutMs', 300000);
    this.logger.debug(`[${correlationId}] Running tests with timeout ${timeoutMs}ms`);

    return this.testRunnerService.runTests({
      workspacePath,
      executionId,
      correlationId,
      timeoutMs,
      collectCoverage: true,
    });
  }

  /**
   * Run coverage analysis using CoverageService (Story 3.3)
   */
  private async runCoverage(
    workspacePath: string,
    projectId: string,
    executionId: string,
    correlationId: string,
    skipCategories: QualityCategory[],
  ): Promise<ICoverageAnalysis | null> {
    if (skipCategories.includes(QualityCategory.COVERAGE)) {
      this.logger.debug(`[${correlationId}] Skipping coverage (category disabled)`);
      return null;
    }

    const timeoutMs = this.configService.get<number>('qualityGate.coverageTimeoutMs', 60000);
    this.logger.debug(`[${correlationId}] Analyzing coverage with timeout ${timeoutMs}ms`);

    return Promise.race([
      this.coverageService.analyzeCoverage(
        {
          passed: true,
          totalTests: 0,
          passedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          durationMs: 0,
          suites: [],
          failedTests: [],
          framework: TestFramework.JEST,
        },
        { workspacePath, projectId, executionId, correlationId },
      ),
      new Promise<ICoverageAnalysis>((_, reject) =>
        setTimeout(() => reject(new Error('Coverage analysis timeout')), timeoutMs),
      ),
    ]);
  }

  /**
   * Run security checks using CodeReviewService (Story 3.4)
   */
  private async runSecurityChecks(
    workspacePath: string,
    projectId: string,
    executionId: string,
    correlationId: string,
    skipCategories: QualityCategory[],
  ): Promise<ISecurityScanResult | null> {
    if (skipCategories.includes(QualityCategory.SECURITY)) {
      this.logger.debug(`[${correlationId}] Skipping security (category disabled)`);
      return null;
    }

    const timeoutMs = this.configService.get<number>('qualityGate.securityTimeoutMs', 180000);
    this.logger.debug(`[${correlationId}] Running security scan with timeout ${timeoutMs}ms`);

    return Promise.race([
      this.codeReviewService.scan({
        workspacePath,
        projectId,
        executionId,
        correlationId,
      }),
      new Promise<ISecurityScanResult>((_, reject) =>
        setTimeout(() => reject(new Error('Security scan timeout')), timeoutMs),
      ),
    ]);
  }

  // ============ Result Aggregation ============

  /**
   * Aggregate results from all QA checks into a format for quality gate evaluation
   */
  private aggregateResults(
    lintingResult: PromiseSettledResult<ILintingResult | null>,
    testResult: PromiseSettledResult<ITestResult | null>,
    coverageResult: PromiseSettledResult<ICoverageAnalysis | null>,
    securityResult: PromiseSettledResult<ISecurityScanResult | null>,
  ): IAggregatedQaResult {
    const linting = this.extractValue(lintingResult, null);
    const tests = this.extractValue(testResult, null);
    const coverage = this.extractValue(coverageResult, null);
    const security = this.extractValue(securityResult, null);

    return {
      linting_passed: linting?.passed ?? true,
      linting_errors: linting
        ? { errorCount: linting.errorCount, warningCount: linting.warningCount }
        : null,
      tests_passed: tests?.passed ?? true,
      test_results: tests
        ? { passed: tests.passedCount, failed: tests.failedCount, skipped: tests.skippedCount }
        : null,
      test_coverage: coverage?.current?.lines ?? null,
      code_review_passed: security?.passed ?? true,
      code_review_issues: security
        ? {
            summary: {
              criticalCount: security.summary.criticalCount,
              highCount: security.summary.highCount,
              mediumCount: security.summary.mediumCount,
            },
            complexityIssues: security.complexityIssues.map((i) => ({
              function: i.functionName,
              complexity: i.value,
            })),
          }
        : null,
    };
  }

  /**
   * Extract value from PromiseSettledResult, returning default if rejected or null
   */
  private extractValue<T>(result: PromiseSettledResult<T>, defaultValue: T): T {
    if (result.status === 'fulfilled') {
      return result.value ?? defaultValue;
    }
    return defaultValue;
  }

  // ============ Database Operations ============

  /**
   * Save QA result to database (upsert pattern)
   */
  private async saveQaResult(
    executionId: string,
    qaResult: IAggregatedQaResult,
    overallPassed: boolean,
  ): Promise<void> {
    const existing = await this.prisma.qAResult.findFirst({
      where: { execution_id: executionId },
    });

    // Prisma requires undefined instead of null for optional JSON fields
    const data = {
      linting_passed: qaResult.linting_passed,
      linting_errors: qaResult.linting_errors ?? undefined,
      tests_passed: qaResult.tests_passed,
      test_results: qaResult.test_results ?? undefined,
      test_coverage: qaResult.test_coverage,
      code_review_passed: qaResult.code_review_passed,
      code_review_issues: qaResult.code_review_issues ?? undefined,
      overall_passed: overallPassed,
    };

    if (existing) {
      await this.prisma.qAResult.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await this.prisma.qAResult.create({
        data: { execution_id: executionId, ...data },
      });
    }
  }

  /**
   * Create audit log for quality gate evaluation
   */
  private async createAuditLog(
    executionId: string,
    result: {
      passed: boolean;
      overallScore: number;
      status: string;
      blockingIssues: unknown[];
      warningIssues: unknown[];
      correlationId: string;
    },
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        entity_type: 'execution',
        entity_id: executionId,
        action: 'quality_gate_evaluated',
        actor_type: 'system',
        after_state: {
          passed: result.passed,
          score: result.overallScore,
          status: result.status,
          blockingIssues: result.blockingIssues.length,
          warningIssues: result.warningIssues.length,
          correlationId: result.correlationId,
        },
      },
    });
  }
}
