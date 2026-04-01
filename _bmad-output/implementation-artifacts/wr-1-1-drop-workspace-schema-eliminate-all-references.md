# Story WR-1.1: Drop Workspace Schema & Eliminate All References

Status: done

## Story

As a **platform engineer**,
I want the `Workspace`, `WorkspaceArchive`, and `WorkspaceStatus` Prisma models removed and all `workspace_path` references eliminated from every service,
So that the codebase no longer contains dead schema that causes silent pipeline failures and TypeScript errors post-migration.

## Acceptance Criteria

**AC-1: Prisma Migration — fail-fast data safety gate**
**Given** the migration `drop_workspace_tables` is run against a database that has one or more rows in `Workspace` or `WorkspaceArchive`
**When** the migration executes
**Then** it fails fast with a descriptive error message and does NOT drop any tables (NFR-WR1)

**AC-2: Prisma Migration — happy path**
**Given** the database has zero rows in `Workspace` and `WorkspaceArchive`
**When** the migration `drop_workspace_tables` is applied
**Then** both `workspaces` and `workspace_archives` tables are dropped from the DB
**And** `model Workspace`, `model WorkspaceArchive`, and `enum WorkspaceStatus` are removed from `prisma/schema.prisma`
**And** `npx prisma generate` succeeds with no references to these models in the generated client

**AC-3: TypeScript compilation must be clean**
**Given** the Prisma models have been removed from the schema
**When** `pnpm build` (full TypeScript compilation) runs
**Then** zero compilation errors exist related to `Workspace`, `WorkspaceArchive`, `WorkspaceStatus`, or `workspace_path`

**AC-4: Zero remaining workspace_path grep matches**
**Given** all file-system references have been eliminated
**When** `grep -r "workspace_path" src/` is run
**Then** it returns zero matches (NFR-WR7)

**AC-5: Zero remaining Prisma workspace model access**
**When** `grep -rn "prisma\.workspace\b" src/` is run
**Then** it returns zero matches — no service may read from the dropped `workspaces` table

**AC-6: Zero remaining import/type refs for removed entities**
**When** `grep -r "WorkspaceArchive\|WorkspaceStatus\|WorkspaceModel\|WorkspaceArchiveModel" src/` is run
**Then** it returns zero matches

**AC-7: No breaking API changes**
**Given** any existing `/api/v1/executions/*` endpoints existed before this story
**When** these schema deletions are applied
**Then** those REST API endpoints remain unchanged in signature, response shape, and status codes (NFR-WR8)

**AC-8: Application starts clean**
**Given** the migration has been applied and TypeScript compiles cleanly
**When** the application starts (`pnpm start:dev`)
**Then** it starts without any errors related to Workspace or storage initialization

## Tasks / Subtasks

- [ ] Task 1: Create Prisma migration with fail-fast data safety gate (AC: 1, 2)
  - [ ] 1.1 Run `npx prisma migrate dev --name drop_workspace_tables --create-only` to scaffold an empty migration file
  - [ ] 1.2 Edit the generated migration SQL file — add the PL/pgSQL safety gate block first (see exact SQL in Dev Notes)
  - [ ] 1.3 After the safety gate block, add `DROP TABLE IF EXISTS workspace_archives CASCADE;` then `DROP TABLE IF EXISTS workspaces CASCADE;` (archives first — FK to execution is shared with workspace, CASCADE handles orphans)
  - [ ] 1.4 Add `DROP TYPE IF EXISTS "WorkspaceStatus";` after the DROP TABLE statements
  - [ ] 1.5 Remove `model Workspace { ... }`, `model WorkspaceArchive { ... }`, and `enum WorkspaceStatus { ... }` from `prisma/schema.prisma`
  - [ ] 1.6 Remove the `archive WorkspaceArchive?` relation line from the `Execution` model (or whichever model carries it — search `schema.prisma` for `WorkspaceArchive`)
  - [ ] 1.7 Run `npx prisma generate` — must succeed cleanly; then `npx prisma validate`

- [ ] Task 2: Update `src/prisma/client.ts` — remove re-exported workspace types (AC: 3, 6)
  - [ ] 2.1 Remove `Workspace` and `WorkspaceArchive` from the `import { ... } from '@prisma/client'` statement
  - [ ] 2.2 Remove `export type WorkspaceModel = Workspace;`
  - [ ] 2.3 Remove `export type WorkspaceArchiveModel = WorkspaceArchive;`

