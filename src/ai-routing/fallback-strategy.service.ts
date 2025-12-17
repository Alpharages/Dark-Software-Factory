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
import {
  IOrchestrationInput,
  IAIExecutionResult,
  IFallbackAttempt,
  AIErrorCode,
} from './interfaces';
import { AIExecutionService } from './ai-execution.service';

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
    private readonly aiExecution: AIExecutionService,
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
   * Execute with fallback strategy
   */
  async executeWithFallback(
    primary: AIProvider,
    fallback: AIProvider | null,
    input: IOrchestrationInput,
  ): Promise<IFallbackExecutionResult> {
    const { correlationId } = input;
    const fallbackAttempts: IFallbackAttempt[] = [];
    const startTime = Date.now();

    // Build execution input (strip orchestration-specific fields)
    const executionInput = {
      correlationId: input.correlationId,
      executionId: input.executionId,
      ticketId: input.ticketId,
      prompt: input.prompt,
      repositoryUrl: input.repositoryUrl,
      baseBranch: input.baseBranch,
      targetFiles: input.targetFiles,
      timeoutMs: input.timeoutMs,
    };

    // Try primary provider
    this.logger.log(`[${correlationId}] Executing with primary provider: ${primary}`);

    const primaryResult = await this.aiExecution.executeWithProvider(primary, executionInput);

    if (primaryResult.success) {
      return {
        result: primaryResult,
        executedBy: primary,
        usedFallback: false,
        fallbackAttempts: [],
      };
    }

    // Primary failed - check if fallback is allowed and available
    if (input.allowFallback === false || !fallback) {
      this.logger.warn(`[${correlationId}] Primary failed, no fallback available or allowed`);
      return {
        result: primaryResult,
        executedBy: primary,
        usedFallback: false,
        fallbackAttempts: [],
      };
    }

    // Check if error is retryable
    const isRetryable = primaryResult.error?.isRetryable ?? true;

    if (!isRetryable) {
      this.logger.warn(
        `[${correlationId}] Primary failed with non-retryable error, not attempting fallback`,
      );
      return {
        result: primaryResult,
        executedBy: primary,
        usedFallback: false,
        fallbackAttempts: [],
      };
    }

    // Record fallback attempt
    fallbackAttempts.push({
      provider: primary,
      error: primaryResult.error?.message || 'Unknown error',
      wasRetryable: isRetryable,
      durationMs: primaryResult.durationMs,
      timestamp: new Date(),
    });

    // Increment fallback counter
    this.fallbackCounter.inc({
      from_provider: primary,
      to_provider: fallback,
      reason: primaryResult.error?.code || 'UNKNOWN',
    });

    // Wait before fallback (optional delay)
    if (this.fallbackDelayMs > 0) {
      await this.delay(this.fallbackDelayMs);
    }

    // Try fallback provider
    this.logger.log(`[${correlationId}] Primary failed, falling back to: ${fallback}`);

    const fallbackResult = await this.aiExecution.executeWithProvider(fallback, executionInput);

    const totalDuration = (Date.now() - startTime) / 1000;
    this.fallbackDuration.observe({ from_provider: primary, to_provider: fallback }, totalDuration);

    if (fallbackResult.success) {
      this.fallbackSuccessCounter.inc({
        from_provider: primary,
        to_provider: fallback,
      });

      this.logger.log(`[${correlationId}] Fallback successful with ${fallback}`);
    } else {
      // Both failed - record second failure
      fallbackAttempts.push({
        provider: fallback,
        error: fallbackResult.error?.message || 'Unknown error',
        wasRetryable: fallbackResult.error?.isRetryable ?? false,
        durationMs: fallbackResult.durationMs,
        timestamp: new Date(),
      });

      this.logger.error(`[${correlationId}] Both providers failed - escalating to human review`);
    }

    return {
      result: fallbackResult,
      executedBy: fallback,
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
