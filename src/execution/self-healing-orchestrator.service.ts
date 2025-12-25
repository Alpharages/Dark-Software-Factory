import { Injectable, Logger } from '@nestjs/common';
import {
  ProgressValidatorService,
  ValidationResult,
} from '@/ai-monitoring/progress-validator.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { ClickUpService } from '@/clickup/clickup.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import {
  MAX_FIX_ATTEMPTS,
  ISelfHealingInput,
  ISelfHealingResult,
  IErrorCounts,
  QAResult,
} from './interfaces/self-healing.interface';

/**
 * Self-Healing Orchestrator Service
 *
 * Orchestrates AI-powered self-healing workflow for QA failures:
 * 1. Extract error counts from QA results
 * 2. Trigger AI fix attempts (max 2)
 * 3. Validate progress after each attempt
 * 4. Escalate to human if max attempts reached or no progress
 *
 * Part of Story 13.3.1: Self-Healing with Progress Validation
 *
 * @module execution/self-healing-orchestrator
 */
@Injectable()
export class SelfHealingOrchestratorService {
  private readonly logger = new Logger(SelfHealingOrchestratorService.name);

  constructor(
    private readonly progressValidator: ProgressValidatorService,
    private readonly aiDecisionLogger: AIDecisionLoggerService,
    private readonly clickupService: ClickUpService,
    private readonly sentryService: SentryService,
    private readonly metricsService: MetricsService,
  ) {}

