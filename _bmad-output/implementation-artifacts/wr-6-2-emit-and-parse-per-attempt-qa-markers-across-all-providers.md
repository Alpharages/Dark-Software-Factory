# Story WR-6.2: Emit & Parse Per-Attempt QA Markers Across All Providers

Status: ready-for-dev

<!-- Depends on WR-6.1 being complete (QAAttempt interface + qa_attempts DB column must exist first) -->

## Story

As a **platform engineer**,
I want the `dsf-execution` SKILL.md to emit `qa_attempt` JSON markers to stdout at the end of each QA attempt, and all 4 providers to parse those markers into a `qaAttempts` array,
so that per-attempt QA history is captured at the source for every provider.

## Acceptance Criteria

**AC-1: SKILL.md emits qa_attempt marker at the end of each QA attempt**
Given the `dsf-execution` SKILL.md defines the QA self-healing loop
When it is updated
Then it emits a `{"type":"qa_attempt",...}` JSON line to stdout at the end of each QA attempt (both on failure and on final pass) with this exact shape:

```json
{
  "type": "qa_attempt",
  "attempt": 1,
  "lintPassed": false,
  "lintErrors": { "count": 3, "details": [] },
  "testsPassed": false,
  "testResults": { "passed": 5, "failed": 2, "details": [] },
  "durationMs": 4200
}
```

**AC-2: ClaudeCodeProvider parses qa_attempt markers**
Given `ClaudeCodeProvider` is parsing stdout lines in `onStdoutLine`
When a line parses as valid JSON with `"type":"qa_attempt"`
Then the attempt data is mapped to a `QAAttempt` object (mapping `"attempt"` → `attemptNumber`) and appended to an in-memory `qaAttempts` array
And `qaAttempts` (or `undefined` if empty) is included in the returned `IAIExecutionResult`

**AC-3: Codex, Kimi, and Gemini providers parse qa_attempt markers identically**
Given the same `onStdoutLine` logic is applied to `CodexProvider`, `KimiProvider`, and `GeminiProvider`
When `qa_attempt` markers are received
Then all 3 providers accumulate and return `qaAttempts` identically to `ClaudeCodeProvider`

**AC-4: Non-qa_attempt lines and parse errors are silently skipped**
Given a stdout line fails JSON parsing or has `"type"` other than `"progress"`, `"result"`, or `"qa_attempt"`
When the line is processed
Then it is logged at debug level and silently skipped — the execution never crashes and `qaAttempts` is never corrupted (NFR-EXT6)

**AC-5: qaAttempts is bounded by qaMaxRetries**
Given `qaMaxRetries` is set to 3 for a project and the agent exhausts all 3 retries
When execution completes
Then `qaAttempts` contains exactly 3 entries — bounded by `qaMaxRetries` (NFR-EXT3)

**AC-6: Build and existing tests remain clean**
Given all changes applied
When `pnpm build` and `pnpm test` run
Then zero TypeScript errors exist and all existing provider tests still pass
And new tests cover `qa_attempt` parsing for all 4 providers

---

## Tasks / Subtasks

- [ ] Task 1: Update SKILL.md to emit qa_attempt markers (AC: 1)
  - [ ] 1.1: In `docker/skills/dsf-execution/SKILL.md`, locate **Step 4: QA Self-Healing Loop**
  - [ ] 1.2: Change the QA run from a single chained command to two separate commands so the agent can determine per-step outcomes independently:
    ```
    Instead of: pnpm lint && pnpm test
    Use:        Run pnpm lint first, capture whether it passed or failed and the error count.
                Then run pnpm test, capture whether it passed or failed, the pass count, and the fail count.
    ```
    Add this instruction to Step 4 so the sandbox agent runs them sequentially and independently.
  - [ ] 1.3: Add instructions to Step 4 to record the attempt start time at the beginning of each QA run using `QA_START_MS=$(date +%s%3N)`.
  - [ ] 1.4: After each QA attempt completes (both on failure AND on final pass, including the first attempt if it passes), add this instruction to Step 4:

    ```
    Compute QA_DURATION_MS = current_time_ms - QA_START_MS.
    Emit a qa_attempt JSON line to stdout with:
      - type: "qa_attempt"
      - attempt: current attempt number (1-based: first run = 1, first retry = 2, etc.)
      - lintPassed: true/false (JSON boolean)
      - lintErrors: { "count": <N>, "details": [] }  (count = 0 and field omittable when lintPassed is true)
      - testsPassed: true/false (JSON boolean; if lint failed and tests were skipped, set testsPassed: false)
      - testResults: { "passed": <N>, "failed": <N>, "details": [] }  (counts = 0 when tests were skipped)
      - durationMs: QA_DURATION_MS

    Example:
    {"type":"qa_attempt","attempt":1,"lintPassed":false,"lintErrors":{"count":3,"details":[]},"testsPassed":false,"testResults":{"passed":0,"failed":0,"details":[]},"durationMs":4200}
    ```

  - [ ] 1.5: The emit timing relative to other output:
    - Initial QA run (attempt 1): emit `qa_attempt` AFTER the QA result is known, BEFORE entering the retry loop
    - Each retry (attempts 2..N): emit `qa_attempt` AFTER re-running QA, BEFORE the next "retrying (N/3)" progress line
    - Final passing run: emit `qa_attempt` BEFORE Step 5 (Commit)
    - If QA passes on first attempt (no retries): still emit exactly 1 `qa_attempt` marker with `lintPassed: true, testsPassed: true`

