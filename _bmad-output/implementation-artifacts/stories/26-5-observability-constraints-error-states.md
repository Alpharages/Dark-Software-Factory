# Story 26-5: Observability Constraints & Error States

## Status

- **Epic**: [Epic 26: PM Dashboard Feature Completion & Operational KPIs](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/epics.md)
- **Status**: Done
- **Priority**: Medium (P2 - High Impact on Operational Visibility)
- **Effort**: 1 day (2 story points)
- **Source**: [QA-REPORT-2026-02-27.md](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/QA-REPORT-2026-02-27.md) (FE-10, FE-11, CE-2, CE-3)

## Goal

Improve the stability and error handling of the Observability and Architecture Constraints pages. This includes handling missing backend dependencies (like Docker/RabbitMQ) gracefully, fixing overlapping error/empty states, and resolving Recharts dimension issues.

## User Review Required

> [!NOTE]
> This story focuses on "graceful degradation". In development environments where the Docker daemon or RabbitMQ is not running, the Observability page will now show "Metrics Unavailable" badges instead of a global "Data Loading Error" alert.

## Proposed Changes

### [Observability] - Inline Error Handling & Auth

#### [MODIFY] [ObservabilityControlPanel.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/features/observability/components/ObservabilityControlPanel.tsx)

- Remove global `hasErrors` alert.
- Implement granular error feedback per section.

#### [MODIFY] [useObservabilityData.ts](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/features/observability/hooks/useObservabilityData.ts)

- Refactor manual `localStorage` token retrieval to use `useAuth()` hook.
- Ensure `isDisconnected` only triggers when critical connectivity is lost, not just individual service check failures.

### [Constraints] - State Machine & Auth

#### [MODIFY] [ConstraintsPage.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/pages/architecture-review/constraints/ConstraintsPage.tsx)

- Refactor to a clean mutual-exclusion state machine (`Loading` -> `Error` -> `Empty` -> `Data`).

#### [MODIFY] [useArchitectureConstraints.ts](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/hooks/api/useArchitectureConstraints.ts)

- Refactor to use `useAuth()` and handle missing tokens via TanStack Query `enabled` flag.

### [UI Fixes] - Recharts Zero-Dimension Fixes

#### [MODIFY] [ProductionErrorDashboard.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/pages/ProductionErrorDashboard.tsx)

- Apply `min-w-0` to chart containers.

#### [MODIFY] [CostTimelineChart.tsx](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/financial/page/CostTimelineChart.tsx)

- Add `<div className="min-w-0 w-full">` wrapper.

## Acceptance Criteria

### AC 1: Observability Graceful Degradation

- **Given** the RabbitMQ service is down in the backend
- **When** I view the Observability page
- **Then** the "RabbitMQ" card shows a "DEGRADED" or "DOWN" status
- **And** NO global "Data Loading Error" alert is visible
- **And** the page remains interactive (e.g., File Locks can still be viewed)

### AC 2: Constraints State Machine

- **Given** the backend returns an empty list for constraints
- **When** the page loads
- **Then** the loading spinner is shown first
- **And** then the "No constraints defined" empty state is shown
- **And** NO "Failed to load" alert appears if the request was successful but empty

### AC 3: Universal Chart Rendering

- **Given** I navigate rapidly between dashboards
- **When** a chart container initializes
- **Then** it renders correctly with proper dimensions on the first paint
- **And** NO `width(-1)` or `height(-1)` warnings appear in the browser console

## Verification Plan

### Automated Tests

- `pnpm test` in `dsf-dasbhoard`.
- `pnpm vitest run src/__tests__/features/observability/hooks/useObservabilityData.test.tsx`.

### Manual Verification

1. **Docker Stop Test:** Stop Docker, verify Observability page shows individual service failures but no global banner.
2. **First-Load Test:** Clear cache, open Financial Metrics, verify charts render instantly.

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Completion Notes List

- Replaced `localStorage` token reads with `useAuth()` + `getAccessToken()` in both `useObservabilityData.ts` and `useArchitectureConstraints.ts`
- Fixed tautological token condition: `options.token ?? (isAuthenticated ? getAccessToken() : null)`
- Removed global `hasErrors` alert from `ObservabilityControlPanel`; replaced with per-section "Metrics Unavailable" cards for system health, queue metrics, and file locks
- Added `aiProvidersError` prop to `HealthMonitorGrid` to surface AI provider failures instead of showing fake hardcoded fallback providers
- `isDisconnected` now only fires when socket is down AND system health fails (true backend unreachability), not on any individual HTTP error
- `ConstraintsPage` refactored to clean `Loading → Error → Empty → Data` state machine with strict mutual exclusion
- `useArchitectureConstraints` query guarded with `enabled: isAuthenticated && !!token`
- Applied `min-w-0` wrappers to Recharts containers in `ProductionErrorDashboard` and `CostTimelineChart`
- Updated tests from Jest to Vitest; added AuthContext mock; added Docker-down disconnection scenario tests

### File List

- `src/features/observability/components/ObservabilityControlPanel.tsx`
- `src/features/observability/components/HealthMonitorGrid.tsx`
- `src/features/observability/hooks/useObservabilityData.ts`
- `src/features/observability/hooks/useObservabilityData.test.tsx`
- `src/hooks/api/useArchitectureConstraints.ts`
- `src/pages/architecture-review/constraints/ConstraintsPage.tsx`
- `src/pages/ProductionErrorDashboard.tsx`
- `src/components/financial/page/CostTimelineChart.tsx`
- `src/__tests__/components/architecture-review/ConstraintsPage.test.tsx`
