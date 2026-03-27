# Story OS-5.1: Env Validation and Configuration Module Cleanup

Status: done

## Change Log

- 2026-03-27: Story enriched with full codebase analysis. Actual scope is narrower than epic suggests — most new blocks already exist. Work focuses on removing DooD remnants, fixing duplicates, and removing dead `sandbox` config block.

## Story

As a **Developer**,
I want `env.validation.ts` and `configuration.ts` cleaned of all dead variables and duplicate entries,
So that the app fails fast on misconfiguration and no stale Joi schemas or config keys confuse future developers.

## Background

Epics OS-1 through OS-4 are complete. The codebase has been migrated to OpenSandbox. **Most new provider blocks are already in place** — this story is about cleanup, not addition.

**What's already done (no action needed):**

- `opensandbox` config block present in `configuration.ts` ✅
- `gemini`, `codex`, `kimi` config blocks present in `configuration.ts` ✅
- All OpenSandbox Joi schemas present in `env.validation.ts` ✅
- All Gemini/Codex/Kimi/AI_PRIMARY_PROVIDER Joi schemas present ✅
- `cursor` config block already removed from `configuration.ts` ✅

**What still needs to be cleaned up:**

1. Two duplicate Joi definitions in `env.validation.ts`
2. Two DooD env var Joi schemas still present in `env.validation.ts`
3. `ANTHROPIC_BASE_URL` actively used but has no Joi schema — add it
4. Dead `sandbox` config block still present in `configuration.ts`
5. `anthropic.workspacesRoot` key still references removed `CLAUDE_WORKSPACES_ROOT`
6. `anthropic.timeoutMs` defined in configuration but has zero consumers — remove

## Acceptance Criteria

1. **Given** `env.validation.ts` is updated
   **When** a developer inspects it
   **Then**:
   - Duplicate `CLAUDE_MAX_CONCURRENT` entry (currently on lines 53-54) is reduced to one
   - Duplicate `ANTHROPIC_MAX_TOKENS` entry (currently on lines 158-159) is reduced to one
   - `ENABLE_CONTAINER_EXECUTION` Joi schema is absent (DooD variable)
   - `DOCKER_CONTAINER_TIMEOUT_MS` Joi schema is absent (DooD variable)
   - `ANTHROPIC_BASE_URL: Joi.string().uri().allow('').optional()` schema is present (was missing despite active consumption by `claude-code.provider.ts`)

2. **Given** `configuration.ts` is updated
   **When** a developer inspects it
   **Then**:
   - The `sandbox` config block (currently lines 333-345) is absent
   - `anthropic.workspacesRoot` key is absent
   - `anthropic.timeoutMs` key is absent, with a comment explaining the removal decision

3. **Given** `ANTHROPIC_MAX_TOKENS` is evaluated during implementation
   **When** the decision is made
   **Then** it is **retained** — `FilePredictionProvider` (`src/file-locks/file-prediction.provider.ts:27`) reads `config.get('anthropic.maxTokens')` directly — removing it would break file prediction

4. **Given** `ANTHROPIC_TIMEOUT_MS` is evaluated during implementation
   **When** the decision is made
   **Then** it is **removed** from `configuration.ts` — no service in the codebase reads `config.get('anthropic.timeoutMs')` — and a code comment documents this: `// ANTHROPIC_TIMEOUT_MS removed OS-5.1: no service reads anthropic.timeoutMs via config`

5. **Given** the updated files
   **When** `pnpm check` (lint + test + build) is run
   **Then** zero lint errors, zero test failures, build succeeds

## Tasks / Subtasks

- [x] Task 1: Fix duplicates in `src/config/env.validation.ts`
  - Remove the second `CLAUDE_MAX_CONCURRENT` definition (line 54 — identical to line 53)
  - Remove the second `ANTHROPIC_MAX_TOKENS` definition (line 159 — identical to line 158)

- [x] Task 2: Remove DooD remnants and add missing schema in `src/config/env.validation.ts`
  - Remove `ENABLE_CONTAINER_EXECUTION` block (Story 22.4 comment + lines 252-254)
  - Remove `DOCKER_CONTAINER_TIMEOUT_MS` block (lines 255-261)
  - **Do NOT remove** the `DOCKER_*` comment on line 255 if it belongs to the next valid block; review context before deleting
  - Add `ANTHROPIC_BASE_URL` Joi schema near the other Anthropic config entries (around line 154): `ANTHROPIC_BASE_URL: Joi.string().uri().allow('').optional().description('Anthropic API base URL override (e.g., for local proxies or LiteLLM)')`

