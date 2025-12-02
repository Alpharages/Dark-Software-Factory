# Story 2.2: Ticket Data Parsing & Validation

**Epic:** 2 - Ticket Intake & AI Routing Engine  
**Status:** done  
**Priority:** P0 - BLOCKER  
**Effort:** 8 story points  
**ClickUp ID:** `86evnjwa2`  
**ClickUp URL:** https://app.clickup.com/t/86evnjwa2

---

## Story

As the system,
I want to parse ClickUp task data into our ticket model,
So that I can validate and process tickets consistently.

---

## Acceptance Criteria

**Given** a ClickUp webhook event is received  
**When** the system parses the task payload  
**Then** the following data is extracted:
- `clickup_task_id` (unique identifier)
- `project_id` (from ClickUp custom field or list)
- `title` (task name)
- `description` (task description - may contain markdown)
- `acceptance_criteria` (from description section or custom field)

**And** validation checks are performed:
- Title is not empty (min 10 characters)
- Description exists and is not empty
- Acceptance criteria are present and well-formed
- Project ID is valid and matches active project

**And** if validation fails:
- Ticket status set to `VALIDATION_FAILED`
- ClickUp task is commented with failure reasons
- PM is notified via ClickUp notification
- Ticket is NOT queued for AI processing

**And** if validation succeeds:
- Ticket record created in database with status `VALIDATED`
- Ticket quality score calculated (0-100 based on completeness)
- Correlation ID propagated from webhook
- Ticket routed to AI processing queue

---

## Quick Implementation Summary (TL;DR)

**9 Key Files in Implementation Order:**
1. `src/rabbitmq/rabbitmq.config.ts` - **MODIFY**: Add queue names
2. `src/rabbitmq/rabbitmq.service.ts` - **MODIFY**: Add queue setup
3. `src/ticket-intake/interfaces/ticket-intake.interface.ts` - Create interfaces
4. `src/ticket-intake/dto/*.ts` - Create DTOs
5. `src/ticket-intake/ticket-validator.service.ts` - Validation logic
6. `src/ticket-intake/ticket-quality.service.ts` - Quality scoring
7. `src/ticket-intake/ticket-intake.service.ts` - Main service
8. `src/ticket-intake/ticket-intake.consumer.ts` - Queue consumer (extends base)
9. `src/ticket-intake/ticket-intake.module.ts` - Wire everything

**No new dependencies required** - uses existing RabbitMQ and Prisma setup.

---

## Technical Requirements

### Quick Reference: Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/rabbitmq/rabbitmq.config.ts` | **MODIFY** | Add TICKET_INTAKE and AI_ROUTING queue names |
| `src/rabbitmq/rabbitmq.service.ts` | **MODIFY** | Setup new queues in onModuleInit |
| `src/config/configuration.ts` | **MODIFY** | Add clickup.apiUrl config |
| `src/ticket-intake/ticket-intake.module.ts` | **MODIFY** | Add providers, imports |
| `src/ticket-intake/ticket-intake.service.ts` | CREATE | Main processing logic |
| `src/ticket-intake/ticket-validator.service.ts` | CREATE | Validation rules |
| `src/ticket-intake/ticket-quality.service.ts` | CREATE | Quality scoring |
| `src/ticket-intake/ticket-intake.consumer.ts` | CREATE | RabbitMQ consumer |
| `src/ticket-intake/dto/parsed-ticket.dto.ts` | CREATE | DTOs |
| `src/ticket-intake/dto/validation-result.dto.ts` | CREATE | DTOs |
| `src/ticket-intake/interfaces/ticket-intake.interface.ts` | CREATE | Interfaces |
| `src/ticket-intake/*.spec.ts` | CREATE | Unit tests |

---

## Step 0: Update RabbitMQ Infrastructure (CRITICAL)

### 0.1 Add Queue Names

**File:** `src/rabbitmq/rabbitmq.config.ts` - **ADD** to QUEUE_NAMES:

```typescript
export const QUEUE_NAMES = {
  // Existing queues
  AI_EXECUTION: 'ai-execution-queue',
  QA_CHECK: 'qa-check-queue',
  DEPLOYMENT: 'deployment-queue',
  MONITORING: 'monitoring-queue',
  DEAD_LETTER: 'dead-letter-queue',
  // ADD these new queues for Epic 2
  TICKET_INTAKE: 'ticket-intake-queue',
  AI_ROUTING: 'ai-routing-queue',
} as const;
```

### 0.2 Setup New Queues

**File:** `src/rabbitmq/rabbitmq.service.ts` - **UPDATE** `setupQueuesAndExchanges()`:

```typescript
private async setupQueuesAndExchanges(): Promise<void> {
  if (!this.channel) return;

  // ... existing DLX setup ...

  // ADD ticket-intake-queue and ai-routing-queue to the list
  const queues = [
    QUEUE_NAMES.AI_EXECUTION,
    QUEUE_NAMES.QA_CHECK,
    QUEUE_NAMES.DEPLOYMENT,
    QUEUE_NAMES.MONITORING,
    QUEUE_NAMES.TICKET_INTAKE,  // ADD
    QUEUE_NAMES.AI_ROUTING,      // ADD
  ];

  // ... rest of setup ...
}
```

