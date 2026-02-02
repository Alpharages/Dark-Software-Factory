# Story 23.2: Automated Container Cleanup

Status: completed

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Operator,
I want containers and workspace volumes to be deleted automatically after execution,
So that the host server disk never fills up.

## Acceptance Criteria

1. **Given** a task execution completes (success or failure)
   **When** the execution finishes
   **Then** the associated Docker container must be removed
   **And** the operation must be logged with execution ID for traceability.

2. **Given** a completed task execution
   **When** the container is being cleaned up
   **Then** the temporary workspace folder on the host must be deleted
   **Unless** debug mode is enabled for the execution.

3. **Given** a running container
   **When** the execution times out or is cancelled
   **Then** the container must be forcefully killed and removed
   **And** the workspace must be cleaned up (unless debug mode).

4. **Given** container cleanup operations
   **When** metrics collection is enabled
   **Then** the system should track: cleanup duration, cleanup failures, containers cleaned, workspace bytes reclaimed
   **And** expose these metrics via Prometheus.

5. **Given** cleanup failures
   **When** a container or workspace cannot be removed
   **Then** the error must be logged but must not block execution completion
   **And** a retry mechanism should attempt cleanup again during the next scheduled cleanup cycle.

## Tasks / Subtasks

- [x] Task 0: Database Schema Updates (Prerequisite for AC 1, 2)
  - [ ] Add `container_id String?` field to `Execution` model in `prisma/schema.prisma`
  - [ ] Add `debug_mode Boolean @default(false)` field to `Execution` model for per-execution debug flag
  - [ ] Generate and run migration: `npx prisma migrate dev --name add_container_cleanup_fields`
  - [ ] Update `WorkspaceStatus` enum to include `CLEANUP_PENDING` status (optional, for tracking cleanup state)

- [x] Task 1: Container ID Storage Integration (Prerequisite for AC 1, 3)
  - [x] Update container spawning code to store container_id in execution record
  - [x] Add `assignContainer(executionId: string, containerId: string): Promise<void>` to `ExecutionTrackerService`
  - [x] Call `assignContainer()` when container is created in execution flow (pty-execution.service.ts:346-353)

- [x] Task 2: Create CleanupService Module (AC: 1, 2, 3)
  - [ ] Create `src/cleanup/cleanup.module.ts` with NestJS module structure
  - [ ] Create `src/cleanup/cleanup.service.ts` with core cleanup orchestration logic
  - [ ] Create `src/cleanup/exceptions/cleanup.exceptions.ts` with custom exceptions:
    - `CleanupException extends InfrastructureException`
    - `ContainerCleanupError`, `WorkspaceCleanupError`, `CleanupTimeoutError`
  - [ ] Implement `cleanupAfterExecution(executionId: string, options?: CleanupOptions): Promise<CleanupResult>`

- [x] Task 3: Container Cleanup Integration (AC: 1, 3)
  - [ ] Implement `removeContainer(containerId: string, force?: boolean): Promise<void>` using existing `DockerService.removeContainer()` [Source: src/docker/docker.service.ts:520-531]
  - [ ] Integrate with `ExecutionTrackerService.getExecution(executionId)` to retrieve container ID
  - [ ] Handle container not found errors gracefully (idempotent cleanup)
  - [ ] Implement force kill for timed out executions using `DockerService.killContainer()` [Source: src/docker/docker.service.ts:501-513]

- [x] Task 4: Workspace Folder Cleanup (AC: 2, 3)
  - [ ] Implement `cleanupWorkspaceFolder(executionId: string, preserveForDebug?: boolean): Promise<number>` (returns bytes reclaimed)
  - [ ] Check `execution.debug_mode` flag before deletion; skip if true
  - [ ] Delegate to existing `WorkspaceService.cleanupWorkspace()` for consistency [Source: src/ai-routing/providers/workspace.service.ts:377-430]
  - [ ] Calculate bytes reclaimed via `StorageManagerService.getDiskUsage()` before/after

- [x] Task 5: Execution Lifecycle Integration (AC: 1, 2, 3)
  - [ ] Modify `ExecutionTrackerService.completeExecution()` [line 171] to trigger cleanup in finally block
  - [ ] Modify `ExecutionTrackerService.failExecution()` [line 251] to trigger cleanup in finally block
  - [ ] Modify `ExecutionTrackerService.timeoutExecution()` [line 332] to trigger cleanup with `forceContainerRemove: true`
  - [ ] Modify `ExecutionTrackerService.cancelExecution()` [line 416] to trigger cleanup in finally block
  - [ ] Add `CleanupService` dependency to `ExecutionTrackerService` constructor

