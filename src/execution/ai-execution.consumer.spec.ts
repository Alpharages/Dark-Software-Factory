import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AIProvider, ExecutionStatus, Prisma } from '@/prisma/client';
import Decimal = Prisma.Decimal;
import { AIExecutionConsumer } from './ai-execution.consumer';
import { ExecutionTrackerService } from './execution-tracker.service';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { OrchestratorService } from '@/ai-routing/orchestrator.service';
import { IExecutionCompletion, IExecutionFailure } from './interfaces';
import { AIErrorCode } from '@/ai-routing/interfaces/ai-provider.interface';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { AICostTrackerService } from '@/cost-tracking/ai-cost-tracker.service';
import { CostOptimizerService } from '@/cost-tracking/cost-optimizer.service';
import { SentryService } from '@/common/sentry';
import { ClickUpService } from '@/clickup/clickup.service';
import { AiCapabilityTrackerService } from '@/architecture-review/capabilities/ai-capability-tracker.service';
import { BotAssignmentService } from '@/integrations/bot-assignment.service';
import {
  PMExecutionStatusService,
  ExecutionPhase,
} from '@/integrations/pm-execution-status.service';

/**
 * AIExecutionConsumer Unit Tests
 * Story 2.10: RabbitMQ AI Execution Queue Processing
 */
