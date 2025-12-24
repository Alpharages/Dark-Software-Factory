import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { createHash } from 'crypto';
import { Prisma } from '@/prisma/client';
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
import { MetricsService } from '@/common/metrics/metrics.service';
import { AI_PROVIDER_RATES } from '@/common/metrics/metrics.constants';
import { ConfigService } from '@nestjs/config';

/**
 * Cost Optimizer Service
 * Story 13.2: Select optimal AI models based on complexity score
 *
 * Model Selection Strategy:
 * - Simple (0-5): gpt-3.5-turbo ($0.15 input / $0.60 output per 1M tokens)
 * - Medium (6-12): claude-3-5-sonnet-20240620 ($3.00 input / $15.00 output per 1M tokens)
 * - Complex (13-20): gpt-4o ($5.00 input / $15.00 output per 1M tokens)
 */

export interface CachedResponse {
  response: unknown;
  costUsd: Decimal;
  cachedAt: Date;
  hits: number;
}

export interface OptimizationResult {
  selectedModel: string;
  originalModel: string;
  savingsUsd: number;
  bypassed: boolean;
}

@Injectable()
export class CostOptimizerService {
  private enabled: boolean;
  private cacheTtl: number;

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly metricsService: MetricsService,
    private readonly configService: ConfigService,
  ) {
    this.enabled = this.configService.get<boolean>('AI_COST_OPTIMIZATION_ENABLED', true);
    this.cacheTtl = this.configService.get<number>('AI_CACHE_TTL_SECONDS', 3600);
  }

  /**
   * Select optimal AI model based on complexity score
   * @param complexityScore 0-20 complexity score from ComplexityScorerService
   * @param ticketMeta Optional ticket metadata (checks for force_premium_model flag)
   * @returns Model name string (e.g., "gpt-3.5-turbo", "claude-3-5-sonnet-20240620", "gpt-4o")
   */
  selectOptimalModel(complexityScore: number, ticketMeta?: Record<string, unknown>): string {
    // Check bypass flags
    if (!this.enabled || this.shouldBypassOptimization(ticketMeta)) {
      return this.getPremiumModel();
    }

    // Select model based on complexity threshold
    if (complexityScore <= 5) {
      return 'gpt-3.5-turbo'; // Cheapest for simple tasks
    } else if (complexityScore <= 12) {
      return 'claude-3-5-sonnet-20240620'; // Mid-tier for medium complexity
    } else {
      return 'gpt-4o'; // Premium for complex tasks
    }
  }

  /**
   * Get cached AI response (if exists)
   * @param prompt AI prompt text
   * @returns Cached response or null
   */
  async getCachedResponse(prompt: string): Promise<CachedResponse | null> {
    if (this.shouldSkipCache(prompt)) {
      this.metricsService.incrementCounter('ai_cache_misses_total', {
        operation_type: 'cache_bypassed',
      });
      return null;
    }

    const cacheKey = this.generateCacheKey(prompt);
    const cached = await this.cacheManager.get<CachedResponse>(cacheKey);

    if (cached) {
      // Increment hits counter
      cached.hits += 1;
      await this.cacheManager.set(cacheKey, cached, this.cacheTtl * 1000);

      this.metricsService.incrementCounter('ai_cache_hits_total', {
        operation_type: 'prompt_cache',
      });

      return cached;
    }

    this.metricsService.incrementCounter('ai_cache_misses_total', {
      operation_type: 'prompt_cache',
    });

    return null;
  }

  /**
   * Cache AI response for reuse
   * @param prompt AI prompt text
   * @param response AI response object
   * @param costUsd Cost in USD (Decimal)
   */
  async cacheResponse(prompt: string, response: unknown, costUsd: Decimal): Promise<void> {
    if (this.shouldSkipCache(prompt)) {
      return;
    }

    const cacheKey = this.generateCacheKey(prompt);
    const cached: CachedResponse = {
      response,
      costUsd,
      cachedAt: new Date(),
      hits: 0,
    };

    await this.cacheManager.set(cacheKey, cached, this.cacheTtl * 1000);
  }

  /**
   * Track cost savings from using cheaper model
   * @param originalModel Model that would have been used (e.g., "gpt-4o")
   * @param selectedModel Model actually selected (e.g., "gpt-3.5-turbo")
   * @param inputTokens Number of input tokens
   * @param outputTokens Number of output tokens
   * @param projectId Project ID for labeling
   */
  trackCostSavings(
    originalModel: string,
    selectedModel: string,
    inputTokens: number,
    outputTokens: number,
    projectId: string,
  ): number {
    const originalCost = this.calculateCost(originalModel, inputTokens, outputTokens);
    const optimizedCost = this.calculateCost(selectedModel, inputTokens, outputTokens);
    const savings = originalCost.minus(optimizedCost).toNumber();

    // Only record savings if positive (no point recording negative savings)
    if (savings > 0) {
      this.metricsService.incrementGauge('ai_cost_savings_total', savings, {
        original_model: originalModel,
        selected_model: selectedModel,
        project_id: projectId,
      });
    }

    return savings;
  }

  /**
   * Calculate cost for given model and token usage
   * @param modelName AI model name
   * @param inputTokens Number of input tokens
   * @param outputTokens Number of output tokens
   * @returns Cost in USD as Decimal
   */
  private calculateCost(modelName: string, inputTokens: number, outputTokens: number): Decimal {
    const rates =
      // eslint-disable-next-line security/detect-object-injection
      (AI_PROVIDER_RATES as Record<string, { input: number; output: number }>)[modelName] ||
      AI_PROVIDER_RATES.default;
    const inputCost = (inputTokens / 1000000) * rates.input;
    const outputCost = (outputTokens / 1000000) * rates.output;
    return new Decimal(inputCost + outputCost);
  }

  /**
   * Check if cost optimization should be bypassed
   * @param ticketMeta Ticket metadata
   * @returns True if should bypass optimization
   */
  private shouldBypassOptimization(ticketMeta?: Record<string, unknown>): boolean {
    return ticketMeta?.force_premium_model === true;
  }

  /**
   * Check if prompt should skip cache (contains non-idempotent keywords)
   * @param prompt AI prompt text
   * @returns True if should skip cache
   */
  private shouldSkipCache(prompt: string): boolean {
    // Use regex to catch ID variations: ticketId, ticket_id, ticket-id, TICKET_ID, etc.
    const bypassPatterns = [/ticket[_-]?id/i, /execution[_-]?id/i, /timestamp/i, /\bunique\b/i];
    return bypassPatterns.some((pattern) => pattern.test(prompt));
  }

  /**
   * Generate SHA-256 hash of prompt for cache key
   * @param prompt AI prompt text
   * @returns SHA-256 hash string
   */
  private generateCacheKey(prompt: string): string {
    return createHash('sha256').update(prompt).digest('hex');
  }

  /**
   * Get premium model for bypass scenarios
   * @returns Premium model name
   */
  private getPremiumModel(): string {
    return 'gpt-4o';
  }
}
