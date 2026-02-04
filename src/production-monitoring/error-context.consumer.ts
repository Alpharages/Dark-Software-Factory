/**
 * Error Context Consumer
 * Story 9-U-4: Error Context Extraction & Linking
 *
 * Consumes error.ingested events and triggers context extraction asynchronously.
 * Non-blocking to error ingestion flow.
 */

import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { RabbitMQConsumerBase } from '@/rabbitmq/rabbitmq-consumer.base';
import { EXCHANGE_NAMES } from '@/rabbitmq/rabbitmq.config';
import { SentryService } from '@/common/sentry/sentry.service';
import { ErrorContextService } from './error-context.service';
import { ErrorIngestedEvent } from './interfaces';

/** Queue name for error context extraction */
const QUEUE_NAME = 'error_context_extraction_queue';

/** Dead letter routing key */
const DLQ_ROUTING_KEY = `dlx-${QUEUE_NAME}`;

/** Exponential backoff delays in ms: 1s, 2s, 4s */
const RETRY_DELAYS = [1000, 2000, 4000];

@Injectable()
export class ErrorContextConsumer extends RabbitMQConsumerBase implements OnModuleInit {
  protected readonly logger = new Logger(ErrorContextConsumer.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly errorContextService: ErrorContextService,
    private readonly sentry: SentryService,
  ) {
    super();
  }

  /**
   * Start consuming on module init
   */
  async onModuleInit(): Promise<void> {
    // Wait for RabbitMQ service to initialize
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await this.startConsuming();
  }

  /**
   * Start consuming from error_context_extraction_queue
   */
  async startConsuming(): Promise<void> {
    this.logger.log(`Starting consumer for ${QUEUE_NAME}`);

    try {
      const channel = this.rabbitMQService.getChannel();

      // Ensure queue exists with dead letter exchange
      await channel.assertQueue(QUEUE_NAME, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': EXCHANGE_NAMES.DEAD_LETTER_EXCHANGE,
          'x-dead-letter-routing-key': DLQ_ROUTING_KEY,
        },
      });

      // Bind to production-events exchange with error.ingested routing key
      await channel.bindQueue(QUEUE_NAME, EXCHANGE_NAMES.PRODUCTION_EVENTS, 'error.ingested');

      // Set prefetch for controlled concurrency
      await channel.prefetch(2);

      // Start consuming
      await channel.consume(
        QUEUE_NAME,
        (message: amqp.ConsumeMessage | null) => {
          if (message) {
            this.handleMessageWithRetry(message, channel);
          }
        },
        { noAck: false },
      );

      this.logger.log(`Consumer started for ${QUEUE_NAME} (prefetch: 2)`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`Failed to start ErrorContextConsumer: ${errorMsg}`, errorStack);
    }
  }

  /**
   * Handle message with exponential backoff retry logic
   */
  private async handleMessageWithRetry(
    message: amqp.ConsumeMessage,
    channel: amqp.Channel,
  ): Promise<void> {
    const content = message.content.toString();
    let retryCount = (message.properties.headers?.['x-retry-count'] as number) || 0;

    try {
      const parsed = JSON.parse(content);
      const correlationId = parsed.correlationId || parsed.messageId || 'unknown';

      this.logger.debug(`[${correlationId}] Processing error context extraction`);

      await this.processMessage(parsed.payload, correlationId);

      // Acknowledge message on success
      channel.ack(message);
      this.logger.debug(`[${correlationId}] Error context extraction completed`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error processing message (attempt ${retryCount + 1}): ${errorMsg}`, err);

      if (retryCount < RETRY_DELAYS.length) {
        // Requeue with delay using exponential backoff
        // eslint-disable-next-line security/detect-object-injection
        const delay = RETRY_DELAYS[retryCount];
        retryCount++;

        this.logger.warn(
          `Retrying message in ${delay}ms (attempt ${retryCount}/${RETRY_DELAYS.length})`,
        );

        // Nack and requeue
        channel.nack(message, false, true);

        // Wait before allowing next attempt (simple approach)
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        // Max retries exceeded, send to dead letter queue
        this.logger.error(`Message failed after ${RETRY_DELAYS.length} attempts, moving to DLQ`);

        // Log to Sentry for observability
        this.sentry.captureException(err instanceof Error ? err : new Error(errorMsg), {
          extra: {
            queue: QUEUE_NAME,
            retryCount,
            messageContent: content.substring(0, 1000), // Truncate for safety
          },
        });

        channel.nack(message, false, false);
      }
    }
  }

  /**
   * Process a message from the queue
   */
  protected async processMessage(payload: unknown, correlationId: string): Promise<void> {
    const event = payload as ErrorIngestedEvent;

    this.logger.debug(
      `[${correlationId}] Processing error.ingested event for record ${event.production_error_id}`,
    );

    // Call error context service to extract and link context
    const result = await this.errorContextService.extractAndLinkContext(
      event.production_error_id,
      correlationId,
    );

    if (result) {
      this.logger.log(
        `[${correlationId}] Successfully extracted context for error ${event.production_error_id}: ` +
          `${result.related_commits.length} commits, deployment: ${result.deployment_context?.deployment_id || 'none'}`,
      );
    } else {
      this.logger.warn(
        `[${correlationId}] Context extraction returned null for error ${event.production_error_id}`,
      );
    }
  }
}
