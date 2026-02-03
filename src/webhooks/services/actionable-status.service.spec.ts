/**
 * Story 20.1: Actionable Status Service Tests
 *
 * Tests for status-based actionability filtering.
 * AC3: Status-Based Routing
 * AC4: Non-Actionable Status Filtering
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ActionableStatusService } from './actionable-status.service';
import { TaskProviderType, InternalTaskStatus } from '@/ticket-intake/dto';

describe('ActionableStatusService', () => {
  let service: ActionableStatusService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActionableStatusService,
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

    service = module.get<ActionableStatusService>(ActionableStatusService);
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

      it('should identify "cancelled" as non-actionable', () => {
        const result = service.evaluateStatus('cancelled', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('COMPLETED');
      });

      it('should identify "archived" as non-actionable', () => {
        const result = service.evaluateStatus('archived', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('COMPLETED');
      });
    });

    describe('ClickUp-specific status mappings', () => {
      it('should map "to do" to QUEUED (actionable)', () => {
        const result = service.evaluateStatus('to do', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(true);
        expect(result.internalStatus).toBe('QUEUED');
      });

      it('should map "review" to QA_REVIEW (non-actionable by default)', () => {
        const result = service.evaluateStatus('review', TaskProviderType.CLICKUP);

        // QA_REVIEW is not in the default actionable list
        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('QA_REVIEW');
      });

      it('should map "waiting" to WAITING (non-actionable by default)', () => {
        const result = service.evaluateStatus('waiting', TaskProviderType.CLICKUP);

        // WAITING is not in the default actionable list
        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('WAITING');
      });

      it('should map "deployed" to DEPLOYED (non-actionable)', () => {
        const result = service.evaluateStatus('deployed', TaskProviderType.CLICKUP);

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
  });

  describe('isActionableInternalStatus', () => {
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
        expect(service.isActionableInternalStatus(status)).toBe(expected);
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

    it('should use default statuses when config is empty', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          ActionableStatusService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn(() => []), // Empty arrays
            },
          },
        ],
      }).compile();

      const defaultService = module.get<ActionableStatusService>(ActionableStatusService);

      // Should still work with empty config (defaults to empty sets)
      const result = defaultService.evaluateStatus('in progress', TaskProviderType.CLICKUP);
      expect(result.internalStatus).toBe('AI_PROCESSING');
    });
  });
});
