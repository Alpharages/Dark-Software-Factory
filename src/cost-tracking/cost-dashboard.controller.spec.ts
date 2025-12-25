import { Test, TestingModule } from '@nestjs/testing';
import { CostDashboardController } from './cost-dashboard.controller';
import { CostDashboardService } from './cost-dashboard.service';
import { LoggerService } from '@/common/logger/logger.service';
import { HttpStatus, HttpException } from '@nestjs/common';
import { BreakdownQueryDto, CostSummaryDto, TicketCostDto, BreakdownDto } from './dto';

import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { ThrottlerGuard } from '@nestjs/throttler';

describe('CostDashboardController', () => {
  let controller: CostDashboardController;
  let service: CostDashboardService;

  const mockCostDashboardService = {
    getCostSummary: jest.fn(),
    getTicketCost: jest.fn(),
    getCostBreakdown: jest.fn(),
  };

  const mockLoggerService = {
    debug: jest.fn(),
    error: jest.fn(),
  };

  const mockGuard = { canActivate: jest.fn(() => true) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CostDashboardController],
      providers: [
        { provide: CostDashboardService, useValue: mockCostDashboardService },
        { provide: LoggerService, useValue: mockLoggerService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(ThrottlerGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<CostDashboardController>(CostDashboardController);
    service = module.get<CostDashboardService>(CostDashboardService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getSummary', () => {
    it('should return cost summary for valid period', async () => {
      const mockResult = { period: 'day', totalCostUsd: '10.0' } as unknown as CostSummaryDto;
      (service.getCostSummary as jest.Mock).mockResolvedValue(mockResult);

      const result = await controller.getSummary('day', 'test-id');

      expect(result).toBe(mockResult);
      expect(service.getCostSummary).toHaveBeenCalledWith('day', 'test-id');
    });

    it('should throw HttpException for invalid period', async () => {
      await expect(controller.getSummary('invalid')).rejects.toThrow(HttpException);
      try {
        await controller.getSummary('invalid');
      } catch (e: unknown) {
        expect((e as HttpException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      }
    });
  });

  describe('getTicketCost', () => {
    it('should call service for ticket cost', async () => {
      const mockResult = { ticketId: 'DSF-123', totalCostUsd: '5.0' } as unknown as TicketCostDto;
      (service.getTicketCost as jest.Mock).mockResolvedValue(mockResult);

      const result = await controller.getTicketCost('DSF-123', 'test-id');

      expect(result).toBe(mockResult);
      expect(service.getTicketCost).toHaveBeenCalledWith('DSF-123', 'test-id');
    });
  });

  describe('getBreakdown', () => {
    it('should return breakdown for valid query', async () => {
      const query: BreakdownQueryDto = {
        groupBy: 'model',
        page: 1,
        limit: 10,
        startDate: '2025-12-01T00:00:00Z',
      };
      const mockResult = { groupBy: 'model', data: [] } as unknown as BreakdownDto;
      (service.getCostBreakdown as jest.Mock).mockResolvedValue(mockResult);

      const result = await controller.getBreakdown(query, 'test-id');

      expect(result).toBe(mockResult);
      expect(service.getCostBreakdown).toHaveBeenCalledWith(
        expect.objectContaining({ groupBy: 'model' }),
        'test-id',
      );
    });

    it('should throw error for invalid startDate format', async () => {
      const query = { groupBy: 'model', startDate: 'invalid-date' } as unknown as BreakdownQueryDto;

      await expect(controller.getBreakdown(query)).rejects.toThrow(HttpException);
    });

    it('should handle service errors with INTERNAL_SERVER_ERROR', async () => {
      const query: BreakdownQueryDto = { groupBy: 'model' };
      (service.getCostBreakdown as jest.Mock).mockRejectedValue(new Error('Unexpected error'));

      await expect(controller.getBreakdown(query)).rejects.toThrow(HttpException);
      try {
        await controller.getBreakdown(query);
      } catch (e: unknown) {
        expect((e as HttpException).getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      }
    });
  });
});
