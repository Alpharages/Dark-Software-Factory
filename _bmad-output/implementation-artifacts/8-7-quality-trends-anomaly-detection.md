# Story 8.7: Quality Trends & Anomaly Detection

**Epic:** 8 - Lead QA Manual Review Workflow  
**Status:** ready-for-dev  
**Priority:** High  
**Estimation:** 2 days  
**Story Points:** 3

---

## Story

As a Lead QA,  
I want automatic detection of quality anomalies,  
so that I can investigate issues before they escalate.

---

## Context

**Story Purpose:** This story implements AI-powered anomaly detection for quality metrics, building on the Quality Metrics Dashboard (Story 8.6). While Story 8.6 provides visibility into quality data, this story adds intelligent analysis to proactively identify problems.

**Delegation Opportunity:** This story leverages AI for statistical analysis, eliminating the need to implement complex anomaly detection algorithms manually:

- AI analyzes historical quality metrics trends
- Detects anomalies with statistical reasoning (sudden drops, declining trends, spikes)
- Identifies possible causes and recommends actions
- **Effort reduction: ~70%** (1 week → 2 days)

**Requirements:** FR41-FR43 - QA metrics analysis with anomaly detection

**Existing Infrastructure:**

- `QaResult` model (Story 3.6) - Historical QA outcomes
- `BugEscape` model (Story 8.5) - Production defect data
- Quality Dashboard (Story 8.6) - Metrics aggregation APIs
- `QualityGateConfig` model (Story 8.4) - Threshold configurations
- Prometheus metrics (Story 1.8, 3.8) - Metrics infrastructure
- `AIDecisionLoggerService` (Story 11.2) - Audit logging

---

## Acceptance Criteria

### AC#1: Anomaly Detection API

**Given** I am a Lead QA with appropriate permissions  
**When** I request anomaly analysis for quality metrics  
**Then** I receive detected anomalies with AI-powered insights:

**Endpoint:** `GET /api/v1/qa-dashboard/anomalies`

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `period` | string | No | `7d`, `30d`, `90d` (default: `30d`) |
| `project_id` | UUID | No | Filter by specific project |
| `metric_types` | string[] | No | Filter by metric types (`pass_rate`, `coverage`, `bug_escape`, `security`) |
| `severity` | enum | No | `critical`, `warning`, `info` |

**Response:** `200 OK`

```json
{
  "period": "30d",
  "analysis_timestamp": "2026-02-04T12:00:00Z",
  "anomalies_detected": 3,
  "anomalies": [
    {
      "id": "uuid",
      "type": "sudden_drop",
      "metric": "test_pass_rate",
      "severity": "critical",
      "project_id": "uuid",
      "project_name": "E-commerce Platform",
      "detected_at": "2026-02-03T14:30:00Z",
      "values": {
        "current": 72.5,
        "previous": 94.2,
        "expected_range": { "min": 90.0, "max": 98.0 },
        "change_percent": -23.0
      },
      "ai_analysis": {
        "possible_causes": [
          "New AI provider (Claude Code) introduced 2 days ago with lower success rate",
          "Complex refactoring tickets increased from 10% to 35% of workload",
          "Quality gate thresholds may be too lenient for new ticket types"
        ],
        "recommended_actions": [
          "Review Claude Code routing rules - consider fallback to Cursor for complex tasks",
          "Increase sampling rate for refactoring tickets to 50%",
          "Audit recent failed QA results for common failure patterns"
        ],
        "confidence": 0.87
      },
      "status": "open"
    },
    {
      "id": "uuid-2",
      "type": "trend_decline",
      "metric": "test_coverage",
      "severity": "warning",
      "project_id": "uuid-2",
      "project_name": "Mobile App",
      "detected_at": "2026-02-01T09:00:00Z",
      "values": {
        "current": 76.2,
        "trend_start": 85.5,
        "decline_over_days": 5,
        "expected_range": { "min": 80.0, "max": 95.0 }
      },
      "ai_analysis": {
        "possible_causes": [
          "Coverage requirements not enforced in quality gates for rush deadline",
          "New frontend components lack corresponding test files"
        ],
        "recommended_actions": [
          "Re-enable coverage threshold (80%) in quality gates",
          "Schedule technical debt sprint for missing tests",
          "Add coverage check to pre-commit hooks"
        ],
        "confidence": 0.92
      },
      "status": "investigating"
    },
    {
      "id": "uuid-3",
      "type": "spike",
      "metric": "bug_escape_rate",
      "severity": "critical",
      "project_id": "uuid",
      "project_name": "E-commerce Platform",
      "detected_at": "2026-02-03T16:00:00Z",
      "values": {
        "current": 8.2,
        "baseline": 2.1,
        "target": 5.0,
        "change_percent": +290.0
      },
      "ai_analysis": {
        "possible_causes": [
          "Holiday code freeze lifted - rushed deployments",
          "Lead QA was out sick - sampling rate dropped to 0% for 3 days",
          "Production monitoring detected 12 new errors in payment flow"
        ],
        "recommended_actions": [
          "Immediate: Increase sampling to 100% for next 20 tickets",
          "Review payment flow changes from Feb 1-3",
          "Schedule post-mortem for bug escape root cause analysis",
          "Consider temporary deployment freeze for this project"
        ],
        "confidence": 0.95
      },
      "status": "open"
    }
  ],
  "summary": {
    "critical": 2,
    "warning": 1,
    "info": 0,
    "by_metric": {
      "test_pass_rate": 1,
      "test_coverage": 1,
      "bug_escape_rate": 1
    }
  }
}
```

