# Story 8.8: Quality Review Metrics & QA Workload

**Epic:** 8 - Lead QA Manual Review Workflow  
**Status:** ready-for-dev  
**Priority:** High  
**Estimation:** 2 days  
**Story Points:** 3

---

## Story

As a Lead QA,  
I want to view workload metrics and capacity analytics for the QA review process,  
so that I can monitor my productivity, identify bottlenecks, and ensure the review queue is properly staffed to meet SLAs.

---

## Context

**Purpose:** The QA Workload Metrics system provides visibility into the Lead QA team's review capacity, processing rates, and queue health. This complements the quality metrics from Stories 8.5-8.7 with operational metrics about the review process itself.

**Requirements:** FR49 (Workforce Management - QA capacity), FR43 (Quality reports)

**Existing Infrastructure:**

- `QaReviewQueue` model (Story 8.1) - manual review records with timestamps, decisions, and reviewer tracking
- `ProductionApproval` model (Story 8.3) - approval audit trail
- `BugEscape` model (Story 8.5) - escaped defects with review linkage
- `QualityDashboardService` (Story 8.6) - existing aggregation patterns
- `User` model - reviewer identity and role information

---

## Acceptance Criteria

### AC#1: QA Workload Summary API

**Given** I am a Lead QA or Manager with appropriate permissions  
**When** I access the QA workload summary endpoint  
**Then** I receive comprehensive workload metrics:

**Endpoint:** `GET /api/v1/qa-workload/summary`

**Response:** `200 OK`

```json
{
  "period": "30d",
  "summary": {
    "total_reviews_completed": 156,
    "total_reviews_pending": 23,
    "reviews_by_decision": {
      "approved": 142,
      "rejected": 12,
      "escalated": 2
    },
    "avg_review_time_minutes": 18.5,
    "median_review_time_minutes": 12.0,
    "sla_compliance_percent": 94.2,
    "reviews_per_day_average": 7.8
  },
  "queue_health": {
    "current_depth": 23,
    "oldest_pending_hours": 4.5,
    "avg_wait_time_hours": 2.3,
    "at_risk_count": 3,
    "trend": "stable"
  },
  "capacity": {
    "active_reviewers": 2,
    "target_reviews_per_day": 10,
    "current_utilization_percent": 78.0,
    "projected_clear_time_hours": 6.2
  }
}
```

**Error Responses:**
| Status | Description | Example |
|--------|-------------|---------|
| `403` | Forbidden - insufficient role | `{ "message": "Requires QA, ADMIN, or MANAGER role" }` |

**SLA Definition:** Reviews completed within 24 hours of entering the queue (configurable per Story 8.4 quality gates).

---

### AC#2: Reviewer Performance Metrics API

**Given** I am a Lead QA or Manager  
**When** I query the reviewer performance endpoint  
**Then** I receive per-reviewer productivity and quality metrics:

**Endpoint:** `GET /api/v1/qa-workload/reviewer-performance`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `period` | string | No | `7d`, `30d`, `90d` (default: `30d`) |
| `reviewer_id` | UUID | No | Filter by specific reviewer (optional) |

**Response:** `200 OK`

```json
{
  "period": "30d",
  "reviewers": [
    {
      "reviewer_id": "uuid-1",
      "reviewer_name": "Alice LeadQA",
      "role": "LEAD_QA",
      "metrics": {
        "reviews_completed": 98,
        "reviews_pending": 12,
        "avg_review_time_minutes": 15.2,
        "approval_rate_percent": 89.8,
        "rejection_rate_percent": 8.2,
        "escalation_rate_percent": 2.0,
        "sla_compliance_percent": 96.9,
        "bug_escapes_caught": 7,
        "false_positive_rate": 3.2
      },
      "daily_pattern": {
        "peak_hours": ["09:00-11:00", "14:00-16:00"],
        "avg_reviews_per_day": 6.5
      },
      "trend": "improving"
    },
    {
      "reviewer_id": "uuid-2",
      "reviewer_name": "Bob QA",
      "role": "QA",
      "metrics": {
        "reviews_completed": 58,
        "reviews_pending": 11,
        "avg_review_time_minutes": 24.1,
        "approval_rate_percent": 94.8,
        "sla_compliance_percent": 91.4
      },
      "trend": "stable"
    }
  ],
  "aggregates": {
    "total_reviewers": 2,
    "team_avg_review_time": 18.5,
    "team_sla_compliance": 94.2
  }
}
```

