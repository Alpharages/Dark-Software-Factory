import { TicketStatus } from '@/prisma/client';
import { TicketIntakeService } from './ticket-intake.service';
import { TicketValidatorService } from './ticket-validator.service';
import { TicketQualityService } from './ticket-quality.service';
import { IRawTaskEvent } from './interfaces';
import { ValidationResultDto } from './dto';
import { CircularDependencyDetectorService } from '../dependencies/circular-dependency-detector.service';
import { DependencyManagerService } from '../dependencies/dependency-manager.service';
// Story 20.1: Provider-Agnostic Intake imports
import { ITaskEvent, TaskProviderType, TaskTriggerSource } from './dto';

describe('TicketIntakeService', () => {
  let service: TicketIntakeService;
  let mockPrisma: {
    ticket: { findUnique: jest.Mock; findFirst: jest.Mock; upsert: jest.Mock };
    auditLog: { create: jest.Mock };
    execution: { findFirst: jest.Mock }; // Story 20.1: For idempotency check
  };
  let mockRabbitMQPublisher: { publishToQueue: jest.Mock };
  let mockConfigService: { get: jest.Mock };
  let mockValidator: { validate: jest.Mock; formatErrorsForComment: jest.Mock };
  let mockQualityService: { calculateScore: jest.Mock };
  let mockIntakeCounter: { inc: jest.Mock };
  let mockDurationHistogram: { startTimer: jest.Mock };
  let mockValidationCounter: { inc: jest.Mock };
  let mockQualityHistogram: { observe: jest.Mock };
  let mockCircularDetector: { detectCircularDependencies: jest.Mock };
  let mockDependencyManager: { checkDependencies: jest.Mock; isStatusResolved: jest.Mock };
  let mockWaitingCounter: { inc: jest.Mock };
  let mockCircularCounter: { inc: jest.Mock };

  let mockProjectService: { findByListId: jest.Mock };

  const mockRawEvent: IRawTaskEvent = {
    correlationId: 'test-corr-123',
    webhookEventId: 'wh-123',
    eventType: 'taskCreated',
    taskId: 'task-456',
    taskName: 'Implement user authentication',
    taskDescription:
      'Create login endpoints because we need secure access.\\n\\n## Acceptance Criteria\\nGiven user submits credentials\\nWhen API validates\\nThen token returned',
    taskStatus: 'Open',
    listId: 'list-1',
    listName: 'Sprint 1',
    spaceId: 'space-1',
    projectId: 'proj-123',
    projectName: 'Test Project',
    taskUrl: 'https://app.clickup.com/t/task-456',
    tags: ['feature'],
    customFields: {},
    creatorEmail: 'dev@test.com',
    eventTimestamp: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  };

  // Story 20.1: Provider-agnostic ITaskEvent mock
  const mockTaskEvent: ITaskEvent = {
    externalId: 'task-789',
    providerType: TaskProviderType.CLICKUP,
    internalStatus: 'QUEUED',
    title: 'Provider-agnostic task',
    description:
      'Test description\\n\\n## Acceptance Criteria\\nGiven test\\nWhen executed\\nThen passes',
    triggerSource: TaskTriggerSource.WEBHOOK,
    correlationId: 'test-corr-789',
    projectIdentifier: 'list-2',
    taskUrl: 'https://app.clickup.com/t/task-789',
    tags: ['feature', 'provider-agnostic'],
    customFields: {},
    creatorEmail: 'test@example.com',
    eventTimestamp: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma = {
      ticket: {
        findUnique: jest.fn(),
        findFirst: jest.fn(), // Story 20.1: Used by new normalized flow
        upsert: jest.fn().mockResolvedValue({ id: 'ticket-uuid-123' }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      // Story 20.1: Mock execution table for idempotency check
      execution: {
        findFirst: jest.fn().mockResolvedValue(null), // No active execution by default
      },
    };

    mockRabbitMQPublisher = {
      publishToQueue: jest.fn().mockResolvedValue(true),
    };

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'clickup.apiUrl') return 'https://api.clickup.com/api/v2';
        if (key === 'clickup.apiKey') return '';
        return null;
      }),
    };

    const validResult = new ValidationResultDto();
    validResult.isValid = true;
    validResult.errors = [];
    validResult.warnings = [];

    mockValidator = {
      validate: jest.fn().mockResolvedValue(validResult),
      formatErrorsForComment: jest.fn().mockReturnValue('Error comment'),
    };

    mockQualityService = {
      calculateScore: jest.fn().mockReturnValue({
        totalScore: 75,
        grade: 'good',
        breakdown: {
          titleClarity: 15,
          descriptionCompleteness: 20,
          acceptanceCriteria: 25,
          contextDocuments: 5,
          taskComplexity: 5,
          prerequisites: 5,
        },
        suggestions: [],
      }),
    };

    mockIntakeCounter = { inc: jest.fn() };
    mockDurationHistogram = { startTimer: jest.fn().mockReturnValue(jest.fn()) };
    mockValidationCounter = { inc: jest.fn() };
    mockQualityHistogram = { observe: jest.fn() };
    mockCircularDetector = {
      detectCircularDependencies: jest.fn().mockResolvedValue({ hasCycle: false }),
    };
    mockDependencyManager = {
      checkDependencies: jest.fn().mockResolvedValue({ canProceed: true }),
      isStatusResolved: jest.fn().mockReturnValue(false),
    };
    mockWaitingCounter = { inc: jest.fn() };
    mockCircularCounter = { inc: jest.fn() };

    // Story 11.4: Mock AIDecisionLoggerService
    const mockAIDecisionLogger = {
      logDecision: jest.fn().mockResolvedValue({ id: 'log-id' }),
    };

    // Story 4.9: Mock ProjectService
    mockProjectService = {
      findByListId: jest.fn().mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000000',
        name: 'Legacy Project',
        clickup_list_id: 'legacy-list-id',
        github_repository_url: 'https://github.com/test/repo',
        is_active: true,
      }),
    };

    service = new TicketIntakeService(
      mockPrisma as never,
      mockRabbitMQPublisher as never,
      mockConfigService as never,
      mockValidator as unknown as TicketValidatorService,
      mockQualityService as unknown as TicketQualityService,
      mockProjectService as never, // Story 4.9
      mockAIDecisionLogger as never, // Story 11.4
      mockIntakeCounter as never,
      mockDurationHistogram as never,
      mockValidationCounter as never,
      mockQualityHistogram as never,
      mockCircularDetector as unknown as CircularDependencyDetectorService,
      mockDependencyManager as unknown as DependencyManagerService,
      mockWaitingCounter as never,
      mockCircularCounter as never,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processTaskEvent', () => {
    it('should process valid taskCreated event successfully', async () => {
      const result = await service.processTaskEvent(mockRawEvent);

      expect(result.success).toBe(true);
      expect(result.status).toBe(TicketStatus.VALIDATED);
      expect(result.ticketId).toBe('ticket-uuid-123');
      expect(result.qualityScore).toBe(75);

      expect(mockValidator.validate).toHaveBeenCalled();
      expect(mockQualityService.calculateScore).toHaveBeenCalled();
      expect(mockPrisma.ticket.upsert).toHaveBeenCalled();
      expect(mockRabbitMQPublisher.publishToQueue).toHaveBeenCalled();
      // Story 20.1: New metrics track provider/trigger instead of event_type
      expect(mockIntakeCounter.inc).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'CLICKUP',
          trigger: 'WEBHOOK',
        }),
      );
    });

    it('should skip taskUpdated if ticket not in VALIDATION_FAILED state', async () => {
      // Story 20.1: New flow uses findFirst instead of findUnique
      mockPrisma.ticket.findFirst.mockResolvedValue({
        status: TicketStatus.VALIDATED,
      });

      const result = await service.processTaskEvent({
        ...mockRawEvent,
        eventType: 'taskUpdated',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(TicketStatus.VALIDATED);
      expect(mockValidator.validate).not.toHaveBeenCalled();
    });

    it('should re-validate taskUpdated if in VALIDATION_FAILED state', async () => {
      // Story 20.1: New flow uses findFirst instead of findUnique
      mockPrisma.ticket.findFirst.mockResolvedValue({
        status: TicketStatus.VALIDATION_FAILED,
      });

      const result = await service.processTaskEvent({
        ...mockRawEvent,
        eventType: 'taskUpdated',
      });

      expect(result.success).toBe(true);
      expect(mockValidator.validate).toHaveBeenCalled();
    });

    it('should handle validation failure', async () => {
      const failedResult = new ValidationResultDto();
      failedResult.isValid = false;
      failedResult.errors = [
        {
          field: 'title',
          code: 'TITLE_REQUIRED',
          message: 'Title required',
          severity: 'error' as const,
        },
      ];
      failedResult.warnings = [];
      mockValidator.validate.mockResolvedValue(failedResult);

      const result = await service.processTaskEvent(mockRawEvent);

      expect(result.success).toBe(false);
      expect(result.status).toBe(TicketStatus.VALIDATION_FAILED);
      expect(result.errors).toContain('Title required');
      expect(mockValidationCounter.inc).toHaveBeenCalledWith({ result: 'failure' });
    });

    it('should extract acceptance criteria from description', async () => {
      await service.processTaskEvent(mockRawEvent);

      const validatorCall = mockValidator.validate.mock.calls[0][0];
      expect(validatorCall.acceptanceCriteria).toContain('Given user submits credentials');
    });

    it('should route validated ticket to AI_ROUTING queue', async () => {
      await service.processTaskEvent(mockRawEvent);

      expect(mockRabbitMQPublisher.publishToQueue).toHaveBeenCalledWith(
        'ai-routing-queue',
        expect.objectContaining({
          ticketId: 'ticket-uuid-123',
          clickupTaskId: 'task-456',
          qualityScore: 75,
          qualityGrade: 'good',
        }),
        'test-corr-123',
      );
    });

    it('should log audit entry on successful validation', async () => {
      await service.processTaskEvent(mockRawEvent);

      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entity_type: 'ticket',
            action: 'ticket_validated',
          }),
        }),
      );
    });

    it('should track metrics correctly', async () => {
      await service.processTaskEvent(mockRawEvent);

      expect(mockIntakeCounter.inc).toHaveBeenCalled();
      expect(mockValidationCounter.inc).toHaveBeenCalledWith({ result: 'success' });
      expect(mockQualityHistogram.observe).toHaveBeenCalledWith({ grade: 'good' }, 75);
      expect(mockDurationHistogram.startTimer).toHaveBeenCalled();
    });

    it('should reject ticket if project is inactive', async () => {
      mockProjectService.findByListId.mockResolvedValue({
        id: 'proj-inactive',
        name: 'Inactive Project',
        is_active: false,
      });

      const result = await service.processTaskEvent(mockRawEvent);

      expect(result.success).toBe(false);
      expect(result.status).toBe(TicketStatus.VALIDATION_FAILED);
      expect(result.errors).toContain(
        'Project "Inactive Project" is inactive. Please reactivate project to process tickets.',
      );
    });
  });

  // ===== Story 20.1: Provider-Agnostic Intake Tests =====
  describe('Story 20.1: Provider-Agnostic Intake', () => {
    describe('ITaskEvent Processing', () => {
      it('should accept and process ITaskEvent directly (AC#3)', async () => {
        const result = await service.processTaskEvent(mockTaskEvent);

        expect(result.success).toBe(true);
        expect(result.status).toBe(TicketStatus.VALIDATED);

        // Verify that validator was called with correctly transformed data
        const validatorCall = mockValidator.validate.mock.calls[0][0];
        expect(validatorCall.title).toBe('Provider-agnostic task');
        expect(validatorCall.description).toBe(mockTaskEvent.description);
        expect(validatorCall.tags).toContain('provider-agnostic');

        // Verify metrics tracked provider type
        expect(mockIntakeCounter.inc).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: 'CLICKUP',
            trigger: 'WEBHOOK',
          }),
        );
      });

      it('should maintain backward compatibility with IRawTaskEvent (AC#3)', async () => {
        // Process legacy event
        const result = await service.processTaskEvent(mockRawEvent);

        expect(result.success).toBe(true);
        expect(result.status).toBe(TicketStatus.VALIDATED);

        // Verify the adapter correctly converted IRawTaskEvent → ITaskEvent
        expect(mockValidator.validate).toHaveBeenCalled();
        expect(mockPrisma.ticket.upsert).toHaveBeenCalled();
      });
    });

    describe('Idempotency Check (AC#4)', () => {
      it('should prevent duplicate AI processing for active executions', async () => {
        // Mock active execution exists
        mockPrisma.execution.findFirst.mockResolvedValueOnce({
          id: 'exec-123',
          ticket_id: 'ticket-uuid-456',
          status: 'IN_PROGRESS',
        });

        const result = await service.processTaskEvent(mockTaskEvent);

        // Should succeed but not route to AI queue
        expect(result.success).toBe(true);
        expect(mockRabbitMQPublisher.publishToQueue).not.toHaveBeenCalled();

        // Verify idempotency check was called
        expect(mockPrisma.execution.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              ticket: { clickup_task_id: mockTaskEvent.externalId },
              status: { in: ['QUEUED', 'IN_PROGRESS'] },
            }),
          }),
        );
      });

      it('should allow processing if no active execution exists', async () => {
        // No active execution (default mock returns null)
        const result = await service.processTaskEvent(mockTaskEvent);

        expect(result.success).toBe(true);
        expect(mockRabbitMQPublisher.publishToQueue).toHaveBeenCalled();
        expect(mockPrisma.execution.findFirst).toHaveBeenCalled();
      });
    });

    describe('Provider-Conditional Operations', () => {
      it('should track provider-specific metrics for non-ClickUp providers', async () => {
        const asanaEvent: ITaskEvent = {
          ...mockTaskEvent,
          externalId: 'asana-task-123',
          providerType: TaskProviderType.ASANA,
        };

        await service.processTaskEvent(asanaEvent);

        expect(mockIntakeCounter.inc).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: 'ASANA',
          }),
        );
      });
    });
  });
});
