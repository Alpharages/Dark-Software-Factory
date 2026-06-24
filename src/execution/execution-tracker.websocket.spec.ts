import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutionTrackerService } from './execution-tracker.service';
import { ExecutionRepository } from './execution.repository';
import { RealtimeService } from '../realtime/realtime.service';
import { ExecutionActivityRepository } from './repositories/execution-activity.repository';
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';
import { ExecutionStatus, AIProvider } from '@/prisma/client';
describe('ExecutionTrackerService WebSocket Streaming', () => {
  // Only `service` is held as an instance — assertions run against the mock
  // objects (mockRealtimeService, mockRepository) directly, so the resolved
  // dependencies don't need their own variables.

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
    getActiveCountByProvider: jest.fn(),
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
      [AIProvider.CLAUDE_CODE]: 0,
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
        ai_provider: AIProvider.CLAUDE_CODE,
        status: ExecutionStatus.QUEUED,
        complexity_score: 5,
        ticket: { project_id: 'proj-1' },
      };

      mockRepository.findById.mockResolvedValue(mockExecution);
      mockRepository.updateStatus.mockResolvedValue(mockExecution); // Added to prevent undefined

      await service.markInProgress(executionId, correlationId);

      // Verify execution.started emission
      expect(mockRealtimeService.emitToProject).toHaveBeenCalledWith(
        'proj-1',
        'execution.started',
        expect.objectContaining({
          executionId,
          aiProvider: AIProvider.CLAUDE_CODE,
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
        ai_provider: AIProvider.CLAUDE_CODE,
        status: ExecutionStatus.QUEUED,
        ticket: null, // No ticket info linked yet or lookup failed part
      };

      mockRepository.findById.mockResolvedValue(mockExecution);
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

      await service.emitProgress(executionId, 'ticket-1', 'proj-1', 'Step X', 50);

      expect(mockRealtimeService.emitToProject).toHaveBeenCalledWith(
        'proj-1',
        'execution.progress',
        expect.objectContaining({
          executionId,
          currentStep: 'Step X',
          percentComplete: 50,
        }),
      );
    });
  });
});