- [x] Task 3: Remove dead `sandbox` block from `src/config/configuration.ts`
  - Remove the entire `sandbox:` block (lines 333-345, including Story 23.3 comment)
  - Verify nothing reads `config.get('sandbox.*')` — confirmed via codebase grep: no consumers exist

- [x] Task 4: Clean up `anthropic` config block in `src/config/configuration.ts`
  - Remove `workspacesRoot: process.env.CLAUDE_WORKSPACES_ROOT || '/tmp/claude-workspaces'` (line 167)
  - Remove `timeoutMs: parseInt(process.env.ANTHROPIC_TIMEOUT_MS || '300000', 10)` (line 165)
  - Add inline comment on line 165 position: `// ANTHROPIC_TIMEOUT_MS removed OS-5.1: no service reads anthropic.timeoutMs — SDK timeout not configured explicitly`
  - KEEP `maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '8000', 10)` (line 164) — consumed by FilePredictionProvider

- [x] Task 5: Final verification
  - Run `pnpm check` — zero lint errors, zero test failures, build succeeds
  - Run dead-ref check (must return zero results):
    ```
    grep -r "ENABLE_CONTAINER_EXECUTION\|DOCKER_CONTAINER_TIMEOUT_MS\|CLAUDE_WORKSPACES_ROOT\|sandbox\.workspacesRoot\|sandbox\.logsRoot\|sandbox\.containerTimeoutMs\|sandbox\.containerExecutionEnabled\|sandbox\.resourceLimits\|anthropic\.workspacesRoot\|anthropic\.timeoutMs" src/ --include="*.ts"
    ```

### Review Findings

- [x] [Review][Decision] RiskScoringService boundary change — The comparison changed from `> 1.5` to `>= 1.5`, altering the MEDIUM risk threshold. [Confirmed: Intentional]
- [x] [Review][Patch] Dead `ANTHROPIC_TIMEOUT_MS` Joi Schema [src/config/env.validation.ts:169]
- [x] [Review][Patch] `KIMI` Missing in Stats [src/audit/ai-decision-logger.service.ts:201, 435]
- [x] [Review][Patch] Unguarded Architecture Constraints DB Call [src/ai-routing/prompt-generator.service.ts:81]
- [x] [Review][Patch] Ambiguous `ANTHROPIC_BASE_URL` Validation [src/config/env.validation.ts:163]
- [x] [Review][Patch] Inconsistent Provider Name Normalization [src/audit/ai-decision-logger.service.ts:441]
- [x] [Review][Patch] Sprint Status Prematurely Marked "Done" [_bmad-output/implementation-artifacts/sprint-status.yaml:564]
- [x] [Review][Defer] Magic Number in Risk Test [src/qa-automation/services/qa-sampling.service.spec.ts:260] — deferred, pre-existing
- [x] [Review][Patch] Incomplete `ANTHROPIC_BASE_URL` validation — `.allow('')` missing from Joi schema [src/config/env.validation.ts:164]
- [x] [Review][Patch] `CLAUDE_WORKSPACES_ROOT` Joi schema orphaned after `anthropic.workspacesRoot` removal [src/config/env.validation.ts:168]
- [x] [Review][Patch] `SANDBOX_WORKSPACES_ROOT` and `SANDBOX_LOGS_ROOT` Joi schemas orphaned after `sandbox` block removal [src/config/env.validation.ts:261-266]
- [x] [Review][Defer] Architecture constraints typed as `any[]` — bypasses type safety for `c.type`/`c.scope`/`c.rules` [src/ai-routing/prompt-generator.service.ts] — deferred, pre-existing pattern in codebase
- [x] [Review][Defer] No caching for `architectureConstraintsService.findAll()` in `generatePrompt` hot path [src/ai-routing/prompt-generator.service.ts] — deferred, requires TTL/invalidation design decision

## Dev Notes

### Files to Modify

| File                | Path                           |
| ------------------- | ------------------------------ |
| `env.validation.ts` | `src/config/env.validation.ts` |
| `configuration.ts`  | `src/config/configuration.ts`  |

### Critical: What NOT to Remove

