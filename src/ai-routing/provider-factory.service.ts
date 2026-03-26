/**
 * Provider Factory Service
 * Story 2.8: Multi-Provider Orchestration & Fallback Logic
 *
 * Selects the optimal AI provider based on task complexity and availability.
 * Implements intelligent routing with fallback support.
 *
 * FR60: Route to appropriate AI tool based on task complexity
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@/prisma/client';
import { Counter } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import {
  IProviderSelection,
  IProviderAvailability,
  ProviderSelectionReason,
  ComplexityGrade,
  IOrchestrationInput,
} from './interfaces';
import { AIExecutionService } from './ai-execution.service';
import { ComplexityScorerService } from './complexity-scorer.service';
import { IRoutingRequest } from './interfaces/ai-routing.interface';
import { ICodingAgentProvider } from './interfaces/coding-agent-provider.interface';
import { ProviderName } from '@/ai-routing/enums/provider-name.enum';
import { ClaudeCodeProvider } from './providers/claude-code.provider';
import { GeminiProvider } from './providers/gemini.provider';

@Injectable()
export class ProviderFactoryService {
  private readonly logger = new Logger(ProviderFactoryService.name);

  /** Complexity thresholds */
  private readonly HIGH_COMPLEXITY_THRESHOLD: number;
  private readonly MEDIUM_COMPLEXITY_THRESHOLD: number;
  private readonly codingProviders: Map<ProviderName, ICodingAgentProvider>;

  constructor(
    private readonly config: ConfigService,
    private readonly aiExecution: AIExecutionService,
    private readonly complexityScorer: ComplexityScorerService,
    @InjectMetric('orchestrator_provider_selections_total')
    private readonly selectionsCounter: Counter<string>,
    private readonly claudeCodeProvider: ClaudeCodeProvider,
    private readonly geminiProvider: GeminiProvider,
  ) {
    this.HIGH_COMPLEXITY_THRESHOLD = this.config.get<number>(
      'orchestrator.complexityThresholdHigh',
      10,
    );
    this.MEDIUM_COMPLEXITY_THRESHOLD = this.config.get<number>(
      'orchestrator.complexityThresholdMedium',
      5,
    );
    this.codingProviders = new Map<ProviderName, ICodingAgentProvider>([
      [ProviderName.CLAUDE_CODE, claudeCodeProvider],
      [ProviderName.GEMINI, geminiProvider],
    ]);
  }

  getCodingProvider(name: ProviderName): ICodingAgentProvider | undefined {
    return this.codingProviders.get(name);
  }

  /**
   * Select optimal provider for the given orchestration input
   */
  async selectProvider(input: IOrchestrationInput): Promise<IProviderSelection> {
    const { correlationId, providerOverride, preCalculatedComplexity } = input;

    // Handle manual override
    if (providerOverride) {
      this.logger.log(`[${correlationId}] Provider override: ${providerOverride}`);
      this.selectionsCounter.inc({
        reason: ProviderSelectionReason.OVERRIDE,
        provider: providerOverride,
      });

      return {
        primary: providerOverride,
        fallback: this.getFallbackFor(providerOverride),
        reason: ProviderSelectionReason.OVERRIDE,
        complexityScore: preCalculatedComplexity ?? 0,
        complexityGrade: ComplexityGrade.MEDIUM,
      };
    }

    // Calculate complexity if not pre-calculated
    let complexityScore: number;
    if (preCalculatedComplexity !== undefined) {
      complexityScore = preCalculatedComplexity;
    } else {
      const routingRequest = this.buildRoutingRequest(input);
      const complexityResult = this.complexityScorer.calculateComplexity(
        routingRequest,
        correlationId,
      );
      complexityScore = complexityResult.totalScore;
    }

    // Determine grade
    const grade = this.getComplexityGrade(complexityScore);

    // Check provider availability
    const claudeAvailable = await this.aiExecution.isProviderAvailable(AIProvider.CLAUDE_CODE);

    // Select based on availability and complexity
    const selection = this.selectByComplexityAndAvailability(
      correlationId,
      complexityScore,
      grade,
      claudeAvailable,
    );

    this.logger.log(
      `[${correlationId}] Provider selected: ${selection.primary} ` +
        `(complexity=${complexityScore}, grade=${grade}, reason=${selection.reason})`,
    );

    this.selectionsCounter.inc({
      reason: selection.reason,
      provider: selection.primary,
    });

    return selection;
  }

  /**
   * Build IRoutingRequest from orchestration input
   */
  private buildRoutingRequest(input: IOrchestrationInput): IRoutingRequest {
    return {
      correlationId: input.correlationId,
      ticketId: input.ticketId,
      clickupTaskId: input.ticketId, // Use ticketId as fallback
      projectId: 'default', // Not available in orchestration context
      title: input.title || '',
      description: input.prompt, // Use prompt as description
      acceptanceCriteria: input.acceptanceCriteria || '',
      tags: input.tags || [],
      qualityScore: 100, // Default to good quality
      qualityGrade: 'good',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Determine complexity grade from score
   */
  private getComplexityGrade(score: number): ComplexityGrade {
    if (score >= this.HIGH_COMPLEXITY_THRESHOLD) {
      return ComplexityGrade.HIGH;
    }
    if (score >= this.MEDIUM_COMPLEXITY_THRESHOLD) {
      return ComplexityGrade.MEDIUM;
    }
    return ComplexityGrade.LOW;
  }

  /**
   * Select provider based on complexity and availability
   */
  private selectByComplexityAndAvailability(
    correlationId: string,
    score: number,
    grade: ComplexityGrade,
    _claudeAvailable: boolean,
  ): IProviderSelection {
    // Check which providers are ENABLED in configuration
    const claudeEnabled = this.config.get<boolean>('ai.providers.claudeCode.enabled', false);

    // Neither enabled - return error case
    if (!claudeEnabled) {
      this.logger.error(`[${correlationId}] No providers ENABLED in configuration!`);
      throw new Error('No AI providers enabled. Set CLAUDE_CODE_ENABLED=true');
    }

    // Simplified for OS-4.1 — full routing in OS-4.4
    return {
      primary: AIProvider.CLAUDE_CODE,
      fallback: null,
      reason: ProviderSelectionReason.SINGLE_PROVIDER,
      complexityScore: score,
      complexityGrade: grade,
    };
  }

  private getFallbackFor(_provider: AIProvider): AIProvider | null {
    // Current simplified fallback logic - always null for now as only Claude is active
    return null;
  }

  /**
   * Get all providers availability status
   */
  async getAllProvidersAvailability(): Promise<IProviderAvailability[]> {
    const providers = [AIProvider.CLAUDE_CODE, AIProvider.GEMINI];
    const availability: IProviderAvailability[] = [];

    for (const provider of providers) {
      const health = await this.aiExecution.getProviderHealth(provider);

      availability.push({
        provider,
        isAvailable: health?.isHealthy ?? false,
        unavailableReason: health?.isHealthy ? undefined : 'Provider unhealthy',
        circuitState: health?.circuitState ?? 'OPEN',
        queueDepth: health?.activeExecutions ?? 0,
        estimatedWaitMs: this.estimateWaitTime(health?.activeExecutions ?? 0),
      });
    }

    return availability;
  }

  /**
   * Estimate wait time based on queue depth
   * Rough estimate: 60 seconds per queued item
   */
  private estimateWaitTime(queueDepth: number): number {
    return queueDepth * 60_000;
  }
}
