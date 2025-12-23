# Story 2.3: AI Tool Selection & Routing Logic (Multi-Provider)

**Epic:** 2 - Ticket Intake & AI Routing Engine  
**Status:** ready-for-dev  
**Priority:** P0 - CRITICAL  
**Effort:** 13 story points  
**ClickUp ID:** `86evnjwa3`  
**ClickUp URL:** https://app.clickup.com/t/86evnjwa3

---

## Story

As the system,
I want to intelligently route tickets to the most appropriate AI tool,
So that each task complexity level is handled by the optimal AI provider.

---

## Acceptance Criteria

**Given** a validated ticket exists in the `ai-routing-queue`  
**When** the routing engine analyzes the ticket  
**Then** the system selects an AI provider based on:
- **Task complexity assessment:**
  - Files to modify count (1 file vs 3+ files)
  - Architecture changes required (yes/no)
  - Cross-file dependencies (low/medium/high)
  - Estimated lines of code (<100 vs >100)
  - Ticket tags (architecture, refactor, complex, simple, bugfix)
- **Provider availability** (health check status)
- **Cost optimization** (prefer Claude Code for simple tasks)
- **Fallback readiness** (if primary fails, use secondary)

**And** routing rules are:
- **High complexity (score ≥10)** → Cursor CLI Headless (full repo context)
- **Low/Medium complexity (score <10)** → Claude Code (faster, cheaper)
- **If primary unavailable** → Automatic fallback to secondary provider

**And** routing decision is logged with:
- Justification (complexity score breakdown)
- Selected provider (CURSOR_HEADLESS | CLAUDE_CODE)
- Routing reason (complexity, availability, cost)
- Timestamp of routing decision

**And** ticket status is updated to `QUEUED`

**And** if no provider is available:
- Ticket remains in `VALIDATED` status
- Retry scheduled after 5 minutes
- Alert sent to operators if downtime > 15 minutes

---

## Tasks/Subtasks

### Phase 1: Database Schema & Infrastructure
- [ ] Update AIProvider enum in Prisma schema (CURSOR_HEADLESS, CLAUDE_CODE)
- [ ] Add routing decision fields to Execution model (complexity_score, complexity_breakdown, routing_reason, fallback_used, original_provider)
- [ ] Run `npx prisma migrate dev --name update_ai_provider_enum`
- [ ] Run `npx prisma generate` to regenerate TypeScript types
- [ ] Verify AI_ROUTING queue exists in rabbitmq.config.ts (or add if missing from Story 2.2)
- [ ] Add ai-routing-queue to setupQueuesAndExchanges() in rabbitmq.service.ts

### Phase 2: Configuration & Interfaces  
- [ ] Add AI provider configuration to src/config/configuration.ts
- [ ] Add environment variable validation to src/config/env.validation.ts
- [ ] Create src/ai-routing/interfaces/ai-routing.interface.ts
- [ ] Create src/ai-routing/interfaces/index.ts barrel export
- [ ] Create src/ai-routing/dto/routing-request.dto.ts
- [ ] Create src/ai-routing/dto/routing-decision.dto.ts
- [ ] Create src/ai-routing/dto/index.ts barrel export

### Phase 3: Core Services
- [ ] Create src/ai-routing/complexity-scorer.service.ts with scoring algorithm
- [ ] Create src/ai-routing/provider-health.service.ts with health monitoring
- [ ] Create src/ai-routing/ai-routing.service.ts with main routing logic
- [ ] Create src/ai-routing/ai-routing.consumer.ts extending RabbitMQConsumerBase

### Phase 4: Module Setup & Metrics
- [ ] Update src/ai-routing/ai-routing.module.ts with all providers
- [ ] Configure Prometheus metrics (ai_routing_total, ai_routing_duration_seconds, ai_complexity_score, ai_provider_health, ai_provider_active_executions, ai_provider_availability_total)
- [ ] Import DatabaseModule and RabbitmqModule
- [ ] Export services for use by other modules

### Phase 5: Testing
- [ ] Write unit tests for ProviderHealthService (src/ai-routing/provider-health.service.spec.ts)
- [ ] Write unit tests for ComplexityScorerService (src/ai-routing/complexity-scorer.service.spec.ts)
- [ ] Write unit tests for AIRoutingService (src/ai-routing/ai-routing.service.spec.ts)
- [ ] Write integration tests for AIRoutingConsumer (src/ai-routing/ai-routing.consumer.spec.ts)
- [ ] Run `pnpm test` and ensure all tests pass
- [ ] Run `pnpm test:e2e` if applicable

### Phase 6: Validation & Documentation
- [ ] Complete validation checklist (database, RabbitMQ, configuration, complexity scoring, routing logic, provider health, ticket status, retry logic, Prometheus metrics, audit logging)
- [ ] Update .env.example with AI provider environment variables
- [ ] Verify all acceptance criteria are met
- [ ] Update File List section with all created/modified files
- [ ] Add completion notes to Dev Agent Record
- [ ] Update sprint-status.yaml to 'review'

---

## Quick Implementation Summary (TL;DR)

**Step 0: Install Dependencies**
```bash
pnpm add @willsoto/nestjs-prometheus prom-client
```

**11 Key Files in Implementation Order:**
1. `prisma/schema.prisma` - **MODIFY**: Update AIProvider enum + run migrate + generate
2. `src/rabbitmq/rabbitmq.config.ts` - **MODIFY**: Add AI_ROUTING queue
3. `src/rabbitmq/rabbitmq.service.ts` - **MODIFY**: Setup ai-routing-queue
4. `src/ai-routing/interfaces/ai-routing.interface.ts` - Create interfaces
5. `src/ai-routing/dto/*.ts` - Create DTOs
6. `src/ai-routing/complexity-scorer.service.ts` - Complexity scoring algorithm
7. `src/ai-routing/provider-health.service.ts` - Provider health checks
8. `src/ai-routing/ai-routing.service.ts` - Main routing logic
9. `src/ai-routing/ai-routing.consumer.ts` - Queue consumer
10. `src/ai-routing/ai-routing.module.ts` - Wire everything

**Required Dependencies:**
```bash
pnpm add @willsoto/nestjs-prometheus prom-client
```

---

## Technical Requirements

### Quick Reference: Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `prisma/schema.prisma` | **MODIFY** | Update AIProvider enum to CURSOR_HEADLESS, CLAUDE_CODE |
| `src/rabbitmq/rabbitmq.config.ts` | **MODIFY** | Add AI_ROUTING queue name |
| `src/rabbitmq/rabbitmq.service.ts` | **MODIFY** | Setup ai-routing-queue in onModuleInit |
| `src/config/configuration.ts` | **MODIFY** | Add AI provider configuration |
| `src/ai-routing/ai-routing.module.ts` | **MODIFY** | Add providers, imports |
| `src/ai-routing/ai-routing.service.ts` | CREATE | Main routing logic |
| `src/ai-routing/complexity-scorer.service.ts` | CREATE | Complexity scoring |
| `src/ai-routing/provider-health.service.ts` | CREATE | Provider availability |
| `src/ai-routing/ai-routing.consumer.ts` | CREATE | RabbitMQ consumer |
| `src/ai-routing/dto/routing-request.dto.ts` | CREATE | DTOs |
| `src/ai-routing/dto/routing-decision.dto.ts` | CREATE | DTOs |
| `src/ai-routing/dto/index.ts` | CREATE | DTO barrel |
| `src/ai-routing/interfaces/ai-routing.interface.ts` | CREATE | Interfaces |
| `src/ai-routing/interfaces/index.ts` | CREATE | Interface barrel |
| `src/ai-routing/provider-health.service.spec.ts` | CREATE | Health service tests |
| `src/ai-routing/complexity-scorer.service.spec.ts` | CREATE | Complexity tests |
| `src/ai-routing/ai-routing.service.spec.ts` | CREATE | Routing service tests |
| `src/ai-routing/ai-routing.consumer.spec.ts` | CREATE | Consumer tests |

---

## Step 0: Update Database Schema (CRITICAL)

### 0.1 Update AIProvider Enum

**File:** `prisma/schema.prisma` - **UPDATE** the AIProvider enum:

```prisma
// OLD:
enum AIProvider {
  CURSOR
  WINDSURF
  ANTIGRAVITY
}

// NEW - Per architecture Multi-Provider Strategy:
enum AIProvider {
  CURSOR_HEADLESS    // Primary: Full repo context, complex tasks
  CLAUDE_CODE        // Secondary: Faster, cheaper, simple tasks
}
```

**Run migration and regenerate client:**
```bash
npx prisma migrate dev --name update_ai_provider_enum
npx prisma generate  # CRITICAL: Regenerate TypeScript types
```

### 0.2 Add Routing Decision Fields to Execution

**File:** `prisma/schema.prisma` - **ADD** to Execution model:

```prisma
model Execution {
  // ... existing fields ...
  
  // ADD: Routing decision metadata
  complexity_score    Int?              // 0-20 score
  complexity_breakdown Json?            // Score breakdown by factor
  routing_reason      String?           // Why this provider was selected
  fallback_used       Boolean           @default(false)
  original_provider   AIProvider?       // If fallback, what was original choice
}
```