| Variable                         | Config Key                     | Reason to Keep                                                                                               |
| -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `ANTHROPIC_MAX_TOKENS`           | `anthropic.maxTokens`          | Read by `src/file-locks/file-prediction.provider.ts:27`                                                      |
| `ANTHROPIC_BASE_URL`             | `anthropic.baseURL`            | Read by `src/ai-routing/providers/claude-code.provider.ts:34`; passed as `ANTHROPIC_BASE_URL` to sandbox env |
| `ANTHROPIC_API_KEY`              | `anthropic.apiKey`             | Used by multiple services (github orchestrators, pm-field-auto-fill, agent-skill-runner)                     |
| `ANTHROPIC_MODEL`                | `anthropic.model`              | Used by agent-skill-runner.service.ts                                                                        |
| `ANTHROPIC_COMMIT_MESSAGE_MODEL` | `anthropic.commitMessageModel` | Used by github-commit-orchestrator and pm-field-auto-fill                                                    |

### What to Change in env.validation.ts

| Action | Schema Key                        | Location                                           | Reason                                                         |
| ------ | --------------------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| REMOVE | Duplicate `CLAUDE_MAX_CONCURRENT` | Line 54                                            | Exact copy of line 53                                          |
| REMOVE | Duplicate `ANTHROPIC_MAX_TOKENS`  | Line 159                                           | Exact copy of line 158                                         |
| REMOVE | `ENABLE_CONTAINER_EXECUTION`      | Lines 252-254                                      | DooD variable (Story 22.4 comment block)                       |
| REMOVE | `DOCKER_CONTAINER_TIMEOUT_MS`     | Lines 255-261                                      | DooD variable                                                  |
| ADD    | `ANTHROPIC_BASE_URL`              | After `ANTHROPIC_COMMIT_MESSAGE_MODEL` (~line 157) | Missing schema — actively read by `claude-code.provider.ts:34` |

**Note on `ANTHROPIC_TIMEOUT_MS`:** This variable was never validated by Joi (no schema in `env.validation.ts`). It was only mapped in `configuration.ts`. Do NOT add a schema for it — it is being removed entirely from `configuration.ts` in Task 4.

### What to Remove from configuration.ts

| Config Key                 | Location      | Reason                                                                    |
| -------------------------- | ------------- | ------------------------------------------------------------------------- |
| `sandbox` block            | Lines 333-345 | All keys reference dead DooD env vars; zero consumers of `sandbox.*` keys |
| `anthropic.workspacesRoot` | Line 167      | `CLAUDE_WORKSPACES_ROOT` removed in OS epic                               |
| `anthropic.timeoutMs`      | Line 165      | No consumer in codebase reads this key                                    |

### Safe Confirmation: sandbox Block Consumers

A grep of `sandbox\.resourceLimits|sandbox\.workspacesRoot|sandbox\.logsRoot|sandbox\.containerTimeoutMs|sandbox\.containerExecutionEnabled|sandbox\.maxConcurrent` across all `.ts` files returns zero results. The `SandboxService` reads only `opensandbox.*` config keys.

### Services Making Direct Anthropic SDK Calls

These use `anthropic.apiKey`/`anthropic.model`/`anthropic.commitMessageModel` — none reads `maxTokens` or `timeoutMs` via config:

- `src/github/services/github-commit-orchestrator.service.ts`
- `src/github/services/github-pr-orchestrator.service.ts`
- `src/integrations/pm-field-auto-fill.service.ts`
- `src/ai-routing/agent-skills/agent-skill-runner.service.ts`

**Neither `AICostTrackerService` nor `ComplexityScorerService` makes direct Anthropic SDK calls** — AC3 decision confirmed: retain `ANTHROPIC_MAX_TOKENS` only because of `FilePredictionProvider`.

### After configuration.ts sandbox Block Removal

The `anthropic` config block should look like:

```typescript
// Story 2.7: Anthropic Claude API Configuration (updated OS-3.2: stale refs removed)
// Model: claude-sonnet-4-20250514 is the latest Sonnet model as of implementation
anthropic: {
  apiKey: process.env.ANTHROPIC_API_KEY || '',
  baseURL: process.env.ANTHROPIC_BASE_URL,
  model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
  // lightweight tasks (commit messages, file predictions)
  commitMessageModel: process.env.ANTHROPIC_COMMIT_MESSAGE_MODEL || 'claude-3-haiku-20240307',
  maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS || '8000', 10),
  // ANTHROPIC_TIMEOUT_MS removed OS-5.1: no service reads anthropic.timeoutMs — SDK timeout not configured explicitly
},
```

### Epic OS-5 Context

This is story 1 of 2 in Epic OS-5. Story OS-5.2 will regenerate `.env.example` using the cleaned-up files from this story as source-of-truth. Do not touch `.env.example` in this story.
