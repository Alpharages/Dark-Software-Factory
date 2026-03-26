/**
 * Orchestrator Service Unit Tests
 * Story 2.8: Multi-Provider Orchestration & Fallback Logic
 */

import { Test, TestingModule } from '@nestjs/testing';
import { AIProvider } from '@/prisma/client';
import { OrchestratorService } from './orchestrator.service';
import { ProviderFactoryService } from './provider-factory.service';
import { FallbackStrategyService } from './fallback-strategy.service';
import { AIExecutionService } from './ai-execution.service';
import { AIDecisionLoggerService } from '../audit/ai-decision-logger.service';
import { AdrParserService } from './adr-parser.service';
import { AdrService } from '../architecture-review/adr.service';
import {
  IOrchestrationInput,
  ProviderSelectionReason,
  ComplexityGrade,
  AIErrorCode,
} from './interfaces';

describe('OrchestratorService', () => {
  let service: OrchestratorService;
  let providerFactory: jest.Mocked<ProviderFactoryService>;
  let fallbackStrategy: jest.Mocked<FallbackStrategyService>;

  const mockInput: IOrchestrationInput = {
    correlationId: 'corr-123',
    executionId: 'exec-456',
    ticketId: 'ticket-789',
    prompt: 'Add a hello function',
    repositoryUrl: 'https://github.com/test/repo.git',
    allowFallback: true,
  };

  const mockMetrics = {
    inc: jest.fn(),
    observe: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(async () => {
    const mockProviderFactory = {
      selectProvider: jest.fn(),
      getAllProvidersAvailability: jest.fn(),
      getCodingProvider: jest.fn(),
    };

    const mockFallbackStrategy = {
      executeWithFallback: jest.fn(),
      executeWithFallbackCodingProvider: jest.fn(),
      shouldFallback: jest.fn(),
      getMaxFallbackAttempts: jest.fn().mockReturnValue(2),
    };

    const mockAIExecutionService = {
      getProvider: jest.fn(),
    };

    const mockAIDecisionLoggerService = {
      logDecision: jest.fn(),
    };

    const mockAdrParserService = {
      hasAdr: jest.fn(),
      parseAdrFromResponse: jest.fn(),
    };

    const mockAdrService = {
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrchestratorService,
        { provide: ProviderFactoryService, useValue: mockProviderFactory },
        { provide: FallbackStrategyService, useValue: mockFallbackStrategy },
        { provide: AIExecutionService, useValue: mockAIExecutionService },
        { provide: AIDecisionLoggerService, useValue: mockAIDecisionLoggerService },
        { provide: AdrParserService, useValue: mockAdrParserService },
        { provide: AdrService, useValue: mockAdrService },
        { provide: 'PROM_METRIC_ORCHESTRATOR_EXECUTIONS_TOTAL', useValue: mockMetrics },
        {
          provide: 'PROM_METRIC_ORCHESTRATOR_EXECUTION_DURATION_SECONDS',
          useValue: mockMetrics,
        },
        { provide: 'PROM_METRIC_ORCHESTRATOR_COST_CENTS', useValue: mockMetrics },
        { provide: 'PROM_METRIC_ADR_CREATION_TOTAL', useValue: mockMetrics },
      ],
    }).compile();

    service = module.get<OrchestratorService>(OrchestratorService);
    providerFactory = module.get(ProviderFactoryService);
    fallbackStrategy = module.get(FallbackStrategyService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('execute', () => {
    it('should execute successfully with primary provider', async () => {
      providerFactory.selectProvider.mockResolvedValue({
        primary: AIProvider.CLAUDE_CODE,
        fallback: null,
        reason: ProviderSelectionReason.COMPLEXITY,
        complexityScore: 12,
        complexityGrade: ComplexityGrade.HIGH,
      });

      providerFactory.getCodingProvider.mockReturnValue({
        providerName: 'claude-code',
        isEnabled: true,
        execute: jest.fn(),
        isHealthy: jest.fn().mockResolvedValue(true),
      } as any);

      fallbackStrategy.executeWithFallbackCodingProvider.mockResolvedValue({
        result: {
          success: true,
          codeDiff: 'diff --git ...',
          filesChanged: ['src/utils.ts'],
          confidenceScore: 0.85,
          durationMs: 30000,
          workspacePath: '/tmp/workspace',
        },
        executedBy: AIProvider.CLAUDE_CODE,
        usedFallback: false,
        fallbackAttempts: [],
      });

      const result = await service.execute(mockInput);

      expect(result.success).toBe(true);
      expect(result.executedBy).toBe(AIProvider.CLAUDE_CODE);
      expect(result.usedFallback).toBe(false);
      expect(result.filesChanged).toEqual(['src/utils.ts']);
      expect(result.confidenceScore).toBe(0.85);
      expect(providerFactory.selectProvider).toHaveBeenCalledWith(mockInput);
      expect(fallbackStrategy.executeWithFallbackCodingProvider).toHaveBeenCalled();
    });

    it('should fallback when primary fails with retryable error', async () => {
      providerFactory.selectProvider.mockResolvedValue({
        primary: AIProvider.CLAUDE_CODE,
        fallback: null,
        reason: ProviderSelectionReason.COMPLEXITY,
        complexityScore: 12,
        complexityGrade: ComplexityGrade.HIGH,
      });

      providerFactory.getCodingProvider.mockReturnValue({
        providerName: 'claude-code',
        isEnabled: true,
        execute: jest.fn(),
        isHealthy: jest.fn().mockResolvedValue(true),
      } as any);

      fallbackStrategy.executeWithFallbackCodingProvider.mockResolvedValue({
        result: {
          success: true,
          codeDiff: 'diff --git ...',
          filesChanged: ['src/utils.ts'],
          confidenceScore: 0.8,
          durationMs: 45000,
          workspacePath: '/tmp/workspace',
        },
        executedBy: AIProvider.CLAUDE_CODE,
        usedFallback: true,
        fallbackAttempts: [
          {
            provider: AIProvider.GEMINI,
            error: 'Timeout',
            wasRetryable: true,
            durationMs: 300000,
            timestamp: new Date(),
          },
        ],
      });

      const result = await service.execute(mockInput);

      expect(result.success).toBe(true);
      expect(result.executedBy).toBe(AIProvider.CLAUDE_CODE);
      expect(result.usedFallback).toBe(true);
      expect(result.fallbackAttempts).toHaveLength(1);
      expect(result.fallbackAttempts[0].provider).toBe(AIProvider.GEMINI);
    });

    it('should handle complete failure when both providers fail', async () => {
      providerFactory.selectProvider.mockResolvedValue({
        primary: AIProvider.CLAUDE_CODE,
        fallback: null,
        reason: ProviderSelectionReason.COMPLEXITY,
        complexityScore: 12,
        complexityGrade: ComplexityGrade.HIGH,
      });

      providerFactory.getCodingProvider.mockReturnValue({
        providerName: 'claude-code',
        isEnabled: true,
        execute: jest.fn(),
        isHealthy: jest.fn().mockResolvedValue(true),
      } as any);

      fallbackStrategy.executeWithFallbackCodingProvider.mockResolvedValue({
        result: {
          success: false,
          codeDiff: null,
          filesChanged: [],
          confidenceScore: 0,
          durationMs: 5000,
          workspacePath: '',
          error: {
            code: AIErrorCode.UNKNOWN,
            message: 'Both providers failed',
            isRetryable: false,
          },
        },
        executedBy: AIProvider.CLAUDE_CODE,
        usedFallback: true,
        fallbackAttempts: [
          {
            provider: AIProvider.GEMINI,
            error: 'Timeout',
            wasRetryable: true,
            durationMs: 300000,
            timestamp: new Date(),
          },
          {
            provider: AIProvider.CLAUDE_CODE,
            error: 'API Error',
            wasRetryable: false,
            durationMs: 5000,
            timestamp: new Date(),
          },
        ],
      });

      const result = await service.execute(mockInput);

      expect(result.success).toBe(false);
      expect(result.usedFallback).toBe(true);
      expect(result.fallbackAttempts).toHaveLength(2);
      expect(result.error?.message).toBe('Both providers failed');
    });

    it('should handle unexpected errors gracefully', async () => {
      providerFactory.selectProvider.mockRejectedValue(new Error('Provider selection failed'));

      const result = await service.execute(mockInput);

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Provider selection failed');
      expect(result.error?.isRetryable).toBe(true);
    });

    it('should use provider override when specified', async () => {
      const inputWithOverride: IOrchestrationInput = {
        ...mockInput,
        providerOverride: AIProvider.CLAUDE_CODE,
      };

      providerFactory.selectProvider.mockResolvedValue({
        primary: AIProvider.CLAUDE_CODE,
        fallback: null,
        reason: ProviderSelectionReason.OVERRIDE,
        complexityScore: 50,
        complexityGrade: ComplexityGrade.MEDIUM,
      });

      providerFactory.getCodingProvider.mockReturnValue({
        providerName: 'claude-code',
        isEnabled: true,
        execute: jest.fn(),
        isHealthy: jest.fn().mockResolvedValue(true),
      } as any);

      fallbackStrategy.executeWithFallbackCodingProvider.mockResolvedValue({
        result: {
          success: true,
          codeDiff: 'diff --git ...',
          filesChanged: ['src/index.ts'],
          confidenceScore: 0.9,
          durationMs: 20000,
          workspacePath: '/tmp/workspace',
        },
        executedBy: AIProvider.CLAUDE_CODE,
        usedFallback: false,
        fallbackAttempts: [],
      });

      const result = await service.execute(inputWithOverride);

      expect(result.success).toBe(true);
      expect(result.executedBy).toBe(AIProvider.CLAUDE_CODE);
      expect(providerFactory.selectProvider).toHaveBeenCalledWith(inputWithOverride);
      expect(fallbackStrategy.executeWithFallbackCodingProvider).toHaveBeenCalled();
    });
  });

  describe('getMetrics', () => {
    it('should return current metrics', () => {
      const metrics = service.getMetrics();

      expect(metrics.totalExecutions).toBeDefined();
      expect(metrics.successfulExecutions).toBeDefined();
      expect(metrics.fallbackTriggers).toBeDefined();
      expect(metrics.fallbackSuccessRate).toBeDefined();
      expect(metrics.providerUsage).toBeDefined();
      expect(metrics.avgExecutionTimeMs).toBeDefined();
    });

    it('should track provider usage after executions', async () => {
      providerFactory.selectProvider.mockResolvedValue({
        primary: AIProvider.CLAUDE_CODE,
        fallback: null,
        reason: ProviderSelectionReason.COMPLEXITY,
        complexityScore: 12,
        complexityGrade: ComplexityGrade.HIGH,
      });

      providerFactory.getCodingProvider.mockReturnValue({
        providerName: 'claude-code',
        isEnabled: true,
        execute: jest.fn(),
        isHealthy: jest.fn().mockResolvedValue(true),
      } as any);

      fallbackStrategy.executeWithFallbackCodingProvider.mockResolvedValue({
        result: {
          success: true,
          codeDiff: 'diff',
          filesChanged: ['file.ts'],
          confidenceScore: 0.9,
          durationMs: 30000,
          workspacePath: '/tmp/ws',
        },
        executedBy: AIProvider.CLAUDE_CODE,
        usedFallback: false,
        fallbackAttempts: [],
      });

      await service.execute(mockInput);

      const metrics = service.getMetrics();
      expect(metrics.totalExecutions).toBeGreaterThanOrEqual(1);
      expect(metrics.providerUsage[AIProvider.CLAUDE_CODE]).toBeGreaterThanOrEqual(1);
    });

    it('should not throw when trackExecution is called with an unknown provider (lazy init)', () => {
      const unknownProvider = 'GEMINI' as AIProvider;
      expect(() =>
        (service as any).trackExecution(
          {
            result: { success: true, durationMs: 5000 },
            executedBy: unknownProvider,
            usedFallback: false,
            fallbackAttempts: [],
          },
          5000,
        ),
      ).not.toThrow();

      const metrics = service.getMetrics();
      expect(metrics.providerUsage[unknownProvider]).toBe(1);
    });
  });

  describe('getProviderAvailability', () => {
    it('should return availability from provider factory', async () => {
      const mockAvailability = [
        {
          provider: AIProvider.CLAUDE_CODE,
          isAvailable: true,
          circuitState: 'CLOSED' as const,
          queueDepth: 2,
          estimatedWaitMs: 120000,
        },
      ];

      providerFactory.getAllProvidersAvailability.mockResolvedValue(mockAvailability);

      const availability = await service.getProviderAvailability();

      expect(availability).toEqual(mockAvailability);
      expect(providerFactory.getAllProvidersAvailability).toHaveBeenCalled();
    });
  });
});