---

## Step 1: Update RabbitMQ Infrastructure

> **Note:** Story 2.2 already adds `TICKET_INTAKE` and `AI_ROUTING` to `QUEUE_NAMES`. 
> Verify these exist before adding. Skip Step 1.1 if Story 2.2 is complete.

### 1.1 Add Queue Name (If Not Already Added by Story 2.2)

**File:** `src/rabbitmq/rabbitmq.config.ts` - **VERIFY or ADD** to QUEUE_NAMES:

```typescript
export const QUEUE_NAMES = {
  // Existing queues
  AI_EXECUTION: 'ai-execution-queue',
  QA_CHECK: 'qa-check-queue',
  DEPLOYMENT: 'deployment-queue',
  MONITORING: 'monitoring-queue',
  DEAD_LETTER: 'dead-letter-queue',
  // ADD (from Story 2.2)
  TICKET_INTAKE: 'ticket-intake-queue',
  AI_ROUTING: 'ai-routing-queue',  // This story consumes from here
} as const;

// ADD routing keys
export const ROUTING_KEYS = {
  // ... existing keys ...
  // ADD for AI Routing
  AI_ROUTING_STARTED: 'ai.routing.started',
  AI_ROUTING_COMPLETED: 'ai.routing.completed',
  AI_ROUTING_NO_PROVIDER: 'ai.routing.no_provider',
} as const;
```

### 1.2 Setup Queue in RabbitMQ Service

**File:** `src/rabbitmq/rabbitmq.service.ts` - **UPDATE** `setupQueuesAndExchanges()`:

```typescript
private async setupQueuesAndExchanges(): Promise<void> {
  if (!this.channel) return;

  // ... existing DLX setup ...

  // ADD ai-routing-queue to the list
  const queues = [
    QUEUE_NAMES.AI_EXECUTION,
    QUEUE_NAMES.QA_CHECK,
    QUEUE_NAMES.DEPLOYMENT,
    QUEUE_NAMES.MONITORING,
    QUEUE_NAMES.TICKET_INTAKE,
    QUEUE_NAMES.AI_ROUTING,  // ADD
  ];

  // ... rest of setup ...
}
```

---

## Step 2: Add AI Provider Configuration

**File:** `src/config/configuration.ts` - **ADD** ai section:

```typescript
export default () => ({
  // ... existing config ...
  
  ai: {
    providers: {
      cursorHeadless: {
        enabled: process.env.CURSOR_HEADLESS_ENABLED === 'true',
        healthCheckUrl: process.env.CURSOR_HEADLESS_HEALTH_URL || '',
        timeout: parseInt(process.env.CURSOR_HEADLESS_TIMEOUT || '300000', 10), // 5 min
        maxConcurrent: parseInt(process.env.CURSOR_MAX_CONCURRENT || '3', 10),
      },
      claudeCode: {
        enabled: process.env.CLAUDE_CODE_ENABLED === 'true',
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        healthCheckUrl: 'https://api.anthropic.com/v1/messages', // Anthropic API status
        timeout: parseInt(process.env.CLAUDE_CODE_TIMEOUT || '180000', 10), // 3 min
        maxConcurrent: parseInt(process.env.CLAUDE_MAX_CONCURRENT || '5', 10),
      },
    },
    routing: {
      complexityThreshold: parseInt(process.env.AI_COMPLEXITY_THRESHOLD || '10', 10),
      retryDelayMinutes: parseInt(process.env.AI_RETRY_DELAY_MINUTES || '5', 10),
      alertThresholdMinutes: parseInt(process.env.AI_ALERT_THRESHOLD_MINUTES || '15', 10),
    },
  },
});
```

**File:** `src/config/env.validation.ts` - **ADD** AI environment variables:

```typescript
// ADD to the Joi schema
CURSOR_HEADLESS_ENABLED: Joi.boolean().default(false),
CURSOR_HEADLESS_HEALTH_URL: Joi.string().optional(),
CURSOR_HEADLESS_TIMEOUT: Joi.number().default(300000),
CURSOR_MAX_CONCURRENT: Joi.number().default(3),
CLAUDE_CODE_ENABLED: Joi.boolean().default(false),
ANTHROPIC_API_KEY: Joi.string().when('CLAUDE_CODE_ENABLED', {
  is: true,
  then: Joi.required(),
  otherwise: Joi.optional(),
}),
CLAUDE_CODE_TIMEOUT: Joi.number().default(180000),
CLAUDE_MAX_CONCURRENT: Joi.number().default(5),
AI_COMPLEXITY_THRESHOLD: Joi.number().default(10),
AI_RETRY_DELAY_MINUTES: Joi.number().default(5),
AI_ALERT_THRESHOLD_MINUTES: Joi.number().default(15),
```

---

## Step 3: Create Interfaces

**File:** `src/ai-routing/interfaces/ai-routing.interface.ts`

```typescript
/**
 * AI Routing Interfaces
 * FR60: System routes to appropriate AI tool based on task complexity
 * Architecture Reference: Multi-Provider AI Strategy
 */

import { AIProvider, TicketStatus } from '@prisma/client';

/**
 * Routing request from ticket-intake (matches Story 2.2 output)
 */
export interface IRoutingRequest {
  correlationId: string;
  ticketId: string;
  clickupTaskId: string;
  projectId: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  tags: string[];
  qualityScore: number;
  qualityGrade: 'excellent' | 'good' | 'fair' | 'poor';
  timestamp: string;
}

/**
 * Complexity score breakdown
 * Per architecture: Files, architecture changes, dependencies, LOC estimate, tags
 */
export interface IComplexityBreakdown {
  /** Files to modify count: 0-4 points (1 file=1, 2 files=2, 3+ files=4) */
  fileCount: number;
  fileCountScore: number;
  
  /** Architecture changes: 0-4 points (no=0, yes=4) */
  architectureChanges: boolean;
  architectureScore: number;
  
  /** Cross-file dependencies: 0-4 points (low=1, medium=2, high=4) */
  dependencyLevel: 'low' | 'medium' | 'high';
  dependencyScore: number;
  
  /** Estimated LOC: 0-4 points (<50=1, 50-100=2, 100-200=3, >200=4) */
  estimatedLoc: number;
  locScore: number;
  
  /** Tags-based: 0-4 points (complex/architecture/refactor=4, simple/bugfix=1) */
  tagComplexity: 'simple' | 'medium' | 'complex';
  tagScore: number;
  
  /** Total complexity score (sum of above) */
  totalScore: number;
}

/**
 * Routing decision result
 */
export interface IRoutingDecision {
  correlationId: string;
  ticketId: string;
  selectedProvider: AIProvider;
  complexityScore: number;
  complexityBreakdown: IComplexityBreakdown;
  routingReason: RoutingReason;
  fallbackUsed: boolean;
  originalProvider?: AIProvider;
  decisionTimestamp: Date;
}

/**
 * Why a provider was selected
 */
export enum RoutingReason {
  COMPLEXITY_HIGH = 'complexity_high',           // Score >= threshold → Cursor
  COMPLEXITY_LOW = 'complexity_low',             // Score < threshold → Claude Code
  COST_OPTIMIZATION = 'cost_optimization',       // Cheaper provider for simple task
  PRIMARY_UNAVAILABLE = 'primary_unavailable',   // Fallback to secondary
  EXPLICIT_OVERRIDE = 'explicit_override',       // Manual override via tag
}

/**
 * Provider health status
 */
export interface IProviderHealth {
  provider: AIProvider;
  isHealthy: boolean;
  lastChecked: Date;
  currentLoad: number;        // 0-100%
  maxConcurrent: number;
  activeExecutions: number;
  responseTimeMs?: number;
  errorMessage?: string;
}

/**
 * Routing result to pass to next queue (ai-execution)
 */
export interface IRoutingResult {
  correlationId: string;
  ticketId: string;
  clickupTaskId: string;
  provider: AIProvider;
  complexityScore: number;
  complexityBreakdown: IComplexityBreakdown;
  routingReason: RoutingReason;
  title: string;
  description: string;
  acceptanceCriteria: string;
  projectId: string;
  tags: string[];
  routedAt: string;
}
```

**File:** `src/ai-routing/interfaces/index.ts`

```typescript
export * from './ai-routing.interface';
```

---

## Step 4: Create DTOs

**File:** `src/ai-routing/dto/routing-request.dto.ts`

```typescript
import { IsString, IsNotEmpty, IsArray, IsNumber, IsIn, Min, Max } from 'class-validator';

export class RoutingRequestDto {
  @IsString() @IsNotEmpty()
  correlationId: string;

  @IsString() @IsNotEmpty()
  ticketId: string;

  @IsString() @IsNotEmpty()
  clickupTaskId: string;

  @IsString() @IsNotEmpty()
  projectId: string;

  @IsString() @IsNotEmpty()
  title: string;

  @IsString()
  description: string;

  @IsString()
  acceptanceCriteria: string;

  @IsArray() @IsString({ each: true })
  tags: string[];

  @IsNumber() @Min(0) @Max(100)
  qualityScore: number;

  @IsIn(['excellent', 'good', 'fair', 'poor'])
  qualityGrade: 'excellent' | 'good' | 'fair' | 'poor';

  @IsString()
  timestamp: string;
}
```

