/**
 * Base AI Provider
 *
 * Abstract base class for all AI providers (Claude Code, Cursor, future providers)
 * Provides shared progress emission logic to ensure consistent UX across all providers
 */

import { Injectable } from '@nestjs/common';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import {
  IAIProvider,
  IAIExecutionInput,
  IAIExecutionResult,
  IProviderHealthStatus,
} from '@/ai-routing/interfaces';
import { AIProvider } from '@/prisma/client';

/**
 * Standardized execution stages with consistent percentage mapping
 * All providers emit progress at these stages
 */
export enum ExecutionStage {
  CONTAINER_SPAWN = 'CONTAINER_SPAWN',
  AI_PLANNING = 'AI_PLANNING',
  AI_WRITING_CODE = 'AI_WRITING_CODE',
  AI_VERIFICATION = 'AI_VERIFICATION',
}

/**
 * Stage configuration for progress emissions
 */
interface StageConfig {
  message: string;
  percentage: number;
}

/**
 * Abstract base class for AI providers
 * Implements shared progress tracking functionality
 */
@Injectable()
export abstract class BaseAIProvider implements IAIProvider {
  protected abstract readonly executionTracker: ExecutionTrackerService;

  // Abstract properties that providers must implement
  abstract readonly provider: AIProvider;
  abstract readonly maxConcurrent: number;
  abstract readonly defaultTimeoutMs: number;

  /**
   * Emit progress at specific execution stages
   * Provides consistent progress updates across all providers
   *
   * @param executionId Execution ID
   * @param ticketId Ticket ID
   * @param stage Execution stage from ExecutionStage enum
   * @param customMessage Optional custom message (overrides default)
   */
  protected async emitStageProgress(
    executionId: string,
    ticketId: string,
    stage: ExecutionStage,
    customMessage?: string,
  ): Promise<void> {
    const { message, percentage } = this.getStageConfig(stage);

    await this.executionTracker.emitProgress(
      executionId,
      ticketId,
      null, // projectId resolved by tracker from execution record
      customMessage || message,
      percentage,
    );
  }

  /**
   * Get stage configuration (message and percentage)
   * Centralized mapping ensures consistency across all providers
   */
  private getStageConfig(stage: ExecutionStage): StageConfig {
    const stageMap: Record<ExecutionStage, StageConfig> = {
      [ExecutionStage.CONTAINER_SPAWN]: {
        message: 'Spawning Container',
        percentage: 25,
      },
      [ExecutionStage.AI_PLANNING]: {
        message: 'Planning Changes',
        percentage: 35,
      },
      [ExecutionStage.AI_WRITING_CODE]: {
        message: 'Writing Code',
        percentage: 55,
      },
      [ExecutionStage.AI_VERIFICATION]: {
        message: 'Running Verification',
        percentage: 75,
      },
    };

    // eslint-disable-next-line security/detect-object-injection
    return stageMap[stage];
  }

  // Abstract methods that providers must implement
  abstract execute(input: IAIExecutionInput): Promise<IAIExecutionResult>;
  abstract checkHealth(): Promise<IProviderHealthStatus>;
  abstract cancel(executionId: string): Promise<void>;
}
