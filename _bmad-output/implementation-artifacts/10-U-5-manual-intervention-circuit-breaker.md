# Story 10.5: Manual Intervention Circuit Breaker

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Product Manager, Tech Lead, or Operations Admin**,
I want to **manually intervene in AI executions through pause/resume controls, decision overrides, and emergency stop functionality**,
so that **I can maintain operational control, prevent runaway executions, override incorrect AI decisions, and ensure human oversight when needed**.

## Acceptance Criteria

1. **Execution Control API Endpoints**
   - `POST /api/v1/execution/:id/pause` - Pause a running execution
     - Request: `{ reason: string, userId: string }`
     - Response: `{ executionId, status: 'PAUSED', pausedAt, pausedBy, reason }`
     - Must transition execution from `IN_PROGRESS` → `PAUSED`
     - Must emit `execution.paused` WebSocket event to appropriate rooms
   - `POST /api/v1/execution/:id/resume` - Resume a paused execution
     - Request: `{ userId: string, resumeNotes?: string }`
     - Response: `{ executionId, status: 'IN_PROGRESS', resumedAt, resumedBy }`
     - Must transition execution from `PAUSED` → `IN_PROGRESS`
     - Must emit `execution.resumed` WebSocket event
   - `POST /api/v1/execution/:id/emergency-stop` - Immediately terminate execution
     - Request: `{ reason: string, userId: string, killContainer?: boolean }`
     - Response: `{ executionId, status: 'EMERGENCY_STOPPED', stoppedAt, stoppedBy, reason }`
     - Must transition execution to `EMERGENCY_STOPPED` (terminal state)
     - Must emit `execution.emergency_stopped` WebSocket event
     - If `killContainer: true`, must immediately kill the Docker container
   - `POST /api/v1/execution/:id/override-decision` - Override AI decision/output
     - Request: `{ decision: 'APPROVE' | 'REJECT', reason: string, userId: string, overrideData?: object }`
     - Response: `{ executionId, decisionOverridden: true, overrideBy, overrideAt, newDecision }`
     - Must store override in `ExecutionOverride` table with full audit trail
     - Must emit `execution.decision_overridden` WebSocket event

2. **Execution State Machine Updates**
   - Add `PAUSED` state to `ExecutionStatus` enum
   - Add `EMERGENCY_STOPPED` state to `ExecutionStatus` enum (terminal state, no transitions out)
   - Update `ExecutionStateMachine` to support transitions:
     - `IN_PROGRESS` → `PAUSED` (allowed)
     - `PAUSED` → `IN_PROGRESS` (allowed - resume)
     - `PAUSED` → `CANCELLED` (allowed)
     - `PAUSED` → `EMERGENCY_STOPPED` (allowed)
     - Any non-terminal state → `EMERGENCY_STOPPED` (allowed)
   - Prevent transitions from `EMERGENCY_STOPPED` to any other state (terminal)

3. **Container Lifecycle Integration**
   - **Container Availability**: Check if `execution.container_id` exists before attempting container operations
     - If `container_id` is null (legacy execution or Epic 22 not fully deployed), skip container control operations
     - Log warning and increment metric `execution_container_control_skipped_total` with reason label
     - State transition should proceed successfully even if container control is skipped
   - When execution is paused:
     - Send `SIGSTOP` signal to Docker container to suspend process (if container exists)
     - Track paused state in `ExecutionTrackerService`
     - Do NOT terminate the container (preserve state for resume)
     - If container control fails, log warning but complete state transition
   - When execution is resumed:
     - Send `SIGCONT` signal to Docker container to resume process (if container exists)
     - Update execution status to `IN_PROGRESS`
     - If container control fails, log warning but complete state transition
   - When emergency stop is triggered:
     - If `killContainer: true`, send `SIGKILL` to Docker container (if container exists)
     - If `killContainer: false`, gracefully stop container with `docker stop` (30s timeout)
     - Clean up all resources (volumes, networks, workspace)
     - Mark execution as `EMERGENCY_STOPPED`
     - Container cleanup failures should not prevent state transition

