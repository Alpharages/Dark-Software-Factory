# Story 26.7: Financial KPI Widgets

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager,
I want to see cost burn metrics on the PM Dashboard,
so that I can spot budget overruns before they become critical, without navigating to the Financial Metrics page.

## Acceptance Criteria

1. **AC 1: Cost per Ticket (STAT-3)**
   - **Given** a user with role `MANAGER` or `ADMIN` is on the PM Dashboard
   - **When** the financial KPI widgets render
   - **Then** a "Cost per Ticket" widget shows: total AI token spend for the current calendar month divided by completed ticket count, formatted as `"$X.XX"`
2. **AC 2: Budget Burn Rate (STAT-4)**
   - **Given** a user with role `MANAGER` or `ADMIN` is on the PM Dashboard
   - **When** the financial KPI widgets render
   - **Then** a "Budget Burn Rate" widget shows: a compact sparkline of daily spend over the past 14 days, with a horizontal line at the configured monthly budget ceiling, and a dashed linear forecast line projected to end of month
3. **AC 3: Role Guarding**
   - **Given** a user with role `PM`, `TL`, or `QA` is on the PM Dashboard
   - **When** the financial KPI widget area renders
   - **Then** the Cost per Ticket and Budget Burn Rate widgets are not shown (role-gated, consistent with the FinancialMetricsSection guard from Story 26.4).

## Tasks / Subtasks

- [x] Task 1: Backend API and Service Integration (AC: 1, 2)
  - [x] **PREVENT PERFORMANCE DISASTER**: Do NOT add heavy 14-day array calculations to the main `getSummary` endpoint. Create a separate endpoint `GET /api/v1/pm-dashboard/financial-summary` and DTO `FinancialSummaryDto`.
  - [x] **PREVENT REINVENTION**: Do NOT write raw queries to calculate cost per ticket or daily spend arrays. Inject `FinancialMetricsService` or `AICostTrackerService` into `PmDashboardService` and reuse existing calculation methods (like `getBudgetTrends` logic).
  - [x] Implement the new endpoint to return `cost_per_ticket`, 14-day `daily_budget_burn` array, `budget_ceiling`, and `budget_forecast`.
- [x] Task 2: Frontend Components (AC: 1, 2)
  - [x] Create `FinancialKPISection` or incorporate into `<FinancialMetricsSection>` on the PM Dashboard.
  - [x] **IMPLEMENTATION ACCELERATOR**: Do not build an animated sparkline from scratch. Analyze and reuse/adapt the `sparklineData` SVG pattern and `<motion.div>` animations from `src/components/dashboard/StatsGrid.tsx`.
- [x] Task 3: Role Guarding and Client Caching (AC: 3)
  - [x] Ensure the component only renders if `useAuth().user?.role === 'MANAGER' || useAuth().user?.role === 'ADMIN'`.
  - [x] Ensure the frontend caches this data using React Query with `staleTime: 60000`.

## Dev Notes

- **Architecture Constraints**: Role guards MUST rely on `useAuth().user?.role`, NOT `localStorage` (as fixed in Epic 25).
- **Service Reuse MUST**: `PmDashboardService` MUST rely on existing `FinancialMetricsService` or `AICostTrackerService` for financial data. Do not duplicate Prisma queries to `aICostLog`.
- **Performance**: Similar to previous widgets in Story 26-6, ensure React Query fetches are not duplicated and use `staleTime` of at least 60 seconds to prevent hammering the DB. Keep financial data fetches independent of core dashboard load.
- **Data Fallbacks (CRITICAL)**: Projects with no AI executions will return empty cost logs. Ensure calculations handle zero-counts without throwing divide-by-zero errors (`NaN`). Render `"No data yet"` gracefully in the UI.
- **Recharts Requirements**: If using a custom Recharts component alongside the `StatsGrid` SVG sparklines, all `ResponsiveContainer` usages MUST have `min-w-0` on their parent `div` and `debounce={100}` to prevent layout zero-width bugs.
- **Git/Review Learnings**: From Story 26.6, ensure strict mock fallback data for UI testing in the absence of DB records to prevent `NaN` or ungraceful renders for edge cases. Ensure `"No data yet"` placeholders render gracefully when values are `{}` or empty.

### Project Structure Notes

- Alignment with unified project structure (paths, modules, naming). DTO in `dsf-dasbhoard/src/types/index.ts` should be updated to match the backend contract.

