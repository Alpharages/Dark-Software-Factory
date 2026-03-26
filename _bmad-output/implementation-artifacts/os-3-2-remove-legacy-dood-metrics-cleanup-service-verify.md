# Story OS-3.2: Remove Legacy DooD Metrics, Clean Up CleanupService, and Verify Zero Docker Dependency

Status: ready-for-dev

## Story

As a **Platform Engineer**,
I want all DooD Prometheus metrics removed and `CleanupService` scrubbed of Docker-specific logic,
so that `/metrics` shows only OpenSandbox metrics and all 7 mandatory grep checks return zero results.

## Acceptance Criteria

1. **Given** `docker.module.ts` Prometheus metric providers were removed (deleted in OS-3.1)
   **When** the `/metrics` endpoint is scraped (or metric registration checked at startup)
   **Then** none of these metric names appear: `sandbox_container_memory_limit_bytes`, `sandbox_container_cpu_limit_percent`, `sandbox_container_oom_events_total`, `sandbox_container_cpu_throttled_seconds_total`, `sandbox_container_memory_usage_bytes`

2. **Given** `CleanupService` is fully reviewed after OS-3.1 changes
   **When** a developer inspects `src/cleanup/cleanup.service.ts`
   **Then**:
   - `DockerService` is not imported, injected, or called anywhere
   - `WorkspaceService` is not imported, injected, or called anywhere
   - `removeContainer()` method is a no-op (OpenSandbox handles TTL)
   - `cleanupWorkspaceFolder()` method is a no-op (OpenSandbox handles workspace)
   - `calculateDirectorySize()` private method is removed (dead code — only called from `cleanupWorkspaceFolder`)
   - `cleanupAfterExecution()` public method signature and return type are **unchanged**
   - Non-Docker config vars (`ENABLE_AUTO_CLEANUP`, `CLEANUP_TIMEOUT_MS`) still work
   - Prometheus metrics `cleanup_duration_seconds`, `cleanup_containers_total`, `cleanup_bytes_reclaimed_total`, `cleanup_failures_total` are **preserved**

3. **Given** the codebase after all OS-3 changes
   **When** all 7 grep checks are run
   **Then** every check returns zero results:
   - `grep -r "DockerService" src/ --include="*.ts"` → 0
   - `grep -r "WorkspaceService" src/ --include="*.ts"` → 0
   - `grep -r "PtyExecutionService" src/ --include="*.ts"` → 0
   - `grep -r "DockerModule" src/ --include="*.ts"` → 0
   - `grep -r "docker.sock" docker-compose*.yml` → 0
   - `grep -r "dockerode" src/ --include="*.ts"` → 0
   - `grep -r "node-pty" src/ --include="*.ts"` → 0

   **Note:** `CURSOR_HEADLESS` grep check is explicitly deferred to Story OS-5.2 — do NOT add that check here.

4. **Given** `pnpm test` is run after all OS-3 changes
   **When** the command completes
   **Then** zero test failures across the full test suite

## Tasks / Subtasks

- [ ] Task 1: Verify OS-3.1 completion before starting (AC: all)
  - [ ] Confirm `src/docker/` directory is deleted
  - [ ] Confirm `src/ai-routing/services/pty-execution.service.ts` is deleted
  - [ ] Confirm `src/ai-routing/providers/workspace.service.ts` is deleted
  - [ ] Confirm `pnpm typecheck` passes (zero TypeScript errors from OS-3.1)
  - [ ] If any of the above are not done, stop and complete OS-3.1 first

