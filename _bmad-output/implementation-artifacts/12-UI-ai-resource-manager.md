# Story 12.UI: AI Resource Manager (Locks & Dependencies)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Tech Lead,
I want to visualize the dependency graph and active file locks,
so that I can identify why a ticket is waiting and resolve circular dependencies or stale locks.

## Acceptance Criteria

1. **Active File Lock Table**:
   - Live list of files currently locked by AI agents via `socket.io` websocket events from `realtime/` module.
   - Fields required: File Path, Ticket ID (Link to ClickUp), Lock Age, Execution ID.
   - Visual badge for "Stale" locks (>30 minutes).
2. **Dependency Graph Visualization**:
   - Use `react-flow-renderer` combined with `dagre` for automated directed-acyclic graph layout.
   - Nodes represent Tickets or Files.
   - Edges represent "Depends on" or "Reserved by" relationships.
   - Circular dependency loops MUST be highlighted in Red.
3. **Conflict Resolution Actions**:
   - Provide a "Force Unlock" action (`DELETE /api/v1/locks/:id`) with an audit `reason` payload.
   - Provide a "Reprioritize" action (`POST /api/v1/queue/reprioritize`) to move a ticket ahead.
   - Both actions MUST invalidate TanStack Query keys `['active-locks']` and `['dependency-graph']` to refresh UI immediately.

## Tasks / Subtasks

- [x] Task 1 (AC: 1) Implement ActiveLockManager Component
  - [x] Subtask 1.1: Create TanStack Query hook `useActiveLocks` integrating socket event `lock.released` and `lock.acquired`.
  - [x] Subtask 1.2: Build the TanStack data table with "Stale" indicators.
- [x] Task 2 (AC: 2) Implement DependencyGraph Component
  - [x] Subtask 2.1: Integrate `react-flow` with `dagre` for auto-layout algorithm.
  - [x] Subtask 2.2: Map backend dependencies to React Flow Nodes and Edges.
  - [x] Subtask 2.3: Implement circular dependency detection logic for node/edge red highlighting.
- [x] Task 3 (AC: 3) Implement ResourceConflictPanel Actions
  - [x] Subtask 3.1: Add "Force Unlock" mutation with confirmation dialog requiring an audit reason.
  - [x] Subtask 3.2: Add "Reprioritize" mutation.
  - [x] Subtask 3.3: Implement `queryClient.invalidateQueries({ queryKey: ['active-locks'] })` on mutation success.
- [x] Task 4 Assemble Resource Manager Page
  - [x] Subtask 4.1: Combine all components in the main AI Resource Manager dashboard view.

## Dev Notes

### 🚨 CRITICAL GUARDRAILS 🚨

1. **Socket.IO Real-time updates:** The `dsf-dashboard` MUST connect to the Orchestrator's namespace. Do not use HTTP polling for lock states.
2. **Audit Logging:** Every destructive action (Force Unlock, Reprioritize) MUST send a `reason` in the request body for Epic 11 Audit Viewer compatibility.
3. **Query Invalidation:** Do not manage local component state for locks; rely entirely on TanStack Query cache invalidation `invalidateQueries` upon successful socket events or user mutations.

- **Technical Stack**: React 19, Tailwind CSS v4, and shadcn/ui.
- **Libraries**: `react-flow-renderer`, `dagre` (for layout), `@tanstack/react-query`, `@tanstack/react-table`.

### Project Structure Notes

- **Repository**: `/Volumes/Data/project/products/alpharages/dsf-dashboard`
- **Component File Locations**: `src/features/resource-manager/components/`
- **Hooks Location**: `src/features/resource-manager/hooks/`

### References

- Epic 12 context for v3 Dependency & Conflict Management.
- See skill `dashboard-ui-engineering` for architectural requirements.

## Dev Agent Record

### Agent Model Used

BMad Dev Agent (Claude Code)

### Debug Log References

- Epic analysis completed successfully.
- Checklist validation applied to ensure zero-reinvention and tech stack alignment.

### Completion Notes List

- ✅ Implemented ActiveLockManager component with TanStack Table
- ✅ Created useActiveLocks hook with Socket.IO integration for real-time updates
- ✅ Implemented DependencyGraph with react-flow and dagre auto-layout
- ✅ Added circular dependency detection with red highlighting
- ✅ Created ResourceConflictPanel with Force Unlock and Reprioritize actions
- ✅ All actions include audit reason for Epic 11 Audit Viewer compatibility
- ✅ Query invalidation on mutation success for real-time UI updates
- ✅ Added comprehensive test coverage for hooks
- ✅ Added route and sidebar navigation for Resource Manager
- ✅ Addressed code review findings (Socket namespace, Dagre memory leak, useMemo anti-pattern, missing tests)

### Implementation Plan

1. **Dependencies**: Added `@xyflow/react` (v12) and `dagre` (v0.8.5) for graph visualization
2. **Types**: Created TypeScript interfaces for FileLock, DependencyGraph, and API requests
3. **API Layer**: Implemented REST API client with authentication interceptors
4. **Hooks**: Created useResourceManager hooks with TanStack Query and Socket.IO integration
5. **Components**:
   - ActiveLockManager: Data table with sorting, filtering, and stale indicators
   - DependencyGraphVisualization: Interactive graph with auto-layout and circular dep highlighting
   - ResourceConflictPanel: Force Unlock and Reprioritize actions with confirmation dialogs
   - ResourceManagerPage: Main dashboard with tabs for Locks and Dependencies
6. **Testing**: Unit tests for all hooks with mocked API and socket events

### File List

- src/features/resource-manager/types/index.ts (new)
- src/features/resource-manager/api/resource-manager.api.ts (new)
- src/features/resource-manager/hooks/useResourceManager.ts (new)
- src/features/resource-manager/hooks/useResourceManager.test.tsx (new)
- src/features/resource-manager/components/ActiveLockManager.tsx (new)
- src/features/resource-manager/components/DependencyGraph.tsx (new)
- src/features/resource-manager/components/ResourceConflictPanel.tsx (new)
- src/features/resource-manager/components/ResourceManagerPage.tsx (new)
- src/features/resource-manager/index.ts (new)
- src/components/ui/textarea.tsx (new - shared component)
- src/App.tsx (modified - added route)
- src/components/layout/Sidebar.tsx (modified - added navigation)
- package.json (modified - dependencies)
- pnpm-lock.yaml (modified - dependencies)
- src/hooks/useSocket.ts (modified - add namespace parameter)

## Change Log

| Date       | Change                                                       | Author      |
| ---------- | ------------------------------------------------------------ | ----------- |
| 2026-02-20 | Initial implementation of AI Resource Manager UI             | Claude Code |
| 2026-02-20 | Added ActiveLockManager with real-time socket updates        | Claude Code |
| 2026-02-20 | Added DependencyGraph with react-flow and dagre layout       | Claude Code |
| 2026-02-20 | Added ResourceConflictPanel with Force Unlock & Reprioritize | Claude Code |
| 2026-02-20 | Added comprehensive test coverage                            | Claude Code |
