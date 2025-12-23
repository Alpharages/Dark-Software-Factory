# Story 2.5: AI Execution Tracking & State Management

**Epic:** 2 - Ticket Intake & AI Routing Engine  
**Status:** Ready for Review  
**Priority:** P0 - CRITICAL  
**Effort:** 8 story points  
**ClickUp ID:** `86evnjwaa`  
**ClickUp URL:** https://app.clickup.com/t/86evnjwaa

---

## ⛔ BLOCKER: Story 2.4 Must Be Complete

**DO NOT START** this story until Story 2.4 is implemented and validated.

**Required from Story 2.4:**
- ✅ Interfaces: `src/ai-routing/interfaces/prompt-generation.interface.ts` exists
- ✅ Services: `PromptGeneratorService`, `CursorPromptBuilder`, `ClaudeCodePromptBuilder` implemented
- ✅ Output: `IGeneratedPrompt` with prompt string and metadata

**Required from Story 1.5:**
- ✅ RabbitMQ infrastructure for event publishing
- ✅ `RabbitmqPublisherService` available for event emission

**If Story 2.4 is not complete:** You will encounter immediate compilation errors:
- `Cannot find module './interfaces/prompt-generation.interface'`
- `Property 'IGeneratedPrompt' does not exist`

**Verify Story 2.4 status:** Check `docs/sprint-artifacts/sprint-status.yaml` - Story 2.4 should be `complete` or `review`.

---

## Story

As the system,
I want to track AI execution state throughout the process,
So that PMs can monitor progress and we can handle failures gracefully.

---

## Acceptance Criteria

**Given** an AI prompt is generated (from Story 2.4)  
**When** execution is started  
**Then** an `Execution` record is created with:
- Unique execution ID (UUID)
- ticket_id (reference to originating ticket)
- ai_provider (CURSOR_HEADLESS or CLAUDE_CODE)
- prompt (generated prompt from Story 2.4)
- status (QUEUED initially)
- started_at timestamp

**And** execution state transitions are tracked:
- QUEUED → IN_PROGRESS → COMPLETED/FAILED/TIMEOUT
- Valid transitions enforced by state machine
- Invalid transitions rejected with error

**And** each state change:
- Updates `executions` table with new status
- Logs transition to `audit_logs` table
- Emits event to RabbitMQ (`execution-status-queue`)
- Updates associated ticket status accordingly

**And** execution metadata is captured:
- `confidence_score` (0.0-1.0) from AI provider response
- `retry_count` (incremented on each retry)
- `completed_at` / `failed_at` timestamps
- `error_message` for failed executions
- `code_output` and `files_changed` on completion

---

## Quick Implementation Summary (TL;DR)

**Step 0: Understand the Input**
- Consumes from: `ai-execution-queue` (published by Story 2.3)
- Uses: `PromptGeneratorService` from Story 2.4 to generate prompt

**10 Key Files in Implementation Order:**
1. `src/execution/interfaces/execution.interface.ts` - Execution interfaces
2. `src/execution/dto/execution.dto.ts` - Execution DTOs
3. `src/execution/enums/execution-status.enum.ts` - Status enum with transitions
4. `src/execution/state-machine/execution-state-machine.ts` - State transition logic
5. `src/execution/execution.repository.ts` - Prisma repository for executions
6. `src/execution/execution-tracker.service.ts` - Core tracking service
7. `src/execution/execution.service.ts` - Main orchestration service
8. `src/execution/execution.service.spec.ts` - Unit tests
9. `src/execution/execution.module.ts` - Wire all components
10. `prisma/schema.prisma` - **MODIFY**: Update AIProvider enum if needed

**Dependencies:** No NEW dependencies beyond previous stories:
- `@willsoto/nestjs-prometheus` (from Story 2.3)
- `prom-client` (from Story 2.3)
- `@prisma/client` (from Story 1.3)

---

## Technical Requirements

### Quick Reference: Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/execution/interfaces/execution.interface.ts` | CREATE | Execution interfaces |
| `src/execution/interfaces/index.ts` | CREATE | Barrel export |
| `src/execution/dto/execution.dto.ts` | CREATE | Execution DTOs |
| `src/execution/dto/index.ts` | CREATE | Barrel export |
| `src/execution/enums/execution-status.enum.ts` | CREATE | State enum |
| `src/execution/enums/index.ts` | CREATE | Barrel export |
| `src/execution/state-machine/execution-state-machine.ts` | CREATE | State transitions |
| `src/execution/state-machine/index.ts` | CREATE | Barrel export |
| `src/execution/execution.repository.ts` | CREATE | Prisma data access |
| `src/execution/execution-tracker.service.ts` | CREATE | Tracking logic |
| `src/execution/execution.service.ts` | CREATE | Main service |
| `src/execution/execution.service.spec.ts` | CREATE | Unit tests |
| `src/execution/execution.module.ts` | **MODIFY** | Wire components |
| `prisma/schema.prisma` | **VERIFY** | Check AIProvider enum |

---

## Step 0: Verify Prerequisites (REQUIRED)

**Before starting implementation, verify Story 2.4 is COMPLETE:**

### 0.1 Check Prompt Generation Interfaces Exist

```bash
# Verify Story 2.4 interfaces exist
ls src/ai-routing/interfaces/prompt-generation.interface.ts
```

**Expected:** File exists with `IGeneratedPrompt` and `IPromptMetadata` interfaces.

**If missing:** Story 2.4 is not complete. STOP and complete Story 2.4 first.

### 0.2 Check PromptGeneratorService Exists

```bash
# Verify Story 2.4 service exists
ls src/ai-routing/prompt-generator.service.ts
```

**Expected:** File exists and exports `PromptGeneratorService`.

### 0.3 Check RabbitMQ Publisher Available

```bash
# Verify Story 1.5 publisher exists
grep -l "RabbitmqPublisherService" src/rabbitmq/*.ts
```

**Expected:** Should find `rabbitmq-publisher.service.ts`.

### 0.4 Check AIProvider Enum

```bash
# Verify Prisma schema has correct enum values
grep -E "CURSOR_HEADLESS|CLAUDE_CODE" prisma/schema.prisma
```

**Expected output:**
```prisma
enum AIProvider {
  CURSOR_HEADLESS
  CLAUDE_CODE
}
```

**If you see `CURSOR, WINDSURF, ANTIGRAVITY`:** Run migration:
```bash
# Create migration for enum update (if not done in Story 2.3)
npx prisma migrate dev --name update-ai-provider-enum
npx prisma generate
```

**If any check fails:** STOP. Complete prerequisites first, then return to this story.

---

## Step 1: Create Execution Interfaces

**File:** `src/execution/interfaces/execution.interface.ts`

