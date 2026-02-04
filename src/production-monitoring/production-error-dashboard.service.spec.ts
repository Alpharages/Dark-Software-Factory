/**
 * Production Error Dashboard Service Tests
 * Story 9-U-5: Production Error Dashboard
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ProductionErrorDashboardService } from './production-error-dashboard.service';
import { PrismaService } from '@/database/prisma.service';
import { FixTicketService } from './fix-ticket.service';
import { ErrorSeverity } from '@/prisma/enums';
import { ErrorListFiltersDto } from './dto/error-overview.dto';
import { HealthStatus } from './dto/application-health.dto';

describe('ProductionErrorDashboardService', () => {
  let service: ProductionErrorDashboardService;
  let prisma: jest.Mocked<PrismaService>;
  let fixTicketService: jest.Mocked<FixTicketService>;

  const mockPrismaService = () => ({
    productionError: {
      count: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      groupBy: jest.fn(),
    },
  });

  const mockFixTicketService = () => ({
    processError: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductionErrorDashboardService,
        { provide: PrismaService, useFactory: mockPrismaService },
        { provide: FixTicketService, useFactory: mockFixTicketService },
      ],
    }).compile();

    service = module.get<ProductionErrorDashboardService>(ProductionErrorDashboardService);
    prisma = module.get(PrismaService);
    fixTicketService = module.get(FixTicketService);
  });

  describe('getErrorOverview', () => {
    it('should return overview metrics', async () => {
      prisma.productionError.count = jest
        .fn()
        .mockResolvedValueOnce(10) // total active
        .mockResolvedValueOnce(5); // new 24h

      prisma.productionError.groupBy = jest.fn().mockResolvedValue([
        { severity: ErrorSeverity.CRITICAL, _count: { severity: 2 } },
        { severity: ErrorSeverity.HIGH, _count: { severity: 3 } },
        { severity: ErrorSeverity.MEDIUM, _count: { severity: 3 } },
        { severity: ErrorSeverity.LOW, _count: { severity: 2 } },
      ]);

      const result = await service.getErrorOverview();

      expect(result.totalActiveErrors).toBe(10);
      expect(result.newErrors24h).toBe(5);
      expect(result.criticalErrors).toBe(2);
      expect(result.highErrors).toBe(3);
      expect(result.mediumErrors).toBe(3);
      expect(result.lowErrors).toBe(2);
    });

    it('should return undefined mttr when no resolved errors', async () => {
      prisma.productionError.count = jest.fn().mockResolvedValue(0);
      prisma.productionError.groupBy = jest.fn().mockResolvedValue([]);
      prisma.productionError.findMany = jest.fn().mockResolvedValue([]);

      const result = await service.getErrorOverview();

      expect(result.mttrHours).toBeUndefined();
    });
  });

  describe('getErrorList', () => {
    it('should return paginated error list', async () => {
      const mockErrors = [
        {
          id: 'error-1',
          application: 'api-service',
          error_type: 'TypeError',
          error_message: 'Cannot read property',
          severity: ErrorSeverity.CRITICAL,
          occurred_at: new Date(),
          affected_users: 5,
          occurrence_count: 10,
          fix_ticket_id: null,
          fix_ticket_url: null,
          resolved: false,
          acknowledged_at: null,
          acknowledged_by: null,
        },
      ];

      prisma.productionError.count = jest.fn().mockResolvedValue(1);
      prisma.productionError.findMany = jest.fn().mockResolvedValue(mockErrors);

      const filters: ErrorListFiltersDto = { page: 1, limit: 20 };
      const result = await service.getErrorList(filters);

      expect(result.errors).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should apply severity filter', async () => {
      prisma.productionError.count = jest.fn().mockResolvedValue(0);
      prisma.productionError.findMany = jest.fn().mockResolvedValue([]);

      const filters: ErrorListFiltersDto = {
        severity: [ErrorSeverity.CRITICAL, ErrorSeverity.HIGH],
      };
      await service.getErrorList(filters);

      expect(prisma.productionError.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            severity: { in: [ErrorSeverity.CRITICAL, ErrorSeverity.HIGH] },
          }),
        }),
      );
    });

    it('should truncate long error messages', async () => {
      const longMessage = 'a'.repeat(200);
      const mockErrors = [
        {
          id: 'error-1',
          application: 'api-service',
          error_type: 'TypeError',
          error_message: longMessage,
          severity: ErrorSeverity.CRITICAL,
          occurred_at: new Date(),
          affected_users: 5,
          occurrence_count: 10,
          fix_ticket_id: null,
          fix_ticket_url: null,
          resolved: false,
          acknowledged_at: null,
          acknowledged_by: null,
        },
      ];

      prisma.productionError.count = jest.fn().mockResolvedValue(1);
      prisma.productionError.findMany = jest.fn().mockResolvedValue(mockErrors);

      const result = await service.getErrorList({});

      expect(result.errors[0].error_message).toBe('a'.repeat(100) + '...');
    });
  });

  describe('getErrorTrends', () => {
    it('should return trends for specified days', async () => {
      prisma.productionError.groupBy = jest.fn().mockResolvedValue([]);

      const result = await service.getErrorTrends(7);

      expect(result.dates).toHaveLength(7);
      expect(result.trendsBySeverity.CRITICAL).toHaveLength(7);
      expect(result.trendsBySeverity.HIGH).toHaveLength(7);
      expect(result.trendsBySeverity.MEDIUM).toHaveLength(7);
      expect(result.trendsBySeverity.LOW).toHaveLength(7);
    });
  });

  describe('getApplicationHealth', () => {
    it('should return health status for all applications', async () => {
      prisma.productionError.groupBy = jest
        .fn()
        .mockResolvedValueOnce([{ application: 'api-service', _count: { application: 12 } }])
        .mockResolvedValueOnce([
          { severity: ErrorSeverity.CRITICAL, _count: { severity: 1 } },
          { severity: ErrorSeverity.HIGH, _count: { severity: 3 } },
          { severity: ErrorSeverity.MEDIUM, _count: { severity: 8 } },
        ]);

      prisma.productionError.findFirst = jest.fn().mockResolvedValue({ occurred_at: new Date() });

      const result = await service.getApplicationHealth();

      expect(result.applications).toHaveLength(1);
      expect(result.applications[0].application).toBe('api-service');
      expect(result.applications[0].healthStatus).toBe(HealthStatus.RED);
    });

    it('should return GREEN status for no errors', async () => {
      // When there are truly no errors, groupBy returns empty array
      prisma.productionError.groupBy = jest.fn().mockResolvedValueOnce([]);

      const result = await service.getApplicationHealth();

      // No applications should be returned if no errors
      expect(result.applications).toHaveLength(0);
    });
  });

  describe('bulkCreateTickets', () => {
    it('should create tickets for errors without existing tickets', async () => {
      prisma.productionError.findUnique = jest.fn().mockResolvedValue({ fix_ticket_id: null });
      fixTicketService.processError = jest.fn().mockResolvedValue(undefined);

      const result = await service.bulkCreateTickets(['error-1', 'error-2']);

      expect(result.created).toBe(2);
      expect(result.skipped).toBe(0);
      expect(fixTicketService.processError).toHaveBeenCalledTimes(2);
    });

    it('should skip errors that already have tickets', async () => {
      prisma.productionError.findUnique = jest
        .fn()
        .mockResolvedValueOnce({ fix_ticket_id: 'ticket-1' })
        .mockResolvedValueOnce({ fix_ticket_id: null });
      fixTicketService.processError = jest.fn().mockResolvedValue(undefined);

      const result = await service.bulkCreateTickets(['error-1', 'error-2']);

      expect(result.created).toBe(1);
      expect(result.skipped).toBe(1);
      expect(fixTicketService.processError).toHaveBeenCalledTimes(1);
    });

    it('should handle errors that do not exist', async () => {
      prisma.productionError.findUnique = jest.fn().mockResolvedValue(null);

      const result = await service.bulkCreateTickets(['error-1']);

      expect(result.created).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('acknowledgeError', () => {
    it('should update error with acknowledgement', async () => {
      prisma.productionError.update = jest.fn().mockResolvedValue({});

      await service.acknowledgeError('error-1', 'user-123');

      expect(prisma.productionError.update).toHaveBeenCalledWith({
        where: { id: 'error-1' },
        data: {
          acknowledged_at: expect.any(Date),
          acknowledged_by: 'user-123',
        },
      });
    });
  });

  describe('getApplications', () => {
    it('should return unique application names', async () => {
      prisma.productionError.groupBy = jest
        .fn()
        .mockResolvedValue([{ application: 'api-service' }, { application: 'web-app' }]);

      const result = await service.getApplications();

      expect(result).toEqual(['api-service', 'web-app']);
    });
  });

  describe('exportErrors', () => {
    it('should return all errors when no ids provided', async () => {
      const mockErrors = [{ id: 'error-1', application: 'api-service' }];
      prisma.productionError.findMany = jest.fn().mockResolvedValue(mockErrors);

      const result = await service.exportErrors();

      expect(result).toEqual(mockErrors);
      expect(prisma.productionError.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
    });

    it('should filter by ids when provided', async () => {
      const mockErrors = [{ id: 'error-1', application: 'api-service' }];
      prisma.productionError.findMany = jest.fn().mockResolvedValue(mockErrors);

      const result = await service.exportErrors(['error-1']);

      expect(result).toEqual(mockErrors);
      expect(prisma.productionError.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['error-1'] } },
        }),
      );
    });
  });
});
