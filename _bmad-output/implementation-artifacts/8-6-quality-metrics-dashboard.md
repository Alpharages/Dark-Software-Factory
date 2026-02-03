# Story 8.6: Quality Metrics Dashboard

**Epic:** 8 - Lead QA Manual Review Workflow  
**Status:** ready-for-dev  
**Priority:** High  
**Estimation:** 3 days  
**Story Points:** 5

---

## Story

As a Lead QA,  
I want to view a comprehensive quality metrics dashboard showing bug rates, test coverage, and deployment success,  
so that I can monitor overall code quality, identify trends, and make data-driven decisions about QA process improvements.

---

## Context

**Dashboard Purpose:** The Quality Metrics Dashboard serves as the central hub for Lead QA to monitor all quality-related metrics across projects. It aggregates data from multiple sources including automated QA results (Story 3.5-3.6), bug escape tracking (Story 8.5), quality gates (Story 8.4), and manual QA reviews (Story 8.1-8.3).

**Requirements:** FR109, FR110, FR111 - Quality dashboard with filtering capabilities.

**Existing Infrastructure:**

- `QaResult` model (Story 3.6) - Automated QA outcomes
- `BugEscape` model (Story 8.5) - Production defect tracking
- `QaReviewQueue` model (Story 8.1) - Manual review records
- `QualityGateConfig` model (Story 8.4) - Per-project quality thresholds
- `Ticket` model - Ticket status and metadata
- `Project` model - Project-level aggregation
- Story 8.5 APIs - Bug escape metrics and quality trends endpoints

---

## Acceptance Criteria

### AC#1: Dashboard Summary API

**Given** I am a Lead QA with appropriate permissions  
**When** I access the quality dashboard summary endpoint  
**Then** I receive a comprehensive quality overview:

**Endpoint:** `GET /api/v1/qa-dashboard/summary`

**Response:** `200 OK`

```json
{
  "period": "30d",
  "summary": {
    "total_tickets_processed": 245,
    "tickets_passed_qa": 198,
    "tickets_failed_qa": 47,
    "overall_pass_rate_percent": 80.8,
    "bug_escapes": {
      "total": 7,
      "rate_percent": 3.54,
      "target_percent": 5.0,
      "status": "within_target"
    },
    "avg_test_coverage_percent": 84.2,
    "avg_test_pass_rate_percent": 92.5,
    "pending_reviews": 12,
    "deployment_success_rate_percent": 96.3
  },
  "quality_gates_summary": {
    "projects_configured": 8,
    "projects_using_defaults": 3,
    "average_coverage_threshold": 82.0
  },
  "alerts": [
    {
      "type": "warning",
      "message": "Project 'Alpha' bug escape rate (6.2%) exceeds threshold",
      "project_id": "uuid",
      "metric": "bug_escape_rate"
    }
  ]
}
```

**Error Responses:**
| Status | Description | Example |
|--------|-------------|---------|
| `403` | Forbidden - insufficient role | `{ "message": "Requires QA or ADMIN role" }` |

---

### AC#2: Quality Metrics by Dimension API

**Given** I am a Lead QA  
**When** I query the quality metrics with filters  
**Then** I receive filtered and grouped quality data:

**Endpoint:** `GET /api/v1/qa-dashboard/metrics`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `period` | string | No | `7d`, `30d`, `90d`, `ytd` (default: `30d`) |
| `group_by` | enum | No | `project`, `ai_provider`, `pm`, `project_type` |
| `project_id` | UUID | No | Filter by specific project |
| `ai_provider` | string | No | Filter by AI tool (`cursor`, `claude`) |
| `pm_id` | UUID | No | Filter by Project Manager |
| `page` | number | No | Page number (default: 1) |
| `limit` | number | No | Page size (default: 20, max: 100) |

**Response (grouped by project):** `200 OK`

```json
{
  "period": "30d",
  "group_by": "project",
  "items": [
    {
      "dimension_id": "uuid",
      "dimension_name": "E-commerce Platform",
      "pm_name": "John Doe",
      "metrics": {
        "tickets_processed": 45,
        "qa_pass_rate_percent": 88.9,
        "avg_coverage_percent": 87.5,
        "bug_escapes": 2,
        "bug_escape_rate_percent": 5.0,
        "deployment_success_rate_percent": 95.5
      },
      "trend": "improving",
      "last_updated": "2026-02-04T00:00:00Z"
    },
    {
      "dimension_id": "uuid-2",
      "dimension_name": "Mobile App",
      "pm_name": "Jane Smith",
      "metrics": {
        "tickets_processed": 32,
        "qa_pass_rate_percent": 75.0,
        "avg_coverage_percent": 78.2,
        "bug_escapes": 4,
        "bug_escape_rate_percent": 12.5,
        "deployment_success_rate_percent": 87.5
      },
      "trend": "declining",
      "alert": "Bug escape rate exceeds 5% threshold"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 8,
    "total_pages": 1
  }
}
```

