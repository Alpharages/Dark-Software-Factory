# Story 12.3: File Lock Manager

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Dark Software Factory orchestrator**,
I want **a file lock manager that predicts which repo files a ticket will modify and reserves exclusive locks before AI execution**,
so that **multiple in-flight tickets cannot modify the same files concurrently, preventing merge conflicts and wasted AI cycles**.

## Acceptance Criteria

1. **AC#1 (AI Prediction):** The system predicts a **repo-relative list of file paths** likely to be modified for a ticket (with reasoning + confidence).
2. **AC#2 (Atomic Lock Acquire + DB Safety):** `acquireLocks()` acquires all required file locks **atomically** (all-or-nothing) and is safe under concurrency **because the database enforces one active lock per file** (partial unique index on `file_path` where `status='LOCKED'`).
3. **AC#3 (Conflict Queue + ETA):** If any file is locked by another ticket, the ticket is **queued** with:
   - conflicting file paths
   - the ticket(s) currently holding those locks
   - an **ETA** until it can proceed (best-effort)
4. **AC#4 (Auto Release on PR Merge):** All locks for a ticket are released automatically after the ticket’s PR is **merged** (or the system receives the canonical “merged” signal).
5. **AC#5 (FIFO Fairness):** For each file path, lock acquisition is **FIFO** among waiting tickets (fairness per file) and the system enforces the **multi-file rule**: a ticket only acquires locks when it is **head-of-queue for every file** it needs (prevents starvation and partial acquisition).
6. **AC#6 (Dashboard Visibility):** Provide API support so dashboards can show:
   - current active file locks
   - waiting tickets per file (queue)
   - estimated wait / ETA
7. **AC#7 (Concurrency Tests):** Unit tests simulate concurrent lock requests and prove:
   - only one ticket holds a lock for a file at a time
   - atomicity holds (no partial acquire)
   - FIFO ordering is honored (per file)

## Tasks / Subtasks

