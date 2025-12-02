import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';
import { QUEUE_NAMES, EXCHANGE_NAMES } from './rabbitmq.config';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private connection: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private channel: any = null;

  constructor(private configService: ConfigService) { }

  async onModuleInit() {
    await this.connect();
    await this.setupQueuesAndExchanges();
    this.logger.log('✅ RabbitMQ connected and configured');
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  /**
   * Establish connection to RabbitMQ
   */
  private async connect(): Promise<void> {
    try {
      const url = this.configService.get<string>('RABBITMQ_URL');
      if (!url) {
        throw new Error('RABBITMQ_URL not configured');
      }

      this.connection = await connect(url);
      this.channel = await this.connection.createChannel();

      // Handle connection errors
      this.connection.on('error', (err: unknown) => {
        this.logger.error('RabbitMQ connection error:', err);
      });

      this.connection.on('close', () => {
        this.logger.warn('RabbitMQ connection closed, attempting reconnect...');
        setTimeout(() => this.connect(), 5000); // Reconnect after 5 seconds
      });

      this.logger.log('RabbitMQ connection established');
    } catch (error) {
      this.logger.error('Failed to connect to RabbitMQ:', error);
      if (process.env.NODE_ENV !== 'test') {
        throw error;
      }
    }
  }

  /**
   * Setup queues, exchanges, and bindings
   */
  private async setupQueuesAndExchanges(): Promise<void> {
    if (!this.channel) {
      return;
    }

    // Create dead letter exchange
    await this.channel.assertExchange(EXCHANGE_NAMES.DEAD_LETTER_EXCHANGE, 'direct', {
      durable: true,
    });

    // Create dead letter queue
    await this.channel.assertQueue(QUEUE_NAMES.DEAD_LETTER, {
      durable: true,
    });

    // Bind dead letter queue to exchange
    await this.channel.bindQueue(QUEUE_NAMES.DEAD_LETTER, EXCHANGE_NAMES.DEAD_LETTER_EXCHANGE, '#');

    // Create main queues with dead letter configuration
    const queues = [
      // Story 2.1-2.2: Ticket intake pipeline
      QUEUE_NAMES.TICKET_INTAKE,
      QUEUE_NAMES.AI_ROUTING,
      // Core execution queues
      QUEUE_NAMES.AI_EXECUTION,
      QUEUE_NAMES.QA_CHECK,
      QUEUE_NAMES.DEPLOYMENT,
      QUEUE_NAMES.MONITORING,
    ];

    // Create wait queue for AI routing retries (Story 2.3 fix)
    // Messages here wait for 5 minutes (TTL) then dead-letter back to AI_ROUTING
    await this.channel.assertQueue(QUEUE_NAMES.AI_ROUTING_WAIT, {
      durable: true,
      deadLetterExchange: '', // Default exchange
      deadLetterRoutingKey: QUEUE_NAMES.AI_ROUTING, // Route back to main queue
      messageTtl: 300000, // 5 minutes
    });
    this.logger.log(`Queue created: ${QUEUE_NAMES.AI_ROUTING_WAIT} (TTL: 5m)`);

    for (const queueName of queues) {
      await this.channel.assertQueue(queueName, {
        durable: true,
        deadLetterExchange: EXCHANGE_NAMES.DEAD_LETTER_EXCHANGE,
        deadLetterRoutingKey: `dlx-${queueName}`,
        messageTtl: 3600000,
      });

      this.logger.log(`Queue created: ${queueName}`);
    }

    // Create main orchestrator events exchange
    await this.channel.assertExchange(EXCHANGE_NAMES.ORCHESTRATOR_EVENTS, 'topic', {
      durable: true,
    });

    this.logger.log('All queues and exchanges configured');
  }

  /**
   * Disconnect from RabbitMQ
   */
  private async disconnect(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }

      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }

      this.logger.log('🔌 RabbitMQ disconnected');
    } catch (error) {
      this.logger.error('Error disconnecting from RabbitMQ:', error);
    }
  }

  /**
   * Get channel for publishing/consuming
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getChannel(): any {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not available');
    }
    return this.channel;
  }

  /**
   * Health check for RabbitMQ connection
   */
  async isHealthy(): Promise<boolean> {
    return this.connection !== null && this.channel !== null;
  }

  /**
   * Get queue statistics (for monitoring)
   */
  async getQueueStats(queueName: string): Promise<{
    messageCount: number;
    consumerCount: number;
  }> {
    if (!this.channel) {
      throw new Error('Channel not available');
    }

    const queue = await this.channel.checkQueue(queueName);
    return {
      messageCount: queue.messageCount,
      consumerCount: queue.consumerCount,
    };
  }

  /**
   * Publish message to a specific queue
   *
   * Per Story 2.1: Webhook events published to ticket-intake-queue
   *
   * @param queue - Queue name
   * @param message - Message payload
   * @param options - Publish options
   */
  async publishToQueue(
    queue: string,
    message: unknown,
    options?: {
      correlationId?: string;
      persistent?: boolean;
      headers?: Record<string, string>;
    },
  ): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not initialized');
    }

    // Ensure queue exists
    await this.channel.assertQueue(queue, {
      durable: true,
      deadLetterExchange: EXCHANGE_NAMES.DEAD_LETTER_EXCHANGE,
      deadLetterRoutingKey: `dlx-${queue}`,
      messageTtl: 3600000, // 1 hour
    });

    // Publish message
    const messageBuffer = Buffer.from(JSON.stringify(message));

    this.channel.sendToQueue(queue, messageBuffer, {
      persistent: options?.persistent ?? true,
      correlationId: options?.correlationId,
      headers: options?.headers,
      contentType: 'application/json',
      timestamp: Date.now(),
    });

    this.logger.debug(`Published message to ${queue}`);
  }
}
