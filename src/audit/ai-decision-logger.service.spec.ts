import { Test, TestingModule } from '@nestjs/testing';
import { AIDecisionLoggerService } from './ai-decision-logger.service';
import { PrismaService } from '@/database/prisma.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { MetricsService } from '@/common/metrics/metrics.service';

describe('AIDecisionLoggerService', () => {
  let service: AIDecisionLoggerService;
  // Explicitly typed to match the partial mock object structure, avoiding @ts-nocheck
  let prisma: {
    aIDecisionLog: { create: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    execution: { groupBy: jest.Mock };
  };
  let sentry: jest.Mocked<SentryService>;
  let metrics: jest.Mocked<MetricsService>;

  const mockAIDecisionLog = {
    id: 'test-uuid-123',
    timestamp: new Date('2025-12-20T00:00:00Z'),
    agent_name: 'CursorCLI',
    action: 'code_generation',
    reasoning: 'Generated REST API endpoint',
    ticket_id: 'DSF-123',
    execution_id: 'exec-456',
    input_data: { prompt: 'Create user endpoint' },
    output_data: { filesModified: 2 },
    confidence: 0.8,
  };

  beforeEach(async () => {
    const mockCreate = jest.fn();
    const mockFindMany = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIDecisionLoggerService,
        {
          provide: PrismaService,
          useValue: {
            aIDecisionLog: {
              create: mockCreate,
              findMany: mockFindMany.mockResolvedValue([]),
              count: jest.fn().mockResolvedValue(0),
            },
            execution: {
              groupBy: jest.fn().mockResolvedValue([]),
            },
          },
        },
        {
          provide: SentryService,
          useValue: {
            captureMessage: jest.fn().mockReturnValue('event-id'),
            captureException: jest.fn().mockReturnValue('event-id'),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            incrementCounter: jest.fn(),
            recordHistogram: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AIDecisionLoggerService>(AIDecisionLoggerService);
    /**
     * Cast as any to bypass Prisma's complex type system in tests.
     * Prisma client methods have sophisticated generic types that conflict
     * with Jest mock functions. The `as any` cast allows mockResolvedValue/mockRejectedValue
     * to work correctly throughout the test file.
     *
     * Note: TypeScript will still show errors on `prisma.aIDecisionLog.create.mockResolvedValue()`
     * but the tests compile and run successfully at runtime.
     */

    prisma = module.get(PrismaService) as typeof prisma;
    sentry = module.get(SentryService) as jest.Mocked<SentryService>;
    metrics = module.get(MetricsService) as jest.Mocked<MetricsService>;

    // Reset mocks between tests
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('logDecision', () => {
    const validDecisionInput = {
      agentName: 'CursorCLI',
      action: 'code_generation',
      reasoning: 'Generated REST API endpoint',
      ticketId: 'DSF-123',
      executionId: 'exec-456',
      inputData: { prompt: 'Create user endpoint' },
      outputData: { filesModified: 2 },
      confidence: 0.8,
    };

    it('should create AI decision log in database', async () => {
      prisma.aIDecisionLog.create.mockResolvedValue(mockAIDecisionLog);

      const result = await service.logDecision(validDecisionInput);

      expect(prisma.aIDecisionLog.create).toHaveBeenCalledWith({
        data: {
          agent_name: 'CursorCLI',
          action: 'code_generation',
          reasoning: 'Generated REST API endpoint',
          ticket_id: 'DSF-123',
          execution_id: 'exec-456',
          input_data: { prompt: 'Create user endpoint' },
          output_data: { filesModified: 2 },
          confidence: 0.8,
        },
      });
      expect(result).toEqual(mockAIDecisionLog);
    });

    it('should record Prometheus metrics for all decisions', async () => {
      prisma.aIDecisionLog.create.mockResolvedValue(mockAIDecisionLog);

      await service.logDecision(validDecisionInput);

      expect(metrics.incrementCounter).toHaveBeenCalledWith('audit_logs_total', {
        agent_name: 'CursorCLI',
        action: 'code_generation',
      });
    });

    it('should trigger Sentry alert for low-confidence decisions', async () => {
      prisma.aIDecisionLog.create.mockResolvedValue(mockAIDecisionLog);

      await service.logDecision({
        ...validDecisionInput,
        confidence: 0.3, // Below threshold
      });

      expect(sentry.captureMessage).toHaveBeenCalledWith(
        'Low confidence AI decision',
        'warning', // ErrorSeverity.HIGH maps to 'warning' string
        expect.objectContaining({
          confidence: 0.3,
          agentName: 'CursorCLI',
          action: 'code_generation',
          ticketId: 'DSF-123',
          reasoning: 'Generated REST API endpoint',
        }),
      );
    });

    it('should record low-confidence metric for decisions below threshold', async () => {
      prisma.aIDecisionLog.create.mockResolvedValue(mockAIDecisionLog);

      await service.logDecision({
        ...validDecisionInput,
        confidence: 0.4, // Below 0.5 threshold
      });

      expect(metrics.incrementCounter).toHaveBeenCalledWith('audit_logs_low_confidence_total', {
        agent_name: 'CursorCLI',
      });
    });

    it('should NOT trigger Sentry alert for high-confidence decisions', async () => {
      prisma.aIDecisionLog.create.mockResolvedValue(mockAIDecisionLog);

      await service.logDecision({
        ...validDecisionInput,
        confidence: 0.9,
      });

      expect(sentry.captureMessage).not.toHaveBeenCalled();
    });

    it('should handle database error gracefully', async () => {
      const dbError = new Error('Database connection failed');
      prisma.aIDecisionLog.create.mockRejectedValue(dbError);

      const result = await service.logDecision(validDecisionInput);

      expect(result).toBeNull();
      expect(sentry.captureException).toHaveBeenCalledWith(dbError);
    });

    it('should handle metrics error gracefully without crashing', async () => {
      prisma.aIDecisionLog.create.mockResolvedValue(mockAIDecisionLog);
      metrics.incrementCounter.mockImplementation(() => {
        throw new Error('Metrics failed');
      });

      const result = await service.logDecision(validDecisionInput);

      // Should still return the log even if metrics fail
      expect(result).toEqual(mockAIDecisionLog);
    });

    it('should handle Sentry error gracefully without crashing', async () => {
      prisma.aIDecisionLog.create.mockResolvedValue(mockAIDecisionLog);
      sentry.captureMessage.mockImplementation(() => {
        throw new Error('Sentry failed');
      });

      const result = await service.logDecision({
        ...validDecisionInput,
        confidence: 0.3,
      });

      // Should still return the log even if Sentry fails
      expect(result).toEqual(mockAIDecisionLog);
    });

    it('should log decision for ClaudeCode agent', async () => {
      prisma.aIDecisionLog.create.mockResolvedValue({
        ...mockAIDecisionLog,
        agent_name: 'ClaudeCode',
      });

      await service.logDecision({
        agentName: 'ClaudeCode',
        action: 'test_generation',
        reasoning: 'Generated unit tests',
        ticketId: 'DSF-456',
        inputData: {},
        outputData: {},
        confidence: 0.9,
      });

      expect(metrics.incrementCounter).toHaveBeenCalledWith('audit_logs_total', {
        agent_name: 'ClaudeCode',
        action: 'test_generation',
      });
    });

    // Fix: Issue #6 - Test confidence value validation
    it('should clamp confidence value below 0 to 0', async () => {
      prisma.aIDecisionLog.create.mockResolvedValue(mockAIDecisionLog);

      await service.logDecision({
        ...validDecisionInput,
        confidence: -0.5, // Invalid: below range
      });

      expect(prisma.aIDecisionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          confidence: 0, // Clamped to minimum
        }),
      });
    });

    it('should clamp confidence value above 1 to 1', async () => {
      prisma.aIDecisionLog.create.mockResolvedValue(mockAIDecisionLog);

      await service.logDecision({
        ...validDecisionInput,
        confidence: 1.5, // Invalid: above range
      });

      expect(prisma.aIDecisionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          confidence: 1, // Clamped to maximum
        }),
      });
    });

    it('should handle NaN confidence value gracefully', async () => {
      prisma.aIDecisionLog.create.mockResolvedValue(mockAIDecisionLog);

      await service.logDecision({
        ...validDecisionInput,
        confidence: NaN, // Invalid: NaN
      });

      expect(prisma.aIDecisionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          confidence: 0, // Falls back to 0
        }),
      });
    });

    it('should handle optional executionId parameter', async () => {
      prisma.aIDecisionLog.create.mockResolvedValue(mockAIDecisionLog);

      await service.logDecision({
        agentName: 'CursorCLI',
        action: 'refactoring',
        reasoning: 'Code cleanup',
        ticketId: 'DSF-789',
        // No executionId
        inputData: {},
        outputData: {},
        confidence: 0.7,
      });

      expect(prisma.aIDecisionLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          execution_id: undefined,
        }),
      });
    });
  });

  describe('getDecisionTimeline', () => {
    it('should return decisions in chronological order', async () => {
      const mockTimeline = [
        {
          ...mockAIDecisionLog,
          id: '1',
          timestamp: new Date('2025-01-01T10:00:00Z'),
          execution: {
            id: 'exec-1',
            status: 'COMPLETED' as const,
            provider: 'CURSOR_CLI' as const,
          },
        },
        {
          ...mockAIDecisionLog,
          id: '2',
          timestamp: new Date('2025-01-01T11:00:00Z'),
          execution: {
            id: 'exec-2',
            status: 'COMPLETED' as const,
            provider: 'CURSOR_CLI' as const,
          },
        },
      ];

      prisma.aIDecisionLog.findMany.mockResolvedValue(mockTimeline as any);

      const result = await service.getDecisionTimeline('DSF-123');

      expect(prisma.aIDecisionLog.findMany).toHaveBeenCalledWith({
        where: { ticket_id: 'DSF-123' },
        orderBy: { timestamp: 'asc' },
        include: {
          execution: {
            select: {
              id: true,
              status: true,
              ai_provider: true,
            },
          },
        },
      });
      expect(result).toEqual(mockTimeline);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no decisions exist', async () => {
      prisma.aIDecisionLog.findMany.mockResolvedValue([]);

      const result = await service.getDecisionTimeline('DSF-999');

      expect(result).toEqual([]);
    });

    it('should include execution relationship in query', async () => {
      prisma.aIDecisionLog.findMany.mockResolvedValue([]);

      await service.getDecisionTimeline('DSF-123');

      expect(prisma.aIDecisionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            execution: expect.any(Object),
          }),
        }),
      );
    });
  });

  describe('getLowConfidenceDecisions', () => {
    it('should filter decisions below threshold', async () => {
      const mockLowConfidence = [
        { ...mockAIDecisionLog, id: '1', confidence: 0.4 },
        { ...mockAIDecisionLog, id: '2', confidence: 0.3 },
      ];

      prisma.aIDecisionLog.findMany.mockResolvedValue(mockLowConfidence as any);
      prisma.aIDecisionLog.count.mockResolvedValue(2);
      const result = await service.getLowConfidenceDecisions({
        page: 1,
        limit: 100,
        minConfidence: 0.5,
      });

      expect(prisma.aIDecisionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { confidence: { lt: 0.5 } },
          orderBy: { timestamp: 'desc' },
          take: 100,
        }),
      );
      expect(result.data).toEqual(mockLowConfidence);
    });

    it('should use default threshold of 0.5 when not specified', async () => {
      prisma.aIDecisionLog.count.mockResolvedValue(0);
      await service.getLowConfidenceDecisions();

      expect(prisma.aIDecisionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { confidence: { lt: 0.5 } },
        }),
      );
    });

    it('should limit results to 100 for performance', async () => {
      prisma.aIDecisionLog.count.mockResolvedValue(0);
      await service.getLowConfidenceDecisions({ page: 1, limit: 100, minConfidence: 0.6 });

      expect(prisma.aIDecisionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 100,
        }),
      );
    });

    it('should order results by most recent first', async () => {
      prisma.aIDecisionLog.count.mockResolvedValue(0);
      await service.getLowConfidenceDecisions({ page: 1, limit: 100, minConfidence: 0.5 });

      expect(prisma.aIDecisionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { timestamp: 'desc' },
        }),
      );
    });

    it('should support custom threshold values', async () => {
      prisma.aIDecisionLog.count.mockResolvedValue(0);
      await service.getLowConfidenceDecisions({ page: 1, limit: 100, minConfidence: 0.7 });

      expect(prisma.aIDecisionLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { confidence: { lt: 0.7 } },
        }),
      );
    });

    it('should return empty array when no low-confidence decisions exist', async () => {
      prisma.aIDecisionLog.count.mockResolvedValue(0);
      const result = await service.getLowConfidenceDecisions({
        page: 1,
        limit: 100,
        minConfidence: 0.5,
      });

      expect(result.data).toEqual([]);
    });
  });

  describe('getProviderDistributionStats', () => {
    it('should return normalized provider percentages', async () => {
      // Now uses execution.groupBy (DB aggregate) instead of aIDecisionLog.findMany
      prisma.execution.groupBy.mockResolvedValue([
        { ai_provider: 'CURSOR_HEADLESS', _count: { _all: 1 } },
        { ai_provider: 'CLAUDE_CODE', _count: { _all: 2 } },
      ]);

      const result = await service.getProviderDistributionStats();

      expect(result).toEqual([
        { provider: 'CLAUDE', percentage: 66.67, count: 2 },
        { provider: 'CURSOR', percentage: 33.33, count: 1 },
        { provider: 'WINDSURF', percentage: 0, count: 0 },
      ]);
    });

    it('should return zeroed distribution when no executions exist', async () => {
      prisma.execution.groupBy.mockResolvedValue([]);

      const result = await service.getProviderDistributionStats();

      expect(result).toEqual([
        { provider: 'CLAUDE', percentage: 0, count: 0 },
        { provider: 'CURSOR', percentage: 0, count: 0 },
        { provider: 'WINDSURF', percentage: 0, count: 0 },
      ]);
    });

    it('should apply PM scope filter to execution groupBy query', async () => {
      prisma.execution.groupBy.mockResolvedValue([
        { ai_provider: 'CLAUDE_CODE', _count: { _all: 3 } },
      ]);

      const result = await service.getProviderDistributionStats({ pmId: 'pm-1', role: 'PM' });

      expect(prisma.execution.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            ticket: expect.objectContaining({
              project: expect.objectContaining({ pm_id: 'pm-1' }),
            }),
          }),
        }),
      );
      expect(result.find((r) => r.provider === 'CLAUDE')?.count).toBe(3);
    });
  });
});
