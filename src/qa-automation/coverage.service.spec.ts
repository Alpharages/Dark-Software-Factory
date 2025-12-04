import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { SentryService } from '../common/sentry/sentry.service';
import { CoverageService } from './coverage.service';
import { CoverageFileParser } from './coverage-file.parser';
import { CoverageBaselineService } from './coverage-baseline.service';
import { ICoverageOptions, ICoverageData } from './interfaces';
import { ITestResult, TestFramework } from './interfaces/test-runner.interface';

describe('CoverageService', () => {
  let service: CoverageService;

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockPrisma = {
    qAResult: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    execution: {
      findUnique: jest.fn(),
    },
    ticket: {
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  const mockMetrics = {
    recordQACheck: jest.fn(),
  };

  const mockSentry = {
    captureException: jest.fn(),
  };

  const mockFileParser = {
    parseCoverageSummary: jest.fn(),
  };

  const mockBaselineService = {
    getBaseline: jest.fn(),
    saveBaseline: jest.fn(),
    getProjectThreshold: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CoverageService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: MetricsService, useValue: mockMetrics },
        { provide: SentryService, useValue: mockSentry },
        { provide: CoverageFileParser, useValue: mockFileParser },
        { provide: CoverageBaselineService, useValue: mockBaselineService },
      ],
    }).compile();

    service = module.get<CoverageService>(CoverageService);

    jest.clearAllMocks();
    mockConfigService.get.mockImplementation((key: string, def: unknown) => def);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('analyzeCoverage', () => {
    const testResult: ITestResult = {
      passed: true,
      rawOutput: '',
      framework: TestFramework.JEST,
      totalTests: 10,
      passedCount: 10,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 1000,
      suites: [],
      failedTests: [],
      coverage: {
        lines: 85,
        branches: 80,
        functions: 90,
        statements: 85,
      },
    };

    const options: ICoverageOptions = {
      executionId: 'exec-1',
      correlationId: 'corr-1',
      projectId: 'proj-1',
      workspacePath: '/tmp/workspace',
      baseBranch: 'main',
    };

    const coverageData: ICoverageData = {
      lines: 85,
      branches: 80,
      functions: 90,
      statements: 85,
    };

    it('should analyze coverage successfully', async () => {
      mockFileParser.parseCoverageSummary.mockResolvedValue({
        files: [],
        aggregate: coverageData,
      });
      mockBaselineService.getBaseline.mockResolvedValue(null);

      const result = await service.analyzeCoverage(testResult, options);

      expect(result.passed).toBe(true);
      expect(result.current).toEqual(coverageData);
      expect(mockMetrics.recordQACheck).toHaveBeenCalledWith(
        expect.objectContaining({
          checkType: 'coverage',
          status: 'passed',
          coverage: 85,
        }),
      );
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
    });

    it('should fail if coverage is below threshold', async () => {
      mockFileParser.parseCoverageSummary.mockResolvedValue({
        files: [],
        aggregate: { ...coverageData, lines: 50 },
      });
      mockBaselineService.getBaseline.mockResolvedValue(null);
      mockConfigService.get.mockReturnValue(80); // Threshold

      const result = await service.analyzeCoverage(testResult, options);

      expect(result.passed).toBe(false);
      expect(mockMetrics.recordQACheck).toHaveBeenCalledWith(
        expect.objectContaining({
          checkType: 'coverage',
          status: 'failed',
        }),
      );
    });

    it('should calculate delta against baseline', async () => {
      mockFileParser.parseCoverageSummary.mockResolvedValue({
        files: [],
        aggregate: coverageData,
      });
      mockBaselineService.getBaseline.mockResolvedValue({
        coverage: {
          lines: 80, // +5
          branches: 80, // 0
          functions: 90, // 0
          statements: 85, // 0
        },
      });

      const result = await service.analyzeCoverage(testResult, options);

      expect(result.delta.lines).toBe(5);
      expect(result.delta.overall).toBeGreaterThan(0);
    });

    it('should use project specific threshold override', async () => {
      mockFileParser.parseCoverageSummary.mockResolvedValue({
        files: [],
        aggregate: { ...coverageData, lines: 75 },
      });
      mockBaselineService.getBaseline.mockResolvedValue(null);

      // Override threshold to 70 (so 75 passes)
      mockBaselineService.getProjectThreshold.mockResolvedValue(70);

      const result = await service.analyzeCoverage(testResult, options);

      expect(result.passed).toBe(true);
      expect(result.threshold).toBe(70);
    });

    it('should upsert QAResult with coverage data', async () => {
      mockFileParser.parseCoverageSummary.mockResolvedValue({
        files: [],
        aggregate: coverageData,
      });
      mockBaselineService.getBaseline.mockResolvedValue(null);
      mockPrisma.qAResult.findFirst.mockResolvedValue(null);

      await service.analyzeCoverage(testResult, options);

      expect(mockPrisma.qAResult.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            execution_id: 'exec-1',
            test_coverage: 85,
          }),
        }),
      );
    });

    it('should update ticket status on coverage failure', async () => {
      mockFileParser.parseCoverageSummary.mockResolvedValue({
        files: [],
        aggregate: { ...coverageData, lines: 50 }, // Below threshold
      });
      mockBaselineService.getBaseline.mockResolvedValue(null);
      mockPrisma.qAResult.findFirst.mockResolvedValue(null);
      mockPrisma.execution.findUnique.mockResolvedValue({
        id: 'exec-1',
        ticket_id: 'ticket-1',
      });

      await service.analyzeCoverage(testResult, options);

      expect(mockPrisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-1' },
        data: { status: 'QA_FAILED' },
      });
    });

    it('should handle file parsing errors gracefully', async () => {
      mockFileParser.parseCoverageSummary.mockResolvedValue(null);
      mockBaselineService.getBaseline.mockResolvedValue(null);

      const result = await service.analyzeCoverage(testResult, options);

      expect(result.current).toEqual(testResult.coverage); // Fallback to testResult
    });

    it('should capture errors in Sentry', async () => {
      mockFileParser.parseCoverageSummary.mockRejectedValue(new Error('Parse error'));

      await expect(service.analyzeCoverage(testResult, options)).rejects.toThrow('Parse error');
      expect(mockSentry.captureException).toHaveBeenCalled();
    });
  });

  describe('updateBaselineOnMerge', () => {
    it('should update baseline after merge', async () => {
      const coverage: ICoverageData = {
        lines: 90,
        branches: 85,
        functions: 95,
        statements: 88,
      };

      await service.updateBaselineOnMerge('proj-1', coverage, 'main');

      expect(mockBaselineService.saveBaseline).toHaveBeenCalledWith('proj-1', 'main', coverage);
    });
  });
});
