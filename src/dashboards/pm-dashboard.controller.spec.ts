import { Test, TestingModule } from '@nestjs/testing';
import { PmDashboardController } from './pm-dashboard.controller';
import { PmDashboardService, UserRole } from './services/pm-dashboard.service';
import { ProjectQueryDto } from './dto/pm-dashboard.dto';
import { MetricsService } from '@/common/metrics/metrics.service';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';

describe('PmDashboardController', () => {
  let controller: PmDashboardController;

  const mockPmDashboardService = {
    getProjects: jest.fn(),
    getSummary: jest.fn(),
    getFinancialSummary: jest.fn(),
  };

  const mockMetricsService = {
    incrementCounter: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PmDashboardController],
      providers: [
        {
          provide: PmDashboardService,
          useValue: mockPmDashboardService,
        },
        {
          provide: MetricsService,
          useValue: mockMetricsService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PmDashboardController>(PmDashboardController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getProjects', () => {
    it('should call service.getProjects with user sub and role', async () => {
      const mockReq = { user: { sub: 'pm-123', role: 'PM' as UserRole } };
      const mockQuery = { page: 1, limit: 10 } as ProjectQueryDto;

      await controller.getProjects(mockReq, mockQuery);

      expect(mockPmDashboardService.getProjects).toHaveBeenCalledWith('pm-123', 'PM', mockQuery);
    });

    it('should return projects for PM', async () => {
      const req = { user: { sub: 'pm-123', role: 'PM' as UserRole } };
      mockPmDashboardService.getProjects.mockResolvedValue({ data: [], pagination: {} });

      const result = await controller.getProjects(req, {} as ProjectQueryDto);
      expect(result).toBeDefined();
    });
  });

  describe('getSummary', () => {
    it('should call service.getSummary with user sub and role', async () => {
      const mockReq = { user: { sub: 'pm-123', role: 'PM' as UserRole } };

      await controller.getSummary(mockReq);

      expect(mockPmDashboardService.getSummary).toHaveBeenCalledWith('pm-123', 'PM');
    });

    it('should return summary for PM', async () => {
      const req = { user: { sub: 'pm-123', role: 'PM' as UserRole } };
      mockPmDashboardService.getSummary.mockResolvedValue({});

      const result = await controller.getSummary(req);
      expect(result).toBeDefined();
    });
  });

  describe('getFinancialSummary', () => {
    it('should call service.getFinancialSummary with user sub and role', async () => {
      const mockReq = { user: { sub: 'manager-123', role: 'MANAGER' as UserRole } };

      await controller.getFinancialSummary(mockReq);

      expect(mockPmDashboardService.getFinancialSummary).toHaveBeenCalledWith(
        'manager-123',
        'MANAGER',
      );
    });

    it('should return financial summary payload', async () => {
      const req = { user: { sub: 'admin-123', role: 'ADMIN' as UserRole } };
      const payload = {
        cost_per_ticket: 42.5,
        daily_budget_burn: Array(14).fill(0),
        budget_ceiling: 12000,
        budget_forecast: 8400,
      };
      mockPmDashboardService.getFinancialSummary.mockResolvedValue(payload);

      const result = await controller.getFinancialSummary(req);
      expect(result).toEqual(payload);
    });
  });
});
