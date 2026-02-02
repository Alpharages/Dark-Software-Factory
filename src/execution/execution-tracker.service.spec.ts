import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutionTrackerService } from './execution-tracker.service';
import { ExecutionRepository } from './execution.repository';
import { ExecutionStateMachine } from './state-machine';
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';
import { ExecutionStatus, AIProvider, PRRiskLevel } from '@/prisma/client';

describe('ExecutionTrackerService', () => {
  let service: ExecutionTrackerService;
  let repository: jest.Mocked<ExecutionRepository>;
  let stateMachine: jest.Mocked<ExecutionStateMachine>;
  let publisher: jest.Mocked<RabbitMQPublisherService>;

  const mockExecution = {
    id: 'exec-123',
    ticket_id: 'ticket-123',
    ai_provider: AIProvider.CURSOR_HEADLESS,
    prompt: 'test prompt',
    status: ExecutionStatus.QUEUED,
    confidence_score: null,
    started_at: null,
    completed_at: null,
    failed_at: null,
    error_message: null,
    code_output: null,
    files_changed: null,
    retry_count: 0,
    max_retries: 3,
    created_at: new Date(),
    updated_at: new Date(),
    complexity_score: 50,
    complexity_breakdown: null,
    routing_reason: null,
    fallback_used: false,
    original_provider: null,
    error_context: null, // Story 2.9
    scheduled_retry_at: null, // Story 2.9
    // Story 11.1: Database schema additions
    base_branch: 'main',
    branch_selection_log: null,
    file_modifications: null,
    risk_level: PRRiskLevel.LOW,
    circular_dep_detected: false,
    // Story 13.2: Cost Optimization
    selected_model: null,
    task_type: null,
    // Story 23.2: Container cleanup tracking
    container_id: null,
    debug_mode: false,
  };

  const mockMetricCounter = {
    inc: jest.fn(),
    labels: jest.fn().mockReturnThis(),
  };

  const mockMetricHistogram = {
    observe: jest.fn(),
    labels: jest.fn().mockReturnThis(),
  };

  const mockMetricGauge = {
    set: jest.fn(),
    labels: jest.fn().mockReturnThis(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionTrackerService,
        {
          provide: ExecutionRepository,
          useValue: {
            create: jest.fn(),
            findById: jest.fn(),
            findByTicketId: jest.fn(),
            updateStatus: jest.fn(),
            incrementRetryAndRequeue: jest.fn(),
            canRetry: jest.fn(),
            createAuditLog: jest.fn(),
            updateTicketStatus: jest.fn(),
            getActiveCountByProvider: jest.fn(),
          },
        },
        {
          provide: ExecutionStateMachine,
          useValue: {
            transition: jest.fn(),
            canStart: jest.fn(),
            canComplete: jest.fn(),
            canRetry: jest.fn(),
            isTerminal: jest.fn(),
          },
        },
        {
          provide: RabbitMQPublisherService,
          useValue: {
            publishToQueue: jest.fn(),
            publishToExchange: jest.fn(),
          },
        },
        {
          provide: 'PROM_METRIC_DSF_EXECUTION_TOTAL',
          useValue: mockMetricCounter,
        },
        {
          provide: 'PROM_METRIC_DSF_EXECUTION_DURATION_SECONDS',
          useValue: mockMetricHistogram,
        },
        {
          provide: 'PROM_METRIC_DSF_EXECUTION_STATUS_GAUGE',
          useValue: mockMetricGauge,
        },
        {
          provide: 'PROM_METRIC_DSF_EXECUTION_RETRY_TOTAL',
          useValue: mockMetricCounter,
        },
        // Story 23.2: Cleanup dependencies
        {
          provide: 'PROM_METRIC_DSF_CONTAINER_LOG_BYTES_TOTAL',
          useValue: mockMetricCounter,
        },
        {
          provide: 'PROM_METRIC_DSF_CONTAINER_EXEC_DURATION_SECONDS',
          useValue: mockMetricHistogram,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(true),
          },
        },
      ],
    }).compile();

    service = module.get<ExecutionTrackerService>(ExecutionTrackerService);
    repository = module.get(ExecutionRepository);
    stateMachine = module.get(ExecutionStateMachine);
    publisher = module.get(RabbitMQPublisherService);

    // Default mocks
    repository.getActiveCountByProvider.mockResolvedValue({
      [AIProvider.CURSOR_HEADLESS]: 0,
      [AIProvider.CLAUDE_CODE]: 0,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startExecution', () => {
    const startInput = {
      correlationId: 'corr-123',
      ticketId: 'ticket-123',
      clickupTaskId: 'cu-123',
      provider: AIProvider.CURSOR_HEADLESS,
      prompt: 'test prompt',
      promptMetadata: {
        promptLength: 100,
        estimatedTokens: 200,
        templateVersion: '1.0.0',
        generatedAt: new Date().toISOString(),
      },
      complexityScore: 50,
    };

    it('should create execution record', async () => {
      repository.create.mockResolvedValue(mockExecution);
      repository.createAuditLog.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);

      const result = await service.startExecution(startInput);

      expect(result).toEqual(mockExecution);
      expect(repository.create).toHaveBeenCalledWith({
        ticketId: 'ticket-123',
        provider: AIProvider.CURSOR_HEADLESS,
        prompt: 'test prompt',
        status: ExecutionStatus.QUEUED,
        complexityScore: 50,
      });
    });

    it('should log to audit', async () => {
      repository.create.mockResolvedValue(mockExecution);
      repository.createAuditLog.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);

      await service.startExecution(startInput);

      expect(repository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'execution',
          entityId: 'exec-123',
          action: 'created',
        }),
      );
    });

    it('should emit RabbitMQ event', async () => {
      repository.create.mockResolvedValue(mockExecution);
      repository.createAuditLog.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);

      await service.startExecution(startInput);

      expect(publisher.publishToQueue).toHaveBeenCalledWith(
        'execution-status-queue',
        expect.objectContaining({
          eventType: 'EXECUTION_STARTED',
          executionId: 'exec-123',
          ticketId: 'ticket-123',
        }),
      );
    });

    it('should increment metrics', async () => {
      repository.create.mockResolvedValue(mockExecution);
      repository.createAuditLog.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);

      await service.startExecution(startInput);

      expect(mockMetricCounter.inc).toHaveBeenCalledWith({
        provider: AIProvider.CURSOR_HEADLESS,
        status: 'started',
      });
    });
  });

  describe('markInProgress', () => {
    it('should transition execution to IN_PROGRESS', async () => {
      repository.findById.mockResolvedValue(mockExecution);
      stateMachine.transition.mockReturnValue({
        executionId: 'exec-123',
        previousStatus: ExecutionStatus.QUEUED,
        newStatus: ExecutionStatus.IN_PROGRESS,
        reason: 'AI execution started',
        transitionedAt: new Date(),
      });
      repository.updateStatus.mockResolvedValue({
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
      });
      repository.createAuditLog.mockResolvedValue();
      repository.updateTicketStatus.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);

      const result = await service.markInProgress('exec-123', 'corr-123');

      expect(result.newStatus).toBe(ExecutionStatus.IN_PROGRESS);
      expect(stateMachine.transition).toHaveBeenCalledWith(
        'exec-123',
        ExecutionStatus.QUEUED,
        ExecutionStatus.IN_PROGRESS,
        'AI execution started',
      );
    });

    it('should throw if execution not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.markInProgress('non-existent', 'corr-123')).rejects.toThrow(
        'Execution non-existent not found',
      );
    });
  });

  describe('completeExecution', () => {
    const completionData = {
      executionId: 'exec-123',
      codeOutput: '// Generated code',
      filesChanged: ['src/test.ts'],
      confidenceScore: 0.95,
    };

    it('should complete execution with results', async () => {
      const inProgressExecution = {
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
        started_at: new Date(Date.now() - 5000),
      };
      repository.findById.mockResolvedValue(inProgressExecution);
      stateMachine.transition.mockReturnValue({
        executionId: 'exec-123',
        previousStatus: ExecutionStatus.IN_PROGRESS,
        newStatus: ExecutionStatus.COMPLETED,
        reason: 'AI execution completed successfully',
        transitionedAt: new Date(),
      });
      repository.updateStatus.mockResolvedValue({
        ...inProgressExecution,
        status: ExecutionStatus.COMPLETED,
      });
      repository.createAuditLog.mockResolvedValue();
      repository.updateTicketStatus.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);

      const result = await service.completeExecution(completionData, 'corr-123');

      expect(result.newStatus).toBe(ExecutionStatus.COMPLETED);
      expect(repository.updateStatus).toHaveBeenCalledWith('exec-123', ExecutionStatus.COMPLETED, {
        codeOutput: '// Generated code',
        filesChanged: ['src/test.ts'],
        confidenceScore: 0.95,
      });
    });

    it('should track duration metrics', async () => {
      const inProgressExecution = {
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
        started_at: new Date(Date.now() - 5000),
      };
      repository.findById.mockResolvedValue(inProgressExecution);
      stateMachine.transition.mockReturnValue({
        executionId: 'exec-123',
        previousStatus: ExecutionStatus.IN_PROGRESS,
        newStatus: ExecutionStatus.COMPLETED,
        reason: 'AI execution completed successfully',
        transitionedAt: new Date(),
      });
      repository.updateStatus.mockResolvedValue({
        ...inProgressExecution,
        status: ExecutionStatus.COMPLETED,
      });
      repository.createAuditLog.mockResolvedValue();
      repository.updateTicketStatus.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);

      await service.completeExecution(completionData, 'corr-123');

      expect(mockMetricHistogram.observe).toHaveBeenCalledWith(
        { provider: AIProvider.CURSOR_HEADLESS, status: 'completed' },
        expect.any(Number),
      );
    });
  });

  describe('failExecution', () => {
    const failureData = {
      executionId: 'exec-123',
      errorMessage: 'Test error',
      isRetryable: true,
      errorCode: 'TEST_ERR',
    };

    it('should fail execution and schedule retry if retryable', async () => {
      const inProgressExecution = {
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
      };
      repository.findById.mockResolvedValue(inProgressExecution);
      stateMachine.transition.mockReturnValue({
        executionId: 'exec-123',
        previousStatus: ExecutionStatus.IN_PROGRESS,
        newStatus: ExecutionStatus.FAILED,
        reason: 'Test error',
        transitionedAt: new Date(),
      });
      repository.updateStatus.mockResolvedValue({
        ...inProgressExecution,
        status: ExecutionStatus.FAILED,
      });
      repository.createAuditLog.mockResolvedValue();
      repository.updateTicketStatus.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);
      repository.canRetry.mockResolvedValue({
        canRetry: true,
        retryCount: 0,
        maxRetries: 3,
      });
      repository.incrementRetryAndRequeue.mockResolvedValue({
        ...inProgressExecution,
        status: ExecutionStatus.QUEUED,
        retry_count: 1,
      });

      const result = await service.failExecution(failureData, 'corr-123');

      expect(result.newStatus).toBe(ExecutionStatus.FAILED);
      expect(repository.incrementRetryAndRequeue).toHaveBeenCalledWith('exec-123');
    });

    it('should not retry if max retries exceeded', async () => {
      const inProgressExecution = {
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
        retry_count: 3,
      };
      repository.findById.mockResolvedValue(inProgressExecution);
      stateMachine.transition.mockReturnValue({
        executionId: 'exec-123',
        previousStatus: ExecutionStatus.IN_PROGRESS,
        newStatus: ExecutionStatus.FAILED,
        reason: 'Test error',
        transitionedAt: new Date(),
      });
      repository.updateStatus.mockResolvedValue({
        ...inProgressExecution,
        status: ExecutionStatus.FAILED,
      });
      repository.createAuditLog.mockResolvedValue();
      repository.updateTicketStatus.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);
      repository.canRetry.mockResolvedValue({
        canRetry: false,
        retryCount: 3,
        maxRetries: 3,
      });

      await service.failExecution(failureData, 'corr-123');

      expect(repository.incrementRetryAndRequeue).not.toHaveBeenCalled();
    });
  });

  describe('timeoutExecution', () => {
    const timeoutData = {
      executionId: 'exec-123',
      timeoutSeconds: 300,
      lastKnownProgress: 'Generating code...',
    };

    it('should timeout execution and schedule retry', async () => {
      const inProgressExecution = {
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
      };
      repository.findById.mockResolvedValue(inProgressExecution);
      stateMachine.transition.mockReturnValue({
        executionId: 'exec-123',
        previousStatus: ExecutionStatus.IN_PROGRESS,
        newStatus: ExecutionStatus.TIMEOUT,
        reason: 'Execution timed out after 300 seconds',
        transitionedAt: new Date(),
      });
      repository.updateStatus.mockResolvedValue({
        ...inProgressExecution,
        status: ExecutionStatus.TIMEOUT,
      });
      repository.createAuditLog.mockResolvedValue();
      repository.updateTicketStatus.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);
      repository.canRetry.mockResolvedValue({
        canRetry: true,
        retryCount: 0,
        maxRetries: 3,
      });
      repository.incrementRetryAndRequeue.mockResolvedValue({
        ...inProgressExecution,
        status: ExecutionStatus.QUEUED,
        retry_count: 1,
      });

      const result = await service.timeoutExecution(timeoutData, 'corr-123');

      expect(result.newStatus).toBe(ExecutionStatus.TIMEOUT);
      expect(repository.incrementRetryAndRequeue).toHaveBeenCalledWith('exec-123');
    });

    it('should track timeout duration in metrics', async () => {
      const inProgressExecution = {
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
      };
      repository.findById.mockResolvedValue(inProgressExecution);
      stateMachine.transition.mockReturnValue({
        executionId: 'exec-123',
        previousStatus: ExecutionStatus.IN_PROGRESS,
        newStatus: ExecutionStatus.TIMEOUT,
        reason: 'Execution timed out after 300 seconds',
        transitionedAt: new Date(),
      });
      repository.updateStatus.mockResolvedValue({
        ...inProgressExecution,
        status: ExecutionStatus.TIMEOUT,
      });
      repository.createAuditLog.mockResolvedValue();
      repository.updateTicketStatus.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);
      repository.canRetry.mockResolvedValue({
        canRetry: false,
        retryCount: 3,
        maxRetries: 3,
      });

      await service.timeoutExecution(timeoutData, 'corr-123');

      expect(mockMetricHistogram.observe).toHaveBeenCalledWith(
        { provider: AIProvider.CURSOR_HEADLESS, status: 'timeout' },
        300,
      );
    });
  });

  describe('cancelExecution', () => {
    it('should cancel execution', async () => {
      repository.findById.mockResolvedValue(mockExecution);
      stateMachine.transition.mockReturnValue({
        executionId: 'exec-123',
        previousStatus: ExecutionStatus.QUEUED,
        newStatus: ExecutionStatus.CANCELLED,
        reason: 'User cancelled',
        transitionedAt: new Date(),
      });
      repository.updateStatus.mockResolvedValue({
        ...mockExecution,
        status: ExecutionStatus.CANCELLED,
      });
      repository.createAuditLog.mockResolvedValue();
      repository.updateTicketStatus.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);

      const result = await service.cancelExecution('exec-123', 'User cancelled', 'corr-123');

      expect(result.newStatus).toBe(ExecutionStatus.CANCELLED);
      expect(mockMetricCounter.inc).toHaveBeenCalledWith({
        provider: AIProvider.CURSOR_HEADLESS,
        status: 'cancelled',
      });
    });
  });

  describe('getExecution', () => {
    it('should return execution by ID', async () => {
      repository.findById.mockResolvedValue(mockExecution);

      const result = await service.getExecution('exec-123');

      expect(result).toEqual(mockExecution);
    });

    it('should return null if not found', async () => {
      repository.findById.mockResolvedValue(null);

      const result = await service.getExecution('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getExecutionsForTicket', () => {
    it('should return executions for ticket', async () => {
      repository.findByTicketId.mockResolvedValue([mockExecution]);

      const result = await service.getExecutionsForTicket('ticket-123');

      expect(result).toEqual([mockExecution]);
    });
  });

  describe('event emission error handling', () => {
    it('should not throw if RabbitMQ publish fails', async () => {
      repository.create.mockResolvedValue(mockExecution);
      repository.createAuditLog.mockResolvedValue();
      publisher.publishToQueue.mockRejectedValue(new Error('Connection failed'));

      // Should not throw
      await expect(
        service.startExecution({
          correlationId: 'corr-123',
          ticketId: 'ticket-123',
          clickupTaskId: 'cu-123',
          provider: AIProvider.CURSOR_HEADLESS,
          prompt: 'test',
          promptMetadata: {
            promptLength: 100,
            estimatedTokens: 200,
            templateVersion: '1.0.0',
            generatedAt: new Date().toISOString(),
          },
          complexityScore: 50,
        }),
      ).resolves.toEqual(mockExecution);
    });
  });
});
