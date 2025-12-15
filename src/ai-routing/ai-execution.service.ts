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
import { AIProvider } from '@prisma/client';
import {
  IAIProvider,
  IAIExecutionInput,
  IAIExecutionResult,
  IProviderHealthStatus,
  AIErrorCode,
} from './interfaces';
import { CursorHeadlessProvider, ClaudeCodeProvider } from './providers';
import { ExecutionService } from '../execution/execution.service';
import { CompleteExecutionDto, FailExecutionDto } from '../execution/dto';

@Injectable()
export class AIExecutionService {
  private readonly logger = new Logger(AIExecutionService.name);

  /** Provider registry */
  private readonly providers: Map<AIProvider, IAIProvider> = new Map();

  constructor(
    private readonly cursorProvider: CursorHeadlessProvider,
    private readonly claudeProvider: ClaudeCodeProvider,
    private readonly executionService: ExecutionService,
  ) {
    // Register providers
    this.providers.set(AIProvider.CURSOR_HEADLESS, this.cursorProvider);
    this.providers.set(AIProvider.CLAUDE_CODE, this.claudeProvider);
  }

  /**
   * Execute AI code generation with the specified provider
   */
  async executeWithProvider(
    provider: AIProvider,
    input: IAIExecutionInput,
  ): Promise<IAIExecutionResult> {
    const { correlationId, executionId } = input;

    this.logger.log(`[${correlationId}] Executing with provider: ${provider}`);

    // Get provider
    const aiProvider = this.providers.get(provider);
    if (!aiProvider) {
      throw new Error(`Provider not registered: ${provider}`);
    }

    // FIX: Check current execution status before attempting transition
    // QA automation reuses execution IDs, so skip state management if already terminal
    const currentExecution = await this.executionService.getExecution(executionId);
    const isTerminalStatus =
      currentExecution && this.executionService.isTerminal(currentExecution.status);

    // Only mark as in progress if not already in a terminal state
    if (!isTerminalStatus) {
      await this.executionService.markInProgress(executionId, correlationId);
    } else {
      this.logger.debug(
        `[${correlationId}] Skipping markInProgress for execution ${executionId} - already in terminal state: ${currentExecution.status}`,
      );
    }

    try {
      // Execute
      const result = await aiProvider.execute(input);

      // Only update execution status if we're managing this execution
      if (!isTerminalStatus) {
        // Update execution status based on result
        if (result.success) {
          const completeDto: CompleteExecutionDto = {
            executionId,
            codeOutput: result.codeDiff || '',
            filesChanged: result.filesChanged,
            confidenceScore: result.confidenceScore,
          };
          await this.executionService.completeExecution(completeDto, correlationId);
        } else {
          const failDto: FailExecutionDto = {
            executionId,
            errorMessage: result.error?.message || 'Unknown error',
            errorCode: result.error?.code,
          };
          await this.executionService.failExecution(
            failDto,
            correlationId,
            result.error?.isRetryable ?? true,
          );
        }
      } else {
        this.logger.debug(
          `[${correlationId}] Skipping status update for terminal execution ${executionId}`,
        );
      }

      return result;
    } catch (error: unknown) {
      // Handle unexpected errors
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Only update status if we're managing this execution
      if (!isTerminalStatus) {
        const failDto: FailExecutionDto = {
          executionId,
          errorMessage,
          errorCode: AIErrorCode.UNKNOWN,
        };
        await this.executionService.failExecution(failDto, correlationId, true);
      }

      throw error;
    }
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
