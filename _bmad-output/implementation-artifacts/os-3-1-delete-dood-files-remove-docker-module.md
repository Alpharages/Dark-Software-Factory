# Story OS-3.1: Delete DooD Files and Remove DockerModule

Status: done

## Story

As a **Developer**,
I want all Docker-related source files deleted and `DockerModule` removed from the module graph,
so that the codebase has zero DooD code and any accidental re-introduction is immediately caught by the TypeScript compiler.

## Acceptance Criteria

1. **Given** the DooD deletion is complete
   **When** the following files are checked
   **Then** they do not exist: `src/docker/docker.service.ts`, `src/docker/docker.module.ts`, `src/docker/workspace.service.ts`, `src/docker/interfaces/resource-profile.interface.ts`, `src/ai-routing/services/pty-execution.service.ts`; and `src/docker/` directory is empty or removed

2. **Given** `src/app.module.ts` is updated
   **When** a developer inspects it
   **Then** `DockerModule` is not imported; `SandboxModule` is already imported (do not add it again)

3. **Given** the following files are updated to remove all Docker/workspace injection: `src/cleanup/cleanup.module.ts`, `src/cleanup/cleanup.service.ts`, `src/qa-automation/qa-orchestrator.service.ts`, `src/github/services/pr-risk-assessor.service.ts`, `src/github/services/github-commit-orchestrator.service.ts`, `src/github/services/github-push-trigger.consumer.ts`
   **When** a developer inspects each file
   **Then** `DockerService` and `WorkspaceService` are not imported, injected, or called anywhere

4. **Given** `pnpm remove dockerode node-pty @types/dockerode` is run
   **When** `package.json` and `pnpm-lock.yaml` are inspected
   **Then** `dockerode`, `node-pty`, and `@types/dockerode` are absent from all dependency sections

5. **Given** `pnpm typecheck` is run after all deletions
   **When** the command completes
   **Then** zero TypeScript errors — the module graph compiles cleanly without the deleted files

## Tasks / Subtasks

