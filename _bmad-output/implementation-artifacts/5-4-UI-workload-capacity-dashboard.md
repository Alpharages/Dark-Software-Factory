# Story 5-4-UI: PM Workload & Capacity Dashboard

**Epic:** 5 - PM Dashboard & Intelligence  
**Story ID:** 5-4-UI  
**Status:** TODO  
**Priority:** Medium  
**Effort:** 3 days  
**Dependencies:** Story 5.4 (Workload API) ✅

---

## Story

**As a** PM or Manager  
**I want** visual gauges and charts for workload tracking  
**So that** I can balance capacity across the team and prevent burnout.

---

## Acceptance Criteria

### AC#1: PM Utilization Gauge
- **Endpoint**: `GET /api/v1/workload/pm/:id`
- **Component**: Circular SVG gauge (0-100%).
- **Color Logic**: 0-60% (Green), 61-80% (Yellow), >80% (Red/Burnout Risk).
- **Display**: "X / Y tickets active".

### AC#2: Team Capacity Overview (Manager View)
- **Endpoint**: `GET /api/v1/workload/team`
- **Display**: Sortable bar chart showing all PMs and their current utilization.
- **Action**: "Reassign" button in the chart/table to open the Project Reassignment Modal.

### AC#3: Historical Utilization Trend
- **Endpoint**: `GET /api/v1/workload/trends/:id`
- **Chart**: Area chart showing utilization over the last 30 days.
- **Analysis**: Highlight periods above the 80% threshold.

---

## Technical Details

- **Repository**: `dsf-dashboard`
- **Components**:
    - `UtilizationGauge.tsx`
    - `TeamCapacityBarChart.tsx`
    - `WorkloadHistoryChart.tsx`
    - `ReassignmentModal.tsx`
- **State**: Persistent project/PM selection in the dashboard sidebar.
