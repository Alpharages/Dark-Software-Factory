import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PrismaService } from '../database/prisma.service';
import { SentryService } from '../common/sentry/sentry.service';
import { ErrorCategory } from '../common/sentry/sentry.constants';
import { QA_METRICS } from '../common/metrics/metrics.constants';
import { DockerExecutorService } from './docker-executor.service';
import { TestOutputParser } from './parsers/test-output.parser';
import {
  ITestResult,
  ITestRunOptions,
  TestFramework,
  TestStatus,
  TEST_FRAMEWORK_CONFIG,
} from './interfaces';

@Injectable()
export class TestRunnerService {
  private readonly logger = new Logger(TestRunnerService.name);
  private readonly defaultTimeoutMs: number;
  private readonly parser = new TestOutputParser();
  private testsInProgress = new Map<string, boolean>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly sentry: SentryService,
    private readonly dockerExecutor: DockerExecutorService,
    @InjectMetric(QA_METRICS.TEST_EXECUTIONS_TOTAL)
    private readonly testExecutionsCounter: Counter<string>,
    @InjectMetric(QA_METRICS.TEST_DURATION) private readonly testDuration: Histogram<string>,
    @InjectMetric(QA_METRICS.TEST_PASSED_TOTAL) private readonly testPassedCounter: Counter<string>,
    @InjectMetric(QA_METRICS.TEST_FAILED_TOTAL) private readonly testFailedCounter: Counter<string>,
  ) {
    this.defaultTimeoutMs = this.configService.get<number>('qa.testTimeoutMs', 300000);
  }

  /**
   * Main entry point - run tests in workspace
   */
  async runTests(options: ITestRunOptions): Promise<ITestResult> {
    const {
      workspacePath,
      executionId,
      correlationId,
      timeoutMs = this.defaultTimeoutMs,
    } = options;

    // Prevent concurrent test runs on same workspace
    if (this.testsInProgress.has(workspacePath)) {
      throw new Error(`Tests already in progress for ${workspacePath}`);
    }
    this.testsInProgress.set(workspacePath, true);

    let framework = options.framework;
    let endTimer: (() => void) | undefined;

    try {
      if (!framework) {
        framework = await this.detectFramework(workspacePath);
      }

      endTimer = this.testDuration.startTimer({ framework });
      this.logger.log(`[${correlationId}] Starting ${framework} test execution for ${executionId}`);

      // Check Docker availability
      const dockerAvailable = await this.dockerExecutor.isDockerAvailable();
      if (!dockerAvailable) {
        throw new Error('Docker is required for test execution but is not available');
      }

      if (framework === TestFramework.UNKNOWN) {
        this.logger.warn(`[${correlationId}] No test framework detected in ${workspacePath}`);
        return this.createSkippedResult(framework);
      }

      const config = TEST_FRAMEWORK_CONFIG[framework];

      await this.dockerExecutor.ensureImage(config.dockerImage);

      // Install dependencies and run tests
      const installCmd =
        framework === TestFramework.GO_TEST
          ? ''
          : framework === TestFramework.PYTEST
            ? 'pip install -q pytest pytest-json-report pytest-cov && '
            : 'npm ci --silent && ';

      const fullCommand = `${installCmd}${config.command}`;

      const result = await this.dockerExecutor.executeInContainer({
        image: config.dockerImage,
        workspacePath,
        command: fullCommand,
        timeoutMs,
        correlationId,
      });

      if (result.timedOut) {
        this.testExecutionsCounter.inc({ framework, result: 'timeout' });
        return this.createTimeoutResult(framework, timeoutMs);
      }

      // Read test results file (written by test framework)
      let testOutput: string;
      try {
        testOutput = await fs.readFile(path.join(workspacePath, 'test-results.json'), 'utf-8');
      } catch {
        testOutput = result.stdout;
      }

      const testResult = this.parser.parse(testOutput, framework);

      // Track metrics
      this.testExecutionsCounter.inc({
        framework,
        result: testResult.passed ? 'passed' : 'failed',
      });
      this.testPassedCounter.inc({ framework }, testResult.passedCount);
      this.testFailedCounter.inc({ framework }, testResult.failedCount);

      this.logger.log(
        `[${correlationId}] ${framework} tests completed: ${testResult.passedCount}/${testResult.totalTests} passed ` +
          `(${testResult.failedCount} failed, ${testResult.skippedCount} skipped)`,
      );

      return testResult;
    } catch (error) {
      const fw = framework || TestFramework.UNKNOWN;
      this.testExecutionsCounter.inc({ framework: fw, result: 'error' });
      this.sentry.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { framework: fw, workspacePath, executionId, correlationId },
      });
      throw error;
    } finally {
      this.testsInProgress.delete(workspacePath);
      if (endTimer) endTimer();
    }
  }

  /**
   * Detect test framework from project configuration files
   */
  async detectFramework(workspacePath: string): Promise<TestFramework> {
    // Check package.json for JS/TS projects
    try {
      const packageJsonPath = path.join(workspacePath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      if (allDeps.vitest) return TestFramework.VITEST;
      if (allDeps.jest) return TestFramework.JEST;
      if (allDeps.mocha) return TestFramework.MOCHA;
    } catch {
      // Not a Node.js project
    }

    // Check for Python project
    try {
      await fs.access(path.join(workspacePath, 'pytest.ini'));
      return TestFramework.PYTEST;
    } catch {
      // No pytest.ini
    }

    try {
      const pyprojectPath = path.join(workspacePath, 'pyproject.toml');
      const content = await fs.readFile(pyprojectPath, 'utf-8');
      if (content.includes('pytest') || content.includes('[tool.pytest')) {
        return TestFramework.PYTEST;
      }
    } catch {
      // No pyproject.toml
    }

    // Check for Go project
    try {
      await fs.access(path.join(workspacePath, 'go.mod'));
      return TestFramework.GO_TEST;
    } catch {
      // No go.mod
    }

    return TestFramework.UNKNOWN;
  }

  /**
   * Save test result to database, update ticket status, and log audit entry
   */
  async saveTestResult(
    executionId: string,
    result: ITestResult,
    correlationId: string,
  ): Promise<void> {
    // 1. Save to qa_results
    const existing = await this.prisma.qAResult.findFirst({
      where: { execution_id: executionId },
    });

    const testResults = {
      framework: result.framework,
      totalTests: result.totalTests,
      passedCount: result.passedCount,
      failedCount: result.failedCount,
      skippedCount: result.skippedCount,
      durationMs: result.durationMs,
      failedTests: result.failedTests.map((t) => ({
        name: t.name,
        suiteName: t.suiteName,
        errorMessage: t.errorMessage,
        stackTrace: t.stackTrace?.substring(0, 2000),
        filePath: t.filePath,
      })),
      coverage: result.coverage,
    };

    if (existing) {
      await this.prisma.qAResult.update({
        where: { id: existing.id },
        data: {
          tests_passed: result.passed,
          test_results: testResults,
          test_coverage: result.coverage?.lines,
        },
      });
    } else {
      await this.prisma.qAResult.create({
        data: {
          execution_id: executionId,
          linting_passed: true,
          tests_passed: result.passed,
          test_results: testResults,
          test_coverage: result.coverage?.lines,
          code_review_passed: false,
          overall_passed: false,
        },
      });
    }

    // 2. Create audit log entry
    await this.prisma.auditLog.create({
      data: {
        entity_type: 'execution',
        entity_id: executionId,
        action: 'tests_executed',
        actor_type: 'system',
        after_state: {
          framework: result.framework,
          passed: result.passed,
          totalTests: result.totalTests,
          failedCount: result.failedCount,
          correlationId,
        },
      },
    });

    // 3. Update ticket status if tests failed
    if (!result.passed) {
      await this.updateTicketStatusOnFailure(executionId, result, correlationId);
    }
  }

  /**
   * Mark ticket as QA_FAILED when tests fail
   */
  private async updateTicketStatusOnFailure(
    executionId: string,
    result: ITestResult,
    correlationId: string,
  ): Promise<void> {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
    });

    if (execution) {
      await this.prisma.ticket.update({
        where: { id: execution.ticket_id },
        data: { status: 'QA_FAILED' },
      });

      const failedTestNames = result.failedTests
        .slice(0, 5)
        .map((t) => t.name)
        .join(', ');

      this.logger.warn(
        `[${correlationId}] Ticket ${execution.ticket_id} marked as QA_FAILED: ` +
          `${result.failedCount} test(s) failed - ${failedTestNames}${result.failedCount > 5 ? '...' : ''}`,
      );
    }
  }

  private createSkippedResult(framework: TestFramework): ITestResult {
    return {
      framework,
      passed: true,
      totalTests: 0,
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 0,
      suites: [],
      failedTests: [],
      rawOutput: 'No test framework detected - skipped',
    };
  }

  private createTimeoutResult(framework: TestFramework, timeoutMs: number): ITestResult {
    return {
      framework,
      passed: false,
      totalTests: 0,
      passedCount: 0,
      failedCount: 1,
      skippedCount: 0,
      durationMs: timeoutMs,
      suites: [],
      failedTests: [
        {
          name: 'Test Execution',
          suiteName: 'Timeout',
          status: TestStatus.FAILED,
          durationMs: timeoutMs,
          errorMessage: `Test execution timed out after ${timeoutMs / 1000} seconds`,
        },
      ],
      rawOutput: `TIMEOUT: Tests did not complete within ${timeoutMs}ms`,
    };
  }
}
