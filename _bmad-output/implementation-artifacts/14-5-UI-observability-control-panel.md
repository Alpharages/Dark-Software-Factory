# Story 14.5-UI: UI: Observability Control Panel

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a System Operator or PM,
I want a real-time dashboard showing system health, queue status, and file locks,
so that I can monitor the AI factory in real-time, detect bottlenecks, and resolve resource conflicts immediately.

## Acceptance Criteria

1. **System Health Widget**
   - Must poll `GET /api/v1/dashboard/system-health` every 10 seconds or use Socket.IO.
   - Traffic light indicators (Green/Yellow/Red) for Database, RabbitMQ, and Prometheus. Include connection error states if endpoints fail.
   - Display latency for each component and an uptime counter in HH:MM:SS format.
   - Must handle disconnected states clearly indicating to the user if the server connection drops.

2. **Queue Depth Monitor**
   - Must use `GET /api/v1/dashboard/queue-metrics`.
   - Utilize Recharts Line or Bar charts to visualize queue depths (`ai-execution-queue`, `qa-check-queue`, `deployment-queue`) and processing rates (tickets/hour).
   - Display a visual alert (Red highlight) if queue depth > 50 or oldest message > 1 hour.
   - Use custom responsive Recharts Tooltips and `ResponsiveContainer` to fit mobile fallback view gracefully.

3. **File Lock & Conflict Tracker**
   - Must use `GET /api/v1/dashboard/file-locks` mapped to `FileLockDto`.
   - Table of active locks containing `file_path`, `ticket_id`, and `duration` built with `shadcn/ui` `DataTable`.
   - Show a conflict warning badge for tickets waiting for the same file.
   - Provide a "Manually Release" button. This **must fire a `DELETE /api/v1/dashboard/file-locks/:ticketId` mutation using TanStack `useMutation` and invalidate the active locks query**.

4. **AI Provider Status**
   - Display availability and status for Cursor CLI, Windsurf, and Antigravity.
   - Allow operators to manually pause execution if needed via a toggle state managed through server APIs.

## Tasks / Subtasks

- [x] Task 1: Create `useObservabilityData` Hook (AC: 1, 2, 3)
  - [x] Implement data fetching from the three dashboard APIs with 30s polling fallback and Socket.IO real-time updates.
  - [x] Handle error states properly and return disconnected booleans.
- [x] Task 2: Build `HealthMonitorGrid` Component (AC: 1, 4)
  - [x] Create traffic light indicators using `shadcn/ui` `Badge` and `Card` components for Database, RabbitMQ, Prometheus, and AI Providers.
  - [x] Add pause execution toggle.
- [x] Task 3: Build `QueueMetricsChart` Component (AC: 2)
  - [x] Translate queue metrics data into Recharts visualization for depths and rates inside a `ResponsiveContainer`.
  - [x] Implement threshold-based red highlighting.
- [x] Task 4: Build `FileLockTable` Component (AC: 3)
  - [x] Display active locks and conflicts in a shadcn/ui data table.
  - [x] Add the "Manually Release" button via TanStack Mutation.
- [x] Task 5: Assemble `ObservabilityControlPanel` Page
  - [x] Combine all components into a responsive Desktop primary layout (fallback to single column Mobile).
- [x] Task 6: Add Route and Navigation
  - [x] Add route to App.tsx with proper role-based access control.
  - [x] Add sidebar navigation link in Operations section.

## Dev Notes

### 🚨 CRITICAL GUARDRAILS 🚨

1. **State Management Constraint**: Rely entirely on component-level TanStack Query (`@tanstack/react-query`) hooks for data fetching. NO `useEffect` standard `fetch` logic inside React components that aren't wrapped in a custom Query hook.
2. **Tech Stack Constraints**: React 19, Tailwind CSS v4, and shadcn/ui (`Card`, `Badge`, `DataTable`, `Button`). Visualization via **Recharts**.
3. **Immutability of UI components**: Feature module location must be `src/features/observability/`. Hooks go in `/hooks`, Components in `/components`, Types in `/types` matching existing apps. Map incoming backend DTOs properly (`SystemHealthDto`, `QueueMetricsDto`, `FileLockDto`).

### Project Structure Notes

- Alignment with unified project structure:
  - Components location: `src/features/observability/components/`
  - Hooks location: `src/features/observability/hooks/`
  - Types/Interfaces: `src/features/observability/types/`
- Adhere to the `dashboard-ui-engineering` skill when crafting visual components to match the "dsf-dashboard" stack.

