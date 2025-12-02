import { Test, TestingModule } from '@nestjs/testing';
import { TicketValidatorService } from './ticket-validator.service';
import { IParsedTicket, IRawTaskEvent } from './interfaces';

describe('TicketValidatorService', () => {
  let service: TicketValidatorService;

  const mockRawEvent: IRawTaskEvent = {
    correlationId: 'test-corr',
    webhookEventId: 'wh-123',
    eventType: 'taskCreated',
    taskId: 'task-123',
    taskName: 'Test Task',
    taskDescription: 'Test description',
    taskStatus: 'Open',
    listId: 'list-1',
    listName: 'Test List',
    spaceId: 'space-1',
    projectId: 'proj-1',
    projectName: 'Test Project',
    taskUrl: 'https://app.clickup.com/t/task-123',
    tags: ['feature'],
    customFields: {},
    creatorEmail: 'test@test.com',
    eventTimestamp: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  };

  const validTicket: IParsedTicket = {
    clickupTaskId: 'task-123',
    projectId: 'proj-456',
    title: 'Implement user authentication flow',
    description:
      'Create login and registration endpoints with JWT tokens because we need secure authentication so that users can access protected resources safely',
    acceptanceCriteria:
      'Given a user submits valid credentials\nWhen the API processes the request\nThen a JWT token is returned',
    tags: ['feature'],
    priority: 'high',
    creatorEmail: 'test@test.com',
    taskUrl: 'https://app.clickup.com/t/task-123',
    rawEvent: mockRawEvent,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TicketValidatorService],
    }).compile();

    service = module.get<TicketValidatorService>(TicketValidatorService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validate', () => {
    it('should pass validation for valid ticket', async () => {
      const result = await service.validate(validTicket, 'test-corr');
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation for empty title', async () => {
      const result = await service.validate({ ...validTicket, title: '' }, 'test-corr');
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === 'TITLE_REQUIRED')).toBe(true);
    });

    it('should fail validation for short title', async () => {
      const result = await service.validate({ ...validTicket, title: 'Fix bug' }, 'test-corr');
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === 'TITLE_TOO_SHORT')).toBe(true);
    });

    it('should fail validation for empty description', async () => {
      const result = await service.validate({ ...validTicket, description: '' }, 'test-corr');
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === 'DESC_REQUIRED')).toBe(true);
    });

    it('should fail validation for short description', async () => {
      const result = await service.validate(
        { ...validTicket, description: 'Short desc' },
        'test-corr',
      );
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === 'DESC_TOO_SHORT')).toBe(true);
    });

    it('should fail validation for missing acceptance criteria', async () => {
      const result = await service.validate(
        { ...validTicket, acceptanceCriteria: '' },
        'test-corr',
      );
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === 'AC_REQUIRED')).toBe(true);
    });

    it('should fail validation for missing project ID', async () => {
      const result = await service.validate({ ...validTicket, projectId: '' }, 'test-corr');
      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === 'PROJECT_REQUIRED')).toBe(true);
    });

    it('should add warning for non-BDD acceptance criteria', async () => {
      const result = await service.validate(
        {
          ...validTicket,
          acceptanceCriteria:
            'User can login successfully and should be redirected to dashboard after authentication',
        },
        'test-corr',
      );
      expect(result.isValid).toBe(true);
      expect(result.warnings.some((w) => w.code === 'AC_NOT_BDD')).toBe(true);
    });

    it('should add warning for generic title', async () => {
      const result = await service.validate(
        { ...validTicket, title: 'Todo: implement user authentication flow' },
        'test-corr',
      );
      expect(result.isValid).toBe(true);
      expect(result.warnings.some((w) => w.code === 'TITLE_GENERIC')).toBe(true);
    });
  });

  describe('formatErrorsForComment', () => {
    it('should format errors for ClickUp comment', async () => {
      const result = await service.validate(
        { ...validTicket, title: '', description: '' },
        'test-corr',
      );
      const comment = service.formatErrorsForComment(result);

      expect(comment).toContain('Validation Failed');
      expect(comment).toContain('title');
      expect(comment).toContain('description');
    });
  });
});
