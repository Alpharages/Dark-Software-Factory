import { Injectable, Logger } from '@nestjs/common';
import { ExecutionStatus, Execution } from '@/prisma/client';
import { ExecutionTrackerService } from './execution-tracker.service';
import { ExecutionStateMachine } from './state-machine';
import {
  IStartExecutionInput,
  IExecutionCompletion,
  IExecutionFailure,
  IExecutionTimeout,
  IStateTransition,
} from './interfaces';
import {
  StartExecutionDto,
  CompleteExecutionDto,
  FailExecutionDto,
  ExecutionResponseDto,
} from './dto';
import { ExecutionGateway } from './gateways/execution.gateway';
import { QaCheckPublisher } from '../qa-automation/qa-check.publisher';
import { ICodeFile } from '../qa-automation/interfaces';

/**
 * Execution Service
 *
 * Main orchestration service for AI execution lifecycle.
 * Coordinates between tracking, state machine, and external systems.
 *
 * FR62: System monitors AI execution progress
 */
@Injectable()
export class ExecutionService {
  private readonly logger = new Logger(ExecutionService.name);

  constructor(
    private readonly tracker: ExecutionTrackerService,
    private readonly stateMachine: ExecutionStateMachine,
    private readonly qaCheckPublisher: QaCheckPublisher,
    private readonly executionGateway: ExecutionGateway,
  ) {}

  /**
   * Start a new AI execution
   *
   * @param dto - Execution start parameters
   * @returns Created execution record
   */
  async startExecution(dto: StartExecutionDto): Promise<ExecutionResponseDto> {
    this.logger.log(`[${dto.correlationId}] Starting execution for ticket ${dto.ticketId}`);

    const input: IStartExecutionInput = {
      correlationId: dto.correlationId,
      ticketId: dto.ticketId,
      clickupTaskId: dto.clickupTaskId,
      provider: dto.provider,
      prompt: dto.prompt,
      promptMetadata: {
        promptLength: dto.promptMetadata.promptLength,
        estimatedTokens: dto.promptMetadata.estimatedTokens,
        templateVersion: dto.promptMetadata.templateVersion,
        generatedAt: dto.promptMetadata.generatedAt,
      },
      complexityScore: dto.complexityScore,
    };

    const execution = await this.tracker.startExecution(input);

    try {
      this.executionGateway.emitProgress({
        executionId: execution.id,
        ticketId: execution.ticket_id,
        status: execution.status,
        timestamp: execution.created_at.toISOString(),
        aiProvider: execution.ai_provider,
      });
    } catch (e: any) {
      this.logger.error(`Failed to emit progress for execution ${execution.id}: ${e.message}`);
    }

    return this.toResponseDto(execution);
  }

  /**
   * Mark execution as in progress
   */
  async markInProgress(executionId: string, correlationId: string): Promise<IStateTransition> {
    this.logger.log(`[${correlationId}] Marking execution ${executionId} as in progress`);
    const transition = await this.tracker.markInProgress(executionId, correlationId);

    // Get execution to include provider in event
    const execution = await this.tracker.getExecution(executionId);
    if (execution) {
      try {
        this.executionGateway.emitProgress({
          executionId: execution.id,
          ticketId: execution.ticket_id,
          status: execution.status,
          timestamp: transition.transitionedAt.toISOString(),
          aiProvider: execution.ai_provider,
        });
      } catch (e: any) {
        this.logger.error(`Failed to emit progress for execution ${execution.id}: ${e.message}`);
      }
    }

    return transition;
  }

  /**
   * Complete execution with results
   * Story 3.7 Task 5: After completion, publish to QA queue
   */
  async completeExecution(
    dto: CompleteExecutionDto,
    correlationId: string,
  ): Promise<IStateTransition> {
    this.logger.log(`[${correlationId}] Completing execution ${dto.executionId}`);

    const completion: IExecutionCompletion = {
      executionId: dto.executionId,
      codeOutput: dto.codeOutput,
      filesChanged: dto.filesChanged,
      confidenceScore: dto.confidenceScore,
    };

    const result = await this.tracker.completeExecution(completion, correlationId);

    // Emit event
    const execution = await this.tracker.getExecution(dto.executionId);
    if (execution) {
      try {
        this.executionGateway.emitProgress({
          executionId: execution.id,
          ticketId: execution.ticket_id,
          status: execution.status,
          timestamp: result.transitionedAt.toISOString(),
          aiProvider: execution.ai_provider,
        });
        this.executionGateway.emitCompletion(execution.id, execution.ticket_id);
      } catch (e: any) {
        this.logger.error(
          `Failed to emit graduation events for execution ${execution.id}: ${e.message}`,
        );
      }
    }

    // Story 3.7 AC#1: Publish QA check request after successful execution
    try {
      // Get execution details to extract ticketId and provider
      const execution = await this.tracker.getExecution(dto.executionId);
      if (execution) {
        // TODO: Story 3.7 - Replace with actual file content extraction from codeOutput
        // For now, create mock ICodeFile objects from filesChanged array
        const codeFiles: ICodeFile[] = dto.filesChanged.map((filePath) => ({
          path: filePath,
          content: dto.codeOutput, // Simplified - should extract per-file content
          language: this.detectLanguage(filePath),
        }));

        // TODO: Story 3.7 - projectId should come from ticket or execution record
        // For now, using ticketId as placeholder
        const projectId = execution.ticket_id;

        await this.qaCheckPublisher.publishQaCheck(
          dto.executionId,
          execution.ticket_id,
          projectId,
          codeFiles,
          execution.ai_provider,
          correlationId,
        );

        this.logger.log(`[${correlationId}] Published QA check for execution ${dto.executionId}`);
      }
    } catch (error) {
      // Log error but don't fail execution completion
      this.logger.error(
        `[${correlationId}] Failed to publish QA check: ${(error as Error).message}`,
        (error as Error).stack,
      );
    }

    return result;
  }