- [ ] Task 3: Update `src/prisma/enums.ts` — remove WorkspaceStatus (AC: 3, 6)
  - [ ] 3.1 Remove `WorkspaceStatus` from the enum re-export

- [ ] Task 4: Partially gut `src/storage/storage-manager.service.ts` (AC: 3, 4, 5)
  - [ ] 4.1 **DO NOT delete this file or its module** — `GitMirrorService` depends on `StorageManagerService.getDiskUsage()` for LRU eviction. The service must remain.
  - [ ] 4.2 `getDiskUsage()` does NOT use the Workspace model (it calls `fs.statfs()`) — **leave it completely unchanged**
  - [ ] 4.3 `archiveWorkspace(executionId)` calls `this.prisma.workspace.findUnique()` and `this.prisma.workspaceArchive.upsert()` — replace its entire body with: `throw new Error('archiveWorkspace is decommissioned — Workspace table dropped in WR-1.1');`
  - [ ] 4.4 Scan the rest of the file for any other `this.prisma.workspace` or `this.prisma.workspaceArchive` call sites and stub them the same way
  - [ ] 4.5 Remove the `workspace_path: workspace.workspace_path` references (lines ~120, 132, 144) that will no longer compile once the Prisma model is gone

- [ ] Task 5: Fix `src/cleanup/listeners/execution-cleanup.listener.ts` (AC: 3, 4)
  - [ ] 5.1 Remove the stale comment block (lines ~29–31) referencing `GitHubCommitOrchestrator` and `GitHubPushTriggerConsumer` — these are deleted in WR-1.2
  - [ ] 5.2 Remove `preserveWorkspace: true` from the `cleanupAfterExecution()` call — this flag is DooD-era dead logic (no file-system workspace exists anymore); change the call to `cleanupAfterExecution(event.executionId, { forceContainerRemove: false })`
  - [ ] 5.3 Update the log message at the end of the try-block to remove the "workspace preserved for GitHub push" text — it's no longer accurate

- [ ] Task 6: Fix `src/cleanup/interfaces/cleanup-options.interface.ts` (AC: 3)
  - [ ] 6.1 Remove the `preserveWorkspace?: boolean` field from `CleanupOptions` — it is dead DooD-era interface surface that would mislead future developers
  - [ ] 6.2 Run `grep -rn "preserveWorkspace" src/` and remove every remaining call site that passes this field

- [ ] Task 7: Fix `src/github/services/pr-risk-assessor.service.ts` (AC: 3, 4, 5)
  - [ ] 7.1 This method has TWO workspace dependencies — both must be removed:
    - **Dep A (line ~67–75):** `this.prisma.workspace.findUnique({ where: { execution_id } })` — remove this entire block; `workspace` is dead
    - **Dep B (line ~98):** `workspacePath: workspace.workspace_path` passed to `aiProvider.executePrompt(...)` — replace with `workspacePath: ''` (or remove the field entirely if `executePrompt` accepts it as optional after Task 9 below)
  - [ ] 7.2 Remove the `if (!workspace) { throw new Error(...) }` guard that follows the findUnique — it refs the removed model
  - [ ] 7.3 Verify the method still compiles and the risk assessment logic is intact (the prompt building and AI call are not workspace-dependent)

- [ ] Task 8: Fix `src/ai-routing/dto/ai-execution.dto.ts` (AC: 3, 6)
  - [ ] 8.1 Line ~82: remove the `@ApiProperty({ description: 'Workspace path (for debugging)' })` decorator and the `workspacePath?` field — this is DooD-era DTO surface
  - [ ] 8.2 Line ~98: `WorkspaceStatusDto` — this DTO represents the old Workspace model as an API response. Remove the entire class (it has no consumers outside this file — confirmed by grep)
  - [ ] 8.3 Run `grep -rn "WorkspaceStatusDto\|workspacePath" src/ --include="*.ts"` to confirm zero remaining references

- [ ] Task 9: Make `workspacePath` optional in `src/ai-routing/interfaces/ai-provider.interface.ts` (AC: 3)
  - [ ] 9.1 Line ~71: Change `workspacePath: string` to `workspacePath?: string` in `IAIExecutionResult` — agentic providers (WR-2) do not use local file paths; making this optional is backward-compatible and removes the forced coupling
  - [ ] 9.2 Check all places that destructure or access `result.workspacePath` — they will still compile (optional field), but verify no logic crashes on `undefined`

