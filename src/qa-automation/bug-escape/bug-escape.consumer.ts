import { Injectable, OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { BugEscapeService } from './bug-escape.service';
import { LoggerService } from '@/common/logger';
import { ProductionErrorDetectedEvent } from './interfaces/production-error-detected.event';

@Injectable()
export class BugEscapeConsumer implements OnModuleInit {
  constructor(
    private readonly bugEscapeService: BugEscapeService,
    private readonly rabbitMQService: RabbitMQService,
    private readonly logger: LoggerService,
  ) {}

  async onModuleInit() {
    this.logger.log('Initializing BugEscapeConsumer subscription...', 'BugEscapeConsumer');
    try {
      const channel = this.rabbitMQService.getChannel();
      // Assert Exchange/Queue and Bind
      const exchange = 'production_events';
      const queueName = 'bug_escape_queue';
      const routingKey = 'error.detected';

      await channel.assertExchange(exchange, 'topic', { durable: true });
      await channel.assertQueue(queueName, { durable: true });
      await channel.bindQueue(queueName, exchange, routingKey);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await channel.consume(queueName, async (msg: Record<string, any> | null) => {
        if (msg) {
          try {
            const content = JSON.parse(msg.content.toString()) as ProductionErrorDetectedEvent;
            this.logger.debug(
              `Received production error event: ${content.production_error_id}`,
              'BugEscapeConsumer',
            );
            await this.handleProductionError(content);
            channel.ack(msg);
          } catch (err) {
            this.logger.error(
              `Error processing message: ${(err as Error).message}`,
              (err as Error).stack,
              'BugEscapeConsumer',
            );
            // Nack with requeue=false to dead letter or just ack if unrecoverable
            channel.nack(msg, false, false);
          }
        }
      });
    } catch (err) {
      this.logger.error(
        `Failed to setup RabbitMQ subscription: ${(err as Error).message}`,
        (err as Error).stack,
        'BugEscapeConsumer',
      );
    }
  }

  async handleProductionError(event: ProductionErrorDetectedEvent) {
    this.logger.log(
      `Processing production error event: ${event.production_error_id}`,
      'BugEscapeConsumer',
    );

    try {
      // Auto-linking logic:
      // If event has ticket_id, use it.
      // Else, we might need a Ticket matching service.
      // For MVP, if no ticket_id, we log warning and skip (or create placeholder if we supported it).

      if (!event.ticket_id) {
        this.logger.warn(
          `Skipping bug escape creation for ${event.production_error_id}: No ticket_id provided`,
        );
        return;
      }

      await this.bugEscapeService.createEscape(
        event.production_error_id,
        event.ticket_id,
        null, // execution_id - Service will try to resolve
        null, // qa_result_id - Service will try to resolve
        null, // review_queue_id - Service will try to resolve
      );
    } catch (error: unknown) {
      const err = error as Error;
      this.logger.error(
        `Failed to process bug escape for error ${event.production_error_id}: ${err.message}`,
      );
    }
  }
}
