# Story 8.5: Bug Escape Tracking & Analysis

**Epic:** 8 - Lead QA Manual Review Workflow  
**Status:** ready-for-dev  
**Priority:** High  
**Estimation:** 3 days  
**Story Points:** 5

---

## Story

As a Lead QA,  
I want to track bug escape rates and analyze quality trends over time,  
so that I can identify systemic quality issues, measure the effectiveness of our QA processes, and continuously improve our automated and manual review workflows.

---

## Context

**Bug Escape Definition:** A production defect that passed automated QA (Story 3.5), AI self-healing (Story 13.3/13.4), and Lead QA review (Story 8.1-8.3). Tracking escapes measures quality gate effectiveness.

**Analysis Dimensions:** AI providers, project types, time trends, root causes (linting misses, test gaps, coverage blind spots, review failures).

**Requirements:** FR40, FR110, PRD <5% escape rate threshold.

**Existing Infrastructure:**

- `ProductionError` model (architecture.md) - stores production errors
- `QaResult` model (Story 3.6) - QA outcomes with `QaReviewQueue` relation
- `Execution` model - links tickets to code changes
- `Project` model - project-level aggregation
- Story 8.1 QA Review Queue (`QaReviewQueue` table) - manual review records
- Story 8.3 Production Approval - approval audit trail

---

## Acceptance Criteria

### AC#1: Bug Escape Identification & Classification

**Given** a production error is recorded in the system  
**When** the error is linked to a ticket that had prior QA execution  
**Then** the system classifies it as a "bug escape" and captures:

| Field                   | Description                                                        |
| ----------------------- | ------------------------------------------------------------------ |
| `escape_id`             | Unique identifier for the escape record                            |
| `production_error_id`   | Link to ProductionError record                                     |
| `ticket_id`             | Original ClickUp ticket that introduced the bug                    |
| `execution_id`          | AI execution that generated the code                               |
| `qa_result_id`          | QA results that (incorrectly) passed                               |
| `qa_review_queue_id`    | Link to QaReviewQueue record (Story 8.1) if manual review occurred |
| `escape_category`       | Root cause classification (see below)                              |
| `detected_at`           | When the production error was first detected                       |
| `resolution_time_hours` | Time from detection to fix deployment                              |

**Escape Categories:**

- `LINTING_MISS`: Code passed linting but had logical errors
- `TEST_GAP`: Missing test coverage for the failing scenario
- `COVERAGE_BLINDSPOT`: Coverage threshold met but critical path untested
- `AI_GENERATION_ERROR`: AI produced incorrect/unsafe code
- `REVIEW_FAILURE`: Manual review missed the issue
- `DEPENDENCY_ISSUE`: External dependency change caused failure
- `ENVIRONMENT_DIFFERENCE`: Dev/prod environment mismatch
- `UNKNOWN`: Cannot determine root cause

**Classification Trigger:** RabbitMQ consumer listens for `production-error-detected` event:

```typescript
interface ProductionErrorDetectedEvent {
  production_error_id: string;
  application: string;
  error_fingerprint: string; // Used to match with ticket context
  ticket_id?: string; // May be null if auto-detection fails
  severity: ErrorSeverity;
  occurred_at: Date;
}
```

**Auto-Linking Logic:**

1. If `ticket_id` provided in event → direct link
2. Otherwise, match via `error_fingerprint` against recent deployments
3. If no match found → create escape record with `ticket_id: null` for manual review

---

### AC#2: Bug Escape Rate Calculation API

**Given** I am a Lead QA with appropriate permissions  
**When** I query the bug escape metrics endpoint  
**Then** I receive calculated bug escape rates with the following aggregations:

**Overall Rate:**

```
bug_escape_rate = (production_errors / total_deployed_tickets) × 100
```

**Time-Based Filtering:**

- Date range (start_date, end_date)
- Predefined periods: `7d`, `30d`, `90d`, `ytd`

**Dimension Breakdowns:**

- By AI Provider (Cursor, Claude Code)
- By Project
- By Complexity Score buckets (0-5, 6-10, 11-15, 16+)
- By Escape Category

**Endpoint:** `GET /api/v1/qa-metrics/bug-escapes`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `period` | string | No | `7d`, `30d`, `90d`, `ytd`, or custom range |
| `start_date` | date | No | ISO 8601 date (required if period=custom) |
| `end_date` | date | No | ISO 8601 date (required if period=custom) |
| `project_id` | UUID | No | Filter by specific project |
| `group_by` | enum | No | `provider`, `project`, `complexity`, `category` |

