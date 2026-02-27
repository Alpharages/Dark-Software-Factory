/**
 * Story 20.1: Robust Webhook Handler Service
 *
 * Enhanced webhook processing with:
 * - Redis-based distributed deduplication (AC2, AC6)
 * - Status-based actionability filtering (AC3, AC4)
 * - Dead letter queue for failed events (AC5)
 * - ITaskEvent normalization (provider-agnostic)
 * - Comprehensive structured logging
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { WEBHOOK_METRICS, QUEUE_METRICS } from '../common/metrics/metrics.constants';
import {
  IClickUpWebhookPayload,
  IClickUpTask,
  ClickUpEventType,
  PROCESSABLE_EVENTS,
} from './interfaces';
import { WebhookResponseDto } from './dto';
import { WebhookDeduplicationService } from './services';
import { StatusEvaluationService } from '../ticket-intake/services/status-evaluation.service';
import {
  ITaskEvent,
  TaskProviderType,
  TaskTriggerSource,
  InternalTaskStatus,
} from '../ticket-intake/dto/task-event.dto';

/**
 * Structured webhook log entry for audit trail
 */
interface WebhookLogEntry {
  correlationId: string;
  webhookId: string;
  event: string;
  taskId: string;
  status: 'received' | 'duplicate' | 'actionable' | 'ignored' | 'error' | 'queued';
  taskStatus?: string;
  internalStatus?: InternalTaskStatus;
  reason?: string;
  timestamp: string;
  dedupSource?: 'redis' | 'memory';
  retryCount?: number;
}

/**
 * Dead letter queue message structure
 */
interface DeadLetterMessage {
  originalEvent: IClickUpWebhookPayload;
  correlationId: string;
  failedAt: string;
  error: string;
  retryCount: number;
  lastRetryAt?: string;
}

@Injectable()
export class WebhooksService implements OnModuleDestroy {
  private readonly logger = new Logger(WebhooksService.name);

  // Cleanup interval for any legacy resources
  private cleanupInterval: NodeJS.Timeout | null = null;