### 0.3 Add ClickUp API URL Config

**File:** `src/config/configuration.ts` - **UPDATE** clickup section:

```typescript
clickup: {
  apiKey: process.env.CLICKUP_API_KEY,
  apiUrl: process.env.CLICKUP_API_URL || 'https://api.clickup.com/api/v2',  // ADD
  webhookSecret: process.env.CLICKUP_WEBHOOK_SECRET,
},
```

---

## Step 1: Create Interfaces

**File:** `src/ticket-intake/interfaces/ticket-intake.interface.ts`

```typescript
/**
 * Ticket Intake Interfaces
 * FR57: Parse ticket details | FR58: Validate ticket quality
 */

/** Raw task event from webhook queue (matches TaskEventDto from Story 2.1) */
export interface IRawTaskEvent {
  correlationId: string;
  webhookEventId: string;
  eventType: string;
  taskId: string;
  taskName: string;
  taskDescription: string | null;
  taskStatus: string;
  listId: string;
  listName: string;
  spaceId: string;
  projectId: string;
  projectName: string;
  taskUrl: string;
  tags: string[];
  customFields: Record<string, unknown>;
  creatorEmail: string;
  eventTimestamp: string;
  receivedAt: string;
}

export interface IParsedTicket {
  clickupTaskId: string;
  projectId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  tags: string[];
  priority: string | null;
  creatorEmail: string;
  taskUrl: string;
  rawEvent: IRawTaskEvent;
}

export interface IValidationError {
  field: string;
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface IQualityScoreBreakdown {
  titleClarity: number;              // 0-15 pts
  descriptionCompleteness: number;   // 0-25 pts
  acceptanceCriteria: number;        // 0-30 pts
  contextDocuments: number;          // 0-10 pts
  taskComplexity: number;            // 0-10 pts
  prerequisites: number;             // 0-10 pts
}

export interface IQualityScore {
  totalScore: number;
  breakdown: IQualityScoreBreakdown;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  suggestions: string[];
}
```

**File:** `src/ticket-intake/interfaces/index.ts`

```typescript
export * from './ticket-intake.interface';
```

---

## Step 2: Create DTOs

**File:** `src/ticket-intake/dto/parsed-ticket.dto.ts`

```typescript
import { IsString, IsNotEmpty, IsOptional, IsArray, MinLength, IsEmail } from 'class-validator';

export class ParsedTicketDto {
  @IsString() @IsNotEmpty()
  clickupTaskId: string;

  @IsString() @IsNotEmpty()
  projectId: string;

  @IsString() @IsNotEmpty() @MinLength(10)
  title: string;

  @IsString() @IsNotEmpty()
  description: string;

  @IsString()
  acceptanceCriteria: string;

  @IsArray() @IsString({ each: true })
  tags: string[];

  @IsOptional() @IsString()
  priority: string | null;

  @IsOptional() @IsEmail()
  creatorEmail: string;

  @IsString()
  taskUrl: string;

  @IsString()
  correlationId: string;
}
```

**File:** `src/ticket-intake/dto/validation-result.dto.ts`

```typescript
export class ValidationErrorDto {
  field: string;
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export class ValidationResultDto {
  isValid: boolean;
  errors: ValidationErrorDto[];
  warnings: ValidationErrorDto[];

  static success(): ValidationResultDto {
    return { isValid: true, errors: [], warnings: [] };
  }

  static failure(errors: ValidationErrorDto[], warnings: ValidationErrorDto[] = []): ValidationResultDto {
    return { isValid: false, errors, warnings };
  }
}

export class QualityScoreBreakdownDto {
  titleClarity: number;
  descriptionCompleteness: number;
  acceptanceCriteria: number;
  contextDocuments: number;
  taskComplexity: number;
  prerequisites: number;
}

export class QualityScoreDto {
  totalScore: number;
  breakdown: QualityScoreBreakdownDto;
  grade: 'excellent' | 'good' | 'fair' | 'poor';
  suggestions: string[];
}
```

**File:** `src/ticket-intake/dto/index.ts`

```typescript
export * from './parsed-ticket.dto';
export * from './validation-result.dto';
```

---

## Step 3: Create Ticket Validator Service

