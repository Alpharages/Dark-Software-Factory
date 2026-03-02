import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { PmDashboardService } from './pm-dashboard.service';
import { PrismaService } from '@/database/prisma.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { FinancialMetricsService } from '@/financial-metrics/financial-metrics.service';

describe('PmDashboardService', () => {
  let service: PmDashboardService;

  const mockPrismaService = {
    project: {
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    ticket: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
      count: jest.fn(),
    },
    execution: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    qAResult: {
      count: jest.fn(),
    },
  };

  const mockMetricsService = {
    recordHistogram: jest.fn(),
  };

  const mockFinancialMetricsService = {
    getDashboardBudgetInsights: jest.fn(),
  };

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PmDashboardService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: MetricsService,
          useValue: mockMetricsService,
        },
        {
          provide: FinancialMetricsService,
          useValue: mockFinancialMetricsService,
        },
        {
          provide: CACHE_MANAGER,
          useValue: mockCacheManager,
        },
      ],
    }).compile();

    service = module.get<PmDashboardService>(PmDashboardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getProjects', () => {
    it('should return paginated projects with ticket aggregations', async () => {
      const mockProjects = [
        {
          id: 'p1',
          name: 'Project 1',
          pm_id: 'pm-1',
          status: 'active',
          updated_at: new Date(),
          created_at: new Date(),
          tickets: [
            { id: 't1', status: 'AI_PROCESSING', updated_at: new Date() },
            { id: 't2', status: 'DEPLOYED', updated_at: new Date() },
          ],
        },
      ];

      mockPrismaService.project.findMany.mockResolvedValue(mockProjects);
      mockPrismaService.project.count.mockResolvedValue(1);

      const result = await service.getProjects('pm-1', 'PM', { page: 1, limit: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].tickets.total).toBe(2);
      expect(result.data[0].tickets.in_progress).toBe(1);
      expect(result.data[0].tickets.completed).toBe(1);
      expect(result.pagination.total).toBe(1);
    });

    it('should filter by pm_id for PM role', async () => {
      mockPrismaService.project.findMany.mockResolvedValue([]);
      mockPrismaService.project.count.mockResolvedValue(0);

      await service.getProjects('pm-1', 'PM', {});

      expect(mockPrismaService.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ pm_id: 'pm-1' }),
        }),
      );
    });

    it('should not filter by pm_id for ADMIN role', async () => {
      mockPrismaService.project.findMany.mockResolvedValue([]);
      mockPrismaService.project.count.mockResolvedValue(0);

      await service.getProjects('admin-1', 'ADMIN', {});

      expect(mockPrismaService.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ pm_id: 'admin-1' }),
        }),
      );
    });
  });

  describe('getSummary', () => {
    it('should return aggregate dashboard statistics', async () => {
      mockPrismaService.project.aggregate.mockResolvedValue({
        _count: { id: 2 },
      });
      mockPrismaService.project.count.mockResolvedValue(1);
      mockPrismaService.ticket.groupBy.mockResolvedValue([
        { status: 'DEPLOYED', _count: { id: 1 } },
        { status: 'AI_PROCESSING', _count: { id: 1 } },
      ]);

      // H1 fix: mock uses started_at/completed_at (not ticket.created_at)
      mockPrismaService.execution.findMany.mockResolvedValue([
        { started_at: new Date(Date.now() - 3600000), completed_at: new Date(Date.now()) }, // 1 hour duration
      ]);
      mockPrismaService.execution.groupBy.mockResolvedValue([
        { status: 'IN_PROGRESS', _count: { id: 2 } },
        { status: 'QUEUED', _count: { id: 1 } },
      ]);
      // M1 fix: QA counts now run in Promise.all — use once-style mocks
      mockPrismaService.qAResult.count
        .mockResolvedValueOnce(10) // qaTotal
        .mockResolvedValueOnce(8); // qaPassed

      const result = await service.getSummary('pm-1', 'PM');

      expect(result.total_projects).toBe(2);
      expect(result.active_projects).toBe(1);
      expect(result.total_tickets).toBe(2);
      expect(result.completed_tickets).toBe(1);
      expect(result.in_progress_tickets).toBe(1);

      // AI Execution KPI assertions
      expect(result.success_rate).toBeCloseTo(0.8); // 8/10
      expect(result.avg_completion_time_hours).toBeGreaterThanOrEqual(0);
      expect(result.active_ai_executions).toBe(2);
      expect(result.queued_ai_executions).toBe(1);
      expect(result.daily_avg_completion_hours).toHaveLength(7);
    });
  });

  describe('getFinancialSummary', () => {
    it('should return cost-per-ticket and budget trend metrics', async () => {
      mockCacheManager.get.mockResolvedValueOnce(undefined);
      mockFinancialMetricsService.getDashboardBudgetInsights.mockResolvedValueOnce({
        monthlySpend: 1000,
        dailyBudgetBurn: [50, 75, 25, 0, 0, 100, 80, 60, 40, 30, 20, 10, 5, 0],
        budgetCeiling: 5000,
        budgetForecast: 2200,
      });
      mockPrismaService.ticket.count.mockResolvedValueOnce(20);

      const result = await service.getFinancialSummary('manager-1', 'MANAGER');

      expect(result).toEqual({
        cost_per_ticket: 50,
        daily_budget_burn: [50, 75, 25, 0, 0, 100, 80, 60, 40, 30, 20, 10, 5, 0],
        budget_ceiling: 5000,
        budget_forecast: 2200,
      });
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'dashboard_financial_summary',
        result,
        60 * 1000,
      );
    });

    it('should guard divide-by-zero when no completed tickets exist', async () => {
      mockCacheManager.get.mockResolvedValueOnce(undefined);
      mockFinancialMetricsService.getDashboardBudgetInsights.mockResolvedValueOnce({
        monthlySpend: 0,
        dailyBudgetBurn: Array(14).fill(0),
        budgetCeiling: 0,
        budgetForecast: 0,
      });
      mockPrismaService.ticket.count.mockResolvedValueOnce(0);

      const result = await service.getFinancialSummary('admin-1', 'ADMIN');

      expect(result.cost_per_ticket).toBeNull();
      expect(result.daily_budget_burn).toHaveLength(14);
      expect(result.budget_ceiling).toBe(0);
      expect(result.budget_forecast).toBe(0);
    });
  });
});
