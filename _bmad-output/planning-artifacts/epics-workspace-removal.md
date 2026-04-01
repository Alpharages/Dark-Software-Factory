---
stepsCompleted:
  [
    'step-01-validate-prerequisites',
    'step-02-design-epics',
    'step-03-create-stories',
    'step-04-final-validation',
  ]
inputDocuments:
  - _bmad-output/planning-artifacts/prd-workspace-removal.md
  - _bmad-output/planning-artifacts/architecture.md
---

# Dark Software Factory - Epic Breakdown (Workspace Removal)

## Overview

This document provides the complete epic and story breakdown for the Workspace Removal initiative (Dark Software Factory), decomposing the requirements from the PRD into implementable epics and stories. This epic completes the OpenSandbox migration by eliminating the `Workspace` DB concept and its entire downstream DooD pipeline, replacing it with a fully agentic sandbox workflow.

## Requirements Inventory

### Functional Requirements

FR-WR1: The `Workspace` and `WorkspaceArchive` Prisma models and `WorkspaceStatus` enum must be dropped via a database migration. Zero `workspace_path` field references may remain in any service, consumer, or query after the migration is applied.

FR-WR2: `QaOrchestratorService` workspace-dependent execution path, `GitHubPushTriggerConsumer`, and `GitHubCommitOrchestrator` must be deleted in their entirety. No provider-type gate or feature flag preserves the old path.

FR-WR3: Each provider's `execute()` method must run the full delivery loop inside the sandbox: clone → implement → QA (with self-healing) → commit → push → open PR. The NestJS backend must not orchestrate any of these steps externally.

FR-WR4: `ClaudeCodeProvider` must inject the `dsf-execution` SKILL.md into the sandbox execution. The SKILL.md file must be bundled in the `dsf-agents` container image and version-controlled. The sandbox command must pass `REPO_URL`, `FEATURE_BRANCH`, `TASK_DESCRIPTION`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, and `QA_MAX_RETRIES` as environment variables.

FR-WR5: Codex, Kimi, and Gemini providers must inject the equivalent delivery workflow as a structured system prompt within `execute()`. The prompt must specify the same milestone sequence and progress marker format as the SKILL.md.

FR-WR6: The sandbox agent must retry QA on failure up to `QA_MAX_RETRIES` times (default 3). Each retry must read the QA error output, reason about root cause, edit the relevant file(s), and re-run the QA check. Dumb retries without file edits do not satisfy this requirement.

FR-WR7: The sandbox command must emit newline-delimited JSON progress markers to stdout at a minimum of 5 milestones per execution (10%, 20%, 40–75%, 80%, 90%, 95%, 100%). `ClaudeCodeProvider` must parse each stdout line; on `type: "progress"`, call `ExecutionTrackerService.emitProgress(executionId, pct, msg)`.

FR-WR8: Raw sandbox stdout and stderr must stream to the frontend in real time via `ExecutionGateway.emitLog()` (existing behavior in `SandboxService` — must be preserved).

FR-WR9: When QA fails after all retries, the provider must: push the branch to GitHub, record `qaStatus: 'failed'` in the result, and return without opening a PR. The execution state must be set to `QA_FAILED`. The ClickUp ticket must be moved to the configured `qa_failure_status`.

FR-WR10: `POST /api/v1/executions/:id/resolve-qa-failure` must accept `{ action: 'open_pr' | 'cancel' }`. `open_pr`: create PR on the pushed branch with `qa-failed` label, move ClickUp ticket to `code_review_status`, mark execution `COMPLETED`. `cancel`: move ClickUp ticket to `manual_review_status`, mark execution `FAILED`, leave branch in place.

FR-WR11: `qa_failure_status` and `manual_review_status` must be configurable per project via the existing project settings model. Status names must be runtime-discovered via `PMStatusService` — no hardcoded ClickUp status name strings.

FR-WR12: The `SandboxService` redaction pattern must cover `CODEX_API_KEY`, `KIMI_API_KEY`, and `GEMINI_API_KEY` in addition to the existing sensitive key patterns. Raw key values must never appear in logs or Sentry captures.