**File:** `src/ticket-intake/ticket-validator.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { IParsedTicket } from './interfaces';
import { ValidationResultDto, ValidationErrorDto } from './dto';

@Injectable()
export class TicketValidatorService {
  private readonly logger = new Logger(TicketValidatorService.name);
  private readonly MIN_TITLE_LENGTH = 10;
  private readonly MIN_DESCRIPTION_LENGTH = 50;
  private readonly MIN_AC_LENGTH = 20;

  async validate(ticket: IParsedTicket, correlationId: string): Promise<ValidationResultDto> {
    this.logger.log(`[${correlationId}] Validating ticket: ${ticket.clickupTaskId}`);
    const errors: ValidationErrorDto[] = [];
    const warnings: ValidationErrorDto[] = [];

    this.validateTitle(ticket.title, errors, warnings);
    this.validateDescription(ticket.description, errors, warnings);
    this.validateAcceptanceCriteria(ticket.acceptanceCriteria, errors, warnings);
    this.validateProjectId(ticket.projectId, errors, warnings);

    const isValid = errors.length === 0;
    this.logger.log(`[${correlationId}] Validation ${isValid ? 'PASSED' : 'FAILED'}: ${errors.length} errors`);

    return isValid ? ValidationResultDto.success() : ValidationResultDto.failure(errors, warnings);
  }

  private validateTitle(title: string, errors: ValidationErrorDto[], warnings: ValidationErrorDto[]): void {
    if (!title?.trim()) {
      errors.push({ field: 'title', code: 'TITLE_REQUIRED', message: 'Ticket title is required', severity: 'error' });
      return;
    }
    if (title.trim().length < this.MIN_TITLE_LENGTH) {
      errors.push({ field: 'title', code: 'TITLE_TOO_SHORT', message: `Title must be at least ${this.MIN_TITLE_LENGTH} characters`, severity: 'error' });
    }
    if (/^(todo|fix|test)\b/i.test(title)) {
      warnings.push({ field: 'title', code: 'TITLE_GENERIC', message: 'Use a more descriptive title', severity: 'warning' });
    }
  }

  private validateDescription(desc: string, errors: ValidationErrorDto[], warnings: ValidationErrorDto[]): void {
    if (!desc?.trim()) {
      errors.push({ field: 'description', code: 'DESC_REQUIRED', message: 'Description is required', severity: 'error' });
      return;
    }
    if (desc.trim().length < this.MIN_DESCRIPTION_LENGTH) {
      errors.push({ field: 'description', code: 'DESC_TOO_SHORT', message: `Description must be at least ${this.MIN_DESCRIPTION_LENGTH} characters`, severity: 'error' });
    }
  }

  private validateAcceptanceCriteria(ac: string, errors: ValidationErrorDto[], warnings: ValidationErrorDto[]): void {
    if (!ac?.trim()) {
      errors.push({ field: 'acceptance_criteria', code: 'AC_REQUIRED', message: 'Acceptance criteria are required', severity: 'error' });
      return;
    }
    if (ac.trim().length < this.MIN_AC_LENGTH) {
      errors.push({ field: 'acceptance_criteria', code: 'AC_TOO_SHORT', message: `Acceptance criteria must be at least ${this.MIN_AC_LENGTH} characters`, severity: 'error' });
    }
    if (!ac.toLowerCase().includes('given') || !ac.toLowerCase().includes('then')) {
      warnings.push({ field: 'acceptance_criteria', code: 'AC_NOT_BDD', message: 'Use Given/When/Then format for clarity', severity: 'warning' });
    }
  }

  private validateProjectId(projectId: string, errors: ValidationErrorDto[], warnings: ValidationErrorDto[]): void {
    if (!projectId?.trim()) {
      errors.push({ field: 'project_id', code: 'PROJECT_REQUIRED', message: 'Project ID is required', severity: 'error' });
    }
  }

  formatErrorsForComment(result: ValidationResultDto): string {
    const lines = ['❌ **Ticket Validation Failed**\n'];
    result.errors.forEach((e, i) => lines.push(`${i + 1}. **${e.field}**: ${e.message}`));
    if (result.warnings.length) {
      lines.push('\n**Suggestions:**');
      result.warnings.forEach(w => lines.push(`- ${w.message}`));
    }
    lines.push('\nPlease update the ticket and it will be re-validated.');
    return lines.join('\n');
  }
}
```

---

## Step 4: Create Quality Scoring Service