- [ ] Task 2: Update ClaudeCodeProvider to parse qa_attempt markers (AC: 2, 4, 6)
  - [ ] 2.1: In `src/ai-routing/providers/claude-code.provider.ts`, add `QAAttempt` to the existing import:
    ```typescript
    import { IAIExecutionResult, AIErrorCode, QAAttempt } from '@/ai-routing/interfaces';
    ```
  - [ ] 2.2: Before the `let agentResult = {}` declaration, add a separate accumulator:
    ```typescript
    const qaAttempts: QAAttempt[] = [];
    ```
  - [ ] 2.3: In the `onStdoutLine` callback, add a new `else if` branch **after** the existing `else if (parsed.type === 'result')` block. The full branch including the required NFR-EXT6 malformed-line guard:
    ```typescript
    } else if (parsed.type === 'qa_attempt') {
      // Double-cast via unknown required: parsed is typed as { type?, pct?, msg? }
      // which has no overlap with the qa_attempt shape — strict mode rejects a direct cast.
      const a = parsed as unknown as {
        attempt: number;
        lintPassed: boolean;
        lintErrors?: { count: number; details: unknown[] };
        testsPassed: boolean;
        testResults?: { passed: number; failed: number; details: unknown[] };
        durationMs: number;
      };
      // NFR-EXT6: guard against malformed lines — only push if all required fields are present
      if (
        typeof a.attempt === 'number' &&
        typeof a.lintPassed === 'boolean' &&
        typeof a.testsPassed === 'boolean' &&
        typeof a.durationMs === 'number'
      ) {
        qaAttempts.push({
          attemptNumber: a.attempt,   // "attempt" in stdout → "attemptNumber" in interface
          lintPassed: a.lintPassed,
          lintErrors: a.lintErrors,
          testsPassed: a.testsPassed,
          testResults: a.testResults,
          durationMs: a.durationMs,
        });
        this.logger.debug(
          `[${executionId}] QA attempt ${a.attempt} captured: lint=${a.lintPassed}, tests=${a.testsPassed}`,
        );
      } else {
        this.logger.debug(
          `[${executionId}] qa_attempt line malformed — skipped`,
        );
      }
    }
    ```
  - [ ] 2.4: `ClaudeCodeProvider` has a **single** `return` statement (not two separate paths). Add `qaAttempts` to this one return, immediately after `qaRetryCount`:
    ```typescript
    qaRetryCount: agentResult.qaRetryCount,
    qaAttempts: qaAttempts.length > 0 ? qaAttempts : undefined,
    ```

- [ ] Task 3: Update CodexProvider to parse qa_attempt markers (AC: 3, 4, 6)
  - [ ] 3.1: In `src/ai-routing/providers/codex.provider.ts`, update the existing import to add `QAAttempt`:
    ```typescript
    import { IAIExecutionResult, AIErrorCode, QAAttempt } from '@/ai-routing/interfaces';
    ```
  - [ ] 3.2: Add `const qaAttempts: QAAttempt[] = [];` before `let agentResult = {}`
  - [ ] 3.3: Add `qa_attempt` parsing to `onStdoutLine` — identical pattern to ClaudeCode (Task 2.3), with:
    - `parsed as unknown as { ... }` double-cast (required for the same strict-mode reason)
    - The same NFR-EXT6 `typeof` guard before pushing
    - Debug log: ``this.logger.debug(`[CodexProvider] QA attempt ${a.attempt} captured: lint=${a.lintPassed}, tests=${a.testsPassed}`)``
    - Malformed log: ``this.logger.debug(`[CodexProvider] qa_attempt line malformed — skipped`)``
  - [ ] 3.4: `CodexProvider` has **two** return statements (failure path and success path). Add `qaAttempts: qaAttempts.length > 0 ? qaAttempts : undefined` to **both**, after `qaRetryCount`

