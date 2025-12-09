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
import { SentryService } from '../common/sentry/sentry.service';
import { ErrorCategory } from '../common/sentry/sentry.constants';
import { OrchestratorService } from '../ai-routing/orchestrator.service';
import { QaMetricsService } from './qa-metrics.service';
import { PrismaService } from '../database/prisma.service';
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
  status: 'PASSED' | 'FAILED' | 'ERROR';
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
   * @param allowFallback - Whether to allow fallback to secondary AI provider (default: true)
   */
  async executeLintCheck(
    ticketId: string,
    projectDir: string,
    allowFallback = true,
  ): Promise<IQaResult> {
    const startTime = Date.now();
    const checkType = 'linting';

    this.logger.log(`[${ticketId}] Starting AI-delegated lint check for ${projectDir}`);

    try {
      // 1. Generate AI instruction
      const instruction = renderLintInstruction(projectDir, ticketId);

      // 2. Delegate to AI with retry logic (AC#6)
      const { result: parsedResult, aiProvider } = await this.executeWithRetry(
        ticketId,
        instruction,
        projectDir,
        checkType,
        allowFallback,
      );

      const duration = Date.now() - startTime;

      // 3. Save to database with detailed results (H5 fix)
      await this.saveQaResult(ticketId, checkType, parsedResult, duration, aiProvider);

      // 4. Record metrics
      this.qaMetrics.recordCheckComplete(checkType, parsedResult.status === 'PASSED', duration, {
        projectId: ticketId,
        aiProvider,
      });

      this.logger.log(`[${ticketId}] Lint check complete: ${parsedResult.status} in ${duration}ms`);

      return {
        executionId: ticketId,
        checkType,
        status: parsedResult.status as 'PASSED' | 'FAILED' | 'ERROR',
        data: parsedResult,
        duration,
        aiProvider,
      };
    } catch (error) {
      return this.handleCheckError(ticketId, checkType, error as Error, startTime);
    }
  }

  /**
   * Execute test run via AI delegation
   * AC#2: Same pattern as lint check
   */
  async executeTestRun(
    ticketId: string,
    projectDir: string,
    allowFallback = true,
  ): Promise<IQaResult> {
    const startTime = Date.now();
    const checkType = 'testing';

    this.logger.log(`[${ticketId}] Starting AI-delegated test run for ${projectDir}`);

    try {
      const instruction = renderTestInstruction(projectDir, ticketId);

      const { result: parsedResult, aiProvider } = await this.executeWithRetry(
        ticketId,
        instruction,
        projectDir,
        checkType,
        allowFallback,
      );

      const duration = Date.now() - startTime;

      await this.saveQaResult(ticketId, checkType, parsedResult, duration, aiProvider);

      this.qaMetrics.recordCheckComplete(checkType, parsedResult.status === 'PASSED', duration, {
        projectId: ticketId,
        aiProvider,
      });

      return {
        executionId: ticketId,
        checkType,
        status: parsedResult.status as 'PASSED' | 'FAILED' | 'ERROR',
        data: parsedResult,
        duration,
        aiProvider,
      };
    } catch (error) {
      return this.handleCheckError(ticketId, checkType, error as Error, startTime);
    }
  }

  /**
   * Execute security scan via AI delegation
   */
  async executeSecurityScan(
    ticketId: string,
    projectDir: string,
    allowFallback = true,
  ): Promise<IQaResult> {
    const startTime = Date.now();
    const checkType = 'security';

    this.logger.log(`[${ticketId}] Starting AI-delegated security scan for ${projectDir}`);

    try {
      const instruction = renderSecurityInstruction(projectDir, ticketId);

      const { result: parsedResult, aiProvider } = await this.executeWithRetry(
        ticketId,
        instruction,
        projectDir,
        checkType,
        allowFallback,
      );

      const duration = Date.now() - startTime;

      await this.saveQaResult(ticketId, checkType, parsedResult, duration, aiProvider);

      this.qaMetrics.recordCheckComplete(checkType, parsedResult.status === 'PASSED', duration, {
        projectId: ticketId,
        aiProvider,
      });

      return {
        executionId: ticketId,
        checkType,
        status: parsedResult.status as 'PASSED' | 'FAILED' | 'ERROR',
        data: parsedResult,
        duration,
        aiProvider,
      };
    } catch (error) {
      return this.handleCheckError(ticketId, checkType, error as Error, startTime);
    }
  }

  /**
   * Execute coverage analysis via AI delegation
   */
  async executeCoverageAnalysis(
    ticketId: string,
    projectDir: string,
    allowFallback = true,
  ): Promise<IQaResult> {
    const startTime = Date.now();
    const checkType = 'coverage';

    this.logger.log(`[${ticketId}] Starting AI-delegated coverage analysis for ${projectDir}`);

    try {
      const instruction = renderCoverageInstruction(projectDir, ticketId);

      const { result: parsedResult, aiProvider } = await this.executeWithRetry(
        ticketId,
        instruction,
        projectDir,
        checkType,
        allowFallback,
      );

      const duration = Date.now() - startTime;

      await this.saveQaResult(ticketId, checkType, parsedResult, duration, aiProvider);

      this.qaMetrics.recordCheckComplete(checkType, parsedResult.status === 'PREFIX', duration, {
        projectId: ticketId,
        aiProvider,
      });

      // Also set coverage metric (Story 3.8)
      if (parsedResult.overall !== undefined) {
        this.qaMetrics.setCoverage(ticketId, parsedResult.overall as number);
      }

      return {
        executionId: ticketId,
        checkType,
        status: parsedResult.status as 'PASSED' | 'FAILED' | 'ERROR',
        data: parsedResult,
        duration,
        aiProvider,
      };
    } catch (error) {
      return this.handleCheckError(ticketId, checkType, error as Error, startTime);
    }
  }

  // ============ Helper Methods ============

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
        executionId: ticketId,
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
      executionId: ticketId,
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
    ticketId: string,
    checkType: string,
    data: Record<string, unknown>,
    duration: number,
    aiProvider: string,
  ): Promise<void> {
    try {
      // Map checkType to appropriate database fields
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
        execution_id: ticketId,
        overall_passed: data.status === 'PASSED',
      };

      // Store detailed results per check type (Story 3.6 schema)
      if (checkType === 'linting') {
        dbData.linting_passed = data.status === 'PASSED';
        dbData.linting_errors = {
          errorCount: data.errorCount || 0,
          warningCount: data.warningCount || 0,
          issues: data.issues || [],
          summary: data.summary || '',
          toolUsed: data.toolUsed || '',
        };
      } else if (checkType === 'testing') {
        dbData.tests_passed = data.status === 'PASSED';
        dbData.test_results = {
          total: data.totalTests || 0,
          passed: data.passedCount || 0,
          failed: data.failedCount || 0,
          skipped: data.skippedCount || 0,
          failedTests: data.failedTests || [],
          coverage: data.coverage || null,
        };
      } else if (checkType === 'security') {
        dbData.code_review_passed = data.status === 'PASSED';
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
        where: { execution_id: ticketId },
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
        `[${ticketId}] Saved ${checkType} result to database (aiProvider: ${aiProvider})`,
      );
    } catch (error) {
      // H6 FIX: Proper error handling - alert Sentry, record metric, and re-throw
      const err = error as Error;
      this.logger.error(
        `[${ticketId}] CRITICAL: Failed to save ${checkType} result: ${err.message}`,
        err.stack,
      );

      // Alert Sentry for investigation
      this.sentry.captureException(err, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: {
          ticketId,
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
        { projectId: ticketId, aiProvider },
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
