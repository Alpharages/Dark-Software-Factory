# Story WR-3.1: Wire All Execution Milestones to Progress Bar

Status: done

## Story

As a **PM watching an execution**,
I want the progress bar to advance through at least 7 named milestones as the agent works (clone → implement → QA → push → PR → done),
So that I can see the execution is alive and know exactly which phase the agent is in at any moment.

## Acceptance Criteria

**AC-1: All 8 happy-path milestones trigger emitProgress()**
**Given** a sandbox execution is underway
**When** the agent emits progress markers to stdout
**Then** `ExecutionTrackerService.emitProgress(executionId, ticketId, projectId, msg, pct)` is called for each of the following milestones:

- 10% — "Budget check passed"
- 20% — "Cloning repository"
- 40% — "Implementing changes"
- 75% — "Implementation complete"
- 80% — "Running QA"
- 90% — "Pushing to GitHub"
- 95% — "Opening PR"
- 100% — "Done"

**AC-2: QA self-healing retry triggers emitProgress()**
**Given** a QA failure occurs during the self-healing loop
**When** the agent emits `{"type":"progress","pct":82,"msg":"QA failed — retrying (N/3)"}`
**Then** `emitProgress()` is called with the retry message (e.g. "QA failed — retrying (1/3)")
**And** each distinct retry message is treated as a step change → always emits regardless of rate limiter

**AC-3: Minimum 7 distinct emitProgress() calls on happy path (FR-WR7)**
**Given** a full happy-path execution completes (no QA retries)
**When** all 8 milestone markers are emitted by the SKILL.md
**Then** a minimum of 7 distinct `emitProgress()` calls are recorded in the provider spec
**And** this applies to all 4 providers (ClaudeCode, Codex, Kimi, Gemini)

**AC-4: Concurrent emitLog + emitProgress don't block each other (NFR-WR4)**
**Given** progress markers and human-readable lines are interleaved in stdout
**When** `SandboxService` calls `onStdoutLine` for each line
**Then** structured JSON lines route to `emitProgress()` AND all raw lines stream via `ExecutionGateway.emitLog()` simultaneously
**And** neither call blocks the other — fire-and-forget pattern preserved

**AC-5: Non-JSON lines silently skipped (NFR-WR4)**
**Given** the agent emits a mix of JSON progress lines and plain text
**When** `onStdoutLine` receives a non-JSON line
**Then** it is logged at debug level and skipped — `emitProgress()` is NOT called for that line
**And** the execution never crashes from a parse error

**AC-6: Build clean**
**Given** all test changes applied
**When** `pnpm test -- --testPathPattern="claude-code.provider|codex.provider|kimi.provider|gemini.provider"` runs
**Then** all tests pass (zero failures, zero TypeScript errors)

## Tasks / Subtasks

> **Context:** The `onStdoutLine` parsing that calls `emitProgress()` is already implemented in all 4 providers (WR-2.3 / WR-2.4). The SKILL.md already emits all 8 milestone markers. This story adds **comprehensive test coverage** that proves the wiring is correct for all 7+ milestones plus QA retry.
>
> **Scope update (2026-04-02 code review):** Production changes to `codex.provider.ts`, `gemini.provider.ts`, and `kimi.provider.ts` were accepted into this story's scope — `sandboxResult` → `agentResult` refactor, `isRetryable: timedOut || qaFailed` semantics (outer retry intentional), Kimi command string correction (`'kimi /dsf-execution'` → `'kimi execute dsf-execution'`), and `.catch()` error surfacing on `emitProgress`.

