import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { PmDashboardService } from './pm-dashboard.service';
import { PrismaService } from '@/database/prisma.service';
import { MetricsService } from '@/common/metrics/metrics.service';

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
    },
  };

  const mockMetricsService = {
    recordHistogram: jest.fn(),
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

      const result = await service.getSummary('pm-1', 'PM');

      expect(result.total_projects).toBe(2);
      expect(result.active_projects).toBe(1);
      expect(result.total_tickets).toBe(2);
      expect(result.completed_tickets).toBe(1);
      expect(result.in_progress_tickets).toBe(1);
    });
  });
});
