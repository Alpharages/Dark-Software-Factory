# Story WR-6.1: Define QAAttempt Interface & Add qa_attempts DB Column

Status: ready-for-dev

<!-- Note: Validate with validate-create-story if needed before running dev-story. -->

## Story

As a **platform engineer**,
I want a typed `QAAttempt` interface and a `qa_attempts` JSON column on the `Execution` model,
so that the shared data contract and storage layer exist before any provider or API work begins.

## Acceptance Criteria

**AC-1: QAAttempt interface defined in ai-provider.interface.ts**
Given the `IAIExecutionResult` interface exists in `src/ai-routing/interfaces/ai-provider.interface.ts`
When it is updated
Then a new `QAAttempt` interface is exported from the same file with these exact fields:

- `attemptNumber: number`
- `lintPassed: boolean`
- `lintErrors?: { count: number; details: unknown[] }`
- `testsPassed: boolean`
- `testResults?: { passed: number; failed: number; details: unknown[] }`
- `durationMs: number`

**AC-2: IAIExecutionResult gains qaAttempts field (additive only)**
Given the `QAAttempt` interface is defined
When `IAIExecutionResult` is updated
Then `qaAttempts?: QAAttempt[]` is added as an optional field after `qaRetryCount`
And all existing fields (`prUrl`, `commitSha`, `branchName`, `qaStatus`, `qaRetryCount`, etc.) remain unchanged — no renames, no removals (NFR-EXT8)

**AC-3: Migration adds qa_attempts to Execution table**
Given the `Execution` Prisma model exists
When migration `add_qa_attempts_to_execution` is applied
Then a new `qa_attempts Json?` nullable column is added to the `executions` table
And all existing execution rows remain unaffected (`null` for the new column)

**AC-4: Build clean — existing providers compile without changes**
Given all changes applied
When `pnpm build` runs
Then zero TypeScript errors exist — `qaAttempts` is optional, so existing providers that return `IAIExecutionResult` without it compile cleanly
And `pnpm typecheck` also passes with zero errors

---

## Tasks / Subtasks

- [ ] Task 1: Define `QAAttempt` interface (AC: 1)
  - [ ] 1.1: In `src/ai-routing/interfaces/ai-provider.interface.ts`, insert the `QAAttempt` interface directly **before** `IAIExecutionResult` (around line 44), with this exact shape:
    ```typescript
    /**
     * Per-attempt QA result captured during sandbox self-healing loop (WR-6.1)
     */
    export interface QAAttempt {
      /** 1-based attempt number */
      attemptNumber: number;
      /** Whether the lint step passed for this attempt */
      lintPassed: boolean;
      /** Lint failure details (absent when lintPassed is true) */
      lintErrors?: { count: number; details: unknown[] };
      /** Whether the test step passed for this attempt */
      testsPassed: boolean;
      /** Test run details (absent when testsPassed is true) */
      testResults?: { passed: number; failed: number; details: unknown[] };
      /** Duration of this QA attempt in milliseconds */
      durationMs: number;
    }
    ```

- [ ] Task 2: Add `qaAttempts` to `IAIExecutionResult` (AC: 2)
  - [ ] 2.1: In `src/ai-routing/interfaces/ai-provider.interface.ts`, add after the `qaRetryCount` field (currently line 99, closing `}` is line 100):
    ```typescript
      /**
       * Per-attempt QA history from the sandbox self-healing loop.
       * Populated by providers in WR-6.2. Optional — absent when QA was skipped or
       * the provider does not yet emit qa_attempt markers.
       */
      qaAttempts?: QAAttempt[];
    ```

