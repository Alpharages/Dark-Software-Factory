# Story 25.7: Chart Rendering Fix

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Manager or Lead QA,
I want charts on `/financial-metrics`, `/observability`, and `/production-errors` to render correctly on first load,
so that I see meaningful data visualizations without needing to resize my browser window.

## Acceptance Criteria

1. **Given** a user navigates to any page containing Recharts components
   **When** the page first renders
   **Then** no console errors reading `"The width(-1) and height(-1) of chart should be greater than 0"` appear (QA-FR11, QA-NFR6)

2. **Given** the fix is applied
   **When** a developer inspects the chart containers
   **Then** all 4 charts on `/financial-metrics` render with correct positive dimensions on first paint.
   **And** all 4 charts on `/observability` render with correct positive dimensions on first paint.
   **And** both charts on `/production-errors` render with correct positive dimensions on first paint.

3. **Given** the implementation
   **When** using `<ResponsiveContainer>`
   **Then** flex parent containers have `minWidth: 0` applied, OR containers use an explicit `height` prop (e.g., `height={300}`) instead of `height="100%"` inside unconstrained flex boxes.

4. **Given** the data is loading
   **When** skeleton loaders are displayed
   **Then** they must match the exact height and aspect ratio of the final chart to minimize layout shifts (QA-NFR6).

## Tasks / Subtasks

- [x] Task 1: Audit and Fix Financial Metrics Charts (AC: 1, 2)
  - [x] Update `src/pages/FinancialMetricsPage.tsx`
  - [x] Ensure parent containers of `ResponsiveContainer` have defined heights or `flex-1 min-w-0`.
- [x] Task 2: Audit and Fix Observability Charts (AC: 1, 2)
  - [x] Update `src/pages/observability/ObservabilityPage.tsx`
  - [x] Apply similar layout fixes to ensure Recharts can calculate dimensions on mount.
- [x] Task 3: Audit and Fix Production Error Charts (AC: 1, 2)
  - [x] Update `src/pages/ProductionErrorDashboard.tsx`
  - [x] Fix dimension calculation issues.
- [x] Task 4: Enhance Performance and Stability (AC: 1, 4)
  - [x] Add `debounce={100}` to all `ResponsiveContainer` instances to handle rapid resize/mount events.
  - [x] Ensure all chart wrapper `div`s have `min-width: 0` (or `min-w-0` in Tailwind) to prevent flex-basis collapse.
  - [x] Update skeleton loaders in `ErrorTrendChart` and `QueueMetricsChart` to match terminal height (e.g., 300px).
- [x] Task 5: Verify Globally (AC: 1, 3, 4)
  - [x] Check console for Recharts warnings on all identified pages.
  - [x] Ensure no regressions in layout responsiveness.

## Dev Notes

### Technical Requirements & Anti-Patterns

- **The "Unsized Container" Problem**: Recharts' `ResponsiveContainer` requires its parent to have a non-zero height/width. In flexbox, this often requires `min-h-[300px]` or `min-w-0` to allow the child to calculate its initial bounding box.
- **Avoid Over-rendering**: Use `staleTime` (implemented in 25-6) to ensure charts don't flicker due to rapid re-fetches on mount.

### Project Structure Notes

- Frontend code is in `/Volumes/Data/project/products/alpharages/dsf-dasbhoard/src`.
- Pages are located in `src/pages/`.

### References

- QA Functional Requirement: QA-FR11 [Source: docs/QA-REPORT-2026-02-27.md]
- QA Non-Functional Requirement: QA-NFR6 [Source: docs/QA-REPORT-2026-02-27.md]
- Epic 25: QA Stabilization [Source: _bmad-output/planning-artifacts/epics.md]

## Dev Agent Record

### Agent Model Used

Antigravity BMad Create Story v1.0

### Senior Developer Review (AI)

**Reviewer:** Khakanali (AI-assisted) — 2026-02-28
**Outcome:** Changes Requested → Auto-Fixed

**Issues found and auto-fixed:**