  // Configuration
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
    private readonly configService: ConfigService,
    // Story 20.1: New services for robust handling
    private readonly deduplicationService: WebhookDeduplicationService,
    private readonly statusEvaluationService: StatusEvaluationService,
    // Prometheus metrics
    @InjectMetric(WEBHOOK_METRICS.RECEIVED_TOTAL)
    private readonly webhookReceivedCounter: Counter<string>,
    @InjectMetric(WEBHOOK_METRICS.PROCESSED_TOTAL)
    private readonly webhookProcessedCounter: Counter<string>,
    @InjectMetric(WEBHOOK_METRICS.PROCESSING_DURATION)
    private readonly webhookDurationHistogram: Histogram<string>,
    @InjectMetric(WEBHOOK_METRICS.ERRORS_TOTAL)
    private readonly webhookErrorsCounter: Counter<string>,
    @InjectMetric(WEBHOOK_METRICS.DUPLICATES_TOTAL)
    private readonly webhookDuplicatesCounter: Counter<string>,
    @InjectMetric(WEBHOOK_METRICS.FILTERED_TOTAL)
    private readonly webhookFilteredCounter: Counter<string>,
    @InjectMetric(WEBHOOK_METRICS.ACTIONABLE_TOTAL)
    private readonly webhookActionableCounter: Counter<string>,
    @InjectMetric(QUEUE_METRICS.DEAD_LETTER_COUNT)
    private readonly deadLetterCounter: Counter<string>,
  ) {
    // Load configuration
    this.maxRetries = this.configService.get<number>('webhooks.maxRetries', 3);
    this.retryDelayMs = this.configService.get<number>('webhooks.retryDelayMs', 1000);
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Process incoming ClickUp webhook
   *
   * AC1: Returns 200 OK immediately (fire-and-forget pattern)
   * AC2: Idempotent processing with Redis deduplication
   * AC3/AC4: Status-based actionability check
   * AC5: Error handling with DLQ for max retries
   * AC6: Distributed deduplication via Redis
   *
   * @param payload - Raw webhook payload
   * @param correlationId - Request correlation ID
   * @returns Acknowledgment response
   */
  async processWebhook(
    payload: IClickUpWebhookPayload,
    correlationId: string,
  ): Promise<WebhookResponseDto> {
    const eventType = this.parseEventType(payload.event);
    const eventTypeLabel = eventType || 'unknown';
    const endTimer = this.webhookDurationHistogram.startTimer({ event_type: eventTypeLabel });

    // Track webhook received (NFR-O5)
    this.webhookReceivedCounter.inc({ event_type: eventTypeLabel });

    // Log structured entry
    this.logWebhookEvent({
      correlationId,
      webhookId: payload.webhook_id,
      event: payload.event,
      taskId: payload.task_id,
      status: 'received',
      timestamp: new Date().toISOString(),
    });

    try {
      // 1. Check idempotency using Redis-based deduplication (AC2, AC6)
      const dedupResult = await this.deduplicationService.checkAndSet(
        payload.webhook_id,
        correlationId,
      );

      if (dedupResult.isDuplicate) {
        this.logger.debug(
          `[${correlationId}] Duplicate webhook detected: ${payload.webhook_id} (source: ${dedupResult.source})`,
        );
        this.webhookDuplicatesCounter.inc({ event_type: eventTypeLabel });

        this.logWebhookEvent({
          correlationId,
          webhookId: payload.webhook_id,
          event: payload.event,
          taskId: payload.task_id,
          status: 'duplicate',
          timestamp: new Date().toISOString(),
          dedupSource: dedupResult.source,
        });

        return this.createResponse(correlationId, false, 'Duplicate event ignored');
      }

      // 2. Log to audit trail
      await this.logToAuditTrail(payload, correlationId);

      // 3. Check event type processability
      if (!eventType || !PROCESSABLE_EVENTS.includes(eventType)) {
        const reason = `Event type '${payload.event}' is not processable`;
        this.logger.debug(`[${correlationId}] ${reason}`);

        this.logWebhookEvent({
          correlationId,
          webhookId: payload.webhook_id,
          event: payload.event,
          taskId: payload.task_id,
          status: 'ignored',
          reason,
          timestamp: new Date().toISOString(),
        });

        return this.createResponse(correlationId, false, reason);
      }

      // 4. Status-based actionability check (AC3, AC4)
      const taskStatus = payload.task?.status?.status || 'unknown';
      const statusEval = this.statusEvaluationService.evaluateStatus(
        taskStatus,
        TaskProviderType.CLICKUP,
      );

      if (!statusEval.isActionable) {
        this.logger.debug(
          `[${correlationId}] Task ${payload.task_id} status '${taskStatus}' is not actionable: ${statusEval.reason}`,
        );

        // Track filtered webhook metric
        this.webhookFilteredCounter.inc({
          status: taskStatus,
          reason: statusEval.internalStatus,
        });

        this.logWebhookEvent({
          correlationId,
          webhookId: payload.webhook_id,
          event: payload.event,
          taskId: payload.task_id,
          taskStatus,
          internalStatus: statusEval.internalStatus,
          status: 'ignored',
          reason: statusEval.reason,
          timestamp: new Date().toISOString(),
        });

        return this.createResponse(correlationId, false, statusEval.reason);
      }

      // Track actionable webhook metric
      this.webhookActionableCounter.inc({
        internal_status: statusEval.internalStatus,
      });

      // 5. Normalize to ITaskEvent format (provider-agnostic)
      const taskEvent = this.normalizeToTaskEvent(
        payload,
        correlationId,
        statusEval.internalStatus,
      );

      // 6. Publish to ticket-intake queue with retry logic (AC5)
      await this.publishToQueueWithRetry(taskEvent, correlationId);

      // Log successful queuing
      this.logWebhookEvent({
        correlationId,
        webhookId: payload.webhook_id,
        event: payload.event,
        taskId: payload.task_id,
        taskStatus,
        internalStatus: statusEval.internalStatus,
        status: 'queued',
        reason: statusEval.reason,
        timestamp: new Date().toISOString(),
      });

      this.logger.log(
        `[${correlationId}] Webhook processed successfully - event: ${eventType}, task: ${payload.task_id}, status: ${taskStatus} -> ${statusEval.internalStatus}`,
      );

      // Track successful processing (NFR-O5)
      this.webhookProcessedCounter.inc({ event_type: eventTypeLabel, status: 'success' });

      // Per NFR-P1: Return 200 OK within 5 seconds
      return this.createResponse(correlationId, true, 'Webhook received and queued');
    } catch (error) {
      // Track errors (NFR-O5)
      this.webhookErrorsCounter.inc({
        event_type: eventTypeLabel,
        error_type: (error as Error).name || 'unknown',
      });

      // Log error with structured format
      this.logWebhookEvent({
        correlationId,
        webhookId: payload.webhook_id,
        event: payload.event,
        taskId: payload.task_id,
        status: 'error',
        reason: (error as Error).message,
        timestamp: new Date().toISOString(),
      });

      // AC5: Send to dead letter queue after max retries
      await this.sendToDeadLetterQueue(payload, correlationId, error as Error, this.maxRetries);

      // Still re-throw to let controller handle HTTP response
      throw error;
    } finally {
      endTimer();
    }
  }

  /**
   * Normalize ClickUp webhook payload to provider-agnostic ITaskEvent
   *
   * AC3: Normalize to ITaskEvent format with triggerSource: 'WEBHOOK'
   *
   * @param payload - ClickUp webhook payload
   * @param correlationId - Request correlation ID
   * @param internalStatus - Mapped internal status
   * @returns ITaskEvent normalized event
   */
  private normalizeToTaskEvent(
    payload: IClickUpWebhookPayload,
    correlationId: string,
    internalStatus: InternalTaskStatus,
  ): ITaskEvent {
    const task = payload.task;

    return {
      externalId: payload.task_id,
      providerType: TaskProviderType.CLICKUP,
      internalStatus,
      title: task?.name || 'Untitled Task',
      description: task?.description || task?.text_content || null,
      triggerSource: TaskTriggerSource.WEBHOOK,
      correlationId,
      projectIdentifier: task?.list?.id || '',
      taskUrl: task?.url || '',
      tags: task?.tags?.map((t) => t.name) || [],
      customFields: this.extractCustomFields(task),
      creatorEmail: task?.creator?.email,
      eventTimestamp: task?.date_created,
      receivedAt: new Date().toISOString(),
      originalProviderStatus: task?.status?.status,
    };
  }

  /**
   * Extract custom fields from ClickUp task
   */
  private extractCustomFields(task: IClickUpTask | undefined): Record<string, unknown> {
    if (!task?.custom_fields) {
      return {};
    }

    const fields: Record<string, unknown> = {};
    for (const field of task.custom_fields) {
      fields[field.name] = field.value;
    }
    return fields;
  }

  /**
   * Publish event to RabbitMQ with exponential backoff retry
   *
   * AC5: Retry with exponential backoff, then move to DLQ
   *
   * @param event - Task event to publish
   * @param correlationId - Request correlation ID
   */
  private async publishToQueueWithRetry(event: ITaskEvent, correlationId: string): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        await this.publishToQueue(event, correlationId);
        return; // Success - exit retry loop
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.maxRetries) {
          // Calculate exponential backoff delay
          const delayMs = this.retryDelayMs * Math.pow(2, attempt - 1);
          this.logger.warn(
            `[${correlationId}] Queue publish attempt ${attempt} failed, retrying in ${delayMs}ms: ${lastError.message}`,
          );

          // Wait before retry
          await this.sleep(delayMs);
        }
      }
    }

    // Max retries exceeded - throw error to trigger DLQ handling
    throw new Error(
      `Failed to publish to queue after ${this.maxRetries} attempts: ${lastError?.message}`,
    );
  }

  /**
   * Publish event to RabbitMQ for async processing
   */
  private async publishToQueue(event: ITaskEvent, correlationId: string): Promise<void> {
    try {
      await this.rabbitMQ.publishToQueue('ticket-intake-queue', event, {
        correlationId,
        persistent: true,
        headers: {
          'x-correlation-id': correlationId,
          'x-event-type': event.internalStatus,
          'x-task-id': event.externalId,
          'x-provider-type': event.providerType,
          'x-trigger-source': event.triggerSource,
        },
      });

      this.logger.debug(
        `[${correlationId}] Published to ticket-intake-queue: task ${event.externalId}`,
      );
    } catch (error) {
      this.logger.error(
        `[${correlationId}] Failed to publish to queue: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  /**
   * Send failed event to dead letter queue for later investigation
   *
   * AC5: Dead letter queue pattern for failed events
   *
   * @param payload - Original webhook payload
   * @param correlationId - Request correlation ID
   * @param error - Error that caused failure
   * @param retryCount - Number of retry attempts made
   */
  private async sendToDeadLetterQueue(
    payload: IClickUpWebhookPayload,
    correlationId: string,
    error: Error,
    retryCount: number,
  ): Promise<void> {
    try {
      const dlqMessage: DeadLetterMessage = {
        originalEvent: payload,
        correlationId,
        failedAt: new Date().toISOString(),
        error: error.message,
        retryCount,
      };

      await this.rabbitMQ.publishToQueue('webhook-dead-letter', dlqMessage, {
        correlationId,
        persistent: true,
        headers: {
          'x-correlation-id': correlationId,
          'x-original-webhook-id': payload.webhook_id,
          'x-error-type': error.name,
          'x-retry-count': retryCount.toString(),
        },
      });

      this.deadLetterCounter.inc({
        queue: 'ticket-intake-queue',
        reason: error.name,
      });

      this.logger.error(
        `[${correlationId}] Event sent to dead letter queue: ${payload.webhook_id}`,
        error.stack,
      );
    } catch (dlqError) {
      // If DLQ fails, just log - we don't want to fail the webhook response
      this.logger.error(
        `[${correlationId}] Failed to send to dead letter queue: ${(dlqError as Error).message}`,
      );
    }
  }

  /**
   * Log structured webhook event for audit trail
   */
  private logWebhookEvent(entry: WebhookLogEntry): void {
    // Structured JSON logging for aggregation
    this.logger.log({
      type: 'webhook_event',
      ...entry,
    });
  }

  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Event type mapping using Map for type-safe lookup
  private readonly eventTypeMap = new Map<string, ClickUpEventType>([
    ['taskCreated', ClickUpEventType.TASK_CREATED],
    ['taskUpdated', ClickUpEventType.TASK_UPDATED],
    ['taskStatusUpdated', ClickUpEventType.TASK_STATUS_UPDATED],
    ['taskCommentPosted', ClickUpEventType.TASK_COMMENT_POSTED],
    ['taskDeleted', ClickUpEventType.TASK_DELETED],
  ]);

  /**
   * Parse event type string to enum
   */
  private parseEventType(event: string): ClickUpEventType | null {
    return this.eventTypeMap.get(event) ?? null;
  }

  /**
   * Log raw webhook payload to audit trail
   */
  private async logToAuditTrail(
    payload: IClickUpWebhookPayload,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          entity_type: 'webhook',
          entity_id: payload.webhook_id,
          action: `webhook_received:${payload.event}`,
          actor_type: 'system',
          actor_id: undefined,
          before_state: undefined,
          after_state: {
            correlationId,
            event: payload.event,
            task_id: payload.task_id,
            received_at: new Date().toISOString(),
            task_name: payload.task?.name,
            task_status: payload.task?.status?.status,
            dedup_backend: this.deduplicationService.getBackendType(),
          },
        },
      });
    } catch (_error) {
      // Don't fail webhook processing if audit logging fails
      this.logger.error(
        `[${correlationId}] Failed to log to audit trail: ${(_error as Error).message}`,
      );
    }
  }

  /**
   * Create standardized webhook response
   */
  private createResponse(
    correlationId: string,
    willProcess: boolean,
    message: string,
  ): WebhookResponseDto {
    const response = new WebhookResponseDto();
    response.success = true; // Always true for successful receipt
    response.message = message;
    response.correlationId = correlationId;
    response.willProcess = willProcess;
    response.timestamp = new Date().toISOString();
    return response;
  }

  /**
   * Health check for webhook service
   */
  async isHealthy(): Promise<boolean> {
    try {
      // Check database connectivity
      await this.prisma.$queryRaw`SELECT 1`;
      // Check RabbitMQ connectivity
      const rabbitHealthy = await this.rabbitMQ.isHealthy();
      // Check deduplication service
      const dedupHealthy = await this.deduplicationService.isHealthy();

      return rabbitHealthy && dedupHealthy;
    } catch {
      return false;
    }
  }
}
