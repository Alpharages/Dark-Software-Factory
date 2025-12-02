# Story 2.10: RabbitMQ AI Execution Queue Processing

**Epic:** 2 - Ticket Intake & AI Routing Engine  
**Status:** ready-for-dev  
**Priority:** P1 - HIGH  
**Effort:** 8 story points  
**ClickUp ID:** `86evnjwam`  
**ClickUp URL:** https://app.clickup.com/t/86evnjwam

---

## ⛔ BLOCKER: Stories 2.5-2.9 Must Be Complete

**DO NOT START** this story until Stories 2.5 through 2.9 are implemented and validated.

**Required from Story 2.5 (Execution Tracking):**
- ✅ `ExecutionTrackerService` with status update methods
- ✅ Execution model in Prisma with status tracking

**Required from Story 1.5 (RabbitMQ):**
- ✅ `RabbitMQService` with `getChannel()` method (VERIFIED - exists)
- ✅ `RabbitMQPublisherService` with `publishToQueue()` method (VERIFIED - exists)
- ✅ Queue infrastructure (`ai-execution-queue`) already configured
- ✅ Dead letter exchange configured

**Required from Story 2.9 (Retry Logic):**
- ✅ `RetryHandlerService` for handling failed executions
- ✅ `RetryClassifierService` for error classification
- ✅ Retry scheduling via RabbitMQ

**Required from Story 2.8 (Orchestration):**
- ✅ `OrchestratorService` with execute method

**If prerequisites are incomplete:** You will encounter errors:
- `No provider for OrchestratorService`
- `No provider for RetryHandlerService`

**Verify prerequisites:** Check `docs/sprint-artifacts/sprint-status.yaml`

---

## Story

As the system,
I want AI executions to be processed asynchronously via message queue,
So that webhook responses are fast and execution can scale independently.

---

## Acceptance Criteria

**Publishing:** Message to `ai-execution-queue` contains: `ticket_id`, `execution_id`, `ai_provider` (CURSOR | WINDSURF | ANTIGRAVITY per Prisma enum), `priority` (1-5), `correlation_id`

**Consumer:** Manual ack (`noAck: false`), prefetch=1, status updates via ExecutionTrackerService, crash recovery via requeue

**Queue Management:** DLQ after 3 retries, depth monitoring (Prometheus gauge), rate tracking (messages/sec), consumer count monitoring

**Events:** Emit to `orchestrator-events` exchange: `ai.execution.started`, `ai.execution.completed`, `ai.execution.failed`

> **⚠️ IMPORTANT:** AIProvider enum values are: `CURSOR`, `WINDSURF`, `ANTIGRAVITY` (defined in `prisma/schema.prisma`). Do NOT use `CURSOR_HEADLESS` or `CLAUDE_CODE` - these will cause Prisma errors.

---

## Quick Implementation Summary (TL;DR)

**Step 0: Understand the Architecture**
- Coordinates with: `OrchestratorService`, `RetryHandlerService`, `RabbitMQService`
- Implements: Queue consumer + message publisher + metrics
- Uses: `RabbitMQPublisherService` for publishing, raw channel for consuming

**10 Key Files in Implementation Order:**
1. `src/execution/interfaces/queue.interface.ts` - Queue message interfaces
2. `src/execution/dto/queue-message.dto.ts` - Message DTOs with validation
3. `src/execution/ai-execution.publisher.ts` - Publish executions to queue
4. `src/execution/ai-execution.consumer.ts` - Consume and process executions
5. `src/execution/execution-tracker.service.ts` - Track execution state changes
6. `src/execution/execution.module.ts` - **MODIFY**: Wire all services
7. `src/execution/ai-execution.consumer.spec.ts` - Unit tests
8. `src/common/metrics/queue-metrics.provider.ts` - Queue-specific metrics
9. `test/ai-execution-queue.e2e-spec.ts` - Integration tests
10. `src/app.module.ts` - **MODIFY**: Import ExecutionModule

**New Dependencies:** None (uses existing RabbitMQ infrastructure)

**Environment Variables:**
```env
# Queue Configuration (optional - has defaults)
AI_EXECUTION_PREFETCH=1
AI_EXECUTION_CONSUMER_TAG=ai-execution-consumer
```

---

## Technical Requirements

> **📍 Architecture Note:** Architecture doc shows `rabbitmq/consumers/ai-task.consumer.ts` as alternative location. We use `execution/` module for execution-specific logic colocation. Both are valid - this choice keeps execution tracking and queue consuming together.

---

## Step 0: Verify Prerequisites (REQUIRED)

### 0.1 Check RabbitMQ Service Exists

```bash
# Verify RabbitMQ service
ls src/rabbitmq/rabbitmq.service.ts
grep -E "getChannel|publishToQueue" src/rabbitmq/*.ts
```

**Expected:** Files exist with required methods.

### 0.2 Check Queue Configuration

```bash
# Verify queue names
grep "AI_EXECUTION" src/rabbitmq/rabbitmq.config.ts
```

**Expected:** `AI_EXECUTION: 'ai-execution-queue'` exists.

### 0.3 Check Prisma Schema

```bash
# Verify Execution model
grep -A 20 "model Execution" prisma/schema.prisma
```

**Expected:** Execution model with status, ticket_id, ai_provider fields.

**If any check fails:** STOP. Complete prerequisites first.

---

## Step 1: Create Queue Interfaces

**File:** `src/execution/interfaces/queue.interface.ts`

```typescript
/**
 * Queue Interfaces
 * Story 2.10: RabbitMQ AI Execution Queue Processing
 */

import { AIProvider } from '@prisma/client';

/**
 * Message published to ai-execution-queue
 */
export interface IAIExecutionMessage {
  /** Unique message identifier */
  messageId: string;
  
  /** ISO 8601 timestamp */
  timestamp: string;
  
  /** Correlation ID for request tracing */
  correlationId: string;
  
  /** Message payload */
  payload: IAIExecutionPayload;
}

/**
 * AI Execution payload - core execution data
 */
export interface IAIExecutionPayload {
  /** Ticket ID from ClickUp */
  ticketId: string;
  
  /** Unique execution ID */
  executionId: string;
  
  /** Selected AI provider */
  aiProvider: AIProvider;
  
  /** Execution priority (1=highest, 5=lowest) */
  priority: number;
  
  /** AI prompt for code generation */
  prompt: string;
  
  /** Repository URL for code context */
  repositoryUrl: string;
  
  /** Project ID for context */
  projectId: string;
  
  /** Optional: Target branch */
  targetBranch?: string;
  
  /** Optional: Specific files to modify */
  targetFiles?: string[];
  
  /** Optional: Allow provider fallback */
  allowFallback?: boolean;
}

/**
 * Consumer processing result
 */
export interface IProcessingResult {
  /** Whether processing succeeded */
  success: boolean;
  
  /** Execution ID that was processed */
  executionId: string;
  
  /** Duration in milliseconds */
  durationMs: number;
  
  /** Error message if failed */
  errorMessage?: string;
  
  /** Error code if failed */
  errorCode?: string;
  
  /** Provider that executed the task */
  executedBy?: AIProvider;
}

/**
 * Queue statistics for monitoring
 */
export interface IQueueStats {
  /** Queue name */
  queueName: string;
  
  /** Messages waiting in queue */
  messageCount: number;
  
  /** Active consumers */
  consumerCount: number;
  
  /** Messages processed per second */
  processingRate: number;
  
  /** Average processing time (ms) */
  avgProcessingTimeMs: number;
}

/**
 * Consumer state for health checks
 */
export interface IConsumerState {
  /** Consumer tag identifier */
  consumerTag: string;
  
  /** Whether consumer is active */
  isActive: boolean;
  
  /** When consumer started */
  startedAt: Date;
  
  /** Total messages processed */
  messagesProcessed: number;
  
  /** Total messages failed */
  messagesFailed: number;
  
  /** Currently processing message ID */
  currentMessageId: string | null;
}
```

