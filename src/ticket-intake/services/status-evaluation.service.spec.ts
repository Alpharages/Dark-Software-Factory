/**
 * Story 20.2: Status Evaluation Service Tests
 *
 * Tests for unified status evaluation service.
 * AC1: Centralized Status Service tests
 * AC3: Consistent Status Mapping tests
 * AC4: Configuration-Driven Actionable Statuses tests
 */

import { Test, TestingModule } from '@nestjs/testing';
import { StatusEvaluationService } from './status-evaluation.service';
import { TaskProviderType, InternalTaskStatus } from '../dto/task-event.dto';

describe('StatusEvaluationService', () => {
  let service: StatusEvaluationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [StatusEvaluationService],
    }).compile();

    service = module.get<StatusEvaluationService>(StatusEvaluationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('evaluateStatus', () => {
    it('should always return actionable QUEUED result (gate upstream CS1-6)', () => {
      const statuses = ['open', 'in progress', 'done', 'unknown'];

      for (const status of statuses) {
        const result = service.evaluateStatus(status, TaskProviderType.CLICKUP);
        expect(result.isActionable).toBe(true);
        expect(result.internalStatus).toBe('QUEUED');
        expect(result.reason).toContain('CS1-6');
      }
    });

    it('should handle different provider types with same stub result', () => {
      const result = service.evaluateStatus('active', TaskProviderType.ASANA);
      expect(result.isActionable).toBe(true);
      expect(result.internalStatus).toBe('QUEUED');
    });
  });

  describe('isActionable (internal status)', () => {
    // Note: This internal method still retains logic but is effectively
    // disconnected from the main intake flow via task-event.mapper stubs
    const testCases: Array<{ status: InternalTaskStatus; expected: boolean }> = [
      { status: 'AI_PROCESSING', expected: true },
      { status: 'QUEUED', expected: true },
      { status: 'VALIDATED', expected: true },
      { status: 'QA_REVIEW', expected: false },
      { status: 'COMPLETED', expected: false },
    ];

    testCases.forEach(({ status, expected }) => {
      it(`should return ${expected} for ${status}`, () => {
        expect(service.isActionable(status)).toBe(expected);
      });
    });
  });

  describe('mapToInternalStatus', () => {
    it('should always return QUEUED (stubbed for CS1-2)', () => {
      const testCases = [
        { status: 'in progress', provider: TaskProviderType.CLICKUP },
        { status: 'done', provider: TaskProviderType.CLICKUP },
        { status: 'active', provider: TaskProviderType.ASANA },
        { status: 'new', provider: TaskProviderType.JIRA },
      ];

      for (const { status, provider } of testCases) {
        expect(service.mapToInternalStatus(status, provider)).toBe('QUEUED');
      }
    });
  });
});