```typescript
/**
 * Execution Tracking Interfaces
 * FR62: System monitors AI execution progress
 * Architecture Reference: Data Architecture - Execution model
 */

import { AIProvider, ExecutionStatus, Execution } from '@prisma/client';

/**
 * Input for starting a new execution
 * Combines routing result + generated prompt
 */
export interface IStartExecutionInput {
  correlationId: string;
  ticketId: string;
  clickupTaskId: string;
  provider: AIProvider;
  prompt: string;
  promptMetadata: IPromptMetadataSnapshot;
  complexityScore: number;
}

/**
 * Snapshot of prompt metadata at execution time
 */
export interface IPromptMetadataSnapshot {
  promptLength: number;
  estimatedTokens: number;
  templateVersion: string;
  generatedAt: string;
}

/**
 * Execution record with full details
 */
export interface IExecutionRecord {
  id: string;
  ticketId: string;
  provider: AIProvider;
  prompt: string;
  status: ExecutionStatus;
  confidenceScore: number | null;
  
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  errorMessage: string | null;
  
  codeOutput: string | null;
  filesChanged: string[] | null;
  
  retryCount: number;
  maxRetries: number;
  
  createdAt: Date;
  updatedAt: Date;
}

/**
 * State transition event
 */
export interface IStateTransition {
  executionId: string;
  previousStatus: ExecutionStatus;
  newStatus: ExecutionStatus;
  reason?: string;
  metadata?: Record<string, unknown>;
  transitionedAt: Date;
}

/**
 * Execution completion data
 */
export interface IExecutionCompletion {
  executionId: string;
  codeOutput: string;
  filesChanged: string[];
  confidenceScore: number;
}

/**
 * Execution failure data
 */
export interface IExecutionFailure {
  executionId: string;
  errorMessage: string;
  isRetryable: boolean;
  errorCode?: string;
}

/**
 * Execution timeout data
 */
export interface IExecutionTimeout {
  executionId: string;
  timeoutSeconds: number;
  lastKnownProgress?: string;
}

/**
 * Event payload for RabbitMQ
 */
export interface IExecutionEvent {
  eventType: 'EXECUTION_STARTED' | 'STATUS_CHANGED' | 'EXECUTION_COMPLETED' | 'EXECUTION_FAILED';
  correlationId: string;
  executionId: string;
  ticketId: string;
  provider: AIProvider;
  status: ExecutionStatus;
  timestamp: string;
  payload?: Record<string, unknown>;
}

/**
 * Audit log entry for execution
 */
export interface IExecutionAuditLog {
  entityType: 'execution';
  entityId: string;
  action: 'created' | 'status_changed' | 'completed' | 'failed' | 'retried';
  actorType: 'system';
  actorId: null;
  beforeState: Partial<IExecutionRecord> | null;
  afterState: Partial<IExecutionRecord>;
  createdAt: Date;
}
```

**File:** `src/execution/interfaces/index.ts`

```typescript
export * from './execution.interface';
```

---

## Step 2: Create Execution DTOs

**File:** `src/execution/dto/execution.dto.ts`

```typescript
import { AIProvider, ExecutionStatus } from '@prisma/client';
import { 
  IsString, 
  IsNotEmpty, 
  IsEnum, 
  IsNumber, 
  IsOptional, 
  IsArray,
  Min,
  Max,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for starting an execution
 */
export class StartExecutionDto {
  @IsString() @IsNotEmpty()
  correlationId: string;

  @IsString() @IsNotEmpty()
  ticketId: string;

  @IsString() @IsNotEmpty()
  clickupTaskId: string;

  @IsEnum(AIProvider)
  provider: AIProvider;

  @IsString() @IsNotEmpty()
  prompt: string;

  @IsNumber()
  complexityScore: number;

  @ValidateNested()
  @Type(() => PromptMetadataSnapshotDto)
  promptMetadata: PromptMetadataSnapshotDto;
}

/**
 * DTO for prompt metadata snapshot
 */
export class PromptMetadataSnapshotDto {
  @IsNumber()
  promptLength: number;

  @IsNumber()
  estimatedTokens: number;

  @IsString()
  templateVersion: string;

  @IsString()
  generatedAt: string;
}

/**
 * DTO for updating execution status
 */
export class UpdateExecutionStatusDto {
  @IsString() @IsNotEmpty()
  executionId: string;

  @IsEnum(ExecutionStatus)
  status: ExecutionStatus;

  @IsOptional() @IsString()
  reason?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

/**
 * DTO for completing an execution
 */
export class CompleteExecutionDto {
  @IsString() @IsNotEmpty()
  executionId: string;

  @IsString()
  codeOutput: string;

  @IsArray() @IsString({ each: true })
  filesChanged: string[];

  @IsNumber() @Min(0) @Max(1)
  confidenceScore: number;
}

/**
 * DTO for failing an execution
 */
export class FailExecutionDto {
  @IsString() @IsNotEmpty()
  executionId: string;

  @IsString() @IsNotEmpty()
  errorMessage: string;

  @IsOptional() @IsString()
  errorCode?: string;
}

/**
 * DTO for execution response
 */
export class ExecutionResponseDto {
  id: string;
  ticketId: string;
  provider: AIProvider;
  status: ExecutionStatus;
  confidenceScore: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  errorMessage: string | null;
  retryCount: number;
  filesChanged: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * DTO for execution with code output
 */
export class ExecutionWithOutputDto extends ExecutionResponseDto {
  codeOutput: string | null;
  prompt: string;
}
```

**File:** `src/execution/dto/index.ts`

```typescript
export * from './execution.dto';
```

---

## Step 3: Create Execution Status Enum with Transitions

**File:** `src/execution/enums/execution-status.enum.ts`