- [ ] Task 1: Update `claude-code.provider.spec.ts` — replace single-progress stub with full milestone sequence (AC: 1, 2, 3, 4, 5)
  - [ ] 1.1 Update the `beforeEach` `mockSandboxService.runAgentCommand` stub to emit all 8 milestone lines in order:
    ```
    10%  "Budget check passed"
    20%  "Cloning repository"
    40%  "Implementing changes"
    75%  "Implementation complete"
    80%  "Running QA"
    90%  "Pushing to GitHub"
    95%  "Opening PR"
    100% "Done"
    + final result line
    ```
    See `ClaudeCodeProvider Test: Full Milestone Mock Pattern` in Dev Notes for the exact implementation.
  - [ ] 1.2 Update `'should run full agentic workflow and parse structured output'` to:
    - Assert `emitProgress` called exactly 8 times (`toHaveBeenCalledTimes(8)`)
    - Spot-check first milestone: `('exec-456', 'ticket-123', 'proj-789', 'Budget check passed', 10)`
    - Spot-check last milestone: `('exec-456', 'ticket-123', 'proj-789', 'Done', 100)`
    - Add `onStdoutLine: expect.any(Function)` to the `runAgentCommand` options assertion (proves provider wired the concurrent stream callback — AC-4)
  - [ ] 1.3 Add `'should call emitProgress for QA retry milestone (pct:82)'` test: stub emits `pct:80 "Running QA"`, then `pct:82 "QA failed — retrying (1/3)"`, then a `qaStatus:'self_healed'` result line; assert:
    - `emitProgress` called with `('exec-456', 'ticket-123', 'proj-789', 'Running QA', 80)`
    - `emitProgress` called with `('exec-456', 'ticket-123', 'proj-789', 'QA failed — retrying (1/3)', 82)`
    - `result.success` is `true` and `result.qaStatus` is `'self_healed'`
  - [ ] 1.4 **DO NOT ADD** a non-JSON skip test — `'should ignore non-structured lines gracefully'` (line 244) already covers AC-5 for ClaudeCode. Verify it exists and passes; do not duplicate it.

- [ ] Task 2: Update `codex.provider.spec.ts` — add full milestone sequence test (AC: 1, 2, 3, 5)
  - [ ] 2.1 Add `'should call emitProgress for all 8 happy-path milestones in order'` test — use `mockImplementationOnce` to fire all 8 progress lines + result line; assert:
    - `mockExecutionTracker.emitProgress` called exactly 8 times
    - `toHaveBeenCalledWith(mockPayload.executionId, mockPayload.ticketId, mockPayload.projectId, 'Budget check passed', 10)`
    - `toHaveBeenCalledWith(mockPayload.executionId, mockPayload.ticketId, mockPayload.projectId, 'Done', 100)`
  - [ ] 2.2 Add `'should call emitProgress for QA self-healing retry message'` test — emit `pct:80 "Running QA"`, then `pct:82 "QA failed — retrying (1/3)"`, then `qaStatus:'self_healed'` result; assert both pct:80 and pct:82 calls plus `result.qaStatus === 'self_healed'`
  - [ ] 2.3 **DO NOT ADD** a non-JSON skip test — `'should silently skip non-JSON stdout lines without crashing'` (line 199) already exists and covers AC-5 for Codex.

- [ ] Task 3: Update `kimi.provider.spec.ts` — same tests as Task 2 (AC: 1, 2, 3, 5)
  - [ ] 3.1 Add `'should call emitProgress for all 8 happy-path milestones in order'` (same pattern as 2.1)
  - [ ] 3.2 Add `'should call emitProgress for QA self-healing retry message'` (same pattern as 2.2)
  - [ ] 3.3 **DO NOT ADD** non-JSON test — `'should silently skip non-JSON stdout lines without crashing'` (line 197) already exists for Kimi.

- [ ] Task 4: Update `gemini.provider.spec.ts` — same tests as Task 2 (AC: 1, 2, 3, 5)
  - [ ] 4.1 Add `'should call emitProgress for all 8 happy-path milestones in order'` (same pattern as 2.1)
  - [ ] 4.2 Add `'should call emitProgress for QA self-healing retry message'` (same pattern as 2.2)
  - [ ] 4.3 **DO NOT ADD** non-JSON test — `'should silently skip non-JSON stdout lines without crashing'` (line 198) already exists for Gemini.

- [ ] Task 5: Verify and run all tests (AC: 6)
  - [ ] 5.1 Confirm existing non-JSON tests still pass (not accidentally broken by beforeEach mock change in claude-code)
  - [ ] 5.2 `pnpm test -- --testPathPattern="claude-code.provider"` → green
  - [ ] 5.3 `pnpm test -- --testPathPattern="codex.provider|kimi.provider|gemini.provider"` → green
  - [ ] 5.4 `pnpm build` → zero TypeScript errors

