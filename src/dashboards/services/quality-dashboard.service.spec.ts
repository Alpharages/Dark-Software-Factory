import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Counter } from 'prom-client';
import { QualityDashboardService } from './quality-dashboard.service';
import { PrismaService } from '@/database/prisma.service';
import { QaResultsService } from '@/qa-automation/qa-results.service';
import { BugEscapeService } from '@/qa-automation/bug-escape/bug-escape.service';
import { QualityGateConfigService } from '@/qa-automation/quality-gate-config/quality-gate-config.service';
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
import {
  QualityDashboardSummaryDto,
  QualityMetricsQueryDto,
  ExportQueryDto,
} from '../dto/quality-dashboard.dto';

describe('QualityDashboardService', () => {
  let service: QualityDashboardService;
  let _prismaService: PrismaService;
  let _qaResultsService: QaResultsService;
  let _bugEscapeService: BugEscapeService;
  let _qualityGateConfigService: QualityGateConfigService;
  let aiDecisionLogger: AIDecisionLoggerService;
  let cacheManager: Cache;
  let apiCallsCounter: Counter<string>;
  let alertsCounter: Counter<string>;
  let cacheHitsCounter: Counter<string>;

  const mockPrismaService = {
    qAResult: {
      findMany: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    qaReviewQueue: {
      count: jest.fn(),
    },
    ticket: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    project: {
      findMany: jest.fn(),
    },
    execution: {
      findMany: jest.fn(),
    },
  };

  const mockQaResultsService = {
    findByProjectId: jest.fn(),
    getMetrics: jest.fn(),
  };

  const mockBugEscapeService = {
    calculateEscapeRate: jest.fn(),
    getEscapesByCategory: jest.fn(),
  };

  const mockQualityGateConfigService = {
    getAllConfigs: jest.fn(),
  };

  const mockAIDecisionLogger = {
    logDecision: jest.fn(),
  };

  const mockCacheManager = {
    get: jest.fn(),
    set: jest.fn(),
  };

  const mockCounter = {
    inc: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QualityDashboardService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: QaResultsService, useValue: mockQaResultsService },
        { provide: BugEscapeService, useValue: mockBugEscapeService },
        {
          provide: QualityGateConfigService,
          useValue: mockQualityGateConfigService,
        },
        { provide: AIDecisionLoggerService, useValue: mockAIDecisionLogger },
        { provide: CACHE_MANAGER, useValue: mockCacheManager },
        {
          provide: 'PROM_METRIC_QUALITY_DASHBOARD_API_CALLS_TOTAL',
          useValue: mockCounter,
        },
        {
          provide: 'PROM_METRIC_QUALITY_DASHBOARD_ALERTS_TOTAL',
          useValue: mockCounter,
        },
        {
          provide: 'PROM_METRIC_QUALITY_DASHBOARD_SUMMARY_CACHE_HITS_TOTAL',
          useValue: mockCounter,
        },
      ],
    }).compile();

    service = module.get<QualityDashboardService>(QualityDashboardService);
    _prismaService = module.get<PrismaService>(PrismaService);
    _qaResultsService = module.get<QaResultsService>(QaResultsService);
    _bugEscapeService = module.get<BugEscapeService>(BugEscapeService);
    _qualityGateConfigService = module.get<QualityGateConfigService>(QualityGateConfigService);
    aiDecisionLogger = module.get<AIDecisionLoggerService>(AIDecisionLoggerService);
    cacheManager = module.get<Cache>(CACHE_MANAGER);
    apiCallsCounter = module.get<Counter<string>>('PROM_METRIC_QUALITY_DASHBOARD_API_CALLS_TOTAL');
    alertsCounter = module.get<Counter<string>>('PROM_METRIC_QUALITY_DASHBOARD_ALERTS_TOTAL');
    cacheHitsCounter = module.get<Counter<string>>(
      'PROM_METRIC_QUALITY_DASHBOARD_SUMMARY_CACHE_HITS_TOTAL',
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSummary', () => {
    it('should return cached summary if available (AC#1)', async () => {
      const cachedSummary: Partial<QualityDashboardSummaryDto> = {
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

      mockCacheManager.get.mockResolvedValue(cachedSummary);

      const result = await service.getSummary();

      expect(result).toEqual(cachedSummary);
      expect(cacheManager.get).toHaveBeenCalledWith('quality_dashboard_summary');
      expect(apiCallsCounter.inc).toHaveBeenCalledWith({ endpoint: 'summary' });
      expect(cacheHitsCounter.inc).toHaveBeenCalledWith({ endpoint: 'summary' });
    });

    it('should generate and cache summary if not cached (AC#1)', async () => {
      mockCacheManager.get.mockResolvedValue(null);

      mockBugEscapeService.calculateEscapeRate.mockResolvedValue({
        summary: {
          total_escapes: 3,
          escape_rate_percent: 3.5,
          target_rate_percent: 5.0,
          status: 'within_target',
        },
      });

      mockPrismaService.qAResult.findMany.mockResolvedValue([
        { overall_passed: true, test_coverage: 80, tests_passed: true },
        { overall_passed: true, test_coverage: 75, tests_passed: true },
      ]);

      mockPrismaService.qaReviewQueue.count.mockResolvedValue(5);
      mockPrismaService.ticket.findMany.mockResolvedValue([
        { status: 'DEPLOYED' },
        { status: 'COMPLETED' },
      ]);

      mockQualityGateConfigService.getAllConfigs.mockResolvedValue([
        { project: { id: 'proj-1' }, pass_threshold: 80 },
      ]);

      const result = await service.getSummary();

      expect(result).toBeDefined();
      expect(result.period).toBe('30d');
      expect(cacheManager.set).toHaveBeenCalled();
      expect(apiCallsCounter.inc).toHaveBeenCalledWith({ endpoint: 'summary' });
    });

    it('should generate critical alert when bug escape rate exceeds target (AC#7)', async () => {
      mockCacheManager.get.mockResolvedValue(null);

      mockBugEscapeService.calculateEscapeRate.mockResolvedValue({
        summary: {
          total_escapes: 10,
          escape_rate_percent: 12.0, // EXCEEDS 5% target
          target_rate_percent: 5.0,
          status: 'exceeded',
        },
      });

      mockPrismaService.qAResult.findMany.mockResolvedValue([
        { overall_passed: true, test_coverage: 80, tests_passed: true },
      ]);

      mockPrismaService.qaReviewQueue.count.mockResolvedValue(2);
      mockPrismaService.ticket.findMany.mockResolvedValue([{ status: 'DEPLOYED' }]);

      mockQualityGateConfigService.getAllConfigs.mockResolvedValue([]);

      const result = await service.getSummary();

      expect(result.alerts).toHaveLength(1);
      expect(result.alerts[0].type).toBe('critical');
      expect(result.alerts[0].metric).toBe('bug_escape_rate');
      expect(aiDecisionLogger.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          agentName: 'QualityDashboardService',
          action: 'quality_alert_generated',
        }),
      );
      expect(alertsCounter.inc).toHaveBeenCalledWith({
        type: 'critical',
        metric: 'bug_escape_rate',
      });
    });

    it('should generate warning alert when QA pass rate is low (AC#7)', async () => {
      mockCacheManager.get.mockResolvedValue(null);

      mockBugEscapeService.calculateEscapeRate.mockResolvedValue({
        summary: {
          total_escapes: 1,
          escape_rate_percent: 2.0,
          target_rate_percent: 5.0,
          status: 'within_target',
        },
      });

      // 60% pass rate (3 out of 5 passed)
      mockPrismaService.qAResult.findMany.mockResolvedValue([
        { overall_passed: true, test_coverage: 80, tests_passed: true },
        { overall_passed: true, test_coverage: 75, tests_passed: true },
        { overall_passed: true, test_coverage: 70, tests_passed: true },
        { overall_passed: false, test_coverage: 50, tests_passed: false },
        { overall_passed: false, test_coverage: 40, tests_passed: false },
      ]);

      mockPrismaService.qaReviewQueue.count.mockResolvedValue(0);
      mockPrismaService.ticket.findMany.mockResolvedValue([]);
      mockQualityGateConfigService.getAllConfigs.mockResolvedValue([]);

      const result = await service.getSummary();

      expect(result.alerts.some((a) => a.metric === 'pass_rate')).toBe(true);
      expect(alertsCounter.inc).toHaveBeenCalledWith({
        type: 'warning',
        metric: 'pass_rate',
      });
    });
  });

  describe('getMetrics', () => {
    it('should return metrics grouped by project (AC#2)', async () => {
      const query: QualityMetricsQueryDto = {
        period: '30d',
        group_by: 'project',
        page: 1,
        limit: 20,
      };

      mockPrismaService.project.findMany.mockResolvedValue([
        { id: 'proj-1', name: 'Project Alpha', pm_id: 'pm-1' },
      ]);

      mockQaResultsService.getMetrics.mockResolvedValue({
        totalExecutions: 50,
        passedCount: 45,
        passRate: 90.0,
        averageCoverage: 80.0,
      });

      mockBugEscapeService.getEscapesByCategory.mockResolvedValue([
        { category: 'TEST_GAP', count: 1 },
      ]);

      mockPrismaService.ticket.findMany.mockResolvedValue([{ status: 'DEPLOYED' }]);

      const result = await service.getMetrics(query);

      expect(result).toBeDefined();
      expect(result.group_by).toBe('project');
      expect(result.items.length).toBeGreaterThan(0);
    });

    it('should support filtering by AI provider (AC#2)', async () => {
      const query: QualityMetricsQueryDto = {
        period: '30d',
        ai_provider: 'CLAUDE',
        page: 1,
        limit: 20,
      };

      mockPrismaService.project.findMany.mockResolvedValue([]);

      const result = await service.getMetrics(query);

      expect(result.items).toHaveLength(0);
    });
  });

  describe('getProviderComparison', () => {
    it('should compare AI providers (AC#3)', async () => {
      mockBugEscapeService.getEscapesByCategory.mockResolvedValue([
        { category: 'TEST_GAP', count: 2 },
      ]);

      mockPrismaService.execution.findMany.mockResolvedValue([
        { ai_provider: 'CLAUDE', status: 'COMPLETED' },
        { ai_provider: 'OPENAI', status: 'COMPLETED' },
      ]);

      const result = await service.getProviderComparison('30d');

      expect(result).toBeDefined();
      expect(result.period).toBe('30d');
      expect(result.comparison).toBeDefined();
    });
  });

  describe('getDrillDown', () => {
    it('should return drill-down data for a project (AC#5)', async () => {
      const projectId = 'proj-1';

      mockPrismaService.project.findMany.mockResolvedValue([
        { id: projectId, name: 'Project Alpha' },
      ]);

      mockQaResultsService.getMetrics.mockResolvedValue({
        totalExecutions: 50,
        passedCount: 45,
        failedCount: 5,
        passRate: 90.0,
      });

      const result = await service.getDrillDown('project', projectId, '30d');

      expect(result).toBeDefined();
      expect(result.dimension).toBeDefined();
      expect(result.dimension.id).toBe(projectId);
      expect(result.dimension.type).toBe('project');
    });

    it('should throw NotFoundException if dimension not found (AC#5)', async () => {
      mockPrismaService.project.findMany.mockResolvedValue([]);

      await expect(service.getDrillDown('project', 'invalid-id', '30d')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('generateExport', () => {
    it('should export data as JSON (AC#6)', async () => {
      const query: ExportQueryDto = {
        format: 'json',
        period: '30d',
      };

      mockPrismaService.project.findMany.mockResolvedValue([
        { id: 'proj-1', name: 'Project Alpha' },
      ]);

      mockQaResultsService.getMetrics.mockResolvedValue({
        totalExecutions: 50,
        passedCount: 45,
        passRate: 90.0,
      });

      mockBugEscapeService.getEscapesByCategory.mockResolvedValue([]);
      mockPrismaService.ticket.findMany.mockResolvedValue([]);

      const result = await service.generateExport(query);

      expect(result.contentType).toBe('application/json');
      expect(result.filename).toContain('.json');
      expect(result.buffer).toBeInstanceOf(Buffer);
    });

    it('should export data as CSV (AC#6)', async () => {
      const query: ExportQueryDto = {
        format: 'csv',
        period: '7d',
      };

      mockPrismaService.project.findMany.mockResolvedValue([
        { id: 'proj-1', name: 'Project Alpha' },
      ]);

      mockQaResultsService.getMetrics.mockResolvedValue({
        totalExecutions: 20,
        passedCount: 18,
        passRate: 90.0,
      });

      mockBugEscapeService.getEscapesByCategory.mockResolvedValue([]);
      mockPrismaService.ticket.findMany.mockResolvedValue([]);

      const result = await service.generateExport(query);

      expect(result.contentType).toBe('text/csv');
      expect(result.filename).toContain('.csv');
      expect(result.buffer.toString()).toContain('Project,Pass Rate');
    });

    it('should throw error for unsupported export format (AC#6)', async () => {
      const query: ExportQueryDto = {
        format: 'xml' as unknown as 'json' | 'csv' | 'pdf',
        period: '30d',
      };

      await expect(service.generateExport(query)).rejects.toThrow('Unsupported export format: xml');
    });

    it('should handle large datasets without crashing (H3)', async () => {
      const query: ExportQueryDto = {
        format: 'json',
        period: '90d',
      };

      const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
        id: `proj-${i}`,
        name: `Project ${i}`,
      }));

      mockPrismaService.project.findMany.mockResolvedValue(largeDataset);
      mockQaResultsService.getMetrics.mockResolvedValue({
        totalExecutions: 100,
        passedCount: 90,
        passRate: 90.0,
      });

      mockBugEscapeService.getEscapesByCategory.mockResolvedValue([]);
      mockPrismaService.ticket.findMany.mockResolvedValue([]);

      const result = await service.generateExport(query);

      expect(result.buffer).toBeDefined();
    });
  });
});
