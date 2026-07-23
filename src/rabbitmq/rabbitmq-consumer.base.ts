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
    } catch (_error) {
      this.logger.error(`Error processing message ${messageId}:`, _error);
      // Reject without requeue → dead-letter queue handles retries.
      this.settle(() => channel.nack(message, false, false), messageId, 'nack');
      return;
    }

    // Ack OUTSIDE the processing try: if the channel closed while processMessage
    // ran (connection dropped/reconnected), ack throws IllegalOperationError. That
    // must not be mistaken for a processing failure — the work already succeeded,
    // and the broker will redeliver this unacked message after reconnect.
    this.settle(() => channel.ack(message), messageId, 'ack');
    this.logger.log(`Message ${messageId} processed successfully`);
  }

  /**
   * Run a channel ack/nack, swallowing "Channel closed" (IllegalOperationError)
   * from a connection drop. An unacked message is redelivered on reconnect, so a
   * failed ack/nack is safe to log rather than throw.
   */
  private settle(op: () => void, messageId: string | undefined, kind: 'ack' | 'nack'): void {
    try {
      op();
    } catch (error) {
      this.logger.warn(
        `Could not ${kind} message ${messageId} (channel closed?); will be redelivered: ${error}`,
      );
    }
  }
}