**Anomaly Types:**
| Type | Description | Detection Criteria |
|------|-------------|-------------------|
| `sudden_drop` | Rapid decrease in metric value | >15% drop in single day, outside 2 std dev |
| `trend_decline` | Gradual decrease over time | Declining for 3+ consecutive periods |
| `spike` | Rapid increase in negative metric | >100% increase in bug escape rate |
| `threshold_breach` | Metric exceeds configured threshold | Exceeds QualityGateConfig threshold |
| `baseline_deviation` | Significant deviation from historical average | >2 standard deviations from 30-day mean |

**Error Responses:**
| Status | Description | Example |
|--------|-------------|---------|
| `403` | Forbidden - insufficient role | `{ "message": "Requires QA or ADMIN role" }` |

---

### AC#2: AI-Powered Anomaly Analysis

**Given** an anomaly is detected  
**When** the AI analysis engine processes it  
**Then** the system uses AI to provide:

1. **Possible Causes Analysis:**
   - Correlates with recent system changes (new AI provider, config changes)
   - Identifies project-specific factors (deadlines, team changes)
   - Links to related metrics (e.g., pass rate drop correlates with complexity increase)

2. **Recommended Actions:**
   - Prioritized list of actions based on severity and confidence
   - Specific operational changes (adjust sampling, change routing)
   - Investigatory steps (review specific tickets, check configurations)

3. **Confidence Score:**
   - 0.0-1.0 score indicating AI confidence in analysis
   - Based on data completeness and pattern clarity
   - Used to prioritize anomalies for review

**AI Prompt Template:**

```
Analyze this quality metric anomaly:

Metric: {metric_type}
Current Value: {current_value}
Previous Value: {previous_value}
Change: {change_percent}%
Project: {project_name}
Time Period: {period}

Recent Context:
- AI Provider Changes: {provider_changes}
- Quality Gate Changes: {gate_changes}
- Ticket Volume: {ticket_count}
- Lead QA Activity: {qa_review_activity}

Provide:
1. 3 most likely causes (with reasoning)
2. 3-5 recommended actions (prioritized)
3. Confidence score (0.0-1.0)
```

---

### AC#3: Anomaly Alert Configuration

**Given** I am configuring anomaly detection  
**When** I set alert thresholds  
**Then** I can customize:

**Endpoint:** `POST /api/v1/qa-dashboard/anomaly-config`

**Request:**