describe('AIExecutionConsumer', () => {
  let consumer: AIExecutionConsumer;
  let _executionTracker: jest.Mocked<ExecutionTrackerService>;
  let _rabbitmqService: jest.Mocked<RabbitMQService>;
  let _orchestrator: jest.Mocked<OrchestratorService>;
  let _clickupService: jest.Mocked<ClickUpService>;
  let _botAssignment: jest.Mocked<BotAssignmentService>;

  const _mockMessage = {
    messageId: 'msg-123',
    timestamp: new Date().toISOString(),
    correlationId: 'corr-123',
    payload: {
      ticketId: 'ticket-456',
      executionId: 'exec-789',
      aiProvider: AIProvider.CLAUDE_CODE,
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
      getExecution: jest.fn().mockResolvedValue({
        status: ExecutionStatus.QUEUED,
        complexity_score: 5,
      }),
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
      qaFailExecution: jest.fn().mockResolvedValue({
        executionId: 'exec-789',
        previousStatus: ExecutionStatus.IN_PROGRESS,
        newStatus: 'QA_FAILED',
        transitionedAt: new Date(),
      }),
      emitProgress: jest.fn(),
    };

    const mockOrchestrator = {
      execute: jest.fn().mockResolvedValue({
        success: true,
        codeDiff: '// Generated code',
        filesChanged: ['src/test.ts'],
        confidenceScore: 0.95,
        executedBy: AIProvider.CLAUDE_CODE,
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

    // Story 13.3: Mock Cost & Sentry
    const mockAICostTracker = {
      estimateCost: jest.fn().mockReturnValue(new Decimal(0.01)),
      calculateUSD: jest.fn().mockReturnValue(new Decimal(0.02)),
      logCost: jest.fn().mockResolvedValue({ id: 'cost-id' }),
      checkBudgetAvailability: jest.fn().mockResolvedValue({ allowed: true }),
    };
    const mockCostOptimizer = {
      selectOptimalModel: jest.fn().mockReturnValue('gpt-4o'),
    };
    const mockSentry = {
      captureMessage: jest.fn(),
      captureException: jest.fn(),
    };
    const mockClickUpService = {
      addComment: jest.fn().mockResolvedValue(true),
    };

    // Mock AiCapabilityTrackerService
    const mockAiCapabilityTracker = {
      trackExecution: jest.fn().mockResolvedValue(undefined),
    };

    const mockBotAssignment = {
      assignBotToTask: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIExecutionConsumer,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(1) } },
        { provide: RabbitMQService, useValue: mockRabbitmq },
        { provide: ExecutionTrackerService, useValue: mockExecutionTracker },
        { provide: OrchestratorService, useValue: mockOrchestrator },
        { provide: AIDecisionLoggerService, useValue: mockAIDecisionLogger },
        { provide: AICostTrackerService, useValue: mockAICostTracker },
        { provide: CostOptimizerService, useValue: mockCostOptimizer },
        { provide: SentryService, useValue: mockSentry },
        { provide: ClickUpService, useValue: mockClickUpService },
        { provide: AiCapabilityTrackerService, useValue: mockAiCapabilityTracker },
        { provide: BotAssignmentService, useValue: mockBotAssignment },
        {
          provide: PMExecutionStatusService,
          useValue: {
            updateByPhase: jest.fn().mockResolvedValue(undefined),
            revertToPreTriggerStatus: jest.fn().mockResolvedValue(undefined),
            notifyQAFailure: jest.fn().mockResolvedValue(undefined),
          },
        },
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
    _clickupService = module.get(ClickUpService);
    _botAssignment = module.get(BotAssignmentService);
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

      const isRetryable = (consumer as any).isRetryableError;

      expect(isRetryable('TIMEOUT')).toBe(true);
      expect(isRetryable('NETWORK_ERROR')).toBe(true);
      expect(isRetryable('PROVIDER_UNAVAILABLE')).toBe(true);
      expect(isRetryable(undefined)).toBe(true);
    });

    it('should identify non-retryable errors', () => {
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
      const shouldRequeue = (consumer as any).shouldRequeueOnError;

      expect(shouldRequeue(new Error('ECONNREFUSED'))).toBe(true);
      expect(shouldRequeue(new Error('ETIMEDOUT'))).toBe(true);
      expect(shouldRequeue(new Error('ENOTFOUND'))).toBe(true);
      expect(shouldRequeue(new Error('Connection closed'))).toBe(true);
    });

    it('should not requeue non-transient errors', () => {
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

  describe('processExecution (Checking Budget)', () => {
    it('should block execution and alert PM when budget exceeded', async () => {
      // Mock checkBudgetAvailability to return allowed: false
      // Access via casting since it is private property in consumer but public in service

      const _costTracker = (consumer as any).aiCostTracker;
      _costTracker.checkBudgetAvailability = jest.fn().mockResolvedValue({
        allowed: false,
        reason: 'Budget exceeded',
        budget: 100,
        spend: 105,
      });

      // Call processExecution via private access or by simulating consume
      // Let's use private access for direct testing of logic

      const result = await (consumer as any).processExecution(_mockMessage);

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('Budget exceeded');

      // Verify ClickUp alert
      expect(_clickupService.addComment).toHaveBeenCalledWith(
        'ticket-456',
        expect.stringContaining('Budget exceeded'),
      );
    });
  });

  describe('processExecution (Bot Assignment)', () => {
    it('should call bot assignment service', async () => {
      // Access via casting
      const result = await (consumer as any).processExecution(_mockMessage);

      expect(result.success).toBe(true);
      expect(_botAssignment.assignBotToTask).toHaveBeenCalledWith(
        'ticket-456',
        'proj-123',
        'corr-123',
      );
    });
  });

  describe('processExecution — QA failure handling (WR-4.1)', () => {
    it('should call qaFailExecution, notifyQAFailure, and ACK message when qaStatus is failed', async () => {
      const pmStatus = (consumer as any).pmExecutionStatus;

      _orchestrator.execute.mockResolvedValue({
        success: false,
        error: {
          code: AIErrorCode.CLI_NOT_FOUND, // any error code
          message: 'Linter failed',
          isRetryable: false,
        },
        qaStatus: 'failed',
        qaRetryCount: 3,
        branchName: 'feature/qa-fail',
        executedBy: AIProvider.CLAUDE_CODE,
        usedFallback: false,
        codeDiff: null,
        filesChanged: [],
        confidenceScore: 0,
        durationMs: 100,
        totalDurationMs: 100,
        workspacePath: '',
        fallbackAttempts: [],
        estimatedCostCents: 0,
      });

      const result = await (consumer as any).processExecution(_mockMessage);

      // Verify returned result indicates success: false but with QA_FAILED
      expect(result.success).toBe(false);
      expect(result.errorCode).toBe('QA_FAILED');

      expect(_executionTracker.qaFailExecution).toHaveBeenCalledWith(
        {
          executionId: 'exec-789',
          errorMessage: 'Linter failed',
          branchName: 'feature/qa-fail',
          qaRetryCount: 3,
        },
        'corr-123',
      );

      expect(pmStatus.notifyQAFailure).toHaveBeenCalledWith(
        'proj-123',
        'ticket-456',
        'feature/qa-fail',
        'corr-123',
      );

      // Verify it skips crash cascade
      expect(pmStatus.revertToPreTriggerStatus).not.toHaveBeenCalled();
      expect(pmStatus.updateByPhase).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        ExecutionPhase.FAILED,
        expect.any(String),
      );
      expect(_executionTracker.failExecution).not.toHaveBeenCalled();
    });

    it('should NOT call qaFailExecution for PROCESS_CRASH without qaStatus', async () => {
      const pmStatus = (consumer as any).pmExecutionStatus;

      _orchestrator.execute.mockResolvedValue({
        success: false,
        error: {
          code: AIErrorCode.PROCESS_CRASH,
          message: 'Sandbox OOM',
          isRetryable: false,
        },
        qaStatus: undefined,
        executedBy: AIProvider.CLAUDE_CODE,
        usedFallback: false,
        codeDiff: null,
        filesChanged: [],
        confidenceScore: 0,
        durationMs: 100,
        totalDurationMs: 100,
        workspacePath: '',
        fallbackAttempts: [],
        estimatedCostCents: 0,
      });

      await (consumer as any).processExecution(_mockMessage);

      expect(_executionTracker.qaFailExecution).not.toHaveBeenCalled();
      expect(pmStatus.notifyQAFailure).not.toHaveBeenCalled();
      expect(_executionTracker.failExecution).toHaveBeenCalled();
      expect(pmStatus.revertToPreTriggerStatus).toHaveBeenCalled();
    });

    it('should fall through to standard error handling if branchName is missing', async () => {
      const pmStatus = (consumer as any).pmExecutionStatus;

      _orchestrator.execute.mockResolvedValue({
        success: false,
        error: {
          code: AIErrorCode.PROCESS_CRASH,
          message: 'Crash during QA',
          isRetryable: false,
        },
        qaStatus: 'failed',
        // branchName missing
        executedBy: AIProvider.CLAUDE_CODE,
        usedFallback: false,
        codeDiff: null,
        filesChanged: [],
        confidenceScore: 0,
        durationMs: 100,
        totalDurationMs: 100,
        workspacePath: '',
        fallbackAttempts: [],
        estimatedCostCents: 0,
      });

      const result = await (consumer as any).processExecution(_mockMessage);

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe(AIErrorCode.PROCESS_CRASH);

      expect(_executionTracker.qaFailExecution).not.toHaveBeenCalled();
      expect(pmStatus.notifyQAFailure).not.toHaveBeenCalled();

      // Verify standard fail logic triggered
      expect(_executionTracker.failExecution).toHaveBeenCalled();
      expect(pmStatus.revertToPreTriggerStatus).toHaveBeenCalled();
    });
  });

  describe('processExecution — crash/timeout handling', () => {
    it('should trigger revertToPreTriggerStatus on AIErrorCode.PROCESS_CRASH', async () => {
      const pmStatus = (consumer as any).pmExecutionStatus;

      _orchestrator.execute.mockResolvedValue({
        success: false,
        error: {
          code: AIErrorCode.PROCESS_CRASH,
          message: 'Sandbox OOM',
          isRetryable: false,
        },
        executedBy: AIProvider.CLAUDE_CODE,
        usedFallback: false,
        codeDiff: null,
        filesChanged: [],
        confidenceScore: 0,
        durationMs: 100,
        totalDurationMs: 100,
        workspacePath: '',
        fallbackAttempts: [],
        estimatedCostCents: 0,
      });

      await (consumer as any).processExecution(_mockMessage);

      expect(pmStatus.revertToPreTriggerStatus).toHaveBeenCalledWith(
        'proj-123',
        'ticket-456',
        'Sandbox OOM',
        'corr-123',
      );
      expect(pmStatus.updateByPhase).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        ExecutionPhase.FAILED,
        expect.any(String),
      );
    });

    it('should trigger revertToPreTriggerStatus on AIErrorCode.TIMEOUT', async () => {
      const pmStatus = (consumer as any).pmExecutionStatus;

      _orchestrator.execute.mockResolvedValue({
        success: false,
        error: {
          code: AIErrorCode.TIMEOUT,
          message: 'Execution reached 1 hour limit',
          isRetryable: false,
        },
        executedBy: AIProvider.CLAUDE_CODE,
        usedFallback: false,
        codeDiff: null,
        filesChanged: [],
        confidenceScore: 0,
        durationMs: 100,
        totalDurationMs: 100,
        workspacePath: '',
        fallbackAttempts: [],
        estimatedCostCents: 0,
      });

      await (consumer as any).processExecution(_mockMessage);

      expect(pmStatus.revertToPreTriggerStatus).toHaveBeenCalledWith(
        'proj-123',
        'ticket-456',
        'Execution reached 1 hour limit',
        'corr-123',
      );
      expect(pmStatus.updateByPhase).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        ExecutionPhase.FAILED,
        expect.any(String),
      );
    });

    // P6 (Task 5.3): non-crash error codes must route to updateByPhase(FAILED)
    it('should call updateByPhase(FAILED) on non-crash error codes (e.g. CLI_NOT_FOUND)', async () => {
      const pmStatus = (consumer as any).pmExecutionStatus;

      _orchestrator.execute.mockResolvedValue({
        success: false,
        error: {
          code: AIErrorCode.CLI_NOT_FOUND,
          message: 'Claude CLI binary not found',
          isRetryable: false,
        },
        executedBy: AIProvider.CLAUDE_CODE,
        usedFallback: false,
        codeDiff: null,
        filesChanged: [],
        confidenceScore: 0,
        durationMs: 100,
        totalDurationMs: 100,
        workspacePath: '',
        fallbackAttempts: [],
        estimatedCostCents: 0,
      });

      await (consumer as any).processExecution(_mockMessage);

      expect(pmStatus.updateByPhase).toHaveBeenCalledWith(
        'proj-123',
        'ticket-456',
        ExecutionPhase.FAILED,
        'corr-123',
      );
      expect(pmStatus.revertToPreTriggerStatus).not.toHaveBeenCalled();
    });

    // P7 (Task 5.4): unhandled catch-block exceptions are always crash-like
    it('should call revertToPreTriggerStatus in global catch block for unhandled exceptions', async () => {
      const pmStatus = (consumer as any).pmExecutionStatus;

      // Simulate an unhandled exception thrown mid-execution (not from provider result)
      _orchestrator.execute.mockRejectedValue(new Error('DB connection lost unexpectedly'));

      await (consumer as any).processExecution(_mockMessage);

      // Unhandled exceptions are always crash-like — should call revert, not updateByPhase
      expect(pmStatus.revertToPreTriggerStatus).toHaveBeenCalledWith(
        'proj-123',
        'ticket-456',
        'DB connection lost unexpectedly',
        'corr-123',
      );
      expect(pmStatus.updateByPhase).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        ExecutionPhase.FAILED,
        expect.any(String),
      );
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
