# Story 10.2: Execution Progress Streaming

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Product Manager**,
I want to **receive real-time execution progress updates via WebSocket**,
so that **I can monitor AI task execution without manually refreshing and know exactly what stage each ticket is in**.

## Acceptance Criteria

1. **Execution Lifecycle Event Emission**
   - `ExecutionTrackerService` must emit real-time events via `RealtimeService` for all state transitions: QUEUED → IN_PROGRESS → COMPLETED/FAILED/TIMEOUT/CANCELLED
   - Events must include execution ID, ticket ID, status, timestamp, and progress metadata (current step, percent complete, error message if failed)
   - Events must be emitted immediately after database updates are committed (not before)
   - Event payload must match the `ExecutionProgressEvent` interface from `realtime.types.ts`

2. **Execution Progress Updates**
   - System must emit `execution.progress` events during long-running executions (e.g., during AI code generation, testing, deployment)
   - Progress updates must include:
     - `currentStep`: String describing what the AI agent is doing (e.g., "Analyzing codebase", "Generating code", "Running tests")
     - `percentComplete`: 0-100 integer estimate of completion
   - Progress updates should emit at meaningful intervals (not more than once every 5 seconds to avoid flooding)
   - Updates must be sent to the project-specific room (`project:{projectId}`)

3. **Room-Based Routing**
   - Execution events must be emitted to:
     - Project-specific room: `project:{projectId}` (for PMs monitoring their projects)
     - Role-based rooms: `role:ADMIN`, `role:MANAGER` (for global oversight)
     - User-specific room: `user:{assignedPmUserId}` (if PM is assigned to the ticket)
   - System must resolve projectId from ticket before emitting
   - If projectId is not available, fall back to broadcast to all admins/managers

4. **Event Types Specification**
   - **`execution.started`**: Emitted when execution transitions to IN_PROGRESS
     - Payload: `{ executionId, ticketId, projectId, aiProvider, startedAt }`
   - **`execution.progress`**: Emitted during execution with progress updates
     - Payload: `{ executionId, ticketId, projectId, currentStep, percentComplete, lastUpdated }`
   - **`execution.completed`**: Emitted when execution succeeds
     - Payload: `{ executionId, ticketId, projectId, completedAt, filesModified[], testsPassed }`
   - **`execution.failed`**: Emitted when execution fails
     - Payload: `{ executionId, ticketId, projectId, failedAt, errorMessage, isRetryable }`
   - **`execution.timeout`**: Emitted when execution times out
     - Payload: `{ executionId, ticketId, projectId, timeoutSeconds, lastKnownProgress }`
   - **`execution.cancelled`**: Emitted when execution is manually cancelled
     - Payload: `{ executionId, ticketId, projectId, cancelledAt, reason, cancelledBy }`

5. **Integration Points**
   - `ExecutionTrackerService.startExecution()` must emit `execution.started` event
   - `ExecutionTrackerService.markInProgress()` must emit `execution.progress` event (0% complete)
   - `ExecutionTrackerService.completeExecution()` must emit `execution.completed` event
   - `ExecutionTrackerService.failExecution()` must emit `execution.failed` event
   - `ExecutionTrackerService.timeoutExecution()` must emit `execution.timeout` event
   - `ExecutionTrackerService.cancelExecution()` must emit `execution.cancelled` event

6. **Error Handling \u0026 Resilience**
   - WebSocket emission failures must NOT block execution state transitions
   - Use try-catch around `RealtimeService` calls with logging
   - If RealtimeService is unavailable, execution must continue normally (degraded mode)
   - Prometheus metric `websocket_emission_errors_total` must track failures

## Tasks / Subtasks

- [x] **Define Event Interfaces** (AC 4)
  - [x] Add `ExecutionProgressEvent`, `ExecutionStartedEvent`, `ExecutionCompletedEvent`, `ExecutionFailedEvent`, `ExecutionTimeoutEvent` to `realtime.types.ts`
  - [x] Ensure interfaces match database Execution model fields
- [x] **Inject RealtimeService into ExecutionTrackerService** (AC 5)
  - [x] Import `RealtimeService` from `@/realtime/realtime.service`
  - [x] Add constructor dependency injection
  - [x] Make injection optional to support graceful degradation if RealtimeModule is not loaded
- [x] **Emit execution.started event** (AC 1, 5)
  - [x] In `startExecution()`, after database commit, call `realtimeService.emitToProject(projectId, 'execution.started', payload)`
  - [x] Fallback to `emitToRole('ADMIN')` if projectId is null
  - [x] Wrap in try-catch, log errors, increment Prometheus metric