- [x] Task 6: Background Cleanup Job (AC: 5)
  - [ ] Create `CleanupSchedulerService` with `@nestjs/schedule` cron job
  - [ ] Run every 5 minutes: `@Cron('0 */5 * * * *')`
  - [ ] Query for executions with status COMPLETED/FAILED/TIMEOUT/CANCELLED but with non-null container_id
  - [ ] Attempt cleanup for orphaned resources (container exists but workspace not cleaned)
  - [ ] Update execution record to null out container_id after successful cleanup

- [x] Task 7: Configuration & Environment (AC: 1, 2, 4)
  - [ ] Add to `env.validation.ts`:
    - `CLEANUP_DEBUG_MODE_DEFAULT` (default: false) - Global default for debug mode
    - `CLEANUP_TIMEOUT_MS` (default: 30000 = 30 seconds)
    - `CLEANUP_RETRY_ATTEMPTS` (default: 3)
    - `ENABLE_AUTO_CLEANUP` (default: true) - Master switch
    - `CLEANUP_SCHEDULE_CRON` (default: '0 _/5 _ \* \* \*') - Background cleanup frequency
  - [ ] Create `CleanupOptions` interface for per-execution overrides

- [x] Task 8: Metrics & Observability (AC: 4)
  - [x] Add Prometheus metrics using `@InjectMetric` decorator pattern:
    - `cleanup_duration_seconds` - Histogram for cleanup operation duration
    - `cleanup_containers_total` - Counter with `status` label (success/failure)
    - `cleanup_bytes_reclaimed_total` - Counter for disk space reclaimed
    - `cleanup_failures_total` - Counter with `type` label (container/workspace)
    - `cleanup_orphaned_resources` - Gauge for resources pending cleanup
  - [ ] Add structured logging for all cleanup operations with execution ID
  - [ ] Add correlation IDs via executionId in logs

- [x] Task 9: Unit and Integration Tests
  - [ ] Test `CleanupService.cleanupAfterExecution()` with mocked Docker operations
  - [ ] Test debug mode preservation logic (workspace not deleted when debug_mode=true)
  - [ ] Test timeout and force kill scenarios
  - [ ] Test metrics collection and Prometheus integration
  - [ ] Test error handling for cleanup failures
  - [ ] Test background cleanup job orphan detection
  - [ ] Test container_id assignment flow

## Dev Notes

### Container ID Storage Flow (Critical Prerequisite)

**Where container_id gets stored:**

The container ID must be stored when a container is spawned for execution. This happens in the execution flow before the AI task runs:

```typescript
// In execution consumer or container orchestrator (likely src/execution/ai-execution.consumer.ts)
async startContainerForExecution(executionId: string, image: string): Promise<void> {
  // Create and start container
  const { container } = await this.dockerService.runContainer({
    image,
    name: `dsf-execution-${executionId}`,
    binds: [`${workspacePath}:/workspace:rw`],
    // ... other options
  });

  // CRITICAL: Store container_id in execution record
  await this.executionTrackerService.assignContainer(executionId, container.id);

  this.logger.log(`[${executionId}] Container ${container.id} assigned to execution`);
}
```

**Add to ExecutionTrackerService:**

```typescript
// src/execution/execution-tracker.service.ts
async assignContainer(executionId: string, containerId: string): Promise<void> {
  await this.repository.update(executionId, { container_id: containerId });
  this.logger.log(`[${executionId}] Container ${containerId} assigned`);
}
```

