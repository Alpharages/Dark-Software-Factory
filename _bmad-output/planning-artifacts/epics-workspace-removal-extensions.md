---
stepsCompleted:
  [
    'step-01-validate-prerequisites',
    'step-02-design-epics',
    'step-03-create-stories',
    'step-04-final-validation',
  ]
status: approved
inputDocuments:
  - _bmad-output/planning-artifacts/prd-workspace-removal.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
  - _bmad-output/planning-artifacts/epics-workspace-removal.md
---

# Dark Software Factory - Epic Breakdown (Workspace Removal — Extensions)

## Overview

This document provides the epic and story breakdown for the three post-MVP items that were explicitly Out of Scope in the Workspace Removal PRD. These items extend the WR initiative with configurable retry limits, per-step QA visibility, and the PM resolution modal that completes the hard QA failure flow in the frontend.

**Parent PRD:** `prd-workspace-removal.md`
**Predecessor epics:** WR-1 through WR-4 (all complete)

---

## Requirements Inventory

### Functional Requirements

FR-EXT1: The `Project` model must have a configurable `qaMaxRetries` field (Int, default 3) that overrides the per-provider hardcoded literal `'3'` for all sandbox providers.

FR-EXT2: All 4 providers (ClaudeCodeProvider, CodexProvider, KimiProvider, GeminiProvider) must read `qaMaxRetries` from the project record at execution time and inject it as `QA_MAX_RETRIES` into the sandbox environment, replacing the current hardcoded literal in each provider file.

FR-EXT3: `qaMaxRetries` must be exposed via the existing project settings API (GET and PATCH) so PMs and platform engineers can configure it per project without a code deploy.

FR-EXT4: `IAIExecutionResult` must be extended with a `qaAttempts` array that captures per-attempt QA data: attempt number, lint passed/failed, lint error details, tests passed/failed, test result details, and attempt duration in milliseconds.

FR-EXT5: The `dsf-execution` SKILL.md and the equivalent structured system prompts for Codex, Kimi, and Gemini must emit per-attempt JSON markers to stdout at the start and end of each QA attempt (both on failure and on final pass), in addition to existing progress markers.

FR-EXT6: All 4 provider `execute()` methods must parse per-attempt QA markers from stdout and populate `qaAttempts` in the returned `IAIExecutionResult`.

FR-EXT7: Per-attempt QA history must be persisted in the database. A new `qa_attempts Json?` field on the `Execution` model must store the full attempt array for each execution (no separate table required — JSON column is sufficient).

FR-EXT8: The execution detail API response must include `qaAttempts` data so the frontend can render the per-attempt breakdown panel.

FR-EXT9: The `dsf-dashboard` frontend must detect when an execution transitions to `QA_FAILED` state via the existing WebSocket connection and surface an action prompt to the PM without requiring a page refresh.

FR-EXT10: When `QA_FAILED` is detected, the frontend must display a PM Resolution Modal containing: the pushed branch name with a clickable GitHub URL, the last QA error output (lint errors or test failures), and two action buttons — "Open PR Anyway" and "Cancel".

FR-EXT11: On "Open PR Anyway", the frontend must call `POST /api/v1/executions/:id/resolve-qa-failure` with `{ "action": "open_pr" }` and display the resulting PR URL and PR number to the PM on success.

FR-EXT12: On "Cancel", the frontend must call the endpoint with `{ "action": "cancel" }` and display a confirmation message: "Execution cancelled — ticket moved to manual review. Branch [name] is available for a developer to continue."

FR-EXT13: The PM Resolution Modal must handle the 3 documented error states with user-facing messages:

- 404 → "Execution not found."
- 409 → "This execution is no longer in QA Failed state — it may have already been resolved."
- 422 → "Invalid action. Please refresh and try again."

FR-EXT14: The execution detail view in `dsf-dashboard` must include a QA Results Panel showing the per-attempt breakdown: attempt number, lint status with error count, test status with pass/fail count, duration, and a "Self-healed" / "Failed" / "Passed" badge on each attempt.

### NonFunctional Requirements

NFR-EXT1: The `qaMaxRetries` field must be validated with a minimum of 1 and maximum of 10 at the API layer (class-validator). Values outside this range must return a 422 response.

