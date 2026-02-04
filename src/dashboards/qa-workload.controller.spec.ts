import { Test, TestingModule } from '@nestjs/testing';
import { QaWorkloadController } from './qa-workload.controller';
import { QaWorkloadService } from './services/qa-workload.service';
import { RolesGuard } from '../common/guards/roles.guard';
import { JwtAuthGuard } from '../common/guards/auth.guard';
import { ThrottlerGuard } from '@nestjs/throttler';

describe('QaWorkloadController', () => {
  let controller: QaWorkloadController;
  let service: QaWorkloadService;

  const mockQaWorkloadService = {
    getSummary: jest.fn(),
    getReviewerPerformance: jest.fn(),
    getQueueFlow: jest.fn(),
    exportWorkloadReport: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QaWorkloadController],
      providers: [{ provide: QaWorkloadService, useValue: mockQaWorkloadService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<QaWorkloadController>(QaWorkloadController);
    service = module.get<QaWorkloadService>(QaWorkloadService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getSummary', () => {
    it('should return summary from service', async () => {
      const summary = { period: '30d' };
      mockQaWorkloadService.getSummary.mockResolvedValue(summary);

      const result = await controller.getSummary({ period: '30d' });
      expect(result).toEqual(summary);
      expect(service.getSummary).toHaveBeenCalledWith('30d');
    });
  });

  describe('getReviewerPerformance', () => {
    it('should return service result', async () => {
      const performance = { period: '30d', reviewers: [] };
      mockQaWorkloadService.getReviewerPerformance.mockResolvedValue(performance);

      const result = await controller.getReviewerPerformance({ period: '30d' });
      expect(result).toEqual(performance);
      expect(service.getReviewerPerformance).toHaveBeenCalledWith({ period: '30d' });
    });
  });
});
