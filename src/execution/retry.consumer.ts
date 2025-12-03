import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { OrchestratorService } from '../ai-routing/orchestrator.service';
import { RetryHandlerService } from './retry-handler.service';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { PrismaService } from '../database/prisma.service';

/**
 * Retry Consumer
 *
 * Consumes retry messages from RabbitMQ and re-executes failed AI tasks.
 * Integrates with OrchestratorService from Story 2.8.
 *
 * FR63: System retries failed executions with error context
 */
@Injectable()
export class RetryConsumer implements OnModuleInit {
  private readonly logger = new Logger(RetryConsumer.name);

  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly orchestrator: OrchestratorService,
    private readonly retryHandler: RetryHandlerService,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.startConsuming();
  }

  /**
   * Start consuming retry messages
   */
  private async startConsuming(): Promise<void> {
    try {
      const channel = this.rabbitmq.getChannel();

      // Ensure queue exists
      await channel.assertQueue(QUEUE_NAMES.AI_EXECUTION_RETRY, {
        durable: true,
        deadLetterExchange: 'dlx.exchange',
        deadLetterRoutingKey: 'dlx-ai-execution-retry',
      });

      // Set prefetch to 1 for fair dispatch
      await channel.prefetch(1);

      this.logger.log('Retry consumer started, waiting for messages...');

      await channel.consume(
        QUEUE_NAMES.AI_EXECUTION_RETRY,
        async (msg: ConsumeMessage | null) => {
          if (!msg) return;

          const startTime = Date.now();
          let data: RetryMessage | null = null;

          try {
            data = JSON.parse(msg.content.toString()) as RetryMessage;
            const { correlationId, executionId, context } = data;

            this.logger.log(
              `[${correlationId}] Processing retry for execution ${executionId} ` +
                `(attempt ${context.retryCount})`,
            );

            // Get execution details from database
            const execution = await this.prisma.execution.findUnique({
              where: { id: executionId },
              include: { ticket: true },
            });

            if (!execution) {
              this.logger.error(`[${correlationId}] Execution ${executionId} not found`);
              channel.ack(msg);
              return;
            }

            // L2: Use ticket's project_id as repository URL
            // Note: This assumes project_id contains the repository URL
            // If project_id is just an ID, this will need proper Project model lookup
            const repositoryUrl = execution.ticket.project_id;

            // Re-execute via orchestrator
            const result = await this.orchestrator.execute({
              correlationId,
              executionId,
              ticketId: execution.ticket_id,
              prompt: execution.prompt,
              repositoryUrl,
              allowFallback: true,
            });

            if (result.success) {
              // Retry succeeded
              await this.retryHandler.handleRetrySuccess(executionId, correlationId);

              this.logger.log(
                `[${correlationId}] Retry successful for ${executionId} ` +
                  `(duration: ${Date.now() - startTime}ms)`,
              );
            } else {
              // Retry failed - will be handled by orchestrator's error flow
              this.logger.warn(
                `[${correlationId}] Retry failed for ${executionId}: ${result.error?.message}`,
              );
            }

            // Acknowledge message
            channel.ack(msg);
          } catch (error: unknown) {
            const err = error as Error;
            this.logger.error(
              `[${data?.correlationId || 'unknown'}] Error processing retry: ${err.message}`,
              err.stack,
            );

            // Reject and requeue if transient error, otherwise send to DLQ
            const shouldRequeue = this.isTransientError(err);
            channel.nack(msg, false, shouldRequeue);
          }
        },
        { noAck: false }, // Manual acknowledgment
      );
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(`Failed to start retry consumer: ${err.message}`);
      throw error;
    }
  }

  /**
   * Check if error is transient (should requeue)
   */
  private isTransientError(error: Error): boolean {
    const transientPatterns = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'Connection closed'];
    return transientPatterns.some((pattern) => error.message.includes(pattern));
  }
}

/**
 * Retry message structure
 */
interface RetryMessage {
  type: 'AI_EXECUTION_RETRY';
  correlationId: string;
  executionId: string;
  context: {
    ticketId: string;
    originalRequestTime: Date;
    previousErrors: unknown[];
    cumulativeDurationMs: number;
    retryCount: number;
  };
  scheduledAt: string;
  delayMs: number;
}