**Response:** `200 OK`

```json
{
  "period": "30d",
  "summary": {
    "total_deployed": 145,
    "total_escapes": 7,
    "escape_rate_percent": 4.83,
    "target_rate_percent": 5.0,
    "status": "within_target"
  },
  "breakdown": [
    {
      "dimension": "cursor",
      "deployed_count": 89,
      "escape_count": 5,
      "escape_rate_percent": 5.62
    },
    {
      "dimension": "claude",
      "deployed_count": 56,
      "escape_count": 2,
      "escape_rate_percent": 3.57
    }
  ],
  "trend": {
    "direction": "improving",
    "previous_period_rate": 6.2,
    "change_percent": -22.1
  }
}
```

**Error Responses:**
| Status | Description | Example |
|--------|-------------|---------|
| `400` | Invalid date range | `{ "message": "start_date must be before end_date" }` |
| `403` | Forbidden - insufficient role | `{ "message": "Requires QA or ADMIN role" }` |
| `404` | Project not found | `{ "message": "Project {id} not found" }` |
| `429` | Rate limit exceeded | `{ "message": "Too many requests" }` |

---

### AC#3: Quality Trends Dashboard API

**Given** I am a Lead QA  
**When** I access the quality trends endpoint  
**Then** I receive time-series data for visualizing trends:

**Endpoint:** `GET /api/v1/qa-metrics/quality-trends`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `metric` | enum | Yes | `escape_rate`, `coverage`, `test_pass_rate`, `review_findings` |
| `granularity` | enum | No | `daily`, `weekly`, `monthly` (default: weekly) |
| `period` | string | No | `30d`, `90d`, `6m`, `1y` (default: 90d) |
| `project_id` | UUID | No | Filter by project |

**Response:** `200 OK`

```json
{
  "metric": "escape_rate",
  "granularity": "weekly",
  "data_points": [
    {
      "period_start": "2026-01-01",
      "period_end": "2026-01-07",
      "deployed_count": 32,
      "escape_count": 2,
      "value": 6.25,
      "target": 5.0
    },
    {
      "period_start": "2026-01-08",
      "period_end": "2026-01-14",
      "deployed_count": 45,
      "escape_count": 1,
      "value": 2.22,
      "target": 5.0
    }
  ],
  "statistics": {
    "average": 4.15,
    "median": 3.75,
    "min": 2.22,
    "max": 6.25,
    "standard_deviation": 1.42
  }
}
```

---

### AC#4: Bug Escape Detail View

**Given** I am investigating a specific bug escape  
**When** I access the escape details endpoint  
**Then** I receive comprehensive information about the escape:

**Endpoint:** `GET /api/v1/qa-metrics/bug-escapes/:escape_id`

**Response includes:**

- Full production error details (stack trace, severity)
- Original ticket information (ClickUp ID, title, complexity)
- AI execution details (provider, prompts, completion)
- QA results that passed (linting, test, coverage metrics)
- Lead QA review record from `QaReviewQueue` (if applicable - reviewer, findings, duration)
- Production approval record (approver, timestamp, override status)
- Timeline of events from ticket creation to production fix

---

### AC#5: AI Provider Quality Comparison

**Given** I want to compare AI tool effectiveness  
**When** I query the provider comparison endpoint  
**Then** I receive comparative metrics:

**Endpoint:** `GET /api/v1/qa-metrics/provider-comparison`

**Response includes per provider:**

- Total tickets processed
- Bug escape rate
- Average complexity of escaped bugs
- Most common escape categories
- Trend direction (improving/declining)

---

### AC#6: Alerting for Escape Rate Thresholds

**Given** the bug escape rate exceeds configurable thresholds  
**When** the threshold is breached  
**Then** the system:

1. Logs an alert via `AIDecisionLoggerService` (Story 11.2)
2. Increments Prometheus counter `bug_escape_threshold_breaches_total`
3. Triggers notification to Lead QA role users

**Threshold Configuration (default):**

- WARNING: Escape rate >4% (approaching 5% target)
- CRITICAL: Escape rate >5% (target exceeded)

---

### AC#7: Data Retention & Archival

**Given** historical bug escape data  
**When** data is older than retention period  
**Then:**

- Raw data retained for 2 years
- Aggregated metrics retained indefinitely
- Automatic archival of detailed trace data after 1 year

---

## Technical Design

### Database Schema

