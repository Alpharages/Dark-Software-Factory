/**
 * QA Review Queue Consumer
 * Story 8.1: QA Review Queue & Sampling Configuration
 *
 * Listens to qa.execution.completed events and:
 * - Evaluates if ticket should be sampled
 * - Adds sampled tickets to the QA Review Queue
 * - Handles errors with retry logic
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '@/prisma/client';
import { LoggerService } from '../../common/logger/logger.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { RabbitMQPublisherService } from '../../rabbitmq/rabbitmq-publisher.service';
import { QaSamplingConfigService } from '../services/qa-sampling-config.service';
import { QaReviewQueueService } from '../services/qa-review-queue.service';
import { QaSamplingService, RiskScoringService } from '../services/qa-sampling.service';
import { QaReviewMetricsService } from '../services/qa-review-metrics.service';
import { ITicketData } from '../interfaces/qa-sampling.interface';

/**
 * QA Execution Completed Event
 */
interface IQaExecutionCompletedEvent {
  executionId: string;
  ticketId: string;
  projectId?: string;
  overallPassed: boolean;
  prId?: string;
  prUrl?: string;
  timestamp: string;
  retryCount?: number;
}

/**
 * Consumer for qa.execution.completed events
 */
@Injectable()
export class QaReviewQueueConsumer {
  private readonly maxRetries: number;
  private readonly dlqRoutingKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly configDbService: QaSamplingConfigService,
    private readonly queueService: QaReviewQueueService,
    private readonly samplingService: QaSamplingService,
    private readonly riskScoringService: RiskScoringService,
    private readonly metricsService: QaReviewMetricsService,
    private readonly logger: LoggerService,
    private readonly sentry: SentryService,
    private readonly rabbitPublisher: RabbitMQPublisherService,
  ) {
    this.maxRetries = this.configService.get<number>('qaReview.queue.maxRetries', 3);
    this.dlqRoutingKey = this.configService.get<string>(
      'qaReview.queue.dlqRoutingKey',
      'qa.execution.completed.dlq',
    );
  }

  /**
   * Handle qa.execution.completed event
   * @param message - Event message
   */
  async handleExecutionCompleted(message: IQaExecutionCompletedEvent): Promise<void> {
    this.logger.debug(`Processing qa.execution.completed for execution ${message.executionId}`);

    try {
      // 1. Verify quality gates passed - only sample passed executions
      if (!message.overallPassed) {
        this.logger.debug(`Execution ${message.executionId} failed QA, skipping sampling`);
        return;
      }

      // 2. Check if already in queue (idempotency)
      const existing = await this.queueService.getByExecutionId(message.executionId);
      if (existing) {
        this.logger.debug(`Execution ${message.executionId} already in queue, skipping`);
        return;
      }

      // 3. Get execution details for sampling evaluation
      const execution = await this.prisma.execution.findUnique({
        where: { id: message.executionId },
        include: {
          ticket: {
            select: {
              clickup_task_id: true,
              project_id: true,
            },
          },
        },
      });

      if (!execution) {
        this.logger.error(`Execution ${message.executionId} not found`);
        throw new Error(`Execution ${message.executionId} not found`);
      }

      // 4. Get QA result for test coverage
      const qaResult = await this.prisma.qAResult.findUnique({
        where: { execution_id: message.executionId },
      });

      // 5. Get sampling configuration
      const config = await this.configDbService.getConfig();

      // 6. Build ticket data for sampling evaluation
      const ticketData: ITicketData = {
        ticketId: execution.ticket.clickup_task_id,
        executionId: message.executionId,
        projectId: execution.ticket.project_id,
        prId: message.prId,
        prUrl: message.prUrl,
        filesChanged: Array.isArray(execution.files_changed) ? execution.files_changed.length : 0,
        complexityScore: execution.complexity_score || 0,
        aiProvider: execution.ai_provider,
        testCoverage: qaResult?.test_coverage || undefined,
      };

      // 7. Evaluate sampling
      const decision = this.samplingService.evaluateSampling(ticketData, config);

      // 8. Record metrics
      this.metricsService.setSamplingRate(config.percentage);

      // 9. If not sampled, we're done
      if (!decision.sample) {
        this.logger.debug(
          `Ticket ${ticketData.ticketId} not selected for sampling ` +
            `(risk: ${decision.riskLevel}, prob: ${(decision.probability * 100).toFixed(1)}%)`,
        );
        return;
      }

      // 10. Create queue entry
      const queueEntry = await this.queueService.createEntry({
        ticketId: ticketData.ticketId,
        executionId: message.executionId,
        projectId: ticketData.projectId,
        prId: message.prId,
        prUrl: message.prUrl,
        riskLevel: decision.riskLevel,
        riskFactors: decision.riskFactors,
        samplingStrategy: decision.samplingStrategy,
      });

      // 11. Record metrics
      this.metricsService.recordTicketSampled(decision.samplingStrategy, decision.riskLevel);
      this.metricsService.recordTicketByRisk(decision.riskLevel);

      this.logger.log(
        `Added execution ${message.executionId} to QA Review Queue ` +
          `(queueId: ${queueEntry.id}, risk: ${decision.riskLevel}, ` +
          `strategy: ${decision.samplingStrategy})`,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to process qa.execution.completed for ${message.executionId}: ${errorMessage}`,
      );
      if (error instanceof Error) {
        this.sentry.captureException(error, {
          extra: {
            executionId: message.executionId,
            ticketId: message.ticketId,
          },
        });
      }

      // Handle retry logic
      if (error instanceof Error) {
        await this.handleRetry(message, error);
      }
    }
  }

  /**
   * Handle retry logic for failed messages
   * @param message - Original message
   * @param error - Error that occurred
   */
  private async handleRetry(message: IQaExecutionCompletedEvent, error: Error): Promise<void> {
    const retryCount = message.retryCount || 0;

    if (retryCount < this.maxRetries) {
      // Retry with incremented count
      const retryMessage = {
        ...message,
        retryCount: retryCount + 1,
      };

      this.logger.warn(
        `Retrying qa.execution.completed for ${message.executionId} ` +
          `(attempt ${retryCount + 1}/${this.maxRetries})`,
      );

      // Re-queue the message for retry with exponential backoff delay
      // Delay: 5s, 10s, 20s for attempts 1, 2, 3
      const delayMs = Math.pow(2, retryCount) * 5000;

      try {
        await this.rabbitPublisher.publishToQueue(
          'qa-execution-retry-queue',
          retryMessage,
          undefined, // correlationId - will be auto-generated
          delayMs,
        );
        this.logger.debug(`Scheduled retry for ${message.executionId} with ${delayMs}ms delay`);
      } catch (publishError) {
        this.logger.error(
          `Failed to schedule retry for ${message.executionId}: ${publishError instanceof Error ? publishError.message : 'Unknown error'}`,
        );
        // If we can't schedule retry, send to DLQ immediately
        await this.sendToDLQ(message, error);
      }
    } else {
      // Max retries exceeded, send to DLQ
      this.logger.error(`Max retries exceeded for ${message.executionId}, sending to DLQ`);

      // Send to DLQ
      await this.sendToDLQ(message, error);

      // Don't rethrow - message is handled
    }
  }

  /**
   * Send message to dead letter queue
   * @param message - Failed message
   * @param error - Error that occurred
   */
  private async sendToDLQ(message: IQaExecutionCompletedEvent, error: Error): Promise<void> {
    try {
      // Create audit log entry for DLQ message
      await this.prisma.auditLog.create({
        data: {
          entity_type: 'qa_review_queue_dlq',
          entity_id: message.executionId,
          action: 'message_dlq',
          actor_type: 'system',
          before_state: message as unknown as Prisma.InputJsonValue,
          after_state: {
            error: error.message,
            dlqRoutingKey: this.dlqRoutingKey,
            timestamp: new Date().toISOString(),
          },
        },
      });

      this.logger.log(`Sent execution ${message.executionId} to DLQ (${this.dlqRoutingKey})`);
    } catch (dlqError) {
      const dlqErrorMessage = dlqError instanceof Error ? dlqError.message : 'Unknown error';
      this.logger.error(`Failed to send to DLQ: ${dlqErrorMessage}`);
      if (dlqError instanceof Error) {
        this.sentry.captureException(dlqError);
      }
    }
  }

  /**
   * Process messages from DLQ (manual recovery)
   * @param executionId - Execution ID to reprocess
   */
  async reprocessDLQMessage(executionId: string): Promise<void> {
    this.logger.log(`Manually reprocessing DLQ message for ${executionId}`);

    // Find the original audit log
    const auditLog = await this.prisma.auditLog.findFirst({
      where: {
        entity_type: 'qa_review_queue_dlq',
        entity_id: executionId,
      },
      orderBy: { created_at: 'desc' },
    });

    if (!auditLog || !auditLog.before_state) {
      throw new Error(`No DLQ message found for execution ${executionId}`);
    }

    // Reset retry count and reprocess
    const message = auditLog.before_state as unknown as IQaExecutionCompletedEvent;
    message.retryCount = 0;

    await this.handleExecutionCompleted(message);
  }
}

/**
 * Legacy queue consumer for backward compatibility
 * Wraps the new consumer for RabbitMQ integration
 */
@Injectable()
export class QaReviewQueueLegacyConsumer {
  constructor(private readonly consumer: QaReviewQueueConsumer) {}

  /**
   * Handle incoming RabbitMQ message
   * @param message - RabbitMQ message
   */
  async consume(message: unknown): Promise<void> {
    // Validate and transform message
    const event = this.parseMessage(message);
    await this.consumer.handleExecutionCompleted(event);
  }

  /**
   * Parse and validate incoming message
   */
  private parseMessage(message: unknown): IQaExecutionCompletedEvent {
    if (!message || typeof message !== 'object') {
      throw new Error('Invalid message format');
    }

    const msg = message as Record<string, unknown>;

    if (!msg.executionId || typeof msg.executionId !== 'string') {
      throw new Error('Missing or invalid executionId');
    }

    if (!msg.ticketId || typeof msg.ticketId !== 'string') {
      throw new Error('Missing or invalid ticketId');
    }

    return {
      executionId: msg.executionId,
      ticketId: msg.ticketId,
      projectId: msg.projectId as string | undefined,
      overallPassed: msg.overallPassed === true,
      prId: msg.prId as string | undefined,
      prUrl: msg.prUrl as string | undefined,
      timestamp: (msg.timestamp as string) || new Date().toISOString(),
      retryCount: (msg.retryCount as number) || 0,
    };
  }
}
