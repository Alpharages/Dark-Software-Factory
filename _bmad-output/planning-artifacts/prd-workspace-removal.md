---
stepsCompleted:
  [
    'step-01-init',
    'step-02-discovery',
    'step-02b-vision',
    'step-02c-executive-summary',
    'step-03-success',
    'step-04-journeys',
    'step-05-domain',
    'step-06-innovation',
    'step-07-technical',
    'step-08-scoping',
    'step-09-functional',
    'step-10-nfr',
    'step-11-complete',
    'step-e-01-discovery',
    'step-e-02-review',
    'step-e-03-edit',
  ]
status: approved
lastEdited: '2026-03-31'
date: '2026-03-31'
inputDocuments:
  - docs/AI-CONTEXT.md
  - _bmad-output/planning-artifacts/prd-opensandbox-migration.md
  - _bmad-output/planning-artifacts/prd.md
workflowType: 'prd'
classification:
  projectType: api_backend
  domain: general
  complexity: medium
  projectContext: brownfield
---

# Product Requirements Document - Dark Software Factory

**Author:** Khakanali
**Date:** 2026-03-31

## Executive Summary

DSF's execution pipeline was designed for Docker-out-of-Docker (DooD): a `Workspace` record tracked a local directory on the host server where the AI cloned the repo, wrote code, and the downstream QA → GitHub push → PR pipeline operated on that local path. The OpenSandbox migration (Epic OS) replaced the DooD execution layer with ephemeral remote sandbox containers, but the `Workspace` DB concept and its entire downstream pipeline were left in place. The result is a broken execution pipeline: every sandbox execution hits `prisma.workspace.findUnique()` → receives `null` → QA fails silently → no code is ever pushed to GitHub.

This PRD defines the work to complete the OpenSandbox migration by eliminating the `Workspace` concept entirely and redesigning the execution model around a fully agentic sandbox workflow.

**Target state:** The NestJS backend is a thin orchestrator — it routes the ticket to a provider, starts the sandbox, waits for the result, and records it. The sandbox runs an AI agent (Claude Code with a bundled `dsf-execution` Agent Skill; Codex/Kimi/Gemini via equivalent prompt injection) that autonomously handles the entire execution lifecycle: clone repository → implement changes → run QA with self-healing (agent reads lint/test errors, fixes root cause, retries) → commit → push → open PR. No local workspace, no downstream queue pipeline, no `workspace_path` dependency anywhere.

**Real-time visibility:** The sandbox command emits structured JSON progress markers to stdout at each milestone. `ClaudeCodeProvider` parses the stream and calls `ExecutionTrackerService.emitProgress()` in real-time, advancing the frontend progress bar from 10% through to 100% while raw agent output streams concurrently via `ExecutionGateway.emitLog()`.

### What Makes This Special

The key architectural insight is that **the AI agent is already capable of running the full delivery workflow** — git, QA, commit, PR creation — without the backend orchestrating each step. The current pipeline treats the AI as a code-writing tool that needs hand-holding through every downstream step. The new model treats it as an autonomous agent that owns the full delivery loop. Self-healing QA is a first-class capability: if linting fails, the agent reads the error, edits the file, and retries — something a bash script fundamentally cannot do. The backend's role shrinks from orchestrator to recorder.

## Project Classification

| Attribute            | Value                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| **Project Type**     | Backend infrastructure — API / service layer                                                       |
| **Domain**           | Developer tooling / AI orchestration platform                                                      |
| **Complexity**       | Medium — scoped refactoring across ~8 services + 2 schema migrations, well-understood blast radius |
| **Project Context**  | Brownfield — modifying existing production system; no production `Workspace` data exists           |
| **Predecessor Epic** | OS (OpenSandbox Migration) — this PRD completes the work that OS left as a non-goal (NG4)          |

## Success Criteria

### User Success

- A PM creates a ticket in ClickUp at the trigger status → the DSF UI shows the execution starting with live progress updates advancing from 10% through clone → implement → QA → push → PR → 100%
- Raw agent output (stdout) streams live in the UI log feed so the user can see exactly what the agent is doing in real time
- When execution completes, a feature branch and open PR exist on GitHub with no human engineering intervention
- If the agent encounters lint or test failures, it self-heals (reads errors, fixes root cause, retries) without the execution failing
- ClickUp ticket moves to the configured "code review" status automatically after PR creation

