# Story 9.UI: Production Error Monitoring Dashboard

**Status:** backlog  
**Epic:** Epic 9 (Self-Healing & Production Monitoring)  
**Priority:** Medium  
**Repository:** `dsf-dashboard`

## Story
As a Developer or Support Engineer,
I want a dashboard to visualize production errors and AI self-healing attempts,
So that I can identify system stability issues and verify that AI is fixing bugs correctly.

## Acceptance Criteria

1. **Given** production errors are being logged
   **When** I access the `/monitoring/errors` page
   **Then** I see:
   - **Error List**: Categorized by severity (Blocker, Major) and status (Open, Self-Healing-Requested, Resolved).
   - **Trend Chart**: Error frequency over time (last 24h, 7d).
   - **Impact Metrics**: Number of affected users and services.

2. **And** I can drill down into an error:
   - **Stack Trace & Logs**: Formatted view of the production error context.
   - **Self-Healing Link**: If AI created a fix ticket, link specifically to that ticket's execution trail.

3. **And** management controls:
   - **Manual Fix Trigger**: Button to manually trigger AI self-healing for a specific error.
   - **Status Update**: Mark error as 'False Positive' or 'Manually Resolved'.

## Tasks
- [ ] Create `/monitoring/errors` route and navigation.
- [ ] Build `ErrorOverviewTable` with severity color-coding.
- [ ] Create `ErrorDetailView` with code-syntax highlighting for stack traces.
- [ ] Implement `SelfHealTriggerButton` with confirmation modal.
- [ ] Integrate with `GET /api/v1/monitoring/errors` and `POST /api/v1/monitoring/self-heal`.

## References
- [Epic 9 Strategy](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/epics.md#Epic-9)