## Dev Notes

### What Is Already Built (Do NOT re-implement)

All the wiring from stdout → emitProgress is **already implemented** in WR-2.3 and WR-2.4:

- `SandboxService.runAgentCommand()` accepts `onStdoutLine?: (line: string) => void` in `AgentCommandOptions` — **already there**
- `SandboxService` line-buffer splits stdout chunks on `\n` and calls `onStdoutLine` per complete line — **already there**
- All 4 providers have `onStdoutLine` that calls `emitProgress()` for `type:progress` JSON lines — **already there**
- SKILL.md at `docker/skills/dsf-execution/SKILL.md` already emits all 8 milestone markers at correct pct values — **do NOT change this file**
- `ExecutionGateway.emitLog()` is called by `SandboxService.onStdout` independently of `onStdoutLine` — **concurrent streaming already works**

This story is **test coverage only** — zero changes to provider `execute()` methods, SandboxService, or SKILL.md.

### emitProgress() Signature (5 args — exact order matters)

```typescript
// src/execution/execution-tracker.service.ts:L1178
async emitProgress(
  executionId: string,  // arg 1
  ticketId: string,     // arg 2
  projectId: string | null,  // arg 3
  currentStep: string,  // arg 4 — this is the msg from the progress line
  percentComplete: number,  // arg 5
  status?: string       // arg 6, optional, defaults to IN_PROGRESS
): Promise<void>
```

**Assertion form:**

```typescript
expect(executionTracker.emitProgress).toHaveBeenCalledWith(
  'exec-456', // executionId
  'ticket-123', // ticketId
  'proj-789', // projectId
  'Budget check passed', // msg from progress line
  10, // pct from progress line
);
```

### Rate Limiter: Step Changes ALWAYS Emit

`ExecutionTrackerService.emitProgress()` has a 500ms rate limiter, but it is **bypassed** whenever `currentStep !== lastStep`. Since each of the 8 milestones has a unique `msg`, each is a step change → **all 8 will always emit regardless of timing**. QA retry messages like `"QA failed — retrying (1/3)"` and `"QA failed — retrying (2/3)"` are also distinct → both emit. This is safe — no special handling needed in tests.

### The 8 SKILL.md Milestone Markers (Exact Strings)

From `docker/skills/dsf-execution/SKILL.md` — use these exact strings in test assertions:

| Step                | pct | msg                            |
| ------------------- | --- | ------------------------------ |
| Validation complete | 10  | `"Budget check passed"`        |
| Before clone        | 20  | `"Cloning repository"`         |
| Before implement    | 40  | `"Implementing changes"`       |
| After implement     | 75  | `"Implementation complete"`    |
| Before QA           | 80  | `"Running QA"`                 |
| QA retry (N=1..3)   | 82  | `"QA failed — retrying (N/3)"` |
| Before push         | 90  | `"Pushing to GitHub"`          |
| Before PR           | 95  | `"Opening PR"`                 |
| Before final result | 100 | `"Done"`                       |

### ClaudeCodeProvider Test: Full Milestone Mock Pattern

Replace the current `beforeEach` stub (which only fires `pct:50 "Halfway there"`) with this:

```typescript
const MILESTONE_LINES = [
  '{"type":"progress","pct":10,"msg":"Budget check passed"}',
  '{"type":"progress","pct":20,"msg":"Cloning repository"}',
  '{"type":"progress","pct":40,"msg":"Implementing changes"}',
  '{"type":"progress","pct":75,"msg":"Implementation complete"}',
  '{"type":"progress","pct":80,"msg":"Running QA"}',
  '{"type":"progress","pct":90,"msg":"Pushing to GitHub"}',
  '{"type":"progress","pct":95,"msg":"Opening PR"}',
  '{"type":"progress","pct":100,"msg":"Done"}',
];
const RESULT_LINE = JSON.stringify({
  type: 'result',
  prUrl: 'https://github.com/pr/1',
  commitSha: 'abc123',
  branchName: 'dsf/ticket-123/exec-456',
  qaStatus: 'passed',
  qaRetryCount: 0,
});

// In beforeEach mock:
runAgentCommand: jest.fn().mockImplementation(async (options) => {
  for (const line of MILESTONE_LINES) {
    options.onStdoutLine?.(line);
  }
  options.onStdoutLine?.(RESULT_LINE);
  const stdout = [...MILESTONE_LINES, RESULT_LINE].join('\n') + '\n';
  return { exitCode: 0, stdout, stderr: '', durationMs: 1500, timedOut: false, sandboxId: 'sbx-123' };
}),
```

