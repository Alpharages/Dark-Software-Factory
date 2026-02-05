import { Injectable, OnModuleInit, Logger, Optional } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge } from 'prom-client';
import { RealtimeService } from '@/realtime/realtime.service';
import { ExecutionLogRepository } from '../repositories/execution-log.repository';
import { EventBusService } from '@/common/event-bus.service';
import {
  LogLevel,
  ErrorType,
  ExecutionLogEvent,
  ExecutionErrorEvent,
  ExecutionAuditEvent,
} from '@/realtime/realtime.types';
import { ExecutionCompletedEvent } from '../events/execution-completed.event';
import { ExecutionFailedEvent } from '../events/execution-failed.event';
import { ExecutionCancelledEvent } from '../events/execution-cancelled.event';

@Injectable()
export class ExecutionLogStreamingService implements OnModuleInit {
  private readonly logger = new Logger(ExecutionLogStreamingService.name);
  private logBuffers = new Map<string, ExecutionLogEvent[]>();
  private emissionCounts = new Map<string, number>(); // Track count for rate limiting
  private readonly BUFFER_FLUSH_SIZE = 100;
  private readonly RATE_LIMIT_THRESHOLD = 100; // First 100 logs stream freely
  private readonly SAMPLE_RATE = 10; // Then emit 1 in 10

  constructor(
    @Optional() private readonly realtimeService: RealtimeService,
    private readonly logRepository: ExecutionLogRepository,
    private readonly eventBus: EventBusService,
    @InjectMetric('execution_logs_emitted_total')
    private readonly logsEmittedCounter: Counter<string>,
    @InjectMetric('execution_logs_dropped_total')
    private readonly logsDroppedCounter: Counter<string>,
    @InjectMetric('websocket_log_emission_errors_total')
    private readonly emissionErrorsCounter: Counter<string>,
    @InjectMetric('execution_log_buffer_size') private readonly bufferSizeGauge: Gauge<string>,
  ) {}

  onModuleInit() {
    // Subscribe to execution lifecycle for cleanup
    this.eventBus.on('execution.completed', (e: ExecutionCompletedEvent) =>
      this.cleanupExecution(e.executionId),
    );
    this.eventBus.on('execution.failed', (e: ExecutionFailedEvent) =>
      this.cleanupExecution(e.executionId),
    );
    this.eventBus.on('execution.cancelled', (e: ExecutionCancelledEvent) =>
      this.cleanupExecution(e.executionId),
    );
  }

  /**
   * Emit an execution log
   */
  async emitLog(
    executionId: string,
    level: LogLevel,
    message: string,
    source: string,
    ticketId: string | null = null,
    projectId: string | null = null,
  ): Promise<void> {
    const timestamp = new Date();
    const redactedMessage = this.redactSecrets(message);

    // Persist to DB (batched or async to avoid blocking)
    // We fire and forget the save to DB to not block execution, but we should handle errors ideally
    // For now, let's treat it as a background promise
    this.logRepository
      .save({
        executionId,
        level,
        message: redactedMessage,
        source,
        timestamp,
      })
      .catch((err) => {
        this.logger.error(`Failed to save log to DB: ${err.message}`, err.stack);
      });

    // Rate Limiting Logic for WebSocket Emission
    if (this.shouldEmitToWebSocket(executionId, level)) {
      const event: ExecutionLogEvent = {
        executionId,
        ticketId,
        projectId,
        timestamp,
        level,
        message: redactedMessage,
        source,
      };

      await this.emitToTargetRooms(executionId, 'execution.log', event, ticketId, projectId);
      this.incrementEmissionCount(executionId);
      this.logsEmittedCounter.inc({ execution_id: executionId, level, source });
    } else {
      this.logsDroppedCounter.inc({ execution_id: executionId, reason: 'rate_limit' });
    }
  }

  /**
   * Emit an execution error (always critical, never throttled)
   */
  async emitError(
    executionId: string,
    errorType: ErrorType,
    errorMessage: string,
    stackTrace: string | null,
    ticketId: string | null = null,
    projectId: string | null = null,
    isRetryable: boolean = false,
  ): Promise<void> {
    const timestamp = new Date();
    const redactedMessage = this.redactSecrets(errorMessage);
    const redactedStack = stackTrace ? this.redactSecrets(stackTrace) : null;

    // Persist to DB
    await this.logRepository.save({
      executionId,
      level: 'ERROR',
      message: redactedMessage,
      source: 'system',
      timestamp,
    });

    const event: ExecutionErrorEvent = {
      executionId,
      ticketId,
      projectId,
      timestamp,
      errorMessage: redactedMessage,
      errorType,
      stackTrace: redactedStack,
      isRetryable,
    };

    await this.emitToTargetRooms(executionId, 'execution.error', event, ticketId, projectId);
    this.logsEmittedCounter.inc({ execution_id: executionId, level: 'ERROR', source: 'system' });
  }

