# Story OS-5.2: .env.example Regeneration and Final Production Audit

Status: ready-for-dev

## Change Log

- 2026-03-27: Story created with full codebase analysis. Current `.env.example` has ~12 dead variables and 3 dead sections. All dead patterns identified with exact line-level precision. Final CURSOR_HEADLESS grep check deferred from OS-3.2 is also in scope here.

## Story

As a **Developer**,
I want `.env.example` fully regenerated with zero dead variables and a clean section structure,
so that any developer cloning the repo gets accurate configuration guidance with no confusion about what is actually used.

## Background

This is the final story in Epic OS-5 (and the OpenSandbox migration sprint overall). **OS-5.1 must be complete before this story is started** — the cleaned `env.validation.ts` and `configuration.ts` from OS-5.1 are the source of truth for what variables are valid.

**What OS-5.1 delivered (already done by the time you run this):**

- Duplicate `CLAUDE_MAX_CONCURRENT` removed from env.validation.ts
- Duplicate `ANTHROPIC_MAX_TOKENS` removed from env.validation.ts
- DooD Joi schemas (`ENABLE_CONTAINER_EXECUTION`, `DOCKER_CONTAINER_TIMEOUT_MS`) removed from env.validation.ts
- `ANTHROPIC_BASE_URL` Joi schema added to env.validation.ts
- Dead `sandbox` config block removed from configuration.ts
- `anthropic.workspacesRoot` (`CLAUDE_WORKSPACES_ROOT`) and `anthropic.timeoutMs` (`ANTHROPIC_TIMEOUT_MS`) removed from configuration.ts

**What this story adds:**

1. Regenerate `.env.example` so it matches the live config (remove dead vars, add new provider vars)
2. Clean up residual comment-only `WorkspaceService` references in spec files (deferred from OS-3.2 code review)
3. Run the final `CURSOR_HEADLESS` grep check (deferred from OS-3.2 note in epics.md)
4. Validate Prometheus metrics post-migration
5. Confirm `pnpm check` green — zero lint errors, zero test failures, build succeeds

## Acceptance Criteria

1. **Given** `.env.example` is regenerated
   **When** a developer inspects the AI PROVIDERS section
   **Then**:
   - `CURSOR_HEADLESS_ENABLED` is absent
   - `CURSOR_CLI_PATH` is absent
   - `CURSOR_HEADLESS_TIMEOUT_MS` is absent
   - `CURSOR_WORKSPACES_ROOT` is absent
   - `CURSOR_MAX_CONCURRENT_WORKSPACES` is absent
   - `CURSOR_PRESERVE_FAILED_WORKSPACES` is absent
   - `CURSOR_GIT_USER_NAME` is absent
   - `CURSOR_GIT_USER_EMAIL` is absent
   - `ANTHROPIC_TIMEOUT_MS` is absent (removed from configuration.ts in OS-5.1)
   - `CLAUDE_WORKSPACES_ROOT` is absent (removed from configuration.ts in OS-5.1)
   - A `# GEMINI PROVIDER` section exists with `GEMINI_ENABLED`, `GEMINI_API_KEY`, `GEMINI_BASE_URL`, `GEMINI_MODEL`
   - A `# CODEX PROVIDER (OpenAI)` section exists with `CODEX_ENABLED`, `CODEX_MODEL`, `OPENAI_BASE_URL` (note: `OPENAI_API_KEY` is shared with Story 5.5 Whisper)
   - A `# KIMI PROVIDER` section exists with `KIMI_ENABLED`, `KIMI_API_KEY`, `KIMI_BASE_URL`, `KIMI_MODEL`
   - `ANTHROPIC_BASE_URL=` is present with a comment (optional LiteLLM/proxy override)
   - `AI_PRIMARY_PROVIDER=` is present with valid values comment: `CLAUDE_CODE`, `GEMINI`, `CODEX`, `KIMI`
   - `CLAUDE_MAX_CONCURRENT=5` is present

2. **Given** `.env.example` is regenerated
   **When** a developer inspects the infrastructure/container sections
   **Then**:
   - The `# DOCKER CLIENT CONFIGURATION (Story 22.1)` section header is absent
   - The `# AI PROVIDER CONTAINER EXECUTION` section is absent along with: `ENABLE_CONTAINER_EXECUTION`, `DOCKER_CONTAINER_TIMEOUT_MS`, `DOCKER_MAX_CONCURRENT`, `SANDBOX_WORKSPACES_ROOT`, `SANDBOX_LOGS_ROOT`
   - The `# SANDBOX RESOURCE LIMIT ENFORCEMENT (Story 23.3)` section is absent along with: `SANDBOX_ENABLE_RESOURCE_LIMITS`, `SANDBOX_MEMORY_LIMIT_MB`, `SANDBOX_CPU_LIMIT_PERCENT`, `SANDBOX_MEMORY_SWAP_LIMIT_MB`
   - The `# OPENSANDBOX CONFIGURATION (Epic OS-1)` section is present and intact

