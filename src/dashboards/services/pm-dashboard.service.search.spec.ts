import { Test, TestingModule } from '@nestjs/testing';
import { PmDashboardService } from './pm-dashboard.service';
import { PrismaService } from '@/database/prisma.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { FinancialMetricsService } from '@/financial-metrics/financial-metrics.service';
import { GitHubService } from '@/github/github.service';
import { QaResultsService } from '@/qa-automation/qa-results.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';

describe('PmDashboardService - Search', () => {
  let service: PmDashboardService;

  const mockPrismaService = {
    ticket: {
      findMany: jest.fn(),
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

  const mockGitHubService = {
    getPrMergeRateStats: jest.fn(),
  };

  const mockQaResultsService = {
    getQaFirstPassRateStats: jest.fn(),
  };

  const mockAiDecisionLoggerService = {
    getProviderDistributionStats: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PmDashboardService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: FinancialMetricsService, useValue: mockFinancialMetricsService },
        { provide: GitHubService, useValue: mockGitHubService },
        { provide: QaResultsService, useValue: mockQaResultsService },
        { provide: AIDecisionLoggerService, useValue: mockAiDecisionLoggerService },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
      ],
    }).compile();

    service = module.get<PmDashboardService>(PmDashboardService);
  });

  describe('searchTickets', () => {
    it('should search tickets across projects for PM', async () => {
      const tickets = [
        {
          id: 't-1',
          title: 'Fix issue',
          status: 'AI_PROCESSING',
          updated_at: new Date(),
          project: { name: 'Project A', id: 'p-1' },
        },
      ];

      mockPrismaService.ticket.findMany.mockResolvedValue(tickets);
      mockPrismaService.ticket.count.mockResolvedValue(1);

      const result = await service.searchTickets('pm-1', 'PM', { query: 'Fix' });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('Fix issue');
      expect(result.data[0].project_name).toBe('Project A');
      expect(mockPrismaService.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            project: { pm_id: 'pm-1' },
          }),
        }),
      );
    });

    it('should search tickets globally for ADMIN', async () => {
      mockPrismaService.ticket.findMany.mockResolvedValue([]);
      mockPrismaService.ticket.count.mockResolvedValue(0);

      await service.searchTickets('admin-1', 'ADMIN', { query: 'Fix' });

      expect(mockPrismaService.ticket.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({
            project: expect.anything(),
          }),
        }),
      );
    });
  });
});