- [ ] Task 4: Update KimiProvider to parse qa_attempt markers (AC: 3, 4, 6)
  - [ ] 4.1: In `src/ai-routing/providers/kimi.provider.ts`, update the import:
    ```typescript
    import {
      IAIExecutionResult,
      AIErrorCode,
      QAAttempt,
    } from '../interfaces/ai-provider.interface';
    ```
  - [ ] 4.2: Add `const qaAttempts: QAAttempt[] = [];` before `let agentResult = {}`
  - [ ] 4.3: Add `qa_attempt` parsing to `onStdoutLine` — identical pattern to Task 2.3, with `[KimiProvider]` prefix in debug/malformed log lines
  - [ ] 4.4: `KimiProvider` has **two** return statements. Add `qaAttempts: qaAttempts.length > 0 ? qaAttempts : undefined` to both, after `qaRetryCount`

- [ ] Task 5: Update GeminiProvider to parse qa_attempt markers (AC: 3, 4, 6)
  - [ ] 5.1: In `src/ai-routing/providers/gemini.provider.ts`, update the import:
    ```typescript
    import {
      IAIExecutionResult,
      AIErrorCode,
      QAAttempt,
    } from '../interfaces/ai-provider.interface';
    ```
  - [ ] 5.2: Add `const qaAttempts: QAAttempt[] = [];` before `let agentResult = {}`
  - [ ] 5.3: Add `qa_attempt` parsing to `onStdoutLine` — identical pattern to Task 2.3, with `[GeminiProvider]` prefix in debug/malformed log lines
  - [ ] 5.4: `GeminiProvider` has **two** return statements. Add `qaAttempts: qaAttempts.length > 0 ? qaAttempts : undefined` to both, after `qaRetryCount`

- [ ] Task 6: Add unit tests (AC: 6)
  - [ ] 6.1: In `src/ai-routing/providers/claude-code.provider.spec.ts`, add `QAAttempt` to the import:
    ```typescript
    import { AIErrorCode, QAAttempt } from '@/ai-routing/interfaces';
    ```
    Then add a `describe('qa_attempt parsing', () => { ... })` block inside the main `describe('execute', ...)` with these tests:
    - **Single qa_attempt populates result**: mock `onStdoutLine` emitting one `qa_attempt` line + the usual `result` line. Assert `result.qaAttempts` has length 1 and `result.qaAttempts[0].attemptNumber === 1` (verifies `attempt` → `attemptNumber` mapping).
    - **Multiple qa_attempt lines accumulate in order**: emit 2 `qa_attempt` lines (attempts 1 and 2). Assert array has 2 entries with correct `attemptNumber` values.
    - **No qa_attempt lines → qaAttempts is undefined**: existing mock (no `qa_attempt` lines). Assert `result.qaAttempts === undefined` (not `[]`).
    - **Malformed qa_attempt (missing required fields) is skipped without crash**: emit `{"type":"qa_attempt","attempt":"bad"}` (wrong type for attempt). Assert no throw, `result.qaAttempts === undefined`.
    - **Non-JSON line does not corrupt qaAttempts**: emit a raw text line followed by a valid `qa_attempt` line. Assert `result.qaAttempts` still has 1 entry.
  - [ ] 6.2: Add equivalent tests to `codex.provider.spec.ts`, `kimi.provider.spec.ts`, `gemini.provider.spec.ts`. Import `QAAttempt` in each spec file using the same pattern as the provider's own import (`@/ai-routing/interfaces` for Codex, `'../interfaces/ai-provider.interface'` for Kimi/Gemini).
  - [ ] 6.3: Run `pnpm test -- --testPathPattern="provider\.spec"` — all 4 provider specs must pass

- [ ] Task 7: Verify build (AC: 6)
  - [ ] 7.1: Run `pnpm typecheck` — zero errors
  - [ ] 7.2: Run `pnpm build` — completes successfully
  - [ ] 7.3: Run `pnpm test -- --testPathPattern="provider\.spec"` — all pass

---

