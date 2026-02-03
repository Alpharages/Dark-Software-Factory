import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExecutionStatus, Execution } from '@/prisma/client';
import { Counter, Histogram, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Observable, Subscription } from 'rxjs';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
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

  constructor(
    private readonly repository: ExecutionRepository,
    private readonly stateMachine: ExecutionStateMachine,
    private readonly publisher: RabbitMQPublisherService,
    private readonly configService: ConfigService,
    @InjectMetric('dsf_execution_total')
    private readonly executionCounter: Counter<string>,
    @InjectMetric('dsf_execution_duration_seconds')
    private readonly durationHistogram: Histogram<string>,
    @InjectMetric('dsf_execution_status_gauge')
    private readonly statusGauge: Gauge<string>,
    @InjectMetric('dsf_execution_retry_total')
    private readonly retryCounter: Counter<string>,
    @InjectMetric('dsf_container_log_bytes_total')
    private readonly containerLogBytesCounter: Counter<string>,
    @InjectMetric('dsf_container_exec_duration_seconds')
    private readonly containerExecDurationHistogram: Histogram<string>,
    @Optional()
    private readonly executionGateway?: ExecutionGateway,
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
   * Check if there are active log subscribers for an execution
   */
  hasLogSubscribers(executionId: string): boolean {
    return this.executionGateway?.hasLogSubscribers(executionId) ?? false;
  }
}
