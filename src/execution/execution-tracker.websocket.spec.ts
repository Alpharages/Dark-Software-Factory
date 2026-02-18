import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutionTrackerService } from './execution-tracker.service';
import { ExecutionRepository } from './execution.repository';
import { ExecutionStateMachine } from './state-machine';
import { RealtimeService } from '../realtime/realtime.service';
import { ExecutionActivityRepository } from './repositories/execution-activity.repository';
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';
import { ExecutionStatus, AIProvider } from '@/prisma/client';
describe('ExecutionTrackerService WebSocket Streaming', () => {
  // Variables used in tests via closure, but defined here for potential shared setup access
  // if strictly unused in describe block scope but used in beforeEach/tests,
  // ensure they are actually used or remove the let if we only use module.get() inside.
  // Actually, looking at the code, 'service' IS used.
  // The lint error might be spurious or referring to the fact that they are 'let' but never re-assigned?
  // or maybe they are shadowed?
  // Let's just remove the explicit type if TS infers it or ensure they are used.
  // Wait, the lint error 13:7 'realtimeService' is assigned a value but never used.
  // Line 93: realtimeService = module.get<RealtimeService>(RealtimeService);
  // Is it used in 'it' blocks?
  // Yes: expect(mockRealtimeService.emitToProject)...
  // AH! I am using 'mockRealtimeService' (the const object) in expectations, NOT the 'realtimeService' instance from the module.
  // So 'realtimeService', 'repository', 'stateMachine' variables ARE indeed unused in the tests because I check calls on the MOCKS.
  // 'service' IS used to call methods.
  // So I should remove 'realtimeService', 'repository', 'stateMachine' variables and their assignments,
  // since I have handle on the mocks directly.

  let service: ExecutionTrackerService;

  const mockRealtimeService = {
    emitToProject: jest.fn(),
    emitToRole: jest.fn(),
  };

  const mockRepository = {
    findById: jest.fn(),
    create: jest.fn(),
    updateStatus: jest.fn(),
    createAuditLog: jest.fn(),
    updateTicketStatus: jest.fn(),
    incrementRetryAndRequeue: jest.fn(),
    canRetry: jest.fn(),
    getActiveCountByProvider: jest.fn(),
  };

  const mockStateMachine = {
    transition: jest.fn(),
  };

  const mockMetrics = {
    inc: jest.fn(),
    startTimer: jest.fn(() => jest.fn()),
    observe: jest.fn(),
    set: jest.fn(),
  };

  const mockRabbitTimer = {
    publishToQueue: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionTrackerService,
        {
          provide: ExecutionRepository,
          useValue: mockRepository,
        },
        {
          provide: ExecutionStateMachine,
          useValue: mockStateMachine,
        },
        {
          provide: RabbitMQPublisherService,
          useValue: mockRabbitTimer,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: RealtimeService,
          useValue: mockRealtimeService,
        },
        {
          provide: 'PROM_METRIC_DSF_AI_EXECUTIONS_TOTAL',
          useValue: mockMetrics,
        },
        {
          provide: ExecutionActivityRepository,
          useValue: {
            create: jest.fn(),
            findByExecutionId: jest.fn(),
            findRecentByExecutionId: jest.fn(),
          },
        },
        {
          provide: 'PROM_METRIC_DSF_AI_EXECUTION_DURATION_SECONDS',
          useValue: mockMetrics,
        },
        {
          provide: 'PROM_METRIC_DSF_EXECUTION_STATUS_GAUGE',
          useValue: mockMetrics,
        },
        {
          provide: 'PROM_METRIC_DSF_EXECUTION_RETRY_TOTAL',
          useValue: mockMetrics,
        },
        {
          provide: 'PROM_METRIC_DSF_CONTAINER_LOG_BYTES_TOTAL',
          useValue: mockMetrics,
        },
        {
          provide: 'PROM_METRIC_DSF_CONTAINER_EXEC_DURATION_SECONDS',
          useValue: mockMetrics,
        },
        {
          provide: 'PROM_METRIC_WEBSOCKET_EMISSION_ERRORS_TOTAL',
          useValue: mockMetrics,
        },
      ],
    }).compile();

    service = module.get<ExecutionTrackerService>(ExecutionTrackerService);

    // Mocks are used directly for assertions, so we don't need to retain references to the injected services
    // except for 'service' which is the CUT (Code Under Test).

    // Default mock setup
    mockRepository.getActiveCountByProvider.mockResolvedValue({
      [AIProvider.CURSOR_HEADLESS]: 0,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('markInProgress', () => {
    it('should emit execution.started and execution.progress events', async () => {
      const executionId = 'exec-1';
      const correlationId = 'corr-1';
      const mockExecution = {
        id: executionId,
        ticket_id: 'ticket-1',
        ai_provider: AIProvider.CURSOR_HEADLESS,
        status: ExecutionStatus.QUEUED,
        complexity_score: 5,
        ticket: { project_id: 'proj-1' },
      };

      mockRepository.findById.mockResolvedValue(mockExecution);
      mockStateMachine.transition.mockReturnValue({
        executionId,
        previousStatus: ExecutionStatus.QUEUED,
        newStatus: ExecutionStatus.IN_PROGRESS,
        transitionedAt: new Date(),
      });
      mockRepository.updateStatus.mockResolvedValue(mockExecution); // Added to prevent undefined

      await service.markInProgress(executionId, correlationId);

      // Verify execution.started emission
      expect(mockRealtimeService.emitToProject).toHaveBeenCalledWith(
        'proj-1',
        'execution.started',
        expect.objectContaining({
          executionId,
          aiProvider: AIProvider.CURSOR_HEADLESS,
        }),
      );

      // Verify execution.progress emission (initial 0%)
      expect(mockRealtimeService.emitToProject).toHaveBeenCalledWith(
        'proj-1',
        'execution.progress',
        expect.objectContaining({
          executionId,
          percentComplete: 0,
          currentStep: 'Starting execution',
        }),
      );
    });

    it('should fallback to role-based emission if projectId is missing', async () => {
      const executionId = 'exec-1';
      const correlationId = 'corr-1';
      const mockExecution = {
        id: executionId,
        ticket_id: 'ticket-1',
        ai_provider: AIProvider.CURSOR_HEADLESS,
        status: ExecutionStatus.QUEUED,
        ticket: null, // No ticket info linked yet or lookup failed part
      };

      mockRepository.findById.mockResolvedValue(mockExecution);
      mockStateMachine.transition.mockReturnValue({
        executionId,
        previousStatus: ExecutionStatus.QUEUED,
        newStatus: ExecutionStatus.IN_PROGRESS,
        transitionedAt: new Date(),
        reason: 'Start',
      });
      mockRepository.updateStatus.mockResolvedValue(mockExecution);

      await service.markInProgress(executionId, correlationId);

      expect(mockRealtimeService.emitToProject).not.toHaveBeenCalled();
      expect(mockRealtimeService.emitToRole).toHaveBeenCalledWith(
        'ADMIN',
        'execution.started',
        expect.anything(),
      );
    });
  });

  describe('completeExecution', () => {
    it('should emit execution.completed event', async () => {
      const executionId = 'exec-1';
      const mockExecution = {
        id: executionId,
        ticket_id: 'ticket-1',
        ai_provider: AIProvider.CLAUDE_CODE,
        status: ExecutionStatus.IN_PROGRESS,
        started_at: new Date(Date.now() - 10000), // 10s ago
        ticket: { project_id: 'proj-1' },
      };

      mockRepository.findById.mockResolvedValue(mockExecution);
      mockStateMachine.transition.mockReturnValue({});
      mockRepository.updateStatus.mockResolvedValue(mockExecution);

      await service.completeExecution(
        {
          executionId,
          codeOutput: 'completion output',
          filesChanged: [],
          confidenceScore: 0.95,
        },
        'corr-1',
      );

      expect(mockRealtimeService.emitToProject).toHaveBeenCalledWith(
        'proj-1',
        'execution.completed',
        expect.objectContaining({
          status: ExecutionStatus.COMPLETED,
          payload: expect.objectContaining({
            confidenceScore: 0.95,
          }),
        }),
      );
    });
  });

  describe('failExecution', () => {
    it('should emit execution.failed event', async () => {
      const executionId = 'exec-1';
      const mockExecution = {
        id: executionId,
        ticket_id: 'ticket-1',
        ai_provider: AIProvider.CURSOR_HEADLESS,
        status: ExecutionStatus.IN_PROGRESS,
        retry_count: 1,
        max_retries: 3,
        ticket: { project_id: 'proj-1' },
      };

      mockRepository.findById.mockResolvedValue(mockExecution);
      mockStateMachine.transition.mockReturnValue({});
      mockRepository.updateStatus.mockResolvedValue(mockExecution);
      mockRepository.canRetry.mockResolvedValue({ canRetry: false }); // Ensure no retry loop logic triggers unexpectedly

      await service.failExecution(
        {
          executionId,
          errorMessage: 'Some Error',
          isRetryable: false,
          errorCode: 'ERR_01',
        },
        'corr-1',
      );

      expect(mockRealtimeService.emitToProject).toHaveBeenCalledWith(
        'proj-1',
        'execution.failed',
        expect.objectContaining({
          status: ExecutionStatus.FAILED,
          payload: expect.objectContaining({
            errorMessage: 'Some Error',
            errorCode: 'ERR_01',
          }),
        }),
      );
    });
  });

  describe('emitProgress', () => {
    it('should emit progress and respect rate limiting', async () => {
      const executionId = 'exec-1';

      // Mock Date.now() to control time
      let currentTime = 1000;
      jest.spyOn(Date, 'now').mockImplementation(() => currentTime);

      // First emit (0%) - should go through (always emitted)
      await service.emitProgress(executionId, 'ticket-1', 'proj-1', 'Step 1', 0);
      expect(mockRealtimeService.emitToProject).toHaveBeenCalledTimes(1);

      // Second emit (10%) with same step immediately - should be skipped (rate limited, < 500ms)
      currentTime += 100; // Only 100ms passed
      await service.emitProgress(executionId, 'ticket-1', 'proj-1', 'Step 1', 10);
      expect(mockRealtimeService.emitToProject).toHaveBeenCalledTimes(1);

      // Advance time by 600ms (> 500ms threshold)
      currentTime += 600;

      // Third emit (20%) - should go through now
      await service.emitProgress(executionId, 'ticket-1', 'proj-1', 'Step 1', 20);
      expect(mockRealtimeService.emitToProject).toHaveBeenCalledTimes(2);

      jest.restoreAllMocks();
    });
  });

  describe('Error Handling', () => {
    it('should catch errors and increment metric', async () => {
      const executionId = 'exec-1';
      mockRealtimeService.emitToProject.mockImplementationOnce(() => {
        throw new Error('Socket error');
      });

      await service.emitProgress(executionId, 'ticket-1', 'proj-1', 'Step X', 50);

      expect(mockMetrics.inc).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'execution.progress',
          reason: 'Socket error',
        }),
      );
    });
  });
});
