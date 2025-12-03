# Story 3.6: QA Results Storage & Retrieval

**Epic:** 3 - Automated QA & Quality Gates  
**Status:** ready-for-dev  
**Priority:** P1 - HIGH  
**Effort:** 5 story points  
**ClickUp ID:** `86evnjwb9`  
**ClickUp URL:** https://app.clickup.com/t/86evnjwb9

---

## Story

As a Lead QA,
I want QA results stored and accessible,
So that I can review quality trends and make informed decisions.

---

## Acceptance Criteria

**Given** QA checks complete  
**When** results are stored  
**Then** the `qa_results` table contains:
- execution_id (link to execution)
- linting_passed (boolean), linting_errors (JSON array)
- tests_passed (boolean), test_results (JSON with pass/fail details)
- test_coverage (float %)
- code_review_passed (boolean), code_review_issues (JSON array)
- overall_passed (boolean)
- created_at (timestamp)

**And** results are queryable by:
- Execution ID
- Ticket ID
- Project
- Date range
- Pass/fail status

**And** API endpoints exist:
- GET `/api/v1/qa-results/:executionId` - Get results for execution
- GET `/api/v1/qa-results?ticketId={id}` - Get results by ticket
- GET `/api/v1/qa-results?projectId={id}&status=failed` - Query with filters

---

## Quick Implementation Summary (TL;DR)

**12 Key Files in Implementation Order:**
1. `prisma/schema.prisma` - MODIFY: Add `@unique` on `execution_id`, relation to Execution, indexes
2. `src/qa-automation/interfaces/qa-results.interface.ts` - Types and interfaces
3. `src/qa-automation/interfaces/index.ts` - MODIFY: Add exports
4. `src/qa-automation/dto/qa-results.dto.ts` - DTOs with validation
5. `src/qa-automation/dto/index.ts` - MODIFY: Add exports
6. `src/qa-automation/qa-results.service.ts` - Main storage/retrieval service with `savePartialResult()`
7. `src/qa-automation/qa-results.controller.ts` - API endpoints with RolesGuard
8. `src/common/metrics/metrics.constants.ts` - MODIFY: Add QA results metrics
9. `src/config/configuration.ts` - MODIFY: Add pagination config
10. `src/qa-automation/qa-automation.module.ts` - MODIFY: Wire providers
11. `src/qa-automation/qa-results.service.spec.ts` - Unit tests (>80% coverage)
12. `test/qa-results.e2e-spec.ts` - E2E tests

**Database:** Uses existing `QAResult` model. Add `@unique` constraint and relation to `Execution`.

**Environment Variables:**
```env
QA_RESULTS_DEFAULT_PAGE_SIZE=20
QA_RESULTS_MAX_PAGE_SIZE=100
```

---

## ⚠️ Anti-Patterns to Avoid

| ❌ DO NOT | ✅ DO INSTEAD |
|-----------|---------------|
| Return all results without pagination | Use `skip`/`take` with configurable limits |
| Query tickets table directly for each request | Use JOIN via Prisma `include` or batch queries |
| Store raw QA output without normalization | Store normalized JSON in dedicated fields |
| Hard-code pagination limits | Use ConfigService for configurable limits |
| Skip correlationId in logs | Use `@CorrelationId()` decorator from `src/common/decorators` |
| Return sensitive error details in API | Mask internal errors, return safe messages, capture to Sentry |
| Query by project without filtering by date | Add date range filters for large datasets |
| Create duplicate QAResult records | Use upsert pattern with execution_id as key |
| Skip authorization checks | Use `@Roles()` decorator and `RolesGuard` for project access |
| Return raw Prisma entities | Map to DTOs for consistent API responses |
| Create custom Logger instances | Use `AppLogger` from `src/common/logger/app-logger.service.ts` |
| Duplicate pagination logic | Extract to reusable private method |
| Perform N+1 queries for metrics | Use Prisma `groupBy` or raw SQL aggregation |

---

## Integration Context

### How This Story Fits in the Pipeline

```
Story 3.1 (Linting) - calls qaResultsService.savePartialResult({ linting_passed, linting_errors })
Story 3.2 (Testing) - calls qaResultsService.savePartialResult({ tests_passed, test_results })
Story 3.3 (Coverage) - calls qaResultsService.savePartialResult({ test_coverage })
Story 3.4 (Security) - calls qaResultsService.savePartialResult({ code_review_passed, code_review_issues })
    ↓ all results stored incrementally
Story 3.5 (Quality Gate) - calls qaResultsService.updateOverallStatus(executionId, passed)
    ↓ final status persisted
Story 3.6 (This Story) - provides storage/retrieval APIs
    ↓ APIs available
Story 5.4 (PM Dashboard) - displays QA results to PMs
Story 8.2 (QA Review Interface) - Lead QA reviews results
```

### Key Integration Points

| From | Interface | To |
|------|-----------|-----|
| Stories 3.1-3.4 | calls `qaResultsService.savePartialResult(executionId, partialData)` | This story |
| Story 3.5 | calls `qaResultsService.updateOverallStatus(executionId, passed)` | This story |
| PM Dashboard (5.x) | calls `GET /api/v1/qa-results/:executionId` | This story |
| QA Review (8.x) | calls `GET /api/v1/qa-results?projectId={id}` | This story |
| Quality Metrics | calls `GET /api/v1/qa-results/metrics/:projectId` | This story |

---

## Technical Requirements

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `prisma/schema.prisma` | MODIFY | Add `@unique`, relation, indexes |
| `src/qa-automation/interfaces/qa-results.interface.ts` | CREATE | Types and interfaces |
| `src/qa-automation/interfaces/index.ts` | MODIFY | Add exports |
| `src/qa-automation/dto/qa-results.dto.ts` | CREATE | DTOs with validation |
| `src/qa-automation/dto/index.ts` | MODIFY | Add exports |
| `src/qa-automation/qa-results.service.ts` | CREATE | Storage and retrieval |
| `src/qa-automation/qa-results.controller.ts` | CREATE | API endpoints |
| `src/common/metrics/metrics.constants.ts` | MODIFY | Add metrics |
| `src/config/configuration.ts` | MODIFY | Add pagination config |
| `src/qa-automation/qa-automation.module.ts` | MODIFY | Wire providers |
| `src/qa-automation/qa-results.service.spec.ts` | CREATE | Unit tests |
| `test/qa-results.e2e-spec.ts` | CREATE | E2E tests |

