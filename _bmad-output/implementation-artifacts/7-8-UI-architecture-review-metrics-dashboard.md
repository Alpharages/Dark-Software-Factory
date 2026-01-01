# Story 7.8-UI: Architecture Review Metrics Dashboard

Status: ready-for-dev

<!-- Note: This is a UI companion story to 7-8-architecture-review-metrics-insights -->

## Story

As a TL,
I want a visual dashboard of architecture review patterns and insights,
so that I can monitor the health of the AI architecture review process at a glance.

## Acceptance Criteria

1. **Given** I am on the Architecture Review dashboard
   **When** I navigate to the "Metrics" tab or page at `/architecture-review/metrics`
   **Then** I see high-level summary widgets:
   - **Review Volume:** Total ADRs reviewed this week/month vs previous.
   - **Average Review Time:** Average minutes spent per TL review action.
   - **Queue Depth:** Current count of ADRs waiting for review.
   - **Estimated Throughput:** Total review time required for current queue.

2. **And** I see visualize charts (using Recharts):
   - **Approval Rate Trend:** Line chart showing % Approved/Rejected over time.
   - **Risk Distribution:** Pie chart showing ratio of High, Medium, and Low risk decisions.
   - **Rejection Reasons:** Bar chart showing top 5 categories of AI rejections (e.g., "Security", "Performance").
   - **Review Volume by Project:** Bar chart comparing workload across different projects.

3. **And** I see "AI Learning Insights" section:
   - Dynamic cards showing patterns detected by the backend (e.g., "AI is 40% more compliant with schema designs after last TL feedback").
   - Trend indicators (Green/Red) showing improvement or regression in AI decision quality.

4. **And** I can filter dashboard data:
   - Date range picker (Last 7 days, 30 days, Custom).
   - Project selector (All or specific projects).
   - Risk level filter.

5. **And** real-time updates are supported:
   - Metrics refresh automatically when an ADR is reviewed (via React Query cache invalidation).

## Tasks / Subtasks

- [ ] UI Setup & Routing
  - [ ] Create route `/architecture-review/metrics` in `App.tsx`.
  - [ ] Add "Metrics & Insights" link to the Sidebar or as a tab in Architecture Review page.

- [ ] API Integration (AC#4, #5)
  - [ ] Create `useAdrMetrics` and `useAdrTrends` hooks in `src/hooks/api/useAdrMetrics.ts`.
  - [ ] Update `architectureReviewApi.ts` with metrics endpoints:
    - `GET /api/v1/architecture-review/metrics`
    - `GET /api/v1/architecture-review/trends`

- [ ] Component: Summary Widgets (AC#1)
  - [ ] Create `MetricsSummaryGrid` component.
  - [ ] Implement `MetricCard` with trend indicators and "Previous Period" comparisons.

- [ ] Component: Metrics Charts (AC#2)
  - [ ] Create `ApprovalRateChart` (Line chart with Recharts).
  - [ ] Create `RiskDistributionChart` (Pie chart with Recharts).
  - [ ] Create `RejectionReasonsChart` (Horizontal bar chart).
  - [ ] Create `WorkloadByProjectChart` (Grouped bar chart).

- [ ] Component: AI Insights Feed (AC#3)
  - [ ] Create `AiInsightsGallery` component.
  - [ ] Develop `InsightCard` with natural language summaries and impact scores.

- [ ] Dashboard Orchestration (AC#4)
  - [ ] Create `ArchitectureMetricsPage.tsx` at `src/pages/architecture-review/`.
  - [ ] Implement `MetricsFilters` component with date range and project selection.
  - [ ] Hook filters into React Query state for automatic refetching.

- [ ] Testing & Verification
  - [ ] Unit tests for charts with mock data.
  - [ ] Unit tests for filtering logic.
  - [ ] Smoke test for API integration with MSW or similar.

## Dev Notes

### Technical Stack
- **Frontend**: React 18, TypeScript, Tailwind CSS.
- **Charts**: `recharts` (standard for the project).
- **Data Fetching**: `@tanstack/react-query`.
- **UI Components**: Shadcn UI (Cards, Select, DatePicker, Popover).

### Architecture Patterns
- **Shared Components**: Reuse the `RiskBadge` logic for colors in charts (High=Red, Medium=Yellow, Low=Green).
- **Filtering**: Use URL query params for filter persistence (NFR-UX requirement).
- **Polling**: Implement 1-minute background polling for the dashboard to keep it "live" for TLs monitoring the queue.

### API Dependencies
- Backend Story 7.8 endpoints should be implemented (or mocked in `src/mocks/handlers.ts`).
- Reference: `GET /api/v1/architecture-review/metrics` DTOs.

### Project Structure Notes
```
src/
├── pages/
│   └── architecture-review/
│       └── ArchitectureMetricsPage.tsx
├── components/
│   └── architecture-review/
│       ├── metrics/
│       │   ├── ApprovalRateChart.tsx
│       │   ├── RiskDistributionChart.tsx
│       │   ├── RejectionReasonsChart.tsx
│       │   ├── MetricsSummaryGrid.tsx
│       │   └── AiInsightsGallery.tsx
│       └── MetricsFilters.tsx
├── hooks/
│   └── api/
│       └── useAdrMetrics.ts
└── api/
    └── architectureReviewApi.ts
```

### References
- [Story 7.8 (Backend)](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/7-8-architecture-review-metrics-insights.md)
- [Story 7-2-UI (Queue UI Pattern)](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/7-2-UI-architecture-review-queue.md)

## Dev Agent Record

### Agent Model Used
_To be filled by dev agent_

### Debug Log References
_To be filled by dev agent_

### Completion Notes List
_To be filled by dev agent_

### File List
_To be filled by dev agent_
