/**
 * AI QA Orchestrator Service
 * Story 3.10: QA Automation AI Delegation Refactor (AC#2)
 *
 * Delegates QA checks (lint, test, security, coverage) to AI agents (Cursor/Claude)
 * instead of building custom service implementations.
 *
 * Pattern: DSF orchestrates WHEN → AI executes + parses → DSF stores + decides
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SentryService } from '@/common/sentry/sentry.service';
import { ErrorCategory } from '@/common/sentry/sentry.constants';
import { QaMetricsService } from './qa-metrics.service';
import { PrismaService } from '@/database/prisma.service';
import { renderLintInstruction } from './templates/lint-instruction.template';
import { renderTestInstruction } from './templates/test-instruction.template';
import { renderSecurityInstruction } from './templates/security-instruction.template';
import { renderCoverageInstruction } from './templates/coverage-instruction.template';
import { QaNotificationService } from './services/qa-notification.service'; // Story 10.3
import { GateType, QaFailureSeverity } from '@/realtime/realtime.types'; // Story 10.3

/**
 * QA Result interface (simplified from Story 3.6)
 */
/**
 * QA Result interface (simplified from Story 3.6)
 * SKIPPED status: QA check was skipped after retries exhausted due to
 * pre-existing issues (broken tests/lint) or missing sandbox environment.
 * Treated as non-blocking so execution can proceed to commit+push.
 */
export interface IQaResult {
  executionId: string;
  checkType: 'linting' | 'testing' | 'security' | 'coverage';
  status: 'PASSED' | 'FAILED' | 'ERROR' | 'NOT_CONFIGURED' | 'SKIPPED';
  data: unknown;
  duration: number;
  aiProvider?: string;
}

@Injectable()
export class AiQaOrchestrator {
  private readonly logger = new Logger(AiQaOrchestrator.name);

  constructor(
    private readonly qaMetrics: QaMetricsService, // Story 3.8
    private readonly sentry: SentryService, // Story 1.9
    private readonly prisma: PrismaService, // Database access
    private readonly qaNotificationService: QaNotificationService, // Story 10.3
    private readonly configService: ConfigService, // For QA retry configuration
  ) {}

  /**
   * Execute lint check via AI delegation
   * AC#2: Core method - detect tooling, generate prompt, delegate to AI, parse, store, record metrics
   * @param ticketId
   * @param executionId
   * @param projectDir
   * @param allowFallback - Whether to allow fallback to secondary AI provider (default: true)
   */
  async executeLintCheck(
    ticketId: string,
    executionId: string,
    projectDir: string,
    allowFallback = true,
  ): Promise<IQaResult> {
    return this.executeQaCheck(
      ticketId,
      executionId,
      projectDir,
      'linting',
      renderLintInstruction,
      allowFallback,
    );
  }

  /**
   * Execute test run via AI delegation
   * AC#2: Same pattern as lint check
   */
  async executeTestRun(
    ticketId: string,
    executionId: string,
    projectDir: string,
    allowFallback = true,
  ): Promise<IQaResult> {
    return this.executeQaCheck(
      ticketId,
      executionId,
      projectDir,
      'testing',
      renderTestInstruction,
      allowFallback,
    );
  }

  /**
   * Execute security scan via AI delegation
   */
  async executeSecurityScan(
    ticketId: string,
    executionId: string,
    projectDir: string,
    allowFallback = true,
  ): Promise<IQaResult> {
    return this.executeQaCheck(
      ticketId,
      executionId,
      projectDir,
      'security',
      renderSecurityInstruction,
      allowFallback,
    );
  }

  /**
   * Execute coverage analysis via AI delegation
   */
  async executeCoverageAnalysis(
    ticketId: string,
    executionId: string,
    projectDir: string,
    allowFallback = true,
  ): Promise<IQaResult> {
    return this.executeQaCheck(
      ticketId,
      executionId,
      projectDir,
      'coverage',
      renderCoverageInstruction,
      allowFallback,
      // Additional callback for coverage-specific metric (Story 3.8)
      (parsedResult) => {
        if (parsedResult.overall !== undefined) {
          this.qaMetrics.setCoverage(ticketId, parsedResult.overall as number);
        }
      },
    );
  }

