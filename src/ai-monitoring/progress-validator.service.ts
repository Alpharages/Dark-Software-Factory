import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { ErrorSeverity } from '@/common/sentry/sentry.constants';
import { MetricsService } from '@/common/metrics/metrics.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';

/**
 * Result of progress validation determining if AI should continue or escalate
 */
export interface ValidationResult {
  shouldContinue: boolean;
  reason: string;
  escalate: boolean;
  metrics: {
    errorsBefore: number;
    errorsAfter: number;
    errorReduction: number;
    totalTimeMs: number;
    attemptNumber: number;
    progressRate: number; // errors reduced per attempt
  };
  confidence: number; // 0-1 range for AI decision logging
}

/**
 * Metrics for tracking a single fix attempt
 */
export interface FixAttemptMetrics {
  executionId: string;
  ticketId: string;
  errorsBefore: number;
  errorsAfter: number;
  attemptNumber: number;
  totalTimeMs: number;
  outcome: 'progress' | 'escalated' | 'success';
}

@Injectable()
export class ProgressValidatorService {
  private readonly logger = new Logger(ProgressValidatorService.name);
  private readonly MAX_FIX_TIME_MS = 10 * 60 * 1000; // 10 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly sentry: SentryService,
    private readonly metrics: MetricsService,
    private readonly aiDecisionLogger: AIDecisionLoggerService,
  ) {}

  /**
   * Validate AI fix progress and determine if execution should continue or escalate
   */
  async validateProgress(params: {
    executionId: string;
    ticketId: string;
    errorsBefore: number;
    errorsAfter: number;
    attemptNumber: number;
    startTime: Date;
  }): Promise<ValidationResult> {
    const totalTimeMs = Date.now() - params.startTime.getTime();
    const errorReduction = params.errorsBefore - params.errorsAfter;
    const progressRate = errorReduction / params.attemptNumber;

    // Edge case: Validate inputs
    if (params.errorsBefore < 0 || params.errorsAfter < 0) {
      this.logger.warn('Invalid error counts detected', {
        errorsBefore: params.errorsBefore,
        errorsAfter: params.errorsAfter,
      });
      // Treat as no progress
      return this.createEscalationResult(params, 'Invalid error count data', totalTimeMs, 0, 0.8);
    }

    // Success case: All errors fixed
    if (params.errorsAfter === 0) {
      await this.logSuccessfulFix(params, totalTimeMs);
      return {
        shouldContinue: true,
        reason: 'All errors resolved successfully',
        escalate: false,
        metrics: {
          errorsBefore: params.errorsBefore,
          errorsAfter: 0,
          errorReduction,
          totalTimeMs,
          attemptNumber: params.attemptNumber,
          progressRate,
        },
        confidence: 1.0, // High confidence in success
      };
    }

    // Time limit exceeded (10 minutes)
    if (totalTimeMs > this.MAX_FIX_TIME_MS) {
      this.logger.warn('Time limit exceeded for execution', {
        executionId: params.executionId,
        totalTimeMs,
        maxTimeMs: this.MAX_FIX_TIME_MS,
      });

      await this.logEscalation(
        params,
        'Time limit exceeded (10 minutes)',
        totalTimeMs,
        errorReduction,
        0.9,
      ).catch((err) => this.logger.warn('Failed to log escalation', err));

      return this.createEscalationResult(
        params,
        `Time limit exceeded: ${Math.round(totalTimeMs / 1000 / 60)} minutes`,
        totalTimeMs,
        errorReduction,
        0.9,
      );
    }

    // Not making progress: errors increased or stayed same
    if (params.errorsAfter >= params.errorsBefore) {
      this.logger.warn('No progress detected - errors not decreasing', {
        executionId: params.executionId,
        errorsBefore: params.errorsBefore,
        errorsAfter: params.errorsAfter,
        attemptNumber: params.attemptNumber,
      });

      await this.logEscalation(
        params,
        'Not making progress - errors not decreasing',
        totalTimeMs,
        errorReduction,
        0.95,
      ).catch((err) => this.logger.warn('Failed to log escalation', err));

      return this.createEscalationResult(
        params,
        `No progress: errors ${params.errorsAfter} vs ${params.errorsBefore} before`,
        totalTimeMs,
        errorReduction,
        0.95,
      );
    }

    // Making progress - continue fixing
    this.logger.log('Progress detected - continuing AI fix', {
      executionId: params.executionId,
      errorReduction,
      errorsBefore: params.errorsBefore,
      errorsAfter: params.errorsAfter,
    });

    await this.trackFixAttempt({
      executionId: params.executionId,
      ticketId: params.ticketId,
      errorsBefore: params.errorsBefore,
      errorsAfter: params.errorsAfter,
      attemptNumber: params.attemptNumber,
      totalTimeMs,
      outcome: 'progress',
    });

    return {
      shouldContinue: true,
      reason: `Making progress: reduced errors from ${params.errorsBefore} to ${params.errorsAfter}`,
      escalate: false,
      metrics: {
        errorsBefore: params.errorsBefore,
        errorsAfter: params.errorsAfter,
        errorReduction,
        totalTimeMs,
        attemptNumber: params.attemptNumber,
        progressRate,
      },
      confidence: 0.7, // Moderate confidence - depends on continued progress
    };
  }

  /**
   * Track fix attempt metrics for analytics and monitoring
   */
  async trackFixAttempt(metrics: FixAttemptMetrics): Promise<void> {
    try {
      // Store as AIDecisionLog with action='fix_attempt'
      await this.aiDecisionLogger.logDecision({
        agentName: 'AI Progress Validator',
        action: 'fix_attempt_tracked',
        reasoning: `Fix attempt #${metrics.attemptNumber}: ${metrics.outcome}`,
        ticketId: metrics.ticketId,
        executionId: metrics.executionId,
        inputData: {
          errorsBefore: metrics.errorsBefore,
          attemptNumber: metrics.attemptNumber,
        },
        outputData: {
          errorsAfter: metrics.errorsAfter,
          errorReduction: metrics.errorsBefore - metrics.errorsAfter,
          totalTimeMs: metrics.totalTimeMs,
          outcome: metrics.outcome,
        },
        confidence: metrics.outcome === 'success' ? 1.0 : 0.7,
      });

      // Record Prometheus metrics (non-blocking)
      this.recordMetrics(metrics);

      this.logger.log({
        message: `Fix attempt tracked: ${metrics.outcome}`,
        executionId: metrics.executionId,
        attemptNumber: metrics.attemptNumber,
        errorReduction: metrics.errorsBefore - metrics.errorsAfter,
      });
    } catch (_error) {
      // Graceful degradation - don't crash if tracking fails
      this.logger.error('Failed to track fix attempt', {
        error: (_error as Error).message,
        executionId: metrics.executionId,
      });
      this.sentry.captureException(_error as Error);
    }
  }

  /**
   * Create escalation result object
   */
  private createEscalationResult(
    params: {
      errorsBefore: number;
      errorsAfter: number;
      attemptNumber: number;
    },
    reason: string,
    totalTimeMs: number,
    errorReduction: number,
    confidence: number,
  ): ValidationResult {
    return {
      shouldContinue: false,
      reason,
      escalate: true,
      metrics: {
        errorsBefore: params.errorsBefore,
        errorsAfter: params.errorsAfter,
        errorReduction,
        totalTimeMs,
        attemptNumber: params.attemptNumber,
        progressRate: errorReduction / params.attemptNumber,
      },
      confidence,
    };
  }

  /**
   * Log escalation decision and send alerts
   */
  private async logEscalation(
    params: {
      executionId: string;
      ticketId: string;
      errorsBefore: number;
      errorsAfter: number;
      attemptNumber: number;
    },
    reason: string,
    totalTimeMs: number,
    errorReduction: number,
    confidence: number,
  ): Promise<void> {
    // Log AI decision for audit trail
    await this.aiDecisionLogger.logDecision({
      agentName: 'AI Progress Validator',
      action: 'escalate_to_human',
      reasoning: reason,
      ticketId: params.ticketId,
      executionId: params.executionId,
      inputData: {
        errorsBefore: params.errorsBefore,
        errorsAfter: params.errorsAfter,
        attemptNumber: params.attemptNumber,
        totalTimeMs,
      },
      outputData: {
        decision: 'escalate',
        reason,
        errorReduction,
      },
      confidence,
    });

    // Record escalation metric
    try {
      this.metrics.incrementCounter('ai_progress_escalations_total', {
        reason: this.categorizeEscalationReason(reason),
      });
    } catch (err) {
      this.logger.warn('Failed to record escalation metric', (err as Error).message);
    }

    // Send Sentry alert for PM/Lead QA notification
    try {
      this.sentry.captureMessage('AI execution escalated to human review', ErrorSeverity.CRITICAL, {
        executionId: params.executionId,
        ticketId: params.ticketId,
        reason,
        errorsBefore: params.errorsBefore,
        errorsAfter: params.errorsAfter,
        attemptNumber: params.attemptNumber,
        totalTimeMinutes: Math.round(totalTimeMs / 1000 / 60),
        errorReduction,
        service: 'progress-validator',
        escalation_type: this.categorizeEscalationReason(reason),
      });
    } catch (err) {
      this.logger.warn('Failed to send Sentry escalation alert', (err as Error).message);
    }
  }

  /**
   * Log successful fix completion
   */
  private async logSuccessfulFix(
    params: {
      executionId: string;
      ticketId: string;
      errorsBefore: number;
      attemptNumber: number;
    },
    totalTimeMs: number,
  ): Promise<void> {
    await this.aiDecisionLogger.logDecision({
      agentName: 'AI Progress Validator',
      action: 'fix_successful',
      reasoning: `All errors resolved after ${params.attemptNumber} attempts`,
      ticketId: params.ticketId,
      executionId: params.executionId,
      inputData: {
        errorsBefore: params.errorsBefore,
        attemptNumber: params.attemptNumber,
        totalTimeMs,
      },
      outputData: {
        errorsAfter: 0,
        decision: 'continue',
        outcome: 'success',
      },
      confidence: 1.0,
    });

    await this.trackFixAttempt({
      executionId: params.executionId,
      ticketId: params.ticketId,
      errorsBefore: params.errorsBefore,
      errorsAfter: 0,
      attemptNumber: params.attemptNumber,
      totalTimeMs,
      outcome: 'success',
    });
  }

  /**
   * Record Prometheus metrics for fix attempts
   */
  private recordMetrics(metrics: FixAttemptMetrics): void {
    // Counter: Total fix attempts by outcome
    try {
      this.metrics.incrementCounter('ai_fix_attempts_total', {
        outcome: metrics.outcome,
      });
    } catch (err) {
      this.logger.warn('Failed to record fix attempts counter', (err as Error).message);
    }

    // Histogram: Fix duration distribution
    try {
      this.metrics.recordHistogram('ai_fix_time_seconds', metrics.totalTimeMs / 1000, {
        ticket_id: metrics.ticketId,
      });
    } catch (err) {
      this.logger.warn('Failed to record fix time histogram', (err as Error).message);
    }

    // Gauge: Current error reduction
    try {
      const reduction = metrics.errorsBefore - metrics.errorsAfter;
      this.metrics.setGauge('ai_progress_validation_errors_reduced', reduction, {
        execution_id: metrics.executionId,
      });
    } catch (err) {
      this.logger.warn('Failed to record error reduction gauge', (err as Error).message);
    }

    // Counter: Escalation rate
    if (metrics.outcome === 'escalated') {
      try {
        this.metrics.incrementCounter('ai_progress_escalations_total', {
          reason: 'no_progress',
        });
      } catch (err) {
        this.logger.warn('Failed to record escalation counter', (err as Error).message);
      }
    }
  }

  /**
   * Categorize escalation reason for metrics
   */
  private categorizeEscalationReason(reason: string): string {
    if (reason.includes('time limit')) return 'timeout';
    if (reason.includes('not decreasing')) return 'no_progress';
    if (reason.includes('Invalid')) return 'invalid_data';
    return 'other';
  }
}
