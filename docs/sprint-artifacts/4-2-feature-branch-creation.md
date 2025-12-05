# Story 4.2: Feature Branch Creation

**Status:** ready-for-dev

## Story

As the system,
I want to create feature branches for each ticket automatically,
So that AI code changes are isolated and reviewable.

## Acceptance Criteria

### AC#1: Branch Naming Convention

**Given** QA checks pass for an execution (quality_gate.overall_passed === true)
**When** the system prepares to push code to GitHub
**Then** it generates a branch name following the convention:

- Format: `ai/{ticket_id}-{slugified-title}`
- Example: `ai/DSF-123-user-authentication`
- Lowercase, kebab-case only
- Maximum 63 characters (Git ref limit)
- Remove special characters except hyphens
- Ticket ID extracted from execution.ticket.clickup_task_id (via relation)
- Validation: Must match regex `^ai/[a-z0-9]+(-[a-z0-9]+)*$`
- Reject if: Consecutive hyphens, leading/trailing hyphens, invalid characters

### AC#2: Branch Creation from Base

**Given** a branch name is generated
**When** the system creates the branch
**Then** it:

- Retrieves the repository's default branch (main/master) from GitHub API
- Gets the latest commit SHA from the default branch
- Creates a new Git reference at `refs/heads/{branch_name}` pointing to that SHA
- Uses GitHub API: POST `/repos/{owner}/{repo}/git/refs`
- Handles authentication via GitHubAuthService (Story 4.1)

### AC#3: Branch Existence Validation

**Given** the system attempts to create a branch
**When** the branch name already exists
**Then** it:

- Detects the 422 Unprocessable Entity response from GitHub
- Determines resolution strategy:
  - If execution is retry → Use existing branch (idempotent)
  - If execution is new → Generate unique name with timestamp suffix: `{branch_name}-{unix_timestamp}`
- Logs the decision via LoggerService with correlationId
- Proceeds with the resolved branch name

### AC#4: Database Record Persistence

**Given** a branch is successfully created
**When** the operation completes
**Then** the system:

- Creates record in `github_pushes` table with:
  - execution_id (FK to executions table)
  - repository (owner/repo format)
  - branch_name
  - commit_sha (initially the base SHA)
  - push_status: BRANCH_CREATED
  - created_at timestamp
- Note: ticketId accessed via execution.ticket_id relation (not stored directly)
- Returns GitHubPushDto with branch details for next story (4.3)

### AC#5: Error Handling & Resilience

**Given** branch creation may fail
**When** errors occur
**Then** the system:

- **Auth Errors (401/403):**
  - Log to SentryService with context: executionId, ticketId, repository, branch_name, operation, correlationId
  - Update execution.status to FAILED
  - Do NOT retry (non-retryable error)
  - Notify PM via ClickUp comment
- **Rate Limit (429):**
  - Use RetryHandlerService.scheduleRetry() from Story 2.9
  - Publish to `github-retry-queue` with delay from X-RateLimit-Reset header
  - Message payload: `{ executionId, operation: 'branch_create', repository, branchName, retryCount }`
  - Max 3 retry attempts with delays: 1min, 5min, 15min
  - Track metric: `github_rate_limit_hit_total`
- **Network Errors:**
  - Use RetryHandlerService with exponential backoff (3 attempts)
  - Delays: 2s, 4s, 8s
  - Include retry attempt number in Sentry context
  - Log each retry attempt with correlationId
- **Repository Not Found (404):**
  - Non-retryable, escalate to TL
  - Log sanitized GitHub API response (no tokens)
  - Possible causes: repo deleted, access revoked, URL misconfigured

### AC#6: Observability & Metrics

**Given** branch operations are executing
**When** metrics are recorded
**Then** the system tracks:

- `github_branch_created_total{status, repository, account_type, retry_count}` - Counter
- `github_branch_creation_duration_seconds{repository}` - Histogram
- `github_api_calls_total{operation="create_branch", status}` - Counter
- All operations logged with: executionId, ticketId, repository, branch_name, duration, correlationId
- account_type label: "user" or "organization" (parsed from repository owner)

## Tasks / Subtasks

