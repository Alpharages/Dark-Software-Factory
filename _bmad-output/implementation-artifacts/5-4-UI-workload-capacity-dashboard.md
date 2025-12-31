# Story 5-4-UI: Workload Management & Capacity Dashboard

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Background & Business Value

Dark Software Factory aims to transform the orchestration team from 30+ to 12-15 people while scaling projects from 15 to 50+. This puts massive pressure on PMs, making workload visibility and burnout prevention a critical business risk (Risk R1). Story 5.4 implemented the backend orchestration for workload tracking; this story (5.4-UI) delivers the visual command center for PMs to monitor their capacity and for Managers to balance distribution across the team.

- **Risk Mitigation:** Prevents PM burnout (R1) via real-time alerting.
- **Operational Scalability:** Enables Managers to handle 50+ projects by balancing load logically.
- **Efficiency:** Uses AI-delegated UI patterns for complex chart visualizations.

## Story

**As a PM,**  
I want a visual utilization gauge and historical trend charts,  
So that I can monitor my own capacity and prevent burnout before it happens.

**As a Manager,**  
I want a team-wide capacity overview with project reassignment capabilities,  
So that I can balance workload across the team and ensure no single orchestrator is overwhelmed.

---

## Acceptance Criteria

### AC#1: PM Utilization Gauge (Radial Gauge)
- **Endpoint:** `GET /api/v1/workload/pm/:id`
- **Visualization:** Circular SVG gauge showing 0-100% utilization.
- **Color Logic (NFR-UX8):** 
  - 🟢 0-60% (Healthy)
  - 🟡 61-80% (Warning)
  - 🔴 >80% (Burnout Risk / Critical)
- **Label:** Displays "X / Y active tickets" in center.
- **Context:** Sits in the top header or summary section of the PM Dashboard.

### AC#2: Historical Utilization Trends (Area Chart)
- **Endpoint:** `GET /api/v1/workload/trends/:id?days=30`
- **Chart:** Area chart using `Recharts` showing historical utilization % over 30 days.
- **Threshold Line:** Static horizontal dashed line at 80% (Burnout Threshold).
- **Tooltips:** Show date and utilization % on hover.

### AC#3: Team Capacity Overview (Manager Dashboard View)
- **Endpoint:** `GET /api/v1/workload/team` (RBAC: MANAGER/ADMIN only)
- **Visualization:** Sortable bar chart showing all PMs (Y-axis) and current utilization % (X-axis).
- **Sort Logic:** Sort by utilization (high-to-low) by default.
- **Drill-down:** Clicking a PM bar filters the project list to that PM's projects.

### AC#4: Project Reassignment Action
- **Action:** "Reassign" button in the Team Capacity chart or Project Card (Manager View).
- **Interface:** Modal with Searchable PM dropdown.
- **Integration:** Calls `POST /api/v1/projects/:id/reassign`.
- **Feedback:** Success toast and project list refresh on reassignment.

### AC#5: Real-time Burnout Alerts (Toast Notifications)
- **Socket Event:** `burnout-alert` (payload: `{ pmId, pmName, utilization }`).
- **Behavior:** Trigger a system-wide toast notification if current PM's utilization crosses 80%.
- **Actionability (NFR-UX3):** Toast includes "View Dashboard" link.

### AC#6: PM Capacity Configuration
- **Endpoint:** `PUT /api/v1/workload/pm/:id/capacity`
- **UI:** Simple numeric input (1-100) for `max_tickets`.
- **Validation:** Enforce positive integer.
- **Effect:** Immediately updates gauge calculation.

---

## Tasks / Subtasks

