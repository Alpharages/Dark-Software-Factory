# Story 5.4: Workload Management & Capacity Planning

**Status:** ready-to-start

## Story
**As a PM,**  
I want to monitor my workload and capacity,  
So that I can prevent burnout and request help before overload.

**As a Manager,**  
I want to see all PMs' workload distribution,  
So that I can balance capacity and prevent team burnout.

## Merged From
- Original Story 5.6 (Workload & Capacity Dashboard)
- Original Story 5.7 (Manager View - Team Capacity Overview)

## Acceptance Criteria
- [ ] **AC#1:** PMs see current utilization % (active_tickets / max_tickets * 100).
- [ ] **AC#2:** Burnout risk indicator displays (green/yellow/red) with threshold explanations.
- [ ] **AC#3:** Alerts trigger when PM >80% utilization (notify PM, Manager, and leadership).
- [ ] **AC#4:** Managers see all PMs' utilization in sortable bar chart.
- [ ] **AC#5:** Managers can reassign projects via drag-and-drop (updates `projects.pm_id`).
- [ ] **AC#6:** Capacity trends over time displayed (weekly chart showing historical utilization).

## Tasks

### Backend (DSF BUILDS)
- [ ] Implement Utilization calculation API:
    - [ ] PM view: `GET /api/v1/workload/pm/{id}`
    - [ ] Manager view: `GET /api/v1/workload/team` (RBAC MANAGER role).
- [ ] Database aggregations (active tickets count, utilization %).
- [ ] Implement Burnout risk calculation logic.
- [ ] Alert logic (>80% utilization trigger).
- [ ] Project reassignment endpoint: `POST /api/v1/projects/{id}/reassign`.
- [ ] Expose Prometheus metrics (`pm_utilization_percent`).

### Frontend (AI DELEGATES)
- [ ] Utilization dashboard UI (gauges, charts).
- [ ] Burnout risk indicators and alerts UI.
- [ ] Workload metrics visualization (completion/rejection rates).
- [ ] Manager team capacity view (bar chart).
- [ ] Drag-and-drop project reassignment UI.

## Dev Notes
- **Dependencies:** Epic 2 (Ticket data).
- **FRs Covered:** FR15, FR16, FR17, FR18, FR19.
- **Effort:** 3.5 days.