- [ ] Create GitHub branch service and DTOs (AC: #1, #2, #3)
  - [ ] Create `src/github/services/github-branch.service.ts`
  - [ ] Create `src/github/dto/create-branch.dto.ts`
  - [ ] Create `src/github/dto/github-push.dto.ts`
  - [ ] Create `src/github/interfaces/branch-options.interface.ts`
  - [ ] Implement branch name slugification utility in `src/github/utils/branch-name.util.ts`
- [ ] Implement branch creation logic (AC: #2, #3)
  - [ ] Inject GitHubService (Story 4.1) for authenticated API calls
  - [ ] Get repository default branch: `GET /repos/{owner}/{repo}`
  - [ ] Get base commit SHA: `GET /repos/{owner}/{repo}/git/refs/heads/{default_branch}`
  - [ ] Create branch reference: `POST /repos/{owner}/{repo}/git/refs`
  - [ ] Handle 422 Unprocessable Entity (branch exists) with resolution logic
- [ ] Add database persistence (AC: #4)
  - [ ] Verify `github_pushes` table exists in Prisma schema (should exist from Epic 1)
  - [ ] Create `src/github/repositories/github-push.repository.ts` (optional pattern)
  - [ ] Inject PrismaService and create record after successful branch creation
  - [ ] Return GitHubPushDto with branch metadata
- [ ] Implement error handling (AC: #5)
  - [ ] Create typed exception classes in `src/github/exceptions/`
  - [ ] Integrate SentryService for non-retryable errors
  - [ ] Use RetryHandlerService pattern from Story 2.9 for retryable errors
  - [ ] Add RabbitMQ delayed message publishing for rate limit retries
  - [ ] Update execution status on fatal errors
- [ ] Add Prometheus metrics (AC: #6)
  - [ ] Inject MetricsService (Story 1.8 facade)
  - [ ] Record branch creation metrics in try-finally blocks
  - [ ] Track operation duration with Date.now() before/after
  - [ ] Use BusinessCollector pattern from Story 3.8
- [ ] Integration with ExecutionService (AC: #4)
  - [ ] Update ExecutionService.handleQASuccess() method to call GitHubBranchService
  - [ ] Trigger after QualityGateService returns overall_passed === true
  - [ ] Pass execution context: executionId (ticketId accessed via relation)
  - [ ] Handle branch creation failures gracefully (update execution status)
  - [ ] Verify `github-retry-queue` exists in RabbitMQ (create if missing)
- [ ] Unit tests (AC: All)
  - [ ] Test branch name generation (valid, too long, special chars)
  - [ ] Test branch exists scenario (idempotent retry vs new execution)
  - [ ] Test error handling (auth, rate limit, network, 404)
  - [ ] Mock GitHubService, PrismaService, SentryService, MetricsService
  - [ ] Achieve >80% coverage (NFR-M1)
- [ ] Integration tests (AC: #2, #3)
  - [ ] Use test GitHub repository from Story 4.1
  - [ ] Test branch creation with real GitHub API
  - [ ] Test branch exists handling
  - [ ] Verify database record created
- [ ] Pre-Review Checklist (MANDATORY per Epic 3 Retro)
  - [ ] Run `pnpm lint` and fix all errors
  - [ ] Run `pnpm test` and ensure all tests pass
  - [ ] Run `pnpm build` and verify successful compilation

## Dev Notes

### Architecture Context

**Epic Goal:** Epic 4 completes the automated pipeline from ticket to production by integrating GitHub operations. Story 4.2 creates isolated feature branches for AI-generated code, enabling code review and preventing direct commits to main/master.

**Workflow Position:**

```
Ticket → AI Generation → QA Checks (Epic 3) → ✅ Branch Creation (This Story) → Code Push (4.3) → PR Creation (4.4) → CI/CD (4.5-4.6)
```

**Design Philosophy:** Feature branches enable:

- Code review before merge
- Parallel development (multiple tickets)
- CI/CD integration with isolated environments
- Rollback capability without affecting main branch

[Source: docs/epics.md#Story 4.2: Feature Branch Creation]

### Technical Requirements

**Branch Naming Standard:**

- Git ref name rules: Lowercase alphanumeric + hyphens, max 63 chars
- Pattern: `ai/{ticket_id}-{slug}` makes branches easily identifiable as AI-generated
- Slug generation: Replace spaces/special chars with hyphens, lowercase, trim
- Validation regex: `^ai/[a-z0-9]+(-[a-z0-9]+)*$`
- Conflict resolution: Add Unix timestamp suffix if branch exists for new execution

**GitHub API Operations (Reference Only):**

1. Get repository info: `GET /repos/{owner}/{repo}` → `{ default_branch }`
2. Get base SHA: `GET /repos/{owner}/{repo}/git/refs/heads/{branch}` → `{ object: { sha } }`
3. Create branch: `POST /repos/{owner}/{repo}/git/refs` with `{ ref, sha }`

See GitHub REST API docs: https://docs.github.com/rest/git/refs

[Source: docs/architecture.md#GitHub Service Implementation]

### Library & Framework Requirements

**Existing Infrastructure to Use:**

- `GitHubService` from Story 4.1 provides: `githubService.getOctokit()` for authenticated API access
- `PrismaService` for database operations (github_pushes table)
- `LoggerService` for structured logging with correlationId (automatic token redaction)
- `SentryService` for error tracking with context
- `MetricsService` facade for Prometheus metrics
- `ExecutionService` (Story 2.5) will call this service's `createBranchForExecution()`
- `RetryHandlerService` (Story 2.9) for RabbitMQ retry patterns

**GitHubService Integration from Story 4.1:**

- Story 4.1 provides: Authenticated Octokit client, rate limit handling, token security
- This story (4.2) implements: Branch-specific operations in `GitHubBranchService`
- Pattern: Create specialized service wrapping `GitHubService` for branch operations

**Service Injection Pattern:**

```typescript
constructor(
  private readonly githubService: GitHubService,
  private readonly prisma: PrismaService,
  private readonly logger: LoggerService,
  private readonly sentry: SentryService,
  private readonly metrics: MetricsService,
  private readonly retryHandler: RetryHandlerService,
) {}
```

[Source: Review of existing modules: execution/, qa-automation/, github/]

### File Structure Requirements

**Module Structure:**

Follow the existing pattern from `execution/`, `qa-automation/` modules:

- **Services:** `src/github/services/github-branch.service.ts` - Core logic
- **DTOs:** `src/github/dto/create-branch.dto.ts`, `github-push.dto.ts`
- **Interfaces:** `src/github/interfaces/branch-options.interface.ts`
- **Exceptions:** `src/github/exceptions/branch-creation.exception.ts`
- **Utils:** `src/github/utils/branch-name.util.ts` - Slugification logic
- **Tests:** Co-located `.spec.ts` files for each service

**Database Schema (Verified from prisma/schema.prisma):**

The `github_pushes` table exists with these fields:

```prisma
model GitHubPush {
  id            String       @id @default(uuid())
  execution_id  String       // FK to executions table
  repository    String       // "owner/repo" format
  branch_name   String
  commit_sha    String?
  pr_number     Int?
  pr_url        String?
  push_status   GitHubStatus @default(PENDING)
  error_message String?      @db.Text
  created_at    DateTime     @default(now())
  updated_at    DateTime     @updatedAt

  @@map("github_pushes")
}
```

**Important:** ticketId is NOT stored directly. Access via: `execution.ticket.clickup_task_id`

[Source: prisma/schema.prisma lines 174-191]

### Testing Requirements

**Unit Test Coverage (>80%):**

- Branch name generation with various inputs
- Edge cases: very long titles, special characters, unicode
- Branch existence handling: retry vs new execution
- Error scenarios: auth failure, rate limit, network error, 404
- Database record creation
- Metrics recording

**Integration Test Scenarios:**

- Create branch on test repository (from Story 4.1 setup)
- Verify branch appears in GitHub
- Test idempotent behavior (create same branch twice)
- Verify database record matches GitHub state

**Mock Strategy:**

- Mock GitHubService for unit tests
- Use real GitHub API with test repository for integration tests
- Mock PrismaService, SentryService, MetricsService in unit tests

[Source: docs/architecture.md#Testing, NFR-M1, Epic 3 Retro]

### Project Structure Notes

**Alignment with Existing Patterns:**

- Follow NestJS dependency injection patterns from `execution/`, `qa-automation/`, `ticket-intake/`
- Use repository pattern (optional): `GitHubPushRepository` for Prisma operations
- Exception pattern: Extend `HttpException` or create `GitHubBranchException` base class
- DTO validation: Use `class-validator` decorators (`@IsString`, `@IsNotEmpty`, `@MaxLength`)
- Service layer separation: `GitHubBranchService` for business logic, `GitHubService` for API calls

**Integration Points:**

- `ExecutionService.handleQASuccess()` (Story 2.5) triggers branch creation after QA passes
- `QualityGateService` (Story 3.5) determines when execution is ready
- Next story (4.3) consumes the branch_name from this story's output
- RabbitMQ integration: Uses `RetryHandlerService` to publish to `github-retry-queue`
- Queue message format: `{ executionId, operation, repository, branchName, retryCount, context }`

**ExecutionService Integration Pattern:**

```typescript
// In execution.service.ts (modify in this story)
async handleQASuccess(executionId: string) {
  const execution = await this.prisma.execution.findUnique({
    where: { id: executionId },
    include: { qa_result: true, ticket: true }
  });

  if (execution.qa_result.overall_passed) {
    await this.githubBranchService.createBranchForExecution(executionId);
  }
}
```

[Source: Review of src/execution/, src/qa-automation/]

### Prometheus Metrics to Add

**Metrics Integration:**

Use `MetricsService` facade (Story 1.8) with `BusinessCollector` pattern (Story 3.8):

```typescript
// In GitHubBranchService
const startTime = Date.now();
const labels = { repository, account_type: this.getAccountType(repository), retry_count };
try {
  // Create branch
  this.metrics.recordOperation('github_branch_create', 'success', Date.now() - startTime, labels);
} catch (error) {
  this.metrics.recordOperation('github_branch_create', 'failed', Date.now() - startTime, labels);
}
```

**Metrics to Record:**

- `github_branch_created_total{status, repository, account_type, retry_count}` - Counter
- `github_branch_creation_duration_seconds{repository}` - Histogram
- `github_api_calls_total{operation, status}` - Counter (shared with other GitHub ops)
- `github_rate_limit_remaining` - Gauge (updated on each API response)

**Optimization: Branch Creation Cache**

- Cache successful creations in Redis (TTL: 5 minutes)
- Key: `branch:${executionId}:${branchName}`
- Check cache on retry before GitHub API call (reduces rate limit usage)

[Source: docs/architecture.md#Observability, Story 1.8, Story 3.8]

### Security Considerations

**Token Security:**

- GitHub tokens automatically redacted by LoggerService (Story 1.7)
- Never log repository clone URLs with embedded tokens
- All GitHub operations use GitHubService with secure auth handling

**Audit Trail:**

- Every branch creation logged to `audit_logs` table via AuditLogService
- Include: operation="branch_create", executionId, repository, branch_name, timestamp, success/failure

**Permission Validation:**

- GitHubService (Story 4.1) validates token has `Contents: Write` permission
- 403 Forbidden responses → Alert operators, log to Sentry with full context

[Source: docs/architecture.md#Security Architecture, NFR-S11]

### References

- **Architecture:** [docs/architecture.md#GitHub Integration](../architecture.md)
- **Epic 4 Overview:** [docs/epics.md#Epic 4: GitHub Integration & CI/CD Pipeline](../epics.md)
- **Story Definition:** [docs/epics.md#Story 4.2: Feature Branch Creation](../epics.md)
- **Story 4.1:** [docs/sprint-artifacts/4-1-github-api-client-authentication.md](./4-1-github-api-client-authentication.md)
- **NFR-M1:** Testing requirement >80% coverage
- **NFR-O5:** Prometheus metrics requirement
- **NFR-R5:** GitHub push failures must alert PM immediately

### Previous Story Learnings

**Epic 3 Retrospective (2025-12-05):**

- Run `pnpm lint` before moving to review (MANDATORY)
- Comprehensive test coverage >80% (NFR-M1)
- Use RabbitMQ for async retry patterns (validated in Stories 2.9, 3.7)

**Story 4.1 Context (GitHub Authentication):**
Story 4.1 established:

- `GitHubService.getOctokit()` provides authenticated Octokit client
- PAT-based authentication for Phase 1 (GitHub App deferred to Phase 2)
- Rate limit handling: Detect 429 → Use RetryHandlerService with delayed retry
- Token redaction: Centralized in LoggerService (automatic)
- Multi-account strategy prepared for future scaling

This story (4.2) uses the authenticated Octokit client to create feature branches.

[Source: docs/sprint-artifacts/4-1-github-api-client-authentication.md, epic-3-retro-2025-12-05.md]

## Dev Agent Record

### Context Reference

**Story Type:** Technical Infrastructure  
**Complexity:** Medium  
**Epic:** 4 - GitHub Integration & CI/CD Pipeline  
**Prerequisites:** Story 4.1 (GitHub API Client), Story 3.5 (QA Quality Gate)

**Key Decision Points:**

1. **Branch Naming:** `ai/{ticket_id}-{slug}` format chosen for:
   - Clear identification of AI-generated branches
   - Traceability to source ticket
   - Git-compatible naming (lowercase, kebab-case, max 63 chars)
2. **Conflict Resolution:** Timestamp suffix for new executions, reuse for retries
   - Enables idempotent retries
   - Prevents accidental overwrites
3. **Error Strategy:** Non-retryable (auth, 404) vs retryable (rate limit, network)
   - Matches RetryHandlerService patterns from Story 2.9
4. **Database:** Reuse `github_pushes` table from Epic 1 schema
   - Minimizes schema changes
   - Links executions to git operations

### Agent Model Used

Story created by: Bob (Scrum Master Agent) via BMAD Method  
Story creation date: 2025-12-05  
Workflow: create-story (BMAD v6.0.0)  
Mode: YOLO (fully automated story generation)

### Debug Log References

<!-- Will be populated during development -->

### Completion Notes List

<!-- Developer to fill during implementation -->

### File List

<!-- Developer to populate with all files created/modified -->