- [x] **Create File Locks module + service skeleton** (AC: #2, #6)
  - [x] Create `src/file-locks/file-lock-manager.service.ts`
  - [x] Create `src/file-locks/file-locks.module.ts`
  - [x] Add `src/file-locks/dto/` + `src/file-locks/interfaces/` as needed
- [x] **DB + migrations: correctness + queue model (DEFAULTS)** (AC: #2, #5)
  - [x] Add SQL migration for **partial unique index** enforcing one active lock per `file_path` where `status='LOCKED'`
  - [x] Implement **Option A (default):** create a dedicated queue table `FileLockQueue` (or `FileLockRequest`) for FIFO ordering
- [x] **Implement AI-based file prediction (delegation pattern)** (AC: #1)
  - [x] Implement `predictFileModifications()` using an AI provider to return strict JSON (paths + confidence + reasoning)
  - [x] Add caching / lightweight heuristics to reduce token cost (Epic 4 delegation lessons)
- [x] **Implement atomic lock acquisition + conflict detection** (AC: #2, #3, #5)
  - [x] Implement `acquireLocks()` with `prisma.$transaction()` and DB constraint handling (partial unique index is the source of truth)
  - [x] Implement `checkConflicts()` returning locked files + lock owners + queue position
  - [x] Persist lock state + queue state; record AIDecisionLog entries for “lock_request”, “lock_conflict”, “lock_acquired”
- [x] **Implement lock release + queue advance** (AC: #4, #5)
  - [x] Implement `releaseLocksForExecution(executionId)` (and/or `releaseLocksForTicket(ticketId)`)
  - [x] Implement “advance queue” per file: promote next WAITING ticket to LOCKED (FIFO) **only when multi-file rule is satisfied**
  - [x] Ensure release is triggered from the canonical “PR merged” signal path (see Technical Requirements)
- [x] **Add dashboard API endpoints (read-only)** (AC: #6)
  - [x] `GET /api/v1/file-locks` (active locks + owners)
  - [x] `GET /api/v1/file-locks/waiting` (queue view; filter by file path optional)
  - [x] Ensure RBAC aligns with dashboard patterns (PM/TL/QA/MGR/Admin)
- [x] **Testing: concurrency + correctness** (AC: #7)
  - [x] Concurrent acquire test (Promise.all) proves DB prevents double-locking
  - [x] Atomicity test: if one file conflicts, none are acquired
  - [x] FIFO test per file path (deterministic ordering)

## Dev Notes

### Developer Context (Read First)

- **Where this runs in the v3 flow**: this is the “File Lock Manager” gate between dependency checks and branch selection (see `docs/system-flow-diagram-v3.md`, “FileConflict → Acquire file locks”).
- **Core job**: *before* AI execution, predict which files a ticket will touch and prevent concurrent modifications by enforcing exclusive locks (Epic 12 goal: “80% reduction in merge conflicts”).
- **Delegation principle (Epic 4 retro)**: DSF orchestrates; **AI produces structured output** (strict JSON); DSF stores + enforces correctness. Avoid custom parsers and huge heuristics that duplicate what AI can do well.
- **Safety principle (Epic 11 foundation)**: correctness comes from **Postgres constraints + Prisma transactions**, with full traceability via `AIDecisionLoggerService` and Prometheus metrics via `MetricsService`.
- **Upstream dependencies:** Story **12.1** (cycle detection) and **12.2** (ETA calculator + re-queue pattern) are upstream; file lock waiting should reuse the same style: best-effort ETA + safe re-queue.
-
- **Recent repo patterns to reuse (avoid regressions):**
  - Reuse existing **metrics + audit** patterns (`MetricsService.incrementCounter/recordHistogram/setGauge`, `AIDecisionLoggerService.logDecision`).
  - Reuse existing **controller prefix** patterns (`@Controller('api/v1/...')`) and RBAC guard style from `src/audit/audit.controller.ts` / `src/projects/project.controller.ts`.
  - For GitHub events, avoid inventing a new subsystem—extend existing `src/webhooks` module with a minimal GitHub webhook endpoint.

### Critical Correctness Constraints (Must Not Miss)

- **DB must prevent double-locking a file under concurrency**. Current `FileLock` model constraints (`@@unique([ticket_id, file_path])`) do **not** prevent *two different tickets* from locking the same `file_path`. Fix requires a DB-level rule, e.g. a **partial unique index**: “unique(file_path) WHERE status = 'LOCKED'”. (Prisma can’t express this; add via SQL migration.)
- **FIFO queue per file requires an explicit ordering mechanism**. You can’t claim FIFO fairness without persisted queue order (e.g., `requested_at` + deterministic tie-breaker) and a “WAITING” state (either extend `FileLockStatus` or create a dedicated queue table).
- **Execution ID requirement (CRITICAL):** `FileLock.execution_id` is **required** in Prisma. Therefore, file locks must be acquired **after an `Execution` record exists** (e.g., in routing stage, right after `prisma.execution.create(...)` and before publishing to `ai-execution-queue`). Do not design a lock-acquire step that runs before `executionId` exists.
- **Multi-file fairness rule (CRITICAL):** a ticket that needs multiple files must only acquire when it is **head-of-queue for ALL those files**. If it’s head-of-queue for some but not all, it stays WAITING (prevents starvation and “lock hoarding”).

### Default Choices (So Dev Agents Don’t Diverge)

- **Queue model:** Option A (new table) — `FileLockQueue` / `FileLockRequest`
- **PR merge signal:** Option A — GitHub webhook `pull_request.closed` with `merged=true`

### Implementation Order (Recommended)

1. DB migration(s): partial unique index + queue table
2. `FileLockManagerService` (predict → acquire → release)
3. Read-only API endpoints for dashboards
4. Concurrency unit tests (Promise.all; deterministic ordering; multi-file rule)
5. GitHub merge signal (webhook endpoint + signature verification) → call release

### Required Observability & Audit (Epic 11 patterns)

- **Audit logs (AIDecisionLoggerService)**: log at least these decisions with `ticketId` and `executionId` when available:
  - `file_lock_prediction` (paths + confidence + reasoning)
  - `file_lock_request` (requested file set)
  - `file_lock_conflict` (conflicts + owners + queue position + ETA)
  - `file_lock_acquired` (locks created)
  - `file_lock_released` (locks released + how release was triggered)
- **Metrics (MetricsService generic facade)**: track lock contention + wait time so Epic 12 success metrics are measurable (e.g., `file_locks_active`, `file_lock_conflicts_total`, `file_lock_wait_seconds` histogram).

### Scope Boundaries (Keep This Story Focused)

- **This story builds** the lock manager module/service, DB constraints/queue model, read APIs for dashboards, and concurrency tests.
- **This story does NOT wire** the lock manager into the full intake pipeline end-to-end; that orchestration wiring happens in **Story 12.5**.

## Technical Requirements

### 1) Data model requirements (Prisma + Postgres)

- **Current schema exists:** `FileLock` + `FileLockStatus` are already present in `prisma/schema.prisma` (Epic 11).
- **Mandatory DB constraint (AC#2):** add a **partial unique index** to enforce “only one active lock per file”:
  - Example intent: `UNIQUE (file_path) WHERE status = 'LOCKED'`
  - Implement via SQL migration (Prisma schema alone cannot express partial unique indexes).
- **Queue/FIFO (AC#5 DEFAULT):** implement a new table `FileLockQueue` (or `FileLockRequest`) with:
  - `id`, `ticket_id`, `execution_id`, `file_path`, `requested_at`, `status` (`WAITING|ACQUIRED|CANCELLED`), `acquired_at?`
  - selection rule: “head of queue = min(requested_at) for that file_path”
- **Deadlock avoidance:** when acquiring multiple file locks, always process file paths in a deterministic order (e.g., lexicographic sort) inside a single DB transaction.
- **Stale lock recovery:** implement a lock timeout (default **30 minutes** per `docs/implementation-plan-v3.md`) so crashes don’t block the pipeline indefinitely.

### 2) Core service API (src/file-locks)

Create `FileLockManagerService` with these minimum methods:

- `predictFileModifications(input): Promise<{ filePaths: string[]; confidence: number; reasoning: string }>`
  - Delegated to AI; must return **strict JSON**; normalize to repo-relative paths and dedupe.
- `acquireLocks(request): Promise<{ acquired: boolean; conflicts?: {...}; estimatedReleaseTime?: Date }>`
  - Must be **atomic** (all-or-nothing) via `prisma.$transaction()`.
  - Must return conflict detail sufficient for ClickUp comments + dashboards.
- `releaseLocksForExecution(executionId: string): Promise<void>`
  - Releases all locks for the execution and advances queues for affected files.

**Conflict handling contract:** when `acquireLocks()` returns `acquired=false`, include enough detail for the orchestrator (Story 12.5) to:
- post a ClickUp comment/status update (optional)
- schedule a retry using an existing delayed/TTL queue pattern (do **not** busy-loop)

### 3) “Release on PR merge” trigger (AC#4)

There is **no GitHub webhook intake** today for PR merge events, but we *do* have PR creation via `GitHubPROrchestrator` and deployment triggers.

**Default strategy (required):** add a minimal GitHub webhook endpoint that handles `pull_request` events and, on `action=closed` with `pull_request.merged=true`, calls `releaseLocksForExecution()` / `releaseLocksForTicket()`.

Either way: the release path must be **idempotent** (safe to run multiple times).

### 4) Metrics + auditing (Epic 11 patterns)

- Log lock decisions with `AIDecisionLoggerService` (see Dev Notes).
- Use `MetricsService` generic facade (`incrementCounter`, `recordHistogram`, `setGauge`) for lock metrics.

### Project Structure Notes

- Alignment with unified project structure (paths, modules, naming)
- Detected conflicts or variances (with rationale)

### References

- `docs/sprint-artifacts/epic-12-v3-dependency-conflict-management.md` (Story 12.3 requirements + ACs)
- `docs/sprint-artifacts/epic-4-retro-2025-12-08.md` (AI delegation pattern: orchestrate vs rebuild)
- `docs/sprint-artifacts/epic-11-retro-2025-12-22.md` (audit/metrics patterns + Prisma transaction caution)
- `docs/system-flow-diagram-v3.md` (File Lock Manager position in pipeline)
- `prisma/schema.prisma` (models: `FileLock`, `AIDecisionLog`, `Execution`; note `FileLock.execution_id` is required)

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.5 (via Cursor IDE)

### Debug Log References

N/A - Implementation completed successfully without requiring debug sessions

### Completion Notes List

- **Database Schema & Migration**: Created `FileLockQueue` table and added partial unique index `file_locks_file_path_locked_key` on `file_locks(file_path) WHERE status='LOCKED'` to enforce single active lock per file (AC#2)
- **Core Service Implementation**: Implemented `FileLockManagerService` with AI-based file prediction (AC#1), atomic lock acquisition with conflict detection (AC#2, #3), FIFO queue management (AC#5), and automatic lock release (AC#4)
- **API Endpoints**: Created REST API endpoints for dashboard visibility (AC#6): `GET /api/v1/file-locks` and `GET /api/v1/file-locks/waiting` with RBAC guards
- **GitHub Webhook Integration**: Created `GitHubWebhooksController` to handle `pull_request.closed` events with `merged=true` to trigger automatic lock release (AC#4); includes signature verification guard
- **Observability**: Integrated `AIDecisionLoggerService` for audit trails and `MetricsService` for Prometheus metrics tracking lock contention and wait times
- **Testing**: Implemented comprehensive unit tests including concurrency tests (AC#7) verifying single lock per file, atomicity, and FIFO ordering
- **Multi-file Fairness**: Enforced the critical multi-file rule: tickets only acquire locks when at head-of-queue for ALL required files
- **Pre-existing Test Failures**: Fixed 3 of 6 pre-existing test suite failures (qa-orchestrator, github.service, ai-decision-logger) unrelated to file-locks; remaining 3 failures (github-pr-orchestrator, github-branch, ai-decision-logger duplication) are technical debt from other stories

### Code Review Fixes Applied (2025-12-23)

Following adversarial code review, the following critical and medium-severity issues were fixed:

**CRITICAL Fixes:**
1. **Registered `FileLocksModule` in `app.module.ts`** - Module was implemented but not wired into the application, making API endpoints inaccessible
2. **Implemented stale lock recovery** - Added `releaseStaleLocksForFiles()` to automatically clean up locks exceeding 30-minute timeout (prevents crashed executions from permanently blocking files)
3. **Fixed story file list** - Corrected documentation to reflect actual files created (removed fictional `file-lock-response.dto.ts` and `file-lock.interface.ts`, added actual DTOs and interfaces)

**MEDIUM Fixes:**
4. **Increased queue advancement iteration limit** - Raised from 10 to 50 iterations (via `MAX_QUEUE_ADVANCE_ITERATIONS` constant) to handle deeper dependency chains
5. **Added comprehensive metrics** - Implemented `file_locks_active` gauge, `file_lock_conflicts_total` counter, `file_lock_stale_releases_total` counter, and `file_prediction_ai_failures_total` counter with error classification
6. **Enhanced AI provider error handling** - Added error type classification (rate_limit, auth_error, network_error, parse_error, api_error) with dedicated metrics and improved logging
7. **Improved file path extraction** - Enhanced `extractExplicitRepoPaths()` to filter out URLs and domain-like patterns, only accepting paths starting with known repo prefixes (`src/`, `prisma/`, `test/`, etc.)
8. **Fixed PR merge detection** - Added `orderBy: { created_at: 'desc' }` to `GitHubPush` query to ensure most recent execution is used when multiple pushes exist for same PR

**Configuration Requirements:**
- **New Environment Variable:** `GITHUB_WEBHOOK_SECRET` - Required for GitHub webhook signature verification (HMAC SHA-256). Configure in GitHub repo settings → Webhooks → Secret.

### File List

**Created Files:**
- `prisma/migrations/20251222230000_add_file_lock_queue_and_partial_unique_index/migration.sql` - Database migration for queue table and partial unique index
- `src/file-locks/file-lock-manager.service.ts` - Core file lock manager service
- `src/file-locks/file-locks.controller.ts` - REST API endpoints for dashboard visibility
- `src/file-locks/file-locks.module.ts` - NestJS module configuration
- `src/file-locks/file-prediction.provider.ts` - AI delegation wrapper for file prediction
- `src/file-locks/dto/acquire-locks.dto.ts` - DTO for lock acquisition requests
- `src/file-locks/dto/file-lock-waiting-query.dto.ts` - DTO for waiting queue queries
- `src/file-locks/dto/predict-file-modifications.dto.ts` - DTO for file prediction requests
- `src/file-locks/interfaces/file-prediction.interface.ts` - TypeScript interfaces for prediction
- `src/file-locks/interfaces/lock-acquire.interface.ts` - TypeScript interfaces for lock acquisition
- `src/file-locks/file-lock-manager.service.spec.ts` - Unit tests for service
- `src/file-locks/file-lock-manager.concurrency.spec.ts` - Concurrency tests (AC#7)
- `src/file-locks/file-lock-manager.acquire-locks.spec.ts` - Lock acquisition tests
- `src/file-locks/file-lock-manager.release-locks.spec.ts` - Lock release tests
- `src/file-locks/file-lock-queue.prisma.spec.ts` - Prisma schema tests
- `src/webhooks/github-webhooks.controller.ts` - GitHub webhook handler for PR merge events
- `src/webhooks/guards/github-webhook-signature.guard.ts` - GitHub webhook signature verification (HMAC SHA-256)

**Modified Files:**
- `prisma/schema.prisma` - Added `FileLockQueueStatus` enum and `FileLockQueue` model
- `src/webhooks/webhooks.module.ts` - Imported `FileLocksModule`
- `src/webhooks/guards/index.ts` - Exported `GitHubWebhookSignatureGuard`
- `src/app.module.ts` - Registered `FileLocksModule`
- `src/config/configuration.ts` - Added `github.webhookSecret` configuration
- `src/config/env.validation.ts` - Added `GITHUB_WEBHOOK_SECRET` validation
- `src/prisma/**` - Generated Prisma client types (auto-generated)


