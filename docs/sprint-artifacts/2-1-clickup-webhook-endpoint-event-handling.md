# Story 2.1: ClickUp Webhook Endpoint & Event Handling

**Epic:** 2 - Ticket Intake & AI Routing Engine  
**Status:** review  
**Priority:** P0 - BLOCKER  
**Effort:** 8 story points  
**ClickUp ID:** `86evnjwa0`  
**ClickUp URL:** https://app.clickup.com/t/86evnjwa0

---

## Story

As a PM,
I want my ClickUp task creation to trigger the orchestrator automatically,
So that I don't need to manually start AI execution for each ticket.

---

## Acceptance Criteria

**Given** ClickUp webhooks are configured to point to our orchestrator  
**When** I create a task in ClickUp (via AetherFlow or directly)  
**Then** the orchestrator receives a webhook POST request at `/api/v1/webhooks/clickup`

**And** the webhook signature is validated using CLICKUP_WEBHOOK_SECRET (NFR-S11)  
**And** webhook events are logged with correlation ID (NFR-O2)  
**And** invalid signatures are rejected with 401 Unauthorized  
**And** successful webhooks return 200 OK within 5 seconds (NFR-P1)  
**And** duplicate events are deduplicated (idempotency based on event ID)  
**And** event payload is parsed into TypeScript DTO

---

## Quick Implementation Summary (TL;DR)

**5 Key Files in Implementation Order:**
1. `src/webhooks/interfaces/clickup-webhook.interface.ts` - Define types first
2. `src/webhooks/guards/webhook-signature.guard.ts` - Security guard
3. `src/webhooks/webhooks.service.ts` - Core processing logic
4. `src/webhooks/webhooks.controller.ts` - HTTP endpoint
5. `src/webhooks/webhooks.module.ts` - Wire everything together

**Critical Dependencies to Install:**
```bash
npm install @nestjs/throttler
```

---

## Technical Requirements

### Quick Reference: Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/webhooks/webhooks.module.ts` | MODIFY | Add controller, service, providers |
| `src/webhooks/webhooks.controller.ts` | CREATE | POST /api/v1/webhooks/clickup endpoint |
| `src/webhooks/webhooks.service.ts` | CREATE | Webhook processing logic |
| `src/webhooks/dto/clickup-webhook.dto.ts` | CREATE | ClickUp webhook payload DTOs |
| `src/webhooks/dto/task-event.dto.ts` | CREATE | Parsed task event DTO |
| `src/webhooks/dto/index.ts` | CREATE | DTO barrel export |
| `src/webhooks/guards/webhook-signature.guard.ts` | CREATE | HMAC signature verification |
| `src/webhooks/guards/index.ts` | CREATE | Guards barrel export |
| `src/webhooks/interfaces/clickup-webhook.interface.ts` | CREATE | TypeScript interfaces |
| `src/webhooks/interfaces/index.ts` | CREATE | Interfaces barrel export |
| `src/common/decorators/correlation-id.decorator.ts` | CREATE | @CorrelationId() decorator |
| `src/common/interceptors/correlation-id.interceptor.ts` | CREATE | Auto-generate correlation IDs |
| `src/app.module.ts` | MODIFY | Add CorrelationIdInterceptor globally |
| `test/webhooks.e2e-spec.ts` | CREATE | E2E tests for webhook endpoint |

**Dependencies to Install:**
```bash
npm install @nestjs/throttler
```

**Uses:** Built-in NestJS features, crypto module, and throttler for rate limiting.

---

### Step 1: Create ClickUp Webhook Interfaces

**File:** `src/webhooks/interfaces/clickup-webhook.interface.ts`

```typescript
/**
 * ClickUp Webhook Payload Interfaces
 * 
 * Per architecture.md:
 * - Webhook events: `taskCreated`, `taskUpdated`, `taskStatusChanged`
 * - Payload includes: task details, custom fields, comments, attachments
 * 
 * Reference: https://clickup.com/api/developer-portal/webhooksevents
 */

/**
 * ClickUp webhook event types supported by the orchestrator
 */
export enum ClickUpEventType {
  TASK_CREATED = 'taskCreated',
  TASK_UPDATED = 'taskUpdated',
  TASK_STATUS_UPDATED = 'taskStatusUpdated',
  TASK_COMMENT_POSTED = 'taskCommentPosted',
  TASK_DELETED = 'taskDeleted',
}

/**
 * Webhook events the orchestrator will process
 * Other events are acknowledged but not processed
 * 
 * NOTE: Consider adding TASK_STATUS_UPDATED in future iterations
 * if you need to trigger actions specifically on status changes
 * (e.g., auto-deploy on "Ready for QA" status). Currently not
 * needed as TASK_UPDATED covers most use cases.
 */
export const PROCESSABLE_EVENTS: ClickUpEventType[] = [
  ClickUpEventType.TASK_CREATED,
  ClickUpEventType.TASK_UPDATED,
  // TASK_STATUS_UPDATED - Uncomment if status-specific workflows needed
];

/**
 * Raw ClickUp webhook payload structure
 */
export interface IClickUpWebhookPayload {
  /** Unique webhook event ID - used for idempotency */
  webhook_id: string;
  
  /** Event type (e.g., 'taskCreated', 'taskUpdated') */
  event: string;
  
  /** Timestamp when the event occurred */
  history_items?: IClickUpHistoryItem[];
  
  /** The task data */
  task_id: string;
  
  /** Full task object (may be partial for updates) */
  task?: IClickUpTask;
}

/**
 * History item in webhook payload
 */
export interface IClickUpHistoryItem {
  id: string;
  type: number;
  date: string;
  field: string;
  parent_id: string;
  data?: Record<string, unknown>;
  source?: string;
  user: {
    id: number;
    username: string;
    email: string;
    color: string;
    initials: string;
    profilePicture?: string;
  };
  before?: unknown;
  after?: unknown;
}

/**
 * ClickUp Task structure from webhook
 */
export interface IClickUpTask {
  id: string;
  custom_id?: string;
  name: string;
  text_content?: string;
  description?: string;
  status: {
    id: string;
    status: string;
    color: string;
    type: string;
    orderindex: number;
  };
  orderindex: string;
  date_created: string;
  date_updated: string;
  date_closed?: string;
  date_done?: string;
  creator: {
    id: number;
    username: string;
    color: string;
    email: string;
    profilePicture?: string;
  };
  assignees: Array<{
    id: number;
    username: string;
    color: string;
    email: string;
    initials: string;
    profilePicture?: string;
  }>;
  watchers: Array<{
    id: number;
    username: string;
    color: string;
    initials: string;
    profilePicture?: string;
  }>;
  checklists: unknown[];
  tags: Array<{
    name: string;
    tag_fg: string;
    tag_bg: string;
  }>;
  parent?: string;
  priority?: {
    id: string;
    priority: string;
    color: string;
    orderindex: string;
  };
  due_date?: string;
  start_date?: string;
  points?: number;
  time_estimate?: number;
  time_spent?: number;
  custom_fields?: IClickUpCustomField[];
  dependencies?: unknown[];
  linked_tasks?: unknown[];
  team_id: string;
  url: string;
  list: {
    id: string;
    name: string;
    access: boolean;
  };
  project: {
    id: string;
    name: string;
    hidden: boolean;
    access: boolean;
  };
  folder: {
    id: string;
    name: string;
    hidden: boolean;
    access: boolean;
  };
  space: {
    id: string;
  };
}

/**
 * ClickUp Custom Field structure
 */
export interface IClickUpCustomField {
  id: string;
  name: string;
  type: string;
  type_config: Record<string, unknown>;
  date_created: string;
  hide_from_guests: boolean;
  value?: unknown;
  required: boolean;
}

/**
 * Processed webhook event ready for internal consumption
 */
export interface IProcessedWebhookEvent {
  /** Correlation ID for tracing */
  correlationId: string;
  
  /** Original webhook event ID (for idempotency) */
  webhookEventId: string;
  
  /** Event type */
  eventType: ClickUpEventType;
  
  /** ClickUp task ID */
  taskId: string;
  
  /** Parsed task data */
  task: IClickUpTask | null;
  
  /** When the event was received */
  receivedAt: Date;
  
  /** Raw payload for audit logging */
  rawPayload: IClickUpWebhookPayload;
}
```