  /**
   * Detect file language from extension
   * Story 3.7: Helper for codeFiles language detection
   */
  private detectLanguage(
    filePath: string,
  ): 'typescript' | 'javascript' | 'python' | 'go' | 'unknown' {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
        return 'javascript';
      case 'py':
        return 'python';
      case 'go':
        return 'go';
      default:
        return 'unknown';
    }
  }

  /**
   * Fail execution with error
   */
  async failExecution(
    dto: FailExecutionDto,
    correlationId: string,
    isRetryable: boolean = true,
  ): Promise<IStateTransition> {
    this.logger.log(`[${correlationId}] Failing execution ${dto.executionId}`);

    const failure: IExecutionFailure = {
      executionId: dto.executionId,
      errorMessage: dto.errorMessage,
      errorCode: dto.errorCode,
      isRetryable,
    };

    const result = await this.tracker.failExecution(failure, correlationId);

    const execution = await this.tracker.getExecution(dto.executionId);
    if (execution) {
      try {
        this.executionGateway.emitProgress({
          executionId: execution.id,
          ticketId: execution.ticket_id,
          status: execution.status,
          timestamp: result.transitionedAt.toISOString(),
          aiProvider: execution.ai_provider,
        });
      } catch (e: any) {
        this.logger.error(`Failed to emit progress for execution ${execution.id}: ${e.message}`);
      }
    }

    return result;
  }

  /**
   * Timeout execution
   */
  async timeoutExecution(
    executionId: string,
    timeoutSeconds: number,
    correlationId: string,
    lastKnownProgress?: string,
  ): Promise<IStateTransition> {
    this.logger.log(`[${correlationId}] Timing out execution ${executionId}`);

    const timeout: IExecutionTimeout = {
      executionId,
      timeoutSeconds,
      lastKnownProgress,
    };

    const result = await this.tracker.timeoutExecution(timeout, correlationId);

    const execution = await this.tracker.getExecution(executionId);
    if (execution) {
      try {
        this.executionGateway.emitProgress({
          executionId: execution.id,
          ticketId: execution.ticket_id,
          status: execution.status,
          timestamp: result.transitionedAt.toISOString(),
          aiProvider: execution.ai_provider,
        });
      } catch (e: any) {
        this.logger.error(`Failed to emit progress for execution ${execution.id}: ${e.message}`);
      }
    }

    return result;
  }

  async cancelExecution(
    executionId: string,
    reason: string,
    correlationId: string,
  ): Promise<IStateTransition> {
    this.logger.log(`[${correlationId}] Cancelling execution ${executionId}`);
    const result = await this.tracker.cancelExecution(executionId, reason, correlationId);

    const execution = await this.tracker.getExecution(executionId);
    if (execution) {
      try {
        this.executionGateway.emitProgress({
          executionId: execution.id,
          ticketId: execution.ticket_id,
          status: execution.status,
          timestamp: result.transitionedAt.toISOString(),
          aiProvider: execution.ai_provider,
        });
      } catch (e: any) {
        this.logger.error(`Failed to emit progress for execution ${execution.id}: ${e.message}`);
      }
    }

    return result;
  }

  /**
   * Get execution by ID
   */
  async getExecution(executionId: string): Promise<ExecutionResponseDto | null> {
    const execution = await this.tracker.getExecution(executionId);
    return execution ? this.toResponseDto(execution) : null;
  }

  /**
   * Get all executions for a ticket
   */
  async getExecutionsForTicket(ticketId: string): Promise<ExecutionResponseDto[]> {
    const executions = await this.tracker.getExecutionsForTicket(ticketId);
    return executions.map((e) => this.toResponseDto(e));
  }

  /**
   * Check if execution can be started
   */
  canStart(status: ExecutionStatus): boolean {
    return this.stateMachine.canStart(status);
  }

  /**
   * Check if execution can be completed
   */
  canComplete(status: ExecutionStatus): boolean {
    return this.stateMachine.canComplete(status);
  }

  /**
   * Check if execution is in terminal state
   */
  isTerminal(status: ExecutionStatus): boolean {
    return this.stateMachine.isTerminal(status);
  }

  /**
   * Convert Prisma model to response DTO
   */
  private toResponseDto(execution: Execution): ExecutionResponseDto {
    return {
      id: execution.id,
      ticketId: execution.ticket_id,
      provider: execution.ai_provider,
      status: execution.status,
      confidenceScore: execution.confidence_score,
      startedAt: execution.started_at,
      completedAt: execution.completed_at,
      failedAt: execution.failed_at,
      errorMessage: execution.error_message,
      retryCount: execution.retry_count,
      filesChanged: execution.files_changed as string[] | null,
      createdAt: execution.created_at,
      updatedAt: execution.updated_at,
    };
  }
}