FR-WR13: The sandbox command must emit a `{"type":"result",...}` JSON line as the last stdout line. `ClaudeCodeProvider` must parse this to populate `prUrl`, `commitSha`, `branchName`, `qaStatus`, and `qaRetryCount` in the returned `IAIExecutionResult`.

FR-WR14: When the sandbox container terminates without emitting a final result line, the execution must: (1) mark the execution state as `FAILED` with the error reason recorded; (2) emit the error reason to the real-time UI so the execution card displays "Failed — agent did not complete. Reason: [error message]"; (3) post a ClickUp comment: "Execution failed — no code was pushed. Reason: [error message]"; (4) revert the ClickUp ticket to its pre-trigger status. No branch cleanup is required.

### NonFunctional Requirements

NFR-WR1: The `drop_workspace_tables` migration must be applied only after confirming zero rows in `Workspace` and `WorkspaceArchive`. The migration must fail fast (not silently) if rows exist.

NFR-WR2: The full agentic workflow — including all self-healing retries — must complete within the TTL configured via `OPENSANDBOX_SANDBOX_TIMEOUT_S`. No additional timeout layer is introduced; the existing sandbox TTL enforcement is the sole timeout boundary. If TTL is exceeded, FR-WR14 crash handling applies.

NFR-WR3: Existing `SandboxService` semaphore-based concurrency limit (`OPENSANDBOX_MAX_CONCURRENT`) applies unchanged to agentic executions. No separate limit for self-healing retries.

NFR-WR4: `ClaudeCodeProvider` stdout parsing must be resilient to non-JSON lines. Only lines that successfully parse as `{ type: "progress" | "result" }` are acted on. Parse errors on individual lines must be logged at debug level and skipped — never crash the execution.

NFR-WR5: No raw provider API key value may appear in any log output, Sentry event, or debug trace — including `CODEX_API_KEY`, `KIMI_API_KEY`, and `GEMINI_API_KEY`. Verification: a log scan after a test execution must return zero matches for any key value string.

NFR-WR6: The `dsf-execution` SKILL.md must undergo mandatory security review before any container image tag is promoted to production. The review must verify: no unauthorized network calls, no exfiltration paths, explicit prohibition on committing `.env` files or secrets.

NFR-WR7: CI must enforce zero remaining `workspace_path` references post-migration. A grep check or TypeScript build failure on removed Prisma fields serves as the enforcement mechanism.

NFR-WR8: Existing REST API endpoints must not change in any way that would break current consumers. The new `resolve-qa-failure` endpoint is additive and does not constitute a breaking change.

### Additional Requirements

**From Architecture (conventions that must be respected):**

- API versioning: URI-based, prefix `/api/v1/*` — new `resolve-qa-failure` endpoint must use `@Controller('executions')` with no hardcoded `api/v1` prefix; versioning applied by NestJS global config
- NestJS module structure: new functionality must use DI with properly scoped modules; no service instances created outside the DI container
- Prisma: schema changes must be applied via named migrations (e.g., `drop_workspace_tables`); no raw SQL bypassing Prisma
- SandboxService existing patterns: `OPENSANDBOX_MAX_CONCURRENT` semaphore, TTL enforcement, and existing log-redaction pattern must not be disrupted
- Socket.IO via `ExecutionGateway`: real-time log streaming already implemented; must be preserved as-is (FR-WR8)
- `IAIExecutionResult` interface: must be extended (not replaced) with the new fields (`prUrl`, `commitSha`, `branchName`, `qaStatus`, `qaRetryCount`) to maintain backward compatibility
- Container image (`dsf-agents`): `dsf-execution` SKILL.md must be treated as a versioned artifact, reviewed before promotion (NFR-WR6)
- `ExecutionPhase` enum: new value `QA_FAILED` added; existing values unchanged

**From PRD scope constraints:**

- Frontend PM resolution modal is **out of scope** — only the backend endpoint contract is in scope
- Configurable max retry limit in DB is **post-MVP** — default 3 hardcoded
- All 4 providers (Claude Code, Codex, Kimi, Gemini) must reach parity in this epic

### FR Coverage Map

