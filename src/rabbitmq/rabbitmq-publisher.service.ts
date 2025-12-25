import { Injectable, Logger } from '@nestjs/common';
import { RabbitMQService } from './rabbitmq.service';
import { v4 as uuidv4 } from 'uuid';

export interface MessagePayload {
  messageId?: string;
  timestamp?: string;
  correlationId?: string;
  payload: unknown;
}

@Injectable()
export class RabbitMQPublisherService {
  private readonly logger = new Logger(RabbitMQPublisherService.name);

  constructor(private rabbitMQService: RabbitMQService) {}

  /**
   * Publish message to a queue
   */
  async publishToQueue(
    queueName: string,
    payload: unknown,
    correlationId?: string,
    delay?: number,
    expiration?: number,
  ): Promise<boolean> {
    try {
      const channel = this.rabbitMQService.getChannel();

      const message: MessagePayload = {
        messageId: uuidv4(),
        timestamp: new Date().toISOString(),
        correlationId: correlationId || uuidv4(),
        payload,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const options: any = {
        persistent: true, // Survive broker restarts
        contentType: 'application/json',
        correlationId: message.correlationId,
        messageId: message.messageId,
        timestamp: Date.now(),
      };

      if (delay && delay > 0) {
        options.headers = { 'x-delay': delay };
      }

      if (expiration && expiration > 0) {
        options.expiration = expiration.toString();
      }

      const sent = channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), options);

      if (sent) {
        this.logger.debug(`Message published to ${queueName}: ${message.messageId}`);
      } else {
        this.logger.warn(`Failed to publish to ${queueName} (queue full?)`);
      }

      return sent;
    } catch (error) {
      this.logger.error(`Error publishing to ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Publish message to exchange with routing key
   */
  async publishToExchange(
    exchangeName: string,
    routingKey: string,
    payload: unknown,
    correlationId?: string,
  ): Promise<boolean> {
    try {
      const channel = this.rabbitMQService.getChannel();

      const message: MessagePayload = {
        messageId: uuidv4(),
        timestamp: new Date().toISOString(),
        correlationId: correlationId || uuidv4(),
        payload,
      };

      const sent = channel.publish(exchangeName, routingKey, Buffer.from(JSON.stringify(message)), {
        persistent: true,
        contentType: 'application/json',
        correlationId: message.correlationId,
        messageId: message.messageId,
        timestamp: Date.now(),
      });

      if (sent) {
        this.logger.debug(
          `Message published to exchange ${exchangeName} (${routingKey}): ${message.messageId}`,
        );
      }

      return sent;
    } catch (error) {
      this.logger.error(`Error publishing to exchange ${exchangeName}:`, error);
      throw error;
    }
  }

  /**
   * Publish with retry logic (3 attempts with exponential backoff)
   */
  async publishWithRetry(
    queueName: string,
    payload: unknown,
    maxRetries: number = 3,
    correlationId?: string,
  ): Promise<boolean> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.publishToQueue(queueName, payload, correlationId);
        if (result) {
          return true;
        }
      } catch (error) {
        lastError = error as Error;
        this.logger.warn(`Publish attempt ${attempt}/${maxRetries} failed:`, error);

        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = Math.pow(2, attempt - 1) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // If all retries returned false (queue full) or threw errors
    throw new Error(
      `Failed to publish after ${maxRetries} attempts: ${lastError ? lastError.message : 'Queue full or unavailable'}`,
    );
  }
}
