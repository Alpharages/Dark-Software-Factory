# Story 12-UI: AI Resource Manager (Locks & Dependencies)

**Epic:** 12 - v3 Dependency & Conflict Management  
**Story ID:** 12-UI  
**Status:** TODO  
**Priority:** Medium  
**Effort:** 3 days  
**Dependencies:** Story 12.1 (Dep Schema), 12.3 (Lock Manager) ✅

---

## Story

**As a** Tech Lead  
**I want** to visualize the dependency graph and active file locks  
**So that** I can identify why a ticket is waiting and resolve circular dependencies or stale locks.

---

## Acceptance Criteria

### AC#1: Active File Lock Table
- **Display**: Live list of files currently locked by AI agents.
- **Fields**: File Path, Ticket ID (Link to ClickUp), Lock Age, Execution ID.
- **Indicator**: Visual badge for "Stale" locks (>30 minutes).

### AC#2: Dependency Graph Visualization
- **Display**: A force-directed or hierarchical graph (e.g., using `react-flow` or `d3`).
- **Nodes**: Tickets/Files.
- **Edges**: "Depends on" or "Reserved by" relationships.
- **Detection**: Highlight circular dependency loops in Red.

### AC#3: Conflict Resolution Actions
- **Action**: "Force Unlock" to clear a file lock.
- **Action**: "Reprioritize" to move a ticket ahead in the lock queue.

---

## Technical Details

- **Repository**: `dsf-dashboard`
- **Components**:
    - `DependencyGraph.tsx`
    - `ActiveLockManager.tsx`
    - `ResourceConflictPanel.tsx`
- **Library**: `react-flow-renderer` for graph visualization recommended.