  /**
   * Attempt to fix QA failures using AI with progress validation
   *
   * @param input - Self-healing input parameters
   * @returns Result of self-healing attempt
   */
  async attemptFix(input: ISelfHealingInput): Promise<ISelfHealingResult> {
    const { executionId, ticketId, qaResult } = input;
    const startTime = new Date();
    let attempts = 0;
    let errorsBefore = this.extractErrorCounts(qaResult);

    this.logger.log('Starting self-healing workflow', {
      executionId,
      ticketId,
      initialErrors: errorsBefore.total,
      maxAttempts: MAX_FIX_ATTEMPTS,
    });

    // Log self-healing initiation
    await this.aiDecisionLogger.logDecision({
      agentName: 'Self-Healing Orchestrator',
      action: 'self_healing_initiated',
      reasoning: `Starting self-healing workflow for execution ${executionId}`,
      ticketId,
      executionId,
      inputData: {
        initialErrorCount: errorsBefore.total,
        lintErrors: errorsBefore.lintErrors,
        testFailures: errorsBefore.testFailures,
        maxAttempts: MAX_FIX_ATTEMPTS,
      },
      outputData: {},
      confidence: 0.8,
    });

    // Fix attempt loop (max 2 attempts)
    while (attempts < MAX_FIX_ATTEMPTS) {
      attempts++;

      this.logger.log(`Self-healing attempt ${attempts}/${MAX_FIX_ATTEMPTS}`, {
        executionId,
        errorsBefore: errorsBefore.total,
      });

      // 1. Trigger AI fix (placeholder - actual integration in Story 13.4)
      // TODO: Story 13.4 - Call AIExecutionService to retry with error context
      // For now, we'll simulate getting new QA results
      const newQaResult = await this.simulateFixAttempt(executionId, errorsBefore);
      const errorsAfter = this.extractErrorCounts(newQaResult);

      this.logger.log('Fix attempt completed', {
        executionId,
        attempt: attempts,
        errorsBefore: errorsBefore.total,
        errorsAfter: errorsAfter.total,
        reduction: errorsBefore.total - errorsAfter.total,
      });

      // Log fix attempt
      await this.aiDecisionLogger.logDecision({
        agentName: 'Self-Healing Orchestrator',
        action: 'self_healing_attempt',
        reasoning: `Fix attempt #${attempts} complete`,
        ticketId,
        executionId,
        inputData: {
          attemptNumber: attempts,
          errorsBefore: errorsBefore.total,
        },
        outputData: {
          errorsAfter: errorsAfter.total,
          errorReduction: errorsBefore.total - errorsAfter.total,
        },
        confidence: 0.7,
      });

      // 2. Validate progress
      let validation: ValidationResult;
      try {
        validation = await this.progressValidator.validateProgress({
          executionId,
          ticketId,
          errorsBefore: errorsBefore.total,
          errorsAfter: errorsAfter.total,
          attemptNumber: attempts,
          startTime,
        });
      } catch (error) {
        this.logger.error('Progress validation failed', {
          executionId,
          error: (error as Error).message,
        });

        this.sentryService.captureException(error as Error, {
          tags: { operation: 'self_healing_progress_validation' },
          extra: {
            executionId,
            ticketId,
            errorsBefore: errorsBefore.total,
            errorsAfter: errorsAfter.total,
          },
        });

        // Escalate as a safety measure when validation fails
        return await this.escalateToHuman(
          ticketId,
          executionId,
          errorsAfter,
          `Progress validation error: ${(error as Error).message}`,
          attempts,
        );
      }

      this.logger.log('Progress validation result', {
        executionId,
        shouldContinue: validation.shouldContinue,
        escalate: validation.escalate,
        reason: validation.reason,
      });

      // 3. Log validation decision
      await this.aiDecisionLogger.logDecision({
        agentName: 'Self-Healing Orchestrator',
        action: 'progress_validation',
        reasoning: validation.reason,
        ticketId,
        executionId,
        inputData: {
          errorsBefore: errorsBefore.total,
          errorsAfter: errorsAfter.total,
          attemptNumber: attempts,
        },
        outputData: {
          shouldContinue: validation.shouldContinue,
          escalate: validation.escalate,
          metrics: validation.metrics,
        },
        confidence: validation.confidence,
      });

      // 4. Check if we should escalate
      if (validation.escalate || !validation.shouldContinue) {
        this.logger.warn('Validation requires escalation', {
          executionId,
          reason: validation.reason,
          attempts,
        });

        return await this.escalateToHuman(
          ticketId,
          executionId,
          errorsAfter,
          validation.reason,
          attempts,
          input,
        );
      }

      // 5. Check if all errors fixed (success)
      if (errorsAfter.total === 0) {
        this.logger.log('Self-healing succeeded - all errors fixed', {
          executionId,
          attempts,
        });

        // Record success metrics
        this.metricsService.incrementCounter('ai_self_healing_attempts_total', {
          ticket_id: ticketId,
          outcome: 'success',
        });

        this.metricsService.setGauge('ai_self_healing_progress', 100, {
          ticket_id: ticketId,
        });

        return {
          success: true,
          outcome: 'SUCCESS',
          attemptsMade: attempts,
          finalErrorCount: 0,
        };
      }

      // Update errorsBefore for next iteration
      errorsBefore = errorsAfter;
    }

    // Max attempts reached without success
    this.logger.warn('Max fix attempts reached', {
      executionId,
      attempts,
      finalErrors: errorsBefore.total,
    });

    return await this.escalateToHuman(
      ticketId,
      executionId,
      errorsBefore,
      `Max fix attempts (${MAX_FIX_ATTEMPTS}) reached without resolving all errors`,
      attempts,
      input,
    );
  }

  /**
   * Extract error counts from QA result
   *
   * @param qaResult - QA result from database
   * @returns Structured error counts
   */
  private extractErrorCounts(qaResult: QAResult): IErrorCounts {
    // linting_errors is stored as JSON array in Prisma
    let lintErrors = 0;
    if (qaResult.linting_errors) {
      if (Array.isArray(qaResult.linting_errors)) {
        lintErrors = qaResult.linting_errors.length;
      } else if (typeof qaResult.linting_errors === 'object') {
        // Handle potential JSON object
        const errorsArray = (qaResult.linting_errors as { errors?: unknown[] }).errors;
        lintErrors = Array.isArray(errorsArray) ? errorsArray.length : 0;
      }
    }

    // test_results is stored as JSON object with 'failed' count
    let testFailures = 0;
    if (qaResult.test_results && typeof qaResult.test_results === 'object') {
      const results = qaResult.test_results as { failed?: number };
      testFailures = results.failed || 0;
    }

    return {
      lintErrors,
      testFailures,
      total: lintErrors + testFailures,
    };
  }