### Cleanup Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Execution Completion                          │
│          (COMPLETED/FAILED/TIMEOUT/CANCELLED)                   │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│              ExecutionTrackerService Methods                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ completeExecution() / failExecution() / timeoutExecution() │  │
│  │ cancelExecution()                                          │  │
│  └──────────────────────┬────────────────────────────────────┘  │
│                         │ finally block                          │
│                         ▼                                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ CleanupService.cleanupAfterExecution(executionId, {       │  │
│  │   forceContainerRemove: status === 'TIMEOUT'              │  │
│  │ })                                                        │  │
│  └──────────────────────┬────────────────────────────────────┘  │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│              CleanupService.cleanupAfterExecution()              │
│  ┌─────────────────────┐  ┌──────────────────────────────────┐  │
│  │ 1. Get Container ID │  │ 2. Get Workspace Path            │  │
│  │    from Execution   │  │    from WorkspaceService         │  │
│  │    model            │  │                                  │  │
│  └──────────┬──────────┘  └──────────┬─────────────────────────┘  │
│             │                        │                           │
│             ▼                        ▼                           │
│  ┌─────────────────────┐  ┌──────────────────────────────────┐  │
│  │ 3. Remove Container │  │ 4. Cleanup Workspace (unless     │  │
│  │    (force if needed)│  │    execution.debug_mode=true)    │  │
│  │    via DockerService│  │    via WorkspaceService          │  │
│  └──────────┬──────────┘  └──────────┬─────────────────────────┘  │
│             │                        │                           │
│             └──────────┬─────────────┘                           │
│                        ▼                                        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 5. Record Metrics & Log Results                             │ │
│  │    - Duration, Bytes reclaimed, Status                      │ │
│  │ 6. Clear container_id from Execution record                 │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### WorkspaceService Relationship

**Boundary Definition:**

| Responsibility            | Service               | Method                                                                              |
| ------------------------- | --------------------- | ----------------------------------------------------------------------------------- |
| Workspace folder deletion | WorkspaceService      | `cleanupWorkspace(executionId)` [src/ai-routing/providers/workspace.service.ts:377] |
| Container removal         | CleanupService        | `removeContainer(containerId)` (wraps DockerService)                                |
| Orchestration             | CleanupService        | `cleanupAfterExecution(executionId)` - calls both                                   |
| Database state update     | WorkspaceService      | Updates status to CLEANED                                                           |
| Archive failed workspaces | StorageManagerService | `archiveWorkspace(executionId)`                                                     |

**CleanupService should delegate to WorkspaceService:**

```typescript
// In CleanupService.cleanupWorkspaceFolder()
async cleanupWorkspaceFolder(executionId: string, preserve?: boolean): Promise<number> {
  if (preserve) {
    this.logger.log(`[${executionId}] Preserving workspace for debug mode`);
    return 0;
  }

  // Delegate to existing WorkspaceService for consistency
  const bytesBefore = await this.getWorkspaceSize(executionId);
  await this.workspaceService.cleanupWorkspace(executionId, true); // force=true
  return bytesBefore;
}
```

### Module Dependencies

```typescript
// src/cleanup/cleanup.module.ts
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    AppMetricsModule,
    ScheduleModule.forRoot(), // For background cleanup job
    DockerModule, // For DockerService
    ExecutionModule, // For ExecutionTrackerService
    AIRoutingModule, // For WorkspaceService
    StorageModule, // For StorageManagerService
  ],
  providers: [CleanupService, CleanupSchedulerService, ...metricProviders],
  exports: [CleanupService],
})
export class CleanupModule {}
```

### Core Service Interface

```typescript
// src/cleanup/interfaces/cleanup-options.interface.ts
export interface CleanupOptions {
  preserveWorkspace?: boolean; // Override debug mode
  forceContainerRemove?: boolean; // Force kill container
  timeoutMs?: number; // Cleanup timeout override
}

// src/cleanup/interfaces/cleanup-result.interface.ts
export interface CleanupResult {
  executionId: string;
  containerRemoved: boolean;
  workspaceCleaned: boolean;
  bytesReclaimed: number;
  durationMs: number;
  errors: CleanupError[];
}

// src/cleanup/cleanup.service.ts
@Injectable()
export class CleanupService {
  constructor(
    private readonly dockerService: DockerService,
    private readonly executionTracker: ExecutionTrackerService,
    private readonly workspaceService: WorkspaceService,
    private readonly storageManager: StorageManagerService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    @InjectMetric('cleanup_duration_seconds')
    private readonly durationHistogram: Histogram<string>,
    @InjectMetric('cleanup_containers_total')
    private readonly containerCounter: Counter<string>,
  ) {}

  async cleanupAfterExecution(
    executionId: string,
    options?: CleanupOptions,
  ): Promise<CleanupResult>;

  async removeContainer(containerId: string, force?: boolean): Promise<void>;

  async cleanupWorkspaceFolder(executionId: string, preserve?: boolean): Promise<number>; // Returns bytes reclaimed
}
```

### ExecutionTrackerService Integration Points

**Exact methods requiring cleanup triggers:**

