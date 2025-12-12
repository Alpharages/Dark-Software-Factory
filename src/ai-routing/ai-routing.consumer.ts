import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RabbitMQConsumerBase } from '../rabbitmq/rabbitmq-consumer.base';
import * as amqp from 'amqplib';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { AIRoutingService } from './ai-routing.service';
import { IRoutingRequest } from './interfaces';

/**
 * AI Routing Queue Consumer
 *
 * Consumes from: ai-routing-queue (published by Story 2.2)
 * Publishes to: ai-execution-queue (consumed by Story 2.4)
 */
@Injectable()
export class AIRoutingConsumer extends RabbitMQConsumerBase implements OnModuleInit {
  protected readonly logger = new Logger(AIRoutingConsumer.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly aiRoutingService: AIRoutingService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.startConsuming();
  }

  async startConsuming(): Promise<void> {
    this.logger.log(`Starting consumer for ${QUEUE_NAMES.AI_ROUTING}`);

    try {
      const channel = this.rabbitMQService.getChannel();

      // Ensure queue exists (config must match rabbitmq.service.ts)
      await channel.assertQueue(QUEUE_NAMES.AI_ROUTING, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'dlx-exchange',
          'x-dead-letter-routing-key': `dlx-${QUEUE_NAMES.AI_ROUTING}`,
        },
      });

      // Set prefetch for controlled concurrency (process 3 at a time)
      await channel.prefetch(3);

      // Start consuming
      await channel.consume(
        QUEUE_NAMES.AI_ROUTING,
        (message: amqp.ConsumeMessage | null) => {
          if (message) {
            this.handleMessage(message, channel);
          }
        },
        { noAck: false },
      );

      this.logger.log(`Consumer started for ${QUEUE_NAMES.AI_ROUTING}`);
    } catch (error) {
      this.logger.error(`Failed to start consumer: ${(error as Error).message}`);
    }
  }

  protected async processMessage(payload: unknown, correlationId: string): Promise<void> {
    const request = payload as IRoutingRequest;

    this.logger.debug(
      `[${correlationId}] Processing routing request for ticket ${request.ticketId}`,
    );

    const decision = await this.aiRoutingService.routeTicket({
      ...request,
      correlationId,
    });

    this.logger.log(
      `[${correlationId}] Routing complete for ${request.ticketId}: ` +
        `provider=${decision.selectedProvider}, score=${decision.complexityScore}`,
    );
  }
}
