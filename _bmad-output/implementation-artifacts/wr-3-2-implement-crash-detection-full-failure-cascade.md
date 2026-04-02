# Story WR-3.2: Implement Crash Detection & Full Failure Cascade

Status: ready-for-dev

## Story

As a **PM watching an execution**,
I want the system to detect when the sandbox container terminates without completing (crash, timeout, rate-limit, unreachable repo) and immediately surface a specific failure reason,
So that I see "Failed — agent did not complete. Reason: [specific message]" instead of the execution freezing indefinitely at whatever progress it last reached.

## Acceptance Criteria

**AC-1: Crash → FAILED state with specific error reason (FR-WR14)**
**Given** a sandbox container exits without emitting a final `{"type":"result",...}` line
**When** the crash is detected (container exit, TTL timeout via `OPENSANDBOX_SANDBOX_TIMEOUT_S`, or unrecovered error)
**Then** the execution state is set to `FAILED` with the specific error reason recorded in the database

**AC-2: Real-time UI event with failure reason (FR-WR14)**
**Given** the execution has been marked `FAILED`
**When** the failure cascade runs
**Then** a WebSocket event is emitted via `ExecutionGateway` so the execution card displays: "Failed — agent did not complete. Reason: [error message]"

**AC-3: ClickUp comment posted on crash (FR-WR14)**
**Given** the execution has been marked `FAILED`
**When** the failure cascade completes
**Then** a ClickUp comment is posted on the ticket: `"⚠️ **Execution Failed — No Code Pushed**\n\nThe agent did not complete. Reason: [error message]\n\nNo branch was created and no code was pushed."`

**AC-4: ClickUp ticket reverted to pre-trigger status (FR-WR14)**
**Given** the execution has been marked `FAILED`
**When** the failure cascade completes
**Then** the ClickUp ticket is moved back to the project's `ai_trigger_status` (the status that originally triggered the execution), NOT the generic FAILED phase status

**AC-5: Timeout uses existing TTL (NFR-WR2)**
**Given** the sandbox timed out via `OPENSANDBOX_SANDBOX_TIMEOUT_S`
**When** the timeout fires
**Then** the same crash cascade (AC-1 through AC-4) is triggered — no additional timeout layer is added

**AC-6: No branch cleanup on crash (FR-WR14)**
**Given** the sandbox crashed mid-implementation with no code pushed
**When** the failure cascade completes
**Then** no branch cleanup is attempted

**AC-7: Specific error type classification**
**Given** a crash whose stdout/stderr contains a known error pattern
**When** it matches: ANTHROPIC_API_KEY rate limit, repository URL unreachable, or container OOM
**Then** the specific error type label is included in both the ClickUp comment and the error message recorded — NOT "Unknown error"

**AC-8: Build clean**
**Given** all changes applied
**When** `pnpm test -- --testPathPattern="ai-execution.consumer|pm-execution-status"` runs
**Then** all tests pass with zero TypeScript errors

## Tasks / Subtasks

> **Context:** FAILED state, WebSocket event, and ClickUp status update via `updateByPhase(FAILED)` are **already implemented** in `ai-execution.consumer.ts`. What's missing is:
>
> 1. The ClickUp **comment** posted on crash (currently only done for budget exceeded)
> 2. **Reverting to `ai_trigger_status`** instead of the AI-skill-selected "failed" status
> 3. **Specific error categorization** beyond PROCESS_CRASH/TIMEOUT codes

