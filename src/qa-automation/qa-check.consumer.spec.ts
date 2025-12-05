/**
 * QaCheckConsumer Unit Tests
 * Story 3.7: RabbitMQ QA Queue Processing
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { QaCheckConsumer } from './qa-check.consumer';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { QaOrchestratorService } from './qa-orchestrator.service';
import { LoggerService } from '../common/logger/logger.service';
import { SentryService } from '../common/sentry/sentry.service';
import { QUEUE_METRICS } from '../common/metrics/metrics.constants';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { ErrorCategory } from '../common/sentry/sentry.constants';

describe('QaCheckConsumer', () => {
  let consumer: QaCheckConsumer;
  let rabbitMQService: jest.Mocked<RabbitMQService>;
  let orchestratorService: jest.Mocked<QaOrchestratorService>;
  let sentryService: jest.Mocked<SentryService>;
  let loggerService: jest.Mocked<LoggerService>;
  let configService: jest.Mocked<ConfigService>;
  let mockQueueDepthGauge: { set: jest.Mock };
  let mockConsumerCountGauge: { inc: jest.Mock; dec: jest.Mock };
  let mockProcessingRateCounter: { inc: jest.Mock };

  beforeEach(async () => {
    mockQueueDepthGauge = { set: jest.fn() };
    mockConsumerCountGauge = { inc: jest.fn(), dec: jest.fn() };
    mockProcessingRateCounter = { inc: jest.fn() };

    const mockRabbitMQService = {
      getChannel: jest.fn().mockReturnValue({
        assertQueue: jest.fn().mockResolvedValue({}),
        prefetch: jest.fn().mockResolvedValue({}),
        consume: jest.fn().mockResolvedValue({}),
        checkQueue: jest.fn().mockResolvedValue({ messageCount: 0 }),
      }),
    };

    const mockOrchestratorService = {
      runQaChecks: jest
        .fn()
        .mockResolvedValue({ passed: true, results: {}, totalDuration: 0, correlationId: '' }),
    };

    const mockSentryService = {
      captureException: jest.fn(),
    };

    const mockLoggerService = {
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue: number) => {
        if (key === 'qa.check.concurrency') return 5;
        if (key === 'qa.check.depthIntervalMs') return 30000;
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QaCheckConsumer,
        { provide: RabbitMQService, useValue: mockRabbitMQService },
        { provide: QaOrchestratorService, useValue: mockOrchestratorService },
        { provide: SentryService, useValue: mockSentryService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: `PROM_METRIC_${QUEUE_METRICS.DEPTH}`, useValue: mockQueueDepthGauge },
        {
          provide: `PROM_METRIC_${QUEUE_METRICS.CONSUMER_COUNT}`,
          useValue: mockConsumerCountGauge,
        },
        {
          provide: `PROM_METRIC_${QUEUE_METRICS.PROCESSING_RATE}`,
          useValue: mockProcessingRateCounter,
        },
      ],
    }).compile();

    consumer = module.get<QaCheckConsumer>(QaCheckConsumer);
    rabbitMQService = module.get(RabbitMQService);
    orchestratorService = module.get(QaOrchestratorService);
    sentryService = module.get(SentryService);
    loggerService = module.get(LoggerService);
    configService = module.get(ConfigService);
  });

  it('should be defined', () => {
    expect(consumer).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should start consuming on module init', async () => {
      await consumer.onModuleInit();

      expect(rabbitMQService.getChannel).toHaveBeenCalled();
      expect(mockConsumerCountGauge.inc).toHaveBeenCalledWith({ queue: QUEUE_NAMES.QA_CHECK });
    });
  });

  describe('onModuleDestroy', () => {
    it('should decrement consumer count gauge', async () => {
      await consumer.onModuleDestroy();

      expect(mockConsumerCountGauge.dec).toHaveBeenCalledWith({ queue: QUEUE_NAMES.QA_CHECK });
    });

    it('should log graceful shutdown', async () => {
      await consumer.onModuleDestroy();

      expect(loggerService.log).toHaveBeenCalledWith(
        'QA check consumer shutting down gracefully',
        'QaCheckConsumer',
      );
    });
  });

  describe('processMessage', () => {
    const mockMessage = {
      executionId: 'exec-123',
      ticketId: 'ticket-456',
      projectId: 'proj-789',
      codeFiles: [{ path: 'test.ts', content: 'code', language: 'typescript' as const }],
      aiProvider: 'cursor',
      correlationId: 'corr-abc',
      completedAt: new Date().toISOString(),
    };

    it('should process QA check message successfully', async () => {
      await consumer['processMessage'](mockMessage, 'corr-abc');

      expect(orchestratorService.runQaChecks).toHaveBeenCalledWith(mockMessage, 'corr-abc');
      expect(mockProcessingRateCounter.inc).toHaveBeenCalledWith({
        queue: QUEUE_NAMES.QA_CHECK,
        status: 'success',
      });
    });

    it('should handle failed QA checks', async () => {
      orchestratorService.runQaChecks.mockResolvedValue({
        passed: false,
        executionId: 'exec-123',
        results: {
          linting: { passed: false, errors: [], duration: 100 },
          testing: { passed: true, results: {}, duration: 200 },
          coverage: { percentage: 75, passed: true, duration: 50 },
          security: { passed: true, issues: [], duration: 150 },
        },
        totalDuration: 500,
        correlationId: 'corr-abc',
      });

      await consumer['processMessage'](mockMessage, 'corr-abc');

      expect(mockProcessingRateCounter.inc).toHaveBeenCalledWith({
        queue: QUEUE_NAMES.QA_CHECK,
        status: 'failed',
      });
    });

    it('should capture errors to Sentry with QA_AUTOMATION category', async () => {
      const error = new Error('QA check failed');
      orchestratorService.runQaChecks.mockRejectedValue(error);

      await expect(consumer['processMessage'](mockMessage, 'corr-abc')).rejects.toThrow(error);

      expect(sentryService.captureException).toHaveBeenCalledWith(error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId: mockMessage.executionId, correlationId: 'corr-abc' },
      });
    });
  });

  describe('configuration', () => {
    it('should use QA_CHECK_CONCURRENCY from config', () => {
      expect(configService.get).toHaveBeenCalledWith('qa.check.concurrency', 5);
    });

    it('should use QA_QUEUE_DEPTH_INTERVAL_MS from config', () => {
      expect(configService.get).toHaveBeenCalledWith('qa.check.depthIntervalMs', 30000);
    });
  });
});
