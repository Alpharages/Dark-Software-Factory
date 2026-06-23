import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { ExecutionStatus, Execution } from '@/prisma/client';
import { ExecutionTrackerService } from './execution-tracker.service';
import {
  IStartExecutionInput,
  IExecutionCompletion,
  IExecutionFailure,
  IExecutionTimeout,
  IStateTransition,
  IExecutionProgress,
} from './interfaces';
import { QAAttempt } from './interfaces'; // WR-6.3
import { isFinalExecutionStatus } from './enums';
import {
  StartExecutionDto,
  CompleteExecutionDto,
  FailExecutionDto,
  ExecutionResponseDto,
} from './dto';
import { EventBusService } from '@/common/event-bus.service';
import { ExecutionCompletedEvent } from './events/execution-completed.event';
import { ExecutionLogStreamingService } from './services/execution-log-streaming.service';

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
    private readonly eventBus: EventBusService,
    private readonly logStreamingService: ExecutionLogStreamingService,
  ) {
    this.logger.log('ExecutionService initialized');
  }

  /**
   * Start a new AI execution
   *
   * Task 20-3: Prevent duplicate executions
   * - Checks for active executions before starting new ones
   *
   * @param dto - Execution start parameters
   * @returns Created execution record
   * @throws ConflictException if there's an active execution for the ticket
   */
  async startExecution(dto: StartExecutionDto): Promise<ExecutionResponseDto> {
    this.logger.log(`[${dto.correlationId}] Starting execution for ticket ${dto.ticketId}`);

    // Task 20-3: Check for duplicate active executions before starting
    const { hasDuplicate, existingExecution } = await this.checkDuplicateExecution(dto.ticketId);
    if (hasDuplicate && existingExecution) {
      throw new ConflictException(
        `Cannot start new execution for ticket ${dto.ticketId}: ` +
          `existing execution ${existingExecution.id} is currently ${existingExecution.status}. ` +
          `Only one active execution per ticket is allowed.`,
      );
    }

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
      feedback: dto.feedback,
    };

    const execution = await this.tracker.startExecution(input);

    await this.logStreamingService.emitLog(
      execution.id,
      'INFO',
      `Starting execution for ticket ${dto.ticketId}`,
      'system',
      dto.ticketId,
    );

    // Note: Lifecycle events (execution.started, execution.progress) are emitted
    // by ExecutionTrackerService via RealtimeService on the default namespace.

    return this.toResponseDto(execution);
  }

  /**
   * Mark execution as in progress
   */
  async markInProgress(executionId: string, correlationId: string): Promise<IStateTransition> {
    this.logger.log(`[${correlationId}] Marking execution ${executionId} as in progress`);
    const transition = await this.tracker.markInProgress(executionId, correlationId);

    await this.logStreamingService.emitLog(
      executionId,
      'INFO',
      'Execution marked as IN_PROGRESS',
      'system',
    );

    // Note: Lifecycle events are emitted by ExecutionTrackerService via RealtimeService.

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

    await this.logStreamingService.emitLog(
      dto.executionId,
      'INFO',
      'Execution completed successfully',
      'system',
    );

    // Note: Lifecycle events (execution.completed) are emitted
    // by ExecutionTrackerService via RealtimeService on the default namespace.

    // Story 3.7 AC#1: Emit event for QA check request after successful execution
    try {
      const execution = await this.tracker.getExecution(dto.executionId);
      if (execution) {
        this.eventBus.emit(
          'execution.completed',
          new ExecutionCompletedEvent(
            dto.executionId,
            execution.ticket_id,
            execution.ticket_id, // projectId placeholder
            dto.filesChanged,
            dto.codeOutput,
            execution.ai_provider,
            correlationId,
          ),
        );
        this.logger.log(
          `[${correlationId}] Emitted execution.completed event for ${dto.executionId}`,
        );
      }
    } catch (_error) {
      this.logger.error(
        `[${correlationId}] Failed to emit execution.completed event: ${(_error as Error).message}`,
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

    await this.logStreamingService.emitError(
      dto.executionId,
      'SYSTEM_ERROR',
      dto.errorMessage,
      null,
      null,
      null,
      isRetryable,
    );

    // Note: Lifecycle events (execution.failed) are emitted
    // by ExecutionTrackerService via RealtimeService on the default namespace.

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

    await this.logStreamingService.emitError(
      executionId,
      'TIMEOUT_ERROR',
      `Execution timed out after ${timeoutSeconds}s`,
      null,
    );

    // Note: Lifecycle events (execution.timeout) are emitted
    // by ExecutionTrackerService via RealtimeService on the default namespace.

    return result;
  }

  async cancelExecution(
    executionId: string,
    reason: string,
    correlationId: string,
  ): Promise<IStateTransition> {
    this.logger.log(`[${correlationId}] Cancelling execution ${executionId}`);
    const result = await this.tracker.cancelExecution(executionId, reason, correlationId);

    await this.logStreamingService.emitLog(
      executionId,
      'WARN',
      `Execution cancelled: ${reason}`,
      'user', // Assuming user initiated cancellation
    );

    // Note: Lifecycle events (execution.cancelled) are emitted
    // by ExecutionTrackerService via RealtimeService on the default namespace.

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
   * Get all active executions
   */
  async getActiveExecutions(): Promise<ExecutionResponseDto[]> {
    const executions = await this.tracker.getActiveExecutions();
    return executions.map((e) => this.toResponseDto(e));
  }

  /**
   * Whether a NEW execution may be started given the latest execution's status.
   *
   * Since OHP-3.2 retired the bespoke state machine, this answers "is the
   * previous run finished?" rather than "may THIS run transition to
   * IN_PROGRESS" — a new run is only allowed once the prior one is final.
   */
  canStart(status: ExecutionStatus): boolean {
    return this.isTerminal(status);
  }

  /**
   * Check if execution can be completed
   */
  canComplete(status: ExecutionStatus): boolean {
    return status === ExecutionStatus.IN_PROGRESS;
  }

  /**
   * Check if execution is in a final state (no further processing/intervention)
   */
  isTerminal(status: ExecutionStatus): boolean {
    return isFinalExecutionStatus(status);
  }

  /**
   * Convert Prisma model to response DTO
   */
  private toResponseDto(execution: Execution): ExecutionResponseDto {
    return {
      id: execution.id,
      ticketId: execution.ticket_id,
      aiProvider: execution.ai_provider,
      status: execution.status,
      confidenceScore: execution.confidence_score,
      startTime: execution.started_at,
      completedAt: execution.completed_at,
      failedAt: execution.failed_at,
      errorMessage: execution.error_message,
      retryCount: execution.retry_count,
      filesChanged: execution.files_changed as string[] | null,
      createdAt: execution.created_at,
      updatedAt: execution.updated_at,
      currentStep:
        (execution.progress as unknown as IExecutionProgress)?.currentStep ?? 'Initializing...',
      percentComplete: (execution.progress as unknown as IExecutionProgress)?.percentComplete ?? 0,
      qaAttempts: execution.qa_attempts as unknown as QAAttempt[] | null, // WR-6.3
    };
  }
  /**
   * Resume execution for a ticket (after approval)
   */
  async resumeExecution(ticketId: string): Promise<void> {
    this.logger.log(`Resuming execution for ticket ${ticketId}`);

    // Find the latest execution
    const executions = await this.tracker.getExecutionsForTicket(ticketId);
    // Sort by created_at desc
    const latest = executions.sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];

    if (
      latest &&
      (latest.status === ExecutionStatus.AWAITING_APPROVAL ||
        latest.status === ExecutionStatus.FAILED)
    ) {
      // Transition to QUEUED
      await this.tracker.updateStatus(latest.id, ExecutionStatus.QUEUED);

      // Emit progress via tracker's RealtimeService path (default namespace).
      // projectId=null → tracker.emitProgress resolves it from DB.
      await this.tracker.emitProgress(
        latest.id,
        latest.ticket_id,
        null,
        'Resuming execution',
        0,
        ExecutionStatus.QUEUED,
      );

      // Trigger processing (Placeholder: depends on how queue consumption works.
      // Often updating status to QUEUED is enough if poller picks it up.
      // If RMQ driven, might need to republish. Assuming Tracker/Poller picks up QUEUED items.)
    } else {
      this.logger.warn(`No resumable execution found for ticket ${ticketId}`);
    }
  }

  /**
   * Check for duplicate active executions for a ticket
   * Task 20-3: Prevent duplicate executions - Check Execution DB before starting new jobs
   *
   * Uses optimized query that only fetches active executions from database.
   *
   * @param ticketId - Ticket ID to check
   * @returns Object with hasDuplicate flag and existing execution info if found
   */
  async checkDuplicateExecution(ticketId: string): Promise<{
    hasDuplicate: boolean;
    existingExecution: ExecutionResponseDto | null;
  }> {
    // Use optimized query that only fetches active executions
    const activeExecution = await this.tracker.findActiveExecution(ticketId);

    if (activeExecution) {
      this.logger.warn(
        `Duplicate execution prevented for ticket ${ticketId}: existing ${activeExecution.id} is ${activeExecution.status}`,
      );
      return {
        hasDuplicate: true,
        existingExecution: this.toResponseDto(activeExecution),
      };
    }

    return { hasDuplicate: false, existingExecution: null };
  }

  /**
   * Check if a new execution can be started for a ticket
   * Only allows new execution if previous is in terminal state or explicitly forcing
   *
   * @param ticketId - Ticket ID to check
   * @param force - Whether to force new execution even if recently completed (bypasses warnings)
   * @returns true if execution can start
   * @throws ConflictException if there's an active execution
   */
  async canStartExecution(ticketId: string, force = false): Promise<boolean> {
    const { hasDuplicate, existingExecution } = await this.checkDuplicateExecution(ticketId);

    if (hasDuplicate && existingExecution) {
      throw new ConflictException(
        `Cannot start new execution for ticket ${ticketId}: ` +
          `existing execution ${existingExecution.id} is currently ${existingExecution.status}. ` +
          `Only one active execution per ticket is allowed.`,
      );
    }

    // If not forcing, check for recent completed executions to prevent accidental duplicates
    if (!force) {
      const executions = await this.tracker.getExecutionsForTicket(ticketId);
      const recentCompleted = executions.find(
        (e) =>
          e.status === ExecutionStatus.COMPLETED &&
          e.completed_at &&
          Date.now() - e.completed_at.getTime() < 5 * 60 * 1000, // 5 minutes
      );

      if (recentCompleted) {
        this.logger.warn(
          `Ticket ${ticketId} was recently completed (${recentCompleted.id}). ` +
            `Use force=true to bypass this warning.`,
        );
        // Return false to indicate execution should not proceed without force flag
        return false;
      }
    }

    return true;
  }
}
