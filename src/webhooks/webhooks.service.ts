import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { WEBHOOK_METRICS } from '../common/metrics/metrics.constants';
import {
  IClickUpWebhookPayload,
  IClickUpTask,
  IProcessedWebhookEvent,
  ClickUpEventType,
  PROCESSABLE_EVENTS,
} from './interfaces';
import { TaskEventDto, WebhookResponseDto } from './dto';

/**
 * Webhook processing service
 *
 * Responsibilities:
 * - Parse and validate webhook payloads
 * - Deduplicate events (idempotency)
 * - Log to audit trail
 * - Queue events for downstream processing
 * - Track Prometheus metrics (NFR-O5)
 *
 * Per FR56: System can receive ClickUp webhook events
 * Per FR57: System can parse ticket details
 * Per NFR-I7: Reliable webhook handling with retries/duplicates
 * Per NFR-O5: System must expose Prometheus-compatible metrics
 */
@Injectable()
export class WebhooksService implements OnModuleDestroy {
  private readonly logger = new Logger(WebhooksService.name);

  // In-memory cache for recent webhook IDs (idempotency)
  // NOTE: In production with multiple instances, use Redis for distributed deduplication
  private readonly processedWebhooks = new Map<string, number>();
  private readonly DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
    // Prometheus metrics injection
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
  ) {
    // Clean up old entries periodically
    this.cleanupInterval = setInterval(() => this.cleanupProcessedWebhooks(), 60 * 1000);
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Process incoming ClickUp webhook
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

    this.logger.log(
      `[${correlationId}] Processing webhook: ${payload.event} for task ${payload.task_id}`,
    );

    try {
      // 1. Check idempotency - have we seen this webhook before?
      if (this.isDuplicateWebhook(payload.webhook_id)) {
        this.logger.debug(`[${correlationId}] Duplicate webhook detected: ${payload.webhook_id}`);
        this.webhookDuplicatesCounter.inc({ event_type: eventTypeLabel });
        return this.createResponse(correlationId, false, 'Duplicate event ignored');
      }

      // 2. Mark as processed (early to prevent race conditions)
      this.markWebhookProcessed(payload.webhook_id);

      // 3. Log raw payload to audit trail
      await this.logToAuditTrail(payload, correlationId);

      // 4. Determine if this event should be processed
      const shouldProcess = eventType && PROCESSABLE_EVENTS.includes(eventType);

      if (!shouldProcess) {
        this.logger.debug(
          `[${correlationId}] Event type '${payload.event}' not processable, acknowledging only`,
        );
        return this.createResponse(
          correlationId,
          false,
          `Event type '${payload.event}' acknowledged but not processed`,
        );
      }

      // 5. Parse into internal event format
      const processedEvent = this.parseWebhookEvent(payload, correlationId, eventType);

      // 6. Convert to TaskEventDto for queue
      const taskEvent = this.createTaskEventDto(processedEvent);

      // 7. Publish to ticket-intake queue for async processing
      await this.publishToQueue(taskEvent, correlationId);

      this.logger.log(
        `[${correlationId}] Webhook processed successfully - event: ${eventType}, task: ${payload.task_id}`,
      );

      // Track successful processing (NFR-O5)
      this.webhookProcessedCounter.inc({ event_type: eventTypeLabel, status: 'success' });

      // Per NFR-P1: Return 200 OK within 5 seconds
      return this.createResponse(correlationId, true, 'Webhook received and queued');
    } catch (_error) {
      // Track errors (NFR-O5)
      this.webhookErrorsCounter.inc({
        event_type: eventTypeLabel,
        error_type: (_error as Error).name || 'unknown',
      });
      throw _error;
    } finally {
      // Always record duration
      endTimer();
    }
  }

  /**
   * Check if webhook has already been processed (idempotency)
   */
  private isDuplicateWebhook(webhookId: string): boolean {
    const processedAt = this.processedWebhooks.get(webhookId);
    if (!processedAt) return false;

    // Check if within deduplication window
    return Date.now() - processedAt < this.DEDUP_WINDOW_MS;
  }

  /**
   * Mark webhook as processed
   */
  private markWebhookProcessed(webhookId: string): void {
    this.processedWebhooks.set(webhookId, Date.now());
  }

  /**
   * Clean up old processed webhook IDs
   */
  private cleanupProcessedWebhooks(): void {
    const now = Date.now();
    for (const [id, timestamp] of this.processedWebhooks) {
      if (now - timestamp > this.DEDUP_WINDOW_MS) {
        this.processedWebhooks.delete(id);
      }
    }
  }

  /**
   * Log raw webhook payload to audit trail
   *
   * Per architecture.md: Store raw webhook payload in audit_logs table
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
            // Store subset to avoid massive audit entries
            task_name: payload.task?.name,
            task_status: payload.task?.status?.status,
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
   * Parse raw webhook into processed event
   */
  private parseWebhookEvent(
    payload: IClickUpWebhookPayload,
    correlationId: string,
    eventType: ClickUpEventType,
  ): IProcessedWebhookEvent {
    return {
      correlationId,
      webhookEventId: payload.webhook_id,
      eventType,
      taskId: payload.task_id,
      task: payload.task as IClickUpTask | null,
      receivedAt: new Date(),
      rawPayload: payload,
    };
  }

  /**
   * Convert processed event to DTO for queue
   */
  private createTaskEventDto(event: IProcessedWebhookEvent): TaskEventDto {
    const task = event.task;

    const dto = new TaskEventDto();
    dto.correlationId = event.correlationId;
    dto.webhookEventId = event.webhookEventId;
    dto.eventType = event.eventType;
    dto.taskId = event.taskId;
    dto.taskName = task?.name || '';
    dto.taskDescription = task?.description || task?.text_content || null;
    dto.taskStatus = task?.status?.status || 'unknown';
    dto.listId = task?.list?.id || '';
    dto.listName = task?.list?.name || '';
    dto.spaceId = task?.space?.id || '';
    dto.projectId = task?.project?.id || '';
    dto.projectName = task?.project?.name || '';
    dto.taskUrl = task?.url || '';
    dto.tags = task?.tags?.map((t) => t.name) || [];
    dto.customFields = new Map(task?.custom_fields?.map((cf) => [cf.name, cf.value]) || []);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dto.creatorEmail = (task?.creator as any)?.email || '';
    dto.eventTimestamp = task ? new Date(task.date_created) : new Date();
    dto.receivedAt = event.receivedAt;

    return dto;
  }

  /**
   * Publish event to RabbitMQ for async processing
   *
   * Per architecture.md:
   * - RabbitMQ queues for: `ai-tasks`, `qa-tasks`, `deployment-tasks`, `monitoring-tasks`
   * - Ticket intake publishes to ticket-intake-queue for Story 2.2 processing
   */
  private async publishToQueue(event: TaskEventDto, correlationId: string): Promise<void> {
    try {
      // Convert Map to object for serialization
      const serializedEvent = {
        ...event,
        customFields: Object.fromEntries(event.customFields),
        receivedAt: event.receivedAt.toISOString(),
        eventTimestamp: event.eventTimestamp.toISOString(),
      };

      await this.rabbitMQ.publishToQueue('ticket-intake-queue', serializedEvent, {
        correlationId,
        persistent: true,
        headers: {
          'x-correlation-id': correlationId,
          'x-event-type': event.eventType,
          'x-task-id': event.taskId,
        },
      });

      this.logger.debug(
        `[${correlationId}] Published to ticket-intake-queue: task ${event.taskId}`,
      );
    } catch (_error) {
      this.logger.error(
        `[${correlationId}] Failed to publish to queue: ${(_error as Error).message}`,
      );
      throw _error;
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
      return await this.rabbitMQ.isHealthy();
    } catch {
      return false;
    }
  }
}