- [ ] Task 3: Add `qa_attempts` to Execution Prisma model (AC: 3)
  - [ ] 3.1: In `prisma/schema.prisma`, on the `Execution` model, add after the `progress` field (currently line 111):
    ```
      qa_attempts           Json?               // WR-6.1: per-attempt QA history array
    ```
  - [ ] 3.2: Run `pnpm db:migrate -- --name add_qa_attempts_to_execution` to create and apply the migration
  - [ ] 3.3: Verify the generated migration SQL contains `ALTER TABLE "executions" ADD COLUMN "qa_attempts" JSONB` (Prisma uses `JSONB` for `Json?` on PostgreSQL)
  - [ ] 3.4: Run `pnpm db:generate` to regenerate the Prisma client

- [ ] Task 4: Verify build and type safety (AC: 4)
  - [ ] 4.1: Run `pnpm typecheck` — must return zero errors
  - [ ] 4.2: Run `pnpm build` — must complete successfully
  - [ ] 4.3: Run `pnpm test -- --testPathPattern="provider\.spec|execution"` — existing tests must still pass (no functional changes in this story; this pattern covers the 4 provider specs + ai-execution.service.spec.ts + execution-tracker.service.spec.ts)

---

## Dev Notes

### THIS STORY SCOPE — WR-6.1 ONLY

This story is **purely foundational**: define the data contract (`QAAttempt` type + `IAIExecutionResult.qaAttempts` field) and the storage layer (`qa_attempts Json?` on `Execution`). No provider changes. No API changes. No marker parsing. Those are WR-6.2 and WR-6.3 respectively.

**Story sequence:**

- WR-6.1 (this): Type + DB column — creates the foundation
- WR-6.2 (next): Providers parse `qa_attempt` stdout markers → populate `qaAttempts`
- WR-6.3 (after): Persist `qaAttempts` to DB + expose via execution detail API

### Exact Location in ai-provider.interface.ts

Current structure (abridged):

```typescript
// line 14: export interface IAIExecutionInput { ... }
// line 46: export interface IAIExecutionResult {
// line 93:   qaStatus?: 'passed' | 'self_healed' | 'failed' | 'skipped';
// line 99:   qaRetryCount?: number;
// line 100: }
// line 105: export interface IAIExecutionError { ... }
```

**Insert `QAAttempt` between lines 44–45** (between the closing `}` of `IAIExecutionInput` and the opening of `IAIExecutionResult`).

**Add `qaAttempts` after line 99** (`qaRetryCount?: number;`), before the closing `}` at line 100.

Final structure around the change:

```typescript
/**
 * Per-attempt QA result captured during sandbox self-healing loop (WR-6.1)
 */
export interface QAAttempt {
  attemptNumber: number;
  lintPassed: boolean;
  lintErrors?: { count: number; details: unknown[] };
  testsPassed: boolean;
  testResults?: { passed: number; failed: number; details: unknown[] };
  durationMs: number;
}

/**
 * Output from AI code generation
 */
export interface IAIExecutionResult {
  // ... existing fields unchanged ...
  qaStatus?: 'passed' | 'self_healed' | 'failed' | 'skipped';
  qaRetryCount?: number;

  /**
   * Per-attempt QA history from the sandbox self-healing loop.
   * Populated by providers in WR-6.2. Optional — absent when QA was skipped or
   * the provider does not yet emit qa_attempt markers.
   */
  qaAttempts?: QAAttempt[];
}
```

### Exact Location in prisma/schema.prisma

The `Execution` model's scalar fields end at `progress` (currently line 111):

```prisma
  progress              Json?               @map("progress") // Store latest progress state (step, percent)
```

Add the new field directly below it:

```prisma
  progress              Json?               @map("progress") // Store latest progress state (step, percent)
  qa_attempts           Json?               // WR-6.1: per-attempt QA history array
```

**No `@map()` needed** — `qa_attempts` already matches snake_case convention (Prisma uses it as-is for the DB column).

### Migration Command

```bash
pnpm db:migrate -- --name add_qa_attempts_to_execution
```

The `--` separator passes `--name` through to `prisma migrate dev`. This matches the pattern used in WR-5.1 (`add_qa_max_retries_to_project`). The generated migration will be timestamped as `YYYYMMDDHHMMSS_add_qa_attempts_to_execution/migration.sql`.

