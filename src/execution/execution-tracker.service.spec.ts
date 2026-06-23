import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutionTrackerService } from './execution-tracker.service';
import { ExecutionRepository } from './execution.repository';
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';
import { ExecutionStatus, AIProvider, PRRiskLevel } from '@/prisma/client';
import { RealtimeService } from '@/realtime/realtime.service';
import { ExecutionActivityRepository } from './repositories/execution-activity.repository';

describe('ExecutionTrackerService', () => {
  let service: ExecutionTrackerService;
  let repository: jest.Mocked<ExecutionRepository>;
  let publisher: jest.Mocked<RabbitMQPublisherService>;

  const mockExecution = {
    id: 'exec-123',
    ticket_id: 'ticket-123',
    ai_provider: AIProvider.CLAUDE_CODE,
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
    progress: null,
    qa_failed_branch: null,
    qa_attempts: null, // WR-6.1
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
            update: jest.fn(),
            incrementRetryAndRequeue: jest.fn(),
            canRetry: jest.fn(),
            createAuditLog: jest.fn(),
            updateTicketStatus: jest.fn(),
            getActiveCountByProvider: jest.fn(),
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
          provide: 'PROM_METRIC_DSF_AI_EXECUTIONS_TOTAL',
          useValue: mockMetricCounter,
        },
        {
          provide: 'PROM_METRIC_DSF_AI_EXECUTION_DURATION_SECONDS',
          useValue: mockMetricHistogram,
        },
        {
          provide: 'PROM_METRIC_DSF_EXECUTION_STATUS_GAUGE',
          useValue: mockMetricGauge,
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
          provide: 'PROM_METRIC_WEBSOCKET_EMISSION_ERRORS_TOTAL',
          useValue: mockMetricCounter,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(true),
          },
        },
        {
          provide: RealtimeService,
          useValue: {
            emitToProject: jest.fn(),
            emitToRole: jest.fn(),
          },
        },
        {
          provide: ExecutionActivityRepository,
          useValue: {
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ExecutionTrackerService>(ExecutionTrackerService);
    repository = module.get(ExecutionRepository);
    publisher = module.get(RabbitMQPublisherService);

    // Default mocks
    repository.getActiveCountByProvider.mockResolvedValue({
      [AIProvider.CLAUDE_CODE]: 0,
      [AIProvider.GEMINI]: 0,
      [AIProvider.CODEX]: 0,
      [AIProvider.KIMI]: 0,
      [AIProvider.OPENHARNESS]: 0,
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
      provider: AIProvider.CLAUDE_CODE,
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
        provider: AIProvider.CLAUDE_CODE,
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
        provider: AIProvider.CLAUDE_CODE,
        status: 'started',
      });
    });
  });

  describe('markInProgress', () => {
    it('should transition execution to IN_PROGRESS', async () => {
      repository.findById.mockResolvedValue(mockExecution);
      repository.updateStatus.mockResolvedValue({
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
      });
      repository.createAuditLog.mockResolvedValue();
      repository.updateTicketStatus.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);

      const result = await service.markInProgress('exec-123', 'corr-123');

      expect(result.newStatus).toBe(ExecutionStatus.IN_PROGRESS);
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
      repository.updateStatus.mockResolvedValue({
        ...inProgressExecution,
        status: ExecutionStatus.COMPLETED,
      });
      repository.createAuditLog.mockResolvedValue();
      repository.updateTicketStatus.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);

      await service.completeExecution(completionData, 'corr-123');

      expect(mockMetricHistogram.observe).toHaveBeenCalledWith(
        { provider: AIProvider.CLAUDE_CODE, status: 'completed' },
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

    it('should fail execution without requeueing retry', async () => {
      const inProgressExecution = {
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
      };
      repository.findById.mockResolvedValue(inProgressExecution);
      repository.updateStatus.mockResolvedValue({
        ...inProgressExecution,
        status: ExecutionStatus.FAILED,
      });
      repository.createAuditLog.mockResolvedValue();
      repository.updateTicketStatus.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);

      const result = await service.failExecution(failureData, 'corr-123');

      expect(result.newStatus).toBe(ExecutionStatus.FAILED);
      expect(repository.incrementRetryAndRequeue).not.toHaveBeenCalled();
    });

    it('should not retry if max retries exceeded', async () => {
      const inProgressExecution = {
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
        retry_count: 3,
      };
      repository.findById.mockResolvedValue(inProgressExecution);
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

  describe('qaFailExecution', () => {
    const qaFailureData = {
      executionId: 'exec-123',
      errorMessage: 'QA failed 3 times',
      branchName: 'feature/test-branch',
      qaRetryCount: 3,
      qaAttempts: [
        {
          attemptNumber: 1,
          lintStatus: 'failed' as const,
          testStatus: 'failed' as const,
          durationMs: 1000,
        } as any,
      ],
    };

    it('should transition execution to QA_FAILED and persist branch name', async () => {
      const inProgressExecution = {
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
        ticket: { project_id: 'proj-1' },
      } as any;
      repository.findById.mockResolvedValue(inProgressExecution);
      repository.updateStatus.mockResolvedValue({
        ...inProgressExecution,
        status: ExecutionStatus.QA_FAILED as any,
      });
      repository.update.mockResolvedValue({
        ...inProgressExecution,
        qa_failed_branch: 'feature/test-branch',
      });
      repository.createAuditLog.mockResolvedValue();
      repository.updateTicketStatus.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);

      const result = await service.qaFailExecution(qaFailureData, 'corr-123');

      expect(result.newStatus).toBe(ExecutionStatus.QA_FAILED as any);
      expect(repository.updateStatus).toHaveBeenCalledWith(
        'exec-123',
        ExecutionStatus.QA_FAILED as any,
        {
          errorMessage: 'QA failed 3 times',
          branchName: 'feature/test-branch',
          qaAttempts: qaFailureData.qaAttempts,
        },
      );
      expect(repository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'qa_failed',
          afterState: expect.objectContaining({
            status: ExecutionStatus.QA_FAILED as any,
            errorMessage: 'QA failed 3 times',
            branchName: 'feature/test-branch',
            qaRetryCount: 3,
          }),
        }),
      );
      expect(publisher.publishToQueue).toHaveBeenCalledWith(
        'execution-status-queue',
        expect.objectContaining({
          status: ExecutionStatus.QA_FAILED as any,
        }),
      );
    });

    it('should emit execution.qa_failed WebSocket event with branch and error payload', async () => {
      const inProgressExecution = {
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
        ticket: { project_id: 'proj-1' },
      } as any;
      repository.findById.mockResolvedValue(inProgressExecution);
      repository.updateStatus.mockResolvedValue({
        ...inProgressExecution,
        status: ExecutionStatus.QA_FAILED as any,
      });
      repository.createAuditLog.mockResolvedValue();
      repository.updateTicketStatus.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);

      const realtimeService = (service as any).realtimeService;

      await service.qaFailExecution(qaFailureData, 'corr-123');

      expect(realtimeService.emitToProject).toHaveBeenCalledWith(
        'proj-1',
        'execution.qa_failed',
        expect.objectContaining({
          executionId: 'exec-123',
          payload: expect.objectContaining({
            errorMessage: 'QA failed 3 times',
            branchName: 'feature/test-branch',
          }),
        }),
      );
    });

    it('should leave QA_FAILED without automatic retry', async () => {
      const inProgressExecution = {
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
        ticket: { project_id: 'proj-1' },
      } as any;
      repository.findById.mockResolvedValue(inProgressExecution);
      repository.updateStatus.mockResolvedValue({
        ...inProgressExecution,
        status: ExecutionStatus.QA_FAILED as any,
      });
      repository.createAuditLog.mockResolvedValue();
      repository.updateTicketStatus.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);

      await service.qaFailExecution(qaFailureData, 'corr-123');

      expect(repository.incrementRetryAndRequeue).not.toHaveBeenCalled();
    });

    it('should create audit log with action qa_failed', async () => {
      const inProgressExecution = {
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
        ticket: { project_id: 'proj-1' },
      } as any;
      repository.findById.mockResolvedValue(inProgressExecution);
      repository.updateStatus.mockResolvedValue({
        ...inProgressExecution,
        status: ExecutionStatus.QA_FAILED as any,
      });
      repository.createAuditLog.mockResolvedValue();
      repository.updateTicketStatus.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);

      await service.qaFailExecution(qaFailureData, 'corr-123');

      expect(repository.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'qa_failed' }),
      );
    });
  });

  describe('timeoutExecution', () => {
    const timeoutData = {
      executionId: 'exec-123',
      timeoutSeconds: 300,
      lastKnownProgress: 'Generating code...',
    };

    it('should timeout execution without requeueing retry', async () => {
      const inProgressExecution = {
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
      };
      repository.findById.mockResolvedValue(inProgressExecution);
      repository.updateStatus.mockResolvedValue({
        ...inProgressExecution,
        status: ExecutionStatus.TIMEOUT,
      });
      repository.createAuditLog.mockResolvedValue();
      repository.updateTicketStatus.mockResolvedValue();
      publisher.publishToQueue.mockResolvedValue(true);

      const result = await service.timeoutExecution(timeoutData, 'corr-123');

      expect(result.newStatus).toBe(ExecutionStatus.TIMEOUT);
      expect(repository.incrementRetryAndRequeue).not.toHaveBeenCalled();
    });

    it('should track timeout duration in metrics', async () => {
      const inProgressExecution = {
        ...mockExecution,
        status: ExecutionStatus.IN_PROGRESS,
      };
      repository.findById.mockResolvedValue(inProgressExecution);
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
        { provider: AIProvider.CLAUDE_CODE, status: 'timeout' },
        300,
      );
    });
  });

  describe('cancelExecution', () => {
    it('should cancel execution', async () => {
      repository.findById.mockResolvedValue(mockExecution);
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
        provider: AIProvider.CLAUDE_CODE,
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
          provider: AIProvider.CLAUDE_CODE,
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

  describe('persistQaAttempts', () => {
    it('should update execution with qa_attempts', async () => {
      const qaAttempts: any[] = [
        {
          attemptNumber: 1,
          lintStatus: 'passed' as const,
          testStatus: 'passed' as const,
          durationMs: 1000,
        },
      ];
      repository.update.mockResolvedValue();

      await service.persistQaAttempts('exec-123', qaAttempts, 'corr-123');

      expect(repository.update).toHaveBeenCalledWith('exec-123', {
        qa_attempts: qaAttempts,
      });
    });

    it('should log error but not throw if update fails', async () => {
      repository.update.mockRejectedValue(new Error('DB error'));

      // Should not throw (tests Prisma.JsonNull branch — null is coalesced sentinel)
      await expect(
        service.persistQaAttempts('exec-123', null, 'corr-123'),
      ).resolves.toBeUndefined();
    });
  });
});
