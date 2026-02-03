import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { QualityGatesService, SAMPLE_QA_RESULT } from './quality-gates.service';
import { QualityCategory, QualityGateStatus } from './interfaces/quality-gate.interface';
import { getToken } from '@willsoto/nestjs-prometheus';
import { QA_METRICS } from '../common/metrics/metrics.constants';
import { QualityGateConfigService } from './quality-gate-config/quality-gate-config.service';

describe('QualityGatesService', () => {
  let service: QualityGatesService;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      // Mock configuration values
      const config = {
        'qualityGate.minTestPassRate': 100,
        'qualityGate.minCoverage': 80,
        'qualityGate.targetCoverage': 90,
        'qualityGate.maxLintingErrors': 0,
        'qualityGate.maxLintingWarnings': 10,
        'qualityGate.blockOnCriticalSecurity': true,
        'qualityGate.blockOnHighSecurity': true,
        'qualityGate.maxComplexity': 20,
        'qualityGate.allowOverride': false,
      } as Record<string, unknown>;
      return config[key] ?? defaultValue;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QualityGatesService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: QualityGateConfigService,
          useValue: {
            getEffectiveConfig: jest.fn().mockResolvedValue({
              projectId: 'proj-123',
              thresholds: {
                minTestPassRate: 100,
                minCoverage: 80,
                targetCoverage: 90,
                maxLintingErrors: 0,
                maxLintingWarnings: 10,
                blockOnCriticalSecurity: true,
                blockOnHighSecurity: true,
                maxComplexity: 20,
              },
              enabledCategories: [
                QualityCategory.LINTING,
                QualityCategory.TESTING,
                QualityCategory.COVERAGE,
                QualityCategory.SECURITY,
              ],
              allowOverride: false,
              overrideRequiresApproval: true,
            }),
          },
        },
        {
          provide: getToken(QA_METRICS.QUALITY_GATE_EVALUATIONS_TOTAL),
          useValue: { inc: jest.fn() },
        },
        {
          provide: getToken(QA_METRICS.QUALITY_GATE_DURATION),
          useValue: { startTimer: jest.fn(() => jest.fn()) },
        },
        {
          provide: getToken(QA_METRICS.QUALITY_SCORE_HISTOGRAM),
          useValue: { observe: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<QualityGatesService>(QualityGatesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('evaluate', () => {
    it('should pass with a perfect score for sample data', async () => {
      // Adjust sample data to meet target coverage to avoid warning
      const perfectResult = {
        ...SAMPLE_QA_RESULT,
        test_coverage: 95, // Above target 90
        linting_errors: { errorCount: 0, warningCount: 0 }, // No warnings
        code_review_issues: { summary: { criticalCount: 0, highCount: 0, mediumCount: 0 } },
      };

      const result = await service.evaluate('exec-123', 'corr-123', 'proj-123', perfectResult);

      expect(result.passed).toBe(true);
      expect(result.status).toBe(QualityGateStatus.PASSED);
      expect(result.overallScore).toBe(100);
      expect(result.blockingIssues).toHaveLength(0);
    });

    it('should fail when tests fail', async () => {
      const failingTestResult = {
        ...SAMPLE_QA_RESULT,
        tests_passed: false,
        test_results: { passed: 9, failed: 1 },
      };

      const result = await service.evaluate('exec-123', 'corr-123', 'proj-123', failingTestResult);

      expect(result.passed).toBe(false);
      expect(result.status).toBe(QualityGateStatus.FAILED);
      expect(result.blockingIssues).toHaveLength(1);
      expect(result.blockingIssues[0].category).toBe(QualityCategory.TESTING);
    });

    it('should fail when coverage is below threshold', async () => {
      const lowCoverageResult = {
        ...SAMPLE_QA_RESULT,
        test_coverage: 70, // Threshold is 80
      };

      const result = await service.evaluate('exec-123', 'corr-123', 'proj-123', lowCoverageResult);

      expect(result.passed).toBe(false);
      expect(result.status).toBe(QualityGateStatus.FAILED);
      expect(result.blockingIssues.some((i) => i.category === QualityCategory.COVERAGE)).toBe(true);
    });

    it('should fail when security scan finds critical issues', async () => {
      const securityIssuesResult = {
        ...SAMPLE_QA_RESULT,
        code_review_passed: false,
        code_review_issues: {
          summary: {
            criticalCount: 1,
            highCount: 0,
            vulnerabilities: [{ severity: 'critical', title: 'SQL Injection' }],
          },
        },
      };

      const result = await service.evaluate(
        'exec-123',
        'corr-123',
        'proj-123',
        securityIssuesResult,
      );

      expect(result.passed).toBe(false);
      expect(result.status).toBe(QualityGateStatus.FAILED);
      expect(result.blockingIssues[0].category).toBe(QualityCategory.SECURITY);
    });

    it('should produce warnings but pass for minor issues', async () => {
      const warningResult = {
        ...SAMPLE_QA_RESULT,
        linting_errors: {
          passed: true,
          errorCount: 0,
          warningCount: 15, // Above max warnings 10
        },
      };

      const result = await service.evaluate('exec-123', 'corr-123', 'proj-123', warningResult);

      expect(result.passed).toBe(true);
      expect(result.status).toBe(QualityGateStatus.WARNING);
      expect(result.warningIssues.length).toBeGreaterThan(0);
    });
  });

  describe('scoring logic', () => {
    it('should calculate weighted score correctly', async () => {
      // Create a scenario with mixed results
      const mixedResult = {
        ...SAMPLE_QA_RESULT,
        test_coverage: 85, // Getting 50% score for coverage (between min 80 and target 90)
        linting_errors: {
          passed: true,
          errorCount: 0,
          warningCount: 5, // 50% score for linting
        },
      };

      const result = await service.evaluate('exec-123', 'corr-123', 'proj-123', mixedResult);

      // Coverage: 25% weight. 85% coverage (midpoint) -> ~50% of weight = 12.5 points
      // Linting: 15% weight. 5 warnings -> ~50% of weight = 7.5 points
      // Testing: 35% weight (PASS) -> 35 points
      // Security: 25% weight (PASS) -> 25 points
      // Total approx: 12.5 + 7.5 + 35 + 25 = 80

      expect(result.overallScore).toBeLessThan(100);
      expect(result.overallScore).toBeGreaterThan(70);
    });
  });
});
