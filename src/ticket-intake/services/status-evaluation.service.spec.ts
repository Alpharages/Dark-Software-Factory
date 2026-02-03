/**
 * Story 20.2: Status Evaluation Service Tests
 *
 * Tests for unified status evaluation service.
 * AC1: Centralized Status Service tests
 * AC3: Consistent Status Mapping tests
 * AC4: Configuration-Driven Actionable Statuses tests
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StatusEvaluationService } from './status-evaluation.service';
import { TaskProviderType, InternalTaskStatus } from '../dto/task-event.dto';

describe('StatusEvaluationService', () => {
  let service: StatusEvaluationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatusEvaluationService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const config: Record<string, unknown> = {
                'webhooks.actionableStatuses': [
                  'in progress',
                  'ready for ai',
                  'ai processing',
                  'open',
                ],
                'webhooks.nonActionableStatuses': [
                  'done',
                  'closed',
                  'blocked',
                  'cancelled',
                  'archived',
                ],
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<StatusEvaluationService>(StatusEvaluationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('evaluateStatus (ClickUp)', () => {
    describe('actionable statuses', () => {
      it('should identify "in progress" as actionable', () => {
        const result = service.evaluateStatus('in progress', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(true);
        expect(result.internalStatus).toBe('AI_PROCESSING');
        expect(result.reason).toContain('in progress');
      });

      it('should identify "ready for ai" as actionable', () => {
        const result = service.evaluateStatus('ready for ai', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(true);
        expect(result.internalStatus).toBe('AI_PROCESSING');
      });

      it('should identify "ai processing" as actionable', () => {
        const result = service.evaluateStatus('ai processing', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(true);
        expect(result.internalStatus).toBe('AI_PROCESSING');
      });

      it('should identify "open" as actionable', () => {
        const result = service.evaluateStatus('open', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(true);
        expect(result.internalStatus).toBe('QUEUED');
      });

      it('should identify "to do" as actionable (maps to QUEUED)', () => {
        const result = service.evaluateStatus('to do', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(true);
        expect(result.internalStatus).toBe('QUEUED');
      });

      it('should identify "todo" as actionable (maps to QUEUED)', () => {
        const result = service.evaluateStatus('todo', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(true);
        expect(result.internalStatus).toBe('QUEUED');
      });

      it('should identify "ready for dev" as actionable (maps to AI_PROCESSING)', () => {
        const result = service.evaluateStatus('ready for dev', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(true);
        expect(result.internalStatus).toBe('AI_PROCESSING');
      });

      it('should be case-insensitive', () => {
        const result = service.evaluateStatus('IN PROGRESS', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(true);
        expect(result.internalStatus).toBe('AI_PROCESSING');
      });

      it('should handle extra whitespace', () => {
        const result = service.evaluateStatus('  in progress  ', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(true);
        expect(result.internalStatus).toBe('AI_PROCESSING');
      });
    });

    describe('non-actionable statuses', () => {
      it('should identify "done" as non-actionable', () => {
        const result = service.evaluateStatus('done', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('COMPLETED');
        expect(result.reason).toContain('done');
        expect(result.reason).toContain('non-actionable');
      });

      it('should identify "closed" as non-actionable', () => {
        const result = service.evaluateStatus('closed', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('COMPLETED');
      });

      it('should identify "blocked" as non-actionable', () => {
        const result = service.evaluateStatus('blocked', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('BLOCKED_CIRCULAR');
      });

      it('should identify "blocked circular" as non-actionable', () => {
        const result = service.evaluateStatus('blocked circular', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('BLOCKED_CIRCULAR');
      });

      it('should identify "cancelled" as non-actionable', () => {
        const result = service.evaluateStatus('cancelled', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('COMPLETED');
      });

      it('should identify "canceled" (US spelling) as non-actionable', () => {
        const result = service.evaluateStatus('canceled', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('COMPLETED');
      });

      it('should identify "archived" as non-actionable', () => {
        const result = service.evaluateStatus('archived', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('COMPLETED');
      });
    });

    describe('statuses that map to non-actionable internal statuses', () => {
      it('should map "review" to QA_REVIEW (non-actionable by default)', () => {
        const result = service.evaluateStatus('review', TaskProviderType.CLICKUP);

        // QA_REVIEW is not in the default actionable list
        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('QA_REVIEW');
      });

      it('should map "in review" to QA_REVIEW (non-actionable)', () => {
        const result = service.evaluateStatus('in review', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('QA_REVIEW');
      });

      it('should map "qa review" to QA_REVIEW (non-actionable)', () => {
        const result = service.evaluateStatus('qa review', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('QA_REVIEW');
      });

      it('should map "waiting" to WAITING (non-actionable by default)', () => {
        const result = service.evaluateStatus('waiting', TaskProviderType.CLICKUP);

        // WAITING is not in the default actionable list
        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('WAITING');
      });

      it('should map "on hold" to WAITING (non-actionable)', () => {
        const result = service.evaluateStatus('on hold', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('WAITING');
      });

      it('should map "pending" to WAITING (non-actionable)', () => {
        const result = service.evaluateStatus('pending', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('WAITING');
      });

      it('should map "validation failed" to VALIDATION_FAILED (non-actionable)', () => {
        const result = service.evaluateStatus('validation failed', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('VALIDATION_FAILED');
      });

      it('should map "failed" to VALIDATION_FAILED (non-actionable)', () => {
        const result = service.evaluateStatus('failed', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('VALIDATION_FAILED');
      });

      it('should map "deployed" to DEPLOYED (non-actionable)', () => {
        const result = service.evaluateStatus('deployed', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('DEPLOYED');
      });

      it('should map "in production" to DEPLOYED (non-actionable)', () => {
        const result = service.evaluateStatus('in production', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('DEPLOYED');
      });
    });

    describe('unknown statuses', () => {
      it('should default unknown statuses to QUEUED (actionable)', () => {
        const result = service.evaluateStatus('some random status', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(true);
        expect(result.internalStatus).toBe('QUEUED');
      });

      it('should handle empty status', () => {
        const result = service.evaluateStatus('', TaskProviderType.CLICKUP);

        expect(result.internalStatus).toBe('QUEUED');
      });

      it('should handle whitespace-only status', () => {
        const result = service.evaluateStatus('   ', TaskProviderType.CLICKUP);

        expect(result.internalStatus).toBe('QUEUED');
      });
    });
  });

  describe('evaluateStatus (other providers)', () => {
    it('should handle ASANA provider', () => {
      const result = service.evaluateStatus('in progress', TaskProviderType.ASANA);

      expect(result.internalStatus).toBe('AI_PROCESSING');
    });

    it('should handle JIRA provider', () => {
      const result = service.evaluateStatus('done', TaskProviderType.JIRA);

      expect(result.internalStatus).toBe('COMPLETED');
    });

    it('should handle UNKNOWN provider with generic mapping', () => {
      const result = service.evaluateStatus('active', TaskProviderType.UNKNOWN);

      expect(result.internalStatus).toBe('AI_PROCESSING');
    });

    it('should default unknown provider status to QUEUED', () => {
      const result = service.evaluateStatus('unknown status', TaskProviderType.UNKNOWN);

      expect(result.internalStatus).toBe('QUEUED');
    });
  });

  describe('isActionable (internal status)', () => {
    const testCases: Array<{ status: InternalTaskStatus; expected: boolean }> = [
      { status: 'AI_PROCESSING', expected: true },
      { status: 'QUEUED', expected: true },
      { status: 'VALIDATED', expected: true },
      { status: 'QA_REVIEW', expected: false },
      { status: 'WAITING', expected: false },
      { status: 'BLOCKED_CIRCULAR', expected: false },
      { status: 'VALIDATION_FAILED', expected: false },
      { status: 'COMPLETED', expected: false },
      { status: 'DEPLOYED', expected: false },
    ];

    testCases.forEach(({ status, expected }) => {
      it(`should return ${expected} for ${status}`, () => {
        expect(service.isActionable(status)).toBe(expected);
      });
    });
  });

  describe('mapToInternalStatus', () => {
    describe('ClickUp mapping', () => {
      it('should map "in progress" to AI_PROCESSING', () => {
        expect(service.mapToInternalStatus('in progress', TaskProviderType.CLICKUP)).toBe(
          'AI_PROCESSING',
        );
      });

      it('should map "done" to COMPLETED', () => {
        expect(service.mapToInternalStatus('done', TaskProviderType.CLICKUP)).toBe('COMPLETED');
      });

      it('should map "open" to QUEUED', () => {
        expect(service.mapToInternalStatus('open', TaskProviderType.CLICKUP)).toBe('QUEUED');
      });

      it('should be case-insensitive', () => {
        expect(service.mapToInternalStatus('IN PROGRESS', TaskProviderType.CLICKUP)).toBe(
          'AI_PROCESSING',
        );
      });

      it('should trim whitespace', () => {
        expect(service.mapToInternalStatus('  in progress  ', TaskProviderType.CLICKUP)).toBe(
          'AI_PROCESSING',
        );
      });

      it('should default unknown status to QUEUED', () => {
        expect(service.mapToInternalStatus('unknown', TaskProviderType.CLICKUP)).toBe('QUEUED');
      });
    });

    describe('Generic mapping (ASANA, JIRA, UNKNOWN)', () => {
      it('should map "active" to AI_PROCESSING for generic provider', () => {
        expect(service.mapToInternalStatus('active', TaskProviderType.ASANA)).toBe('AI_PROCESSING');
      });

      it('should map "new" to QUEUED for generic provider', () => {
        expect(service.mapToInternalStatus('new', TaskProviderType.JIRA)).toBe('QUEUED');
      });

      it('should map "processing" to AI_PROCESSING for unknown provider', () => {
        expect(service.mapToInternalStatus('processing', TaskProviderType.UNKNOWN)).toBe(
          'AI_PROCESSING',
        );
      });
    });
  });

  describe('configuration', () => {
    it('should load actionable statuses from config', () => {
      const statuses = service.getActionableStatuses();

      expect(statuses).toContain('in progress');
      expect(statuses).toContain('ready for ai');
      expect(statuses).toContain('ai processing');
      expect(statuses).toContain('open');
    });

    it('should load non-actionable statuses from config', () => {
      const statuses = service.getNonActionableStatuses();

      expect(statuses).toContain('done');
      expect(statuses).toContain('closed');
      expect(statuses).toContain('blocked');
      expect(statuses).toContain('cancelled');
      expect(statuses).toContain('archived');
    });

    it('should use default statuses when config returns empty arrays', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StatusEvaluationService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn(() => []), // Empty arrays
            },
          },
        ],
      }).compile();

      const defaultService = module.get<StatusEvaluationService>(StatusEvaluationService);

      // Should still work with empty config (defaults to empty sets)
      const result = defaultService.evaluateStatus('in progress', TaskProviderType.CLICKUP);
      expect(result.internalStatus).toBe('AI_PROCESSING');
    });

    it('should handle custom actionable statuses from config', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          StatusEvaluationService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn((key: string) => {
                if (key === 'webhooks.actionableStatuses') {
                  return ['custom status', 'another status'];
                }
                if (key === 'webhooks.nonActionableStatuses') {
                  return ['done', 'closed'];
                }
                return undefined;
              }),
            },
          },
        ],
      }).compile();

      const customService = module.get<StatusEvaluationService>(StatusEvaluationService);

      expect(customService.getActionableStatuses()).toContain('custom status');
      expect(customService.getActionableStatuses()).toContain('another status');

      // Custom status should be actionable
      const result = customService.evaluateStatus('custom status', TaskProviderType.CLICKUP);
      expect(result.isActionable).toBe(true);
    });
  });

  describe('comprehensive status mapping coverage', () => {
    // Test all ClickUp status mappings
    const clickUpMappings: Array<{ input: string; expected: InternalTaskStatus }> = [
      { input: 'to do', expected: 'QUEUED' },
      { input: 'todo', expected: 'QUEUED' },
      { input: 'open', expected: 'QUEUED' },
      { input: 'backlog', expected: 'QUEUED' },
      { input: 'in progress', expected: 'AI_PROCESSING' },
      { input: 'inprogress', expected: 'AI_PROCESSING' },
      { input: 'ready for ai', expected: 'AI_PROCESSING' },
      { input: 'ai processing', expected: 'AI_PROCESSING' },
      { input: 'ready for dev', expected: 'AI_PROCESSING' },
      { input: 'review', expected: 'QA_REVIEW' },
      { input: 'in review', expected: 'QA_REVIEW' },
      { input: 'qa review', expected: 'QA_REVIEW' },
      { input: 'waiting', expected: 'WAITING' },
      { input: 'on hold', expected: 'WAITING' },
      { input: 'pending', expected: 'WAITING' },
      { input: 'blocked', expected: 'BLOCKED_CIRCULAR' },
      { input: 'blocked circular', expected: 'BLOCKED_CIRCULAR' },
      { input: 'validation failed', expected: 'VALIDATION_FAILED' },
      { input: 'failed', expected: 'VALIDATION_FAILED' },
      { input: 'done', expected: 'COMPLETED' },
      { input: 'completed', expected: 'COMPLETED' },
      { input: 'closed', expected: 'COMPLETED' },
      { input: 'cancelled', expected: 'COMPLETED' },
      { input: 'canceled', expected: 'COMPLETED' },
      { input: 'archived', expected: 'COMPLETED' },
      { input: 'deployed', expected: 'DEPLOYED' },
      { input: 'in production', expected: 'DEPLOYED' },
    ];

    clickUpMappings.forEach(({ input, expected }) => {
      it(`should map "${input}" to ${expected}`, () => {
        const result = service.mapToInternalStatus(input, TaskProviderType.CLICKUP);
        expect(result).toBe(expected);
      });
    });
  });
});