---

**File:** `src/webhooks/interfaces/index.ts`

```typescript
export * from './clickup-webhook.interface';
```

---

### Step 2: Create Webhook DTOs with Validation

**File:** `src/webhooks/dto/clickup-webhook.dto.ts`

```typescript
import { IsString, IsNotEmpty, IsOptional, IsObject, ValidateNested, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ClickUpEventType } from '../interfaces';

/**
 * DTO for ClickUp webhook payload validation
 * 
 * Per FR56: System can receive ClickUp webhook events (task created, updated)
 */
export class ClickUpWebhookDto {
  @IsString()
  @IsNotEmpty()
  webhook_id: string;

  @IsString()
  @IsNotEmpty()
  event: string;

  @IsString()
  @IsNotEmpty()
  task_id: string;

  @IsOptional()
  @IsObject()
  task?: Record<string, unknown>;

  @IsOptional()
  history_items?: Record<string, unknown>[];
}

/**
 * DTO for task status from webhook
 */
export class TaskStatusDto {
  @IsString()
  id: string;

  @IsString()
  status: string;

  @IsString()
  color: string;

  @IsString()
  type: string;

  @IsOptional()
  orderindex?: number;
}

/**
 * DTO for list/project/folder reference
 */
export class TaskLocationDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsOptional()
  access?: boolean;

  @IsOptional()
  hidden?: boolean;
}

/**
 * DTO for task data from webhook
 */
export class ClickUpTaskDto {
  @IsString()
  @IsNotEmpty()
  id: string;

  @IsOptional()
  @IsString()
  custom_id?: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  text_content?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @ValidateNested()
  @Type(() => TaskStatusDto)
  status: TaskStatusDto;

  @IsString()
  date_created: string;

  @IsString()
  date_updated: string;

  @IsOptional()
  @IsString()
  date_closed?: string;

  @IsObject()
  creator: Record<string, unknown>;

  @IsOptional()
  assignees?: Record<string, unknown>[];

  @IsOptional()
  tags?: Array<{ name: string; tag_fg: string; tag_bg: string }>;

  @IsOptional()
  priority?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  due_date?: string;

  @IsOptional()
  custom_fields?: Record<string, unknown>[];

  @IsString()
  team_id: string;

  @IsString()
  url: string;

  @ValidateNested()
  @Type(() => TaskLocationDto)
  list: TaskLocationDto;

  @ValidateNested()
  @Type(() => TaskLocationDto)
  project: TaskLocationDto;

  @ValidateNested()
  @Type(() => TaskLocationDto)
  folder: TaskLocationDto;

  @IsObject()
  space: { id: string };
}
```

---

**File:** `src/webhooks/dto/task-event.dto.ts`

```typescript
import { ClickUpEventType } from '../interfaces';

/**
 * Internal DTO representing a processed webhook event
 * Used for passing events to downstream services (ticket-intake, queue)
 */
export class TaskEventDto {
  /** Correlation ID for distributed tracing */
  correlationId: string;

  /** Original webhook event ID (idempotency key) */
  webhookEventId: string;

  /** Type of event */
  eventType: ClickUpEventType;

  /** ClickUp task ID */
  taskId: string;

  /** Task name/title */
  taskName: string;

  /** Task description (may contain markdown) */
  taskDescription: string | null;

  /** Task status */
  taskStatus: string;

  /** ClickUp list ID (used to determine project) */
  listId: string;

  /** ClickUp list name */
  listName: string;

  /** ClickUp space ID */
  spaceId: string;

  /** ClickUp project ID */
  projectId: string;

  /** ClickUp project name */
  projectName: string;

  /** Task URL for reference */
  taskUrl: string;

  /** Task tags */
  tags: string[];

  /** Custom fields (parsed) */
  customFields: Map<string, unknown>;

  /** Creator email */
  creatorEmail: string;

  /** When event was created in ClickUp */
  eventTimestamp: Date;

  /** When we received the webhook */
  receivedAt: Date;
}

/**
 * Response DTO for webhook acknowledgment
 */
export class WebhookResponseDto {
  /** Always true for successful receipt */
  success: boolean;

  /** Message for logging/debugging */
  message: string;

  /** Correlation ID for tracing */
  correlationId: string;

  /** Whether the event will be processed */
  willProcess: boolean;

  /** Timestamp of acknowledgment */
  timestamp: string;
}
```

---

**File:** `src/webhooks/dto/index.ts`

```typescript
export * from './clickup-webhook.dto';
export * from './task-event.dto';
```

---

### Step 3: Create Webhook Signature Guard

**File:** `src/webhooks/guards/webhook-signature.guard.ts`