- [ ] Task 1: Add `revertToPreTriggerStatus()` to `PMExecutionStatusService` (AC: 3, 4)
  - [ ] 1.1 In `src/integrations/pm-execution-status.service.ts`, add new public method:
    ```typescript
    async revertToPreTriggerStatus(
      projectId: string,
      ticketId: string,
      failureReason: string,
      correlationId?: string,
    ): Promise<void>
    ```
  - [ ] 1.2 Inside the method (always best-effort, never throws — same pattern as `updateByPhase`):
    - Resolve `ticket.clickup_task_id` from DSF ticket UUID (same as `updateByPhase`, lines 74-82)
    - Load `integration` via `integrationService.findByProjectAndProvider(projectId, CLICKUP)` (same as lines 87-95)
    - Get `provider` via `providerFactory.getProvider(integration)` (same as line 98)
    - Read `integration.ai_trigger_status` — if null/undefined, log warn and fall back to calling `updateByPhase(ExecutionPhase.FAILED, ...)` then return
    - Resolve the ClickUp status ID for `ai_trigger_status` using `provider.getStatuses(task.listId)` → find by name (same hallucination-guard pattern as lines 149-156)
    - If status found: call `provider.updateStatus(clickupTaskId, statusId)` to revert
    - After status revert: call `provider.addComment(clickupTaskId, failureComment)` where `failureComment` is built from `failureReason`
  - [ ] 1.3 Failure comment format (exact):

    ```
    ⚠️ **Execution Failed — No Code Pushed**

    The agent did not complete. Reason: {failureReason}

    No branch was created and no code was pushed.
    ```

  - [ ] 1.4 Wrap entire method body in `try/catch` — log error but never throw (best-effort, same as `updateByPhase`)

- [ ] Task 2: Wire `revertToPreTriggerStatus()` into failure cascade in `ai-execution.consumer.ts` (AC: 1, 2, 3, 4, 5, 6)
  - [ ] 2.1 **Add import** at the top of `ai-execution.consumer.ts` — `AIErrorCode` is NOT currently imported there; add it:
    ```typescript
    import { AIErrorCode } from '@/ai-routing/interfaces/ai-provider.interface';
    ```
  - [ ] 2.2 In the **orchestration failure block** (lines 651-703), replace the `updateByPhase(FAILED)` call (lines 681-686) with:

    ```typescript
    const isCrashFailure =
      result.error?.code === AIErrorCode.PROCESS_CRASH ||
      result.error?.code === AIErrorCode.TIMEOUT;

    if (isCrashFailure) {
      await this.pmExecutionStatus.revertToPreTriggerStatus(
        payload.projectId,
        payload.ticketId,
        result.error?.message || 'Unknown crash',
        correlationId,
      );
    } else {
      await this.pmExecutionStatus.updateByPhase(
        payload.projectId,
        payload.ticketId,
        ExecutionPhase.FAILED,
        correlationId,
      );
    }
    ```

  - [ ] 2.3 In the **catch block** (lines 704-731), replace `updateByPhase(FAILED)` (lines 717-722) with:
    ```typescript
    await this.pmExecutionStatus.revertToPreTriggerStatus(
      payload.projectId,
      payload.ticketId,
      err.message || 'Unhandled execution error',
      correlationId,
    );
    ```
    Unhandled exceptions are always crash-like — no conditional needed here.

- [ ] Task 3: Add specific error categorization in `ClaudeCodeProvider` (AC: 7)
  - [ ] 3.1 In `src/ai-routing/providers/claude-code.provider.ts`, add private helper:
    ```typescript
    private categorizeError(stdout: string, stderr: string, timedOut: boolean): string {
      if (timedOut) return 'Sandbox execution timed out';
      const output = `${stdout}\n${stderr}`.toLowerCase();
      if (/rate.?limit|429|quota.?exceeded|too.?many.?requests/.test(output))
        return 'API rate limit exceeded — retry later';
      if (/repository.*not.*found|could not.*clone|permission.*denied.*clone|authentication.*failed.*git/.test(output))
        return 'Repository unreachable or access denied';
      if (/out.?of.?memory|oom.?kill|killed.*memory/.test(output))
        return 'Container ran out of memory (OOM)';
      return 'Agent did not emit a final result line — execution may have crashed';
    }
    ```
  - [ ] 3.2 In the `execute()` method error block (lines 141-154), replace the hardcoded `'Agent did not emit a final result line...'` string with a call to `this.categorizeError(result.stdout, result.stderr, result.timedOut)`:
    ```typescript
    error: {
      code: result.timedOut ? AIErrorCode.TIMEOUT : AIErrorCode.PROCESS_CRASH,
      message: result.timedOut || !resultReceived
        ? this.categorizeError(result.stdout, result.stderr, result.timedOut)
        : qaFailed
          ? 'Agentic delivery failed: QA self-healing exhausted retries'
          : result.stderr || 'Claude Code execution failed in sandbox',
      isRetryable: result.timedOut || qaFailed,
      rawOutput: `${result.stdout}\n${result.stderr}`.trim(),
      exitCode: result.exitCode,
    }
    ```
  - [ ] 3.3 Apply the same `categorizeError` helper to `codex.provider.ts`, `kimi.provider.ts`, and `gemini.provider.ts` — **same exact helper method, same error substitution** (these providers have identical error block patterns from WR-2.4)