4. **Real-Time Event Emission**
   - All control operations must emit WebSocket events via `RealtimeService`
   - Event types to implement in `realtime.types.ts`:
     - `execution.paused`: `{ executionId, ticketId, projectId, pausedAt, pausedBy, reason }`
     - `execution.resumed`: `{ executionId, ticketId, projectId, resumedAt, resumedBy, resumeNotes }`
     - `execution.emergency_stopped`: `{ executionId, ticketId, projectId, stoppedAt, stoppedBy, reason, containerKilled }`
     - `execution.decision_overridden`: `{ executionId, ticketId, projectId, overriddenAt, overriddenBy, originalDecision, newDecision, reason }`
   - Events must be routed to:
     - Project room: `project:{projectId}` (if available)
     - User room: `user:{assignedPmUserId}` (if PM assigned)
     - Role rooms: `role:ADMIN`, `role:MANAGER`, `role:TL` (operational oversight)
   - Use `emitToTargetRooms()` helper pattern from Story 10-U-2

5. **Authorization & RBAC**
   - **Pause/Resume**: Allowed for `PM`, `TL`, `MANAGER`, `ADMIN` roles
   - **Emergency Stop**: Allowed for `TL`, `MANAGER`, `ADMIN` roles only (elevated privilege)
   - **Override Decision**: Allowed for `TL`, `ADMIN` roles only (critical operation)
   - All endpoints must be protected by `JwtAuthGuard` and `RolesGuard`
   - Validate that user has permission to control executions for the given project
   - Return `403 Forbidden` if user lacks required role or project access

6. **Audit Trail & Observability**
   - All control operations must be logged to `AuditLog` table with:
     - `entityType: 'execution'`, `entityId: executionId`
     - `action`: 'paused', 'resumed', 'emergency_stopped', 'decision_overridden'
     - `actorType: 'user'`, `actorId: userId`
     - `beforeState`, `afterState` (full state snapshot)
     - `metadata`: `{ reason, killContainer, overrideData, etc. }`
   - Create `ExecutionOverride` table to track decision overrides:
     - Fields: `id`, `executionId`, `userId`, `originalDecision`, `newDecision`, `reason`, `overrideData`, `overriddenAt`
     - Foreign key to `Execution` table
   - Prometheus metrics:
     - `execution_paused_total` (counter with labels: [provider, reason])
     - `execution_resumed_total` (counter with labels: [provider])
     - `execution_emergency_stopped_total` (counter with labels: [provider, reason, container_killed])
     - `execution_decision_overridden_total` (counter with labels: [provider, original_decision, new_decision])

7. **Error Handling & Edge Cases**
   - If execution is already in terminal state (`COMPLETED`, `FAILED`, `CANCELLED`, `EMERGENCY_STOPPED`), return `400 Bad Request` with error message
   - If execution is `PAUSED` and pause is requested again, return `409 Conflict`
   - If execution is not `PAUSED` and resume is requested, return `400 Bad Request`
   - **Container Availability**: If `container_id` is null, skip container operations with warning log
   - If Docker container is not found or already stopped, log warning but continue with state transition
   - If container pause/resume/kill fails, log error, increment `execution_container_control_failed_total` metric, but complete state transition (state change is source of truth)
   - All operations must be idempotent where possible (e.g., multiple emergency stops should be safe)
   - Response DTOs should include `containerControlSkipped: boolean` field to indicate if container operations were performed

## Tasks / Subtasks

- [ ] **Update Prisma Schema** (AC 2, 6)
  - [ ] Add `PAUSED` and `EMERGENCY_STOPPED` to `ExecutionStatus` enum in `schema.prisma`
  - [ ] Create `ExecutionOverride` model:
    - Fields: `id`, `executionId`, `userId`, `originalDecision`, `newDecision`, `reason`, `overrideData` (JSON), `overriddenAt`
    - Foreign key to `Execution` table with cascade delete
    - Index on `executionId`
  - [ ] Run Prisma migration: `npx prisma migrate dev --name execution-manual-controls`

- [ ] **Update Execution State Machine** (AC 2)
  - [ ] Modify `src/execution/state-machine/execution-state-machine.service.ts`
  - [ ] Add allowed transitions for `PAUSED` and `EMERGENCY_STOPPED` states
  - [ ] Add business logic validation for terminal state enforcement
  - [ ] Update unit tests to cover new transitions

- [ ] **Define WebSocket Event Interfaces** (AC 4)
  - [ ] Add to `src/realtime/realtime.types.ts`:
    - `ExecutionPausedEvent`
    - `ExecutionResumedEvent`
    - `ExecutionEmergencyStoppedEvent`
    - `ExecutionDecisionOverriddenEvent`