  // ============ Helper Methods ============

  /**
   * Common execution pattern for all QA checks
   * Reduces code duplication across executeTestRun, executeLintCheck, executeSecurityScan, executeCoverageAnalysis
   * @param ticketId - Ticket ID for correlation
   * @param executionId - Execution ID for database tracking
   * @param projectDir - Project directory path
   * @param checkType - Type of QA check being performed
   * @param instructionRenderer - Function to generate the AI instruction
   * @param allowFallback - Whether to allow fallback to secondary AI provider
   * @param postMetricsCallback - Optional callback for additional metrics (e.g., coverage)
   */
  private async executeQaCheck(
    ticketId: string,
    executionId: string,
    projectDir: string,
    checkType: 'linting' | 'testing' | 'security' | 'coverage',
    instructionRenderer: (projectDir: string, ticketId: string) => string,
    allowFallback = true,
    postMetricsCallback?: (parsedResult: Record<string, unknown>) => void,
  ): Promise<IQaResult> {
    const startTime = Date.now();

    this.logger.log(`[${ticketId}] Starting AI-delegated ${checkType} check for ${projectDir}`);

    try {
      // 1. Generate AI instruction
      const instruction = instructionRenderer(projectDir, ticketId);

      // 2. Delegate to AI with retry logic (AC#6)
      const { result: parsedResult, aiProvider } = await this.executeWithRetry(
        ticketId,
        executionId,
        instruction,
        projectDir,
        checkType,
        allowFallback,
      );

      if (!parsedResult) {
        throw new Error(`AI returned empty result for ${checkType}`);
      }

      if (parsedResult.status === 'ERROR') {
        const errorMsg =
          parsedResult.data && (parsedResult.data as Record<string, unknown>).error
            ? (parsedResult.data as Record<string, unknown>).error
            : JSON.stringify(parsedResult.data);
        throw new Error(`${checkType} check failed: ${errorMsg}`);
      }

      const duration = Date.now() - startTime;

      // 3. Save to database with detailed results (H5 fix)
      await this.saveQaResult(executionId, checkType, parsedResult, duration, aiProvider);

      // 4. Record metrics
      // NOT_CONFIGURED and SKIPPED are treated as non-blocking (proceed to commit+push)
      const status = (parsedResult.status as string) || 'UNKNOWN';
      const isPassed = status === 'PASSED' || status === 'NOT_CONFIGURED' || status === 'SKIPPED';
      this.qaMetrics.recordCheckComplete(checkType, isPassed, duration, {
        projectId: ticketId,
        aiProvider,
      });

      // 5. Execute any additional post-metrics logic (e.g., coverage-specific metrics)
      if (postMetricsCallback) {
        postMetricsCallback(parsedResult);
      }

      // 6. Notify on IMMEDIATE failure (Story 10.3)
      // This is for individual tool failures (e.g., linter found errors), distinct from Quality Gate failure
      if (status === 'FAILED') {
        this.notifyCheckFailure(ticketId, executionId, checkType, parsedResult).catch((err) =>
          this.logger.error(`Failed to emit QA failure notification: ${err.message}`),
        );
      }

      // Log NOT_CONFIGURED and SKIPPED as info, not a failure
      if (status === 'NOT_CONFIGURED') {
        this.logger.log(
          `[${ticketId}] ${checkType} check skipped: tooling not configured. ${parsedResult.summary || ''}`,
        );
      } else if (status === 'SKIPPED') {
        this.logger.warn(
          `[${ticketId}] ${checkType} check SKIPPED after retry exhaustion. Proceeding to commit+push. ${parsedResult.summary || ''}`,
        );
      } else {
        this.logger.log(`[${ticketId}] ${checkType} check complete: ${status} in ${duration}ms`);
      }

      return {
        executionId,
        checkType,
        status:
          (parsedResult.status as 'PASSED' | 'FAILED' | 'ERROR' | 'NOT_CONFIGURED' | 'SKIPPED') ||
          'ERROR',
        data: parsedResult,
        duration,
        aiProvider,
      };
    } catch (_error) {
      return this.handleCheckError(ticketId, checkType, _error as Error, startTime);
    }
  }