**File:** `src/ai-routing/dto/routing-decision.dto.ts`

```typescript
import { AIProvider } from '@prisma/client';
import { RoutingReason, IComplexityBreakdown } from '../interfaces';

export class ComplexityBreakdownDto implements IComplexityBreakdown {
  fileCount: number;
  fileCountScore: number;
  architectureChanges: boolean;
  architectureScore: number;
  dependencyLevel: 'low' | 'medium' | 'high';
  dependencyScore: number;
  estimatedLoc: number;
  locScore: number;
  tagComplexity: 'simple' | 'medium' | 'complex';
  tagScore: number;
  totalScore: number;
}

export class RoutingDecisionDto {
  correlationId: string;
  ticketId: string;
  selectedProvider: AIProvider;
  complexityScore: number;
  complexityBreakdown: ComplexityBreakdownDto;
  routingReason: RoutingReason;
  fallbackUsed: boolean;
  originalProvider?: AIProvider;
  decisionTimestamp: Date;
}

export class RoutingResultDto {
  correlationId: string;
  ticketId: string;
  clickupTaskId: string;
  provider: AIProvider;
  complexityScore: number;
  complexityBreakdown: ComplexityBreakdownDto;
  routingReason: RoutingReason;
  title: string;
  description: string;
  acceptanceCriteria: string;
  projectId: string;
  tags: string[];
  routedAt: string;
}
```

**File:** `src/ai-routing/dto/index.ts`

```typescript
export * from './routing-request.dto';
export * from './routing-decision.dto';
```

---

## Step 5: Create Complexity Scorer Service

**File:** `src/ai-routing/complexity-scorer.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { IComplexityBreakdown, IRoutingRequest } from './interfaces';

/**
 * Complexity Scoring Algorithm
 * 
 * Per architecture.md Multi-Provider Strategy:
 * - Score 0-20 based on 5 factors (0-4 each)
 * - Score >= 10: High complexity → Cursor CLI Headless
 * - Score < 10: Low/Medium → Claude Code
 * 
 * FR60: System routes to appropriate AI tool based on task complexity
 */
@Injectable()
export class ComplexityScorerService {
  private readonly logger = new Logger(ComplexityScorerService.name);

  // Keywords that indicate complexity levels
  private readonly COMPLEX_KEYWORDS = [
    'refactor', 'architecture', 'redesign', 'migration', 'complex',
    'multi-file', 'cross-module', 'integration', 'database schema',
    'api design', 'performance optimization', 'security audit',
  ];

  private readonly SIMPLE_KEYWORDS = [
    'bugfix', 'fix', 'typo', 'simple', 'minor', 'quick',
    'add comment', 'update text', 'rename', 'format',
  ];

  private readonly ARCHITECTURE_KEYWORDS = [
    'architecture', 'database', 'schema', 'migration', 'api',
    'module', 'service', 'provider', 'factory', 'pattern',
    'restructure', 'redesign', 'new module', 'new service',
  ];

  /**
   * Calculate complexity score for a ticket
   * Returns breakdown with 0-20 total score
   */
  calculateComplexity(request: IRoutingRequest, correlationId: string): IComplexityBreakdown {
    this.logger.debug(`[${correlationId}] Calculating complexity for ticket ${request.ticketId}`);

    const content = `${request.title} ${request.description} ${request.acceptanceCriteria}`.toLowerCase();
    const tags = request.tags.map(t => t.toLowerCase());

    // 1. File count estimation (0-4 points)
    const fileCount = this.estimateFileCount(content);
    const fileCountScore = this.scoreFileCount(fileCount);

    // 2. Architecture changes (0-4 points)
    const architectureChanges = this.detectArchitectureChanges(content, tags);
    const architectureScore = architectureChanges ? 4 : 0;

    // 3. Cross-file dependencies (0-4 points)
    const dependencyLevel = this.assessDependencies(content, tags);
    const dependencyScore = this.scoreDependency(dependencyLevel);

    // 4. Estimated LOC (0-4 points)
    const estimatedLoc = this.estimateLinesOfCode(content, request.acceptanceCriteria);
    const locScore = this.scoreEstimatedLoc(estimatedLoc);

    // 5. Tag-based complexity (0-4 points)
    const tagComplexity = this.assessTagComplexity(content, tags);
    const tagScore = this.scoreTagComplexity(tagComplexity);

    const totalScore = fileCountScore + architectureScore + dependencyScore + locScore + tagScore;

    const breakdown: IComplexityBreakdown = {
      fileCount,
      fileCountScore,
      architectureChanges,
      architectureScore,
      dependencyLevel,
      dependencyScore,
      estimatedLoc,
      locScore,
      tagComplexity,
      tagScore,
      totalScore,
    };

    this.logger.log(
      `[${correlationId}] Complexity score: ${totalScore}/20 ` +
      `(files=${fileCountScore}, arch=${architectureScore}, deps=${dependencyScore}, ` +
      `loc=${locScore}, tags=${tagScore})`,
    );

    return breakdown;
  }

  /**
   * Estimate number of files to modify
   */
  private estimateFileCount(content: string): number {
    // Look for file path patterns
    const filePatterns = content.match(/\b[\w-]+\.(ts|js|tsx|jsx|py|java|go|rs)\b/gi) || [];
    const uniqueFiles = [...new Set(filePatterns)];

    // Look for "files" mentions
    const multiFileMatch = content.match(/(\d+)\s*(files?|components?|modules?|services?)/i);
    if (multiFileMatch) {
      return Math.max(parseInt(multiFileMatch[1], 10), uniqueFiles.length);
    }

    // Keywords suggesting multiple files
    if (/multiple files|several files|across files|various files/i.test(content)) {
      return Math.max(3, uniqueFiles.length);
    }

    if (/single file|one file|only file/i.test(content)) {
      return 1;
    }

    // Default based on content length and complexity indicators
    if (uniqueFiles.length > 0) return uniqueFiles.length;
    if (content.length > 1000) return 2;
    return 1;
  }

  private scoreFileCount(count: number): number {
    if (count <= 1) return 1;
    if (count === 2) return 2;
    if (count >= 3) return 4;
    return 2;
  }

  /**
   * Detect if architecture changes are required
   */
  private detectArchitectureChanges(content: string, tags: string[]): boolean {
    // Check tags first (most reliable)
    if (tags.some(t => ['architecture', 'design', 'schema', 'migration'].includes(t))) {
      return true;
    }

    // Check content for architecture keywords
    return this.ARCHITECTURE_KEYWORDS.some(keyword => content.includes(keyword));
  }

  /**
   * Assess cross-file dependency level
   */
  private assessDependencies(content: string, tags: string[]): 'low' | 'medium' | 'high' {
    // High dependency indicators
    if (
      tags.includes('integration') ||
      /cross-module|multiple services|api changes|database changes|shared state/i.test(content)
    ) {
      return 'high';
    }

    // Medium dependency indicators
    if (
      /import from|depends on|requires|updates? interface|changes? contract/i.test(content) ||
      /affects? other|impacts? other/i.test(content)
    ) {
      return 'medium';
    }

    return 'low';
  }

  private scoreDependency(level: 'low' | 'medium' | 'high'): number {
    switch (level) {
      case 'low': return 1;
      case 'medium': return 2;
      case 'high': return 4;
    }
  }

  /**
   * Estimate lines of code to change
   */
  private estimateLinesOfCode(content: string, acceptanceCriteria: string): number {
    // Count acceptance criteria points (rough estimate: 20 LOC per AC point)
    const acPoints = (acceptanceCriteria.match(/^[-*•]\s/gm) || []).length;
    const acEstimate = acPoints * 20;

    // Look for explicit LOC mentions
    const locMatch = content.match(/(\d+)\s*(lines?|loc)\b/i);
    if (locMatch) {
      return parseInt(locMatch[1], 10);
    }

    // Keywords suggesting large changes
    if (/large|extensive|major|significant/i.test(content)) {
      return Math.max(200, acEstimate);
    }

    if (/small|minor|quick|simple/i.test(content)) {
      return Math.min(50, acEstimate || 30);
    }

    // Default based on AC points
    if (acEstimate > 0) return acEstimate;
    
    // Fallback based on description length
    return content.length > 500 ? 100 : 50;
  }

  private scoreEstimatedLoc(loc: number): number {
    if (loc < 50) return 1;
    if (loc < 100) return 2;
    if (loc < 200) return 3;
    return 4;
  }

  /**
   * Assess complexity from content and tags
   */
  private assessTagComplexity(content: string, tags: string[]): 'simple' | 'medium' | 'complex' {
    // Check tags first
    if (tags.some(t => ['complex', 'architecture', 'refactor', 'migration'].includes(t))) {
      return 'complex';
    }
    if (tags.some(t => ['simple', 'bugfix', 'minor', 'quick'].includes(t))) {
      return 'simple';
    }

    // Check content keywords
    const hasComplexKeywords = this.COMPLEX_KEYWORDS.some(kw => content.includes(kw));
    const hasSimpleKeywords = this.SIMPLE_KEYWORDS.some(kw => content.includes(kw));

    if (hasComplexKeywords && !hasSimpleKeywords) return 'complex';
    if (hasSimpleKeywords && !hasComplexKeywords) return 'simple';

    return 'medium';
  }

  private scoreTagComplexity(complexity: 'simple' | 'medium' | 'complex'): number {
    switch (complexity) {
      case 'simple': return 1;
      case 'medium': return 2;
      case 'complex': return 4;
    }
  }
}
```

