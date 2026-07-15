import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RabbitMQConsumerBase } from '../rabbitmq/rabbitmq-consumer.base';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { TicketIntakeService } from './ticket-intake.service';
import { ITaskEvent } from './dto';
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
      // QA: hardcoded to 1 so at most one execution runs at a time; the rest wait
      // in the queue until a slot frees. (Temporary — see report §3.5: make this a
      // configurable global + per-project setting.)
      await channel.prefetch(1);

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

      this.logger.log(`Consumer started for ${QUEUE_NAMES.TICKET_INTAKE} (prefetch: 1)`);
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
    // Dependency auto-resume: when a blocker completes, DependencyManagerService
    // publishes a bare { ticket_id, reason: 'dependencies_resolved' } signal — NOT a
    // task event. Route it to the guarded re-dispatch; the intake parser below would
    // otherwise read an absent `taskId`/`externalId` and silently drop the resume.
    const resume = payload as { reason?: string; ticket_id?: string };
    if (resume.reason === 'dependencies_resolved' && resume.ticket_id) {
      await this.ticketIntakeService.resumeBlockedTicket(resume.ticket_id, correlationId);
      return;
    }

    const event = payload as IRawTaskEvent | ITaskEvent;
    const taskId = 'externalId' in event ? event.externalId : event.taskId;

    if (!taskId) {
      throw new Error('Ticket intake message is missing taskId/externalId');
    }

    this.logger.debug(`[${correlationId}] Processing message for task ${taskId}`);

    const result =
      'externalId' in event
        ? await this.ticketIntakeService.processTaskEvent({ ...event, correlationId })
        : await this.ticketIntakeService.processTaskEvent({ ...event, correlationId });

    this.logger.log(
      `[${correlationId}] Processed ${taskId}: success=${result.success}, status=${result.status}`,
    );

    if (!result.success && result.errors) {
      this.logger.warn(`[${correlationId}] Validation errors: ${result.errors.join(', ')}`);
    }
  }
}
