# Story WR-5.2: Wire All Providers to Per-Project QA Retry Limit

Status: ready-for-dev

<!-- Note: Validate with validate-create-story if needed before running dev-story. -->

## Story

As a **platform engineer**,
I want all 4 sandbox providers to read `qaMaxRetries` from the project record at execution time,
so that the hardcoded `'3'` literals are gone and each project controls its own retry behaviour.

## Acceptance Criteria

**AC-1: ClaudeCodeProvider reads qaMaxRetries from payload**
Given `ClaudeCodeProvider.execute()` is called for a project with `qaMaxRetries: 5` in the payload
When the sandbox is launched
Then `QA_MAX_RETRIES=5` is passed as an environment variable to the sandbox container
And the hardcoded literal `'3'` no longer exists in `claude-code.provider.ts`

**AC-2: CodexProvider, KimiProvider, GeminiProvider read qaMaxRetries from payload**
Given each of the three providers contains a hardcoded `const QA_MAX_RETRIES = '3'`
When they are updated
Then each reads `qaMaxRetries` from the execution payload and injects it as `QA_MAX_RETRIES` into the sandbox env
And the hardcoded `const QA_MAX_RETRIES = '3'` declaration is removed from all 3 files

**AC-3: Fallback to 3 when qaMaxRetries is absent**
Given a project has not had `qaMaxRetries` explicitly set (field is absent from payload)
When any provider runs an execution for that project
Then the provider falls back to `QA_MAX_RETRIES=3` — the default applied in provider code via `?? 3`, not assumed from DB

**AC-4: In-flight executions unaffected (NFR-EXT7)**
Given `qaMaxRetries` is changed on a project while an execution is in progress
When the change is saved
Then the in-flight execution continues with the retry count it was launched with
(The value is captured at dispatch time into the payload; changing the DB record does not affect running executions)

**AC-5: qaMaxRetries flows through IAIExecutionPayload**
Given `qaMaxRetries` is added as an optional field to `IAIExecutionPayload`
When the OrchestratorConsumer builds the orchestration input from the project record
Then it passes `ticket.project.qa_max_retries` into `IOrchestrationInput.qaMaxRetries`
And `OrchestratorService.buildExecutionPayload()` includes it in the returned `IAIExecutionPayload`

**AC-6: No hardcoded literals remain**
Given a `grep -r "QA_MAX_RETRIES.*=.*'3'" src/` scan is run after implementation
When the scan completes
Then zero matches are found — no hardcoded retry literals remain in any provider file

**AC-7: Build and tests pass**
Given all changes applied
When `pnpm test -- --testPathPattern="claude-code.provider|codex.provider|kimi.provider|gemini.provider|orchestrator.service"` runs
Then all tests pass with zero TypeScript errors (`pnpm typecheck`)

---

## Tasks / Subtasks

- [ ] Task 1: Add `qaMaxRetries` to `IAIExecutionPayload` (AC: 5)
  - [ ] 1.1: In `src/execution/interfaces/queue.interface.ts`, add `qaMaxRetries?: number` after `complexityScore` with a JSDoc comment: `/** Per-project QA retry limit — populated from Project.qa_max_retries at dispatch time (WR-5.2) */`

- [ ] Task 2: Add `qaMaxRetries` to `IOrchestrationInput` (AC: 5)
  - [ ] 2.1: In `src/ai-routing/interfaces/orchestration.interface.ts`, add `qaMaxRetries?: number` to `IOrchestrationInput` after `routingConfig`, with JSDoc comment matching WR-5.2 tag

- [ ] Task 3: Populate `qaMaxRetries` in `OrchestratorConsumer` (AC: 5, 4)
  - [ ] 3.1: In `src/ai-routing/orchestrator.consumer.ts`, in the `input: IOrchestrationInput` literal (lines ~127–135), add `qaMaxRetries: ticket?.project?.qa_max_retries`
  - [ ] 3.2: The `ticket` variable (with `include: { project: true }`) is already fetched at line 106 — no additional DB query needed

- [ ] Task 4: Pass `qaMaxRetries` through `buildExecutionPayload` in OrchestratorService (AC: 5)
  - [ ] 4.1: In `src/ai-routing/orchestrator.service.ts`, in `buildExecutionPayload()` (line ~82), add `qaMaxRetries: input.qaMaxRetries` to the returned object alongside `complexityScore`

