import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { IRetryDecision, IRetryContext, IRetrySchedule, RetryDecisionReason } from './interfaces';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';

/**
 * Retry Scheduler Service
 *
 * Calculates retry delays using exponential backoff with jitter.
 * Schedules retry attempts via RabbitMQ delayed messages.
 *
 * FR63: Exponential backoff: 1s, 2s, 4s (with ±20% jitter)
 */
@Injectable()
export class RetrySchedulerService {
  private readonly logger = new Logger(RetrySchedulerService.name);

  /** Configuration */
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly backoffMultiplier: number;
  private readonly maxDelayMs: number;

  constructor(
    private readonly config: ConfigService,
    private readonly rabbitmq: RabbitMQService,
    @InjectMetric('retry_scheduled_total')
    private readonly scheduledCounter: Counter<string>,
    @InjectMetric('retry_delay_seconds')
    private readonly delayHistogram: Histogram<string>,
  ) {
    this.maxRetries = this.config.get<number>('retry.maxAttempts', 3);
    this.baseDelayMs = this.config.get<number>('retry.baseDelayMs', 1000);
    this.backoffMultiplier = this.config.get<number>('retry.backoffMultiplier', 2);
    this.maxDelayMs = this.config.get<number>('retry.maxDelayMs', 30000);
  }

  /**
   * Determine if and when to retry
   */
  shouldRetry(
    currentRetryCount: number,
    isRetryable: boolean,
    correlationId: string,
  ): IRetryDecision {
    // Check if error is retryable
    if (!isRetryable) {
      this.logger.log(`[${correlationId}] Error is not retryable - no retry scheduled`);
      return {
        shouldRetry: false,
        delayMs: 0,
        attemptNumber: currentRetryCount + 1,
        maxRetries: this.maxRetries,
        reason: RetryDecisionReason.NON_RETRYABLE_ERROR,
      };
    }

    // Check if max retries exceeded
    if (currentRetryCount >= this.maxRetries) {
      this.logger.log(
        `[${correlationId}] Max retries (${this.maxRetries}) exceeded - no more retries`,
      );
      return {
        shouldRetry: false,
        delayMs: 0,
        attemptNumber: currentRetryCount + 1,
        maxRetries: this.maxRetries,
        reason: RetryDecisionReason.MAX_RETRIES_EXCEEDED,
      };
    }

    // Calculate delay with exponential backoff
    const delayMs = this.calculateBackoffDelay(currentRetryCount);

    this.logger.log(
      `[${correlationId}] Retry scheduled: attempt ${currentRetryCount + 1}/${this.maxRetries}, ` +
        `delay ${delayMs}ms`,
    );

    return {
      shouldRetry: true,
      delayMs,
      attemptNumber: currentRetryCount + 1,
      maxRetries: this.maxRetries,
      reason: RetryDecisionReason.RETRYABLE,
    };
  }

  /**
   * Schedule a retry attempt via RabbitMQ
   */
  async scheduleRetry(context: IRetryContext, delayMs: number): Promise<IRetrySchedule> {
    const { correlationId, executionId } = context;
    const scheduledTime = new Date(Date.now() + delayMs);

    const schedule: IRetrySchedule = {
      executionId,
      correlationId,
      scheduledTime,
      delayMs,
      context,
    };

    // Publish to RabbitMQ with delay
    // Uses channel.sendToQueue() - RabbitMQ delayed message plugin required for x-delay
    const channel = this.rabbitmq.getChannel();
    const message = Buffer.from(
      JSON.stringify({
        type: 'AI_EXECUTION_RETRY',
        correlationId,
        executionId,
        context,
        scheduledAt: new Date().toISOString(),
        delayMs,
      }),
    );

    await channel.sendToQueue(QUEUE_NAMES.AI_EXECUTION_RETRY, message, {
      persistent: true,
      headers: {
        'x-delay': delayMs, // Requires rabbitmq_delayed_message_exchange plugin
      },
    });

    // Track metrics
    this.scheduledCounter.inc({ attempt: String(context.retryCount + 1) });
    this.delayHistogram.observe(delayMs / 1000);

    this.logger.log(
      `[${correlationId}] Retry scheduled for execution ${executionId} ` +
        `at ${scheduledTime.toISOString()} (delay: ${delayMs}ms)`,
    );

    return schedule;
  }

  /**
   * Calculate exponential backoff delay with jitter
   * Formula: baseDelay * (multiplier ^ retryCount) ± 20% jitter
   * Jitter prevents thundering herd when multiple retries fire together
   * Example with defaults: ~1000ms, ~2000ms, ~4000ms (±20% variation)
   */
  calculateBackoffDelay(retryCount: number): number {
    const baseDelay = this.baseDelayMs * Math.pow(this.backoffMultiplier, retryCount);
    const cappedDelay = Math.min(baseDelay, this.maxDelayMs);
    // Add ±20% jitter to prevent thundering herd
    const jitter = cappedDelay * 0.2 * (Math.random() * 2 - 1);
    return Math.floor(cappedDelay + jitter);
  }

  /**
   * Get retry configuration
   */
  getRetryConfig(): {
    maxRetries: number;
    baseDelayMs: number;
    backoffMultiplier: number;
    maxDelayMs: number;
  } {
    return {
      maxRetries: this.maxRetries,
      baseDelayMs: this.baseDelayMs,
      backoffMultiplier: this.backoffMultiplier,
      maxDelayMs: this.maxDelayMs,
    };
  }
}