- [ ] Task 4: Tests for `PMExecutionStatusService.revertToPreTriggerStatus()` (AC: 3, 4, 8)
  - [ ] 4.1 In `src/integrations/pm-execution-status.service.spec.ts`, add describe block `'revertToPreTriggerStatus'`:
    - `'should post failure comment and revert status to ai_trigger_status'` — mock `integration.ai_trigger_status = 'Ready for Dev'`, mock statuses including `{ name: 'Ready for Dev', id: 'status-123' }`, assert `provider.updateStatus` called with `(clickupTaskId, 'status-123')`, assert `provider.addComment` called with message containing "Execution Failed" and the failure reason
    - `'should fall back to updateByPhase(FAILED) if ai_trigger_status is null'` — mock `integration.ai_trigger_status = null`, assert `provider.updateStatus` NOT called, assert `skillRunner.run` IS called (verifying updateByPhase delegation)
    - `'should never throw — swallows errors (best-effort)'` — mock `provider.updateStatus` throws, assert method resolves without throwing

- [ ] Task 5: Tests for crash cascade in `ai-execution.consumer.ts` (AC: 1, 2, 3, 4, 5, 6, 8)
  - [ ] 5.0 **Update the `PMExecutionStatusService` mock** in the `beforeEach` / module setup (line 152-153). Current mock is `{ updateByPhase: jest.fn().mockResolvedValue(undefined) }` — add `revertToPreTriggerStatus`:
    ```typescript
    useValue: {
      updateByPhase: jest.fn().mockResolvedValue(undefined),
      revertToPreTriggerStatus: jest.fn().mockResolvedValue(undefined),
    }
    ```
    Without this, tests will throw `TypeError: pmExecutionStatus.revertToPreTriggerStatus is not a function`.
  - [ ] 5.1 Update existing failure test (the one asserting `newStatus: ExecutionStatus.FAILED` around line 84) to also assert `pmExecutionStatus.revertToPreTriggerStatus` is called when `error.code === AIErrorCode.PROCESS_CRASH`
  - [ ] 5.2 Add `'should call revertToPreTriggerStatus on TIMEOUT error'` — mock orchestrator returns `{ success: false, error: { code: AIErrorCode.TIMEOUT, message: 'Sandbox timed out' } }`, assert `revertToPreTriggerStatus` called with the timeout message, `updateByPhase` NOT called
  - [ ] 5.3 Add `'should call updateByPhase(FAILED) on non-crash error codes'` — use `error.code = AIErrorCode.CLI_NOT_FOUND` (a non-retryable non-crash code, exists in both the enum and the `nonRetryable` list), assert `revertToPreTriggerStatus` NOT called, `updateByPhase(ExecutionPhase.FAILED)` IS called
  - [ ] 5.4 Add `'should call revertToPreTriggerStatus in catch block for unhandled exceptions'` — mock orchestrator throws `new Error('Unexpected failure')`, assert `revertToPreTriggerStatus` called, `updateByPhase` NOT called