## Dev Notes

### PREREQUISITE: WR-6.1 MUST BE COMPLETE

This story requires the `QAAttempt` interface to exist in `src/ai-routing/interfaces/ai-provider.interface.ts` and be exported from `src/ai-routing/interfaces/index.ts` (barrel). If `QAAttempt` is not there, TypeScript will fail immediately on import. Do NOT proceed until WR-6.1 is committed and the build passes cleanly.

### Exactly ONE SKILL.md — All 4 Providers Share It

The SKILL.md at `docker/skills/dsf-execution/SKILL.md` is the single agentic workflow definition used by all 4 providers:

- ClaudeCode: `claude --dangerously-skip-permissions -p "/dsf-execution"` — reads SKILL.md as a slash command
- Codex: `codex execute dsf-execution`
- Kimi: `kimi execute dsf-execution`
- Gemini: `gemini execute dsf-execution`

There are **no separate Codex/Kimi/Gemini system prompt files**. Updating the one SKILL.md covers all 4 providers on the agent side.

### Field Name Mismatch: "attempt" → "attemptNumber"

The SKILL.md emits `"attempt": N` (short name for stdout compactness), but the `QAAttempt` TypeScript interface uses `attemptNumber: number`. The provider must map explicitly:

```typescript
qaAttempts.push({
  attemptNumber: a.attempt,   // ← REQUIRED field rename
  ...
});
```

If you cast `parsed as QAAttempt` directly, `attemptNumber` is silently `undefined` at runtime — TypeScript won't catch this because the property names differ.

### Why `parsed as unknown as { ... }` (double-cast)

`parsed` inside `onStdoutLine` is typed as `{ type?: string; pct?: number; msg?: string }`. TypeScript strict mode rejects a direct cast to `{ attempt: number; ... }` because the types have no overlap. The standard fix is the two-step cast through `unknown`:

```typescript
const a = parsed as unknown as { attempt: number; lintPassed: boolean; ... };
```

A direct `parsed as { attempt: number; ... }` will produce a TypeScript error in strict mode. `unknown` is the safe escape hatch — it forces you to prove your intent.

### Separate qaAttempts Array — NOT inside agentResult

```typescript
const qaAttempts: QAAttempt[] = [];
let agentResult: { ... } = {};
```

Do NOT add `qaAttempts` to the `agentResult` type. The reason: Codex/Kimi/Gemini do `agentResult = { ...agentResult, ...r }` when a `result` line arrives. If `qaAttempts` were inside `agentResult`, the spread from a `result` line (which has no `qaAttempts`) would reset the accumulated array to `undefined`.

### ClaudeCode Has ONE Return Statement — Not Two

`ClaudeCodeProvider.execute()` ends with a **single** `return` that uses a conditional spread for the error path:

```typescript
return {
  ...
  qaRetryCount: agentResult.qaRetryCount,
  qaAttempts: qaAttempts.length > 0 ? qaAttempts : undefined,  // ← add here
  ...(agenticSuccess ? {} : { error: {...} }),
};
```

Tasks 3.4, 4.4, 5.4 correctly say "two return statements" — that applies to Codex/Kimi/Gemini (they have a failure `return` and a success `return`). ClaudeCode is different.

### Return undefined (not []) When No QA Attempts

```typescript
qaAttempts: qaAttempts.length > 0 ? qaAttempts : undefined,
```

WR-6.3 stores `null` for executions with no QA attempts. Returning `undefined` lets WR-6.3 use `qaAttempts ?? null` consistently. Do NOT return `[]`.

### Provider Import Path Differences

| Provider   | Import style | Import from                             |
| ---------- | ------------ | --------------------------------------- |
| ClaudeCode | barrel       | `@/ai-routing/interfaces`               |
| Codex      | barrel       | `@/ai-routing/interfaces`               |
| Kimi       | direct       | `'../interfaces/ai-provider.interface'` |
| Gemini     | direct       | `'../interfaces/ai-provider.interface'` |

The barrel re-exports everything from `ai-provider.interface`, so `QAAttempt` is available via both paths after WR-6.1.

### ClaudeCode Has No Fallback Stdout Scan

`ClaudeCodeProvider` only uses `onStdoutLine`. `CodexProvider`, `KimiProvider`, and `GeminiProvider` each have a fallback scan over `result.stdout.split('\n')` that looks for `type === 'result'`. Do NOT modify the fallback scan to accumulate `qa_attempt` lines — it is only for recovering a missed `result` line. All `qa_attempt` accumulation happens in `onStdoutLine` only.