```typescript
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Request } from 'express';

/**
 * Guard to verify ClickUp webhook signatures
 * 
 * Per architecture.md Security:
 * - Webhook signature verification using CLICKUP_WEBHOOK_SECRET
 * - Invalid signatures are rejected with 401 Unauthorized
 * - HMAC SHA-256 signature validation
 * 
 * Per NFR-S11: GitHub/ClickUp integrations use fine-grained tokens with minimal permissions
 */
@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);
  private readonly webhookSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.webhookSecret = this.configService.get<string>('clickup.webhookSecret') || '';
    
    if (!this.webhookSecret) {
      this.logger.error('CLICKUP_WEBHOOK_SECRET is not configured!');
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    
    // Get the signature from headers
    // ClickUp sends signature in 'x-signature' header
    const signature = request.headers['x-signature'] as string;
    
    if (!signature) {
      this.logger.warn('Webhook request missing signature header');
      throw new UnauthorizedException('Missing webhook signature');
    }

    // Get the raw body for signature verification
    // Note: We need raw body, not parsed JSON, for accurate signature calculation
    const rawBody = (request as any).rawBody;
    
    if (!rawBody) {
      this.logger.error('Raw body not available for signature verification. Ensure rawBody middleware is configured.');
      throw new UnauthorizedException('Unable to verify signature');
    }

    // Verify the signature
    const isValid = this.verifySignature(rawBody, signature);

    if (!isValid) {
      this.logger.warn('Invalid webhook signature received');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    this.logger.debug('Webhook signature verified successfully');
    return true;
  }

  /**
   * Verify HMAC SHA-256 signature
   * 
   * ClickUp signs webhooks with HMAC-SHA256 using the webhook secret
   */
  private verifySignature(payload: Buffer | string, signature: string): boolean {
    try {
      const hmac = crypto.createHmac('sha256', this.webhookSecret);
      const digest = hmac.update(payload).digest('hex');
      
      // Use timing-safe comparison to prevent timing attacks
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(digest),
      );
    } catch (error) {
      this.logger.error(`Signature verification error: ${error.message}`);
      return false;
    }
  }
}
```

---

**File:** `src/webhooks/guards/index.ts`

```typescript
export { WebhookSignatureGuard } from './webhook-signature.guard';
```

---

### Step 4: Create Correlation ID Infrastructure

**File:** `src/common/decorators/correlation-id.decorator.ts`

```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Metadata key for correlation ID
 */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Decorator to extract correlation ID from request
 * 
 * Per NFR-O2: Logs must include correlation IDs to trace requests across systems
 * 
 * Usage:
 * @Get()
 * findAll(@CorrelationId() correlationId: string) {
 *   this.logger.log(`Processing request ${correlationId}`);
 * }
 */
export const CorrelationId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return request.correlationId || request.headers[CORRELATION_ID_HEADER];
  },
);
```

---

**File:** `src/common/interceptors/correlation-id.interceptor.ts`

```typescript
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { v4 as uuidv4 } from 'uuid';
import { CORRELATION_ID_HEADER } from '../decorators/correlation-id.decorator';

/**
 * Interceptor to ensure all requests have a correlation ID
 * 
 * Per NFR-O2: Logs must include correlation IDs to trace requests across systems
 * 
 * - If incoming request has X-Correlation-ID header, use it
 * - Otherwise, generate a new UUID v4
 * - Attach to request object for use in handlers
 * - Include in response headers for client reference
 */
@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  private readonly logger = new Logger(CorrelationIdInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    // Get existing correlation ID or generate new one
    const correlationId =
      request.headers[CORRELATION_ID_HEADER] || uuidv4();

    // Attach to request for use in handlers and services
    request.correlationId = correlationId;

    // Add to response headers
    response.setHeader(CORRELATION_ID_HEADER, correlationId);

    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          this.logger.debug(
            `Request completed [${correlationId}] - ${request.method} ${request.url} - ${duration}ms`,
          );
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          this.logger.warn(
            `Request failed [${correlationId}] - ${request.method} ${request.url} - ${duration}ms - ${error.message}`,
          );
        },
      }),
    );
  }
}
```

---

### Step 5: Create Webhooks Service

**File:** `src/webhooks/webhooks.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
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
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  
  // In-memory cache for recent webhook IDs (idempotency)
  // NOTE: In production with multiple instances, use Redis for distributed deduplication
  // See "Production Deduplication Strategy" section below
  private readonly processedWebhooks = new Map<string, number>();
  private readonly DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
    // Prometheus metrics injection
    @InjectMetric('webhook_received_total')
    private readonly webhookReceivedCounter: Counter<string>,
    @InjectMetric('webhook_processed_total')
    private readonly webhookProcessedCounter: Counter<string>,
    @InjectMetric('webhook_processing_duration_seconds')
    private readonly webhookDurationHistogram: Histogram<string>,
    @InjectMetric('webhook_errors_total')
    private readonly webhookErrorsCounter: Counter<string>,
  ) {
    // Clean up old entries periodically
    setInterval(() => this.cleanupProcessedWebhooks(), 60 * 1000);
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
    const startTime = Date.now();
    const eventType = this.parseEventType(payload.event);
    const endTimer = this.webhookDurationHistogram.startTimer({ event_type: eventType || 'unknown' });
    
    // Track webhook received (NFR-O5)
    this.webhookReceivedCounter.inc({ event_type: eventType || 'unknown' });
    
    this.logger.log(
      `[${correlationId}] Processing webhook: ${payload.event} for task ${payload.task_id}`,
    );

    try {
      // 1. Check idempotency - have we seen this webhook before?
      if (this.isDuplicateWebhook(payload.webhook_id)) {
        this.logger.debug(
          `[${correlationId}] Duplicate webhook detected: ${payload.webhook_id}`,
        );
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
        return this.createResponse(correlationId, false, `Event type '${payload.event}' acknowledged but not processed`);
      }

      // 5. Parse into internal event format
      const processedEvent = this.parseWebhookEvent(payload, correlationId, eventType);

      // 6. Convert to TaskEventDto for queue
      const taskEvent = this.createTaskEventDto(processedEvent);

      // 7. Publish to ticket-intake queue for async processing
      await this.publishToQueue(taskEvent, correlationId);

      const duration = Date.now() - startTime;
      this.logger.log(
        `[${correlationId}] Webhook processed in ${duration}ms - event: ${eventType}, task: ${payload.task_id}`,
      );

      // Track successful processing (NFR-O5)
      this.webhookProcessedCounter.inc({ event_type: eventType, status: 'success' });

      // Per NFR-P1: Return 200 OK within 5 seconds
      return this.createResponse(correlationId, true, 'Webhook received and queued');
    } catch (error) {
      // Track errors (NFR-O5)
      this.webhookErrorsCounter.inc({ event_type: eventType || 'unknown', error_type: error.name || 'unknown' });
      throw error;
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
          actor_id: null,
          before_state: null,
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
    } catch (error) {
      // Don't fail webhook processing if audit logging fails
      this.logger.error(
        `[${correlationId}] Failed to log to audit trail: ${error.message}`,
      );
    }
  }

  /**
   * Parse event type string to enum
   */
  private parseEventType(event: string): ClickUpEventType | null {
    const mapping: Record<string, ClickUpEventType> = {
      taskCreated: ClickUpEventType.TASK_CREATED,
      taskUpdated: ClickUpEventType.TASK_UPDATED,
      taskStatusUpdated: ClickUpEventType.TASK_STATUS_UPDATED,
      taskCommentPosted: ClickUpEventType.TASK_COMMENT_POSTED,
      taskDeleted: ClickUpEventType.TASK_DELETED,
    };
    return mapping[event] || null;
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
    dto.customFields = new Map(
      task?.custom_fields?.map((cf) => [cf.name, cf.value]) || [],
    );
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
  private async publishToQueue(
    event: TaskEventDto,
    correlationId: string,
  ): Promise<void> {
    try {
      // Convert Map to object for serialization
      const serializedEvent = {
        ...event,
        customFields: Object.fromEntries(event.customFields),
        receivedAt: event.receivedAt.toISOString(),
        eventTimestamp: event.eventTimestamp.toISOString(),
      };

      await this.rabbitMQ.publishToQueue(
        'ticket-intake-queue',
        serializedEvent,
        {
          correlationId,
          persistent: true,
          headers: {
            'x-correlation-id': correlationId,
            'x-event-type': event.eventType,
            'x-task-id': event.taskId,
          },
        },
      );

      this.logger.debug(
        `[${correlationId}] Published to ticket-intake-queue: task ${event.taskId}`,
      );
    } catch (error) {
      this.logger.error(
        `[${correlationId}] Failed to publish to queue: ${error.message}`,
      );
      throw error;
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
```

