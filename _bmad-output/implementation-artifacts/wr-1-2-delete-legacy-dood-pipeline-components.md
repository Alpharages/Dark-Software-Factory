# Story WR-1.2: Delete Legacy DooD Pipeline Components

Status: done

## Story

As a **platform engineer**,
I want `QaOrchestratorService`'s workspace-dependent execution path, `GitHubPushTriggerConsumer`, and `GitHubCommitOrchestrator` deleted in their entirety,
So that no legacy DooD code path remains that could produce silent failures or require maintenance.

## Acceptance Criteria

**AC-1: QaOrchestratorService — workspace-dependent private methods removed**
**Given** `QaOrchestratorService` contains four private workspace-dependent methods (`runLintingCheck`, `runTestingCheck`, `runCoverageCheck`, `runSecurityCheck`) at lines ~985–1233 that each call `this.prisma.workspace.findUnique(...)`
**When** these four private methods are deleted
**Then** no `prisma.workspace` call, no `workspace.workspace_path` reference, and no `IQaQueueMessage`-specific workspace look-up exists anywhere in `QaOrchestratorService`
**And** the commented-out `Promise.allSettled([])` block in `runQaChecks()` (lines ~110–115) that referenced these methods remains correctly commented out — do not uncomment it

**AC-2: QaOrchestratorService — `runQaChecks()` auto-approve publish removed**
**Given** `runQaChecks()` inside `QaOrchestratorService` contains two `this.rabbitPublisher.publishToExchange(ROUTING_KEYS.GITHUB_PUSH_TRIGGER, ...)` calls at lines ~213–222 and ~431–440 (auto-approve path)
**When** these publish calls are removed
**Then** `ROUTING_KEYS.GITHUB_PUSH_TRIGGER` is no longer referenced anywhere in `QaOrchestratorService`
**And** the log messages referencing "GitHub push triggered directly" are also removed
**And** the `GITHUB_PUSH` ticket status transitions that accompany those publish calls are removed
**And** the remaining `AWAITING_APPROVAL` logic (for the non-auto-approve path) continues to work unchanged

**AC-3: `GitHubPushTriggerConsumer` file deleted**
**Given** `src/github/services/github-push-trigger.consumer.ts` exists as a RabbitMQ consumer
**When** it is deleted
**Then** the file is removed from the filesystem
**And** its import and `providers: [GitHubPushTriggerConsumer]` entry are removed from `src/github/github.module.ts` (line 9, line 70)
**And** `grep -r "GitHubPushTriggerConsumer" src/` returns zero matches

**AC-4: `GitHubCommitOrchestrator` file deleted**
**Given** `src/github/services/github-commit-orchestrator.service.ts` (494 lines) and `src/github/services/github-commit-orchestrator.service.spec.ts` exist
**When** both files are deleted
**Then** the import (line 7), the `providers: [GitHubCommitOrchestrator]` entry (line 68), and the `exports: [GitHubCommitOrchestrator]` entry (line 106) are removed from `src/github/github.module.ts`
**And** `grep -r "GitHubCommitOrchestrator" src/` returns zero matches

**AC-5: Cleanup listener — stale comments and `preserveWorkspace` removed**
**Given** `src/cleanup/listeners/execution-cleanup.listener.ts` contains stale DooD-era comments referencing `GitHubCommitOrchestrator` and `GitHubPushTriggerConsumer` (lines 29–32) and still passes `preserveWorkspace: true` (line 38)
**When** these stale artifacts are removed
**Then** the four stale comment lines (the `// CRITICAL FIX:` block) are deleted
**And** the `cleanupAfterExecution()` call no longer passes `preserveWorkspace: true`
**And** the log message "workspace preserved for GitHub push" is updated to "execution cleanup completed"

**AC-6: `anthropic-tools.ts` — JSDoc comment updated**
**Given** `src/ai-routing/providers/anthropic-tools.ts` line 121 contains the comment `* Used by GitHubCommitOrchestrator for AI-powered commit messages`
**When** this JSDoc is updated
**Then** the `GitHubCommitOrchestrator` mention in the comment is removed (replace with a neutral description e.g., `* Generates AI-powered commit messages`)

