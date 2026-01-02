import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RabbitMQConsumerBase } from '../rabbitmq/rabbitmq-consumer.base';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { TicketIntakeService } from './ticket-intake.service';
import { IRawTaskEvent } from './interfaces';

/**
 * Ticket Intake Queue Consumer
 * FR57: Consumes messages from ticket-intake-queue
 *
 * Listens to ticket-intake-queue for task events published by Story 2.1
 * and processes them through the TicketIntakeService.
 */
@Injectable()
export class TicketIntakeConsumer extends RabbitMQConsumerBase implements OnModuleInit {
  protected readonly logger = new Logger(TicketIntakeConsumer.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly ticketIntakeService: TicketIntakeService,
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
   * Start consuming from ticket-intake-queue
   */
  async startConsuming(): Promise<void> {
    this.logger.log(`Starting consumer for ${QUEUE_NAMES.TICKET_INTAKE}`);

    try {
      const channel = this.rabbitMQService.getChannel();

      // Ensure queue exists
      await channel.assertQueue(QUEUE_NAMES.TICKET_INTAKE, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'dlx-exchange',
          'x-dead-letter-routing-key': `dlx-${QUEUE_NAMES.TICKET_INTAKE}`,
        },
      });

      // Set prefetch for controlled concurrency
      await channel.prefetch(5);

      // Start consuming
      await channel.consume(
        QUEUE_NAMES.TICKET_INTAKE,
        (message: amqp.ConsumeMessage | null) => {
          if (message) {
            this.handleMessage(message, channel);
          }
        },
        { noAck: false },
      );

      this.logger.log(`Consumer started for ${QUEUE_NAMES.TICKET_INTAKE} (prefetch: 5)`);
    } catch (_error) {
      this.logger.error(
        `Failed to start consumer: ${(_error as Error).message}`,
        (_error as Error).stack,
      );
    }
  }

  /**
   * Process a message from the queue
   */
  protected async processMessage(payload: unknown, correlationId: string): Promise<void> {
    const event = payload as IRawTaskEvent;

    this.logger.debug(`[${correlationId}] Processing message for task ${event.taskId}`);

    const result = await this.ticketIntakeService.processTaskEvent({
      ...event,
      correlationId,
    });

    this.logger.log(
      `[${correlationId}] Processed ${event.taskId}: success=${result.success}, status=${result.status}`,
    );

    if (!result.success && result.errors) {
      this.logger.warn(`[${correlationId}] Validation errors: ${result.errors.join(', ')}`);
    }
  }
}
