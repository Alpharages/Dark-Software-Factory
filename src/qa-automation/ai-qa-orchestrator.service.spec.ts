import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AiQaOrchestrator } from './ai-qa-orchestrator.service';
import { OrchestratorService } from '../ai-routing/orchestrator.service';
import { QaMetricsService } from './qa-metrics.service';
import { PrismaService } from '../database/prisma.service';
import { SentryService } from '../common/sentry/sentry.service';
import { QaNotificationService } from './services/qa-notification.service';
import { AIProvider } from '@/prisma/client';

describe('AiQaOrchestrator', () => {
  let service: AiQaOrchestrator;
  let orchestratorService: jest.Mocked<OrchestratorService>;
  let _qaMetrics: jest.Mocked<QaMetricsService>;
  let _prismaService: jest.Mocked<PrismaService>;
  let sentry: jest.Mocked<SentryService>;

  beforeEach(async () => {
    const mockOrchestratorService = {
      execute: jest.fn(),
    };

    const mockQaMetrics = {
      recordCheckComplete: jest.fn(),
      recordCheckError: jest.fn(),
      setCoverage: jest.fn(),
    };

    const mockPrismaService = {
      qAResult: {
        create: jest.fn().mockResolvedValue({} as never),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({} as never),
      },
      ticket: {
        findUnique: jest.fn(),
      },
    };

    const mockSentry = {
      captureException: jest.fn(),
    };

    const mockQaNotificationService = {
      emitGateFailed: jest.fn().mockResolvedValue(undefined),
      emitAllGatesFailed: jest.fn().mockResolvedValue(undefined),
      emitGateBlocked: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiQaOrchestrator,
        { provide: OrchestratorService, useValue: mockOrchestratorService },
        { provide: QaMetricsService, useValue: mockQaMetrics },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: SentryService, useValue: mockSentry },
        { provide: QaNotificationService, useValue: mockQaNotificationService },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(2) } },
      ],
    }).compile();

    service = module.get<AiQaOrchestrator>(AiQaOrchestrator);
    orchestratorService = module.get(OrchestratorService);
    _qaMetrics = module.get(QaMetricsService);
    _prismaService = module.get(PrismaService);
    sentry = module.get(SentryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('executeLintCheck', () => {
    it('should execute successful lint check', async () => {
      const mockAiResponse = {
        success: true,
        codeDiff: JSON.stringify({
          status: 'PASSED',
          errorCount: 0,
          warningCount: 0,
          issues: [],
        }),
        executedBy: AIProvider.CURSOR_HEADLESS,
      };
      orchestratorService.execute.mockResolvedValue(mockAiResponse as never);

      const result = await service.executeLintCheck('ticket-1', 'exec-1', '/project/path');

      expect(result.status).toBe('PASSED');
      expect(result.checkType).toBe('linting');
      expect(result.aiProvider).toBe(AIProvider.CURSOR_HEADLESS);
    });

    it('should handle AI provider failure with fallback', async () => {
      orchestratorService.execute.mockRejectedValue(new Error('AI provider unavailable'));

      const result = await service.executeLintCheck('ticket-1', 'exec-1', '/project/path');

      expect(result.status).toBe('SKIPPED');
      expect(sentry.captureException).toHaveBeenCalled();
    });

    it('should handle invalid JSON response with retry', async () => {
      const invalidResponse = {
        success: true,
        codeDiff: 'invalid json',
        executedBy: AIProvider.CURSOR_HEADLESS,
      };
      const validResponse = {
        success: true,
        codeDiff: JSON.stringify({ status: 'PASSED', errorCount: 0 }),
        executedBy: AIProvider.CURSOR_HEADLESS,
      };

      orchestratorService.execute
        .mockResolvedValueOnce(invalidResponse as never)
        .mockResolvedValueOnce(validResponse as never);

      const result = await service.executeLintCheck('ticket-1', 'exec-1', '/project/path');

      expect(result.status).toBe('PASSED');
      expect(orchestratorService.execute).toHaveBeenCalledTimes(2);
    });
  });

  describe('executeTestRun', () => {
    it('should execute successful test run', async () => {
      const mockAiResponse = {
        success: true,
        codeDiff: JSON.stringify({
          status: 'PASSED',
          totalTests: 10,
          passedCount: 10,
          failedCount: 0,
        }),
        executedBy: AIProvider.CURSOR_HEADLESS,
      };
      orchestratorService.execute.mockResolvedValue(mockAiResponse as never);

      const result = await service.executeTestRun('ticket-1', 'exec-1', '/project/path');

      expect(result.status).toBe('PASSED');
      expect(result.checkType).toBe('testing');
    });
  });

  describe('executeSecurityScan', () => {
    it('should execute successful security scan', async () => {
      const mockAiResponse = {
        success: true,
        codeDiff: JSON.stringify({
          status: 'PASSED',
          vulnerabilities: [],
        }),
        executedBy: AIProvider.CURSOR_HEADLESS,
      };
      orchestratorService.execute.mockResolvedValue(mockAiResponse as never);

      const result = await service.executeSecurityScan('ticket-1', 'exec-1', '/project/path');

      expect(result.status).toBe('PASSED');
      expect(result.checkType).toBe('security');
    });
  });

  describe('executeCoverageAnalysis', () => {
    it('should execute successful coverage analysis', async () => {
      const mockAiResponse = {
        success: true,
        codeDiff: JSON.stringify({
          status: 'PASSED',
          overall: 85.5,
        }),
        executedBy: AIProvider.CURSOR_HEADLESS,
      };
      orchestratorService.execute.mockResolvedValue(mockAiResponse as never);

      const result = await service.executeCoverageAnalysis('ticket-1', 'exec-1', '/project/path');

      expect(result.status).toBe('PASSED');
      expect(result.checkType).toBe('coverage');
    });
  });
});
