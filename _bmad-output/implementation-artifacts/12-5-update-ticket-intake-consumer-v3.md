# Story 12.5: Update Ticket Intake Consumer for v3

**Status:** drafted
**Effort:** 2 days
**Story Points:** 5
**Developer:** [Assignee]
**Dev Branch:** `feature/12-5-update-ticket-intake-v3`

## Description

Integrate the newly developed v3 dependency and conflict management services into the primary ticket intake flow. This story wires the `CircularDependencyDetectorService`, `DependencyManagerService`, `FileLockManagerService`, and `BranchStrategistService` into the pipeline to ensure that every ticket processed in v3 is safe, non-redundant, and executes against the correct branch.

## Acceptance Criteria

1.  **Circular Dependency Check**: The `TicketIntakeService` must call `CircularDependencyDetectorService.detectCircularDependencies()` immediately after basic validation.
2.  **PM Notification for Cycles**: If a circular dependency is detected, the ticket must be marked as `BLOCKED_CIRCULAR` and a PM alert must be triggered (via 12.1 service).
3.  **Dependency Blocking**: if a ticket has unresolved dependencies (detected via `DependencyManagerService.checkDependencies()`), it must be marked as `WAITING` and not proceed to routing.
4.  **ETA Calculation**: Waiting tickets must have an initial ETA calculated and stored in the database.
5.  **File Lock Acquisition**: The `AIRoutingService` (or equivalent) must acquire file locks via `FileLockManagerService.acquireLocks()` before initiating AI execution.
6.  **Conflict Queuing**: If locks are unavailable, the ticket must enter the lock queue and wait for notification to re-process.
7.  **AI Branch Selection**: The `BranchStrategistService` must be used to select the base branch for every execution, integrating it into the `Execution` record and logging reasoning.
8.  **E2E Validation**: A complete end-to-end test (`test/dependency-flow.e2e-spec.ts`) must demonstrate:
    - A ticket with a cycle being blocked.
    - A ticket waiting for another being queued with ETA.
    - Two tickets with file conflicts executing sequentially.
    - A dependent ticket automatically re-triggering once its blocker is merged.

## Tasks

### Phase 1: Intake & Dependency Integration

- [ ] Update `TicketIntakeService.processTaskEvent` to call `CircularDependencyDetectorService.detectCircularDependencies()`.
- [ ] Implement early exit: If `CircularDependencyResult.hasCycle` is true, mark ticket `BLOCKED_CIRCULAR` and stop.
- [ ] Integrate `DependencyManagerService.checkDependencies()`:
  - If `canProceed` is false, update status to `WAITING`.
  - Call `calculateETA()` to set initial `estimated_eta`.
  - **Re-queue Pattern**: Do NOT publish to `ai-routing-queue`.
- [ ] Ensure `DependencyManagerService` successfully triggers re-intake via `notifyDependentTickets()` when a blocker is resolved.

### Phase 2: Routing, Locking & Branching

- [ ] Update `AIRoutingService.routeTicket`:
  - Predict files via `FileLockManagerService.predictFileModifications()`.
  - Acquire locks via `acquireLocks(executionId, files)`.
- [ ] Handle **Lock Blocking**:
  - If locks are not acquired, publish ticket back to `ai-routing-wait-queue` (5-min delay) and mark status `WAITING_FOR_LOCKS`.
- [ ] Integrate `BranchStrategistService.selectBaseBranch(ticketId)`:
  - Call _after_ locks are successfully acquired.
  - Update `Execution` record with `base_branch` and `branch_selection_log`.
- [ ] Ensure `executionId` is passed to all loggers for correlation.

### Phase 3: Monitoring & Audit Trail

- [ ] Log all v3 decisions via `AIDecisionLoggerService`:
  - `circular_dependency_check`, `dependency_resolution`, `file_lock_acquisition`, `branch_selection`.
- [x] Integrate `CircularDependencyDetectorService` into `TicketIntakeService.processTaskEvent`.
- [x] Implement cycle blocking logic and ClickUp notifications.
- [x] Integrate `DependencyManagerService` for blocker checking and ETA calculation.
- [x] Update `AIRoutingService` to handle file lock prediction and acquisition.
- [x] Implement `WAITING_FOR_LOCKS` routing logic and RabbitMQ re-queueing.
- [x] Integrate `BranchStrategistService` for intelligent base branch selection.
- [x] Log all AI routing decisions and dependency findings to `AIDecisionLog`.
- [x] Implement E2E tests in `test/dependency-flow.e2e-spec.ts`.
- [x] **FIX**: Resolved race condition in branch selection (updated `BranchStrategistService` to return decision object instead of performing direct DB update).

## File List

- [MODIFY] [ticket-intake.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/ticket-intake/ticket-intake.service.ts)
- [MODIFY] [ai-routing.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/ai-routing/ai-routing.service.ts)
- [MODIFY] [branch-strategist.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/services/branch-strategist.service.ts)
- [MODIFY] [dependency-manager.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/dependencies/dependency-manager.service.ts)
- [NEW] [dependency-flow.e2e-spec.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/test/dependency-flow.e2e-spec.ts)
- [MODIFY] [ticket-intake.module.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/ticket-intake/ticket-intake.module.ts)
- [MODIFY] [ai-routing.module.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/ai-routing/ai-routing.module.ts)
- [MODIFY] [schema.prisma](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/prisma/schema.prisma)
- [MODIFY] [sprint-status.yaml](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/sprint-status.yaml)
- [MODIFY] [dependencies.module.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/dependencies/dependencies.module.ts)
- [MODIFY] [circular-dependency-detector.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/dependencies/circular-dependency-detector.service.ts)
- [MODIFY] [file-lock-manager.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/file-locks/file-lock-manager.service.ts)

## Change Log

- 2025-12-24: Initial implementation of v3 integrations.
- 2025-12-24: Fixed race condition in branch selection and expanded E2E coverage after adversarial review.

## References

- [Epic 12: v3 Dependency & Conflict Management](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/epic-12-v3-dependency-conflict-management.md)
- [Story 12.1: Circular Dependency Detector](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/12-1-circular-dependency-detector.md)
- [Story 12.2: Dependency Manager & ETA Calculator](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/12-2-dependency-manager-eta-calculator.md)
- [Story 12.3: File Lock Manager](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/12-3-file-lock-manager.md)
- [Story 12.4: AI Branch Strategist](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/12-4-ai-branch-strategist.md)
- [System Flow Diagram v3](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/system-flow-diagram-v3.md)
