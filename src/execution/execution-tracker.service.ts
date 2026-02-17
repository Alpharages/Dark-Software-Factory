import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExecutionStatus, Execution } from '@/prisma/client';
import { Counter, Histogram, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Observable, Subscription } from 'rxjs';
import { RabbitMQPublisherService } from '@/rabbitmq/rabbitmq-publisher.service';
import { ExecutionRepository } from './execution.repository';
import { ExecutionStateMachine } from './state-machine';
import { ExecutionGateway, LogLevel } from './gateways/execution.gateway';
import {
  IStartExecutionInput,
  IExecutionCompletion,
  IExecutionFailure,
  IExecutionTimeout,
  IExecutionEvent,
  IStateTransition,
} from './interfaces';
import { RealtimeService } from '@/realtime/realtime.service';
import {
  ExecutionStartedEvent,
  ExecutionCompletedEvent,
  ExecutionFailedEvent,
  ExecutionTimeoutEvent,
  ExecutionCancelledEvent,
  ExecutionProgressEvent,
} from '@/realtime/realtime.types';
import { AI_METRICS, CONTAINER_METRICS } from '@/common/metrics';

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

  /** Track active log subscriptions to prevent memory leaks */
  private activeLogSubscriptions = new Map<string, Subscription>();

  /** Track last progress emission to implement rate limiting */
  private lastProgressEmitMap = new Map<string, number>();

  /** Track last progress step to force emission on change */
  private lastProgressStepMap = new Map<string, string>();

  constructor(
    private readonly repository: ExecutionRepository,
    private readonly stateMachine: ExecutionStateMachine,
    private readonly publisher: RabbitMQPublisherService,
    private readonly configService: ConfigService,
    @InjectMetric(AI_METRICS.EXECUTIONS_TOTAL)
    private readonly executionCounter: Counter<string>,
    @InjectMetric(AI_METRICS.EXECUTION_DURATION)
    private readonly durationHistogram: Histogram<string>,
    @InjectMetric('dsf_execution_status_gauge')
    private readonly statusGauge: Gauge<string>,
    @InjectMetric('dsf_execution_retry_total')
    private readonly retryCounter: Counter<string>,
    @InjectMetric(CONTAINER_METRICS.LOG_BYTES_TOTAL)
    private readonly containerLogBytesCounter: Counter<string>,
    @InjectMetric(CONTAINER_METRICS.EXEC_DURATION_SECONDS)
    private readonly containerExecDurationHistogram: Histogram<string>,
    @InjectMetric('websocket_emission_errors_total')
    private readonly websocketEmissionErrorsCounter: Counter<string>,
    @Optional()
    private readonly executionGateway?: ExecutionGateway,
    @Optional()
    private readonly realtimeService?: RealtimeService,
  ) {}

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

    // Emit execution.started event (AC 4: Emitted when execution transitions to IN_PROGRESS)
    await this.emitWebSocketEvent<ExecutionStartedEvent>('execution.started', {
      executionId: execution.id,
      ticketId: execution.ticket_id,
      projectId: execution.ticket?.project_id || null,
      aiProvider: execution.ai_provider,
      startedAt: new Date().toISOString(),
      payload: {
        complexityScore: execution.complexity_score || undefined,
      },
    });

    // Determine initial status based on provider
    const initialStatus = 'Starting execution';

    // Emit initial progress event
    await this.emitProgress(
      executionId,
      execution.ticket_id,
      execution.ticket?.project_id || null,
      initialStatus,
      0,
    );

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

    try {
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
    } catch (e) {
      this.logger.error(`[${correlationId}] Error in completeExecution:`, e);
      throw e;
    }

    // Emit execution.completed event (AC 5)
    await this.emitWebSocketEvent<ExecutionCompletedEvent>('execution.completed', {
      executionId: executionId,
      ticketId: execution.ticket_id,
      projectId: execution.ticket?.project_id || null,
      provider: execution.ai_provider,
      status: ExecutionStatus.COMPLETED,
      timestamp: new Date().toISOString(),
      payload: {
        confidenceScore,
        filesChanged: filesChanged || [],
        durationSeconds: execution.started_at
          ? (Date.now() - execution.started_at.getTime()) / 1000
          : 0,
      },
    });

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

    try {
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
    } catch (e) {
      this.logger.error(`[${correlationId}] Error in failExecution:`, e);
      throw e;
    }

    // Emit execution.failed event (AC 5)
    await this.emitWebSocketEvent<ExecutionFailedEvent>('execution.failed', {
      executionId: executionId,
      ticketId: execution.ticket_id,
      projectId: execution.ticket?.project_id || null,
      provider: execution.ai_provider,
      status: ExecutionStatus.FAILED,
      timestamp: new Date().toISOString(),
      payload: {
        errorMessage,
        errorCode,
        isRetryable: isRetryable || false,
        retryCount: execution.retry_count,
        maxRetries: execution.max_retries,
      },
    });

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

    try {
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
    } catch (e) {
      this.logger.error(`[${correlationId}] Error in timeoutExecution:`, e);
      throw e;
    }

    // Emit execution.timeout event (AC 5)
    await this.emitWebSocketEvent<ExecutionTimeoutEvent>('execution.timeout', {
      executionId: executionId,
      ticketId: execution.ticket_id,
      projectId: execution.ticket?.project_id || null,
      provider: execution.ai_provider,
      status: ExecutionStatus.TIMEOUT,
      timestamp: new Date().toISOString(),
      payload: {
        errorMessage: `Execution timed out after ${timeout.timeoutSeconds} seconds`,
        timeoutSeconds: timeout.timeoutSeconds,
        lastKnownProgress: timeout.lastKnownProgress ? parseInt(timeout.lastKnownProgress, 10) : 0,
      },
    });

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

    try {
      await this.applyTransition(execution, transition, correlationId);

      this.executionCounter.inc({ provider: execution.ai_provider, status: 'cancelled' });
      await this.updateStatusGauges();
    } catch (e) {
      this.logger.error(`[${correlationId}] Error in cancelExecution:`, e);
      throw e;
    }

    // Emit execution.cancelled event (AC 5)
    await this.emitWebSocketEvent<ExecutionCancelledEvent>('execution.cancelled', {
      executionId: executionId,
      ticketId: execution.ticket_id,
      projectId: execution.ticket?.project_id || null,
      provider: execution.ai_provider,
      status: ExecutionStatus.CANCELLED,
      timestamp: new Date().toISOString(),
      payload: {
        reason,
        cancelledBy: 'system', // TODO: Pass user ID if available
      },
    });

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
   * Check if ticket has any active executions (Task 20-3)
   * More efficient than getExecutionsForTicket() when only checking existence
   */
  async hasActiveExecution(ticketId: string): Promise<boolean> {
    return this.repository.hasActiveExecution(ticketId);
  }

  /**
   * Find active execution for a ticket (Task 20-3)
   * Returns the most recent active execution or null
   */
  async findActiveExecution(ticketId: string): Promise<Execution | null> {
    return this.repository.findActiveExecutionByTicketId(ticketId);
  }

  /**
   * Get all active executions
   */
  async getActiveExecutions(): Promise<Execution[]> {
    return this.repository.findActiveExecutions();
  }

  /**
   * Assign container to execution (Story 23.2)
   * Stores container ID for later cleanup
   */
  async assignContainer(executionId: string, containerId: string): Promise<void> {
    await this.repository.update(executionId, { container_id: containerId });
    this.logger.log(`[${executionId}] Container ${containerId} assigned`);
  }

  /**
   * Get execution or throw if not found
   */
  private async getExecutionOrThrow(
    executionId: string,
  ): Promise<Execution & { ticket?: { project_id: string } }> {
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
    } catch (_error) {
      if (_error instanceof Error) {
        this.logger.error(
          `[${event.correlationId}] Failed to emit event: ${_error.message}`,
          _error.stack,
        );
      } else {
        this.logger.error(
          `[${event.correlationId}] Failed to emit event with unknown error:`,
          _error,
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
    } catch (_error) {
      if (_error instanceof Error) {
        this.logger.error(`Failed to update status gauges: ${_error.message}`, _error.stack);
      } else {
        this.logger.error('Failed to update status gauges with unknown error:', _error);
      }
    }
  }

  /**
   * Directly update execution status (for manual overrides/resumption)
   */
  async updateStatus(executionId: string, status: ExecutionStatus): Promise<Execution> {
    return this.repository.updateStatus(executionId, status);
  }

  /**
   * Stream execution logs from container output to WebSocket gateway
   * AC 1, 3, 5: Pipe container output to ExecutionGateway for real-time streaming
   *
   * @param executionId Execution ID
   * @param ticketId Ticket ID
   * @param output$ Observable stream of output data
   * @param source 'stdout' or 'stderr'
   * @returns Subscription that can be unsubscribed to stop streaming
   */
  streamExecutionLogs(
    executionId: string,
    ticketId: string,
    output$: Observable<string>,
    source: 'stdout' | 'stderr' = 'stdout',
  ): { unsubscribe: () => void } {
    // Clean up any existing subscription for this execution
    this.cleanupExecutionLogs(executionId);

    // If no gateway is available, just track bytes for metrics
    if (!this.executionGateway) {
      this.logger.warn(
        `ExecutionGateway not available, logs will not be streamed for ${executionId}`,
      );

      const subscription = output$.subscribe({
        next: (data) => {
          // Track bytes even if not streaming
          this.containerLogBytesCounter.inc(
            { execution_id: executionId, source },
            Buffer.byteLength(data, 'utf8'),
          );
        },
        error: (err) => {
          this.logger.error(`[${executionId}] Container output stream error: ${err.message}`);
        },
        complete: () => {
          this.activeLogSubscriptions.delete(executionId);
        },
      });

      this.activeLogSubscriptions.set(executionId, subscription);

      return {
        unsubscribe: () => {
          subscription.unsubscribe();
          this.activeLogSubscriptions.delete(executionId);
        },
      };
    }

    // Track start time for duration metric
    const startTime = Date.now();

    const subscription = output$.subscribe({
      next: (data) => {
        // Track bytes
        const byteLength = Buffer.byteLength(data, 'utf8');
        this.containerLogBytesCounter.inc({ execution_id: executionId, source }, byteLength);

        // Emit log via gateway
        this.executionGateway?.emitLog(executionId, ticketId, data, source);
      },
      error: (err: Error) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        this.logger.error(`[${executionId}] Container output stream error: ${errorMessage}`);

        // Emit error log via gateway
        this.executionGateway?.emitErrorLog(
          executionId,
          ticketId,
          `Stream error: ${errorMessage}`,
          'stderr',
        );

        // Track duration
        const durationSec = (Date.now() - startTime) / 1000;
        this.containerExecDurationHistogram.observe(
          { execution_id: executionId, status: 'error' },
          durationSec,
        );

        // Clean up subscription tracking
        this.activeLogSubscriptions.delete(executionId);
      },
      complete: () => {
        this.logger.debug(`[${executionId}] Container output stream completed`);

        // Track duration
        const durationSec = (Date.now() - startTime) / 1000;
        this.containerExecDurationHistogram.observe(
          { execution_id: executionId, status: 'complete' },
          durationSec,
        );

        // Clean up subscription tracking
        this.activeLogSubscriptions.delete(executionId);
      },
    });

    this.activeLogSubscriptions.set(executionId, subscription);

    return {
      unsubscribe: () => {
        subscription.unsubscribe();
        this.activeLogSubscriptions.delete(executionId);
      },
    };
  }

  /**
   * Clean up execution log subscription for a specific execution
   * Prevents memory leaks by ensuring subscriptions are properly disposed
   */
  cleanupExecutionLogs(executionId: string): void {
    const subscription = this.activeLogSubscriptions.get(executionId);
    if (subscription) {
      subscription.unsubscribe();
      this.activeLogSubscriptions.delete(executionId);
      this.logger.debug(`[${executionId}] Cleaned up log subscription`);
    }
  }

  /**
   * Emit a log message immediately (bypasses throttling)
   * Use for important status messages
   */
  emitImmediateLog(
    executionId: string,
    ticketId: string,
    message: string,
    level: LogLevel = LogLevel.INFO,
    source: 'stdout' | 'stderr' = 'stdout',
  ): void {
    if (this.executionGateway) {
      this.executionGateway.emitLog(executionId, ticketId, message, source, level);
    }
  }

  /**
   * Emit a structured container activity event for PM dashboard
   * These provide human-readable, icon-tagged updates (not raw logs)
   */
  async emitActivity(
    executionId: string,
    ticketId: string,
    activity: string,
    category: string,
    icon: string,
    detail?: string,
    suggestedPercent?: number,
  ): Promise<void> {
    const payload: import('./gateways/execution.gateway').ContainerActivityPayload = {
      executionId,
      ticketId,
      timestamp: new Date().toISOString(),
      activity,
      detail,
      category: category as import('./gateways/execution.gateway').ActivityCategory,
      icon,
      suggestedPercent,
      projectId: null,
    };

    // Resolve projectId from DB so we can route to the correct project room
    try {
      const execution = await this.repository.findById(executionId);
      if (execution?.ticket?.project_id) {
        payload.projectId = execution.ticket.project_id;
      }
    } catch {
      // Non-critical: continue without projectId
    }

    // 1. Emit to project/role rooms via RealtimeService (dashboard cards get these)
    if (this.realtimeService) {
      try {
        if (payload.projectId) {
          this.realtimeService.emitToProject(payload.projectId, 'execution-activity', payload);
        } else {
          this.realtimeService.emitToRole('ADMIN', 'execution-activity', payload);
          this.realtimeService.emitToRole('MANAGER', 'execution-activity', payload);
        }
      } catch (err) {
        this.logger.warn(`Failed to emit activity via realtimeService: ${err}`);
      }
    }

    // 2. Emit to ticket & execution_logs rooms via ExecutionGateway (log viewer sidebar gets these)
    if (this.executionGateway) {
      this.executionGateway.emitActivity(payload);
    }
  }

  /**
   * Check if there are active log subscribers for an execution
   */
  hasLogSubscribers(executionId: string): boolean {
    return this.executionGateway?.hasLogSubscribers(executionId) ?? false;
  }

  /**
   * Helper to emit WebSocket events with project routing (Story 10.2 AC 3)
   */
  private async emitWebSocketEvent<T extends { projectId: string | null }>(
    event: string,
    payload: T,
  ): Promise<void> {
    if (!this.realtimeService) {
      return;
    }

    try {
      const { projectId } = payload;
      if (projectId) {
        this.realtimeService.emitToProject(projectId, event, payload);
      } else {
        // Fallback to role-based rooms if project is unknown
        this.realtimeService.emitToRole('ADMIN', event, payload);
        this.realtimeService.emitToRole('MANAGER', event, payload);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to emit WebSocket event ${event}:`, error);
      this.websocketEmissionErrorsCounter.inc({ event, reason: errorMessage });
    }
  }

  /**
   * Emit execution progress with rate limiting (Story 10.2 AC 2)
   */
  async emitProgress(
    executionId: string,
    ticketId: string,
    projectId: string | null,
    currentStep: string,
    percentComplete: number,
    status: string = ExecutionStatus.IN_PROGRESS,
  ): Promise<void> {
    if (!this.realtimeService) {
      return;
    }

    // Rate limiting logic: skip if < 500ms since last emit, unless it's critical (0%, 100%) or step changed
    // 0% is start, 100% is completion (though completion has its own event, sometimes progress=100 is useful)
    // We treat 0% as critical start progress.
    const now = Date.now();
    const lastEmit = this.lastProgressEmitMap.get(executionId) || 0;
    const lastStep = this.lastProgressStepMap.get(executionId) || '';
    const stepChanged = currentStep !== lastStep;

    // Always emit if first time (lastEmit == 0), significant milestone (0%), or step changed
    // Otherwise enforce 500ms window
    if (
      !stepChanged &&
      lastEmit > 0 &&
      now - lastEmit < 500 &&
      percentComplete > 0 &&
      percentComplete < 100
    ) {
      this.logger.debug(
        `[ExecutionTracker] Skipping progress emit for ${executionId}: ${currentStep} (${percentComplete}%) - Rate limited (${now - lastEmit}ms < 500ms)`,
      );
      return;
    }

    // Resolve missing fields (projectId, aiProvider, startedAt)
    let resolvedProjectId = projectId;
    let resolvedAiProvider: string | undefined;
    let resolvedStartedAt: string | undefined;

    // Check if we need to fetch execution details
    if (!resolvedProjectId || !resolvedAiProvider || !resolvedStartedAt) {
      try {
        const execution = await this.repository.findById(executionId);
        if (execution) {
          if (!resolvedProjectId && execution.ticket?.project_id) {
            resolvedProjectId = execution.ticket.project_id;
          }
          resolvedAiProvider = execution.ai_provider;
          resolvedStartedAt = execution.started_at ? execution.started_at.toISOString() : undefined;
        }
      } catch (err) {
        this.logger.warn(`Failed to resolve details for execution ${executionId}: ${err}`);
      }
    }

    this.lastProgressEmitMap.set(executionId, now);
    this.lastProgressStepMap.set(executionId, currentStep);

    const event: ExecutionProgressEvent = {
      executionId,
      ticketId,
      projectId: resolvedProjectId,
      currentStep,
      percentComplete,
      status,
      lastUpdated: new Date().toISOString(),
      aiProvider: resolvedAiProvider,
      startedAt: resolvedStartedAt,
      progress: { currentStep, percentComplete }, // Include progress object
    };

    // Story 13.3.1: Persist progress to DB for recovery
    try {
      // We don't await this to avoid blocking the event loop
      // Optimistic update - in high load we might want to debounce this
      this.repository
        .update(executionId, {
          progress: {
            currentStep,
            percentComplete,
            lastUpdated: event.lastUpdated,
          },
        })
        .catch((err) => {
          this.logger.warn(`Failed to persist progress for ${executionId}: ${err.message}`);
        });
    } catch (e) {
      // Ignore sync errors
      this.logger.warn(`Failed to persist progress for ${executionId}: ${e}`);
    }

    this.logger.log(
      `[ExecutionTracker] Emitting progress for ${executionId}: ${currentStep} (${percentComplete}%)`,
    );

    // 1. Emit to Project/Role rooms via RealtimeService (New Architecture)
    await this.emitWebSocketEvent<ExecutionProgressEvent>('execution.progress', event);
  }
}