```typescript
import { ExecutionStatus } from '@prisma/client';

/**
 * Valid state transitions for execution status
 * 
 * State Machine:
 *                    ┌─────────────┐
 *                    │   QUEUED    │
 *                    └──────┬──────┘
 *                           │
 *                           ▼
 *                    ┌─────────────┐
 *        ┌───────────│ IN_PROGRESS │───────────┐
 *        │           └──────┬──────┘           │
 *        │                  │                  │
 *        ▼                  ▼                  ▼
 *   ┌─────────┐      ┌───────────┐      ┌─────────┐
 *   │ TIMEOUT │      │ COMPLETED │      │ FAILED  │
 *   └─────────┘      └───────────┘      └─────────┘
 *        │                                    │
 *        │          ┌───────────┐             │
 *        └─────────▶│ CANCELLED │◀────────────┘
 *                   └───────────┘
 * 
 * Note: CANCELLED can be reached from any non-terminal state
 */

/**
 * Map of valid transitions from each status
 */
export const VALID_TRANSITIONS: Record<ExecutionStatus, ExecutionStatus[]> = {
  [ExecutionStatus.QUEUED]: [
    ExecutionStatus.IN_PROGRESS,
    ExecutionStatus.CANCELLED,
  ],
  [ExecutionStatus.IN_PROGRESS]: [
    ExecutionStatus.COMPLETED,
    ExecutionStatus.FAILED,
    ExecutionStatus.TIMEOUT,
    ExecutionStatus.CANCELLED,
  ],
  [ExecutionStatus.COMPLETED]: [],  // Terminal state
  [ExecutionStatus.FAILED]: [
    ExecutionStatus.QUEUED,  // Allow retry → back to queue
    ExecutionStatus.CANCELLED,
  ],
  [ExecutionStatus.TIMEOUT]: [
    ExecutionStatus.QUEUED,  // Allow retry → back to queue
    ExecutionStatus.CANCELLED,
  ],
  [ExecutionStatus.CANCELLED]: [],  // Terminal state
};

/**
 * Terminal states that cannot transition
 */
export const TERMINAL_STATES: ExecutionStatus[] = [
  ExecutionStatus.COMPLETED,
  ExecutionStatus.CANCELLED,
];

/**
 * States that can be retried
 */
export const RETRYABLE_STATES: ExecutionStatus[] = [
  ExecutionStatus.FAILED,
  ExecutionStatus.TIMEOUT,
];

/**
 * Human-readable status labels
 */
export const STATUS_LABELS: Record<ExecutionStatus, string> = {
  [ExecutionStatus.QUEUED]: 'Queued',
  [ExecutionStatus.IN_PROGRESS]: 'In Progress',
  [ExecutionStatus.COMPLETED]: 'Completed',
  [ExecutionStatus.FAILED]: 'Failed',
  [ExecutionStatus.TIMEOUT]: 'Timed Out',
  [ExecutionStatus.CANCELLED]: 'Cancelled',
};

/**
 * Check if a transition is valid
 */
export function isValidTransition(
  from: ExecutionStatus,
  to: ExecutionStatus,
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Check if status is terminal
 */
export function isTerminalStatus(status: ExecutionStatus): boolean {
  return TERMINAL_STATES.includes(status);
}

/**
 * Check if status allows retry
 */
export function isRetryableStatus(status: ExecutionStatus): boolean {
  return RETRYABLE_STATES.includes(status);
}
```

**File:** `src/execution/enums/index.ts`

```typescript
export * from './execution-status.enum';
```

---

## Step 4: Create State Machine

**File:** `src/execution/state-machine/execution-state-machine.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ExecutionStatus } from '@prisma/client';
import {
  isValidTransition,
  isTerminalStatus,
  isRetryableStatus,
  STATUS_LABELS,
} from '../enums';
import { IStateTransition } from '../interfaces';

/**
 * Execution State Machine
 * 
 * Enforces valid state transitions and provides transition metadata.
 * FR62: System monitors AI execution progress
 */
@Injectable()
export class ExecutionStateMachine {
  private readonly logger = new Logger(ExecutionStateMachine.name);

  /**
   * Validate and execute a state transition
   * 
   * @param executionId - Execution ID
   * @param currentStatus - Current status
   * @param targetStatus - Desired new status
   * @param reason - Optional reason for transition
   * @returns State transition record or throws error
   */
  transition(
    executionId: string,
    currentStatus: ExecutionStatus,
    targetStatus: ExecutionStatus,
    reason?: string,
  ): IStateTransition {
    // Same state is a no-op
    if (currentStatus === targetStatus) {
      this.logger.debug(
        `[${executionId}] Status already ${STATUS_LABELS[currentStatus]}, no transition needed`,
      );
      return {
        executionId,
        previousStatus: currentStatus,
        newStatus: targetStatus,
        reason: 'No change',
        transitionedAt: new Date(),
      };
    }

    // Validate transition
    if (!isValidTransition(currentStatus, targetStatus)) {
      const error = `Invalid transition: ${STATUS_LABELS[currentStatus]} → ${STATUS_LABELS[targetStatus]}`;
      this.logger.error(`[${executionId}] ${error}`);
      throw new InvalidStateTransitionError(
        executionId,
        currentStatus,
        targetStatus,
        error,
      );
    }

    // Create transition record
    const transition: IStateTransition = {
      executionId,
      previousStatus: currentStatus,
      newStatus: targetStatus,
      reason,
      transitionedAt: new Date(),
    };

    this.logger.log(
      `[${executionId}] State transition: ${STATUS_LABELS[currentStatus]} → ${STATUS_LABELS[targetStatus]}` +
      (reason ? ` (${reason})` : ''),
    );

    return transition;
  }

  /**
   * Check if execution can be started (QUEUED → IN_PROGRESS)
   */
  canStart(currentStatus: ExecutionStatus): boolean {
    return isValidTransition(currentStatus, ExecutionStatus.IN_PROGRESS);
  }

  /**
   * Check if execution can be completed
   */
  canComplete(currentStatus: ExecutionStatus): boolean {
    return isValidTransition(currentStatus, ExecutionStatus.COMPLETED);
  }

  /**
   * Check if execution can be failed
   */
  canFail(currentStatus: ExecutionStatus): boolean {
    return isValidTransition(currentStatus, ExecutionStatus.FAILED);
  }

  /**
   * Check if execution can be cancelled
   */
  canCancel(currentStatus: ExecutionStatus): boolean {
    return isValidTransition(currentStatus, ExecutionStatus.CANCELLED);
  }

  /**
   * Check if execution can be retried
   */
  canRetry(currentStatus: ExecutionStatus, retryCount: number, maxRetries: number): boolean {
    return (
      isRetryableStatus(currentStatus) &&
      retryCount < maxRetries
    );
  }

  /**
   * Check if status is terminal (no further transitions)
   */
  isTerminal(status: ExecutionStatus): boolean {
    return isTerminalStatus(status);
  }

  /**
   * Get human-readable status label
   */
  getStatusLabel(status: ExecutionStatus): string {
    return STATUS_LABELS[status];
  }

  /**
   * Get valid next states from current state
   */
  getValidNextStates(currentStatus: ExecutionStatus): ExecutionStatus[] {
    const { VALID_TRANSITIONS } = require('../enums');
    return VALID_TRANSITIONS[currentStatus] || [];
  }
}

/**
 * Custom error for invalid state transitions
 */
export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly executionId: string,
    public readonly fromStatus: ExecutionStatus,
    public readonly toStatus: ExecutionStatus,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidStateTransitionError';
  }
}
```

**File:** `src/execution/state-machine/index.ts`

```typescript
export * from './execution-state-machine';
```

---

## Step 5: Create Execution Repository