- [ ] **Create Manual Intervention Service** (AC 1, 3, 4, 6)
  - [ ] Create `src/execution/services/manual-intervention.service.ts`
  - [ ] Inject dependencies: `ExecutionRepository`, `ExecutionTrackerService`, `RealtimeService`, `PrismaService`, `PrometheusMetrics`
  - [ ] Implement `pauseExecution(executionId, userId, reason)` method
    - Validate execution state
    - Send `SIGSTOP` to container via Docker API
    - Update execution status to `PAUSED`
    - Create audit log entry
    - Emit `execution.paused` event
    - Increment Prometheus counter
  - [ ] Implement `resumeExecution(executionId, userId, resumeNotes?)` method
    - Validate execution state (must be `PAUSED`)
    - Send `SIGCONT` to container via Docker API
    - Update execution status to `IN_PROGRESS`
    - Create audit log entry
    - Emit `execution.resumed` event
    - Increment Prometheus counter
  - [ ] Implement `emergencyStop(executionId, userId, reason, killContainer)` method
    - Kill or gracefully stop container based on `killContainer` flag
    - Clean up workspace resources
    - Update execution status to `EMERGENCY_STOPPED`
    - Create audit log entry
    - Emit `execution.emergency_stopped` event
    - Increment Prometheus counter
  - [ ] Implement `overrideDecision(executionId, userId, decision, reason, overrideData?)` method
    - Create `ExecutionOverride` record
    - Update execution metadata with override information
    - Create audit log entry
    - Emit `execution.decision_overridden` event
    - Increment Prometheus counter

- [ ] **Create Container Control Service** (AC 3)
  - [ ] Create `src/execution/services/container-control.service.ts` (or extend existing Docker service)
  - [ ] Implement `pauseContainer(containerId)` - sends `SIGSTOP` signal
  - [ ] Implement `resumeContainer(containerId)` - sends `SIGCONT` signal
  - [ ] Implement `emergencyKillContainer(containerId)` - sends `SIGKILL` signal
  - [ ] Implement `gracefulStopContainer(containerId, timeout = 30)` - graceful shutdown
  - [ ] Add error handling for missing/stopped containers

- [ ] **Create Manual Intervention Controller** (AC 1, 5)
  - [ ] Create `src/execution/controllers/manual-intervention.controller.ts`
  - [ ] Implement `POST /api/v1/execution/:id/pause` endpoint
    - Add `@UseGuards(JwtAuthGuard, RolesGuard)`
    - Add `@Roles('PM', 'TL', 'MANAGER', 'ADMIN')`
    - Extract user ID from JWT token
    - Call `manualInterventionService.pauseExecution()`
    - Add Swagger documentation
  - [ ] Implement `POST /api/v1/execution/:id/resume` endpoint
    - Add `@UseGuards(JwtAuthGuard, RolesGuard)`
    - Add `@Roles('PM', 'TL', 'MANAGER', 'ADMIN')`
    - Extract user ID from JWT token
    - Call `manualInterventionService.resumeExecution()`
    - Add Swagger documentation
  - [ ] Implement `POST /api/v1/execution/:id/emergency-stop` endpoint
    - Add `@UseGuards(JwtAuthGuard, RolesGuard)`
    - Add `@Roles('TL', 'MANAGER', 'ADMIN')` (elevated privilege)
    - Extract user ID from JWT token
    - Call `manualInterventionService.emergencyStop()`
    - Add Swagger documentation
  - [ ] Implement `POST /api/v1/execution/:id/override-decision` endpoint
    - Add `@UseGuards(JwtAuthGuard, RolesGuard)`
    - Add `@Roles('TL', 'ADMIN')` (critical operation)
    - Extract user ID from JWT token
    - Call `manualInterventionService.overrideDecision()`
    - Add Swagger documentation

- [ ] **Create Execution Override Repository** (AC 6)
  - [ ] Create `src/execution/repositories/execution-override.repository.ts`
  - [ ] Implement `create(data)` - create override record
  - [ ] Implement `findByExecutionId(executionId)` - retrieve overrides for execution
  - [ ] Implement `findByUserId(userId)` - retrieve overrides by user (audit)