**AC-7: Full build clean after deletions**
**Given** all three components and their stale references have been deleted
**When** `pnpm build` runs
**Then** zero TypeScript compilation errors exist — no dangling imports, no missing providers, no type mismatches

**AC-8: Zero grep matches for deleted symbols**
**When** `grep -r "GitHubPushTriggerConsumer\|GitHubCommitOrchestrator" src/` is run
**Then** it returns zero matches (no imports, no type references, no injections, no spec imports)

**AC-9: No breaking API changes**
**Given** any existing `/api/v1/executions/*` endpoints existed before this story
**When** these deletions are applied
**Then** those REST API endpoints remain unchanged in signature, response shape, and status codes (NFR-WR8)
**And** the approval service's `approve()` method continues to publish to `ROUTING_KEYS.GITHUB_PUSH_TRIGGER` — this publish now simply has no consumer registered (intentional; WR-2 will route this differently)

**AC-10: Application starts clean**
**Given** all deletions are applied and `pnpm build` succeeds
**When** `pnpm start:dev` runs
**Then** the application starts without any module-resolution errors related to the deleted services
**And** NestJS DI container resolves without circular-dependency or missing-provider errors in `GitHubModule` or `QaAutomationModule`

---

## Tasks / Subtasks

- [ ] Task 1: Delete `GitHubPushTriggerConsumer` class and file (AC: 3, 7, 8)
  - [ ] 1.1 Delete `src/github/services/github-push-trigger.consumer.ts`
  - [ ] 1.2 In `src/github/github.module.ts`:
    - Remove `import { GitHubPushTriggerConsumer } from './services/github-push-trigger.consumer';` (line 9)
    - Remove `GitHubPushTriggerConsumer,` from the `providers: []` array (line 70)
    - **Note:** `GitHubPushTriggerConsumer` was NOT in `exports: []` — no export to remove
  - [ ] 1.3 Run `grep -r "GitHubPushTriggerConsumer" src/` — must return zero matches

- [ ] Task 2: Delete `GitHubCommitOrchestrator` class, file, and spec (AC: 4, 7, 8)
  - [ ] 2.1 Delete `src/github/services/github-commit-orchestrator.service.ts`
  - [ ] 2.2 Delete `src/github/services/github-commit-orchestrator.service.spec.ts`
  - [ ] 2.3 In `src/github/github.module.ts`:
    - Remove `import { GitHubCommitOrchestrator } from './services/github-commit-orchestrator.service';` (line 7)
    - Remove `GitHubCommitOrchestrator,` from `providers: []` array (line 68)
    - Remove `GitHubCommitOrchestrator,` from `exports: []` array (line 106)
  - [ ] 2.4 Run `grep -r "GitHubCommitOrchestrator" src/` — must return zero matches

- [ ] Task 3: Remove workspace-dependent private methods from `QaOrchestratorService` (AC: 1, 7, 8)
  - [ ] 3.1 In `src/qa-automation/qa-orchestrator.service.ts`, delete the entire body of the four private methods:
    - `runLintingCheck()` — lines ~985–1043 (entire method including JSDoc)
    - `runTestingCheck()` — lines ~1050–1110 (entire method including JSDoc)
    - `runCoverageCheck()` — lines ~1117–1174 (entire method including JSDoc)
    - `runSecurityCheck()` — lines ~1181–1233 (entire method including JSDoc)
  - [ ] 3.2 These four methods are currently dead code — they are wrapped in the commented-out `checkResults` block (lines ~110–115). Deleting the method definitions does NOT require uncommenting that block.
  - [ ] 3.3 Run `grep -n "prisma\.workspace" src/qa-automation/qa-orchestrator.service.ts` — must return zero matches
  - [ ] 3.4 The `IQaQueueMessage` import and `IQaQueueResult` types may still be needed by `runQaChecks()` — **do not remove them** unless TypeScript compilation confirms they are unused