**Grouping Options:**

- `project` - Group by individual projects
- `ai_provider` - Compare Cursor vs Claude Code quality
- `pm` - Group by Project Manager
- `project_type` - Group by project category/type

---

### AC#3: AI Provider Quality Comparison

**Given** I want to compare AI tool effectiveness  
**When** I access the provider comparison endpoint  
**Then** I receive detailed quality metrics per AI provider:

**Endpoint:** `GET /api/v1/qa-dashboard/provider-comparison`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `period` | string | No | `7d`, `30d`, `90d` (default: `30d`) |

**Response:** `200 OK`

```json
{
  "period": "30d",
  "comparison": [
    {
      "provider": "cursor",
      "tickets_processed": 156,
      "qa_pass_rate_percent": 82.1,
      "avg_coverage_percent": 83.5,
      "avg_complexity_score": 7.2,
      "bug_escapes": 5,
      "bug_escape_rate_percent": 3.21,
      "deployment_success_rate_percent": 96.8,
      "common_escape_categories": ["TEST_GAP", "COVERAGE_BLINDSPOT"],
      "trend": "stable"
    },
    {
      "provider": "claude",
      "tickets_processed": 89,
      "qa_pass_rate_percent": 79.8,
      "avg_coverage_percent": 85.2,
      "avg_complexity_score": 8.1,
      "bug_escapes": 2,
      "bug_escape_rate_percent": 2.25,
      "deployment_success_rate_percent": 97.8,
      "common_escape_categories": ["LINTING_MISS"],
      "trend": "improving"
    }
  ],
  "analysis": {
    "better_provider": "claude",
    "key_differences": [
      "Claude has 30% lower bug escape rate",
      "Cursor processes 75% more tickets",
      "Claude achieves higher average coverage"
    ]
  }
}
```

---

### AC#4: Real-time Quality Status WebSocket

**Given** the Lead QA dashboard is open  
**When** quality metrics change  
**Then** the dashboard receives real-time updates:

**WebSocket Event:** `quality-metrics-update`

**Payload:**

```json
{
  "timestamp": "2026-02-04T12:30:00Z",
  "updates": {
    "new_ticket_completed": {
      "ticket_id": "uuid",
      "status": "DEPLOYED",
      "qa_passed": true,
      "coverage_percent": 91.2
    },
    "bug_escape_detected": {
      "escape_id": "uuid",
      "severity": "HIGH",
      "project_id": "uuid",
      "project_name": "E-commerce Platform"
    }
  },
  "summary_delta": {
    "total_tickets_processed": 246,
    "overall_pass_rate_percent": 80.9
  }
}
```

**Integration:** Use existing `DashboardGateway` (`src/dashboards/gateways/dashboard.gateway.ts`)

---

### AC#5: Quality Drill-Down View

**Given** I am investigating a specific project or dimension  
**When** I access the drill-down endpoint  
**Then** I receive detailed quality breakdown:

**Endpoint:** `GET /api/v1/qa-dashboard/drill-down/:dimension_type/:dimension_id`

**Path Parameters:**
| Parameter | Description |
|-----------|-------------|
| `dimension_type` | `project`, `provider`, `pm` |
| `dimension_id` | UUID of the dimension |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `period` | string | No | `7d`, `30d`, `90d` (default: `30d`) |

**Response (for project drill-down):** `200 OK`