**File:** `src/ticket-intake/ticket-quality.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { IParsedTicket } from './interfaces';
import { QualityScoreDto, QualityScoreBreakdownDto } from './dto';

@Injectable()
export class TicketQualityService {
  private readonly logger = new Logger(TicketQualityService.name);

  calculateScore(ticket: IParsedTicket, correlationId: string): QualityScoreDto {
    const breakdown = new QualityScoreBreakdownDto();
    const suggestions: string[] = [];

    breakdown.titleClarity = this.scoreTitleClarity(ticket.title, suggestions);
    breakdown.descriptionCompleteness = this.scoreDescription(ticket.description, suggestions);
    breakdown.acceptanceCriteria = this.scoreAcceptanceCriteria(ticket.acceptanceCriteria, suggestions);
    breakdown.contextDocuments = this.scoreContextDocuments(ticket.description, suggestions);
    breakdown.taskComplexity = this.scoreComplexity(ticket, suggestions);
    breakdown.prerequisites = this.scorePrerequisites(ticket.description, suggestions);

    const totalScore = Object.values(breakdown).reduce((sum, val) => sum + val, 0);
    const grade = totalScore >= 90 ? 'excellent' : totalScore >= 70 ? 'good' : totalScore >= 50 ? 'fair' : 'poor';

    this.logger.log(`[${correlationId}] Quality score: ${totalScore}/100 (${grade})`);
    return { totalScore, breakdown, grade, suggestions };
  }

  private scoreTitleClarity(title: string, suggestions: string[]): number {
    let score = title ? 5 : 0;
    if (title?.length >= 10 && title.length <= 50) score += 5;
    if (/\b(add|create|implement|fix|update|remove|refactor)\b/i.test(title)) score += 5;
    else suggestions.push('Start title with an action verb');
    return Math.min(score, 15);
  }

  private scoreDescription(desc: string, suggestions: string[]): number {
    if (!desc) return 0;
    let score = 5;
    if (desc.length >= 200) score += 8;
    else if (desc.length >= 100) score += 5;
    else suggestions.push('Add more detail to description (100+ chars)');
    if (desc.includes('\n') || desc.includes('- ')) score += 6;
    if (/\b(because|so that|in order to)\b/i.test(desc)) score += 6;
    else suggestions.push('Explain WHY this feature is needed');
    return Math.min(score, 25);
  }

  private scoreAcceptanceCriteria(ac: string, suggestions: string[]): number {
    if (!ac) return 0;
    let score = 5;
    const lines = ac.split('\n').filter(l => l.trim());
    if (lines.length >= 5) score += 8;
    else if (lines.length >= 3) score += 5;
    else suggestions.push('Add more acceptance criteria (3-5 points)');
    const hasGWT = /given/i.test(ac) && /when/i.test(ac) && /then/i.test(ac);
    if (hasGWT) score += 12;
    else suggestions.push('Use Given/When/Then format');
    if (/\b(should|must|verify|ensure)\b/i.test(ac)) score += 5;
    return Math.min(score, 30);
  }

  private scoreContextDocuments(desc: string, suggestions: string[]): number {
    let score = 0;
    if (/https?:\/\//.test(desc)) score += 5;
    if (/\.(pdf|md|doc)/i.test(desc) || /architecture|design doc/i.test(desc)) score += 5;
    if (score < 5) suggestions.push('Attach relevant context documents');
    return Math.min(score, 10);
  }

  private scoreComplexity(ticket: IParsedTicket, suggestions: string[]): number {
    let score = 0;
    if (ticket.tags?.length) score += 5;
    else suggestions.push('Add tags (feature, bugfix, refactor)');
    if (ticket.priority) score += 3;
    if (/src\/|\.ts\b/.test(ticket.description)) score += 2;
    return Math.min(score, 10);
  }

  private scorePrerequisites(desc: string, suggestions: string[]): number {
    let score = 0;
    if (/prerequisite|depends on|blocked by|requires/i.test(desc)) score += 5;
    if (/story\s+\d|#\d+/i.test(desc)) score += 5;
    if (score < 5) suggestions.push('List prerequisites or dependencies');
    return Math.min(score, 10);
  }
}
```

---

## Step 5: Create Main Ticket Intake Service

