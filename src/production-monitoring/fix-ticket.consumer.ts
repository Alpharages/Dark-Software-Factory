import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RabbitMQConsumerBase } from '../rabbitmq/rabbitmq-consumer.base';
import { QUEUE_NAMES, EXCHANGE_NAMES, ROUTING_KEYS } from '../rabbitmq/rabbitmq.config';
import { FixTicketService } from './fix-ticket.service';
import { ErrorStoredEvent } from './interfaces/error-stored.event';

/**
 * Fix Ticket Creation Queue Consumer
 * Consumes production error events and creates ClickUp tickets via FixTicketService
 */
@Injectable()
export class FixTicketConsumer extends RabbitMQConsumerBase implements OnModuleInit {
  protected readonly logger = new Logger(FixTicketConsumer.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly fixTicketService: FixTicketService,
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
   * Start consuming from fix-ticket-creation-queue
   */
  async startConsuming(): Promise<void> {
    this.logger.log(`Starting consumer for ${QUEUE_NAMES.FIX_TICKET_CREATION}`);

    try {
      const channel = this.rabbitMQService.getChannel();

      // Ensure queue exists and is bound to production-events exchange
      await channel.assertQueue(QUEUE_NAMES.FIX_TICKET_CREATION, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': EXCHANGE_NAMES.DEAD_LETTER_EXCHANGE,
          'x-dead-letter-routing-key': `dlx-${QUEUE_NAMES.FIX_TICKET_CREATION}`,
        },
      });

      await channel.bindQueue(
        QUEUE_NAMES.FIX_TICKET_CREATION,
        EXCHANGE_NAMES.PRODUCTION_EVENTS,
        ROUTING_KEYS.PRODUCTION_ERROR_STORED,
      );

      // Set prefetch for controlled concurrency
      await channel.prefetch(2);

      // Start consuming
      await channel.consume(
        QUEUE_NAMES.FIX_TICKET_CREATION,
        (message: amqp.ConsumeMessage | null) => {
          if (message) {
            this.handleMessage(message, channel);
          }
        },
        { noAck: false },
      );

      this.logger.log(`Consumer started for ${QUEUE_NAMES.FIX_TICKET_CREATION} (prefetch: 2)`);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      this.logger.error(`Failed to start FixTicketConsumer: ${errorMsg}`, errorStack);
    }
  }

  /**
   * Process a message from the queue
   */
  protected async processMessage(payload: unknown, correlationId: string): Promise<void> {
    const event = payload as ErrorStoredEvent;

    // Use correlation_id from event if available, otherwise use message correlation_id
    const eventCorrelationId = event.correlation_id || correlationId;

    this.logger.debug(
      `[${eventCorrelationId}] Processing error event for record ${event.production_error_id}`,
    );

    const result = await this.fixTicketService.processError(
      event.production_error_id,
      eventCorrelationId,
      event.execution_id,
    );

    if (result) {
      this.logger.log(
        `[${eventCorrelationId}] Successfully processed error ${event.production_error_id}. Ticket: ${result}`,
      );
    } else {
      this.logger.log(
        `[${eventCorrelationId}] Error ${event.production_error_id} processed: no ticket created (skipped or error).`,
      );
    }
  }
}
