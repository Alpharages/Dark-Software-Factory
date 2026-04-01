# Story WR-2.1: Establish Shared Provider Contract & Execution State

Status: ready-for-dev

## Story

As a **platform engineer**,
I want the `IAIExecutionResult` interface extended with sandbox-result fields and `QA_FAILED` added to `ExecutionPhase`,
So that all sandbox providers share a single typed contract and the new execution state is available before any provider code is written.

## Acceptance Criteria

**AC-1: `IAIExecutionResult` extended with 5 new optional fields**
**Given** the current `IAIExecutionResult` interface in `src/ai-routing/interfaces/ai-provider.interface.ts`
**When** it is updated
**Then** the following 5 new fields are added (all optional — no existing fields removed or renamed):

- `prUrl?: string`
- `commitSha?: string`
- `branchName?: string`
- `qaStatus?: 'passed' | 'self_healed' | 'failed' | 'skipped'`
- `qaRetryCount?: number`

**AC-2: `ExecutionPhase.QA_FAILED` added**
**Given** the `ExecutionPhase` enum in `src/ai-routing/agent-skills/skills/execution-phase.enum.ts` has `STARTED`, `COMPLETED`, `FAILED`
**When** `QA_FAILED = 'QA_FAILED'` is added
**Then** all existing enum values remain present and unchanged
**And** `pnpm build` compiles with zero errors

**AC-3: Backward compatibility — existing providers unchanged**
**Given** the updated interface is in place
**When** any existing provider (`claude-code.provider.ts`, `kimi.provider.ts`, `codex.provider.ts`, `gemini.provider.ts`, `base-ai.provider.ts`) returns a result
**Then** TypeScript does not error — all new fields are optional so non-sandbox providers can omit them
**And** consumers accessing `result.qaStatus` will receive `undefined` and should default to `'skipped'`
**And** consumers accessing `result.qaRetryCount` will receive `undefined` and should default to `0`

**AC-4: `AIExecutionResultDto` updated for Swagger documentation**
**Given** `AIExecutionResultDto` in `src/ai-routing/dto/ai-execution.dto.ts` mirrors the interface for API docs
**When** the DTO is updated
**Then** the 5 new optional fields are documented with `@ApiPropertyOptional` decorators
**And** `qaStatus` enum values are listed in the `@ApiPropertyOptional` decorator

**AC-5: Full build clean**
**Given** all changes applied
**When** `pnpm build` runs
**Then** zero TypeScript compilation errors exist

## Tasks / Subtasks

- [ ] Task 1: Extend `IAIExecutionResult` interface (AC: 1, 3, 5)
  - [ ] 1.1 Open `src/ai-routing/interfaces/ai-provider.interface.ts`
  - [ ] 1.2 After the existing `error?: IAIExecutionError` field, add the following block:

    ```typescript
    /** PR URL opened by sandbox agent (populated by WR-2.3/2.4 providers) */
    prUrl?: string;

    /** Git commit SHA produced by sandbox agent */
    commitSha?: string;

    /** Feature branch name pushed by sandbox agent */
    branchName?: string;

    /**
     * QA outcome from sandbox execution.
     * - 'passed'      — QA passed on first attempt
     * - 'self_healed' — QA passed after one or more retries
     * - 'failed'      — All retries exhausted; branch pushed but no PR
     * - 'skipped'     — Provider does not run in-sandbox QA (legacy/non-sandbox providers)
     */
    qaStatus?: 'passed' | 'self_healed' | 'failed' | 'skipped';

    /**
     * Number of QA self-healing retries that occurred.
     * 0 means QA passed first time or was skipped.
     */
    qaRetryCount?: number;
    ```

  - [ ] 1.3 Do NOT modify or remove any existing fields (`success`, `codeDiff`, `filesChanged`, `confidenceScore`, `durationMs`, `tokensInput`, `model`, `tokensOutput`, `workspacePath`, `error`)
  - [ ] 1.4 Confirm `workspacePath?: string` remains (it was made optional in WR-1.1 for debugging purposes — do not remove it)

