# Story 26.8: Quality & Provider KPI Widgets

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a PM, Lead QA, or Manager,
I want to see quality metrics and AI provider distribution on the PM Dashboard,
so that I can monitor the reliability of our AI outputs and understand which models we rely on most.

## Acceptance Criteria

1. **AC 1: PR Merge Rate (STAT-5)**
   - **Given** an authenticated user is on the PM Dashboard
   - **When** the KPI widgets render
   - **Then** a "PR Merge Rate" widget shows: the percentage of auto-generated PRs merged without manual rework, calculated from GitHub module PR statuses.
2. **AC 2: QA First-Pass Rate (STAT-6)**
   - **Given** an authenticated user is on the PM Dashboard
   - **When** the KPI widgets render
   - **Then** a "QA First-Pass Rate" widget shows: the percentage of executions that passed QA checks on the first attempt, calculated from QA automation results.
3. **AC 3: AI Provider Distribution (STAT-8)**
   - **Given** an authenticated user is on the PM Dashboard
   - **When** the KPI widgets render
   - **Then** an "AI Provider Distribution" widget shows a small pie or donut chart breaking down usage percentages between Claude, Cursor, and Windsurf, based on recent AI-routing decision logs.

## Tasks / Subtasks

- [x] Task 1: Backend API and Service Integration (AC: 1, 2, 3)
  - [x] Add new endpoints or expand `getSummary` in `PmDashboardService` to provide `pr_merge_rate`, `qa_first_pass_rate`, and `provider_distribution`.
  - [x] **PREVENT REINVENTION**: Inject existing services (e.g., from `GitHubModule`, `QaAutomationModule`, and `AiRoutingModule`) to calculate these metrics rather than writing raw queries.
  - [x] Update `DashboardSummaryDto` in `pm-dashboard.dto.ts` to reflect the new KPI stats.
- [x] Task 2: Frontend Components (AC: 1, 2, 3)
  - [x] Update `DashboardSummary` interface in `src/types/index.ts` to include the new fields.
  - [x] Add the PR Merge Rate and QA First-Pass Rate widgets to the dashboard `StatsGrid` (`src/components/dashboard/StatsGrid.tsx`).
  - [x] Create a new pie/donut chart component for AI Provider Distribution using Recharts. **Note**: Consider refactoring the existing `ProviderDonutChart` in `financial/page` into a shared component to avoid duplication.
  - [x] **Recharts Safety**: Ensure the donut chart's `<ResponsiveContainer>` is wrapped in a container that has `min-w-0` and `debounce={100}`.
- [x] Task 3: Client Data Fetching and Caching
  - [x] Update frontend React Query hooks to fetch the new metrics.
  - [x] Set `staleTime` appropriately (e.g., 60 seconds) to avoid duplicate fetching and hitting the database too frequently, adhering to performance fixes from Epic 25.
  - [x] Provide graceful degradation (e.g., "No data yet") if the metrics are not available or there's zero data.

## Dev Notes

- **Architecture Constraints**: Ensure the new endpoints follow the established module boundaries. Do not directly access `github` tables from the Dashboard service without going through the appropriate internal service.
- **Performance**: Like previous stories, avoid heavy calculations on the main DB thread. Ensure aggregations are efficiently queried.
- **Data Fallbacks (CRITICAL)**: Handle divide-by-zero scenarios gracefully when calculating percentages (e.g., if there are 0 PRs total, the merge rate should be handled logically rather than throwing `NaN`).
- **Metric Definitions**: PR Merge Rate without manual rework implies checking PRs where human review comments or rejection counts are zero. QA First-Pass Rate implies executions that successfully passed QA immediately without entering a retry/fix loop.
- **Git/Review Learnings**: We recently fixed zero-dimension rendering issues with Recharts. Ensure the new donut chart implements `min-w-0` correctly up the DOM tree!

### Project Structure Notes

- Alignment with unified project structure. Make sure any new DTO fields match the backend contract precisely.

### References