```json
{
  "project_id": "uuid",
  "metric_configs": [
    {
      "metric": "test_pass_rate",
      "sudden_drop_threshold": 15.0,
      "trend_decline_periods": 3,
      "baseline_deviation_std": 2.0,
      "enabled": true
    },
    {
      "metric": "test_coverage",
      "sudden_drop_threshold": 10.0,
      "trend_decline_periods": 5,
      "baseline_deviation_std": 2.0,
      "enabled": true
    },
    {
      "metric": "bug_escape_rate",
      "spike_threshold": 100.0,
      "baseline_deviation_std": 2.5,
      "enabled": true
    },
    {
      "metric": "security_vulnerabilities",
      "critical_threshold": 1,
      "high_threshold": 3,
      "enabled": true
    }
  ],
  "alert_channels": ["in_app", "email", "slack"],
  "minimum_confidence": 0.7
}
```

**Default Thresholds (if not configured):**
| Metric | Sudden Drop | Trend Decline | Spike | Std Dev |
|--------|-------------|---------------|-------|---------|
| Test Pass Rate | >15% | 3 periods | N/A | 2σ |
| Test Coverage | >10% | 5 periods | N/A | 2σ |
| Bug Escape Rate | N/A | N/A | >100% | 2.5σ |
| Security Vulns | N/A | N/A | Critical: ≥1 | N/A |

---

### AC#4: Real-Time Anomaly Notifications

**Given** an anomaly is detected  
**When** it meets severity and confidence thresholds  
**Then:**

1. **In-App Alert:** Appears in dashboard notifications panel
2. **Email Alert:** Sent to Lead QA (and optionally PM for project-specific)
3. **Slack Notification:** Posted to configured channel

**WebSocket Event:** `quality-anomaly-detected`

**Payload:**

```json
{
  "timestamp": "2026-02-04T12:00:00Z",
  "anomaly": {
    "id": "uuid",
    "type": "sudden_drop",
    "metric": "test_pass_rate",
    "severity": "critical",
    "project_name": "E-commerce Platform",
    "summary": "Test pass rate dropped from 94% to 72%",
    "ai_confidence": 0.87
  },
  "action_url": "/qa-dashboard/anomalies/uuid",
  "dismissible": false
}
```

---

### AC#5: Anomaly Resolution Workflow

**Given** an anomaly has been detected  
**When** a Lead QA takes action  
**Then** they can:

**Endpoint:** `PATCH /api/v1/qa-dashboard/anomalies/:id`

**Actions:**

- `acknowledge` - Mark as seen, stays open
- `investigating` - Mark as being investigated
- `resolved` - Mark as resolved with notes
- `false_positive` - Mark as false positive with reason
- `snooze` - Temporarily suppress (24h, 7d)

**Request:**

```json
{
  "action": "resolved",
  "notes": "Caused by new AI provider - adjusted routing rules to fallback on complex tasks",
  "follow_up_date": "2026-02-11T00:00:00Z"
}
```

---

### AC#6: Historical Anomaly Report

**Given** I want to review past anomalies  
**When** I query the historical report  
**Then** I receive:

**Endpoint:** `GET /api/v1/qa-dashboard/anomalies/history`

**Response:**

```json
{
  "period": "90d",
  "summary": {
    "total_anomalies": 12,
    "by_severity": { "critical": 3, "warning": 6, "info": 3 },
    "by_type": { "sudden_drop": 4, "trend_decline": 5, "spike": 3 },
    "resolution_rate": 0.92,
    "avg_resolution_time_hours": 18.5
  },
  "patterns": {
    "most_common_cause": "New AI provider introduction",
    "most_affected_project": "E-commerce Platform",
    "seasonal_trends": "Higher anomalies during sprint endings"
  },
  "trend": "improving"
}
```

---

## Technical Design

### DTO Specifications

**AnomalyDto** (`src/dashboards/dto/anomaly-detection.dto.ts`)