- [ ] Task 2: Add `QA_FAILED` to `ExecutionPhase` enum (AC: 2, 5)
  - [ ] 2.1 Open `src/ai-routing/agent-skills/skills/execution-phase.enum.ts`
  - [ ] 2.2 Add `QA_FAILED = 'QA_FAILED'` after `FAILED = 'FAILED'`:
    ```typescript
    export enum ExecutionPhase {
      STARTED = 'STARTED',
      COMPLETED = 'COMPLETED',
      FAILED = 'FAILED',
      /** QA retries exhausted; branch pushed, no PR created, awaiting PM resolution */
      QA_FAILED = 'QA_FAILED',
    }
    ```
  - [ ] 2.3 Note: This enum is re-exported by `src/integrations/pm-execution-status.service.ts` (line 15: `export { ExecutionPhase };`) — the re-export picks up the new value automatically, no change needed there

- [ ] Task 3: Update `AIExecutionResultDto` for Swagger docs (AC: 4, 5)
  - [ ] 3.1 Open `src/ai-routing/dto/ai-execution.dto.ts`
  - [ ] 3.2 Add these optional fields to `AIExecutionResultDto` after the existing `isRetryable?` field:

    ```typescript
    @ApiPropertyOptional({ description: 'PR URL opened by sandbox agent' })
    prUrl?: string;

    @ApiPropertyOptional({ description: 'Git commit SHA produced by sandbox agent' })
    commitSha?: string;

    @ApiPropertyOptional({ description: 'Feature branch name pushed by sandbox agent' })
    branchName?: string;

    @ApiPropertyOptional({
      description: 'QA outcome from sandbox execution',
      enum: ['passed', 'self_healed', 'failed', 'skipped'],
    })
    qaStatus?: 'passed' | 'self_healed' | 'failed' | 'skipped';

    @ApiPropertyOptional({ description: 'Number of QA self-healing retries (0 = passed first time or skipped)' })
    qaRetryCount?: number;
    ```

- [ ] Task 4: Add `QA_FAILED` to `PHASE_DESCRIPTIONS` in `clickup-status.skill.ts` (AC: 2, 5)
  - [ ] 4.1 Open `src/ai-routing/agent-skills/skills/clickup-status.skill.ts`
  - [ ] 4.2 Line 36 declares `const PHASE_DESCRIPTIONS: Record<ExecutionPhase, string>` — this is an **exhaustive record**; TypeScript will fail compilation if any enum member is missing
  - [ ] 4.3 Add the `QA_FAILED` entry to the record:
    ```typescript
    const PHASE_DESCRIPTIONS: Record<ExecutionPhase, string> = {
      [ExecutionPhase.STARTED]:
        'An AI agent has just started coding on this task. Work is actively in progress.',
      [ExecutionPhase.COMPLETED]:
        'An AI agent has finished coding and a pull request has been created and is ready for review.',
      [ExecutionPhase.FAILED]:
        'The AI execution failed or was blocked and requires human attention.',
      [ExecutionPhase.QA_FAILED]:
        'The AI agent exhausted all QA retries. The branch has been pushed but no PR was created — awaiting PM resolution.',
    };
    ```
  - [ ] 4.4 This is the **4th file** that changes in this story — it is not optional

- [ ] Task 5: Verify build and no regressions (AC: 5)
  - [ ] 5.1 `pnpm build` → zero TypeScript compilation errors
  - [ ] 5.2 `pnpm test -- --testPathPattern="ai-routing|provider|execution|clickup-status"` → no regressions
  - [ ] 5.3 Confirm no existing provider file (`claude-code.provider.ts`, `kimi.provider.ts`, `codex.provider.ts`, `gemini.provider.ts`, `base-ai.provider.ts`) requires changes — they all return the interface and all new fields are optional

## Dev Notes

### Minimal Scope — Pure Type Definitions

This is a pure TypeScript types-only story. **No provider logic, no runtime behavior, no database changes.** Four files change:

| File                                                         | Change                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| `src/ai-routing/interfaces/ai-provider.interface.ts`         | Add 5 optional fields to `IAIExecutionResult`                   |
| `src/ai-routing/agent-skills/skills/execution-phase.enum.ts` | Add `QA_FAILED = 'QA_FAILED'`                                   |
| `src/ai-routing/agent-skills/skills/clickup-status.skill.ts` | Add `[ExecutionPhase.QA_FAILED]` to `PHASE_DESCRIPTIONS` record |
| `src/ai-routing/dto/ai-execution.dto.ts`                     | Add 5 `@ApiPropertyOptional` fields to `AIExecutionResultDto`   |

**No other files need to change.** Provider implementations (WR-2.3, WR-2.4) will populate the new fields in subsequent stories.

### `IAIExecutionResult` Current State (before this story)

```typescript
export interface IAIExecutionResult {
  success: boolean;
  codeDiff: string | null;
  filesChanged: string[];
  confidenceScore: number;
  durationMs: number;
  tokensInput?: number;
  model?: string;
  tokensOutput?: number;
  workspacePath?: string; // kept optional for debugging (WR-1.1)
  error?: IAIExecutionError;
  // ← NEW FIELDS GO HERE (WR-2.1)
}
```

### Why All New Fields Are Optional

The AC explicitly states: "TypeScript does not error — new fields are optional or have safe defaults (qaStatus: 'skipped', qaRetryCount: 0) for non-sandbox providers". Making all 5 fields optional (`?`) is the correct approach because:

- 8 files currently import and use `IAIExecutionResult` (providers, orchestrator, fallback-strategy, etc.)
- Making fields required would force all return sites to add `qaStatus: 'skipped', qaRetryCount: 0` in this story, which is unnecessary scope
- WR-2.3 and WR-2.4 will add the sandbox implementations that populate these fields

### `ExecutionPhase` Re-export Chain

```
src/ai-routing/agent-skills/skills/execution-phase.enum.ts   ← DEFINE HERE
  ↓ re-exported by
src/integrations/pm-execution-status.service.ts (line 15: export { ExecutionPhase })
  ↓ imported by
src/execution/ai-execution.consumer.ts (from @/integrations/pm-execution-status.service)
src/ai-routing/agent-skills/skills/clickup-status.skill.ts
```

Adding `QA_FAILED` to the enum file propagates automatically through the re-export. The `pm-execution-status.service.ts` does NOT need to be touched.

### Files That Import `ExecutionPhase` — Change Required vs Safe

| File                                                              | Action                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/ai-routing/agent-skills/skills/clickup-status.skill.ts`      | **MUST UPDATE** — `Record<ExecutionPhase, string>` requires exhaustive keys               |
| `src/integrations/pm-execution-status.service.ts`                 | Safe — re-exports enum; new value propagates automatically                                |
| `src/execution/ai-execution.consumer.ts`                          | Safe — uses specific values (`STARTED`/`COMPLETED`/`FAILED`); new value unused until WR-4 |
| `src/ai-routing/agent-skills/skills/clickup-status.skill.spec.ts` | Safe — tests do not exhaustively enumerate phases                                         |
| `src/integrations/pm-execution-status.service.spec.ts`            | Safe — `it.each` will not break; `QA_FAILED` coverage added in WR-4                       |

### Files That Import `IAIExecutionResult` (Do NOT need changes)

| File                                                           | Why safe                                                          |
| -------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/ai-routing/orchestrator.service.ts`                       | Passes result through; new optional fields are ignored            |
| `src/ai-routing/fallback-strategy.service.ts`                  | Passes result through; no field-level destructuring of new fields |
| `src/ai-routing/providers/base-ai.provider.ts`                 | Base class; return type is interface; optional fields satisfied   |
| `src/ai-routing/providers/claude-code.provider.ts`             | Returns `IAIExecutionResult`; new fields omitted → OK (all `?`)   |
| `src/ai-routing/providers/kimi.provider.ts`                    | Same as claude-code                                               |
| `src/ai-routing/providers/codex.provider.ts`                   | Same                                                              |
| `src/ai-routing/providers/gemini.provider.ts`                  | Same                                                              |
| `src/ai-routing/interfaces/coding-agent-provider.interface.ts` | Refers to the interface type; no field access                     |
| `src/ai-routing/interfaces/orchestration.interface.ts`         | Refers to the interface type; no field access                     |

