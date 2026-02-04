/* eslint-disable @typescript-eslint/no-explicit-any*/
/**
 * Production Error Dashboard Controller Tests
 * Story 9-U-5: Production Error Dashboard
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ProductionErrorDashboardController } from './production-error-dashboard.controller';
import { ProductionErrorDashboardService } from './production-error-dashboard.service';
import { ProductionErrorDashboardMetrics } from './production-error-dashboard.metrics';
import { PrismaService } from '@/database/prisma.service';
import { ErrorSeverity } from '@/prisma/enums';
import { ErrorListFiltersDto } from './dto/error-overview.dto';

describe('ProductionErrorDashboardController', () => {
  let controller: ProductionErrorDashboardController;
  let service: jest.Mocked<ProductionErrorDashboardService>;
  let metrics: jest.Mocked<ProductionErrorDashboardMetrics>;
  let prisma: jest.Mocked<PrismaService>;

  const mockOverview = {
    totalActiveErrors: 10,
    newErrors24h: 5,
    criticalErrors: 2,
    highErrors: 3,
    mediumErrors: 3,
    lowErrors: 2,
    mttrHours: 24.5,
  };

  const mockErrorList = {
    errors: [
      {
        id: 'error-1',
        application: 'api-service',
        error_type: 'TypeError',
        error_message: 'Cannot read property...',
        severity: ErrorSeverity.CRITICAL,
        occurred_at: new Date(),
        affected_users: 5,
        occurrence_count: 10,
        resolved: false,
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
  };

  const mockTrends = {
    dates: ['2026-02-01', '2026-02-02'],
    trendsBySeverity: {
      CRITICAL: [1, 2],
      HIGH: [3, 4],
      MEDIUM: [5, 6],
      LOW: [7, 8],
    },
  };

  const mockHealth = {
    applications: [
      {
        application: 'api-service',
        errorCount24h: 12,
        criticalCount: 1,
        highCount: 3,
        mediumCount: 8,
        lowCount: 0,
        healthStatus: 'RED',
        lastErrorAt: new Date(),
      },
    ],
  };

  beforeEach(async () => {
    const mockService = {
      getErrorOverview: jest.fn().mockResolvedValue(mockOverview),
      getErrorList: jest.fn().mockResolvedValue(mockErrorList),
      getErrorTrends: jest.fn().mockResolvedValue(mockTrends),
      getApplicationHealth: jest.fn().mockResolvedValue(mockHealth),
      getApplications: jest.fn().mockResolvedValue(['api-service', 'web-app']),
      bulkCreateTickets: jest.fn().mockResolvedValue({ created: 2, skipped: 0, errors: [] }),
      acknowledgeError: jest.fn().mockResolvedValue(undefined),
      exportErrors: jest.fn().mockResolvedValue([]),
    };

    const mockMetrics = {
      incrementDashboardViews: jest.fn(),
      incrementDetailView: jest.fn(),
      incrementTicketsCreated: jest.fn(),
      incrementFilterUsage: jest.fn(),
    };

    const mockPrisma = {
      productionError: {
        findUnique: jest.fn().mockResolvedValue({ severity: ErrorSeverity.CRITICAL }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductionErrorDashboardController],
      providers: [
        { provide: ProductionErrorDashboardService, useValue: mockService },
        { provide: ProductionErrorDashboardMetrics, useValue: mockMetrics },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    controller = module.get<ProductionErrorDashboardController>(ProductionErrorDashboardController);
    service = module.get(ProductionErrorDashboardService);
    metrics = module.get(ProductionErrorDashboardMetrics);
    prisma = module.get(PrismaService);
  });

  describe('getErrorOverview', () => {
    it('should return error overview metrics', async () => {
      const result = await controller.getErrorOverview();

      expect(result).toEqual(mockOverview);
      expect(service.getErrorOverview).toHaveBeenCalled();
      expect(metrics.incrementDashboardViews).toHaveBeenCalled();
    });
  });

  describe('getErrorList', () => {
    it('should return filtered error list', async () => {
      const filters: ErrorListFiltersDto = {
        severity: [ErrorSeverity.CRITICAL],
        page: 1,
        limit: 20,
      };

      const result = await controller.getErrorList(filters);

      expect(result).toEqual(mockErrorList);
      expect(service.getErrorList).toHaveBeenCalledWith(filters);
      expect(metrics.incrementFilterUsage).toHaveBeenCalledWith('default');
    });

    it('should handle empty filters', async () => {
      const filters: ErrorListFiltersDto = {};

      const result = await controller.getErrorList(filters);

      expect(result).toEqual(mockErrorList);
      expect(service.getErrorList).toHaveBeenCalledWith(filters);
    });
  });

  describe('getErrorTrends', () => {
    it('should return error trends with default days', async () => {
      const result = await controller.getErrorTrends({});

      expect(result).toEqual(mockTrends);
      expect(service.getErrorTrends).toHaveBeenCalledWith(7);
    });

    it('should return error trends with custom days', async () => {
      const result = await controller.getErrorTrends({ days: 14 });

      expect(result).toEqual(mockTrends);
      expect(service.getErrorTrends).toHaveBeenCalledWith(14);
    });
  });

  describe('getApplicationHealth', () => {
    it('should return application health data', async () => {
      const result = await controller.getApplicationHealth();

      expect(result).toEqual(mockHealth);
      expect(service.getApplicationHealth).toHaveBeenCalled();
    });
  });

  describe('getApplications', () => {
    it('should return list of applications', async () => {
      const result = await controller.getApplications();

      expect(result).toEqual(['api-service', 'web-app']);
      expect(service.getApplications).toHaveBeenCalled();
    });
  });

  describe('bulkCreateTickets', () => {
    it('should create tickets for selected errors', async () => {
      const dto = { errorIds: ['error-1', 'error-2'] };

      const result = await controller.bulkCreateTickets(dto);

      expect(result).toEqual({ created: 2, skipped: 0, errors: [] });
      expect(service.bulkCreateTickets).toHaveBeenCalledWith(dto.errorIds);
      expect(metrics.incrementTicketsCreated).toHaveBeenCalledWith(true);
    });
  });

  describe('acknowledgeError', () => {
    it('should acknowledge error', async () => {
      const errorId = 'error-1';
      const dto = { acknowledgedBy: 'user-123' };

      await controller.acknowledgeError(errorId, dto);

      expect(service.acknowledgeError).toHaveBeenCalledWith(errorId, 'user-123');
    });
  });

  describe('exportErrors', () => {
    it('should export errors to CSV', async () => {
      const mockResponse = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as any;

      const query = { ids: ['error-1', 'error-2'] };

      await controller.exportErrors(query, mockResponse);

      expect(service.exportErrors).toHaveBeenCalledWith(query.ids);
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename=production-errors.csv',
      );
    });
  });

  describe('trackErrorView', () => {
    it('should track error detail view', async () => {
      const errorId = 'error-1';

      await controller.trackErrorView(errorId);

      expect(prisma.productionError.findUnique).toHaveBeenCalledWith({
        where: { id: errorId },
        select: { severity: true },
      });
      expect(metrics.incrementDetailView).toHaveBeenCalledWith(ErrorSeverity.CRITICAL);
    });
  });
});
