import { Test, TestingModule } from '@nestjs/testing';
import { AnomalyDetectionController } from './anomaly-detection.controller';
import { AnomalyDetectionService } from './services/anomaly-detection.service';
import { AnomalyStatus } from './dto/anomaly-detection.dto';
import { JwtAuthGuard } from '../common/guards/auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { ThrottlerGuard } from '@nestjs/throttler';

describe('AnomalyDetectionController', () => {
  let controller: AnomalyDetectionController;
  let service: AnomalyDetectionService;

  const mockService = {
    detectAnomalies: jest.fn(),
    resolveAnomaly: jest.fn(),
    runScheduledAnalysis: jest.fn(),
    getAnomalyConfig: jest.fn(),
    updateAnomalyConfig: jest.fn(),
  };

  const mockGuard = { canActivate: jest.fn(() => true) };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnomalyDetectionController],
      providers: [{ provide: AnomalyDetectionService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(RolesGuard)
      .useValue(mockGuard)
      .overrideGuard(ThrottlerGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<AnomalyDetectionController>(AnomalyDetectionController);
    service = module.get<AnomalyDetectionService>(AnomalyDetectionService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAnomalies', () => {
    it('should call service.detectAnomalies', async () => {
      await controller.getAnomalies({});
      expect(service.detectAnomalies).toHaveBeenCalled();
    });
  });

  describe('resolveAnomaly', () => {
    it('should call service.resolveAnomaly with user ID', async () => {
      const dto = { status: AnomalyStatus.RESOLVED, notes: 'fixed' };

      const req = { user: { id: 'user-1' } } as any;
      await controller.resolveAnomaly('1', dto, req);
      expect(service.resolveAnomaly).toHaveBeenCalledWith('1', dto, 'user-1');
    });
  });

  describe('config', () => {
    it('should get config', async () => {
      await controller.getConfig('p1');
      expect(service.getAnomalyConfig).toHaveBeenCalledWith('p1');
    });

    it('should update config', async () => {
      const dto = {
        project_id: 'p1',
        thresholds: {} as Record<string, unknown>,
        notifications_enabled: true,
      };

      const req = { user: { id: 'user-1' } } as any;
      await controller.updateConfig(dto, req);
      expect(service.updateAnomalyConfig).toHaveBeenCalledWith(dto, 'user-1');
    });
  });
});
