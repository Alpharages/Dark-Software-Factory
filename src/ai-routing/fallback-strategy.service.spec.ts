/**
 * Fallback Strategy Service Unit Tests
 * Story 2.8: Multi-Provider Orchestration & Fallback Logic
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@prisma/client';
import { FallbackStrategyService } from './fallback-strategy.service';
import { AIExecutionService } from './ai-execution.service';
import { IOrchestrationInput, AIErrorCode } from './interfaces';

describe('FallbackStrategyService', () => {
  let service: FallbackStrategyService;
  let aiExecution: jest.Mocked<AIExecutionService>;

  const mockMetrics = {
    inc: jest.fn(),
    observe: jest.fn(),
    set: jest.fn(),
  };

  const baseInput: IOrchestrationInput = {
    correlationId: 'corr-123',
    executionId: 'exec-456',
    ticketId: 'ticket-789',
    prompt: 'Add a function',
    repositoryUrl: 'https://github.com/test/repo.git',
    allowFallback: true,
  };

  beforeEach(async () => {
    const mockAIExecution = {
      executeWithProvider: jest.fn(),
    };

    const mockConfig = {
      get: jest.fn((key: string, defaultValue: number) => defaultValue),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FallbackStrategyService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: AIExecutionService, useValue: mockAIExecution },
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

    service = module.get<FallbackStrategyService>(FallbackStrategyService);
    aiExecution = module.get(AIExecutionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('executeWithFallback', () => {
    it('should succeed with primary provider without fallback', async () => {
      aiExecution.executeWithProvider.mockResolvedValue({
        success: true,
        codeDiff: 'diff --git a/file.ts b/file.ts',
        filesChanged: ['file.ts'],
        confidenceScore: 0.9,
        durationMs: 30000,
        workspacePath: '/tmp/workspace',
      });

      const result = await service.executeWithFallback(
        AIProvider.CURSOR_HEADLESS,
        AIProvider.CLAUDE_CODE,
        baseInput,
      );

      expect(result.result.success).toBe(true);
      expect(result.executedBy).toBe(AIProvider.CURSOR_HEADLESS);
      expect(result.usedFallback).toBe(false);
      expect(result.fallbackAttempts).toHaveLength(0);
      expect(aiExecution.executeWithProvider).toHaveBeenCalledTimes(1);
    });

    it('should fallback to secondary when primary fails with retryable error', async () => {
      // Primary fails with retryable error
      aiExecution.executeWithProvider
        .mockResolvedValueOnce({
          success: false,
          codeDiff: null,
          filesChanged: [],
          confidenceScore: 0,
          durationMs: 300000,
          workspacePath: '/tmp/workspace',
          error: {
            code: AIErrorCode.TIMEOUT,
            message: 'Execution timed out',
            isRetryable: true,
          },
        })
        // Fallback succeeds
        .mockResolvedValueOnce({
          success: true,
          codeDiff: 'diff --git a/file.ts b/file.ts',
          filesChanged: ['file.ts'],
          confidenceScore: 0.8,
          durationMs: 45000,
          workspacePath: '/tmp/workspace2',
        });

      const result = await service.executeWithFallback(
        AIProvider.CURSOR_HEADLESS,
        AIProvider.CLAUDE_CODE,
        baseInput,
      );

      expect(result.result.success).toBe(true);
      expect(result.executedBy).toBe(AIProvider.CLAUDE_CODE);
      expect(result.usedFallback).toBe(true);
      expect(result.fallbackAttempts).toHaveLength(1);
      expect(result.fallbackAttempts[0].provider).toBe(AIProvider.CURSOR_HEADLESS);
      expect(result.fallbackAttempts[0].wasRetryable).toBe(true);
      expect(aiExecution.executeWithProvider).toHaveBeenCalledTimes(2);
    });

    it('should not fallback when primary fails with non-retryable error', async () => {
      aiExecution.executeWithProvider.mockResolvedValue({
        success: false,
        codeDiff: null,
        filesChanged: [],
        confidenceScore: 0,
        durationMs: 5000,
        workspacePath: '/tmp/workspace',
        error: {
          code: AIErrorCode.INVALID_PROMPT,
          message: 'Invalid prompt format',
          isRetryable: false,
        },
      });

      const result = await service.executeWithFallback(
        AIProvider.CURSOR_HEADLESS,
        AIProvider.CLAUDE_CODE,
        baseInput,
      );

      expect(result.result.success).toBe(false);
      expect(result.executedBy).toBe(AIProvider.CURSOR_HEADLESS);
      expect(result.usedFallback).toBe(false);
      expect(result.fallbackAttempts).toHaveLength(0);
      expect(aiExecution.executeWithProvider).toHaveBeenCalledTimes(1);
    });

    it('should not fallback when allowFallback is false', async () => {
      const inputNoFallback: IOrchestrationInput = {
        ...baseInput,
        allowFallback: false,
      };

      aiExecution.executeWithProvider.mockResolvedValue({
        success: false,
        codeDiff: null,
        filesChanged: [],
        confidenceScore: 0,
        durationMs: 300000,
        workspacePath: '/tmp/workspace',
        error: {
          code: AIErrorCode.TIMEOUT,
          message: 'Timeout',
          isRetryable: true,
        },
      });

      const result = await service.executeWithFallback(
        AIProvider.CURSOR_HEADLESS,
        AIProvider.CLAUDE_CODE,
        inputNoFallback,
      );

      expect(result.result.success).toBe(false);
      expect(result.usedFallback).toBe(false);
      expect(aiExecution.executeWithProvider).toHaveBeenCalledTimes(1);
    });

    it('should not fallback when no fallback provider is available', async () => {
      aiExecution.executeWithProvider.mockResolvedValue({
        success: false,
        codeDiff: null,
        filesChanged: [],
        confidenceScore: 0,
        durationMs: 300000,
        workspacePath: '/tmp/workspace',
        error: {
          code: AIErrorCode.TIMEOUT,
          message: 'Timeout',
          isRetryable: true,
        },
      });

      const result = await service.executeWithFallback(
        AIProvider.CURSOR_HEADLESS,
        null, // No fallback
        baseInput,
      );

      expect(result.result.success).toBe(false);
      expect(result.usedFallback).toBe(false);
      expect(aiExecution.executeWithProvider).toHaveBeenCalledTimes(1);
    });

    it('should record both failures when both providers fail', async () => {
      // Both providers fail
      aiExecution.executeWithProvider
        .mockResolvedValueOnce({
          success: false,
          codeDiff: null,
          filesChanged: [],
          confidenceScore: 0,
          durationMs: 300000,
          workspacePath: '/tmp/workspace',
          error: {
            code: AIErrorCode.TIMEOUT,
            message: 'Primary timeout',
            isRetryable: true,
          },
        })
        .mockResolvedValueOnce({
          success: false,
          codeDiff: null,
          filesChanged: [],
          confidenceScore: 0,
          durationMs: 60000,
          workspacePath: '/tmp/workspace2',
          error: {
            code: AIErrorCode.PROCESS_CRASH,
            message: 'Fallback crashed',
            isRetryable: false,
          },
        });

      const result = await service.executeWithFallback(
        AIProvider.CURSOR_HEADLESS,
        AIProvider.CLAUDE_CODE,
        baseInput,
      );

      expect(result.result.success).toBe(false);
      expect(result.usedFallback).toBe(true);
      expect(result.fallbackAttempts).toHaveLength(2);
      expect(result.fallbackAttempts[0].provider).toBe(AIProvider.CURSOR_HEADLESS);
      expect(result.fallbackAttempts[1].provider).toBe(AIProvider.CLAUDE_CODE);
    });
  });

  describe('shouldFallback', () => {
    it('should return true for retryable timeout error', () => {
      const result = service.shouldFallback({
        code: AIErrorCode.TIMEOUT,
        isRetryable: true,
      });
      expect(result).toBe(true);
    });

    it('should return true for retryable process crash', () => {
      const result = service.shouldFallback({
        code: AIErrorCode.PROCESS_CRASH,
        isRetryable: true,
      });
      expect(result).toBe(true);
    });

    it('should return true for no changes error', () => {
      const result = service.shouldFallback({
        code: AIErrorCode.NO_CHANGES,
        isRetryable: true,
      });
      expect(result).toBe(true);
    });

    it('should return false for non-retryable errors', () => {
      const result = service.shouldFallback({
        code: AIErrorCode.TIMEOUT,
        isRetryable: false,
      });
      expect(result).toBe(false);
    });

    it('should return false for invalid prompt errors', () => {
      const result = service.shouldFallback({
        code: AIErrorCode.INVALID_PROMPT,
        isRetryable: true,
      });
      expect(result).toBe(false);
    });
  });

  describe('getMaxFallbackAttempts', () => {
    it('should return configured max fallback attempts', () => {
      const max = service.getMaxFallbackAttempts();
      expect(max).toBe(2); // Default value
    });
  });
});