---

## Step 6: Create Provider Health Service

**File:** `src/ai-routing/provider-health.service.ts`

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { IProviderHealth } from './interfaces';
import { Counter, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';

/**
 * Provider Health Monitoring Service
 * 
 * Tracks availability and load of AI providers:
 * - Cursor CLI Headless (primary)
 * - Claude Code (secondary)
 * 
 * Per architecture: Auto-fallback when primary unavailable
 */
@Injectable()
export class ProviderHealthService implements OnModuleInit {
  private readonly logger = new Logger(ProviderHealthService.name);
  
  // In-memory health cache (updated periodically)
  private healthStatus: Map<AIProvider, IProviderHealth> = new Map();
  private healthCheckInterval: NodeJS.Timer;
  
  // Track unavailability duration for alerts
  private unavailableSince: Map<AIProvider, Date> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @InjectMetric('ai_provider_health')
    private readonly healthGauge: Gauge<string>,
    @InjectMetric('ai_provider_active_executions')
    private readonly activeExecutionsGauge: Gauge<string>,
    @InjectMetric('ai_provider_availability_total')
    private readonly availabilityCounter: Counter<string>,
  ) {}

  async onModuleInit(): Promise<void> {
    // Initialize health status for all providers
    await this.checkAllProviders();
    
    // Start periodic health checks (every 30 seconds)
    this.healthCheckInterval = setInterval(
      () => this.checkAllProviders(),
      30000,
    );
    
    this.logger.log('Provider health monitoring initialized');
  }

  /**
   * Get health status for a specific provider
   */
  async getProviderHealth(provider: AIProvider): Promise<IProviderHealth> {
    const cached = this.healthStatus.get(provider);
    
    // If cache is stale (>1 min), refresh
    if (!cached || Date.now() - cached.lastChecked.getTime() > 60000) {
      return this.checkProvider(provider);
    }
    
    return cached;
  }

  /**
   * Get first available provider in priority order
   * Per architecture: Cursor Headless → Claude Code
   */
  async getAvailableProvider(
    preferredProvider?: AIProvider,
  ): Promise<{ provider: AIProvider; health: IProviderHealth } | null> {
    // Priority order
    const providers: AIProvider[] = preferredProvider
      ? [preferredProvider, ...Object.values(AIProvider).filter(p => p !== preferredProvider)]
      : [AIProvider.CURSOR_HEADLESS, AIProvider.CLAUDE_CODE];

    for (const provider of providers) {
      const health = await this.getProviderHealth(provider);
      
      if (health.isHealthy && health.currentLoad < 90) {
        return { provider, health };
      }
    }

    return null;
  }

  /**
   * Check if any provider has been unavailable too long (for alerting)
   */
  getUnavailableDuration(provider: AIProvider): number | null {
    const since = this.unavailableSince.get(provider);
    if (!since) return null;
    return (Date.now() - since.getTime()) / 60000; // Minutes
  }

  /**
   * Check all providers health
   */
  private async checkAllProviders(): Promise<void> {
    for (const provider of Object.values(AIProvider)) {
      await this.checkProvider(provider);
    }
  }

  /**
   * Check single provider health
   */
  private async checkProvider(provider: AIProvider): Promise<IProviderHealth> {
    const config = this.getProviderConfig(provider);
    
    const health: IProviderHealth = {
      provider,
      isHealthy: false,
      lastChecked: new Date(),
      currentLoad: 0,
      maxConcurrent: config.maxConcurrent,
      activeExecutions: 0,
    };

    try {
      // Check if provider is enabled
      if (!config.enabled) {
        health.errorMessage = 'Provider disabled in configuration';
        this.updateHealthStatus(health);
        return health;
      }

      // Check API availability (provider-specific)
      const apiHealthy = await this.checkProviderApi(provider, config);
      
      if (!apiHealthy) {
        health.errorMessage = 'API health check failed';
        this.updateHealthStatus(health);
        return health;
      }

      // Get active execution count from database
      const activeCount = await this.prisma.execution.count({
        where: {
          ai_provider: provider,
          status: { in: ['QUEUED', 'IN_PROGRESS'] },
        },
      });

      health.activeExecutions = activeCount;
      health.currentLoad = (activeCount / config.maxConcurrent) * 100;
      health.isHealthy = activeCount < config.maxConcurrent;

      // Clear unavailable tracking if now healthy
      if (health.isHealthy) {
        this.unavailableSince.delete(provider);
      }

    } catch (error) {
      this.logger.error(`Health check failed for ${provider}: ${error.message}`);
      health.errorMessage = error.message;
    }

    this.updateHealthStatus(health);
    return health;
  }

  /**
   * Provider-specific API health check
   */
  private async checkProviderApi(
    provider: AIProvider,
    config: { healthCheckUrl?: string; apiKey?: string },
  ): Promise<boolean> {
    // Skip if no health check URL configured
    if (!config.healthCheckUrl) {
      // Assume healthy if enabled but no health check
      return true;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const headers: Record<string, string> = {};
      
      // Add auth for Anthropic API
      if (provider === AIProvider.CLAUDE_CODE && config.apiKey) {
        headers['x-api-key'] = config.apiKey;
        headers['anthropic-version'] = '2023-06-01';
      }

      const response = await fetch(config.healthCheckUrl, {
        method: 'HEAD',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      
      // 200-399 considered healthy (some APIs return 400 for HEAD)
      return response.status < 500;
    } catch (error) {
      this.logger.warn(`API check failed for ${provider}: ${error.message}`);
      return false;
    }
  }

  /**
   * Get provider configuration
   */
  private getProviderConfig(provider: AIProvider): {
    enabled: boolean;
    healthCheckUrl?: string;
    apiKey?: string;
    maxConcurrent: number;
    timeout: number;
  } {
    switch (provider) {
      case AIProvider.CURSOR_HEADLESS:
        return {
          enabled: this.configService.get<boolean>('ai.providers.cursorHeadless.enabled', false),
          healthCheckUrl: this.configService.get<string>('ai.providers.cursorHeadless.healthCheckUrl'),
          maxConcurrent: this.configService.get<number>('ai.providers.cursorHeadless.maxConcurrent', 3),
          timeout: this.configService.get<number>('ai.providers.cursorHeadless.timeout', 300000),
        };
      case AIProvider.CLAUDE_CODE:
        return {
          enabled: this.configService.get<boolean>('ai.providers.claudeCode.enabled', false),
          healthCheckUrl: this.configService.get<string>('ai.providers.claudeCode.healthCheckUrl'),
          apiKey: this.configService.get<string>('ai.providers.claudeCode.apiKey'),
          maxConcurrent: this.configService.get<number>('ai.providers.claudeCode.maxConcurrent', 5),
          timeout: this.configService.get<number>('ai.providers.claudeCode.timeout', 180000),
        };
      default:
        return { enabled: false, maxConcurrent: 1, timeout: 60000 };
    }
  }

  /**
   * Update health status cache and metrics
   */
  private updateHealthStatus(health: IProviderHealth): void {
    const previous = this.healthStatus.get(health.provider);
    this.healthStatus.set(health.provider, health);

    // Update Prometheus metrics
    this.healthGauge.set(
      { provider: health.provider },
      health.isHealthy ? 1 : 0,
    );
    this.activeExecutionsGauge.set(
      { provider: health.provider },
      health.activeExecutions,
    );

    // Track availability transitions
    if (previous?.isHealthy !== health.isHealthy) {
      this.availabilityCounter.inc({
        provider: health.provider,
        status: health.isHealthy ? 'available' : 'unavailable',
      });

      // Track when provider became unavailable
      if (!health.isHealthy && !this.unavailableSince.has(health.provider)) {
        this.unavailableSince.set(health.provider, new Date());
        this.logger.warn(`Provider ${health.provider} became unavailable`);
      }
    }
  }
}
```

---

## Step 7: Create Main AI Routing Service

**File:** `src/ai-routing/ai-routing.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider, TicketStatus, ExecutionStatus } from '@prisma/client';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { QUEUE_NAMES, ROUTING_KEYS, EXCHANGE_NAMES } from '../rabbitmq/rabbitmq.config';
import { ComplexityScorerService } from './complexity-scorer.service';
import { ProviderHealthService } from './provider-health.service';
import {
  IRoutingRequest,
  IRoutingDecision,
  IRoutingResult,
  RoutingReason,
  IComplexityBreakdown,
} from './interfaces';

/**
 * AI Routing Service
 * 
 * Per architecture.md Multi-Provider Strategy:
 * - Route based on complexity score
 * - High complexity (≥10) → Cursor CLI Headless
 * - Low complexity (<10) → Claude Code
 * - Auto-fallback if primary unavailable
 * 
 * FR60: System routes to appropriate AI tool based on task complexity
 */
@Injectable()
export class AIRoutingService {
  private readonly logger = new Logger(AIRoutingService.name);
  private readonly complexityThreshold: number;
  private readonly retryDelayMs: number;
  private readonly alertThresholdMinutes: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly rabbitMQPublisher: RabbitMQPublisherService,
    private readonly complexityScorer: ComplexityScorerService,
    private readonly providerHealth: ProviderHealthService,
    @InjectMetric('ai_routing_total')
    private readonly routingCounter: Counter<string>,
    @InjectMetric('ai_routing_duration_seconds')
    private readonly routingDuration: Histogram<string>,
    @InjectMetric('ai_complexity_score')
    private readonly complexityHistogram: Histogram<string>,
  ) {
    this.complexityThreshold = this.configService.get<number>('ai.routing.complexityThreshold', 10);
    this.retryDelayMs = this.configService.get<number>('ai.routing.retryDelayMinutes', 5) * 60 * 1000;
    this.alertThresholdMinutes = this.configService.get<number>('ai.routing.alertThresholdMinutes', 15);
  }

  /**
   * Route a ticket to the appropriate AI provider
   */
  async routeTicket(request: IRoutingRequest): Promise<IRoutingDecision> {
    const correlationId = request.correlationId;
    const endTimer = this.routingDuration.startTimer();

    this.logger.log(`[${correlationId}] Routing ticket ${request.ticketId}`);

    try {
      // 1. Calculate complexity score
      const complexityBreakdown = this.complexityScorer.calculateComplexity(request, correlationId);
      this.complexityHistogram.observe(
        { grade: this.getComplexityGrade(complexityBreakdown.totalScore) },
        complexityBreakdown.totalScore,
      );

      // 2. Determine preferred provider based on complexity
      const preferredProvider = this.selectProviderByComplexity(complexityBreakdown.totalScore);
      this.logger.debug(
        `[${correlationId}] Complexity ${complexityBreakdown.totalScore} → preferred ${preferredProvider}`,
      );

      // 3. Check provider availability with fallback
      const available = await this.providerHealth.getAvailableProvider(preferredProvider);

      // 4. Handle no provider available
      if (!available) {
        return await this.handleNoProviderAvailable(request, complexityBreakdown, correlationId);
      }

      // 5. Build routing decision
      const decision: IRoutingDecision = {
        correlationId,
        ticketId: request.ticketId,
        selectedProvider: available.provider,
        complexityScore: complexityBreakdown.totalScore,
        complexityBreakdown,
        routingReason: this.determineRoutingReason(
          preferredProvider,
          available.provider,
          complexityBreakdown.totalScore,
        ),
        fallbackUsed: available.provider !== preferredProvider,
        originalProvider: available.provider !== preferredProvider ? preferredProvider : undefined,
        decisionTimestamp: new Date(),
      };

      // 6. Create execution record
      await this.createExecutionRecord(request, decision);

      // 7. Update ticket status to QUEUED
      await this.updateTicketStatus(request.ticketId, TicketStatus.QUEUED, correlationId);

      // 8. Publish to AI execution queue
      await this.publishToExecutionQueue(request, decision);

      // 9. Log audit trail
      await this.logRoutingDecision(decision);

      // 10. Update metrics
      this.routingCounter.inc({
        provider: decision.selectedProvider,
        reason: decision.routingReason,
        fallback: String(decision.fallbackUsed),
      });

      this.logger.log(
        `[${correlationId}] Routed to ${decision.selectedProvider} ` +
        `(reason: ${decision.routingReason}, fallback: ${decision.fallbackUsed})`,
      );

      return decision;
    } finally {
      endTimer();
    }
  }

  /**
   * Select provider based on complexity score
   */
  private selectProviderByComplexity(score: number): AIProvider {
    // Per architecture: >= threshold → Cursor, < threshold → Claude Code
    return score >= this.complexityThreshold
      ? AIProvider.CURSOR_HEADLESS
      : AIProvider.CLAUDE_CODE;
  }

  /**
   * Determine routing reason
   */
  private determineRoutingReason(
    preferred: AIProvider,
    selected: AIProvider,
    complexityScore: number,
  ): RoutingReason {
    if (preferred !== selected) {
      return RoutingReason.PRIMARY_UNAVAILABLE;
    }

    if (complexityScore >= this.complexityThreshold) {
      return RoutingReason.COMPLEXITY_HIGH;
    }

    return RoutingReason.COMPLEXITY_LOW;
  }

  /**
   * Handle scenario when no provider is available
   */
  private async handleNoProviderAvailable(
    request: IRoutingRequest,
    complexityBreakdown: IComplexityBreakdown,
    correlationId: string,
  ): Promise<IRoutingDecision> {
    this.logger.warn(`[${correlationId}] No AI provider available for ticket ${request.ticketId}`);

    // Check if we should alert (any provider unavailable > threshold)
    for (const provider of Object.values(AIProvider)) {
      const unavailableMinutes = this.providerHealth.getUnavailableDuration(provider);
      if (unavailableMinutes && unavailableMinutes >= this.alertThresholdMinutes) {
        await this.sendOperatorAlert(provider, unavailableMinutes, correlationId);
      }
    }

    // Schedule retry
    await this.scheduleRetry(request, correlationId);

    // Emit event for monitoring
    await this.rabbitMQPublisher.publishToExchange(
      EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
      ROUTING_KEYS.AI_ROUTING_NO_PROVIDER,
      {
        correlationId,
        ticketId: request.ticketId,
        complexityScore: complexityBreakdown.totalScore,
        retryScheduledAt: new Date(Date.now() + this.retryDelayMs).toISOString(),
      },
      correlationId,
    );

    // Return decision with null provider (ticket stays in VALIDATED status)
    return {
      correlationId,
      ticketId: request.ticketId,
      selectedProvider: null as any, // Will be set on retry
      complexityScore: complexityBreakdown.totalScore,
      complexityBreakdown,
      routingReason: RoutingReason.PRIMARY_UNAVAILABLE,
      fallbackUsed: false,
      decisionTimestamp: new Date(),
    };
  }

  /**
   * Schedule retry after delay
   * 
   * NOTE: This uses setTimeout which will be lost on server restart.
   * For production resilience, consider:
   * - RabbitMQ delayed message plugin (x-delayed-message exchange)
   * - Database-backed retry queue with scheduled job processor
   * - Bull/BullMQ with Redis for reliable delayed jobs
   */
  private async scheduleRetry(request: IRoutingRequest, correlationId: string): Promise<void> {
    // TODO: Replace with persistent retry mechanism for production
    setTimeout(async () => {
      this.logger.log(`[${correlationId}] Retrying routing for ticket ${request.ticketId}`);
      
      await this.rabbitMQPublisher.publishToQueue(
        QUEUE_NAMES.AI_ROUTING,
        {
          ...request,
          timestamp: new Date().toISOString(),
          isRetry: true,
        },
        correlationId,
      );
    }, this.retryDelayMs);

    this.logger.debug(
      `[${correlationId}] Retry scheduled in ${this.retryDelayMs / 60000} minutes`,
    );
  }

  /**
   * Send alert to operators
   */
  private async sendOperatorAlert(
    provider: AIProvider,
    unavailableMinutes: number,
    correlationId: string,
  ): Promise<void> {
    // TODO: Integrate with notification system (Slack, email, etc.)
    this.logger.error(
      `[${correlationId}] ALERT: Provider ${provider} unavailable for ${unavailableMinutes.toFixed(1)} minutes!`,
    );

    // Log to metrics for alerting systems
    this.routingCounter.inc({
      provider,
      reason: 'alert_triggered',
      fallback: 'false',
    });
  }

  /**
   * Create execution record in database
   */
  private async createExecutionRecord(
    request: IRoutingRequest,
    decision: IRoutingDecision,
  ): Promise<void> {
    await this.prisma.execution.create({
      data: {
        ticket_id: request.ticketId,
        ai_provider: decision.selectedProvider,
        prompt: '', // Will be set by prompt generation in next story
        status: ExecutionStatus.QUEUED,
        complexity_score: decision.complexityScore,
        complexity_breakdown: decision.complexityBreakdown as any,
        routing_reason: decision.routingReason,
        fallback_used: decision.fallbackUsed,
        original_provider: decision.originalProvider,
      },
    });
  }

  /**
   * Update ticket status
   */
  private async updateTicketStatus(
    ticketId: string,
    status: TicketStatus,
    correlationId: string,
  ): Promise<void> {
    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status, updated_at: new Date() },
    });

    this.logger.debug(`[${correlationId}] Ticket ${ticketId} status updated to ${status}`);
  }

  /**
   * Publish to AI execution queue for next story (2.4)
   */
  private async publishToExecutionQueue(
    request: IRoutingRequest,
    decision: IRoutingDecision,
  ): Promise<void> {
    const routingResult: IRoutingResult = {
      correlationId: request.correlationId,
      ticketId: request.ticketId,
      clickupTaskId: request.clickupTaskId,
      provider: decision.selectedProvider,
      complexityScore: decision.complexityScore,
      complexityBreakdown: decision.complexityBreakdown,
      routingReason: decision.routingReason,
      title: request.title,
      description: request.description,
      acceptanceCriteria: request.acceptanceCriteria,
      projectId: request.projectId,
      tags: request.tags,
      routedAt: new Date().toISOString(),
    };

    await this.rabbitMQPublisher.publishToQueue(
      QUEUE_NAMES.AI_EXECUTION,
      routingResult,
      request.correlationId,
    );
  }

  /**
   * Log routing decision to audit trail
   */
  private async logRoutingDecision(decision: IRoutingDecision): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        entity_type: 'ticket',
        entity_id: decision.ticketId,
        action: 'ai_routing_decision',
        actor_type: 'system',
        actor_id: null,
        after_state: {
          correlationId: decision.correlationId,
          selectedProvider: decision.selectedProvider,
          complexityScore: decision.complexityScore,
          routingReason: decision.routingReason,
          fallbackUsed: decision.fallbackUsed,
          originalProvider: decision.originalProvider,
          timestamp: decision.decisionTimestamp.toISOString(),
        },
      },
    });
  }

  /**
   * Get complexity grade label
   */
  private getComplexityGrade(score: number): string {
    if (score >= 16) return 'very_high';
    if (score >= 12) return 'high';
    if (score >= 8) return 'medium';
    if (score >= 4) return 'low';
    return 'very_low';
  }
}
```

---

## Step 8: Create RabbitMQ Consumer

**File:** `src/ai-routing/ai-routing.consumer.ts`

```typescript
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RabbitMQConsumerBase } from '../rabbitmq/rabbitmq-consumer.base';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { AIRoutingService } from './ai-routing.service';
import { IRoutingRequest } from './interfaces';