**File:** `src/ticket-intake/ticket-intake.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { TicketStatus } from '@prisma/client';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { TicketValidatorService } from './ticket-validator.service';
import { TicketQualityService } from './ticket-quality.service';
import { IRawTaskEvent, IParsedTicket } from './interfaces';
import { ValidationResultDto, QualityScoreDto } from './dto';

@Injectable()
export class TicketIntakeService {
  private readonly logger = new Logger(TicketIntakeService.name);
  private readonly clickupApiUrl: string;
  private readonly clickupApiKey: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQPublisher: RabbitMQPublisherService,
    private readonly configService: ConfigService,
    private readonly validator: TicketValidatorService,
    private readonly qualityService: TicketQualityService,
    @InjectMetric('ticket_intake_total') private readonly intakeCounter: Counter<string>,
    @InjectMetric('ticket_intake_duration_seconds') private readonly durationHistogram: Histogram<string>,
    @InjectMetric('ticket_validation_total') private readonly validationCounter: Counter<string>,
    @InjectMetric('ticket_quality_score') private readonly qualityHistogram: Histogram<string>,
  ) {
    this.clickupApiUrl = this.configService.get<string>('clickup.apiUrl') || 'https://api.clickup.com/api/v2';
    this.clickupApiKey = this.configService.get<string>('clickup.apiKey') || '';
  }

  async processTaskEvent(event: IRawTaskEvent): Promise<{
    success: boolean;
    ticketId?: string;
    status: TicketStatus;
    qualityScore?: number;
    errors?: string[];
  }> {
    const endTimer = this.durationHistogram.startTimer();
    const correlationId = event.correlationId;
    this.logger.log(`[${correlationId}] Processing: ${event.taskId} (${event.eventType})`);
    this.intakeCounter.inc({ event_type: event.eventType });

    try {
      // For taskUpdated: only re-validate if previously failed
      if (event.eventType === 'taskUpdated') {
        const existing = await this.prisma.ticket.findUnique({
          where: { clickup_task_id: event.taskId },
          select: { status: true },
        });
        if (existing && existing.status !== TicketStatus.VALIDATION_FAILED) {
          this.logger.debug(`[${correlationId}] Skipping update - ticket not in VALIDATION_FAILED state`);
          return { success: true, status: existing.status };
        }
      }

      const parsed = this.parseTaskEvent(event);
      const validation = await this.validator.validate(parsed, correlationId);

      this.validationCounter.inc({ result: validation.isValid ? 'success' : 'failure' });

      if (!validation.isValid) {
        return await this.handleValidationFailure(parsed, validation, correlationId);
      }

      const qualityScore = this.qualityService.calculateScore(parsed, correlationId);
      this.qualityHistogram.observe({ grade: qualityScore.grade }, qualityScore.totalScore);

      const ticket = await this.createOrUpdateTicket(parsed, qualityScore, correlationId);
      await this.routeToAIProcessing(ticket.id, parsed, qualityScore, correlationId);

      return { success: true, ticketId: ticket.id, status: TicketStatus.VALIDATED, qualityScore: qualityScore.totalScore };
    } catch (error) {
      this.logger.error(`[${correlationId}] Error: ${error.message}`, error.stack);
      this.intakeCounter.inc({ event_type: event.eventType, status: 'error' });
      throw error;
    } finally {
      endTimer();
    }
  }

  private parseTaskEvent(event: IRawTaskEvent): IParsedTicket {
    return {
      clickupTaskId: event.taskId,
      projectId: event.customFields?.['project_id']?.toString() || event.projectId || event.listId || '',
      title: event.taskName,
      description: event.taskDescription || '',
      acceptanceCriteria: this.extractAcceptanceCriteria(event.taskDescription || ''),
      tags: event.tags || [],
      priority: null,
      creatorEmail: event.creatorEmail,
      taskUrl: event.taskUrl,
      rawEvent: event,
    };
  }

  private extractAcceptanceCriteria(description: string): string {
    const patterns = [
      /acceptance\s*criteria[:\s]*\n?([\s\S]*?)(?=\n##|\n\*\*[A-Z]|$)/i,
      /given[\s\S]*?then[\s\S]*?(?=\n##|$)/i,
    ];
    for (const pattern of patterns) {
      const match = description.match(pattern);
      if (match?.[1]?.trim()) return match[1].trim();
      if (match?.[0]?.trim()) return match[0].trim();
    }
    return '';
  }

  private async handleValidationFailure(ticket: IParsedTicket, validation: ValidationResultDto, correlationId: string) {
    this.logger.warn(`[${correlationId}] Validation failed for ${ticket.clickupTaskId}`);

    await this.prisma.ticket.upsert({
      where: { clickup_task_id: ticket.clickupTaskId },
      create: {
        clickup_task_id: ticket.clickupTaskId,
        project_id: ticket.projectId || 'unknown',
        title: ticket.title || 'Untitled',
        description: ticket.description || '',
        acceptance_criteria: ticket.acceptanceCriteria || '',
        ticket_quality_score: 0,
        status: TicketStatus.VALIDATION_FAILED,
      },
      update: { status: TicketStatus.VALIDATION_FAILED, updated_at: new Date() },
    });

    await this.commentOnClickUpTask(ticket.clickupTaskId, this.validator.formatErrorsForComment(validation), correlationId);
    await this.logAudit(ticket.clickupTaskId, 'validation_failed', { errors: validation.errors }, correlationId);

    return { success: false, status: TicketStatus.VALIDATION_FAILED, errors: validation.errors.map(e => e.message) };
  }

  private async createOrUpdateTicket(parsed: IParsedTicket, qualityScore: QualityScoreDto, correlationId: string) {
    const ticket = await this.prisma.ticket.upsert({
      where: { clickup_task_id: parsed.clickupTaskId },
      create: {
        clickup_task_id: parsed.clickupTaskId,
        project_id: parsed.projectId,
        title: parsed.title,
        description: parsed.description,
        acceptance_criteria: parsed.acceptanceCriteria,
        ticket_quality_score: qualityScore.totalScore,
        status: TicketStatus.VALIDATED,
      },
      update: {
        title: parsed.title,
        description: parsed.description,
        acceptance_criteria: parsed.acceptanceCriteria,
        ticket_quality_score: qualityScore.totalScore,
        status: TicketStatus.VALIDATED,
        updated_at: new Date(),
      },
    });

    await this.logAudit(parsed.clickupTaskId, 'ticket_validated', { ticketId: ticket.id, qualityScore: qualityScore.totalScore }, correlationId);
    return ticket;
  }

  private async routeToAIProcessing(ticketId: string, parsed: IParsedTicket, qualityScore: QualityScoreDto, correlationId: string) {
    await this.rabbitMQPublisher.publishToQueue(
      QUEUE_NAMES.AI_ROUTING,
      {
        ticketId,
        clickupTaskId: parsed.clickupTaskId,
        projectId: parsed.projectId,
        title: parsed.title,
        description: parsed.description,
        acceptanceCriteria: parsed.acceptanceCriteria,
        tags: parsed.tags,
        qualityScore: qualityScore.totalScore,
        qualityGrade: qualityScore.grade,
        timestamp: new Date().toISOString(),
      },
      correlationId,
    );
    this.logger.debug(`[${correlationId}] Routed ${ticketId} to ${QUEUE_NAMES.AI_ROUTING}`);
  }

  private async commentOnClickUpTask(taskId: string, comment: string, correlationId: string): Promise<void> {
    if (!this.clickupApiKey) {
      this.logger.warn(`[${correlationId}] ClickUp API key not configured`);
      return;
    }
    try {
      const response = await fetch(`${this.clickupApiUrl}/task/${taskId}/comment`, {
        method: 'POST',
        headers: { Authorization: this.clickupApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment_text: comment, notify_all: true }),
      });
      if (!response.ok) this.logger.error(`[${correlationId}] ClickUp comment failed: ${response.status}`);
    } catch (error) {
      this.logger.error(`[${correlationId}] ClickUp API error: ${error.message}`);
    }
  }

  private async logAudit(entityId: string, action: string, data: Record<string, unknown>, correlationId: string) {
    try {
      await this.prisma.auditLog.create({
        data: {
          entity_type: 'ticket',
          entity_id: entityId,
          action,
          actor_type: 'system',
          actor_id: null,
          after_state: { ...data, correlationId, timestamp: new Date().toISOString() },
        },
      });
    } catch (error) {
      this.logger.error(`[${correlationId}] Audit log failed: ${error.message}`);
    }
  }
}
```

