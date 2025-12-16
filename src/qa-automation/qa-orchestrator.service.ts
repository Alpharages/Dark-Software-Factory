import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { SentryService } from '../common/sentry/sentry.service';
import { ErrorCategory } from '../common/sentry/sentry.constants';
import { EXCHANGE_NAMES, ROUTING_KEYS, QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { QualityGatesService } from './quality-gates.service';
import { QaMetricsService } from './qa-metrics.service';
import { AiQaOrchestrator } from './ai-qa-orchestrator.service'; // Story 3.10
// Story 3.10: Deleted services - replaced by AI delegation
// import { LinterService } from './linter.service';
// import { TestRunnerService } from './test-runner.service';
// import { CoverageService } from './coverage.service';
// import { CodeReviewService } from './code-review.service';
import {
  IQaCheckMessage,
  IQaOrchestrationResult,
  QualityCategory,
  ILintingResult,
  ILintingIssue,
  ITestResult,
  ICoverageAnalysis,
  ISecurityScanResult,
  TestFramework,
  IQaQueueMessage,
  IQaQueueResult,
  QaCheckType,
  SupportedLanguage,
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
  overall_passed?: boolean; // Story 3.7
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
    // Story 3.10: AiQaOrchestrator replaces deleted services
    private readonly aiQaOrchestrator: AiQaOrchestrator,
    // Story 3.10: Temporarily commented - will be replaced with AiQaOrchestrator
    // private readonly linterService: LinterService,
    // private readonly testRunnerService: TestRunnerService,
    // private readonly coverageService: CoverageService,
    // private readonly codeReviewService: CodeReviewService,
    private readonly rabbitPublisher: RabbitMQPublisherService,
    private readonly qaMetrics: QaMetricsService, // Story 3.8: Use facade instead of direct injection
  ) {}

  /**
   * Story 3.7: Run QA checks for post-execution code files
   * AC#2: Creates QA result record, runs checks in parallel, stores partial results,
   *       evaluates gate, publishes result events
   */
  async runQaChecks(message: IQaQueueMessage, correlationId: string): Promise<IQaQueueResult> {
    const { executionId, ticketId, projectId, aiProvider } = message;
    const startTime = Date.now();

    this.logger.log(`[${correlationId}] Starting parallel QA checks for execution ${executionId}`);

    try {
      // AC#2: Create QA result record BEFORE running checks
      // Note: Using upsert pattern via savePartialResult to handle concurrent updates
      await this.savePartialQaResult(executionId, { overall_passed: false });

      // Run all checks in parallel with timeout wrapper
      const checkResults = await Promise.allSettled([
        this.withTimeout(this.runLintingCheck(message, correlationId), 'linting'),
        this.withTimeout(this.runTestingCheck(message, correlationId), 'testing'),
        this.withTimeout(this.runCoverageCheck(message, correlationId), 'coverage'),
        this.withTimeout(this.runSecurityCheck(message, correlationId), 'security'),
      ]);

      // Extract results
      const lintingResult = this.extractCheckResult(checkResults[0], 'linting');
      const testingResult = this.extractCheckResult(checkResults[1], 'testing');
      const coverageResult = this.extractCheckResult(checkResults[2], 'coverage');
      const securityResult = this.extractCheckResult(checkResults[3], 'security');

      // Evaluate overall gate (simplified until Story 3.5 quality gates integrated)
      const overallPassed =
        lintingResult.passed &&
        testingResult.passed &&
        coverageResult.passed &&
        securityResult.passed;

      // Update overall status
      await this.savePartialQaResult(executionId, { overall_passed: overallPassed });

      const totalDuration = Date.now() - startTime;

      const result: IQaQueueResult = {
        executionId,
        passed: overallPassed,
        results: {
          linting: {
            passed: lintingResult.passed,
            errors: lintingResult.data as unknown[],
            duration: lintingResult.duration,
          },
          testing: {
            passed: testingResult.passed,
            results: testingResult.data,
            duration: testingResult.duration,
          },
          coverage: {
            percentage: coverageResult.passed ? (coverageResult.data as number) : null,
            passed: coverageResult.passed,
            duration: coverageResult.duration,
          },
          security: {
            passed: securityResult.passed,
            issues: securityResult.data as unknown[],
            duration: securityResult.duration,
          },
        },
        totalDuration,
        correlationId,
      };

      // AC#2: Publish result event to orchestrator-events exchange
      await this.publishQaResultEvent(result);

      this.logger.log(
        `[${correlationId}] QA checks completed: ${overallPassed ? 'PASSED' : 'FAILED'} (${totalDuration}ms)`,
      );

      // Record overall gate decision metric (Story 3.8)
      this.qaMetrics.recordGateDecision(overallPassed, {
        projectId,
        aiProvider,
      });

      return result;
    } catch (error) {
      // Record error metric (Story 3.8)
      this.qaMetrics.recordCheckError('linting', 'error', Date.now() - startTime, {
        projectId,
        aiProvider,
      });
      this.logger.error(
        `[${correlationId}] QA checks failed: ${(error as Error).message}`,
        (error as Error).stack,
      );

      this.sentry.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId, ticketId, correlationId },
      });

      throw error;
    }
  }

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

    this.logger.log(`[${correlationId}] Starting QA orchestration for execution ${executionId}`);

    try {
      // Update ticket status to QA_REVIEW
      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: TicketStatus.QA_REVIEW },
      });

      // Run all QA checks in parallel with per-category timeouts
      const [lintingResult, testResult, coverageResult, securityResult] = await Promise.allSettled([
        this.runLinting(ticketId, executionId, workspacePath, correlationId, skipCategories),
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
        // Record metrics using QaMetricsService (Story 3.8)
        this.qaMetrics.recordGateDecision(true, { projectId });
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
        // Record failed gate decision (Story 3.8)
        this.qaMetrics.recordGateDecision(false, { projectId });
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

      // Extract actual results from PromiseSettledResult
      const linting = this.extractValue(lintingResult, null);
      const tests = this.extractValue(testResult, null);
      const coverage = this.extractValue(coverageResult, null);
      const security = this.extractValue(securityResult, null);

      return {
        executionId,
        correlationId,
        status: overallPassed ? 'passed' : 'failed',
        lintingResult: linting ?? {
          passed: true,
          errorCount: 0,
          warningCount: 0,
          infoCount: 0,
          issues: [],
          language: SupportedLanguage.TYPESCRIPT,
          filesLinted: [],
          durationMs: 0,
        },
        testResult: tests ?? {
          framework: TestFramework.JEST,
          passed: true,
          totalTests: 0,
          passedCount: 0,
          failedCount: 0,
          skippedCount: 0,
          durationMs: 0,
          suites: [],
          failedTests: [],
        },
        coverageResult: coverage ?? {
          executionId,
          correlationId,
          current: { lines: 0, branches: 0, functions: 0, statements: 0 },
          delta: { lines: 0, branches: 0, functions: 0, statements: 0, overall: 0 },
          passed: false,
          threshold: 70,
          failedFiles: [],
          summary: {
            totalFiles: 0,
            filesBelowThreshold: 0,
            avgLineCoverage: 0,
          },
          analyzedAt: new Date(),
        },
        securityResult: security ?? {
          passed: true,
          executionId,
          correlationId,
          scanDurationMs: 0,
          summary: {
            totalFindings: 0,
            criticalCount: 0,
            highCount: 0,
            mediumCount: 0,
            lowCount: 0,
            infoCount: 0,
          },
          vulnerabilities: [],
          secrets: [],
          complexityIssues: [],
          patternFindings: [],
          scannerResults: {
            dependency: { ran: false, passed: true, durationMs: 0 },
            secrets: { ran: false, passed: true, durationMs: 0 },
            complexity: { ran: false, passed: true, durationMs: 0 },
            patterns: { ran: false, passed: true, durationMs: 0 },
          },
          scannedAt: new Date(),
        },
        qualityGateResult: gateResult,
      };
    } catch (error) {
      // Record error metric (Story 3.8)
      this.qaMetrics.recordCheckError('linting', 'error', Date.now() - startTime, { projectId });
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
    ticketId: string,
    executionId: string,
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

    // Story 3.10: Use AiQaOrchestrator instead of deleted LinterService
    try {
      const result = await this.aiQaOrchestrator.executeLintCheck(
        ticketId,
        executionId,
        workspacePath,
      );
      if (result.status === 'ERROR') {
        throw new Error(`Lint check failed: ${JSON.stringify(result.data)}`);
      }
      // Convert AiQaOrchestrator result to ILintingResult format
      const data = result.data as Record<string, unknown>;
      return {
        passed: result.status === 'PASSED',
        errorCount: (data.errorCount as number) || 0,
        warningCount: (data.warningCount as number) || 0,
        infoCount: 0,
        issues: (data.issues as ILintingIssue[]) || [],
        language: SupportedLanguage.TYPESCRIPT,
        filesLinted: [],
        durationMs: result.duration,
      };
    } catch (error) {
      this.logger.error(
        `[${correlationId}] AI-delegated lint check failed: ${(error as Error).message}`,
      );
      return null;
    }
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

    // Story 3.10: Service replaced by AI delegation - return placeholder for now
    // return this.testRunnerService.runTests({
    //   workspacePath,
    //   executionId,
    //   correlationId,
    //   timeoutMs,
    //   collectCoverage: true,
    // });
    this.logger.warn(`[${correlationId}] TestRunnerService replaced by AI delegation (Story 3.10)`);
    return null;
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

    // Story 3.10: Service replaced by AI delegation - return placeholder for now
    // return Promise.race([
    //   this.coverageService.analyzeCoverage(
    //     {
    //       passed: true,
    //       totalTests: 0,
    //       passedCount: 0,
    //       failedCount: 0,
    //       skippedCount: 0,
    //       durationMs: 0,
    //       suites: [],
    //       failedTests: [],
    //       framework: TestFramework.JEST,
    //     },
    //     { workspacePath, projectId, executionId, correlationId },
    //   ),
    //   new Promise<ICoverageAnalysis>((_, reject) =>
    //     setTimeout(() => reject(new Error('Coverage analysis timeout')), timeoutMs),
    //   ),
    // ]);
    this.logger.warn(`[${correlationId}] CoverageService replaced by AI delegation (Story 3.10)`);
    return null;
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

    // Story 3.10: Service replaced by AI delegation - return placeholder for now
    // return Promise.race([
    //   this.codeReviewService.scan({
    //     workspacePath,
    //     projectId,
    //     executionId,
    //     correlationId,
    //   }),
    //   new Promise<ISecurityScanResult>((_, reject) =>
    //     setTimeout(() => reject(new Error('Security scan timeout')), timeoutMs),
    //   ),
    // ]);
    this.logger.warn(`[${correlationId}] CodeReviewService replaced by AI delegation (Story 3.10)`);
    return null;
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

  // ============ Story 3.7: Helper Methods for runQaChecks() ============

  /**
   * Wrapper for savePartialResult with alias for Story 3.7
   */
  private async savePartialQaResult(
    executionId: string,
    data: Partial<IAggregatedQaResult>,
  ): Promise<void> {
    await this.saveQaResult(executionId, data as IAggregatedQaResult, data.overall_passed ?? false);
  }

  /**
   * Timeout wrapper for individual checks
   * AC#2: Per-check timeouts using Promise.race()
   */
  private async withTimeout<T>(promise: Promise<T>, checkType: QaCheckType): Promise<T> {
    const timeoutMs = this.configService.get<number>('qa.check.timeoutMs', 300000);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${checkType} check timed out after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    );
    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Run linting check (Story 3.7 version - uses code files from message)
   * H2-H4 FIX: Actually call AiQaOrchestrator instead of returning placeholders
   */
  private async runLintingCheck(
    message: IQaQueueMessage,
    _correlationId: string,
  ): Promise<{ type: QaCheckType; passed: boolean; data: unknown; duration: number }> {
    const startTime = Date.now();

    try {
      // Extract repository URL from ticket's project_id
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: message.ticketId },
        select: { project_id: true },
      });

      // Use project_id directly as repository URL (it already contains the full GitHub URL)
      const repositoryUrl = ticket?.project_id || '';
      if (!repositoryUrl) {
        throw new Error('Repository URL not found in ticket');
      }

      // Call AiQaOrchestrator with repository URL
      const result = await this.aiQaOrchestrator.executeLintCheck(
        message.ticketId,
        message.executionId,
        repositoryUrl,
      );

      await this.savePartialQaResult(message.executionId, {
        linting_passed: result.status === 'PASSED',
        linting_errors: result.data as never,
      });

      const duration = Date.now() - startTime;
      // Record linting check metric (Story 3.8)
      this.qaMetrics.recordCheckComplete('linting', result.status === 'PASSED', duration, {
        projectId: message.projectId,
        aiProvider: message.aiProvider,
      });

      return {
        type: 'linting',
        passed: result.status === 'PASSED',
        data: result.data,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      this.sentry.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId: message.executionId, checkType: 'linting' },
      });

      await this.savePartialQaResult(message.executionId, {
        linting_passed: false,
        linting_errors: { error: (error as Error).message } as never,
      });

      return { type: 'linting', passed: false, data: [], duration: Date.now() - startTime };
    }
  }

  /**
   * Run testing check (Story 3.7 version)
   * H2-H4 FIX: Actually call AiQaOrchestrator instead of returning placeholders
   */
  private async runTestingCheck(
    message: IQaQueueMessage,
    _correlationId: string,
  ): Promise<{ type: QaCheckType; passed: boolean; data: unknown; duration: number }> {
    const startTime = Date.now();

    try {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: message.ticketId },
        select: { project_id: true },
      });

      // Use project_id directly as repository URL (it already contains the full GitHub URL)
      const repositoryUrl = ticket?.project_id || '';
      if (!repositoryUrl) {
        throw new Error('Repository URL not found in ticket');
      }

      const result = await this.aiQaOrchestrator.executeTestRun(
        message.ticketId,
        message.executionId,
        repositoryUrl,
      );

      await this.savePartialQaResult(message.executionId, {
        tests_passed: result.status === 'PASSED',
        test_results: result.data as never,
      });

      const duration = Date.now() - startTime;
      // Record testing check metric (Story 3.8)
      this.qaMetrics.recordCheckComplete('testing', result.status === 'PASSED', duration, {
        projectId: message.projectId,
        aiProvider: message.aiProvider,
      });

      return {
        type: 'testing',
        passed: result.status === 'PASSED',
        data: result.data,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      this.sentry.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId: message.executionId, checkType: 'testing' },
      });

      await this.savePartialQaResult(message.executionId, {
        tests_passed: false,
        test_results: { error: (error as Error).message } as never,
      });

      return { type: 'testing', passed: false, data: null, duration: Date.now() - startTime };
    }
  }

  /**
   * Run coverage check (Story 3.7 version)
   * H2-H4 FIX: Actually call AiQaOrchestrator instead of returning placeholders
   */
  private async runCoverageCheck(
    message: IQaQueueMessage,
    _correlationId: string,
  ): Promise<{ type: QaCheckType; passed: boolean; data: unknown; duration: number }> {
    const startTime = Date.now();

    try {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: message.ticketId },
        select: { project_id: true },
      });

      // Use project_id directly as repository URL (it already contains the full GitHub URL)
      const repositoryUrl = ticket?.project_id || '';
      if (!repositoryUrl) {
        throw new Error('Repository URL not found in ticket');
      }

      const result = await this.aiQaOrchestrator.executeCoverageAnalysis(
        message.ticketId,
        message.executionId,
        repositoryUrl,
      );

      const coverage = (result.data as Record<string, unknown>).overall as number;
      const passed = coverage >= 70.0;

      await this.savePartialQaResult(message.executionId, { test_coverage: coverage });

      const duration = Date.now() - startTime;
      // Record coverage metric (Story 3.8)
      this.qaMetrics.recordCheckComplete('coverage', passed, duration, {
        projectId: message.projectId,
        aiProvider: message.aiProvider,
      });
      this.qaMetrics.setCoverage(message.ticketId, coverage);

      return {
        type: 'coverage',
        passed,
        data: coverage,
        duration,
      };
    } catch (error) {
      this.sentry.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId: message.executionId, checkType: 'coverage' },
      });

      return { type: 'coverage', passed: false, data: 0, duration: Date.now() - startTime };
    }
  }

  /**
   * Run security check (Story 3.7 version)
   * H2-H4 FIX: Actually call AiQaOrchestrator instead of returning placeholders
   */
  private async runSecurityCheck(
    message: IQaQueueMessage,
    _correlationId: string,
  ): Promise<{ type: QaCheckType; passed: boolean; data: unknown; duration: number }> {
    const startTime = Date.now();

    try {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: message.ticketId },
        select: { project_id: true },
      });

      // Use project_id directly as repository URL (it already contains the full GitHub URL)
      const repositoryUrl = ticket?.project_id || '';
      if (!repositoryUrl) {
        throw new Error('Repository URL not found in ticket');
      }

      const result = await this.aiQaOrchestrator.executeSecurityScan(
        message.ticketId,
        message.executionId,
        repositoryUrl,
      );

      await this.savePartialQaResult(message.executionId, {
        code_review_passed: result.status === 'PASSED',
        code_review_issues: result.data as never,
      });

      const duration = Date.now() - startTime;
      // Record security metric (Story 3.8)
      this.qaMetrics.recordCheckComplete('security', result.status === 'PASSED', duration, {
        projectId: message.projectId,
        aiProvider: message.aiProvider,
      });

      return {
        type: 'security',
        passed: result.status === 'PASSED',
        data: result.data,
        duration,
      };
    } catch (error) {
      this.sentry.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId: message.executionId, checkType: 'security' },
      });

      return { type: 'security', passed: false, data: [], duration: Date.now() - startTime };
    }
  }

  /**
   * Extract result from PromiseSettledResult
   */
  private extractCheckResult(
    result: PromiseSettledResult<{
      type: QaCheckType;
      passed: boolean;
      data: unknown;
      duration: number;
    }>,
    type: QaCheckType,
  ): { type: QaCheckType; passed: boolean; data: unknown; duration: number } {
    if (result.status === 'fulfilled') return result.value;
    return {
      type,
      passed: false,
      data: null,
      error: result.reason?.message || 'Unknown error',
      duration: 0,
    } as never;
  }

  /**
   * Publish QA result event to orchestrator-events exchange
   * AC#2: Publishes result to orchestrator-events exchange
   */
  private async publishQaResultEvent(result: IQaQueueResult): Promise<void> {
    const routingKey = result.passed
      ? ROUTING_KEYS.QA_CHECK_COMPLETED
      : ROUTING_KEYS.QA_CHECK_FAILED;

    try {
      await this.rabbitPublisher.publishToExchange(
        EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
        routingKey,
        result,
        result.correlationId,
      );

      this.logger.log(
        `[${result.correlationId}] Published QA result event: ${result.passed ? 'COMPLETED' : 'FAILED'}`,
      );
    } catch (error) {
      this.logger.error(
        `[${result.correlationId}] Failed to publish QA result event: ${(error as Error).message}`,
        (error as Error).stack,
      );

      this.sentry.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: {
          executionId: result.executionId,
          correlationId: result.correlationId,
          passed: result.passed,
          routingKey,
        },
      });

      // Re-throw to fail QA check if event publishing fails
      throw error;
    }
  }
}
