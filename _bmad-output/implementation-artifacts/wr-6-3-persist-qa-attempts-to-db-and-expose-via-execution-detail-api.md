# Story WR-6.3: Persist qaAttempts to DB & Expose via Execution Detail API

Status: ready-for-dev

## Story

As a **platform engineer**,
I want `qaAttempts` persisted to `Execution.qa_attempts` and exposed via the execution status API,
so that consumers (frontend, audit tools) can access the full per-attempt QA history after execution completes.

## Acceptance Criteria

**AC-1: Orchestrator passes qaAttempts through IOrchestrationResult**
Given `IAIExecutionResult.qaAttempts` is populated by providers (WR-6.2)
When `OrchestratorService.execute()` builds `IOrchestrationResult`
Then `result.qaAttempts` is set to `executionResult.result.qaAttempts`
And the consumer can access `result.qaAttempts` after the orchestrator returns

**AC-2: qaAttempts persisted on COMPLETED executions**
Given `result.qaAttempts` is available after orchestrator returns with `result.success === true`
When the consumer's success path runs
Then `Execution.qa_attempts` is updated with the serialized array
And if `result.qaAttempts` is undefined/empty, `qa_attempts` is set to `null` (not `[]`)

**AC-3: qaAttempts persisted on QA_FAILED executions**
Given the QA failure path fires (`result.qaStatus === 'failed' && result.branchName`)
When `executionTracker.qaFailExecution()` is called
Then `qaAttempts` is passed through `IExecutionQAFailure` and persisted alongside `errorMessage`/`branchName`
And if no attempts exist, `qa_attempts` is `null`

**AC-4: Execution detail API exposes qaAttempts**
Given `Execution.qa_attempts` is populated
When `GET /api/v1/executions/:id/status` is called
Then the response `ExecutionResponseDto` includes `qaAttempts: QAAttempt[] | null`
And when `qa_attempts` is null in DB the field returns `null` (no 500 error, no empty array coercion)
And all existing response fields remain unchanged (NFR-EXT8: purely additive)

**AC-5: Build clean — no TypeScript errors**
Given all changes applied
When `pnpm typecheck` and `pnpm build` run
Then zero TypeScript errors

---

## Tasks / Subtasks

- [ ] Task 1: Pass qaAttempts through IOrchestrationResult (AC: 1)
  - [ ] 1.1: In `src/ai-routing/orchestrator.service.ts`, in the `execute()` method at the result builder block (currently lines 185–201), add `qaAttempts: executionResult.result.qaAttempts` as the last field before the closing `}`:
    ```typescript
    const result: IOrchestrationResult = {
      success: executionResult.result.success,
      // ... existing fields unchanged ...
      tokensInput: executionResult.result.tokensInput,
      tokensOutput: executionResult.result.tokensOutput,
      qaAttempts: executionResult.result.qaAttempts, // WR-6.3
    };
    ```
  - [ ] 1.2: Verify `IOrchestrationResult extends IAIExecutionResult` — since `qaAttempts?: QAAttempt[]` is already on `IAIExecutionResult` after WR-6.1, no interface changes are needed here; TypeScript already accepts the field

- [ ] Task 2: Add qaAttempts support to repository.updateStatus (AC: 2, 3)
  - [ ] 2.1: In `src/execution/execution.repository.ts`, extend the `additionalData` partial type of `updateStatus` to include `qaAttempts?: QAAttempt[] | null`:
    ```typescript
    additionalData?: Partial<{
      confidenceScore: number;
      codeOutput: string;
      filesChanged: string[];
      errorMessage: string;
      branchName: string | null;
      qaAttempts: QAAttempt[] | null; // WR-6.3
    }>
    ```
  - [ ] 2.2: Add import at top of file: `import { QAAttempt } from '@/ai-routing/interfaces/ai-provider.interface';`
  - [ ] 2.3: In the `COMPLETED` case of the `switch (status)` block, after `filesChanged` handling, add:
    ```typescript
    if ('qaAttempts' in (additionalData ?? {})) {
      updateData.qa_attempts = (additionalData?.qaAttempts ??
        null) as unknown as Prisma.InputJsonValue;
    }
    ```
  - [ ] 2.4: In the `QA_FAILED` case, after `branchName` handling, add the same pattern:
    ```typescript
    if ('qaAttempts' in (additionalData ?? {})) {
      updateData.qa_attempts = (additionalData?.qaAttempts ??
        null) as unknown as Prisma.InputJsonValue;
    }
    ```
    **Why `'qaAttempts' in additionalData`:** distinguishes "caller explicitly passed null (skipped QA)" from "caller didn't provide the field at all (unknown, don't overwrite)". Do NOT use `additionalData?.qaAttempts !== undefined` — that would silently skip explicit `null`.

