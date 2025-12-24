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
import { SentryService } from '@/common/sentry/sentry.service';
import { ErrorCategory } from '@/common/sentry/sentry.constants';
import { OrchestratorService } from '@/ai-routing/orchestrator.service';
import { QaMetricsService } from './qa-metrics.service';
import { PrismaService } from '@/database/prisma.service';
import { renderLintInstruction } from './templates/lint-instruction.template';
import { renderTestInstruction } from './templates/test-instruction.template';
import { renderSecurityInstruction } from './templates/security-instruction.template';
import { renderCoverageInstruction } from './templates/coverage-instruction.template';

/**
 * QA Result interface (simplified from Story 3.6)
 */
export interface IQaResult {
  executionId: string;
  checkType: 'linting' | 'testing' | 'security' | 'coverage';
  status: 'PASSED' | 'FAILED' | 'ERROR' | 'NOT_CONFIGURED';
  data: unknown;
  duration: number;
  aiProvider?: string;
}

@Injectable()
export class AiQaOrchestrator {
  private readonly logger = new Logger(AiQaOrchestrator.name);

  constructor(
    private readonly orchestratorService: OrchestratorService, // Story 2.8
    private readonly qaMetrics: QaMetricsService, // Story 3.8
    private readonly sentry: SentryService, // Story 1.9
    private readonly prisma: PrismaService, // Database access
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
      // NOT_CONFIGURED is treated as successful (tool not found, but not an error)
      const status = (parsedResult.status as string) || 'UNKNOWN';
      const isPassed = status === 'PASSED' || status === 'NOT_CONFIGURED';
      this.qaMetrics.recordCheckComplete(checkType, isPassed, duration, {
        projectId: ticketId,
        aiProvider,
      });

      // 5. Execute any additional post-metrics logic (e.g., coverage-specific metrics)
      if (postMetricsCallback) {
        postMetricsCallback(parsedResult);
      }

      // Log NOT_CONFIGURED as info, not a failure
      if (status === 'NOT_CONFIGURED') {
        this.logger.log(
          `[${ticketId}] ${checkType} check skipped: tooling not configured. ${parsedResult.summary || ''}`,
        );
      } else {
        this.logger.log(`[${ticketId}] ${checkType} check complete: ${status} in ${duration}ms`);
      }

      return {
        executionId,
        checkType,
        status:
          (parsedResult.status as 'PASSED' | 'FAILED' | 'ERROR' | 'NOT_CONFIGURED') || 'ERROR',
        data: parsedResult,
        duration,
        aiProvider,
      };
    } catch (error) {
      return this.handleCheckError(ticketId, checkType, error as Error, startTime);
    }
  }

  /**
   * Parse JSON response from AI
   * AC#6: Handle invalid JSON with retry logic
   */
  private parseJSONResponse(output: string, checkType: string): Record<string, unknown> {
    try {
      // Remove markdown code blocks if present
      const cleanOutput = output
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      return JSON.parse(cleanOutput);
    } catch (_error) {
      this.logger.warn(`Failed to parse JSON for ${checkType}: ${output.substring(0, 100)}...`);
      throw new Error(`Invalid JSON response from AI for ${checkType} check`);
    }
  }

  /**
   * Execute AI task with automatic retry on invalid JSON (AC#6)
   * @returns Parsed JSON result or throws after retry exhausted
   */
  private async executeWithRetry(
    ticketId: string,
    executionId: string,
    instruction: string,
    projectDir: string,
    checkType: string,
    allowFallback: boolean,
  ): Promise<{ result: Record<string, unknown>; aiProvider: string }> {
    let lastError: Error | null = null;

    // Attempt 1: Normal execution
    try {
      const aiResponse = await this.orchestratorService.execute({
        ticketId,
        correlationId: ticketId,
        executionId,
        prompt: instruction,
        repositoryUrl: projectDir,
        allowFallback,
      });

      if (!aiResponse.success) {
        throw new Error(aiResponse.error?.message || 'AI execution failed');
      }

      const parsedResult = this.parseJSONResponse(aiResponse.codeDiff || '{}', checkType);
      return { result: parsedResult, aiProvider: aiResponse.executedBy };
    } catch (error) {
      lastError = error as Error;

      // Only retry on JSON parse errors, not on AI execution failures
      if (!lastError.message.includes('Invalid JSON response')) {
        throw lastError;
      }

      this.logger.warn(`[${ticketId}] Retry attempt for ${checkType} with clarified instructions`);
    }

    // Attempt 2: Retry with clearer prompt emphasizing JSON-only output
    const retryInstruction = `${instruction}\n\n⚠️ CRITICAL REMINDER: Your previous response was not valid JSON. Return ONLY the JSON object with NO additional text, explanations, or markdown formatting.`;

    const aiResponse = await this.orchestratorService.execute({
      ticketId,
      correlationId: `${ticketId}-retry`,
      executionId,
      prompt: retryInstruction,
      repositoryUrl: projectDir,
      allowFallback,
    });

    if (!aiResponse.success) {
      throw new Error(aiResponse.error?.message || 'AI execution failed on retry');
    }

    const parsedResult = this.parseJSONResponse(aiResponse.codeDiff || '{}', checkType);
    return { result: parsedResult, aiProvider: aiResponse.executedBy };
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
    } catch (error) {
      // H6 FIX: Proper error handling - alert Sentry, record metric, and re-throw
      const err = error as Error;
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

    return {
      executionId: ticketId,
      checkType: checkType as 'linting' | 'testing' | 'security' | 'coverage',
      status: 'ERROR',
      data: { error: error.message },
      duration,
    };
  }
}