- [ ] **Add Prometheus Metrics** (AC 6)
  - [ ] Register `execution_paused_total` counter with labels: [provider, reason]
  - [ ] Register `execution_resumed_total` counter with labels: [provider]
  - [ ] Register `execution_emergency_stopped_total` counter with labels: [provider, reason, container_killed]
  - [ ] Register `execution_decision_overridden_total` counter with labels: [provider, original_decision, new_decision]
  - [ ] Inject metrics into `ManualInterventionService`

- [ ] **Update Execution Module** (Integration)
  - [ ] Add `ManualInterventionService` to providers in `execution.module.ts`
  - [ ] Add `ContainerControlService` to providers (or update existing Docker service)
  - [ ] Add `ExecutionOverrideRepository` to providers
  - [ ] Add `ManualInterventionController` to controllers
  - [ ] Add Prometheus metric providers for manual controls
  - [ ] Ensure `RealtimeModule` is imported (from Story 10-U-1)

- [ ] **Unit Tests** (All ACs)
  - [ ] Test `ManualInterventionService` pause/resume/emergency-stop/override methods with mocked dependencies
  - [ ] Test state machine transitions for `PAUSED` and `EMERGENCY_STOPPED` states
  - [ ] Test container control service (mock Docker API)
  - [ ] Test RBAC enforcement in controller (different user roles)
  - [ ] Test error handling for invalid state transitions
  - [ ] Test audit log creation
  - [ ] Test WebSocket event emission

- [ ] **Integration Tests**
  - [ ] Test end-to-end pause → resume flow with real container
  - [ ] Test emergency stop with container cleanup
  - [ ] Test decision override with database persistence
  - [ ] Test RBAC restrictions (403 for unauthorized users)
  - [ ] Test idempotency of operations

## Dev Notes

### Architecture Compliance

- **New Service**: `src/execution/services/manual-intervention.service.ts`
- **New Service**: `src/execution/services/container-control.service.ts` (or extend existing)
- **New Controller**: `src/execution/controllers/manual-intervention.controller.ts`
- **New Repository**: `src/execution/repositories/execution-override.repository.ts`
- **Database**: Add `PAUSED`, `EMERGENCY_STOPPED` to `ExecutionStatus` enum; create `ExecutionOverride` model
- **State Machine**: Update `src/execution/state-machine/execution-state-machine.service.ts`
- **Module**: Update `src/execution/execution.module.ts`
  - Add new services, repository, controller to providers/controllers
  - Import `RealtimeModule` (already done in Story 10-U-1)
  - Add Prometheus metric providers
- **Event Types**: Extend `src/realtime/realtime.types.ts` with manual control event interfaces

### Key Technical Requirements

1. **Manual Intervention Service Pattern**

   ```typescript
   @Injectable()
   export class ManualInterventionService {
     constructor(
       private readonly repository: ExecutionRepository,
       private readonly tracker: ExecutionTrackerService,
       private readonly containerControl: ContainerControlService,
       private readonly overrideRepository: ExecutionOverrideRepository,
       @Optional() private readonly realtimeService?: RealtimeService,
       @InjectMetric('execution_paused_total') private readonly pausedCounter?: Counter,
       private readonly logger: LoggerService,
     ) {}

     async pauseExecution(executionId: string, userId: string, reason: string): Promise<Execution> {
       const execution = await this.repository.findById(executionId);

       // Validate state
       if (execution.status !== 'IN_PROGRESS') {
         throw new BadRequestException('Only IN_PROGRESS executions can be paused');
       }

       // Pause container
       if (execution.container_id) {
         await this.containerControl.pauseContainer(execution.container_id);
       }

       // Update execution state
       const updated = await this.tracker.updateStatus(executionId, ExecutionStatus.PAUSED);

       // Audit log
       await this.repository.createAuditLog({
         entityType: 'execution',
         entityId: executionId,
         action: 'paused',
         actorType: 'user',
         actorId: userId,
         beforeState: { status: 'IN_PROGRESS' },
         afterState: { status: 'PAUSED', reason },
         metadata: { reason },
         createdAt: new Date(),
       });

       // Emit event
       await this.emitToTargetRooms(execution, 'execution.paused', {
         executionId,
         ticketId: execution.ticket_id,
         projectId: execution.ticket?.project_id || null,
         pausedAt: new Date().toISOString(),
         pausedBy: userId,
         reason,
       });

       // Metrics
       this.pausedCounter?.inc({ provider: execution.ai_provider, reason });

       return updated;
     }

     private async emitToTargetRooms(
       execution: Execution,
       event: string,
       payload: unknown,
     ): Promise<void> {
       if (!this.realtimeService) return;

       const projectId = execution.ticket?.project_id;
       const pmUserId = execution.ticket?.assigned_to;

       try {
         if (projectId) {
           this.realtimeService.emitToProject(projectId, event, payload);
         }
         if (pmUserId) {
           this.realtimeService.emitToUser(pmUserId, event, payload);
         }
         this.realtimeService.emitToRole('ADMIN', event, payload);
         this.realtimeService.emitToRole('MANAGER', event, payload);
         this.realtimeService.emitToRole('TL', event, payload);
       } catch (error) {
         this.logger.error(`Failed to emit ${event} event:`, error);
       }
     }
   }
   ```

