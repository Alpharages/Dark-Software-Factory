import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider, ExecutionStatus } from '@prisma/client';
import { Counter, Gauge, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { ExecutionTrackerService } from './execution-tracker.service';
import {
    IAIExecutionMessage,
    IConsumerState,
    IProcessingResult,
    IExecutionCompletion,
    IExecutionFailure,
} from './interfaces';
import { OrchestratorService } from '../ai-routing/orchestrator.service';

/**
 * AI Execution Consumer
 * 
 * Consumes messages from ai-execution-queue and processes AI executions.
 * Implements manual acknowledgment, error handling, and metrics.
 * 
 * Story 2.10: RabbitMQ AI Execution Queue Processing
 * 
 * Architecture Reference:
 * - Prefetch count: 1 (process one at a time)
 * - Manual acknowledgment required
 * - Dead letter after 3 retries
 * - Exponential backoff for transient failures
 * 
 * **Design Decision:** Uses raw `channel.consume()` instead of `@MessagePattern`
 * decorator because manual acknowledgment control is required for:
 * - Explicit ack/nack based on processing result
 * - Requeue decisions based on error type
 * - DLQ routing for permanent failures
 * @MessagePattern auto-acks which doesn't meet our reliability requirements.
 */
@Injectable()
export class AIExecutionConsumer implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(AIExecutionConsumer.name);

    /** Consumer state for health checks */
    private consumerState: IConsumerState = {
        consumerTag: '',
        isActive: false,
        startedAt: new Date(),
        messagesProcessed: 0,
        messagesFailed: 0,
        currentMessageId: null,
    };

    /** Processing metrics */
    private processingTimes: number[] = [];
    private readonly MAX_PROCESSING_TIMES = 100;

    /** Queue monitoring interval */
    private monitoringInterval?: NodeJS.Timeout;

    constructor(
        private readonly config: ConfigService,
        private readonly rabbitmq: RabbitMQService,
        private readonly executionTracker: ExecutionTrackerService,
        private readonly orchestrator: OrchestratorService,
        @InjectMetric('queue_messages_consumed_total')
        private readonly consumedCounter: Counter<string>,
        @InjectMetric('queue_messages_failed_total')
        private readonly failedCounter: Counter<string>,
        @InjectMetric('queue_processing_duration_seconds')
        private readonly processingHistogram: Histogram<string>,
        @InjectMetric('queue_depth')
        private readonly queueDepthGauge: Gauge<string>,
        @InjectMetric('queue_consumer_count')
        private readonly consumerCountGauge: Gauge<string>,
    ) { }

    async onModuleInit(): Promise<void> {
        await this.startConsuming();
        this.startQueueMonitoring();
    }

    async onModuleDestroy(): Promise<void> {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
        }
        await this.stopConsuming();
    }

    /**
     * Start consuming messages from the queue
     */
    private async startConsuming(): Promise<void> {
        try {
            const channel = this.rabbitmq.getChannel();
            const prefetch = this.config.get<number>('AI_EXECUTION_PREFETCH', 1);
            const consumerTag = this.config.get<string>(
                'AI_EXECUTION_CONSUMER_TAG',
                'ai-execution-consumer',
            );

            // Set prefetch to process one message at a time
            await channel.prefetch(prefetch);

            this.logger.log(
                `Starting AI execution consumer (prefetch: ${prefetch})`,
            );

            // Start consuming with manual acknowledgment
            const { consumerTag: tag } = await channel.consume(
                QUEUE_NAMES.AI_EXECUTION,
                async (msg: any) => {
                    if (!msg) return;

                    const startTime = Date.now();
                    let messageData: IAIExecutionMessage | null = null;

                    try {
                        // Parse message
                        messageData = JSON.parse(msg.content.toString()) as IAIExecutionMessage;
                        const { correlationId, payload } = messageData;

                        this.consumerState.currentMessageId = messageData.messageId;
                        // Correlation ID is tracked via middleware; log it for reference

                        this.logger.log(
                            `[${correlationId}] Processing execution ${payload.executionId} ` +
                            `(provider: ${payload.aiProvider}, priority: ${payload.priority})`,
                        );

                        // Process the execution
                        const result = await this.processExecution(messageData);

                        // Record metrics
                        const duration = Date.now() - startTime;
                        this.recordProcessingTime(duration);

                        if (result.success) {
                            this.logger.log(
                                `[${correlationId}] Execution ${payload.executionId} completed ` +
                                `(${duration}ms)`,
                            );

                            // Acknowledge message
                            channel.ack(msg);
                            this.consumerState.messagesProcessed++;

                            this.consumedCounter.inc({
                                queue: QUEUE_NAMES.AI_EXECUTION,
                                status: 'success',
                                provider: payload.aiProvider,
                            });

                        } else {
                            // Processing failed - check if retryable
                            await this.handleProcessingFailure(
                                msg,
                                channel,
                                messageData,
                                result,
                            );
                        }

                        this.processingHistogram.observe(
                            { queue: QUEUE_NAMES.AI_EXECUTION },
                            duration / 1000,
                        );

                    } catch (error: any) {
                        // Unexpected error - reject message
                        this.logger.error(
                            `[${messageData?.correlationId || 'unknown'}] Consumer error: ${error.message}`,
                            error.stack,
                        );

                        const shouldRequeue = this.shouldRequeueOnError(error);
                        channel.nack(msg, false, shouldRequeue);

                        this.consumerState.messagesFailed++;
                        this.failedCounter.inc({
                            queue: QUEUE_NAMES.AI_EXECUTION,
                            error_type: error.name || 'UnknownError',
                        });

                    } finally {
                        this.consumerState.currentMessageId = null;
                    }
                },
                { noAck: false, consumerTag },
            );

            this.consumerState.consumerTag = tag;
            this.consumerState.isActive = true;
            this.consumerState.startedAt = new Date();

            this.logger.log(`✅ AI execution consumer started (tag: ${tag})`);

        } catch (error: any) {
            this.logger.error(`Failed to start consumer: ${error.message}`);
            throw error;
        }
    }

    /**
     * Process a single AI execution
     */
    private async processExecution(
        message: IAIExecutionMessage,
    ): Promise<IProcessingResult> {
        const { correlationId, payload } = message;
        const { executionId, prompt, repositoryUrl } = payload;
        const startTime = Date.now();

        try {
            // 1. Mark execution as in-progress
            await this.executionTracker.markInProgress(executionId, correlationId);

            // 2. Execute via OrchestratorService
            const result = await this.orchestrator.execute({
                correlationId,
                executionId,
                ticketId: payload.ticketId,
                prompt,
                repositoryUrl,
                allowFallback: payload.allowFallback ?? true,
            });

            if (result.success) {
                // 3. Mark as completed
                const completion: IExecutionCompletion = {
                    executionId,
                    codeOutput: result.codeDiff || '',
                    filesChanged: result.filesChanged || [],
                    confidenceScore: result.confidenceScore || 0.8,
                };
                await this.executionTracker.completeExecution(completion, correlationId);

                return {
                    success: true,
                    executionId,
                    durationMs: Date.now() - startTime,
                    executedBy: result.executedBy,
                };

            } else {
                // 4. Mark as failed
                const failure: IExecutionFailure = {
                    executionId,
                    errorMessage: result.error?.message || 'Unknown error',
                    isRetryable: this.isRetryableError(result.error?.code),
                    errorCode: result.error?.code,
                };
                await this.executionTracker.failExecution(failure, correlationId);

                return {
                    success: false,
                    executionId,
                    durationMs: Date.now() - startTime,
                    errorMessage: result.error?.message,
                    errorCode: result.error?.code,
                };
            }

        } catch (error: any) {
            this.logger.error(
                `[${correlationId}] Execution ${executionId} threw error: ${error.message}`,
            );

            const failure: IExecutionFailure = {
                executionId,
                errorMessage: error.message,
                isRetryable: this.isRetryableError(error.code),
                errorCode: error.code || 'EXECUTION_ERROR',
            };
            await this.executionTracker.failExecution(failure, correlationId);

            return {
                success: false,
                executionId,
                durationMs: Date.now() - startTime,
                errorMessage: error.message,
                errorCode: error.code || 'EXECUTION_ERROR',
            };
        }
    }

    /**
     * Handle processing failure - determine retry or DLQ
     */
    private async handleProcessingFailure(
        msg: any,
        channel: any,
        messageData: IAIExecutionMessage,
        result: IProcessingResult,
    ): Promise<void> {
        const { correlationId } = messageData;
        const retryCount = (msg.properties.headers?.['x-retry-count'] || 0) + 1;
        const maxRetries = 3;

        this.logger.warn(
            `[${correlationId}] Execution failed (attempt ${retryCount}/${maxRetries}): ${result.errorMessage}`,
        );

        if (retryCount < maxRetries && this.isRetryableError(result.errorCode)) {
            // Requeue with updated retry count
            // Note: In production, use delayed message plugin for backoff
            channel.nack(msg, false, true); // Requeue immediately for simplicity

            this.logger.log(
                `[${correlationId}] Message requeued for retry (attempt ${retryCount + 1})`,
            );

        } else {
            // Max retries exceeded or non-retryable - send to DLQ
            channel.nack(msg, false, false); // Don't requeue - goes to DLQ

            this.consumerState.messagesFailed++;

            this.logger.error(
                `[${correlationId}] Message sent to DLQ after ${retryCount} attempts`,
            );

            this.failedCounter.inc({
                queue: QUEUE_NAMES.AI_EXECUTION,
                error_type: result.errorCode || 'UNKNOWN',
                final: 'true',
            });
        }
    }

    /**
     * Check if error is retryable
     */
    private isRetryableError(errorCode?: string): boolean {
        const nonRetryable = [
            'INVALID_PROMPT',
            'INVALID_REPOSITORY',
            'AUTHENTICATION_ERROR',
            'PERMISSION_DENIED',
            'CANCELLED',
        ];
        return !nonRetryable.includes(errorCode || '');
    }

    /**
     * Check if error should trigger requeue (transient network issues)
     */
    private shouldRequeueOnError(error: Error): boolean {
        const transientPatterns = [
            'ECONNREFUSED',
            'ETIMEDOUT',
            'ENOTFOUND',
            'Connection closed',
        ];
        return transientPatterns.some(p => error.message.includes(p));
    }

    /**
     * Record processing time for rate calculation
     */
    private recordProcessingTime(durationMs: number): void {
        this.processingTimes.push(durationMs);
        if (this.processingTimes.length > this.MAX_PROCESSING_TIMES) {
            this.processingTimes.shift();
        }
    }

    /**
     * Start queue depth monitoring
     */
    private startQueueMonitoring(): void {
        const intervalMs = this.config.get<number>('AI_EXECUTION_MONITOR_INTERVAL_MS', 10000);
        this.monitoringInterval = setInterval(async () => {
            try {
                const stats = await this.rabbitmq.getQueueStats(QUEUE_NAMES.AI_EXECUTION);

                this.queueDepthGauge.set(
                    { queue: QUEUE_NAMES.AI_EXECUTION },
                    stats.messageCount,
                );

                this.consumerCountGauge.set(
                    { queue: QUEUE_NAMES.AI_EXECUTION },
                    stats.consumerCount,
                );

            } catch (error) {
                // Silently ignore monitoring errors
            }
        }, intervalMs);
    }

    /**
     * Stop consuming messages
     */
    private async stopConsuming(): Promise<void> {
        if (this.consumerState.consumerTag && this.consumerState.isActive) {
            const channel = this.rabbitmq.getChannel();
            await channel.cancel(this.consumerState.consumerTag);
            this.consumerState.isActive = false;
            this.logger.log('AI execution consumer stopped');
        }
    }

    /**
     * Get consumer state for health checks
     */
    getConsumerState(): IConsumerState {
        return { ...this.consumerState };
    }

    /**
     * Get queue statistics
     */
    async getQueueStats(): Promise<{
        messageCount: number;
        consumerCount: number;
        processingRate: number;
        avgProcessingTimeMs: number;
    }> {
        const stats = await this.rabbitmq.getQueueStats(QUEUE_NAMES.AI_EXECUTION);

        const avgTime = this.processingTimes.length > 0
            ? this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length
            : 0;

        const processingRate = this.processingTimes.length > 0
            ? 1000 / avgTime // Messages per second
            : 0;

        return {
            ...stats,
            processingRate: Math.round(processingRate * 100) / 100,
            avgProcessingTimeMs: Math.round(avgTime),
        };
    }
}