### References

- QA-FR33: Epic 26 — Cost per Ticket KPI [Source: docs/QA-REPORT-2026-02-27.md]
- QA-FR34: Epic 26 — Budget Burn Rate chart [Source: docs/QA-REPORT-2026-02-27.md]
- Epic 26 Requirements [Source: _bmad-output/planning-artifacts/epics.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Backend tests: `pnpm test src/dashboards/pm-dashboard.controller.spec.ts src/dashboards/services/pm-dashboard.service.spec.ts src/dashboards/services/pm-dashboard.service.search.spec.ts`
- Backend lint: `pnpm exec eslint src/dashboards/dto/pm-dashboard.dto.ts src/dashboards/services/pm-dashboard.service.ts src/dashboards/pm-dashboard.controller.ts src/dashboards/dashboards.module.ts src/financial-metrics/financial-metrics.service.ts src/dashboards/services/pm-dashboard.service.spec.ts src/dashboards/services/pm-dashboard.service.search.spec.ts src/dashboards/pm-dashboard.controller.spec.ts`
- Frontend tests: `pnpm test src/__tests__/components/dashboard/FinancialKPISection.test.tsx src/__tests__/components/DashboardAuth.test.tsx`
- Frontend lint: `pnpm exec eslint src/types/index.ts src/components/dashboard/FinancialKPISection.tsx src/pages/Dashboard.tsx src/__tests__/components/dashboard/FinancialKPISection.test.tsx src/__tests__/components/DashboardAuth.test.tsx`

### Completion Notes List

- Added `GET /api/v1/pm-dashboard/financial-summary` with `MANAGER`/`ADMIN` guard and Swagger DTO contract.
- Implemented `PmDashboardService.getFinancialSummary()` with 60s cache, current-month cost-per-ticket calculation, zero-division guard (`null`), and 14-day burn/ceiling/forecast payload.
- Added reusable `FinancialMetricsService.getDashboardBudgetInsights()` to centralize financial aggregation logic (14-day spend, monthly spend, budget ceiling, forecast).
- Wired backend module dependencies so PM dashboard can reuse financial metrics service without duplicating raw queries.
- Added/updated backend unit tests for new controller endpoint and service behavior.
- Added frontend `FinancialKPISection` on dashboard, using `motion.div` and SVG sparkline pattern adapted from `StatsGrid`.
- Implemented strict role gating via `useAuth().user?.role === 'MANAGER' || user?.role === 'ADMIN'`.
- Implemented React Query caching with `staleTime: 60000` for financial summary fetch.
- Added `"No data yet"` graceful fallbacks when cost-per-ticket or burn data are empty.
- Added frontend tests for manager/admin rendering, role blocking for PM, and no-data fallback; updated dashboard auth test harness with `QueryClientProvider`.

### File List

- src/dashboards/dto/pm-dashboard.dto.ts
- src/dashboards/services/pm-dashboard.service.ts
- src/dashboards/pm-dashboard.controller.ts
- src/dashboards/dashboards.module.ts
- src/financial-metrics/financial-metrics.service.ts
- src/dashboards/services/pm-dashboard.service.spec.ts
- src/dashboards/services/pm-dashboard.service.search.spec.ts
- src/dashboards/pm-dashboard.controller.spec.ts
- ../dsf-dasbhoard/src/types/index.ts
- ../dsf-dasbhoard/src/components/dashboard/FinancialKPISection.tsx
- ../dsf-dasbhoard/src/pages/Dashboard.tsx
- ../dsf-dasbhoard/src/**tests**/components/dashboard/FinancialKPISection.test.tsx
- ../dsf-dasbhoard/src/**tests**/components/DashboardAuth.test.tsx
- \_bmad-output/implementation-artifacts/sprint-status.yaml

## Change Log

- 2026-03-02: Implemented Financial KPI widgets across backend and frontend, added tests, and moved story to `review`.
- 2026-03-02: Code review fixes applied — fixed budget ceiling data source (SystemConfig), corrected forecast line anchor to current day, added error state handling to FinancialKPISection, decoupled FinancialKPISection from summary block, fixed SVG gradient ID collision, removed duplicate WorkloadSchedulerService provider, added role metadata test for financial-summary, fixed global cache key, added Swagger 403 response. Story moved to `done`.
