import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AIProvider, ExecutionStatus } from '@/prisma/client';
import { AIExecutionConsumer } from './ai-execution.consumer';
import { ExecutionTrackerService } from './execution-tracker.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { OrchestratorService } from '../ai-routing/orchestrator.service';
import { IExecutionCompletion, IExecutionFailure } from './interfaces';
import { AIDecisionLoggerService } from '../audit/ai-decision-logger.service';

/**
 * AIExecutionConsumer Unit Tests
 * Story 2.10: RabbitMQ AI Execution Queue Processing
 */
describe('AIExecutionConsumer', () => {
  let consumer: AIExecutionConsumer;
  let _executionTracker: jest.Mocked<ExecutionTrackerService>;
  let _rabbitmqService: jest.Mocked<RabbitMQService>;
  let _orchestrator: jest.Mocked<OrchestratorService>;

  const _mockMessage = {
    messageId: 'msg-123',
    timestamp: new Date().toISOString(),
    correlationId: 'corr-123',
    payload: {
      ticketId: 'ticket-456',
      executionId: 'exec-789',
      aiProvider: AIProvider.CURSOR_HEADLESS,
      priority: 3,
      prompt: 'Fix the bug',
      repositoryUrl: 'https://github.com/test/repo',
      projectId: 'proj-123',
      allowFallback: true,
    },
  };

  beforeEach(async () => {
    const mockChannel = {
      prefetch: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockResolvedValue({ consumerTag: 'test-consumer' }),
      ack: jest.fn(),
      nack: jest.fn(),
      cancel: jest.fn().mockResolvedValue(undefined),
    };

    const mockRabbitmq = {
      getChannel: jest.fn().mockReturnValue(mockChannel),
      getQueueStats: jest.fn().mockResolvedValue({
        messageCount: 5,
        consumerCount: 1,
      }),
    };

    const mockExecutionTracker = {
      markInProgress: jest.fn().mockResolvedValue({
        executionId: 'exec-789',
        previousStatus: ExecutionStatus.QUEUED,
        newStatus: ExecutionStatus.IN_PROGRESS,
        transitionedAt: new Date(),
      }),
      completeExecution: jest.fn().mockResolvedValue({
        executionId: 'exec-789',
        previousStatus: ExecutionStatus.IN_PROGRESS,
        newStatus: ExecutionStatus.COMPLETED,
        transitionedAt: new Date(),
      }),
      failExecution: jest.fn().mockResolvedValue({
        executionId: 'exec-789',
        previousStatus: ExecutionStatus.IN_PROGRESS,
        newStatus: ExecutionStatus.FAILED,
        transitionedAt: new Date(),
      }),
    };

    const mockOrchestrator = {
      execute: jest.fn().mockResolvedValue({
        success: true,
        codeDiff: '// Generated code',
        filesChanged: ['src/test.ts'],
        confidenceScore: 0.95,
        executedBy: AIProvider.CURSOR_HEADLESS,
      }),
    };

    // Mock metrics
    const mockCounter = { inc: jest.fn(), labels: jest.fn().mockReturnThis() };
    const mockHistogram = { observe: jest.fn(), labels: jest.fn().mockReturnThis() };
    const mockGauge = { set: jest.fn(), labels: jest.fn().mockReturnThis() };

    // Story 11.4: Mock AIDecisionLoggerService
    const mockAIDecisionLogger = {
      logDecision: jest.fn().mockResolvedValue({ id: 'log-id' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIExecutionConsumer,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(1) } },
        { provide: RabbitMQService, useValue: mockRabbitmq },
        { provide: ExecutionTrackerService, useValue: mockExecutionTracker },
        { provide: OrchestratorService, useValue: mockOrchestrator },
        { provide: AIDecisionLoggerService, useValue: mockAIDecisionLogger },
        { provide: 'PROM_METRIC_QUEUE_MESSAGES_CONSUMED_TOTAL', useValue: mockCounter },
        { provide: 'PROM_METRIC_QUEUE_MESSAGES_FAILED_TOTAL', useValue: mockCounter },
        { provide: 'PROM_METRIC_QUEUE_PROCESSING_DURATION_SECONDS', useValue: mockHistogram },
        { provide: 'PROM_METRIC_QUEUE_DEPTH', useValue: mockGauge },
        { provide: 'PROM_METRIC_QUEUE_CONSUMER_COUNT', useValue: mockGauge },
      ],
    }).compile();

    consumer = module.get<AIExecutionConsumer>(AIExecutionConsumer);
    _executionTracker = module.get(ExecutionTrackerService);
    _rabbitmqService = module.get(RabbitMQService);
    _orchestrator = module.get(OrchestratorService);
  });

  describe('getConsumerState', () => {
    it('should return consumer state with expected properties', () => {
      const state = consumer.getConsumerState();

      expect(state).toHaveProperty('consumerTag');
      expect(state).toHaveProperty('isActive');
      expect(state).toHaveProperty('startedAt');
      expect(state).toHaveProperty('messagesProcessed');
      expect(state).toHaveProperty('messagesFailed');
      expect(state).toHaveProperty('currentMessageId');
    });

    it('should initially have isActive as false', () => {
      const state = consumer.getConsumerState();
      expect(state.isActive).toBe(false);
    });

    it('should initially have zero processed messages', () => {
      const state = consumer.getConsumerState();
      expect(state.messagesProcessed).toBe(0);
      expect(state.messagesFailed).toBe(0);
    });
  });

  describe('getQueueStats', () => {
    it('should return queue statistics', async () => {
      const stats = await consumer.getQueueStats();

      expect(stats.messageCount).toBe(5);
      expect(stats.consumerCount).toBe(1);
      expect(stats).toHaveProperty('processingRate');
      expect(stats).toHaveProperty('avgProcessingTimeMs');
    });

    it('should calculate processing rate as 0 when no messages processed', async () => {
      const stats = await consumer.getQueueStats();
      expect(stats.processingRate).toBe(0);
      expect(stats.avgProcessingTimeMs).toBe(0);
    });
  });

  describe('error classification', () => {
    it('should identify retryable errors', () => {
      // Access private method via type casting for testing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isRetryable = (consumer as any).isRetryableError;

      expect(isRetryable('TIMEOUT')).toBe(true);
      expect(isRetryable('NETWORK_ERROR')).toBe(true);
      expect(isRetryable('PROVIDER_UNAVAILABLE')).toBe(true);
      expect(isRetryable(undefined)).toBe(true);
    });

    it('should identify non-retryable errors', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isRetryable = (consumer as any).isRetryableError;

      expect(isRetryable('INVALID_PROMPT')).toBe(false);
      expect(isRetryable('INVALID_REPOSITORY')).toBe(false);
      expect(isRetryable('AUTHENTICATION_ERROR')).toBe(false);
      expect(isRetryable('PERMISSION_DENIED')).toBe(false);
      expect(isRetryable('CANCELLED')).toBe(false);
    });
  });

  describe('transient error handling', () => {
    it('should identify connection errors as requeue-able', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shouldRequeue = (consumer as any).shouldRequeueOnError;

      expect(shouldRequeue(new Error('ECONNREFUSED'))).toBe(true);
      expect(shouldRequeue(new Error('ETIMEDOUT'))).toBe(true);
      expect(shouldRequeue(new Error('ENOTFOUND'))).toBe(true);
      expect(shouldRequeue(new Error('Connection closed'))).toBe(true);
    });

    it('should not requeue non-transient errors', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shouldRequeue = (consumer as any).shouldRequeueOnError;

      expect(shouldRequeue(new Error('Invalid input'))).toBe(false);
      expect(shouldRequeue(new Error('Validation failed'))).toBe(false);
    });
  });

  describe('lifecycle hooks', () => {
    it('should clean up monitoring interval on destroy', async () => {
      // Set up monitoring interval
      await consumer.onModuleInit();

      // Verify interval was cleared
      await consumer.onModuleDestroy();

      // Consumer should be inactive after destroy
      const state = consumer.getConsumerState();
      expect(state.isActive).toBe(false);
    });
  });
});

describe('AIExecutionConsumer Integration', () => {
  it('should have valid interface types', () => {
    // Verify IExecutionCompletion interface
    const completion: IExecutionCompletion = {
      executionId: 'exec-123',
      codeOutput: '// code',
      filesChanged: ['file.ts'],
      confidenceScore: 0.9,
    };
    expect(completion.executionId).toBeDefined();

    // Verify IExecutionFailure interface
    const failure: IExecutionFailure = {
      executionId: 'exec-123',
      errorMessage: 'Error occurred',
      isRetryable: true,
      errorCode: 'TEST_ERROR',
    };
    expect(failure.executionId).toBeDefined();
  });
});