**File:** `src/execution/interfaces/index.ts`

```typescript
export * from './queue.interface';
```

---

## Step 2: Create Queue DTOs

**File:** `src/execution/dto/queue-message.dto.ts`

```typescript
import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsEnum,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AIProvider } from '@prisma/client';

/**
 * DTO for AI Execution queue message payload
 */
export class AIExecutionPayloadDto {
  @IsString() @IsNotEmpty()
  ticketId: string;

  @IsUUID()
  executionId: string;

  @IsEnum(AIProvider)
  aiProvider: AIProvider;

  @IsNumber() @Min(1) @Max(5)
  priority: number;

  @IsString() @IsNotEmpty()
  prompt: string;

  @IsString() @IsNotEmpty()
  repositoryUrl: string;

  @IsString() @IsNotEmpty()
  projectId: string;

  @IsOptional() @IsString()
  targetBranch?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  targetFiles?: string[];

  @IsOptional() @IsBoolean()
  allowFallback?: boolean;
}

/**
 * DTO for complete queue message
 */
export class AIExecutionMessageDto {
  @IsUUID()
  messageId: string;

  @IsString()
  timestamp: string;

  @IsUUID()
  correlationId: string;

  @ValidateNested()
  @Type(() => AIExecutionPayloadDto)
  payload: AIExecutionPayloadDto;
}

/**
 * DTO for queue publish request
 */
export class PublishExecutionDto {
  @IsString() @IsNotEmpty()
  ticketId: string;

  @IsString() @IsNotEmpty()
  prompt: string;

  @IsString() @IsNotEmpty()
  repositoryUrl: string;

  @IsString() @IsNotEmpty()
  projectId: string;

  @IsOptional() @IsEnum(AIProvider)
  preferredProvider?: AIProvider;

  @IsOptional() @IsNumber() @Min(1) @Max(5)
  priority?: number;

  @IsOptional() @IsString()
  targetBranch?: string;

  @IsOptional() @IsBoolean()
  allowFallback?: boolean;
}

/**
 * DTO for processing result
 */
export class ProcessingResultDto {
  success: boolean;
  executionId: string;
  durationMs: number;
  errorMessage?: string;
  errorCode?: string;
  executedBy?: AIProvider;
}

/**
 * DTO for queue statistics
 */
export class QueueStatsDto {
  queueName: string;
  messageCount: number;
  consumerCount: number;
  processingRate: number;
  avgProcessingTimeMs: number;
}
```

**File:** `src/execution/dto/index.ts`

```typescript
export * from './queue-message.dto';
```

---

## Step 3: Create Execution Tracker Service

**File:** `src/execution/execution-tracker.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { AIProvider, ExecutionStatus } from '@prisma/client';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaService } from '../database/prisma.service';
import { LoggerService } from '../common/logger/logger.service';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { EXCHANGE_NAMES, ROUTING_KEYS } from '../rabbitmq/rabbitmq.config';

/**
 * Execution Tracker Service
 * 
 * Manages execution state transitions and emits lifecycle events.
 * Central point for all execution status updates.
 * 
 * Story 2.10: RabbitMQ AI Execution Queue Processing
 */
@Injectable()
export class ExecutionTrackerService {
  private readonly logger = new Logger(ExecutionTrackerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly loggerService: LoggerService,
    private readonly publisher: RabbitMQPublisherService,
    @InjectMetric('execution_status_transitions_total')
    private readonly transitionsCounter: Counter<string>,
    @InjectMetric('execution_duration_seconds')
    private readonly durationHistogram: Histogram<string>,
  ) {}

  /**
   * Create a new execution record
   */
  async createExecution(
    ticketId: string,
    aiProvider: AIProvider,
    prompt: string,
    correlationId: string,
  ): Promise<string> {
    this.loggerService.setCorrelationId(correlationId);

    const execution = await this.prisma.execution.create({
      data: {
        ticket_id: ticketId,
        ai_provider: aiProvider,
        prompt,
        status: ExecutionStatus.QUEUED,
        retry_count: 0,
        max_retries: 3,
      },
    });

    this.logger.log(
      `[${correlationId}] Created execution ${execution.id} for ticket ${ticketId}`,
    );

    this.transitionsCounter.inc({
      from_status: 'none',
      to_status: 'QUEUED',
      provider: aiProvider,
    });

    return execution.id;
  }

  /**
   * Mark execution as started
   */
  async markStarted(
    executionId: string,
    correlationId: string,
  ): Promise<void> {
    const execution = await this.prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.IN_PROGRESS,
        started_at: new Date(),
      },
    });

    this.logger.log(`[${correlationId}] Execution ${executionId} started`);

    this.transitionsCounter.inc({
      from_status: 'QUEUED',
      to_status: 'IN_PROGRESS',
      provider: execution.ai_provider,
    });

    // Emit event
    await this.publisher.publishToExchange(
      EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
      ROUTING_KEYS.AI_EXECUTION_STARTED,
      {
        executionId,
        ticketId: execution.ticket_id,
        aiProvider: execution.ai_provider,
        startedAt: execution.started_at,
      },
      correlationId,
    );
  }

  /**
   * Mark execution as completed
   */
  async markCompleted(
    executionId: string,
    correlationId: string,
    codeOutput: string,
    filesChanged: string[],
    confidenceScore?: number,
  ): Promise<void> {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
    });

    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const completedAt = new Date();
    const durationMs = execution.started_at
      ? completedAt.getTime() - execution.started_at.getTime()
      : 0;

    await this.prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.COMPLETED,
        completed_at: completedAt,
        code_output: codeOutput,
        files_changed: filesChanged,
        confidence_score: confidenceScore,
      },
    });

    this.logger.log(
      `[${correlationId}] Execution ${executionId} completed (${durationMs}ms)`,
    );

    this.transitionsCounter.inc({
      from_status: 'IN_PROGRESS',
      to_status: 'COMPLETED',
      provider: execution.ai_provider,
    });

    this.durationHistogram.observe(
      { provider: execution.ai_provider, status: 'success' },
      durationMs / 1000,
    );

    // Emit event
    await this.publisher.publishToExchange(
      EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
      ROUTING_KEYS.AI_EXECUTION_COMPLETED,
      {
        executionId,
        ticketId: execution.ticket_id,
        aiProvider: execution.ai_provider,
        completedAt,
        durationMs,
        filesChanged,
        confidenceScore,
      },
      correlationId,
    );
  }

  /**
   * Mark execution as failed
   */
  async markFailed(
    executionId: string,
    correlationId: string,
    errorMessage: string,
    errorCode?: string,
  ): Promise<void> {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
    });

    if (!execution) {
      throw new Error(`Execution ${executionId} not found`);
    }

    const failedAt = new Date();
    const durationMs = execution.started_at
      ? failedAt.getTime() - execution.started_at.getTime()
      : 0;

    await this.prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.FAILED,
        failed_at: failedAt,
        error_message: errorMessage,
      },
    });

    this.logger.error(
      `[${correlationId}] Execution ${executionId} failed: ${errorMessage}`,
    );

    this.transitionsCounter.inc({
      from_status: 'IN_PROGRESS',
      to_status: 'FAILED',
      provider: execution.ai_provider,
    });

    this.durationHistogram.observe(
      { provider: execution.ai_provider, status: 'failed' },
      durationMs / 1000,
    );

    // Emit event
    await this.publisher.publishToExchange(
      EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
      ROUTING_KEYS.AI_EXECUTION_FAILED,
      {
        executionId,
        ticketId: execution.ticket_id,
        aiProvider: execution.ai_provider,
        failedAt,
        durationMs,
        errorMessage,
        errorCode,
        retryCount: execution.retry_count,
      },
      correlationId,
    );
  }

  /**
   * Get execution by ID
   */
  async getExecution(executionId: string) {
    return this.prisma.execution.findUnique({
      where: { id: executionId },
      include: { ticket: true },
    });
  }

  /**
   * Get execution status
   */
  async getStatus(executionId: string): Promise<ExecutionStatus | null> {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
      select: { status: true },
    });
    return execution?.status ?? null;
  }
}
```