- [ ] Task 3: Thread qaAttempts through IExecutionQAFailure and qaFailExecution (AC: 3)
  - [ ] 3.1: In `src/execution/interfaces/execution.interface.ts`, add `qaAttempts?: QAAttempt[] | null` to `IExecutionQAFailure`:
    ```typescript
    export interface IExecutionQAFailure {
      executionId: string;
      errorMessage: string;
      branchName: string | null;
      qaRetryCount?: number;
      qaAttempts?: QAAttempt[] | null; // WR-6.3
    }
    ```
  - [ ] 3.2: Add import at top of file: `import { QAAttempt } from '@/ai-routing/interfaces/ai-provider.interface';`
  - [ ] 3.3: In `src/execution/execution-tracker.service.ts`, in `qaFailExecution()`, destructure `qaAttempts` from `failure` and pass to `repository.updateStatus`:
    ```typescript
    const { executionId, errorMessage, branchName, qaRetryCount, qaAttempts } = failure;
    // ...
    await this.repository.updateStatus(executionId, ExecutionStatus.QA_FAILED, {
      errorMessage,
      branchName: branchName ?? null,
      qaAttempts: qaAttempts ?? null, // WR-6.3
    });
    ```

- [ ] Task 4: Wire persistence calls in consumer (AC: 2, 3)
  - [ ] 4.1: In `src/execution/ai-execution.consumer.ts`, in the **success path** (`if (result.success)`), after the `ai_execution_complete` decision log call (~line 638) and before the ClickUp update:
    ```typescript
    // WR-6.3: Persist per-attempt QA history to DB
    await this.executionTracker.persistQaAttempts(executionId, result.qaAttempts ?? null);
    ```
  - [ ] 4.2: In `src/execution/ai-execution.consumer.ts`, in the **QA failure path** (`if (result.qaStatus === 'failed' && result.branchName)`), update the `qaFailure` object to include `qaAttempts`:
    ```typescript
    const qaFailure: IExecutionQAFailure = {
      executionId,
      errorMessage: qaErrorMessage,
      branchName: result.branchName,
      qaRetryCount: result.qaRetryCount,
      qaAttempts: result.qaAttempts ?? null, // WR-6.3
    };
    ```
  - [ ] 4.3: Add `QAAttempt` import if not already present via `IAIExecutionResult` type

- [ ] Task 5: Add persistQaAttempts helper to ExecutionTrackerService (AC: 2)
  - [ ] 5.1: In `src/execution/execution-tracker.service.ts`, add the following method (after `qaFailExecution`):
    ```typescript
    /**
     * Persist per-attempt QA history to Execution.qa_attempts (WR-6.3)
     * Called from consumer success path after orchestrator returns.
     * Stores null when no attempts occurred (qaStatus: 'skipped' or provider pre-WR-6.2).
     */
    async persistQaAttempts(
      executionId: string,
      qaAttempts: QAAttempt[] | null,
    ): Promise<void> {
      await this.repository.update(executionId, {
        qa_attempts: (qaAttempts ?? null) as unknown as Prisma.InputJsonValue,
      });
      this.logger.debug(
        `[${executionId}] qa_attempts persisted: ${qaAttempts?.length ?? 0} attempts`,
      );
    }
    ```
  - [ ] 5.2: Add imports: `import { QAAttempt } from '@/ai-routing/interfaces/ai-provider.interface';` and ensure `Prisma` is imported from `@/prisma/client`