2. **Container Control Integration**

   ```typescript
   @Injectable()
   export class ContainerControlService {
     async pauseContainer(containerId: string): Promise<void> {
       const container = this.dockerClient.getContainer(containerId);
       await container.pause();
     }

     async resumeContainer(containerId: string): Promise<void> {
       const container = this.dockerClient.getContainer(containerId);
       await container.unpause();
     }

     async emergencyKillContainer(containerId: string): Promise<void> {
       const container = this.dockerClient.getContainer(containerId);
       await container.kill({ signal: 'SIGKILL' });
     }

     async gracefulStopContainer(containerId: string, timeout = 30): Promise<void> {
       const container = this.dockerClient.getContainer(containerId);
       await container.stop({ t: timeout });
     }
   }
   ```

3. **State Machine Transitions**

   ```typescript
   // Add to execution-state-machine.service.ts
   private readonly allowedTransitions: Record<ExecutionStatus, ExecutionStatus[]> = {
     // ... existing transitions ...
     IN_PROGRESS: [
       ExecutionStatus.COMPLETED,
       ExecutionStatus.FAILED,
       ExecutionStatus.AWAITING_APPROVAL,
       ExecutionStatus.PAUSED, // NEW
       ExecutionStatus.CANCELLED,
       ExecutionStatus.EMERGENCY_STOPPED, // NEW
     ],
     PAUSED: [
       ExecutionStatus.IN_PROGRESS, // Resume
       ExecutionStatus.CANCELLED,
       ExecutionStatus.EMERGENCY_STOPPED,
     ],
     EMERGENCY_STOPPED: [], // Terminal state - no transitions out
   };
   ```

4. **Event Payload Interfaces**

   ```typescript
   // Add to src/realtime/realtime.types.ts

   export interface ExecutionPausedEvent {
     executionId: string;
     ticketId: string | null;
     projectId: string | null;
     pausedAt: string;
     pausedBy: string;
     reason: string;
   }

   export interface ExecutionResumedEvent {
     executionId: string;
     ticketId: string | null;
     projectId: string | null;
     resumedAt: string;
     resumedBy: string;
     resumeNotes?: string;
   }

   export interface ExecutionEmergencyStoppedEvent {
     executionId: string;
     ticketId: string | null;
     projectId: string | null;
     stoppedAt: string;
     stoppedBy: string;
     reason: string;
     containerKilled: boolean;
   }

   export interface ExecutionDecisionOverriddenEvent {
     executionId: string;
     ticketId: string | null;
     projectId: string | null;
     overriddenAt: string;
     overriddenBy: string;
     originalDecision: string | null;
     newDecision: string;
     reason: string;
   }
   ```

5. **Prisma Schema Updates**

   ```prisma
   // Update ExecutionStatus enum
   enum ExecutionStatus {
     QUEUED
     IN_PROGRESS
     PAUSED              // NEW
     AWAITING_APPROVAL
     COMPLETED
     FAILED
     TIMEOUT
     CANCELLED
     EMERGENCY_STOPPED   // NEW
   }

   // New ExecutionOverride model
   model ExecutionOverride {
     id               String   @id @default(uuid())
     executionId      String   @map("execution_id")
     userId           String   @map("user_id")
     originalDecision String?  @map("original_decision")
     newDecision      String   @map("new_decision")
     reason           String   @db.Text
     overrideData     Json?    @map("override_data")
     overriddenAt     DateTime @default(now()) @map("overridden_at")

     execution        Execution @relation(fields: [executionId], references: [id], onDelete: Cascade)
     user             User      @relation(fields: [userId], references: [id])

     @@index([executionId])
     @@map("execution_overrides")
   }

   // Update Execution model to add relation:
   model Execution {
     // ... existing fields ...
     overrides        ExecutionOverride[]
   }

   // Update User model to add reverse relation:
   model User {
     // ... existing fields ...
     execution_overrides  ExecutionOverride[]
   }
   ```