```json
{
  "dimension": {
    "type": "project",
    "id": "uuid",
    "name": "E-commerce Platform",
    "pm": "John Doe"
  },
  "period": "30d",
  "overview": {
    "tickets_processed": 45,
    "qa_pass_rate_percent": 88.9,
    "deployment_success_rate_percent": 95.5
  },
  "quality_gates": {
    "config": {
      "min_coverage": 80,
      "min_test_pass_rate": 100,
      "max_complexity": 20
    },
    "effectiveness": {
      "tickets_blocked": 12,
      "tickets_passed": 33,
      "most_common_failure": "coverage_threshold"
    }
  },
  "qa_results_breakdown": {
    "by_category": [
      { "category": "linting", "pass_rate": 95.6, "avg_issues": 2.1 },
      { "category": "testing", "pass_rate": 92.5, "avg_failures": 1.8 },
      { "category": "coverage", "pass_rate": 87.5, "avg_coverage": 87.5 }
    ],
    "by_complexity_bucket": [
      { "bucket": "low (1-5)", "count": 20, "pass_rate": 95.0 },
      { "bucket": "medium (6-10)", "count": 18, "pass_rate": 88.9 },
      { "bucket": "high (11-15)", "count": 6, "pass_rate": 83.3 },
      { "bucket": "critical (16+)", "count": 1, "pass_rate": 50.0 }
    ]
  },
  "bug_escapes": {
    "total": 2,
    "by_category": [
      { "category": "TEST_GAP", "count": 1 },
      { "category": "COVERAGE_BLINDSPOT", "count": 1 }
    ],
    "avg_resolution_time_hours": 4.5
  },
  "recent_tickets": [
    {
      "ticket_id": "uuid",
      "clickup_id": "ABC-123",
      "title": "Fix checkout flow",
      "status": "DEPLOYED",
      "qa_result": "PASSED",
      "coverage_percent": 91.2,
      "processed_at": "2026-02-03T14:20:00Z"
    }
  ]
}
```

---

### AC#6: Quality Scorecards Export

**Given** I need to share quality reports  
**When** I request an export  
**Then** I receive a downloadable quality report:

**Endpoint:** `GET /api/v1/qa-dashboard/export`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | enum | Yes | `pdf`, `csv`, `json` |
| `period` | string | No | `7d`, `30d`, `90d` (default: `30d`) |
| `project_id` | UUID | No | Filter by project (optional) |

**Response:** File download with appropriate content type

**PDF Content Includes:**

- Executive summary with key metrics
- Trend charts (if feasible in PDF)
- Project-by-project breakdown
- AI provider comparison
- Bug escape analysis
- Recommendations based on data

---

### AC#7: Alert Threshold Configuration

**Given** quality metrics exceed configured thresholds  
**When** the threshold is breached  
**Then:**