  /**
   * Emit an audit event
   */
  async emitAudit(
    executionId: string,
    auditEvent: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: Record<string, any>,
    ticketId: string | null = null,
    projectId: string | null = null,
  ): Promise<void> {
    const timestamp = new Date();

    // Persist to DB as INFO log
    await this.logRepository.save({
      executionId,
      level: 'INFO',
      message: `Audit: ${auditEvent}`,
      source: 'audit',
      timestamp,
    });

    const event: ExecutionAuditEvent = {
      executionId,
      ticketId,
      projectId,
      timestamp,
      auditEvent,
      metadata,
    };

    await this.emitToTargetRooms(executionId, 'execution.audit', event, ticketId, projectId);
    this.logsEmittedCounter.inc({ execution_id: executionId, level: 'INFO', source: 'audit' });
  }

  /**
   * Route event to correct rooms (Project, User, Role)
   */
  private async emitToTargetRooms(
    executionId: string,
    eventName: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: any,
    ticketId: string | null,
    projectId: string | null,
  ): Promise<void> {
    if (!this.realtimeService) return;

    try {
      // 1. Project Room
      if (projectId) {
        this.realtimeService.emitToProject(projectId, eventName, payload);
      }

      // 2. Role Rooms (Admins/Devs always get logs)
      // Note: RealtimeService.emitToRole might be expensive if high volume, maybe restrict to specific critical events?
      // For now, mirroring AC requirements: "Role-based rooms: role:ADMIN, role:DEVELOPER"
      // Optimization: Only emit to roles if projectId is NOT present (broadcast fallback) OR strictly required.
      // AC says: "If projectId is not available, fall back to broadcast".
      // But also AC 3: "Execution log events must be emitted to... Role-based rooms" (implies always).
      // Let's emit to roles for now, assuming FE filters or user context manages subscriptions.
      this.realtimeService.emitToRole('ADMIN', eventName, payload);
      this.realtimeService.emitToRole('DEVELOPER', eventName, payload);

      // 3. User Room (Assigned PM - need userId, tricky if not passed in)
      // If we had the assigned PM ID, we'd emit to user:{assignedPmUserId}
      // Since we don't always have it in the args, we rely on the Project/Role rooms coverage.
      // Since we don't always have it in the args, we rely on the Project/Role rooms coverage.

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      this.logger.error(`WebSocket emission failed: ${e.message}`);
      this.emissionErrorsCounter.inc({ event: eventName, reason: e.message });
    }
  }

  /**
   * Adaptive rate limiting:
   * - ERROR/WARN: Always emit
   * - First 100 logs: Always emit
   * - After 100: Sample 1/10
   */
  private shouldEmitToWebSocket(executionId: string, level: LogLevel): boolean {
    if (level === 'ERROR' || level === 'WARN') return true;

    const count = this.emissionCounts.get(executionId) || 0;

    if (count < this.RATE_LIMIT_THRESHOLD) return true;

    return count % this.SAMPLE_RATE === 0;
  }

  private incrementEmissionCount(executionId: string) {
    const count = this.emissionCounts.get(executionId) || 0;
    this.emissionCounts.set(executionId, count + 1);
  }

  /**
   * Redact secrets using regex
   */
  private redactSecrets(message: string): string {
    if (!message) return '';
    return message
      .replace(/api[\s_-]?key[_-]?[=:]?\s*([a-z0-9_-]{20,})/gi, '[REDACTED]')
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]') // Improved JWT regex
      .replace(/(password|secret|token)[=:]\s*([^\s]+)/gi, '$1=[REDACTED]');
  }

  /**
   * Cleanup memory after execution finishes
   */
  private async cleanupExecution(executionId: string): Promise<void> {
    // Flush any remaining buffers if we were buffering
    // (Current implementation writes directly to DB, but if we add buffering later, flush here)

    this.emissionCounts.delete(executionId);
    this.logBuffers.delete(executionId);
    this.bufferSizeGauge.set(0); // Reset for this execution (conceptual)
  }

  /**
   * Helper to parse log level from string content
   */
  parseLogLevel(output: string, isStderr: boolean): LogLevel {
    if (output.match(/^\[ERROR\]|Error:|ERROR:/i)) return 'ERROR';
    if (output.match(/^\[WARN\]|Warning:|WARN:/i)) return 'WARN';
    if (output.match(/^\[INFO\]|Info:|INFO:/i)) return 'INFO';
    if (output.match(/^\[DEBUG\]|Debug:|DEBUG:/i)) return 'DEBUG';
    return isStderr ? 'STDERR' : 'STDOUT';
  }
}
