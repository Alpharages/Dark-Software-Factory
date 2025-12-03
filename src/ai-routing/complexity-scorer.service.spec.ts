import { Test, TestingModule } from '@nestjs/testing';
import { ComplexityScorerService } from './complexity-scorer.service';
import { IRoutingRequest } from './interfaces';

describe('ComplexityScorerService', () => {
  let service: ComplexityScorerService;

  const createRequest = (overrides: Partial<IRoutingRequest> = {}): IRoutingRequest => ({
    correlationId: 'test-corr',
    ticketId: 'ticket-123',
    clickupTaskId: 'task-456',
    projectId: 'proj-789',
    title: 'Test ticket',
    description: 'Test description',
    acceptanceCriteria: '- AC 1\n- AC 2\n- AC 3',
    tags: [],
    qualityScore: 80,
    qualityGrade: 'good',
    timestamp: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ComplexityScorerService],
    }).compile();
    service = module.get<ComplexityScorerService>(ComplexityScorerService);
  });

  describe('calculateComplexity', () => {
    it('should score simple bugfix as low complexity', () => {
      const request = createRequest({
        title: 'Fix typo in header',
        description: 'Simple fix for typo',
        tags: ['bugfix', 'simple'],
      });

      const result = service.calculateComplexity(request, 'test-corr');

      expect(result.totalScore).toBeLessThan(10);
      expect(result.tagComplexity).toBe('simple');
    });

    it('should score architecture change as high complexity', () => {
      const request = createRequest({
        title: 'Refactor authentication module architecture',
        description:
          'Redesign the authentication module with new service pattern. Affects multiple files and requires database schema migration.',
        tags: ['architecture', 'refactor'],
      });

      const result = service.calculateComplexity(request, 'test-corr');

      expect(result.totalScore).toBeGreaterThanOrEqual(10);
      expect(result.architectureChanges).toBe(true);
      expect(result.tagComplexity).toBe('complex');
    });

    it('should detect multiple files from description', () => {
      const request = createRequest({
        description: 'Update app.module.ts, auth.service.ts, and user.controller.ts',
      });

      const result = service.calculateComplexity(request, 'test-corr');

      expect(result.fileCount).toBeGreaterThanOrEqual(3);
      expect(result.fileCountScore).toBe(4);
    });

    it('should score high dependencies correctly', () => {
      const request = createRequest({
        description: 'Cross-module changes affecting multiple services with shared state',
        tags: ['integration'],
      });

      const result = service.calculateComplexity(request, 'test-corr');

      expect(result.dependencyLevel).toBe('high');
      expect(result.dependencyScore).toBe(4);
    });

    it('should calculate total score correctly', () => {
      const request = createRequest({
        title: 'Medium complexity task',
        description: 'Update auth.service.ts with new validation',
        acceptanceCriteria: '- AC 1\n- AC 2',
        tags: [],
      });

      const result = service.calculateComplexity(request, 'test-corr');

      const expectedTotal =
        result.fileCountScore +
        result.architectureScore +
        result.dependencyScore +
        result.locScore +
        result.tagScore;

      expect(result.totalScore).toBe(expectedTotal);
      expect(result.totalScore).toBeGreaterThanOrEqual(0);
      expect(result.totalScore).toBeLessThanOrEqual(20);
    });
  });
});
