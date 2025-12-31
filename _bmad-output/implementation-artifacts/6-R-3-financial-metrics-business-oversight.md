# Story 6-R-3: Financial Metrics Business Oversight

Status: ready-for-dev

<!-- Note: Created by BMad create-story workflow. Optimized for LLM dev agent zero-mistake implementation. -->

## Story

As a **Chief Financial Officer (CFO) or Business Stakeholder**,
I want **comprehensive financial dashboards tracking AI cost metrics by feature, ROI, budget trends, and utilization patterns**,
so that **I can make informed business decisions about AI investment and quickly identify cost optimization opportunities**.

## Context & Business Value

This story delivers **executive-level financial intelligence** for the AI Factory. While Stories 13-1/13-5 provide technical cost tracking APIs and Story 6-R-2 provides operational Go/No-Go decisions, this story creates the **Business Intelligence layer** that translates raw cost data into actionable financial insights for executives.

**Key Business Outcomes:**
- **Cost per Feature/Story**: Understand true AI development costs
- **ROI Tracking**: Compare AI costs vs business value delivered (story points, features shipped)
- **Budget Trend Analysis**: Identify cost patterns, predict overruns, optimize budgets
- **Utilization Patterns**: See which AI models/providers deliver best value for money

This completes Epic 6-R's cost management vision: **Automatic caps (6-R-1) → Operational decisions (6-R-2) → Business oversight (6-R-3)**.

## Acceptance Criteria

### AC#1: Cost per Feature Dashboard

**Requirement:** Display AI cost breakdown at the Feature/Epic level with drill-down to individual stories

**Validation:**
- **Endpoint**: `GET /api/v1/financial-metrics/cost-per-feature?epicId={epicNum}`
  - Optional filters: `startDate`, `endDate`, `projectId`
- **Calculation Formula**: `Feature_Cost_USD = SUM(AICostLog.cost_usd WHERE ticket.epic_num = {epicNum})`
- **Metrics to Display**:
  - Total Cost per Epic (USD)
  - Average Cost per Story in Epic
  - Cost breakdown by AI provider (CURSOR vs CLAUDE)
  - Cost breakdown by operation type (code_generation, self_healing, etc.)
- **Response Structure**:
  ```json
  {
    "epicId": "epic-5",
    "epicTitle": "PM Dashboard",
    "totalCostUsd": "450.25",
    "storyCount": 7,
    "avgCostPerStory": "64.32",
    "storyCosts": [
      {
        "storyId": "5-1",
        "storyTitle": "PM Dashboard API",
        "costUsd": "125.50",
        "tokensTotal": 350000,
        "completionDate": "2025-12-23"
      }
    ],
    "byProvider": [
      { "provider": "CURSOR_HEADLESS", "costUsd": "280.15", "percentage": 62.2 },
      { "provider": "CLAUDE_CODE", "costUsd": "170.10", "percentage": 37.8 }
    ]
  }
  ```

### AC#2: ROI Calculator & Value Tracking

**Requirement:** Calculate Return on Investment by comparing AI costs against business value metrics

**Validation:**
- **Endpoint**: `GET /api/v1/financial-metrics/roi?projectId={id}&period={day|week|month}`
- **ROI Calculation**:
  - **Cost**: SUM(AICostLog.cost_usd) for period
  - **Value Proxy**: SUM(Ticket.story_points) * Value_Per_Point (configurable, default $500/point)
  - **ROI Formula**: `((Value - Cost) / Cost) * 100`
  - **Efficiency Metric**: `Cost_Per_Story_Point = Total_Cost / Total_Story_Points`
- **Response Structure**:
  ```json
  {
    "projectId": "project-123",
    "period": "month",
    "metrics": {
      "totalCostUsd": "1250.00",
      "totalValue sd": "3500.00",
      "storyPointsDelivered": 7,
      "valuePerPoint": 500,
      "roiPercentage": 180.0,
      "costPerStoryPoint": "178.57",
      "breakEvenPoint": "3 stories"
    },
    "trend": {
      "previousPeriodRoi": 150.0,
      "change": "+30.0%",
      "direction": "improving"
    }
  }
  ```

