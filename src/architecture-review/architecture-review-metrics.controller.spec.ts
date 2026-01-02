import { Test, TestingModule } from '@nestjs/testing';
import { ArchitectureReviewMetricsController } from './architecture-review-metrics.controller';
import { AdrMetricsService } from './metrics/adr-metrics.service';
import { AdrInsightsService } from './metrics/adr-insights.service';

describe('ArchitectureReviewMetricsController', () => {
  let controller: ArchitectureReviewMetricsController;
  let metricsService: AdrMetricsService;
  let insightsService: AdrInsightsService;

  const mockMetricsService = {
    getReviewMetrics: jest.fn().mockResolvedValue({
      review_volume: [],
      approval_rate: 85,
      risk_distribution: {},
      top_rejection_reasons: {},
      queue_metrics: { current_depth: 5, average_wait_time_minutes: 30 },
    }),
    getTrendAnalysis: jest.fn().mockResolvedValue({
      approval_trend: [],
      review_time_trend: [],
      learning_insights: [],
    }),
  };

  const mockInsightsService = {
    generateInsights: jest.fn().mockResolvedValue({
      patterns: ['Insight 1'],
      capacity_forecast: {},
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ArchitectureReviewMetricsController],
      providers: [
        { provide: AdrMetricsService, useValue: mockMetricsService },
        { provide: AdrInsightsService, useValue: mockInsightsService },
      ],
    }).compile();

    controller = module.get<ArchitectureReviewMetricsController>(
      ArchitectureReviewMetricsController,
    );
    metricsService = module.get<AdrMetricsService>(AdrMetricsService);
    insightsService = module.get<AdrInsightsService>(AdrInsightsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getMetrics', () => {
    it('should return metrics', async () => {
      const result = await controller.getMetrics('proj1');
      expect(result.approval_rate).toBe(85);
      expect(metricsService.getReviewMetrics).toHaveBeenCalledWith('proj1');
    });
  });

  describe('getTrends', () => {
    it('should return trends enriched with insights', async () => {
      const result = await controller.getTrends('proj1');
      expect(result.learning_insights).toContain('Insight 1');
      expect(metricsService.getTrendAnalysis).toHaveBeenCalledWith('proj1');
      expect(insightsService.generateInsights).toHaveBeenCalledWith('proj1');
    });
  });
});
