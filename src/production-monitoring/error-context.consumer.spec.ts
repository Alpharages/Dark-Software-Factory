/**
 * Error Context Consumer Unit Tests
 * Story 9-U-4: Error Context Extraction & Linking
 */

import { Test, TestingModule } from '@nestjs/testing';
import * as amqp from 'amqplib';
import { ErrorContextConsumer } from './error-context.consumer';
import { ErrorContextService } from './error-context.service';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { SentryService } from '@/common/sentry/sentry.service';

describe('ErrorContextConsumer', () => {
  let consumer: ErrorContextConsumer;
  let errorContextService: jest.Mocked<ErrorContextService>;

  let _rabbitMQService: jest.Mocked<RabbitMQService>;
  let sentryService: jest.Mocked<SentryService>;

  const mockChannel = {
    assertQueue: jest.fn().mockResolvedValue({}),
    bindQueue: jest.fn().mockResolvedValue({}),
    prefetch: jest.fn().mockResolvedValue({}),
    consume: jest.fn().mockResolvedValue({ consumerTag: 'test-tag' }),
    ack: jest.fn(),
    nack: jest.fn(),
  };

  const mockRabbitMQService = {
    getChannel: jest.fn().mockReturnValue(mockChannel),
  };

  const mockErrorContextService = {
    extractAndLinkContext: jest.fn(),
  };

  const mockSentryService = {
    captureException: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ErrorContextConsumer,
        { provide: ErrorContextService, useValue: mockErrorContextService },
        { provide: RabbitMQService, useValue: mockRabbitMQService },
        { provide: SentryService, useValue: mockSentryService },
      ],
    }).compile();

    consumer = module.get<ErrorContextConsumer>(ErrorContextConsumer);
    errorContextService = module.get(ErrorContextService);
    _rabbitMQService = module.get(RabbitMQService);
    sentryService = module.get(SentryService);

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should start consuming after delay', async () => {
      jest.useFakeTimers();

      const startConsumingSpy = jest.spyOn(consumer, 'startConsuming').mockResolvedValue();

      const initPromise = consumer.onModuleInit();
      jest.advanceTimersByTime(2000);
      await initPromise;

      expect(startConsumingSpy).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('startConsuming', () => {
    it('should setup queue and bindings correctly', async () => {
      await consumer.startConsuming();

      expect(mockChannel.assertQueue).toHaveBeenCalledWith('error_context_extraction_queue', {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'dlx-exchange',
          'x-dead-letter-routing-key': 'dlx-error_context_extraction_queue',
        },
      });

      expect(mockChannel.bindQueue).toHaveBeenCalledWith(
        'error_context_extraction_queue',
        'production-events',
        'error.ingested',
      );

      expect(mockChannel.prefetch).toHaveBeenCalledWith(2);
      expect(mockChannel.consume).toHaveBeenCalledWith(
        'error_context_extraction_queue',
        expect.any(Function),
        { noAck: false },
      );
    });

    it('should handle startup errors gracefully', async () => {
      mockChannel.assertQueue.mockRejectedValueOnce(new Error('Connection failed'));

      await consumer.startConsuming();

      // Should not throw, just log error
      expect(mockChannel.assertQueue).toHaveBeenCalled();
    });
  });

  describe('processMessage', () => {
    it('should process error.ingested event successfully', async () => {
      const event = {
        production_error_id: 'error-123',
        application: 'api-service',
        occurred_at: new Date(),
      };

      mockErrorContextService.extractAndLinkContext.mockResolvedValue({
        id: 'error-123',
        application: 'api-service',
        error_type: 'TypeError',
        error_message: 'Test error',
        related_commits: [],
        affected_users: 1,
        occurrence_count: 1,
      });

      await (
        consumer as unknown as {
          processMessage: (payload: unknown, correlationId: string) => Promise<void>;
        }
      ).processMessage(event, 'corr-123');

      expect(errorContextService.extractAndLinkContext).toHaveBeenCalledWith(
        'error-123',
        'corr-123',
      );
    });

    it('should handle null result from service', async () => {
      const event = {
        production_error_id: 'error-123',
        application: 'api-service',
        occurred_at: new Date(),
      };

      mockErrorContextService.extractAndLinkContext.mockResolvedValue(null);

      await (
        consumer as unknown as {
          processMessage: (payload: unknown, correlationId: string) => Promise<void>;
        }
      ).processMessage(event, 'corr-123');

      expect(errorContextService.extractAndLinkContext).toHaveBeenCalledWith(
        'error-123',
        'corr-123',
      );
    });
  });

  describe('handleMessageWithRetry', () => {
    const createMockMessage = (payload: unknown, retryCount = 0): amqp.ConsumeMessage => {
      const content = Buffer.from(
        JSON.stringify({
          payload,
          correlationId: 'corr-123',
          messageId: 'msg-123',
        }),
      );

      return {
        content,
        fields: {} as amqp.MessageFields,
        properties: {
          headers: { 'x-retry-count': retryCount },
          messageId: 'msg-123',
          contentType: 'application/json',
          contentEncoding: 'utf-8',
          deliveryMode: 2,
          priority: 0,
          correlationId: '',
          replyTo: '',
          expiration: '',
          timestamp: 0,
          type: '',
          userId: '',
          appId: '',
          clusterId: '',
        },
      } as unknown as amqp.ConsumeMessage;
    };

    it('should acknowledge message on success', async () => {
      const event = {
        production_error_id: 'error-123',
        application: 'api-service',
        occurred_at: new Date(),
      };

      mockErrorContextService.extractAndLinkContext.mockResolvedValue({
        id: 'error-123',
        application: 'api-service',
        error_type: 'TypeError',
        error_message: 'Test',
        related_commits: [],
        affected_users: 1,
        occurrence_count: 1,
      });

      const message = createMockMessage(event);

      await (
        consumer as unknown as {
          handleMessageWithRetry: (
            message: amqp.ConsumeMessage,
            channel: amqp.Channel,
          ) => Promise<void>;
        }
      ).handleMessageWithRetry(message, mockChannel as unknown as amqp.Channel);

      expect(mockChannel.ack).toHaveBeenCalledWith(message);
      expect(mockChannel.nack).not.toHaveBeenCalled();
    });

    it('should retry with exponential backoff on failure', async () => {
      const event = {
        production_error_id: 'error-123',
        application: 'api-service',
        occurred_at: new Date(),
      };

      mockErrorContextService.extractAndLinkContext.mockRejectedValue(new Error('Service error'));

      const message = createMockMessage(event, 0);

      await (
        consumer as unknown as {
          handleMessageWithRetry: (
            message: amqp.ConsumeMessage,
            channel: amqp.Channel,
          ) => Promise<void>;
        }
      ).handleMessageWithRetry(message, mockChannel as unknown as amqp.Channel);

      // Should nack with requeue for retry
      expect(mockChannel.nack).toHaveBeenCalledWith(message, false, true);
      expect(mockChannel.ack).not.toHaveBeenCalled();
    });

    it('should send to DLQ after max retries', async () => {
      const event = {
        production_error_id: 'error-123',
        application: 'api-service',
        occurred_at: new Date(),
      };

      mockErrorContextService.extractAndLinkContext.mockRejectedValue(new Error('Service error'));

      // 3 retries = max (index 0, 1, 2)
      const message = createMockMessage(event, 3);

      await (
        consumer as unknown as {
          handleMessageWithRetry: (
            message: amqp.ConsumeMessage,
            channel: amqp.Channel,
          ) => Promise<void>;
        }
      ).handleMessageWithRetry(message, mockChannel as unknown as amqp.Channel);

      // Should nack without requeue (send to DLQ)
      expect(mockChannel.nack).toHaveBeenCalledWith(message, false, false);
      expect(sentryService.captureException).toHaveBeenCalled();
    });

    it('should handle invalid JSON in message', async () => {
      const message = {
        content: Buffer.from('invalid json'),
        fields: {} as amqp.MessageFields,
        properties: {
          headers: {},
          messageId: 'msg-123',
          contentType: 'application/json',
          contentEncoding: 'utf-8',
          deliveryMode: 2,
          priority: 0,
          correlationId: '',
          replyTo: '',
          expiration: '',
          timestamp: 0,
          type: '',
          userId: '',
          appId: '',
          clusterId: '',
        },
      } as unknown as amqp.ConsumeMessage;

      await (
        consumer as unknown as {
          handleMessageWithRetry: (
            message: amqp.ConsumeMessage,
            channel: amqp.Channel,
          ) => Promise<void>;
        }
      ).handleMessageWithRetry(message, mockChannel as unknown as amqp.Channel);

      expect(mockChannel.nack).toHaveBeenCalled();
    });
  });
});
