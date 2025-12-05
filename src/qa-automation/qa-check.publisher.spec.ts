/**
 * QaCheckPublisher Unit Tests
 * Story 3.7: RabbitMQ QA Queue Processing
 */

import { Test, TestingModule } from '@nestjs/testing';
import { QaCheckPublisher } from './qa-check.publisher';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { LoggerService } from '../common/logger/logger.service';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { ICodeFile } from './interfaces';

describe('QaCheckPublisher', () => {
  let publisher: QaCheckPublisher;
  let rabbitMQPublisher: jest.Mocked<RabbitMQPublisherService>;
  let logger: jest.Mocked<LoggerService>;

  beforeEach(async () => {
    const mockRabbitMQPublisher = {
      publishWithRetry: jest.fn().mockResolvedValue(true),
    };

    const mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QaCheckPublisher,
        { provide: RabbitMQPublisherService, useValue: mockRabbitMQPublisher },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile();

    publisher = module.get<QaCheckPublisher>(QaCheckPublisher);
    rabbitMQPublisher = module.get(RabbitMQPublisherService);
    logger = module.get(LoggerService);
  });

  it('should be defined', () => {
    expect(publisher).toBeDefined();
  });

  describe('publishQaCheck', () => {
    const executionId = 'exec-123';
    const ticketId = 'ticket-456';
    const projectId = 'proj-789';
    const correlationId = 'corr-abc';
    const aiProvider = 'cursor';
    const codeFiles: ICodeFile[] = [
      { path: 'src/test.ts', content: 'export const test = 1;', language: 'typescript' },
    ];

    it('should publish QA check message to qa-check-queue', async () => {
      const result = await publisher.publishQaCheck(
        executionId,
        ticketId,
        projectId,
        codeFiles,
        aiProvider,
        correlationId,
      );

      expect(result).toBe(true);
      expect(rabbitMQPublisher.publishWithRetry).toHaveBeenCalledWith(
        QUEUE_NAMES.QA_CHECK,
        expect.objectContaining({
          executionId,
          ticketId,
          projectId,
          codeFiles,
          aiProvider,
          correlationId,
          completedAt: expect.any(String),
        }),
        3,
        correlationId,
      );
    });

    it('should log publishing action', async () => {
      await publisher.publishQaCheck(
        executionId,
        ticketId,
        projectId,
        codeFiles,
        aiProvider,
        correlationId,
      );

      expect(logger.log).toHaveBeenCalledWith(
        `Publishing QA check for execution ${executionId}`,
        expect.objectContaining({
          context: 'QaCheckPublisher',
          correlationId,
          ticketId,
          fileCount: 1,
        }),
      );
    });

    it('should handle publish failure', async () => {
      rabbitMQPublisher.publishWithRetry.mockResolvedValue(false);

      const result = await publisher.publishQaCheck(
        executionId,
        ticketId,
        projectId,
        codeFiles,
        aiProvider,
        correlationId,
      );

      expect(result).toBe(false);
    });

    it('should include completedAt timestamp', async () => {
      const beforePublish = new Date().toISOString();

      await publisher.publishQaCheck(
        executionId,
        ticketId,
        projectId,
        codeFiles,
        aiProvider,
        correlationId,
      );

      const publishedMessage = rabbitMQPublisher.publishWithRetry.mock.calls[0][1] as {
        completedAt: string;
      };
      expect(publishedMessage.completedAt).toBeDefined();
      expect(new Date(publishedMessage.completedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(beforePublish).getTime(),
      );
    });
  });
});