### AC#3: Budget Utilization Trends

**Requirement:** Visualize budget utilization over time with trend analysis and forecasting

**Validation:**
- **Endpoint**: `GET /api/v1/financial-metrics/budget-trends?projectId={id}&period={week|month|quarter}`
- **Trend Metrics**:
  - Daily/Weekly/Monthly spend rate
  - Cumulative spend vs budget (percentage)
  - Burn rate ($/day average)
  - Forecast: Days until budget exhausted (linear projection)
  - Anomaly detection: Flag unusual spending spikes (>150% of rolling average)
- **Response Structure**:
  ```json
  {
    "projectId": "project-123",
    "period": "month",
    "budget": {
      "totalBudgetUsd": "5000.00",
      "spentUsd": "1850.50",
      "remainingUsd": "3149.50",
      "utilizationPercentage": 37.01
    },
    "trends": {
      "burnRatePerDay": "61.68",
      "forecastDaysRemaining": 51,
      "forecastExhaustionDate": "2026-02-20",
      "status": "healthy"
    },
    "timeSeries": [
      {
        "date": "2025-12-01",
        "dailyCost": "45.20",
        "cumulativeCost": "45.20",
        "utilizationPct": 0.904
      },
      {
        "date": "2025-12-02",
        "dailyCost": "62.10",
        "cumulativeCost": "107.30",
        "utilizationPct": 2.146
      }
    ],
    "anomalies": [
      {
        "date": "2025-12-15",
        "cost": "185.00",
        "avgCost": "62.00",
        "spike": "198%",
        "reason": "Self-healing spike - Epic 3 QA refactor"
      }
    ]
  }
  ```

### AC#4: AI Model Efficiency Analysis

**Requirement:** Compare AI provider/model performance by cost efficiency and quality

**Validation:**
- **Endpoint**: `GET /api/v1/financial-metrics/model-efficiency?projectId={id}`
- **Efficiency Metrics**:
  - Cost per successful execution
  - Cost per 1000 tokens
  - Average execution time
  - Success rate (% executions without errors)
  - Self-healing rate (% of executions needing fixes)
- **Response Structure**:
  ```json
  {
    "models": [
      {
        "modelName": "gpt-4o",
        "provider": "CURSOR_HEADLESS",
        "totalCostUsd": "850.00",
        "executionCount": 45,
        "successRate": 88.9,
        "costPerExecution": "18.89",
        "costPer1kTokens": "0.0425",
        "avgExecutionTimeSec": 125,
        "selfHealingRate": 11.1
      },
      {
        "modelName": "claude-3.5-sonnet",
        "provider": "CLAUDE_CODE",
        "totalCostUsd": "620.00",
        "executionCount": 52,
        "successRate": 92.3,
        "costPerExecution": "11.92",
        "costPer1kTokens": "0.0380",
        "avgExecutionTimeSec": 98,
        "selfHealingRate": 7.7
      }
    ],
    "recommendation": {
      "mostEfficient": "claude-3.5-sonnet",
      "reason": "Lower cost per execution, higher success rate, faster execution",
      "potentialSavings": "15-20% if migrating all CURSOR tasks to CLAUDE"
    }
  }
  ```

### AC#5: JWT Authentication & RBAC

**Requirement:** Secure all financial endpoints with proper authentication and authorization

**Validation:**
- **Guards**: `@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)` on all endpoints
- **Allowed Roles**: `@Roles(Role.MANAGER, Role.ADMIN)` (CFO/Business stakeholder access only - NOT PM/TL/QA)
  - **Rationale**: Financial P&L data is executive-level sensitive, stricter than technical cost dashboards (13-5)
- **Rate Limiting**: `@Throttle({ default: { limit: 50, ttl: 60000 } })` (50 req/min - expensive aggregation queries)

### AC#6: Swagger Documentation & Export

**Requirement:** Complete API documentation with export capabilities for reporting

