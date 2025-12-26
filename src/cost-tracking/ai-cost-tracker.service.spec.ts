import { Test, TestingModule } from '@nestjs/testing';
import { AICostTrackerService } from './ai-cost-tracker.service';
import { PrismaService } from '@/database/prisma.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { AIProvider, Prisma } from '@/prisma/client';
import { ErrorSeverity } from '@/common/sentry/sentry.constants';

const Decimal = Prisma.Decimal;

describe('AICostTrackerService', () => {
  let service: AICostTrackerService;
  let prisma: PrismaService;
  let metrics: MetricsService;
  let sentry: SentryService;

  const mockPrismaService = {
    aICostLog: {
      create: jest.fn().mockResolvedValue({}),
      aggregate: jest.fn().mockResolvedValue({ _sum: { cost_usd: new Decimal(10) } }),
    },
    ticket: {
      findUnique: jest.fn().mockResolvedValue({
        project_id: 'test-project',
        project: { budget_usd: new Decimal(100) },
      }),
    },
  };

  const mockMetricsService = {
    recordAICost: jest.fn(),
    setBudgetUtilization: jest.fn(),
  };

  const mockSentryService = {
    captureMessage: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AICostTrackerService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: SentryService, useValue: mockSentryService },
      ],
    }).compile();

    service = module.get<AICostTrackerService>(AICostTrackerService);
    prisma = module.get<PrismaService>(PrismaService);
    metrics = module.get<MetricsService>(MetricsService);
    sentry = module.get<SentryService>(SentryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('calculateUSD', () => {
    it('should calculate cost correctly for Claude 3.5 Sonnet', () => {
      const model = 'claude-3-5-sonnet-20240620';
      const inputTokens = 1_000_000;
      const outputTokens = 1_000_000;

      const cost = service.calculateUSD(model, inputTokens, outputTokens);

      // Rates: input $3/1M, output $15/1M
      expect(cost.toNumber()).toBe(18);
    });

    it('should calculate cost correctly for GPT-4o', () => {
      const model = 'gpt-4o';
      const inputTokens = 1_000_000;
      const outputTokens = 1_000_000;

      const cost = service.calculateUSD(model, inputTokens, outputTokens);

      // Rates: input $5/1M, output $15/1M
      expect(cost.toNumber()).toBe(20);
    });

    it('should use default rates for unknown model', () => {
      const model = 'unknown-model';
      const inputTokens = 1_000_000;

      const cost = service.calculateUSD(model, inputTokens, 0);

      // Default rate: input $10/1M
      expect(cost.toNumber()).toBe(10);
    });
  });

  describe('logCost', () => {
    it('should log cost to database and metrics', async () => {
      const params = {
        executionId: 'exec-1',
        ticketId: 'ticket-1',
        provider: AIProvider.CLAUDE_CODE,
        model: 'claude-3-5-sonnet-20240620',
        inputTokens: 1000,
        outputTokens: 500,
        agentName: 'TestAgent',
        operationType: 'testing',
      };

      await service.logCost(params);

      expect(prisma.aICostLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            execution_id: 'exec-1',
            ai_provider: AIProvider.CLAUDE_CODE,
            tokens_input: 1000,
            tokens_output: 500,
          }),
        }),
      );

      expect(metrics.recordAICost).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'CLAUDE_CODE',
          model: params.model,
          inputTokens: 1000,
          outputTokens: 500,
        }),
      );
    });
  });

  describe('estimateCost', () => {
    it('should estimate cost based on prompt length using 4 chars/token approximation', () => {
      const prompt = 'a'.repeat(1000); // 1000 characters
      const model = 'gpt-4o';
      const estimatedOutputTokens = 500; // Typical response

      const cost = service.estimateCost(prompt, model, estimatedOutputTokens);

      // 1000 chars / 4 = 250 input tokens
      // gpt-4o: input $5/1M, output $15/1M
      // (250 / 1_000_000) * 5 + (500 / 1_000_000) * 15 = 0.00125 + 0.0075 = 0.00875
      expect(cost.toNumber()).toBeCloseTo(0.00875, 6);
    });

    it('should handle very long prompts correctly', () => {
      const prompt = 'a'.repeat(100_000); // 100K characters = ~25K tokens
      const model = 'claude-3-5-sonnet-20240620';
      const estimatedOutputTokens = 1000;

      const cost = service.estimateCost(prompt, model, estimatedOutputTokens);

      // 100K chars / 4 = 25K tokens
      // Claude 3.5 Sonnet: input $3/1M, output $15/1M
      // (25000 / 1_000_000) * 3 + (1000 / 1_000_000) * 15 = 0.075 + 0.015 = 0.09
      expect(cost.toNumber()).toBeCloseTo(0.09, 6);
    });

    it('should use default rates for unknown model', () => {
      const prompt = 'test prompt';
      const model = 'unknown-model-xyz';
      const estimatedOutputTokens = 200;

      const cost = service.estimateCost(prompt, model, estimatedOutputTokens);

      // prompt.length = 11, / 4 = 2.75 tokens (floor to 2)
      // Default: input $10/1M, output $50/1M
      expect(cost.toNumber()).toBeGreaterThan(0);
    });

    it('should handle empty prompt edge case', () => {
      const prompt = '';
      const model = 'gpt-4o';
      const estimatedOutputTokens = 100;

      const cost = service.estimateCost(prompt, model, estimatedOutputTokens);

      // 0 input tokens, 100 output tokens
      // (0 / 1_000_000) * 5 + (100 / 1_000_000) * 15 = 0 + 0.0015 = 0.0015
      expect(cost.toNumber()).toBeCloseTo(0.0015, 6);
    });
  });

  describe('checkBudgetThresholds', () => {
    it('should trigger warning alert when threshold reached', async () => {
      // Mock aggregate to return 85% of budget

      jest.spyOn(prisma.aICostLog, 'aggregate').mockResolvedValue({
        _sum: { cost_usd: new Decimal(85) }, // Budget is mocked at 100 in service
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await service.logCost({
        ticketId: 'ticket-1',
        provider: AIProvider.CLAUDE_CODE,
        model: 'gpt-4o',
        inputTokens: 10,
        outputTokens: 10,
        agentName: 'Agent',
        operationType: 'op',
      });

      expect(metrics.setBudgetUtilization).toHaveBeenCalledWith('test-project', 85);
      expect(sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('WARNING'),
        ErrorSeverity.HIGH,
      );
    });

    it('should trigger critical alert when budget exceeded', async () => {
      // Mock aggregate to return 110% of budget

      jest.spyOn(prisma.aICostLog, 'aggregate').mockResolvedValue({
        _sum: { cost_usd: new Decimal(110) },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await service.logCost({
        ticketId: 'ticket-1',
        provider: AIProvider.CLAUDE_CODE,
        model: 'gpt-4o',
        inputTokens: 10,
        outputTokens: 10,
        agentName: 'Agent',
        operationType: 'op',
      });

      expect(sentry.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL'),
        ErrorSeverity.FATAL,
      );
    });
    /* ... existing tests ... */
  });

  describe('checkBudgetAvailability', () => {
    it('should allow execution when within budget', async () => {
      // Mock aggregate to return $50 spend (Budget $100)
      jest.spyOn(prisma.aICostLog, 'aggregate').mockResolvedValue({
        _sum: { cost_usd: new Decimal(50) },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await service.checkBudgetAvailability('ticket-1', new Decimal(10));

      expect(result.allowed).toBe(true);
    });

    it('should block execution when budget exceeded', async () => {
      // Mock aggregate to return $95 spend (Budget $100) + $10 estimate = $105
      jest.spyOn(prisma.aICostLog, 'aggregate').mockResolvedValue({
        _sum: { cost_usd: new Decimal(95) },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await service.checkBudgetAvailability('ticket-1', new Decimal(10));

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Project budget exceeded');
    });

    it('should block execution when budget already exceeded', async () => {
      // Mock aggregate to return $105 spend (Budget $100)
      jest.spyOn(prisma.aICostLog, 'aggregate').mockResolvedValue({
        _sum: { cost_usd: new Decimal(105) },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await service.checkBudgetAvailability('ticket-1', new Decimal(1));

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Project budget exceeded');
    });

    it('should block execution when project context is missing (Fail Closed)', async () => {
      jest.spyOn(prisma.ticket, 'findUnique').mockResolvedValue(null);

      const result = await service.checkBudgetAvailability('invalid-ticket', new Decimal(10));

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Project context not found');
    });
  });
});
