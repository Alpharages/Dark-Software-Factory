import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { RabbitMQConsumerBase } from '../../rabbitmq/rabbitmq-consumer.base';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { PRReminderService, PRReminderPayload } from './pr-reminder.service';
import { QUEUE_NAMES } from '../../rabbitmq/rabbitmq.config';
import * as amqp from 'amqplib';

@Injectable()
export class PRReminderConsumer
  extends RabbitMQConsumerBase
  implements OnModuleInit, OnModuleDestroy
{
  protected readonly logger = new Logger(PRReminderConsumer.name);
  protected readonly queueName = QUEUE_NAMES.GITHUB_PR_REMINDER;

  private channel: amqp.Channel | null = null;
  private consumerTag: string | null = null;

  constructor(
    protected readonly rabbitMQ: RabbitMQService,
    private readonly reminderService: PRReminderService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      const channel = this.rabbitMQ.getChannel();
      this.channel = channel;

      await channel.prefetch(5); // Process a few reminders in parallel
      await channel.assertQueue(this.queueName, { durable: true });

      const result = await channel.consume(
        this.queueName,
        async (msg: amqp.ConsumeMessage | null) => {
          if (msg) {
            await this.handleMessage(msg, channel);
          }
        },
        { noAck: false },
      );

      this.consumerTag = result.consumerTag;
      this.logger.log(`PR reminder consumer started - listening on ${this.queueName}`);
    } catch (_error) {
      this.logger.error('Failed to initialize PR reminder consumer', _error);
      throw _error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.channel && this.consumerTag) {
      await this.channel.cancel(this.consumerTag);
      this.logger.log('PR reminder consumer stopped');
    }
  }

  protected async processMessage(payload: PRReminderPayload, correlationId: string): Promise<void> {
    this.logger.log(
      `[${correlationId}] Processing PR reminder for ${payload.repository}#${payload.prNumber} (attempt ${payload.attempt})`,
    );
    await this.reminderService.processReminder(payload);
  }
}
