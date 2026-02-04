import { Test, TestingModule } from '@nestjs/testing';
import { QaWorkloadService } from './qa-workload.service';
import { PrismaService } from '@/database/prisma.service';
import { BugEscapeService } from '@/qa-automation/bug-escape/bug-escape.service';
import { QualityGateConfigService } from '@/qa-automation/quality-gate-config/quality-gate-config.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import { DashboardGateway } from '../gateways/dashboard.gateway';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { getToken } from '@willsoto/nestjs-prometheus';

describe('QaWorkloadService', () => {
  let service: QaWorkloadService;

  const mockPrisma = {
    qaReviewQueue: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
      groupBy: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    bugEscape: {
      findMany: jest.fn(),
    },
  };

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
  };

  const mockMetric = {
    inc: jest.fn(),
    set: jest.fn(),
    observe: jest.fn(),
  };

  const mockDashboardGateway = {
    server: {
      emit: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QaWorkloadService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: BugEscapeService, useValue: {} },
        { provide: QualityGateConfigService, useValue: {} },
        { provide: AIDecisionLoggerService, useValue: { logDecision: jest.fn() } },
        { provide: DashboardGateway, useValue: mockDashboardGateway },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        { provide: getToken('qa_workload_api_calls_total'), useValue: mockMetric },
        { provide: getToken('qa_workload_queue_depth'), useValue: mockMetric },
        { provide: getToken('qa_workload_review_duration_seconds'), useValue: mockMetric },
        { provide: getToken('qa_workload_alerts_total'), useValue: mockMetric },
      ],
    }).compile();

    service = module.get<QaWorkloadService>(QaWorkloadService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSummary', () => {
    it('should return workload summary from cache if available', async () => {
      const cachedData = { period: '30d' };
      mockCacheManager.get.mockResolvedValue(cachedData);

      const result = await service.getSummary('30d');
      expect(result).toEqual(cachedData);
      expect(mockCacheManager.get).toHaveBeenCalledWith('qa_workload_summary_30d');
    });

    it('should calculate summary if not in cache', async () => {
      mockCacheManager.get.mockResolvedValue(null);
      mockPrisma.qaReviewQueue.findMany.mockResolvedValue(
        new Array(5).fill({ created_at: new Date() }),
      );
      mockPrisma.qaReviewQueue.count.mockResolvedValue(5);
      mockPrisma.qaReviewQueue.findFirst.mockResolvedValue({ created_at: new Date() });
      mockPrisma.qaReviewQueue.groupBy.mockResolvedValue([{ reviewed_by: 'u1' }]);

      const result = await service.getSummary('30d');

      expect(result.summary.total_reviews_pending).toBe(5);
      expect(mockCacheManager.set).toHaveBeenCalled();
    });
  });

  describe('checkWorkloadAlerts', () => {
    it('should trigger alert if queue depth is high', async () => {
      mockPrisma.qaReviewQueue.count.mockResolvedValue(35);

      await service.checkWorkloadAlerts();

      expect(mockDashboardGateway.server.emit).toHaveBeenCalledWith(
        'qa-workload-alert',
        expect.objectContaining({
          type: 'QUEUE_DEPTH_HIGH',
          severity: 'warning',
        }),
      );
    });

    it('should trigger critical alert if queue depth is very high', async () => {
      mockPrisma.qaReviewQueue.count.mockResolvedValue(55);

      await service.checkWorkloadAlerts();

      expect(mockDashboardGateway.server.emit).toHaveBeenCalledWith(
        'qa-workload-alert',
        expect.objectContaining({
          type: 'QUEUE_DEPTH_CRITICAL',
          severity: 'critical',
        }),
      );
    });
  });
});