- QA-FR35: Epic 26 — PR Merge Rate KPI [Source: docs/QA-REPORT-2026-02-27.md]
- QA-FR36: Epic 26 — QA First-Pass Rate KPI [Source: docs/QA-REPORT-2026-02-27.md]
- QA-FR38: Epic 26 — AI Provider Distribution chart [Source: docs/QA-REPORT-2026-02-27.md]
- Epic 26 Requirements [Source: _bmad-output/planning-artifacts/epics.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Backend tests: `pnpm test src/dashboards/services/pm-dashboard.service.spec.ts src/dashboards/services/pm-dashboard.service.search.spec.ts src/github/github.service.spec.ts src/audit/ai-decision-logger.service.spec.ts src/qa-automation/qa-results.service.spec.ts`
- Backend lint: `pnpm exec eslint src/dashboards/dto/pm-dashboard.dto.ts src/dashboards/services/pm-dashboard.service.ts src/dashboards/dashboards.module.ts src/github/github.service.ts src/github/github.service.spec.ts src/qa-automation/qa-results.service.ts src/qa-automation/qa-results.service.spec.ts src/audit/ai-decision-logger.service.ts src/audit/ai-decision-logger.service.spec.ts src/dashboards/services/pm-dashboard.service.spec.ts src/dashboards/services/pm-dashboard.service.search.spec.ts`
- Frontend tests: `cd ../dsf-dasbhoard && pnpm test src/__tests__/components/dashboard/StatsGrid.test.tsx src/__tests__/components/dashboard/ProviderDistributionChart.test.tsx src/__tests__/components/DashboardAuth.test.tsx src/__tests__/components/dashboard/FinancialKPISection.test.tsx`
- Frontend lint: `cd ../dsf-dasbhoard && pnpm exec eslint src/types/index.ts src/components/dashboard/StatsGrid.tsx src/components/dashboard/ProviderDistributionChart.tsx src/pages/Dashboard.tsx src/__tests__/components/dashboard/StatsGrid.test.tsx src/__tests__/components/dashboard/ProviderDistributionChart.test.tsx src/__tests__/components/DashboardAuth.test.tsx`

### Completion Notes List

- Extended `DashboardSummaryDto` and PM dashboard summary payload with `pr_merge_rate`, `qa_first_pass_rate`, and `provider_distribution`.
- Implemented KPI aggregation via existing module services (not raw dashboard queries): `GitHubService.getPrMergeRateStats()`, `QaResultsService.getQaFirstPassRateStats()`, and `AIDecisionLoggerService.getProviderDistributionStats()`.
- Updated `PmDashboardService` to inject/reuse those services and include new KPI values in cached summary responses.
- Wired `DashboardsModule` to import `GitHubModule` for cross-module KPI service reuse.
- Updated frontend summary types and enhanced `StatsGrid` with PR Merge Rate and QA First-Pass Rate cards.
- Added new `ProviderDistributionChart` donut widget and mounted it on the dashboard page.
- Enforced Recharts safety requirements on the new donut chart (`min-w-0` wrapper + `debounce={100}`).
- Added frontend regression tests for `StatsGrid` and `ProviderDistributionChart`, and updated dashboard auth test mocks.

### File List

- \_bmad-output/implementation-artifacts/26-8-quality-provider-kpi-widgets.md
- \_bmad-output/implementation-artifacts/sprint-status.yaml
- src/dashboards/dto/pm-dashboard.dto.ts
- src/dashboards/services/pm-dashboard.service.ts
- src/dashboards/dashboards.module.ts
- src/github/github.service.ts
- src/qa-automation/qa-results.service.ts
- src/audit/ai-decision-logger.service.ts
- src/dashboards/services/pm-dashboard.service.spec.ts
- src/dashboards/services/pm-dashboard.service.search.spec.ts
- src/github/github.service.spec.ts
- src/qa-automation/qa-results.service.spec.ts
- src/audit/ai-decision-logger.service.spec.ts
- ../dsf-dasbhoard/src/types/index.ts
- ../dsf-dasbhoard/src/components/dashboard/StatsGrid.tsx
- ../dsf-dasbhoard/src/components/dashboard/ProviderDistributionChart.tsx
- ../dsf-dasbhoard/src/pages/Dashboard.tsx
- ../dsf-dasbhoard/src/**tests**/components/dashboard/StatsGrid.test.tsx
- ../dsf-dasbhoard/src/**tests**/components/dashboard/ProviderDistributionChart.test.tsx
- ../dsf-dasbhoard/src/**tests**/components/DashboardAuth.test.tsx

## Change Log

- 2026-03-02: Implemented quality/provider KPI widgets across backend and frontend, added tests/lint coverage, and moved story status to `review`.
