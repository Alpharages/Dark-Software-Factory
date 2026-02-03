/**
 * Story 20.1: Actionable Status Service Tests
 * Story 20.2: Updated to test facade delegating to StatusEvaluationService
 *
 * Tests for status-based actionability filtering.
 * AC3: Status-Based Routing
 * AC4: Non-Actionable Status Filtering
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ActionableStatusService } from './actionable-status.service';
import {
  StatusEvaluationService,
  StatusEvaluationResult,
} from '@/ticket-intake/services/status-evaluation.service';
import { TaskProviderType, InternalTaskStatus } from '@/ticket-intake/dto';

describe('ActionableStatusService', () => {
  let service: ActionableStatusService;
  let statusEvaluationService: StatusEvaluationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ActionableStatusService,
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

    service = module.get<ActionableStatusService>(ActionableStatusService);
    statusEvaluationService = module.get<StatusEvaluationService>(StatusEvaluationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('facade delegation', () => {
    it('should delegate evaluateStatus to StatusEvaluationService', () => {
      const spy = jest.spyOn(statusEvaluationService, 'evaluateStatus');
      const mockResult: StatusEvaluationResult = {
        isActionable: true,
        internalStatus: 'AI_PROCESSING',
        reason: 'Test reason',
      };
      spy.mockReturnValue(mockResult);

      const result = service.evaluateStatus('in progress', TaskProviderType.CLICKUP);

      expect(spy).toHaveBeenCalledWith('in progress', TaskProviderType.CLICKUP);
      expect(result).toEqual(mockResult);
    });

    it('should delegate isActionableInternalStatus to StatusEvaluationService', () => {
      const spy = jest.spyOn(statusEvaluationService, 'isActionable');
      spy.mockReturnValue(true);

      const result = service.isActionableInternalStatus('AI_PROCESSING');

      expect(spy).toHaveBeenCalledWith('AI_PROCESSING');
      expect(result).toBe(true);
    });

    it('should delegate getActionableStatuses to StatusEvaluationService', () => {
      const spy = jest.spyOn(statusEvaluationService, 'getActionableStatuses');
      spy.mockReturnValue(['in progress', 'open']);

      const result = service.getActionableStatuses();

      expect(spy).toHaveBeenCalled();
      expect(result).toEqual(['in progress', 'open']);
    });

    it('should delegate getNonActionableStatuses to StatusEvaluationService', () => {
      const spy = jest.spyOn(statusEvaluationService, 'getNonActionableStatuses');
      spy.mockReturnValue(['done', 'closed']);

      const result = service.getNonActionableStatuses();

      expect(spy).toHaveBeenCalled();
      expect(result).toEqual(['done', 'closed']);
    });
  });

  describe('end-to-end status evaluation', () => {
    // These tests verify the facade works correctly with real StatusEvaluationService
    describe('actionable statuses', () => {
      it('should identify "in progress" as actionable', () => {
        const result = service.evaluateStatus('in progress', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(true);
        expect(result.internalStatus).toBe('AI_PROCESSING');
      });

      it('should identify "ready for ai" as actionable', () => {
        const result = service.evaluateStatus('ready for ai', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(true);
        expect(result.internalStatus).toBe('AI_PROCESSING');
      });

      it('should identify "open" as actionable', () => {
        const result = service.evaluateStatus('open', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(true);
        expect(result.internalStatus).toBe('QUEUED');
      });
    });

    describe('non-actionable statuses', () => {
      it('should identify "done" as non-actionable', () => {
        const result = service.evaluateStatus('done', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('COMPLETED');
      });

      it('should identify "blocked" as non-actionable', () => {
        const result = service.evaluateStatus('blocked', TaskProviderType.CLICKUP);

        expect(result.isActionable).toBe(false);
        expect(result.internalStatus).toBe('BLOCKED_CIRCULAR');
      });
    });

    describe('isActionableInternalStatus', () => {
      const testCases: Array<{ status: InternalTaskStatus; expected: boolean }> = [
        { status: 'AI_PROCESSING', expected: true },
        { status: 'QUEUED', expected: true },
        { status: 'VALIDATED', expected: true },
        { status: 'QA_REVIEW', expected: false },
        { status: 'COMPLETED', expected: false },
      ];

      testCases.forEach(({ status, expected }) => {
        it(`should return ${expected} for ${status}`, () => {
          expect(service.isActionableInternalStatus(status)).toBe(expected);
        });
      });
    });
  });

  describe('configuration', () => {
    it('should load actionable statuses through StatusEvaluationService', () => {
      const statuses = service.getActionableStatuses();

      expect(statuses).toContain('in progress');
      expect(statuses).toContain('ready for ai');
      expect(statuses).toContain('open');
    });

    it('should load non-actionable statuses through StatusEvaluationService', () => {
      const statuses = service.getNonActionableStatuses();

      expect(statuses).toContain('done');
      expect(statuses).toContain('closed');
      expect(statuses).toContain('blocked');
    });
  });
});
