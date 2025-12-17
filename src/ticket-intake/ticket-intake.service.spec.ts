import { TicketStatus } from '@/prisma/client';
import { TicketIntakeService } from './ticket-intake.service';
import { TicketValidatorService } from './ticket-validator.service';
import { TicketQualityService } from './ticket-quality.service';
import { IRawTaskEvent } from './interfaces';
import { ValidationResultDto } from './dto';

describe('TicketIntakeService', () => {
  let service: TicketIntakeService;
  let mockPrisma: {
    ticket: { findUnique: jest.Mock; upsert: jest.Mock };
    auditLog: { create: jest.Mock };
  };
  let mockRabbitMQPublisher: { publishToQueue: jest.Mock };
  let mockConfigService: { get: jest.Mock };
  let mockValidator: { validate: jest.Mock; formatErrorsForComment: jest.Mock };
  let mockQualityService: { calculateScore: jest.Mock };
  let mockIntakeCounter: { inc: jest.Mock };
  let mockDurationHistogram: { startTimer: jest.Mock };
  let mockValidationCounter: { inc: jest.Mock };
  let mockQualityHistogram: { observe: jest.Mock };

  const mockRawEvent: IRawTaskEvent = {
    correlationId: 'test-corr-123',
    webhookEventId: 'wh-123',
    eventType: 'taskCreated',
    taskId: 'task-456',
    taskName: 'Implement user authentication',
    taskDescription:
      'Create login endpoints because we need secure access.\n\n## Acceptance Criteria\nGiven user submits credentials\nWhen API validates\nThen token returned',
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

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma = {
      ticket: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({ id: 'ticket-uuid-123' }),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({}),
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

    service = new TicketIntakeService(
      mockPrisma as never,
      mockRabbitMQPublisher as never,
      mockConfigService as never,
      mockValidator as unknown as TicketValidatorService,
      mockQualityService as unknown as TicketQualityService,
      mockIntakeCounter as never,
      mockDurationHistogram as never,
      mockValidationCounter as never,
      mockQualityHistogram as never,
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
      expect(mockIntakeCounter.inc).toHaveBeenCalledWith({ event_type: 'taskCreated' });
    });

    it('should skip taskUpdated if ticket not in VALIDATION_FAILED state', async () => {
      mockPrisma.ticket.findUnique.mockResolvedValue({
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
      mockPrisma.ticket.findUnique.mockResolvedValue({
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
  });
});