6. **Controller Endpoint Example**

   ```typescript
   @Controller('execution')
   @UseGuards(JwtAuthGuard, RolesGuard)
   export class ManualInterventionController {
     constructor(private readonly service: ManualInterventionService) {}

     @Post(':id/pause')
     @Roles('PM', 'TL', 'MANAGER', 'ADMIN')
     @ApiOperation({ summary: 'Pause a running execution' })
     @ApiResponse({ status: 200, description: 'Execution paused successfully' })
     @ApiResponse({ status: 400, description: 'Invalid execution state' })
     @ApiResponse({ status: 403, description: 'Insufficient permissions' })
     async pauseExecution(
       @Param('id') executionId: string,
       @Body() dto: PauseExecutionDto,
       @Request() req,
     ): Promise<ExecutionControlResponse> {
       const userId = req.user.userId;
       const execution = await this.service.pauseExecution(executionId, userId, dto.reason);

       return {
         executionId: execution.id,
         status: execution.status,
         pausedAt: execution.updated_at.toISOString(),
         pausedBy: userId,
         reason: dto.reason,
       };
     }

     @Post(':id/emergency-stop')
     @Roles('TL', 'MANAGER', 'ADMIN') // Elevated privilege only
     @ApiOperation({ summary: 'Emergency stop execution' })
     async emergencyStop(
       @Param('id') executionId: string,
       @Body() dto: EmergencyStopDto,
       @Request() req,
     ): Promise<ExecutionControlResponse> {
       const userId = req.user.userId;
       const execution = await this.service.emergencyStop(
         executionId,
         userId,
         dto.reason,
         dto.killContainer || false,
       );

       return {
         executionId: execution.id,
         status: execution.status,
         stoppedAt: execution.updated_at.toISOString(),
         stoppedBy: userId,
         reason: dto.reason,
       };
     }
   }
   ```

### Security

- All endpoints protected by `JwtAuthGuard` and `RolesGuard`
- RBAC enforcement:
  - Pause/Resume: `PM`, `TL`, `MANAGER`, `ADMIN`
  - Emergency Stop: `TL`, `MANAGER`, `ADMIN` (elevated)
  - Override Decision: `TL`, `ADMIN` (critical)
- Full audit trail for all control operations
- Project-level access validation (user must have access to project)
- WebSocket events use room-based routing (privacy/security)

### Testing Strategy

- **Unit Tests**: Mock all dependencies, verify service methods and state transitions
- **State Machine Tests**: Verify allowed transitions for `PAUSED` and `EMERGENCY_STOPPED`
- **RBAC Tests**: Test permission enforcement for different roles
- **Container Control Tests**: Mock Docker API, verify signal sending
- **Integration Tests**: Test full flows with real database and containers
- **E2E Tests**: Deferred to future story (requires frontend dashboard integration)

### Project Structure Notes

**Files to Create:**

- `src/execution/services/manual-intervention.service.ts` - Core manual intervention service
- `src/execution/services/manual-intervention.service.spec.ts` - Unit tests
- `src/execution/services/container-control.service.ts` - Container pause/resume/kill operations
- `src/execution/services/container-control.service.spec.ts` - Container control tests
- `src/execution/controllers/manual-intervention.controller.ts` - REST API endpoints
- `src/execution/controllers/manual-intervention.controller.spec.ts` - Controller tests
- `src/execution/repositories/execution-override.repository.ts` - Override persistence
- `src/execution/repositories/execution-override.repository.spec.ts` - Repository tests
- `src/execution/dto/pause-execution.dto.ts` - Request DTO
- `src/execution/dto/resume-execution.dto.ts` - Request DTO
- `src/execution/dto/emergency-stop.dto.ts` - Request DTO
- `src/execution/dto/override-decision.dto.ts` - Request DTO
- `src/execution/dto/execution-control-response.dto.ts` - Response DTO
- `prisma/migrations/XXXXXX_execution_manual_controls.sql` - Database migration