### Business Success

- End-to-end execution success rate rises from ~0% (currently broken at GitHub push) to a functioning baseline across all 4 providers
- All 4 providers (Claude Code, Codex, Kimi, Gemini) can execute the full workflow: clone → implement → QA → commit → push → PR
- Zero orphaned executions — every execution that reaches COMPLETED has a corresponding PR on GitHub

### Technical Success

- `Workspace` and `WorkspaceArchive` tables dropped from Prisma schema with migration
- Zero `workspace_path` references remaining anywhere in the codebase
- `QaOrchestratorService` no longer blocks the pipeline when workspace is null for sandbox executions
- `GitHubCommitOrchestrator` and `GitHubPushTriggerConsumer` bypassed for all sandbox provider executions
- `ExecutionTrackerService.emitProgress()` called at every sandbox milestone (clone 20%, implement 40–75%, QA 80%, push 90%, PR 95%, done 100%)
- `ClaudeCodeProvider` bundles `dsf-execution` Agent Skill (`SKILL.md`) in the container image; all other providers inject the equivalent workflow as a structured system prompt

### Measurable Outcomes

| Outcome                  | Target                                                                  |
| ------------------------ | ----------------------------------------------------------------------- |
| GitHub push success rate | > 90% of non-budget-blocked executions produce a PR                     |
| UI progress coverage     | Progress events emitted at ≥ 5 milestones per execution                 |
| Provider coverage        | All 4 providers pass end-to-end smoke test                              |
| Schema cleanliness       | 0 `workspace_path` references, 0 `Workspace` model usages post-deploy   |
| Self-healing QA          | Agent retries at least once on QA failure before reporting final status |

## Product Scope

### MVP — Minimum Viable Product

- Drop `Workspace` + `WorkspaceArchive` schema, all references removed
- `ClaudeCodeProvider` runs full agentic workflow (clone → implement → QA self-heal → commit → push → PR) using bundled `dsf-execution` SKILL.md
- Codex, Kimi, Gemini providers run same workflow via prompt injection
- Structured JSON progress markers emitted to stdout → parsed → `emitProgress()` called → frontend bar advances
- Raw stdout streamed live to frontend via existing `ExecutionGateway.emitLog()`
- Pipeline deletion: `QaOrchestratorService` workspace-dependent path, `GitHubPushTriggerConsumer`, and `GitHubCommitOrchestrator` deleted in their entirety

### Growth (Post-MVP)

- Configurable max self-healing retry limit per project (DB setting)
- Per-step QA results visible in UI (lint error count, test pass/fail panel)
- MCP server injected into sandbox for structured tool access (GitHub API, test runner)

### Vision (Future — to discuss)

- TBD

## User Journeys

### Journey 1 — PM: Full Success Path

**Persona:** Khakanali, Orchestration Lead. He moves a ticket to "In Development" in ClickUp and opens the DSF dashboard to watch.

**Opening:** Ticket enters the AI trigger status. The DSF UI immediately shows the execution card at 10% — "Budget Check passed." He's seen this screen freeze at 10% before. This time it keeps moving.

**Rising Action:** Progress advances in real-time — "Cloning repository" (20%) → "Implementing changes" (40%→75% as the agent works) → "Running QA" (80%) → "Pushing to GitHub" (90%) → "Opening PR" (95%). The live log feed below shows the agent's raw output — he can see it editing files, running `pnpm lint`, committing.

**Climax:** Progress hits 100%. A PR link appears in the execution card. ClickUp ticket moves automatically to "Code Review."

**Resolution:** Khakanali opens the PR — clean branch, AI-generated commit message, diff looks correct. He assigns it to a reviewer. No developer was involved in the execution.

---

### Journey 2 — PM: Self-Healing QA

**Opening:** Same trigger. Progress reaches "Running QA" (80%) and pauses. The log feed shows: `ESLint: 3 errors — 'result' is defined but never used`. He watches.

**Rising Action:** Instead of failing, the progress bar shows "QA failed — agent retrying." The log feed shows the agent reading the lint errors, editing the file, running lint again. Second attempt: clean. Progress resumes to 90% → 95% → 100%.