| FR      | Epic | Description                                                                                                     |
| ------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| FR-WR1  | WR-1 | Drop `Workspace` + `WorkspaceArchive` schema + all `workspace_path` refs                                        |
| FR-WR2  | WR-1 | Delete legacy DooD pipeline: QaOrchestratorService ws-path, GitHubPushTriggerConsumer, GitHubCommitOrchestrator |
| FR-WR3  | WR-2 | All providers run full agentic loop: clone→implement→QA self-heal→commit→push→PR                                |
| FR-WR4  | WR-2 | ClaudeCodeProvider injects dsf-execution SKILL.md, passes required env vars                                     |
| FR-WR5  | WR-2 | Codex, Kimi, Gemini inject equivalent workflow as structured system prompt                                      |
| FR-WR6  | WR-2 | Self-healing QA retry loop (read errors → reason → fix → retry, max 3)                                          |
| FR-WR7  | WR-3 | Structured JSON progress markers at 5+ milestones → emitProgress()                                              |
| FR-WR8  | WR-3 | Live log streaming via ExecutionGateway.emitLog() (preserve existing)                                           |
| FR-WR9  | WR-4 | Hard QA failure: push branch, QA_FAILED state, ClickUp notification                                             |
| FR-WR10 | WR-4 | POST /resolve-qa-failure endpoint: open_pr or cancel actions                                                    |
| FR-WR11 | WR-4 | Per-project qa_failure_status + manual_review_status config fields                                              |
| FR-WR12 | WR-2 | API key redaction extended to CODEX_API_KEY, KIMI_API_KEY, GEMINI_API_KEY                                       |
| FR-WR13 | WR-2 | Final type:result JSON line parsed → populates IAIExecutionResult fields                                        |
| FR-WR14 | WR-3 | Crash handling: FAILED state + UI error + ClickUp comment + revert ticket status                                |

## Epic List

### Epic WR-1: Dead Code Elimination & Schema Cleanup

Developers and PMs can trust the system is no longer silently broken — the `Workspace` table, its archive, and the entire DooD pipeline are gone. All executions that start will flow through the sandbox path with no dead-code traps.
**FRs covered:** FR-WR1, FR-WR2
**NFRs addressed:** NFR-WR1, NFR-WR7, NFR-WR8

### Epic WR-2: Agentic Provider Execution Engine

All 4 providers (Claude Code, Codex, Kimi, Gemini) can run the complete delivery workflow autonomously: clone the repository, implement the changes, self-heal QA failures, commit, push, and open a PR — all without the NestJS backend orchestrating individual steps.
**FRs covered:** FR-WR3, FR-WR4, FR-WR5, FR-WR6, FR-WR12, FR-WR13
**NFRs addressed:** NFR-WR2, NFR-WR3, NFR-WR4, NFR-WR5, NFR-WR6

### Epic WR-3: Live Execution Visibility & Crash Resilience

PMs watching the DSF dashboard see a live progress bar advancing through named milestones, raw agent output in their log feed, and — if the sandbox crashes unexpectedly — an immediate, specific failure message with no ambiguous "stuck at 10%" silent freeze.
**FRs covered:** FR-WR7, FR-WR8, FR-WR14
**NFRs addressed:** NFR-WR2 (TTL as sole timeout boundary, crash handling)

### Epic WR-4: Hard QA Failure Handling & PM Resolution

When an agent exhausts all QA retries, PMs are immediately notified with context (branch URL, failing test details), and can choose: open a PR with a `qa-failed` label for manual review, or cancel and hand the branch to a developer. No execution is ever abandoned silently.
**FRs covered:** FR-WR9, FR-WR10, FR-WR11
**NFRs addressed:** NFR-WR8

---

## Epic WR-1: Dead Code Elimination & Schema Cleanup

Developers and PMs can trust the system is no longer silently broken — the `Workspace` table, its archive, and the entire DooD pipeline are gone. All executions that start will flow through the sandbox path with no dead-code traps.

### Story WR-1.1: Drop Workspace Schema & Eliminate All References

As a **platform engineer**,
I want the `Workspace`, `WorkspaceArchive`, and `WorkspaceStatus` Prisma models removed and all `workspace_path` references eliminated from every service,
So that the codebase no longer contains dead schema that causes silent pipeline failures and TypeScript errors post-migration.

**Acceptance Criteria:**

