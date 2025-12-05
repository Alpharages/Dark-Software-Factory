# Story 4.1: GitHub API Client & Authentication

**Status:** ready-for-dev

## Story

As the system,
I want to authenticate with GitHub API securely using a multi-account strategy,
So that I can perform git operations programmatically across different GitHub accounts and organizations.

## Acceptance Criteria

### AC#1: GitHub Authentication Client Setup

**Given** GITHUB_TOKEN or GitHub App credentials are configured in environment
**When** the system initializes the GitHub client
**Then** the authentication mechanism is configured with:

- Support for Personal Access Token (PAT) OR GitHub App authentication
- Token rotation/refresh capability (for GitHub App)
- Automatic token expiration handling
- Secure credential storage (no logging of tokens)

### AC#2: GitHub API Client Operations

**Given** an authenticated GitHub client exists
**When** GitHub operations are performed
**Then** the client supports these core operations:

- Get repository details (owner, name, default branch, visibility)
- Create branches
- Push commits (via Git API)
- Create pull requests
- Update commit status
- Add PR comments
- List repository installations (for GitHub App)

### AC#3: Rate Limit Handling

**Given** GitHub API requests are being made
**When** rate limits are approached or exceeded
**Then** the system:

- Detects 429 (Too Many Requests) responses
- Reads `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers
- Uses RabbitMQ delayed message pattern from Story 2.9 for retries
- When 429 detected: publish to `github-retry-queue` with delay = X-RateLimit-Reset timestamp
- Max 3 retries with exponential backoff: 1min, 5min, 15min
- Logs rate limit events to LoggerService with correlation ID
- Tracks rate limit metrics: `github_rate_limit_remaining`, `github_rate_limit_hit_total`

### AC#4: Multi-Account Repository Resolution

**Given** repositories exist across multiple GitHub accounts (user accounts, organizations)
**When** the system needs to access a specific repository
**Then** it:

- Parses repository URL to extract owner/repo
- Determines which GitHub App installation has access (if using GitHub App)
- Obtains appropriate authentication token for that installation
- Caches installation-to-repository mappings for performance

### AC#5: Error Handling & Resilience

**Given** GitHub API operations may fail
**When** errors occur
**Then** the system:

- Categorizes error types: authentication (401/403), rate limit (429), not found (404), network errors
- Logs errors via SentryService (Story 1.9) with full context (repo, operation, executionId, correlationId)
- Retries transient errors using RetryStrategyService pattern (Story 2.9)
- Uses RabbitMQ delayed messages for retry scheduling (max 3 attempts)
- Does NOT retry auth errors (401/403) or client errors (4xx except 429)
- Returns typed errors: `GitHubAuthError`, `GitHubRateLimitError`, `GitHubNetworkError`

### AC#6: Security & Audit

**Given** GitHub operations involve sensitive credentials
**When** any GitHub operation is performed
**Then**:

- Tokens are NEVER logged (redacted in logs)
- All operations are logged to `audit_logs` table with: operation type, repository, user, timestamp, success/failure
- Failed authentication attempts trigger Sentry alerts
- Prometheus metrics track operation counts: `github_operations_total{operation, status}`

## Tasks / Subtasks

- [ ] Install GitHub API dependencies (AC: #1, #2)
  - [ ] Verify latest stable versions on npmjs.com
  - [ ] Check @octokit/rest and @octokit/app compatibility matrix
  - [ ] Install `@octokit/rest` (latest stable ~21.x)
  - [ ] Install `@octokit/app` (latest stable ~15.x - for future GitHub App support)
  - [ ] Test authentication flow with specified versions
- [ ] Create Prisma migration for GitHub Installation tracking
  - [ ] Add GitHubInstallation model per architecture.md (lines 844-861)
  - [ ] Add indexes: installationId (unique), accountLogin
  - [ ] Run `pnpm db:migrate:dev --name add_github_installation`
- [ ] Create GitHub module structure (AC: #1, #2)
  - [ ] Create `src/github/github.module.ts` with proper imports
  - [ ] Create `src/github/github.service.ts` for core operations
  - [ ] Create `src/github/github-auth.service.ts` for authentication logic (PAT only in Phase 1)
  - [ ] Create `src/github/github-client.service.ts` for Octokit wrapper
  - [ ] Optional: Create `src/github/repositories/github.repository.ts` for Prisma operations
- [ ] Implement authentication strategies (AC: #1, #4)
  - [ ] Support Personal Access Token authentication
  - [ ] Support GitHub App authentication (multi-installation)
  - [ ] Implement token caching with expiration
  - [ ] Create installation-to-repo mapping resolver
- [ ] Implement core GitHub operations (AC: #2)
  - [ ] `getRepository(owner, repo)` - Get repo details
  - [ ] `createBranch(repo, branchName, baseSha)` - Create feature branch
  - [ ] `pushCommit(repo, branch, files, message)` - Push code changes
  - [ ] `createPullRequest(repo, title, body, head, base)` - Create PR
  - [ ] `updateCommitStatus(repo, sha, state, context)` - Update status checks
  - [ ] `addPRComment(repo, prNumber, comment)` - Add PR comments
- [ ] Implement rate limit handling (AC: #3)
  - [ ] Detect rate limit responses (429, headers)
  - [ ] Implement exponential backoff with max retries
  - [ ] Add Prometheus metrics for rate limits
  - [ ] Log rate limit events with Winston
- [ ] Implement error handling (AC: #5)
  - [ ] Create typed error classes for different failure modes
  - [ ] Implement retry logic for transient errors
  - [ ] Integrate Sentry for error tracking
  - [ ] Add error context (repo, operation, correlation ID)
- [ ] Add security & audit logging (AC: #6)
  - [ ] Add token redaction patterns to LoggerService (centralized)
  - [ ] Create AuditLogService in `src/common/audit/` (if doesn't exist)
  - [ ] Log operations via AuditLogService.log()
  - [ ] Integrate MetricsService (Story 1.8) for Prometheus metrics
  - [ ] Inject SentryService (Story 1.9) for error tracking
- [ ] Environment configuration (AC: #1)
  - [ ] Add GitHub config to `src/config/configuration.ts` with Joi validation
  - [ ] Support both GITHUB_TOKEN (PAT) and future GitHub App credentials
  - [ ] Add GitHub env vars to `.env.example`
  - [ ] Document PAT setup steps in README (GitHub App = future phase)
  - [ ] Use ConfigService (Story 1.4) - NOT process.env directly
- [ ] Unit tests (AC: All)
  - [ ] Test authentication with PAT
  - [ ] Test GitHub App authentication with multiple installations
  - [ ] Test rate limit detection and backoff
  - [ ] Test error handling for each error type
  - [ ] Test operation methods with mocked Octokit
  - [ ] Achieve >80% coverage (NFR-M1)
- [ ] Integration tests (AC: #2, #3)
  - [ ] Create test GitHub repository: `dark-factory-test-repo`
  - [ ] Use dedicated test account with minimal permissions PAT
  - [ ] Add GITHUB_TEST_TOKEN to `.env.test` (git-ignored)
  - [ ] Test against GitHub API with test repository
  - [ ] Verify rate limit headers are respected
- [ ] Pre-Review Checklist (MANDATORY)
  - [ ] Run `pnpm lint` and fix all errors
  - [ ] Run `pnpm test` and ensure all tests pass
  - [ ] Run `pnpm build` and verify successful compilation

## Dev Notes

### Architecture Context

**Epic Goal:** Epic 4 completes the automated pipeline from ticket to production by integrating GitHub operations. Story 4.1 establishes the authentication foundation required for all subsequent GitHub stories (4.2-4.8).

**Multi-Account Strategy:**
The architecture recommends GitHub App over Personal Access Tokens for multi-account flexibility. However, for MVP delivery:

**Phase 1 (This Story):** Implement PAT authentication only

- Simpler, faster delivery for MVP validation
- Sufficient for single-account or limited multi-account scenarios
- Rate limit: 1,000 requests/hour (acceptable for MVP)
- Lower implementation complexity

**Phase 2 (Future Story):** Add GitHub App multi-installation support

- Higher rate limits (5,000/hour), per-installation permissions
- Clear bot actor identity, better security
- Required when scaling to multiple client organizations

[Source: docs/architecture.md#GitHub Integration (Multi-Account Strategy)]

### Technical Requirements

**Authentication Patterns:**

1. **PAT Strategy (Simpler):**
   - Single token in `GITHUB_TOKEN` env var
   - Works with one GitHub account
   - Rate limit: 1,000 requests/hour
2. **GitHub App Strategy (Recommended for Production):**
   - App ID, Private Key, Installation IDs
   - Dynamic token generation per installation
   - Rate limit: 5,000 requests/hour per installation
   - Requires database schema for installation tracking

**Required Octokit Setup:**

- PAT authentication: Single token from GITHUB_TOKEN via ConfigService
- GitHub App authentication: Deferred to Phase 2 (future story)
- See architecture.md#GitHub Service Implementation (lines 735-750) for authentication flow details

[Source: docs/architecture.md#GitHub Service Implementation]

### Library & Framework Requirements

**Dependencies to Install:**

- `@octokit/rest`: Latest stable (verify compatibility on npmjs.com)
- `@octokit/app`: Install for future GitHub App support (Phase 2)
- `@octokit/webhooks`: Required for future webhook stories (4.5+)

**Existing Infrastructure to Use:**

- `PrismaService` for database operations (Story 1.3)
- `LoggerService` (Winston) with token redaction patterns (Story 1.7)
- `SentryService` for error tracking with context (Story 1.9)
- `MetricsService` facade for Prometheus metrics (Story 1.8)
- `ConfigService` with Joi validation (Story 1.4)
- `AuditLogService` for centralized audit logging (create in `src/common/audit/` if not exists)

**Integration Pattern:**

```typescript
// In github.service.ts constructor:
constructor(
  private readonly prisma: PrismaService,
  private readonly logger: LoggerService,
  private readonly sentry: SentryService,
  private readonly metrics: MetricsService,
  private readonly config: ConfigService,
  private readonly audit: AuditLogService,
) {}
```

[Source: docs/architecture.md#Technology Stack Details]

### File Structure Requirements

**Module Structure:**

- `src/github/` module with services: github.service.ts, github-auth.service.ts, github-client.service.ts
- DTOs in `dto/`, interfaces in `interfaces/`, exceptions in `exceptions/`
- Optional: `repositories/github.repository.ts` for Prisma operations encapsulation
- Follow NestJS module pattern from Stories 2.x-3.x (reference existing modules)
- Exception classes extend `HttpException` with error codes: `GITHUB_AUTH_001`, `GITHUB_RATE_002`

[Source: docs/architecture.md#Complete Project Structure]

### Testing Requirements

**Unit Test Coverage (>80%):**

- Authentication initialization (PAT and GitHub App)
- Each GitHub operation method
- Rate limit detection and backoff logic
- Error handling for all error types
- Token caching and expiration

**E2E Test Scenarios:**

- Create branch on test repository
- Push commit to test repository
- Create pull request
- Handle rate limits gracefully

**Mock Strategy:**

- Mock Octokit client for unit tests
- Use real GitHub API with test account for E2E (or mock server)

[Source: docs/architecture.md#Testing, NFR-M1]

### Project Structure Notes

**Alignment with Existing Patterns:**

- Follow NestJS dependency injection patterns used in `ai-routing`, `qa-automation`, `execution`
- Use consistent error handling with typed exceptions (see `execution/exceptions/`, `ai-routing/exceptions/`)
- Exception pattern: Extend `HttpException` or create `GitHubBaseException` with error codes
- Follow DTO patterns from `ticket-intake/dto/` and `execution/dto/`
- Use repository pattern (optional): `GitHubRepository` for Prisma operations (matches `ExecutionRepository`, `QaResultsRepository`)

**Workflow Integration:**

- `ExecutionService` (Story 2.5) will call `GitHubService.pushCode()` after QA passes
- Triggered by `QualityGateService` (Story 3.5) when `overall_passed === true`
- Pass execution context: executionId, ticketId, projectId, aiProvider
- Integration happens in Story 4.2+ (Feature Branch Creation)

**Service Dependencies:**

- `AuditLogService` in `common/audit/` for centralized audit logging (create if not exists)
- `SentryService` from `common/sentry/` for error tracking with context
- `MetricsService` from `common/metrics/` for Prometheus metrics facade
- `LoggerService` with automatic token redaction

[Source: Review of existing modules: execution/, qa-automation/, ticket-intake/]

### Prometheus Metrics to Add

**Prometheus Metrics Integration:**

- Inject `MetricsService` (Story 1.8 facade) - NOT individual @InjectMetric() decorators
- Use existing BusinessCollector pattern from Story 3.8
- Example: `this.metrics.recordOperation('github_push', status, duration)`

**Metrics to Record:**

- `github_operations_total{operation, status, repository}` - via MetricsService
- `github_operation_duration_seconds{operation}` - via MetricsService
- `github_rate_limit_remaining{installation}` - Gauge (set on each API call)
- `github_rate_limit_hit_total` - Counter (increment on 429)
- `github_auth_failures_total{error_type}` - Counter (increment on auth errors)

[Source: docs/architecture.md#Observability, Story 1.8, Story 3.8]

### Security Considerations

**NFR-S11: Fine-grained GitHub tokens**

- Use fine-grained PATs with minimal permissions: Contents (RW), PRs (RW), Workflows (RW)
- For GitHub App: Request only necessary permissions during installation
- Store credentials in environment variables, never in code
- Redact tokens in logs using regex patterns (ghp*\*, ghs*_, github*pat*_)

**Token Security:**

- Add redaction patterns to `LoggerService` (Story 1.7) as centralized utility
- Patterns: `/(ghp_|ghs_|github_pat_)\w+/g` → `$1***REDACTED***`
- GitHub service should ONLY log through LoggerService (automatic redaction)
- **Do NOT** implement redaction logic in github.service.ts
- All tokens logged through LoggerService are automatically redacted

[Source: docs/architecture.md#Security Architecture, NFR-S11]

### References

- **Architecture:** [docs/architecture.md#GitHub Integration (Multi-Account Strategy)](../architecture.md)
- **Epic 4 Overview:** [docs/epics.md#Epic 4: GitHub Integration & CI/CD Pipeline](../epics.md)
- **Story Definition:** [docs/epics.md#Story 4.1: GitHub API Client & Authentication](../epics.md)
- **Technology Stack:** [docs/architecture.md#Technology Stack Details](../architecture.md)
- **NFR-S11:** Security requirement for fine-grained tokens
- **NFR-M1:** Testing requirement >80% coverage
- **NFR-O5:** Prometheus metrics requirement
- **NFR-O6:** Sentry error tracking requirement

### Previous Story Learnings

**Epic 3 Retrospective Insights (2025-12-05):**

- **Leaner Stories:** Avoid over-specifying implementation code; focus on requirements and acceptance criteria. Implementation details should be minimal and marked "for reference only."
- **Process:** Run `pnpm lint` before moving to review to catch errors early.
- **Testing:** Prioritize comprehensive test coverage over code volume.

[Source: docs/sprint-artifacts/epic-3-retro-2025-12-05.md]

**Recent Patterns from Stories 3.6-3.8:**

- Consistent DTO structure with validation decorators (`class-validator`)
- Service layer separation: orchestrator service + specialized services
- Metrics integration using `@InjectMetric()` decorator
- Error handling with Sentry context
- Repository pattern for database operations

[Source: Git commits from Epic 3, Stories 3.6-3.8]

## Dev Agent Record

### Context Reference

<!-- Story context created by Scrum Master - comprehensive developer guide -->

**Story Type:** Technical Infrastructure  
**Complexity:** Medium  
**Epic:** 4 - GitHub Integration & CI/CD Pipeline  
**Prerequisites:** Story 1.4 (Environment Config), Story 1.9 (Sentry), Story 3.5 (QA completion)

**Key Decision Points:**

1. **Authentication Strategy (DECIDED):** Start with PAT for MVP (Story 4.1), add GitHub App in Phase 2
   - **Rationale:** PAT provides faster delivery, sufficient for MVP validation
   - **Accept:** Lower rate limits (1,000/hour) acceptable for initial phase
   - **Future:** GitHub App implementation when scaling to multiple client orgs
2. **Error Handling:** Use typed exceptions extending `HttpException` (pattern from execution/ai-routing modules)
3. **Caching:** In-memory Map for token caching (sufficient for PAT strategy)
4. **Data Access:** Optional repository pattern for Prisma operations encapsulation

### Agent Model Used

Story created by: Bob (Scrum Master Agent) via BMAD Method  
Story creation date: 2025-12-05  
Workflow: create-story (BMAD v6.0.0)

### Debug Log References

<!-- Will be populated during development -->

### Completion Notes List

<!-- Developer to fill during implementation -->

### File List

<!-- Developer to populate with all files created/modified -->