### Why `unknown[]` for details fields

TypeScript strict mode forbids `any[]`. The lint error details and test result details come from stdout (external, untyped source). `unknown[]` is the correct strict-mode choice — consumers must narrow the type before use. Do NOT use `any[]`.

### Why No Separate QAAttempt Table

FR-EXT7 explicitly states: "no separate table required — JSON column is sufficient." The data is bounded by `qaMaxRetries` (max 10 attempts × fixed shape per NFR-EXT3), so there is zero unbounded growth risk. Do not create a `QAAttempt` model or a `qa_attempts` relation table.

### Why Optional (`?`) on Both Sides

- `IAIExecutionResult.qaAttempts?` — existing providers (ClaudeCode, Codex, Kimi, Gemini) return `IAIExecutionResult` without `qaAttempts`. Making it optional keeps them compiling cleanly until WR-6.2 adds parsing.
- `qa_attempts Json?` in Prisma — existing execution rows get `null` automatically; no migration data fill needed.

### Anti-Pattern Prevention

1. **Do NOT add `QAAttempt` as a Prisma model** — JSON column only, per FR-EXT7.
2. **Do NOT modify any provider files** — that is WR-6.2 work. Touching providers here causes scope creep and breaks the clean separation.
3. **Do NOT modify the execution detail API or any DTO** — that is WR-6.3 work.
4. **Do NOT make `qaAttempts` required in `IAIExecutionResult`** — would immediately break all 4 providers with TypeScript errors.
5. **Do NOT use `any[]`** for `details` fields — use `unknown[]` (TypeScript strict mode requirement per ESLint config).
6. **Do NOT add `@Index` on `qa_attempts`** — JSON columns on `executions` are not indexed; the data is accessed by execution ID (existing index), not queried inside the JSON.
7. **Do NOT place `QAAttempt` in a separate file** — keep it co-located with `IAIExecutionResult` in `ai-provider.interface.ts` for WR-6.2 to import cleanly.

### Files to Touch (Complete List)

| File                                                          | Change                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `src/ai-routing/interfaces/ai-provider.interface.ts`          | Add `QAAttempt` interface + `qaAttempts?: QAAttempt[]` to `IAIExecutionResult` |
| `prisma/schema.prisma`                                        | Add `qa_attempts Json?` to `Execution` model                                   |
| `prisma/migrations/<timestamp>_add_qa_attempts_to_execution/` | Auto-generated by `pnpm db:migrate`                                            |

**DO NOT TOUCH:** Any provider file, any DTO, any service, any controller, any other interface.

### Previous Story Context (WR-5.x)

WR-5.1 and WR-5.2 are complete (both in `ready-for-dev` / committed). They added:

- `qa_max_retries Int @default(3)` on the `Project` model
- `qaMaxRetries?: number` flowing through `IAIExecutionPayload` and `IOrchestrationInput`
- All 4 providers reading `qaMaxRetries` from payload instead of hardcoding `'3'`

WR-6.1 is independent of WR-5 — no dependency, no shared files.

The WR-5.1 migration pattern to follow: add the field in `schema.prisma` first, then run `pnpm db:migrate -- --name <name>`, then `pnpm db:generate`.

### References

- FR-EXT4: `IAIExecutionResult` extended with `qaAttempts[]` — `_bmad-output/planning-artifacts/epics-workspace-removal-extensions.md`
- FR-EXT7: `qa_attempts Json?` column on `Execution` — same file
- NFR-EXT3: Bounded by `qaMaxRetries` (max 10 × fixed shape) — same file
- NFR-EXT8: Additive only — same file
- Interface file: `src/ai-routing/interfaces/ai-provider.interface.ts` (current lines 46–100 for `IAIExecutionResult`)
- Schema file: `prisma/schema.prisma` (current lines 77–130 for `Execution` model)
- Precedent migration: `prisma/migrations/20260402213657_add_qa_max_retries_to_project/`

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