### SKILL.md: Run Lint and Tests Separately

The current SKILL.md Step 4 runs `pnpm lint && pnpm test` as a chain. For the qa_attempt marker to correctly populate `lintPassed` and `testsPassed` independently, the sandbox agent must run them as separate commands so it can determine each outcome individually. If lint fails in a chain, `&&` short-circuits and tests never run — the agent would have to infer `testsPassed: false` from context rather than from actual test output. The SKILL.md update must explicitly instruct the agent to run them separately and capture each exit status.

### WR-5.2 Status (Do Not Conflate)

`ClaudeCodeProvider` already uses `String(payload.qaMaxRetries ?? 3)` for `QA_MAX_RETRIES` (WR-5.2 applied). `CodexProvider`, `KimiProvider`, and `GeminiProvider` still have `const QA_MAX_RETRIES = '3'` — that hardcoded literal is WR-5.2 work for those three. **Do NOT touch `QA_MAX_RETRIES` in any provider** in this story — WR-6.2 adds only `qa_attempt` parsing.

Existing test `QA_MAX_RETRIES: '3'` for ClaudeCode still passes: `mockPayload.qaMaxRetries` is `undefined` → `String(undefined ?? 3)` → `'3'`. No test update needed.

### Existing Tests — What Must Stay Green

The existing provider specs test `onStdoutLine` with `progress` + `result` lines only. Your changes add a new `else if` branch — the existing mocks don't emit `qa_attempt` lines, so they get `qaAttempts: undefined`, which is valid. All existing assertions pass unchanged.

### Files to Touch (Complete List)

| File                                                    | Change                                                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `docker/skills/dsf-execution/SKILL.md`                  | Add separate lint/test runs + `qa_attempt` emission to QA loop                                     |
| `src/ai-routing/providers/claude-code.provider.ts`      | Import `QAAttempt`, add `qaAttempts[]`, parse `qa_attempt` in `onStdoutLine`, add to single return |
| `src/ai-routing/providers/codex.provider.ts`            | Same; two return statements                                                                        |
| `src/ai-routing/providers/kimi.provider.ts`             | Same; two return statements; direct import path                                                    |
| `src/ai-routing/providers/gemini.provider.ts`           | Same; two return statements; direct import path                                                    |
| `src/ai-routing/providers/claude-code.provider.spec.ts` | Add `QAAttempt` import + `qa_attempt` parsing tests                                                |
| `src/ai-routing/providers/codex.provider.spec.ts`       | Same                                                                                               |
| `src/ai-routing/providers/kimi.provider.spec.ts`        | Same                                                                                               |
| `src/ai-routing/providers/gemini.provider.spec.ts`      | Same                                                                                               |

**DO NOT TOUCH:**

| File                                                 | Reason                                       |
| ---------------------------------------------------- | -------------------------------------------- |
| `src/ai-routing/interfaces/ai-provider.interface.ts` | WR-6.1 work — `QAAttempt` must already exist |
| `prisma/schema.prisma`                               | WR-6.1 work                                  |
| Any execution service, controller, or DTO            | WR-6.3 work                                  |
| Any existing migration file                          | Never edit past migrations                   |
| `src/ai-routing/providers/base-ai.provider.ts`       | Not modified in this story                   |

### Scope of This Story vs Adjacent Stories

- **WR-6.1 (prerequisite):** `QAAttempt` interface + `qa_attempts Json?` DB column
- **WR-6.2 (this story):** SKILL.md emits markers + all 4 providers parse them in-memory — **no DB writes**
- **WR-6.3 (next):** Persists `qaAttempts` to DB + exposes via execution detail API

Providers return `qaAttempts` in `IAIExecutionResult` but nothing reads it yet — WR-6.3 will pick it up. This is intentional.

### References

- FR-EXT5: SKILL.md + all provider prompts emit `qa_attempt` markers — `_bmad-output/planning-artifacts/epics-workspace-removal-extensions.md`
- FR-EXT6: All 4 providers parse markers into `qaAttempts` — same file
- NFR-EXT3: Bounded by `qaMaxRetries` (max 10 × fixed shape) — same file
- NFR-EXT6: Parse errors silently skipped at debug level — same file
- SKILL.md: `docker/skills/dsf-execution/SKILL.md`
- Interface file: `src/ai-routing/interfaces/ai-provider.interface.ts`

---

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