- [ ] Task 6: Run and verify (AC: 8)
  - [ ] 6.1 `pnpm test -- --testPathPattern="pm-execution-status"` → green
  - [ ] 6.2 `pnpm test -- --testPathPattern="ai-execution.consumer"` → green
  - [ ] 6.3 `pnpm test -- --testPathPattern="claude-code.provider"` → green (categorizeError tests pass)
  - [ ] 6.4 `pnpm build` → zero TypeScript errors

## Dev Notes

### What Is Already Built (Do NOT Re-implement)

**Crash/failure detection is already complete at the provider layer:**

- `SandboxService.runAgentCommand()` returns `{exitCode, timedOut, stdout, stderr}` — already detects timeouts via `timedOut` flag — **do NOT add new timeouts**
- `ClaudeCodeProvider.execute()` already returns `{success: false, error: {code: 'PROCESS_CRASH' | 'TIMEOUT', message: string}}` when sandbox exits without result — `src/ai-routing/providers/claude-code.provider.ts:L121-L154`
- `executionTracker.failExecution()` already marks execution `FAILED` in DB + emits `execution.failed` WebSocket event + updates internal ticket status — `src/execution/execution-tracker.service.ts:L333-L431`
- `ai-execution.consumer.ts:L651-L703` already handles provider failures, calls `failExecution()` and `updateByPhase(FAILED)` — **extend this, don't replace it**

**What is NOT done (this story adds):**

- ClickUp **comment** on crash — only budget exceeded posts a comment (L397); orchestration failures do not
- **Revert to `ai_trigger_status`** — currently `updateByPhase(FAILED)` uses AI skill to pick a generic "failed" status, NOT the pre-trigger status
- **Specific error category strings** in the comment/message

### AIErrorCode Constants (Use These, Not Strings)

The AIErrorCode enum is at **`src/ai-routing/interfaces/ai-provider.interface.ts:L125`**. Confirmed values:

- `AIErrorCode.TIMEOUT = 'TIMEOUT'`
- `AIErrorCode.PROCESS_CRASH = 'PROCESS_CRASH'`
- `AIErrorCode.CLI_NOT_FOUND = 'CLI_NOT_FOUND'` (non-retryable; safe for test examples in Task 5.3)

**CRITICAL:** `AIErrorCode` is NOT currently imported in `ai-execution.consumer.ts` (confirmed — imports only from `./interfaces`). Task 2.1 adds this import. The consumer's `isRetryableError()` uses plain string literals which match enum values exactly — both work. Use the enum in new code for type safety.

### `PMExecutionStatusService.updateByPhase()` Pattern — Exact Copy for `revertToPreTriggerStatus()`

The new method follows the **exact same structure** as `updateByPhase()` (file: `src/integrations/pm-execution-status.service.ts`):

```
Steps 1–4 are identical (resolve ticket, integration, provider, task)
Step 5: Get statuses for task.listId (same as getStatuses call in updateByPhase)
Step 6: Find status matching integration.ai_trigger_status by name (case-insensitive)
Step 7: Call provider.updateStatus(clickupTaskId, statusId) — NOT via AI skill
Step 8: Call provider.addComment(clickupTaskId, failureComment)
Wrap everything in try/catch, return void, never throw
```

**Key difference from `updateByPhase`:** This method does NOT run the CS2 field pre-check pipeline or the AI skill. It bypasses them entirely for crash scenarios — we just revert the status and post a comment.

### `provider.updateStatus()` vs `provider.addComment()` Method Names

These are IPMProvider interface methods. Check `src/integrations/providers/pm-provider.interface.ts` (or `IPMProvider` interface) for the exact method names. Common names:

- Status update: `updateStatus(taskId, statusId)` or `updateTaskStatus(taskId, statusId)`
- Comment: `addComment(taskId, commentText)`

### `integration.ai_trigger_status` Field

Located on `ProjectIntegration` model — `prisma/schema.prisma:L1259` confirms: `ai_trigger_status String?`