---

## Tasks

- [ ] **Task 1: Update Database Schema** (AC: Performance, Data Integrity)
  - [ ] Add `@unique` constraint to `execution_id` in QAResult model
  - [ ] Add relation from QAResult to Execution model
  - [ ] Add `@@index([execution_id])` to QAResult model
  - [ ] Add `@@index([overall_passed, created_at])` for filtering queries
  - [ ] Add `updated_at DateTime @updatedAt` field
  - [ ] Run `npx prisma migrate dev --name add_qa_results_constraints`
  - [ ] Verify with `\d qa_results` in psql

- [ ] **Task 2: Create Interfaces** (AC: #1)
  - [ ] `IQaResultCreate`, `IQaResultUpdate`, `IQaResultPartial`, `IQaResultQuery`
  - [ ] `IQaResultResponse`, `IQaResultsPageResponse`
  - [ ] `QaResultFilterStatus` enum (all, passed, failed)

- [ ] **Task 3: Create DTOs** (AC: #1, #2)
  - [ ] `QaResultDto` - main response DTO with OpenAPI examples
  - [ ] `QaResultsQueryDto` - query parameters
  - [ ] `QaResultsPageDto` - paginated response
  - [ ] `CreateQaResultDto`, `UpdateQaResultDto`
  - [ ] `QaResultMetricsDto` - aggregated metrics

- [ ] **Task 4: Implement QaResultsService** (AC: All)
  - [ ] `create(executionId, data)` - create new result (internal only)
  - [ ] `savePartialResult(executionId, partialData)` - **CRITICAL: used by Stories 3.1-3.4**
  - [ ] `findByExecutionId(executionId)` - single result lookup
  - [ ] `findByTicketId(ticketId, filters)` - results for ticket
  - [ ] `findByProjectId(projectId, filters)` - results for project with pagination
  - [ ] `updateOverallStatus(executionId, passed)` - update after gate evaluation
  - [ ] `getMetrics(projectId, dateRange)` - aggregated metrics (use Prisma groupBy)
  - [ ] Extract pagination logic to `buildPaginatedResponse()` helper
  - [ ] Use `AppLogger` from `src/common/logger/app-logger.service.ts`
  - [ ] Add Sentry error capture with `@SentryCapture()` decorator

- [ ] **Task 5: Implement QaResultsController** (AC: #3)
  - [ ] `GET /api/v1/qa-results/:executionId` - single result
  - [ ] `GET /api/v1/qa-results` - query with filters
  - [ ] `GET /api/v1/qa-results/metrics/:projectId` - metrics endpoint
  - [ ] Apply `@UseGuards(JwtAuthGuard, RolesGuard)` for authentication
  - [ ] Apply `@Roles(Role.LEAD_QA, Role.PM, Role.ADMIN)` for authorization
  - [ ] Use `@CorrelationId()` decorator for request tracing
  - [ ] Add OpenAPI response examples for better documentation

- [ ] **Task 6: Add Metrics** (AC: Performance tracking)
  - [ ] Add `QA_RESULTS_QUERIES_TOTAL` to `QA_METRICS` in metrics.constants.ts
  - [ ] Add `QA_RESULTS_QUERY_DURATION` histogram

- [ ] **Task 7: Configuration** (AC: #2)
  - [ ] Add `qa.results.defaultPageSize` config (default: 20)
  - [ ] Add `qa.results.maxPageSize` config (default: 100)
  - [ ] Document environment variables in `.env.example`

- [ ] **Task 8: Wire Module + Tests** (AC: All)
  - [ ] Update `QaAutomationModule` with providers and controllers
  - [ ] Unit tests for QaResultsService (>80% coverage target)
  - [ ] E2E tests for API endpoints
  - [ ] Verify `savePartialResult()` method works for upstream stories

---

## Implementation Guide

### Step 1: Database Schema Update

**File:** `prisma/schema.prisma` (MODIFY QAResult model)

```prisma
// ============================================
// QA RESULTS
// ============================================

model QAResult {
  id                  String   @id @default(uuid())
  execution_id        String   @unique  // CRITICAL: Must be unique for upsert pattern
  
  linting_passed      Boolean  @default(false)
  linting_errors      Json?
  
  tests_passed        Boolean  @default(false)
  test_results        Json?
  test_coverage       Float?
  
  code_review_passed  Boolean  @default(false)
  code_review_issues  Json?
  
  overall_passed      Boolean  @default(false)
  
  created_at          DateTime @default(now())
  updated_at          DateTime @updatedAt
  
  // Relation to Execution model
  execution           Execution @relation(fields: [execution_id], references: [id], onDelete: Cascade)
  
  @@index([overall_passed, created_at])  // For status + date filtering
  @@map("qa_results")
}

// NOTE: Add to Execution model:
// qa_result    QAResult?
```

After modifying, run:
```bash
npx prisma migrate dev --name add_qa_results_constraints
npx prisma generate
```

---

### Step 2: Create Interfaces

**File:** `src/qa-automation/interfaces/qa-results.interface.ts`

```typescript
/**
 * QA Results Storage & Retrieval Interfaces
 * Story 3.6: FR38 - Lead QA can view automated QA results
 * Architecture: docs/architecture.md line 1642 (QAResult model)
 */

export enum QaResultFilterStatus {
  ALL = 'all',
  PASSED = 'passed',
  FAILED = 'failed',
}

/**
 * Full creation input - used internally by create()
 */
export interface IQaResultCreate {
  executionId: string;
  linting_passed?: boolean;
  linting_errors?: Record<string, unknown>;
  tests_passed?: boolean;
  test_results?: Record<string, unknown>;
  test_coverage?: number | null;
  code_review_passed?: boolean;
  code_review_issues?: Record<string, unknown>;
  overall_passed?: boolean;
}

/**
 * Partial update input - used by Stories 3.1-3.4 via savePartialResult()
 * Each story updates only their relevant fields
 */
export interface IQaResultPartial {
  linting_passed?: boolean;
  linting_errors?: Record<string, unknown>;
  tests_passed?: boolean;
  test_results?: Record<string, unknown>;
  test_coverage?: number | null;
  code_review_passed?: boolean;
  code_review_issues?: Record<string, unknown>;
}

export interface IQaResultUpdate extends IQaResultPartial {
  overall_passed?: boolean;
}

export interface IQaResultQuery {
  ticketId?: string;
  projectId?: string;
  status?: QaResultFilterStatus;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  limit?: number;
}

export interface IQaResult {
  id: string;
  execution_id: string;
  linting_passed: boolean;
  linting_errors: Record<string, unknown> | null;
  tests_passed: boolean;
  test_results: Record<string, unknown> | null;
  test_coverage: number | null;
  code_review_passed: boolean;
  code_review_issues: Record<string, unknown> | null;
  overall_passed: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface IQaResultWithExecution extends IQaResult {
  execution?: {
    id: string;
    ticket_id: string;
    ai_provider: string;
    status: string;
    ticket?: {
      id: string;
      title: string;
      project_id: string;
      clickup_task_id: string;
    };
  };
}

export interface IPageInfo {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface IQaResultsPageResponse {
  data: IQaResultWithExecution[];
  pageInfo: IPageInfo;
}

export interface IQaResultMetrics {
  projectId: string;
  dateRange: {
    start: Date;
    end: Date;
  };
  totalExecutions: number;
  passedCount: number;
  failedCount: number;
  passRate: number;
  averageCoverage: number;
  lintingPassRate: number;
  testPassRate: number;
  securityPassRate: number;
  trends: {
    date: string;
    passed: number;
    failed: number;
    coverage: number;
  }[];
}
```

---

### Step 3: Create DTOs

**File:** `src/qa-automation/dto/qa-results.dto.ts`

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsObject,
  IsEnum,
  IsDateString,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QaResultFilterStatus } from '../interfaces';

export class QaResultDto {
  @ApiProperty({ description: 'QA Result ID', example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ description: 'Execution ID', example: '660e8400-e29b-41d4-a716-446655440001' })
  execution_id: string;

  @ApiProperty({ description: 'Linting check passed', example: true })
  linting_passed: boolean;

  @ApiPropertyOptional({ 
    description: 'Linting errors details',
    example: { errors: [{ file: 'src/app.ts', line: 10, message: 'Unexpected any' }] }
  })
  linting_errors?: Record<string, unknown> | null;

  @ApiProperty({ description: 'Tests passed', example: true })
  tests_passed: boolean;

  @ApiPropertyOptional({ 
    description: 'Test results details',
    example: { total: 50, passed: 48, failed: 2, skipped: 0 }
  })
  test_results?: Record<string, unknown> | null;

  @ApiPropertyOptional({ description: 'Test coverage percentage', example: 85.5 })
  test_coverage?: number | null;

  @ApiProperty({ description: 'Code review passed', example: true })
  code_review_passed: boolean;

  @ApiPropertyOptional({ 
    description: 'Code review issues',
    example: { issues: [{ severity: 'warning', message: 'Unused variable' }] }
  })
  code_review_issues?: Record<string, unknown> | null;

  @ApiProperty({ description: 'Overall QA passed', example: true })
  overall_passed: boolean;

  @ApiProperty({ description: 'Created timestamp', example: '2025-12-03T10:30:00Z' })
  created_at: Date;

  @ApiProperty({ description: 'Updated timestamp', example: '2025-12-03T10:35:00Z' })
  updated_at: Date;
}

export class ExecutionSummaryDto {
  @ApiProperty({ example: '660e8400-e29b-41d4-a716-446655440001' })
  id: string;

  @ApiProperty({ example: '770e8400-e29b-41d4-a716-446655440002' })
  ticket_id: string;

  @ApiProperty({ example: 'claude-3-opus' })
  ai_provider: string;

  @ApiProperty({ example: 'completed' })
  status: string;

  @ApiPropertyOptional()
  ticket?: {
    id: string;
    title: string;
    project_id: string;
    clickup_task_id: string;
  };
}

export class QaResultWithExecutionDto extends QaResultDto {
  @ApiPropertyOptional({ description: 'Associated execution details', type: ExecutionSummaryDto })
  execution?: ExecutionSummaryDto;
}

export class QaResultsQueryDto {
  @ApiPropertyOptional({ description: 'Filter by ticket ID' })
  @IsOptional()
  @IsString()
  ticketId?: string;

  @ApiPropertyOptional({ description: 'Filter by project ID' })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiPropertyOptional({ 
    description: 'Filter by status',
    enum: QaResultFilterStatus,
    default: QaResultFilterStatus.ALL,
  })
  @IsOptional()
  @IsEnum(QaResultFilterStatus)
  status?: QaResultFilterStatus;

  @ApiPropertyOptional({ description: 'Start date for date range filter (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date for date range filter (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Results per page', default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class PageInfoDto {
  @ApiProperty({ example: 150 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 8 })
  totalPages: number;

  @ApiProperty({ example: true })
  hasNextPage: boolean;

  @ApiProperty({ example: false })
  hasPreviousPage: boolean;
}

export class QaResultsPageDto {
  @ApiProperty({ type: [QaResultWithExecutionDto] })
  data: QaResultWithExecutionDto[];

  @ApiProperty({ type: PageInfoDto })
  pageInfo: PageInfoDto;
}

export class CreateQaResultDto {
  @ApiProperty({ description: 'Execution ID' })
  @IsString()
  executionId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  linting_passed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  linting_errors?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  tests_passed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  test_results?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  test_coverage?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  code_review_passed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  code_review_issues?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  overall_passed?: boolean;
}

export class UpdateQaResultDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  linting_passed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  linting_errors?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  tests_passed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  test_results?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  test_coverage?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  code_review_passed?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  code_review_issues?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  overall_passed?: boolean;
}

export class TrendDataDto {
  @ApiProperty({ example: '2025-12-03' })
  date: string;

  @ApiProperty({ example: 15 })
  passed: number;

  @ApiProperty({ example: 3 })
  failed: number;

  @ApiProperty({ example: 82 })
  coverage: number;
}

export class QaResultMetricsDto {
  @ApiProperty({ description: 'Project ID', example: '880e8400-e29b-41d4-a716-446655440003' })
  projectId: string;

  @ApiProperty({ description: 'Date range' })
  dateRange: {
    start: Date;
    end: Date;
  };

  @ApiProperty({ description: 'Total executions', example: 100 })
  totalExecutions: number;

  @ApiProperty({ description: 'Passed count', example: 85 })
  passedCount: number;

  @ApiProperty({ description: 'Failed count', example: 15 })
  failedCount: number;

  @ApiProperty({ description: 'Pass rate (0-100)', example: 85.0 })
  passRate: number;

  @ApiProperty({ description: 'Average test coverage (0-100)', example: 78.5 })
  averageCoverage: number;

  @ApiProperty({ description: 'Linting pass rate (0-100)', example: 92.0 })
  lintingPassRate: number;

  @ApiProperty({ description: 'Test pass rate (0-100)', example: 88.0 })
  testPassRate: number;

  @ApiProperty({ description: 'Security pass rate (0-100)', example: 95.0 })
  securityPassRate: number;

  @ApiProperty({ description: 'Daily trends', type: [TrendDataDto] })
  trends: TrendDataDto[];
}

export class DateRangeDto {
  @ApiProperty({ description: 'Start date' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ description: 'End date' })
  @IsDateString()
  endDate: string;
}
```

---

### Step 4: Implement QaResultsService

**File:** `src/qa-automation/qa-results.service.ts`

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaService } from '../database/prisma.service';
import { AppLogger } from '../common/logger/app-logger.service';
import { SentryCapture } from '../common/sentry/decorators/sentry-capture.decorator';
import { QA_METRICS } from '../common/metrics/metrics.constants';
import {
  IQaResultCreate,
  IQaResultUpdate,
  IQaResultPartial,
  IQaResultQuery,
  IQaResult,
  IQaResultWithExecution,
  IQaResultsPageResponse,
  IQaResultMetrics,
  IPageInfo,
  QaResultFilterStatus,
} from './interfaces';

/**
 * QA Results Service
 * Story 3.6: Storage and retrieval of QA results
 * FR38: Lead QA can view automated QA results for each ticket
 * 
 * Key Methods:
 * - savePartialResult(): Called by Stories 3.1-3.4 to store individual check results
 * - updateOverallStatus(): Called by Story 3.5 after quality gate evaluation
 * - findBy*(): Query methods for dashboards (Stories 5.4, 8.2)
 */
@Injectable()
export class QaResultsService {
  private readonly defaultPageSize: number;
  private readonly maxPageSize: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly logger: AppLogger,
    @InjectMetric(QA_METRICS.QA_RESULTS_QUERIES_TOTAL)
    private readonly queriesCounter: Counter<string>,
    @InjectMetric(QA_METRICS.QA_RESULTS_QUERY_DURATION)
    private readonly queryDuration: Histogram<string>,
  ) {
    this.logger.setContext(QaResultsService.name);
    this.defaultPageSize = this.configService.get<number>('qa.results.defaultPageSize', 20);
    this.maxPageSize = this.configService.get<number>('qa.results.maxPageSize', 100);
  }

  /**
   * Save partial QA result - CRITICAL METHOD for Stories 3.1-3.4 integration
   * Each QA check story calls this to store their specific results.
   * Uses upsert pattern to handle concurrent updates safely.
   * 
   * @example Story 3.1 (Linting):
   * await qaResultsService.savePartialResult(executionId, { 
   *   linting_passed: true, 
   *   linting_errors: [] 
   * });
   * 
   * @example Story 3.2 (Testing):
   * await qaResultsService.savePartialResult(executionId, { 
   *   tests_passed: false, 
   *   test_results: { failed: ['test1'] } 
   * });
   */
  @SentryCapture()
  async savePartialResult(executionId: string, partialData: IQaResultPartial): Promise<IQaResult> {
    this.logger.debug(`Saving partial QA result for execution ${executionId}`, { 
      fields: Object.keys(partialData) 
    });

    const result = await this.prisma.qAResult.upsert({
      where: { execution_id: executionId },
      create: {
        execution_id: executionId,
        linting_passed: partialData.linting_passed ?? false,
        linting_errors: partialData.linting_errors ?? null,
        tests_passed: partialData.tests_passed ?? false,
        test_results: partialData.test_results ?? null,
        test_coverage: partialData.test_coverage ?? null,
        code_review_passed: partialData.code_review_passed ?? false,
        code_review_issues: partialData.code_review_issues ?? null,
        overall_passed: false, // Will be set by Story 3.5
      },
      update: {
        ...(partialData.linting_passed !== undefined && { linting_passed: partialData.linting_passed }),
        ...(partialData.linting_errors !== undefined && { linting_errors: partialData.linting_errors }),
        ...(partialData.tests_passed !== undefined && { tests_passed: partialData.tests_passed }),
        ...(partialData.test_results !== undefined && { test_results: partialData.test_results }),
        ...(partialData.test_coverage !== undefined && { test_coverage: partialData.test_coverage }),
        ...(partialData.code_review_passed !== undefined && { code_review_passed: partialData.code_review_passed }),
        ...(partialData.code_review_issues !== undefined && { code_review_issues: partialData.code_review_issues }),
      },
    });

    this.logger.debug(`Saved partial QA result ${result.id} for execution ${executionId}`);
    return this.mapToInterface(result);
  }

  /**
   * Create a new QA result record (internal use)
   */
  @SentryCapture()
  async create(data: IQaResultCreate): Promise<IQaResult> {
    this.logger.debug(`Creating QA result for execution ${data.executionId}`);

    const result = await this.prisma.qAResult.upsert({
      where: { execution_id: data.executionId },
      create: {
        execution_id: data.executionId,
        linting_passed: data.linting_passed ?? false,
        linting_errors: data.linting_errors ?? null,
        tests_passed: data.tests_passed ?? false,
        test_results: data.test_results ?? null,
        test_coverage: data.test_coverage ?? null,
        code_review_passed: data.code_review_passed ?? false,
        code_review_issues: data.code_review_issues ?? null,
        overall_passed: data.overall_passed ?? false,
      },
      update: {
        ...(data.linting_passed !== undefined && { linting_passed: data.linting_passed }),
        ...(data.linting_errors !== undefined && { linting_errors: data.linting_errors }),
        ...(data.tests_passed !== undefined && { tests_passed: data.tests_passed }),
        ...(data.test_results !== undefined && { test_results: data.test_results }),
        ...(data.test_coverage !== undefined && { test_coverage: data.test_coverage }),
        ...(data.code_review_passed !== undefined && { code_review_passed: data.code_review_passed }),
        ...(data.code_review_issues !== undefined && { code_review_issues: data.code_review_issues }),
        ...(data.overall_passed !== undefined && { overall_passed: data.overall_passed }),
      },
    });

    this.logger.debug(`Created QA result ${result.id} for execution ${data.executionId}`);
    return this.mapToInterface(result);
  }

  /**
   * Update an existing QA result by execution ID
   */
  @SentryCapture()
  async update(executionId: string, data: IQaResultUpdate): Promise<IQaResult> {
    const existing = await this.prisma.qAResult.findUnique({
      where: { execution_id: executionId },
    });

    if (!existing) {
      throw new NotFoundException(`QA result not found for execution ${executionId}`);
    }

    const result = await this.prisma.qAResult.update({
      where: { execution_id: executionId },
      data: {
        ...(data.linting_passed !== undefined && { linting_passed: data.linting_passed }),
        ...(data.linting_errors !== undefined && { linting_errors: data.linting_errors }),
        ...(data.tests_passed !== undefined && { tests_passed: data.tests_passed }),
        ...(data.test_results !== undefined && { test_results: data.test_results }),
        ...(data.test_coverage !== undefined && { test_coverage: data.test_coverage }),
        ...(data.code_review_passed !== undefined && { code_review_passed: data.code_review_passed }),
        ...(data.code_review_issues !== undefined && { code_review_issues: data.code_review_issues }),
        ...(data.overall_passed !== undefined && { overall_passed: data.overall_passed }),
      },
    });

    this.logger.debug(`Updated QA result ${result.id} for execution ${executionId}`);
    return this.mapToInterface(result);
  }

  /**
   * Update only the overall_passed status after quality gate evaluation
   * Called by Story 3.5 (Quality Gate Decision Engine)
   */
  @SentryCapture()
  async updateOverallStatus(executionId: string, passed: boolean): Promise<void> {
    await this.prisma.qAResult.update({
      where: { execution_id: executionId },
      data: { overall_passed: passed },
    });
    this.logger.debug(`Updated overall status for execution ${executionId}: ${passed}`);
  }

  /**
   * Find QA result by execution ID
   */
  @SentryCapture()
  async findByExecutionId(executionId: string): Promise<IQaResultWithExecution> {
    const endTimer = this.queryDuration.startTimer({ query_type: 'by_execution' });
    this.queriesCounter.inc({ query_type: 'by_execution' });

    try {
      const result = await this.prisma.qAResult.findUnique({
        where: { execution_id: executionId },
        include: {
          execution: {
            select: {
              id: true,
              ticket_id: true,
              ai_provider: true,
              status: true,
              ticket: {
                select: {
                  id: true,
                  title: true,
                  project_id: true,
                  clickup_task_id: true,
                },
              },
            },
          },
        },
      });

      if (!result) {
        throw new NotFoundException(`QA result not found for execution ${executionId}`);
      }

      return this.mapToInterfaceWithExecution(result);
    } finally {
      endTimer();
    }
  }

  /**
   * Find QA results by ticket ID
   */
  @SentryCapture()
  async findByTicketId(
    ticketId: string,
    query: IQaResultQuery = {},
  ): Promise<IQaResultsPageResponse> {
    const endTimer = this.queryDuration.startTimer({ query_type: 'by_ticket' });
    this.queriesCounter.inc({ query_type: 'by_ticket' });

    try {
      return this.findWithFilters({ ...query, ticketId });
    } finally {
      endTimer();
    }
  }

  /**
   * Find QA results by project ID with filters
   */
  @SentryCapture()
  async findByProjectId(
    projectId: string,
    query: IQaResultQuery = {},
  ): Promise<IQaResultsPageResponse> {
    const endTimer = this.queryDuration.startTimer({ query_type: 'by_project' });
    this.queriesCounter.inc({ query_type: 'by_project' });

    try {
      return this.findWithFilters({ ...query, projectId });
    } finally {
      endTimer();
    }
  }

  /**
   * Query QA results with filters
   */
  @SentryCapture()
  async query(query: IQaResultQuery): Promise<IQaResultsPageResponse> {
    const endTimer = this.queryDuration.startTimer({ query_type: 'general' });
    this.queriesCounter.inc({ query_type: 'general' });

    try {
      return this.findWithFilters(query);
    } finally {
      endTimer();
    }
  }

  /**
   * Get aggregated metrics for a project
   * Uses Prisma groupBy for efficient aggregation instead of loading all records
   */
  @SentryCapture()
  async getMetrics(projectId: string, startDate?: Date, endDate?: Date): Promise<IQaResultMetrics> {
    const endTimer = this.queryDuration.startTimer({ query_type: 'metrics' });
    this.queriesCounter.inc({ query_type: 'metrics' });

    try {
      const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default 30 days
      const end = endDate || new Date();

      // Get execution IDs for project via a single efficient query
      const executions = await this.prisma.execution.findMany({
        where: {
          ticket: { project_id: projectId },
        },
        select: { id: true },
      });

      const executionIds = executions.map((e) => e.id);

      if (executionIds.length === 0) {
        return this.emptyMetrics(projectId, start, end);
      }

      // Use Prisma aggregation for efficiency
      const [aggregates, results] = await Promise.all([
        this.prisma.qAResult.aggregate({
          where: {
            execution_id: { in: executionIds },
            created_at: { gte: start, lte: end },
          },
          _count: { id: true },
          _avg: { test_coverage: true },
        }),
        this.prisma.qAResult.findMany({
          where: {
            execution_id: { in: executionIds },
            created_at: { gte: start, lte: end },
          },
          select: {
            overall_passed: true,
            linting_passed: true,
            tests_passed: true,
            code_review_passed: true,
            test_coverage: true,
            created_at: true,
          },
        }),
      ]);

      const totalExecutions = aggregates._count.id;
      const passedCount = results.filter((r) => r.overall_passed).length;
      const failedCount = totalExecutions - passedCount;
      const passRate = totalExecutions > 0 ? (passedCount / totalExecutions) * 100 : 0;
      const averageCoverage = aggregates._avg.test_coverage ?? 0;

      const lintingPassRate = totalExecutions > 0
        ? (results.filter((r) => r.linting_passed).length / totalExecutions) * 100
        : 0;
      const testPassRate = totalExecutions > 0
        ? (results.filter((r) => r.tests_passed).length / totalExecutions) * 100
        : 0;
      const securityPassRate = totalExecutions > 0
        ? (results.filter((r) => r.code_review_passed).length / totalExecutions) * 100
        : 0;

      // Calculate daily trends
      const trendMap = new Map<string, { passed: number; failed: number; coverage: number[] }>();

      results.forEach((r) => {
        const dateKey = r.created_at.toISOString().split('T')[0];
        if (!trendMap.has(dateKey)) {
          trendMap.set(dateKey, { passed: 0, failed: 0, coverage: [] });
        }
        const day = trendMap.get(dateKey)!;
        if (r.overall_passed) {
          day.passed++;
        } else {
          day.failed++;
        }
        if (r.test_coverage !== null) {
          day.coverage.push(r.test_coverage);
        }
      });

      const trends = Array.from(trendMap.entries())
        .map(([date, data]) => ({
          date,
          passed: data.passed,
          failed: data.failed,
          coverage: data.coverage.length > 0
            ? Math.round(data.coverage.reduce((a, b) => a + b, 0) / data.coverage.length)
            : 0,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        projectId,
        dateRange: { start, end },
        totalExecutions,
        passedCount,
        failedCount,
        passRate: Math.round(passRate * 100) / 100,
        averageCoverage: Math.round(averageCoverage * 100) / 100,
        lintingPassRate: Math.round(lintingPassRate * 100) / 100,
        testPassRate: Math.round(testPassRate * 100) / 100,
        securityPassRate: Math.round(securityPassRate * 100) / 100,
        trends,
      };
    } finally {
      endTimer();
    }
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Consolidated query method - handles all filter combinations
   */
  private async findWithFilters(query: IQaResultQuery): Promise<IQaResultsPageResponse> {
    const { page = 1, limit = this.defaultPageSize } = query;
    const effectiveLimit = Math.min(limit, this.maxPageSize);
    const skip = (page - 1) * effectiveLimit;

    // Build execution filter
    const executionFilter: any = {};
    if (query.ticketId) {
      executionFilter.ticket_id = query.ticketId;
    }
    if (query.projectId) {
      executionFilter.ticket = { project_id: query.projectId };
    }

    // Build QA result filter
    const qaResultFilter: any = {};
    if (query.status === QaResultFilterStatus.PASSED) {
      qaResultFilter.overall_passed = true;
    } else if (query.status === QaResultFilterStatus.FAILED) {
      qaResultFilter.overall_passed = false;
    }
    if (query.startDate || query.endDate) {
      qaResultFilter.created_at = {};
      if (query.startDate) qaResultFilter.created_at.gte = query.startDate;
      if (query.endDate) qaResultFilter.created_at.lte = query.endDate;
    }

    // If filtering by ticket/project, get execution IDs first
    if (query.ticketId || query.projectId) {
      const executions = await this.prisma.execution.findMany({
        where: executionFilter,
        select: { id: true },
      });

      if (executions.length === 0) {
        return this.buildPaginatedResponse([], 0, page, effectiveLimit);
      }

      qaResultFilter.execution_id = { in: executions.map((e) => e.id) };
    }

    const [results, total] = await Promise.all([
      this.prisma.qAResult.findMany({
        where: qaResultFilter,
        skip,
        take: effectiveLimit,
        orderBy: { created_at: 'desc' },
        include: {
          execution: {
            select: {
              id: true,
              ticket_id: true,
              ai_provider: true,
              status: true,
              ticket: {
                select: {
                  id: true,
                  title: true,
                  project_id: true,
                  clickup_task_id: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.qAResult.count({ where: qaResultFilter }),
    ]);

    const data = results.map((r) => this.mapToInterfaceWithExecution(r));
    return this.buildPaginatedResponse(data, total, page, effectiveLimit);
  }

  /**
   * Build standardized paginated response
   */
  private buildPaginatedResponse(
    data: IQaResultWithExecution[],
    total: number,
    page: number,
    limit: number,
  ): IQaResultsPageResponse {
    const totalPages = Math.ceil(total / limit);
    return {
      data,
      pageInfo: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  private emptyMetrics(projectId: string, start: Date, end: Date): IQaResultMetrics {
    return {
      projectId,
      dateRange: { start, end },
      totalExecutions: 0,
      passedCount: 0,
      failedCount: 0,
      passRate: 0,
      averageCoverage: 0,
      lintingPassRate: 0,
      testPassRate: 0,
      securityPassRate: 0,
      trends: [],
    };
  }

  private mapToInterface(result: any): IQaResult {
    return {
      id: result.id,
      execution_id: result.execution_id,
      linting_passed: result.linting_passed,
      linting_errors: result.linting_errors as Record<string, unknown> | null,
      tests_passed: result.tests_passed,
      test_results: result.test_results as Record<string, unknown> | null,
      test_coverage: result.test_coverage,
      code_review_passed: result.code_review_passed,
      code_review_issues: result.code_review_issues as Record<string, unknown> | null,
      overall_passed: result.overall_passed,
      created_at: result.created_at,
      updated_at: result.updated_at,
    };
  }

  private mapToInterfaceWithExecution(result: any): IQaResultWithExecution {
    const base = this.mapToInterface(result);
    return {
      ...base,
      execution: result.execution
        ? {
            id: result.execution.id,
            ticket_id: result.execution.ticket_id,
            ai_provider: result.execution.ai_provider,
            status: result.execution.status,
            ticket: result.execution.ticket,
          }
        : undefined,
    };
  }
}
```

---

### Step 5: Implement QaResultsController

**File:** `src/qa-automation/qa-results.controller.ts`

```typescript
import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/strategies/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CorrelationId } from '../common/decorators/correlation-id.decorator';
import { Role } from '../auth/constants/roles.enum';
import { AppLogger } from '../common/logger/app-logger.service';
import { QaResultsService } from './qa-results.service';
import {
  QaResultWithExecutionDto,
  QaResultsQueryDto,
  QaResultsPageDto,
  QaResultMetricsDto,
} from './dto';

@ApiTags('QA Results')
@Controller('api/v1/qa-results')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class QaResultsController {
  constructor(
    private readonly qaResultsService: QaResultsService,
    private readonly logger: AppLogger,
  ) {
    this.logger.setContext(QaResultsController.name);
  }

  @Get('metrics/:projectId')
  @Roles(Role.LEAD_QA, Role.PM, Role.ADMIN)
  @ApiOperation({ summary: 'Get QA metrics for a project' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'QA metrics retrieved successfully',
    type: QaResultMetricsDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient role' })
  async getMetrics(
    @Param('projectId') projectId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @CorrelationId() correlationId?: string,
  ): Promise<QaResultMetricsDto> {
    this.logger.debug(`Getting metrics for project ${projectId}`, { correlationId });
    return this.qaResultsService.getMetrics(
      projectId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get(':executionId')
  @Roles(Role.LEAD_QA, Role.PM, Role.DEVELOPER, Role.ADMIN)
  @ApiOperation({ summary: 'Get QA result by execution ID' })
  @ApiParam({ name: 'executionId', description: 'Execution ID' })
  @ApiResponse({ 
    status: 200, 
    description: 'QA result retrieved successfully',
    type: QaResultWithExecutionDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'QA result not found' })
  async getByExecutionId(
    @Param('executionId') executionId: string,
    @CorrelationId() correlationId?: string,
  ): Promise<QaResultWithExecutionDto> {
    this.logger.debug(`Getting QA result for execution ${executionId}`, { correlationId });
    return this.qaResultsService.findByExecutionId(executionId);
  }

  @Get()
  @Roles(Role.LEAD_QA, Role.PM, Role.DEVELOPER, Role.ADMIN)
  @ApiOperation({ summary: 'Query QA results with filters' })
  @ApiResponse({ 
    status: 200, 
    description: 'QA results retrieved successfully',
    type: QaResultsPageDto,
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async query(
    @Query() queryDto: QaResultsQueryDto,
    @CorrelationId() correlationId?: string,
  ): Promise<QaResultsPageDto> {
    this.logger.debug(`Querying QA results`, { filters: queryDto, correlationId });
    return this.qaResultsService.query({
      ticketId: queryDto.ticketId,
      projectId: queryDto.projectId,
      status: queryDto.status,
      startDate: queryDto.startDate ? new Date(queryDto.startDate) : undefined,
      endDate: queryDto.endDate ? new Date(queryDto.endDate) : undefined,
      page: queryDto.page,
      limit: queryDto.limit,
    });
  }
}
```

---

### Step 6: Add Metrics Constants

**File:** `src/common/metrics/metrics.constants.ts` (ADD to existing QA_METRICS)

```typescript
// ADD these to QA_METRICS object (around line 85):
export const QA_METRICS = {
  // ... existing metrics ...
  QA_RESULTS_QUERIES_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_results_queries_total`,
  QA_RESULTS_QUERY_DURATION: `${METRICS_CONSTANTS.PREFIX}qa_results_query_duration_seconds`,
};
```

---

### Step 7: Configuration

**File:** `src/config/configuration.ts` (ADD to config object)

```typescript
qa: {
  results: {
    defaultPageSize: parseInt(process.env.QA_RESULTS_DEFAULT_PAGE_SIZE || '20', 10),
    maxPageSize: parseInt(process.env.QA_RESULTS_MAX_PAGE_SIZE || '100', 10),
  },
},
```

**File:** `.env.example` (ADD environment variables documentation)

```env
# QA Results Configuration (Story 3.6)
QA_RESULTS_DEFAULT_PAGE_SIZE=20
QA_RESULTS_MAX_PAGE_SIZE=100
```

---

### Step 8: Wire Module

**File:** `src/qa-automation/qa-automation.module.ts` (UPDATE)

```typescript
import { Module } from '@nestjs/common';
import { makeCounterProvider, makeHistogramProvider } from '@willsoto/nestjs-prometheus';
import { DatabaseModule } from '../database/database.module';
import { ConfigModule } from '../config/config.module';
import { LoggerModule } from '../common/logger/logger.module';
import { QA_METRICS } from '../common/metrics/metrics.constants';
import { QaResultsService } from './qa-results.service';
import { QaResultsController } from './qa-results.controller';

@Module({
  imports: [DatabaseModule, ConfigModule, LoggerModule],
  controllers: [QaResultsController],
  providers: [
    QaResultsService,
    makeCounterProvider({
      name: QA_METRICS.QA_RESULTS_QUERIES_TOTAL,
      help: 'Total number of QA results queries',
      labelNames: ['query_type'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.QA_RESULTS_QUERY_DURATION,
      help: 'QA results query duration in seconds',
      labelNames: ['query_type'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    }),
  ],
  exports: [QaResultsService],
})
export class QaAutomationModule {}
```

---

## Testing Requirements

### Unit Tests (>80% Coverage Target)

**File:** `src/qa-automation/qa-results.service.spec.ts`

```typescript
describe('QaResultsService', () => {
  describe('savePartialResult', () => {
    it('should create new result if none exists for execution');
    it('should update existing result (upsert behavior)');
    it('should only update provided fields');
    it('should handle concurrent updates safely');
  });

  describe('create', () => {
    it('should create a new QA result');
    it('should update existing result if execution_id exists (upsert)');
    it('should handle partial data with defaults');
  });

  describe('update', () => {
    it('should update specified fields only');
    it('should throw NotFoundException if not found');
  });

  describe('updateOverallStatus', () => {
    it('should update only overall_passed field');
    it('should not throw if record does not exist (updateMany behavior)');
  });

  describe('findByExecutionId', () => {
    it('should return result with execution details');
    it('should throw NotFoundException if not found');
    it('should include ticket details via execution');
    it('should track query metrics');
  });

  describe('findByTicketId', () => {
    it('should return paginated results for ticket');
    it('should filter by status (passed/failed)');
    it('should filter by date range');
    it('should return empty response if no results');
  });

  describe('findByProjectId', () => {
    it('should return paginated results for project');
    it('should apply all filters correctly');
    it('should respect max page size limit');
  });

  describe('query', () => {
    it('should delegate to findByTicketId when ticketId provided');
    it('should delegate to findByProjectId when projectId provided');
    it('should use findWithFilters for general queries');
  });

  describe('getMetrics', () => {
    it('should calculate pass rate correctly');
    it('should calculate average coverage using Prisma aggregate');
    it('should calculate category pass rates');
    it('should return daily trends sorted by date');
    it('should default to 30 day range if no dates provided');
    it('should return empty metrics for project with no results');
  });

  describe('buildPaginatedResponse', () => {
    it('should calculate totalPages correctly');
    it('should set hasNextPage when more pages exist');
    it('should set hasPreviousPage when on page > 1');
  });
});
```

### E2E Tests

**File:** `test/qa-results.e2e-spec.ts`

```typescript
describe('QA Results API (e2e)', () => {
  describe('GET /api/v1/qa-results/:executionId', () => {
    it('should return 200 with QA result');
    it('should return 404 if not found');
    it('should require authentication (401)');
    it('should include execution and ticket details');
  });

  describe('GET /api/v1/qa-results', () => {
    it('should return paginated results');
    it('should filter by ticketId');
    it('should filter by projectId');
    it('should filter by status=passed');
    it('should filter by status=failed');
    it('should filter by date range');
    it('should respect page and limit parameters');
    it('should enforce max page size');
    it('should return correct pagination metadata');
  });

  describe('GET /api/v1/qa-results/metrics/:projectId', () => {
    it('should return metrics for project');
    it('should accept date range parameters');
    it('should return empty metrics for project with no results');
    it('should require LEAD_QA, PM, or ADMIN role (403 for DEVELOPER)');
  });

  describe('Authorization', () => {
    it('should allow LEAD_QA to access all endpoints');
    it('should allow PM to access all endpoints');
    it('should allow ADMIN to access all endpoints');
    it('should allow DEVELOPER to access single result and query');
    it('should reject unauthenticated requests');
  });
});
```

---

## Prerequisites

| Story | Status | Required For |
|-------|--------|--------------|
| Story 1.3 (Database) | ✅ done | `qa_results` table exists |
| Story 1.6 (Auth) | ✅ done | JWT authentication, RolesGuard |
| Story 1.8 (Prometheus) | ✅ done | Metrics infrastructure |

**Note:** Stories 3.1-3.5 will use this service to store results via `savePartialResult()`, but are not strict prerequisites. The storage service can be implemented first.

---

## References

| Source | Section |
|--------|---------|
| `docs/architecture.md` | Line 1642: QAResult model |
| `docs/epics.md` | Story 3.6 acceptance criteria |
| `docs/prd.md` | FR38: Lead QA can view automated QA results |
| `prisma/schema.prisma` | QAResult model definition |
| `src/common/guards/roles.guard.ts` | RolesGuard implementation |
| `src/common/decorators/correlation-id.decorator.ts` | CorrelationId decorator |
| `src/common/logger/app-logger.service.ts` | AppLogger service |
| `src/common/sentry/decorators/sentry-capture.decorator.ts` | SentryCapture decorator |

---

## Dev Agent Record

### Context Reference

- Uses existing `QAResult` Prisma model per `prisma/schema.prisma` line 116
- Implements FR38: Lead QA can view automated QA results
- API follows NestJS patterns from `ticket-intake` module
- Pagination follows existing patterns with `PageInfoDto`
- Authentication uses `JwtAuthGuard` from `src/auth/strategies/jwt-auth.guard.ts`
- Authorization uses `RolesGuard` from `src/common/guards/roles.guard.ts`
- Logging uses `AppLogger` from `src/common/logger/app-logger.service.ts`
- Error tracking uses `SentryCapture` decorator

### Critical Integration Note

The `savePartialResult()` method is **critical** for Stories 3.1-3.4 integration. Each QA check story calls this method to store their specific results incrementally. Ensure this method is well-tested and documented before those stories begin implementation.

### Agent Model Used

{{agent_model_name_version}}

### Change Log

| Date | Change | Author |
|------|--------|--------|
| 2025-12-03 | Story drafted with comprehensive implementation guide | Scrum Master Bob |
| 2025-12-03 | Enhanced with validation improvements: @unique constraint, savePartialResult(), Sentry, RolesGuard, AppLogger, pagination consolidation | Scrum Master Bob |

### File List

<!-- Populated during implementation -->