**Files to Modify:**

- `src/realtime/realtime.types.ts` - Add manual control event interfaces
- `src/execution/execution.module.ts` - Add new services, repository, controller; add metrics
- `src/execution/state-machine/execution-state-machine.service.ts` - Add `PAUSED`, `EMERGENCY_STOPPED` transitions
- `src/execution/state-machine/execution-state-machine.service.spec.ts` - Add tests for new transitions
- `prisma/schema.prisma` - Add `PAUSED`, `EMERGENCY_STOPPED` to enum; create `ExecutionOverride` model; add `execution_overrides` relation to User model; add `overrides` relation to Execution model

### References

- [Story 10-U-1: Socket.IO Infrastructure](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/10-U-1-socket-io-real-time-infrastructure.md) - RealtimeService and room patterns
- [Story 10-U-2: Execution Progress Streaming](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/10-U-2-execution-progress-streaming.md) - Event emission and room routing patterns
- [Story 10-U-4: Execution Logs Streaming](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/10-U-4-execution-logs-streaming.md) - WebSocket streaming patterns
- [Story 2.5: Execution Tracking](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/sprint-status.yaml#L100) - ExecutionTrackerService state management
- [Architecture Doc: AI Execution Engine](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/architecture.md#FR60-65) - AI execution architecture
- [PRD: FR60-65 AI Tool Routing](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/prd.md#FR60-65) - Original requirements
- [ExecutionTrackerService](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/execution/execution-tracker.service.ts) - Existing execution tracking
- [ExecutionStateMachine](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/execution/state-machine/execution-state-machine.service.ts) - State transition logic

### Previous Story Intelligence

**Story 10-U-1 Learnings:**

- `RealtimeService` provides 4 emission methods: `emitToProject()`, `emitToRole()`, `emitToUser()`, `broadcast()`
- Use `@Optional()` decorator for graceful degradation when RealtimeModule not loaded
- Event interfaces must be exported from `realtime.types.ts` for consumer use
- Room-based routing ensures targeted notifications (security/privacy)

**Story 10-U-2 Learnings:**

- Fire-and-forget emission pattern (do NOT await or block critical paths)
- Use try-catch wrappers to prevent service crashes from notification failures
- Prometheus metrics for observability are required
- `emitToTargetRooms()` helper pattern for routing to project/user/role rooms

**Story 10-U-4 Learnings:**

- Optional dependency injection for graceful degradation
- Defensive programming with null checks
- Prometheus metrics for observability
- Database persistence as fallback when WebSocket unavailable
- Audit trail for all critical operations

**Execution Module Patterns:**

- `ExecutionTrackerService` manages all state transitions via state machine
- All state changes must create audit log entries
- Container lifecycle managed through Docker API
- Error handling must not block execution tracking
- Metrics must be incremented for all state transitions

### Project Context Reference

This story implements manual intervention controls (pause/resume, emergency stop, decision override) for AI executions, completing Epic 10-U (Real-time Notifications & Controls). It provides operational oversight and human-in-the-loop capabilities for:

- **Executive Control**: Pause runaway executions, resume after manual review
- **Safety Mechanisms**: Emergency stop for critical issues
- **Decision Authority**: Override incorrect AI decisions with full audit trail
- **Operational Transparency**: Real-time notifications to relevant stakeholders

This story complements:

- **Story 2.5 (Execution Tracking)**: State management and execution lifecycle
- **Story 10-U-1 (Socket.IO)**: Real-time event infrastructure
- **Story 10-U-2 (Progress Streaming)**: Progress update patterns
- **Story 10-U-4 (Log Streaming)**: Log streaming patterns
- **Epic 22/23 (Docker Execution)**: Container lifecycle management

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.5

### Debug Log References

N/A - Implementation completed successfully

### Completion Notes List

1. **Prisma Schema Updates**:
   - Added `PAUSED` and `EMERGENCY_STOPPED` to `ExecutionStatus` enum
   - Created `ExecutionOverride` model with fields: id, executionId, userId, originalDecision, newDecision, reason, overrideData, overriddenAt
   - Added relations to Execution and User models
   - Applied database migration via SQL commands

2. **State Machine Updates**:
   - Updated `VALID_TRANSITIONS` to include `PAUSED` and `EMERGENCY_STOPPED` states
   - Added `PAUSED` transitions: can resume to IN_PROGRESS, cancel, or emergency stop
   - Added `EMERGENCY_STOPPED` as terminal state (no transitions out)
   - Added `canTransition()` method to ExecutionStateMachine
   - Updated `TERMINAL_STATES` and `STATUS_LABELS`

3. **WebSocket Event Types**:
   - Added `ExecutionPausedEvent` interface
   - Added `ExecutionResumedEvent` interface
   - Added `ExecutionEmergencyStoppedEvent` interface
   - Added `ExecutionDecisionOverriddenEvent` interface

4. **Services Created**:
   - `ContainerControlService`: Docker container pause/resume/kill/stop operations
   - `ExecutionOverrideRepository`: CRUD operations for decision overrides
   - `ManualInterventionService`: Core business logic for pause/resume/emergency-stop/override

5. **Controller Created**:
   - `ManualInterventionController`: REST API endpoints with RBAC
   - POST /api/v1/execution/:id/pause (PM, TL, MANAGER, ADMIN)
   - POST /api/v1/execution/:id/resume (PM, TL, MANAGER, ADMIN)
   - POST /api/v1/execution/:id/emergency-stop (TL, MANAGER, ADMIN)
   - POST /api/v1/execution/:id/override-decision (TL, ADMIN)

6. **DTOs Created**:
   - `PauseExecutionDto`: reason field validation
   - `ResumeExecutionDto`: optional resumeNotes
   - `EmergencyStopDto`: reason and killContainer flag
   - `OverrideDecisionDto`: decision enum, reason, optional overrideData
   - `ExecutionControlResponse`: standardized response format
   - `DecisionOverrideResponse`: override-specific response

7. **ExecutionModule Updates**:
   - Added new services to providers
   - Added new controller to controllers
   - Added 5 Prometheus metric providers (paused, resumed, emergency_stopped, decision_overridden, container_control_failed)
   - Imported AuditLogService for audit trail

8. **Unit Tests**:
   - `manual-intervention.service.spec.ts`: 15 tests covering all operations
   - `manual-intervention.controller.spec.ts`: 8 tests for API endpoints
   - `container-control.service.spec.ts`: 9 tests for Docker operations
   - `execution-override.repository.spec.ts`: 6 tests for repository operations
   - Total: 38 new tests, all passing

### File List

**New Files Created (14)**:

1. `src/execution/services/manual-intervention.service.ts` (core service)
2. `src/execution/services/manual-intervention.service.spec.ts` (tests)
3. `src/execution/services/container-control.service.ts` (Docker operations)
4. `src/execution/services/container-control.service.spec.ts` (tests)
5. `src/execution/controllers/manual-intervention.controller.ts` (REST API)
6. `src/execution/controllers/manual-intervention.controller.spec.ts` (tests)
7. `src/execution/repositories/execution-override.repository.ts` (repository)
8. `src/execution/repositories/execution-override.repository.spec.ts` (tests)
9. `src/execution/dto/pause-execution.dto.ts`
10. `src/execution/dto/resume-execution.dto.ts`
11. `src/execution/dto/emergency-stop.dto.ts`
12. `src/execution/dto/override-decision.dto.ts`
13. `src/execution/dto/execution-control-response.dto.ts`
14. `prisma/migrations/20260205161711_execution_manual_controls/migration.sql`

**Modified Files (6)**:

1. `prisma/schema.prisma` - Added enum values and ExecutionOverride model
2. `src/execution/enums/execution-status.enum.ts` - Updated state machine transitions
3. `src/execution/state-machine/execution-state-machine.ts` - Added canTransition method
4. `src/execution/execution.module.ts` - Added providers, controllers, metrics
5. `src/execution/dto/index.ts` - Exported new DTOs
6. `src/realtime/realtime.types.ts` - Added WebSocket event interfaces

### Change Log

- 2026-02-05: Story implementation completed
- 2026-02-05: Database migration applied (enum values + ExecutionOverride table)
- 2026-02-05: All 38 unit tests passing
- 2026-02-05: TypeScript build clean for all new files