**Given** the current Prisma schema contains `model Workspace`, `model WorkspaceArchive`, and `enum WorkspaceStatus`
**When** the migration `drop_workspace_tables` is created and applied
**Then** both tables are dropped from the database and the models are removed from `prisma/schema.prisma`
**And** `npx prisma generate` produces no references to `Workspace`, `WorkspaceArchive`, or `WorkspaceStatus` in the generated client

**Given** the migration is run against a database that has zero rows in `Workspace` and `WorkspaceArchive`
**When** the migration executes
**Then** it completes successfully and both tables are absent from the live schema

**Given** the migration is run against a database that has one or more rows in either `Workspace` or `WorkspaceArchive`
**When** the migration attempts to execute
**Then** it fails fast with a descriptive error and does NOT drop any tables (NFR-WR1 — data safety gate)

**Given** the Prisma models have been removed
**When** `pnpm build` (TypeScript compilation) runs across the entire codebase
**Then** zero compilation errors exist related to `Workspace`, `WorkspaceArchive`, `WorkspaceStatus`, or `workspace_path`
**And** a `grep -r "workspace_path" src/` scan returns zero matches (NFR-WR7)

**Given** the zero-reference enforcement is needed in CI
**When** a developer introduces a new `workspace_path` reference in any source file
**Then** the TypeScript build or a CI grep check fails, preventing the regression from merging

### Story WR-1.2: Delete Legacy DooD Pipeline Components

As a **platform engineer**,
I want `QaOrchestratorService`'s workspace-dependent execution path, `GitHubPushTriggerConsumer`, and `GitHubCommitOrchestrator` deleted in their entirety,
So that no legacy DooD code path remains that could produce silent failures or require maintenance.

**Acceptance Criteria:**

**Given** `QaOrchestratorService` currently contains a workspace-dependent execution branch
**When** the workspace-dependent path is deleted
**Then** no workspace-conditional logic (`if workspace`, `findUnique('workspace')`, `workspace_path` checks) remains anywhere in `QaOrchestratorService`
**And** `QaOrchestratorService` compiles cleanly with zero references to `Workspace` models or `workspace_path`

**Given** `GitHubPushTriggerConsumer` exists as a RabbitMQ consumer
**When** it is deleted
**Then** the consumer class file is removed, its module registration is removed, and no imports of it remain anywhere in the codebase
**And** the RabbitMQ queue it consumed from no longer has a registered handler

**Given** `GitHubCommitOrchestrator` exists as a service
**When** it is deleted
**Then** the orchestrator class file is removed, its NestJS module provider registration is removed, and no imports of it remain
**And** no provider in the system attempts to call methods on `GitHubCommitOrchestrator`

**Given** all three components have been deleted
**When** `pnpm build` runs
**Then** zero TypeScript errors exist and the application starts successfully
**And** a `grep -r "GitHubPushTriggerConsumer\|GitHubCommitOrchestrator" src/` scan returns zero matches

**Given** any existing `/api/v1/executions/*` endpoints existed before this story
**When** these deletions are applied
**Then** those REST API endpoints remain unchanged and return the same responses as before (NFR-WR8 — no breaking changes)

---

## Epic WR-2: Agentic Provider Execution Engine

All 4 providers (Claude Code, Codex, Kimi, Gemini) can run the complete delivery workflow autonomously: clone the repository, implement the changes, self-heal QA failures, commit, push, and open a PR — all without the NestJS backend orchestrating individual steps.

### Story WR-2.1: Establish Shared Provider Contract & Execution State

As a **platform engineer**,
I want the `IAIExecutionResult` interface extended with sandbox-result fields and `QA_FAILED` added to `ExecutionPhase`,
So that all sandbox providers share a single typed contract and the new execution state is available before any provider code is written.

**Acceptance Criteria:**

**Given** the current `IAIExecutionResult` interface exists
**When** it is updated
**Then** it includes the following new fields alongside all existing fields (no existing fields removed or renamed — NFR-WR8):

- `prUrl?: string`
- `commitSha?: string`
- `branchName?: string`
- `qaStatus: 'passed' | 'self_healed' | 'failed' | 'skipped'`
- `qaRetryCount: number`