---

## Step 6: Create RabbitMQ Consumer (CORRECT PATTERN)

**File:** `src/ticket-intake/ticket-intake.consumer.ts`

```typescript
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RabbitMQConsumerBase } from '../rabbitmq/rabbitmq-consumer.base';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { TicketIntakeService } from './ticket-intake.service';
import { IRawTaskEvent } from './interfaces';

@Injectable()
export class TicketIntakeConsumer extends RabbitMQConsumerBase implements OnModuleInit {
  protected readonly logger = new Logger(TicketIntakeConsumer.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly ticketIntakeService: TicketIntakeService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.startConsuming();
  }

  async startConsuming(): Promise<void> {
    this.logger.log(`Starting consumer for ${QUEUE_NAMES.TICKET_INTAKE}`);

    try {
      const channel = this.rabbitMQService.getChannel();

      // Ensure queue exists
      await channel.assertQueue(QUEUE_NAMES.TICKET_INTAKE, { durable: true });

      // Set prefetch for controlled concurrency
      await channel.prefetch(5);

      // Start consuming
      await channel.consume(
        QUEUE_NAMES.TICKET_INTAKE,
        (message: amqp.ConsumeMessage | null) => {
          if (message) {
            this.handleMessage(message, channel);
          }
        },
        { noAck: false },
      );

      this.logger.log(`Consumer started for ${QUEUE_NAMES.TICKET_INTAKE}`);
    } catch (error) {
      this.logger.error(`Failed to start consumer: ${error.message}`);
    }
  }

  protected async processMessage(payload: unknown, correlationId: string): Promise<void> {
    const event = payload as IRawTaskEvent;

    this.logger.debug(`[${correlationId}] Processing message for task ${event.taskId}`);

    const result = await this.ticketIntakeService.processTaskEvent({
      ...event,
      correlationId,
    });

    this.logger.log(
      `[${correlationId}] Processed ${event.taskId}: success=${result.success}, status=${result.status}`,
    );

    if (!result.success && result.errors) {
      this.logger.warn(`[${correlationId}] Validation errors: ${result.errors.join(', ')}`);
    }
  }
}
```

---

## Step 7: Update Module

**File:** `src/ticket-intake/ticket-intake.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { makeCounterProvider, makeHistogramProvider } from '@willsoto/nestjs-prometheus';
import { TicketIntakeService } from './ticket-intake.service';
import { TicketValidatorService } from './ticket-validator.service';
import { TicketQualityService } from './ticket-quality.service';
import { TicketIntakeConsumer } from './ticket-intake.consumer';
import { DatabaseModule } from '../database/database.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';

@Module({
  imports: [ConfigModule, DatabaseModule, RabbitMQModule],
  providers: [
    TicketIntakeService,
    TicketValidatorService,
    TicketQualityService,
    TicketIntakeConsumer,
    makeCounterProvider({ name: 'ticket_intake_total', help: 'Total tickets processed', labelNames: ['event_type', 'status'] }),
    makeCounterProvider({ name: 'ticket_validation_total', help: 'Validation results', labelNames: ['result'] }),
    makeHistogramProvider({ name: 'ticket_intake_duration_seconds', help: 'Processing duration', buckets: [0.1, 0.5, 1, 2.5, 5, 10] }),
    makeHistogramProvider({ name: 'ticket_quality_score', help: 'Quality score distribution', labelNames: ['grade'], buckets: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] }),
  ],
  exports: [TicketIntakeService, TicketValidatorService, TicketQualityService],
})
export class TicketIntakeModule {}
```