- [ ] Task 6: Expose qaAttempts in ExecutionResponseDto and toResponseDto (AC: 4)
  - [ ] 6.1: In `src/execution/dto/execution.dto.ts`, add `qaAttempts?: QAAttempt[] | null` to `ExecutionResponseDto`:
    ```typescript
    export class ExecutionResponseDto {
      id!: string;
      ticketId!: string;
      // ... existing fields unchanged ...
      currentStep?: string;
      percentComplete?: number;
      qaAttempts?: QAAttempt[] | null; // WR-6.3: per-attempt QA history
    }
    ```
  - [ ] 6.2: Add import at top of file: `import { QAAttempt } from '@/ai-routing/interfaces/ai-provider.interface';`
  - [ ] 6.3: In `src/execution/execution.service.ts`, in `toResponseDto()`, add the mapping after `percentComplete`:
    ```typescript
    qaAttempts: (execution.qa_attempts as unknown as QAAttempt[] | null) ?? null,
    ```
  - [ ] 6.4: Add import: `import { QAAttempt } from '@/ai-routing/interfaces/ai-provider.interface';`

- [ ] Task 7: Verify build and tests (AC: 5)
  - [ ] 7.1: Run `pnpm typecheck` — zero errors
  - [ ] 7.2: Run `pnpm build` — must succeed
  - [ ] 7.3: Run `pnpm test -- --testPathPattern="execution-tracker|execution\.service|ai-execution\.consumer"` — existing tests must pass
  - [ ] 7.4: Verify no tests assert on `ExecutionResponseDto` shape that would break from adding the optional `qaAttempts` field

---

## Dev Notes

### THIS STORY SCOPE — WR-6.3 ONLY

This story wires the final two concerns of Epic WR-6:

1. **Persistence**: `IAIExecutionResult.qaAttempts` → `Execution.qa_attempts` DB column (populated by WR-6.2 providers)
2. **API exposure**: `GET /api/v1/executions/:id/status` returns `qaAttempts` in the response DTO

**Story sequence:**

- WR-6.1 (prerequisite): `QAAttempt` interface + `qa_attempts Json?` column on `Execution`
- WR-6.2 (prerequisite): Providers parse stdout markers → populate `IAIExecutionResult.qaAttempts`
- WR-6.3 (this): Persist to DB + expose via API

**DO NOT:**

- Add a new `GET /executions/:id` endpoint — the existing `/status` endpoint already serves the detail use case
- Create a `QAAttempt` Prisma model — per FR-EXT7, the JSON column on `Execution` is sufficient
- Use `JSON.stringify()` manually — Prisma handles JSON serialization for `Json?` fields automatically
- Break the `repository.update()` contract — it uses `updateMany` internally; this is intentional for crash safety (AC6 pattern)

### Why the `'qaAttempts' in additionalData` check in repository

Prisma's `Json?` nullable column has three meaningful states:

- Column value = `[{...},{...}]` → QA attempts occurred
- Column value = `null` → QA was skipped OR execution pre-dates WR-6
- Column value not written → same as null (default)

The check `'qaAttempts' in (additionalData ?? {})` allows a caller to explicitly write `null` (to record "QA skipped") vs. not providing the field (leave DB value unchanged). Without this distinction, old code paths that don't know about `qaAttempts` would accidentally overwrite valid data with null on every status update.

### Orchestrator result builder — why no interface change needed

`IOrchestrationResult extends IAIExecutionResult`. After WR-6.1, `IAIExecutionResult.qaAttempts?: QAAttempt[]` already exists. TypeScript allows adding `qaAttempts` to the `IOrchestrationResult` literal at the call site because it's defined on the parent interface. Only the orchestrator result builder needs updating — no interface file changes.

### Consumer success path — where to place the persistQaAttempts call

The consumer's success path (line ~640) currently has this note:

```
// Note: execution status and execution.completed EventBus event are handled by
// AIExecutionService.executeWithProvider() → ExecutionService.completeExecution().
```

This comment refers to a legacy flow (the `completeExecution` mechanism) that does NOT run in the current sandbox provider path. The `persistQaAttempts` call should be placed **after** the `ai_execution_complete` decision log (~line 638) and **before** the ClickUp update (~line 644). This is consistent with how the QA failure path calls `qaFailExecution` with all QA-related data.

