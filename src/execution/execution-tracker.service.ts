import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ExecutionStatus, Execution } from '@/prisma/client';
import { Counter, Histogram, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { ExecutionRepository } from './execution.repository';
import { ExecutionStateMachine } from './state-machine';
import {
  IStartExecutionInput,
  IExecutionCompletion,
  IExecutionFailure,
  IExecutionTimeout,
  IExecutionEvent,
  IStateTransition,
} from './interfaces';

/**
 * Execution Tracker Service
 *
 * Core service for tracking AI execution state throughout the lifecycle.
 * FR62: System monitors AI execution progress
 *
 * Features:
 * - State machine-based transitions
 * - Audit logging for all changes
 * - RabbitMQ event emission
 * - Prometheus metrics tracking
 */
@Injectable()
export class ExecutionTrackerService implements OnModuleInit {
  private readonly logger = new Logger(ExecutionTrackerService.name);

  /** Queue for status change events */
  private readonly STATUS_QUEUE = 'execution-status-queue';

  constructor(
    private readonly repository: ExecutionRepository,
    private readonly stateMachine: ExecutionStateMachine,
    private readonly publisher: RabbitMQPublisherService,
    @InjectMetric('execution_total')
    private readonly executionCounter: Counter<string>,
    @InjectMetric('execution_duration_seconds')
    private readonly durationHistogram: Histogram<string>,
    @InjectMetric('execution_status_gauge')
    private readonly statusGauge: Gauge<string>,
    @InjectMetric('execution_retry_total')
    private readonly retryCounter: Counter<string>,
  ) { }

  async onModuleInit(): Promise<void> {
    this.logger.log('Execution Tracker Service initialized');
    await this.updateStatusGauges();
  }

  /**
   * Start a new execution
   * Creates execution record, logs to audit, emits event
   */
  async startExecution(input: IStartExecutionInput): Promise<Execution> {
    const { correlationId, ticketId, provider, prompt, complexityScore } = input;

    this.logger.log(
      `[${correlationId}] Starting execution for ticket ${ticketId} with ${provider}`,
    );

    // 1. Create execution record
    const execution = await this.repository.create({
      ticketId,
      provider,
      prompt,
      status: ExecutionStatus.QUEUED,
      complexityScore,
    });

    // 2. Log to audit
    await this.repository.createAuditLog({
      entityType: 'execution',
      entityId: execution.id,
      action: 'created',
      actorType: 'system',
      actorId: null,
      beforeState: null,
      afterState: {
        id: execution.id,
        ticketId,
        provider,
        status: ExecutionStatus.QUEUED,
        complexityScore,
      },
      createdAt: new Date(),
    });

    // 3. Emit event
    await this.emitExecutionEvent({
      eventType: 'EXECUTION_STARTED',
      correlationId,
      executionId: execution.id,
      ticketId,
      provider,
      status: ExecutionStatus.QUEUED,
      timestamp: new Date().toISOString(),
      payload: {
        complexityScore,
        promptLength: input.promptMetadata.promptLength,
        estimatedTokens: input.promptMetadata.estimatedTokens,
      },
    });

    // 4. Track metrics
    this.executionCounter.inc({ provider, status: 'started' });
    await this.updateStatusGauges();

    this.logger.log(`[${correlationId}] Execution ${execution.id} created with status QUEUED`);

    return execution;
  }

  /**
   * Transition execution to IN_PROGRESS
   */
  async markInProgress(executionId: string, correlationId: string): Promise<IStateTransition> {
    const execution = await this.getExecutionOrThrow(executionId);

    const transition = this.stateMachine.transition(
      executionId,
      execution.status,
      ExecutionStatus.IN_PROGRESS,
      'AI execution started',
    );

    await this.applyTransition(execution, transition, correlationId);
    return transition;
  }

  /**
   * Transition execution to AWAITING_APPROVAL
   * Story 5.3: Manual approval gate
   */
  async markAwaitingApproval(
    executionId: string,
    correlationId: string,
    reason: string = 'QA passed, awaiting manual approval',
  ): Promise<IStateTransition> {
    const execution = await this.getExecutionOrThrow(executionId);

    const transition = this.stateMachine.transition(
      executionId,
      execution.status,
      ExecutionStatus.AWAITING_APPROVAL,
      reason,
    );

    await this.applyTransition(execution, transition, correlationId);
    return transition;
  }

  /**
   * Complete execution successfully
   */
  async completeExecution(
    completion: IExecutionCompletion,
    correlationId: string,
  ): Promise<IStateTransition> {
    const { executionId, codeOutput, filesChanged, confidenceScore } = completion;
    const execution = await this.getExecutionOrThrow(executionId);

    const transition = this.stateMachine.transition(
      executionId,
      execution.status,
      ExecutionStatus.COMPLETED,
      'AI execution completed successfully',
    );

    // Update with completion data
    await this.repository.updateStatus(executionId, ExecutionStatus.COMPLETED, {
      codeOutput,
      filesChanged,
      confidenceScore,
    });

    // Calculate duration
    const durationMs = execution.started_at ? Date.now() - execution.started_at.getTime() : 0;
    const durationSec = durationMs / 1000;

    // Log audit
    await this.repository.createAuditLog({
      entityType: 'execution',
      entityId: executionId,
      action: 'completed',
      actorType: 'system',
      actorId: null,
      beforeState: { status: execution.status },
      afterState: {
        status: ExecutionStatus.COMPLETED,
        confidenceScore,
        filesChanged,
        durationSeconds: durationSec,
      },
      createdAt: new Date(),
    });

    // Update ticket status
    await this.repository.updateTicketStatus(execution.ticket_id, 'COMPLETED');

    // Emit event
    await this.emitExecutionEvent({
      eventType: 'EXECUTION_COMPLETED',
      correlationId,
      executionId,
      ticketId: execution.ticket_id,
      provider: execution.ai_provider,
      status: ExecutionStatus.COMPLETED,
      timestamp: new Date().toISOString(),
      payload: {
        confidenceScore,
        filesChanged,
        durationSeconds: durationSec,
      },
    });

    // Track metrics
    this.executionCounter.inc({ provider: execution.ai_provider, status: 'completed' });
    this.durationHistogram.observe(
      { provider: execution.ai_provider, status: 'completed' },
      durationSec,
    );
    await this.updateStatusGauges();

    this.logger.log(
      `[${correlationId}] Execution ${executionId} completed in ${durationSec.toFixed(2)}s ` +
      `(confidence: ${confidenceScore}, files: ${filesChanged.length})`,
    );

    return transition;
  }

  /**
   * Fail execution with error
   */
  async failExecution(
    failure: IExecutionFailure,
    correlationId: string,
  ): Promise<IStateTransition> {
    const { executionId, errorMessage, isRetryable, errorCode } = failure;
    const execution = await this.getExecutionOrThrow(executionId);

    const transition = this.stateMachine.transition(
      executionId,
      execution.status,
      ExecutionStatus.FAILED,
      errorMessage,
    );

    await this.repository.updateStatus(executionId, ExecutionStatus.FAILED, {
      errorMessage,
    });

    // Log audit
    await this.repository.createAuditLog({
      entityType: 'execution',
      entityId: executionId,
      action: 'failed',
      actorType: 'system',
      actorId: null,
      beforeState: { status: execution.status },
      afterState: {
        status: ExecutionStatus.FAILED,
        errorMessage,
        errorCode,
        isRetryable,
      },
      createdAt: new Date(),
    });

    // Update ticket status
    await this.repository.updateTicketStatus(execution.ticket_id, 'FAILED');

    // Emit event
    await this.emitExecutionEvent({
      eventType: 'EXECUTION_FAILED',
      correlationId,
      executionId,
      ticketId: execution.ticket_id,
      provider: execution.ai_provider,
      status: ExecutionStatus.FAILED,
      timestamp: new Date().toISOString(),
      payload: {
        errorMessage,
        errorCode,
        isRetryable,
        retryCount: execution.retry_count,
        maxRetries: execution.max_retries,
      },
    });

    // Track metrics
    this.executionCounter.inc({ provider: execution.ai_provider, status: 'failed' });
    await this.updateStatusGauges();

    // Auto-retry if eligible
    if (isRetryable) {
      const retryInfo = await this.repository.canRetry(executionId);
      if (retryInfo.canRetry) {
        this.logger.log(
          `[${correlationId}] Scheduling retry ${retryInfo.retryCount + 1}/${retryInfo.maxRetries}`,
        );
        await this.scheduleRetry(executionId, correlationId);
      } else {
        this.logger.warn(
          `[${correlationId}] Max retries (${retryInfo.maxRetries}) exceeded for ${executionId}`,
        );
      }
    }

    return transition;
  }

  /**
   * Mark execution as timed out
   */
  async timeoutExecution(
    timeout: IExecutionTimeout,
    correlationId: string,
  ): Promise<IStateTransition> {
    const { executionId, timeoutSeconds, lastKnownProgress } = timeout;
    const execution = await this.getExecutionOrThrow(executionId);

    const errorMessage =
      `Execution timed out after ${timeoutSeconds} seconds` +
      (lastKnownProgress ? ` (last progress: ${lastKnownProgress})` : '');

    const transition = this.stateMachine.transition(
      executionId,
      execution.status,
      ExecutionStatus.TIMEOUT,
      errorMessage,
    );

    await this.repository.updateStatus(executionId, ExecutionStatus.TIMEOUT, {
      errorMessage,
    });

    // Log audit
    await this.repository.createAuditLog({
      entityType: 'execution',
      entityId: executionId,
      action: 'failed',
      actorType: 'system',
      actorId: null,
      beforeState: { status: execution.status },
      afterState: {
        status: ExecutionStatus.TIMEOUT,
        errorMessage,
        timeoutSeconds,
      },
      createdAt: new Date(),
    });

    // Update ticket status
    await this.repository.updateTicketStatus(execution.ticket_id, 'TIMEOUT');

    // Emit event
    await this.emitExecutionEvent({
      eventType: 'EXECUTION_FAILED',
      correlationId,
      executionId,
      ticketId: execution.ticket_id,
      provider: execution.ai_provider,
      status: ExecutionStatus.TIMEOUT,
      timestamp: new Date().toISOString(),
      payload: {
        errorMessage,
        timeoutSeconds,
        lastKnownProgress,
      },
    });

    // Track metrics
    this.executionCounter.inc({ provider: execution.ai_provider, status: 'timeout' });
    this.durationHistogram.observe(
      { provider: execution.ai_provider, status: 'timeout' },
      timeoutSeconds,
    );
    await this.updateStatusGauges();

    // Auto-retry if eligible (TIMEOUT is retryable)
    const retryInfo = await this.repository.canRetry(executionId);
    if (retryInfo.canRetry) {
      this.logger.log(
        `[${correlationId}] Scheduling retry after timeout ${retryInfo.retryCount + 1}/${retryInfo.maxRetries}`,
      );
      await this.scheduleRetry(executionId, correlationId);
    } else {
      this.logger.warn(
        `[${correlationId}] Max retries (${retryInfo.maxRetries}) exceeded for timed out execution ${executionId}`,
      );
    }

    return transition;
  }

  /**
   * Cancel execution
   */
  async cancelExecution(
    executionId: string,
    reason: string,
    correlationId: string,
  ): Promise<IStateTransition> {
    const execution = await this.getExecutionOrThrow(executionId);

    const transition = this.stateMachine.transition(
      executionId,
      execution.status,
      ExecutionStatus.CANCELLED,
      reason,
    );

    await this.applyTransition(execution, transition, correlationId);

    this.executionCounter.inc({ provider: execution.ai_provider, status: 'cancelled' });
    await this.updateStatusGauges();

    return transition;
  }

  /**
   * Schedule a retry for failed execution
   */
  async scheduleRetry(executionId: string, correlationId: string): Promise<void> {
    const execution = await this.repository.incrementRetryAndRequeue(executionId);

    // Log audit
    await this.repository.createAuditLog({
      entityType: 'execution',
      entityId: executionId,
      action: 'retried',
      actorType: 'system',
      actorId: null,
      beforeState: { status: ExecutionStatus.FAILED },
      afterState: {
        status: ExecutionStatus.QUEUED,
        retryCount: execution.retry_count,
      },
      createdAt: new Date(),
    });

    // Track retry metric
    this.retryCounter.inc({ provider: execution.ai_provider });

    // Emit event for retry
    await this.emitExecutionEvent({
      eventType: 'STATUS_CHANGED',
      correlationId,
      executionId,
      ticketId: execution.ticket_id,
      provider: execution.ai_provider,
      status: ExecutionStatus.QUEUED,
      timestamp: new Date().toISOString(),
      payload: {
        retryCount: execution.retry_count,
        reason: 'Scheduled for retry',
      },
    });

    this.logger.log(
      `[${correlationId}] Execution ${executionId} scheduled for retry (attempt ${execution.retry_count})`,
    );
  }

  /**
   * Get execution by ID
   */
  async getExecution(executionId: string): Promise<Execution | null> {
    return this.repository.findById(executionId);
  }

  /**
   * Get executions for a ticket
   */
  async getExecutionsForTicket(ticketId: string): Promise<Execution[]> {
    return this.repository.findByTicketId(ticketId);
  }

  /**
   * Get execution or throw if not found
   */
  private async getExecutionOrThrow(executionId: string): Promise<Execution> {
    const execution = await this.repository.findById(executionId);
    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }
    return execution;
  }

  /**
   * Apply a state transition
   */
  private async applyTransition(
    execution: Execution,
    transition: IStateTransition,
    correlationId: string,
  ): Promise<void> {
    // Update status
    await this.repository.updateStatus(execution.id, transition.newStatus);

    // Log audit
    await this.repository.createAuditLog({
      entityType: 'execution',
      entityId: execution.id,
      action: 'status_changed',
      actorType: 'system',
      actorId: null,
      beforeState: { status: transition.previousStatus },
      afterState: { status: transition.newStatus, reason: transition.reason },
      createdAt: new Date(),
    });

    // Update ticket status
    await this.repository.updateTicketStatus(execution.ticket_id, transition.newStatus);

    // Emit event
    await this.emitExecutionEvent({
      eventType: 'STATUS_CHANGED',
      correlationId,
      executionId: execution.id,
      ticketId: execution.ticket_id,
      provider: execution.ai_provider,
      status: transition.newStatus,
      timestamp: transition.transitionedAt.toISOString(),
      payload: {
        previousStatus: transition.previousStatus,
        reason: transition.reason,
      },
    });
  }

  /**
   * Emit execution event to RabbitMQ
   */
  private async emitExecutionEvent(event: IExecutionEvent): Promise<void> {
    try {
      await this.publisher.publishToQueue(this.STATUS_QUEUE, event);
      this.logger.debug(
        `[${event.correlationId}] Emitted ${event.eventType} event for execution ${event.executionId}`,
      );
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(
          `[${event.correlationId}] Failed to emit event: ${error.message}`,
          error.stack,
        );
      } else {
        this.logger.error(
          `[${event.correlationId}] Failed to emit event with unknown error:`,
          error,
        );
      }
      // Don't throw - event emission failure shouldn't break execution tracking
    }
  }

  /**
   * Update Prometheus gauges for execution status counts
   */
  private async updateStatusGauges(): Promise<void> {
    try {
      const counts = await this.repository.getActiveCountByProvider();

      for (const [provider, count] of Object.entries(counts)) {
        this.statusGauge.set({ provider, status: 'active' }, count);
      }
    } catch (error) {
      if (error instanceof Error) {
        this.logger.error(`Failed to update status gauges: ${error.message}`, error.stack);
      } else {
        this.logger.error('Failed to update status gauges with unknown error:', error);
      }
    }
  }

  /**
   * Directly update execution status (for manual overrides/resumption)
   */
  async updateStatus(executionId: string, status: ExecutionStatus): Promise<Execution> {
    return this.repository.updateStatus(executionId, status);
  }
}