**Metrics Definitions:**

| Metric                | Calculation                                                                    |
| --------------------- | ------------------------------------------------------------------------------ |
| `avg_review_time`     | `AVG(completed_at - assigned_at)` for completed reviews (from `QaReviewQueue`) |
| `approval_rate`       | `(approved / total_completed) × 100`                                           |
| `bug_escapes_caught`  | Reviews that rejected code that later had confirmed bug escapes                |
| `false_positive_rate` | Reviews rejected but later approved after minor changes                        |

**RBAC Guard Pattern:**

```typescript
@Controller('/api/v1/qa-workload')
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
@ApiTags('QA Workload')
export class QAWorkloadController {
  @Get('summary')
  @Roles(Role.QA, Role.ADMIN, Role.MANAGER)
  @Throttle(100, 60) // 100 requests per minute
  async getSummary(@Query() query: WorkloadSummaryQueryDto) { ... }
}
```

---

### AC#3: Queue Depth & Flow Metrics API

**Given** I need to analyze queue throughput  
**When** I access the queue flow metrics endpoint  
**Then** I receive time-series data about queue dynamics:

**Endpoint:** `GET /api/v1/qa-workload/queue-flow`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `period` | string | No | `24h`, `7d`, `30d` (default: `7d`) |
| `granularity` | string | No | `hour`, `day` (default: `day`) |

**Response:** `200 OK`

```json
{
  "period": "7d",
  "granularity": "day",
  "data_points": [
    {
      "timestamp": "2026-02-01T00:00:00Z",
      "inflow_count": 24,
      "outflow_count": 22,
      "net_change": 2,
      "ending_depth": 18,
      "avg_wait_time_hours": 2.1,
      "sla_breaches": 1
    },
    {
      "timestamp": "2026-02-02T00:00:00Z",
      "inflow_count": 28,
      "outflow_count": 31,
      "net_change": -3,
      "ending_depth": 15,
      "avg_wait_time_hours": 1.8,
      "sla_breaches": 0
    }
  ],
  "summary": {
    "total_inflow": 156,
    "total_outflow": 148,
    "avg_daily_inflow": 22.3,
    "avg_processing_rate": 21.1,
    "peak_inflow_day": "2026-02-04",
    "peak_inflow_count": 35
  }
}
```

---

### AC#4: Workload Alert Configuration & Notifications

**Given** workload thresholds are configured  
**When** a threshold is breached  
**Then** appropriate alerts are triggered:

**Alert Conditions:** (Thresholds configurable via `QualityGateConfig`)

| Alert Type             | Condition                               | Severity | Default Threshold |
| ---------------------- | --------------------------------------- | -------- | ----------------- |
| `QUEUE_DEPTH_HIGH`     | Pending reviews > threshold             | warning  | 30                |
| `QUEUE_DEPTH_CRITICAL` | Pending reviews > threshold             | critical | 50                |
| `SLA_BREACH_RISK`      | Reviews approaching SLA limit           | warning  | SLA - 4h          |
| `SLA_BREACH`           | Reviews exceeding SLA                   | critical | 24h               |
| `REVIEWER_OVERLOAD`    | Individual reviewer pending > threshold | warning  | 15                |
| `CAPACITY_SHORTFALL`   | Projected clear time > threshold        | warning  | 12h               |

**Alert Payload:**

```json
{
  "alert_id": "uuid",
  "type": "QUEUE_DEPTH_HIGH",
  "severity": "warning",
  "message": "Review queue depth (32) exceeds threshold (30)",
  "current_value": 32,
  "threshold": 30,
  "timestamp": "2026-02-04T14:30:00Z",
  "recommended_action": "Consider reassigning QA resources or escalating to Manager"
}
```

**Integration Points:**

1. Prometheus counter `qa_workload_alerts_total` increments per alert
2. Alert is logged via `AIDecisionLoggerService` (Story 11.2)
3. WebSocket event `qa-workload-alert` emitted via `DashboardGateway`
4. Optional: Slack/email notification for critical alerts

---

### AC#5: Workload Report Export

**Given** I need to share workload analytics  
**When** I request an export  
**Then** I receive a downloadable report:

**Endpoint:** `GET /api/v1/qa-workload/export`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | enum | Yes | `pdf`, `csv`, `json` |
| `period` | string | No | `7d`, `30d`, `90d` (default: `30d`) |
| `include_reviewer_details` | boolean | No | Include per-reviewer breakdown (default: true) |

**CSV Export Columns:**

```csv
date,reviewer_name,reviews_completed,reviews_rejected,reviews_escalated,avg_review_time_minutes,sla_compliance_percent,bug_escapes_caught
2026-02-01,Alice LeadQA,12,1,0,14.5,100,1
2026-02-01,Bob QA,8,0,0,22.3,100,0
```

---

## Technical Design

### DTO Specifications

**QAWorkloadSummaryDto** (`src/dashboards/dto/qa-workload.dto.ts`)

```typescript
export class QAWorkloadSummaryDto {
  period: string;
  summary: {
    total_reviews_completed: number;
    total_reviews_pending: number;
    reviews_by_decision: {
      approved: number;
      rejected: number;
      escalated: number;
    };
    avg_review_time_minutes: number;
    median_review_time_minutes: number;
    sla_compliance_percent: number;
    reviews_per_day_average: number;
  };
  queue_health: {
    current_depth: number;
    oldest_pending_hours: number;
    avg_wait_time_hours: number;
    at_risk_count: number;
    trend: 'improving' | 'stable' | 'declining';
  };
  capacity: {
    active_reviewers: number;
    target_reviews_per_day: number;
    current_utilization_percent: number;
    projected_clear_time_hours: number;
  };
}

export class ReviewerPerformanceDto {
  reviewer_id: string;
  reviewer_name: string;
  role: string;
  metrics: {
    reviews_completed: number;
    reviews_pending: number;
    avg_review_time_minutes: number;
    approval_rate_percent: number;
    rejection_rate_percent?: number;
    escalation_rate_percent?: number;
    sla_compliance_percent: number;
    bug_escapes_caught?: number;
    false_positive_rate?: number;
  };
  daily_pattern?: {
    peak_hours: string[];
    avg_reviews_per_day: number;
  };
  trend: 'improving' | 'stable' | 'declining';
}

export class QueueFlowDataPointDto {
  timestamp: Date;
  inflow_count: number;
  outflow_count: number;
  net_change: number;
  ending_depth: number;
  avg_wait_time_hours: number;
  sla_breaches: number;
}
```

**Query DTOs:**

```typescript
export class ReviewerPerformanceQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d', '90d'] })
  @IsOptional()
  @IsEnum(['7d', '30d', '90d'])
  period?: string = '30d';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reviewer_id?: string;
}

export class QueueFlowQueryDto {
  @ApiPropertyOptional({ enum: ['24h', '7d', '30d'] })
  @IsOptional()
  @IsEnum(['24h', '7d', '30d'])
  period?: string = '7d';

  @ApiPropertyOptional({ enum: ['hour', 'day'] })
  @IsOptional()
  @IsEnum(['hour', 'day'])
  granularity?: string = 'day';
}
```

### Service Architecture

**QAWorkloadService** (`src/dashboards/services/qa-workload.service.ts`)

- `@Cacheable({ ttl: 180 }) getSummary(period)` - Workload summary with 3-minute cache
- `getReviewerPerformance(query)` - Per-reviewer metrics
- `getQueueFlow(query)` - Time-series queue data
- `calculateSLACompliance()` - SLA breach detection
- `generateExport(format, filters)` - Report generation
- `checkWorkloadAlerts()` - Threshold monitoring

**QAWorkloadController** (`src/dashboards/qa-workload.controller.ts`)

- `GET /api/v1/qa-workload/summary` - Workload summary
- `GET /api/v1/qa-workload/reviewer-performance` - Reviewer metrics
- `GET /api/v1/qa-workload/queue-flow` - Queue dynamics
- `GET /api/v1/qa-workload/export` - Report export

### Database Queries

**Key Aggregations:**

