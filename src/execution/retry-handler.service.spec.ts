import { Test, TestingModule } from '@nestjs/testing';
import { AIProvider, ExecutionStatus } from '@/prisma/client';
import { RetryHandlerService } from './retry-handler.service';
import { RetryClassifierService } from './retry-classifier.service';
import { RetrySchedulerService } from './retry-scheduler.service';
import { ExecutionTrackerService } from './execution-tracker.service';
import { SentryService } from '../common/sentry/sentry.service';
import { LoggerService } from '../common/logger/logger.service';
import { PrismaService } from '../database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { ErrorSeverity, RetryDecisionReason } from './interfaces';

describe('RetryHandlerService', () => {
  let service: RetryHandlerService;
  let classifier: jest.Mocked<RetryClassifierService>;
  let scheduler: jest.Mocked<RetrySchedulerService>;
  let prisma: jest.Mocked<PrismaService>;
  let sentry: jest.Mocked<SentryService>;

  const mockExecution = {
    id: 'exec-123',
    ticket_id: 'ticket-456',
    status: ExecutionStatus.IN_PROGRESS,
    retry_count: 0,
    max_retries: 3,
    error_context: null,
    created_at: new Date(),
    updated_at: new Date(),
    ticket: { id: 'ticket-456' },
    // Story 23.2: Container cleanup tracking
    container_id: null,
    debug_mode: false,
  };

  beforeEach(async () => {
    const mockClassifier = {
      classifyError: jest.fn(),
      isRetryable: jest.fn(),
    };

    const mockScheduler = {
      shouldRetry: jest.fn(),
      scheduleRetry: jest.fn(),
      calculateBackoffDelay: jest.fn(),
    };

    const mockExecutionTracker = {
      updateStatus: jest.fn(),
    };

    const mockSentry = {
      captureException: jest.fn(),
    };

    const mockLogger = {
      setCorrelationId: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const mockPrisma = {
      execution: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const mockMetrics = {
      inc: jest.fn(),
      dec: jest.fn(),
      observe: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetryHandlerService,
        { provide: RetryClassifierService, useValue: mockClassifier },
        { provide: RetrySchedulerService, useValue: mockScheduler },
        { provide: ExecutionTrackerService, useValue: mockExecutionTracker },
        { provide: SentryService, useValue: mockSentry },
        { provide: LoggerService, useValue: mockLogger },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: 'PROM_METRIC_RETRY_ATTEMPTS_TOTAL', useValue: mockMetrics },
        { provide: 'PROM_METRIC_RETRY_EXHAUSTED_TOTAL', useValue: mockMetrics },
        { provide: 'PROM_METRIC_RETRY_SUCCESS_TOTAL', useValue: mockMetrics },
        { provide: 'PROM_METRIC_RETRY_ACTIVE_COUNT', useValue: mockMetrics },
      ],
    }).compile();

    service = module.get<RetryHandlerService>(RetryHandlerService);
    classifier = module.get(RetryClassifierService);
    scheduler = module.get(RetrySchedulerService);
    prisma = module.get(PrismaService);
    sentry = module.get(SentryService);
  });

  describe('handleFailure', () => {
    it('should schedule retry for retryable error under limit', async () => {
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prisma.execution.update as jest.Mock).mockResolvedValue(mockExecution);

      classifier.classifyError.mockReturnValue({
        isRetryable: true,
        errorCode: 'TIMEOUT',
        message: 'Execution timed out',
        suggestedDelayMs: 5000,
        shouldFallback: true,
        severity: ErrorSeverity.MEDIUM,
      });

      scheduler.shouldRetry.mockReturnValue({
        shouldRetry: true,
        delayMs: 1000,
        attemptNumber: 1,
        maxRetries: 3,
        reason: RetryDecisionReason.RETRYABLE,
      });

      scheduler.scheduleRetry.mockResolvedValue({
        executionId: 'exec-123',
        correlationId: 'corr-123',
        scheduledTime: new Date(),
        delayMs: 1000,

        context: {} as any,
      });

      const result = await service.handleFailure(
        'exec-123',
        'corr-123',
        'TIMEOUT',
        'Execution timed out',
        AIProvider.CLAUDE_CODE,
        30000,
      );

      expect(result.decision.shouldRetry).toBe(true);
      expect(result.scheduled).toBe(true);
      expect(scheduler.scheduleRetry).toHaveBeenCalled();
    });

    it('should not retry non-retryable error', async () => {
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prisma.execution.update as jest.Mock).mockResolvedValue(mockExecution);

      classifier.classifyError.mockReturnValue({
        isRetryable: false,
        errorCode: 'INVALID_PROMPT',
        message: 'Prompt is invalid',
        suggestedDelayMs: 0,
        shouldFallback: false,
        severity: ErrorSeverity.HIGH,
      });

      scheduler.shouldRetry.mockReturnValue({
        shouldRetry: false,
        delayMs: 0,
        attemptNumber: 1,
        maxRetries: 3,
        reason: RetryDecisionReason.NON_RETRYABLE_ERROR,
      });

      const result = await service.handleFailure(
        'exec-123',
        'corr-123',
        'INVALID_PROMPT',
        'Prompt is invalid',
        AIProvider.CLAUDE_CODE,
        5000,
      );

      expect(result.decision.shouldRetry).toBe(false);
      expect(result.scheduled).toBe(false);
      expect(scheduler.scheduleRetry).not.toHaveBeenCalled();
    });

    it('should not retry when max retries exceeded', async () => {
      const exhaustedExecution = { ...mockExecution, retry_count: 3 };
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(exhaustedExecution);
      (prisma.execution.update as jest.Mock).mockResolvedValue(exhaustedExecution);

      classifier.classifyError.mockReturnValue({
        isRetryable: true,
        errorCode: 'TIMEOUT',
        message: 'Execution timed out',
        suggestedDelayMs: 5000,
        shouldFallback: true,
        severity: ErrorSeverity.MEDIUM,
      });

      scheduler.shouldRetry.mockReturnValue({
        shouldRetry: false,
        delayMs: 0,
        attemptNumber: 4,
        maxRetries: 3,
        reason: RetryDecisionReason.MAX_RETRIES_EXCEEDED,
      });

      const result = await service.handleFailure(
        'exec-123',
        'corr-123',
        'TIMEOUT',
        'Execution timed out',
        AIProvider.CLAUDE_CODE,
        30000,
      );

      expect(result.decision.shouldRetry).toBe(false);
      expect(result.decision.reason).toBe(RetryDecisionReason.MAX_RETRIES_EXCEEDED);
      expect(result.scheduled).toBe(false);
    });

    it('should log to Sentry on critical permanent failure', async () => {
      (prisma.execution.findUnique as jest.Mock).mockResolvedValue(mockExecution);
      (prisma.execution.update as jest.Mock).mockResolvedValue(mockExecution);

      classifier.classifyError.mockReturnValue({
        isRetryable: false,
        errorCode: 'AUTHENTICATION_ERROR',
        message: 'Auth failed',
        suggestedDelayMs: 0,
        shouldFallback: false,
        severity: ErrorSeverity.CRITICAL,
      });

      scheduler.shouldRetry.mockReturnValue({
        shouldRetry: false,
        delayMs: 0,
        attemptNumber: 1,
        maxRetries: 3,
        reason: RetryDecisionReason.NON_RETRYABLE_ERROR,
      });

      await service.handleFailure(
        'exec-123',
        'corr-123',
        'AUTHENTICATION_ERROR',
        'Auth failed',
        AIProvider.CLAUDE_CODE,
        1000,
      );

      expect(sentry.captureException).toHaveBeenCalled();
    });
  });

  describe('handleRetrySuccess', () => {
    it('should update status and track success', async () => {
      (prisma.execution.update as jest.Mock).mockResolvedValue(mockExecution);

      await service.handleRetrySuccess('exec-123', 'corr-123');

      expect(prisma.execution.update).toHaveBeenCalledWith({
        where: { id: 'exec-123' },
        data: expect.objectContaining({
          status: ExecutionStatus.COMPLETED,
        }),
      });
    });
  });

  describe('getMetrics', () => {
    it('should return current metrics', () => {
      const metrics = service.getMetrics();

      expect(metrics).toHaveProperty('totalRetries');
      expect(metrics).toHaveProperty('successfulRetries');
      expect(metrics).toHaveProperty('exhaustedRetries');
      expect(metrics).toHaveProperty('successRate');
    });
  });
});