**Given** the `ExecutionPhase` enum exists with its current values
**When** `QA_FAILED = 'QA_FAILED'` is added
**Then** all existing enum values remain present and unchanged
**And** `pnpm build` compiles with zero errors

**Given** the updated interface is in place
**When** any existing provider (that does not yet implement the new fields) returns a result
**Then** TypeScript does not error — new fields are optional or have safe defaults (`qaStatus: 'skipped'`, `qaRetryCount: 0`) for non-sandbox providers

### Story WR-2.2: Author & Bundle the `dsf-execution` Agent Skill

As a **platform engineer**,
I want the `dsf-execution` SKILL.md file authored with the complete agentic delivery workflow and bundled in the `dsf-agents` container image,
So that `ClaudeCodeProvider` can inject it natively and Claude executes the full workflow without additional runtime instructions.

**Acceptance Criteria:**

**Given** a `dsf-execution` SKILL.md needs to be created
**When** it is authored
**Then** it specifies the full delivery workflow in this exact sequence:

1. Clone repository at `$REPO_URL` to branch `$FEATURE_BRANCH`
2. Implement changes per `$TASK_DESCRIPTION`
3. Run QA (lint + tests); on failure: read errors → reason about root cause → fix → retry (max `$QA_MAX_RETRIES`, default 3)
4. Commit with AI-generated descriptive message
5. Push `$FEATURE_BRANCH` to origin using `$GITHUB_TOKEN`
6. Open PR via `gh pr create`
7. Emit structured JSON progress markers to stdout at each milestone
8. Emit final `{"type":"result",...}` JSON line as the last stdout output

**Given** the SKILL.md is authored
**When** a mandatory security review is performed (NFR-WR6)
**Then** the review confirms: no unauthorized network calls outside required hosts, no exfiltration paths, explicit instruction to never commit `.env` files, secrets, or credentials
**And** the review sign-off is recorded before any image tag is promoted to production

**Given** the SKILL.md passes security review
**When** the `dsf-agents` container image is built
**Then** the SKILL.md is present at `~/.claude/skills/dsf-execution/SKILL.md` inside the container
**And** the source file is version-controlled in the repository (e.g., `docker/skills/dsf-execution/SKILL.md`)

**Given** the required env vars are documented
**When** a developer reviews the SKILL.md
**Then** the following env vars are clearly documented as required: `REPO_URL`, `FEATURE_BRANCH`, `TASK_DESCRIPTION`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `QA_MAX_RETRIES`

### Story WR-2.3: Implement ClaudeCodeProvider Full Agentic Workflow

As a **platform engineer**,
I want `ClaudeCodeProvider.execute()` to run the complete agentic delivery loop via the `dsf-execution` SKILL.md and parse the structured stdout output,
So that a Claude Code sandbox execution produces a real PR on GitHub with no backend pipeline orchestration.

**Acceptance Criteria:**

**Given** `ClaudeCodeProvider.execute()` is called for a ticket
**When** it launches the sandbox
**Then** it passes these env vars to the sandbox command: `REPO_URL`, `FEATURE_BRANCH`, `TASK_DESCRIPTION`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `QA_MAX_RETRIES=3` (FR-WR4)
**And** the sandbox uses the `dsf-execution` SKILL.md at `~/.claude/skills/dsf-execution/SKILL.md`

**Given** the sandbox is running and emitting stdout
**When** each line of stdout is received
**Then** if the line parses as valid JSON with `"type":"progress"`, `ExecutionTrackerService.emitProgress(executionId, pct, msg)` is called
**And** if the line does NOT parse as valid JSON, it is logged at debug level and silently skipped — the execution never crashes (NFR-WR4)
**And** raw stdout continues streaming concurrently via `ExecutionGateway.emitLog()` regardless (FR-WR8 preservation)

**Given** the sandbox completes successfully
**When** the final `{"type":"result",...}` JSON line is parsed
**Then** `prUrl`, `commitSha`, `branchName`, `qaStatus`, and `qaRetryCount` are extracted and populated into the returned `IAIExecutionResult` (FR-WR13)
**And** `success: true` is returned

