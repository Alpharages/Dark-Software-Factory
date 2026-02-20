# Story 12.UI: AI Resource Manager (Locks & Dependencies)

Status: ready-for-dev

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

- [ ] Task 1 (AC: 1) Implement ActiveLockManager Component
  - [ ] Subtask 1.1: Create TanStack Query hook `useActiveLocks` integrating socket event `lock.released` and `lock.acquired`.
  - [ ] Subtask 1.2: Build the TanStack data table with "Stale" indicators.
- [ ] Task 2 (AC: 2) Implement DependencyGraph Component
  - [ ] Subtask 2.1: Integrate `react-flow` with `dagre` for auto-layout algorithm.
  - [ ] Subtask 2.2: Map backend dependencies to React Flow Nodes and Edges.
  - [ ] Subtask 2.3: Implement circular dependency detection logic for node/edge red highlighting.
- [ ] Task 3 (AC: 3) Implement ResourceConflictPanel Actions
  - [ ] Subtask 3.1: Add "Force Unlock" mutation with confirmation dialog requiring an audit reason.
  - [ ] Subtask 3.2: Add "Reprioritize" mutation.
  - [ ] Subtask 3.3: Implement `queryClient.invalidateQueries({ queryKey: ['active-locks'] })` on mutation success.
- [ ] Task 4 Assemble Resource Manager Page
  - [ ] Subtask 4.1: Combine all components in the main AI Resource Manager dashboard view.

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

BMad Create Story Optimizer (Antigravity)

### Debug Log References

- Epic analysis completed successfully.
- Checklist validation applied to ensure zero-reinvention and tech stack alignment.

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List

- src/features/resource-manager/components/DependencyGraph.tsx (pending)
- src/features/resource-manager/components/ActiveLockManager.tsx (pending)
- src/features/resource-manager/components/ResourceConflictPanel.tsx (pending)
