# Story 26-6: AI Execution KPI Widgets

## Status

- **Epic**: [Epic 26: PM Dashboard Feature Completion & Operational KPIs](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/epics.md)
- **Status**: review
- **Priority**: Medium (P2 - High Operational Visibility)
- **Effort**: 1 day (3 story points)
- **Source**: [epics.md](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/epics.md) (QA-FR31, QA-FR32, QA-FR37)

## Goal

Enhance the PM Dashboard with real-time AI execution metrics. This provides PMs and Operators with immediate visibility into how the orchestrator is performing, its current load, and historical success/efficiency trends.

## Proposed Changes

### [Frontend] - Dashboard KPI Widgets

#### [NEW] [ExecutionKPISection.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/dashboard/ExecutionKPISection.tsx)

- Create a new component to house the specialized AI metrics.
- **STAT-1 (Success Rate)**: Radial gauge or circular progress showing % of successful executions.
- **STAT-2 (Avg Time)**: Metric card showing Queued -> Completed average duration in hours, with a sparkline for 7-day trend.
- **STAT-7 (Live Load)**: Dynamic counter for "Active" and "Queued" tasks, updated via Socket.IO.

#### [MODIFY] [App.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/App.tsx)

- Import and render `ExecutionKPISection` above or below the `StatsGrid`.
- Pass real-time socket events for "Active/Queued" updates to the KPIs.

#### [MODIFY] [src/types/index.ts](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/types/index.ts)

### 1. Backend Changes (NestJS)

- [x] Update `src/types/index.ts` (if shared) or `src/dashboards/dto/pm-dashboard.dto.ts` to include `success_rate`, `avg_completion_time_hours`, and `execution_counts` in the `DashboardSummary` response.
- [x] Modify `src/dashboards/services/pm-dashboard.service.ts` -> `getSummary()`:
  - Add logic to calculate overall `success_rate` from `QAResult.overall_passed` tied to the PM's tracked projects.
  - Calculate `avg_completion_time_hours` based on the difference between `Execution.started_at` and `Execution.completed_at` for successful executions in the timeframe.
  - Count active and queued executions for the live load.

### 2. Frontend Changes (React + Tailwind)

- [x] Create a new component `ExecutionKPISection.tsx` in `src/components/dashboard/`.
- [x] **STAT-1 Widget**: Implement the Success Rate gauge.
- [x] **STAT-2 Widget**: Implement the Average Completion Time sparkline chart using Recharts. Ensure `min-w-0` is applied to the chart's container.
- [x] **STAT-7 Widget**: Implement the Live Load counters. Utilize the existing `useSocket('/dashboard')` hook to listen for `execution:started` and `execution:finished` events and optimistically update the counts.
- [x] Update `src/pages/Dashboard.tsx` to include `ExecutionKPISection` above or below the existing `StatsGrid`.

## Acceptance Criteria

### AC 1: AI Execution Success Rate (STAT-1)

- **Given** I am on the PM Dashboard
- **When** the summary data loads
- **Then** I see a "Success Rate" widget showing the percentage of tickets that passed QA (`overall_passed: true` in `QAResult`).
- **And** it uses a color-coded gauge (Emerald for >90%, Amber for 70-90%, Rose for <70%).

### AC 2: Average Completion Time (STAT-2)

- **Given** multiple tickets have been completed in the last 7 days
- **When** the dashboard loads
- **Then** I see the "Avg Completion Time" metric in hours (Turnaround Time).
- **And** a sparkline shows the daily trend of this metric over the last 7 days.

### AC 3: Live Load Monitoring (STAT-7)

- **Given** the orchestrator is processing tickets
- **When** I view the "Live Load" widget
- **Then** I see real-time counters for "Currently Active" and "In Queue".
- **And** these counters increment/decrement instantly via Socket.IO events (`execution:started`, `execution:finished`) on the `/dashboard` namespace.

## Technical Guardrails

- **Charts**: Use `Recharts`. All ResponsiveContainers MUST have `min-w-0` on their parent `div` and `debounce={100}` to prevent zero-dimension width errors.
- **Real-time**: Use the centralized `SocketProvider` and `useSocket` hook. Do NOT create new socket instances.
- **Performance**: Ensure these metrics are cached with `staleTime: 60000` via React Query to prevent excessive DB load.

## Verification Plan

### Automated Tests

- `dsf-dasbhoard`: Unit test for `ExecutionKPISection` rendering with mock data.
- Backend: Integration test for `PmDashboardService` calculation logic.

### Manual Verification

1. **Live Sync**: Start an AI execution and verify the "Active" counter increments instantly.
2. **Layout**: Check responsiveness on 1440px and 1024px widths.

## Dev Agent Record

### File List

**Backend (`Dark Software Factory`):**

- `src/dashboards/dto/pm-dashboard.dto.ts` — Added `daily_avg_completion_hours: number[]` field to `DashboardSummaryDto`
- `src/dashboards/services/pm-dashboard.service.ts` — Fixed timing calculation (started_at), added 7-day filter, daily bucket computation, moved QA queries into Promise.all, reduced cache TTL to 60s
- `src/dashboards/services/pm-dashboard.service.spec.ts` — Updated mocks and assertions for new KPI fields

**Frontend (`dsf-dasbhoard`):**

- `src/components/dashboard/ExecutionKPISection.tsx` — New component: STAT-1 gauge, STAT-2 sparkline with real daily data, STAT-7 live load with socket
- `src/__tests__/components/dashboard/ExecutionKPISection.test.tsx` — Unit tests for component rendering and socket event handling
- `src/pages/Dashboard.tsx` — Integrated ExecutionKPISection; migrated summary fetch to React Query with staleTime: 60s
- `src/types/index.ts` — Added `daily_avg_completion_hours?: number[]` to DashboardSummary interface

### Change Log

| Date       | Change                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| 2026-03-02 | Initial implementation of AI Execution KPI widgets                                                                     |
| 2026-03-02 | Code review fixes: correct timing field, 7-day filter, real sparkline data, parallel DB queries, React Query staleTime |