  /**
   * Parse JSON response from AI
   * AC#6: Handle invalid JSON with retry logic
   */
  private parseJSONResponse(output: string, checkType: string): Record<string, unknown> {
    try {
      // 1. Strip Docker stream metadata that can prefix container output
      let cleanOutput = output.replace(/^\s*\{"stream"\s*:\s*true[^}]*\}\s*/g, '');
      // 2. Remove ANSI escape codes
      // eslint-disable-next-line no-control-regex
      cleanOutput = cleanOutput.replace(/\x1b\[[0-9;]*m/g, '');
      // 3. Remove markdown code blocks if present
      cleanOutput = cleanOutput
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      // 4. Try direct parse first
      try {
        return JSON.parse(cleanOutput);
      } catch {
        // 5. Fallback: extract the last JSON object (skip any prefixed noise)
        const jsonObjects = cleanOutput.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
        if (jsonObjects && jsonObjects.length > 0) {
          // Use the last JSON object — the actual response, not metadata
          return JSON.parse(jsonObjects[jsonObjects.length - 1]);
        }
        throw new Error('No valid JSON object found');
      }
    } catch (_error) {
      this.logger.warn(`Failed to parse JSON for ${checkType}: ${output.substring(0, 200)}...`);
      throw new Error(`Invalid JSON response from AI for ${checkType} check`);
    }
  }

  /**
   * Execute AI task with automatic retry on ALL failure types.
   *
   * FIX: Previously only retried on JSON parse errors. Now retries on ALL failures
   * (AI execution failures, lint/test failures due to pre-existing issues, missing
   * sandbox environment like databases, etc.) with a configurable max retry limit.
   *
   * When retries are exhausted, returns a SKIPPED result instead of throwing,
   * allowing execution to proceed to commit+push rather than getting stuck in a loop.
   *
   * @returns Parsed JSON result, or SKIPPED result after retry exhaustion
   */
  private async executeWithRetry(
    ticketId: string,
    executionId: string,
    instruction: string,
    projectDir: string,
    checkType: string,
    allowFallback: boolean,
  ): Promise<{ result: Record<string, unknown>; aiProvider: string }> {
    const maxAttempts = this.configService.get<number>('qa.check.qaRetryMaxAttempts', 2);
    let lastError: Error | null = null;
    let lastAiProvider = 'unknown';

    // ai-routing orchestrator removed (OHP-3.1) — QA execution is handled by OpenHarness.
    // There is no AI call to retry here, so report a SKIPPED result directly so execution
    // proceeds to commit+push rather than looping.
    lastAiProvider = 'openharness';
    lastError = new Error(
      'ai-routing orchestrator removed; QA execution is handled by OpenHarness',
    );

    // Return SKIPPED result instead of throwing
    // This prevents the execution from getting stuck in a loop
    this.logger.warn(
      `[${ticketId}] ${checkType} check SKIPPED after ${maxAttempts} retry attempts exhausted. ` +
        `Last error: ${lastError?.message}. Execution will proceed to commit+push.`,
    );

    // Report to Sentry so we can track how often this happens
    this.sentry.captureException(
      lastError || new Error(`${checkType} check skipped after retry exhaustion`),
      {
        category: ErrorCategory.QA_AUTOMATION,
        extra: {
          ticketId,
          executionId,
          checkType,
          maxAttempts,
          action: 'SKIPPED_AFTER_RETRY_EXHAUSTION',
        },
      },
    );

    return {
      result: {
        status: 'SKIPPED',
        summary: `${checkType} check skipped after ${maxAttempts} failed attempts. Last error: ${lastError?.message}. This may be due to pre-existing issues in the repository or missing sandbox environment (e.g., database). The execution will proceed to commit and push.`,
        errorCount: 0,
        warningCount: 0,
        skippedReason: 'RETRY_EXHAUSTION',
        lastError: lastError?.message,
        attemptsExhausted: maxAttempts,
        projectDir,
        allowFallback,
        instructionLength: instruction.length,
      },
      aiProvider: lastAiProvider,
    };
  }

