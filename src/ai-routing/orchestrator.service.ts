/**
 * Orchestrator Service
 * Story 2.8: Multi-Provider Orchestration & Fallback Logic
 *
 * Main entry point for AI code generation.
 * Coordinates provider selection, execution, and fallback handling.
 *
 * FR60-65: AI code generation orchestration
 */

import { Injectable, Logger } from '@nestjs/common';
import { AIProvider } from '@prisma/client';
import { Counter, Histogram, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import {
  IOrchestrationInput,
  IOrchestrationResult,
  IOrchestrationMetrics,
  AIErrorCode,
} from './interfaces';
import { ProviderFactoryService } from './provider-factory.service';
import { FallbackStrategyService } from './fallback-strategy.service';

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  /** Metrics tracking */
  private totalExecutions = 0;
  private successfulExecutions = 0;
  private fallbackTriggers = 0;
  private fallbackSuccesses = 0;
  private providerUsage: Record<AIProvider, number> = {
    [AIProvider.CURSOR_HEADLESS]: 0,
    [AIProvider.CLAUDE_CODE]: 0,
  };
  private executionTimes: Record<AIProvider, number[]> = {
    [AIProvider.CURSOR_HEADLESS]: [],
    [AIProvider.CLAUDE_CODE]: [],
  };

  constructor(
    private readonly providerFactory: ProviderFactoryService,
    private readonly fallbackStrategy: FallbackStrategyService,
    @InjectMetric('orchestrator_executions_total')
    private readonly executionsCounter: Counter<string>,
    @InjectMetric('orchestrator_execution_duration_seconds')
    private readonly durationHistogram: Histogram<string>,
    @InjectMetric('orchestrator_cost_cents')
    private readonly costGauge: Gauge<string>,
  ) { }

  /**
   * Execute AI code generation with intelligent orchestration
   */
  async execute(input: IOrchestrationInput): Promise<IOrchestrationResult> {
    const { correlationId, ticketId, providerOverride } = input;

    const startTime = Date.now();
    this.totalExecutions++;

    this.logger.log(`[${correlationId}] Orchestrating AI execution for ticket ${ticketId}`);

    try {
      let selection: { primary: AIProvider; fallback: AIProvider | null; complexityScore: number };

      // Check if provider override is specified (e.g., for commit operations)
      if (providerOverride) {
        this.logger.log(`[${correlationId}] Using provider override: ${providerOverride}`);
        selection = {
          primary: providerOverride,
          fallback: null, // No fallback when using override
          complexityScore: 50, // Default complexity
        };
      } else {
        // 1. Select provider via AI routing
        selection = await this.providerFactory.selectProvider(input);

        this.logger.log(
          `[${correlationId}] Provider selected: primary=${selection.primary}, ` +
          `fallback=${selection.fallback}, complexity=${selection.complexityScore}`,
        );
      }

      // 2. Execute with fallback strategy
      const executionResult = await this.fallbackStrategy.executeWithFallback(
        selection.primary,
        selection.fallback,
        input,
      );

      // 3. Track metrics
      const totalDurationMs = Date.now() - startTime;
      this.trackExecution(executionResult, totalDurationMs);

      // 4. Build result
      const result: IOrchestrationResult = {
        success: executionResult.result.success,
        executedBy: executionResult.executedBy,
        usedFallback: executionResult.usedFallback,
        codeDiff: executionResult.result.codeDiff,
        filesChanged: executionResult.result.filesChanged,
        confidenceScore: executionResult.result.confidenceScore,
        durationMs: executionResult.result.durationMs,
        totalDurationMs,
        workspacePath: executionResult.result.workspacePath,
        fallbackAttempts: executionResult.fallbackAttempts,
        estimatedCostCents: this.estimateCost(executionResult.executedBy, totalDurationMs),
        error: executionResult.result.error,
      };

      if (result.success) {
        this.successfulExecutions++;
        this.executionsCounter.inc({
          status: 'success',
          provider: result.executedBy,
        });

        this.logger.log(
          `[${correlationId}] Orchestration successful: provider=${result.executedBy}, ` +
          `fallback=${result.usedFallback}, files=${result.filesChanged.length}`,
        );
      } else {
        this.executionsCounter.inc({
          status: 'failed',
          provider: result.executedBy,
        });

        this.logger.error(`[${correlationId}] Orchestration failed: ${result.error?.message}`);
      }

      this.durationHistogram.observe(
        { status: result.success ? 'success' : 'failed' },
        totalDurationMs / 1000,
      );

      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.executionsCounter.inc({ status: 'error', provider: 'none' });

      this.logger.error(`[${correlationId}] Orchestration error: ${errorMessage}`);

      return {
        success: false,
        executedBy: AIProvider.CURSOR_HEADLESS,
        usedFallback: false,
        codeDiff: null,
        filesChanged: [],
        confidenceScore: 0,
        durationMs: Date.now() - startTime,
        totalDurationMs: Date.now() - startTime,
        workspacePath: '',
        fallbackAttempts: [],
        estimatedCostCents: 0,
        error: {
          code: AIErrorCode.UNKNOWN,
          message: errorMessage,
          isRetryable: true,
        },
      };
    }
  }

  /**
   * Get current orchestration metrics
   */
  getMetrics(): IOrchestrationMetrics {
    return {
      totalExecutions: this.totalExecutions,
      successfulExecutions: this.successfulExecutions,
      fallbackTriggers: this.fallbackTriggers,
      fallbackSuccessRate:
        this.fallbackTriggers > 0 ? this.fallbackSuccesses / this.fallbackTriggers : 0,
      providerUsage: { ...this.providerUsage },
      avgExecutionTimeMs: this.calculateAvgExecutionTimes(),
    };
  }

  /**
   * Track execution metrics
   */
  private trackExecution(
    result: {
      executedBy: AIProvider;
      usedFallback: boolean;
      result: { success: boolean; durationMs: number };
    },
    totalDurationMs: number,
  ): void {
    this.providerUsage[result.executedBy]++;

    this.executionTimes[result.executedBy].push(result.result.durationMs);

    // Keep only last 100 execution times for average calculation

    if (this.executionTimes[result.executedBy].length > 100) {
      this.executionTimes[result.executedBy].shift();
    }

    if (result.usedFallback) {
      this.fallbackTriggers++;
      if (result.result.success) {
        this.fallbackSuccesses++;
      }
    }

    this.costGauge.set(this.estimateCost(result.executedBy, totalDurationMs));
  }

  /**
   * Calculate average execution times for each provider
   */
  private calculateAvgExecutionTimes(): Record<AIProvider, number> {
    // Use Map for safe iteration and storage
    const timesMap = new Map(Object.entries(this.executionTimes));
    const avgTimesMap = new Map<AIProvider, number>();

    for (const [provider, times] of timesMap.entries()) {
      const typedProvider = provider as AIProvider;
      if (times.length > 0) {
        avgTimesMap.set(typedProvider, times.reduce((a, b) => a + b, 0) / times.length);
      } else {
        // Default estimates when no data available
        avgTimesMap.set(
          typedProvider,
          typedProvider === AIProvider.CURSOR_HEADLESS ? 120_000 : 60_000,
        );
      }
    }

    return {
      [AIProvider.CURSOR_HEADLESS]: avgTimesMap.get(AIProvider.CURSOR_HEADLESS) ?? 120_000,
      [AIProvider.CLAUDE_CODE]: avgTimesMap.get(AIProvider.CLAUDE_CODE) ?? 60_000,
    };
  }

  /**
   * Estimate cost based on provider and duration
   */
  private estimateCost(provider: AIProvider, durationMs: number): number {
    // Rough cost estimates in cents
    switch (provider) {
      case AIProvider.CURSOR_HEADLESS:
        // Cursor: ~$0.05 per minute of execution
        return Math.ceil((durationMs / 60_000) * 5);
      case AIProvider.CLAUDE_CODE:
        // Claude: ~$0.20 per execution (token-based, avg estimate)
        return 20;
      default:
        return 0;
    }
  }

  /**
   * Get provider availability status
   */
  async getProviderAvailability() {
    return this.providerFactory.getAllProvidersAvailability();
  }
}