```typescript
// src/execution/execution-tracker.service.ts

// Line 171: completeExecution()
async completeExecution(
  completion: IExecutionCompletion,
  correlationId: string,
): Promise<IStateTransition> {
  try {
    // ... existing completion logic ...
  } finally {
    await this.triggerCleanup(completion.executionId, { force: false });
  }
}

// Line 251: failExecution()
async failExecution(
  failure: IExecutionFailure,
  correlationId: string,
): Promise<IStateTransition> {
  try {
    // ... existing failure logic ...
  } finally {
    await this.triggerCleanup(failure.executionId, { force: false });
  }
}

// Line 332: timeoutExecution()
async timeoutExecution(
  timeout: IExecutionTimeout,
  correlationId: string,
): Promise<IStateTransition> {
  try {
    // ... existing timeout logic ...
  } finally {
    await this.triggerCleanup(timeout.executionId, { force: true });
  }
}

// Line 416: cancelExecution()
async cancelExecution(
  executionId: string,
  reason: string,
  correlationId: string,
): Promise<IStateTransition> {
  try {
    // ... existing cancel logic ...
  } finally {
    await this.triggerCleanup(executionId, { force: true });
  }
}

private async triggerCleanup(
  executionId: string,
  options: { force: boolean }
): Promise<void> {
  if (!this.configService.get('ENABLE_AUTO_CLEANUP', true)) return;

  try {
    const execution = await this.getExecution(executionId);
    if (!execution) return;

    await this.cleanupService.cleanupAfterExecution(executionId, {
      preserveWorkspace: execution.debug_mode,
      forceContainerRemove: options.force,
    });
  } catch (error) {
    this.logger.error(`[${executionId}] Cleanup failed:`, error);
    // Don't throw - cleanup failure shouldn't fail execution
  }
}
```

### Background Cleanup Job

```typescript
// src/cleanup/cleanup-scheduler.service.ts
@Injectable()
export class CleanupSchedulerService {
  constructor(
    private readonly cleanupService: CleanupService,
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  @Cron('0 */5 * * * *') // Every 5 minutes
  async cleanupOrphanedResources(): Promise<void> {
    this.logger.debug('Running orphaned resource cleanup');

    // Find executions with container_id set but execution is terminal
    const orphaned = await this.prisma.execution.findMany({
      where: {
        container_id: { not: null },
        status: {
          in: [
            ExecutionStatus.COMPLETED,
            ExecutionStatus.FAILED,
            ExecutionStatus.TIMEOUT,
            ExecutionStatus.CANCELLED,
          ],
        },
      },
      take: 10, // Process in batches
    });

    for (const execution of orphaned) {
      try {
        await this.cleanupService.cleanupAfterExecution(execution.id, {
          forceContainerRemove: execution.status === ExecutionStatus.TIMEOUT,
        });
        this.logger.log(`[${execution.id}] Orphaned resources cleaned`);
      } catch (error) {
        this.logger.error(`[${execution.id}] Failed to clean orphaned resources:`, error);
      }
    }
  }
}
```

### Error Handling Strategy

| Error Type              | Handling                                                                 |
| ----------------------- | ------------------------------------------------------------------------ |
| Container not found     | Log warning, treat as success (idempotent), clear container_id           |
| Container remove failed | Retry with force=true, log error after max attempts, schedule background |
| Workspace not found     | Log warning, continue with container cleanup                             |
| Workspace delete failed | Log error, don't block container cleanup, schedule background retry      |
| Cleanup timeout         | Log error, schedule for retry in background cleanup job                  |
| Force kill failed       | Log critical error, mark for manual investigation                        |
| Execution not found     | Skip cleanup, log warning                                                |

### Custom Exception Pattern

```typescript
// src/cleanup/exceptions/cleanup.exceptions.ts
export class CleanupException extends InfrastructureException {
  constructor(message: string, status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR) {
    super(message, status, 'CLEANUP_ERROR');
  }
}

export class ContainerCleanupError extends CleanupException {
  constructor(containerId: string, originalError: string) {
    super(
      `Failed to cleanup container ${containerId}: ${originalError}`,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

export class WorkspaceCleanupError extends CleanupException {
  constructor(workspacePath: string, originalError: string) {
    super(
      `Failed to cleanup workspace at ${workspacePath}: ${originalError}`,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

export class CleanupTimeoutError extends CleanupException {
  constructor(executionId: string) {
    super(`Cleanup timed out for execution ${executionId}`, HttpStatus.REQUEST_TIMEOUT);
  }
}
```

### Configuration Reference