/**
 * AI Routing Queue Consumer
 * 
 * Consumes from: ai-routing-queue (published by Story 2.2)
 * Publishes to: ai-execution-queue (consumed by Story 2.4)
 */
@Injectable()
export class AIRoutingConsumer extends RabbitMQConsumerBase implements OnModuleInit {
  protected readonly logger = new Logger(AIRoutingConsumer.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly aiRoutingService: AIRoutingService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.startConsuming();
  }

  async startConsuming(): Promise<void> {
    this.logger.log(`Starting consumer for ${QUEUE_NAMES.AI_ROUTING}`);

    try {
      const channel = this.rabbitMQService.getChannel();

      // Ensure queue exists
      await channel.assertQueue(QUEUE_NAMES.AI_ROUTING, { durable: true });

      // Set prefetch for controlled concurrency (process 3 at a time)
      await channel.prefetch(3);

      // Start consuming
      await channel.consume(
        QUEUE_NAMES.AI_ROUTING,
        (message: amqp.ConsumeMessage | null) => {
          if (message) {
            this.handleMessage(message, channel);
          }
        },
        { noAck: false },
      );

      this.logger.log(`Consumer started for ${QUEUE_NAMES.AI_ROUTING}`);
    } catch (error) {
      this.logger.error(`Failed to start consumer: ${error.message}`);
    }
  }

