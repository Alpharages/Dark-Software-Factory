# Epic 12: v3 Dependency & Conflict Management

**Epic Key:** DSF-12  
**Status:** Backlog  
**Priority:** High  
**Phase:** Phase 2 (Week 2-3)  
**Dependencies:** Epic 11 (v3 Foundation)  
**Blocks:** Epic 13, 14, 15

## Epic Overview

Handle task dependencies and prevent concurrent modification conflicts. Implement circular dependency detection, file lock manager, dependency ETA calculation, and AI branch strategist to intelligently select base branches.

## Business Value

- **Reliability:** Zero deadlocks from circular dependencies
- **Efficiency:** 80% reduction in merge conflicts via file locking
- **Transparency:** ETA calculations for waiting tickets
- **Intelligence:** AI-driven branch selection based on dependency chains

## Success Metrics

- Zero circular dependency deadlocks
- 80% reduction in merge conflicts
- 100% of waiting tickets show accurate ETAs
- AI branch selection accuracy >90%

## Technical Scope

### New Services

- `CircularDependencyDetectorService` - Graph traversal to detect cycles
- `DependencyManagerService` - Track dependencies and calculate ETAs
- `FileLockManagerService` - Prevent concurrent file modifications
- `BranchStrategistService` - AI-powered branch selection

### Database Integration

- Use `TicketDependency` and `FileLock` models from Epic 11
- Integration with ClickUp API for dependency fetching

## Stories

### 12.1: Circular Dependency Detector

**Effort:** 2 days  
**Story Points:** 5

Detect circular dependencies in ClickUp task chains to prevent deadlocks.

**Acceptance Criteria:**

- AC#1: DFS algorithm detects cycles in dependency graph
- AC#2: Alerts PM with dependency chain visualization
- AC#3: Updates all tickets in cycle to "Blocked - Circular Dependency"
- AC#4: AI decision logged with full dependency graph
- AC#5: Unit tests with multiple cycle patterns
- AC#6: Integration test with ClickUp API

**Tasks:**

- [ ] Create `src/dependencies/circular-dependency-detector.service.ts`
- [ ] Implement `detectCircularDependencies()` with DFS
- [ ] Implement `buildDependencyGraph()` from ClickUp data
- [ ] Implement `visualizeCycle()` for PM alerts
- [ ] Implement `markTicketsAsCircular()` to update statuses
- [ ] Add Prometheus metrics for circular detections
- [ ] Write unit tests with cycle scenarios
- [ ] Write integration test with mock ClickUp responses

---

### 12.2: Dependency Manager & ETA Calculator

**Effort:** 2 days  
**Story Points:** 5

Manage ticket dependencies and calculate ETAs for waiting tickets.

**Acceptance Criteria:**

- AC#1: `checkDependencies()` validates all deps resolved
- AC#2: `calculateETA()` uses historical data + pipeline position
- AC#3: ETA updated every time dependent ticket progresses
- AC#4: `notifyDependentTickets()` re-queues waiting tickets
- AC#5: Database stores dependency status and ETA
- AC#6: Unit tests >80% coverage

**Tasks:**

- [ ] Create `src/dependencies/dependency-manager.service.ts`
- [ ] Create `src/dependencies/dependency-manager.module.ts`
- [ ] Implement `checkDependencies()` method
- [ ] Implement `calculateETA()` with historical averages
- [ ] Implement `notifyDependentTickets()` for re-queueing
- [ ] Add Prometheus metrics for dependency wait times
- [ ] Write unit tests
- [ ] Document ETA calculation algorithm

---

### 12.3: File Lock Manager

**Effort:** 3 days  
**Story Points:** 8

Prevent merge conflicts by locking files during ticket processing.

**Acceptance Criteria:**

- AC#1: AI predicts which files will be modified
- AC#2: `acquireLocks()` uses database transaction for atomicity
- AC#3: Conflicting tickets queued with ETA
- AC#4: Locks released automatically after PR merge
- AC#5: FIFO queue per file for fairness
- AC#6: Dashboard shows current locks and waiting tickets
- AC#7: Unit tests with concurrent lock requests

**Tasks:**

- [ ] Create `src/file-locks/file-lock-manager.service.ts`
- [ ] Create `src/file-locks/file-lock-manager.module.ts`
- [ ] Implement `predictFileModifications()` using AI
- [ ] Implement `acquireLocks()` with transaction
- [ ] Implement `releaseLocks()` with notification
- [ ] Implement `checkConflicts()` for detection
- [ ] Add Prometheus metrics for lock contention
- [ ] Write unit tests with concurrency scenarios
- [ ] Create dashboard API endpoints

---

### 12.4: AI Branch Strategist

**Effort:** 1.5 days  
**Story Points:** 3

AI-powered base branch selection based on dependency chains.

**Acceptance Criteria:**

- AC#1: No dependencies → selects `main` branch
- AC#2: Single dependency → follows dependency's branch
- AC#3: Multiple dependencies → uses `main` with merge strategy
- AC#4: AI logs reasoning for branch selection
- AC#5: Integrates with Ticket Intake Consumer
- AC#6: Unit tests >80% coverage

**Tasks:**

- [ ] Create `src/git/branch-strategist.service.ts`
- [ ] Implement `selectBaseBranch()` logic
- [ ] Implement `getDependencyBranches()` helper
- [ ] Add AI decision logging
- [ ] Add Prometheus metrics
- [ ] Write unit tests with various dependency scenarios
- [ ] Document branch selection strategy in ADR

---

### 12.5: Update Ticket Intake Consumer for v3

**Effort:** 2 days  
**Story Points:** 5

Wire dependency and conflict checks into ticket intake flow.

**Acceptance Criteria:**

- AC#1: Circular dependency check runs before processing
- AC#2: Dependency check blocks if deps unresolved
- AC#3: File lock check prevents concurrent modifications
- AC#4: Branch selection integrated into workflow
- AC#5: ClickUp status updated with AI reasoning
- AC#6: E2E test validates full flow

**Tasks:**

- [ ] Update `TicketIntakeConsumer` with dependency checks
- [ ] Add circular dependency detection step
- [ ] Add file lock acquisition step
- [ ] Add branch selection step
- [ ] Add re-queue logic for waiting tickets
- [ ] Add ClickUp status update integration
- [ ] Write E2E test for dependency flow
- [ ] Verify Prometheus metrics

---

## Technical Debt

- AI file modification prediction may have false positives initially (improve over time)
- File lock recovery mechanism if system crashes (implement dead-lock detection)
- Performance optimization for large dependency graphs (>100 tickets)

## Definition of Done

- [ ] All 5 stories completed
- [ ] Zero circular dependency deadlocks in testing
- [ ] File lock manager tested under concurrent load
- [ ] All unit tests passing (>80% coverage)
- [ ] E2E test validates full dependency flow
- [ ] Prometheus metrics verified
- [ ] Dashboard shows locks and waiting tickets
- [ ] Documentation updated
- [ ] Code review completed
- [ ] Epic retrospective conducted

## References

- Implementation Plan: `/docs/implementation-plan-v3.md`
- System Flow Diagram: `/docs/system-flow-diagram-v3.md`
- Epic 11: Database schema for dependencies and locks
