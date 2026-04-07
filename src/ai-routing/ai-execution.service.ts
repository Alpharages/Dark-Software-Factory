/**
 * AI Execution Service
 * Story 2.6: AI Provider Integration - Cursor CLI Headless Mode
 *
 * Orchestrates AI code generation across providers.
 * Coordinates with ExecutionService for status tracking.
 *
 * FR65: Execute AI code generation
 */

import { Injectable, Logger } from '@nestjs/common';
import { IAIProvider, IAIExecutionInput, IProviderHealthStatus } from './interfaces';
import { ClaudeCodeProvider } from './providers';
import { ExecutionService } from '../execution/execution.service';
import { AICostTrackerService } from '../cost-tracking/ai-cost-tracker.service';
import { AIProvider } from '@/prisma/enums';

@Injectable()
export class AIExecutionService {
  private readonly logger = new Logger(AIExecutionService.name);

  /** Provider registry */
  private readonly providers: Map<AIProvider, IAIProvider> = new Map();

  constructor(
    private readonly claudeProvider: ClaudeCodeProvider,
    private readonly executionService: ExecutionService,
    private readonly costTracker: AICostTrackerService,
  ) {
    // Register Claude Code via adapter
    this.providers.set(AIProvider.CLAUDE_CODE, {
      provider: AIProvider.CLAUDE_CODE,
      maxConcurrent: 5,
      defaultTimeoutMs: 3600 * 1000,
      execute: async (input: IAIExecutionInput) => {
        // Build basic payload from input for legacy compatibility
        return this.claudeProvider.execute({
          ticketId: input.ticketId,
          executionId: input.executionId,
          aiProvider: AIProvider.CLAUDE_CODE,
          priority: 1,
          prompt: input.prompt,
          repositoryUrl: input.repositoryUrl,
          projectId: '',
          targetBranch: input.baseBranch,
          targetFiles: input.targetFiles,
          complexityScore: 5, // Default complexity
        });
      },
      checkHealth: async () => {
        const isHealthy = await this.claudeProvider.isHealthy();
        return {
          provider: AIProvider.CLAUDE_CODE,
          isHealthy,
          lastSuccessAt: isHealthy ? new Date() : null,
          lastFailureAt: isHealthy ? null : new Date(),
          consecutiveFailures: isHealthy ? 0 : 1,
          circuitState: isHealthy ? 'CLOSED' : 'OPEN',
          activeExecutions: 0,
        };
      },
      cancel: async () => {
        this.logger.log(`Cancel requested for Claude execution, not supported in legacy adapter`);
      },
    } as IAIProvider);
  }

  /**
   * Get provider instance for specialized orchestration (Story 14.1 Fix)
   */
  getProvider(provider: AIProvider): IAIProvider | undefined {
    this.logger.log(`Provider requested: ${provider}`);
    return this.providers.get(provider);
  }

  /**
   * Get provider health status
   */
  async getProviderHealth(provider: AIProvider): Promise<IProviderHealthStatus | null> {
    const aiProvider = this.providers.get(provider);
    if (!aiProvider) {
      return null;
    }
    return aiProvider.checkHealth();
  }

  /**
   * Get all providers health
   */
  async getAllProvidersHealth(): Promise<IProviderHealthStatus[]> {
    const health: IProviderHealthStatus[] = [];

    for (const provider of this.providers.values()) {
      health.push(await provider.checkHealth());
    }

    return health;
  }

  /**
   * Cancel an ongoing execution
   */
  async cancelExecution(
    provider: AIProvider,
    executionId: string,
    correlationId: string,
  ): Promise<void> {
    const aiProvider = this.providers.get(provider);
    if (aiProvider) {
      await aiProvider.cancel(executionId);
    }

    await this.executionService.cancelExecution(executionId, 'Cancelled by user', correlationId);
  }

  /**
   * Check if provider is available
   */
  async isProviderAvailable(provider: AIProvider): Promise<boolean> {
    const health = await this.getProviderHealth(provider);
    return health?.isHealthy ?? false;
  }
}