3. **Given** the final CURSOR_HEADLESS production audit
   **When** the following grep is run: `grep -r "CURSOR_HEADLESS" src/ --include="*.ts"`
   **Then** it returns zero results

4. **Given** the WorkspaceService comment-only grep cleanup (deferred from OS-3.2)
   **When** the following grep is run: `grep -r "WorkspaceService" src/ --include="*.spec.ts"`
   **Then** it returns zero results — the three OS-3.1 documentation comment hits in `github-commit-orchestrator.service.spec.ts:85`, `pr-risk-assessor.service.spec.ts:91`, and `qa-orchestrator.service.spec.ts:99` are removed

5. **Given** Prometheus metrics validation post-migration
   **When** the `/metrics` endpoint is scraped after startup
   **Then** none of the removed DooD metrics appear: `sandbox_container_memory_limit_bytes`, `sandbox_container_cpu_limit_percent`, `sandbox_container_oom_events_total`, `sandbox_container_cpu_throttled_seconds_total`, `sandbox_container_memory_usage_bytes`

6. **Given** the final production readiness audit
   **When** `pnpm check` (lint + test + build) is run
   **Then** zero lint errors, zero test failures, build succeeds

## Tasks / Subtasks

- [ ] Task 1: Verify OS-5.1 prerequisite (AC: all)
  - Run `pnpm check` before starting — confirm it passes (OS-5.1 must be merged)
  - Confirm `configuration.ts` no longer has `anthropic.timeoutMs` or `anthropic.workspacesRoot` keys
  - Confirm `env.validation.ts` no longer has duplicate entries or DooD schemas