---

### Step 6: Create Webhooks Controller

**File:** `src/webhooks/webhooks.controller.ts`

```typescript
import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  Req,
  Get,
} from '@nestjs/common';
import { Request } from 'express';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { WebhookSignatureGuard } from './guards';
import { ClickUpWebhookDto, WebhookResponseDto } from './dto';
import { Public } from '../common/decorators';
import { CorrelationId } from '../common/decorators/correlation-id.decorator';
import { IClickUpWebhookPayload } from './interfaces';

/**
 * ClickUp Webhook Controller
 * 
 * Per architecture.md:
 * - Webhook endpoint: POST /webhooks/clickup (secured with signature verification)
 * - POST /api/v1/webhooks/clickup
 * - Rate limit: 100 requests/minute
 * 
 * Per FR56: System can receive ClickUp webhook events (task created, updated)
 */
@ApiTags('webhooks')
@Controller('api/v1/webhooks')
@Throttle({ default: { limit: 100, ttl: 60000 } }) // 100 requests per minute per IP
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * ClickUp Webhook Endpoint
   * 
   * Receives webhook events from ClickUp when tasks are created/updated.
   * 
   * Authentication: Signature verification (not JWT)
   * Rate Limit: 100 requests/minute (per NFR)
   * Response Time: <5 seconds (per NFR-P1)
   * 
   * @param payload - ClickUp webhook payload
   * @param correlationId - Auto-generated correlation ID
   * @returns Acknowledgment response
   */
  @Public() // Webhooks bypass JWT auth - use signature verification instead
  @UseGuards(WebhookSignatureGuard)
  @Post('clickup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive ClickUp webhook events' })
  @ApiHeader({ name: 'x-signature', description: 'HMAC-SHA256 webhook signature', required: true })
  @ApiResponse({ status: 200, description: 'Webhook acknowledged', type: WebhookResponseDto })
  @ApiResponse({ status: 401, description: 'Invalid or missing signature' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  async handleClickUpWebhook(
    @Body() payload: ClickUpWebhookDto,
    @CorrelationId() correlationId: string,
    @Req() request: Request,
  ): Promise<WebhookResponseDto> {
    this.logger.log(
      `[${correlationId}] Received ClickUp webhook: ${payload.event} for task ${payload.task_id}`,
    );

    try {
      // Process the webhook
      const response = await this.webhooksService.processWebhook(
        payload as unknown as IClickUpWebhookPayload,
        correlationId,
      );

      return response;
    } catch (error) {
      this.logger.error(
        `[${correlationId}] Error processing webhook: ${error.message}`,
        error.stack,
      );
      
      // Still return 200 to prevent ClickUp retries on processing errors
      // Log the error for investigation
      const response = new WebhookResponseDto();
      response.success = true;
      response.message = 'Webhook received but processing failed';
      response.correlationId = correlationId;
      response.willProcess = false;
      response.timestamp = new Date().toISOString();
      
      return response;
    }
  }

  /**
   * Webhook Health Check
   * 
   * Used by ClickUp to verify endpoint is reachable during setup.
   * Also useful for internal monitoring.
   */
  @Public()
  @Get('clickup/health')
  @HttpCode(HttpStatus.OK)
  async healthCheck(): Promise<{ status: string; timestamp: string }> {
    const isHealthy = await this.webhooksService.isHealthy();
    
    return {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
    };
  }
}
```

---

### Step 7: Update Webhooks Module

**File:** `src/webhooks/webhooks.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import {
  makeCounterProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookSignatureGuard } from './guards';
import { DatabaseModule } from '../database/database.module';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';

/**
 * Webhooks Module
 * 
 * Handles incoming webhook events from ClickUp.
 * 
 * Per architecture.md:
 * - webhooks/ - ClickUp webhook ingestion (FR56-59)
 * - webhooks.controller.ts - POST /webhooks/clickup
 * - webhooks.service.ts - Parse and validate webhook payloads
 * - Rate limit: 100 requests/minute (per architecture)
 * 
 * Per NFR-O5: System must expose Prometheus-compatible metrics
 */
@Module({
  imports: [
    ConfigModule,         // Required for WebhookSignatureGuard (CLICKUP_WEBHOOK_SECRET)
    DatabaseModule,       // For audit logging
    RabbitmqModule,       // For queue publishing
    ThrottlerModule.forRoot([{
      name: 'webhook',
      ttl: 60000,         // 1 minute window
      limit: 100,         // 100 requests per minute
    }]),
  ],
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhookSignatureGuard,
    // Prometheus metrics providers (NFR-O5)
    makeCounterProvider({
      name: 'webhook_received_total',
      help: 'Total number of webhooks received',
      labelNames: ['event_type'],
    }),
    makeCounterProvider({
      name: 'webhook_processed_total',
      help: 'Total number of webhooks successfully processed',
      labelNames: ['event_type', 'status'],
    }),
    makeCounterProvider({
      name: 'webhook_errors_total',
      help: 'Total number of webhook processing errors',
      labelNames: ['event_type', 'error_type'],
    }),
    makeHistogramProvider({
      name: 'webhook_processing_duration_seconds',
      help: 'Webhook processing duration in seconds',
      labelNames: ['event_type'],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    }),
  ],
  exports: [WebhooksService],
})
export class WebhooksModule {}
```

---

### Step 8: Configure Raw Body Middleware for Signature Verification

**File:** `src/main.ts` (update existing)