- [x] **Emit execution.progress event** (AC 2, 5)
  - [x] In `markInProgress()`, emit `execution.progress` with `percentComplete: 0` and `currentStep: 'Starting execution'`
  - [x] Add helper method `emitProgress(executionId, currentStep, percentComplete)` for reusability
  - [x] Implement rate limiting: track `lastProgressEmit` timestamp per execution, skip if `Date.now() - lastProgressEmit < 5000ms`
- [x] **Emit execution.completed event** (AC 5)
  - [x] In `completeExecution()`, emit `execution.completed` with result metadata
  - [x] Include `filesModified` array from completion DTO
- [x] **Emit execution.failed event** (AC 5)
  - [x] In `failExecution()`, emit `execution.failed` with error details
  - [x] Include `isRetryable` flag from failure DTO
- [x] **Emit execution.timeout event** (AC 5)
  - [x] In `timeoutExecution()`, emit `execution.timeout` with timeout details
  - [x] Include `lastKnownProgress` if available
- [x] **Emit execution.cancelled event** (AC 5)
  - [x] In `cancelExecution()`, emit `execution.cancelled` with reason
- [x] **Add Prometheus Metrics** (AC 6)
  - [x] Register `websocket_emission_errors_total` counter in `ExecutionModule` providers using `makeCounterProvider({ name: 'websocket_emission_errors_total', help: 'WebSocket emission failures', labelNames: ['event', 'reason'] })`
  - [x] Inject counter in `ExecutionTrackerService` constructor
  - [x] Increment on each emission failure with event name and error reason labels
- [x] **Resolve Project ID from Ticket** (AC 3)
  - [x] Add helper method to query Ticket → Project relationship
  - [x] Cache projectId in execution context if possible
- [x] **Unit Tests** (All ACs)
  - [x] Test each emission method with mocked `RealtimeService`
  - [x] Test graceful degradation when `RealtimeService` is unavailable
  - [x] Test error handling and metrics increment
  - [x] Verify correct room routing (project, role, user)

## Dev Notes

### Architecture Compliance

- **Module**: `src/execution/execution-tracker.service.ts` (modify existing)
- **Module Import**: Add `RealtimeModule` to `ExecutionModule.imports[]` array (required for dependency injection)
- **Dependencies**:
  - `RealtimeService` from `@/realtime/realtime.service`
  - Optional injection pattern: `@Optional() private readonly realtimeService?: RealtimeService`
  - Prometheus counter: `@InjectMetric('websocket_emission_errors_total') private readonly emissionErrorsCounter: Counter`
- **Event Types**: Define in `src/realtime/realtime.types.ts` (existing file from Story 10-U-1)
- **Integration Pattern**: Fire-and-forget WebSocket emissions (do NOT await, do NOT block state machine)
- **EventBus vs RealtimeService**:
  - `EventBusService` (existing): Internal domain events for database, RabbitMQ, state machine coordination
  - `RealtimeService` (new): External WebSocket events for frontend clients
  - **Both fire in parallel** - do NOT refactor EventBus to trigger WebSocket or vice versa

### Key Technical Requirements

1. **Optional Dependency Injection**

   ```typescript
   constructor(
     // ... existing dependencies
     @Optional() private readonly realtimeService?: RealtimeService,
     @InjectMetric('websocket_emission_errors_total')
     private readonly emissionErrorsCounter?: Counter,
   ) {}
   ```

2. **Generic Event Emission Helper** (Recommended Pattern)

   ```typescript
   private async emitExecutionEvent<T extends Record<string, any>>(
     event: string,
     execution: Execution,
     additionalPayload: Partial<T> = {},
   ): Promise<void> {
     if (!this.realtimeService) {
       this.logger.warn('RealtimeService not available, skipping WebSocket emission');
       return;
     }

     const projectId = execution.ticket?.projectId || null;
     const payload = {
       executionId: execution.id,
       ticketId: execution.ticketId,
       projectId,
       ...additionalPayload,
     };

     try {
       if (projectId) {
         await this.realtimeService.emitToProject(projectId, event, payload);
       } else {
         await this.realtimeService.emitToRole('ADMIN', event, payload);
         await this.realtimeService.emitToRole('MANAGER', event, payload);
       }
     } catch (error) {
       this.logger.error(`Failed to emit ${event}:`, error);
       this.emissionErrorsCounter?.inc({ event, reason: error.message });
     }
   }
   ```

3. **Project ID Resolution** (Critical Implementation Detail)

   **Execution model already includes ticket relationship** - use Prisma include:

   ```typescript
   // In ExecutionRepository or ExecutionTrackerService methods:
   const execution = await this.prisma.execution.findUnique({
     where: { id: executionId },
     include: { ticket: { select: { projectId: true } } },
   });
   // Access: execution.ticket.projectId
   ```

   **DO NOT inject TicketIntakeService** - causes circular dependency. Access via loaded relationship.