describe('RetryClassifierService', () => {
  let service: RetryClassifierService;

  beforeEach(async () => {
    const mockConfig = {
      get: jest.fn().mockReturnValue(3),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RetryClassifierService, { provide: ConfigService, useValue: mockConfig }],
    }).compile();

    service = module.get<RetryClassifierService>(RetryClassifierService);
  });

  describe('classifyError', () => {
    it('should classify TIMEOUT as retryable', () => {
      const result = service.classifyError('TIMEOUT', 'Timed out', 'corr-1');
      expect(result.isRetryable).toBe(true);
      expect(result.severity).toBe(ErrorSeverity.MEDIUM);
    });

    it('should classify INVALID_PROMPT as non-retryable', () => {
      const result = service.classifyError('INVALID_PROMPT', 'Bad prompt', 'corr-1');
      expect(result.isRetryable).toBe(false);
      expect(result.severity).toBe(ErrorSeverity.HIGH);
    });

    it('should handle unknown errors as retryable', () => {
      const result = service.classifyError('SOME_NEW_ERROR', 'Unknown', 'corr-1');
      expect(result.isRetryable).toBe(true);
    });
  });
});

describe('RetrySchedulerService', () => {
  let scheduler: RetrySchedulerService;

  beforeEach(async () => {
    const mockConfig = {
      get: jest.fn().mockImplementation((key) => {
        if (key === 'retry.maxAttempts') return 3;
        if (key === 'retry.baseDelayMs') return 1000;
        if (key === 'retry.backoffMultiplier') return 2;
        if (key === 'retry.maxDelayMs') return 30000;
        return null;
      }),
    };

    const mockRabbitMQ = {
      getChannel: jest.fn(),
    };

    const mockMetrics = {
      inc: jest.fn(),
      observe: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetrySchedulerService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: RabbitMQService, useValue: mockRabbitMQ },
        { provide: 'PROM_METRIC_RETRY_SCHEDULED_TOTAL', useValue: mockMetrics },
        { provide: 'PROM_METRIC_RETRY_DELAY_SECONDS', useValue: mockMetrics },
      ],
    }).compile();

    scheduler = module.get<RetrySchedulerService>(RetrySchedulerService);
  });

  describe('calculateBackoffDelay', () => {
    it('should calculate exponential backoff with jitter', () => {
      // With base 1000ms and multiplier 2:
      // Attempt 0: ~1000ms ± 20% = 800-1200ms
      // Attempt 1: ~2000ms ± 20% = 1600-2400ms
      // Attempt 2: ~4000ms ± 20% = 3200-4800ms

      // Run multiple times to test jitter variance
      const delay0Values = Array.from({ length: 10 }, () => scheduler.calculateBackoffDelay(0));

      // All values should be within ±20% of base
      delay0Values.forEach((delay) => {
        expect(delay).toBeGreaterThanOrEqual(800);
        expect(delay).toBeLessThanOrEqual(1200);
      });

      // Values should NOT all be identical (jitter working)
      const uniqueValues = new Set(delay0Values);
      expect(uniqueValues.size).toBeGreaterThan(1);
    });

    it('should cap delay at maxDelay before applying jitter', () => {
      // Even with jitter, delay should not exceed maxDelay + 20%
      const config = scheduler.getRetryConfig();
      const delay10 = scheduler.calculateBackoffDelay(10);

      // Max with jitter = maxDelay * 1.2
      expect(delay10).toBeLessThanOrEqual(config.maxDelayMs * 1.2);
    });
  });
});