**Resolution:** PR opens. The commit message notes lint fixes were applied. No human intervention needed.

---

### Journey 3 — PM: Hard QA Failure (Choice Required)

**Opening:** Execution reaches QA at 80%. The agent tries to fix a failing test — it's a logic error in the implementation, not a formatting issue. The agent retries 3 times. Still failing.

**Rising Action:** Progress stops at 82%. A UI alert appears: "QA failed after 3 retries. Code has been pushed to `feature/ticket-9mc3xp`. Tests are failing in `payment.service.spec.ts`." A ClickUp comment is added with the same details and the last test error output.

**Climax:** Khakanali has two buttons: **"Open PR Anyway"** (I'll flag it for manual review) and **"Cancel"** (leave it on the branch, developer will take over).

**Resolution — Cancel path:** He clicks Cancel. Ticket moves to a "Needs Manual Review" status. A developer picks up the branch from where the agent left it and fixes the failing test manually.

**Resolution — Open PR path:** He clicks "Open PR Anyway." PR is created with a `qa-failed` label. Reviewer knows upfront this needs manual QA attention.

---

### Journey 4 — PM: Execution Crash (No Code Written)

**Opening:** The sandbox container crashes during implementation — ANTHROPIC_API_KEY rate limit hit mid-execution, or the repo URL is unreachable.

**Rising Action:** Progress stops at 45% ("Implementing changes"). After the timeout, the execution card shows "Failed — agent did not complete." No branch was created.

**Resolution:** ClickUp comment added: "Execution failed — no code was pushed. Reason: [error message]." Ticket reverts to its previous status. Khakanali re-queues it once the issue is resolved. No manual cleanup needed — no branch to delete.

---

### Journey 5 — Platform Engineer: Deploying New Container Image

**Persona:** DevOps engineer deploying the updated `dsf-agents` container image.

**Opening:** Receives updated image tag with the bundled `dsf-execution` SKILL.md and updated provider env var requirements.

**Rising Action:** Updates `OPENSANDBOX_AGENT_IMAGE` env var. Verifies `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, and the 3 new provider keys (`CODEX_API_KEY`, `KIMI_API_KEY`, `GEMINI_API_KEY`) are set. Runs the provider health check endpoint — all 4 providers return healthy. Runs a smoke-test execution against a test ticket.

**Resolution:** Smoke test completes end-to-end. Provider health dashboard shows all 4 providers active. Rolls out to production.

---

### Journey 6 — Developer: Adding a New Provider

**Opening:** Team wants to add a 5th provider. Developer implements `ICodingAgentProvider` — about 50 lines. The interface contract is clear: inject workflow via structured prompt, emit `{"type":"progress",...}` markers to stdout, return `{ success, prUrl, commitSha, branchName }`.

**Resolution:** New provider registered in `ProviderFactoryService`. Health check, routing weight, and fallback strategy are all that need configuring. No changes to QA, GitHub push, or PR pipeline — the provider owns all of that internally.

### Journey Requirements Summary

| Capability Needed                                           | Revealed By      |
| ----------------------------------------------------------- | ---------------- |
| Real-time progress events (5+ milestones)                   | Journeys 1, 2, 3 |
| Live log feed in UI                                         | Journeys 1, 2, 3 |
| Self-healing QA retry loop (N retries)                      | Journey 2        |
| Push-without-PR on hard QA failure                          | Journey 3        |
| PM notification with [Open PR] / [Cancel] actions           | Journey 3        |
| `qa-failed` PR label on manual override                     | Journey 3        |
| Graceful crash handling with no branch cleanup needed       | Journey 4        |
| Provider health endpoint (all 4 providers)                  | Journey 5        |
| `ICodingAgentProvider` interface with clear return contract | Journey 6        |

## Domain-Specific Requirements

### Security Constraints

- **API key redaction in logs** — `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `CODEX_API_KEY`, `KIMI_API_KEY`, `GEMINI_API_KEY` are all injected as sandbox env vars. The existing `SandboxService` NFR-OS5 redaction pattern must extend to cover all new provider keys. Raw env values must never appear in logs or Sentry captures.
- **GitHub token scope** — The `GITHUB_TOKEN` injected into the sandbox must be a fine-grained token scoped to `contents: write` and `pull_requests: write` per repository. Broad-scope tokens are not acceptable for sandbox injection.
- **Agent Skill file integrity** — The `dsf-execution` SKILL.md bundled in the container image must be reviewed as part of the container image build and release process. Per Anthropic security guidance, malicious or compromised skills can direct Claude to make unexpected network calls or exfiltrate data. Review is mandatory before any image tag promotion to production.
- **Sandbox network egress** — Per OS PRD `FR-OS6`, per-sandbox egress policies must be applied. The sandbox requires egress to: the target GitHub repository host, the AI provider API endpoint, and package registries (npm). All other outbound traffic should be denied by default.

## Innovation & Novel Patterns

### Detected Innovation Areas

**1. AI Agent as Delivery Loop Owner**
Mainstream AI code generation platforms position the AI as a code-writing tool: it produces output, then a separate QA system, git pipeline, and PR workflow handle the rest. This architecture inverts that model. The AI agent owns the full delivery loop — from cloning the repository to opening the PR. The NestJS backend becomes a recorder of outcomes, not an orchestrator of steps. This is a genuine architectural shift: "AI agent as autonomous CI/CD participant" rather than "AI as a code generation service."

**2. Self-Healing QA as a First-Class Execution Primitive**
Self-healing in most systems means retry wrappers or `--fix` flags. In this model, self-healing is a designed primitive: the agent reads QA error output, reasons about root cause in the context of its own implementation, edits the relevant file, and reruns the check. This is semantically different from automated retries — it requires understanding and targeted repair, not repetition. The distinction matters because it changes the failure surface: recoverable QA errors (lint, unused imports, type mismatches) become non-events rather than execution failures.

**3. Agent Skills as Executable Operating Procedures**
Packaging the delivery workflow as a `dsf-execution` SKILL.md that Claude loads natively establishes a new pattern for the platform: operational procedures defined as machine-readable agent skills rather than long system prompts or hardcoded command strings. This creates a maintainable, auditable, version-controlled "operating procedure" layer that is separate from the backend code. Future agent behaviors (new QA strategies, different commit conventions, deployment verification steps) become Skill updates rather than provider code changes.

## Technical & API Requirements

### New API Endpoint — PM Resolution for Hard QA Failures

```
POST /api/v1/executions/:id/resolve-qa-failure
Body: { "action": "open_pr" | "cancel" }
```

- `open_pr` — creates PR on the already-pushed branch, adds `qa-failed` label, advances ClickUp ticket to configured `code_review_status`
- `cancel` — moves ClickUp ticket to configured `manual_review_status`, leaves branch as-is, marks execution `FAILED`

**Error responses:**

- `404 Not Found` — execution ID does not exist
- `409 Conflict` — execution exists but is not in `QA_FAILED` state
- `422 Unprocessable Entity` — `action` value is not `open_pr` or `cancel`

### Updated Provider Return Contract

All sandbox providers implement `ICodingAgentProvider` and return:

```typescript
interface IAIExecutionResult {
  success: boolean;
  provider: string;
  tokensUsed?: number;
  cost?: number;
  error?: string;
  // Sandbox-required fields:
  prUrl?: string;
  commitSha?: string;
  branchName?: string;
  qaStatus: 'passed' | 'self_healed' | 'failed' | 'skipped';
  qaRetryCount: number;
}
```

### Execution State & ClickUp Config

**New `ExecutionPhase` value:**

```typescript
QA_FAILED = 'QA_FAILED'; // hard QA failure — awaiting PM decision
```

**New per-project config fields** (no hardcoded ClickUp status names — runtime-discovered via `PMStatusService`):

| Field                  | Purpose                                                                       |
| ---------------------- | ----------------------------------------------------------------------------- |
| `qa_failure_status`    | ClickUp status to set when hard QA failure occurs (e.g. "QA Failed")          |
| `manual_review_status` | ClickUp status to set when PM cancels resolution (e.g. "Needs Manual Review") |

### `dsf-execution` Agent Skill

Bundled in the `dsf-agents` container image at `~/.claude/skills/dsf-execution/SKILL.md`. Claude loads it natively. Defines the full delivery workflow:

1. Clone repository at `$REPO_URL` to `$FEATURE_BRANCH`
2. Implement changes per `$TASK_DESCRIPTION`
3. Run QA (lint + tests); on failure: read errors → reason about root cause → fix → retry (max `$QA_MAX_RETRIES`, default 3)
4. Commit with AI-generated message
5. Push `$FEATURE_BRANCH` to origin
6. Open PR via `gh pr create`
7. Emit structured JSON progress markers to stdout at each milestone

Codex, Kimi, and Gemini providers inject the equivalent workflow as a structured system prompt inside `execute()`. The SKILL.md is Claude-exclusive.

### Progress Marker Format

Sandbox stdout emits newline-delimited JSON. `ClaudeCodeProvider` parses each line; on `type: "progress"` it calls `ExecutionTrackerService.emitProgress(executionId, pct, msg)`. Raw stdout streams concurrently via `ExecutionGateway.emitLog()`.

```jsonc
{"type":"progress","pct":10,"msg":"Budget check passed"}
{"type":"progress","pct":20,"msg":"Cloning repository"}
{"type":"progress","pct":40,"msg":"Implementing changes"}
{"type":"progress","pct":75,"msg":"Implementation complete"}
{"type":"progress","pct":80,"msg":"Running QA"}
{"type":"progress","pct":82,"msg":"QA failed — retrying (1/3)"}
{"type":"progress","pct":90,"msg":"Pushing to GitHub"}
{"type":"progress","pct":95,"msg":"Opening PR"}
{"type":"progress","pct":100,"msg":"Done"}
// Final result line — parsed to populate IAIExecutionResult:
{"type":"result","success":true,"prUrl":"...","commitSha":"...","branchName":"...","qaStatus":"self_healed","qaRetryCount":1}
```

### Schema Changes

**Drop from `prisma/schema.prisma`:**

- `model Workspace` (including `enum WorkspaceStatus`)
- `model WorkspaceArchive`

Migration: `drop_workspace_tables` — no data loss, confirmed no production data in either table.

**Zero `workspace_path` references permitted post-migration.** All references across all services must be removed, not made conditional.

### Legacy DooD Pipeline — Full Removal

The Docker-out-of-Docker execution path is removed entirely. No provider-type gates, no fallback to the old path:

| Component                                        | Action                                   |
| ------------------------------------------------ | ---------------------------------------- |
| `QaOrchestratorService` workspace-dependent path | **Deleted** — QA runs inside sandbox     |
| `GitHubPushTriggerConsumer`                      | **Deleted** — sandbox owns git push      |
| `GitHubCommitOrchestrator`                       | **Deleted** — sandbox owns commit + push |
| `Workspace` / `WorkspaceArchive` Prisma models   | **Dropped**                              |
| All `workspace_path` field references            | **Removed**                              |

All executions go through the sandbox agentic workflow. The legacy pipeline is not preserved behind a feature flag.

## Scope

### In Scope

| Item                                                    | Notes                                                 |
| ------------------------------------------------------- | ----------------------------------------------------- |
| Drop `Workspace` + `WorkspaceArchive` schema            | Migration + all reference removal                     |
| `ClaudeCodeProvider` full agentic workflow              | Clone → implement → QA self-heal → commit → push → PR |
| Codex, Kimi, Gemini full agentic workflow               | Same workflow via prompt injection                    |
| `dsf-execution` SKILL.md                                | Bundled in `dsf-agents` container image               |
| Structured progress markers → UI bar                    | Parse stdout → `emitProgress()` → WebSocket           |
| PM resolution endpoint for hard QA failures             | `POST /resolve-qa-failure`                            |
| New per-project config fields                           | `qa_failure_status`, `manual_review_status`           |
| Delete `QaOrchestratorService` workspace-dependent path | Full deletion, not bypass                             |
| Delete `GitHubPushTriggerConsumer`                      | Full deletion                                         |
| Delete `GitHubCommitOrchestrator`                       | Full deletion                                         |
| API key redaction extended to new provider keys         | `CODEX_API_KEY`, `KIMI_API_KEY`, `GEMINI_API_KEY`     |

### Out of Scope

| Item                                            | Rationale                                                |
| ----------------------------------------------- | -------------------------------------------------------- |
| Frontend UI changes for PM resolution modal     | Separate frontend epic; backend endpoint is the contract |
| Configurable max retry limit in DB              | Post-MVP — default of 3 hardcoded initially              |
| Per-step QA results panel in UI                 | Post-MVP                                                 |
| MCP server injection into sandbox               | Future vision                                            |
| Changes to non-sandbox execution infrastructure | Nothing non-sandbox remains after DooD removal           |
| Migrating existing `Execution` records          | No schema change to `Execution` table                    |

## Functional Requirements

### FR-WR1 — Schema Removal

The `Workspace` and `WorkspaceArchive` Prisma models and the `WorkspaceStatus` enum must be dropped via a database migration. Zero `workspace_path` field references may remain in any service, consumer, or query after the migration is applied.

### FR-WR2 — Legacy Pipeline Removal

`QaOrchestratorService` workspace-dependent execution path, `GitHubPushTriggerConsumer`, and `GitHubCommitOrchestrator` must be deleted in their entirety. No provider-type gate or feature flag preserves the old path.

### FR-WR3 — Provider Agentic Workflow

Each provider's `execute()` method must run the full delivery loop inside the sandbox: clone → implement → QA (with self-healing) → commit → push → open PR. The NestJS backend must not orchestrate any of these steps externally.

### FR-WR4 — Agent Skill (Claude Code)

`ClaudeCodeProvider` must inject the `dsf-execution` SKILL.md into the sandbox execution. The SKILL.md file must be bundled in the `dsf-agents` container image and version-controlled. The sandbox command must pass `REPO_URL`, `FEATURE_BRANCH`, `TASK_DESCRIPTION`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, and `QA_MAX_RETRIES` as environment variables.

### FR-WR5 — Prompt Injection (Codex, Kimi, Gemini)

Codex, Kimi, and Gemini providers must inject the equivalent delivery workflow as a structured system prompt within `execute()`. The prompt must specify the same milestone sequence and progress marker format as the SKILL.md.

### FR-WR6 — Self-Healing QA

The sandbox agent must retry QA on failure up to `QA_MAX_RETRIES` times (default 3). Each retry must read the QA error output, reason about root cause, edit the relevant file(s), and re-run the QA check. Dumb retries without file edits do not satisfy this requirement.

### FR-WR7 — Structured Progress Markers

The sandbox command must emit newline-delimited JSON progress markers to stdout at a minimum of 5 milestones per execution (10%, 20%, 40–75%, 80%, 90%, 95%, 100%). `ClaudeCodeProvider` must parse each stdout line; on `type: "progress"`, call `ExecutionTrackerService.emitProgress(executionId, pct, msg)`.

### FR-WR8 — Live Log Streaming

Raw sandbox stdout and stderr must stream to the frontend in real time via `ExecutionGateway.emitLog()` (existing behavior in `SandboxService` — must be preserved).

### FR-WR9 — Hard QA Failure Handling

When QA fails after all retries, the provider must: push the branch to GitHub, record `qaStatus: 'failed'` in the result, and return without opening a PR. The execution state must be set to `QA_FAILED`. The ClickUp ticket must be moved to the configured `qa_failure_status`.

### FR-WR10 — PM Resolution Endpoint

`POST /api/v1/executions/:id/resolve-qa-failure` must accept `{ action: 'open_pr' | 'cancel' }`.

- `open_pr`: create PR on the pushed branch with `qa-failed` label, move ClickUp ticket to `code_review_status`, mark execution `COMPLETED`
- `cancel`: move ClickUp ticket to `manual_review_status`, mark execution `FAILED`, leave branch in place

### FR-WR11 — Per-Project Config Fields

`qa_failure_status` and `manual_review_status` must be configurable per project via the existing project settings model. Status names must be runtime-discovered via `PMStatusService` — no hardcoded ClickUp status name strings.

### FR-WR12 — API Key Redaction

The `SandboxService` redaction pattern must cover `CODEX_API_KEY`, `KIMI_API_KEY`, and `GEMINI_API_KEY` in addition to the existing sensitive key patterns. Raw key values must never appear in logs or Sentry captures.

### FR-WR13 — Final Result Line

The sandbox command must emit a `{"type":"result",...}` JSON line as the last stdout line. `ClaudeCodeProvider` must parse this to populate `prUrl`, `commitSha`, `branchName`, `qaStatus`, and `qaRetryCount` in the returned `IAIExecutionResult`.

### FR-WR14 — Execution Crash Handling

When the sandbox container terminates without emitting a final result line (timeout, API rate limit, unreachable repository, or any unrecovered error), the execution must: (1) mark the execution state as `FAILED` with the error reason recorded; (2) emit the error reason to the real-time UI so the execution card displays "Failed — agent did not complete. Reason: [error message]"; (3) post a ClickUp comment: "Execution failed — no code was pushed. Reason: [error message]"; (4) revert the ClickUp ticket to its pre-trigger status. No branch cleanup is required — if no code was pushed, no branch exists.

## Non-Functional Requirements

### NFR-WR1 — No Production Data Loss

The `drop_workspace_tables` migration must be applied only after confirming zero rows in `Workspace` and `WorkspaceArchive`. The migration must fail fast (not silently) if rows exist.

### NFR-WR2 — Execution Timeout

The full agentic workflow — including all self-healing retries — must complete within the TTL configured via `OPENSANDBOX_SANDBOX_TIMEOUT_S`. No additional timeout layer is introduced; the existing sandbox TTL enforcement is the sole timeout boundary. If the TTL is exceeded, FR-WR14 crash handling applies.

### NFR-WR3 — Concurrency Unchanged

Existing `SandboxService` semaphore-based concurrency limit (`OPENSANDBOX_MAX_CONCURRENT`) applies unchanged to agentic executions. No separate limit for self-healing retries.

### NFR-WR4 — Stdout Parsing Resilience

`ClaudeCodeProvider` stdout parsing must be resilient to non-JSON lines (agent will produce human-readable output between markers). Only lines that successfully parse as `{ type: "progress" | "result" }` are acted on. Parse errors on individual lines must be logged at debug level and skipped — never crash the execution.

### NFR-WR5 — Key Redaction Coverage

No raw provider API key value may appear in any log output, Sentry event, or debug trace — including `CODEX_API_KEY`, `KIMI_API_KEY`, and `GEMINI_API_KEY`. Verification: a log scan after a test execution must return zero matches for any key value string.

### NFR-WR6 — SKILL.md Security Review

The `dsf-execution` SKILL.md must undergo mandatory security review before any container image tag is promoted to production. The review must verify: no unauthorized network calls, no exfiltration paths, explicit prohibition on committing `.env` files or secrets. This is treated as a code review gate, not an optional step.

### NFR-WR7 — Zero `workspace_path` References

CI must enforce zero remaining `workspace_path` references post-migration. A grep check or TypeScript build failure on removed Prisma fields serves as the enforcement mechanism.

### NFR-WR8 — Backward Compatibility

Existing REST API endpoints must not change in any way that would break current consumers. Breaking changes are defined as: removing or renaming an endpoint, adding a required request field, removing or renaming a response field, changing an HTTP status code for a documented response, or modifying authentication requirements. The new `resolve-qa-failure` endpoint is additive and does not constitute a breaking change. Frontend integration for the resolution modal is a separate frontend epic.

### Validation Approach

- **End-to-end smoke test** — trigger a real ticket against a test repository, verify PR is created, branch exists, commit SHA recorded in DB
- **Self-healing validation** — intentionally introduce a lint error in the test repository, verify the agent fixes and proceeds rather than failing
- **Hard failure path** — introduce a non-fixable test failure, verify code is pushed to branch but no PR is created, PM notification fires
- **Progress event validation** — verify all 5+ milestones emit `emitProgress()` calls during execution and frontend bar advances

### Risk Mitigation

| Risk                                                  | Mitigation                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Agent goes in an infinite self-healing loop           | Hard cap on retry count (configurable, default 3); timeout enforced by OpenSandbox TTL                        |
| SKILL.md instructions cause unexpected agent behavior | Mandatory security review of SKILL.md before container image promotion; treat like code review                |
| Agent commits credentials or secrets in code          | Sandbox network egress restricts exfiltration; SKILL.md instructions explicitly prohibit committing env files |
| Provider prompt injection via ticket content          | Ticket content passed as task description, not as system instructions; SKILL.md is authoritative              |
