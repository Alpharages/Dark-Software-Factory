# Story 26.8: Quality & Provider KPI Widgets

Status: ready-for-dev

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

- [ ] Task 1: Backend API and Service Integration (AC: 1, 2, 3)
  - [ ] Add new endpoints or expand `getSummary` in `PmDashboardService` to provide `pr_merge_rate`, `qa_first_pass_rate`, and `provider_distribution`.
  - [ ] **PREVENT REINVENTION**: Inject existing services (e.g., from `GitHubModule`, `QaAutomationModule`, and `AiRoutingModule`) to calculate these metrics rather than writing raw queries.
  - [ ] Update `DashboardSummaryDto` in `pm-dashboard.dto.ts` to reflect the new KPI stats.
- [ ] Task 2: Frontend Components (AC: 1, 2, 3)
  - [ ] Update `DashboardSummary` interface in `src/types/index.ts` to include the new fields.
  - [ ] Add the PR Merge Rate and QA First-Pass Rate widgets to the dashboard `StatsGrid` (`src/components/dashboard/StatsGrid.tsx`).
  - [ ] Create a new pie/donut chart component for AI Provider Distribution using Recharts. **Note**: Consider refactoring the existing `ProviderDonutChart` in `financial/page` into a shared component to avoid duplication.
  - [ ] **Recharts Safety**: Ensure the donut chart's `<ResponsiveContainer>` is wrapped in a container that has `min-w-0` and `debounce={100}`.
- [ ] Task 3: Client Data Fetching and Caching
  - [ ] Update frontend React Query hooks to fetch the new metrics.
  - [ ] Set `staleTime` appropriately (e.g., 60 seconds) to avoid duplicate fetching and hitting the database too frequently, adhering to performance fixes from Epic 25.
  - [ ] Provide graceful degradation (e.g., "No data yet") if the metrics are not available or there's zero data.

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

Gemini Antigravity

### Debug Log References

N/A

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created

### File List

- \_bmad-output/implementation-artifacts/26-8-quality-provider-kpi-widgets.md