- [ ] Task 5: Update ClaudeCodeProvider (AC: 1, 3, 6)
  - [ ] 5.1: In `src/ai-routing/providers/claude-code.provider.ts` line 59, replace:
        `QA_MAX_RETRIES: '3',`
        with:
        `QA_MAX_RETRIES: String(payload.qaMaxRetries ?? 3),`

- [ ] Task 6: Update CodexProvider (AC: 2, 3, 6)
  - [ ] 6.1: In `src/ai-routing/providers/codex.provider.ts`, remove line 44: `const QA_MAX_RETRIES = '3';`
  - [ ] 6.2: Replace line 62 `QA_MAX_RETRIES,` (shorthand) with `QA_MAX_RETRIES: String(payload.qaMaxRetries ?? 3),`

- [ ] Task 7: Update KimiProvider (AC: 2, 3, 6)
  - [ ] 7.1: In `src/ai-routing/providers/kimi.provider.ts`, remove line 44: `const QA_MAX_RETRIES = '3';`
  - [ ] 7.2: Replace line 62 `QA_MAX_RETRIES,` with `QA_MAX_RETRIES: String(payload.qaMaxRetries ?? 3),`

- [ ] Task 8: Update GeminiProvider (AC: 2, 3, 6)
  - [ ] 8.1: In `src/ai-routing/providers/gemini.provider.ts`, remove line 44: `const QA_MAX_RETRIES = '3';`
  - [ ] 8.2: Replace line 62 `QA_MAX_RETRIES,` with `QA_MAX_RETRIES: String(payload.qaMaxRetries ?? 3),`

- [ ] Task 9: Update provider tests (AC: 7)
  - [ ] 9.1: In `src/ai-routing/providers/claude-code.provider.spec.ts` — update existing `QA_MAX_RETRIES: '3'` assertion (line 184) to assert `QA_MAX_RETRIES: '3'` when `mockPayload` has no `qaMaxRetries` (covers AC-3 fallback)
  - [ ] 9.2: Add new test in ClaudeCodeProvider spec: `{ ...mockPayload, qaMaxRetries: 5 }` → asserts `QA_MAX_RETRIES: '5'` in env (covers AC-1)
  - [ ] 9.3: In `src/ai-routing/providers/codex.provider.spec.ts` — same pattern: existing assertion covers fallback; add new test with `qaMaxRetries: 7` → `QA_MAX_RETRIES: '7'`
  - [ ] 9.4: In `src/ai-routing/providers/kimi.provider.spec.ts` — same pattern
  - [ ] 9.5: In `src/ai-routing/providers/gemini.provider.spec.ts` — same pattern

- [ ] Task 10: Add orchestrator service test for qaMaxRetries propagation (AC: 5, 7)
  - [ ] 10.1: In `src/ai-routing/orchestrator.service.spec.ts`, add the following complete test inside the existing `describe('execute')` block (it requires the same mock setup as sibling tests):

    ```typescript
    it('should pass qaMaxRetries from input through to execution payload', async () => {
      providerFactory.selectProvider.mockResolvedValue({
        primary: AIProvider.CLAUDE_CODE,
        fallback: null,
        reason: ProviderSelectionReason.COMPLEXITY,
        complexityScore: 5,
        complexityGrade: ComplexityGrade.MEDIUM,
      });
      providerFactory.getCodingProvider.mockReturnValue({
        providerName: 'claude-code',
        isEnabled: true,
        execute: jest.fn(),
        isHealthy: jest.fn().mockResolvedValue(true),
      } as any);
      fallbackStrategy.executeWithFallbackCodingProvider.mockResolvedValue({
        result: {
          success: true,
          codeDiff: 'diff',
          filesChanged: ['src/foo.ts'],
          confidenceScore: 0.9,
          durationMs: 10000,
          workspacePath: '/tmp/ws',
        },
        executedBy: AIProvider.CLAUDE_CODE,
        usedFallback: false,
        fallbackAttempts: [],
      });

      await service.execute({ ...mockInput, qaMaxRetries: 7 });

      expect(fallbackStrategy.executeWithFallbackCodingProvider).toHaveBeenCalledWith(
        expect.any(Object), // primary ICodingAgentProvider
        null, // no fallback
        expect.objectContaining({ qaMaxRetries: 7 }),
      );
    });
    ```

