import { Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import { RabbitMQConsumerBase } from './rabbitmq-consumer.base';

class TestConsumer extends RabbitMQConsumerBase {
  protected readonly logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  public shouldThrow = false;
  protected async processMessage(): Promise<void> {
    if (this.shouldThrow) throw new Error('processing failed');
  }
}

const msg = (payload: unknown): amqp.ConsumeMessage =>
  ({
    content: Buffer.from(JSON.stringify({ messageId: 'm1', payload })),
    properties: { headers: {} },
  }) as unknown as amqp.ConsumeMessage;

describe('RabbitMQConsumerBase.handleMessage', () => {
  let consumer: TestConsumer;
  let channel: { ack: jest.Mock; nack: jest.Mock };

  beforeEach(() => {
    consumer = new TestConsumer();
    channel = { ack: jest.fn(), nack: jest.fn() };
  });

  it('acks a successfully processed message and never nacks', async () => {
    await consumer.handleMessage(msg({ ok: true }), channel as unknown as amqp.Channel);
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('nacks (once) when processing throws, and does not ack', async () => {
    consumer.shouldThrow = true;
    await consumer.handleMessage(msg({}), channel as unknown as amqp.Channel);
    expect(channel.nack).toHaveBeenCalledTimes(1);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('does NOT nack (or rethrow) when ack fails on a closed channel', async () => {
    channel.ack.mockImplementation(() => {
      throw new Error('Channel closed'); // IllegalOperationError shape
    });
    // The whole point: a failed ack must not be treated as a processing failure.
    await expect(
      consumer.handleMessage(msg({ ok: true }), channel as unknown as amqp.Channel),
    ).resolves.toBeUndefined();
    expect(channel.nack).not.toHaveBeenCalled();
  });
});
