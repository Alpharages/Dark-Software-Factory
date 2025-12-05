import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RabbitMQConsumerBase } from '../rabbitmq/rabbitmq-consumer.base';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { SentryService } from '../common/sentry/sentry.service';
import { ErrorCategory } from '../common/sentry/sentry.constants';
import { QaOrchestratorService } from './qa-orchestrator.service';
import { IQaCheckMessage } from './interfaces';

/**
 * QA Orchestrator Consumer
 * FR70: Consumes QA check messages from qa-check-queue
 *
 * Listens to qa-check-queue for QA orchestration requests
 * and processes them through the QaOrchestratorService.
 */
@Injectable()
export class QaOrchestratorConsumer extends RabbitMQConsumerBase implements OnModuleInit {
  protected readonly logger = new Logger(QaOrchestratorConsumer.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly orchestratorService: QaOrchestratorService,
    private readonly sentry: SentryService,
  ) {
    super();
  }

  /**
   * Start consuming on module init
   */
  async onModuleInit(): Promise<void> {
    // Small delay to ensure RabbitMQ connection is ready
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.startConsuming();
  }

  /**
   * Start consuming from qa-check-queue
   */
  async startConsuming(): Promise<void> {
    this.logger.log(`Starting consumer for ${QUEUE_NAMES.QA_CHECK}`);

    try {
      const channel = this.rabbitMQService.getChannel();

      // Ensure queue exists
      await channel.assertQueue(QUEUE_NAMES.QA_CHECK, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'dlx-exchange',
          'x-dead-letter-routing-key': `dlx-${QUEUE_NAMES.QA_CHECK}`,
        },
      });

      // Set prefetch for controlled concurrency (1 for QA checks - resource intensive)
      await channel.prefetch(1);

      // Start consuming
      await channel.consume(
        QUEUE_NAMES.QA_CHECK,
        (message: amqp.ConsumeMessage | null) => {
          if (message) {
            this.handleMessage(message, channel);
          }
        },
        { noAck: false },
      );

      this.logger.log(`Consumer started for ${QUEUE_NAMES.QA_CHECK} (prefetch: 1)`);
    } catch (error) {
      this.logger.error(
        `Failed to start consumer: ${(error as Error).message}`,
        (error as Error).stack,
      );
      this.sentry.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { queue: QUEUE_NAMES.QA_CHECK },
      });
    }
  }

  /**
   * Process a message from the queue
   */
  protected async processMessage(payload: unknown, correlationId: string): Promise<void> {
    const message = payload as IQaCheckMessage;
    const { executionId } = message;

    this.logger.log(`[${correlationId}] Processing QA check for execution ${executionId}`);

    try {
      await this.orchestratorService.processQaCheck({
        ...message,
        correlationId,
      });

      this.logger.log(`[${correlationId}] QA check completed for execution ${executionId}`);
    } catch (error) {
      this.logger.error(`[${correlationId}] QA check failed: ${(error as Error).message}`);
      this.sentry.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId, correlationId },
      });
      // Re-throw to trigger nack in base class
      throw error;
    }
  }
}