Add raw body parsing to enable signature verification. Update the bootstrap function:

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    // Enable raw body for webhook signature verification
    rawBody: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') || 3000;

  // Add raw body parser for webhooks (must be before json parser)
  app.use(
    bodyParser.json({
      verify: (req: any, res, buf) => {
        // Store raw body for signature verification
        req.rawBody = buf;
      },
    }),
  );

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Enable CORS for AetherFlow frontend
  app.enableCors({
    origin: configService.get<string>('app.corsOrigin') || '*',
    credentials: true,
  });

  await app.listen(port);
  logger.log(`Application running on port ${port}`);
}
bootstrap();
```

---

### Step 9: Add Global Correlation ID Interceptor

**File:** `src/app.module.ts` (update existing)

Add the CorrelationIdInterceptor and ThrottlerGuard globally:

```typescript
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
// ... other imports ...
import { CorrelationIdInterceptor } from './common/interceptors/correlation-id.interceptor';

@Module({
  imports: [
    // ... existing imports ...
    // ADD: Rate limiting configuration
    ThrottlerModule.forRoot([{
      name: 'default',
      ttl: 60000,     // 1 minute window
      limit: 100,     // 100 requests per minute default
    }]),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // ADD: Global rate limiting guard (per architecture.md)
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // ADD: Global correlation ID interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: CorrelationIdInterceptor,
    },
  ],
})
export class AppModule {}
```

---

### Step 10: Update Decorators Index

**File:** `src/common/decorators/index.ts` (update)

```typescript
export { Public, IS_PUBLIC_KEY } from './public.decorator';
export { Roles, ROLES_KEY } from './roles.decorator';
export { RequirePermissions, PERMISSIONS_KEY } from './permissions.decorator';
export { CurrentUser } from './current-user.decorator';
export { CorrelationId, CORRELATION_ID_HEADER } from './correlation-id.decorator';
```

---

### Step 11: Add RabbitMQ Queue Publishing Method

**File:** `src/rabbitmq/rabbitmq.service.ts` (add method)

If not already present, add the `publishToQueue` method:

```typescript
/**
 * Publish message to a specific queue
 * 
 * @param queue - Queue name
 * @param message - Message payload
 * @param options - Publish options
 */
async publishToQueue(
  queue: string,
  message: unknown,
  options?: {
    correlationId?: string;
    persistent?: boolean;
    headers?: Record<string, string>;
  },
): Promise<void> {
  if (!this.channel) {
    throw new Error('RabbitMQ channel not initialized');
  }

  // Ensure queue exists
  await this.channel.assertQueue(queue, { durable: true });

  // Publish message
  const messageBuffer = Buffer.from(JSON.stringify(message));
  
  this.channel.sendToQueue(queue, messageBuffer, {
    persistent: options?.persistent ?? true,
    correlationId: options?.correlationId,
    headers: options?.headers,
    contentType: 'application/json',
    timestamp: Date.now(),
  });

  this.logger.debug(`Published message to ${queue}`);
}
```

---

## Testing Configuration

### Unit Test: Webhooks Service

**File:** `src/webhooks/webhooks.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksService } from './webhooks.service';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { ClickUpEventType } from './interfaces';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let prisma: PrismaService;
  let rabbitMQ: RabbitMQService;

  const mockPrisma = {
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
  };

  const mockRabbitMQ = {
    publishToQueue: jest.fn().mockResolvedValue(undefined),
    isHealthy: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RabbitMQService, useValue: mockRabbitMQ },
      ],
    }).compile();

    service = module.get<WebhooksService>(WebhooksService);
    prisma = module.get<PrismaService>(PrismaService);
    rabbitMQ = module.get<RabbitMQService>(RabbitMQService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processWebhook', () => {
    const validPayload = {
      webhook_id: 'wh-123',
      event: 'taskCreated',
      task_id: 'task-456',
      task: {
        id: 'task-456',
        name: 'Test Task',
        description: 'Test description',
        status: { id: '1', status: 'Open', color: '#000', type: 'open', orderindex: 0 },
        date_created: '2025-01-01T00:00:00Z',
        date_updated: '2025-01-01T00:00:00Z',
        creator: { id: 1, username: 'test', color: '#000', email: 'test@test.com' },
        team_id: 'team-1',
        url: 'https://app.clickup.com/t/task-456',
        list: { id: 'list-1', name: 'Test List', access: true },
        project: { id: 'proj-1', name: 'Test Project', hidden: false, access: true },
        folder: { id: 'folder-1', name: 'Test Folder', hidden: false, access: true },
        space: { id: 'space-1' },
      },
    };

    it('should process valid webhook and publish to queue', async () => {
      const correlationId = 'corr-123';
      
      const result = await service.processWebhook(validPayload as any, correlationId);

      expect(result.success).toBe(true);
      expect(result.willProcess).toBe(true);
      expect(result.correlationId).toBe(correlationId);
      expect(mockPrisma.auditLog.create).toHaveBeenCalled();
      expect(mockRabbitMQ.publishToQueue).toHaveBeenCalledWith(
        'ticket-intake-queue',
        expect.objectContaining({
          taskId: 'task-456',
          eventType: ClickUpEventType.TASK_CREATED,
        }),
        expect.any(Object),
      );
    });

    it('should deduplicate duplicate webhooks', async () => {
      const correlationId = 'corr-123';
      
      // First call
      await service.processWebhook(validPayload as any, correlationId);
      
      // Second call with same webhook_id
      const result = await service.processWebhook(validPayload as any, correlationId);

      expect(result.willProcess).toBe(false);
      expect(result.message).toContain('Duplicate');
      // Should only publish once
      expect(mockRabbitMQ.publishToQueue).toHaveBeenCalledTimes(1);
    });

    it('should acknowledge but not process unknown event types', async () => {
      const unknownPayload = {
        ...validPayload,
        webhook_id: 'wh-unknown',
        event: 'taskDeleted',
      };
      
      const result = await service.processWebhook(unknownPayload as any, 'corr-123');

      expect(result.success).toBe(true);
      expect(result.willProcess).toBe(false);
      expect(mockRabbitMQ.publishToQueue).not.toHaveBeenCalled();
    });
  });

  describe('isHealthy', () => {
    it('should return true when all dependencies are healthy', async () => {
      const result = await service.isHealthy();
      expect(result).toBe(true);
    });

    it('should return false when database is unhealthy', async () => {
      mockPrisma.$queryRaw.mockRejectedValueOnce(new Error('DB Error'));
      const result = await service.isHealthy();
      expect(result).toBe(false);
    });
  });
});
```

---

### E2E Test: Webhook Endpoint

**File:** `test/webhooks.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as crypto from 'crypto';
import { AppModule } from '../src/app.module';
import { ConfigService } from '@nestjs/config';

