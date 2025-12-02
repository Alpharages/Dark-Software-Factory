import { Test, TestingModule } from '@nestjs/testing';
import { TicketQualityService } from './ticket-quality.service';
import { IParsedTicket, IRawTaskEvent } from './interfaces';

describe('TicketQualityService', () => {
  let service: TicketQualityService;

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

  const excellentTicket: IParsedTicket = {
    clickupTaskId: 'task-123',
    projectId: 'proj-456',
    title: 'Implement user authentication flow',
    description:
      'Create login and registration endpoints because we need secure user management so that users can access protected resources. This requires changes to src/auth/ module. See architecture doc for details.',
    acceptanceCriteria:
      'Given a user submits valid credentials\nWhen the API processes the login request\nThen a JWT token is returned\nAnd the token should expire after 1 hour\nAnd invalid credentials should return 401',
    tags: ['feature', 'authentication'],
    priority: 'high',
    creatorEmail: 'test@test.com',
    taskUrl: 'https://app.clickup.com/t/task-123',
    rawEvent: mockRawEvent,
  };

  const poorTicket: IParsedTicket = {
    ...excellentTicket,
    title: 'Fix',
    description: 'Bug fix',
    acceptanceCriteria: 'Works',
    tags: [],
    priority: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TicketQualityService],
    }).compile();

    service = module.get<TicketQualityService>(TicketQualityService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('calculateScore', () => {
    it('should score excellent ticket above 70', () => {
      const result = service.calculateScore(excellentTicket, 'test-corr');
      expect(result.totalScore).toBeGreaterThanOrEqual(70);
      expect(['excellent', 'good']).toContain(result.grade);
    });

    it('should score poor ticket below 50', () => {
      const result = service.calculateScore(poorTicket, 'test-corr');
      expect(result.totalScore).toBeLessThan(50);
      expect(result.grade).toBe('poor');
    });

    it('should provide suggestions for improvements', () => {
      const result = service.calculateScore({ ...excellentTicket, tags: [] }, 'test-corr');
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('should calculate correct grade boundaries', () => {
      // Excellent: >= 90
      const excellent = service.calculateScore(excellentTicket, 'test-corr');
      if (excellent.totalScore >= 90) {
        expect(excellent.grade).toBe('excellent');
      }

      // Poor: < 50
      const poor = service.calculateScore(poorTicket, 'test-corr');
      expect(poor.grade).toBe('poor');
    });

    it('should return breakdown by category', () => {
      const result = service.calculateScore(excellentTicket, 'test-corr');

      expect(result.breakdown).toBeDefined();
      expect(result.breakdown.titleClarity).toBeDefined();
      expect(result.breakdown.descriptionCompleteness).toBeDefined();
      expect(result.breakdown.acceptanceCriteria).toBeDefined();
      expect(result.breakdown.contextDocuments).toBeDefined();
      expect(result.breakdown.taskComplexity).toBeDefined();
      expect(result.breakdown.prerequisites).toBeDefined();
    });

    it('should cap individual scores at max values', () => {
      const result = service.calculateScore(excellentTicket, 'test-corr');

      expect(result.breakdown.titleClarity).toBeLessThanOrEqual(15);
      expect(result.breakdown.descriptionCompleteness).toBeLessThanOrEqual(25);
      expect(result.breakdown.acceptanceCriteria).toBeLessThanOrEqual(30);
      expect(result.breakdown.contextDocuments).toBeLessThanOrEqual(10);
      expect(result.breakdown.taskComplexity).toBeLessThanOrEqual(10);
      expect(result.breakdown.prerequisites).toBeLessThanOrEqual(10);
    });

    it('should give points for BDD format in AC', () => {
      const bddTicket = {
        ...poorTicket,
        acceptanceCriteria:
          'Given user is logged in\nWhen they click logout\nThen they are logged out',
      };
      const nonBddTicket = {
        ...poorTicket,
        acceptanceCriteria: 'User can logout from the system',
      };

      const bddResult = service.calculateScore(bddTicket, 'test-corr');
      const nonBddResult = service.calculateScore(nonBddTicket, 'test-corr');

      expect(bddResult.breakdown.acceptanceCriteria).toBeGreaterThan(
        nonBddResult.breakdown.acceptanceCriteria,
      );
    });

    it('should give points for tags', () => {
      const withTags = { ...poorTicket, tags: ['feature'] };
      const withoutTags = { ...poorTicket, tags: [] };

      const withTagsResult = service.calculateScore(withTags, 'test-corr');
      const withoutTagsResult = service.calculateScore(withoutTags, 'test-corr');

      expect(withTagsResult.breakdown.taskComplexity).toBeGreaterThan(
        withoutTagsResult.breakdown.taskComplexity,
      );
    });
  });
});