**Assertion for full milestone test:**

```typescript
// Verify at least 7 distinct emitProgress calls
expect(executionTracker.emitProgress).toHaveBeenCalledTimes(8); // all 8 milestones
// Spot-check specific milestones:
expect(executionTracker.emitProgress).toHaveBeenCalledWith(
  'exec-456',
  'ticket-123',
  'proj-789',
  'Budget check passed',
  10,
);
expect(executionTracker.emitProgress).toHaveBeenCalledWith(
  'exec-456',
  'ticket-123',
  'proj-789',
  'Done',
  100,
);
```

### Codex/Kimi/Gemini Provider Test Pattern

> **Do NOT update the `beforeEach` mock for Codex/Kimi/Gemini.** Their existing `beforeEach` still fires `pct:50 "Testing..."` which serves the existing tests. New milestone tests use `mockImplementationOnce` which overrides the default mock for that specific test — the `beforeEach` mock is irrelevant inside a `mockImplementationOnce` block.

Use the same `MILESTONE_LINES` constant in new `mockImplementationOnce` blocks. The `emitProgress` call args differ only in executionId/ticketId/projectId (use `mockPayload` values):

```typescript
expect(mockExecutionTracker.emitProgress).toHaveBeenCalledTimes(8);
// executionId='exec-456', ticketId='ticket-123', projectId='proj-789' (use mockPayload values)
expect(mockExecutionTracker.emitProgress).toHaveBeenCalledWith(
  mockPayload.executionId,
  mockPayload.ticketId,
  mockPayload.projectId,
  'Budget check passed',
  10,
);
expect(mockExecutionTracker.emitProgress).toHaveBeenCalledWith(
  mockPayload.executionId,
  mockPayload.ticketId,
  mockPayload.projectId,
  'Done',
  100,
);
```

### QA Retry Test Pattern (all 4 providers)

```typescript
it('should call emitProgress for QA retry milestone (pct:82)', async () => {
  const retryLine = '{"type":"progress","pct":82,"msg":"QA failed — retrying (1/3)"}';
  const resultLine = JSON.stringify({
    type: 'result',
    prUrl: 'https://github.com/pr/1',
    commitSha: 'abc123',
    branchName: 'dsf/ticket-123/exec-456',
    qaStatus: 'self_healed',
    qaRetryCount: 1,
  });

  sandboxService.runAgentCommand.mockImplementationOnce(async (options) => {
    options.onStdoutLine?.('{"type":"progress","pct":80,"msg":"Running QA"}');
    options.onStdoutLine?.(retryLine);
    options.onStdoutLine?.(resultLine);
    return {
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 2000,
      timedOut: false,
      sandboxId: 'sbx',
    };
  });

  await provider.execute(mockPayload);

  expect(executionTracker.emitProgress).toHaveBeenCalledWith(
    'exec-456',
    'ticket-123',
    'proj-789',
    'QA failed — retrying (1/3)',
    82,
  );
  expect(executionTracker.emitProgress).toHaveBeenCalledWith(
    'exec-456',
    'ticket-123',
    'proj-789',
    'Running QA',
    80,
  );
});
```

### Non-JSON Lines Are Skipped (Already Tested — Exact Test Names)

These tests exist today — do NOT add duplicates:

| Provider   | Spec file                          | Existing test name                                              |
| ---------- | ---------------------------------- | --------------------------------------------------------------- |
| ClaudeCode | `claude-code.provider.spec.ts:244` | `'should ignore non-structured lines gracefully'`               |
| Codex      | `codex.provider.spec.ts:199`       | `'should silently skip non-JSON stdout lines without crashing'` |
| Kimi       | `kimi.provider.spec.ts:197`        | `'should silently skip non-JSON stdout lines without crashing'` |
| Gemini     | `gemini.provider.spec.ts:198`      | `'should silently skip non-JSON stdout lines without crashing'` |