### References

- [Source: _bmad-output/planning-artifacts/prd.md#FR100] Operators view real-time orchestrator status.
- [Source: _bmad-output/planning-artifacts/prd.md#FR101] Operators see current queue depth and processing rate.
- [Source: _bmad-output/planning-artifacts/architecture.md#Section-Dashboard-Monitoring] Dashboard controllers expose REST APIs; React + TypeScript frontend.
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#UX-Requirements] Real-time updates via Socket.IO; Role-specific dashboard views.

## Dev Agent Record

### Agent Model Used

Antigravity (gemini-2.5-pro)

### Debug Log References

- Reviewed `epic-13-14-15-v3-remaining.md` for Epic 14 Context.
- Gathered details from PRD, arch, and UX design docs.
- Applied validations post-checklist review to enforce strict component/hook boundaries and explicit mutation strategies.
- Implemented in the correct frontend repository at `/Volumes/Data/project/products/alpharages/dsf-dasbhoard/`.

### Completion Notes List

- ✅ Ultimate context engine analysis completed - comprehensive developer guide created.
- ✅ [AI-Review] Added strict component path definitions avoiding vague locations.
- ✅ [AI-Review] Specific Recharts tooltips and responsive behavior added.
- ✅ [AI-Review] Included strict mutation instructions for `useMutation` on lock release.
- ✅ [AI-Review] Refined components to use `shadcn/ui` standard definitions (Card, Badge).
- ✅ Created `useObservabilityData` hook with TanStack Query + Socket.IO real-time support
- ✅ Implemented `HealthMonitorGrid` with traffic light indicators (Green/Yellow/Red)
- ✅ Implemented `QueueMetricsChart` with Recharts Bar/Line charts and threshold alerts
- ✅ Implemented `FileLockTable` with conflict badges and manual release mutation
- ✅ Assembled `ObservabilityControlPanel` page with responsive grid layout
- ✅ Added route `/observability` with role-based access control (PM, TL, QA, MANAGER, ADMIN, OPERATOR)
- ✅ Added sidebar navigation link in Operations section
- ✅ Created utility functions (formatUptime, formatLatency, formatDuration, formatQueueName)
- ✅ Created Alert UI component for the design system
- ✅ [AI-Review] Implemented AI Providers Status fetch and execution pause toggle
- ✅ [AI-Review] Refactored FileLockTable to use shadcn/ui Table components
- ✅ [AI-Review] Fixed polling interval to 10 seconds per AC1
- ✅ [AI-Review] Added unit tests for useObservabilityData hook

### File List

Frontend Repository: `/Volumes/Data/project/products/alpharages/dsf-dasbhoard/`

**Observability Feature Module:**

- `src/features/observability/index.ts` - Feature exports
- `src/features/observability/types/index.ts` - TypeScript types (SystemHealthDto, QueueMetricsDto, FileLockDto, etc.)
- `src/features/observability/api/observability.api.ts` - API client functions
- `src/features/observability/hooks/useObservabilityData.ts` - Main data hook with polling + Socket.IO
- `src/features/observability/hooks/useObservabilityData.test.tsx` - Unit tests for observability hook
- `src/features/observability/components/HealthMonitorGrid.tsx` - System health widget with traffic lights
- `src/features/observability/components/QueueMetricsChart.tsx` - Queue metrics visualization with Recharts
- `src/features/observability/components/FileLockTable.tsx` - File lock table with conflict tracking
- `src/features/observability/components/ObservabilityControlPanel.tsx` - Main dashboard component

**Page Integration:**

- `src/pages/observability/ObservabilityPage.tsx` - Page wrapper component
- `src/pages/observability/index.ts` - Page exports

**UI Components:**

- `src/components/ui/alert.tsx` - New Alert component with variants (default, destructive, warning, success)

**Utilities (Extended):**

- `src/lib/utils.ts` - Added: formatUptime, formatLatency, formatDuration, formatQueueName

**App Integration:**

- `src/App.tsx` - Added route `/observability` with role-based access control
- `src/components/layout/Sidebar.tsx` - Added Observability link in Operations section

## Change Log

| Date       | Change                                                                                                                           | Author      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 2026-02-20 | Initial story creation                                                                                                           | BMAD        |
| 2026-02-20 | Story implementation complete - UI components created in dsf-dasbhoard repo                                                      | Dev Agent   |
| 2026-02-20 | Code review fixes applied: Fixed polling interval, implemented AI Provider status, updated DataTable usage, and added unit tests | AI Reviewer |