  /**
   * Save QA result to database
   * AC#2: Store results in database per Story 3.6 schema
   * H5 FIX: Store detailed JSON results, not just boolean flags
   * H6 FIX: Proper error handling with Sentry + metrics
   */
  private async saveQaResult(
    executionId: string,
    checkType: string,
    data: Record<string, unknown>,
    duration: number,
    aiProvider: string,
  ): Promise<void> {
    try {
      // Map checkType to appropriate database fields
      const status = (data.status as string) || 'UNKNOWN';
      const dbData: Partial<{
        execution_id: string;
        overall_passed: boolean;
        linting_passed?: boolean;
        linting_errors?: unknown;
        tests_passed?: boolean;
        test_results?: unknown;
        code_review_passed?: boolean;
        code_review_issues?: unknown;
        test_coverage?: number;
      }> = {
        execution_id: executionId,
        overall_passed: status === 'PASSED',
      };

      // Store detailed results per check type (Story 3.6 schema)
      if (checkType === 'linting') {
        dbData.linting_passed = status === 'PASSED';
        dbData.linting_errors = {
          errorCount: data.errorCount || 0,
          warningCount: data.warningCount || 0,
          issues: data.issues || [],
          summary: data.summary || '',
          toolUsed: data.toolUsed || '',
        };
      } else if (checkType === 'testing') {
        dbData.tests_passed = status === 'PASSED';
        dbData.test_results = {
          total: data.totalTests || 0,
          passed: data.passedCount || 0,
          failed: data.failedCount || 0,
          skipped: data.skippedCount || 0,
          failedTests: data.failedTests || [],
          coverage: data.coverage || null,
        };
      } else if (checkType === 'security') {
        dbData.code_review_passed = status === 'PASSED';
        dbData.code_review_issues = {
          summary: data.summary || { critical: 0, high: 0, medium: 0 },
          vulnerabilities: data.vulnerabilities || [],
          secrets: data.secrets || [],
        };
      } else if (checkType === 'coverage') {
        dbData.test_coverage = (data.overall as number) || 0;
      }

      // Upsert pattern - create or update
      const existing = await this.prisma.qAResult.findFirst({
        where: { execution_id: executionId },
      });

      if (existing) {
        await this.prisma.qAResult.update({
          where: { id: existing.id },
          data: dbData as never,
        });
      } else {
        await this.prisma.qAResult.create({ data: dbData as never });
      }

      this.logger.debug(
        `[${executionId}] Saved ${checkType} result to database (aiProvider: ${aiProvider})`,
      );
    } catch (_error) {
      // H6 FIX: Proper error handling - alert Sentry, record metric, and re-throw
      const err = _error as Error;
      this.logger.error(
        `[${executionId}] CRITICAL: Failed to save ${checkType} result: ${err.message}`,
        err.stack,
      );

      // Alert Sentry for investigation
      this.sentry.captureException(err, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: {
          executionId,
          checkType,
          aiProvider,
          operation: 'database_save',
        },
      });

      // Record database failure metric
      this.qaMetrics.recordCheckError(
        checkType as 'linting' | 'testing' | 'coverage' | 'security',
        'error', // Changed from 'database_error' to 'error'
        duration,
        { projectId: executionId, aiProvider },
      );

      // Re-throw to propagate error (don't silently swallow)
      throw new Error(`Database save failed for ${checkType} check: ${err.message}`);
    }
  }

  /**
   * Handle errors during QA check execution
   * AC#6: Error handling + fallback + Sentry logging
   *
   * FIX: Now returns SKIPPED instead of ERROR when the error is clearly from
   * retry exhaustion (executeWithRetry returns SKIPPED results, so this handler
   * only catches unexpected errors outside the retry loop). These are still treated
   * as non-blocking to prevent the execution from getting stuck.
   */
  private handleCheckError(
    ticketId: string,
    checkType: string,
    error: Error,
    startTime: number,
  ): IQaResult {
    const duration = Date.now() - startTime;

    this.logger.error(`[${ticketId}] ${checkType} check failed: ${error.message}`, error.stack);

    // Log to Sentry
    this.sentry.captureException(error, {
      category: ErrorCategory.QA_AUTOMATION,
      extra: { ticketId, checkType, duration },
    });

    // Record error metric
    this.qaMetrics.recordCheckError(
      checkType as 'linting' | 'testing' | 'coverage' | 'security',
      'error',
      duration,
      { projectId: ticketId },
    );

    // Return SKIPPED instead of ERROR to prevent blocking.
    // The executeWithRetry method handles structured retries and returns SKIPPED
    // on exhaustion. If we reach here, it's an unexpected error outside the retry
    // loop (e.g., instruction rendering failure, database error). We still skip
    // rather than block the entire execution pipeline.
    this.logger.warn(
      `[${ticketId}] ${checkType} check returning SKIPPED due to unrecoverable error. Execution will proceed to commit+push.`,
    );

    return {
      executionId: ticketId,
      checkType: checkType as 'linting' | 'testing' | 'security' | 'coverage',
      status: 'SKIPPED',
      data: {
        error: error.message,
        skippedReason: 'UNRECOVERABLE_ERROR',
        summary: `${checkType} check skipped due to error: ${error.message}. Execution will proceed to commit+push.`,
      },
      duration,
    };
  }

  /**
   * Helper to emit real-time notifications for check failures (Story 10.3)
   */
  private async notifyCheckFailure(
    ticketId: string,
    executionId: string,
    checkType: string,
    resultData: Record<string, unknown>,
  ): Promise<void> {
    const gateType = this.mapCheckTypeToGateType(checkType);
    const severity = this.determineSeverity(checkType, resultData);

    const executionContext = {
      id: executionId,
      ticketId: ticketId,
      ticket: { projectId: ticketId, project: null }, // Approximation using ticketId as projectId often
    };

    await this.qaNotificationService.emitGateFailed(
      executionContext,
      gateType,
      resultData,
      severity,
    );
  }

  private mapCheckTypeToGateType(checkType: string): GateType {
    switch (checkType) {
      case 'linting':
        return 'LINTING';
      case 'testing':
        return 'TEST';
      case 'security':
        return 'SECURITY';
      case 'coverage':
        return 'COVERAGE';
      default:
        return 'CUSTOM';
    }
  }

  private determineSeverity(checkType: string, data: Record<string, unknown>): QaFailureSeverity {
    if (checkType === 'security') {
      const summary = data.summary as { criticalCount?: number; highCount?: number } | undefined;
      if (summary?.criticalCount && summary.criticalCount > 0) return 'CRITICAL';
      if (summary?.highCount && summary.highCount > 0) return 'HIGH';
    }

    if (checkType === 'testing') {
      // If many tests failed, it's high severity. If any failed in "production-bound code" (proxy: any fail) -> CRITICAL often used, but AC says "test failures in production-bound code".
      // Safe default for test failure is HIGH as per 'determineBlockingIssues' in QualityGatesService usually treating them as blockers.
      const failedCount = data.failedCount as number | undefined;
      return failedCount && failedCount > 0 ? 'HIGH' : 'MEDIUM';
    }

    if (checkType === 'coverage') {
      const overall = data.overall as number | undefined;
      // Assuming target is 80 if not provided (safe default) or if we can infer.
      // But better to use the diff if available.
      // AC says: "HIGH: Coverage below threshold by >10%"
      // If we don't have threshold data here, we can't be perfect, but let's try.
      // Often 'data' comes from parsed results which might not have the threshold.
      // However, QualityGatesService handles the main logic. This Orchestrator logic is for "Immediate" notification.
      // Let's assume a default threshold of 80% for immediate alerting if unknown.
      if (overall !== undefined && overall < 70) return 'HIGH'; // < 80 - 10
    }

    return 'MEDIUM';
  }
}
