/**
 * Provider Factory Service Unit Tests
 * Story 2.8: Multi-Provider Orchestration & Fallback Logic
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@/prisma/client';
import { ProviderFactoryService } from './provider-factory.service';
import { AIExecutionService } from './ai-execution.service';
import { ComplexityScorerService } from './complexity-scorer.service';
import { ProviderSelectionReason, ComplexityGrade, IOrchestrationInput } from './interfaces';
import { ClaudeCodeProvider } from './providers/claude-code.provider';
import { ProviderName } from '@/ai-routing/enums/provider-name.enum';

describe('ProviderFactoryService', () => {
  let service: ProviderFactoryService;
  let aiExecution: jest.Mocked<AIExecutionService>;
  let complexityScorer: jest.Mocked<ComplexityScorerService>;
  let _configService: jest.Mocked<ConfigService>;

  const mockMetrics = {
    inc: jest.fn(),
    observe: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(async () => {
    const mockAIExecution = {
      isProviderAvailable: jest.fn(),
      getProviderHealth: jest.fn(),
    };

    const mockComplexityScorer = {
      calculateComplexity: jest.fn(),
    };

    const mockConfig = {
      get: jest.fn((key: string, defaultValue?: unknown) => {
        // Return enabled status for providers
        if (key === 'ai.providers.claudeCode.enabled') return true;
        // Return default values for thresholds
        return defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderFactoryService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: AIExecutionService, useValue: mockAIExecution },
        { provide: ComplexityScorerService, useValue: mockComplexityScorer },
        {
          provide: ClaudeCodeProvider,
          useValue: { providerName: ProviderName.CLAUDE_CODE, isEnabled: true },
        },
        {
          provide: 'PROM_METRIC_ORCHESTRATOR_PROVIDER_SELECTIONS_TOTAL',
          useValue: mockMetrics,
        },
      ],
    }).compile();

    service = module.get<ProviderFactoryService>(ProviderFactoryService);
    aiExecution = module.get(AIExecutionService);
    complexityScorer = module.get(ComplexityScorerService);
    _configService = module.get(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('selectProvider', () => {
    const baseInput: IOrchestrationInput = {
      correlationId: 'corr-123',
      executionId: 'exec-456',
      ticketId: 'ticket-789',
      prompt: 'Add a function',
      repositoryUrl: 'https://github.com/test/repo.git',
    };

    it('should select Claude for high complexity tasks (OS-4.1 default)', async () => {
      complexityScorer.calculateComplexity.mockReturnValue({
        totalScore: 15,
        fileCount: 5,
        fileCountScore: 4,
        architectureChanges: true,
        architectureScore: 4,
        dependencyLevel: 'high',
        dependencyScore: 4,
        estimatedLoc: 200,
        locScore: 4,
        tagComplexity: 'complex',
        tagScore: 4,
      });

      aiExecution.isProviderAvailable.mockResolvedValue(true);

      const result = await service.selectProvider(baseInput);

      expect(result.primary).toBe(AIProvider.CLAUDE_CODE);
      expect(result.fallback).toBeNull();
      expect(result.reason).toBe(ProviderSelectionReason.COMPLEXITY);
      expect(result.complexityGrade).toBe(ComplexityGrade.HIGH);
    });

    it('should select Claude for low complexity tasks', async () => {
      complexityScorer.calculateComplexity.mockReturnValue({
        totalScore: 4,
        fileCount: 1,
        fileCountScore: 1,
        architectureChanges: false,
        architectureScore: 0,
        dependencyLevel: 'low',
        dependencyScore: 1,
        estimatedLoc: 30,
        locScore: 1,
        tagComplexity: 'simple',
        tagScore: 1,
      });

      aiExecution.isProviderAvailable.mockResolvedValue(true);

      const result = await service.selectProvider(baseInput);

      expect(result.primary).toBe(AIProvider.CLAUDE_CODE);
      expect(result.fallback).toBeNull();
      expect(result.reason).toBe(ProviderSelectionReason.COMPLEXITY);
      expect(result.complexityGrade).toBe(ComplexityGrade.LOW);
    });

    it('should respect provider override', async () => {
      const inputWithOverride: IOrchestrationInput = {
        ...baseInput,
        providerOverride: AIProvider.CLAUDE_CODE,
      };

      const result = await service.selectProvider(inputWithOverride);

      expect(result.primary).toBe(AIProvider.CLAUDE_CODE);
      expect(result.fallback).toBeNull();
      expect(result.reason).toBe(ProviderSelectionReason.OVERRIDE);
      expect(complexityScorer.calculateComplexity).not.toHaveBeenCalled();
    });

    it('should use pre-calculated complexity and return Claude', async () => {
      const inputWithComplexity: IOrchestrationInput = {
        ...baseInput,
        preCalculatedComplexity: 12,
      };

      aiExecution.isProviderAvailable.mockResolvedValue(true);

      const result = await service.selectProvider(inputWithComplexity);

      expect(result.complexityScore).toBe(12);
      expect(result.complexityGrade).toBe(ComplexityGrade.HIGH);
      expect(result.primary).toBe(AIProvider.CLAUDE_CODE);
      expect(complexityScorer.calculateComplexity).not.toHaveBeenCalled();
    });

    it('should select available provider when Claude is available', async () => {
      complexityScorer.calculateComplexity.mockReturnValue({
        totalScore: 15,
        fileCount: 5,
        fileCountScore: 4,
        architectureChanges: true,
        architectureScore: 4,
        dependencyLevel: 'high',
        dependencyScore: 4,
        estimatedLoc: 200,
        locScore: 4,
        tagComplexity: 'complex',
        tagScore: 4,
      });

      // Only Claude available
      aiExecution.isProviderAvailable.mockImplementation(
        async (provider: AIProvider) => provider === AIProvider.CLAUDE_CODE,
      );

      const result = await service.selectProvider(baseInput);

      expect(result.primary).toBe(AIProvider.CLAUDE_CODE);
      expect(result.fallback).toBeNull();
      expect(result.reason).toBe(ProviderSelectionReason.COMPLEXITY);
    });

    it('should handle when no providers are available', async () => {
      complexityScorer.calculateComplexity.mockReturnValue({
        totalScore: 8,
        fileCount: 2,
        fileCountScore: 2,
        architectureChanges: false,
        architectureScore: 0,
        dependencyLevel: 'medium',
        dependencyScore: 2,
        estimatedLoc: 80,
        locScore: 2,
        tagComplexity: 'medium',
        tagScore: 2,
      });

      aiExecution.isProviderAvailable.mockResolvedValue(false);

      const result = await service.selectProvider(baseInput);

      expect(result.primary).toBe(AIProvider.CLAUDE_CODE);
      expect(result.fallback).toBeNull();
      expect(result.reason).toBe(ProviderSelectionReason.COMPLEXITY);
    });
  });

  describe('getAllProvidersAvailability', () => {
    it('should return availability for all providers', async () => {
      aiExecution.getProviderHealth.mockResolvedValue({
        provider: AIProvider.CLAUDE_CODE,
        isHealthy: true,
        lastSuccessAt: new Date(),
        lastFailureAt: null,
        consecutiveFailures: 0,
        circuitState: 'CLOSED',
        activeExecutions: 2,
      });

      const availability = await service.getAllProvidersAvailability();

      expect(availability).toHaveLength(1);
      expect(availability.find((a) => a.provider === AIProvider.CLAUDE_CODE)).toBeDefined();
    });

    it('should calculate estimated wait time based on queue depth', async () => {
      aiExecution.getProviderHealth.mockResolvedValue({
        provider: AIProvider.CLAUDE_CODE,
        isHealthy: true,
        lastSuccessAt: new Date(),
        lastFailureAt: null,
        consecutiveFailures: 0,
        circuitState: 'CLOSED',
        activeExecutions: 3,
      });

      const availability = await service.getAllProvidersAvailability();

      // 3 active executions * 60000ms = 180000ms
      expect(availability[0].estimatedWaitMs).toBe(180000);
    });

    it('should mark provider unavailable when health check fails', async () => {
      aiExecution.getProviderHealth.mockResolvedValue({
        provider: AIProvider.CLAUDE_CODE,
        isHealthy: false,
        lastSuccessAt: null,
        lastFailureAt: new Date(),
        consecutiveFailures: 5,
        circuitState: 'OPEN',
        activeExecutions: 0,
      });

      const availability = await service.getAllProvidersAvailability();

      expect(availability[0].isAvailable).toBe(false);
      expect(availability[0].circuitState).toBe('OPEN');
      expect(availability[0].unavailableReason).toBe('Provider unhealthy');
    });
  });
  describe('getCodingProvider', () => {
    it('should return the provider if registered', () => {
      const provider = service.getCodingProvider(ProviderName.CLAUDE_CODE);
      expect(provider).toBeDefined();
      expect(provider?.providerName).toBe(ProviderName.CLAUDE_CODE);
    });

    it('should return undefined for unregistered provider', () => {
      const provider = service.getCodingProvider('UNKNOWN_PROVIDER' as ProviderName);
      expect(provider).toBeUndefined();
    });
  });
});