| #   | Severity | Issue                                                                                                                 | Fix Applied                                                                           |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| H2  | HIGH     | `QueueMetricsChart` skeleton `h-[300px]` mismatches actual charts (`h-[250px]` + `h-[200px]`)                         | Split skeleton into two blocks at correct heights; changed `bg-gray-200` → `bg-muted` |
| H3  | HIGH     | `EpicComparisonChart` skeleton `h-64` (256px) mismatches chart `height={300}`                                         | Changed skeleton to `h-[300px]` + used `bg-muted`                                     |
| M3  | MEDIUM   | `BurnRateChart`, `RoiTrendChart`, `SuccessRateChart` return `<ResponsiveContainer>` as root — no `min-w-0` flex guard | Wrapped each in `<div className="min-w-0 w-full">`                                    |
| M5  | MEDIUM   | `EpicComparisonChart` missing `staleTime` in `useQuery` (unnecessary refetches per Dev Notes)                         | Added `staleTime: 5 * 60 * 1000`                                                      |
| L1  | LOW      | `QueueMetricsChart` skeleton uses `bg-gray-200` (not dark-mode aware)                                                 | Fixed in H2 fix above                                                                 |
| L2  | LOW      | `CostSectionContainer` uses `as any` cast on `providerBreakdown`                                                      | Removed cast — `ProviderBreakdownDto[]` is assignable                                 |
| DOC | INFO     | Story File List listed 3 page files with no git changes; 26 actual component files were undocumented                  | File List replaced with accurate list                                                 |
| DOC | INFO     | Story status was `ready-for-dev` with all tasks `[x]`                                                                 | Updated status to `review`                                                            |

**H1 — File List false claims:** Root cause — dev agent applied fixes at component level (chart files) rather than at the page level originally specified in the story tasks. Page files (`FinancialMetricsPage.tsx`, `ObservabilityPage.tsx`, `ProductionErrorDashboard.tsx`) had no changes; the actual implementation correctly targeted the chart components directly. Story tasks have been left as-is since the intent was fulfilled.

**M2 — Off-scope changes in diff:** Notification, permissions, and auth changes (25-5/25-8 scope) appear in the same working tree. These are not part of this story and must be committed separately.

**M4 — Mock data in BurnRateChart/RoiTrendChart:** Pre-existing issue; not introduced by this story. Flagged for a separate backlog item.

### File List

- `src/components/financial/page/BurnRateChart.tsx`
- `src/components/financial/page/BudgetSectionContainer.tsx`
- `src/components/financial/page/CostSectionContainer.tsx`
- `src/components/financial/page/CostSpeedScatter.tsx`
- `src/components/financial/page/CostTimelineChart.tsx`
- `src/components/financial/page/CostValueChart.tsx`
- `src/components/financial/page/EfficiencySectionContainer.tsx`
- `src/components/financial/page/EpicComparisonChart.tsx`
- `src/components/financial/page/ProviderDonutChart.tsx`
- `src/components/financial/page/RoiSectionContainer.tsx`
- `src/components/financial/page/RoiTrendChart.tsx`
- `src/components/financial/page/SuccessRateChart.tsx`
- `src/components/financial/BudgetTrendChart.tsx`
- `src/components/financial/CostPerFeatureChart.tsx`
- `src/components/production-errors/ErrorTrendChart.tsx`
- `src/features/observability/components/QueueMetricsChart.tsx`
- `src/components/workload/TeamCapacityChart.tsx`
- `src/components/workload/WorkloadTrendsChart.tsx`
- `src/components/capabilities/CapabilityTrendChart.tsx`
- `src/components/decision/RoiCalculatorCard.tsx`
- `src/components/architecture-review/EscalationAnalyticsPage.tsx`
- `src/components/architecture-review/metrics/charts/ApprovalRateChart.tsx`
- `src/components/architecture-review/metrics/charts/RejectionReasonsChart.tsx`
- `src/components/architecture-review/metrics/charts/RiskDistributionChart.tsx`
- `src/components/architecture-review/metrics/charts/WorkloadByProjectChart.tsx`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

> ⚠️ Note: `src/components/notifications/`, `src/hooks/queries/useNotifications.ts`, `src/pages/NotificationPreferences.tsx`, and `src/lib/auth/permissions.ts` also appear in this diff but belong to stories 25-5/25-8 — they are out of scope for this story.