4. **Rate Limiting for Progress Updates** (AC 2)

   ```typescript
   private lastProgressEmitMap = new Map<string, number>(); // executionId → timestamp

   private shouldEmitProgress(executionId: string): boolean {
     const lastEmit = this.lastProgressEmitMap.get(executionId) || 0;
     const now = Date.now();
     if (now - lastEmit < 5000) return false; // 5 second minimum interval
     this.lastProgressEmitMap.set(executionId, now);
     return true;
   }
   ```

5. **Event Payload Interfaces**

   ```typescript
   export interface ExecutionProgressEvent {
     executionId: string;
     ticketId: string;
     projectId: string | null;
     currentStep: string;
     percentComplete: number; // 0-100
     lastUpdated: Date;
   }

   export interface ExecutionStartedEvent {
     executionId: string;
     ticketId: string;
     projectId: string | null;
     aiProvider: string;
     startedAt: Date;
   }

   // ... define ExecutionCompletedEvent, ExecutionFailedEvent, ExecutionTimeoutEvent, ExecutionCancelledEvent
   ```

### Security

- All WebSocket events already authenticated by `WsAuthGuard` (Story 10-U-1)
- RBAC for room subscriptions handled by `RealtimeGateway.joinProject()` (Story 10-U-1)
- No additional auth needed in `ExecutionTrackerService` (just emit events)

### Testing Strategy

- **Unit Tests**: Mock `RealtimeService`, verify emission calls and parameters
- **Integration Tests**: Use real `RealtimeGateway`, subscribe to rooms, verify events received
- **E2E Tests**: Deferred to future story (requires frontend + full stack integration)

### Project Structure Notes

**Files to Modify:**

- `src/execution/execution-tracker.service.ts` - Add RealtimeService injection and event emissions
- `src/execution/execution.module.ts` - **CRITICAL**: Import `RealtimeModule` in imports array AND add `makeCounterProvider()` for `websocket_emission_errors_total` metric
- `src/realtime/realtime.types.ts` - Add all 6 execution event interfaces (started, progress, completed, failed, timeout, cancelled)
- `src/execution/execution.repository.ts` - Ensure Prisma queries include `{ ticket: { select: { projectId: true } } }` for project ID access

**Files to Create:**

- `src/execution/execution-tracker.service.spec.ts` - Additional tests for WebSocket emission logic

### References

- [Story 10-U-1: Socket.IO Infrastructure](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/10-U-1-socket-io-real-time-infrastructure.md) - Established RealtimeService and event emission patterns
- [Architecture Doc: WebSocket Events](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/architecture.md#Section-Real-Time-Communication) - Event specifications
- [ExecutionTrackerService](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/execution/execution-tracker.service.ts) - Service to modify
- [Epic 14.5 Enhancement](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/sprint-status.yaml#L753) - Future backend real-time APIs will provide additional ticket timeline data

### Previous Story Intelligence

**Story 10-U-1 Learnings:**

- `RealtimeService` provides 4 emission methods: `emitToProject()`, `emitToRole()`, `emitToUser()`, `broadcast()`
- Event interfaces must be exported from `realtime.types.ts` (CODE REVIEW FINDING from 10-U-1)
- Use `@Optional()` decorator for graceful degradation (pattern from existing codebase)
- Metrics tracking is critical (CODE REVIEW FINDING from 10-U-1)
- Error handling must use try-catch wrappers to prevent service crashes

**Established Patterns:**

- Fire-and-forget emission (do NOT await or block critical paths)
- Defensive programming with null checks
- Prometheus metrics for observability
- Room-based routing: `project:{id}`, `role:{role}`, `user:{userId}`

## Dev Agent Record

### Agent Model Used

Antigravity (Google Deepmind)

### Debug Log References

- Code Review: 2026-02-05

### Completion Notes List

- Implemented WebSocket event streaming in `ExecutionTrackerService` for all 6 execution lifecycle states.
- Added `RealtimeModule` to `ExecutionModule` with optional dependency injection.
- Defined all 6 event interfaces in `realtime.types.ts`.
- Implemented rate limiting (5000ms) for progress updates.
- Added `websocket_emission_errors_total` Prometheus metric.
- Added 6/6 unit tests in `execution-tracker.websocket.spec.ts` verifying emission logic and fallbacks.

### Change Log

- 2026-02-05: Code Review applied fixes - marked all tasks as complete, populated file list, and updated status to done.

### File List

- src/execution/execution-tracker.service.ts
- src/execution/execution.module.ts
- src/execution/execution.repository.ts
- src/realtime/realtime.types.ts
- src/execution/execution-tracker.websocket.spec.ts
