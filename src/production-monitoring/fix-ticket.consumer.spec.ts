import { Test, TestingModule } from '@nestjs/testing';
import { FixTicketConsumer } from './fix-ticket.consumer';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { FixTicketService } from './fix-ticket.service';
import { QUEUE_NAMES, EXCHANGE_NAMES, ROUTING_KEYS } from '../rabbitmq/rabbitmq.config';
import { ErrorSeverity } from '@/prisma/enums';

describe('FixTicketConsumer', () => {
  let consumer: FixTicketConsumer;
  let fixTicketService: FixTicketService;

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

  const mockFixTicketService = {
    processError: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FixTicketConsumer,
        { provide: RabbitMQService, useValue: mockRabbitMQService },
        { provide: FixTicketService, useValue: mockFixTicketService },
      ],
    }).compile();

    consumer = module.get<FixTicketConsumer>(FixTicketConsumer);
    fixTicketService = module.get<FixTicketService>(FixTicketService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(consumer).toBeDefined();
  });

  describe('startConsuming', () => {
    it('should setup queue, bindings and start consuming', async () => {
      await consumer.startConsuming();

      expect(mockChannel.assertQueue).toHaveBeenCalledWith(
        QUEUE_NAMES.FIX_TICKET_CREATION,
        expect.any(Object),
      );
      expect(mockChannel.bindQueue).toHaveBeenCalledWith(
        QUEUE_NAMES.FIX_TICKET_CREATION,
        EXCHANGE_NAMES.PRODUCTION_EVENTS,
        ROUTING_KEYS.PRODUCTION_ERROR_STORED,
      );
      expect(mockChannel.prefetch).toHaveBeenCalledWith(2);
      expect(mockChannel.consume).toHaveBeenCalledWith(
        QUEUE_NAMES.FIX_TICKET_CREATION,
        expect.any(Function),
        { noAck: false },
      );
    });

    it('should log error if startConsuming fails', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loggerSpy = jest.spyOn((consumer as any).logger, 'error');
      mockChannel.assertQueue.mockRejectedValue(new Error('Connect failed'));

      await consumer.startConsuming();

      expect(loggerSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to start FixTicketConsumer: Connect failed'),
        expect.any(String),
      );
    });
  });

  describe('processMessage', () => {
    it('should call fixTicketService.processError with the record ID', async () => {
      const payload = {
        production_error_id: 'error-123',
        application: 'TestApp',
        severity: ErrorSeverity.HIGH,
        occurred_at: new Date(),
      };

      // Accessing protected method for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (consumer as any).processMessage(payload, 'corr-1');

      expect(fixTicketService.processError).toHaveBeenCalledWith('error-123', 'corr-1', undefined);
    });
  });
});