Just confirm they pass in Task 5. Key assertion in those tests:

```typescript
// emitProgress is NOT called for 'this is plain text, not json' or '{ invalid json }'
// but IS called once for the valid result/progress line
```

### Concurrent Streaming: How It Works (No Code Change Needed)

`SandboxService.runAgentCommand()` has two independent paths in the `onStdout` callback:

```typescript
onStdout: (msg) => {
  stdoutBuffer += msg.text;
  this.executionGateway?.emitLog(executionId, ticketId, msg.text, 'stdout'); // path 1: always called
  if (options.onStdoutLine) {
    // path 2: per-line callback
    lineBuffer += msg.text;
    const parts = lineBuffer.split('\n');
    lineBuffer = parts.pop() ?? '';
    for (const line of parts) {
      if (line.trim()) options.onStdoutLine(line); // → emitProgress for type:progress
    }
  }
};
```

`emitLog` and `onStdoutLine` run synchronously in the same callback — neither blocks the other. The `emitLog` call happens BEFORE the line-buffer logic. This is already correct.

**Provider-level test for AC-4:** At the provider layer, the only thing to verify is that `onStdoutLine` is passed in the `runAgentCommand` options. The actual concurrent `emitLog` call is inside `SandboxService` (not the provider), so it's tested in `SandboxService` tests. Add `onStdoutLine: expect.any(Function)` to the `runAgentCommand` `expect.objectContaining(...)` assertion in Task 1.2. No separate test case needed — do NOT create a standalone "concurrent streaming" test in provider specs.

**Codex spec already has this pattern**: `codex.provider.spec.ts:180` asserts `onStdoutLine: expect.any(Function)` in the `runAgentCommand` call check. Add the same to ClaudeCode's Task 1.2 assertion.

### Project Structure Notes

- All spec files are in `src/ai-routing/providers/` — no new files created
- Use `@/` path aliases for all imports
- `ExecutionTrackerService` is at `@/execution/execution-tracker.service`
- `ai-routing.module.ts:L60` already imports `ExecutionModule` with `forwardRef` — no module changes needed

### References