- [ ] Task 2: Final CleanupService scrub (AC: #2)
  - [ ] Open `src/cleanup/cleanup.service.ts` — read the current state post-OS-3.1
  - [ ] Verify `DockerService` import and injection are removed (done in OS-3.1)
  - [ ] Verify `WorkspaceService` import and injection are removed (done in OS-3.1)
  - [ ] Verify `removeContainer()` method (line ~180 in pre-OS-3.1) is now a no-op that logs a debug message
  - [ ] Verify `cleanupWorkspaceFolder()` method (line ~207 pre-OS-3.1) is now a no-op that returns 0
  - [ ] Delete `calculateDirectorySize()` private method — it is dead code once `cleanupWorkspaceFolder` is a no-op
  - [ ] Remove `import * as fs from 'fs/promises'` (line 5 pre-OS-3.1) — only used by `calculateDirectorySize()`
  - [ ] Remove `import * as path from 'path'` (line 6 pre-OS-3.1) — only used by `calculateDirectorySize()`
  - [ ] Remove `ContainerCleanupError` from the exceptions import (line 12 pre-OS-3.1); keep `CleanupTimeoutError` — it is still thrown by `runWithTimeout()`: `import { CleanupTimeoutError } from './exceptions/cleanup.exceptions';`
  - [ ] **PRESERVE `runWithTimeout()` private method** — `cleanupAfterExecution()` still wraps both no-op calls with it; it is NOT dead code
  - [ ] Confirm `cleanupAfterExecution()` public signature is unchanged: `async cleanupAfterExecution(executionId: string, options?: CleanupOptions): Promise<CleanupResult>`
  - [ ] Confirm `execution.container_id` path in `cleanupAfterExecution()` still works (calls the no-op removeContainer, sets containerRemoved=true)
  - [ ] Confirm `ExecutionTrackerService` injection is still present (used for `getExecution()` and `assignContainer()` at lines ~78 and ~148 pre-OS-3.1 — NOT Docker)

- [ ] Task 2b: Scrub cleanup.module.ts (AC: #2, #3)
  - [ ] Open `src/cleanup/cleanup.module.ts`
  - [ ] Verify `import { DockerModule } from '@/docker/docker.module'` is removed (OS-3.1 Task 2)
  - [ ] Verify `DockerModule` is removed from the `imports` array
  - [ ] Remove `import { AiRoutingModule } from '@/ai-routing/ai-routing.module'` — after WorkspaceService is deleted from AiRoutingModule's exports, nothing in CleanupModule needs AiRoutingModule (`CleanupService` uses only `ExecutionTrackerService`/`ConfigService`; `ExecutionCleanupListener` uses only `CleanupService`/`EventBusService`/`ConfigService`)
  - [ ] Remove `AiRoutingModule` from the `imports` array
  - [ ] Run `pnpm typecheck` — if any provider-not-found error appears, identify what still needs AiRoutingModule and re-add it with a comment; otherwise removal is safe

- [ ] Task 3: Update cleanup.service.spec.ts (AC: #2, #4)
  - [ ] Open `src/cleanup/cleanup.service.spec.ts` — read post-OS-3.1 state
  - [ ] Verify `DockerService` and `WorkspaceService` mocks are removed (done in OS-3.1 Task 8)
  - [ ] Verify `cleanupContainer` / `cleanupWorkspace` tests were replaced with no-op behavior assertions
  - [ ] If `calculateDirectorySize()` had tests, remove them (method deleted in Task 2 above)
  - [ ] Add test: `cleanupWorkspaceFolder()` always returns 0 and logs debug message (no-op behavior)
  - [ ] Add test: `removeContainer()` calls logger.debug and returns without throwing (no-op behavior)
  - [ ] Run `pnpm test src/cleanup/cleanup.service.spec.ts` → must pass green

- [ ] Task 4: Check for any remaining @InjectMetric references to docker metrics (AC: #1)
  - [ ] Run: `grep -r "sandbox_container_" src/ --include="*.ts"`
  - [ ] Expected result: zero hits (docker.service.ts was deleted in OS-3.1, and no other service injected those metrics)
  - [ ] If any hits found, remove those @InjectMetric injections and their usages

- [ ] Task 5: Run all 7 mandatory grep checks (AC: #3)
  - [ ] `grep -r "DockerService" src/ --include="*.ts"` → must be 0
  - [ ] `grep -r "WorkspaceService" src/ --include="*.ts"` → must be 0
  - [ ] `grep -r "PtyExecutionService" src/ --include="*.ts"` → must be 0
  - [ ] `grep -r "DockerModule" src/ --include="*.ts"` → must be 0
  - [ ] `grep -r "docker.sock" docker-compose*.yml` → must be 0
  - [ ] `grep -r "dockerode" src/ --include="*.ts"` → must be 0
  - [ ] `grep -r "node-pty" src/ --include="*.ts"` → must be 0
  - [ ] For each non-zero result: fix the remaining reference, then re-run that check

- [ ] Task 6: Final typecheck and test run (AC: #4)
  - [ ] Run `pnpm typecheck` → zero TypeScript errors
  - [ ] Run `pnpm test` → zero test failures
  - [ ] Fix any failures before marking story complete

## Dev Notes

### Prerequisite: OS-3.1 Must Be Complete

This story is a FOLLOW-ON to OS-3.1. Do NOT start OS-3.2 until OS-3.1 is fully done (all docker files deleted, DockerModule removed, packages removed, typecheck passes). The docker metrics (AC #1) are removed implicitly when `docker.module.ts` is deleted in OS-3.1 — there are no other files to change for that.

### CleanupService — What OS-3.1 Does vs. What OS-3.2 Verifies

OS-3.1 calls the private methods `cleanupContainer()` and `cleanupWorkspace()` per its dev notes. However, the actual method names in `cleanup.service.ts` are:

- `removeContainer()` (PUBLIC, line ~180) — calls `dockerService.killContainer()` and `dockerService.removeContainer()`
- `cleanupWorkspaceFolder()` (PUBLIC, line ~207) — calls `workspaceService.getWorkspace()` and `workspaceService.cleanupWorkspace()`

OS-3.1 should have replaced these with no-ops. If the developer implementing OS-3.1 used different names in the no-op implementation, adapt accordingly — what matters is that the Docker/WorkspaceService calls are gone.

**Post-OS-3.2 expected no-op implementations:**

```typescript
// removeContainer — no-op, OpenSandbox handles TTL
async removeContainer(containerId: string, force = false): Promise<void> {
  // OpenSandbox handles container cleanup via TTL — no action needed
  this.logger.debug(`Container cleanup delegated to OpenSandbox TTL (containerId: ${containerId})`);
}

// cleanupWorkspaceFolder — no-op, OpenSandbox handles workspace
async cleanupWorkspaceFolder(executionId: string, preserve = false): Promise<number> {
  // OpenSandbox handles workspace cleanup — no action needed
  this.logger.debug(`Workspace cleanup delegated to OpenSandbox TTL (executionId: ${executionId})`);
  return 0;
}
```

And `calculateDirectorySize()` (private, ~line 239 pre-OS-3.1) must be **deleted** — it only existed to measure bytes before `workspaceService.cleanupWorkspace()` was called.

### CleanupService — What Must NOT Change

These parts of `CleanupService` are NOT Docker-related and must remain functional:

- `cleanupAfterExecution()` public method signature and return type — callers depend on it
- `ExecutionTrackerService` injection — used for `getExecution()` and `assignContainer(executionId, '')` (clearing container_id from DB after cleanup, completely separate from Docker)
- `ConfigService` injection — used for `ENABLE_AUTO_CLEANUP` and `CLEANUP_TIMEOUT_MS` config checks
- Prometheus metrics: `cleanup_duration_seconds`, `cleanup_containers_total`, `cleanup_bytes_reclaimed_total`, `cleanup_failures_total` — these measure cleanup operations, NOT Docker container stats — they stay
- `runWithTimeout()` private method — **must be preserved**; `cleanupAfterExecution()` still wraps both no-op calls with it (`this.runWithTimeout(this.removeContainer(...), ...)` and `this.runWithTimeout(this.cleanupWorkspaceFolder(...), ...)`)

### Docker Metrics vs. Cleanup Metrics — Critical Distinction

The 5 docker metrics (`sandbox_container_*`) are defined in `docker.module.ts` and injected into `docker.service.ts`. They are **gone** when OS-3.1 deletes those files.

The 5 cleanup metrics (`PROM_METRIC_CLEANUP_*`) are defined in `cleanup.module.ts` and injected into `cleanup.service.ts`. They are **NOT Docker metrics** and must be **preserved**. Do NOT remove them.

From `cleanup.service.spec.ts` line 106-110 (pre-OS-3.1), the following are cleanup-specific and must remain:

```
'PROM_METRIC_CLEANUP_DURATION_SECONDS'
'PROM_METRIC_CLEANUP_CONTAINERS_TOTAL'
'PROM_METRIC_CLEANUP_BYTES_RECLAIMED_TOTAL'
'PROM_METRIC_CLEANUP_FAILURES_TOTAL'
'PROM_METRIC_CLEANUP_ORPHANED_RESOURCES'   ← used in cleanup-scheduler.service.spec.ts too
```

### cleanup.exceptions.ts — Dead Classes After OS-3

After this story's changes, `cleanup.exceptions.ts` contains two classes that are dead code:

- `ContainerCleanupError` — was only thrown in `removeContainer()` (now a no-op); safe to delete
- `WorkspaceCleanupError` — was never imported in `cleanup.service.ts`; safe to delete

`CleanupTimeoutError` is still thrown by `runWithTimeout()` and must be **kept**.

Deleting the dead exception classes is optional for OS-3.2 (no compile/test failures if they stay). If removed, also remove `CleanupException` base class if it has no other subclasses. Defer to OS-5 if preferred.

### Grep Check Notes

**`WorkspaceService` check:** There are/were TWO different WorkspaceService classes (from `@/docker/workspace.service` and `@/ai-routing/providers/workspace.service`). Both are deleted by OS-3.1. The grep must return zero for the import string pattern.

**`docker.sock` check:** The shell glob `docker-compose*.yml` from the project root only matches `docker-compose.prod.yml` (the only root-level compose file). The other compose file at `docker/docker-compose.yml` lives in a subdirectory and already has **no** `docker.sock` mount — it is clean. OS-3.1 removes the mount from `docker-compose.prod.yml` (line ~64: `- /var/run/docker.sock:/var/run/docker.sock`). The grep check confirms that removal.

**`CURSOR_HEADLESS` check is NOT in scope** — this is deferred to OS-5.2 per epic design. The `cursor-headless.provider.ts` file still exists during OS-3 (Cursor is retired in Epic OS-4).

### Order of Operations (If Stragglers Found)

If grep checks return non-zero after confirming OS-3.1 is complete:

1. Fix the specific file(s) referenced by the grep output
2. Re-run `pnpm typecheck` after each fix
3. Re-run that specific grep check
4. Only after all 7 checks return zero, run `pnpm test`

### Project Structure Notes

- `src/cleanup/cleanup.service.ts` — primary file to verify/fix in this story
- `src/cleanup/cleanup.service.spec.ts` — update if tests still reference Docker/Workspace
- `src/cleanup/cleanup.module.ts` — should already be clean after OS-3.1 (DockerModule removed)
- `src/cleanup/cleanup-scheduler.service.spec.ts` — contains `'PROM_METRIC_CLEANUP_ORPHANED_RESOURCES'` mock — do NOT remove this

### Execution Model — Why Cleanup Becomes No-Op

Per OS-1, OpenSandbox creates sandboxes with a TTL. When the TTL expires, OpenSandbox automatically:

- Terminates the container
- Cleans up the workspace directory inside the sandbox

Therefore, DSF no longer needs to explicitly clean up containers or workspaces after execution. The `CleanupService` orchestration flow (`cleanupAfterExecution()`) still runs (called by execution state machine) but its Docker-specific internals are no-ops.

### References

- FR-OS40: Cleanup Service Review [Source: `_bmad-output/planning-artifacts/prd-opensandbox-migration.md#5.15`]
- FR-OS34, FR-OS35: Files to delete [Source: `_bmad-output/planning-artifacts/prd-opensandbox-migration.md#5.16.1`]
- Prometheus metrics to remove: [Source: `_bmad-output/planning-artifacts/prd-opensandbox-migration.md#5.16.5`]
- Verification grep checks: [Source: `_bmad-output/planning-artifacts/prd-opensandbox-migration.md#5.16.7`]
- CleanupService current state (pre-OS-3.1): `src/cleanup/cleanup.service.ts:1-285`
- CleanupService spec mocks: `src/cleanup/cleanup.service.spec.ts:104-110`
- OS-3.1 story (predecessor): `_bmad-output/implementation-artifacts/os-3-1-delete-dood-files-remove-docker-module.md`
- OS-3.1 dev notes — cleanup replacements: `_bmad-output/implementation-artifacts/os-3-1-delete-dood-files-remove-docker-module.md#Replacing-CleanupService-Docker-Calls`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