- [ ] Task 11: Run verification (AC: 6, 7)
  - [ ] 11.1: Run `grep -rn "QA_MAX_RETRIES.*=.*'3'" src/` — must return zero matches. If any `.spec.ts` files surface (test fixtures asserting `'3'`), those are AC-3 fallback coverage — they are correct and should remain
  - [ ] 11.2: Run `pnpm test -- --testPathPattern="claude-code.provider|codex.provider|kimi.provider|gemini.provider|orchestrator.service"` — all green
  - [ ] 11.3: Run `pnpm typecheck` — zero errors

---

## Dev Notes

### THIS STORY SCOPE — WR-5.2 ONLY

This story is purely about **wiring** the already-completed schema field (`qa_max_retries` from WR-5.1) through the execution pipeline into each provider's sandbox env. No new DB migrations. No new API endpoints. No DTO changes.

WR-5.1 (already `ready-for-dev`) adds the DB column and settings API. This story reads that value and passes it to providers.

### Exact Architecture Flow (Read This Before Touching Any Code)

The value travels through 4 layers. Add it at each layer in order:

```
Project.qa_max_retries (DB, set by WR-5.1)
         ↓
ticket.project.qa_max_retries
         ↓ (OrchestratorConsumer.processMessage)
IOrchestrationInput.qaMaxRetries
         ↓ (OrchestratorService.buildExecutionPayload)
IAIExecutionPayload.qaMaxRetries
         ↓ (provider.execute(payload))
env.QA_MAX_RETRIES = String(payload.qaMaxRetries ?? 3)
```

The `OrchestratorConsumer` already fetches the project record at line 106:

```typescript
const ticket = await this.prisma.ticket.findUnique({
  where: { id: ticketId },
  include: { project: true }, // <-- project already included
});
```

`ticket?.project?.qa_max_retries` is available for free. No new DB query.

### Exact Code Changes — Provider Pattern (All 4 Providers)

**ClaudeCodeProvider** (`src/ai-routing/providers/claude-code.provider.ts` line 59):

```typescript
// BEFORE:
QA_MAX_RETRIES: '3',

// AFTER:
QA_MAX_RETRIES: String(payload.qaMaxRetries ?? 3),
```

**CodexProvider** (`src/ai-routing/providers/codex.provider.ts`):

```typescript
// BEFORE (line 44):
const QA_MAX_RETRIES = '3';
// ...
// BEFORE (line 62):
QA_MAX_RETRIES,

// AFTER: Remove the const declaration entirely.
// Change the env entry to:
QA_MAX_RETRIES: String(payload.qaMaxRetries ?? 3),
```

**KimiProvider** (`src/ai-routing/providers/kimi.provider.ts`) — identical pattern to Codex:

- Remove `const QA_MAX_RETRIES = '3';` at line 44
- Replace `QA_MAX_RETRIES,` shorthand at line 62 with `QA_MAX_RETRIES: String(payload.qaMaxRetries ?? 3),`

**GeminiProvider** (`src/ai-routing/providers/gemini.provider.ts`) — identical pattern to Codex:

- Remove `const QA_MAX_RETRIES = '3';` at line 44
- Replace `QA_MAX_RETRIES,` shorthand at line 62 with `QA_MAX_RETRIES: String(payload.qaMaxRetries ?? 3),`

### OrchestratorConsumer Change (line ~127)

```typescript
// BEFORE:
const input: IOrchestrationInput = {
  correlationId,
  executionId,
  ticketId,
  prompt: promptResult.prompt,
  repositoryUrl,
  baseBranch,
  allowFallback: true,
};

// AFTER:
const input: IOrchestrationInput = {
  correlationId,
  executionId,
  ticketId,
  prompt: promptResult.prompt,
  repositoryUrl,
  baseBranch,
  allowFallback: true,
  qaMaxRetries: ticket?.project?.qa_max_retries, // WR-5.2
};
```

Note: Optional chaining (`?.`) already returns `undefined` when any segment is absent — no extra `?? undefined` needed. The value is simply absent from the payload if the project record is missing, which is the correct behaviour (providers then apply their own `?? 3` fallback).

### OrchestratorService.buildExecutionPayload Change (line ~82)

```typescript
// BEFORE:
private buildExecutionPayload(
  input: IOrchestrationInput,
  complexityScore: number,
  resolvedProvider: AIProvider,
): IAIExecutionPayload {
  return {
    ...
    complexityScore,
  };
}

// AFTER — add qaMaxRetries alongside complexityScore:
    complexityScore,
    qaMaxRetries: input.qaMaxRetries,   // WR-5.2: undefined propagates as-is; providers use ?? 3
```

### Why `String(payload.qaMaxRetries ?? 3)` Not `payload.qaMaxRetries?.toString() ?? '3'`