- [Source: docker/skills/dsf-execution/SKILL.md] — exact milestone markers and pct values (Step 1 through Step 8)
- [Source: src/execution/execution-tracker.service.ts:L1178] — `emitProgress` 5-arg signature + rate-limit logic (step change always emits)
- [Source: src/ai-routing/providers/claude-code.provider.spec.ts] — existing test structure to extend
- [Source: src/ai-routing/providers/codex.provider.spec.ts] — existing test structure (WR-2.4 patterns)
- [Source: wr-2-4-implement-codex-kimi-gemini-full-agentic-workflow.md#Example-Test-Progress-Line-Parsing] — existing progress test pattern to extend
- [Source: wr-2-3-implement-claude-code-provider-full-agentic-workflow.md#AC-2] — onStdoutLine behavior contract
- [Source: epics-workspace-removal.md#Story-WR-3.1] — FR-WR7 + NFR-WR4 requirements
- [Source: src/sandbox/interfaces/agent-command-options.interface.ts] — `onStdoutLine?: (line: string) => void` field (added in WR-2.3)
- [Source: src/sandbox/sandbox.service.ts] — concurrent emitLog + onStdoutLine implementation

---

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 — story created 2026-04-01

### Debug Log References

### Completion Notes List

### File List

---

## Review Findings

> Code review conducted 2026-04-02 — 3-layer adversarial review (Blind Hunter, Edge Case Hunter, Acceptance Auditor).
> **2 decision-needed · 11 patch · 5 deferred · 1 dismissed**

### Decision-Needed

- [x] [Review][Decision] D1: `isRetryable: timedOut || qaFailed` — **resolved: keep** — outer retry on QA failure is intentional; outer orchestrator may retry for infra reasons independent of inner QA exhaustion.
- [x] [Review][Decision] D2: Scope violation — production `.ts` files modified — **resolved: expand scope** — production refactor accepted into this story; P8 and P11 are active patches.

### Patches

- [x] [Review][Patch] P1: AC-1 — All 8 milestone strings wrong on all 4 providers; none match SKILL.md exact strings. e.g. pct:10 uses `"Initializing execution context..."` instead of `"Budget check passed"`, pct:75 uses `"Finalizing implementation..."` instead of `"Implementation complete"` [all 4 spec files]
- [x] [Review][Patch] P2: AC-2 — ClaudeCode QA retry test missing pct:80 `"Running QA"` emission before pct:82; spec mandates asserting BOTH calls [claude-code.provider.spec.ts]
- [x] [Review][Patch] P3: AC-4 — `onStdoutLine: expect.any(Function)` assertion removed from Codex, Kimi, Gemini milestone tests; also not present in ClaudeCode Task 1.2 assertion [all 4 spec files]
- [x] [Review][Patch] P4: AC-5 — `'should silently skip non-JSON stdout lines without crashing'` deleted from Codex, Kimi, Gemini — explicitly protected by spec; must be restored [codex.provider.spec.ts, kimi.provider.spec.ts, gemini.provider.spec.ts]
- [x] [Review][Patch] P5: Deleted `'should fallback to parsing stdout if onStdoutLine missed the result'` from Codex, Gemini, Kimi — critical resilience path now untested [codex.provider.spec.ts, gemini.provider.spec.ts, kimi.provider.spec.ts]
- [x] [Review][Patch] P6: Deleted `'should return failure if result line is missing'` tests from Codex, Kimi, Gemini — most common crash scenario now untested [codex.provider.spec.ts, kimi.provider.spec.ts, gemini.provider.spec.ts]
- [x] [Review][Patch] P7: Deleted command invocation assertions (`command`, `image`, `env`, `onStdoutLine: expect.any(Function)`) from Codex, Kimi, Gemini — zero coverage that correct command is passed to sandboxService [codex.provider.spec.ts, kimi.provider.spec.ts, gemini.provider.spec.ts]
- [x] [Review][Patch] P8: Fallback guard `!agentResult.qaStatus` is a falsy check — a result line with `qaStatus` absent (but `prUrl`/`commitSha` present) will trigger the stdout fallback scan and then report as "no result received", causing false failure [codex.provider.ts, gemini.provider.ts, kimi.provider.ts] — conditional on D2 outcome
- [x] [Review][Patch] P9: Kimi QA retry test: mock emits `"QA failed — retrying (1/3)"` but asserts `qaRetryCount: 2`; Codex/Gemini equivalents use `qaRetryCount: 1` — inconsistency [kimi.provider.spec.ts]
- [x] [Review][Patch] P10: Non-JSON resilience test (ClaudeCode) missing `toHaveBeenCalledTimes(1)` — does not catch accidental extra emitProgress calls [claude-code.provider.spec.ts]
- [x] [Review][Patch] P11: Unsafe spread cast `parsed as typeof agentResult` in `type:'result'` handler — should narrow the type via explicit field extraction instead of a blanket cast [codex.provider.ts, gemini.provider.ts, kimi.provider.ts] — conditional on D2 outcome

### Deferred

- [x] [Review][Defer] W1: Multiple sequential `type:'result'` lines merge via spread accumulation — second partial line with missing keys does not overwrite prior values, but behavior is undocumented and untested — deferred, pre-existing protocol edge case [codex.provider.ts, gemini.provider.ts, kimi.provider.ts]
- [x] [Review][Defer] W2: `agentResult.branchName || featureBranch` — empty-string branchName from agent silently replaced by local fallback — deferred, theoretical edge case not covered by agent protocol spec
- [x] [Review][Defer] W3: Fourth error message branch (`'Agent process exited with non-zero code after emitting result'`) is dead code; no test exercises exitCode≠0 with a valid result line — deferred, pre-existing pattern
- [x] [Review][Defer] W4: ClaudeCode has no stdout buffered fallback; Codex/Kimi/Gemini do — cross-provider behavioral divergence undocumented — deferred, pre-existing architectural difference
- [x] [Review][Defer] W5: `isRetryable:false` for crash-with-no-result path is not explicitly asserted in Codex/Kimi/Gemini crash tests (asymmetric vs timeout/QA coverage) — deferred, minor coverage gap