- [ ] Task 4: Remove `GITHUB_PUSH_TRIGGER` publish calls from `QaOrchestratorService` (AC: 2, 7)
  - [ ] 4.1 In `runQaChecks()` method (the Story 3.7 version), locate and remove the auto-approve branch `if (autoApprove) { ... }` block at lines ~180–226 (the one that publishes to `ROUTING_KEYS.GITHUB_PUSH_TRIGGER` and updates ticket to `GITHUB_PUSH`)
  - [ ] 4.2 Similarly remove the auto-approve branch `if (autoApprove) { ... }` block in `processQaCheck()` at lines ~424–444 (it also publishes `ROUTING_KEYS.GITHUB_PUSH_TRIGGER` and sets `GITHUB_PUSH` status)
  - [ ] 4.3 **Keep** the `else` branch (the `AWAITING_APPROVAL` path) in both methods — it is the correct non-DooD behavior
  - [ ] 4.4 **Keep** `approval.service.ts` untouched — it still publishes `GITHUB_PUSH_TRIGGER` for PM approval flow (this is expected to have no consumer for now; WR-2 will handle it)
  - [ ] 4.5 After removal, clean up any imports from `qa-orchestrator.service.ts` that are no longer needed (e.g., `TicketStatus.GITHUB_PUSH` if it's no longer referenced — check before removing)
  - [ ] 4.6 Run `grep -n "GITHUB_PUSH_TRIGGER" src/qa-automation/qa-orchestrator.service.ts` — must return zero matches

- [ ] Task 5: Fix `src/cleanup/listeners/execution-cleanup.listener.ts` (AC: 5, 7)
  - [ ] 5.1 Delete the four stale comment lines (the entire `// CRITICAL FIX: When execution...` block at lines ~28–33 in the source)
  - [ ] 5.2 Remove `preserveWorkspace: true,` from the options object passed to `cleanupAfterExecution()` — the call should become:
    ```typescript
    await this.cleanupService.cleanupAfterExecution(event.executionId, {
      forceContainerRemove: false,
    });
    ```
  - [ ] 5.3 Update the success log message from `"workspace preserved for GitHub push"` to `"execution cleanup completed"`
  - [ ] 5.4 **Note:** `preserveWorkspace` field itself was already removed from `CleanupOptions` interface in WR-1.1 (Task 6) — if WR-1.1 has been applied, this call will already be failing TS compilation; this task fixes it

- [ ] Task 6: Update `src/ai-routing/providers/anthropic-tools.ts` JSDoc (AC: 6)
  - [ ] 6.1 Find line ~121: `* Used by GitHubCommitOrchestrator for AI-powered commit messages`
  - [ ] 6.2 Replace with: `* Generates AI-powered commit messages for code changes`

- [ ] Task 7: Run full verification suite (AC: 7, 8, 10)
  - [ ] 7.1 `grep -r "GitHubPushTriggerConsumer\|GitHubCommitOrchestrator" src/` → must return zero matches
  - [ ] 7.2 `grep -n "prisma\.workspace" src/qa-automation/qa-orchestrator.service.ts` → must return zero matches
  - [ ] 7.3 `grep -n "GITHUB_PUSH_TRIGGER" src/qa-automation/qa-orchestrator.service.ts` → must return zero matches
  - [ ] 7.4 `pnpm build` → zero TypeScript compilation errors
  - [ ] 7.5 Verify `src/github/github.module.ts`:
    - No import of `GitHubCommitOrchestrator` or `GitHubPushTriggerConsumer`
    - These classes removed from `providers` and `exports`

- [ ] Task 8: Verify tests (AC: 7, 10)
  - [ ] 8.1 Run `pnpm test -- --testPathPattern="qa-orchestrator|qa-check|github"` to confirm no regressions
  - [ ] 8.2 Confirm `github-commit-orchestrator.service.spec.ts` is deleted and no longer discovered by Jest
  - [ ] 8.3 Run `grep -n "workspace\|GitHubPushTrigger\|GitHubCommitOrchestrat" src/qa-automation/qa-orchestrator.service.spec.ts` — update any spec assertions that mocked `this.prisma.workspace` or the old auto-approve publish path if they exist (see Dev Notes: these mocks exist in the spec at lines ~166 and ~290 as `workspacePath: '/tmp/workspace'` in `IQaQueueMessage` payloads — these are message payload fields, NOT Prisma mocks, safe to leave as-is if `processQaCheck()` still accepts `workspacePath` in its input message interface)

---

## Dev Notes

### Coordination With WR-1.1

WR-1.1 stubbed the Prisma workspace call sites to `throw new Error('DooD...')`. WR-1.2 deletes the entire method bodies and files. **The recommended sequencing is WR-1.1 first, then WR-1.2.** However, if WR-1.1 is still in progress:

- Task 1 and Task 2 (file deletions) are safe to do independently — they have no dependency on WR-1.1's Prisma stubs
- Task 3 (removing private methods in QaOrchestratorService) overlaps with WR-1.1 Task 10's stub approach — if WR-1.1 stubs are already in place, Task 3 in this story simply replaces those stubs by deleting the methods entirely

### Complete File Impact Map

Every non-spec file that requires a change in this story:

| File                                                             | Change                                                                                         | AC         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------- |
| `src/github/services/github-push-trigger.consumer.ts`            | **DELETE entire file**                                                                         | AC-3       |
| `src/github/services/github-commit-orchestrator.service.ts`      | **DELETE entire file**                                                                         | AC-4       |
| `src/github/services/github-commit-orchestrator.service.spec.ts` | **DELETE entire file**                                                                         | AC-4       |
| `src/github/github.module.ts`                                    | Remove 3 lines (import L7, provider L68, export L106) and 1 line (import L9, provider L70)     | AC-3, AC-4 |
| `src/qa-automation/qa-orchestrator.service.ts`                   | Delete 4 private methods (~L985–1233) + remove 2 auto-approve if-blocks (~L180–226, ~L424–444) | AC-1, AC-2 |
| `src/cleanup/listeners/execution-cleanup.listener.ts`            | Remove stale comments + `preserveWorkspace: true` + update log message                         | AC-5       |
| `src/ai-routing/providers/anthropic-tools.ts`                    | Update JSDoc comment line ~121                                                                 | AC-6       |

**Files intentionally LEFT UNCHANGED (despite referencing the topic):**
| File | Reason |
|------|--------|
| `src/rabbitmq/rabbitmq.config.ts` | `GITHUB_PUSH_TRIGGER` routing key remains — still used by `approval.service.ts` |
| `src/execution/services/approval.service.ts` | PM approval flow still publishes `GITHUB_PUSH_TRIGGER`; WR-2 will add a new consumer |
| `src/qa-automation/qa-orchestrator.service.ts` (public `processQaCheck()` method) | This entire method stays — it handles the `IQaCheckMessage` format used by `QaOrchestratorConsumer` |
| `src/qa-automation/qa-automation.module.ts` | No changes needed — `GitHubCommitOrchestrator` and `GitHubPushTriggerConsumer` were never imported here |

### `github.module.ts` After Surgery

After Tasks 1 and 2, the module file should look like (relevant sections only):

```typescript
// REMOVED: import { GitHubCommitOrchestrator } ...
import { GitHubPROrchestrator } from './services/github-pr-orchestrator.service';
// REMOVED: import { GitHubPushTriggerConsumer } ...

providers: [
  GitHubService,
  GitHubAuthFlowService,
  GitHubAuthService,
  GitHubClientService,
  GitHubBranchService,
  // GitHubCommitOrchestrator — DELETED
  GitHubPROrchestrator,
  // GitHubPushTriggerConsumer — DELETED
  DeploymentOrchestrator,
  // ... rest unchanged
],
exports: [
  GitHubService,
  GitHubAuthService,
  GitHubClientService,
  GitHubBranchService,
  // GitHubCommitOrchestrator — DELETED
  GitHubPROrchestrator,
  // ... rest unchanged
],
```

### `QaOrchestratorService` Auto-Approve Removal Explained

The `runQaChecks()` method (lines ~96–330) has two branches after QA passes:

1. `if (autoApprove) { ... }` — publishes `GITHUB_PUSH_TRIGGER`, sets ticket to `GITHUB_PUSH` — **DELETE THIS BRANCH**
2. `else { ... }` — moves ticket to `AWAITING_APPROVAL`, calls `executionTracker.markAwaitingApproval()` — **KEEP THIS**

Same pattern in `processQaCheck()` (lines ~336–644):

1. `if (autoApprove) { ... }` — publishes `GITHUB_PUSH_TRIGGER`, sets ticket to `GITHUB_PUSH` — **DELETE THIS BRANCH**
2. `else { ... }` — moves ticket to `AWAITING_APPROVAL`, calls `executionTracker.markAwaitingApproval()` — **KEEP THIS**

**After deleting the auto-approve branches**, the `configService.get('features.autoApproveAfterQa', false)` read and the local `autoApprove` variable can also be removed since they're no longer consumed.

> **Important:** `TicketStatus.GITHUB_PUSH` may still be imported for use elsewhere in the file — do NOT remove the import blindly. Run `grep -n "GITHUB_PUSH" src/qa-automation/qa-orchestrator.service.ts` after edits to confirm whether the import should stay.

### The `ROUTING_KEYS.GITHUB_PUSH_TRIGGER` Survivor

After WR-1.2, **one publisher remains** (`approval.service.ts` line 61) and **zero consumers** for `GITHUB_PUSH_TRIGGER`. This is intentional — WR-2 will wire a new agentic execution path triggered from the approval flow. The routing key definition in `rabbitmq.config.ts` stays.

### `processQaCheck()` vs `runQaChecks()` — Two Different Entry Points

`QaOrchestratorService` has **two separate top-level methods** both containing `GITHUB_PUSH_TRIGGER` publish calls:

- `runQaChecks()` — Story 3.7 version using `IQaQueueMessage`; called by `QaCheckConsumer`
- `processQaCheck()` — Story 3.1/older version using `IQaCheckMessage`; called by `QaOrchestratorConsumer`

Both must have their auto-approve publish blocks removed (Tasks 4.1 and 4.2 respectively).

### `workspacePath` in Spec Files Explained

The grep in Task 8.3 will find `workspacePath: '/tmp/workspace'` in spec fixtures — these are **test message payloads** for `IQaCheckMessage`, NOT Prisma mock references. The `workspacePath` field will still exist on the `IQaCheckMessage` interface (it's used by the public methods that remain). These spec fixtures are safe to leave as-is.

### `GitHubPushTriggerConsumer` — No Export to Remove

`GitHubPushTriggerConsumer` was declared in `providers: []` only — it was **not** in `exports: []`. Only `GitHubCommitOrchestrator` needs to be removed from both `providers` and `exports`.

### Project Structure Notes

- NestJS module convention: providers are lifecycle-managed by the DI container; removing a provider that's not injected elsewhere requires no downstream changes
- `GitHubPROrchestrator` (NOT deleted) remains in `providers` and `exports` — it is used by `DeploymentOrchestrator` and the approval flow
- Test file naming: co-located `*.spec.ts` next to source file; Jest discovers them automatically via `testMatch` glob

### References

- [Source: epics-workspace-removal.md#Story-WR-1.2] — FR-WR2, NFR-WR8 specs
- [Source: src/github/github.module.ts] — current provider/export registrations (L7, L9, L68, L70, L106)
- [Source: src/github/services/github-commit-orchestrator.service.ts] — 494-line file to delete
- [Source: src/github/services/github-push-trigger.consumer.ts] — 270-line file to delete
- [Source: src/qa-automation/qa-orchestrator.service.ts#L992,L1057,L1124,L1188] — 4 workspace.findUnique call sites in private methods (WR-1.1 stubbed; WR-1.2 deletes the methods)
- [Source: src/qa-automation/qa-orchestrator.service.ts#L213-222, L431-440] — auto-approve GITHUB_PUSH_TRIGGER publishes to remove
- [Source: src/cleanup/listeners/execution-cleanup.listener.ts#L28-33. L38] — stale comments + preserveWorkspace to strip
- [Source: src/ai-routing/providers/anthropic-tools.ts#L121] — JSDoc comment update
- [Source: src/execution/services/approval.service.ts#L61] — intentionally retained GITHUB_PUSH_TRIGGER publisher
- [Source: docs/AI-CONTEXT.md] — Architecture conventions: NestJS module patterns, no breaking API changes

---

### Review Findings

_Code review performed 2026-04-01 by bmad-code-review workflow. Edge Case Hunter layer failed (rejected by user); findings from Blind Hunter + Acceptance Auditor only._

- [x] [Review][Patch] AC-2 VIOLATION: Two `if (autoApprove)` blocks still publish `ROUTING_KEYS.GITHUB_PUSH_TRIGGER` and set `TicketStatus.GITHUB_PUSH` in `QaOrchestratorService` — neither was removed in this diff. [`src/qa-automation/qa-orchestrator.service.ts:169` and `:413`] — **fixed 2026-04-01**
- [x] [Review][Patch] AC-1 VIOLATION: Four private methods (`runLintingCheck`, `runTestingCheck`, `runCoverageCheck`, `runSecurityCheck`) are stubbed with `throw new Error(...)` instead of being fully deleted. Method shells still occupy the file. [`src/qa-automation/qa-orchestrator.service.ts:963–1010`] — **fixed 2026-04-01**
- [x] [Review][Patch] AC-5 log message deviation: message reads `"Container cleaned up for execution ${executionId}"` but spec requires `"execution cleanup completed"`. [`src/cleanup/listeners/execution-cleanup.listener.ts`] — **fixed 2026-04-01**
- [x] [Review][Patch] AC-6 JSDoc deviation: comment reads `* Used for AI-powered commit message generation.\n* Note: GitHubCommitOrchestrator deleted in WR-1.2.` — spec requires `* Generates AI-powered commit messages for code changes` (no class name re-introduced). [`src/ai-routing/providers/anthropic-tools.ts:121`] — **fixed 2026-04-01**
- [x] [Review][Defer] `--dangerously-skip-permissions` flag + unpinned `npm install -g @anthropic-ai/claude-code` in ClaudeCodeProvider command — pre-existing OS-2 scope change, out of WR-1.2 boundary. [`src/ai-routing/providers/claude-code.provider.spec.ts`] — deferred, pre-existing
- [x] [Review][Defer] `ANTHROPIC_AUTH_TOKEN` renamed to `ANTHROPIC_API_KEY` in claude-code provider spec — OS-2 scope, deployment envs must be updated. — deferred, pre-existing
- [x] [Review][Defer] `pr-risk-assessor.service.ts` workspace lookup removed; `executePrompt` now called without `workspacePath` — may produce hollow AI output if provider still reads workspace files. WR-1.1 scope. [`src/github/services/pr-risk-assessor.service.ts:87`] — deferred, pre-existing
- [x] [Review][Defer] `workspacePath` made optional in `IAIExecutionResult` and removed from `IAIPromptExecutionInput` — callers may receive `undefined` silently; WR-1.1 scope, build+tests should verify. — deferred, pre-existing
- [x] [Review][Defer] RabbitMQ `github-push-trigger-queue` binding persists in broker with no registered consumer — intentional (WR-2 will add new consumer); messages will queue until WR-2 lands. — deferred, pre-existing
- [x] [Review][Defer] `WorkspaceModel`/`WorkspaceArchiveModel` type exports removed from `src/prisma/client.ts` without grep confirmation of zero usages — WR-1.1 scope; build will catch any remaining callers. — deferred, pre-existing

---

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 (Thinking) — story created 2026-03-31

### Debug Log References

### Completion Notes List

### File List