- `String(undefined)` = `'undefined'` — do NOT use this
- `String(payload.qaMaxRetries ?? 3)` = `String(3)` = `'3'` when undefined — correct fallback
- `payload.qaMaxRetries?.toString() ?? '3'` also works but is more verbose
- Use `String(payload.qaMaxRetries ?? 3)` — consistent with the numeric fallback value being `3` not `'3'`

### Interface Changes (Additive Only)

**`src/execution/interfaces/queue.interface.ts`** — add after `complexityScore?`:

```typescript
/** Per-project QA retry limit — populated from Project.qa_max_retries at dispatch time (WR-5.2) */
qaMaxRetries?: number;
```

**`src/ai-routing/interfaces/orchestration.interface.ts`** — add to `IOrchestrationInput` after `routingConfig?`:

```typescript
/** Per-project QA retry limit from Project.qa_max_retries (WR-5.2) */
qaMaxRetries?: number;
```

Both are `?` optional — existing callers compile without changes (NFR-EXT8).

**On `null` reaching providers:** `IAIExecutionPayload.qaMaxRetries` is typed as `number | undefined` — `null` is not in the type. `Project.qa_max_retries` in the DB is `Int @default(3)` (non-nullable), so null cannot enter the pipeline. Do NOT add a null guard in providers — it's redundant and adds noise.

### Test Pattern for Provider Specs

All 4 provider specs follow the same structure. For each:

```typescript
// Existing test — rename its description to make the fallback intent explicit.
// E.g. in claude-code.provider.spec.ts the existing test is
// "should run full agentic workflow and parse structured output" (line ~174).
// You can rename it OR add a separate focused test:
it('should default QA_MAX_RETRIES to 3 when qaMaxRetries not in payload', async () => {
  // mockPayload has no qaMaxRetries — default applies
  await provider.execute(mockPayload);
  expect(sandboxService.runAgentCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      env: expect.objectContaining({
        QA_MAX_RETRIES: '3',
      }),
    }),
  );
});

// New test — add in the same describe('execute') block:
it('should pass qaMaxRetries from payload as QA_MAX_RETRIES env var', async () => {
  await provider.execute({ ...mockPayload, qaMaxRetries: 5 });
  expect(sandboxService.runAgentCommand).toHaveBeenCalledWith(
    expect.objectContaining({
      env: expect.objectContaining({
        QA_MAX_RETRIES: '5',
      }),
    }),
  );
});
```

### Orchestrator Service Test

In `orchestrator.service.spec.ts`, add to the existing `describe('execute')` block:

```typescript
it('should include qaMaxRetries from input in execution payload', async () => {
  const inputWithRetries: IOrchestrationInput = { ...mockInput, qaMaxRetries: 7 };
  await orchestratorService.execute(inputWithRetries);

  expect(fallbackStrategy.executeWithFallbackCodingProvider).toHaveBeenCalledWith(
    expect.any(Object), // primary provider
    expect.any(Object), // fallback provider
    expect.objectContaining({ qaMaxRetries: 7 }),
  );
});
```

Note: Check the actual `fallbackStrategy.executeWithFallbackCodingProvider` mock in `orchestrator.service.spec.ts` to confirm the arg order and the mock setup pattern before writing this test.

### NFR-EXT7: In-Flight Execution Isolation

Because `qaMaxRetries` is captured into the `IAIExecutionPayload` at the moment the message is enqueued (dispatch time), changing the project's `qa_max_retries` in the DB **while an execution is running** has no effect on that execution — the message already carries the value. This satisfies NFR-EXT7 with zero extra code.

### Anti-Pattern Prevention

1. **Do NOT inject `ProjectRepository` or `ProjectService` into providers.** Providers are stateless sandbox launchers — they must not know about project schemas. The `projectId` is already in the payload for logging only; fetch project data upstream in the consumer.
2. **Do NOT add a DB call inside `OrchestratorService`** — the project record is already available from the consumer's existing `prisma.ticket.findUnique()` call with `include: { project: true }`.
3. **Do NOT change `PublishExecutionDto` or `AIExecutionPublisher`** — the publisher path does not have project context. Only the `OrchestratorConsumer` path (which handles the actual execution) needs to populate this.
4. **Do NOT use `|| 3` instead of `?? 3`** — `|| 3` would incorrectly replace `0` with `3`. Use `?? 3` (nullish coalescing) to only replace `null`/`undefined`.
5. **Do NOT rename the env var** — the sandbox agents expect exactly `QA_MAX_RETRIES`. Do not change the key name.
6. **Do NOT add `@Min`/`@Max` guards in providers** — validation belongs in the settings API (WR-5.1). Providers trust the value from the payload.