  protected async processMessage(payload: unknown, correlationId: string): Promise<void> {
    const request = payload as IRoutingRequest;

    this.logger.debug(`[${correlationId}] Processing routing request for ticket ${request.ticketId}`);

    const decision = await this.aiRoutingService.routeTicket({
      ...request,
      correlationId,
    });

    this.logger.log(
      `[${correlationId}] Routing complete for ${request.ticketId}: ` +
      `provider=${decision.selectedProvider}, score=${decision.complexityScore}`,
    );
  }
}
```

---

## Step 9: Update Module

**File:** `src/ai-routing/ai-routing.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { makeCounterProvider, makeHistogramProvider, makeGaugeProvider } from '@willsoto/nestjs-prometheus';
import { AIRoutingService } from './ai-routing.service';
import { ComplexityScorerService } from './complexity-scorer.service';
import { ProviderHealthService } from './provider-health.service';
import { AIRoutingConsumer } from './ai-routing.consumer';
import { DatabaseModule } from '../database/database.module';
import { RabbitmqModule } from '../rabbitmq/rabbitmq.module';

/**
 * AI Routing Module
 * 
 * FR60: System routes to appropriate AI tool based on task complexity
 * 
 * Components:
 * - ComplexityScorerService: Calculate ticket complexity (0-20)
 * - ProviderHealthService: Track AI provider availability
 * - AIRoutingService: Main routing logic
 * - AIRoutingConsumer: Process routing queue
 */
@Module({
  imports: [ConfigModule, DatabaseModule, RabbitmqModule],
  providers: [
    AIRoutingService,
    ComplexityScorerService,
    ProviderHealthService,
    AIRoutingConsumer,
    // Prometheus metrics
    makeCounterProvider({
      name: 'ai_routing_total',
      help: 'Total AI routing decisions',
      labelNames: ['provider', 'reason', 'fallback'],
    }),
    makeHistogramProvider({
      name: 'ai_routing_duration_seconds',
      help: 'AI routing duration in seconds',
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    }),
    makeHistogramProvider({
      name: 'ai_complexity_score',
      help: 'Complexity score distribution',
      labelNames: ['grade'],
      buckets: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
    }),
    makeGaugeProvider({
      name: 'ai_provider_health',
      help: 'AI provider health status (1=healthy, 0=unhealthy)',
      labelNames: ['provider'],
    }),
    makeGaugeProvider({
      name: 'ai_provider_active_executions',
      help: 'Number of active executions per provider',
      labelNames: ['provider'],
    }),
    makeCounterProvider({
      name: 'ai_provider_availability_total',
      help: 'Provider availability transitions',
      labelNames: ['provider', 'status'],
    }),
  ],
  exports: [AIRoutingService, ComplexityScorerService, ProviderHealthService],
})
export class AiRoutingModule {}
```

---

## Step 10: Unit Tests

### 10.1 ProviderHealthService Tests

**File:** `src/ai-routing/provider-health.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@prisma/client';
import { ProviderHealthService } from './provider-health.service';
import { PrismaService } from '../database/prisma.service';

describe('ProviderHealthService', () => {
  let service: ProviderHealthService;

  const mockPrisma = {
    execution: {
      count: jest.fn(),
    },
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      const config: Record<string, any> = {
        'ai.providers.cursorHeadless.enabled': true,
        'ai.providers.cursorHeadless.maxConcurrent': 3,
        'ai.providers.cursorHeadless.timeout': 300000,
        'ai.providers.claudeCode.enabled': true,
        'ai.providers.claudeCode.maxConcurrent': 5,
        'ai.providers.claudeCode.timeout': 180000,
      };
      return config[key] ?? defaultValue;
    }),
  };

  const mockMetrics = {
    set: jest.fn(),
    inc: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProviderHealthService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: 'ai_provider_health', useValue: mockMetrics },
        { provide: 'ai_provider_active_executions', useValue: mockMetrics },
        { provide: 'ai_provider_availability_total', useValue: mockMetrics },
      ],
    }).compile();

    service = module.get<ProviderHealthService>(ProviderHealthService);
    jest.clearAllMocks();
  });

  describe('getProviderHealth', () => {
    it('should return healthy status when provider is enabled and under capacity', async () => {
      mockPrisma.execution.count.mockResolvedValue(1); // 1 active execution

      const health = await service.getProviderHealth(AIProvider.CURSOR_HEADLESS);

      expect(health.isHealthy).toBe(true);
      expect(health.activeExecutions).toBe(1);
      expect(health.maxConcurrent).toBe(3);
      expect(health.currentLoad).toBeLessThan(100);
    });

    it('should return unhealthy when at max capacity', async () => {
      mockPrisma.execution.count.mockResolvedValue(3); // At max concurrent

      const health = await service.getProviderHealth(AIProvider.CURSOR_HEADLESS);

      expect(health.isHealthy).toBe(false);
      expect(health.currentLoad).toBe(100);
    });

    it('should return unhealthy when provider disabled', async () => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'ai.providers.cursorHeadless.enabled') return false;
        return 3;
      });

      const health = await service.getProviderHealth(AIProvider.CURSOR_HEADLESS);

      expect(health.isHealthy).toBe(false);
      expect(health.errorMessage).toContain('disabled');
    });
  });

  describe('getAvailableProvider', () => {
    it('should return preferred provider when available', async () => {
      mockPrisma.execution.count.mockResolvedValue(1);

      const result = await service.getAvailableProvider(AIProvider.CURSOR_HEADLESS);

      expect(result).not.toBeNull();
      expect(result?.provider).toBe(AIProvider.CURSOR_HEADLESS);
    });

    it('should fallback to secondary when primary unavailable', async () => {
      // Cursor at capacity, Claude available
      mockPrisma.execution.count
        .mockResolvedValueOnce(3) // Cursor full
        .mockResolvedValueOnce(2); // Claude available

      const result = await service.getAvailableProvider(AIProvider.CURSOR_HEADLESS);

      expect(result?.provider).toBe(AIProvider.CLAUDE_CODE);
    });

    it('should return null when no provider available', async () => {
      mockPrisma.execution.count.mockResolvedValue(10); // All over capacity

      const result = await service.getAvailableProvider();

      expect(result).toBeNull();
    });
  });

  describe('getUnavailableDuration', () => {
    it('should return null for healthy provider', () => {
      const duration = service.getUnavailableDuration(AIProvider.CURSOR_HEADLESS);
      expect(duration).toBeNull();
    });
  });
});
```

### 10.2 ComplexityScorerService Tests

**File:** `src/ai-routing/complexity-scorer.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ComplexityScorerService } from './complexity-scorer.service';
import { IRoutingRequest } from './interfaces';