```typescript
// AC#1, AC#2: Review counts by decision (from QaReviewQueue model)
const reviewStats = await prisma.qaReviewQueue.groupBy({
  by: ['decision', 'reviewed_by'],
  where: {
    status: 'COMPLETED',
    completed_at: { gte: periodStart },
    reviewed_by: { not: null },
    decision: { not: null },
  },
  _count: { id: true },
});

// AC#2: Average review time calculation
const avgReviewTime = await prisma.qaReviewQueue.aggregate({
  where: {
    status: 'COMPLETED',
    completed_at: { gte: periodStart },
    decision: { not: null },
  },
  _avg: {
    review_duration_minutes: true,
  },
});

// Queue depth snapshot
const pendingCount = await prisma.qaReviewQueue.count({
  where: {
    status: { in: ['PENDING', 'IN_REVIEW'] },
  },
});

// Oldest pending review
const oldestPending = await prisma.qaReviewQueue.findFirst({
  where: {
    status: { in: ['PENDING', 'IN_REVIEW'] },
  },
  orderBy: { created_at: 'asc' },
});
```

### Integration Points

1. **QaReviewQueue Service** (Story 8.1):
   - Query queue depth and pending status
   - Track review assignment timestamps

2. **QaReviewQueue Service** (Story 8.1):
   - Query review decisions and outcomes (stored in QaReviewQueue model)
   - Calculate review duration metrics

3. **BugEscape Service** (Story 8.5):
   - Correlate escaped bugs with review decisions
   - Calculate "bug escapes caught" metric

4. **QualityDashboardService** (Story 8.6):
   - Share aggregation patterns and caching strategies

5. **AIDecisionLogger** (Story 11.2):
   - Log workload alerts
   - Audit access to workload metrics

6. **Dashboard Gateway** (Real-time):
   - Emit `qa-workload-alert` events
   - Subscribe to queue depth changes

7. **Prometheus Metrics** (register in `dashboards.module.ts` like Story 8.6):
   ```typescript
   // Add to dashboards.module.ts providers:
   {
     provide: 'QA_WORKLOAD_METRICS',
     useFactory: () => ({
       reviewsTotal: new Counter(...),
       queueDepth: new Gauge(...),
       reviewDuration: new Histogram(...),
       slaBreaches: new Counter(...),
       alertsTotal: new Counter(...)
     })
   }
   ```

---

## Tasks / Subtasks