- [ ] Task 1: Delete all DooD source files (AC: #1)
  - [ ] Delete `src/docker/docker.service.ts`
  - [ ] Delete `src/docker/docker.service.spec.ts`
  - [ ] Delete `src/docker/docker.module.ts`
  - [ ] Delete `src/docker/workspace.service.ts`
  - [ ] Delete `src/docker/workspace.service.spec.ts`
  - [ ] Delete `src/docker/index.ts`
  - [ ] Delete `src/docker/interfaces/resource-profile.interface.ts`
  - [ ] Delete `src/docker/interfaces/resource-profile.interface.spec.ts`
  - [ ] Delete `src/docker/interfaces/resource-limit-config.interface.ts`
  - [ ] Delete `src/ai-routing/services/pty-execution.service.ts`
  - [ ] Delete `src/ai-routing/services/pty-execution.service.spec.ts` if it exists
  - [ ] Remove `src/docker/` directory entirely once empty
  - [ ] Note: `run-container-options.interface.ts`, `exec-in-container-options.interface.ts`, `container-stream-options.interface.ts` are already absent — skip

- [ ] Task 2: Remove DockerModule from AppModule, AiRoutingModule, CleanupModule; remove docker.sock from compose (AC: #2, #3)
  - [ ] Open `src/app.module.ts`
  - [ ] Remove `import { DockerModule } from '@/docker';` line
  - [ ] Remove `DockerModule,` from the `imports` array — `SandboxModule` is already present, do not add it again
  - [ ] Open `src/ai-routing/ai-routing.module.ts`
  - [ ] Remove `import { DockerModule } from '@/docker/docker.module';`
  - [ ] Remove `DockerModule` from the `imports` array
  - [ ] Remove `WorkspaceService` from the `providers` array
  - [ ] Remove `WorkspaceService` from the `exports` array
  - [ ] Remove `import { WorkspaceService } from './providers/workspace.service';` (or equivalent path)
  - [ ] Open `src/cleanup/cleanup.module.ts`
  - [ ] Remove `import { DockerModule } from '@/docker/docker.module';`
  - [ ] Remove `DockerModule` from the `imports` array
  - [ ] Open `docker-compose.prod.yml`
  - [ ] Remove the line: `- /var/run/docker.sock:/var/run/docker.sock`

- [ ] Task 3: Remove DockerService from CleanupService (AC: #3)
  - [ ] Open `src/cleanup/cleanup.service.ts`
  - [ ] Remove `import { DockerService } from '@/docker/docker.service';`
  - [ ] Remove `private readonly dockerService: DockerService` from constructor
  - [ ] Remove `import { WorkspaceService } from '@/ai-routing/providers/workspace.service';`
  - [ ] Remove `private readonly workspaceService: WorkspaceService` from constructor
  - [ ] Delete the `cleanupContainer()` private method body that calls `dockerService.killContainer()` and `dockerService.removeContainer()` — see Dev Notes for replacement
  - [ ] Delete the `cleanupWorkspace()` private method body that calls `workspaceService.cleanupWorkspace()` — see Dev Notes for replacement
  - [ ] Ensure the public `cleanup()` method remains functional — container and workspace cleanup now no-op (OpenSandbox handles TTL cleanup)

- [ ] Task 4: Remove WorkspaceService from QaOrchestratorService (AC: #3)
  - [ ] Open `src/qa-automation/qa-orchestrator.service.ts`
  - [ ] Remove `import { WorkspaceService } from '../ai-routing/providers/workspace.service';`
  - [ ] Remove `@Inject(forwardRef(() => WorkspaceService)) private readonly workspaceService: WorkspaceService` from constructor
  - [ ] Replace every `this.workspaceService.getWorkspace(message.executionId)` call — see Dev Notes for the replacement pattern using ExecutionTrackerService

- [ ] Task 5: Remove DockerService/WorkspaceService from AppService and GitHub services (AC: #3)
  - [ ] Open `src/app.service.ts`
  - [ ] Remove `import { DockerService } from './docker/docker.service';`
  - [ ] Remove `private readonly dockerService: DockerService` from constructor
  - [ ] Remove or replace any method bodies that call `this.dockerService.*` — see Dev Notes
  - [ ] Open `src/github/services/pr-risk-assessor.service.ts` and remove any DockerService/WorkspaceService imports, injections, and calls
  - [ ] Open `src/github/services/github-commit-orchestrator.service.ts` and remove any DockerService/WorkspaceService imports, injections, and calls
  - [ ] Open `src/github/services/github-push-trigger.consumer.ts` and remove any DockerService/WorkspaceService imports, injections, and calls
  - [ ] For any method that previously used Docker/workspace, replace with a no-op or direct Prisma query as appropriate (see Dev Notes)

- [ ] Task 6: Remove npm packages (AC: #4)
  - [ ] Run `pnpm remove dockerode node-pty @types/dockerode`
  - [ ] Verify `package.json` no longer lists these packages

- [ ] Task 7: Delete workspace.service from ai-routing/providers (AC: #3)
  - [ ] Delete `src/ai-routing/providers/workspace.service.ts`
  - [ ] Delete `src/ai-routing/providers/workspace.service.spec.ts`
  - [ ] Verify no remaining `import { WorkspaceService }` in the codebase: `grep -r "WorkspaceService" src/ --include="*.ts"` → should return zero

- [ ] Task 8: Update cleanup.service.spec.ts (AC: #5)
  - [ ] Open `src/cleanup/cleanup.service.spec.ts`
  - [ ] Remove `DockerService` and `WorkspaceService` from the mock providers/imports
  - [ ] Replace tests for `cleanupContainer()` and `cleanupWorkspace()` with no-op behavior assertions: verify `logger.debug` is called rather than Docker methods
  - [ ] Run `pnpm test src/cleanup/cleanup.service.spec.ts` to confirm green

- [ ] Task 9: Typecheck and full test run (AC: #5)
  - [ ] Run `pnpm typecheck` and fix all TypeScript errors
  - [ ] Run `pnpm test` and fix any remaining test failures caused by removed dependencies

## Dev Notes

### CRITICAL: What Actually Exists vs. What the Epic Lists

The epic acceptance criteria lists some interface files that **do not exist** in the current codebase (already absent):

- `src/docker/interfaces/run-container-options.interface.ts` — **NOT FOUND**, skip
- `src/docker/interfaces/exec-in-container-options.interface.ts` — **NOT FOUND**, skip
- `src/docker/interfaces/container-stream-options.interface.ts` — **NOT FOUND**, skip

These files **DO exist** and must be deleted (some not explicitly listed in the epic but part of the docker module):

- `src/docker/interfaces/resource-limit-config.interface.ts` — **exists**, delete it
- `src/docker/interfaces/resource-profile.interface.spec.ts` — **exists**, delete it
- `src/docker/docker.service.spec.ts` — **exists**, delete it
- `src/docker/workspace.service.spec.ts` — **exists**, delete it
- `src/docker/index.ts` — **exists**, delete it

### CRITICAL: Two Different WorkspaceService Classes

There are **two** `WorkspaceService` classes in the codebase — they are different:

| File                                            | Purpose                                    | Status                             |
| ----------------------------------------------- | ------------------------------------------ | ---------------------------------- |
| `src/docker/workspace.service.ts`               | Creates Docker workspace directories       | **Delete** (Task 1)                |
| `src/ai-routing/providers/workspace.service.ts` | Stores/retrieves workspace paths in the DB | **Delete its usages** in Tasks 3–5 |

The `CleanupService`, `QaOrchestratorService`, and GitHub services all import `WorkspaceService` from `@/ai-routing/providers/workspace.service` (NOT from docker). Both must be removed per AC #3.

### Replacing WorkspaceService.getWorkspace() in QaOrchestratorService

`QaOrchestratorService` calls `this.workspaceService.getWorkspace(message.executionId)` in 4 places to retrieve the workspace path for QA checks.

**⚠️ IMPORTANT: The `Execution` Prisma model has NO `workspacePath` field.** Do NOT use `execution.workspacePath` — it doesn't exist and will cause a TypeScript error.

`WorkspaceService.getWorkspace()` internally does `prisma.workspace.findUnique({ where: { execution_id } })` — it queries a separate `workspace` table. The correct replacement is a direct Prisma query. `PrismaService` is already injected in `QaOrchestratorService` (check the constructor — if not, add it via the already-imported `DatabaseModule`):

```typescript
// OLD:
const workspace = await this.workspaceService.getWorkspace(message.executionId);
if (!workspace) {
  this.logger.warn(`...`);
  return;
}
const workspacePath = workspace.path;

// NEW: Direct Prisma workspace lookup (same query WorkspaceService used)
const workspace = await this.prisma.workspace.findUnique({
  where: { execution_id: message.executionId },
});
if (!workspace) {
  this.logger.warn(`[${message.executionId}] No workspace found — QA check skipped`);
  return;
}
const workspacePath = workspace.path;
```

Check what field name `workspace.path` uses on the Prisma model — look at `prisma/schema.prisma` for the `Workspace` model field names before using `workspace.path`.

### Replacing CleanupService Docker Calls

`CleanupService` currently calls `dockerService.killContainer()`, `dockerService.removeContainer()`, and `workspaceService.cleanupWorkspace()`. After OS-3, OpenSandbox handles container cleanup via TTL — the DSF backend no longer needs to clean up containers or workspaces explicitly.

Replace the cleanup methods with no-ops that log a message:

```typescript
private async cleanupContainer(containerId: string, force: boolean): Promise<void> {
  // OpenSandbox handles container cleanup via TTL — no action needed
  this.logger.debug(`Container cleanup delegated to OpenSandbox TTL (containerId: ${containerId})`);
}

private async cleanupWorkspace(executionId: string): Promise<void> {
  // OpenSandbox handles workspace cleanup — no action needed
  this.logger.debug(`Workspace cleanup delegated to OpenSandbox TTL (executionId: ${executionId})`);
}
```

The public `cleanup()` method signature and flow must remain unchanged — only the internal implementation changes.

### AppModule — SandboxModule Already Present

`src/app.module.ts` already imports `SandboxModule` (added in OS-1). When removing `DockerModule`, do NOT add SandboxModule again. The current state:

```typescript
import { DockerModule } from '@/docker'; // Story 22.1  ← REMOVE THIS LINE
import { SandboxModule } from '@/sandbox'; // Epic OS-1  ← KEEP, already present
```

And in the `imports` array:

```typescript
DockerModule, // Story 22.1: Docker Client Integration  ← REMOVE
SandboxModule, // Epic OS-1: OpenSandbox Migration  ← KEEP
```

### DockerModule Prometheus Metric Providers

`DockerModule` registers 5 Prometheus metric providers via `@willsoto/nestjs-prometheus`. These will be removed as part of this story when `DockerModule` is deleted. Any services that inject these metrics by name will fail to compile — check for `@InjectMetric('sandbox_container_*')` patterns:

```bash
grep -r "sandbox_container_memory_limit_bytes\|sandbox_container_cpu_limit_percent\|sandbox_container_oom_events_total\|sandbox_container_cpu_throttled_seconds_total\|sandbox_container_memory_usage_bytes" src/ --include="*.ts"
```

If any service injects these metrics, remove those `@InjectMetric` injections and their usages. Story OS-3.2 explicitly cleans up remaining metric references.

### AppService — DockerService for Integration Health

`src/app.service.ts` injects `DockerService` and uses it in an integration health check method (likely `getIntegrationHealth()` or similar — it returns `IntegrationHealthResponseDto`). After removing `DockerService`:

1. Remove the constructor injection
2. Remove the Docker-specific health entry from the response — or replace with a hardcoded `{ status: 'removed', message: 'Docker dependency eliminated in OS-3' }` entry if the method signature requires it
3. Check `src/app.controller.ts` — it likely calls the AppService method; the controller itself may not need changes, but verify

### AiRoutingModule — WorkspaceService Owner

`src/ai-routing/ai-routing.module.ts` is the module that **provides and exports** `WorkspaceService` from `@/ai-routing/providers/workspace.service`. It also imports `DockerModule`. Both must be removed. After removing `WorkspaceService` from providers/exports, the `CleanupModule` and `QaAutomationModule` (which import `AiRoutingModule` to consume `WorkspaceService`) will no longer receive it — which is the desired state once Tasks 3–5 remove all usages.

The `CursorHeadlessProvider` is also listed in `AiRoutingModule` providers/exports — **do NOT touch it**. Cursor is retired in OS-4.

### GitHub Services — Likely Minimal Docker Usage

From the grep results, `pr-risk-assessor.service.ts`, `github-commit-orchestrator.service.ts`, and `github-push-trigger.consumer.ts` appear in the Docker/WorkspaceService grep output. Before editing, check what they actually use:

```bash
grep -n "DockerService\|WorkspaceService" src/github/services/pr-risk-assessor.service.ts
grep -n "DockerService\|WorkspaceService" src/github/services/github-commit-orchestrator.service.ts
grep -n "DockerService\|WorkspaceService" src/github/services/github-push-trigger.consumer.ts
```

Remove only what you find. Do not make assumptions about what Docker logic exists — verify first.

### Order of Operations

Perform deletions in this order to minimize cascading TypeScript errors:

1. Delete `src/docker/` directory entirely first (Task 1)
2. Delete `src/ai-routing/services/pty-execution.service.ts` (Task 1)
3. Update module files: `app.module.ts`, `ai-routing.module.ts`, `cleanup.module.ts`, `docker-compose.prod.yml` (Task 2)
4. Update service files to remove injections: CleanupService, QaOrchestratorService, AppService, GitHub services (Tasks 3–5)
5. Delete `src/ai-routing/providers/workspace.service.ts` and its spec (Task 7)
6. Update `cleanup.service.spec.ts` (Task 8)
7. Run `pnpm remove dockerode node-pty @types/dockerode` (Task 6)
8. Run `pnpm typecheck` and fix remaining errors (Task 9)

Do NOT run `pnpm typecheck` before step 8 — it will fail until all references are removed.

### What This Story Does NOT Cover (OS-3.2 scope)

- Prometheus metric cleanup: `docker.module.ts` metric providers are removed implicitly when the file is deleted. Verifying `/metrics` endpoint shows none of those metric names is OS-3.2's responsibility.
- The 7 grep checks that must all return zero — verified as part of OS-3.2.

### Project Structure Notes

**Files to delete entirely:**

```
src/docker/docker.service.ts
src/docker/docker.service.spec.ts
src/docker/docker.module.ts
src/docker/workspace.service.ts
src/docker/workspace.service.spec.ts
src/docker/index.ts
src/docker/interfaces/resource-profile.interface.ts
src/docker/interfaces/resource-profile.interface.spec.ts
src/docker/interfaces/resource-limit-config.interface.ts
src/ai-routing/services/pty-execution.service.ts
src/ai-routing/services/pty-execution.service.spec.ts  (if exists)
```

**Files to modify (remove Docker/WorkspaceService references only):**

```
src/app.module.ts
src/app.service.ts
src/ai-routing/ai-routing.module.ts
src/cleanup/cleanup.module.ts
src/cleanup/cleanup.service.ts
src/cleanup/cleanup.service.spec.ts  (remove docker-dependent tests)
src/qa-automation/qa-orchestrator.service.ts
src/github/services/pr-risk-assessor.service.ts
src/github/services/github-commit-orchestrator.service.ts
src/github/services/github-push-trigger.consumer.ts
docker-compose.prod.yml
```

**Files NOT to touch:**

- `src/sandbox/` — OS-1 SandboxService; do not modify
- `src/ai-routing/providers/workspace.service.ts` — delete its usages in callers per Tasks 3–5, but check if this file itself should be deleted only after all references are removed. Delete it in this story if no remaining callers after Tasks 3–5.
- `src/ai-routing/providers/cursor-headless.provider.ts` — Cursor code is retired in OS-4, not OS-3
- Any `src/ai-routing/` file not related to DooD (orchestrator, fallback, routing, health services)

### Key Pattern From OS-2 Stories

OS-2 established that `SandboxService.runAgentCommand()` is the replacement for Docker execution. For any Docker call patterns you encounter, the equivalent is now:

- Container creation → `SandboxService.runAgentCommand(sandboxId, command, options)`
- Workspace setup → not needed; OpenSandbox creates workspace inside the sandbox
- Container cleanup → not needed; OpenSandbox TTL handles it

### References

- FR-OS34: Files to delete [Source: `_bmad-output/planning-artifacts/prd-opensandbox-migration.md#5.12`]
- FR-OS35: DockerModule removal from AppModule [Source: `_bmad-output/planning-artifacts/prd-opensandbox-migration.md#5.12`]
- FR-OS40: CleanupService review [Source: `_bmad-output/planning-artifacts/prd-opensandbox-migration.md#5.15`]
- DockerModule metric providers: `src/docker/docker.module.ts:1–51`
- SandboxModule (already in AppModule): `src/sandbox/sandbox.module.ts`
- ExecutionTrackerService (for workspace path lookup): `src/execution/execution-tracker.service.ts`
- OS-2.2 story (SandboxService execution pattern): `_bmad-output/implementation-artifacts/os-2-2-claude-code-provider-rewrite-sandbox-service.md`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

### Review Findings

- [x] [Review][Patch] Stale commented-out `DockerModule` and `WorkspaceService` imports/exports in 6 files [`src/app.module.ts:62,102`, `src/ai-routing/ai-routing.module.ts:39`, `src/cleanup/cleanup.module.ts:9`, `src/github/services/github-push-trigger.consumer.ts:10`, `src/qa-automation/qa-orchestrator.service.ts:10`, `src/ai-routing/providers/index.ts:7`]
- [x] [Review][Patch] JSDoc in `CleanupService` still names deleted classes as active dependencies [`src/cleanup/cleanup.service.ts:15`]
- [x] [Review][Patch] `app.service.spec.ts` SandboxService test uses `/var/run/docker.sock` error string which is Docker-specific and misleading [`src/app.service.spec.ts:58`]

### Review Findings — Group 2 (src/ai-routing/ deletions)

- [x] [Review][Patch] `cursor-headless.provider.ts` and spec deleted prematurely — spec explicitly says "do NOT touch it; Cursor is retired in OS-4, not OS-3" — restore both files from git [`src/ai-routing/providers/cursor-headless.provider.ts`, `src/ai-routing/providers/cursor-headless.provider.spec.ts`]
- [x] [Review][Patch] Stale JSDoc in `GithubCommitOrchestratorService` references deleted `CursorHeadlessProvider` [`src/github/services/github-commit-orchestrator.service.ts:63`]
- [x] [Review][Patch] `providers/index.ts` banner comment still credits Story 2.6 (Cursor CLI Headless Mode) as active export [`src/ai-routing/providers/index.ts:3`]
- [x] [Review][Patch] Dead commented-out `cursor_*` Prometheus metric blocks remain in `AiRoutingModule` [`src/ai-routing/ai-routing.module.ts:148-167`]
- [x] [Review][Defer] No surviving code writes to `workspace` Prisma table after `WorkspaceService` deletion — downstream readers (`qa-orchestrator`, `github-commit-orchestrator`, `pr-risk-assessor`, `storage-manager`) may always receive `null` — deferred; OpenSandbox workspace lifecycle ownership needs to be confirmed in OS-3.2
- [x] [Review][Defer] `WorkspaceService.recoverWorkspaces()` startup reconciliation gap — stale `CREATING/IN_USE` rows will never be cleared after a crash — deferred; OS-3.2+ concern
- [x] [Review][Defer] `injectAIInstructions` (copies `.ai/instructions.md` → `CLAUDE.md`/`.cursorrules`) deleted with no replacement — AI agents will receive no system instructions — deferred; OS-3.2+ concern
- [x] [Review][Defer] `preserveFailedWorkspaces` guard deleted — failed workspaces will not be preserved for debugging — deferred; OS-3.2+ concern
- [x] [Review][Defer] `WorkspaceModel` type alias in `src/prisma/client.ts:79` is now unused — deferred, safe cleanup in OS-3.2
- [x] [Review][Defer] Prometheus metrics `sandbox_container_*` (5 metrics) go dark with no replacement — deferred, pre-existing; OS-3.2 responsibility per spec
- [x] [Review][Defer] WorkspaceService replacement is implicit in comments with no interface contract — deferred, pre-existing; architectural decision accepted in OS-3 design
- [x] [Review][Defer] SandboxResourceProfileService behavioral equivalence to deleted `getResourceProfile` is untested — deferred, pre-existing; out of scope for OS-3.1

### Review Findings — Group 3 (module/config changes)

- [x] [Review][Decision] `container-control.service.ts` imports `dockerode` after package removal — resolved: deleted `container-control.service.ts`, `container-control.service.spec.ts`; removed from `execution.module.ts`; replaced container control calls in `ManualInterventionService` with OpenSandbox no-ops; updated spec
- [x] [Review][Patch] `PtyExecutionService` commented-out stubs removed from `ai-routing.module.ts`
- [x] [Review][Patch] `libgcc`/`libstdc++` removed from Dockerfile build stage
- [x] [Review][Defer] `CostTrackingModule` imported twice in `AiRoutingModule` imports array — deferred, pre-existing duplicate; NestJS startup warning only
- [x] [Review][Defer] `CleanupModule` imports `AiRoutingModule` unnecessarily after WorkspaceService removal — deferred; removing it requires verifying no other CleanupModule consumers depend on transitive AiRouting exports

### Review Findings — Group 4 (service changes)

- [x] [Review][Patch] `CleanupTimeoutError` imported but never used in `cleanup.service.ts` — removed
- [x] [Review][Patch] Commented-out `WorkspaceService` import + constructor param removed from `github-commit-orchestrator.service.ts`
- [x] [Review][Patch] Commented-out `WorkspaceService` import + constructor param removed from `pr-risk-assessor.service.ts`
- [x] [Review][Patch] Commented-out `WorkspaceService` constructor param removed from `github-push-trigger.consumer.ts`
- [x] [Review][Defer] Dead `run*Check` methods in `QaOrchestratorService` (L987–1227) will swallow workspace-not-found as `passed:false` when re-enabled — deferred; OS-3.2 concern
- [x] [Review][Defer] `cleanupAfterExecution` always returns `containerRemoved: true, workspaceCleaned: true` — deferred; intentional no-op in OpenSandbox world; observability gap tracked in OS-3.2
- [x] [Review][Defer] `debug_mode` no longer preserves workspace (always reports `workspaceCleaned: true`) — deferred; intentional in OpenSandbox world; debug-workspace preservation needs equivalent in OS-3.2+

### Review Findings — Group 5 (final pass)

- [x] [Review][Patch] Commented-out `cursor-headless` export line not removed — should be deleted, not commented [`src/ai-routing/providers/index.ts:7`]
- [x] [Review][Patch] Commented-out `WorkspaceService` constructor injection remains in `QaOrchestratorService` — 2 lines at constructor param position should be deleted outright, not commented [`src/qa-automation/qa-orchestrator.service.ts:76-77`]
- [x] [Review][Patch] `[DEBUG]` string embedded in `logger.log()` (INFO-level) calls — should be `logger.debug()` in 3 files [`src/cleanup/cleanup.service.ts:~75,~86`, `src/github/services/github-push-trigger.consumer.ts:~252`, `src/qa-automation/qa-orchestrator.service.ts:~296`]
- [x] [Review][Patch] Misleading test name `'should report container removal failed but workspace success when execution has errors'` — asserts `containerRemoved: true` (success), not failure [`src/cleanup/cleanup.service.spec.ts:~101`]
- [x] [Review][Patch] Missing no-op test for `forceContainerRemove: true` path — test deleted without replacement; no coverage of `cleanupAfterExecution('exec-123', { forceContainerRemove: true })` behavior [`src/cleanup/cleanup.service.spec.ts`]
- [x] [Review][Defer] `CursorHeadlessProvider` still injects removed `cursor_*` metric tokens via `@InjectMetric` — safe now (not registered in any module) but fragile; OS-4 cleanup will address [`src/ai-routing/providers/cursor-headless.provider.ts:59,63`]
- [x] [Review][Defer] Stale model name `claude-3-5-sonnet-20240620` hardcoded as fallback — pre-existing; out of OS-3.1 scope [`src/ai-execution.service.ts:~120`]
- [x] [Review][Defer] Provider cancel assertion commented out in unit test — ClaudeCodeProvider cancel support is a separate concern [`src/ai-routing/ai-execution.service.spec.ts:~242`]