- [ ] Task 10: Fix workspace-dependent call sites in `src/qa-automation/qa-orchestrator.service.ts` (AC: 3, 4, 5)
  - [ ] 10.1 Locate the 4 `this.prisma.workspace.findUnique(...)` call sites (approx lines 992, 1057, 1124, 1188)
  - [ ] 10.2 For each: replace the `findUnique` + the `workspace.workspace_path` usage that follows with `throw new Error('DooD execution path removed — workspace table dropped in WR-1.1. This code path is deleted in WR-1.2.')`
  - [ ] 10.3 This stubs the DooD branch so the app compiles and starts without crashing, while making the intent clear. WR-1.2 will delete these entire methods.

- [ ] Task 11: Run full verification suite (AC: 4, 5, 6)
  - [ ] 11.1 `grep -r "workspace_path" src/` → must return zero matches
  - [ ] 11.2 `grep -rn "prisma\.workspace\b" src/` → must return zero matches (catches all Prisma model access)
  - [ ] 11.3 `grep -r "WorkspaceArchive\|WorkspaceStatus\|WorkspaceArchiveModel\|WorkspaceModel" src/ --include="*.ts"` → must return zero matches
  - [ ] 11.4 `grep -rn "preserveWorkspace" src/` → must return zero matches
  - [ ] 11.5 `pnpm build` → zero TypeScript compilation errors
  - [ ] 11.6 `npx prisma validate` → schema is valid

- [ ] Task 12: Verify tests pass (AC: all)
  - [ ] 12.1 Run `grep -r "WorkspaceModel\|WorkspaceArchive\|WorkspaceStatus\|workspace_path\|prisma\.workspace" src/ --include="*.spec.ts"` — update or delete any spec files that import or mock these removed types
  - [ ] 12.2 `pnpm test` — all existing tests green, zero regressions
  - [ ] 12.3 The migration SQL cannot be unit-tested easily — add a comment-only spec note in a `migrations.spec.ts` documenting that the `drop_workspace_tables` migration file contains the row-count safety gate, for future auditability

## Dev Notes

### Overview

This story drops the `Workspace` + `WorkspaceArchive` Prisma models and `WorkspaceStatus` enum — they are dead DooD-era schema. All executions now flow through OpenSandbox (`SandboxService.runAgentCommand()`); no workspace directory is created on the backend file system. The full delivery loop (clone → implement → QA → commit → push → PR) happens entirely inside the sandbox container (implemented in Epic WR-2).

### NFR-WR1: Fail-Fast Data Safety Gate (CRITICAL)

The migration **must not silently drop data**. Exact PL/pgSQL to use:

```sql
-- Safety gate: abort if any workspace rows exist
DO $$
DECLARE
  workspace_count INTEGER;
  archive_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO workspace_count FROM workspaces;
  SELECT COUNT(*) INTO archive_count FROM workspace_archives;
  IF workspace_count > 0 OR archive_count > 0 THEN
    RAISE EXCEPTION
      'drop_workspace_tables aborted: % workspace row(s) and % archive row(s) still exist. '
      'Drain all active executions before applying this migration.',
      workspace_count, archive_count;
  END IF;
END $$;

-- Drop archives first (FK dependency order)
DROP TABLE IF EXISTS workspace_archives CASCADE;
DROP TABLE IF EXISTS workspaces CASCADE;
DROP TYPE IF EXISTS "WorkspaceStatus";
```

> **Drop order matters:** `workspace_archives` before `workspaces` ensures no FK constraint violations. `CASCADE` handles any remaining referential edges.

### Complete File Impact Map

From the full codebase scan (2026-03-31), every non-spec file requiring a change:

| File                                                        | Location                                                  | Action                                                                                                                                                           |
| ----------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                      | L407–422, L520–534, L1218–1225                            | Remove `model Workspace`, `model WorkspaceArchive`, `enum WorkspaceStatus`, and the `archive WorkspaceArchive?` relation                                         |
| `src/prisma/client.ts`                                      | L26, L79, L85                                             | Remove `Workspace`/`WorkspaceArchive` imports and `WorkspaceModel`/`WorkspaceArchiveModel` type aliases                                                          |
| `src/prisma/enums.ts`                                       | L18                                                       | Remove `WorkspaceStatus` re-export                                                                                                                               |
| `src/storage/storage-manager.service.ts`                    | L110–165                                                  | Stub `archiveWorkspace()` to throw; **keep `getDiskUsage()` unchanged** — `GitMirrorService` depends on it                                                       |
| `src/cleanup/listeners/execution-cleanup.listener.ts`       | L29–35                                                    | Remove stale DooD comments + `preserveWorkspace: true` from the `cleanupAfterExecution()` call                                                                   |
| `src/cleanup/interfaces/cleanup-options.interface.ts`       | L7                                                        | Remove `preserveWorkspace?: boolean` field                                                                                                                       |
| `src/cleanup/cleanup.service.ts`                            | L104–148                                                  | Verify `cleanupWorkspaceFolder` is already a no-op (it was delegated to OpenSandbox TTL) — if so, leave the no-op stub; just ensure no `prisma.workspace` access |
| `src/github/services/pr-risk-assessor.service.ts`           | L67–75 (findUnique), L98 (workspacePath arg)              | Remove `prisma.workspace.findUnique` call + guard + `workspacePath` arg from `executePrompt`                                                                     |
| `src/ai-routing/dto/ai-execution.dto.ts`                    | L82 (workspacePath field), L98–120 (`WorkspaceStatusDto`) | Remove `workspacePath` DTO field; remove `WorkspaceStatusDto` class                                                                                              |
| `src/ai-routing/interfaces/ai-provider.interface.ts`        | L71                                                       | Change `workspacePath: string` → `workspacePath?: string` in `IAIExecutionResult`                                                                                |
| `src/ai-routing/orchestrator.service.ts`                    | L412–416                                                  | The `/tmp/ai-task-workspace` fallback still compiles once `workspacePath` is optional — leave as-is for now (WR-2 will refactor provider execution path)         |
| `src/qa-automation/qa-orchestrator.service.ts`              | L992, L1057, L1124, L1188                                 | Stub each `prisma.workspace.findUnique` block to throw (WR-1.2 deletes surrounding methods)                                                                      |
| `src/github/github.module.ts`                               | L7, L9, L68, L70, L106                                    | **Do not touch** — `GitHubCommitOrchestrator` + `GitHubPushTriggerConsumer` registrations deleted in WR-1.2                                                      |
| `src/github/services/github-commit-orchestrator.service.ts` | all                                                       | **Do not touch** — entire file deleted in WR-1.2                                                                                                                 |
| `src/github/services/github-push-trigger.consumer.ts`       | all                                                       | **Do not touch** — entire file deleted in WR-1.2                                                                                                                 |
| `src/ai-routing/providers/anthropic-tools.ts`               | L121                                                      | Comment only — safe to update the JSDoc to remove `GitHubCommitOrchestrator` mention                                                                             |

### StorageManagerService: What to Keep vs. Stub

`StorageManagerService` has two distinct method groups with different fates:

| Method                                    | Uses Workspace Prisma?                                                    | Action                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `getDiskUsage()`                          | ❌ No — uses `fs.statfs()`                                                | **Keep unchanged** — `GitMirrorService` calls this for LRU eviction |
| `archiveWorkspace(executionId)`           | ✅ Yes — `prisma.workspace.findUnique` + `prisma.workspaceArchive.upsert` | Stub to `throw new Error(...)`                                      |
| Any other methods with `prisma.workspace` | ✅ Yes                                                                    | Stub to throw                                                       |

> **Never delete the StorageModule** — `GitMirrorModule` imports it. Deleting `StorageManagerService` or `StorageModule` will break the build.

### Coordination With WR-1.2

WR-1.1 and WR-1.2 (Delete DooD Pipeline) are sequential. The safe split:

- **WR-1.1 scope** = remove the Prisma schema + null-out all `prisma.workspace`/`prisma.workspaceArchive` read/write call sites (stub to throw)
- **WR-1.2 scope** = delete the service/consumer class files themselves (`github-commit-orchestrator.service.ts`, `github-push-trigger.consumer.ts`) and the workspace-dependent branches in `QaOrchestratorService`

This means some methods will temporarily throw an error at runtime — that is correct and intentional. The app should still **start** and **compile** cleanly after WR-1.1.

### Prisma Migration Conventions