**File:** `src/execution/execution.repository.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { AIProvider, ExecutionStatus, Execution, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { IExecutionRecord, IExecutionAuditLog } from './interfaces';

/**
 * Execution Repository
 * 
 * Data access layer for execution records using Prisma.
 * Handles CRUD operations and audit logging.
 */
@Injectable()
export class ExecutionRepository {
  private readonly logger = new Logger(ExecutionRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new execution record
   */
  async create(data: {
    ticketId: string;
    provider: AIProvider;
    prompt: string;
    status?: ExecutionStatus;
    maxRetries?: number;
  }): Promise<Execution> {
    const execution = await this.prisma.execution.create({
      data: {
        ticket_id: data.ticketId,
        ai_provider: data.provider,
        prompt: data.prompt,
        status: data.status || ExecutionStatus.QUEUED,
        max_retries: data.maxRetries || 3,
        retry_count: 0,
      },
    });

    this.logger.log(`Created execution ${execution.id} for ticket ${data.ticketId}`);
    return execution;
  }

  /**
   * Find execution by ID
   */
  async findById(id: string): Promise<Execution | null> {
    return this.prisma.execution.findUnique({
      where: { id },
    });
  }

  /**
   * Find executions by ticket ID
   */
  async findByTicketId(ticketId: string): Promise<Execution[]> {
    return this.prisma.execution.findMany({
      where: { ticket_id: ticketId },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Update execution status with timestamp handling
   */
  async updateStatus(
    id: string,
    status: ExecutionStatus,
    additionalData?: Partial<{
      confidenceScore: number;
      codeOutput: string;
      filesChanged: string[];
      errorMessage: string;
    }>,
  ): Promise<Execution> {
    const updateData: Prisma.ExecutionUpdateInput = {
      status,
    };

    // Set appropriate timestamp based on status
    switch (status) {
      case ExecutionStatus.IN_PROGRESS:
        updateData.started_at = new Date();
        break;
      case ExecutionStatus.COMPLETED:
        updateData.completed_at = new Date();
        if (additionalData?.confidenceScore !== undefined) {
          updateData.confidence_score = additionalData.confidenceScore;
        }
        if (additionalData?.codeOutput !== undefined) {
          updateData.code_output = additionalData.codeOutput;
        }
        if (additionalData?.filesChanged !== undefined) {
          updateData.files_changed = additionalData.filesChanged;
        }
        break;
      case ExecutionStatus.FAILED:
      case ExecutionStatus.TIMEOUT:
        updateData.failed_at = new Date();
        if (additionalData?.errorMessage !== undefined) {
          updateData.error_message = additionalData.errorMessage;
        }
        break;
    }

    const execution = await this.prisma.execution.update({
      where: { id },
      data: updateData,
    });

    this.logger.log(`Updated execution ${id} status to ${status}`);
    return execution;
  }

  /**
   * Increment retry count and reset to QUEUED
   */
  async incrementRetryAndRequeue(id: string): Promise<Execution> {
    return this.prisma.execution.update({
      where: { id },
      data: {
        retry_count: { increment: 1 },
        status: ExecutionStatus.QUEUED,
        // Clear failure timestamps for retry
        failed_at: null,
        error_message: null,
      },
    });
  }

  /**
   * Check if execution can retry
   */
  async canRetry(id: string): Promise<{ canRetry: boolean; retryCount: number; maxRetries: number }> {
    const execution = await this.prisma.execution.findUnique({
      where: { id },
      select: { retry_count: true, max_retries: true, status: true },
    });

    if (!execution) {
      return { canRetry: false, retryCount: 0, maxRetries: 0 };
    }

    return {
      canRetry: execution.retry_count < execution.max_retries,
      retryCount: execution.retry_count,
      maxRetries: execution.max_retries,
    };
  }

  /**
   * Get executions by status
   */
  async findByStatus(
    status: ExecutionStatus,
    options?: { limit?: number; provider?: AIProvider },
  ): Promise<Execution[]> {
    return this.prisma.execution.findMany({
      where: {
        status,
        ...(options?.provider ? { ai_provider: options.provider } : {}),
      },
      take: options?.limit,
      orderBy: { created_at: 'asc' },
    });
  }

  /**
   * Get active execution count per provider
   */
  async getActiveCountByProvider(): Promise<Record<AIProvider, number>> {
    const results = await this.prisma.execution.groupBy({
      by: ['ai_provider'],
      where: {
        status: { in: [ExecutionStatus.QUEUED, ExecutionStatus.IN_PROGRESS] },
      },
      _count: true,
    });

    // Initialize with zeros
    const counts: Record<AIProvider, number> = {
      [AIProvider.CURSOR_HEADLESS]: 0,
      [AIProvider.CLAUDE_CODE]: 0,
    } as Record<AIProvider, number>;

    // Fill in actual counts
    for (const result of results) {
      counts[result.ai_provider] = result._count;
    }

    return counts;
  }

  /**
   * Create audit log entry
   */
  async createAuditLog(log: IExecutionAuditLog): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        entity_type: log.entityType,
        entity_id: log.entityId,
        action: log.action,
        actor_type: log.actorType,
        actor_id: log.actorId,
        before_state: log.beforeState as Prisma.JsonValue,
        after_state: log.afterState as Prisma.JsonValue,
      },
    });
  }

  /**
   * Update ticket status based on execution
   */
  async updateTicketStatus(ticketId: string, status: string): Promise<void> {
    // Map execution-related statuses to ticket statuses
    const ticketStatusMap: Record<string, string> = {
      'QUEUED': 'QUEUED',
      'IN_PROGRESS': 'AI_PROCESSING',
      'COMPLETED': 'QA_REVIEW',  // Move to QA after AI completes
      'FAILED': 'FAILED',
      'TIMEOUT': 'FAILED',
    };

    const ticketStatus = ticketStatusMap[status];
    if (ticketStatus) {
      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: ticketStatus as any },
      });
      this.logger.log(`Updated ticket ${ticketId} status to ${ticketStatus}`);
    }
  }
}
```

---

## Step 6: Create Execution Tracker Service

