import { Test, TestingModule } from '@nestjs/testing';
import { ProgressValidatorService } from './progress-validator.service';
import { PrismaService } from '@/database/prisma.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';

describe('ProgressValidatorService', () => {
  let service: ProgressValidatorService;
  let sentry: jest.Mocked<SentryService>;
  let metrics: jest.Mocked<MetricsService>;
  let aiDecisionLogger: jest.Mocked<AIDecisionLoggerService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgressValidatorService,
        {
          provide: PrismaService,
          useValue: {
            // Mock if needed (might not be used directly)
          },
        },
        {
          provide: SentryService,
          useValue: {
            captureMessage: jest.fn().mockResolvedValue(undefined),
            captureException: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            incrementCounter: jest.fn().mockReturnValue(undefined),
            recordHistogram: jest.fn().mockReturnValue(undefined),
            setGauge: jest.fn().mockReturnValue(undefined),
          },
        },
        {
          provide: AIDecisionLoggerService,
          useValue: {
            logDecision: jest.fn().mockResolvedValue({ id: 'mock-log-id' }),
          },
        },
      ],
    }).compile();

    service = module.get<ProgressValidatorService>(ProgressValidatorService);
    sentry = module.get(SentryService);
    metrics = module.get(MetricsService);
    aiDecisionLogger = module.get(AIDecisionLoggerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateProgress', () => {
    it('should escalate when errors are not decreasing (same count)', async () => {
      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 5,
        errorsAfter: 5, // No progress
        attemptNumber: 2,
        startTime: new Date(),
      });

      expect(result.shouldContinue).toBe(false);
      expect(result.escalate).toBe(true);
      expect(result.reason).toContain('No progress');
      expect(aiDecisionLogger.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'escalate_to_human',
          agentName: 'AI Progress Validator',
        }),
      );
      expect(sentry.captureMessage).toHaveBeenCalled();
    });

    it('should escalate when errors increase', async () => {
      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 3,
        errorsAfter: 5, // Getting worse
        attemptNumber: 1,
        startTime: new Date(),
      });

      expect(result.shouldContinue).toBe(false);
      expect(result.escalate).toBe(true);
      expect(result.metrics.errorReduction).toBe(-2);
    });

    it('should escalate when time limit exceeded', async () => {
      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000);

      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 10,
        errorsAfter: 5,
        attemptNumber: 3,
        startTime: elevenMinutesAgo,
      });

      expect(result.shouldContinue).toBe(false);
      expect(result.escalate).toBe(true);
      expect(result.reason).toContain('Time limit exceeded');
      expect(result.metrics.totalTimeMs).toBeGreaterThan(10 * 60 * 1000);
    });

    it('should continue when making progress within time limit', async () => {
      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 10,
        errorsAfter: 5, // 50% reduction
        attemptNumber: 1,
        startTime: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
      });

      expect(result.shouldContinue).toBe(true);
      expect(result.escalate).toBe(false);
      expect(result.reason).toContain('Making progress');
      expect(result.metrics.errorReduction).toBe(5);
      expect(result.metrics.progressRate).toBe(5); // 5 errors / 1 attempt
    });

    it('should handle successful fix (zero errors)', async () => {
      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 3,
        errorsAfter: 0, // All errors fixed
        attemptNumber: 2,
        startTime: new Date(Date.now() - 5 * 60 * 1000),
      });

      expect(result.shouldContinue).toBe(true);
      expect(result.escalate).toBe(false);
      expect(result.reason).toContain('All errors resolved');
      expect(result.confidence).toBe(1.0);
      expect(aiDecisionLogger.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'fix_successful',
        }),
      );
    });

    it('should handle edge case: negative error counts', async () => {
      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: -1, // Invalid
        errorsAfter: 5,
        attemptNumber: 1,
        startTime: new Date(),
      });

      expect(result.shouldContinue).toBe(false);
      expect(result.escalate).toBe(true);
      expect(result.reason).toContain('Invalid error count');
    });

    it('should handle edge case: zero errors before and after', async () => {
      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 0,
        errorsAfter: 0,
        attemptNumber: 1,
        startTime: new Date(),
      });

      expect(result.shouldContinue).toBe(true);
      expect(result.reason).toContain('All errors resolved');
      expect(result.confidence).toBe(1.0);
    });
  });

  describe('trackFixAttempt', () => {
    it('should log fix attempt via AI Decision Logger', async () => {
      await service.trackFixAttempt({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 10,
        errorsAfter: 5,
        attemptNumber: 1,
        totalTimeMs: 120000, // 2 minutes
        outcome: 'progress',
      });

      expect(aiDecisionLogger.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'fix_attempt_tracked',
          agentName: 'AI Progress Validator',
          inputData: {
            errorsBefore: 10,
            attemptNumber: 1,
          },
          outputData: expect.objectContaining({
            errorsAfter: 5,
            errorReduction: 5,
            outcome: 'progress',
          }),
        }),
      );
    });

    it('should record Prometheus metrics', async () => {
      await service.trackFixAttempt({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 8,
        errorsAfter: 2,
        attemptNumber: 2,
        totalTimeMs: 300000,
        outcome: 'success',
      });

      expect(metrics.incrementCounter).toHaveBeenCalledWith('ai_fix_attempts_total', {
        outcome: 'success',
      });

      expect(metrics.recordHistogram).toHaveBeenCalledWith('ai_fix_time_seconds', 300, {
        ticket_id: 'DSF-456',
      });

      expect(metrics.setGauge).toHaveBeenCalledWith('ai_progress_validation_errors_reduced', 6, {
        execution_id: 'exec-123',
      });
    });

    it('should handle tracking failures gracefully', async () => {
      aiDecisionLogger.logDecision.mockRejectedValue(new Error('DB error'));

      await expect(
        service.trackFixAttempt({
          executionId: 'exec-123',
          ticketId: 'DSF-456',
          errorsBefore: 5,
          errorsAfter: 2,
          attemptNumber: 1,
          totalTimeMs: 60000,
          outcome: 'progress',
        }),
      ).resolves.not.toThrow(); // Graceful degradation

      expect(sentry.captureException).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle very long execution times', async () => {
      const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);

      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 100,
        errorsAfter: 1, // Making progress but too slow
        attemptNumber: 10,
        startTime: twentyMinutesAgo,
      });

      expect(result.escalate).toBe(true);
      expect(result.reason).toContain('Time limit exceeded');
    });

    it('should calculate progress rate correctly', async () => {
      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 15,
        errorsAfter: 3, // 12 errors reduced
        attemptNumber: 3, // Over 3 attempts
        startTime: new Date(Date.now() - 4 * 60 * 1000),
      });

      expect(result.metrics.progressRate).toBe(4); // 12 / 3 = 4 errors per attempt
      expect(result.shouldContinue).toBe(true);
    });
  });
});