describe('ComplexityScorerService', () => {
  let service: ComplexityScorerService;

  const createRequest = (overrides: Partial<IRoutingRequest> = {}): IRoutingRequest => ({
    correlationId: 'test-corr',
    ticketId: 'ticket-123',
    clickupTaskId: 'task-456',
    projectId: 'proj-789',
    title: 'Test ticket',
    description: 'Test description',
    acceptanceCriteria: '- AC 1\n- AC 2\n- AC 3',
    tags: [],
    qualityScore: 80,
    qualityGrade: 'good',
    timestamp: new Date().toISOString(),
    ...overrides,
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ComplexityScorerService],
    }).compile();
    service = module.get<ComplexityScorerService>(ComplexityScorerService);
  });

  describe('calculateComplexity', () => {
    it('should score simple bugfix as low complexity', () => {
      const request = createRequest({
        title: 'Fix typo in header',
        description: 'Simple fix for typo',
        tags: ['bugfix', 'simple'],
      });

      const result = service.calculateComplexity(request, 'test-corr');

      expect(result.totalScore).toBeLessThan(10);
      expect(result.tagComplexity).toBe('simple');
    });

    it('should score architecture change as high complexity', () => {
      const request = createRequest({
        title: 'Refactor authentication module architecture',
        description: 'Redesign the authentication module with new service pattern. Affects multiple files and requires database schema migration.',
        tags: ['architecture', 'refactor'],
      });

      const result = service.calculateComplexity(request, 'test-corr');

      expect(result.totalScore).toBeGreaterThanOrEqual(10);
      expect(result.architectureChanges).toBe(true);
      expect(result.tagComplexity).toBe('complex');
    });

    it('should detect multiple files from description', () => {
      const request = createRequest({
        description: 'Update app.module.ts, auth.service.ts, and user.controller.ts',
      });

      const result = service.calculateComplexity(request, 'test-corr');

      expect(result.fileCount).toBeGreaterThanOrEqual(3);
      expect(result.fileCountScore).toBe(4);
    });

    it('should score high dependencies correctly', () => {
      const request = createRequest({
        description: 'Cross-module changes affecting multiple services with shared state',
        tags: ['integration'],
      });

      const result = service.calculateComplexity(request, 'test-corr');

      expect(result.dependencyLevel).toBe('high');
      expect(result.dependencyScore).toBe(4);
    });

    it('should calculate total score correctly', () => {
      const request = createRequest({
        title: 'Medium complexity task',
        description: 'Update auth.service.ts with new validation',
        acceptanceCriteria: '- AC 1\n- AC 2',
        tags: [],
      });

      const result = service.calculateComplexity(request, 'test-corr');

      const expectedTotal =
        result.fileCountScore +
        result.architectureScore +
        result.dependencyScore +
        result.locScore +
        result.tagScore;

      expect(result.totalScore).toBe(expectedTotal);
      expect(result.totalScore).toBeGreaterThanOrEqual(0);
      expect(result.totalScore).toBeLessThanOrEqual(20);
    });
  });
});
```

**File:** `src/ai-routing/ai-routing.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AIProvider, TicketStatus, ExecutionStatus } from '@prisma/client';
import { AIRoutingService } from './ai-routing.service';
import { ComplexityScorerService } from './complexity-scorer.service';
import { ProviderHealthService } from './provider-health.service';
import { PrismaService } from '../database/prisma.service';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { IRoutingRequest, RoutingReason } from './interfaces';

describe('AIRoutingService', () => {
  let service: AIRoutingService;
  let complexityScorer: ComplexityScorerService;
  let providerHealth: ProviderHealthService;
  let prisma: PrismaService;
  let rabbitMQ: RabbitMQPublisherService;

  const mockPrisma = {
    execution: { create: jest.fn() },
    ticket: { update: jest.fn() },
    auditLog: { create: jest.fn() },
  };

  const mockRabbitMQ = {
    publishToQueue: jest.fn().mockResolvedValue(true),
    publishToExchange: jest.fn().mockResolvedValue(true),
  };

  const mockProviderHealth = {
    getProviderHealth: jest.fn(),
    getAvailableProvider: jest.fn(),
    getUnavailableDuration: jest.fn().mockReturnValue(null),
  };

  const mockComplexityScorer = {
    calculateComplexity: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      const config: Record<string, any> = {
        'ai.routing.complexityThreshold': 10,
        'ai.routing.retryDelayMinutes': 5,
        'ai.routing.alertThresholdMinutes': 15,
      };
      return config[key] ?? defaultValue;
    }),
  };

  const createRequest = (): IRoutingRequest => ({
    correlationId: 'test-corr',
    ticketId: 'ticket-123',
    clickupTaskId: 'task-456',
    projectId: 'proj-789',
    title: 'Test ticket',
    description: 'Test description',
    acceptanceCriteria: '- AC 1',
    tags: [],
    qualityScore: 80,
    qualityGrade: 'good',
    timestamp: new Date().toISOString(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIRoutingService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RabbitMQPublisherService, useValue: mockRabbitMQ },
        { provide: ComplexityScorerService, useValue: mockComplexityScorer },
        { provide: ProviderHealthService, useValue: mockProviderHealth },
        // Mock Prometheus metrics
        { provide: 'ai_routing_total', useValue: { inc: jest.fn() } },
        { provide: 'ai_routing_duration_seconds', useValue: { startTimer: jest.fn(() => jest.fn()) } },
        { provide: 'ai_complexity_score', useValue: { observe: jest.fn() } },
      ],
    }).compile();

    service = module.get<AIRoutingService>(AIRoutingService);
    jest.clearAllMocks();
  });

  describe('routeTicket', () => {
    it('should route high complexity ticket to Cursor Headless', async () => {
      const request = createRequest();
      
      mockComplexityScorer.calculateComplexity.mockReturnValue({
        totalScore: 15,
        fileCountScore: 4,
        architectureScore: 4,
        dependencyScore: 4,
        locScore: 2,
        tagScore: 1,
      });

      mockProviderHealth.getAvailableProvider.mockResolvedValue({
        provider: AIProvider.CURSOR_HEADLESS,
        health: { isHealthy: true, currentLoad: 30 },
      });

      const result = await service.routeTicket(request);

      expect(result.selectedProvider).toBe(AIProvider.CURSOR_HEADLESS);
      expect(result.complexityScore).toBe(15);
      expect(result.routingReason).toBe(RoutingReason.COMPLEXITY_HIGH);
      expect(result.fallbackUsed).toBe(false);
    });

    it('should route low complexity ticket to Claude Code', async () => {
      const request = createRequest();
      
      mockComplexityScorer.calculateComplexity.mockReturnValue({
        totalScore: 5,
        fileCountScore: 1,
        architectureScore: 0,
        dependencyScore: 1,
        locScore: 1,
        tagScore: 2,
      });

      mockProviderHealth.getAvailableProvider.mockResolvedValue({
        provider: AIProvider.CLAUDE_CODE,
        health: { isHealthy: true, currentLoad: 20 },
      });

      const result = await service.routeTicket(request);

      expect(result.selectedProvider).toBe(AIProvider.CLAUDE_CODE);
      expect(result.complexityScore).toBe(5);
      expect(result.routingReason).toBe(RoutingReason.COMPLEXITY_LOW);
    });

    it('should use fallback when primary provider unavailable', async () => {
      const request = createRequest();
      
      mockComplexityScorer.calculateComplexity.mockReturnValue({
        totalScore: 15, // High complexity → prefers Cursor
      });

      // Cursor unavailable, fallback to Claude Code
      mockProviderHealth.getAvailableProvider.mockResolvedValue({
        provider: AIProvider.CLAUDE_CODE,
        health: { isHealthy: true, currentLoad: 40 },
      });

      const result = await service.routeTicket(request);

      expect(result.selectedProvider).toBe(AIProvider.CLAUDE_CODE);
      expect(result.fallbackUsed).toBe(true);
      expect(result.originalProvider).toBe(AIProvider.CURSOR_HEADLESS);
      expect(result.routingReason).toBe(RoutingReason.PRIMARY_UNAVAILABLE);
    });

    it('should update ticket status to QUEUED', async () => {
      const request = createRequest();
      
      mockComplexityScorer.calculateComplexity.mockReturnValue({ totalScore: 8 });
      mockProviderHealth.getAvailableProvider.mockResolvedValue({
        provider: AIProvider.CLAUDE_CODE,
        health: { isHealthy: true },
      });

      await service.routeTicket(request);

      expect(mockPrisma.ticket.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: request.ticketId },
          data: expect.objectContaining({ status: TicketStatus.QUEUED }),
        }),
      );
    });

    it('should publish to execution queue', async () => {
      const request = createRequest();
      
      mockComplexityScorer.calculateComplexity.mockReturnValue({ totalScore: 8 });
      mockProviderHealth.getAvailableProvider.mockResolvedValue({
        provider: AIProvider.CLAUDE_CODE,
        health: { isHealthy: true },
      });

      await service.routeTicket(request);

      expect(mockRabbitMQ.publishToQueue).toHaveBeenCalledWith(
        'ai-execution-queue',
        expect.objectContaining({
          ticketId: request.ticketId,
          provider: AIProvider.CLAUDE_CODE,
        }),
        request.correlationId,
      );
    });
  });
});
```

### 10.4 AIRoutingConsumer Integration Test

**File:** `src/ai-routing/ai-routing.consumer.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AIRoutingConsumer } from './ai-routing.consumer';
import { AIRoutingService } from './ai-routing.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { AIProvider } from '@prisma/client';
import { RoutingReason } from './interfaces';

