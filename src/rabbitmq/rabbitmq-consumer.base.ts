import { Logger } from '@nestjs/common';
import * as amqp from 'amqplib';

export abstract class RabbitMQConsumerBase {
  protected abstract readonly logger: Logger;

  /**
   * Abstract method to process message
   * Subclasses must implement this
   */
  protected abstract processMessage(payload: unknown, correlationId: string): Promise<void>;

  /**
   * Handle incoming message with error handling
   */
  async handleMessage(message: amqp.ConsumeMessage, channel: amqp.Channel): Promise<void> {
    const content = message.content.toString();
    let messageId: string | undefined;
    let correlationId: string | undefined;

    try {
      const parsed = JSON.parse(content);
      messageId = parsed.messageId;
      correlationId = (parsed.correlationId || messageId || '') as string;

      this.logger.log(`Processing message ${messageId}`);

      // Process the message
      await this.processMessage(parsed.payload, correlationId);

      // Acknowledge message (manual ack)
      channel.ack(message);
      this.logger.log(`Message ${messageId} processed successfully`);
    } catch (_error) {
      this.logger.error(`Error processing message ${messageId}:`, _error);

      // Check retry count (stored in message headers)
      const retryCount = (message.properties.headers?.['x-retry-count'] as number) || 0;
      const maxRetries = 3;

      if (retryCount < maxRetries) {
        // Increment retry count and requeue
        this.logger.warn(`Retrying message ${messageId} (attempt ${retryCount + 1}/${maxRetries})`);

        // Reject and requeue with incremented retry count
        // Note: This requires manually republishing with updated headers
        // For now, send to DLQ which will handle retries
        channel.nack(message, false, false);
      } else {
        // Max retries exceeded, send to dead letter queue
        this.logger.error(
          `Message ${messageId} failed after ${maxRetries} attempts, moving to DLQ`,
        );
        channel.nack(message, false, false);
      }
    }
  }
}