---

## Step 8: Unit Tests

**File:** `src/ticket-intake/ticket-validator.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { TicketValidatorService } from './ticket-validator.service';
import { IParsedTicket } from './interfaces';

describe('TicketValidatorService', () => {
  let service: TicketValidatorService;

  const validTicket: IParsedTicket = {
    clickupTaskId: 'task-123',
    projectId: 'proj-456',
    title: 'Implement user authentication flow',
    description: 'Create login and registration endpoints with JWT tokens for secure authentication',
    acceptanceCriteria: 'Given a user submits valid credentials\nWhen the API processes the request\nThen a JWT token is returned',
    tags: ['feature'],
    priority: 'high',
    creatorEmail: 'test@test.com',
    taskUrl: 'https://app.clickup.com/t/task-123',
    rawEvent: {} as any,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TicketValidatorService],
    }).compile();
    service = module.get<TicketValidatorService>(TicketValidatorService);
  });

  it('should pass validation for valid ticket', async () => {
    const result = await service.validate(validTicket, 'test-corr');
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail validation for empty title', async () => {
    const result = await service.validate({ ...validTicket, title: '' }, 'test-corr');
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.code === 'TITLE_REQUIRED')).toBe(true);
  });

  it('should fail validation for short title', async () => {
    const result = await service.validate({ ...validTicket, title: 'Fix bug' }, 'test-corr');
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.code === 'TITLE_TOO_SHORT')).toBe(true);
  });

  it('should fail validation for missing acceptance criteria', async () => {
    const result = await service.validate({ ...validTicket, acceptanceCriteria: '' }, 'test-corr');
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.code === 'AC_REQUIRED')).toBe(true);
  });

  it('should add warning for non-BDD acceptance criteria', async () => {
    const result = await service.validate({ ...validTicket, acceptanceCriteria: 'User can login successfully' }, 'test-corr');
    expect(result.warnings.some(w => w.code === 'AC_NOT_BDD')).toBe(true);
  });
});
```

**File:** `src/ticket-intake/ticket-quality.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { TicketQualityService } from './ticket-quality.service';
import { IParsedTicket } from './interfaces';

describe('TicketQualityService', () => {
  let service: TicketQualityService;

  const excellentTicket: IParsedTicket = {
    clickupTaskId: 'task-123',
    projectId: 'proj-456',
    title: 'Implement user authentication flow',
    description: 'Create login and registration endpoints because we need secure user management so that users can access protected resources. This requires changes to src/auth/ module.',
    acceptanceCriteria: 'Given a user submits valid credentials\nWhen the API processes the login request\nThen a JWT token is returned\nAnd the token should expire after 1 hour\nAnd invalid credentials should return 401',
    tags: ['feature', 'authentication'],
    priority: 'high',
    creatorEmail: 'test@test.com',
    taskUrl: 'https://app.clickup.com/t/task-123',
    rawEvent: {} as any,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TicketQualityService],
    }).compile();
    service = module.get<TicketQualityService>(TicketQualityService);
  });

  it('should score excellent ticket above 70', () => {
    const result = service.calculateScore(excellentTicket, 'test-corr');
    expect(result.totalScore).toBeGreaterThanOrEqual(70);
    expect(['excellent', 'good']).toContain(result.grade);
  });

  it('should score poor ticket below 50', () => {
    const poorTicket = { ...excellentTicket, title: 'Fix', description: 'Bug', acceptanceCriteria: 'Works', tags: [] };
    const result = service.calculateScore(poorTicket, 'test-corr');
    expect(result.totalScore).toBeLessThan(50);
    expect(result.grade).toBe('poor');
  });

  it('should provide suggestions for improvements', () => {
    const result = service.calculateScore({ ...excellentTicket, tags: [] }, 'test-corr');
    expect(result.suggestions.length).toBeGreaterThan(0);
  });
});
```

---

## Validation Checklist

**RabbitMQ Infrastructure:**
- [ ] `TICKET_INTAKE` and `AI_ROUTING` added to `QUEUE_NAMES`
- [ ] Queues created in `setupQueuesAndExchanges()`
- [ ] Consumer extends `RabbitMQConsumerBase`
- [ ] Uses `RabbitMQPublisherService` (not `RabbitMQService`) for publishing

**Configuration:**
- [ ] `clickup.apiUrl` added to configuration.ts

**Ticket Parsing:**
- [ ] Extracts clickup_task_id, project_id, title, description
- [ ] Extracts acceptance criteria via regex patterns
- [ ] Handles taskUpdated differently from taskCreated

**Validation:**
- [ ] Title min 10 chars
- [ ] Description min 50 chars
- [ ] Acceptance criteria required
- [ ] Project ID required
- [ ] Validation failures → VALIDATION_FAILED status
- [ ] ClickUp comment posted on failure

