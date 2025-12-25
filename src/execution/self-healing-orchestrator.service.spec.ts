import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { SelfHealingOrchestratorService } from './self-healing-orchestrator.service';
import { ProgressValidatorService } from '@/ai-monitoring/progress-validator.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { ClickUpService } from '@/clickup/clickup.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { QAResult } from './interfaces/self-healing.interface';

describe('SelfHealingOrchestratorService', () => {
  let service: SelfHealingOrchestratorService;
  let progressValidator: jest.Mocked<ProgressValidatorService>;
  let aiDecisionLogger: jest.Mocked<AIDecisionLoggerService>;
  let clickupService: jest.Mocked<ClickUpService>;
  let sentryService: jest.Mocked<SentryService>;
  let metricsService: jest.Mocked<MetricsService>;

  // Sample QA results for testing
  const createQAResult = (lintErrors: number, testFailures: number): QAResult => ({
    id: 'qa-result-id',
    execution_id: 'exec-123',
    linting_passed: lintErrors === 0,
    linting_errors: Array.from({ length: lintErrors }, (_, i) => ({
      file: `file${i}.ts`,
      line: i + 1,
      rule: 'test-rule',
      message: 'Test error',
    })),
    tests_passed: testFailures === 0,
    test_results: {
      passed: 10 - testFailures,
      failed: testFailures,
      total: 10,
    },
    overall_passed: lintErrors === 0 && testFailures === 0,
    created_at: new Date(),
    updated_at: new Date(),
  });

  beforeEach(async () => {
    // Create mocked services
    const mockProgressValidator = {
      validateProgress: jest.fn(),
    };

    const mockAIDecisionLogger = {
      logDecision: jest.fn().mockResolvedValue(undefined),
    };

    const mockClickUpService = {
      addComment: jest.fn().mockResolvedValue(true),
    };

    const mockSentryService = {
      captureException: jest.fn(),
    };

    const mockMetricsService = {
      incrementCounter: jest.fn(),
      setGauge: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SelfHealingOrchestratorService,
        { provide: ProgressValidatorService, useValue: mockProgressValidator },
        { provide: AIDecisionLoggerService, useValue: mockAIDecisionLogger },
        { provide: ClickUpService, useValue: mockClickUpService },
        { provide: SentryService, useValue: mockSentryService },
        { provide: MetricsService, useValue: mockMetricsService },
      ],
    }).compile();

    service = module.get<SelfHealingOrchestratorService>(SelfHealingOrchestratorService);
    progressValidator = module.get(ProgressValidatorService);
    aiDecisionLogger = module.get(AIDecisionLoggerService);
    clickupService = module.get(ClickUpService);
    sentryService = module.get(SentryService);
    metricsService = module.get(MetricsService);

    // Suppress logger output during tests
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('attemptFix - Success Scenarios', () => {
    it('should succeed on first attempt when all errors fixed', async () => {
      const initialQA = createQAResult(5, 3);
      const fixedQA = createQAResult(0, 0);

      // Mock successful fix
      jest.spyOn(service as never, 'simulateFixAttempt').mockResolvedValue(fixedQA as never);

      // Mock validation success
      progressValidator.validateProgress.mockResolvedValue({
        shouldContinue: true,
        reason: 'All errors resolved',
        escalate: false,
        metrics: {
          errorsBefore: 8,
          errorsAfter: 0,
          errorReduction: 8,
          totalTimeMs: 1000,
          attemptNumber: 1,
          progressRate: 8,
        },
        confidence: 1.0,
      });

      const result = await service.attemptFix({
        executionId: 'exec-123',
        ticketId: 'ticket-456',
        qaResult: initialQA,
        previousErrorCount: 8,
      });

      expect(result).toEqual({
        success: true,
        outcome: 'SUCCESS',
        attemptsMade: 1,
        finalErrorCount: 0,
      });

      // Verify metrics recorded
      expect(metricsService.incrementCounter).toHaveBeenCalledWith(
        'ai_self_healing_attempts_total',
        {
          ticket_id: 'ticket-456',
          outcome: 'success',
        },
      );

      expect(metricsService.setGauge).toHaveBeenCalledWith('ai_self_healing_progress', 100, {
        ticket_id: 'ticket-456',
      });
    });

    it('should succeed on second attempt', async () => {
      const initialQA = createQAResult(5, 3);
      const attempt1QA = createQAResult(2, 1);
      const attempt2QA = createQAResult(0, 0);

      const simulateFixSpy = jest
        .spyOn(service as never, 'simulateFixAttempt')
        .mockResolvedValueOnce(attempt1QA as never)
        .mockResolvedValueOnce(attempt2QA as never);

      // Mock validation - continue, then success
      progressValidator.validateProgress
        .mockResolvedValueOnce({
          shouldContinue: true,
          reason: 'Making progress',
          escalate: false,
          metrics: {
            errorsBefore: 8,
            errorsAfter: 3,
            errorReduction: 5,
            totalTimeMs: 1000,
            attemptNumber: 1,
            progressRate: 5,
          },
          confidence: 0.7,
        })
        .mockResolvedValueOnce({
          shouldContinue: true,
          reason: 'All errors resolved',
          escalate: false,
          metrics: {
            errorsBefore: 3,
            errorsAfter: 0,
            errorReduction: 3,
            totalTimeMs: 2000,
            attemptNumber: 2,
            progressRate: 1.5,
          },
          confidence: 1.0,
        });

      const result = await service.attemptFix({
        executionId: 'exec-123',
        ticketId: 'ticket-456',
        qaResult: initialQA,
        previousErrorCount: 8,
      });

      expect(result.success).toBe(true);
      expect(result.attemptsMade).toBe(2);
      expect(result.finalErrorCount).toBe(0);
      expect(simulateFixSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('attemptFix - Escalation Scenarios', () => {
    it('should escalate when errors do not decrease', async () => {
      const initialQA = createQAResult(5, 3);
      const unchangedQA = createQAResult(5, 3);

      jest.spyOn(service as never, 'simulateFixAttempt').mockResolvedValue(unchangedQA as never);

      progressValidator.validateProgress.mockResolvedValue({
        shouldContinue: false,
        reason: 'No progress - errors not decreasing',
        escalate: true,
        metrics: {
          errorsBefore: 8,
          errorsAfter: 8,
          errorReduction: 0,
          totalTimeMs: 1000,
          attemptNumber: 1,
          progressRate: 0,
        },
        confidence: 0.95,
      });

      const result = await service.attemptFix({
        executionId: 'exec-123',
        ticketId: 'ticket-456',
        qaResult: initialQA,
        previousErrorCount: 8,
      });

      expect(result).toEqual({
        success: false,
        outcome: 'ESCALATED',
        attemptsMade: 1,
        finalErrorCount: 8,
        escalationReason: 'No progress - errors not decreasing',
      });

      // Verify ClickUp comment was added
      expect(clickupService.addComment).toHaveBeenCalledWith(
        'ticket-456',
        expect.stringContaining('Self-Healing Escalation'),
        { correlationId: 'exec-123' },
      );

      // Verify AI decision log
      expect(aiDecisionLogger.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'escalation_triggered',
          agentName: 'Self-Healing Orchestrator',
        }),
      );
    });

    it('should escalate when max attempts reached without fixing all errors', async () => {
      const initialQA = createQAResult(10, 5);
      const attempt1QA = createQAResult(8, 3);
      const attempt2QA = createQAResult(5, 2);

      jest
        .spyOn(service as never, 'simulateFixAttempt')
        .mockResolvedValueOnce(attempt1QA as never)
        .mockResolvedValueOnce(attempt2QA as never);

      // Both attempts show progress, but don't reach zero
      progressValidator.validateProgress.mockResolvedValue({
        shouldContinue: true,
        reason: 'Making progress',
        escalate: false,
        metrics: {
          errorsBefore: 15,
          errorsAfter: 11,
          errorReduction: 4,
          totalTimeMs: 1000,
          attemptNumber: 1,
          progressRate: 4,
        },
        confidence: 0.7,
      });

      const result = await service.attemptFix({
        executionId: 'exec-123',
        ticketId: 'ticket-456',
        qaResult: initialQA,
        previousErrorCount: 15,
      });

      expect(result).toEqual({
        success: false,
        outcome: 'MAX_ATTEMPTS',
        attemptsMade: 2,
        finalErrorCount: 7,
        escalationReason: expect.stringContaining('Max fix attempts (2) reached'),
      });

      expect(metricsService.incrementCounter).toHaveBeenCalledWith(
        'ai_self_healing_attempts_total',
        {
          ticket_id: 'ticket-456',
          outcome: 'max_attempts',
        },
      );
    });

    it('should handle ClickUp comment failure gracefully', async () => {
      const initialQA = createQAResult(5, 3);

      jest.spyOn(service as never, 'simulateFixAttempt').mockResolvedValue(initialQA as never);

      progressValidator.validateProgress.mockResolvedValue({
        shouldContinue: false,
        reason: 'No progress',
        escalate: true,
        metrics: {
          errorsBefore: 8,
          errorsAfter: 8,
          errorReduction: 0,
          totalTimeMs: 1000,
          attemptNumber: 1,
          progressRate: 0,
        },
        confidence: 0.95,
      });

      // Mock ClickUp failure
      clickupService.addComment.mockRejectedValue(new Error('ClickUp API error'));

      const result = await service.attemptFix({
        executionId: 'exec-123',
        ticketId: 'ticket-456',
        qaResult: initialQA,
        previousErrorCount: 8,
      });

      // Should still escalate
      expect(result.outcome).toBe('ESCALATED');

      // Should capture exception in Sentry
      expect(sentryService.captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'ClickUp API error' }),
        expect.objectContaining({ tags: { operation: 'self_healing_escalation' } }),
      );
    });
  });

  // Note: extractErrorCounts is tested indirectly through attemptFix() tests
  // Direct testing of private methods removed to avoid type assertion complexity

  describe('AI decision logging', () => {
    it('should log all decision points during successful fix', async () => {
      const initialQA = createQAResult(5, 3);
      const fixedQA = createQAResult(0, 0);

      jest.spyOn(service as never, 'simulateFixAttempt').mockResolvedValue(fixedQA as never);

      progressValidator.validateProgress.mockResolvedValue({
        shouldContinue: true,
        reason: 'All errors resolved',
        escalate: false,
        metrics: {
          errorsBefore: 8,
          errorsAfter: 0,
          errorReduction: 8,
          totalTimeMs: 1000,
          attemptNumber: 1,
          progressRate: 8,
        },
        confidence: 1.0,
      });

      await service.attemptFix({
        executionId: 'exec-123',
        ticketId: 'ticket-456',
        qaResult: initialQA,
        previousErrorCount: 8,
      });

      // Verify all 3 log points: initiation, attempt, validation
      expect(aiDecisionLogger.logDecision).toHaveBeenCalledTimes(3);

      expect(aiDecisionLogger.logDecision).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          action: 'self_healing_initiated',
          agentName: 'Self-Healing Orchestrator',
        }),
      );

      expect(aiDecisionLogger.logDecision).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          action: 'self_healing_attempt',
        }),
      );

      expect(aiDecisionLogger.logDecision).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          action: 'progress_validation',
        }),
      );
    });

    it('should log escalation  when validation fails', async () => {
      const initialQA = createQAResult(5, 3);

      jest.spyOn(service as never, 'simulateFixAttempt').mockResolvedValue(initialQA as never);

      progressValidator.validateProgress.mockResolvedValue({
        shouldContinue: false,
        reason: 'No progress',
        escalate: true,
        metrics: {
          errorsBefore: 8,
          errorsAfter: 8,
          errorReduction: 0,
          totalTimeMs: 1000,
          attemptNumber: 1,
          progressRate: 0,
        },
        confidence: 0.95,
      });

      await service.attemptFix({
        executionId: 'exec-123',
        ticketId: 'ticket-456',
        qaResult: initialQA,
        previousErrorCount: 8,
      });

      // Should have escalation_triggered log
      expect(aiDecisionLogger.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'escalation_triggered',
          reasoning: 'No progress',
          confidence: 0.95,
        }),
      );
    });
  });

  describe('metrics recording', () => {
    it('should record success metrics', async () => {
      const initialQA = createQAResult(5, 3);
      const fixedQA = createQAResult(0, 0);

      jest.spyOn(service as never, 'simulateFixAttempt').mockResolvedValue(fixedQA as never);

      progressValidator.validateProgress.mockResolvedValue({
        shouldContinue: true,
        reason: 'All errors resolved',
        escalate: false,
        metrics: {
          errorsBefore: 8,
          errorsAfter: 0,
          errorReduction: 8,
          totalTimeMs: 1000,
          attemptNumber: 1,
          progressRate: 8,
        },
        confidence: 1.0,
      });

      await service.attemptFix({
        executionId: 'exec-123',
        ticketId: 'ticket-456',
        qaResult: initialQA,
        previousErrorCount: 8,
      });

      expect(metricsService.incrementCounter).toHaveBeenCalledWith(
        'ai_self_healing_attempts_total',
        {
          ticket_id: 'ticket-456',
          outcome: 'success',
        },
      );

      expect(metricsService.setGauge).toHaveBeenCalledWith('ai_self_healing_progress', 100, {
        ticket_id: 'ticket-456',
      });
    });

    it('should record escalation metrics', async () => {
      const initialQA = createQAResult(5, 3);

      jest.spyOn(service as never, 'simulateFixAttempt').mockResolvedValue(initialQA as never);

      progressValidator.validateProgress.mockResolvedValue({
        shouldContinue: false,
        reason: 'No progress',
        escalate: true,
        metrics: {
          errorsBefore: 8,
          errorsAfter: 8,
          errorReduction: 0,
          totalTimeMs: 1000,
          attemptNumber: 1,
          progressRate: 0,
        },
        confidence: 0.95,
      });

      await service.attemptFix({
        executionId: 'exec-123',
        ticketId: 'ticket-456',
        qaResult: initialQA,
        previousErrorCount: 8,
      });

      expect(metricsService.incrementCounter).toHaveBeenCalledWith(
        'ai_self_healing_attempts_total',
        {
          ticket_id: 'ticket-456',
          outcome: 'escalated',
        },
      );
    });
  });
});