**Enum: ErrorSeverity** (reused from ProductionError model)

```prisma
enum ErrorSeverity {
  CRITICAL
  HIGH
  MEDIUM
  LOW
}
```

**New Model: BugEscape**

```prisma
model BugEscape {
  id                      String   @id @default(uuid())

  // Traceability links
  production_error_id     String   @unique
  production_error        ProductionError @relation(fields: [production_error_id], references: [id])

  ticket_id               String
  ticket                  Ticket   @relation(fields: [ticket_id], references: [id])

  execution_id            String?
  execution               Execution? @relation(fields: [execution_id], references: [id])

  qa_result_id            String?
  qa_result               QaResult? @relation(fields: [qa_result_id], references: [id])

  qa_review_queue_id      String?  // Link to QaReviewQueue from Story 8.1
  qa_review_queue         QaReviewQueue? @relation(fields: [qa_review_queue_id], references: [id])

  // Classification
  escape_category         EscapeCategory
  severity_at_detection   ErrorSeverity

  // Metrics
  detected_at             DateTime
  resolved_at             DateTime?
  resolution_time_hours   Float?

  // Metadata
  project_id              String
  ai_provider             String?  // cursor, claude, etc.
  complexity_score        Int?

  created_at              DateTime @default(now())

  // Indexes for performance
  @@index([project_id, detected_at])
  @@index([detected_at])           // For time-series queries without project filter
  @@index([escape_category])
  @@index([ai_provider, detected_at])
  @@map("bug_escapes")
}

enum EscapeCategory {
  LINTING_MISS
  TEST_GAP
  COVERAGE_BLINDSPOT
  AI_GENERATION_ERROR
  REVIEW_FAILURE
  DEPENDENCY_ISSUE
  ENVIRONMENT_DIFFERENCE
  UNKNOWN
}
```

### DTO Specifications

**BugEscapeQueryDto** (`src/qa-automation/bug-escape/dto/bug-escape-query.dto.ts`)

```typescript
export class BugEscapeQueryDto {
  @ApiPropertyOptional({
    description: 'Predefined period',
    enum: ['7d', '30d', '90d', 'ytd', 'custom'],
  })
  @IsOptional()
  @IsEnum(['7d', '30d', '90d', 'ytd', 'custom'])
  period?: string = '30d';

  @ApiPropertyOptional({ description: 'Start date (ISO 8601)', example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @ApiPropertyOptional({ description: 'End date (ISO 8601)', example: '2026-01-31' })
  @IsOptional()
  @IsDateString()
  end_date?: string;

  @ApiPropertyOptional({ description: 'Filter by project ID' })
  @IsOptional()
  @IsUUID()
  project_id?: string;

  @ApiPropertyOptional({
    description: 'Group by dimension',
    enum: ['provider', 'project', 'complexity', 'category'],
  })
  @IsOptional()
  @IsEnum(['provider', 'project', 'complexity', 'category'])
  group_by?: string;

  @ApiPropertyOptional({ description: 'Page number', minimum: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Page size', minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;
}
```

**QualityTrendsQueryDto** (`src/qa-automation/bug-escape/dto/quality-trends-query.dto.ts`)

```typescript
export class QualityTrendsQueryDto {
  @ApiProperty({
    description: 'Metric to trend',
    enum: ['escape_rate', 'coverage', 'test_pass_rate', 'review_findings'],
  })
  @IsEnum(['escape_rate', 'coverage', 'test_pass_rate', 'review_findings'])
  metric: string;

  @ApiPropertyOptional({
    description: 'Time granularity',
    enum: ['daily', 'weekly', 'monthly'],
    default: 'weekly',
  })
  @IsOptional()
  @IsEnum(['daily', 'weekly', 'monthly'])
  granularity?: string = 'weekly';

  @ApiPropertyOptional({
    description: 'Time period',
    enum: ['30d', '90d', '6m', '1y'],
    default: '90d',
  })
  @IsOptional()
  @IsEnum(['30d', '90d', '6m', '1y'])
  period?: string = '90d';

  @ApiPropertyOptional({ description: 'Filter by project ID' })
  @IsOptional()
  @IsUUID()
  project_id?: string;
}
```

### Service Architecture

**BugEscapeService** (`src/qa-automation/bug-escape/bug-escape.service.ts`)