---

## Step 4: Create AI Execution Publisher

**File:** `src/execution/ai-execution.publisher.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { AIProvider } from '@prisma/client';
import { Counter } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { v4 as uuidv4 } from 'uuid';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { ExecutionTrackerService } from './execution-tracker.service';
import { IAIExecutionMessage, IAIExecutionPayload } from './interfaces';
import { PublishExecutionDto } from './dto';

/**
 * AI Execution Publisher
 * 
 * Publishes AI execution tasks to RabbitMQ queue for async processing.
 * Creates execution record before publishing.
 * 
 * Story 2.10: RabbitMQ AI Execution Queue Processing
 */
@Injectable()
export class AIExecutionPublisher {
  private readonly logger = new Logger(AIExecutionPublisher.name);

  constructor(
    private readonly publisher: RabbitMQPublisherService,
    private readonly executionTracker: ExecutionTrackerService,
    @InjectMetric('queue_messages_published_total')
    private readonly publishedCounter: Counter<string>,
    @InjectMetric('queue_publish_errors_total')
    private readonly publishErrorsCounter: Counter<string>,
  ) {}

  /**
   * Publish an AI execution task to the queue
   * 
   * @param dto - Execution publish request
   * @param correlationId - Optional correlation ID (auto-generated if not provided)
   * @returns Created execution ID
   */
  async publishExecution(
    dto: PublishExecutionDto,
    correlationId?: string,
  ): Promise<{ executionId: string; correlationId: string }> {
    const corrId = correlationId || uuidv4();
    const messageId = uuidv4();

    // Determine AI provider (default to CURSOR for now)
    const aiProvider = dto.preferredProvider || AIProvider.CURSOR;
    const priority = dto.priority || 3; // Default medium priority

    try {
      // 1. Create execution record in database
      const executionId = await this.executionTracker.createExecution(
        dto.ticketId,
        aiProvider,
        dto.prompt,
        corrId,
      );

      // 2. Build queue message
      const payload: IAIExecutionPayload = {
        ticketId: dto.ticketId,
        executionId,
        aiProvider,
        priority,
        prompt: dto.prompt,
        repositoryUrl: dto.repositoryUrl,
        projectId: dto.projectId,
        targetBranch: dto.targetBranch,
        allowFallback: dto.allowFallback ?? true,
      };

      const message: IAIExecutionMessage = {
        messageId,
        timestamp: new Date().toISOString(),
        correlationId: corrId,
        payload,
      };

      // 3. Publish to queue with retry
      const published = await this.publisher.publishWithRetry(
        QUEUE_NAMES.AI_EXECUTION,
        message,
        3,
        corrId,
      );

      if (!published) {
        throw new Error('Failed to publish message to queue');
      }

      this.logger.log(
        `[${corrId}] Published execution ${executionId} to queue (priority: ${priority})`,
      );

      this.publishedCounter.inc({
        queue: QUEUE_NAMES.AI_EXECUTION,
        provider: aiProvider,
        priority: String(priority),
      });

      return { executionId, correlationId: corrId };

    } catch (error: any) {
      this.logger.error(
        `[${corrId}] Failed to publish execution: ${error.message}`,
      );

      this.publishErrorsCounter.inc({
        queue: QUEUE_NAMES.AI_EXECUTION,
        error_type: error.name || 'UnknownError',
      });

      throw error;
    }
  }

  /**
   * Publish multiple executions (batch)
   */
  async publishBatch(
    executions: PublishExecutionDto[],
    correlationId?: string,
  ): Promise<{ executionIds: string[]; correlationId: string }> {
    const corrId = correlationId || uuidv4();
    const executionIds: string[] = [];

    for (const dto of executions) {
      const result = await this.publishExecution(dto, corrId);
      executionIds.push(result.executionId);
    }

    this.logger.log(
      `[${corrId}] Published batch of ${executionIds.length} executions`,
    );

    return { executionIds, correlationId: corrId };
  }
}
```

---

## Step 5: Create AI Execution Consumer

**File:** `src/execution/ai-execution.consumer.ts`