describe('AIRoutingConsumer', () => {
  let consumer: AIRoutingConsumer;
  let aiRoutingService: AIRoutingService;

  const mockRabbitMQService = {
    getChannel: jest.fn().mockReturnValue({
      assertQueue: jest.fn().mockResolvedValue({}),
      prefetch: jest.fn().mockResolvedValue(undefined),
      consume: jest.fn().mockResolvedValue({}),
      ack: jest.fn(),
      nack: jest.fn(),
    }),
  };

  const mockAIRoutingService = {
    routeTicket: jest.fn().mockResolvedValue({
      correlationId: 'test-corr',
      ticketId: 'ticket-123',
      selectedProvider: AIProvider.CLAUDE_CODE,
      complexityScore: 5,
      routingReason: RoutingReason.COMPLEXITY_LOW,
      fallbackUsed: false,
      decisionTimestamp: new Date(),
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AIRoutingConsumer,
        { provide: RabbitMQService, useValue: mockRabbitMQService },
        { provide: AIRoutingService, useValue: mockAIRoutingService },
      ],
    }).compile();

    consumer = module.get<AIRoutingConsumer>(AIRoutingConsumer);
    aiRoutingService = module.get<AIRoutingService>(AIRoutingService);
    jest.clearAllMocks();
  });

  describe('processMessage', () => {
    it('should route ticket successfully', async () => {
      const payload = {
        correlationId: 'test-corr',
        ticketId: 'ticket-123',
        clickupTaskId: 'task-456',
        projectId: 'proj-789',
        title: 'Test ticket',
        description: 'Test description',
        acceptanceCriteria: '- AC 1',
        tags: [],
        qualityScore: 80,
        qualityGrade: 'good',
        timestamp: new Date().toISOString(),
      };

      await consumer['processMessage'](payload, 'test-corr');

      expect(aiRoutingService.routeTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: 'ticket-123',
          correlationId: 'test-corr',
        }),
      );
    });
  });
});
```

---

## Validation Checklist

**Database:**
- [ ] AIProvider enum updated to CURSOR_HEADLESS, CLAUDE_CODE
- [ ] Execution model has complexity_score, complexity_breakdown, routing_reason fields
- [ ] Migration created and applied

**RabbitMQ Infrastructure:**
- [ ] `AI_ROUTING` queue added to QUEUE_NAMES
- [ ] Queue created in `setupQueuesAndExchanges()`
- [ ] Consumer extends `RabbitMQConsumerBase`
- [ ] Publishes to `AI_EXECUTION` queue

**Configuration:**
- [ ] AI provider config added to configuration.ts
- [ ] Environment variables validated in env.validation.ts

**Complexity Scoring:**
- [ ] File count estimation (0-4 points)
- [ ] Architecture changes detection (0-4 points)
- [ ] Dependency level assessment (0-4 points)
- [ ] LOC estimation (0-4 points)
- [ ] Tag-based complexity (0-4 points)
- [ ] Total score 0-20

**Routing Logic:**
- [ ] Score >= 10 → Cursor CLI Headless
- [ ] Score < 10 → Claude Code
- [ ] Fallback when primary unavailable
- [ ] Routing reason logged

**Provider Health:**
- [ ] Health check service implemented
- [ ] Periodic health checks (30 sec)
- [ ] Load tracking (active executions)
- [ ] Unavailability duration tracking

**Ticket Status:**
- [ ] Updated to QUEUED on successful routing
- [ ] Remains VALIDATED if no provider available

**Retry Logic:**
- [ ] Retry scheduled after 5 minutes if no provider
- [ ] Alert after 15 minutes unavailability

**Prometheus Metrics:**
- [ ] ai_routing_total
- [ ] ai_routing_duration_seconds
- [ ] ai_complexity_score
- [ ] ai_provider_health
- [ ] ai_provider_active_executions
- [ ] ai_provider_availability_total

**Audit Logging:**
- [ ] Routing decision logged to audit_logs

**Tests:**
- [ ] Unit tests for ProviderHealthService
- [ ] Unit tests for ComplexityScorerService
- [ ] Unit tests for AIRoutingService
- [ ] Integration test for AIRoutingConsumer

---

## Prerequisites

- ✅ **Node.js 18+** - Required for native `fetch()` API in health checks
- ✅ Story 2.2 Complete - Ticket parsing publishes to ai-routing-queue
- ✅ Story 1.3 Complete - PostgreSQL/Prisma
- ✅ Story 1.5 Complete - RabbitMQ
- ✅ Story 1.8 Complete - Prometheus metrics

---

## Environment Variables

Add to `.env`:

```bash
# AI Provider Configuration
CURSOR_HEADLESS_ENABLED=false
CURSOR_HEADLESS_HEALTH_URL=
CURSOR_HEADLESS_TIMEOUT=300000
CURSOR_MAX_CONCURRENT=3

CLAUDE_CODE_ENABLED=false
ANTHROPIC_API_KEY=
CLAUDE_CODE_TIMEOUT=180000
CLAUDE_MAX_CONCURRENT=5

# Routing Configuration
AI_COMPLEXITY_THRESHOLD=10
AI_RETRY_DELAY_MINUTES=5
AI_ALERT_THRESHOLD_MINUTES=15
```

---

## References

| Document | Section | Content |
|----------|---------|---------|
| `docs/architecture.md` | Lines 471-528 | Multi-Provider AI Strategy |
| `docs/architecture.md` | Lines 129-141 | ai-routing module structure |
| `docs/epics.md` | Lines 874-922 | Story 2.3 acceptance criteria |
| `docs/prd.md` | FR60 | Route to appropriate AI tool |
| `prisma/schema.prisma` | Lines 59-104 | Execution model, AIProvider enum |
| `docs/sprint-artifacts/validation-report-2-3-2025-12-01.md` | Full | Quality validation report |

---

## Preparation for Future Stories

This routing foundation enables:
- **Story 2.4:** Prompt generation uses provider from routing decision
- **Story 2.5:** Execution tracking uses execution record created here
- **Story 2.6-2.7:** Provider integrations use health service
- **Story 2.8:** Multi-provider orchestration extends routing logic

---

## Dev Agent Record

### Context Reference

This story was prepared with complete context analysis from:
- Architecture document (Multi-Provider AI Strategy, ADR-003, ADR-006)
- PRD functional requirements (FR60)
- Previous stories (2.1 Webhook, 2.2 Ticket Parsing)
- Current codebase (empty ai-routing module, Prisma schema, RabbitMQ setup)
- Multi-provider complexity-based routing algorithm from architecture

### Completion Notes

**Story Status:** ready-for-dev  
**Context Completeness:** ✅ COMPREHENSIVE  
**Developer Readiness:** ✅ FLAWLESS IMPLEMENTATION GUIDE CREATED  
**Validation Status:** ✅ VALIDATED (see `validation-report-2-3-2025-12-01.md`)

**Post-Validation Improvements Applied:**
- Added missing `@willsoto/nestjs-prometheus` dependency
- Fixed DTO validation decorator (`@IsEnum` → `@IsIn`)
- Added ProviderHealthService unit tests
- Added AIRoutingConsumer integration test
- Added Node.js 18+ requirement for native fetch
- Clarified Story 2.2 queue dependency
- Added retry mechanism production notes

**Workflow After Story Completion:**
1. **Before Starting:** Update `sprint-status.yaml` → `2-3-ai-tool-selection-routing-logic-multi-provider: in-progress`
2. **Implementation:** Follow Steps 0-10 in order
3. **Migration:** Run `npx prisma migrate dev` after schema changes
4. **Validation:** Complete all items in Validation Checklist
5. **Version Control:** Commit with message `feat: add AI routing with complexity-based provider selection`
6. **Status Update:** Update `sprint-status.yaml` → `2-3-ai-tool-selection-routing-logic-multi-provider: review`
7. **Code Review:** Request review via code-review workflow

---

**Document prepared by:** Bob (Scrum Master)  
**Preparation date:** 2025-12-01  
**Analysis method:** Ultimate BMad Method Story Context Engine  
**Quality level:** Developer-ready with zero ambiguity