- `@Cacheable({ ttl: 300 }) calculateEscapeRate(filters)` - Cache 5 min for performance
- `classifyEscape(productionErrorId): Promise<BugEscape>` - Creates escape record with classification
- `getQualityTrends(metric, granularity): Promise<TrendData[]>` - Time-series trend data
- `getEscapeDetails(escapeId): Promise<BugEscapeDetail>` - Full traceability view
- `compareProviders(period): Promise<ProviderComparison[]>` - AI tool effectiveness comparison

**BugEscapeAnalyzer** (`src/qa-automation/bug-escape/bug-escape-analyzer.service.ts`)

- `determineEscapeCategory(productionError, qaResult): EscapeCategory` - Root cause classification
- `analyzeTrendDirection(current, previous): TrendDirection` - Trend analysis
- `calculateResolutionTime(escape): number` - Time-to-fix metrics

**BugEscapeController** (`src/qa-automation/bug-escape/bug-escape.controller.ts`)

- `GET /api/v1/qa-metrics/bug-escapes` - List/query escapes with filters
- `GET /api/v1/qa-metrics/bug-escapes/:id` - Single escape details
- `GET /api/v1/qa-metrics/quality-trends` - Trend data
- `GET /api/v1/qa-metrics/provider-comparison` - Provider comparison

### Integration Points

1. **Production Monitoring Integration** (Epic 9):
   - Listen for new `ProductionError` records via RabbitMQ `production-error-detected` queue
   - Trigger automatic escape classification via `BugEscapeConsumer`

2. **QA Review Queue** (Story 8.1):
   - Link escapes to `QaReviewQueue` records (not `QaReview` - verify table name from Story 8.1)
   - Identify review failures when `qa_review_queue.status = 'approved'` but escape occurred

3. **AI Decision Logger** (Story 11.2):
   - Log threshold breach alerts with context
   - Audit trail for quality decisions

4. **Prometheus Metrics** (Story 1.8, 3.8):
   ```
   bug_escapes_total{category, provider, project_id}
   bug_escape_rate_percent{project_id}
   bug_escape_threshold_breaches_total{threshold_type}
   bug_escape_resolution_time_hours{category}
   ```

### Root Cause Classification Logic

**Classification Algorithm:** (`src/qa-automation/bug-escape/bug-escape-analyzer.service.ts`)

```typescript
function determineEscapeCategory(
  error: ProductionError,
  qaResult: QaResult,
  reviewQueue?: QaReviewQueue,
): EscapeCategory {
  // 1. No QA result - cannot classify
  if (!qaResult) return EscapeCategory.UNKNOWN;

  // 2. Extract affected files from stack trace
  const affectedFiles = extractFilesFromStackTrace(error.stack_trace);

  // 3. Check coverage blindspot - files affected but not covered
  const coverageData = qaResult.coverage as { covered_files?: string[]; percentage?: number };
  if (coverageData?.covered_files && affectedFiles.length > 0) {
    const uncoveredAffectedFiles = affectedFiles.filter(
      (f) => !coverageData.covered_files!.includes(f),
    );
    if (uncoveredAffectedFiles.length > 0) {
      return EscapeCategory.COVERAGE_BLINDSPOT;
    }
  }

  // 4. Check test gaps - tests exist but didn't catch this scenario
  const testResults = qaResult.test_results as { failed_tests?: string[]; test_files?: string[] };
  if (testResults?.test_files && affectedFiles.length > 0) {
    const testedFiles = testResults.test_files;
    const hasTestsButFailed = affectedFiles.some((f) =>
      testedFiles.some((tf: string) => f.includes(tf) || tf.includes(f)),
    );
    if (hasTestsButFailed && testResults.failed_tests?.length === 0) {
      return EscapeCategory.TEST_GAP;
    }
  }

  // 5. Check linting misses - linting passed but logic error
  const lintingResult = qaResult.linting as { passed: boolean; errors?: unknown[] };
  if (lintingResult?.passed && isLogicError(error)) {
    return EscapeCategory.LINTING_MISS;
  }

  // 6. Check manual review failure
  if (reviewQueue?.status === 'approved') {
    return EscapeCategory.REVIEW_FAILURE;
  }

  // 7. Check for dependency/environment patterns
  if (isDependencyError(error)) {
    return EscapeCategory.DEPENDENCY_ISSUE;
  }
  if (isEnvironmentError(error)) {
    return EscapeCategory.ENVIRONMENT_DIFFERENCE;
  }

  return EscapeCategory.UNKNOWN;
}

// Helper: Extract file paths from stack trace
function extractFilesFromStackTrace(stackTrace?: string | null): string[] {
  if (!stackTrace) return [];
  const fileRegex = /(?:at\s+.*?\s+\()?([^\s(]+\.(?:ts|js|tsx|jsx)):\d+:\d+\)?/g;
  const matches = [...stackTrace.matchAll(fileRegex)];
  return [...new Set(matches.map((m) => m[1]))];
}

// Helper: Check if error is a logic error (not syntax/runtime)
function isLogicError(error: ProductionError): boolean {
  const logicPatterns = [
    /TypeError.*undefined/i,
    /TypeError.*null/i,
    /ReferenceError.*is not defined/i,
    /AssertionError/i,
  ];
  return logicPatterns.some((p) => p.test(error.error_message));
}

// Helper: Check for dependency-related errors
function isDependencyError(error: ProductionError): boolean {
  const depPatterns = [
    /MODULE_NOT_FOUND/i,
    /Cannot find module/i,
    /Error: Cannot resolve/i,
    /npm ERR/i,
  ];
  return depPatterns.some((p) => p.test(error.error_message));
}

// Helper: Check for environment-specific errors
function isEnvironmentError(error: ProductionError): boolean {
  const envPatterns = [
    /ECONNREFUSED.*localhost/i,
    /ENOTFOUND.*internal/i,
    /ENV.*not set/i,
    /process\.env/i,
  ];
  return envPatterns.some((p) => p.test(error.error_message));
}
```