### Casting `execution.qa_attempts` in toResponseDto

Prisma returns `Json?` as `Prisma.JsonValue | null` — a union of all valid JSON types. To expose it as typed `QAAttempt[] | null`:

```typescript
qaAttempts: (execution.qa_attempts as unknown as QAAttempt[] | null) ?? null,
```

The double cast via `unknown` is the correct TypeScript pattern for structured JSON fields. Do NOT use `as QAAttempt[]` directly — TypeScript rejects direct casts from `JsonValue` to user types.

### Prisma write for Json field

When writing to `qa_attempts` in `repository.update()`:

```typescript
qa_attempts: (qaAttempts ?? null) as unknown as Prisma.InputJsonValue,
```

Prisma 7 uses `Prisma.InputJsonValue` for writable JSON. The cast via `unknown` is required. Do NOT use `JSON.stringify()` — Prisma handles serialization.

When writing via `repository.updateStatus()` in the `updateData` object:

```typescript
updateData.qa_attempts = (additionalData?.qaAttempts ?? null) as unknown as Prisma.InputJsonValue;
```

### Files to Touch (Complete List)

| File                                              | Change                                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/ai-routing/orchestrator.service.ts`          | Add `qaAttempts: executionResult.result.qaAttempts` to result builder               |
| `src/execution/interfaces/execution.interface.ts` | Add `qaAttempts?: QAAttempt[] \| null` to `IExecutionQAFailure`                     |
| `src/execution/execution.repository.ts`           | Add `qaAttempts` to `additionalData` partial; handle in COMPLETED + QA_FAILED cases |
| `src/execution/execution-tracker.service.ts`      | Add `persistQaAttempts()` method; thread `qaAttempts` in `qaFailExecution()`        |
| `src/execution/ai-execution.consumer.ts`          | Call `persistQaAttempts` in success path; add `qaAttempts` to QA failure object     |
| `src/execution/dto/execution.dto.ts`              | Add `qaAttempts?: QAAttempt[] \| null` to `ExecutionResponseDto`                    |
| `src/execution/execution.service.ts`              | Map `execution.qa_attempts` in `toResponseDto()`                                    |

**DO NOT TOUCH:**

| File                                                   | Reason                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                 | `qa_attempts Json?` already added by WR-6.1                               |
| `prisma/migrations/`                                   | Migration already applied by WR-6.1                                       |
| Any provider file (`*.provider.ts`)                    | Providers already populate `qaAttempts` in WR-6.2                         |
| `src/ai-routing/interfaces/ai-provider.interface.ts`   | `QAAttempt` interface and `IAIExecutionResult.qaAttempts` added in WR-6.1 |
| `src/ai-routing/interfaces/orchestration.interface.ts` | `IOrchestrationResult extends IAIExecutionResult` — no change needed      |

### Previous Story Intelligence (WR-6.1)

WR-6.1 established:

- `QAAttempt` interface lives in `src/ai-routing/interfaces/ai-provider.interface.ts` — import from `@/ai-routing/interfaces/ai-provider.interface`
- `IAIExecutionResult.qaAttempts?: QAAttempt[]` — optional field, existing providers return without it
- `Execution.qa_attempts Json?` — nullable column, default null for all existing rows
- `@/` path alias must be used (never relative paths)
- No separate `QAAttempt` Prisma model — JSON column only (FR-EXT7)

### Previous Story Intelligence (WR-6.2)

WR-6.2 established:

- All 4 providers (ClaudeCode, Codex, Kimi, Gemini) parse `{"type":"qa_attempt",...}` stdout markers
- Accumulated into `IAIExecutionResult.qaAttempts` array
- Bounded by `qaMaxRetries` (max 10 per NFR-EXT3)
- Parsing failures never crash execution (NFR-EXT6)

### Git Intelligence

Recent commits pattern:

- `feat(wr-5.1)`: Added `qaMaxRetries` to Project — pattern: `additionalData` in `updateStatus` follows `Partial<{...}>` type extension
- `feat(wr-4.3)`: Added `resolve-qa-failure` endpoint — pattern: controller delegates to service, service returns typed DTO
- `feat(wr-4.1)`: Added `qaFailExecution` in tracker — pattern: destructure from failure object, thread through to `updateStatus`
- `feat(wr-4.2/4.3)`: Added per-project QA status config — pattern: additive fields only, no existing shapes changed

### Anti-Pattern Prevention

1. **Do NOT call `completeExecution()`** from the consumer — it is not wired in the sandbox provider path and calling it would double-update status. Use `persistQaAttempts()` instead for the success path.
2. **Do NOT store `[]` (empty array)** for executions without QA attempts — store `null` per spec. Check: `qaAttempts?.length ? qaAttempts : null`
3. **Do NOT add `@ApiProperty()` decorators** to `ExecutionResponseDto.qaAttempts` — the existing DTOs in this file don't use class-validator/swagger decorators; follow the existing pattern
4. **Do NOT add `qaAttempts` to `CompleteExecutionDto`** — that DTO is used by a separate code path (HTTP endpoint) not involved in the sandbox flow; adding it there is scope creep
5. **Do NOT break the `'qaAttempts' in additionalData`** check by using optional chaining — `additionalData?.qaAttempts !== undefined` would treat explicit `null` as "not provided"

### NFR Compliance

- **NFR-EXT8 (Additive only)**: `qaAttempts` is added to `ExecutionResponseDto` as an optional field. No existing fields renamed or removed.
- **NFR-EXT3 (Bounded)**: By the time data reaches persistence, providers have already bounded `qaAttempts` to `qaMaxRetries` entries.
- **No unbounded growth**: `qa_attempts` is a single JSON column on `Execution` (1:1), capped by `qaMaxRetries`.

### Expected API Response Shape

`GET /api/v1/executions/:id/status` after WR-6.3:

```json
{
  "id": "uuid",
  "ticketId": "uuid",
  "aiProvider": "CLAUDE_CODE",
  "status": "COMPLETED",
  "confidenceScore": 0.9,
  "startTime": "2026-04-03T10:00:00.000Z",
  "completedAt": "2026-04-03T10:05:00.000Z",
  "failedAt": null,
  "errorMessage": null,
  "retryCount": 0,
  "filesChanged": ["src/foo.ts"],
  "createdAt": "2026-04-03T10:00:00.000Z",
  "updatedAt": "2026-04-03T10:05:00.000Z",
  "currentStep": "Complete",
  "percentComplete": 100,
  "qaAttempts": [
    {
      "attemptNumber": 1,
      "lintPassed": false,
      "lintErrors": { "count": 3, "details": [] },
      "testsPassed": false,
      "testResults": { "passed": 5, "failed": 2, "details": [] },
      "durationMs": 4200
    },
    {
      "attemptNumber": 2,
      "lintPassed": true,
      "testsPassed": true,
      "testResults": { "passed": 7, "failed": 0, "details": [] },
      "durationMs": 2100
    }
  ]
}
```

When `qa_attempts` is null: `"qaAttempts": null` (field present, value null — not omitted).

### References

- FR-EXT7: `qa_attempts Json?` column — `_bmad-output/planning-artifacts/epics-workspace-removal-extensions.md`
- FR-EXT8: Execution detail API exposes `qaAttempts` — same file
- NFR-EXT3: Bounded by `qaMaxRetries` — same file
- NFR-EXT8: Additive only — same file
- `IOrchestrationResult`: `src/ai-routing/interfaces/orchestration.interface.ts` (extends `IAIExecutionResult`)
- `updateStatus` additionalData: `src/execution/execution.repository.ts` lines 85–94
- `qaFailExecution`: `src/execution/execution-tracker.service.ts` lines 441–514
- Consumer QA failure path: `src/execution/ai-execution.consumer.ts` lines 683–706
- Consumer success path: `src/execution/ai-execution.consumer.ts` lines 517–660
- Orchestrator result builder: `src/ai-routing/orchestrator.service.ts` lines 185–201
- `toResponseDto`: `src/execution/execution.service.ts` lines 336–355

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