When null: no pre-trigger status configured → fall back to `updateByPhase(ExecutionPhase.FAILED, ...)`. Log at warn level: `"[${tag}] No ai_trigger_status configured for project ${projectId} — falling back to FAILED phase update"`.

### Best-Effort Pattern (NEVER Throw)

`PMExecutionStatusService` is always best-effort. The entire `revertToPreTriggerStatus()` body must be wrapped:

```typescript
try {
  // ... all logic
} catch (err) {
  this.logger.error(
    `${tag}Failed to revert pre-trigger status for ticket ${ticketId}: ${(err as Error).message}`,
  );
}
```

This matches the existing pattern in `updateByPhase()`.

### Error Categorization — Scope Limit

`categorizeError()` in Task 3 is a **private helper in each provider**. Do NOT create a shared utility or service. Three regex patterns are sufficient:

1. Rate limit: matches 429, "rate limit", "quota exceeded", "too many requests"
2. Repo unreachable: matches "repository not found", "could not clone", "permission denied" + "clone", "authentication failed" + "git"
3. OOM: matches "out of memory", "OOMKill", "killed" + "memory"

Regex checks are case-insensitive on `stdout + stderr` combined. If no pattern matches and not timeout, return the default "Agent did not emit a final result line — execution may have crashed".

### `ClickUpService.addComment()` vs `provider.addComment()`

There are TWO addComment methods:

- `ClickUpService.addComment(ticketId, comment)` — `src/clickup/clickup.service.ts:L142` — used in `ai-execution.consumer.ts` budget block (L397). Takes ClickUp **task ID** directly (uses it as `/task/${ticketId}/comment`).
- `IPMProvider.addComment(taskId, comment)` — provider interface method

In Task 1 (`revertToPreTriggerStatus`), use the **provider method** since you already have the provider instance. This is cleaner and avoids injecting `ClickUpService` into `PMExecutionStatusService`.

### Existing Tests to NOT Break

| Spec file                             | Existing test                                  | Covers                 |
| ------------------------------------- | ---------------------------------------------- | ---------------------- |
| `ai-execution.consumer.spec.ts`       | `'should handle ai execution failure'`         | Existing FAILED path   |
| `pm-execution-status.service.spec.ts` | `'should update task status for FAILED phase'` | Existing updateByPhase |

**Spec mock that MUST be updated (or tests will throw):**

`ai-execution.consumer.spec.ts` line 152-153 — `PMExecutionStatusService` is mocked as:

```typescript
useValue: {
  updateByPhase: jest.fn().mockResolvedValue(undefined);
}
```

Add `revertToPreTriggerStatus` to this mock (Task 5.0) or the crash-path tests will throw `TypeError: pmExecutionStatus.revertToPreTriggerStatus is not a function`.

The existing `'should handle ai execution failure'` test likely asserts `updateByPhase(FAILED)` is called. After Task 2.2, that test's mock orchestrator returns a `PROCESS_CRASH` error — so it will now route to `revertToPreTriggerStatus`. **Update that test's assertion** to expect `revertToPreTriggerStatus` instead of `updateByPhase`.

### File List

All changes in this story:

- `src/integrations/pm-execution-status.service.ts` — add `revertToPreTriggerStatus()`
- `src/integrations/pm-execution-status.service.spec.ts` — new tests for `revertToPreTriggerStatus()`
- `src/execution/ai-execution.consumer.ts` — crash-path branching (Tasks 2.2 and 2.3)
- `src/execution/ai-execution.consumer.spec.ts` — crash cascade tests (Task 5)
- `src/ai-routing/providers/claude-code.provider.ts` — `categorizeError()` helper (Task 3)
- `src/ai-routing/providers/codex.provider.ts` — same `categorizeError()` (Task 3.3)
- `src/ai-routing/providers/kimi.provider.ts` — same `categorizeError()` (Task 3.3)
- `src/ai-routing/providers/gemini.provider.ts` — same `categorizeError()` (Task 3.3)

