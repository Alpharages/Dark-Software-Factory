/**
 * Orchestrator Integration Tests
 * Story 2.8: Multi-Provider Orchestration & Fallback Logic
 *
 * Tests the full orchestration flow with provider selection and fallback.
 * Run with: pnpm test:e2e -- --testPathPattern=orchestrator
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AIProvider } from '@/prisma/client';
import { OrchestratorService } from '../src/ai-routing/orchestrator.service';
import { ProviderFactoryService } from '../src/ai-routing/provider-factory.service';
import { FallbackStrategyService } from '../src/ai-routing/fallback-strategy.service';
import { AIExecutionService } from '../src/ai-routing/ai-execution.service';
import { ComplexityScorerService } from '../src/ai-routing/complexity-scorer.service';
import {
  ProviderSelectionReason,
  ComplexityGrade,
  AIErrorCode,
} from '../src/ai-routing/interfaces';
// Prometheus metric providers not needed - using mock values directly
import configuration from '../src/config/configuration';

describe('Orchestrator (e2e)', () => {
  let app: INestApplication;
  let orchestrator: OrchestratorService;
  let providerFactory: ProviderFactoryService;
  let aiExecution: jest.Mocked<AIExecutionService>;

  beforeAll(async () => {
    const mockAIExecution = {
      executeWithProvider: jest.fn(),
      isProviderAvailable: jest.fn().mockResolvedValue(true),
      getProviderHealth: jest.fn().mockResolvedValue({
        provider: AIProvider.CURSOR_HEADLESS,
        isHealthy: true,
        lastSuccessAt: new Date(),
        lastFailureAt: null,
        consecutiveFailures: 0,
        circuitState: 'CLOSED',
        activeExecutions: 0,
      }),
    };

    const mockMetrics = {
      inc: jest.fn(),
      observe: jest.fn(),
      set: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: [configuration],
          isGlobal: true,
        }),
      ],
      providers: [
        OrchestratorService,
        ProviderFactoryService,
        FallbackStrategyService,
        ComplexityScorerService,
        { provide: AIExecutionService, useValue: mockAIExecution },
        // Metrics
        { provide: 'PROM_METRIC_ORCHESTRATOR_EXECUTIONS_TOTAL', useValue: mockMetrics },
        {
          provide: 'PROM_METRIC_ORCHESTRATOR_EXECUTION_DURATION_SECONDS',
          useValue: mockMetrics,
        },
        { provide: 'PROM_METRIC_ORCHESTRATOR_COST_CENTS', useValue: mockMetrics },
        {
          provide: 'PROM_METRIC_ORCHESTRATOR_PROVIDER_SELECTIONS_TOTAL',
          useValue: mockMetrics,
        },
        { provide: 'PROM_METRIC_ORCHESTRATOR_FALLBACK_TOTAL', useValue: mockMetrics },
        {
          provide: 'PROM_METRIC_ORCHESTRATOR_FALLBACK_SUCCESS_TOTAL',
          useValue: mockMetrics,
        },
        {
          provide: 'PROM_METRIC_ORCHESTRATOR_FALLBACK_DURATION_SECONDS',
          useValue: mockMetrics,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    orchestrator = app.get<OrchestratorService>(OrchestratorService);
    providerFactory = app.get<ProviderFactoryService>(ProviderFactoryService);
    aiExecution = app.get(AIExecutionService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Provider Selection', () => {
    it('should select Cursor for high complexity tasks', async () => {
      const selection = await providerFactory.selectProvider({
        correlationId: 'test-corr-1',
        executionId: 'exec-1',
        ticketId: 'ticket-1',
        prompt:
          'Refactor the entire authentication module to use OAuth 2.0 with multiple providers',
        repositoryUrl: 'https://github.com/test/repo.git',
        title: 'Refactor authentication module',
        tags: ['architecture', 'refactor'],
        acceptanceCriteria:
          '- OAuth 2.0 support\n- Multiple providers\n- Token refresh\n- Session management\n- Audit logging',
        estimatedFilesCount: 8,
      });

      expect(selection.primary).toBe(AIProvider.CURSOR_HEADLESS);
      expect(selection.complexityGrade).toBe(ComplexityGrade.HIGH);
      expect(selection.fallback).toBe(AIProvider.CLAUDE_CODE);
    });

    it('should select Claude for low complexity tasks', async () => {
      const selection = await providerFactory.selectProvider({
        correlationId: 'test-corr-2',
        executionId: 'exec-2',
        ticketId: 'ticket-2',
        prompt: 'Add a helper function to format dates',
        repositoryUrl: 'https://github.com/test/repo.git',
        title: 'Add date formatter',
        tags: ['simple', 'bugfix'],
        acceptanceCriteria: '- Format dates correctly',
        estimatedFilesCount: 1,
      });

      expect(selection.primary).toBe(AIProvider.CLAUDE_CODE);
      expect(selection.reason).toBe(ProviderSelectionReason.COST_OPTIMIZATION);
      expect(selection.fallback).toBe(AIProvider.CURSOR_HEADLESS);
    });

    it('should respect provider override', async () => {
      const selection = await providerFactory.selectProvider({
        correlationId: 'test-corr-3',
        executionId: 'exec-3',
        ticketId: 'ticket-3',
        prompt: 'Simple task',
        repositoryUrl: 'https://github.com/test/repo.git',
        providerOverride: AIProvider.CURSOR_HEADLESS,
      });

      expect(selection.primary).toBe(AIProvider.CURSOR_HEADLESS);
      expect(selection.reason).toBe(ProviderSelectionReason.OVERRIDE);
    });
  });

  describe('Provider Availability', () => {
    it('should return availability for all providers', async () => {
      const availability = await providerFactory.getAllProvidersAvailability();

      expect(availability).toHaveLength(2);

      const cursor = availability.find((a) => a.provider === AIProvider.CURSOR_HEADLESS);
      const claude = availability.find((a) => a.provider === AIProvider.CLAUDE_CODE);

      expect(cursor).toBeDefined();
      expect(claude).toBeDefined();
      expect(cursor?.isAvailable).toBe(true);
    });
  });

  describe('Full Orchestration Flow', () => {
    it('should execute successfully with primary provider', async () => {
      aiExecution.executeWithProvider.mockResolvedValue({
        success: true,
        codeDiff: 'diff --git a/src/utils.ts b/src/utils.ts\n+export function hello() {}',
        filesChanged: ['src/utils.ts'],
        confidenceScore: 0.9,
        durationMs: 30000,
        workspacePath: '/tmp/workspace',
      });

      const result = await orchestrator.execute({
        correlationId: 'test-corr-4',
        executionId: 'exec-4',
        ticketId: 'ticket-4',
        prompt: 'Add a hello function',
        repositoryUrl: 'https://github.com/test/repo.git',
        allowFallback: true,
      });

      expect(result.success).toBe(true);
      expect(result.usedFallback).toBe(false);
      expect(result.filesChanged).toContain('src/utils.ts');
      expect(result.estimatedCostCents).toBeGreaterThan(0);
    });

    it('should track metrics after execution', async () => {
      aiExecution.executeWithProvider.mockResolvedValue({
        success: true,
        codeDiff: 'diff',
        filesChanged: ['file.ts'],
        confidenceScore: 0.85,
        durationMs: 25000,
        workspacePath: '/tmp/ws',
      });

      await orchestrator.execute({
        correlationId: 'test-corr-5',
        executionId: 'exec-5',
        ticketId: 'ticket-5',
        prompt: 'Simple fix',
        repositoryUrl: 'https://github.com/test/repo.git',
      });

      const metrics = orchestrator.getMetrics();

      expect(metrics.totalExecutions).toBeGreaterThanOrEqual(1);
      expect(metrics.providerUsage).toBeDefined();
    });
  });

  describe('Orchestration Metrics', () => {
    it('should track execution metrics', () => {
      const metrics = orchestrator.getMetrics();

      expect(metrics.totalExecutions).toBeGreaterThanOrEqual(0);
      expect(metrics.successfulExecutions).toBeGreaterThanOrEqual(0);
      expect(metrics.fallbackTriggers).toBeGreaterThanOrEqual(0);
      expect(metrics.fallbackSuccessRate).toBeGreaterThanOrEqual(0);
      expect(metrics.providerUsage).toHaveProperty('CURSOR_HEADLESS');
      expect(metrics.providerUsage).toHaveProperty('CLAUDE_CODE');
      expect(metrics.avgExecutionTimeMs).toHaveProperty('CURSOR_HEADLESS');
      expect(metrics.avgExecutionTimeMs).toHaveProperty('CLAUDE_CODE');
    });
  });

  describe('Fallback Scenarios', () => {
    it('should fallback when primary provider fails', async () => {
      // First call fails, second succeeds
      aiExecution.executeWithProvider
        .mockResolvedValueOnce({
          success: false,
          codeDiff: null,
          filesChanged: [],
          confidenceScore: 0,
          durationMs: 300000,
          workspacePath: '/tmp/ws1',
          error: {
            code: AIErrorCode.TIMEOUT,
            message: 'Execution timed out',
            isRetryable: true,
          },
        })
        .mockResolvedValueOnce({
          success: true,
          codeDiff: 'diff --git ...',
          filesChanged: ['src/main.ts'],
          confidenceScore: 0.8,
          durationMs: 45000,
          workspacePath: '/tmp/ws2',
        });

      const result = await orchestrator.execute({
        correlationId: 'test-corr-6',
        executionId: 'exec-6',
        ticketId: 'ticket-6',
        prompt: 'Complex task',
        repositoryUrl: 'https://github.com/test/repo.git',
        tags: ['architecture'],
        allowFallback: true,
      });

      expect(result.success).toBe(true);
      expect(result.usedFallback).toBe(true);
      expect(result.fallbackAttempts.length).toBeGreaterThan(0);
    });
  });
});