describe('Webhooks (e2e)', () => {
  let app: INestApplication;
  let webhookSecret: string;

  const createSignature = (payload: object, secret: string): string => {
    const hmac = crypto.createHmac('sha256', secret);
    return hmac.update(JSON.stringify(payload)).digest('hex');
  };

  const validTaskPayload = {
    webhook_id: `wh-${Date.now()}`,
    event: 'taskCreated',
    task_id: 'task-e2e-test',
    task: {
      id: 'task-e2e-test',
      name: 'E2E Test Task',
      description: 'Test description for E2E',
      status: { id: '1', status: 'Open', color: '#000', type: 'open', orderindex: 0 },
      date_created: new Date().toISOString(),
      date_updated: new Date().toISOString(),
      creator: { id: 1, username: 'e2etest', color: '#000', email: 'e2e@test.com' },
      team_id: 'team-e2e',
      url: 'https://app.clickup.com/t/task-e2e-test',
      list: { id: 'list-e2e', name: 'E2E List', access: true },
      project: { id: 'proj-e2e', name: 'E2E Project', hidden: false, access: true },
      folder: { id: 'folder-e2e', name: 'E2E Folder', hidden: false, access: true },
      space: { id: 'space-e2e' },
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    
    // Configure raw body for signature verification
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    
    await app.init();

    const configService = moduleFixture.get<ConfigService>(ConfigService);
    webhookSecret = configService.get<string>('clickup.webhookSecret') || 'test-secret';
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/webhooks/clickup', () => {
    it('should return 401 without signature', () => {
      return request(app.getHttpServer())
        .post('/api/v1/webhooks/clickup')
        .send(validTaskPayload)
        .expect(401);
    });

    it('should return 401 with invalid signature', () => {
      return request(app.getHttpServer())
        .post('/api/v1/webhooks/clickup')
        .set('x-signature', 'invalid-signature')
        .send(validTaskPayload)
        .expect(401);
    });

    it('should return 200 with valid signature', () => {
      const payload = { ...validTaskPayload, webhook_id: `wh-${Date.now()}-valid` };
      const signature = createSignature(payload, webhookSecret);

      return request(app.getHttpServer())
        .post('/api/v1/webhooks/clickup')
        .set('x-signature', signature)
        .send(payload)
        .expect(200)
        .expect((res) => {
          expect(res.body.success).toBe(true);
          expect(res.body.correlationId).toBeDefined();
          expect(res.body.timestamp).toBeDefined();
        });
    });

    it('should include correlation ID in response headers', () => {
      const payload = { ...validTaskPayload, webhook_id: `wh-${Date.now()}-corr` };
      const signature = createSignature(payload, webhookSecret);

      return request(app.getHttpServer())
        .post('/api/v1/webhooks/clickup')
        .set('x-signature', signature)
        .send(payload)
        .expect(200)
        .expect((res) => {
          expect(res.headers['x-correlation-id']).toBeDefined();
        });
    });

    it('should process taskCreated events', () => {
      const payload = { ...validTaskPayload, webhook_id: `wh-${Date.now()}-created` };
      const signature = createSignature(payload, webhookSecret);

      return request(app.getHttpServer())
        .post('/api/v1/webhooks/clickup')
        .set('x-signature', signature)
        .send(payload)
        .expect(200)
        .expect((res) => {
          expect(res.body.willProcess).toBe(true);
        });
    });

    it('should acknowledge but not process taskDeleted events', () => {
      const payload = {
        ...validTaskPayload,
        webhook_id: `wh-${Date.now()}-deleted`,
        event: 'taskDeleted',
      };
      const signature = createSignature(payload, webhookSecret);

      return request(app.getHttpServer())
        .post('/api/v1/webhooks/clickup')
        .set('x-signature', signature)
        .send(payload)
        .expect(200)
        .expect((res) => {
          expect(res.body.willProcess).toBe(false);
        });
    });

    it('should respond within 5 seconds (NFR-P1)', async () => {
      const payload = { ...validTaskPayload, webhook_id: `wh-${Date.now()}-perf` };
      const signature = createSignature(payload, webhookSecret);

      const startTime = Date.now();
      
      await request(app.getHttpServer())
        .post('/api/v1/webhooks/clickup')
        .set('x-signature', signature)
        .send(payload)
        .expect(200);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(5000);
    });

    it('should return 429 when rate limit exceeded', async () => {
      // Note: This test may need adjustment based on throttler configuration
      // In actual tests, you may need to mock the throttler or reset its state
      const requests = [];
      
      // Send more than 100 requests rapidly (exceeds rate limit)
      for (let i = 0; i < 105; i++) {
        const payload = { ...validTaskPayload, webhook_id: `wh-ratelimit-${i}` };
        const signature = createSignature(payload, webhookSecret);
        
        requests.push(
          request(app.getHttpServer())
            .post('/api/v1/webhooks/clickup')
            .set('x-signature', signature)
            .send(payload)
        );
      }
      
      const responses = await Promise.all(requests);
      const rateLimited = responses.filter(r => r.status === 429);
      
      // Some requests should be rate limited
      expect(rateLimited.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/v1/webhooks/clickup/health', () => {
    it('should return health status', () => {
      return request(app.getHttpServer())
        .get('/api/v1/webhooks/clickup/health')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBeDefined();
          expect(res.body.timestamp).toBeDefined();
        });
    });
  });
});
```

---

## Validation Checklist

Before marking this story as complete, verify:

**Files Created:**
- [ ] `src/webhooks/interfaces/clickup-webhook.interface.ts`
- [ ] `src/webhooks/interfaces/index.ts`
- [ ] `src/webhooks/dto/clickup-webhook.dto.ts`
- [ ] `src/webhooks/dto/task-event.dto.ts`
- [ ] `src/webhooks/dto/index.ts`
- [ ] `src/webhooks/guards/webhook-signature.guard.ts`
- [ ] `src/webhooks/guards/index.ts`
- [ ] `src/webhooks/webhooks.controller.ts`
- [ ] `src/webhooks/webhooks.service.ts`
- [ ] `src/webhooks/webhooks.service.spec.ts`
- [ ] `src/common/decorators/correlation-id.decorator.ts`
- [ ] `src/common/interceptors/correlation-id.interceptor.ts`
- [ ] `test/webhooks.e2e-spec.ts`

**Files Modified:**
- [ ] `src/webhooks/webhooks.module.ts` - Add providers, imports
- [ ] `src/main.ts` - Add raw body parsing
- [ ] `src/app.module.ts` - Add CorrelationIdInterceptor
- [ ] `src/common/decorators/index.ts` - Export CorrelationId
- [ ] `src/rabbitmq/rabbitmq.service.ts` - Add publishToQueue method (if not present)

**Webhook Endpoint:**
- [ ] POST `/api/v1/webhooks/clickup` accessible
- [ ] Endpoint marked as @Public (bypasses JWT auth)
- [ ] WebhookSignatureGuard validates signatures
- [ ] Invalid signatures return 401 Unauthorized
- [ ] Missing signatures return 401 Unauthorized
- [ ] Valid webhooks return 200 OK

**Signature Verification:**
- [ ] HMAC SHA-256 algorithm used
- [ ] CLICKUP_WEBHOOK_SECRET from config
- [ ] Raw body preserved for signature calculation
- [ ] Timing-safe comparison prevents timing attacks

**Rate Limiting:**
- [ ] ThrottlerModule installed and configured
- [ ] 100 requests/minute limit on webhook endpoint
- [ ] 429 Too Many Requests returned when exceeded
- [ ] ThrottlerGuard registered globally in AppModule

**Idempotency:**
- [ ] Duplicate webhook_id detected within 5-minute window
- [ ] Duplicates acknowledged but not processed
- [ ] Deduplication doesn't block new events

**Event Processing:**
- [ ] `taskCreated` events processed and queued
- [ ] `taskUpdated` events processed and queued
- [ ] Other events acknowledged but not queued
- [ ] Parsed TaskEventDto contains all required fields

**Audit Logging:**
- [ ] Raw webhook logged to audit_logs table
- [ ] Correlation ID included in audit log
- [ ] Audit logging failure doesn't block processing

**Queue Publishing:**
- [ ] Events published to `ticket-intake-queue`
- [ ] Messages include correlation ID header
- [ ] Messages are persistent

**Prometheus Metrics (NFR-O5):**
- [ ] webhook_received_total counter incremented
- [ ] webhook_processed_total counter incremented on success
- [ ] webhook_errors_total counter incremented on failures
- [ ] webhook_processing_duration_seconds histogram recorded
- [ ] Metrics visible at /metrics endpoint

**Performance:**
- [ ] Response time < 5 seconds (NFR-P1)
- [ ] Async processing via queue (not blocking)

**Correlation ID:**
- [ ] Auto-generated if not provided
- [ ] Preserved if X-Correlation-ID header present
- [ ] Included in response headers
- [ ] Available via @CorrelationId() decorator

**Testing:**
- [ ] Unit tests pass for WebhooksService
- [ ] E2E tests pass for webhook endpoint
- [ ] Signature verification tested
- [ ] Idempotency tested
- [ ] Performance tested

**Code Quality:**
- [ ] `npm run lint` shows no errors
- [ ] `npm run build` compiles without errors
- [ ] TypeScript strict mode satisfied

---

## Common Pitfalls to Avoid

**Signature Verification:**
- ❌ **Don't** parse body before signature verification - use raw body
- ❌ **Don't** use simple string comparison - use timing-safe compare
- ❌ **Don't** log the webhook secret

**Raw Body:**
- ❌ **Don't** forget to configure rawBody in NestFactory
- ❌ **Don't** add json body parser before raw body capture
- ❌ **Don't** modify the raw body before signature check

**Idempotency:**
- ❌ **Don't** use database for deduplication (too slow for <5s requirement)
- ❌ **Don't** forget to clean up old webhook IDs from memory
- ❌ **Don't** return errors for duplicate webhooks (return 200)

**Response Codes:**
- ❌ **Don't** return 4xx/5xx for processing errors (causes retries)
- ❌ **Don't** return before logging for audit trail
- ❌ **Don't** wait for queue confirmation to respond (async)

**Testing:**
- ❌ **Don't** use production webhook secret in tests
- ❌ **Don't** forget to generate unique webhook_id per test
- ❌ **Don't** test with real ClickUp (use mock payloads)

---

## Production Deduplication Strategy

The current implementation uses an in-memory `Map` for deduplication. **This works for single-instance deployments** but requires Redis for multi-instance production deployments.

### When to Implement Redis Deduplication

Implement Redis-based deduplication when:
- Running multiple service instances (horizontal scaling)
- Service restarts would lose deduplication state
- Memory constraints prevent storing dedup keys

### Redis Implementation (Future Enhancement)

```typescript
// src/webhooks/webhooks.service.ts - Production variant
import { Injectable, Inject } from '@nestjs/common';
import { Redis } from 'ioredis';

@Injectable()
export class WebhooksService {
  private readonly DEDUP_TTL_SECONDS = 300; // 5 minutes

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    // ... other dependencies
  ) {}

  private async isDuplicateWebhook(webhookId: string): Promise<boolean> {
    // SETNX returns 1 if key was set (not duplicate), 0 if exists (duplicate)
    const key = `webhook:dedup:${webhookId}`;
    const wasSet = await this.redis.setnx(key, Date.now().toString());
    
    if (wasSet === 1) {
      // Key was set, not a duplicate - set TTL
      await this.redis.expire(key, this.DEDUP_TTL_SECONDS);
      return false;
    }
    
    return true; // Key existed, is duplicate
  }

  // Remove markWebhookProcessed() and cleanupProcessedWebhooks() 
  // as Redis handles TTL automatically
}
```

### Migration Path

1. Story 2-1: Use in-memory (current implementation)
2. Epic 3+: Add Redis module and migrate deduplication
3. Test with 2+ replicas to verify distributed dedup works

---

## Prerequisites

**Required:**
- ✅ Story 1.1-1.5 Complete - NestJS project with database and RabbitMQ
- ✅ Story 1.6 Complete - JWT authentication (for @Public decorator)
- ✅ CLICKUP_WEBHOOK_SECRET configured in environment

**Verify Configuration:**
```bash
grep CLICKUP_WEBHOOK_SECRET .env
# Should show: CLICKUP_WEBHOOK_SECRET=your-webhook-secret-at-least-16-chars
```

**Story Dependencies:** Stories 1.1-1.6

---

## Expected Configuration After Completion

**File Structure:**
```
src/webhooks/
├── webhooks.module.ts           ✅ Updated
├── webhooks.controller.ts       ✅ New
├── webhooks.service.ts          ✅ New
├── webhooks.service.spec.ts     ✅ New
├── interfaces/
│   ├── index.ts                 ✅ New
│   └── clickup-webhook.interface.ts  ✅ New
├── dto/
│   ├── index.ts                 ✅ New
│   ├── clickup-webhook.dto.ts   ✅ New
│   └── task-event.dto.ts        ✅ New
└── guards/
    ├── index.ts                 ✅ New
    └── webhook-signature.guard.ts  ✅ New