### 1. Repository Setup & Routing
- [x] **Create API Wrapper:** `src/api/workloadApi.ts` (AC: #1, #2, #3, #4, #6)
  - [x] Implement all workload-related endpoints using the established `axios` client pattern.
- [x] **Define Routes:** Update `src/App.tsx` (AC: #1, #3)
  - [x] Wrap new components in `ProtectedRoute` (MANAGER role for Team View).
- [x] **Navigation:** Update `src/components/layout/Sidebar.tsx` (AC: #3)
  - [x] Add "Capacity Monitor" link for Managers using the `Gauge` or `Users` icon.

### 2. Visualization Components (dsf-dasbhoard)
- [x] **UtilizationGauge:** SVG-based circular gauge component. (AC: #1)
  - [x] **REUSE PATTERN:** Refer to `src/components/financial/RoiGaugeWidget.tsx` for SVG radial implementation and color logic.
  - [x] Implement color spectrum based on percentage: 0-60% (Green), 61-80% (Yellow), >80% (Red).
- [x] **WorkloadTrendsChart:** Recharts `AreaChart` for 30-day history. (AC: #2)
  - [x] Implement 80% threshold line.
- [x] **TeamCapacityChart:** Recharts `BarChart` for manager view. (AC: #3)
  - [x] Handle sort and filter callbacks.

### 3. Action Components & Modals
- [x] **ReassignmentModal:** Searchable select dropdown for users. (AC: #4)
  - [x] Fetch users with `PM` role from project user API.
- [x] **CapacitySettings:** Floating setting or modal for updating `max_tickets`. (AC: #6)

### 4. Integration & Real-time
- [x] **API Integration:** Connect components to `workloadApi` endpoints. (AC: #1, #2, #3, #4, #6)
  - [x] Use `react-query` (TanStack Query) for data fetching and caching with 5m stale time.
- [x] **Socket.IO Logic:** Use existing `src/hooks/useSocket.ts` hook. (AC: #5)
  - [x] Listen for `burnout-alert` and `workload-update` events.
  - [x] Trigger system-wide `Toaster` notifications for alerts.

---

## Dev Notes / Developer Context

### Architecture & Tech Stack
- **Frontend:** React + TypeScript + Tailwind CSS.
- **Layout Pattern:** Follow `src/pages/FinancialMetricsPage.tsx` for the multi-widget grid layout.
- **Visualization:** `Recharts` for all charts. Ensure `ResponsiveContainer` is used for NFR-UX1 compliance.
- **Real-time:** Use the established `useSocket` hook; do not re-initialize the socket client.
- **Icons:** Use `lucide-react` icons (`Gauge`, `Users`, `BarChart3`, `AlertTriangle`) to match system style.

### API Contracts
- `GET /api/v1/workload/pm/:id` -> `{ utilization: number, active_tickets: number, max_tickets: number }`
- `GET /api/v1/workload/team` -> `{ data: [{ pmId: string, pmName: string, utilization: number }] }`
- `GET /api/v1/workload/trends/:id` -> `{ data: [{ date: string, utilization: number }] }`
- `POST /api/v1/projects/:id/reassign` -> `body: { newPmId: string, reason: string }`
- `PUT /api/v1/workload/pm/:id/capacity` -> `body: { max_tickets: number }`

### UI Rules (NFR-UX Alignment)
- **NFR-UX1:** responsive design - charts must use `ResponsiveContainer`.
- **NFR-UX2:** Critical actions < 3 clicks - "Reassign" must be available on the bar chart bar or project card.
- **NFR-UX8:** visual cues for workload (Green/Yellow/Red).

### Project Structure Notes
- Place components in `src/components/workload/`.
- API wrapper in `src/api/workloadApi.ts`.
- Components MUST reuse the radial SVG pattern from `RoiGaugeWidget.tsx` for consistency.

### References
- [PRD Section: Workload & Capacity Management](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/prd.md#L275-282)
- [Architecture: AI Delegation Pattern for UI](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/architecture.md#L656-788)
- [Backend Implementation Summary](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/5-4-workload-management-capacity-planning.md)
- [Financial Metrics Pattern Example](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/6-R-3-UI-financial-metrics-dashboard-page.md)
- [Reference Gauge Implementation](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/financial/RoiGaugeWidget.tsx)

## Dev Agent Record

### Agent Model Used
{{agent_model_name_version}}

### Completion Notes List
- [x] Implement `workloadApi.ts` first.
- [x] Reuse radial SVG logic from `RoiGaugeWidget.tsx`.
- [x] Ensure Manager/Admin RBAC for team views.
- [x] Link "Reassign" button to backend and toast feedback.

### File List
- **New Files:**
  - `src/api/workloadApi.ts`
  - `src/api/userApi.ts`
  - `src/components/workload/UtilizationGauge.tsx`
  - `src/components/workload/WorkloadTrendsChart.tsx`
  - `src/components/workload/TeamCapacityChart.tsx`
  - `src/components/workload/ReassignmentModal.tsx`
  - `src/components/workload/CapacitySettingsModal.tsx`
  - `src/pages/WorkloadCapacityPage.tsx`
- **Modified Files:**
  - `src/App.tsx` (Routing)
  - `src/components/layout/Sidebar.tsx` (Navigation)