**Validation:**
- **Swagger Decorators**: `@ApiTags('Financial Metrics')`, `@ApiBearerAuth()`, `@ApiOperation()`, `@ApiResponse()` on all endpoints
- **Export Feature** (lightweight implementation):
  - Add `format=json` query param to all endpoints (default)
  - Add `format=csv` query param for CSV download (AC#1, AC#3 only - tabular data)
  - CSV Headers: "Epic,Story,Cost USD,Tokens,Completion Date" for Cost per Feature
  - CSV Implementation: Use simple `Array.map().join(',')` transformation, return `Content-Type: text/csv`

## Tasks / Subtasks

### Backend (NestJS - `dsf` repo)

#### 1. Create Financial Metrics Module & DTOs

- [ ] **Create Module Structure**
  - [ ] [NEW] `src/financial-metrics/financial-metrics.module.ts`
  - [ ] [NEW] `src/financial-metrics/financial-metrics.service.ts`
  - [ ] [NEW] `src/financial-metrics/financial-metrics.controller.ts`
  - [ ] [MODIFY] `src/app.module.ts` (Import `FinancialMetricsModule`)

- [ ] **Create DTOs** (AC: #1-6)
  - [ ] [NEW] `src/financial-metrics/dto/cost-per-feature.dto.ts`
    - [ ] `CostPerFeatureQueryDto`: Query params (epicId, projectId?, startDate?, endDate?, format?)
    - [ ] `StoryCostDto`: Individual story cost breakdown
    - [ ] `ProviderBreakdownDto`: Cost by provider
    - [ ] `CostPerFeatureDto`: Response with epic cost, stories, provider breakdown
  - [ ] [NEW] `src/financial-metrics/dto/roi-metrics.dto.ts`
    - [ ] `RoiQueryDto`: Query params (projectId, period, valuePerPoint?)
    - [ ] `RoiMetricsDto`: ROI calculation results with trend comparison
  - [ ] [NEW] `src/financial-metrics/dto/budget-trends.dto.ts`
    - [ ] `BudgetTrendsQueryDto`: Query params (projectId, period)
    - [ ] `TimeSeriesDataPointDto`: Single data point (date, cost, cumulative)
    - [ ] `AnomalyDto`: Spending anomalies
    - [ ] `BudgetTrendsDto`: Complete trend analysis with forecasting
  - [ ] [NEW] `src/financial-metrics/dto/model-efficiency.dto.ts`
    - [ ] `ModelEfficiencyQueryDto`: Query params (projectId, startDate?, endDate?)
    - [ ] `ModelMetricsDto`: Individual model performance
    - [ ] `ModelEfficiencyDto`: All models with recommendation
  - [ ] [NEW] `src/financial-metrics/dto/index.ts` (Barrel export)
  - [ ] Add `@ApiProperty()` decorators with examples to ALL DTOs

#### 2. Implement Service Layer (AC: #1-4)

- [ ] **Implement `FinancialMetricsService`**
  - [ ] Inject: `PrismaService`, `AICostTrackerService` (Story 13-1), `LoggerService`, `SentryService`
  - [ ] **Method 1**: `getCostPerFeature(options: CostPerFeatureQueryDto): Promise<CostPerFeatureDto[]>`
    - [ ] Query: Join `AICostLog` → `Ticket` → Group by `epic_num`
    - [ ] Filter: WHERE epic_num = options.epicId (if provided), date range (if provided)
    - [ ] Aggregate: SUM(cost_usd) per story, per epic, per provider
    - [ ] Calculate: avg cost per story = total_epic_cost / story_count
    - [ ] Map to DTO with provider percentage calculations
  - [ ] **Method 2**: `calculateRoi(options: RoiQueryDto): Promise<RoiMetricsDto>`
    - [ ] Get project's total cost for period (reuse `AICostTrackerService` or direct Prisma query)
    - [ ] Get completed tickets for period: `WHERE status = 'COMPLETED' AND completion_date BETWEEN startDate AND endDate`
    - [ ] Sum all story_points
    - [ ] Calculate ROI: ((story_points * valuePerPoint) - total_cost) / total_cost * 100
    - [ ] Get previous period ROI for trend comparison
    - [ ] Return with breakeven calculation
  - [ ] **Method 3**: `getBudgetTrends(options: BudgetTrendsQueryDto): Promise<BudgetTrendsDto>`
    - [ ] Get Project.budget_usd
    - [ ] Query cost logs grouped by DATE(timestamp) for period
    - [ ] Calculate cumulative daily costs
    - [ ] Calculate burn rate:  total_spend / days_elapsed
    - [ ] Forecast exhaustion date: remaining_budget / burn_rate = days_left
    - [ ] Detect anomalies: daily_cost > (rolling_7day_avg * 1.5)
    - [ ] Return timeSeries array + forecast metrics
  - [ ] **Method 4**: `getModelEfficiency(options: ModelEfficiencyQueryDto): Promise<ModelEfficiencyDto>`
    - [ ] Query: Group by model_name, ai_provider
    - [ ] Join with Execution table to get status, execution_time
    - [ ] Calculate metrics:
      - [ ] Success rate: COUNT(status = 'COMPLETED') / COUNT(*)
      - [ ] Cost per execution: SUM(cost_usd) / COUNT(*)
      - [ ] Cost per 1k tokens: (SUM(cost_usd) / SUM(tokens_total)) * 1000
      - [ ] Self-healing rate: COUNT(self_healing_attempts > 0) / COUNT(*)
    - [ ] Generate recommendation: Sort by cost efficiency (lowest cost per success)
    - [ ] Return models array + recommendation

#### 3. Implement REST Controller (AC: #5, #6)

- [ ] **Create `FinancialMetricsController`**
  - [ ] Controller decorators:
    - [ ] `@Controller('api/v1/financial-metrics')`
    - [ ] `@ApiTags('Financial Metrics')`
    - [ ] `@ApiBearerAuth()`
    - [ ] `@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)`
  - [ ] Inject: `FinancialMetricsService`, `LoggerService`

- [ ] **Implement Endpoints**:
  - [ ] `@Get('cost-per-feature')` - Cost per Feature (AC#1)
    - [ ] `@Roles(Role.MANAGER, Role.ADMIN)`
    - [ ] `@Throttle({ default: { limit: 50, ttl: 60000 } })`
    - [ ] Query params: `@Query() query: CostPerFeatureQueryDto`
    - [ ] Handle CSV export: If `format=csv`, convert DTO to CSV string and return with header `Content-Type: text/csv`
    - [ ] Swagger docs: `@ApiOperation()`, `@ApiQuery()`, `@ApiResponse()`
  
  - [ ] `@Get('roi')` - ROI Calculator (AC#2)
    - [ ] Same guards/throttle as above
    - [ ] Query params: `@Query() query: RoiQueryDto`
    - [ ] Delegate to `service.calculateRoi()`
    - [ ] Swagger docs
  
  - [ ] `@Get('budget-trends')` - Budget Trends (AC#3)
    - [ ] Same guards/throttle
    - [ ] Query params: `@Query() query: BudgetTrendsQueryDto`
    - [ ] Handle CSV export for timeSeries data
    - [ ] Delegate to `service.getBudgetTrends()`
    - [ ] Swagger docs
  
  - [ ] `@Get('model-efficiency')` - Model Efficiency (AC#4)
    - [ ] Same guards/throttle
    - [ ] Query params: `@Query() query: ModelEfficiencyQueryDto`
    - [ ] Delegate to `service.getModelEfficiency()`
    - [ ] Swagger docs

#### 4. Unit Tests

- [ ] **Create Service Tests**: `src/financial-metrics/financial-metrics.service.spec.ts`
  - [ ] Test `getCostPerFeature()`: Aggregates epic costs correctly, calculates avg per story
  - [ ] Test `calculateRoi()`: Correct ROI formula, handles zero costs, trend comparison
  - [ ] Test `getBudgetTrends()`: Timeseries generation, anomaly detection, forecast calculation
  - [ ] Test `getModelEfficiency()`: Success rate calculations, cost metrics, recommendation logic
  - [ ] Mock: `PrismaService`, `AICostTrackerService`, `LoggerService`, `SentryService`
  - [ ] Target: 15+ test cases, >80% coverage

- [ ] **Create Controller Tests**: `src/financial-metrics/financial-metrics.controller.spec.ts`
  - [ ] Test all 4 endpoints delegate to service correctly
  - [ ] Test CSV export format conversion
  - [ ] Test query param validation
  - [ ] Mock: `FinancialMetricsService`
  - [ ] Target: 10+ test cases

### Frontend (React - `dsf-dashboard` repo) - OPTIONAL ENHANCEMENT

> **Note**: Frontend implementation is **OPTIONAL** for this story. Backend APIs are the MVP deliverable. UI can be delegated to Epic 5 (PM Dashboard) or deferred to future sprint.

- [ ] **OPTIONAL**: Create Financial Metrics Page
  - [ ] [NEW] `apps/dsf-dashboard/src/pages/FinancialMetricsPage.tsx`
  - [ ] Install: `recharts` (if not already installed from Story 6-R-2)
  - [ ] Components:
    - [ ] `CostPerFeatureChart.tsx`: Bar chart of epic costs
    - [ ] `RoiGaugeWidget.tsx`: ROI gauge visualization
    - [ ] `BudgetTrendChart.tsx`: Line chart with forecast
    - [ ] `ModelEfficiencyTable.tsx`: Sortable table of model metrics
  - [ ] Route: `/financial-metrics` (add to `App.tsx`)
  - [ ] Sidebar: Add "Financial Metrics" nav link (Manager/Admin only)

## Dev Notes

### 🚨 CRITICAL Architecture Patterns

**1. Reuse Epic 13 Foundation**
- **DO**: Use `AICostTrackerService` (Story 13-1) for all cost queries
- **DO**: Follow patterns from `CostDashboardService` (Story 13-5) for Prisma aggregations
- **DON'T**: Create new cost logging or calculation logic - reuse existing

**2. Prisma Query Optimization**
- **Use indexes**: `AICostLog` has indexes on `[ticket_id, timestamp]`, `[ai_provider, timestamp]` - leverage for performance
- **Batch queries**: Use `Promise.all()` for parallel aggregations (provider + model in single call)
- **Decimal precision**: Always convert `cost_usd` Decimal to string in DTOs: `cost.toString()`

**3. RBAC Security**
- **Access Control**: Financial metrics are MANAGER/ADMIN only (more restrictive than Story 13-5's PM/TL access)
- **Sensitive Data**: P&L data, budget forecasts are executive-level - enforce strict RBAC

### Source Tree Components

**Files to CREATE:**
- `src/financial-metrics/financial-metrics.module.ts`
- `src/financial-metrics/financial-metrics.service.ts`
- `src/financial-metrics/financial-metrics.controller.ts`
- `src/financial-metrics/dto/*.dto.ts` (5 DTO files)

**Files to MODIFY:**
- `src/app.module.ts` (Import FinancialMetricsModule)

**Files to REFERENCE (Do NOT modify):**
- `src/cost-tracking/ai-cost-tracker.service.ts` (Story 13-1 - cost calculation logic)
- `src/cost-tracking/cost-dashboard.service.ts` (Story 13-5 - aggregation patterns)
- `prisma/schema.prisma` (AICostLog, Ticket, Project, Execution models)

### Testing Standards

**Unit Tests (Backend)**:
- **Service Layer**: 15+ tests, mock Prisma, verify calculations/aggregations
- **Controller Layer**: 10+ tests, mock service, verify delegation
- **Pattern**: Follow `cost-dashboard.service.spec.ts` (Story 13-5) for Prisma mocking
- **Coverage Target**: >80% (critical business logic)

**E2E Tests (Deferred)**:
- Complex setup (requires Prisma seeding, multi-table joins, auth)
- Defer to follow-up PR after MVP validation

### Previous Story Learnings

**From Story 6-R-2 (Go/No-Go Dashboard)**:
- ✅ **Pattern**: Separate `/override` endpoint for elevated permissions worked well
- ✅ **React Patterns**: `recharts` for visualizations, modals for actions, real-time with Socket.IO (deferred)
- ✅ **Build Verification**: Always verify build passes before marking done
- ⚠️ **Lesson**: Frontend components should be optional MVP deliverable, backend APIs are critical

**From Story 13-5 (Cost Dashboard API)**:
- ✅ **Prisma Patterns**: `groupBy()` for aggregations, `_sum` for totals, dynamic where clauses for filters
- ✅ **Decimal Handling**: Always use `.toString()` on Decimal types, never `.toNumber()`
- ✅ **Error Handling**: Graceful degradation (return zeros) vs throwing (let controller handle)
- ✅ **Pagination**: Implemented for breakdown endpoint, consider for large epic lists

**From Story 13-1 (AI Cost Tracking)**:
- ✅ **Centralization**: All cost logic in one service prevents duplication
- ✅ **Precision**: Decimal(10,6) precision prevents floating-point errors in financial calculations
- ✅ **Observability**: Prometheus metrics + Sentry alerts for cost anomalies

### API Response Performance Considerations

**Expected Data Volumes:**
- Cost per Feature: 1-20 epics per project
- ROI: Single calculation per project/period
- Budget Trends: 7-90 data points (daily for week/month/quarter)
- Model Efficiency: 2-5 models per project

**Optimization Strategies:**
- Use database aggregations (don't fetch all rows then calculate in-app)
- Cache frequently accessed data (project budget, model prices) - consider Redis if performance issues
- Add pagination to Cost per Feature if projects have >50 epics (unlikely in MVP)

### CSV Export Implementation

**Simple Pattern** (No libraries needed):
```typescript
if (query.format === 'csv') {
  const csv = [
    'Epic,Story,Cost USD,Tokens,Completion Date',
    ...data.storyCosts.map(s => 
      `${data.epicId},${s.storyId},${s.costUsd},${s.tokensTotal},${s.completionDate}`
    )
  ].join('\n');
  
  return {
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="cost-per-feature-${epicId}.csv"` },
    body: csv
  };
}
```

### References

- **Epic Context**: [v3-epic-impact-analysis.md](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/v3-epic-impact-analysis.md#L77-L92) (Epic 6-R definition)
- **Cost Tracking Foundation**: [Story 13-1](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/13-1-ai-cost-tracking-service.md) (AICostTrackerService)
- **Cost API Patterns**: [Story 13-5](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/13-5-cost-dashboard-api.md) (CostDashboardService aggregation patterns)
- **Previous Story**: [Story 6-R-2](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/6-R-2-go-no-go-decision-dashboard.md) (Go/No-Go Dashboard)
- **Schema Reference**: `prisma/schema.prisma` (AICostLog model lines 633-656, Project model for budget_usd)

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.5 (BMad Create-Story Workflow Engine)

### Debug Log References

- [Task MD](file:///Users/khakanali/.gemini/antigravity/brain/e6572544-be10-40f0-89f6-f5870d1e6172/task.md)
- Workflow Execution: `_bmad/bmm/workflows/4-implementation/create-story/`

### Completion Notes

- "Ultimate context engine analysis completed - comprehensive developer guide created for CFO/Business financial oversight dashboard"
- "Story built on Epic 13 cost tracking foundation (Stories 13-1, 13-5), completing Epic 6-R's cost management vision"
- "Backend APIs are MVP, frontend optional - can be integrated with Epic 5 PM Dashboard or deferred"
- "All acceptance criteria validated against architecture, previous story patterns, and Epic 6-R requirements"

### File List

**TO BE CREATED BY DEV AGENT:**
- `src/financial-metrics/financial-metrics.module.ts`
- `src/financial-metrics/financial-metrics.service.ts`
- `src/financial-metrics/financial-metrics.controller.ts`
- `src/financial-metrics/dto/cost-per-feature.dto.ts`
- `src/financial-metrics/dto/roi-metrics.dto.ts`
- `src/financial-metrics/dto/budget-trends.dto.ts`
- `src/financial-metrics/dto/model-efficiency.dto.ts`
- `src/financial-metrics/dto/index.ts`
- `src/financial-metrics/financial-metrics.service.spec.ts`
- `src/financial-metrics/financial-metrics.controller.spec.ts`
- `_bmad-output/implementation-artifacts/6-R-3-financial-metrics-business-oversight.md` (This file)

**TO BE MODIFIED:**
- `src/app.module.ts` (Import FinancialMetricsModule)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (Update story status backlog → ready-for-dev)