NFR-EXT2: Adding `qaMaxRetries` to the `Project` model must not break existing project records — a default of 3 must be applied automatically to all pre-existing rows via migration with no data loss.

NFR-EXT3: Per-attempt QA data stored in the `qa_attempts` JSON column is bounded by `qaMaxRetries` (max 10 attempts × fixed data shape) — no unbounded growth risk.

NFR-EXT4: The PM Resolution Modal must be focus-trapped while open, dismissible via Escape key (unless an action is in progress), and all buttons must have explicit ARIA labels (per UX spec accessibility requirements).

NFR-EXT5: The QA Results Panel must use `aria-live="polite"` for real-time attempt updates during an active execution (consistent with the UX spec's progress bar ARIA pattern).

NFR-EXT6: stdout parsing for per-attempt QA markers must follow the same resilience rules as NFR-WR4 — non-JSON lines and unknown marker types are silently skipped at debug level; parsing errors never crash the execution.

NFR-EXT7: `qaMaxRetries` changes take effect on the next execution only — in-flight executions are not interrupted.

NFR-EXT8: No existing project settings API fields, response shapes, or status codes may change — new fields are additive only (consistent with NFR-WR8).

### Additional Requirements

**From Architecture (conventions applicable to these extensions):**

- API versioning: URI-based `/api/v1/*` — all new/modified endpoints use `@Controller('projects')` or `@Controller('executions')` with global versioning config, no hardcoded prefix
- Prisma: schema additions must be applied via named migrations (e.g., `add_qa_max_retries_to_project`, `add_qa_attempts_to_execution`)
- NestJS DI: new service logic must be properly injected via module providers; no service instances created outside the DI container
- `IAIExecutionResult` interface: must be extended (not replaced) — existing fields `prUrl`, `commitSha`, `branchName`, `qaStatus`, `qaRetryCount` remain unchanged
- class-validator + class-transformer: all new DTO fields use decorators for validation

### UX Design Requirements

UX-DR1: PM Resolution Modal must follow the UX spec's Modal Dialog pattern — critical decision only, click-outside dismissible (unless action in progress), focus trap enabled, Escape key closes.

UX-DR2: Modal must use the Traffic Light color system from UX spec — `qa-failed` state indicator in red, branch URL in blue (link), action buttons using the existing `premium-card` / destructive button variants.

UX-DR3: QA Results Panel must follow the UX spec's AI Execution Progress Tracker component pattern — multi-state display with color coding: attempt failure in red (striped), self-healed pass in green, final pass in green solid.

UX-DR4: The "Open PR Anyway" and "Cancel" buttons must have a minimum touch target of 44px height (UX spec mobile requirement) and a confirmation step for "Open PR Anyway" to prevent accidental submissions.

UX-DR5: Toast notifications must be used for non-blocking confirmations after modal actions complete (e.g., "PR #123 opened successfully" at bottom-right, 5s auto-dismiss — per UX spec Feedback Patterns).

UX-DR6: Per-attempt QA data in the panel must be grouped by attempt number with a clear visual separator, lint errors shown as a count badge, and test results shown as "X passed / Y failed" using status-badge components.

### FR Coverage Map

| FR       | Epic | Description                                                               |
| -------- | ---- | ------------------------------------------------------------------------- |
| FR-EXT1  | WR-5 | `qaMaxRetries` field on `Project` model (Int, default 3)                  |
| FR-EXT2  | WR-5 | All 4 providers read `qaMaxRetries` from project, replace hardcoded `'3'` |
| FR-EXT3  | WR-5 | Exposed via project settings GET/PATCH API                                |
| FR-EXT4  | WR-6 | `IAIExecutionResult` extended with `qaAttempts[]` array                   |
| FR-EXT5  | WR-6 | SKILL.md + all 3 provider prompts emit per-attempt stdout markers         |
| FR-EXT6  | WR-6 | All 4 providers parse per-attempt markers into `qaAttempts`               |
| FR-EXT7  | WR-6 | `qa_attempts Json?` column on `Execution` DB model                        |
| FR-EXT8  | WR-6 | Execution detail API exposes `qaAttempts`                                 |
| FR-EXT9  | FE-1 | WebSocket detects `QA_FAILED` state transition                            |
| FR-EXT10 | FE-1 | Modal shows branch URL, last QA error, two action buttons                 |
| FR-EXT11 | FE-1 | "Open PR Anyway" → calls API → shows PR URL + number                      |
| FR-EXT12 | FE-1 | "Cancel" → calls API → shows confirmation message                         |
| FR-EXT13 | FE-1 | 3 error states (404, 409, 422) handled with user-facing messages          |
| FR-EXT14 | FE-1 | QA Results Panel with per-attempt breakdown                               |

## Epic List

### Epic WR-5: Configurable QA Retry Limit per Project

A platform engineer or PM can configure exactly how many QA retry attempts the agent makes before giving up — per project — instead of being locked to the global default of 3. Projects with simple codebases get faster failure detection; complex projects get more resilience. No code deploy needed to change it.

**FRs covered:** FR-EXT1, FR-EXT2, FR-EXT3
**NFRs addressed:** NFR-EXT1, NFR-EXT2, NFR-EXT7, NFR-EXT8
**Dependencies:** None

### Epic WR-6: Per-Attempt QA History — Backend Capture & Storage

The backend captures and persists a structured per-attempt QA history for every sandbox execution — which lint errors fired, which tests failed, how long each attempt took — and exposes it via the execution detail API. The API now has the data needed for frontend QA panels, audit trails, and debugging why the agent self-healed (or didn't).

**FRs covered:** FR-EXT4, FR-EXT5, FR-EXT6, FR-EXT7, FR-EXT8
**NFRs addressed:** NFR-EXT3, NFR-EXT6
**Dependencies:** None

### Epic FE-1: PM Resolution Modal & QA Results Panel

A PM watching the DSF dashboard can act on a QA-failed execution directly — choose to open the PR for manual review or cancel — and inspect a per-attempt QA breakdown showing exactly what the agent tried, what failed, and where it self-healed. PMs have full agency over QA failures from the dashboard with no manual GitHub/ClickUp work.

**FRs covered:** FR-EXT9, FR-EXT10, FR-EXT11, FR-EXT12, FR-EXT13, FR-EXT14
**NFRs addressed:** NFR-EXT4, NFR-EXT5
**UX-DRs addressed:** UX-DR1, UX-DR2, UX-DR3, UX-DR4, UX-DR5, UX-DR6
**Dependencies:** WR-6 (for QA Results Panel — FR-EXT8); PM Resolution Modal portion (FR-EXT9–13) is independent

---

## Epic WR-5: Configurable QA Retry Limit per Project

A platform engineer or PM can configure exactly how many QA retry attempts the agent makes before giving up — per project — instead of being locked to the global default of 3. Projects with simple codebases get faster failure detection; complex projects get more resilience. No code deploy needed to change it.

### Story WR-5.1: Add qaMaxRetries to Project Schema & Settings API

As a **platform engineer configuring a project**,
I want a `qaMaxRetries` field on the project settings model exposed via the API,
So that each project's QA retry limit can be set independently without touching code.

**Acceptance Criteria:**

**Given** the `Project` Prisma model exists with existing QA status fields
**When** the migration `add_qa_max_retries_to_project` is applied
**Then** a new `qaMaxRetries Int @default(3)` field is added to the `Project` table
**And** all existing project rows receive the default value of 3 with no data loss (NFR-EXT2)

**Given** the project settings GET endpoint is called
**When** the response is returned
**Then** `qaMaxRetries` is included in the response body alongside existing settings fields

**Given** a PATCH request is made to the project settings endpoint with `{ "qaMaxRetries": 5 }`
**When** the request is processed
**Then** the project's `qaMaxRetries` is updated to 5 in the database

**Given** a PATCH request is made with `{ "qaMaxRetries": 0 }`
**When** the request is validated
**Then** a `422 Unprocessable Entity` is returned — minimum value is 1 (NFR-EXT1)

**Given** a PATCH request is made with `{ "qaMaxRetries": 11 }`
**When** the request is validated
**Then** a `422 Unprocessable Entity` is returned — maximum value is 10 (NFR-EXT1)

**Given** existing project settings endpoints exist
**When** this field is added
**Then** all existing fields remain unchanged in shape and response — purely additive (NFR-EXT8)

### Story WR-5.2: Wire All Providers to Per-Project QA Retry Limit

As a **platform engineer**,
I want all 4 sandbox providers to read `qaMaxRetries` from the project record at execution time,
So that the hardcoded `'3'` literals are gone and each project controls its own retry behaviour.

**Acceptance Criteria:**

**Given** `ClaudeCodeProvider.execute()` is called for a project with `qaMaxRetries: 5`
**When** the sandbox is launched
**Then** `QA_MAX_RETRIES=5` is passed as an environment variable to the sandbox container
**And** the hardcoded literal `'3'` no longer exists in `claude-code.provider.ts`

**Given** `CodexProvider`, `KimiProvider`, and `GeminiProvider` each contain a hardcoded `const QA_MAX_RETRIES = '3'`
**When** they are updated
**Then** each reads `qaMaxRetries` from the project record and injects it as `QA_MAX_RETRIES` into the sandbox env — the hardcoded literal is removed from all 3 files

**Given** a project has not had `qaMaxRetries` explicitly set (null in DB)
**When** any provider runs an execution for that project
**Then** the provider falls back to `QA_MAX_RETRIES=3` — the default is applied in code, not assumed from the DB default

**Given** `qaMaxRetries` is changed on a project while an execution is in progress
**When** the change is saved
**Then** the in-flight execution continues with the retry count it was launched with — the change takes effect on the next execution only (NFR-EXT7)

**Given** a `grep -r "QA_MAX_RETRIES.*=.*'3'" src/` scan is run after implementation
**When** the scan completes
**Then** zero matches are found — no hardcoded retry literals remain in any provider file

---

## Epic WR-6: Per-Attempt QA History — Backend Capture & Storage

The backend captures and persists a structured per-attempt QA history for every sandbox execution — which lint errors fired, which tests failed, how long each attempt took — and exposes it via the execution detail API.

### Story WR-6.1: Define QAAttempt Interface & Add qa_attempts DB Column

As a **platform engineer**,
I want a typed `QAAttempt` interface and a `qa_attempts` JSON column on the `Execution` model,
So that the shared data contract and storage layer exist before any provider or API work begins.

**Acceptance Criteria:**

**Given** the `IAIExecutionResult` interface exists in `src/ai-routing/interfaces/ai-provider.interface.ts`
**When** it is updated
**Then** a new `QAAttempt` interface is defined with these fields:

- `attemptNumber: number`
- `lintPassed: boolean`
- `lintErrors?: { count: number; details: unknown[] }`
- `testsPassed: boolean`
- `testResults?: { passed: number; failed: number; details: unknown[] }`
- `durationMs: number`

**And** `IAIExecutionResult` gains `qaAttempts?: QAAttempt[]` as an optional field alongside all existing fields — no existing fields removed or renamed (NFR-EXT8)

**Given** the `Execution` Prisma model exists
**When** the migration `add_qa_attempts_to_execution` is applied
**Then** a new `qa_attempts Json?` nullable column is added to the `Execution` table
**And** all existing execution rows remain unaffected (null for the new column)

**Given** `pnpm build` is run after both changes
**When** TypeScript compilation completes
**Then** zero errors exist — existing providers that do not yet populate `qaAttempts` compile cleanly because the field is optional

### Story WR-6.2: Emit & Parse Per-Attempt QA Markers Across All Providers

As a **platform engineer**,
I want the `dsf-execution` SKILL.md and all 3 provider system prompts to emit per-attempt QA markers to stdout, and all 4 providers to parse them into `qaAttempts`,
So that the per-attempt history is captured at the source for every provider.

**Acceptance Criteria:**

**Given** the `dsf-execution` SKILL.md defines the QA self-healing loop
**When** it is updated
**Then** it emits a `{"type":"qa_attempt",...}` JSON line to stdout at the end of each QA attempt (both on failure and on final pass) with this shape:

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

**Given** Codex, Kimi, and Gemini provider system prompts define the equivalent QA loop
**When** they are updated
**Then** each specifies the same `{"type":"qa_attempt",...}` marker format and requires the agent to emit it at the end of each QA attempt

**Given** `ClaudeCodeProvider` is parsing stdout lines
**When** a line parses as valid JSON with `"type":"qa_attempt"`
**Then** the attempt data is appended to an in-memory `qaAttempts` array for the current execution
**And** the accumulated array is included in `IAIExecutionResult.qaAttempts` when execution completes

**Given** the same stdout parsing logic is applied to Codex, Kimi, and Gemini providers
**When** `qa_attempt` markers are received
**Then** all 3 providers accumulate and return `qaAttempts` identically to `ClaudeCodeProvider`

**Given** a stdout line fails JSON parsing or has `"type"` other than known types
**When** the line is processed
**Then** it is logged at debug level and silently skipped — the execution never crashes and `qaAttempts` is not corrupted (NFR-EXT6)

**Given** `qaMaxRetries` is set to 3 for a project
**When** the agent exhausts all 3 retries
**Then** `qaAttempts` contains exactly 3 entries — bounded by `qaMaxRetries`, never grows unboundedly (NFR-EXT3)

### Story WR-6.3: Persist qaAttempts to DB & Expose via Execution Detail API

As a **platform engineer**,
I want `qaAttempts` persisted to the `Execution` record and included in the execution detail API response,
So that consumers (frontend, audit tools) can access the full per-attempt history after execution completes.

**Acceptance Criteria:**

**Given** a sandbox execution completes and `IAIExecutionResult.qaAttempts` is populated
**When** the execution service records the result
**Then** `qaAttempts` is serialised to JSON and saved to `Execution.qa_attempts` in the database

**Given** a sandbox execution completes with no QA attempts (e.g. `qaStatus: 'skipped'`)
**When** the execution service records the result
**Then** `Execution.qa_attempts` is stored as `null` — no empty array written

**Given** the execution detail API endpoint is called for a completed execution
**When** the response DTO is serialised
**Then** `qaAttempts` is included in the response as a typed array (or `null` if no attempts occurred)

**Given** the execution detail endpoint is called for an execution where `qa_attempts` is `null`
**When** the response is returned
**Then** `qaAttempts: null` (or omitted) is returned — no 500 error, no empty array coercion

**Given** existing execution detail API consumers
**When** this field is added to the response
**Then** all existing response fields remain unchanged — `qaAttempts` is purely additive (NFR-EXT8)

---

## Epic FE-1: PM Resolution Modal & QA Results Panel

A PM watching the DSF dashboard can act on a QA-failed execution directly — choose to open the PR for manual review or cancel — and inspect a per-attempt QA breakdown showing exactly what the agent tried, what failed, and where it self-healed.

### Story FE-1.1: Detect QA_FAILED State & Surface Resolution Prompt

As a **PM watching an execution**,
I want the execution card to immediately reflect `QA_FAILED` state when it occurs and show a prompt to act,
So that I know I need to make a decision without refreshing the page.

**Acceptance Criteria:**

**Given** the frontend has an active WebSocket connection via the existing `useSocket` hook
**When** the server emits a state change event with `executionPhase: 'QA_FAILED'`
**Then** the execution card updates in real time to show a `QA_FAILED` status badge (red, per UX Traffic Light system) without a page refresh (FR-EXT9)

**Given** the execution card is showing `QA_FAILED`
**When** the PM views it
**Then** a visible prompt appears on the card: "QA failed after [N] retries — action required" with a "Resolve" button

**Given** the "Resolve" button is visible
**When** the PM has not yet clicked it
**Then** the execution card does not auto-redirect or auto-dismiss — it remains in `QA_FAILED` state until the PM acts

**Given** the execution card is in `QA_FAILED` state
**When** another PM or the same PM resolves it via the API directly
**Then** a WebSocket event updates the card to the resulting state (`COMPLETED` or `FAILED`) in real time

### Story FE-1.2: Implement PM Resolution Modal (Open PR / Cancel)

As a **PM with a QA-failed execution**,
I want a modal that shows me the branch, the last QA error, and lets me choose to open a PR or cancel,
So that I can resolve the situation in one action without touching GitHub or ClickUp manually.

**Acceptance Criteria:**

**Given** the PM clicks "Resolve" on a `QA_FAILED` execution card
**When** the modal opens
**Then** it displays: the pushed branch name as a clickable GitHub URL, the last QA error output (lint errors or test failures), and two action buttons: "Open PR Anyway" and "Cancel" (FR-EXT10)
**And** the modal is focus-trapped and all buttons have explicit ARIA labels (NFR-EXT4, UX-DR1)

**Given** the modal is open
**When** the PM clicks "Open PR Anyway"
**Then** a confirmation step is shown ("Are you sure? This will open a PR with failing QA.") before the API call is made (UX-DR4)
**And** on confirmation, `POST /api/v1/executions/:id/resolve-qa-failure` is called with `{ "action": "open_pr" }`

**Given** the `open_pr` API call succeeds
**When** the response is received
**Then** the modal closes and a toast notification appears: "PR #[number] opened — [prUrl]" at bottom-right, auto-dismissing after 5 seconds (FR-EXT11, UX-DR5)
**And** the execution card updates to `COMPLETED` state

**Given** the PM clicks "Cancel" in the modal
**When** the API call completes
**Then** `POST /api/v1/executions/:id/resolve-qa-failure` is called with `{ "action": "cancel" }`
**And** the modal shows: "Execution cancelled — ticket moved to manual review. Branch [name] is available for a developer to continue." (FR-EXT12)
**And** the execution card updates to `FAILED` state

**Given** the API returns a `404`
**When** the response is received
**Then** an inline error message shows: "Execution not found." — buttons remain enabled for retry (FR-EXT13)

**Given** the API returns a `409`
**When** the response is received
**Then** the modal shows: "This execution is no longer in QA Failed state — it may have already been resolved." and the modal closes after 3 seconds (FR-EXT13)

**Given** the API returns a `422`
**When** the response is received
**Then** the modal shows: "Invalid action. Please refresh and try again." (FR-EXT13)

**Given** the modal is open and no action is in progress
**When** the PM presses Escape or clicks outside the modal
**Then** the modal closes without calling the API (NFR-EXT4, UX-DR1)

**Given** an action is in progress (API call in-flight)
**When** the PM presses Escape or clicks outside
**Then** the modal does NOT close — it remains until the response is received (NFR-EXT4, UX-DR1)

**Given** the modal renders on mobile (< 768px viewport)
**When** the PM views it
**Then** both "Open PR Anyway" and "Cancel" buttons have a minimum height of 44px (UX-DR4)

### Story FE-1.3: QA Results Panel — Per-Attempt Breakdown

As a **PM reviewing a completed or QA-failed execution**,
I want a QA Results Panel on the execution detail page showing each attempt's lint and test outcome,
So that I can see exactly what the agent tried, what failed, and whether it self-healed.

**Acceptance Criteria:**

**Given** the execution detail page is loaded for an execution with `qaAttempts` data
**When** the panel renders
**Then** each attempt is shown as a distinct row with: attempt number, lint status (pass ✅ / fail ❌ with error count badge), test status (pass ✅ / fail ❌ with "X passed / Y failed"), duration, and a final badge ("Self-healed" green / "Failed" red / "Passed" green solid) (FR-EXT14, UX-DR3, UX-DR6)

**Given** the execution has `qaAttempts: null` or `qaAttempts: []`
**When** the panel renders
**Then** a graceful empty state is shown: "No QA attempt data available for this execution" — no crash, no empty table

**Given** a sandbox execution is actively running and the agent is on attempt 2 of 3
**When** the `qa_attempt` WebSocket event arrives or the panel is polled
**Then** attempt 2 data appears in the panel without a page refresh
**And** the panel uses `aria-live="polite"` so screen readers announce the new attempt without stealing focus (NFR-EXT5, UX-DR3)

**Given** lint errors exist for a failed attempt
**When** the PM expands the attempt row
**Then** the lint error details are shown (file names, error messages) in a collapsible section

**Given** the execution used `qaStatus: 'self_healed'`
**When** the panel renders
**Then** the final passing attempt is visually distinguished as "Self-healed" in green, and earlier failed attempts are shown in red — making the recovery path clear (UX-DR3, UX-DR6)