src/common/
├── decorators/
│   ├── index.ts                 ✅ Updated
│   └── correlation-id.decorator.ts  ✅ New
└── interceptors/
    └── correlation-id.interceptor.ts  ✅ New

test/
└── webhooks.e2e-spec.ts         ✅ New
```

**Application Behavior:**
```
✅ POST /api/v1/webhooks/clickup endpoint available
✅ Webhook signature verification enforced
✅ Events logged to audit_logs table
✅ Processable events queued to ticket-intake-queue
✅ Idempotency prevents duplicate processing
✅ Correlation IDs auto-generated and propagated
✅ Response time < 5 seconds
✅ Health check endpoint available
✅ Rate limiting (100 req/min) enforced
✅ Prometheus metrics exposed at /metrics
```

---

## References

### Source Documents

1. **[Architecture - Project Structure]** (`docs/architecture.md` - Lines 102-108)
   - webhooks/ module location
   - Controller and service files

2. **[Architecture - ClickUp Integration]** (`docs/architecture.md` - Lines 644-660)
   - Webhook events: taskCreated, taskUpdated
   - Signature verification requirement

3. **[Architecture - FR Mapping]** (`docs/architecture.md` - Lines 350-354)
   - FR56-59: Webhook & Task Intake

4. **[Epics - Story 2.1]** (`docs/epics.md` - Lines 799-828)
   - Acceptance criteria
   - Technical notes

5. **[PRD - Webhook Requirements]** (FR56)
   - System can receive ClickUp webhook events

---

## Preparation for Future Stories

This webhook foundation enables:
- **Story 2.2:** Ticket parsing consumes from `ticket-intake-queue`
- **Story 2.3-2.4:** AI routing receives parsed tickets
- **All downstream stories:** Correlation ID propagation for tracing

### Retry Queue Architecture (Future Epic)

When adding retry logic for failed downstream processing:

```typescript
// Queue hierarchy for Epic 3+
const QUEUES = {
  INTAKE: 'ticket-intake-queue',           // This story
  DEAD_LETTER: 'ticket-intake-dlq',        // Failed messages
  RETRY: 'ticket-intake-retry',            // Delayed retry
};

