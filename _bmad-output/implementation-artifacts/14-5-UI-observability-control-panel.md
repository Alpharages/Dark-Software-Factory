# Story 14-5-UI: Real-Time Observability Dashboard

**Epic:** 14 - v3 Observability & Operational Features  
**Story ID:** 14-5-UI  
**Status:** TODO  
**Priority:** High  
**Effort:** 3 days  
**Dependencies:** Story 14.5 (Observability API) ✅

---

## Story

**As a** System Operator or PM  
**I want** a real-time dashboard showing system health, queue status, and file locks  
**So that** I can monitor the AI factory in real-time, detect bottlenecks, and resolve resource conflicts immediately.

---

## Acceptance Criteria

### AC#1: System Health Widget
- **Endpoint**: `GET /api/v1/dashboard/system-health`
- **Display**: 
    - Traffic light indicators (Green/Yellow/Red) for Database, RabbitMQ, and Prometheus.
    - Latency display for each component.
    - Uptime counter in HH:MM:SS format.
- **Logic**: Poll every 10 seconds.

### AC#2: Queue Depth Monitor
- **Endpoint**: `GET /api/v1/dashboard/queue-metrics`
- **Charts**: Use `Recharts` Line or Bar charts to show:
    - Queue depth for `ai-execution-queue`, `qa-check-queue`, `deployment-queue`.
    - Processing rates (tickets/hour).
- **Alert**: Highlight in Red if queue depth > 50 or oldest message > 1 hour.

### AC#3: File Lock & Conflict Tracker
- **Endpoint**: `GET /api/v1/dashboard/file-locks`
- **Display**: 
    - Table of active locks: `file_path`, `ticket_id`, `duration`.
    - Conflict warning: Show tickets waiting for the same file.
- **Action**: Button to "Manually Release" lock (calls future DELETE endpoint).

---

## Technical Details

- **Repository**: `dsf-dashboard`
- **Components**:
    - `HealthMonitorGrid.tsx`
    - `QueueMetricsChart.tsx`
    - `FileLockTable.tsx`
    - `DependencyGraph.tsx` (Integrating Story 12 logic)
- **Hook**: `useObservabilityData` for polling and aggregation.