### References

- [Source: epics-workspace-removal.md#Story-WR-3.2] — FR-WR14 requirements, all ACs
- [Source: src/execution/ai-execution.consumer.ts:L651-L703] — existing failure path to extend
- [Source: src/execution/ai-execution.consumer.ts:L392-L440] — budget comment pattern (reference for ClickUp comment pattern)
- [Source: src/integrations/pm-execution-status.service.ts:L64-L200] — `updateByPhase()` implementation to copy structure from
- [Source: src/ai-routing/providers/claude-code.provider.ts:L121-L154] — existing error block to extend with `categorizeError()`
- [Source: prisma/schema.prisma:L1259] — `ai_trigger_status String?` on ProjectIntegration
- [Source: src/integrations/providers/pm-provider.interface.ts] — IPMProvider `addComment` / `updateStatus` method signatures

---

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 — story created 2026-04-01

### Debug Log References

### Completion Notes List

### File List

- `src/integrations/pm-execution-status.service.ts`
- `src/integrations/pm-execution-status.service.spec.ts`
- `src/execution/ai-execution.consumer.ts`
- `src/execution/ai-execution.consumer.spec.ts`
- `src/ai-routing/providers/claude-code.provider.ts`
- `src/ai-routing/providers/claude-code.provider.spec.ts`
- `src/ai-routing/providers/codex.provider.ts`
- `src/ai-routing/providers/codex.provider.spec.ts`
- `src/ai-routing/providers/kimi.provider.ts`
- `src/ai-routing/providers/gemini.provider.ts`

---

### Review Findings

- [ ] [Review][Patch] P1 — Catch block condition always false: `err.code` on raw Error is never `AIErrorCode.PROCESS_CRASH` — unhandled exceptions always route to `updateByPhase` instead of `revertToPreTriggerStatus` [ai-execution.consumer.ts:728]
- [ ] [Review][Patch] P2 — `updateStatus()` called with status `name` (e.g. `"Open"`) instead of status `id`; ClickUp API requires the numeric ID [pm-execution-status.service.ts:revertToPreTriggerStatus step 7]
- [ ] [Review][Patch] P3 — OOM regex too broad: `/killed/i` in `ClaudeCodeProvider` matches unrelated log messages; spec requires matching `"killed" + "memory"` [claude-code.provider.ts:176]
- [ ] [Review][Patch] P4 — Missing "never throws" test for `revertToPreTriggerStatus` (Task 4.1 spec requirement) [pm-execution-status.service.spec.ts]
- [ ] [Review][Patch] P5 — `isRetryable` string-check inconsistency: Gemini checks `'429'` string, Kimi does not [kimi.provider.ts:~181]
- [ ] [Review][Patch] P6 — Consumer test missing: non-crash error code (e.g. `CLI_NOT_FOUND`) should route to `updateByPhase(FAILED)` — Task 5.3 [ai-execution.consumer.spec.ts]
- [ ] [Review][Patch] P7 — Consumer test missing: unhandled catch-block exception should route to `revertToPreTriggerStatus` — Task 5.4 [ai-execution.consumer.spec.ts]
- [ ] [Review][Patch] P8 — `task.listId` null causes early return BEFORE failure comment is posted (AC-3 partially unimplemented) [pm-execution-status.service.ts:revertToPreTriggerStatus step 5]
- [ ] [Review][Patch] P9 — `/OOM/i` regex too broad across all 4 providers; matches `"zoom"`, `"room"` etc. [claude-code, codex, kimi, gemini providers]
- [ ] [Review][Patch] P10 — Test T1 only asserts `stringContaining('Sandbox Timeout')`, does not verify AC-3 exact comment format (emoji header, bold title, footer) [pm-execution-status.service.spec.ts]
- [x] [Review][Defer] ECH-3 — `updateByPhase` fallback escapes outer try/catch via `return`; asymmetric but benign since `updateByPhase` is documented never-throw — deferred, pre-existing pattern