**Given** the agent encounters QA failures during execution
**When** retries occur (up to `QA_MAX_RETRIES`)
**Then** each retry emits a progress marker (e.g., `{"type":"progress","pct":82,"msg":"QA failed — retrying (1/3)"}`)
**And** the final `qaStatus` reflects `'self_healed'` if retries ultimately succeeded or `'failed'` if all retries were exhausted (FR-WR6)

**Given** the existing `SandboxService` semaphore (`OPENSANDBOX_MAX_CONCURRENT`) is in place
**When** `ClaudeCodeProvider.execute()` runs
**Then** it operates within the existing concurrency limits — no new semaphore or limit is introduced (NFR-WR3)

### Story WR-2.4: Implement Codex, Kimi & Gemini Full Agentic Workflow

As a **platform engineer**,
I want Codex, Kimi, and Gemini providers to inject the full delivery workflow as a structured system prompt and parse the same structured stdout output as `ClaudeCodeProvider`,
So that all 4 providers reach execution parity and any provider can complete the full clone→implement→QA→commit→push→PR lifecycle.

**Acceptance Criteria:**

**Given** each of Codex, Kimi, and Gemini has an `execute()` method
**When** it is updated
**Then** the system prompt injected into the sandbox specifies the same 8-step workflow sequence defined in the `dsf-execution` SKILL.md (FR-WR5):

1. Clone → 2. Implement → 3. QA self-heal loop (max `QA_MAX_RETRIES`) → 4. Commit → 5. Push → 6. Open PR → 7. Emit progress markers → 8. Emit final result line

**Given** each provider is running in the sandbox and emitting stdout
**When** stdout lines are received
**Then** progress marker parsing (`type:"progress"`) and result line parsing (`type:"result"`) behave identically to `ClaudeCodeProvider` — same `emitProgress()` calls, same resilience to non-JSON lines (NFR-WR4)

**Given** each provider completes successfully
**When** the final result line is parsed
**Then** `prUrl`, `commitSha`, `branchName`, `qaStatus`, and `qaRetryCount` are populated in `IAIExecutionResult` — identical to the Claude Code contract (FR-WR13)

**Given** an end-to-end smoke test is run for each provider
**When** the smoke test triggers a real ticket against a test repository
**Then** each of the 4 providers produces a real PR on GitHub, with branch name and commit SHA recorded in the execution record
**And** the provider health check endpoint returns `healthy` for all 4 providers

### Story WR-2.5: Extend API Key Redaction to All Provider Keys

As a **security-conscious platform engineer**,
I want `SandboxService`'s log redaction pattern extended to cover `CODEX_API_KEY`, `KIMI_API_KEY`, and `GEMINI_API_KEY`,
So that no raw API key values for any provider can ever appear in logs, Sentry captures, or debug traces.

**Acceptance Criteria:**

**Given** `SandboxService` already redacts some sensitive env vars
**When** the redaction pattern is updated
**Then** `CODEX_API_KEY`, `KIMI_API_KEY`, and `GEMINI_API_KEY` are added to the set of redacted keys alongside existing patterns (FR-WR12)

**Given** a test execution is run with all 4 provider keys set to known test values
**When** the resulting logs (stdout, application log, Sentry test event) are scanned for those key values
**Then** zero matches are found for any raw key value string (NFR-WR5)

**Given** the redaction covers logs at all severity levels
**When** a debug-level log trace is captured
**Then** the raw key value does not appear even in debug-level output

---

## Epic WR-3: Live Execution Visibility & Crash Resilience

PMs watching the DSF dashboard see a live progress bar advancing through named milestones, raw agent output in their log feed, and — if the sandbox crashes unexpectedly — an immediate, specific failure message with no ambiguous "stuck at 10%" silent freeze.

### Story WR-3.1: Wire All Execution Milestones to Progress Bar

As a **PM watching an execution**,
I want the progress bar to advance through at least 7 named milestones as the agent works (clone → implement → QA → push → PR → done),
So that I can see the execution is alive and know exactly which phase the agent is in at any moment.

**Acceptance Criteria:**

**Given** a sandbox execution is underway
**When** the agent emits progress markers to stdout
**Then** `ExecutionTrackerService.emitProgress(executionId, pct, msg)` is called for each of the following milestones, advancing the frontend bar:

- 10% — "Budget check passed"
- 20% — "Cloning repository"
- 40% — "Implementing changes"
- 75% — "Implementation complete"
- 80% — "Running QA"
- 90% — "Pushing to GitHub"
- 95% — "Opening PR"
- 100% — "Done"

**Given** a self-healing QA retry occurs
**When** the agent emits `{"type":"progress","pct":82,"msg":"QA failed — retrying (N/3)"}`
**Then** `emitProgress()` is called with the retry message, showing the PM the agent is self-healing rather than stalled

**Given** at least 5 milestones must be emitted per execution (FR-WR7)
**When** a full happy-path execution completes
**Then** a minimum of 7 distinct `emitProgress()` calls are recorded (10%, 20%, 40%, 75%, 80%, 90%–95%, 100%)

**Given** raw agent stdout is streaming concurrently
**When** progress markers and human-readable lines are interleaved in stdout
**Then** both are handled simultaneously — progress markers route to `emitProgress()`, all raw lines route to `ExecutionGateway.emitLog()` — neither blocks the other (NFR-WR4 resilience)

### Story WR-3.2: Implement Crash Detection & Full Failure Cascade

As a **PM watching an execution**,
I want the system to detect when the sandbox container terminates without completing (crash, timeout, rate-limit, unreachable repo) and immediately surface a specific failure reason,
So that I see "Failed — agent did not complete. Reason: [specific message]" instead of the execution freezing indefinitely at whatever progress it last reached.

**Acceptance Criteria:**

**Given** a sandbox container exits without emitting a final `{"type":"result",...}` line
**When** the crash is detected (container exit, TTL exceeded via `OPENSANDBOX_SANDBOX_TIMEOUT_S`, or unrecovered error)
**Then** the execution state is set to `FAILED` with the specific error reason recorded in the database (FR-WR14)

**Given** the execution has been marked `FAILED`
**When** the failure is detected
**Then** a real-time UI event is emitted via `ExecutionGateway` so the execution card displays: "Failed — agent did not complete. Reason: [error message]" (FR-WR14)

**Given** the execution has been marked `FAILED`
**When** the failure cascade completes
**Then** a ClickUp comment is posted on the ticket: "Execution failed — no code was pushed. Reason: [error message]" (FR-WR14)
**And** the ClickUp ticket is reverted to its pre-trigger status

**Given** the sandbox timed out via the existing `OPENSANDBOX_SANDBOX_TIMEOUT_S` TTL
**When** the timeout fires
**Then** the crash handling path above is triggered — the existing TTL is the sole timeout boundary; no additional timeout layer is added (NFR-WR2)

**Given** the sandbox crashed mid-implementation with no code pushed
**When** the failure cascade completes
**Then** no branch cleanup is attempted — if no push occurred, no branch exists and no cleanup action is taken (FR-WR14)

**Given** the failure reason captured from the crash
**When** it is a known error type (ANTHROPIC_API_KEY rate limit, repository URL unreachable, container OOM)
**Then** the specific error type is included in the ClickUp comment and UI display, not a generic "unknown error"

---

## Epic WR-4: Hard QA Failure Handling & PM Resolution

When an agent exhausts all QA retries, PMs are immediately notified with context (branch URL, failing test details), and can choose: open a PR with a `qa-failed` label for manual review, or cancel and hand the branch to a developer. No execution is ever abandoned silently.

### Story WR-4.1: Implement Hard QA Failure Provider Behaviour & State Transition

As a **PM watching an execution**,
I want the system to recognise when all QA retries are exhausted, push the code branch to GitHub anyway, set the execution to `QA_FAILED`, and move the ClickUp ticket to the configured QA failure status,
So that the code is preserved on a branch and I'm notified immediately rather than having the execution silently fail with nothing pushed.

**Acceptance Criteria:**

**Given** the sandbox agent has exhausted all `QA_MAX_RETRIES` attempts without passing QA
**When** the provider receives `qaStatus: 'failed'` in the result line
**Then** the provider pushes the branch to GitHub (if not already pushed) before returning
**And** it returns the result with `success: false`, `qaStatus: 'failed'`, and `branchName` populated (FR-WR9)
**And** it does NOT open a PR at this stage