```typescript
export class AnomalyDto {
  id: string;
  type: 'sudden_drop' | 'trend_decline' | 'spike' | 'threshold_breach' | 'baseline_deviation';
  metric: 'test_pass_rate' | 'test_coverage' | 'bug_escape_rate' | 'security_vulnerabilities';
  severity: 'critical' | 'warning' | 'info';
  project_id: string;
  project_name: string;
  detected_at: Date;
  values: {
    current: number;
    previous?: number;
    expected_range?: { min: number; max: number };
    change_percent?: number;
  };
  ai_analysis: {
    possible_causes: string[];
    recommended_actions: string[];
    confidence: number;
  };
  status: 'open' | 'acknowledged' | 'investigating' | 'resolved' | 'false_positive';
  resolution?: {
    resolved_at: Date;
    resolved_by: string;
    notes: string;
  };
}

export class AnomalyQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d', '90d'] })
  @IsOptional()
  @IsEnum(['7d', '30d', '90d'])
  period?: string = '30d';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  project_id?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  metric_types?: string[];

  @ApiPropertyOptional({ enum: ['critical', 'warning', 'info'] })
  @IsOptional()
  severity?: string;
}

export class AnomalyConfigDto {
  project_id?: string;
  metric_configs: MetricConfig[];
  alert_channels: string[];
  minimum_confidence: number;
}
```

### Service Architecture

**AnomalyDetectionService** (`src/dashboards/services/anomaly-detection.service.ts`)

- `detectAnomalies(period, filters)` - Main detection entry point
- `analyzeWithAI(anomalyData)` - AI-powered cause analysis
- `getAnomalyConfig(projectId)` - Retrieve configuration
- `updateAnomalyConfig(config)` - Update thresholds
- `resolveAnomaly(id, action, notes)` - Resolution workflow
- `runScheduledAnalysis()` - Cron job for daily analysis

**Detection Algorithms:**

```typescript
// Sudden Drop Detection
private detectSuddenDrop(
  current: number,
  previous: number,
  threshold: number
): boolean {
  const changePercent = ((current - previous) / previous) * 100;
  return Math.abs(changePercent) >= threshold;
}

// Trend Decline Detection
private detectTrendDecline(
  values: number[],
  periods: number
): boolean {
  if (values.length < periods) return false;
  const recent = values.slice(-periods);
  return recent.every((val, i) => i === 0 || val <= recent[i - 1]);
}

// Statistical Deviation
private detectStatisticalDeviation(
  value: number,
  historicalValues: number[],
  stdDevThreshold: number
): boolean {
  const mean = historicalValues.reduce((a, b) => a + b, 0) / historicalValues.length;
  const variance = historicalValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / historicalValues.length;
  const stdDev = Math.sqrt(variance);
  const zScore = Math.abs((value - mean) / stdDev);
  return zScore >= stdDevThreshold;
}
```

**AnomalyDetectionController** (`src/dashboards/anomaly-detection.controller.ts`)

- `GET /api/v1/qa-dashboard/anomalies` - List anomalies
- `GET /api/v1/qa-dashboard/anomalies/:id` - Get specific anomaly
- `POST /api/v1/qa-dashboard/anomaly-config` - Configure thresholds
- `PATCH /api/v1/qa-dashboard/anomalies/:id` - Update status
- `GET /api/v1/qa-dashboard/anomalies/history` - Historical report

### Database Schema Addition

**Anomaly Model** (add to Prisma schema):

```prisma
model QualityAnomaly {
  id              String   @id @default(uuid())
  type            String   // sudden_drop, trend_decline, spike, etc.
  metric          String   // test_pass_rate, coverage, bug_escape, security
  severity        String   // critical, warning, info
  project_id      String
  detected_at     DateTime @default(now())
  current_value   Float
  previous_value  Float?
  expected_min    Float?
  expected_max    Float?
  change_percent  Float?

  // AI Analysis (stored as JSON)
  ai_analysis     Json?    // { possible_causes, recommended_actions, confidence }

  status          String   @default("open") // open, acknowledged, investigating, resolved, false_positive
  resolved_at     DateTime?
  resolved_by     String?
  resolution_notes String?

  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt

  @@index([project_id])
  @@index([status])
  @@index([detected_at])
  @@index([severity])
}
```

### Integration Points

1. **Quality Dashboard Service** (Story 8.6):
   - Reuses `QualityDashboardService` for metrics aggregation
   - Calls `getMetrics()` to retrieve historical data for analysis