| Variable                     | Default         | Description                                    |
| ---------------------------- | --------------- | ---------------------------------------------- |
| `ENABLE_AUTO_CLEANUP`        | `true`          | Master switch for automatic cleanup            |
| `CLEANUP_DEBUG_MODE_DEFAULT` | `false`         | Global default for debug mode                  |
| `CLEANUP_TIMEOUT_MS`         | `30000`         | Max time allowed for cleanup operation         |
| `CLEANUP_RETRY_ATTEMPTS`     | `3`             | Number of retry attempts for failed cleanups   |
| `CLEANUP_SCHEDULE_CRON`      | `0 */5 * * * *` | Background cleanup frequency (every 5 minutes) |

### Project Structure Notes

New/modified files:

- `prisma/schema.prisma` - Add container_id and debug_mode fields to Execution model
- `prisma/migrations/` - New migration for schema changes
- `src/cleanup/cleanup.module.ts` - NestJS module definition
- `src/cleanup/cleanup.service.ts` - Core cleanup orchestration service
- `src/cleanup/cleanup-scheduler.service.ts` - Background cleanup job
- `src/cleanup/cleanup.service.spec.ts` - Unit tests
- `src/cleanup/interfaces/cleanup-options.interface.ts` - Options type
- `src/cleanup/interfaces/cleanup-result.interface.ts` - Result type
- `src/cleanup/exceptions/cleanup.exceptions.ts` - Custom exceptions
- `src/cleanup/index.ts` - Module exports
- `src/config/env.validation.ts` - Add cleanup configuration
- `src/execution/execution-tracker.service.ts` - Add assignContainer(), cleanup triggers in 4 methods [lines 171, 251, 332, 416]
- Container spawning code - Add assignContainer() call (likely in ai-execution.consumer.ts)
- `src/app.module.ts` - Import CleanupModule

### Dependencies

- Uses `DockerService` (`src/docker/docker.service.ts:520-531`) for container removal
- Uses `ExecutionTrackerService` (`src/execution/execution-tracker.service.ts`) for execution metadata
- Uses `WorkspaceService` (`src/ai-routing/providers/workspace.service.ts:377-430`) for workspace cleanup delegation
- Uses `StorageManagerService` for disk usage checks
- Uses `ConfigService` for configuration
- Uses `AppMetricsModule` for Prometheus metrics
- Uses `@nestjs/schedule` for background cleanup job
- Follows patterns from Story 23-1 (GitMirrorService) for metrics and error handling

### Key Architectural Decisions

- **Idempotent Cleanup**: Multiple cleanup calls for same execution are safe; container_id is cleared after success
- **Fail-Safe Design**: Cleanup failures don't block execution completion; logged and retried in background
- **Debug Mode**: Workspaces preserved when `execution.debug_mode=true` for troubleshooting
- **Force Kill**: Timed out containers are forcefully terminated with `forceContainerRemove: true`
- **Background Retry**: Failed cleanups are retried in scheduled cleanup job; orphan detection every 5 minutes
- **Metrics First**: All cleanup operations tracked for observability
- **Workspace Cleanup Delegation**: CleanupService orchestrates but delegates to existing WorkspaceService for consistency

### References