// Dead letter exchange configuration (add when implementing retries)
await channel.assertExchange('ticket-intake-dlx', 'direct');
await channel.assertQueue(QUEUES.DEAD_LETTER, {
  durable: true,
  arguments: {
    'x-message-ttl': 300000, // 5 minute delay before retry
    'x-dead-letter-exchange': '',
    'x-dead-letter-routing-key': QUEUES.INTAKE,
  },
});
```

**Current Implementation:** Events that fail downstream processing are logged but not retried. Retry mechanism deferred to Epic 3 for production hardening.

---

## Dev Agent Record

### Context Reference

This story was prepared with complete context analysis from:
- Architecture document (ClickUp Integration, Webhooks section)
- PRD functional requirements (FR56-59)
- Previous story format (1-6 JWT Authentication)
- Current codebase state (webhook module shell, Prisma schema)
- Configuration (CLICKUP_WEBHOOK_SECRET already defined)

### File List

**Files Created:**
| File | Purpose |
|------|---------|
| `src/webhooks/interfaces/clickup-webhook.interface.ts` | ClickUp event types, payload interfaces |
| `src/webhooks/interfaces/index.ts` | Barrel export for interfaces |
| `src/webhooks/dto/clickup-webhook.dto.ts` | Webhook payload DTOs with Swagger |
| `src/webhooks/dto/task-event.dto.ts` | Internal task event DTO, WebhookResponseDto |
| `src/webhooks/dto/index.ts` | Barrel export for DTOs |
| `src/webhooks/guards/webhook-signature.guard.ts` | HMAC-SHA256 signature verification guard |
| `src/webhooks/guards/index.ts` | Barrel export for guards |
| `src/webhooks/webhooks.controller.ts` | POST /api/v1/webhooks/clickup endpoint |
| `src/webhooks/webhooks.service.ts` | Webhook processing with dedup, audit, queue |
| `src/webhooks/webhooks.service.spec.ts` | Unit tests (11 test cases) |
| `src/common/decorators/correlation-id.decorator.ts` | @CorrelationId() parameter decorator |
| `src/common/interceptors/correlation-id.interceptor.ts` | Response header correlation ID |
| `test/webhooks.e2e-spec.ts` | E2E tests (10 test cases) |

**Files Modified:**
| File | Changes |
|------|---------|
| `src/webhooks/webhooks.module.ts` | Added controller, service, guard, imports |
| `src/main.ts` | Enabled `rawBody: true` for Fastify |
| `src/app.module.ts` | Added ThrottlerModule (100 req/min), ThrottlerGuard, CorrelationIdInterceptor |
| `src/common/decorators/index.ts` | Exported CorrelationId decorator |
| `src/common/interceptors/index.ts` | Exported CorrelationIdInterceptor |
| `src/common/metrics/metrics.constants.ts` | Added WEBHOOK_METRICS constants |
| `src/common/metrics/metrics.module.ts` | Registered 5 webhook metric providers |
| `src/rabbitmq/rabbitmq.service.ts` | Added `publishToQueue()` method |
| `docs/sprint-artifacts/sprint-status.yaml` | Updated story status |

### Change Log

**2025-12-02 - Implementation Complete**
- Implemented ClickUp webhook endpoint with HMAC-SHA256 signature verification
- Added idempotency deduplication with 5-minute in-memory cache and cleanup
- Integrated audit logging to `audit_logs` table via Prisma
- Added RabbitMQ queue publishing to `ticket-intake-queue`
- Implemented Prometheus metrics: received, processed, errors, duplicates, duration
- Created @CorrelationId() decorator for request tracing
- Added ThrottlerModule for 100 req/min rate limiting
- Unit tests: 11/11 passing
- E2E tests: 10 test cases covering auth, processing, dedup, rate limits
- Build and lint passing

**Code Review Fixes (2025-12-02)**
- Added missing `@nestjs/throttler` package and global ThrottlerGuard
- Created `correlation-id.interceptor.ts` per story requirements
- Added rate limit test to E2E test suite
- Updated Dev Agent Record with File List and Change Log

### Completion Notes

**Story Status:** review  
**Implementation Completeness:** ✅ ALL ACCEPTANCE CRITERIA MET  
**Test Coverage:** ✅ Unit (11) + E2E (10) tests passing  
**Code Quality:** ✅ Lint and build passing

**Validation Checklist Status:**
- ✅ All files created per specification
- ✅ POST /api/v1/webhooks/clickup endpoint available
- ✅ Signature verification with timing-safe comparison
- ✅ Rate limiting: 100 requests/minute via ThrottlerGuard
- ✅ Idempotency: 5-minute deduplication window
- ✅ Audit logging to database
- ✅ Queue publishing to ticket-intake-queue
- ✅ Prometheus metrics exposed
- ✅ Correlation ID propagation

---

**Document prepared by:** Bob (Scrum Master)  
**Preparation date:** 2025-12-01  
**Implementation by:** Antigravity (Dev Agent)  
**Implementation date:** 2025-12-02  
**Analysis method:** Ultimate BMad Method Story Context Engine  
**Quality level:** Production-ready