### `PHASE_DESCRIPTIONS` — Why `clickup-status.skill.ts` Must Change

`Record<ExecutionPhase, string>` is a mapped type that TypeScript checks exhaustively — every enum member must appear as a key. Adding `QA_FAILED` to `ExecutionPhase` without adding a corresponding `[ExecutionPhase.QA_FAILED]` entry causes a **compile-time error**, not a runtime error. The `pnpm build` in AC-5 will catch this, but the fix must be made or the build won't pass.

The description for `QA_FAILED` in the record should align with the epic intent: "QA retries exhausted, branch pushed, no PR created, awaiting PM resolution."

### `ai-execution.consumer.ts` — Forward Context for WR-4

`src/execution/ai-execution.consumer.ts` currently calls `ExecutionPhase` at five sites (lines 264, 440, 638, 684, 720), using only `STARTED`, `COMPLETED`, and `FAILED`. **Do not touch this file in this story.** However, WR-4 stories will need to add a `QA_FAILED` call path in the consumer after `qaStatus: 'failed'` is returned by a provider. This is expected and intentional — the enum value is defined here so WR-4 can import it immediately.

### `pm-execution-status.service.spec.ts` — Test Gap for WR-4

The `it.each` at line 530-534 covers `STARTED`, `COMPLETED`, and `FAILED` phases. `QA_FAILED` is not covered. Adding `QA_FAILED` to the enum does **not** break this test. The WR-4 developer should add a `QA_FAILED` test case to this `it.each` when implementing the hard QA failure state transition. This story does not add that test (no business logic is introduced here).

### `qaStatus` Literal Union — Do Not Use a Separate Type

The story defines `qaStatus` inline as `'passed' | 'self_healed' | 'failed' | 'skipped'`. Do not extract this into a separate type alias or enum — the WR-2 epics reference it inline. Consistency with the epic spec is required.

### `AIExecutionResultDto` — DTO vs Interface Alignment

The `AIExecutionResultDto` class does NOT have class-validator decorators on its fields (it's a response DTO, not a request DTO). Only `@ApiPropertyOptional` is needed for Swagger docs. Do not add `@IsString()` or other validators.

### Testing Note

This story has no business logic — tests are not required. The `pnpm build` passing is the primary verification. However, run the ai-routing tests to confirm no spec breaks from the new enum value or interface fields.

### Project Structure Notes

- Path alias `@/` maps to `./src/` — use it in any new imports
- Interface files live in `src/ai-routing/interfaces/` — no new files needed
- Enum files live alongside their skill: `src/ai-routing/agent-skills/skills/`

### References

- [Source: _bmad-output/planning-artifacts/epics-workspace-removal.md#Story-WR-2.1] — FR-WR13, NFR-WR8 specs
- [Source: src/ai-routing/interfaces/ai-provider.interface.ts] — current `IAIExecutionResult` definition
- [Source: src/ai-routing/agent-skills/skills/execution-phase.enum.ts] — current `ExecutionPhase` enum
- [Source: src/ai-routing/dto/ai-execution.dto.ts] — current `AIExecutionResultDto` class
- [Source: src/integrations/pm-execution-status.service.ts#L15] — `ExecutionPhase` re-export
- [Source: src/execution/ai-execution.consumer.ts#L38-39] — `ExecutionPhase` consumer import path
- [Source: src/ai-routing/agent-skills/skills/clickup-status.skill.ts#L36-42] — `Record<ExecutionPhase, string>` exhaustive record requiring `QA_FAILED` entry
- [Source: src/integrations/pm-execution-status.service.spec.ts#L530-534] — `it.each` phase coverage gap (WR-4 to address)

---

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 — story created 2026-04-01

### Debug Log References

### Completion Notes List

### File List