- [ ] Task 2: Regenerate `.env.example` — remove dead variables (AC: #1, #2)
  - Remove the `# DOCKER CLIENT CONFIGURATION (Story 22.1)` section header (empty shell)
  - Remove the entire `# AI PROVIDER CONTAINER EXECUTION` section and its variables:
    - `ENABLE_CONTAINER_EXECUTION`, `DOCKER_CONTAINER_TIMEOUT_MS`, `DOCKER_MAX_CONCURRENT`, `SANDBOX_WORKSPACES_ROOT`, `SANDBOX_LOGS_ROOT`
    - **`QA_CHECK_RETRY_MAX_ATTEMPTS`** — check if it exists in env.validation.ts first; if NOT present in the Joi schema, remove it from this dead section (it appears alongside DooD variables); if it IS validated, move it to the QA QUEUE PROCESSING section
  - Remove the entire `# SANDBOX RESOURCE LIMIT ENFORCEMENT (Story 23.3)` section and its variables:
    - `SANDBOX_ENABLE_RESOURCE_LIMITS`, `SANDBOX_MEMORY_LIMIT_MB`, `SANDBOX_CPU_LIMIT_PERCENT`, `SANDBOX_MEMORY_SWAP_LIMIT_MB`
    - And the resource profile comment block below them
  - Remove the CURSOR-specific variables from the AI PROVIDERS section:
    - `CURSOR_HEADLESS_ENABLED`
    - `CURSOR_CLI_PATH` and its Story 2.6 comment block
    - `CURSOR_HEADLESS_TIMEOUT_MS`
    - `CURSOR_WORKSPACES_ROOT`
    - `CURSOR_MAX_CONCURRENT_WORKSPACES`
    - `CURSOR_PRESERVE_FAILED_WORKSPACES`
  - Remove `CURSOR_GIT_USER_NAME` and `CURSOR_GIT_USER_EMAIL` (not in env.validation.ts, not in any `.ts` source file)
  - Remove `ANTHROPIC_TIMEOUT_MS` (removed from configuration.ts in OS-5.1)
  - Remove `CLAUDE_WORKSPACES_ROOT` (removed from configuration.ts in OS-5.1)
  - Run a comprehensive audit grep to catch any remaining hits from the full epics AC2 list:
    ```bash
    grep -n "DOCKER_SOCKET_PATH\|DOCKER_CONNECTION_RETRY_ATTEMPTS\|DOCKER_CONNECTION_RETRY_DELAY_MS\|WINDSURF_API_KEY\|LOG_STREAM_THROTTLE_MS\|CURSOR_HEADLESS_HEALTH_URL\|CURSOR_HEADLESS_TIMEOUT\b\|CURSOR_MAX_CONCURRENT\b\|CURSOR_API_KEY\|CURSOR_WORKSPACE_CLEANUP_AGE_MS" .env.example
    ```
    Remove any hits found.

- [ ] Task 3: Regenerate `.env.example` — add new provider sections (AC: #1)
  - Add `ANTHROPIC_BASE_URL=` near the other Anthropic variables:
    ```
    # Optional: Override Anthropic API base URL (e.g., for LiteLLM proxy)
    ANTHROPIC_BASE_URL=
    ```
  - Add `AI_PRIMARY_PROVIDER=` near `CLAUDE_CODE_ENABLED`:
    ```
    # Optional: Force all tickets to a single provider (bypasses complexity routing)
    # Valid values: CLAUDE_CODE, GEMINI, CODEX, KIMI (leave empty for auto-routing)
    AI_PRIMARY_PROVIDER=
    ```
  - Add `CLAUDE_MAX_CONCURRENT=5` near `CLAUDE_CODE_ENABLED` if not already present
  - Add new provider sections after the existing Anthropic variables:

    ```
    # ============================================
    # GEMINI PROVIDER (Story OS-4.2)
    # ============================================
    # Dark-deployed by default — enable with GEMINI_ENABLED=true
    GEMINI_ENABLED=false
    GEMINI_API_KEY=
    GEMINI_BASE_URL=
    GEMINI_MODEL=gemini-2.5-pro

    # ============================================
    # CODEX PROVIDER (Story OS-4.3)
    # ============================================
    # OPENAI_API_KEY is shared with Story 5.5 Whisper transcription (declared above)
    # Dark-deployed by default — enable with CODEX_ENABLED=true
    CODEX_ENABLED=false
    OPENAI_BASE_URL=
    CODEX_MODEL=codex-1

    # ============================================
    # KIMI PROVIDER (Story OS-4.3)
    # ============================================
    # Dark-deployed by default — enable with KIMI_ENABLED=true
    KIMI_ENABLED=false
    KIMI_API_KEY=
    KIMI_BASE_URL=
    KIMI_MODEL=kimi-k2
    ```

- [ ] Task 4: Verify WorkspaceService comment cleanup in configuration.ts (AC: #4)
  - Run: `grep -n "WorkspaceService" src/config/configuration.ts`
  - **This is expected to return zero results** — the deferred work comment was from a previous state and may already be clean
  - If zero results: mark done, no action needed
  - If any hits remain: remove or reword the comment to not mention WorkspaceService

- [ ] Task 5: Clean up WorkspaceService documentation comments in spec files (AC: #4)
  - Remove the `// WorkspaceService removed (handled by OpenSandbox TTL)` comment from these exact lines:
    - `src/github/services/github-commit-orchestrator.service.spec.ts:85`
    - `src/github/services/pr-risk-assessor.service.spec.ts:91`
    - `src/qa-automation/qa-orchestrator.service.spec.ts:99`
  - Verify: `grep -r "WorkspaceService" src/ --include="*.spec.ts"` returns 0

- [ ] Task 6: Run final CURSOR_HEADLESS audit (AC: #3)
  - Run: `grep -r "CURSOR_HEADLESS" src/ --include="*.ts"` — must return 0
  - If any hits remain, remove them (should be comment-only stale references)

- [ ] Task 7: Final production verification (AC: #5, #6)
  - Run full dead-var grep check to confirm nothing stale remains in src/:
    ```bash
    grep -r "CURSOR_HEADLESS\|CURSOR_WORKSPACES_ROOT\|CURSOR_CLI_PATH\|CLAUDE_WORKSPACES_ROOT\|SANDBOX_WORKSPACES_ROOT\|ENABLE_CONTAINER_EXECUTION\|DOCKER_CONTAINER_TIMEOUT_MS\|ANTHROPIC_TIMEOUT_MS\|sandbox\.workspacesRoot\|sandbox\.logsRoot\|anthropic\.workspacesRoot\|anthropic\.timeoutMs" src/ --include="*.ts"
    ```
    Must return 0 results
  - Prometheus metrics check: start the app and confirm `/metrics` does NOT contain `sandbox_container_memory_limit_bytes`, `sandbox_container_cpu_limit_percent`, `sandbox_container_oom_events_total`, `sandbox_container_cpu_throttled_seconds_total`, `sandbox_container_memory_usage_bytes`
  - Run `pnpm check` — zero lint errors, zero test failures, build succeeds

## Dev Notes

### Files to Modify

| File               | Path                          | Change Type                                                         |
| ------------------ | ----------------------------- | ------------------------------------------------------------------- |
| `.env.example`     | `.env.example`                | Major restructure — remove dead sections, add new provider sections |
| Spec files (3)     | see Task 5                    | Comment cleanup only (1 line per file)                              |
| `configuration.ts` | `src/config/configuration.ts` | Verify only — likely already clean                                  |

### Critical: Do NOT Remove from .env.example

| Variable                                      | Reason to Keep                                                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FEATURE_AUTO_APPROVE_AFTER_QA`               | **Keep** — used in `configuration.ts:152` as `autoApproveAfterQa: process.env.FEATURE_AUTO_APPROVE_AFTER_QA === 'true'`. Intentionally unvalidated by Joi (boolean flag, defaults false). |
| `OPENAI_API_KEY`                              | Shared between Codex provider (OS-4.3) AND Story 5.5 Whisper transcription. Has Joi schema in env.validation.ts. Keep in Story 5.5 section with a note that Codex also uses it.           |
| All `OPENSANDBOX_*` variables                 | Active — used by SandboxService                                                                                                                                                           |
| All `REDIS_URL`, `RABBITMQ_*`, `DATABASE_URL` | Core infrastructure                                                                                                                                                                       |

### What's Already Clean (No Action Needed)

- `env.validation.ts`: CURSOR_HEADLESS has no Joi schema (already removed)
- `env.validation.ts`: DOCKER_CONTAINER_TIMEOUT_MS has no Joi schema (already removed by OS-5.1)
- `configuration.ts`: `cursor` config block already removed
- `configuration.ts`: `sandbox` config block removed by OS-5.1
- `configuration.ts`: WorkspaceService references — **confirmed clean** (grep returns 0 as of story creation)

### Current .env.example Dead Sections (exact section headers to remove)

```
# ============================================
# DOCKER CLIENT CONFIGURATION (Story 22.1)
# ============================================
# ============================================       ← empty shell, just a double-closed comment
```

```
# ============================================
# AI PROVIDER CONTAINER EXECUTION
# ============================================
```

```
# ============================================
# SANDBOX RESOURCE LIMIT ENFORCEMENT (Story 23.3)
# ============================================
```

### CURSOR Variables Currently in .env.example (all dead)

Located around the `# AI PROVIDERS` comment:

```
CURSOR_HEADLESS_ENABLED=false
CURSOR_CLI_PATH="/Users/Alpharages/.local/bin/cursor-agent"
CURSOR_HEADLESS_TIMEOUT_MS=300000
CURSOR_WORKSPACES_ROOT="/tmp/cursor-workspaces"
CURSOR_MAX_CONCURRENT_WORKSPACES=10
CURSOR_PRESERVE_FAILED_WORKSPACES=true
```

Located in git configuration section:

```
CURSOR_GIT_USER_NAME="Dark Factory Bot"   ← not in env.validation.ts, not used in any .ts source file
CURSOR_GIT_USER_EMAIL="bot@darkfactory.ai"
```

### ANTHROPIC Dead Variables in .env.example

```
ANTHROPIC_TIMEOUT_MS=300000      ← REMOVE (removed from configuration.ts in OS-5.1)
CLAUDE_WORKSPACES_ROOT="/tmp/claude-workspaces"   ← REMOVE (removed from configuration.ts in OS-5.1)
```

**Safe only after OS-5.1 is complete** — both are still read by the current configuration.ts until OS-5.1 cleans them.

### New Anthropic Block Expected After Cleanup

```
# ANTHROPIC CLAUDE API (Story 2.7)
ANTHROPIC_API_KEY=""
# Heavy model for code generation tasks
ANTHROPIC_MODEL=claude-sonnet-4-20250514
# Cheap model for commit messages
ANTHROPIC_COMMIT_MESSAGE_MODEL=claude-3-haiku-20240307
ANTHROPIC_MAX_TOKENS=8000
# Optional: Override Anthropic API base URL (e.g., for LiteLLM proxy or local dev)
ANTHROPIC_BASE_URL=
```

### WorkspaceService Spec File Removals (exact lines confirmed)

```
src/github/services/github-commit-orchestrator.service.spec.ts:85  → // WorkspaceService removed (handled by OpenSandbox TTL)
src/github/services/pr-risk-assessor.service.spec.ts:91            → // WorkspaceService removed (handled by OpenSandbox TTL)
src/qa-automation/qa-orchestrator.service.spec.ts:99               → // WorkspaceService removed (handled by OpenSandbox TTL)
```

Simply remove these comment lines. No functional code is affected.

### Deferred Work Items Resolved by This Story

From `deferred-work.md`:

- **OS-3.2**: "WorkspaceService grep check returns 5 comment-only hits — Clean up in OS-5.2 final grep-clean pass" ✓ Resolved by Tasks 4 & 5
- **Epics note**: "The `CURSOR_HEADLESS` grep check is deferred to Story OS-5.2" ✓ Resolved by Task 6

### Epic OS-5 Context

This is the final story (2 of 2) in Epic OS-5. After this story:

- The entire OpenSandbox migration sprint (OS-1 through OS-5) is complete
- All 9 mandatory grep checks pass
- `.env.example` is the definitive developer setup reference
- Epic OS-5 retrospective can be run

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
