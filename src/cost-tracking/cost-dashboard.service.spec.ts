import { Test, TestingModule } from '@nestjs/testing';
import { CostDashboardService } from './cost-dashboard.service';
import { PrismaService } from '@/database/prisma.service';
import { LoggerService } from '@/common/logger/logger.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { Prisma, AIProvider } from '@/prisma/client';

describe('CostDashboardService', () => {
  let service: CostDashboardService;
  let prisma: PrismaService;

  const mockPrismaService = {
    aICostLog: {
      groupBy: jest.fn(),
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
  };

  const mockLoggerService = {
    debug: jest.fn(),
    error: jest.fn(),
  };

  const mockSentryService = {
    captureException: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CostDashboardService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: LoggerService, useValue: mockLoggerService },
        { provide: SentryService, useValue: mockSentryService },
      ],
    }).compile();

    service = module.get<CostDashboardService>(CostDashboardService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getCostSummary', () => {
    it('should return aggregated cost summary for a day', async () => {
      const providerData = [
        {
          ai_provider: AIProvider.CURSOR_HEADLESS,
          _sum: { cost_usd: new Prisma.Decimal('10.5'), tokens_input: 1000, tokens_output: 500 },
          _count: 5,
        },
      ];
      const modelData = [
        {
          model_name: 'gpt-4o',
          _sum: { cost_usd: new Prisma.Decimal('10.5'), tokens_input: 1000, tokens_output: 500 },
          _count: 5,
        },
      ];
      const totalData = {
        _sum: { cost_usd: new Prisma.Decimal('10.5'), tokens_input: 1000, tokens_output: 500 },
        _count: 5,
      };

      (prisma.aICostLog.groupBy as jest.Mock)
        .mockResolvedValueOnce(providerData)
        .mockResolvedValueOnce(modelData);
      (prisma.aICostLog.aggregate as jest.Mock).mockResolvedValueOnce(totalData);

      const result = await service.getCostSummary('day');

      expect(result.period).toBe('day');
      expect(result.totalCostUsd).toBe('10.5');
      expect(result.invocationCount).toBe(5);
      expect(result.byProvider).toHaveLength(1);
      expect(result.byProvider[0].provider).toBe(AIProvider.CURSOR_HEADLESS);
      expect(result.byModel).toHaveLength(1);
      expect(result.byModel[0].model).toBe('gpt-4o');
    });

    it('should handle errors gracefully and return zeroed results', async () => {
      (prisma.aICostLog.groupBy as jest.Mock).mockRejectedValue(new Error('Prisma error'));

      const result = await service.getCostSummary('week');

      expect(result.period).toBe('week');
      expect(result.totalCostUsd).toBe('0.00');
      expect(result.invocationCount).toBe(0);
      expect(mockSentryService.captureException).toHaveBeenCalled();
    });
  });

  describe('getTicketCost', () => {
    it('should return detailed cost for a specific ticket', async () => {
      const mockLogs = [
        {
          id: 'log-1',
          timestamp: new Date(),
          ai_provider: AIProvider.CURSOR_HEADLESS,
          model_name: 'gpt-4o',
          operation_type: 'code_gen',
          tokens_input: 100,
          tokens_output: 50,
          cost_usd: new Prisma.Decimal('0.05'),
          execution: {
            id: 'exec-1',
            status: 'SUCCESS',
            ai_provider: 'CURSOR_HEADLESS',
            selected_model: 'gpt-4o',
          },
        },
      ];

      (prisma.aICostLog.findMany as jest.Mock).mockResolvedValue(mockLogs);

      const result = await service.getTicketCost('DSF-123');

      expect(result.ticketId).toBe('DSF-123');
      expect(result.totalCostUsd).toBe('0.05');
      expect(result.costLogs).toHaveLength(1);
      expect(result.costLogs[0].id).toBe('log-1');
      expect(result.costLogs[0].execution?.id).toBe('exec-1');
    });

    it('should handle errors gracefully for ticket cost', async () => {
      (prisma.aICostLog.findMany as jest.Mock).mockRejectedValue(new Error('Database error'));

      const result = await service.getTicketCost('DSF-123');

      expect(result.ticketId).toBe('DSF-123');
      expect(result.totalCostUsd).toBe('0.00');
      expect(result.costLogs).toHaveLength(0);
    });
  });

  describe('getCostBreakdown', () => {
    it('should return grouped cost breakdown with pagination', async () => {
      const mockBreakdown = [
        {
          model_name: 'gpt-4o',
          _sum: { cost_usd: new Prisma.Decimal('50.0'), tokens_input: 5000, tokens_output: 2000 },
          _count: 10,
        },
      ];
      const mockTotalGroups = 5;

      (prisma.aICostLog.groupBy as jest.Mock)
        .mockResolvedValueOnce(mockBreakdown)
        .mockResolvedValueOnce(new Array(mockTotalGroups).fill({}));

      const result = await service.getCostBreakdown({
        groupBy: 'model',
        page: 1,
        limit: 10,
      });

      expect(result.groupBy).toBe('model');
      expect(result.data).toHaveLength(1);
      expect(result.data[0].groupKey).toBe('gpt-4o');
      expect(result.data[0].totalCostUsd).toBe('50');
      expect(result.meta.total).toBe(5);
      expect(result.meta.totalPages).toBe(1);
    });

    it('should group by agent/operation correcty', async () => {
      const mockBreakdown = [
        {
          ai_provider: AIProvider.CURSOR_HEADLESS,
          operation_type: 'generate_tests',
          _sum: { cost_usd: new Prisma.Decimal('20.0'), tokens_input: 2000, tokens_output: 1000 },
          _count: 5,
        },
      ];

      (prisma.aICostLog.groupBy as jest.Mock)
        .mockResolvedValueOnce(mockBreakdown)
        .mockResolvedValueOnce([{}]);

      const result = await service.getCostBreakdown({
        groupBy: 'agent',
        page: 1,
        limit: 10,
      });

      expect(result.data[0].groupKey).toBe(`${AIProvider.CURSOR_HEADLESS} (generate tests)`);
    });

    it('should throw error when database query fails in breakdown', async () => {
      (prisma.aICostLog.groupBy as jest.Mock).mockRejectedValue(new Error('Query failed'));

      await expect(
        service.getCostBreakdown({
          groupBy: 'model',
          page: 1,
          limit: 10,
        }),
      ).rejects.toThrow('Query failed');
    });
  });
});
