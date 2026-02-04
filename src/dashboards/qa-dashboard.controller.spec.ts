import { Test, TestingModule } from '@nestjs/testing';
import { Response } from 'express';
import { QaDashboardController } from './qa-dashboard.controller';
import { QualityDashboardService } from './services/quality-dashboard.service';
import {
  QualityDashboardSummaryDto,
  QualityMetricsQueryDto,
  QualityMetricsResponseDto,
  ProviderComparisonResponseDto,
  QualityDrillDownDto,
  ExportQueryDto,
} from './dto/quality-dashboard.dto';

describe('QaDashboardController', () => {
  let controller: QaDashboardController;
  let service: QualityDashboardService;

  const mockQualityDashboardService = {
    getSummary: jest.fn(),
    getMetrics: jest.fn(),
    getProviderComparison: jest.fn(),
    getDrillDown: jest.fn(),
    generateExport: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [QaDashboardController],
      providers: [
        {
          provide: QualityDashboardService,
          useValue: mockQualityDashboardService,
        },
      ],
    }).compile();

    controller = module.get<QaDashboardController>(QaDashboardController);
    service = module.get<QualityDashboardService>(QualityDashboardService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getSummary', () => {
    it('should return quality dashboard summary (AC#1)', async () => {
      const mockSummary: Partial<QualityDashboardSummaryDto> = {
        period: '30d',
        summary: {
          total_tickets_processed: 100,
          tickets_passed_qa: 85,
          tickets_failed_qa: 15,
          overall_pass_rate_percent: 85.0,
          bug_escapes: {
            total: 3,
            rate_percent: 3.5,
            target_percent: 5.0,
            status: 'within_target',
          },
          avg_test_coverage_percent: 78.5,
          avg_test_pass_rate_percent: 92.0,
          pending_reviews: 5,
          deployment_success_rate_percent: 95.0,
        },
        quality_gates_summary: {
          projects_configured: 3,
          projects_using_defaults: 1,
          average_coverage_threshold: 80,
        },
        alerts: [],
      };

      mockQualityDashboardService.getSummary.mockResolvedValue(mockSummary);

      const result = await controller.getSummary();

      expect(result).toEqual(mockSummary);
      expect(service.getSummary).toHaveBeenCalledTimes(1);
    });

    it('should handle errors gracefully', async () => {
      mockQualityDashboardService.getSummary.mockRejectedValue(new Error('Database error'));

      await expect(controller.getSummary()).rejects.toThrow('Database error');
    });
  });

  describe('getMetrics', () => {
    it('should return filtered metrics (AC#2)', async () => {
      const query: QualityMetricsQueryDto = {
        period: '30d',
        group_by: 'project',
        page: 1,
        limit: 20,
      };

      const mockResponse: Partial<QualityMetricsResponseDto> = {
        period: '30d',
        group_by: 'project',
        items: [
          {
            dimension_id: 'proj-1',
            dimension_name: 'Project Alpha',
            pm_name: 'Lead PM',
            metrics: {
              tickets_processed: 50,
              qa_pass_rate_percent: 90.0,
              avg_coverage_percent: 80.0,
              bug_escapes: 1,
              bug_escape_rate_percent: 2.0,
              deployment_success_rate_percent: 95.0,
            },
            trend: 'improving',
            last_updated: new Date(),
          },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          total_pages: 1,
        },
      };

      mockQualityDashboardService.getMetrics.mockResolvedValue(mockResponse);

      const result = await controller.getMetrics(query);

      expect(result).toEqual(mockResponse);
      expect(service.getMetrics).toHaveBeenCalledWith(query);
    });

    it('should support filtering by AI provider (AC#2)', async () => {
      const query: QualityMetricsQueryDto = {
        period: '30d',
        ai_provider: 'CLAUDE',
        page: 1,
        limit: 20,
      };

      mockQualityDashboardService.getMetrics.mockResolvedValue({
        period: '30d',
        items: [],
        pagination: { page: 1, limit: 20, total: 0, total_pages: 0 },
      });

      await controller.getMetrics(query);

      expect(service.getMetrics).toHaveBeenCalledWith(
        expect.objectContaining({ ai_provider: 'CLAUDE' }),
      );
    });
  });

  describe('getProviderComparison', () => {
    it('should return AI provider comparison (AC#3)', async () => {
      const mockComparison: Partial<ProviderComparisonResponseDto> = {
        period: '30d',
        comparison: [
          {
            provider: 'CLAUDE',
            tickets_processed: 50,
            qa_pass_rate_percent: 88.0,
            avg_coverage_percent: 82.0,
            avg_complexity_score: 5.2,
            bug_escapes: 2,
            bug_escape_rate_percent: 4.0,
            deployment_success_rate_percent: 95.0,
            common_escape_categories: [],
            trend: 'stable',
          },
          {
            provider: 'OPENAI',
            tickets_processed: 40,
            qa_pass_rate_percent: 82.5,
            avg_coverage_percent: 75.0,
            avg_complexity_score: 4.8,
            bug_escapes: 3,
            bug_escape_rate_percent: 7.5,
            deployment_success_rate_percent: 92.0,
            common_escape_categories: [],
            trend: 'stable',
          },
        ],
        analysis: {
          better_provider: 'CLAUDE',
          key_differences: ['Lower escape rate', 'Higher coverage'],
        },
      };

      mockQualityDashboardService.getProviderComparison.mockResolvedValue(mockComparison);

      const result = await controller.getProviderComparison('30d');

      expect(result).toEqual(mockComparison);
      expect(service.getProviderComparison).toHaveBeenCalledWith('30d');
    });
  });

  describe('getDrillDown', () => {
    it('should return drill-down data for dimension (AC#5)', async () => {
      const mockDrillDown: Partial<QualityDrillDownDto> = {
        dimension: {
          type: 'project',
          id: 'proj-1',
          name: 'Project Alpha',
        },
        period: '30d',
        overview: {
          tickets_processed: 50,
          qa_pass_rate_percent: 90.0,
          deployment_success_rate_percent: 95.0,
        },
        quality_gates: {
          config: {
            min_coverage: 80,
            min_test_pass_rate: 85,
            max_complexity: 10,
          },
          effectiveness: {
            tickets_blocked: 5,
            tickets_passed: 45,
            most_common_failure: 'low_coverage',
          },
        },
      };

      mockQualityDashboardService.getDrillDown.mockResolvedValue(mockDrillDown);

      const result = await controller.getDrillDown('project', 'proj-1', '30d');

      expect(result).toEqual(mockDrillDown);
      expect(service.getDrillDown).toHaveBeenCalledWith('project', 'proj-1', '30d');
    });
  });

  describe('export', () => {
    it('should export as JSON (AC#6)', async () => {
      const query: ExportQueryDto = {
        format: 'json',
        period: '30d',
      };

      const mockExport = {
        buffer: Buffer.from(JSON.stringify({ data: 'test' })),
        contentType: 'application/json',
        filename: 'quality_metrics_30d.json',
      };

      mockQualityDashboardService.generateExport.mockResolvedValue(mockExport);

      const mockResponse = {
        set: jest.fn(),
        send: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      await controller.export(query, mockResponse);

      expect(mockResponse.set).toHaveBeenCalledWith({
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="quality_metrics_30d.json"',
      });
      expect(mockResponse.send).toHaveBeenCalledWith(mockExport.buffer);
    });

    it('should export as CSV (AC#6)', async () => {
      const query: ExportQueryDto = {
        format: 'csv',
        period: '7d',
      };

      const mockExport = {
        buffer: Buffer.from('metric,value\npass_rate,85'),
        contentType: 'text/csv',
        filename: 'quality_metrics_7d.csv',
      };

      mockQualityDashboardService.generateExport.mockResolvedValue(mockExport);

      const mockResponse = {
        set: jest.fn(),
        send: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      } as unknown as Response;

      await controller.export(query, mockResponse);

      expect(mockResponse.set).toHaveBeenCalledWith({
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="quality_metrics_7d.csv"',
      });
    });

    it('should return 501 for PDF export (AC#6 - MVP limitation)', async () => {
      const query: ExportQueryDto = {
        format: 'pdf',
        period: '30d',
      };

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        set: jest.fn(),
        send: jest.fn(),
      } as unknown as Response;

      await controller.export(query, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(501);
      expect(mockResponse.json).toHaveBeenCalledWith({
        message: 'PDF export not supported yet',
      });
    });
  });
});