---

## Tasks / Subtasks

- [ ] **Database Schema** (AC: #1)
  - [ ] Create `BugEscape` model in Prisma schema
  - [ ] Add `EscapeCategory` enum
  - [ ] Add `ErrorSeverity` enum (if not exists)
  - [ ] Create migration file
  - [ ] Generate Prisma client
  - [ ] **Verify:** `QaReviewQueue` table name from Story 8.1 (not `QaReview`)

- [ ] **DTO Implementation** (AC: #2, #3)
  - [ ] Create `BugEscapeQueryDto` with validation
  - [ ] Create `QualityTrendsQueryDto` with validation
  - [ ] Create `EscapeRateResponseDto` for API responses
  - [ ] Create `BugEscapeDetailDto` for detail view

- [ ] **Core Service Implementation** (AC: #1, #2, #3)
  - [ ] Create `BugEscapeService` with classification logic
  - [ ] Create `BugEscapeAnalyzer` with helper functions
  - [ ] Implement `classifyEscape()` method with traceability linking
  - [ ] Implement `calculateEscapeRate()` with `@Cacheable({ ttl: 300 })`
  - [ ] Implement `getQualityTrends()` time-series query

- [ ] **REST API Controller** (AC: #2, #3, #4, #5)
  - [ ] Create `BugEscapeController` with all endpoints
  - [ ] Add RBAC (`Role.QA`, `Role.ADMIN`)
  - [ ] Add rate limiting (ThrottlerGuard: 100 req/min for list, 20 req/min for trends)
  - [ ] Add Swagger documentation with `@ApiResponse` for error cases

- [ ] **Production Monitoring Integration** (AC: #1)
  - [ ] Create `BugEscapeConsumer` for RabbitMQ
  - [ ] Define `ProductionErrorDetectedEvent` interface
  - [ ] Implement auto-linking logic (direct match + fingerprint match)
  - [ ] Handle orphaned errors (no ticket match)

- [ ] **Prometheus Metrics** (AC: #6)
  - [ ] Add metric providers to `QaMetricsService`
  - [ ] Register counters and histograms
  - [ ] Implement threshold breach detection

- [ ] **Alerting Integration** (AC: #6)
  - [ ] Integrate with `AIDecisionLoggerService`
  - [ ] Log threshold breaches with context
  - [ ] Create alert notification service

- [ ] **Unit Tests**
  - [ ] `BugEscapeService` tests (classification, rate calculation)
  - [ ] `BugEscapeAnalyzer` tests (trend analysis, helper functions)
  - [ ] Controller tests (endpoints, guards, validation)
  - [ ] Integration tests (traceability linking)

- [ ] **Documentation**
  - [ ] Update API documentation (Swagger)
  - [ ] Add metrics documentation
  - [ ] Document classification algorithm

---

## Dev Notes

### Architecture Compliance

- **Module Structure:** Create `bug-escape/` subdirectory under `src/qa-automation/`
- **RBAC:** Use existing `RolesGuard` with `Role.QA` and `Role.ADMIN`
- **Rate Limiting:** Apply `ThrottlerGuard` (100 req/min for list, 20 req/min for trends)
- **Database:** Follow existing Prisma patterns with proper indexes
- **Caching:** Use `@Cacheable` decorator from `@nestjs/cache-manager` (5 min TTL for escape rates)
- **Metrics:** Extend existing `QaMetricsService` from Story 3.8

### Dependencies

- Story 3.5: Quality Gate Decision Engine (`QaResult` model)
- Story 3.6: QA Results Storage (database schema, interfaces)
- Story 8.1: QA Review Queue (`QaReviewQueue` table - verify exact name)
- Story 8.3: Production Approval (approval audit trail)
- Story 11.2: AI Decision Audit Logger (alert logging)
- Story 1.8: Prometheus Metrics (infrastructure)
- Epic 9: Production Monitoring (`ProductionError` source)

### Testing Approach

1. **Unit Tests:** Mock Prisma, test classification logic, rate calculations
2. **Integration Tests:** Test traceability linking across `BugEscape`, `QaResult`, `QaReviewQueue` models
3. **E2E Tests:** Full flow from `ProductionError` event to escape record creation

### Performance Considerations

- Database queries use composite indexes (`project_id + detected_at`)
- Standalone `detected_at` index for time-series queries
- **Cache escape rate calculations for 5 minutes** using `@Cacheable({ ttl: 300 })`
- Time-series queries aggregate at DB level using Prisma `groupBy`

### Security Considerations

- Stack traces in detailed view require `QA` or `ADMIN` role
- Production error data is sensitive - access is audit-logged via `AIDecisionLogger`
- Escape classification is immutable after creation (prevent tampering)

---

## References

- **FR40:** Lead QA can track bug escape rates and quality trends over time [Source: _bmad-output/planning-artifacts/epics.md#Lead-QA-Capabilities]
- **FR110:** Lead QA can see quality trends over time [Source: _bmad-output/planning-artifacts/epics.md#Quality-Dashboard]
- **PRD:** Bug escape rate <5% quality threshold [Source: _bmad-output/planning-artifacts/prd.md]
- **Architecture:** `ProductionError` model schema [Source: _bmad-output/planning-artifacts/architecture.md#Production-Monitoring]
- **Story 8.1:** QA Review Queue API patterns (`QaReviewQueue` table) [Source: _bmad-output/implementation-artifacts/8-1-qa-review-queue-sampling-configuration.md]
- **Story 3.6:** `QaResult` interfaces and patterns [Source: _bmad-output/implementation-artifacts/3-6-qa-results-storage-retrieval.md]
- **Story 3.8:** QA Metrics Prometheus integration [Source: _bmad-output/implementation-artifacts/3-8-qa-metrics-prometheus-integration.md]

---

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

- `prisma/schema.prisma` - BugEscape model + EscapeCategory enum + ErrorSeverity enum
- `prisma/migrations/XXXXXXXXXXXXXX_add_bug_escape/migration.sql` - Database migration
- `src/qa-automation/bug-escape/bug-escape.service.ts` - Core service (300+ LOC)
- `src/qa-automation/bug-escape/bug-escape-analyzer.service.ts` - Analysis logic with helpers (150+ LOC)
- `src/qa-automation/bug-escape/bug-escape.controller.ts` - REST API endpoints
- `src/qa-automation/bug-escape/bug-escape.module.ts` - NestJS module
- `src/qa-automation/bug-escape/dto/bug-escape-query.dto.ts` - Query DTO
- `src/qa-automation/bug-escape/dto/quality-trends-query.dto.ts` - Trends query DTO
- `src/qa-automation/bug-escape/dto/escape-rate-response.dto.ts` - Response DTOs
- `src/qa-automation/bug-escape/dto/bug-escape-detail.dto.ts` - Detail view DTO
- `src/qa-automation/bug-escape/interfaces/bug-escape.interface.ts` - TypeScript interfaces
- `src/qa-automation/bug-escape/interfaces/production-error-detected.event.ts` - RabbitMQ event interface
- `src/qa-automation/bug-escape/bug-escape.consumer.ts` - RabbitMQ consumer
- `src/qa-automation/bug-escape/bug-escape.service.spec.ts` - Unit tests
- `src/qa-automation/bug-escape/bug-escape.controller.spec.ts` - Controller tests
- `src/qa-automation/qa-metrics/qa-metrics.service.ts` - Extended with new metrics
- `src/qa-automation/qa-automation.module.ts` - Updated module imports
