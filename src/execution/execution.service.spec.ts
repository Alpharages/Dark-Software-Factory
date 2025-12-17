import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionService } from './execution.service';
import { ExecutionTrackerService } from './execution-tracker.service';
import { ExecutionStateMachine, InvalidStateTransitionError } from './state-machine';
import { ExecutionStatus, AIProvider } from '@/prisma/client';
import {
  StartExecutionDto,
  CompleteExecutionDto,
  FailExecutionDto,
  PromptMetadataSnapshotDto,
} from './dto';
import { IStateTransition } from './interfaces';
import { QaCheckPublisher } from '../qa-automation/qa-check.publisher'; // Story 3.7 integration

describe('ExecutionService', () => {
  let service: ExecutionService;
  let trackerService: ExecutionTrackerService;
  let stateMachine: ExecutionStateMachine;

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
    complexity_score: null,
    complexity_breakdown: null,
    routing_reason: null,
    fallback_used: false,
    original_provider: null,
    error_context: null, // Story 2.9
    scheduled_retry_at: null, // Story 2.9
  };

  const mockTransition: IStateTransition = {
    executionId: 'exec-123',
    previousStatus: ExecutionStatus.QUEUED,
    newStatus: ExecutionStatus.IN_PROGRESS,
    reason: 'Test transition',
    transitionedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionService,
        {
          provide: ExecutionTrackerService,
          useValue: {
            startExecution: jest.fn(),
            markInProgress: jest.fn(),
            completeExecution: jest.fn(),
            failExecution: jest.fn(),
            timeoutExecution: jest.fn(),
            cancelExecution: jest.fn(),
            getExecution: jest.fn(),
            getExecutionsForTicket: jest.fn(),
          },
        },
        {
          provide: ExecutionStateMachine,
          useValue: {
            canStart: jest.fn(),
            canComplete: jest.fn(),
            isTerminal: jest.fn(),
            transition: jest.fn(),
          },
        },
        {
          // Story 3.7: QaCheckPublisher added to ExecutionService constructor
          provide: QaCheckPublisher,
          useValue: {
            publishQaCheck: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<ExecutionService>(ExecutionService);
    trackerService = module.get<ExecutionTrackerService>(ExecutionTrackerService);
    stateMachine = module.get<ExecutionStateMachine>(ExecutionStateMachine);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startExecution', () => {
    it('should start execution and return response DTO', async () => {
      const dto: StartExecutionDto = {
        correlationId: 'corr-123',
        ticketId: 'ticket-123',
        clickupTaskId: 'cu-123',
        provider: AIProvider.CURSOR_HEADLESS,
        prompt: 'test prompt',
        complexityScore: 50,
        promptMetadata: {
          promptLength: 100,
          estimatedTokens: 200,
          templateVersion: '1.0.0',
          generatedAt: new Date().toISOString(),
        } as PromptMetadataSnapshotDto,
      };

      jest.spyOn(trackerService, 'startExecution').mockResolvedValue(mockExecution);

      const result = await service.startExecution(dto);

      expect(result).toBeDefined();
      expect(result.id).toBe('exec-123');
      expect(result.status).toBe(ExecutionStatus.QUEUED);
      expect(trackerService.startExecution).toHaveBeenCalled();
    });
  });

  describe('markInProgress', () => {
    it('should mark execution as in progress', async () => {
      jest.spyOn(trackerService, 'markInProgress').mockResolvedValue(mockTransition);

      const result = await service.markInProgress('exec-123', 'corr-123');

      expect(result).toBeDefined();
      expect(result.newStatus).toBe(ExecutionStatus.IN_PROGRESS);
      expect(trackerService.markInProgress).toHaveBeenCalledWith('exec-123', 'corr-123');
    });
  });

  describe('completeExecution', () => {
    it('should complete execution with results', async () => {
      const dto: CompleteExecutionDto = {
        executionId: 'exec-123',
        codeOutput: '// Generated code',
        filesChanged: ['src/test.ts'],
        confidenceScore: 0.95,
      };

      jest.spyOn(trackerService, 'completeExecution').mockResolvedValue({
        ...mockTransition,
        newStatus: ExecutionStatus.COMPLETED,
      });

      const result = await service.completeExecution(dto, 'corr-123');

      expect(result).toBeDefined();
      expect(result.newStatus).toBe(ExecutionStatus.COMPLETED);
      expect(trackerService.completeExecution).toHaveBeenCalled();
    });
  });

  describe('failExecution', () => {
    it('should fail execution with error', async () => {
      const dto: FailExecutionDto = {
        executionId: 'exec-123',
        errorMessage: 'Test error',
        errorCode: 'TEST_ERR',
      };

      jest.spyOn(trackerService, 'failExecution').mockResolvedValue({
        ...mockTransition,
        newStatus: ExecutionStatus.FAILED,
      });

      const result = await service.failExecution(dto, 'corr-123', true);

      expect(result).toBeDefined();
      expect(result.newStatus).toBe(ExecutionStatus.FAILED);
      expect(trackerService.failExecution).toHaveBeenCalled();
    });
  });

  describe('timeoutExecution', () => {
    it('should timeout execution', async () => {
      jest.spyOn(trackerService, 'timeoutExecution').mockResolvedValue({
        ...mockTransition,
        newStatus: ExecutionStatus.TIMEOUT,
      });

      const result = await service.timeoutExecution('exec-123', 300, 'corr-123');

      expect(result).toBeDefined();
      expect(result.newStatus).toBe(ExecutionStatus.TIMEOUT);
      expect(trackerService.timeoutExecution).toHaveBeenCalled();
    });
  });

  describe('cancelExecution', () => {
    it('should cancel execution', async () => {
      jest.spyOn(trackerService, 'cancelExecution').mockResolvedValue({
        ...mockTransition,
        newStatus: ExecutionStatus.CANCELLED,
      });

      const result = await service.cancelExecution('exec-123', 'User cancelled', 'corr-123');

      expect(result).toBeDefined();
      expect(result.newStatus).toBe(ExecutionStatus.CANCELLED);
      expect(trackerService.cancelExecution).toHaveBeenCalledWith(
        'exec-123',
        'User cancelled',
        'corr-123',
      );
    });
  });

  describe('getExecution', () => {
    it('should return execution by ID', async () => {
      jest.spyOn(trackerService, 'getExecution').mockResolvedValue(mockExecution);

      const result = await service.getExecution('exec-123');

      expect(result).toBeDefined();
      expect(result?.id).toBe('exec-123');
    });

    it('should return null if execution not found', async () => {
      jest.spyOn(trackerService, 'getExecution').mockResolvedValue(null);

      const result = await service.getExecution('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('state machine helpers', () => {
    it('should check if can start from QUEUED', () => {
      jest.spyOn(stateMachine, 'canStart').mockReturnValue(true);

      const result = service.canStart(ExecutionStatus.QUEUED);

      expect(result).toBe(true);
      expect(stateMachine.canStart).toHaveBeenCalledWith(ExecutionStatus.QUEUED);
    });

    it('should check if can complete', () => {
      jest.spyOn(stateMachine, 'canComplete').mockReturnValue(true);

      const result = service.canComplete(ExecutionStatus.IN_PROGRESS);

      expect(result).toBe(true);
    });

    it('should check if status is terminal', () => {
      jest.spyOn(stateMachine, 'isTerminal').mockReturnValue(true);

      const result = service.isTerminal(ExecutionStatus.COMPLETED);

      expect(result).toBe(true);
    });
  });
});

describe('ExecutionStateMachine', () => {
  let stateMachine: ExecutionStateMachine;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExecutionStateMachine],
    }).compile();

    stateMachine = module.get<ExecutionStateMachine>(ExecutionStateMachine);
  });

  it('should be defined', () => {
    expect(stateMachine).toBeDefined();
  });

  describe('valid transitions', () => {
    it('should allow QUEUED → IN_PROGRESS', () => {
      const transition = stateMachine.transition(
        'exec-123',
        ExecutionStatus.QUEUED,
        ExecutionStatus.IN_PROGRESS,
        'Starting',
      );

      expect(transition).toBeDefined();
      expect(transition.previousStatus).toBe(ExecutionStatus.QUEUED);
      expect(transition.newStatus).toBe(ExecutionStatus.IN_PROGRESS);
    });

    it('should allow IN_PROGRESS → COMPLETED', () => {
      const transition = stateMachine.transition(
        'exec-123',
        ExecutionStatus.IN_PROGRESS,
        ExecutionStatus.COMPLETED,
        'Done',
      );

      expect(transition).toBeDefined();
      expect(transition.newStatus).toBe(ExecutionStatus.COMPLETED);
    });

    it('should allow FAILED → QUEUED (retry)', () => {
      const transition = stateMachine.transition(
        'exec-123',
        ExecutionStatus.FAILED,
        ExecutionStatus.QUEUED,
        'Retry',
      );

      expect(transition).toBeDefined();
      expect(transition.newStatus).toBe(ExecutionStatus.QUEUED);
    });
  });

  describe('invalid transitions', () => {
    it('should reject QUEUED → COMPLETED', () => {
      expect(() => {
        stateMachine.transition('exec-123', ExecutionStatus.QUEUED, ExecutionStatus.COMPLETED);
      }).toThrow(InvalidStateTransitionError);
    });

    it('should reject COMPLETED → IN_PROGRESS', () => {
      expect(() => {
        stateMachine.transition('exec-123', ExecutionStatus.COMPLETED, ExecutionStatus.IN_PROGRESS);
      }).toThrow(InvalidStateTransitionError);
    });
  });

  describe('same state', () => {
    it('should return no-op for same state', () => {
      const transition = stateMachine.transition(
        'exec-123',
        ExecutionStatus.QUEUED,
        ExecutionStatus.QUEUED,
      );

      expect(transition.reason).toBe('No change');
    });
  });

  describe('helper methods', () => {
    it('should correctly identify retryable status', () => {
      const result = stateMachine.canRetry(ExecutionStatus.FAILED, 1, 3);
      expect(result).toBe(true);
    });

    it('should reject retry if max retries exceeded', () => {
      const result = stateMachine.canRetry(ExecutionStatus.FAILED, 3, 3);
      expect(result).toBe(false);
    });

    it('should identify terminal states', () => {
      expect(stateMachine.isTerminal(ExecutionStatus.COMPLETED)).toBe(true);
      expect(stateMachine.isTerminal(ExecutionStatus.CANCELLED)).toBe(true);
      expect(stateMachine.isTerminal(ExecutionStatus.IN_PROGRESS)).toBe(false);
    });
  });
});
