import { CodeReviewService } from './code-review.service';
import { SecuritySeverity, SecurityCheckType, ISecurityScanOptions } from './interfaces';

// Mock database
jest.mock('../database/prisma.service', () => ({
  PrismaService: jest.fn().mockImplementation(() => ({})),
}));

// Mock sentry
jest.mock('../common/sentry/sentry.service', () => ({
  SentryService: jest.fn().mockImplementation(() => ({
    captureException: jest.fn(),
  })),
}));

describe('CodeReviewService', () => {
  const mockPrisma = {
    qAResult: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ id: 'qa-1' }),
      create: jest.fn().mockResolvedValue({ id: 'qa-1' }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    execution: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'exec-123',
        ticket_id: 'ticket-123',
      }),
    },
    ticket: {
      update: jest.fn().mockResolvedValue({ id: 'ticket-123' }),
    },
  };

  const mockConfig = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      const config: Record<string, unknown> = {
        'security.blockOnCritical': true,
        'security.blockOnHigh': true,
        'security.scanTimeoutMs': 180000,
      };
      return config[key] ?? defaultValue;
    }),
  };

  const mockSentry = {
    captureException: jest.fn(),
  };

  const mockDependencyScanner = {
    scan: jest.fn().mockResolvedValue([]),
  };

  const mockSecretsScanner = {
    scan: jest.fn().mockResolvedValue([]),
  };

  const mockComplexityAnalyzer = {
    analyze: jest.fn().mockResolvedValue([]),
  };

  const mockSecurityPattern = {
    scan: jest.fn().mockResolvedValue([]),
  };

  const mockCounter = { inc: jest.fn() };
  const mockHistogram = { startTimer: jest.fn().mockReturnValue(jest.fn()) };

  let service: CodeReviewService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CodeReviewService(
      mockPrisma as never,
      mockConfig as never,
      mockSentry as never,
      mockDependencyScanner as never,
      mockSecretsScanner as never,
      mockComplexityAnalyzer as never,
      mockSecurityPattern as never,
      mockCounter as never,
      mockHistogram as never,
      mockCounter as never,
      mockCounter as never,
      mockCounter as never,
      mockCounter as never,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('scan', () => {
    const mockOptions: ISecurityScanOptions = {
      workspacePath: '/test/workspace',
      executionId: 'exec-123',
      correlationId: 'corr-123',
      projectId: 'proj-123',
    };

    it('should run all scanners in parallel', async () => {
      await service.scan(mockOptions);

      expect(mockDependencyScanner.scan).toHaveBeenCalledWith(
        mockOptions.workspacePath,
        mockOptions.correlationId,
      );
      expect(mockSecretsScanner.scan).toHaveBeenCalledWith(
        mockOptions.workspacePath,
        mockOptions.correlationId,
      );
      expect(mockComplexityAnalyzer.analyze).toHaveBeenCalledWith(
        mockOptions.workspacePath,
        mockOptions.correlationId,
      );
      expect(mockSecurityPattern.scan).toHaveBeenCalledWith(
        mockOptions.workspacePath,
        mockOptions.correlationId,
      );
    });

    it('should track per-scanner duration', async () => {
      const result = await service.scan(mockOptions);

      expect(result.scannerResults.dependency.ran).toBe(true);
      expect(result.scannerResults.dependency.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.scannerResults.secrets.ran).toBe(true);
      expect(result.scannerResults.complexity.ran).toBe(true);
      expect(result.scannerResults.patterns.ran).toBe(true);
    });

    it('should fail on critical vulnerabilities when blockOnCritical=true', async () => {
      mockDependencyScanner.scan.mockResolvedValueOnce([
        {
          checkType: SecurityCheckType.DEPENDENCY,
          severity: SecuritySeverity.CRITICAL,
          package: 'lodash',
          version: '1.0.0',
          vulnerableVersions: '<4.17.21',
          title: 'Critical vulnerability',
          description: 'Test',
          recommendation: 'Upgrade',
        },
      ]);

      const result = await service.scan(mockOptions);

      expect(result.passed).toBe(false);
      expect(result.summary.criticalCount).toBe(1);
    });

    it('should pass when only medium/low findings', async () => {
      mockDependencyScanner.scan.mockResolvedValueOnce([
        {
          checkType: SecurityCheckType.DEPENDENCY,
          severity: SecuritySeverity.MEDIUM,
          package: 'test-pkg',
          version: '1.0.0',
          vulnerableVersions: '<2.0.0',
          title: 'Medium vulnerability',
          description: 'Test',
          recommendation: 'Upgrade',
        },
      ]);

      const result = await service.scan(mockOptions);

      expect(result.passed).toBe(true);
      expect(result.summary.mediumCount).toBe(1);
      expect(result.summary.criticalCount).toBe(0);
      expect(result.summary.highCount).toBe(0);
    });

    it('should handle scanner errors gracefully', async () => {
      mockDependencyScanner.scan.mockRejectedValueOnce(new Error('Scanner failed'));

      const result = await service.scan(mockOptions);

      // Scanner errors are caught by Promise.allSettled
      expect(result.scannerResults.dependency.passed).toBe(false);
      expect(result.scannerResults.dependency.error).toBe('Scanner failed');
      // Other scanners still run successfully
      expect(result.scannerResults.secrets.passed).toBe(true);
      expect(result.scannerResults.complexity.passed).toBe(true);
      expect(result.scannerResults.patterns.passed).toBe(true);
    });
  });

  describe('saveResult', () => {
    const mockScanResult = {
      passed: true,
      executionId: 'exec-123',
      correlationId: 'corr-123',
      scanDurationMs: 1000,
      summary: {
        totalFindings: 0,
        criticalCount: 0,
        highCount: 0,
        mediumCount: 0,
        lowCount: 0,
        infoCount: 0,
      },
      vulnerabilities: [],
      secrets: [],
      complexityIssues: [],
      patternFindings: [],
      scannerResults: {
        dependency: { ran: true, passed: true, durationMs: 100 },
        secrets: { ran: true, passed: true, durationMs: 50 },
        complexity: { ran: true, passed: true, durationMs: 200 },
        patterns: { ran: true, passed: true, durationMs: 150 },
      },
      scannedAt: new Date(),
    };

    it('should create new QAResult if none exists', async () => {
      await service.saveResult('exec-123', mockScanResult);

      expect(mockPrisma.qAResult.create).toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
    });

    it('should update existing QAResult', async () => {
      mockPrisma.qAResult.findFirst.mockResolvedValueOnce({ id: 'qa-1' });

      await service.saveResult('exec-123', mockScanResult);

      expect(mockPrisma.qAResult.update).toHaveBeenCalledWith({
        where: { id: 'qa-1' },
        data: expect.objectContaining({
          code_review_passed: true,
        }),
      });
    });

    it('should update ticket status to QA_FAILED if scan failed', async () => {
      const failedResult = { ...mockScanResult, passed: false };

      await service.saveResult('exec-123', failedResult);

      expect(mockPrisma.ticket.update).toHaveBeenCalledWith({
        where: { id: 'ticket-123' },
        data: { status: 'QA_FAILED' },
      });
    });
  });
});
