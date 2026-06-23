import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect } from 'amqplib';
import { QUEUE_NAMES, EXCHANGE_NAMES, ROUTING_KEYS } from './rabbitmq.config';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private connection: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private channel: any = null;

  constructor(private configService: ConfigService) {}

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
    } catch (_error) {
      this.logger.error('Failed to connect to RabbitMQ:', _error);
      // Allow application to start without RabbitMQ for debugging/development without full stack
      if (process.env.NODE_ENV !== 'test') {
        // throw _error;
        this.logger.warn('Continuing without RabbitMQ connection...');
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
      // Core execution queues
      QUEUE_NAMES.DEPLOYMENT,
      QUEUE_NAMES.MONITORING,
      QUEUE_NAMES.FIX_TICKET_CREATION,
    ];

    // Create WAIT queue for PR reminders (Story 14.2)
    // Messages wait here for variable TTL based on attempt, then dead-letter back to GITHUB_PR_REMINDER
    await this.channel.assertQueue(QUEUE_NAMES.GITHUB_PR_REMINDER_WAIT, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': '', // Default exchange
        'x-dead-letter-routing-key': QUEUE_NAMES.GITHUB_PR_REMINDER, // Route back to main queue
      },
    });

    for (const queueName of queues) {
      await this.channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': EXCHANGE_NAMES.DEAD_LETTER_EXCHANGE,
          'x-dead-letter-routing-key': `dlx-${queueName}`,
        },
        // messageTtl removed - can be set per-message if needed
      });

      this.logger.log(`Queue created: ${queueName}`);
    }

    // Create main orchestrator events exchange
    await this.channel.assertExchange(EXCHANGE_NAMES.ORCHESTRATOR_EVENTS, 'topic', {
      durable: true,
    });

    // Create production events exchange
    await this.channel.assertExchange(EXCHANGE_NAMES.PRODUCTION_EVENTS, 'topic', {
      durable: true,
    });

    // Bind fix ticket creation queue to production events exchange
    await this.channel.bindQueue(
      QUEUE_NAMES.FIX_TICKET_CREATION,
      EXCHANGE_NAMES.PRODUCTION_EVENTS,
      ROUTING_KEYS.PRODUCTION_ERROR_STORED,
    );

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
    } catch (_error) {
      this.logger.error('Error disconnecting from RabbitMQ:', _error);
    }
  }

  /**
   * Get channel for publishing/consuming
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getChannel(): any {
    if (!this.channel) {
      if (process.env.NODE_ENV !== 'test') {
        this.logger.warn('Returning MOCK RabbitMQ channel');
        return {
          assertExchange: async () => {},
          assertQueue: async () => ({ messageCount: 0, consumerCount: 0 }),
          bindQueue: async () => {},
          consume: async () => ({ consumerTag: 'mock-tag' }),
          ack: () => {},
          nack: () => {},
          checkQueue: async () => ({ messageCount: 0, consumerCount: 0 }),
          sendToQueue: () => true,
          publish: () => true,
          prefetch: () => {},
          close: async () => {},
        };
      }
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
   * AC#2: Get queue metrics for all monitored queues
   * Returns depth, rate, and oldest message age for each queue
   */
  async getQueueMetrics(): Promise<{
    'deployment-queue': { depth: number; rate: number; oldest_message_age_seconds: number };
  }> {
    if (!this.channel) {
      throw new Error('Channel not available');
    }

    const queues = ['deployment-queue'];
    const metricsMap = new Map<string, unknown>();

    for (const queueName of queues) {
      try {
        const stats = await this.getQueueStats(queueName);
        metricsMap.set(queueName, {
          depth: stats.messageCount,
          rate: 0, // Will be calculated by ObservabilityDashboardService from Execution table
          oldest_message_age_seconds: 0, // Placeholder - requires RabbitMQ Management API
        });
      } catch (_error) {
        this.logger.warn(`Failed to get stats for queue ${queueName}`, _error);
        metricsMap.set(queueName, {
          depth: 0,
          rate: 0,
          oldest_message_age_seconds: 0,
        });
      }
    }

    const metrics = Object.fromEntries(metricsMap);

    return metrics as {
      'deployment-queue': { depth: number; rate: number; oldest_message_age_seconds: number };
    };
  }

  /**
   * Ping RabbitMQ connection (for health checks)
   */
  async ping(): Promise<void> {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not available');
    }
    // Simple check - if channel exists and is usable
    await this.isHealthy();
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
      arguments: {
        'x-dead-letter-exchange': EXCHANGE_NAMES.DEAD_LETTER_EXCHANGE,
        'x-dead-letter-routing-key': `dlx-${queue}`,
      },
      // messageTtl removed - can be set per-message if needed
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

  /**
   * Publish message to an exchange
   *
   * @param exchange - Exchange name
   * @param routingKey - Routing key
   * @param message - Message payload
   * @param options - Publish options
   */
  async publishToExchange(
    exchange: string,
    routingKey: string,
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

    // Publish message
    const messageBuffer = Buffer.from(JSON.stringify(message));

    this.channel.publish(exchange, routingKey, messageBuffer, {
      persistent: options?.persistent ?? true,
      correlationId: options?.correlationId,
      headers: options?.headers,
      contentType: 'application/json',
      timestamp: Date.now(),
    });

    this.logger.debug(`Published message to ${exchange} with key ${routingKey}`);
  }
}