- [Source: _bmad-output/planning-artifacts/epics-containerization.md#Story 2.2 - AC for container and workspace cleanup]
- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml#epic-023 - Epic status]
- [Story 23-1: Local Git Mirror Service - Patterns for metrics (@InjectMetric) and error handling]
- [Source: src/docker/docker.service.ts:501-531 - Docker killContainer and removeContainer methods]
- [Source: src/ai-routing/providers/workspace.service.ts:377-430 - Existing WorkspaceService.cleanupWorkspace()]
- [Source: src/execution/execution-tracker.service.ts:171-246 - completeExecution() method]
- [Source: src/execution/execution-tracker.service.ts:251-327 - failExecution() method]
- [Source: src/execution/execution-tracker.service.ts:332-411 - timeoutExecution() method]
- [Source: src/execution/execution-tracker.service.ts:416-436 - cancelExecution() method]
- [Source: prisma/schema.prisma:160-228 - Execution model definition]

## Dev Agent Record

### Agent Model Used

Kimi Code CLI

### Debug Log References

N/A

### Completion Notes List

1. **Database Schema (Task 0)**: Added `container_id` and `debug_mode` fields to Execution model in Prisma schema. Migration `20260202203705_add_container_cleanup_fields` generated and applied successfully.

2. **Container ID Storage (Task 1)**: Added `assignContainer()` method to ExecutionTrackerService and `update()` method to ExecutionRepository for storing container IDs when containers are spawned.

3. **Cleanup Module (Tasks 2-4)**: Created complete CleanupModule with:
   - `CleanupService`: Core orchestration for container and workspace cleanup
   - `CleanupSchedulerService`: Background job running every 5 minutes for orphaned resources
   - Custom exceptions: CleanupException, ContainerCleanupError, WorkspaceCleanupError, CleanupTimeoutError
   - Full TypeScript interfaces for options and results

4. **Execution Lifecycle Integration (Task 5)**: Added cleanup triggers in finally blocks of:
   - `completeExecution()` - normal completion, force=false
   - `failExecution()` - failure, force=false
   - `timeoutExecution()` - timeout, force=true (kill container)
   - `cancelExecution()` - cancellation, force=true (kill container)

5. **Configuration (Task 7)**: Added 5 new environment variables to `env.validation.ts`:
   - ENABLE_AUTO_CLEANUP (default: true)
   - CLEANUP_DEBUG_MODE_DEFAULT (default: false)
   - CLEANUP_TIMEOUT_MS (default: 30000)
   - CLEANUP_RETRY_ATTEMPTS (default: 3)
   - CLEANUP_SCHEDULE_CRON (default: '0 _/5 _ \* \* \*')

6. **Metrics (Task 8)**: Implemented Prometheus metrics:
   - cleanup_duration_seconds (Histogram)
   - cleanup_containers_total (Counter with status label)
   - cleanup_bytes_reclaimed_total (Counter)
   - cleanup_failures_total (Counter with type label)

7. **Tests (Task 9)**: Created comprehensive unit tests:
   - `cleanup.service.spec.ts`: 10 test cases covering all AC scenarios
   - `cleanup-scheduler.service.spec.ts`: 5 test cases for background job
   - All 18 cleanup tests pass
   - Fixed existing execution-tracker tests to work with new dependencies

### Code Review Fixes Applied

- Fixed import paths in cleanup.module.ts (AiRoutingModule case, LoggerModule path)
- Fixed metric token names in tests to match @willsoto/nestjs-prometheus convention
- Added ConfigService and metric mocks to execution-tracker.service.spec.ts
- Added container_id and debug_mode to all mock execution objects in test files

### Code Review Fixes Applied (Post-Review)

1. **Test Bug Fix** (cleanup.service.spec.ts:222-225): Added missing `await service.cleanupWorkspaceFolder()` call in test
2. **Missing Container Assignment** (pty-execution.service.ts:346-353): Added `assignContainer()` call after container creation
3. **Missing Metric** (cleanup.module.ts): Added `cleanup_orphaned_resources` Gauge
4. **Timeout Configuration** (cleanup.service.ts): Implemented `runWithTimeout()` helper and wired up `CLEANUP_TIMEOUT_MS`
5. **Test Updates** (pty-execution.service.spec.ts): Added ExecutionTrackerService mock
6. **Lint Fixes**: All lint errors resolved

### File List

**New Files:**

- `src/cleanup/cleanup.module.ts`
- `src/cleanup/cleanup.service.ts`
- `src/cleanup/cleanup-scheduler.service.ts`
- `src/cleanup/cleanup.service.spec.ts`
- `src/cleanup/cleanup-scheduler.service.spec.ts`
- `src/cleanup/index.ts`
- `src/cleanup/interfaces/cleanup-options.interface.ts`
- `src/cleanup/interfaces/cleanup-result.interface.ts`
- `src/cleanup/exceptions/cleanup.exceptions.ts`

**Modified Files:**

- `prisma/schema.prisma` - Add container_id, debug_mode to Execution model
- `prisma/migrations/20260202203705_add_container_cleanup_fields/migration.sql` - New migration
- `src/config/env.validation.ts` - Add cleanup configuration
- `src/execution/execution-tracker.service.ts` - Add assignContainer(), cleanup triggers, ConfigService dependency
- `src/execution/execution.repository.ts` - Add update() method
- `src/execution/execution-tracker.service.spec.ts` - Add new mocks for ConfigService and metrics
- `src/execution/execution.service.spec.ts` - Add container_id, debug_mode to mock
- `src/execution/ai-execution.publisher.spec.ts` - Add container_id, debug_mode to mock
- `src/execution/retry-handler.service.spec.ts` - Add container_id, debug_mode to mock
- `src/execution/execution.repository.spec.ts` - Add container_id, debug_mode to mock
- `src/app.module.ts` - Import CleanupModule
- `src/ai-routing/services/pty-execution.service.ts` - Add assignContainer() call after container creation (Story 23.2 integration)
