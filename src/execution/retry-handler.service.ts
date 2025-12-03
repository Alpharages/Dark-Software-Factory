import { Injectable, Logger } from '@nestjs/common';
import { AIProvider, ExecutionStatus } from '@prisma/client';
import { Counter, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import {
    IRetryContext,
    IRetryDecision,
    IRetryMetrics,
    IPreviousAttempt,
    ErrorSeverity,
} from './interfaces';
import { RetryClassifierService } from './retry-classifier.service';
import { RetrySchedulerService } from './retry-scheduler.service';
import { ExecutionTrackerService } from './execution-tracker.service';
import { SentryService } from '../common/sentry/sentry.service';
import { ErrorCategory } from '../common/sentry/sentry.constants';
import { LoggerService } from '../common/logger/logger.service';
import { PrismaService } from '../database/prisma.service';

/**
 * Retry Handler Service
 * 
 * Main orchestrator for retry logic.
 * Coordinates error classification, scheduling, and state management.
 * 
 * FR63: System retries failed executions with error context
 * NFR-R3: Failed AI executions must be recoverable
 */
@Injectable()
export class RetryHandlerService {
    private readonly logger = new Logger(RetryHandlerService.name);

    /** In-memory metrics tracking */
    private totalRetries = 0;
    private successfulRetries = 0;
    private exhaustedRetries = 0;
    private retriesByErrorCode: Record<string, number> = {};

    /** M2: Max error history to prevent unbounded growth */
    private static readonly MAX_ERROR_HISTORY = 5;

    constructor(
        private readonly classifier: RetryClassifierService,
        private readonly scheduler: RetrySchedulerService,
        private readonly executionTracker: ExecutionTrackerService,
        private readonly sentry: SentryService,
        private readonly loggerService: LoggerService,
        private readonly prisma: PrismaService,
        @InjectMetric('retry_attempts_total')
        private readonly attemptsCounter: Counter<string>,
        @InjectMetric('retry_exhausted_total')
        private readonly exhaustedCounter: Counter<string>,
        @InjectMetric('retry_success_total')
        private readonly successCounter: Counter<string>,
        @InjectMetric('retry_active_count')
        private readonly activeGauge: Gauge<string>,
    ) { }

    /**
     * Handle a failed execution - determine retry or permanent failure
     */
    async handleFailure(
        executionId: string,
        correlationId: string,
        errorCode: string,
        errorMessage: string,
        provider: AIProvider,
        durationMs: number,
    ): Promise<{
        decision: IRetryDecision;
        scheduled: boolean;
    }> {
        // Set context for structured logging
        // this.loggerService.setCorrelationId(correlationId); // Not available in LoggerService

        this.logger.log(
            `[${correlationId}] Handling failure for execution ${executionId}: ${errorCode}`,
        );

        // 1. Get current execution state
        const execution = await this.prisma.execution.findUnique({
            where: { id: executionId },
            include: { ticket: true },
        });

        if (!execution) {
            this.logger.error(`[${correlationId}] Execution ${executionId} not found`);
            throw new Error(`Execution ${executionId} not found`);
        }

        // 2. Classify the error
        const classification = this.classifier.classifyError(
            errorCode,
            errorMessage,
            correlationId,
        );

        // 3. Determine if we should retry
        const decision = this.scheduler.shouldRetry(
            execution.retry_count,
            classification.isRetryable,
            correlationId,
        );

        // 4. Build retry context
        const previousAttempt: IPreviousAttempt = {
            attemptNumber: execution.retry_count + 1,
            provider,
            errorCode,
            errorMessage,
            durationMs,
            timestamp: new Date(),
        };

        // Track metrics
        this.totalRetries++;
        this.retriesByErrorCode[errorCode] = (this.retriesByErrorCode[errorCode] || 0) + 1;
        this.attemptsCounter.inc({
            error_code: errorCode,
            provider,
            retryable: String(classification.isRetryable),
        });

        if (decision.shouldRetry) {
            // 5a. Schedule retry
            const context: IRetryContext = {
                correlationId,
                executionId,
                ticketId: execution.ticket_id,
                originalRequestTime: execution.created_at,
                previousErrors: this.parsePreviousErrors(execution.error_context),
                cumulativeDurationMs: this.calculateCumulativeDuration(execution, durationMs),
                retryCount: execution.retry_count + 1,
            };

            // Add current attempt to previous errors
            context.previousErrors.push(previousAttempt);

            // M2: Limit error history size to prevent unbounded growth
            if (context.previousErrors.length > RetryHandlerService.MAX_ERROR_HISTORY) {
                context.previousErrors = context.previousErrors.slice(-RetryHandlerService.MAX_ERROR_HISTORY);
            }

            // M1: Schedule retry first, then update DB for atomicity
            // If RabbitMQ fails, we don't update DB (no orphaned state)
            try {
                await this.scheduler.scheduleRetry(context, decision.delayMs);

                // H1: Use optimistic locking to prevent race conditions
                await this.updateExecutionForRetry(
                    executionId,
                    execution.retry_count,
                    context,
                    decision.delayMs,
                );

                this.activeGauge.inc();

                this.logger.log(
                    `[${correlationId}] Retry scheduled: attempt ${decision.attemptNumber}/${decision.maxRetries}, ` +
                    `delay ${decision.delayMs}ms`,
                );

                return { decision, scheduled: true };
            } catch (error: any) {
                this.logger.error(
                    `[${correlationId}] Failed to schedule retry: ${error.message}`,
                    error.stack,
                );
                // M1: If scheduling fails, treat as permanent failure
                await this.handlePermanentFailure(
                    execution,
                    correlationId,
                    classification,
                    previousAttempt,
                );
                throw error;
            }

        } else {
            // 5b. Mark as permanent failure
            await this.handlePermanentFailure(
                execution,
                correlationId,
                classification,
                previousAttempt,
            );

            return { decision, scheduled: false };
        }
    }

    /**
     * Handle successful retry completion
     */
    async handleRetrySuccess(
        executionId: string,
        correlationId: string,
    ): Promise<void> {
        this.successfulRetries++;
        this.successCounter.inc();
        this.activeGauge.dec();

        this.logger.log(
            `[${correlationId}] Retry successful for execution ${executionId}`,
        );

        // Update execution status
        await this.prisma.execution.update({
            where: { id: executionId },
            data: {
                status: ExecutionStatus.COMPLETED,
                updated_at: new Date(),
            },
        });
    }

    /**
     * Handle permanent failure - no more retries
     */
    private async handlePermanentFailure(
        execution: any,
        correlationId: string,
        classification: { severity: ErrorSeverity; errorCode: string; message: string },
        lastAttempt: IPreviousAttempt,
    ): Promise<void> {
        this.exhaustedRetries++;
        this.exhaustedCounter.inc({ error_code: classification.errorCode });
        this.activeGauge.dec();

        this.logger.error(
            `[${correlationId}] Permanent failure for execution ${execution.id}: ` +
            `${classification.message} (${execution.retry_count + 1} attempts)`,
        );

        // Update execution status
        await this.prisma.execution.update({
            where: { id: execution.id },
            data: {
                status: ExecutionStatus.FAILED,
                error_message: classification.message,
                error_context: JSON.stringify({
                    ...this.parsePreviousErrors(execution.error_context),
                    finalError: lastAttempt,
                    totalAttempts: execution.retry_count + 1,
                    failureReason: classification.errorCode,
                }),
                updated_at: new Date(),
            },
        });

        // Log to Sentry based on severity
        // Uses SentryService interface: { severity, category, tags, extra }
        if (classification.severity === ErrorSeverity.CRITICAL ||
            classification.severity === ErrorSeverity.HIGH) {
            this.sentry.captureException(
                new Error(`AI Execution Permanent Failure: ${classification.message}`),
                {
                    severity: classification.severity,
                    category: ErrorCategory.AI_EXECUTION, // Requires adding to sentry.constants.ts
                    tags: {
                        executionId: execution.id,
                        ticketId: execution.ticket_id,
                        errorCode: classification.errorCode,
                    },
                    extra: {
                        correlationId,
                        totalAttempts: execution.retry_count + 1,
                        previousErrors: this.parsePreviousErrors(execution.error_context),
                        lastAttempt,
                    },
                },
            );
        }

        // M4: Basic PM notification via structured logging
        // Enhanced webhook/email notifications will be implemented in future story
        this.logger.warn(
            `🚨 PERMANENT FAILURE - PM Action Required:\n` +
            `  Execution: ${execution.id}\n` +
            `  Ticket: ${execution.ticket_id}\n` +
            `  Error: ${classification.message}\n` +
            `  Attempts: ${execution.retry_count + 1}\n` +
            `  Correlation: ${correlationId}`,
        );
    }

    /**
     * Update execution record for retry
     * H1: Uses optimistic locking to prevent race conditions
     */
    private async updateExecutionForRetry(
        executionId: string,
        currentRetryCount: number,
        context: IRetryContext,
        delayMs: number,
    ): Promise<void> {
        // H1: Re-fetch execution to verify retry_count hasn't changed (optimistic lock)
        const current = await this.prisma.execution.findUnique({
            where: { id: executionId },
            select: { retry_count: true },
        });

        if (!current || current.retry_count !== currentRetryCount) {
            throw new Error(
                `Race condition detected: execution ${executionId} was modified by another process ` +
                `(expected retry_count: ${currentRetryCount}, actual: ${current?.retry_count})`,
            );
        }

        // Safe to update now
        await this.prisma.execution.update({
            where: { id: executionId },
            data: {
                status: ExecutionStatus.QUEUED,
                retry_count: context.retryCount,
                error_context: JSON.stringify(context.previousErrors),
                scheduled_retry_at: new Date(Date.now() + delayMs),
                updated_at: new Date(),
            },
        });
    }

    /**
     * Parse previous errors from JSON context
     */
    private parsePreviousErrors(errorContext: string | null): IPreviousAttempt[] {
        if (!errorContext) return [];
        try {
            const parsed = JSON.parse(errorContext);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    /**
     * Calculate cumulative duration including current attempt
     */
    private calculateCumulativeDuration(execution: any, currentDurationMs: number): number {
        const previousErrors = this.parsePreviousErrors(execution.error_context);
        const previousDuration = previousErrors.reduce(
            (sum, err) => sum + (err.durationMs || 0),
            0,
        );
        return previousDuration + currentDurationMs;
    }

    /**
     * Get retry metrics
     */
    getMetrics(): IRetryMetrics {
        return {
            totalRetries: this.totalRetries,
            successfulRetries: this.successfulRetries,
            exhaustedRetries: this.exhaustedRetries,
            avgRetriesPerExecution: this.totalRetries > 0
                ? this.totalRetries / (this.successfulRetries + this.exhaustedRetries || 1)
                : 0,
            successRate: this.totalRetries > 0
                ? this.successfulRetries / this.totalRetries
                : 0,
            retriesByErrorCode: { ...this.retriesByErrorCode },
        };
    }
}
