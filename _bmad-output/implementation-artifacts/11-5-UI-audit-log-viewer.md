# Story 11-5-UI: AI Decision Audit Log Viewer

**Epic:** 11 - v3 Foundation & Safety  
**Story ID:** 11-5-UI  
**Status:** TODO  
**Priority:** Medium  
**Effort:** 2 days  
**Dependencies:** Story 11-5 (Backend Audit API) ✅

---

## Story

**As a** Tech Lead or QA Engineer  
**I want** a comprehensive UI to view and search AI decision audit logs  
**So that** I can understand why the AI made specific decisions, review low-confidence actions, and debug complex multi-step execution chains.

---

## Acceptance Criteria

### AC#1: Decision Timeline Component
- **Input**: `ticketId`
- **Action**: Fetch data from `GET /api/v1/audit/timeline/:ticketId`
- **Display**: Use a vertical timeline component (e.g., from `shadcn/ui` or custom)
- **Content**: Show `timestamp`, `agent_name`, `action`, and `confidence` (badge colored by score).
- **Drill-down**: Clicking an event opens a flyout/modal showing full `reasoning`, `input_data`, and `output_data` as formatted JSON.

### AC#2: Low-Confidence Review Queue
- **View**: A dedicated tab or page for "Review Required"
- **Action**: Fetch data from `GET /api/v1/audit/low-confidence`
- **Display**: A list/table of decisions with confidence < 0.5.
- **Filtering**: Allow adjusting the threshold slider (0.1 to 0.9) to refresh the view.
- **Workflow**: Ability to mark an audit log as "Reviewed" (UI state only for now, or update via future API).

### AC#3: Global Audit Search
- **Endpoint**: Integrated with `GET /api/v1/audit/search`
- **Filters**: UI for Agent Name, Action, Date Range, and Ticket ID.
- **Results**: Paginated table with "View Detail" links for each record.

---

## Technical Details

- **Repository**: `dsf-dashboard`
- **Components**:
    - `AuditTimeline.tsx`
    - `DecisionDetailModal.tsx`
    - `LowConfidenceQueue.tsx`
    - `AuditSearchForm.tsx`
- **Logic**: Use TanStack Query for data fetching and caching.
- **Mocking**: Provide mock data for the 11.5 API if the backend is not locally running.
