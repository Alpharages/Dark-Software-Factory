import { Test, TestingModule } from '@nestjs/testing';
import { DeploymentSuccessRateCalculator } from './deployment-success-rate-calculator.service';
import { PrismaService } from '../../database/prisma.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { LoggerService } from '../../common/logger';
import { DeploymentStatus } from '@prisma/client';

describe('DeploymentSuccessRateCalculator', () => {
  let service: DeploymentSuccessRateCalculator;
  let prisma: PrismaService;
  let metrics: MetricsService;
  let logger: LoggerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeploymentSuccessRateCalculator,
        {
          provide: PrismaService,
          useValue: {
            deployment: {
              findMany: jest.fn(),
            },
          },
        },
        {
          provide: MetricsService,
          useValue: {
            setGauge: jest.fn(),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            warn: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DeploymentSuccessRateCalculator>(DeploymentSuccessRateCalculator);
    prisma = module.get<PrismaService>(PrismaService);
    metrics = module.get<MetricsService>(MetricsService);
    logger = module.get<LoggerService>(LoggerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('update', () => {
    it('should update rates for all time windows (1h, 24h, 7d)', async () => {
      (prisma.deployment.findMany as jest.Mock).mockResolvedValue([
        { status: DeploymentStatus.COMPLETED },
        { status: DeploymentStatus.FAILED },
      ]);

      await service.update('production', DeploymentStatus.COMPLETED);

      expect(prisma.deployment.findMany).toHaveBeenCalledTimes(3);
      expect(metrics.setGauge).toHaveBeenCalledTimes(3);

      // Verify time windows
      expect(metrics.setGauge).toHaveBeenCalledWith('deployment_success_rate', expect.any(Number), {
        environment: 'production',
        time_window: '1h',
      });
      expect(metrics.setGauge).toHaveBeenCalledWith('deployment_success_rate', expect.any(Number), {
        environment: 'production',
        time_window: '24h',
      });
      expect(metrics.setGauge).toHaveBeenCalledWith('deployment_success_rate', expect.any(Number), {
        environment: 'production',
        time_window: '7d',
      });
    });

    it('should calculate success rate correctly', async () => {
      // 1 COMPLETED, 1 FAILED = 50%
      (prisma.deployment.findMany as jest.Mock).mockResolvedValue([
        { status: DeploymentStatus.COMPLETED },
        { status: DeploymentStatus.FAILED },
      ]);

      await service.update('production', DeploymentStatus.COMPLETED);

      expect(metrics.setGauge).toHaveBeenCalledWith(
        'deployment_success_rate',
        50,
        expect.objectContaining({ environment: 'production' }),
      );
    });

    it('should handle zero deployments (optimistic 100%)', async () => {
      (prisma.deployment.findMany as jest.Mock).mockResolvedValue([]);

      await service.update('staging', DeploymentStatus.COMPLETED);

      expect(metrics.setGauge).toHaveBeenCalledWith(
        'deployment_success_rate',
        100,
        expect.objectContaining({ environment: 'staging' }),
      );
    });

    it('should log warning if query limit hit', async () => {
      const mockDeployments = Array(1000).fill({ status: DeploymentStatus.COMPLETED });
      (prisma.deployment.findMany as jest.Mock).mockResolvedValue(mockDeployments);

      await service.update('production', DeploymentStatus.COMPLETED);

      expect(logger.warn).toHaveBeenCalledWith(
        'Hit deployment query limit for success rate calculation',
        expect.any(Object),
      );
    });
  });
});