**Quality Scoring:**
- [ ] 0-100 score calculated
- [ ] Grade assigned (excellent/good/fair/poor)
- [ ] Suggestions generated

**Database:**
- [ ] Ticket upsert with VALIDATED status
- [ ] Audit log entries created

**Prometheus Metrics:**
- [ ] ticket_intake_total
- [ ] ticket_validation_total
- [ ] ticket_intake_duration_seconds
- [ ] ticket_quality_score

**Tests:**
- [ ] Unit tests for validator service
- [ ] Unit tests for quality service

---

## Prerequisites

- ✅ Story 2.1 Complete - Webhook publishing to ticket-intake-queue
- ✅ Story 1.3 Complete - PostgreSQL/Prisma
- ✅ Story 1.5 Complete - RabbitMQ

---

## References

| Document | Section | Content |
|----------|---------|---------|
| `docs/architecture.md` | Lines 110-115 | ticket-intake module structure |
| `docs/epics.md` | Lines 829-873 | Story 2.2 acceptance criteria |
| `docs/prd.md` | FR57-58 | Parse & validate requirements |
| `prisma/schema.prisma` | Lines 18-54 | Ticket model, TicketStatus enum |

---

**Document prepared by:** Bob (Scrum Master)  
**Preparation date:** 2025-12-01  
**Quality Review:** ✅ VALIDATED - All critical issues addressed

---

## Dev Agent Record

### File List

**Files Created:**
| File | Purpose |
|------|---------|
| `src/ticket-intake/interfaces/ticket-intake.interface.ts` | IRawTaskEvent, IParsedTicket, IValidationError, IQualityScore interfaces |
| `src/ticket-intake/interfaces/index.ts` | Barrel export |
| `src/ticket-intake/dto/parsed-ticket.dto.ts` | ParsedTicketDto with Swagger decorators |
| `src/ticket-intake/dto/validation-result.dto.ts` | ValidationResultDto, QualityScoreDto |
| `src/ticket-intake/dto/index.ts` | Barrel export |
| `src/ticket-intake/ticket-validator.service.ts` | Title/Desc/AC/Project validation with error formatting |
| `src/ticket-intake/ticket-quality.service.ts` | 0-100 quality scoring (6 categories) |
| `src/ticket-intake/ticket-intake.service.ts` | Main orchestration: parse, validate, score, route |
| `src/ticket-intake/ticket-intake.consumer.ts` | RabbitMQ queue consumer |
| `src/ticket-intake/ticket-validator.service.spec.ts` | 11 unit tests |
| `src/ticket-intake/ticket-quality.service.spec.ts` | 9 unit tests |
| `src/ticket-intake/ticket-intake.service.spec.ts` | 8 unit tests |

**Files Modified:**
| File | Changes |
|------|---------|
| `src/rabbitmq/rabbitmq.config.ts` | Added TICKET_INTAKE and AI_ROUTING queue names |
| `src/rabbitmq/rabbitmq.service.ts` | Added queues to setupQueuesAndExchanges() |
| `src/config/configuration.ts` | Added clickup.apiUrl |
| `src/ticket-intake/ticket-intake.module.ts` | Complete module with providers and Prometheus metrics |

### Change Log

**2025-12-02 - Implementation Complete**
- Implemented ticket parsing from webhook queue events
- Added validation rules: title ≥10 chars, description ≥50 chars, AC ≥20 chars, project required
- Implemented quality scoring (0-100) with 6 categories and grade assignment
- Added ClickUp API commenting for validation failures
- Created queue consumer extending RabbitMQConsumerBase
- Registered Prometheus metrics: intake_total, validation_total, duration, quality_score
- Unit tests: 28 total (11 validator + 9 quality + 8 intake service)

**2025-12-02 - Code Review Fixes**
- Added TICKET_INTAKE and AI_ROUTING queues to setupQueuesAndExchanges()
- Created unit tests for TicketIntakeService
- Added Dev Agent Record section

### Completion Notes

**Story Status:** review
**Implementation Completeness:** ✅ ALL ACCEPTANCE CRITERIA MET
**Test Coverage:** ✅ Unit tests: 28 total
**Code Quality:** ✅ Lint and build passing

**Validation Checklist Status:**
- ✅ `TICKET_INTAKE` and `AI_ROUTING` in QUEUE_NAMES
- ✅ Queues created in setupQueuesAndExchanges()
- ✅ Consumer extends RabbitMQConsumerBase
- ✅ Uses RabbitMQPublisherService for publishing
- ✅ clickup.apiUrl in configuration.ts
- ✅ Ticket parsing (clickup_task_id, project_id, title, description, AC)
- ✅ Validation (title, desc, AC, project)
- ✅ Quality scoring (0-100, grades, suggestions)
- ✅ Database upsert with VALIDATED/VALIDATION_FAILED status
- ✅ Audit logging
- ✅ Prometheus metrics

---

**Implementation by:** Antigravity (Dev Agent)
**Implementation date:** 2025-12-02