### Files to Touch (Complete List)

| File                                                    | Change                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/execution/interfaces/queue.interface.ts`           | Add `qaMaxRetries?: number` to `IAIExecutionPayload`                                   |
| `src/ai-routing/interfaces/orchestration.interface.ts`  | Add `qaMaxRetries?: number` to `IOrchestrationInput`                                   |
| `src/ai-routing/orchestrator.consumer.ts`               | Pass `ticket?.project?.qa_max_retries` into input                                      |
| `src/ai-routing/orchestrator.service.ts`                | Include `qaMaxRetries: input.qaMaxRetries` in `buildExecutionPayload()`                |
| `src/ai-routing/providers/claude-code.provider.ts`      | Replace `QA_MAX_RETRIES: '3'` with `String(payload.qaMaxRetries ?? 3)`                 |
| `src/ai-routing/providers/codex.provider.ts`            | Remove `const QA_MAX_RETRIES = '3'`; inline `String(payload.qaMaxRetries ?? 3)` in env |
| `src/ai-routing/providers/kimi.provider.ts`             | Same as Codex                                                                          |
| `src/ai-routing/providers/gemini.provider.ts`           | Same as Codex                                                                          |
| `src/ai-routing/providers/claude-code.provider.spec.ts` | Update existing test + add qaMaxRetries: 5 test                                        |
| `src/ai-routing/providers/codex.provider.spec.ts`       | Same pattern                                                                           |
| `src/ai-routing/providers/kimi.provider.spec.ts`        | Same pattern                                                                           |
| `src/ai-routing/providers/gemini.provider.spec.ts`      | Same pattern                                                                           |
| `src/ai-routing/orchestrator.service.spec.ts`           | Add qaMaxRetries propagation test                                                      |

**DO NOT TOUCH:** `prisma/schema.prisma`, any DTO, any migration file, `project.service.ts`, `project.controller.ts` — those are WR-5.1 territory.

### Previous Story Context (WR-5.1)

WR-5.1 adds `qa_max_retries Int @default(3)` to the `Project` Prisma model and exposes it via `PATCH /api/v1/projects/:id/qa-status-config`. After WR-5.1 is applied:

- `ticket?.project?.qa_max_retries` will be a `number` (3 by default for all existing projects)
- The Prisma client will type it as `number` on the project object

Until WR-5.1 migration is applied, `ticket?.project?.qa_max_retries` will be `undefined` (old schema). The `?? undefined` fallback in the consumer ensures this is safe — providers will use `?? 3` and default correctly.

**If WR-5.1 has not yet been merged**, the Prisma-generated client won't have `qa_max_retries` on the `Project` type yet, causing a TypeScript compile error on `ticket?.project?.qa_max_retries`. In that case use `(ticket?.project as Record<string, unknown>)?.qa_max_retries as number | undefined` as a **strictly temporary** workaround. **This cast MUST be removed before code review — it is a compile-error bypass, not a feature.** The correct solution is to implement WR-5.1 first (run `pnpm db:generate` after applying its migration), then implement WR-5.2 against the updated Prisma client. If you see this cast still present at review time, reject the PR.

**Preferred order:** Implement and merge WR-5.1 → run `pnpm db:generate` → implement WR-5.2 cleanly with no casts.

### References

- FR-EXT2: All 4 providers read `qaMaxRetries` from project record — `_bmad-output/planning-artifacts/epics-workspace-removal-extensions.md` Story WR-5.2 ACs
- NFR-EXT7: In-flight executions unaffected — same file
- NFR-EXT8: Additive only — same file
- Provider files: `src/ai-routing/providers/{claude-code,codex,kimi,gemini}.provider.ts` — hardcoded `'3'` at line 44 or 59
- Payload interface: `src/execution/interfaces/queue.interface.ts` line 28
- Orchestration input: `src/ai-routing/interfaces/orchestration.interface.ts` line 64
- Consumer project fetch: `src/ai-routing/orchestrator.consumer.ts` lines 106–114
- Payload builder: `src/ai-routing/orchestrator.service.ts` lines 77–97
- WR-5.1 (prerequisite): `_bmad-output/implementation-artifacts/wr-5-1-add-qa-max-retries-to-project-schema-and-settings-api.md`

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