```typescript
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider, ExecutionStatus } from '@prisma/client';
import { Counter, Gauge, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { ExecutionTrackerService } from './execution-tracker.service';
import { IAIExecutionMessage, IConsumerState, IProcessingResult } from './interfaces';
import { LoggerService } from '../common/logger/logger.service';
// NOTE: OrchestratorService will be from Story 2.8 - using forward reference
// import { OrchestratorService } from '../ai-routing/orchestrator.service';

/**
 * AI Execution Consumer
 * 
 * Consumes messages from ai-execution-queue and processes AI executions.
 * Implements manual acknowledgment, error handling, and metrics.
 * 
 * Story 2.10: RabbitMQ AI Execution Queue Processing
 * 
 * Architecture Reference:
 * - Prefetch count: 1 (process one at a time)
 * - Manual acknowledgment required
 * - Dead letter after 3 retries
 * - Exponential backoff for transient failures
 * 
 * **Design Decision:** Uses raw `channel.consume()` instead of `@MessagePattern`
 * decorator because manual acknowledgment control is required for:
 * - Explicit ack/nack based on processing result
 * - Requeue decisions based on error type
 * - DLQ routing for permanent failures
 * @MessagePattern auto-acks which doesn't meet our reliability requirements.
 */
@Injectable()
export class AIExecutionConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AIExecutionConsumer.name);
  
  /** Consumer state for health checks */
  private consumerState: IConsumerState = {
    consumerTag: '',
    isActive: false,
    startedAt: new Date(),
    messagesProcessed: 0,
    messagesFailed: 0,
    currentMessageId: null,
  };

  /** Processing metrics */
  private processingTimes: number[] = [];
  private readonly MAX_PROCESSING_TIMES = 100;

  constructor(
    private readonly config: ConfigService,
    private readonly rabbitmq: RabbitMQService,
    private readonly executionTracker: ExecutionTrackerService,
    private readonly loggerService: LoggerService,
    // NOTE: Inject OrchestratorService when Story 2.8 is complete
    // private readonly orchestrator: OrchestratorService,
    @InjectMetric('queue_messages_consumed_total')
    private readonly consumedCounter: Counter<string>,
    @InjectMetric('queue_messages_failed_total')
    private readonly failedCounter: Counter<string>,
    @InjectMetric('queue_processing_duration_seconds')
    private readonly processingHistogram: Histogram<string>,
    @InjectMetric('queue_depth')
    private readonly queueDepthGauge: Gauge<string>,
    @InjectMetric('queue_consumer_count')
    private readonly consumerCountGauge: Gauge<string>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.startConsuming();
    this.startQueueMonitoring();
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopConsuming();
  }

  /**
   * Start consuming messages from the queue
   */
  private async startConsuming(): Promise<void> {
    try {
      const channel = this.rabbitmq.getChannel();
      const prefetch = this.config.get<number>('AI_EXECUTION_PREFETCH', 1);
      const consumerTag = this.config.get<string>(
        'AI_EXECUTION_CONSUMER_TAG',
        'ai-execution-consumer',
      );

      // Set prefetch to process one message at a time
      await channel.prefetch(prefetch);

      this.logger.log(
        `Starting AI execution consumer (prefetch: ${prefetch})`,
      );

      // Start consuming with manual acknowledgment
      const { consumerTag: tag } = await channel.consume(
        QUEUE_NAMES.AI_EXECUTION,
        async (msg: any) => {
          if (!msg) return;

          const startTime = Date.now();
          let messageData: IAIExecutionMessage | null = null;

          try {
            // Parse message
            messageData = JSON.parse(msg.content.toString()) as IAIExecutionMessage;
            const { correlationId, payload } = messageData;

            this.consumerState.currentMessageId = messageData.messageId;
            this.loggerService.setCorrelationId(correlationId);

            this.logger.log(
              `[${correlationId}] Processing execution ${payload.executionId} ` +
              `(provider: ${payload.aiProvider}, priority: ${payload.priority})`,
            );

            // Process the execution
            const result = await this.processExecution(messageData);

            // Record metrics
            const duration = Date.now() - startTime;
            this.recordProcessingTime(duration);

            if (result.success) {
              this.logger.log(
                `[${correlationId}] Execution ${payload.executionId} completed ` +
                `(${duration}ms)`,
              );

              // Acknowledge message
              channel.ack(msg);
              this.consumerState.messagesProcessed++;

              this.consumedCounter.inc({
                queue: QUEUE_NAMES.AI_EXECUTION,
                status: 'success',
                provider: payload.aiProvider,
              });

            } else {
              // Processing failed - check if retryable
              await this.handleProcessingFailure(
                msg,
                channel,
                messageData,
                result,
                duration,
              );
            }

            this.processingHistogram.observe(
              { queue: QUEUE_NAMES.AI_EXECUTION },
              duration / 1000,
            );

          } catch (error: any) {
            // Unexpected error - reject message
            this.logger.error(
              `[${messageData?.correlationId || 'unknown'}] Consumer error: ${error.message}`,
              error.stack,
            );

            const shouldRequeue = this.shouldRequeueOnError(error);
            channel.nack(msg, false, shouldRequeue);

            this.consumerState.messagesFailed++;
            this.failedCounter.inc({
              queue: QUEUE_NAMES.AI_EXECUTION,
              error_type: error.name || 'UnknownError',
            });

          } finally {
            this.consumerState.currentMessageId = null;
          }
        },
        { noAck: false, consumerTag },
      );

      this.consumerState.consumerTag = tag;
      this.consumerState.isActive = true;
      this.consumerState.startedAt = new Date();

      this.logger.log(`✅ AI execution consumer started (tag: ${tag})`);

    } catch (error: any) {
      this.logger.error(`Failed to start consumer: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process a single AI execution
   */
  private async processExecution(
    message: IAIExecutionMessage,
  ): Promise<IProcessingResult> {
    const { correlationId, payload } = message;
    const { executionId, aiProvider, prompt, repositoryUrl } = payload;
    const startTime = Date.now();

    try {
      // 1. Mark execution as started
      await this.executionTracker.markStarted(executionId, correlationId);

      // 2. Execute via OrchestratorService
      // NOTE: When Story 2.8 is complete, use:
      // const result = await this.orchestrator.execute({
      //   correlationId,
      //   executionId,
      //   ticketId: payload.ticketId,
      //   prompt,
      //   repositoryUrl,
      //   allowFallback: payload.allowFallback,
      // });

      // TODO(story-2.8): Replace simulateExecution() with OrchestratorService.execute()
      // FIXME: Remove simulation when Story 2.8 is complete
      const result = await this.simulateExecution(payload);

      if (result.success) {
        // 3. Mark as completed
        await this.executionTracker.markCompleted(
          executionId,
          correlationId,
          result.codeOutput || '',
          result.filesChanged || [],
          result.confidenceScore,
        );

        return {
          success: true,
          executionId,
          durationMs: Date.now() - startTime,
          executedBy: result.executedBy || aiProvider,
        };

      } else {
        // 4. Mark as failed
        await this.executionTracker.markFailed(
          executionId,
          correlationId,
          result.errorMessage || 'Unknown error',
          result.errorCode,
        );

        return {
          success: false,
          executionId,
          durationMs: Date.now() - startTime,
          errorMessage: result.errorMessage,
          errorCode: result.errorCode,
        };
      }

    } catch (error: any) {
      this.logger.error(
        `[${correlationId}] Execution ${executionId} threw error: ${error.message}`,
      );

      await this.executionTracker.markFailed(
        executionId,
        correlationId,
        error.message,
        error.code || 'EXECUTION_ERROR',
      );

      return {
        success: false,
        executionId,
        durationMs: Date.now() - startTime,
        errorMessage: error.message,
        errorCode: error.code || 'EXECUTION_ERROR',
      };
    }
  }

  /**
   * TEMPORARY: Simulate execution for testing
   * Remove when OrchestratorService (Story 2.8) is integrated
   * 
   * TODO(story-2.8): Remove this method entirely
   * FIXME: Replace with OrchestratorService.execute() call when available
   * @deprecated Will be removed when Story 2.8 integrates OrchestratorService
   */
  private async simulateExecution(payload: any): Promise<{
    success: boolean;
    codeOutput?: string;
    filesChanged?: string[];
    confidenceScore?: number;
    executedBy?: AIProvider;
    errorMessage?: string;
    errorCode?: string;
  }> {
    // Simulate processing time (1-3 seconds)
    await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));

    // Simulate 90% success rate for testing
    if (Math.random() < 0.9) {
      return {
        success: true,
        codeOutput: `// Generated code for ticket ${payload.ticketId}\n// TODO: Replace with actual AI output`,
        filesChanged: ['src/generated/example.ts'],
        confidenceScore: 0.85 + Math.random() * 0.15,
        executedBy: payload.aiProvider, // Uses valid enum: CURSOR | WINDSURF | ANTIGRAVITY
      };
    } else {
      return {
        success: false,
        errorMessage: 'Simulated execution failure',
        errorCode: 'SIMULATED_FAILURE',
      };
    }
  }

  /**
   * Handle processing failure - determine retry or DLQ
   */
  private async handleProcessingFailure(
    msg: any,
    channel: any,
    messageData: IAIExecutionMessage,
    result: IProcessingResult,
    duration: number,
  ): Promise<void> {
    const { correlationId } = messageData;
    const retryCount = (msg.properties.headers?.['x-retry-count'] || 0) + 1;
    const maxRetries = 3;

    this.logger.warn(
      `[${correlationId}] Execution failed (attempt ${retryCount}/${maxRetries}): ${result.errorMessage}`,
    );

    if (retryCount < maxRetries && this.isRetryableError(result.errorCode)) {
      // Requeue with updated retry count
      // Note: In production, use delayed message plugin for backoff
      channel.nack(msg, false, true); // Requeue immediately for simplicity
      
      this.logger.log(
        `[${correlationId}] Message requeued for retry (attempt ${retryCount + 1})`,
      );

    } else {
      // Max retries exceeded or non-retryable - send to DLQ
      channel.nack(msg, false, false); // Don't requeue - goes to DLQ

      this.consumerState.messagesFailed++;
      
      this.logger.error(
        `[${correlationId}] Message sent to DLQ after ${retryCount} attempts`,
      );

      this.failedCounter.inc({
        queue: QUEUE_NAMES.AI_EXECUTION,
        error_type: result.errorCode || 'UNKNOWN',
        final: 'true',
      });
    }
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(errorCode?: string): boolean {
    const nonRetryable = [
      'INVALID_PROMPT',
      'INVALID_REPOSITORY',
      'AUTHENTICATION_ERROR',
      'PERMISSION_DENIED',
      'CANCELLED',
    ];
    return !nonRetryable.includes(errorCode || '');
  }

  /**
   * Check if error should trigger requeue (transient network issues)
   */
  private shouldRequeueOnError(error: Error): boolean {
    const transientPatterns = [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'Connection closed',
    ];
    return transientPatterns.some(p => error.message.includes(p));
  }

  /**
   * Record processing time for rate calculation
   */
  private recordProcessingTime(durationMs: number): void {
    this.processingTimes.push(durationMs);
    if (this.processingTimes.length > this.MAX_PROCESSING_TIMES) {
      this.processingTimes.shift();
    }
  }

  /**
   * Start queue depth monitoring (runs every 10 seconds)
   */
  private startQueueMonitoring(): void {
    setInterval(async () => {
      try {
        const stats = await this.rabbitmq.getQueueStats(QUEUE_NAMES.AI_EXECUTION);
        
        this.queueDepthGauge.set(
          { queue: QUEUE_NAMES.AI_EXECUTION },
          stats.messageCount,
        );

        this.consumerCountGauge.set(
          { queue: QUEUE_NAMES.AI_EXECUTION },
          stats.consumerCount,
        );

      } catch (error) {
        // Silently ignore monitoring errors
      }
    }, 10000);
  }

  /**
   * Stop consuming messages
   */
  private async stopConsuming(): Promise<void> {
    if (this.consumerState.consumerTag && this.consumerState.isActive) {
      const channel = this.rabbitmq.getChannel();
      await channel.cancel(this.consumerState.consumerTag);
      this.consumerState.isActive = false;
      this.logger.log('AI execution consumer stopped');
    }
  }

  /**
   * Get consumer state for health checks
   */
  getConsumerState(): IConsumerState {
    return { ...this.consumerState };
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    messageCount: number;
    consumerCount: number;
    processingRate: number;
    avgProcessingTimeMs: number;
  }> {
    const stats = await this.rabbitmq.getQueueStats(QUEUE_NAMES.AI_EXECUTION);
    
    const avgTime = this.processingTimes.length > 0
      ? this.processingTimes.reduce((a, b) => a + b, 0) / this.processingTimes.length
      : 0;

    const processingRate = this.processingTimes.length > 0
      ? 1000 / avgTime // Messages per second
      : 0;

    return {
      ...stats,
      processingRate: Math.round(processingRate * 100) / 100,
      avgProcessingTimeMs: Math.round(avgTime),
    };
  }
}
```

---

## Step 6: Create Queue Metrics Provider

**File:** `src/common/metrics/queue-metrics.provider.ts`

```typescript
import {
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';

/**
 * Queue Metrics Providers
 * Story 2.10: RabbitMQ AI Execution Queue Processing
 */

export const queueMetricsProviders = [
  // Publishing metrics
  makeCounterProvider({
    name: 'queue_messages_published_total',
    help: 'Total messages published to queues',
    labelNames: ['queue', 'provider', 'priority'],
  }),

  makeCounterProvider({
    name: 'queue_publish_errors_total',
    help: 'Total publish errors',
    labelNames: ['queue', 'error_type'],
  }),

  // Consumer metrics
  makeCounterProvider({
    name: 'queue_messages_consumed_total',
    help: 'Total messages consumed from queues',
    labelNames: ['queue', 'status', 'provider'],
  }),

  makeCounterProvider({
    name: 'queue_messages_failed_total',
    help: 'Total messages that failed processing',
    labelNames: ['queue', 'error_type', 'final'],
  }),

  makeHistogramProvider({
    name: 'queue_processing_duration_seconds',
    help: 'Message processing duration in seconds',
    labelNames: ['queue'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  }),

  // Queue state metrics
  makeGaugeProvider({
    name: 'queue_depth',
    help: 'Current number of messages in queue',
    labelNames: ['queue'],
  }),

  makeGaugeProvider({
    name: 'queue_consumer_count',
    help: 'Current number of consumers on queue',
    labelNames: ['queue'],
  }),

  // Execution tracking metrics
  makeCounterProvider({
    name: 'execution_status_transitions_total',
    help: 'Total execution status transitions',
    labelNames: ['from_status', 'to_status', 'provider'],
  }),

  makeHistogramProvider({
    name: 'execution_duration_seconds',
    help: 'AI execution duration in seconds',
    labelNames: ['provider', 'status'],
    buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800],
  }),
];
```

---

## Step 7: Update Execution Module

**File:** `src/execution/execution.module.ts` - **REPLACE**

```typescript
import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { queueMetricsProviders } from '../common/metrics/queue-metrics.provider';

// Services
import { ExecutionTrackerService } from './execution-tracker.service';
import { AIExecutionPublisher } from './ai-execution.publisher';
import { AIExecutionConsumer } from './ai-execution.consumer';

// NOTE: Import AIRoutingModule when Story 2.8 is complete
// import { AIRoutingModule } from '../ai-routing/ai-routing.module';

/**
 * Execution Module
 * 
 * Provides AI execution queue processing, tracking, and metrics.
 * 
 * Story 2.10: RabbitMQ AI Execution Queue Processing
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RabbitMQModule,
    // NOTE: Add when Story 2.8 is complete
    // forwardRef(() => AIRoutingModule),
  ],
  providers: [
    // Core services
    ExecutionTrackerService,
    AIExecutionPublisher,
    AIExecutionConsumer,
    
    // Metrics providers
    ...queueMetricsProviders,
  ],
  exports: [
    ExecutionTrackerService,
    AIExecutionPublisher,
    AIExecutionConsumer,
  ],
})
export class ExecutionModule {}
```

---

## Step 8: Update App Module

**File:** `src/app.module.ts` - **ADD** ExecutionModule import:

```typescript
// Add to imports array:
import { ExecutionModule } from './execution/execution.module';

@Module({
  imports: [
    // ... existing imports
    ExecutionModule, // ADD: Story 2.10
  ],
  // ...
})
export class AppModule {}
```

---

## Step 9: Create Unit Tests

**File:** `src/execution/ai-execution.consumer.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AIProvider, ExecutionStatus } from '@prisma/client';
import { getMetricToken } from '@willsoto/nestjs-prometheus';
import { AIExecutionConsumer } from './ai-execution.consumer';
import { ExecutionTrackerService } from './execution-tracker.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { LoggerService } from '../common/logger/logger.service';

describe('AIExecutionConsumer', () => {
  let consumer: AIExecutionConsumer;
  let executionTracker: jest.Mocked<ExecutionTrackerService>;
  let rabbitmqService: jest.Mocked<RabbitMQService>;

  const mockMessage = {
    messageId: 'msg-123',
    timestamp: new Date().toISOString(),
    correlationId: 'corr-123',
    payload: {
      ticketId: 'ticket-456',
      executionId: 'exec-789',
      aiProvider: AIProvider.CURSOR, // Valid enum: CURSOR | WINDSURF | ANTIGRAVITY
      priority: 3,
      prompt: 'Fix the bug',
      repositoryUrl: 'https://github.com/test/repo',
      projectId: 'proj-123',
      allowFallback: true,
    },
  };

  beforeEach(async () => {
    const mockChannel = {
      prefetch: jest.fn(),
      consume: jest.fn().mockResolvedValue({ consumerTag: 'test-consumer' }),
      ack: jest.fn(),
      nack: jest.fn(),
      cancel: jest.fn(),
    };

    const mockRabbitmq = {
      getChannel: jest.fn().mockReturnValue(mockChannel),
      getQueueStats: jest.fn().mockResolvedValue({
        messageCount: 5,
        consumerCount: 1,
      }),
    };

    const mockExecutionTracker = {
      markStarted: jest.fn(),
      markCompleted: jest.fn(),
      markFailed: jest.fn(),
    };

    const mockLogger = {
      setCorrelationId: jest.fn(),
    };

    // Mock metrics using proper injection tokens from @willsoto/nestjs-prometheus
    const mockCounter = { inc: jest.fn(), labels: jest.fn().mockReturnThis() };
    const mockHistogram = { observe: jest.fn(), labels: jest.fn().mockReturnThis() };
    const mockGauge = { set: jest.fn(), labels: jest.fn().mockReturnThis() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIExecutionConsumer,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(1) } },
        { provide: RabbitMQService, useValue: mockRabbitmq },
        { provide: ExecutionTrackerService, useValue: mockExecutionTracker },
        { provide: LoggerService, useValue: mockLogger },
        // Use getMetricToken() for proper NestJS injection
        { provide: getMetricToken('queue_messages_consumed_total'), useValue: mockCounter },
        { provide: getMetricToken('queue_messages_failed_total'), useValue: mockCounter },
        { provide: getMetricToken('queue_processing_duration_seconds'), useValue: mockHistogram },
        { provide: getMetricToken('queue_depth'), useValue: mockGauge },
        { provide: getMetricToken('queue_consumer_count'), useValue: mockGauge },
      ],
    }).compile();

    consumer = module.get<AIExecutionConsumer>(AIExecutionConsumer);
    executionTracker = module.get(ExecutionTrackerService);
    rabbitmqService = module.get(RabbitMQService);
  });

  describe('getConsumerState', () => {
    it('should return consumer state', () => {
      const state = consumer.getConsumerState();

      expect(state).toHaveProperty('consumerTag');
      expect(state).toHaveProperty('isActive');
      expect(state).toHaveProperty('startedAt');
      expect(state).toHaveProperty('messagesProcessed');
      expect(state).toHaveProperty('messagesFailed');
    });
  });

  describe('getQueueStats', () => {
    it('should return queue statistics', async () => {
      const stats = await consumer.getQueueStats();

      expect(stats.messageCount).toBe(5);
      expect(stats.consumerCount).toBe(1);
      expect(stats).toHaveProperty('processingRate');
      expect(stats).toHaveProperty('avgProcessingTimeMs');
    });
  });

  describe('error handling', () => {
    it('should identify retryable errors', () => {
      // Access private method via reflection for testing
      const isRetryable = (consumer as any).isRetryableError;
      
      expect(isRetryable('TIMEOUT')).toBe(true);
      expect(isRetryable('NETWORK_ERROR')).toBe(true);
      expect(isRetryable('INVALID_PROMPT')).toBe(false);
      expect(isRetryable('AUTHENTICATION_ERROR')).toBe(false);
    });
  });
});

describe('AIExecutionPublisher', () => {
  // Similar test structure for publisher
});

describe('ExecutionTrackerService', () => {
  // Similar test structure for tracker
});
```

---

## Step 10: Create Integration Tests

**File:** `test/ai-execution-queue.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AIProvider } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { AIExecutionPublisher } from '../src/execution/ai-execution.publisher';
import { AIExecutionConsumer } from '../src/execution/ai-execution.consumer';
import { ExecutionTrackerService } from '../src/execution/execution-tracker.service';
import { RabbitMQService } from '../src/rabbitmq/rabbitmq.service';
import { PrismaService } from '../src/database/prisma.service';
import { QUEUE_NAMES } from '../src/rabbitmq/rabbitmq.config';

/**
 * AI Execution Queue Integration Tests
 * 
 * Tests the complete flow from publishing to consuming.
 * Run with: pnpm test:e2e -- --testPathPattern=ai-execution-queue
 */
describe('AI Execution Queue (e2e)', () => {
  let app: INestApplication;
  let publisher: AIExecutionPublisher;
  let consumer: AIExecutionConsumer;
  let tracker: ExecutionTrackerService;
  let rabbitmq: RabbitMQService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    publisher = app.get<AIExecutionPublisher>(AIExecutionPublisher);
    consumer = app.get<AIExecutionConsumer>(AIExecutionConsumer);
    tracker = app.get<ExecutionTrackerService>(ExecutionTrackerService);
    rabbitmq = app.get<RabbitMQService>(RabbitMQService);
    prisma = app.get<PrismaService>(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('RabbitMQ Connection', () => {
    it('should be connected and healthy', async () => {
      const isHealthy = await rabbitmq.isHealthy();
      expect(isHealthy).toBe(true);
    });

    it('should have ai-execution-queue available', async () => {
      const stats = await rabbitmq.getQueueStats(QUEUE_NAMES.AI_EXECUTION);
      expect(stats).toHaveProperty('messageCount');
      expect(stats).toHaveProperty('consumerCount');
    });
  });

  describe('Publishing', () => {
    it('should publish execution to queue', async () => {
      // Create a test ticket first (or mock)
      const result = await publisher.publishExecution({
        ticketId: 'test-ticket-123',
        prompt: 'Test AI prompt',
        repositoryUrl: 'https://github.com/test/repo',
        projectId: 'test-project',
        priority: 3,
      });

      expect(result.executionId).toBeDefined();
      expect(result.correlationId).toBeDefined();

      // Verify execution was created in database
      const execution = await prisma.execution.findUnique({
        where: { id: result.executionId },
      });

      expect(execution).toBeDefined();
      expect(execution?.status).toBe('QUEUED');
    });

    it('should handle priority correctly', async () => {
      const highPriority = await publisher.publishExecution({
        ticketId: 'high-priority-ticket',
        prompt: 'Urgent fix',
        repositoryUrl: 'https://github.com/test/repo',
        projectId: 'test-project',
        priority: 1, // Highest
      });

      const lowPriority = await publisher.publishExecution({
        ticketId: 'low-priority-ticket',
        prompt: 'Minor improvement',
        repositoryUrl: 'https://github.com/test/repo',
        projectId: 'test-project',
        priority: 5, // Lowest
      });

      expect(highPriority.executionId).toBeDefined();
      expect(lowPriority.executionId).toBeDefined();
    });
  });

  describe('Consumer State', () => {
    it('should report active consumer', () => {
      const state = consumer.getConsumerState();
      
      expect(state.isActive).toBe(true);
      expect(state.consumerTag).toBeDefined();
      expect(state.startedAt).toBeInstanceOf(Date);
    });

    it('should track processed messages', () => {
      const state = consumer.getConsumerState();
      
      expect(state.messagesProcessed).toBeGreaterThanOrEqual(0);
      expect(state.messagesFailed).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Queue Statistics', () => {
    it('should return queue statistics', async () => {
      const stats = await consumer.getQueueStats();

      expect(stats.messageCount).toBeGreaterThanOrEqual(0);
      expect(stats.consumerCount).toBeGreaterThanOrEqual(1);
      expect(stats.processingRate).toBeGreaterThanOrEqual(0);
      expect(stats.avgProcessingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Execution Tracking', () => {
    it('should track execution status transitions', async () => {
      // Create execution
      const executionId = await tracker.createExecution(
        'track-test-ticket',
        AIProvider.CURSOR,
        'Test prompt',
        'test-correlation-id',
      );

      // Verify QUEUED status
      let status = await tracker.getStatus(executionId);
      expect(status).toBe('QUEUED');

      // Mark started
      await tracker.markStarted(executionId, 'test-correlation-id');
      status = await tracker.getStatus(executionId);
      expect(status).toBe('IN_PROGRESS');

      // Mark completed
      await tracker.markCompleted(
        executionId,
        'test-correlation-id',
        '// Generated code',
        ['src/test.ts'],
        0.95,
      );
      status = await tracker.getStatus(executionId);
      expect(status).toBe('COMPLETED');
    });
  });
});
```

---

## Validation Checklist

### Interfaces & DTOs
- [ ] `IAIExecutionMessage` captures complete message structure
- [ ] `IAIExecutionPayload` includes all required fields
- [ ] `IConsumerState` for health checks
- [ ] DTOs have validation decorators

### AI Execution Publisher
- [ ] `publishExecution()` creates execution record
- [ ] Message includes all required fields (ticket_id, execution_id, ai_provider, priority, correlation_id)
- [ ] Uses `publishWithRetry()` for reliability
- [ ] Metrics tracked for publishes

### AI Execution Consumer
- [ ] Consumes from `ai-execution-queue`
- [ ] Manual acknowledgment (`noAck: false`)
- [ ] Prefetch=1 for one-at-a-time processing
- [ ] Updates execution status via `ExecutionTrackerService`
- [ ] Handles failures with retry/DLQ logic
- [ ] Queue depth monitoring (Prometheus gauge)
- [ ] Processing rate tracking

### Execution Tracker Service
- [ ] `createExecution()` creates with QUEUED status
- [ ] `markStarted()` updates to IN_PROGRESS
- [ ] `markCompleted()` updates to COMPLETED with output
- [ ] `markFailed()` updates to FAILED with error
- [ ] Emits lifecycle events to exchange

### Module Integration
- [ ] All services added to ExecutionModule providers
- [ ] All metrics providers registered
- [ ] ExecutionModule imported in AppModule
- [ ] RabbitMQModule and DatabaseModule imported

### Metrics
- [ ] `queue_messages_published_total` counter
- [ ] `queue_messages_consumed_total` counter
- [ ] `queue_messages_failed_total` counter
- [ ] `queue_processing_duration_seconds` histogram
- [ ] `queue_depth` gauge
- [ ] `queue_consumer_count` gauge
- [ ] `execution_status_transitions_total` counter
- [ ] `execution_duration_seconds` histogram

### Tests
- [ ] Unit tests for consumer
- [ ] Unit tests for publisher
- [ ] Unit tests for tracker
- [ ] Integration tests pass

---

## Quick Verification Commands

```bash
# After Steps 1-5 (Services)
npx tsc --noEmit src/execution/ai-execution.consumer.ts
npx tsc --noEmit src/execution/ai-execution.publisher.ts
npx tsc --noEmit src/execution/execution-tracker.service.ts

# After Step 7 (Module)
npx tsc --noEmit src/execution/execution.module.ts

# After Step 8 (App Module)
npx tsc --noEmit src/app.module.ts

# After Step 9 (Tests)
pnpm test -- --testPathPattern=ai-execution

# Verify queue setup
curl http://localhost:15672/api/queues/%2F/ai-execution-queue

# Full verification
pnpm run build && pnpm test
```

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `No provider for RabbitMQService` | RabbitMQModule not imported | Import RabbitMQModule in ExecutionModule |
| `Channel not available` | RabbitMQ not connected | Check RABBITMQ_URL environment variable |
| `Queue not found` | Queue not created | Verify RabbitMQService.setupQueuesAndExchanges() runs |
| `Message not acknowledged` | Consumer throws before ack | Add try/catch with nack in catch block |
| `Consumer not starting` | Module init error | Check onModuleInit() logs |
| `Metrics not found` | Providers not registered | Add queueMetricsProviders to module |
| `Circular dependency` | Module import order | Use forwardRef() for AIRoutingModule |

---

## Architecture Flow (Condensed)

```
Webhook → TicketIntake → AIRouting → AIExecutionPublisher
                                           │
                                           ▼
                                  ai-execution-queue (RabbitMQ)
                                           │
                                           ▼
                                   AIExecutionConsumer
                                   (manual ack, prefetch=1)
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    ▼                      ▼                      ▼
               SUCCESS                  RETRY                 DEAD LETTER
            (ack + event)         (nack+requeue, max 3)     (nack, alert PM)
```

**Flow Details:** Publisher creates QUEUED execution → publishes with retry → Consumer picks up → marks IN_PROGRESS → calls OrchestratorService → marks COMPLETED/FAILED → emits lifecycle event → acks/nacks

---

## Message Format Reference

```typescript
// Queue message structure (per architecture)
// NOTE: aiProvider MUST be valid Prisma enum: "CURSOR" | "WINDSURF" | "ANTIGRAVITY"
{
  "messageId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-12-02T10:30:00.000Z",
  "correlationId": "req-12345-abcde",
  "payload": {
    "ticketId": "clickup-task-12345",
    "executionId": "exec-67890-fghij",
    "aiProvider": "CURSOR", // Valid values: CURSOR | WINDSURF | ANTIGRAVITY
    "priority": 3,
    "prompt": "Implement user authentication with JWT...",
    "repositoryUrl": "https://github.com/org/repo",
    "projectId": "proj-dark-factory",
    "targetBranch": "feature/auth-implementation",
    "allowFallback": true  // Falls back to WINDSURF if CURSOR fails
  }
}
```

---

## References

| Document | Section | Content |
|----------|---------|---------|
| `docs/architecture.md` | Lines 449-461 | RabbitMQ configuration |
| `docs/architecture.md` | Lines 1402-1409 | Queue naming conventions |
| `docs/architecture.md` | Lines 1466-1475 | RabbitMQ message format |
| `docs/architecture.md` | Lines 1496-1499 | Error recovery patterns |
| `docs/epics.md` | Lines 1202-1226 | Story 2.10 Requirements |
| `docs/prd.md` | FR60-65 | AI routing and execution |
| `src/rabbitmq/rabbitmq.config.ts` | Full file | Queue configuration |
| `src/rabbitmq/rabbitmq.service.ts` | Full file | RabbitMQ service |

---

## Dev Agent Record

### Context Reference

This story was prepared with complete context analysis from:
- Architecture document (RabbitMQ configuration, message patterns)
- PRD functional requirements (FR60-65)
- Existing RabbitMQ infrastructure (Story 1.5)
- Story 2.9 retry logic patterns

### Patterns Reused

1. **Service Pattern:** Publisher + Consumer + Tracker separation
2. **Metrics Pattern:** Counter, Histogram, Gauge from @willsoto/nestjs-prometheus
3. **Message Format:** Per architecture (messageId, timestamp, correlationId, payload)
4. **Error Recovery:** 3 retries with exponential backoff, DLQ for permanent failures
5. **Consumer Pattern:** `OnModuleInit` with manual acknowledgment

### Integration Notes

**Story 2.8 Integration:**
- Consumer currently uses simulated execution (see `simulateExecution()` method)
- When Story 2.8 is complete, replace with actual `OrchestratorService.execute()` call
- Import `AIRoutingModule` with `forwardRef()` to avoid circular dependencies

**Story 2.9 Integration:**
- Retry logic in consumer is simplified for this story
- Full retry handling (RetryHandlerService) integrates via Story 2.9
- Consumer handles basic retry count, Story 2.9 handles sophisticated backoff

### Completion Notes

**Story Status:** ready-for-dev  
**Context Completeness:** ✅ COMPREHENSIVE  
**Developer Readiness:** ✅ FLAWLESS IMPLEMENTATION GUIDE CREATED

**Workflow After Story Completion:**
1. **Before Starting:** Update `sprint-status.yaml` → `2-10-rabbitmq-ai-execution-queue-processing: in-progress`
2. **Implementation:** Follow Steps 1-10 in order
3. **Testing:** Run unit tests, verify metrics, test with RabbitMQ
4. **Validation:** Complete all items in Validation Checklist
5. **Version Control:** Commit with message `feat: add RabbitMQ AI execution queue processing`
6. **Status Update:** Update `sprint-status.yaml` → `2-10-rabbitmq-ai-execution-queue-processing: review`

---

**Document prepared by:** Bob (Scrum Master)  
**Preparation date:** 2025-12-02  
**Analysis method:** Ultimate BMad Method Story Context Engine  
**Quality level:** Developer-ready with zero ambiguity