**Given** the provider returns with `qaStatus: 'failed'`
**When** the execution service processes the result
**Then** the execution state is set to `QA_FAILED`
**And** `prUrl` remains null/undefined in the execution record

**Given** the execution is in `QA_FAILED` state
**When** the state transition is applied
**Then** the ClickUp ticket is moved to the project's configured `qa_failure_status` via `PMStatusService` runtime discovery (FR-WR9)
**And** if `qa_failure_status` is not configured for the project, a warning is logged and a ClickUp comment is posted noting the configuration gap — no exception is thrown

**Given** a PM is watching the execution card in the DSF dashboard
**When** the execution reaches `QA_FAILED`
**Then** a real-time UI event is emitted via `ExecutionGateway` displaying the QA failure state with the branch URL and last QA error output

### Story WR-4.2: Add Per-Project QA Failure & Manual Review Status Configuration

As a **platform engineer configuring a project**,
I want `qa_failure_status` and `manual_review_status` to be configurable per project in the project settings model,
So that ClickUp status transitions for QA failures can be customised per project without hardcoding status name strings anywhere in the backend.

**Acceptance Criteria:**

**Given** the existing project settings model
**When** it is updated
**Then** two new optional string fields are added: `qa_failure_status` and `manual_review_status` (FR-WR11)
**And** the schema migration is applied with no data loss to existing project records

**Given** a project has `qa_failure_status` set to a value (e.g., "QA Failed")
**When** `PMStatusService` resolves the ClickUp status
**Then** it uses runtime discovery to look up the ClickUp status ID — no hardcoded ClickUp status name strings anywhere in the resolution code (FR-WR11)

**Given** a project has `manual_review_status` set to a value (e.g., "Needs Manual Review")
**When** a PM selects the `cancel` action via the resolve-qa-failure endpoint
**Then** `PMStatusService` resolves and applies that status using the same runtime-discovery mechanism

**Given** a project does NOT have `qa_failure_status` configured
**When** a hard QA failure occurs
**Then** the system logs a warning and leaves the ClickUp ticket at its current status without throwing an unhandled exception

### Story WR-4.3: Implement the PM Resolution Endpoint

As a **PM who sees a QA-failed execution**,
I want to call `POST /api/v1/executions/:id/resolve-qa-failure` with either `open_pr` or `cancel`,
So that I can decide in one API call whether to open the PR for manual review or cancel and hand the branch to a developer — without any manual GitHub or ClickUp intervention.

**Acceptance Criteria:**

**Given** an execution in `QA_FAILED` state with a pushed branch
**When** `POST /api/v1/executions/:id/resolve-qa-failure` is called with `{ "action": "open_pr" }`
**Then** a PR is created on the already-pushed branch with a `qa-failed` label attached (FR-WR10)
**And** the ClickUp ticket is moved to the project's `code_review_status` via `PMStatusService` runtime discovery
**And** the execution state is set to `COMPLETED` and `prUrl` is populated in the execution record

**Given** an execution in `QA_FAILED` state with a pushed branch
**When** the endpoint is called with `{ "action": "cancel" }`
**Then** no PR is created — the branch is left as-is on GitHub (FR-WR10)
**And** the ClickUp ticket is moved to the project's `manual_review_status` via `PMStatusService`
**And** the execution state is set to `FAILED`

**Given** the endpoint is called with an execution ID that does not exist
**When** the request is processed
**Then** a `404 Not Found` response is returned

**Given** the endpoint is called on an execution that exists but is NOT in `QA_FAILED` state
**When** the request is processed
**Then** a `409 Conflict` response is returned indicating the execution is not in the expected state

**Given** the endpoint is called with an `action` value other than `open_pr` or `cancel`
**When** the request is processed
**Then** a `422 Unprocessable Entity` response is returned

**Given** the endpoint follows the project's API versioning convention
**When** the controller is implemented
**Then** it uses `@Controller('executions')` with no hardcoded `api/v1` prefix — global NestJS versioning config applies it automatically (architecture convention, NFR-WR8)

**Given** existing `/api/v1/executions/*` endpoints exist
**When** this new endpoint is added
**Then** all existing endpoints remain unchanged in signature, response shape, and status codes — this endpoint is purely additive (NFR-WR8)
