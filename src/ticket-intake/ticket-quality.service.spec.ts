import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TicketQualityService } from './ticket-quality.service';
import { IParsedTicket, IRawTaskEvent, IQualityScoreInput } from './interfaces';

describe('TicketQualityService', () => {
  let service: TicketQualityService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue: number) => defaultValue),
  };

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

  // Story 2.11: PM API Input
  const excellentInput: IQualityScoreInput = {
    title: 'Implement user authentication for login endpoint',
    description:
      'Add JWT-based authentication to enable secure login because users need to access protected resources. This involves creating the auth service in src/auth/ and adding the endpoint.',
    acceptanceCriteria:
      'Given valid credentials When user submits login Then JWT token is returned within 200ms\nGiven invalid credentials When user submits login Then 401 Unauthorized is returned\nGiven expired token When user accesses protected route Then 401 is returned',
    contextDocuments: ['auth-spec.md', 'security-guidelines.pdf'],
    tags: ['auth', 'security', 'backend'],
    prerequisites: ['Story 1.5', 'Story 1.6'],
  };

  const poorInput: IQualityScoreInput = {
    title: 'Fix',
    description: 'Bug',
    acceptanceCriteria: 'Works',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TicketQualityService, { provide: ConfigService, useValue: mockConfigService }],
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

  // ============================================================
  // Story 2.11: PM-Facing Quality Scoring API Tests
  // ============================================================

  describe('calculateScoreEnhanced', () => {
    it('should return enhanced score with grade details for excellent input', async () => {
      const result = await service.calculateScoreEnhanced(excellentInput, 'test-corr');

      expect(result.totalScore).toBeGreaterThanOrEqual(70);
      expect(['excellent', 'good']).toContain(result.grade);
      expect(result.gradeEmoji).toBeDefined();
      expect(result.gradeMessage).toBeDefined();
      expect(result.meetsMinimumThreshold).toBe(true);
      expect(result.scoredAt).toBeDefined();
    });

    it('should return poor grade for minimal input', async () => {
      const result = await service.calculateScoreEnhanced(poorInput, 'test-corr');

      expect(result.totalScore).toBeLessThan(50);
      expect(result.grade).toBe('poor');
      expect(result.gradeEmoji).toBe('❌');
      expect(result.meetsMinimumThreshold).toBe(false);
    });

    it('should return detailed breakdown with category scores', async () => {
      const result = await service.calculateScoreEnhanced(excellentInput, 'test-corr');

      expect(result.breakdown).toBeDefined();
      expect(result.breakdown.titleClarity).toBeDefined();
      expect(result.breakdown.titleClarity.category).toBe('titleClarity');
      expect(result.breakdown.titleClarity.score).toBeGreaterThanOrEqual(0);
      expect(result.breakdown.titleClarity.maxPoints).toBe(15);
      expect(result.breakdown.titleClarity.percentage).toBeGreaterThanOrEqual(0);
      expect(result.breakdown.titleClarity.percentage).toBeLessThanOrEqual(100);
    });

    it('should include suggestions in category breakdown', async () => {
      const result = await service.calculateScoreEnhanced(poorInput, 'test-corr');

      // Poor input should have suggestions
      const allSuggestions = [
        ...result.breakdown.titleClarity.suggestions,
        ...result.breakdown.descriptionCompleteness.suggestions,
        ...result.breakdown.acceptanceCriteria.suggestions,
      ];
      expect(allSuggestions.length).toBeGreaterThan(0);
    });

    it('should aggregate top 5 suggestions', async () => {
      const result = await service.calculateScoreEnhanced(poorInput, 'test-corr');

      expect(result.topSuggestions).toBeDefined();
      expect(result.topSuggestions.length).toBeLessThanOrEqual(5);
      expect(result.topSuggestions.length).toBeGreaterThan(0);
    });

    it('should use cache for identical requests', async () => {
      const result1 = await service.calculateScoreEnhanced(excellentInput, 'test-1');
      const result2 = await service.calculateScoreEnhanced(excellentInput, 'test-2');

      // Same input should return same score
      expect(result1.totalScore).toBe(result2.totalScore);
      expect(result1.grade).toBe(result2.grade);
    });

    it('should score context documents when provided', async () => {
      const withDocs = { ...poorInput, contextDocuments: ['spec.md', 'design.pdf'] };
      const withoutDocs = { ...poorInput };

      const withDocsResult = await service.calculateScoreEnhanced(withDocs, 'test-1');
      const withoutDocsResult = await service.calculateScoreEnhanced(withoutDocs, 'test-2');

      expect(withDocsResult.breakdown.contextDocuments.score).toBeGreaterThan(
        withoutDocsResult.breakdown.contextDocuments.score,
      );
    });

    it('should score prerequisites when provided', async () => {
      const withPrereqs = { ...poorInput, prerequisites: ['Story 1.1', 'Story 1.2'] };
      const withoutPrereqs = { ...poorInput };

      const withPrereqsResult = await service.calculateScoreEnhanced(withPrereqs, 'test-1');
      const withoutPrereqsResult = await service.calculateScoreEnhanced(withoutPrereqs, 'test-2');

      expect(withPrereqsResult.breakdown.prerequisites.score).toBeGreaterThan(
        withoutPrereqsResult.breakdown.prerequisites.score,
      );
    });
  });

  describe('quickScore', () => {
    it('should return score and grade only', async () => {
      const result = await service.quickScore(excellentInput, 'test-corr');

      expect(result.score).toBeDefined();
      expect(result.grade).toBeDefined();
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(['excellent', 'good', 'fair', 'poor']).toContain(result.grade);
    });

    it('should return same score as calculateScoreEnhanced', async () => {
      const quickResult = await service.quickScore(excellentInput, 'test-1');
      const enhancedResult = await service.calculateScoreEnhanced(excellentInput, 'test-2');

      expect(quickResult.score).toBe(enhancedResult.totalScore);
      expect(quickResult.grade).toBe(enhancedResult.grade);
    });
  });

  describe('batchScoreEnhanced', () => {
    it('should score multiple tickets', async () => {
      const inputs = [excellentInput, poorInput];
      const results = await service.batchScoreEnhanced(inputs, 'test-batch');

      expect(results).toHaveLength(2);
      expect(results[0].totalScore).toBeGreaterThan(results[1].totalScore);
    });

    it('should return empty array for empty input', async () => {
      const results = await service.batchScoreEnhanced([], 'test-batch');
      expect(results).toHaveLength(0);
    });

    it('should handle single ticket batch', async () => {
      const results = await service.batchScoreEnhanced([excellentInput], 'test-batch');

      expect(results).toHaveLength(1);
      expect(results[0].totalScore).toBeGreaterThanOrEqual(70);
    });
  });

  describe('grade thresholds', () => {
    it('should use configurable thresholds', async () => {
      // Default thresholds: excellent=90, good=70, fair=50
      const result = await service.calculateScoreEnhanced(excellentInput, 'test-corr');

      if (result.totalScore >= 90) {
        expect(result.grade).toBe('excellent');
      } else if (result.totalScore >= 70) {
        expect(result.grade).toBe('good');
      } else if (result.totalScore >= 50) {
        expect(result.grade).toBe('fair');
      } else {
        expect(result.grade).toBe('poor');
      }
    });

    it('should return correct grade emoji', async () => {
      const poorResult = await service.calculateScoreEnhanced(poorInput, 'test-poor');
      expect(poorResult.gradeEmoji).toBe('❌');

      // For a well-formed input, expect good or excellent emoji
      const goodResult = await service.calculateScoreEnhanced(excellentInput, 'test-good');
      expect(['✅', '👍', '⚠️']).toContain(goodResult.gradeEmoji);
    });
  });

  describe('scoring categories', () => {
    it('should score title with action verb higher', async () => {
      const withVerb: IQualityScoreInput = {
        ...poorInput,
        title: 'Implement user authentication service',
      };
      const withoutVerb: IQualityScoreInput = {
        ...poorInput,
        title: 'User authentication service',
      };

      const withVerbResult = await service.calculateScoreEnhanced(withVerb, 'test-1');
      const withoutVerbResult = await service.calculateScoreEnhanced(withoutVerb, 'test-2');

      expect(withVerbResult.breakdown.titleClarity.score).toBeGreaterThan(
        withoutVerbResult.breakdown.titleClarity.score,
      );
    });

    it('should score BDD acceptance criteria higher', async () => {
      const bddInput: IQualityScoreInput = {
        ...poorInput,
        acceptanceCriteria:
          'Given valid input When processing Then success returned\nGiven invalid input When processing Then error returned',
      };
      const plainInput: IQualityScoreInput = {
        ...poorInput,
        acceptanceCriteria: 'System should work correctly and handle errors',
      };

      const bddResult = await service.calculateScoreEnhanced(bddInput, 'test-1');
      const plainResult = await service.calculateScoreEnhanced(plainInput, 'test-2');

      expect(bddResult.breakdown.acceptanceCriteria.score).toBeGreaterThan(
        plainResult.breakdown.acceptanceCriteria.score,
      );
    });

    it('should score description with reasoning higher', async () => {
      const withReasoning: IQualityScoreInput = {
        ...poorInput,
        description:
          'Add authentication because users need secure access so that they can manage their accounts safely.',
      };
      const withoutReasoning: IQualityScoreInput = {
        ...poorInput,
        description: 'Add authentication for users.',
      };

      const withResult = await service.calculateScoreEnhanced(withReasoning, 'test-1');
      const withoutResult = await service.calculateScoreEnhanced(withoutReasoning, 'test-2');

      expect(withResult.breakdown.descriptionCompleteness.score).toBeGreaterThan(
        withoutResult.breakdown.descriptionCompleteness.score,
      );
    });
  });
});