- [ ] **DTO Implementation** (AC: #1, #2, #3)
  - [ ] Create `QAWorkloadSummaryDto`
  - [ ] Create `ReviewerPerformanceDto`
  - [ ] Create `QueueFlowDataPointDto`
  - [ ] Create `WorkloadAlertDto`
  - [ ] Create query DTOs with validation

- [ ] **QA Workload Service** (AC: #1, #2, #3)
  - [ ] Create `QAWorkloadService`
  - [ ] Implement `getSummary()` with caching
  - [ ] Implement `getReviewerPerformance()`
  - [ ] Implement `getQueueFlow()` time-series
  - [ ] Implement `calculateSLACompliance()`
  - [ ] Implement `checkWorkloadAlerts()`

- [ ] **REST API Controller** (AC: #1, #2, #3)
  - [ ] Create `QAWorkloadController`
  - [ ] Add RBAC (`Role.QA`, `Role.ADMIN`, `Role.MANAGER`)
  - [ ] Add rate limiting (100 req/min for summary)
  - [ ] Add Swagger documentation

- [ ] **Alerting & Monitoring** (AC: #4)
  - [ ] Define alert threshold configuration
  - [ ] Implement threshold checking logic
  - [ ] Integrate with `AIDecisionLoggerService`
  - [ ] Add Prometheus metrics for workload
  - [ ] Extend `DashboardGateway` for workload alerts

- [ ] **Export Functionality** (AC: #5)
  - [ ] Implement JSON export
  - [ ] Implement CSV export
  - [ ] ~~PDF export~~ **DEFERRED** - Use JSON for MVP (Story 8.6 pattern)

- [ ] **Unit Tests**
  - [ ] `QAWorkloadService` tests (aggregation, SLA calculation)
  - [ ] Controller tests (endpoints, guards, validation)
  - [ ] Alert threshold tests

- [ ] **Documentation**
  - [ ] Update API documentation (Swagger)
  - [ ] Add workload metrics documentation
  - [ ] Document alert types and thresholds

---

## Dev Notes

### Architecture Compliance

- **Module Structure:** Extend `dashboards/` module with `qa-workload.controller.ts` and `services/qa-workload.service.ts`
- **RBAC:** Use existing `RolesGuard` with `Role.QA`, `Role.ADMIN`, `Role.MANAGER`. Apply `@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)` pattern from Story 8.1
- **Rate Limiting:** Apply `ThrottlerGuard` (100 req/min for summary)
- **Caching:** Use `@Cacheable` decorator with 3-minute TTL for summary data
- **Database:** Follow existing Prisma patterns with proper indexes
- **Metrics:** Extend existing metrics infrastructure

### Dependencies

- Story 8.1: QA Review Queue (queue status, assignment tracking)
- Story 8.2: QA Code Review Interface (review decisions, duration)
- Story 8.3: Production Approval (approval timestamps)
- Story 8.4: Quality Gate Configuration (SLA threshold configuration)
- Story 8.5: Bug Escape Tracking (correlate with review decisions)
- Story 11.2: AI Decision Audit Logger (alert logging)
- Story 1.8: Prometheus Metrics (infrastructure)

### Data Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  QAWorkload     │────▶│  QAWorkload      │────▶│   Prisma DB     │
│  Controller     │     │     Service      │     │ (QaReviewQueue, │
└─────────────────┘     └──────────────────┘     │ QaReviewDecision│
         │                      │                 │  BugEscape)     │
         │                      │                 └─────────────────┘
         │                      │                           ▲
         │                      ▼                           │
         │            ┌──────────────────┐                  │
         │            │  Dashboard       │                  │
         │            │  Gateway         │                  │
         │            └──────────────────┘                  │
         │                      │                           │
         ▼                      ▼                           │
┌─────────────────┐     ┌──────────────────┐               │
│  Alert Service  │     │ AIDecisionLogger │───────────────┘
│  (Thresholds)   │     │  (Story 11.2)    │
└─────────────────┘     └──────────────────┘
```

### Performance Considerations

- **Cache workload summary** for 3 minutes using `@Cacheable({ ttl: 180 })`
- Use database aggregation queries (Prisma `groupBy`, `_avg`, `_count`)
- Leverage existing indexes on `QaReviewQueue.created_at`, `QaReviewQueue.completed_at`
- Queue flow queries may use time-series optimization for larger datasets

### Security Considerations

- Workload data may reveal individual reviewer performance - respect privacy
- Managers can view all reviewer metrics; QA can only view aggregated team data or their own
- All access is audit-logged via `AIDecisionLogger`

### SLA Configuration

The 24-hour SLA is configurable via the Quality Gate Configuration (Story 8.4). The workload service should:

1. Query the configured SLA threshold from `QualityGateConfig`
2. Use a sensible default (24h) if not configured
3. Support per-project SLA overrides

---

## References

- **FR49:** Managers can view team capacity and utilization (PMs, TLs, QA) [Source: _bmad-output/planning-artifacts/epics.md#Workforce-Management]
- **FR43:** Lead QA can generate quality reports for client transparency [Source: _bmad-output/planning-artifacts/epics.md#QA-Metrics-Analysis]
- **Story 8.1:** QA Review Queue API patterns [Source: _bmad-output/implementation-artifacts/8-1-qa-review-queue-sampling-configuration.md]
- **Story 8.2:** QA Code Review Interface [Source: _bmad-output/implementation-artifacts/8-2-qa-code-review-interface.md]
- **Story 8.5:** Bug Escape Tracking (correlation with reviews) [Source: _bmad-output/implementation-artifacts/8-5-bug-escape-tracking-analysis.md]
- **Story 8.6:** Quality Dashboard (aggregation patterns to reuse) [Source: _bmad-output/implementation-artifacts/8-6-quality-metrics-dashboard.md]
- **Story 11.2:** AI Decision Audit Logger [Source: _bmad-output/implementation-artifacts/11-2-ai-decision-audit-logger.md]

---

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

**New Files:**

- `src/dashboards/qa-workload.controller.ts` - REST API controller with RBAC
- `src/dashboards/services/qa-workload.service.ts` - Core service with aggregations
- `src/dashboards/dto/qa-workload.dto.ts` - DTOs (summary, performance, flow, alerts)

**Modified Files:**

- `src/dashboards/dashboards.module.ts` - Add QAWorkload providers and metrics
- `src/dashboards/gateways/dashboard.gateway.ts` - Add workload alert WebSocket events
- `_bmad-output/implementation-artifacts/sprint-status.yaml` - Update story status

**Test Files:**

- `src/dashboards/services/qa-workload.service.spec.ts` - Service unit tests
- `src/dashboards/qa-workload.controller.spec.ts` - Controller unit tests