1. Alert appears in dashboard summary (AC#1)
2. Prometheus counter `quality_dashboard_alerts_total` increments
3. Alert is logged via `AIDecisionLoggerService` (Story 11.2)

**Default Thresholds:**
| Metric | Warning | Critical |
|--------|---------|----------|
| Bug escape rate | >4% | >5% |
| QA pass rate | <85% | <75% |
| Test coverage | <80% | <70% |
| Deployment success | <95% | <90% |

---

## Technical Design

### DTO Specifications

**QualityDashboardSummaryDto** (`src/dashboards/dto/quality-dashboard.dto.ts`)

```typescript
export class QualityDashboardSummaryDto {
  period: string;
  summary: {
    total_tickets_processed: number;
    tickets_passed_qa: number;
    tickets_failed_qa: number;
    overall_pass_rate_percent: number;
    bug_escapes: {
      total: number;
      rate_percent: number;
      target_percent: number;
      status: 'within_target' | 'approaching_target' | 'exceeded';
    };
    avg_test_coverage_percent: number;
    avg_test_pass_rate_percent: number;
    pending_reviews: number;
    deployment_success_rate_percent: number;
  };
  quality_gates_summary: {
    projects_configured: number;
    projects_using_defaults: number;
    average_coverage_threshold: number;
  };
  alerts: QualityAlertDto[];
}

export class QualityAlertDto {
  type: 'warning' | 'critical';
  message: string;
  project_id?: string;
  metric: string;
}
```

**QualityMetricsQueryDto** (`src/dashboards/dto/quality-dashboard.dto.ts`)

```typescript
export class QualityMetricsQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d', '90d', 'ytd'] })
  @IsOptional()
  @IsEnum(['7d', '30d', '90d', 'ytd'])
  period?: string = '30d';

  @ApiPropertyOptional({ enum: ['project', 'ai_provider', 'pm', 'project_type'] })
  @IsOptional()
  @IsEnum(['project', 'ai_provider', 'pm', 'project_type'])
  group_by?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  project_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  ai_provider?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  pm_id?: string;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;
}
```

### Service Architecture

**QualityDashboardService** (`src/dashboards/services/quality-dashboard.service.ts`)

- `@Cacheable({ ttl: 300 }) getSummary()` - Dashboard summary with caching
- `getMetrics(query)` - Filtered/grouped quality metrics
- `getProviderComparison(period)` - AI tool comparison
- `getDrillDown(dimensionType, dimensionId)` - Detailed breakdown
- `generateExport(format, filters)` - Report generation
- `checkAlertThresholds()` - Threshold monitoring

**QualityDashboardController** (`src/dashboards/qa-dashboard.controller.ts`)

- `GET /api/v1/qa-dashboard/summary` - Dashboard summary
- `GET /api/v1/qa-dashboard/metrics` - Filtered metrics
- `GET /api/v1/qa-dashboard/provider-comparison` - AI comparison
- `GET /api/v1/qa-dashboard/drill-down/:type/:id` - Drill-down view
- `GET /api/v1/qa-dashboard/export` - Export reports

### Database Queries

**Key Aggregations:**

```typescript
// Overall QA pass rate
const qaStats = await prisma.qaResult.groupBy({
  by: ['status'],
  where: { created_at: { gte: periodStart } },
  _count: { id: true },
});

// Average coverage by project
const coverageByProject = await prisma.qaResult.groupBy({
  by: ['project_id'],
  where: { created_at: { gte: periodStart } },
  _avg: { coverage_percent: true },
});

// Bug escape rate (from BugEscape model - Story 8.5)
const bugEscapes = await prisma.bugEscape.count({
  where: { detected_at: { gte: periodStart } },
});
```

### Integration Points

1. **Bug Escape Service** (Story 8.5):
   - Reuse `GET /api/v1/qa-metrics/bug-escapes` endpoint internally
   - Leverage `BugEscapeService.calculateEscapeRate()`

2. **QA Results** (Story 3.6):
   - Query `QaResult` model for coverage, test pass rates
   - Aggregate by project, provider, time period

3. **Quality Gates** (Story 8.4):
   - Query `QualityGateConfig` for configuration summary
   - Cross-reference with `QaResult` for effectiveness

4. **AI Decision Logger** (Story 11.2):
   - Log threshold breach alerts
   - Audit dashboard access

5. **Dashboard Gateway** (Real-time):
   - Emit `quality-metrics-update` events
   - Subscribe to ticket status changes

6. **Prometheus Metrics** (Story 1.8, 3.8):
   ```
   quality_dashboard_api_calls_total{endpoint, role}
   quality_dashboard_summary_cache_hits_total
   quality_alerts_triggered_total{severity, metric_type}
   ```

---

## Tasks / Subtasks

- [ ] **DTO Implementation** (AC: #1, #2, #3, #5)
  - [ ] Create `QualityDashboardSummaryDto`
  - [ ] Create `QualityMetricsQueryDto`
  - [ ] Create `QualityAlertDto`
  - [ ] Create `ProviderComparisonDto`
  - [ ] Create `DrillDownResponseDto`
  - [ ] Add validation decorators

- [ ] **Quality Dashboard Service** (AC: #1, #2, #3, #5)
  - [ ] Create `QualityDashboardService`
  - [ ] Implement `getSummary()` with caching (@Cacheable 5 min)
  - [ ] Implement `getMetrics()` with filtering and grouping
  - [ ] Implement `getProviderComparison()`
  - [ ] Implement `getDrillDown()` for detailed views
  - [ ] Implement `checkAlertThresholds()`
  - [ ] Integrate with BugEscapeService for escape metrics

- [ ] **REST API Controller** (AC: #1, #2, #3, #5)
  - [ ] Create `QaDashboardController`
  - [ ] Add RBAC (`Role.QA`, `Role.ADMIN`)
  - [ ] Add rate limiting (100 req/min for summary, 50 req/min for metrics)
  - [ ] Add Swagger documentation

- [ ] **Real-time Updates** (AC: #4)
  - [ ] Extend `DashboardGateway` with quality events
  - [ ] Subscribe to ticket completion events
  - [ ] Subscribe to bug escape detection events
  - [ ] Emit `quality-metrics-update` WebSocket events

- [ ] **Export Functionality** (AC: #6)
  - [ ] Implement JSON export
  - [ ] Implement CSV export
  - [ ] Implement PDF export (optional - can use JSON for MVP)

- [ ] **Alerting & Monitoring** (AC: #7)
  - [ ] Configure default alert thresholds
  - [ ] Integrate with `AIDecisionLoggerService`
  - [ ] Add Prometheus metrics for dashboard usage

- [ ] **Unit Tests**
  - [ ] `QualityDashboardService` tests (aggregation, caching)
  - [ ] Controller tests (endpoints, guards, validation)
  - [ ] Integration tests with BugEscapeService

- [ ] **Documentation**
  - [ ] Update API documentation (Swagger)
  - [ ] Add dashboard metrics documentation
  - [ ] Document WebSocket events

---

## Dev Notes

### Architecture Compliance

- **Module Structure:** Extend `dashboards/` module with `qa-dashboard.controller.ts` and `services/quality-dashboard.service.ts`
- **RBAC:** Use existing `RolesGuard` with `Role.QA` and `Role.ADMIN`
- **Rate Limiting:** Apply `ThrottlerGuard` (100 req/min for summary, 50 req/min for detailed queries)
- **Caching:** Use `@Cacheable` decorator with 5-minute TTL for summary data
- **Database:** Follow existing Prisma patterns with proper indexes
- **Metrics:** Extend existing metrics infrastructure

### Dependencies

- Story 3.5: Quality Gate Decision Engine (QaResult model)
- Story 3.6: QA Results Storage (database schema)
- Story 8.1: QA Review Queue (pending reviews count)
- Story 8.4: Quality Gate Configuration (config summary)
- Story 8.5: Bug Escape Tracking (escape metrics APIs)
- Story 11.2: AI Decision Audit Logger (alert logging)
- Story 1.8: Prometheus Metrics (infrastructure)

### Data Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   QaDashboard   │────▶│ QualityDashboard │────▶│   Prisma DB     │
│   Controller    │     │     Service      │     │  (QaResult,     │
└─────────────────┘     └──────────────────┘     │   BugEscape,    │
         │                      │                 │   Project)      │
         │                      │                 └─────────────────┘
         │                      │                           ▲
         │                      ▼                           │
         │            ┌──────────────────┐                  │
         │            │ BugEscapeService │──────────────────┘
         │            │  (Story 8.5)     │
         │            └──────────────────┘
         │                      │
         ▼                      ▼
┌─────────────────┐     ┌──────────────────┐
│ DashboardGateway│     │ AIDecisionLogger │
│  (WebSocket)    │     │  (Story 11.2)    │
└─────────────────┘     └──────────────────┘
```

### Performance Considerations

- **Cache dashboard summary** for 5 minutes using `@Cacheable({ ttl: 300 })`
- Use database aggregation queries (Prisma `groupBy`, `_avg`, `_count`)
- Leverage existing indexes on `QaResult.project_id`, `QaResult.created_at`
- Pre-aggregate metrics in service layer for complex queries

### Security Considerations

- Dashboard data contains sensitive quality metrics - restrict to QA and ADMIN roles
- All access is audit-logged via `AIDecisionLogger`
- Export functionality respects RBAC (can only export data user has access to)

---

## References

- **FR109:** Lead QA can view quality metrics dashboard (bug rates, test coverage, deployment success) [Source: _bmad-output/planning-artifacts/prd.md#Quality-Dashboard]
- **FR110:** Lead QA can see quality trends over time [Source: _bmad-output/planning-artifacts/prd.md#Quality-Dashboard]
- **FR111:** Lead QA can filter quality data by AI tool, project type, or PM [Source: _bmad-output/planning-artifacts/prd.md#Quality-Dashboard]
- **Architecture:** Quality Dashboard specification [Source: _bmad-output/planning-artifacts/architecture.md#Dashboard-Controllers]
- **Story 8.1:** QA Review Queue API patterns [Source: _bmad-output/implementation-artifacts/8-1-qa-review-queue-sampling-configuration.md]
- **Story 8.4:** Quality Gate Configuration [Source: _bmad-output/implementation-artifacts/8-4-quality-gate-configuration.md]
- **Story 8.5:** Bug Escape Tracking (metrics APIs to reuse) [Source: _bmad-output/implementation-artifacts/8-5-bug-escape-tracking-analysis.md]
- **Story 3.6:** QA Results Storage [Source: _bmad-output/implementation-artifacts/3-6-qa-results-storage-retrieval.md]

---

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

- `src/dashboards/qa-dashboard.controller.ts` - REST API controller
- `src/dashboards/services/quality-dashboard.service.ts` - Core service with aggregations
- `src/dashboards/dto/quality-dashboard.dto.ts` - DTOs (summary, query, alerts, comparison)
- `src/dashboards/quality-dashboard.module.ts` - NestJS module (or extend dashboards.module.ts)
- `src/dashboards/services/quality-dashboard.service.spec.ts` - Unit tests
- `src/dashboards/qa-dashboard.controller.spec.ts` - Controller tests