  /**
   * Escalate to human via ClickUp comment and mark execution as failed
   *
   * @param ticketId - ClickUp ticket ID
   * @param executionId - Execution ID
   * @param errorCounts - Final error counts
   * @param reason - Escalation reason
   * @param attempts - Number of attempts made
   * @param input - Self-healing input with context
   * @returns Self-healing result with escalation details
   */
  private async escalateToHuman(
    ticketId: string,
    executionId: string,
    errorCounts: IErrorCounts,
    reason: string,
    attempts: number,
    input?: ISelfHealingInput,
  ): Promise<ISelfHealingResult> {
    // Calculate progress percentage for metrics
    const initialErrorCount = input?.previousErrorCount || errorCounts.total;
    const progressPercent =
      initialErrorCount > 0
        ? Math.round(((initialErrorCount - errorCounts.total) / initialErrorCount) * 100)
        : 0;

    // Format markdown comment for ClickUp
    const markdown = `
## 🚨 Self-Healing Escalation

**Reason**: ${reason}

**Fix Attempts Made**: ${attempts}/${MAX_FIX_ATTEMPTS}

**Current Errors**:
- Lint Errors: ${errorCounts.lintErrors}
- Test Failures: ${errorCounts.testFailures}
- **Total**: ${errorCounts.total}

**AI Decision Log**: See \`ai_decision_logs\` table for execution details (Execution ID: \`${executionId}\`)

**Action Required**: Manual review and fix needed.
    `.trim();

    // Add ClickUp comment
    try {
      await this.clickupService.addComment(ticketId, markdown, {
        correlationId: executionId,
      });

      this.logger.log('ClickUp escalation comment added', {
        ticketId,
        executionId,
      });
    } catch (error) {
      this.logger.error('Failed to add ClickUp escalation comment', {
        ticketId,
        executionId,
        error: (error as Error).message,
      });

      this.sentryService.captureException(error as Error, {
        tags: { operation: 'self_healing_escalation' },
        extra: { ticketId, executionId, errorCounts },
      });
    }

    // Log escalation decision
    await this.aiDecisionLogger.logDecision({
      agentName: 'Self-Healing Orchestrator',
      action: 'escalation_triggered',
      reasoning: reason,
      ticketId,
      executionId,
      inputData: {
        attemptsMade: attempts,
        maxAttempts: MAX_FIX_ATTEMPTS,
      },
      outputData: {
        errorCounts,
        escalationReason: reason,
      },
      confidence: 0.95, // High confidence in escalation decision
    });

    // Record escalation metrics
    const outcome = attempts >= MAX_FIX_ATTEMPTS ? 'max_attempts' : 'escalated';

    this.metricsService.incrementCounter('ai_self_healing_attempts_total', {
      ticket_id: ticketId,
      outcome,
    });

    this.metricsService.setGauge('ai_self_healing_progress', progressPercent, {
      ticket_id: ticketId,
    });

    return {
      success: false,
      outcome: attempts >= MAX_FIX_ATTEMPTS ? 'MAX_ATTEMPTS' : 'ESCALATED',
      attemptsMade: attempts,
      finalErrorCount: errorCounts.total,
      escalationReason: reason,
    };
  }

  /**
   * Simulate fix attempt (placeholder for Story 13.4 integration)
   * TODO: Replace with actual AIExecutionService retry call
   *
   * @param executionId - Execution ID
   * @param errorCounts - Current error counts
   * @returns Simulated QA result
   */
  private async simulateFixAttempt(
    executionId: string,
    errorCounts: IErrorCounts,
  ): Promise<QAResult> {
    this.logger.warn('Using simulated fix attempt - Story 13.4 will integrate real AI execution', {
      executionId,
    });

    // Simulate reduced errors (for testing)
    const newLintErrors = Math.max(0, errorCounts.lintErrors - 1);
    const newTestFailures = Math.max(0, errorCounts.testFailures - 1);

    return {
      id: 'simulated-qa-result',
      execution_id: executionId,
      linting_passed: newLintErrors === 0,
      linting_errors: Array.from({ length: newLintErrors }, (_, i) => ({
        file: `file${i}.ts`,
        line: i + 1,
        rule: 'simulated-rule',
        message: 'Simulated error',
      })),
      tests_passed: newTestFailures === 0,
      test_results: {
        passed: 10,
        failed: newTestFailures,
        skipped: 0,
        total: 10 + newTestFailures,
      },
      overall_passed: newLintErrors + newTestFailures === 0,
      created_at: new Date(),
      updated_at: new Date(),
    };
  }
}
