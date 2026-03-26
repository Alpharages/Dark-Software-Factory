/**
 * Fallback Strategy Service
 * Story 2.8: Multi-Provider Orchestration & Fallback Logic
 *
 * Handles automatic fallback to secondary provider when primary fails.
 * Tracks fallback metrics for monitoring and optimization.
 *
 * FR60: Automatic fallback on provider failure
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@/prisma/client';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { IAIExecutionResult, IFallbackAttempt, AIErrorCode } from './interfaces';
import { ICodingAgentProvider } from './interfaces/coding-agent-provider.interface';
import { IAIExecutionPayload } from '@/execution/interfaces';

/**
 * Result from fallback execution
 */
export interface IFallbackExecutionResult {
  result: IAIExecutionResult;
  executedBy: AIProvider;
  usedFallback: boolean;
  fallbackAttempts: IFallbackAttempt[];
}

@Injectable()
export class FallbackStrategyService {
  private readonly logger = new Logger(FallbackStrategyService.name);

  /** Configuration */
  /**
   * Maximum fallback attempts allowed.
   * Currently supports single fallback (primary → fallback).
   * Reserved for future multi-attempt retry loop in Story 2.9.
   */
  private readonly maxFallbackAttempts: number;
  private readonly fallbackDelayMs: number;

  constructor(
    private readonly config: ConfigService,
    @InjectMetric('orchestrator_fallback_total')
    private readonly fallbackCounter: Counter<string>,
    @InjectMetric('orchestrator_fallback_success_total')
    private readonly fallbackSuccessCounter: Counter<string>,
    @InjectMetric('orchestrator_fallback_duration_seconds')
    private readonly fallbackDuration: Histogram<string>,
  ) {
    this.maxFallbackAttempts = this.config.get<number>('orchestrator.maxFallbackAttempts', 2);
    this.fallbackDelayMs = this.config.get<number>('orchestrator.fallbackDelayMs', 1000);
  }

  /**
   * Execute with fallback for ICodingAgentProvider implementations (FR-OS29)
   * No provider-specific logic — works with any ICodingAgentProvider.
   */
  async executeWithFallbackCodingProvider(
    primary: ICodingAgentProvider,
    fallback: ICodingAgentProvider | null,
    payload: IAIExecutionPayload,
  ): Promise<IFallbackExecutionResult> {
    const fallbackAttempts: IFallbackAttempt[] = [];
    const startTime = Date.now();

    this.logger.log(
      `[${payload.executionId}] Executing with coding provider: ${primary.providerName}`,
    );

    const primaryResult = await primary.execute(payload);

    if (primaryResult.success) {
      return {
        result: primaryResult,
        executedBy: primary.providerName as unknown as AIProvider,
        usedFallback: false,
        fallbackAttempts: [],
      };
    }

    if (payload.allowFallback === false || !fallback) {
      this.logger.warn(
        `[${payload.executionId}] Coding provider failed, no fallback available or allowed`,
      );
      return {
        result: primaryResult,
        executedBy: primary.providerName as unknown as AIProvider,
        usedFallback: false,
        fallbackAttempts: [],
      };
    }

    const isRetryable = primaryResult.error?.isRetryable ?? false;

    if (!isRetryable) {
      this.logger.warn(`[${payload.executionId}] Coding provider failed with non-retryable error`);
      return {
        result: primaryResult,
        executedBy: primary.providerName as unknown as AIProvider,
        usedFallback: false,
        fallbackAttempts: [],
      };
    }

    fallbackAttempts.push({
      provider: primary.providerName as unknown as AIProvider,
      error: primaryResult.error?.message || 'Unknown error',
      wasRetryable: isRetryable,
      durationMs: primaryResult.durationMs,
      timestamp: new Date(),
    });

    this.fallbackCounter.inc({
      from_provider: primary.providerName,
      to_provider: fallback.providerName,
      reason: primaryResult.error?.code || 'UNKNOWN',
    });

    if (this.fallbackDelayMs > 0) {
      await this.delay(this.fallbackDelayMs);
    }

    this.logger.log(
      `[${payload.executionId}] Falling back to coding provider: ${fallback.providerName}`,
    );

    const fallbackResult = await fallback.execute(payload);

    const totalDuration = (Date.now() - startTime) / 1000;
    this.fallbackDuration.observe(
      { from_provider: primary.providerName, to_provider: fallback.providerName },
      totalDuration,
    );

    if (fallbackResult.success) {
      this.fallbackSuccessCounter.inc({
        from_provider: primary.providerName,
        to_provider: fallback.providerName,
      });
      this.logger.log(`[${payload.executionId}] Fallback successful with ${fallback.providerName}`);
    } else {
      fallbackAttempts.push({
        provider: fallback.providerName as unknown as AIProvider,
        error: fallbackResult.error?.message || 'Unknown error',
        wasRetryable: fallbackResult.error?.isRetryable ?? false,
        durationMs: fallbackResult.durationMs,
        timestamp: new Date(),
      });
      this.logger.error(
        `[${payload.executionId}] Both coding providers failed - escalating to DLQ`,
      );
    }

    return {
      result: fallbackResult,
      executedBy: fallback.providerName as unknown as AIProvider,
      usedFallback: true,
      fallbackAttempts,
    };
  }

  /**
   * Check if an error should trigger fallback
   */
  shouldFallback(error: { code: AIErrorCode; isRetryable: boolean }): boolean {
    // Non-retryable errors should not trigger fallback
    if (!error.isRetryable) {
      return false;
    }

    // Specific codes that should trigger fallback
    const fallbackCodes: AIErrorCode[] = [
      AIErrorCode.TIMEOUT,
      AIErrorCode.PROCESS_CRASH,
      AIErrorCode.NO_CHANGES,
      AIErrorCode.WORKSPACE_LIMIT,
    ];

    return fallbackCodes.includes(error.code);
  }

  /**
   * Get maximum fallback attempts configured
   */
  getMaxFallbackAttempts(): number {
    return this.maxFallbackAttempts;
  }

  /**
   * Helper delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
