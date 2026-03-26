/**
 * Fallback Strategy Service Unit Tests
 * Story 2.8: Multi-Provider Orchestration & Fallback Logic
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@/prisma/client';
import { FallbackStrategyService } from './fallback-strategy.service';
import { AIErrorCode } from './interfaces';

describe('FallbackStrategyService', () => {
  let service: FallbackStrategyService;

  const mockMetrics = {
    inc: jest.fn(),
    observe: jest.fn(),
    set: jest.fn(),
  };

  beforeEach(async () => {
    const mockConfig = {
      get: jest.fn((key: string, defaultValue: number) => defaultValue),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FallbackStrategyService,
        { provide: ConfigService, useValue: mockConfig },
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
  });

  describe('executeWithFallbackCodingProvider', () => {
    let mockPrimary: any;
    let mockFallback: any;
    const basePayload: any = {
      executionId: 'exec-test-123',
      correlationId: 'corr-123',
      allowFallback: true,
      ticket: { prompt: 'test' },
      repository: { url: 'https://test.git' },
    };

    beforeEach(() => {
      mockPrimary = {
        isEnabled: true,
        execute: jest.fn(),
      };
      mockFallback = {
        isEnabled: true,
        execute: jest.fn(),
      };
    });

    it('should succeed with primary provider without fallback', async () => {
      mockPrimary.execute.mockResolvedValue({
        success: true,
        codeDiff: 'diff',
        filesChanged: ['file.ts'],
        confidenceScore: 0.9,
        durationMs: 30000,
        workspacePath: '/tmp/workspace',
        executedBy: AIProvider.CLAUDE_CODE,
      });

      const result = await service.executeWithFallbackCodingProvider(
        mockPrimary,
        mockFallback,
        basePayload,
      );

      expect(result.result.success).toBe(true);
      expect(result.usedFallback).toBe(false);
      expect(result.fallbackAttempts).toHaveLength(0);
      expect(mockPrimary.execute).toHaveBeenCalledTimes(1);
      expect(mockFallback.execute).not.toHaveBeenCalled();
    });

    it('should fallback to secondary when primary fails with retryable error', async () => {
      mockPrimary.execute.mockResolvedValue({
        success: false,
        durationMs: 30000,
        executedBy: AIProvider.CLAUDE_CODE,
        error: { code: AIErrorCode.TIMEOUT, message: 'Timeout', isRetryable: true },
      });
      mockFallback.execute.mockResolvedValue({
        success: true,
        codeDiff: 'diff',
        filesChanged: ['file.ts'],
        confidenceScore: 0.9,
        durationMs: 40000,
        executedBy: AIProvider.GEMINI,
      });

      const result = await service.executeWithFallbackCodingProvider(
        mockPrimary,
        mockFallback,
        basePayload,
      );

      expect(result.result.success).toBe(true);
      expect(result.usedFallback).toBe(true);
      expect(result.fallbackAttempts).toHaveLength(1);
      expect(mockPrimary.execute).toHaveBeenCalledTimes(1);
      expect(mockFallback.execute).toHaveBeenCalledTimes(1);
    });

    it('should not fallback when primary fails with non-retryable error', async () => {
      mockPrimary.execute.mockResolvedValue({
        success: false,
        durationMs: 3000,
        executedBy: AIProvider.CLAUDE_CODE,
        error: { code: AIErrorCode.INVALID_PROMPT, message: 'Invalid', isRetryable: false },
      });

      const result = await service.executeWithFallbackCodingProvider(
        mockPrimary,
        mockFallback,
        basePayload,
      );

      expect(result.result.success).toBe(false);
      expect(result.usedFallback).toBe(false);
      expect(mockPrimary.execute).toHaveBeenCalledTimes(1);
      expect(mockFallback.execute).not.toHaveBeenCalled();
    });

    it('should not fallback when allowFallback is false in payload', async () => {
      mockPrimary.execute.mockResolvedValue({
        success: false,
        durationMs: 3000,
        executedBy: AIProvider.CLAUDE_CODE,
        error: { code: AIErrorCode.TIMEOUT, message: 'Timeout', isRetryable: true },
      });

      const result = await service.executeWithFallbackCodingProvider(mockPrimary, mockFallback, {
        ...basePayload,
        allowFallback: false,
      });

      expect(result.result.success).toBe(false);
      expect(result.usedFallback).toBe(false);
      expect(mockPrimary.execute).toHaveBeenCalledTimes(1);
      expect(mockFallback.execute).not.toHaveBeenCalled();
    });

    it('should not fallback when fallback provider is null', async () => {
      mockPrimary.execute.mockResolvedValue({
        success: false,
        durationMs: 3000,
        executedBy: AIProvider.CLAUDE_CODE,
        error: { code: AIErrorCode.TIMEOUT, message: 'Timeout', isRetryable: true },
      });

      const result = await service.executeWithFallbackCodingProvider(
        mockPrimary,
        null,
        basePayload,
      );

      expect(result.result.success).toBe(false);
      expect(result.usedFallback).toBe(false);
      expect(mockPrimary.execute).toHaveBeenCalledTimes(1);
    });

    it('should record both failures when both providers fail', async () => {
      mockPrimary.execute.mockResolvedValue({
        success: false,
        durationMs: 3000,
        executedBy: AIProvider.CLAUDE_CODE,
        error: { code: AIErrorCode.TIMEOUT, message: 'Timeout', isRetryable: true },
      });
      mockFallback.execute.mockResolvedValue({
        success: false,
        durationMs: 3000,
        executedBy: AIProvider.GEMINI,
        error: { code: AIErrorCode.PROCESS_CRASH, message: 'Crash', isRetryable: false },
      });

      const result = await service.executeWithFallbackCodingProvider(
        mockPrimary,
        mockFallback,
        basePayload,
      );

      expect(result.result.success).toBe(false);
      expect(result.usedFallback).toBe(true);
      expect(result.fallbackAttempts).toHaveLength(2);
      expect(mockPrimary.execute).toHaveBeenCalledTimes(1);
      expect(mockFallback.execute).toHaveBeenCalledTimes(1);
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