**File:** `src/execution/execution-tracker.service.ts`

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ExecutionStatus, AIProvider, Execution } from '@prisma/client';
import { Counter, Histogram, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { RabbitmqPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { ExecutionRepository } from './execution.repository';
import { ExecutionStateMachine, InvalidStateTransitionError } from './state-machine';
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

  /** RabbitMQ exchange for execution events */
  private readonly EXECUTION_EXCHANGE = 'execution-events';
  
  /** Queue for status change events */
  private readonly STATUS_QUEUE = 'execution-status-queue';

  constructor(
    private readonly repository: ExecutionRepository,
    private readonly stateMachine: ExecutionStateMachine,
    private readonly publisher: RabbitmqPublisherService,
    @InjectMetric('execution_total')
    private readonly executionCounter: Counter<string>,
    @InjectMetric('execution_duration_seconds')
    private readonly durationHistogram: Histogram<string>,
    @InjectMetric('execution_status_gauge')
    private readonly statusGauge: Gauge<string>,
    @InjectMetric('execution_retry_total')
    private readonly retryCounter: Counter<string>,
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

    this.logger.log(
      `[${correlationId}] Execution ${execution.id} created with status QUEUED`,
    );

    return execution;
  }

  /**
   * Transition execution to IN_PROGRESS
   */
  async markInProgress(
    executionId: string,
    correlationId: string,
  ): Promise<IStateTransition> {
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
    const durationMs = execution.started_at
      ? Date.now() - execution.started_at.getTime()
      : 0;
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

    const errorMessage = `Execution timed out after ${timeoutSeconds} seconds` +
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
      await this.publisher.publish(this.STATUS_QUEUE, event);
      this.logger.debug(
        `[${event.correlationId}] Emitted ${event.eventType} event for execution ${event.executionId}`,
      );
    } catch (error) {
      this.logger.error(
        `[${event.correlationId}] Failed to emit event: ${error.message}`,
      );
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
      this.logger.error(`Failed to update status gauges: ${error.message}`);
    }
  }
}
```

---

## Step 7: Create Main Execution Service

**File:** `src/execution/execution.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ExecutionStatus, AIProvider, Execution } from '@prisma/client';
import { ExecutionTrackerService } from './execution-tracker.service';
import { ExecutionStateMachine } from './state-machine';
import {
  IStartExecutionInput,
  IExecutionCompletion,
  IExecutionFailure,
  IExecutionTimeout,
  IStateTransition,
  IExecutionRecord,
} from './interfaces';
import {
  StartExecutionDto,
  CompleteExecutionDto,
  FailExecutionDto,
  ExecutionResponseDto,
} from './dto';

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
  ) {}

  /**
   * Start a new AI execution
   * 
   * @param dto - Execution start parameters
   * @returns Created execution record
   */
  async startExecution(dto: StartExecutionDto): Promise<ExecutionResponseDto> {
    this.logger.log(
      `[${dto.correlationId}] Starting execution for ticket ${dto.ticketId}`,
    );

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
    return this.toResponseDto(execution);
  }

  /**
   * Mark execution as in progress
   */
  async markInProgress(
    executionId: string,
    correlationId: string,
  ): Promise<IStateTransition> {
    this.logger.log(`[${correlationId}] Marking execution ${executionId} as in progress`);
    return this.tracker.markInProgress(executionId, correlationId);
  }

  /**
   * Complete execution with results
   */
  async completeExecution(dto: CompleteExecutionDto, correlationId: string): Promise<IStateTransition> {
    this.logger.log(`[${correlationId}] Completing execution ${dto.executionId}`);

    const completion: IExecutionCompletion = {
      executionId: dto.executionId,
      codeOutput: dto.codeOutput,
      filesChanged: dto.filesChanged,
      confidenceScore: dto.confidenceScore,
    };

    return this.tracker.completeExecution(completion, correlationId);
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

    return this.tracker.failExecution(failure, correlationId);
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

    return this.tracker.timeoutExecution(timeout, correlationId);
  }

  /**
   * Cancel execution
   */
  async cancelExecution(
    executionId: string,
    reason: string,
    correlationId: string,
  ): Promise<IStateTransition> {
    this.logger.log(`[${correlationId}] Cancelling execution ${executionId}`);
    return this.tracker.cancelExecution(executionId, reason, correlationId);
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
    return executions.map(e => this.toResponseDto(e));
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
```

---

## Step 8: Update Execution Module

**File:** `src/execution/execution.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';
import { ExecutionService } from './execution.service';
import { ExecutionTrackerService } from './execution-tracker.service';
import { ExecutionRepository } from './execution.repository';
import { ExecutionStateMachine } from './state-machine';
import { DatabaseModule } from '../database/database.module';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';

/**
 * Execution Module
 * 
 * Story 2.5: FR62 - System monitors AI execution progress
 * 
 * Provides:
 * - Execution lifecycle management
 * - State machine for valid transitions
 * - Audit logging for all state changes
 * - RabbitMQ event emission
 * - Prometheus metrics
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RabbitmqModule,
  ],
  providers: [
    // Core services
    ExecutionService,
    ExecutionTrackerService,
    ExecutionRepository,
    ExecutionStateMachine,

    // Prometheus metrics
    makeCounterProvider({
      name: 'execution_total',
      help: 'Total execution count by provider and status',
      labelNames: ['provider', 'status'],
    }),
    makeHistogramProvider({
      name: 'execution_duration_seconds',
      help: 'Execution duration in seconds',
      labelNames: ['provider', 'status'],
      buckets: [10, 30, 60, 120, 300, 600, 900, 1800],
    }),
    makeGaugeProvider({
      name: 'execution_status_gauge',
      help: 'Current execution count by status',
      labelNames: ['provider', 'status'],
    }),
    makeCounterProvider({
      name: 'execution_retry_total',
      help: 'Total execution retry count',
      labelNames: ['provider'],
    }),
  ],
  exports: [
    ExecutionService,
    ExecutionTrackerService,
    ExecutionRepository,
    ExecutionStateMachine,
  ],
})
export class ExecutionModule {}
```

---

## Step 9: Create Unit Tests

**File:** `src/execution/execution.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AIProvider, ExecutionStatus } from '@prisma/client';
import { ExecutionService } from './execution.service';
import { ExecutionTrackerService } from './execution-tracker.service';
import { ExecutionStateMachine } from './state-machine';
import { StartExecutionDto, CompleteExecutionDto, FailExecutionDto } from './dto';

describe('ExecutionService', () => {
  let service: ExecutionService;
  let trackerService: jest.Mocked<ExecutionTrackerService>;
  let stateMachine: ExecutionStateMachine;

  const mockExecution = {
    id: 'exec-123',
    ticket_id: 'ticket-456',
    ai_provider: AIProvider.CLAUDE_CODE,
    prompt: 'Test prompt',
    status: ExecutionStatus.QUEUED,
    confidence_score: null,
    started_at: null,
    completed_at: null,
    failed_at: null,
    error_message: null,
    code_output: null,
    files_changed: null,
    retry_count: 0,
    max_retries: 3,
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(async () => {
    const mockTrackerService = {
      startExecution: jest.fn().mockResolvedValue(mockExecution),
      markInProgress: jest.fn().mockResolvedValue({
        executionId: 'exec-123',
        previousStatus: ExecutionStatus.QUEUED,
        newStatus: ExecutionStatus.IN_PROGRESS,
        transitionedAt: new Date(),
      }),
      completeExecution: jest.fn().mockResolvedValue({
        executionId: 'exec-123',
        previousStatus: ExecutionStatus.IN_PROGRESS,
        newStatus: ExecutionStatus.COMPLETED,
        transitionedAt: new Date(),
      }),
      failExecution: jest.fn().mockResolvedValue({
        executionId: 'exec-123',
        previousStatus: ExecutionStatus.IN_PROGRESS,
        newStatus: ExecutionStatus.FAILED,
        transitionedAt: new Date(),
      }),
      timeoutExecution: jest.fn().mockResolvedValue({
        executionId: 'exec-123',
        previousStatus: ExecutionStatus.IN_PROGRESS,
        newStatus: ExecutionStatus.TIMEOUT,
        transitionedAt: new Date(),
      }),
      cancelExecution: jest.fn().mockResolvedValue({
        executionId: 'exec-123',
        previousStatus: ExecutionStatus.QUEUED,
        newStatus: ExecutionStatus.CANCELLED,
        transitionedAt: new Date(),
      }),
      getExecution: jest.fn().mockResolvedValue(mockExecution),
      getExecutionsForTicket: jest.fn().mockResolvedValue([mockExecution]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionService,
        ExecutionStateMachine,
        { provide: ExecutionTrackerService, useValue: mockTrackerService },
      ],
    }).compile();

    service = module.get<ExecutionService>(ExecutionService);
    trackerService = module.get(ExecutionTrackerService);
    stateMachine = module.get<ExecutionStateMachine>(ExecutionStateMachine);
  });

  describe('startExecution', () => {
    it('should create a new execution', async () => {
      const dto: StartExecutionDto = {
        correlationId: 'corr-123',
        ticketId: 'ticket-456',
        clickupTaskId: 'task-789',
        provider: AIProvider.CLAUDE_CODE,
        prompt: 'Test prompt',
        complexityScore: 8,
        promptMetadata: {
          promptLength: 1000,
          estimatedTokens: 250,
          templateVersion: '1.0.0',
          generatedAt: new Date().toISOString(),
        },
      };

      const result = await service.startExecution(dto);

      expect(trackerService.startExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          correlationId: dto.correlationId,
          ticketId: dto.ticketId,
          provider: dto.provider,
        }),
      );
      expect(result.id).toBe(mockExecution.id);
      expect(result.status).toBe(ExecutionStatus.QUEUED);
    });
  });

  describe('markInProgress', () => {
    it('should transition to IN_PROGRESS', async () => {
      const result = await service.markInProgress('exec-123', 'corr-123');

      expect(trackerService.markInProgress).toHaveBeenCalledWith('exec-123', 'corr-123');
      expect(result.newStatus).toBe(ExecutionStatus.IN_PROGRESS);
    });
  });

  describe('completeExecution', () => {
    it('should complete execution with results', async () => {
      const dto: CompleteExecutionDto = {
        executionId: 'exec-123',
        codeOutput: 'Generated code...',
        filesChanged: ['src/test.ts'],
        confidenceScore: 0.95,
      };

      const result = await service.completeExecution(dto, 'corr-123');

      expect(trackerService.completeExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: dto.executionId,
          confidenceScore: dto.confidenceScore,
        }),
        'corr-123',
      );
      expect(result.newStatus).toBe(ExecutionStatus.COMPLETED);
    });
  });

  describe('failExecution', () => {
    it('should fail execution with error', async () => {
      const dto: FailExecutionDto = {
        executionId: 'exec-123',
        errorMessage: 'API rate limit exceeded',
        errorCode: 'RATE_LIMIT',
      };

      const result = await service.failExecution(dto, 'corr-123', true);

      expect(trackerService.failExecution).toHaveBeenCalled();
      expect(result.newStatus).toBe(ExecutionStatus.FAILED);
    });
  });

  describe('timeoutExecution', () => {
    it('should timeout execution', async () => {
      const result = await service.timeoutExecution('exec-123', 300, 'corr-123');

      expect(trackerService.timeoutExecution).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: 'exec-123',
          timeoutSeconds: 300,
        }),
        'corr-123',
      );
      expect(result.newStatus).toBe(ExecutionStatus.TIMEOUT);
    });
  });

  describe('cancelExecution', () => {
    it('should cancel execution', async () => {
      const result = await service.cancelExecution('exec-123', 'User cancelled', 'corr-123');

      expect(trackerService.cancelExecution).toHaveBeenCalledWith('exec-123', 'User cancelled', 'corr-123');
      expect(result.newStatus).toBe(ExecutionStatus.CANCELLED);
    });
  });

  describe('getExecution', () => {
    it('should return execution by ID', async () => {
      const result = await service.getExecution('exec-123');

      expect(trackerService.getExecution).toHaveBeenCalledWith('exec-123');
      expect(result?.id).toBe(mockExecution.id);
    });

    it('should return null for non-existent execution', async () => {
      trackerService.getExecution.mockResolvedValueOnce(null);

      const result = await service.getExecution('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('state machine helpers', () => {
    it('canStart should check QUEUED status', () => {
      expect(service.canStart(ExecutionStatus.QUEUED)).toBe(true);
      expect(service.canStart(ExecutionStatus.COMPLETED)).toBe(false);
    });

    it('canComplete should check IN_PROGRESS status', () => {
      expect(service.canComplete(ExecutionStatus.IN_PROGRESS)).toBe(true);
      expect(service.canComplete(ExecutionStatus.QUEUED)).toBe(false);
    });

    it('isTerminal should identify terminal states', () => {
      expect(service.isTerminal(ExecutionStatus.COMPLETED)).toBe(true);
      expect(service.isTerminal(ExecutionStatus.CANCELLED)).toBe(true);
      expect(service.isTerminal(ExecutionStatus.IN_PROGRESS)).toBe(false);
    });
  });
});

describe('ExecutionStateMachine', () => {
  let stateMachine: ExecutionStateMachine;

  beforeEach(() => {
    stateMachine = new ExecutionStateMachine();
  });

  describe('transition', () => {
    it('should allow valid QUEUED → IN_PROGRESS transition', () => {
      const result = stateMachine.transition(
        'exec-123',
        ExecutionStatus.QUEUED,
        ExecutionStatus.IN_PROGRESS,
        'Starting execution',
      );

      expect(result.previousStatus).toBe(ExecutionStatus.QUEUED);
      expect(result.newStatus).toBe(ExecutionStatus.IN_PROGRESS);
    });

    it('should allow valid IN_PROGRESS → COMPLETED transition', () => {
      const result = stateMachine.transition(
        'exec-123',
        ExecutionStatus.IN_PROGRESS,
        ExecutionStatus.COMPLETED,
        'Execution finished',
      );

      expect(result.newStatus).toBe(ExecutionStatus.COMPLETED);
    });

    it('should reject invalid QUEUED → COMPLETED transition', () => {
      expect(() =>
        stateMachine.transition(
          'exec-123',
          ExecutionStatus.QUEUED,
          ExecutionStatus.COMPLETED,
          'Invalid',
        ),
      ).toThrow('Invalid transition');
    });

    it('should reject transition from terminal state', () => {
      expect(() =>
        stateMachine.transition(
          'exec-123',
          ExecutionStatus.COMPLETED,
          ExecutionStatus.IN_PROGRESS,
          'Invalid',
        ),
      ).toThrow('Invalid transition');
    });

    it('should allow same-state no-op', () => {
      const result = stateMachine.transition(
        'exec-123',
        ExecutionStatus.QUEUED,
        ExecutionStatus.QUEUED,
      );

      expect(result.previousStatus).toBe(ExecutionStatus.QUEUED);
      expect(result.newStatus).toBe(ExecutionStatus.QUEUED);
      expect(result.reason).toBe('No change');
    });
  });

  describe('helper methods', () => {
    it('canRetry should check status and retry count', () => {
      expect(stateMachine.canRetry(ExecutionStatus.FAILED, 0, 3)).toBe(true);
      expect(stateMachine.canRetry(ExecutionStatus.FAILED, 3, 3)).toBe(false);
      expect(stateMachine.canRetry(ExecutionStatus.COMPLETED, 0, 3)).toBe(false);
    });

    it('getValidNextStates should return valid transitions', () => {
      const states = stateMachine.getValidNextStates(ExecutionStatus.QUEUED);
      expect(states).toContain(ExecutionStatus.IN_PROGRESS);
      expect(states).toContain(ExecutionStatus.CANCELLED);
    });
  });
});
```

---

## Step 10: Verify Prisma Schema (if needed)

**Check if AIProvider enum needs updating:**

```bash
grep -A 5 "enum AIProvider" prisma/schema.prisma
```

**If it shows old values (CURSOR, WINDSURF, ANTIGRAVITY), update to:**

```prisma
enum AIProvider {
  CURSOR_HEADLESS
  CLAUDE_CODE
}
```

Then run:
```bash
npx prisma migrate dev --name update-ai-provider-enum
npx prisma generate
```

---

## Validation Checklist

### Interfaces & DTOs
- [ ] `IStartExecutionInput` interface matches Story 2.4 output
- [ ] `IExecutionRecord` interface covers all Prisma Execution fields
- [ ] `IStateTransition` interface captures transition metadata
- [ ] `IExecutionEvent` interface for RabbitMQ events
- [ ] DTOs have validation decorators

### State Machine
- [ ] `VALID_TRANSITIONS` map defines all valid state flows
- [ ] `isValidTransition()` function works correctly
- [ ] `isTerminalStatus()` identifies COMPLETED and CANCELLED
- [ ] `isRetryableStatus()` identifies FAILED and TIMEOUT
- [ ] Invalid transitions throw `InvalidStateTransitionError`

### Execution Repository
- [ ] `create()` creates execution with QUEUED status
- [ ] `updateStatus()` sets appropriate timestamps
- [ ] `incrementRetryAndRequeue()` handles retry logic
- [ ] `createAuditLog()` logs to audit_logs table
- [ ] `updateTicketStatus()` syncs ticket status

### Execution Tracker Service
- [ ] `startExecution()` creates record, logs audit, emits event
- [ ] `markInProgress()` validates transition, updates status
- [ ] `completeExecution()` captures results, calculates duration
- [ ] `failExecution()` handles errors, schedules retry if eligible
- [ ] `timeoutExecution()` marks as timed out with details
- [ ] All state changes emit RabbitMQ events
- [ ] Prometheus metrics tracked: `execution_total`, `execution_duration_seconds`, `execution_status_gauge`, `execution_retry_total`

### Module Integration
- [ ] `ExecutionService` added to module providers
- [ ] `ExecutionTrackerService` added to module providers
- [ ] `ExecutionRepository` added to module providers
- [ ] `ExecutionStateMachine` added to module providers
- [ ] All services exported from module
- [ ] Metrics providers registered

### Tests
- [ ] `ExecutionService` unit tests pass
- [ ] `ExecutionStateMachine` unit tests pass
- [ ] Tests cover: all state transitions, retry logic, error cases

---

## Quick Verification Commands

After each step, verify with TypeScript compiler:

**After Steps 1-4:** `npx tsc --noEmit src/execution/interfaces/index.ts src/execution/dto/index.ts src/execution/enums/index.ts src/execution/state-machine/index.ts`  
**After Step 5:** `npx tsc --noEmit src/execution/execution.repository.ts`  
**After Step 6:** `npx tsc --noEmit src/execution/execution-tracker.service.ts`  
**After Step 7:** `npx tsc --noEmit src/execution/execution.service.ts`  
**After Step 8:** `npx tsc --noEmit src/execution/execution.module.ts`  
**After Step 9:** `pnpm test -- --testPathPattern=execution`

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Cannot find module '../database/prisma.service'` | Database module not properly imported | Verify DatabaseModule in imports and PrismaService exported |
| `Cannot find module '../rabbitmq/rabbitmq-publisher.service'` | RabbitMQ module not imported | Verify RabbitmqModule in imports |
| `Property 'CURSOR_HEADLESS' does not exist` | Prisma enum not updated | Run migration: `npx prisma migrate dev && npx prisma generate` |
| `Type 'XXX' is not assignable to type 'ExecutionStatus'` | Enum mismatch | Verify using `@prisma/client` ExecutionStatus |
| `Cannot find name 'Counter'` | Missing prom-client import | Add `import { Counter, Histogram, Gauge } from 'prom-client'` |
| Metrics not registering | Metric providers not in module | Verify all makeXxxProvider calls in module providers array |

---

## Prerequisites

- ✅ **Story 2.4 Complete** - Provides `PromptGeneratorService` and `IGeneratedPrompt`
- ✅ **Story 1.5 Complete** - RabbitMQ infrastructure with `RabbitmqPublisherService`
- ✅ **Story 1.3 Complete** - Database with Prisma and `Execution` model
- ✅ **Story 1.8 Complete** - Prometheus metrics infrastructure

---

## Integration Notes

### How This Story Connects

**Input (from Story 2.4):**
```typescript
// After prompt generation, start execution tracking
const generatedPrompt = await promptGeneratorService.generatePrompt(input, context);

// Create execution record
const execution = await executionService.startExecution({
  correlationId,
  ticketId,
  clickupTaskId,
  provider,
  prompt: generatedPrompt.prompt,
  promptMetadata: {
    promptLength: generatedPrompt.metadata.promptLength,
    estimatedTokens: generatedPrompt.metadata.estimatedTokens,
    templateVersion: generatedPrompt.metadata.templateVersion,
    generatedAt: generatedPrompt.metadata.generatedAt.toISOString(),
  },
  complexityScore,
});
```

**Output (to Story 2.6/2.7 - Provider Integration):**
```typescript
// Provider integration will:
// 1. Get execution record
const execution = await executionService.getExecution(executionId);

// 2. Mark as in progress
await executionService.markInProgress(executionId, correlationId);

// 3. Execute AI provider with prompt
const result = await cursorProvider.execute(execution.prompt);

// 4. Complete or fail based on result
if (result.success) {
  await executionService.completeExecution({
    executionId,
    codeOutput: result.code,
    filesChanged: result.files,
    confidenceScore: result.confidence,
  }, correlationId);
} else {
  await executionService.failExecution({
    executionId,
    errorMessage: result.error,
    errorCode: result.errorCode,
  }, correlationId, result.isRetryable);
}
```

### RabbitMQ Events Emitted

| Event Type | Queue | Payload |
|------------|-------|---------|
| `EXECUTION_STARTED` | `execution-status-queue` | executionId, ticketId, provider, complexityScore |
| `STATUS_CHANGED` | `execution-status-queue` | executionId, previousStatus, newStatus, reason |
| `EXECUTION_COMPLETED` | `execution-status-queue` | executionId, filesChanged, confidenceScore, duration |
| `EXECUTION_FAILED` | `execution-status-queue` | executionId, errorMessage, isRetryable, retryCount |

---

## References

| Document | Section | Content |
|----------|---------|---------|
| `docs/architecture.md` | Lines 1595-1640 | Execution model and ExecutionStatus enum |
| `docs/architecture.md` | Lines 143-150 | Execution module structure |
| `docs/epics.md` | Lines 972-1003 | Story 2.5 Requirements |
| `docs/prd.md` | FR62 | System monitors AI execution progress |
| `prisma/schema.prisma` | Lines 56-104 | Execution and ExecutionStatus models |

---

## Dev Agent Record

### Context Reference

This story was prepared with complete context analysis from:
- Architecture document (Execution model, state transitions)
- PRD functional requirements (FR62)
- Previous story (2-4) patterns: interfaces, DTOs, services, module structure, metrics
- Prisma schema for Execution model
- Current codebase structure

### Learnings from Previous Stories Applied

1. **Interface Pattern:** Comprehensive typing with clear input/output contracts
2. **DTO Pattern:** Use class-validator decorators for runtime validation
3. **Service Pattern:** Layered architecture (Service → Tracker → Repository)
4. **State Machine Pattern:** Explicit valid transitions with error handling
5. **Metrics Pattern:** Use `@willsoto/nestjs-prometheus` providers
6. **Event Pattern:** RabbitMQ events for state changes with correlation IDs
7. **Audit Pattern:** Every state change logged to audit_logs table

### Completion Notes

**Story Status:** ✅ DONE (Code Review Approved)  
**Implementation Date:** 2025-12-03  
**Developer:** Amelia (Dev Agent)

**Implementation Summary:**
- All 10 implementation steps completed following red-green-refactor cycle
- Created execution tracking module with state machine for valid state transitions
- Implemented FR62: System monitors AI execution progress
- All 63 unit tests passing (22 original + 19 tracker + 22 repository)
- TypeScript compiles without errors
- ESLint passes for execution module

**Code Review Fixes Applied:**
1. ✅ Added retry logic to `timeoutExecution()` - now consistent with `failExecution()`
2. ✅ Removed unused `EXECUTION_EXCHANGE` constant (dead code)
3. ✅ Store `complexityScore` in database via `repository.create()`
4. ✅ Added `CANCELLED` to `ticketStatusMap` (maps to FAILED ticket status)
5. ✅ Created `execution-tracker.service.spec.ts` with 19 comprehensive tests
6. ✅ Created `execution.repository.spec.ts` with 22 comprehensive tests

**Key Accomplishments:**
1. Execution lifecycle management (QUEUED → IN_PROGRESS → COMPLETED/FAILED/TIMEOUT)
2. State machine enforcing valid transitions with InvalidStateTransitionError
3. Audit logging for all state changes to audit_logs table
4. RabbitMQ event emission for status changes (execution-status-queue)
5. Prometheus metrics: execution_total, execution_duration_seconds, execution_status_gauge, execution_retry_total
6. Automatic retry scheduling for failed/timeout executions

---

## File List

| File | Action | Purpose |
|------|--------|---------|
| `src/execution/interfaces/execution.interface.ts` | EXISTS | Execution interfaces (IStartExecutionInput, IStateTransition, etc.) |
| `src/execution/interfaces/index.ts` | EXISTS | Barrel export |
| `src/execution/dto/execution.dto.ts` | EXISTS | Execution DTOs with class-validator decorators |
| `src/execution/dto/index.ts` | EXISTS | Barrel export |
| `src/execution/enums/execution-status.enum.ts` | EXISTS | State transitions, terminal states, helper functions |
| `src/execution/enums/index.ts` | EXISTS | Barrel export |
| `src/execution/state-machine/execution-state-machine.ts` | EXISTS | State transition logic with InvalidStateTransitionError |
| `src/execution/state-machine/index.ts` | EXISTS | Barrel export |
| `src/execution/execution.repository.ts` | MODIFIED | Added complexityScore, CANCELLED mapping |
| `src/execution/execution.repository.spec.ts` | CREATED | 22 unit tests for repository layer |
| `src/execution/execution-tracker.service.ts` | MODIFIED | Added timeout retry, removed dead code |
| `src/execution/execution-tracker.service.spec.ts` | CREATED | 19 unit tests for tracker service |
| `src/execution/execution.service.ts` | MODIFIED | Fixed lint errors (unused imports) |
| `src/execution/execution.service.spec.ts` | MODIFIED | Fixed lint errors (unused imports) |
| `src/execution/execution.module.ts` | EXISTS | Module with Prometheus metric providers |
| `docs/sprint-artifacts/sprint-status.yaml` | MODIFIED | Updated story status to done |

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2025-12-03 | Implementation complete - all 22 tests passing, lint clean | Amelia (Dev Agent) |
| 2025-12-03 | Fixed lint errors in execution module files | Amelia (Dev Agent) |
| 2025-12-03 | Code Review: Fixed 6 issues, added 41 new tests | Code Reviewer |

---

**Document prepared by:** Bob (Scrum Master)  
**Preparation date:** 2025-12-01  
**Implementation completed by:** Amelia (Dev Agent)  
**Implementation date:** 2025-12-03  
**Analysis method:** Ultimate BMad Method Story Context Engine  
**Quality level:** ✅ IMPLEMENTATION VERIFIED