- Create with: `npx prisma migrate dev --name drop_workspace_tables --create-only` → edit the SQL → apply with `npx prisma migrate dev`
- Run `npx prisma generate` immediately after schema.prisma changes, before attempting `pnpm build`
- Never bypass with raw SQL outside a migration file

### Project Structure Notes

- `prisma/schema.prisma` — single unified schema file (not sharded)
- `prisma/migrations/` — timestamp-named dirs, e.g. `20260326165521_retire_cursor_headless_provider/migration.sql`
- `src/prisma/client.ts` — barrel re-exporting Prisma generated types + custom type aliases
- `src/prisma/enums.ts` — barrel re-exporting Prisma enums
- Test files: `src/**/__tests__/*.spec.ts` or co-located `*.spec.ts`

### References

- [Source: _bmad-output/planning-artifacts/epics-workspace-removal.md#Story-WR-1.1] — ACs and FR-WR1 + NFR-WR1 specs
- [Source: prisma/schema.prisma#L407-422] — `model Workspace` (12 fields incl. `workspace_path`)
- [Source: prisma/schema.prisma#L520-534] — `model WorkspaceArchive` (10 fields incl. `workspace_path`)
- [Source: prisma/schema.prisma#L1218-1225] — `enum WorkspaceStatus` (CREATING, READY, IN_USE, FAILED, CLEANING, CLEANED)
- [Source: src/storage/storage-manager.service.ts#L87] — `getDiskUsage()` uses `fs.statfs()` only — **keep live**
- [Source: src/storage/storage-manager.service.ts#L110-165] — `archiveWorkspace()` — stub to throw
- [Source: src/git-mirror/git-mirror.service.ts#L524] — `storageManager.getDiskUsage()` call in `evictOldestMirrorsIfNeeded()` — live dependency
- [Source: src/github/services/pr-risk-assessor.service.ts#L67-75] — `prisma.workspace.findUnique` call (must be removed, not just the workspacePath arg)
- [Source: src/ai-routing/interfaces/ai-provider.interface.ts#L71] — `workspacePath: string` in `IAIExecutionResult` (must become optional)
- [Source: src/cleanup/interfaces/cleanup-options.interface.ts#L7] — `preserveWorkspace?: boolean` (remove entire field)
- [Source: src/qa-automation/qa-orchestrator.service.ts#L992,L1057,L1124,L1188] — 4 `prisma.workspace.findUnique` call sites (stub each)
- [Source: docs/AI-CONTEXT.md#Section-3] — Architecture conventions: Prisma patterns, NestJS DI rules, no breaking API changes

## Review Findings

Code review conducted 2026-04-01. 0 decision-needed, 7 patch, 0 defer, 12 dismissed.

- [x] [Review][Patch] WR-1.2 scope files deleted in WR-1.1 — DISMISSED: `wr-1-2` is already `done` in sprint-status; deletions were intentional (WR-1.1 + WR-1.2 implemented together)
- [x] [Review][Patch] QA methods deleted instead of stubbed — restored `runLintingCheck`, `runTestingCheck`, `runCoverageCheck`, `runSecurityCheck` as decommission stubs [`src/qa-automation/qa-orchestrator.service.ts`]
- [x] [Review][Patch] `startCleanupScheduler()` calls decommissioned `performCleanup()` nightly — commented out `startCleanupScheduler()` in `onModuleInit()` [`src/storage/storage-manager.service.ts`]
- [x] [Review][Patch] Migration safety gate not idempotent — added `pg_tables` existence check before `COUNT(*)` queries [`prisma/migrations/20260331190104_drop_workspace_tables/migration.sql`]
- [x] [Review][Patch] `ArchiveStatus` enum orphaned — added `DROP TYPE IF EXISTS "ArchiveStatus"` to migration; removed from `prisma/schema.prisma`, `src/prisma/enums.ts`, and dead import in `storage-manager.service.spec.ts`
- [x] [Review][Patch] `migrations.spec.ts` missing — created `prisma/migrations/migrations.spec.ts` with safety gate audit note (Task 12.3)
- [x] [Review][Patch] Stale JSDoc referencing deleted `GitHubCommitOrchestrator` — updated `anthropic-tools.ts` and `github-error-monitor.service.ts` [`src/ai-routing/providers/anthropic-tools.ts`, `src/github/services/github-error-monitor.service.ts`]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 (Thinking) — story created 2026-03-31, validated and improved 2026-03-31

### Debug Log References

### Completion Notes List

### File List