2. **AI Provider Service** (Epic 2):
   - Uses `ClaudeCodeProvider` for anomaly analysis
   - Falls back to `CursorHeadlessProvider` if needed
   - Configurable AI model for analysis

3. **Scheduled Job** (Daily Analysis):
   - NestJS `@Cron('0 9 * * *')` - Run at 9 AM daily
   - Triggered via `AnomalyDetectionService.runScheduledAnalysis()`
   - Can also be triggered on-demand via API

4. **Notification Service**:
   - Integrates with existing notification system
   - WebSocket via `DashboardGateway`
   - Email via existing email service

5. **Prometheus Metrics**:
   ```
   quality_anomalies_detected_total{type, severity}
   quality_anomalies_open_count{severity}
   quality_anomaly_resolution_time_hours
   quality_anomaly_ai_confidence_average
   ```

---

## Tasks / Subtasks

- [ ] **Database Schema** (AC: #1, #3)
  - [ ] Add `QualityAnomaly` model to Prisma schema
  - [ ] Create migration
  - [ ] Generate Prisma client

- [ ] **DTO Implementation** (AC: #1, #3, #5)
  - [ ] Create `AnomalyDto` with all fields
  - [ ] Create `AnomalyQueryDto` with filters
  - [ ] Create `AnomalyConfigDto` for configuration
  - [ ] Create `AnomalyResolutionDto` for status updates
  - [ ] Add validation decorators

- [ ] **Anomaly Detection Service** (AC: #1, #2)
  - [ ] Create `AnomalyDetectionService`
  - [ ] Implement `detectAnomalies()` with multiple detection algorithms
  - [ ] Implement `analyzeWithAI()` for AI-powered insights
  - [ ] Implement `runScheduledAnalysis()` for cron job
  - [ ] Add caching for historical metrics data

- [ ] **REST API Controller** (AC: #1, #3, #5, #6)
  - [ ] Create `AnomalyDetectionController`
  - [ ] Add RBAC (`Role.QA`, `Role.ADMIN`)
  - [ ] Add rate limiting
  - [ ] Add Swagger documentation

- [ ] **Real-Time Notifications** (AC: #4)
  - [ ] Extend `DashboardGateway` with anomaly events
  - [ ] Implement email notification template
  - [ ] Implement Slack webhook integration
  - [ ] Add severity-based routing

- [ ] **Configuration Management** (AC: #3)
  - [ ] Create default configuration
  - [ ] Implement per-project override
  - [ ] Add validation for thresholds

- [ ] **Scheduled Analysis** (AC: #1, #2)
  - [ ] Add `@nestjs/schedule` dependency
  - [ ] Configure daily cron job
  - [ ] Add manual trigger endpoint
  - [ ] Implement job locking to prevent duplicates

- [ ] **Unit Tests**
  - [ ] `AnomalyDetectionService` detection algorithms
  - [ ] Controller tests (endpoints, guards, validation)
  - [ ] AI analysis integration tests (mocked)

- [ ] **Documentation**
  - [ ] Update API documentation (Swagger)
  - [ ] Add anomaly detection guide
  - [ ] Document AI prompt templates

---

## Dev Notes

### Architecture Compliance

- **Module Structure:** Extend `dashboards/` module with `anomaly-detection.controller.ts` and `services/anomaly-detection.service.ts`
- **RBAC:** Use existing `RolesGuard` with `Role.QA` and `Role.ADMIN`
- **Rate Limiting:** Apply `ThrottlerGuard` (50 req/min for anomaly queries)
- **Caching:** Cache historical metrics data for 1 hour
- **Database:** Follow existing Prisma patterns
- **AI Integration:** Use existing AI provider infrastructure from Epic 2

### Dependencies

- **Required Stories:**
  - Story 8.6: Quality Metrics Dashboard (metrics data source)
  - Story 3.6: QA Results Storage (historical QA data)
  - Story 8.5: Bug Escape Tracking (bug escape data)
  - Story 1.8: Prometheus Metrics (infrastructure)
  - Story 2.x: AI Provider Integration (Claude Code for analysis)

- **NPM Dependencies:**
  ```bash
  npm install @nestjs/schedule
  npm install --save-dev @types/cron
  ```

### Data Flow

```
┌─────────────────────┐     ┌──────────────────────────┐     ┌─────────────────┐
│   Cron Job / API    │────▶│ AnomalyDetectionService  │────▶│   Prisma DB     │
│   Trigger           │     │                          │     │  (QaResult,     │
└─────────────────────┘     └──────────────────────────┘     │   BugEscape)    │
                                     │                       └─────────────────┘
                                     │                                ▲
                                     ▼                                │
                     ┌──────────────────────────┐                   │
                     │   Detection Algorithms   │                   │
                     │  - Sudden Drop           │                   │
                     │  - Trend Decline         │                   │
                     │  - Statistical Deviation │                   │
                     └──────────────────────────┘                   │
                                     │                                │
                                     ▼                                │
                     ┌──────────────────────────┐                   │
                     │    AI Analysis Engine    │───────────────────┘
                     │   (Claude Code / LLM)    │  (Save anomalies)
                     └──────────────────────────┘
                                     │
                                     ▼
                     ┌──────────────────────────┐
                     │   Notification Service   │
                     │   - WebSocket            │
                     │   - Email                │
                     │   - Slack                │
                     └──────────────────────────┘
```

### AI Delegation Strategy

**What AI Handles:**

- Correlation analysis between metrics and system events
- Natural language generation for possible causes
- Action recommendation prioritization
- Confidence scoring

**What We Implement:**

- Statistical detection algorithms (sudden drop, trend)
- Threshold monitoring
- Data aggregation and preparation
- Alert routing and storage

**Benefits:**

- ~70% effort reduction vs. building full ML pipeline
- Leverages existing AI provider infrastructure
- Human-interpretable results with reasoning
- Configurable confidence thresholds

### Performance Considerations

- **Caching:** Cache historical metrics for 1 hour to reduce DB load
- **Batch Analysis:** Process all projects in single daily batch
- **Async AI Calls:** AI analysis runs asynchronously after detection
- **Index Strategy:** Indexes on `project_id`, `status`, `detected_at` for fast queries

### Security Considerations

- Anomaly data may reveal project quality issues - restrict to QA/ADMIN roles
- AI analysis may include sensitive project names - ensure proper sanitization
- Audit log all anomaly status changes via `AIDecisionLogger`

---

## References

- **FR41:** Lead QA can view quality dashboards with trend analysis [Source: docs/epics.md]
- **FR42:** Lead QA can identify which project types or AI tools have quality issues [Source: docs/epics.md]
- **FR43:** Lead QA can generate quality reports for client transparency [Source: docs/epics.md]
- **Story 8.6:** Quality Metrics Dashboard (metrics data source) [Source: _bmad-output/implementation-artifacts/8-6-quality-metrics-dashboard.md]
- **Story 8.5:** Bug Escape Tracking [Source: _bmad-output/implementation-artifacts/8-5-bug-escape-tracking-analysis.md]
- **Story 3.6:** QA Results Storage [Source: _bmad-output/implementation-artifacts/3-6-qa-results-storage-retrieval.md]
- **Architecture:** Dashboard Controllers [Source: _bmad-output/planning-artifacts/architecture.md#Dashboard-Controllers]
- **Delegation Strategy:** Epic 5-10 Delegation Strategy [Source: docs/architecture/epic-5-10-delegation-strategy.md]

---

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

- `prisma/schema.prisma` - Add QualityAnomaly model
- `src/dashboards/anomaly-detection.controller.ts` - REST API controller
- `src/dashboards/services/anomaly-detection.service.ts` - Core detection service
- `src/dashboards/dto/anomaly-detection.dto.ts` - DTOs (AnomalyDto, AnomalyQueryDto, etc.)
- `src/dashboards/services/anomaly-detection.service.spec.ts` - Unit tests
- `src/dashboards/anomaly-detection.controller.spec.ts` - Controller tests
