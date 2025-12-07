# Story 4.5: CI/CD Pipeline Trigger & Monitoring

**Status:** ready-for-dev

## Story

As the system,
I want to trigger CI/CD pipelines automatically when code is pushed,
So that deployments happen without manual intervention.

## Acceptance Criteria

### AC#1: CI/CD Provider Detection & Triggering

**Given** code is pushed to a feature branch (Story 4.3) and PR is created (Story 4.4)  
**When** the system triggers CI/CD deployment  
**Then** it:

- Consumes RabbitMQ message from `github-pr-created-queue` (published by Story 4.4)
- Validates required PR metadata exists (pr_number, pr_url must not be NULL)
- Detects CI/CD provider from repository configuration (GitHub Actions, Jenkins, CircleCI, etc.)
- Triggers pipeline via provider-specific API or webhook
- Records deployment in `deployments` table
- Links deployment to `github_pushes` record via foreign key
- Passes deployment parameters: branch name, environment (dev/staging), commit SHA

**Execution Trigger:**

- Create `DeploymentTriggerConsumer` extends `RabbitMQConsumerBase `
- Listen to queue: `github-pr-created-queue` (or event from Story 4.4)
- Message payload: `{ executionId, githubPushId, repository, branchName, prUrl, prNumber }`
- On message received → validate PR metadata → invoke `DeploymentOrchestrator.triggerDeployment()`
- If PR metadata missing: Skip deployment, log error, update execution status

**CI/CD Provider Support:**

| Provider        | Trigger Method                     | Status API                   | Priority  |
| --------------- | ---------------------------------- | ---------------------------- | --------- |
| GitHub Actions  | Workflow Dispatch API              | Checks API / Deployments API | Primary   |
| Jenkins         | Build Trigger API                  | Build Status API             | Secondary |
| CircleCI        | Pipeline Trigger API               | Pipeline Status API          | Optional  |
| Generic Webhook | HTTP POST to configurable endpoint | Status webhook callback      | Fallback  |

**GitHub Actions Integration (Primary):**

```typescript
// Trigger GitHub Actions workflow
POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches
{
  "ref": branchName, // feature/ticket-123
  "inputs": {
    "environment": "dev" | "staging",
    "commit_sha": commitSha,
    "ticket_id": ticketId,
    "execution_id": executionId
  }
}
```

**Workflow Detection Strategy:**

- Use GitHub Contents API: `GET /repos/{owner}/{repo}/contents/.github/workflows`
- Returns list of workflow files without cloning repository
- Parse each YAML file using `js-yaml` library to find `workflow_dispatch` trigger
- Select first matching workflow or use `ConfigService` default (`github.defaultWorkflowId`)
- Provider fallback sequence: GitHub Actions → Jenkins → CircleCI → Generic Webhook (configured in env)
- If no workflow found: Use generic webhook endpoint (configured per repository)

### AC#2: Deployment Tracking Database

**Given** CI/CD pipeline is triggered  
**When** deployment record is created  
**Then** the system:

- Creates `Deployment` record in database
- Links to `GitHubPush` via `github_push_id` foreign key
- Sets initial status: `TRIGGERED`
- Records:
  - `environment`: dev, staging, or production
  - `cicd_provider`: github-actions, jenkins, circleci, webhook
  - `build_id`: Provider-specific build identifier
  - `triggered_at`: Current timestamp

**Database Schema:**

```prisma
// NEW in Story 4.5
model Deployment {
  id              String   @id @default(uuid())
  github_push_id  String
  github_push     GitHubPush @relation(fields: [github_push_id], references: [id])

  environment     String   // dev, staging, production
  cicd_provider   String   // github-actions, jenkins, etc.
  build_id        String?  // Provider-specific build/run ID
  workflow_id     String?  // GitHub Actions workflow ID (from API response)

  status          DeploymentStatus @default(TRIGGERED)
  deployed_at     DateTime?
  error_message   String?  @db.Text

  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt

  @@index([github_push_id])
  @@index([status, environment])
  @@map("deployments")
}

enum DeploymentStatus {
  TRIGGERED
  IN_PROGRESS
  COMPLETED
  FAILED
  ROLLED_BACK
}
```

**Note:** `workflow_id` populated from GitHub Actions Workflow Dispatch API response, stored for status polling.

### AC#3: Pipeline Status Monitoring

**Given** CI/CD pipeline is running  
**When** the system monitors status  
**Then** it:

- Polls GitHub Checks API or Deployments API every 30 seconds
- Updates `deployments.status` based on pipeline state:
  - `pending` → `TRIGGERED`
  - `in_progress` / `queued` → `IN_PROGRESS`
  - `success` / `completed` → `COMPLETED`
  - `failure` / `cancelled` → `FAILED`
- Records `deployed_at` timestamp when status reaches `COMPLETED`
- Stores `error_message` if deployment fails
- Stops polling when terminal status reached (COMPLETED, FAILED)

**GitHub Actions Status Polling:**

```typescript
// Get workflow run status
GET /repos/{owner}/{repo}/actions/runs/{run_id}

Response:
{
  "id": runId,
  "status": "queued" | "in_progress" | "completed",
  "conclusion": "success" | "failure" | "cancelled" | null,
  "created_at": timestamp,
  "updated_at": timestamp
}
```

**Polling Strategy:**

- **RECOMMENDED:** Use RabbitMQ delayed messages (Story 1.5 pattern)
  - Publish message to `deployment-status-poll-queue` with 30s delay
  - Consumer checks status, updates DB, re-publishes if not terminal status
  - Advantages: No memory leaks, survives restarts, observable queue depth
- **Alternative:** setTimeout with OnModuleDestroy cleanup (simpler, less robust)
- Exponential backoff: 30s → 60s → 90s (max 2 minutes between polls)
- Stop polling after 30 minutes (timeout threshold)
- Rate limit detection: Check `x-ratelimit-remaining` header before polling. If < 100, pause and resume after reset time.
- Conditional requests: Use `ETag` header from previous response as `If-None-Match` value (GitHub returns 304 if unchanged)

### AC#4: Deployment Status Synchronization to ClickUp

**Given** deployment completes (SUCCESS or FAILED)  
**When** status update is processed  
**Then** the system updates ClickUp ticket:

**ClickUp Status Mapping:**

- Success: `COMPLETED` → Configured status (env: `CLICKUP_STATUS_DEPLOYED`, default: "Deployed")
- Failure: `FAILED` → `CLICKUP_STATUS_DEPLOY_FAILED` (default: "Deployment Failed")
- Rollback: `ROLLED_BACK` → `CLICKUP_STATUS_ROLLED_BACK` (default: "Rolled Back")
- Use `ClickUpService.updateStatus()` which handles status ID resolution per workspace

**Deployment Success:**

- Update ticket status per mapping above
- Add comment including: environment, timestamp, commit SHA, build ID, PR number, logs link

**Deployment Failure:**

- Update ticket status per mapping above
- Add comment including: environment, build ID, sanitized error message, logs link, required actions

**Template Variable Construction:**

- `github_commit_url`: `https://github.com/${owner}/${repo}/commit/${commitSha}`
- `cicd_build_url`: GitHub Actions: `https://github.com/${owner}/${repo}/actions/runs/${runId}`
- `logs_link`: Same as `cicd_build_url` for GitHub Actions
- `pr_url`: From `github_pushes.pr_url`

**Rollback Notification (if applicable):**

- Update ticket status: `Rolled Back`
- Add comment: `🔄 Deployment rolled back to previous version. Reason: {reason}`

### AC#5: Error Handling & Resilience

**Given** deployment operations may fail  
**When** errors occur  
**Then** the system handles them:

| Error Type               | Retry | Action                                                    |
| ------------------------ | ----- | --------------------------------------------------------- |
| GitHub API Failure       | 3x    | Exponential backoff, log to Sentry                        |
| Workflow Not Found       | No    | Mark FAILED, notify PM via ClickUp comment                |
| Pipeline Timeout (30min) | No    | Mark FAILED, alert operators via Sentry + PagerDuty       |
| ClickUp API Failure      | 3x    | Publish to `clickup-retry-queue` (Story 2.1) with backoff |
| Rate Limit Exceeded      | No    | Pause polling, resume after limit resets                  |
| Provider Authentication  | No    | Mark FAILED, alert operators, check credentials           |

**Error Logging:**

- All deployment failures logged to Sentry with full context:
  - `githubPushId`, `ticketId`, `repository`, `environment`
  - `cicdProvider`, `buildId`, `workflowId`
  - Error stack trace and API response
- Create audit log entry for all deployment state transitions
- Increment failure metrics for alerting

**Graceful Degradation:**

- If pipeline status cannot be determined: Mark as `IN_PROGRESS` and continue monitoring
- If ClickUp update fails: Log error, retry async, do not fail deployment tracking
- If deployment record creation fails: Log critical error to Sentry, retry transaction

### AC#6: Observability & Metrics

**Given** CI/CD operations execute  
**When** metrics are recorded  
**Then** the system tracks:

**Prometheus Metrics:**

- `deployment_triggered_total{environment, cicd_provider}` - Counter
- `deployment_status_total{environment, status, cicd_provider}` - Counter
- `deployment_duration_seconds{environment, cicd_provider}` - Histogram
- `deployment_success_rate{environment}` - Gauge (calculated: completed / (completed + failed), updated after each deployment)
- `deployment_pipeline_waiting_time_seconds{environment}` - Histogram (trigger → start)
- `cicd_api_calls_total{provider, operation, status}` - Counter

**Structured Logging:**

- Log all deployment operations via `LoggerService`:
  - `githubPushId`, `deploymentId`, `ticketId`, `repository`
  - `environment`, `cicdProvider`, `buildId`, `workflowId`
  - `status`, `triggeredAt`, `deployedAt`, `duration`
  - `correlationId` (from execution context)

**Audit Trail:**

- Every deployment state transition logged to `audit_logs` table
- Includes: timestamp, deployment ID, from_status, to_status, reason

## Tasks / Subtasks

### Implementation Tasks

- [ ] Create deployment orchestrator service (AC: #1, #2, #3)
  - [ ] `DeploymentOrchestrator` service
  - [ ] Detect CI/CD provider from repository
  - [ ] Trigger GitHub Actions workflow
  - [ ] Create deployment record in database
  - [ ] Poll pipeline status via GitHub API
  - [ ] Update deployment status based on poll results
- [ ] Create ClickUp status synchronization (AC: #4)
  - [ ] `DeploymentStatusSync` service or extend `ClickUpService`
  - [ ] Format success/failure comment templates
  - [ ] Update ticket status on deployment completion
  - [ ] Add deployment details comment
  - [ ] Handle rollback notifications
- [ ] Add error handling (AC: #5)
  - [ ] Retry logic for transient GitHub API failures
  - [ ] Timeout handling (30-minute threshold)
  - [ ] Rate limit detection and backoff
  - [ ] ClickUp API failure resilience
  - [ ] Sentry integration for critical failures
- [ ] Add metrics integration (AC: #6)
  - [ ] Create deployment metrics (counter, histogram, gauge)
  - [ ] Record deployment duration
  - [ ] Track success/failure rates
  - [ ] Structured logging for all operations
- [ ] Wire to GitHub module
  - [ ] Add `DeploymentOrchestrator` to providers
  - [ ] Export service
  - [ ] Integrate with `ExecutionService` (after Story 4.4)
- [ ] Write unit tests (>80% coverage)
  - [ ] Test provider detection logic
  - [ ] Test GitHub Actions trigger
  - [ ] Test status polling with mocked API responses
  - [ ] Test ClickUp synchronization
  - [ ] Test error scenarios (timeout, rate limit, API failure)
  - [ ] Mock all external dependencies
- [ ] Integration tests (Optional - requires live CI/CD)
  - [ ] Full deployment flow with test repository
  - [ ] Verify GitHub Actions triggered
  - [ ] Verify status updates in database
  - [ ] Verify ClickUp ticket update
- [ ] Update story file
  - [ ] Mark tasks complete
  - [ ] Populate file list
  - [ ] Add completion notes
- [ ] Pre-review checklist
  - [ ] Run `pnpm lint`: 0 errors
  - [ ] Run `pnpm test`: All passing
  - [ ] Run `pnpm build`: Success

### Phase 1: Provider Detection & Triggering (AC: #1, #2)

- [ ] Create `src/github/services/deployment-orchestrator.service.ts`
- [ ] Create `src/github/interfaces/deployment-config.interface.ts`
- [ ] Create `src/github/dto/trigger-deployment.dto.ts`
- [ ] Inject dependencies:
  - [ ] `GitHubService` (Story 4.1)
  - [ ] `PrismaService` (Story 1.3)
  - [ ] `MetricsService` (Story 1.8)
  - [ ] `AuditLogService` (Story 1.7)
  - [ ] `SentryService` (Story 1.9)
  - [ ] `ClickUpService` (Story 2.1)
  - [ ] `LoggerService` (Story 1.7)
- [ ] Implement provider detection
  - [ ] Check for GitHub Actions workflows
  - [ ] Parse workflow YAML for trigger types
  - [ ] Fallback to generic webhook
- [ ] Implement GitHub Actions trigger
  - [ ] Call Workflow Dispatch API
  - [ ] Pass environment and commit context
  - [ ] Extract workflow run ID from response
- [ ] Create deployment database record
  - [ ] Link to `github_pushes` table
  - [ ] Set initial status `TRIGGERED`
  - [ ] Store provider and build metadata

### Phase 2: Status Monitoring (AC: #3)

- [ ] Implement GitHub Actions polling
  - [ ] Call Workflow Runs API
  - [ ] Parse status and conclusion fields
  - [ ] Map to deployment status enum
- [ ] Implement polling strategy
  - [ ] Initial poll: 30s interval
  - [ ] Exponential backoff: 30s → 60s → 90s
  - [ ] Timeout after 30 minutes
  - [ ] Conditional requests (If-None-Match)
- [ ] Update deployment status
  - [ ] Update `deployments` table
  - [ ] Record `deployed_at` timestamp on completion
  - [ ] Store `error_message` on failure
  - [ ] Stop polling on terminal status

### Phase 3: ClickUp Synchronization (AC: #4)

- [ ] Create comment templates
  - [ ] Success template with deployment details
  - [ ] Failure template with error and actions
  - [ ] Rollback template (if applicable)
- [ ] Implement ClickUp updates
  - [ ] Update ticket status on completion
  - [ ] Add formatted comment
  - [ ] Handle API failures gracefully
  - [ ] Queue retry if ClickUp unavailable

### Phase 4: Error Handling & Resilience (AC: #5)

- [ ] Implement retry logic
  - [ ] GitHub API failures: 3 retries, exponential backoff
  - [ ] ClickUp API failures: 3 retries, async queue
- [ ] Implement timeout handling
  - [ ] 30-minute pipeline timeout
  - [ ] Mark as FAILED, log warning
  - [ ] Alert operators via Sentry
- [ ] Implement rate limit handling
  - [ ] Detect GitHub rate limit headers
  - [ ] Pause polling until reset time
  - [ ] Log rate limit events
- [ ] Sentry integration
  - [ ] Capture all deployment failures
  - [ ] Include full context: ticket, deployment, provider
  - [ ] Alert on critical errors

### Phase 5: Observability (AC: #6)

- [ ] Add Prometheus metrics
  - [ ] `deployment_triggered_total`
  - [ ] `deployment_status_total`
  - [ ] `deployment_duration_seconds`
  - [ ] `deployment_success_rate`
  - [ ] `deployment_pipeline_waiting_time_seconds`
  - [ ] `cicd_api_calls_total`
- [ ] Add structured logging
  - [ ] Log deployment trigger
  - [ ] Log status poll results
  - [ ] Log ClickUp updates
  - [ ] Log all state transitions
- [ ] Create audit log entries
  - [ ] Deployment triggered
  - [ ] Status transitions
  - [ ] Completion (success/failure)

### Phase 6: Integration & Testing

- [ ] Wire to `ExecutionService`
  - [ ] Call after Story 4.4 (PR created)
  - [ ] Trigger deployment based on environment config
  - [ ] Handle deployment failures
- [ ] Unit tests (>80% coverage - NFR-M1)
  - [ ] Test provider detection logic
  - [ ] Test GitHub Actions trigger API calls
  - [ ] Test status polling and mapping
  - [ ] Test ClickUp synchronization
  - [ ] Test error scenarios (timeout, rate limit, API failures)
  - [ ] Mock `GitHubService`, `PrismaService`, `ClickUpService`
- [ ] Integration tests (Optional)
  - [ ] Full flow with test repository
  - [ ] Verify GitHub Actions triggered
  - [ ] Verify database updates
  - [ ] Verify ClickUp updates
- [ ] Pre-review checklist
  - [ ] `pnpm lint`: 0 errors
  - [ ] `pnpm test`: All passing
  - [ ] `pnpm build`: Success

## Dev Notes

### Architectural Decision: Direct Implementation (Not AI Delegated)

**CRITICAL:** Unlike Stories 4.3/4.4 (commit, PR creation), CI/CD triggering is **NOT delegated to AI agents**.

**Rationale:**

- GitHub Actions Workflow Dispatch API is deterministic, simple HTTP POST
- No code generation needed - just trigger existing CI/CD workflow defined in repository
- AI delegation overhead not justified for straightforward API operation
- Polling and status monitoring are traditional service responsibilities

**Pattern:** Direct service implementation with GitHub API calls via `GitHubService` (Story 4.1)

### Implementation Guidance

**Epic Context:** Part of Epic 4 automated pipeline. See architecture.md for full workflow.

**Provider-Agnostic Design (NFR-I9):**

- Primary: GitHub Actions (most common)
- Fallback: Jenkins → CircleCI → Generic Webhook
- Detect via repository configuration

**Integration Pattern (from Story 4.4):**

- Orchestrator pattern: Thin coordination, delegate to services
- Metrics facade: Use `MetricsService`, not `@InjectMetric()`
- Error strategy: Classify by retry ability, log to Sentry
- Audit logging: All operations with full context
- Database tracking: All state transitions recorded

### Technical Requirements

**Required Config Values (ConfigService):**

- `github.defaultWorkflowId`: Fallback workflow if detection fails
- `deployment.pollInterval`: Initial poll interval (default: 30s)
- `deployment.timeout`: Max poll duration (default: 30min)
- `clickup.statusDeployed`: ClickUp status name for successful deployment
- `clickup.statusDeployFailed`: ClickUp status name for failed deployment

**Service Dependencies:**

- `GitHubService` (4.1): Workflow Dispatch, Runs API
- `PrismaService` (1.3): Deployments table CRUD
- `ClickUpService` (2.1): Status updates, comments
- `MetricsService` (1.8): Prometheus metrics
- `RabbitMQPublisherService` (1.5): Polling queue messages

### Service Architecture

**Core Services:**

- `DeploymentOrchestrator`: Main coordination service
- `DeploymentTriggerConsumer`: RabbitMQ consumer (entry point)
- Optional: `DeploymentStatusPoller`: Status monitoring service

**Dependencies:** GitHubService, PrismaService, ClickUpService, MetricsService, AuditLogService, SentryService, LoggerService, ConfigService (see Technical Requirements)

**No New NPM Dependencies:** Uses `@octokit/rest`, `js-yaml` (for workflow parsing)

### File Structure

**New Files:**

- `src/github/services/deployment-orchestrator.service.ts`
- `src/github/consumers/deployment-trigger.consumer.ts`
- `src/github/dto/trigger-deployment.dto.ts`
- `src/github/interfaces/deployment-config.interface.ts`
- `prisma/migrations/*_add_deployments_table.sql` (Prisma auto-generated)

**Modified Files:**

- `src/github/github.module.ts` (add DeploymentOrchestrator, consumer)
- `src/common/metrics/collectors/business.collector.ts` (register deployment metrics)

**Database:** Deployments table (see AC#2 schema). Migration naming: Prisma auto-generates timestamp.

### Testing Requirements

**Unit Test Coverage (>80% - NFR-M1):**

**Deployment Orchestrator:**

- Test provider detection (GitHub Actions workflow detection)
- Test GitHub Actions trigger API call
- Test status polling logic (pending → in_progress → completed)
- Test status mapping (GitHub status → Deployment enum)
- Test ClickUp synchronization (success comment, failure comment)
- Test error scenarios (timeout, rate limit, API failure)
- Mock all external dependencies

**Status Polling:**

- Test exponential backoff strategy (30s → 60s → 90s)
- Test timeout after 30 minutes
- Test conditional requests (If-None-Match headers)
- Test rate limit handling
- Test terminal status detection (stop polling)

**ClickUp Sync:**

- Test comment template rendering
- Test ticket status update
- Test retry logic on API failures
- Test graceful degradation (continue if ClickUp fails)

**Mock Strategy:**

- Mock `GitHubService`, `PrismaService`, `ClickUpService`, `MetricsService`, `SentryService`, `AuditLogService`
- Use Jest fake timers for polling tests:

```typescript
// Polling test example
it('should poll with exponential backoff', async () => {
  jest.useFakeTimers();
  const pollSpy = jest.spyOn(service, 'pollDeploymentStatus');

  service.startPolling(deploymentId);

  jest.advanceTimersByTime(30000); // 30s
  expect(pollSpy).toHaveBeenCalledTimes(1);

  jest.advanceTimersByTime(60000); // 60s
  expect(pollSpy).toHaveBeenCalledTimes(2);

  jest.useRealTimers();
});
```

**Integration Tests (Optional):** Require GitHub test repository with Actions workflows. Verify full flow: trigger → poll → complete → ClickUp update.

### Metrics Implementation

**Register Metrics in BusinessCollector (One-Time Setup):**

Check if already registered in Story 1.8/3.8. If not, add to `business.collector.ts`:

```typescript
makeCounterProvider('deployment_triggered_total', ...),
makeCounterProvider('deployment_status_total', ...),
makeHistogramProvider('deployment_duration_seconds', ...),
makeGaugeProvider('deployment_success_rate', ...),
// ... rest
```

**Record Metrics:**

- `deployment_triggered_total`: On workflow dispatch call
- `deployment_status_total`: On status update to terminal state
- `deployment_duration_seconds`: Calculate `(deployed_at - triggered_at) / 1000`
- `deployment_success_rate`: Recalculate after each deployment: `completed / (completed + failed)`

**Use MetricsService Facade:**

```typescript
this.metrics.incrementCounter('deployment_triggered_total', { environment, cicd_provider });
this.metrics.recordHistogram('deployment_duration_seconds', duration, labels);
```

### Security & Audit

**Credentials:** Handled by GitHubService (4.1) and ConfigService (1.4). Never store in deployment records.

**Data Sanitization:** Sanitize error messages before storing (remove secrets). Use safe templates for ClickUp comments.

**Audit Trail:** Log all deployment state transitions to `audit_logs` with full context (deploymentId, githubPushId, ticketId, status change, timestamp).

### Anti-Patterns to Avoid

**From Epic 3 Retrospective:**

- ❌ Skip lint checks before review
- ❌ Incomplete test coverage (<80%)

**From Story 4.4:**

- ❌ Direct `@InjectMetric()` decorators (use MetricsService facade)
- ❌ Retry non-retryable errors (classify first)
- ❌ Miss audit logging for state changes
- ❌ Block pipeline on non-critical failures (e.g., ClickUp API down)

### References

**Architecture:** CI/CD Integration, Deployment Architecture  
**Prerequisites:** Stories 4.1-4.4, 2.1, 1.11  
**Requirements:** NFR-M1 (>80% coverage), NFR-O5/O6 (metrics/alerts), NFR-I9 (provider-agnostic), FR76-78 (trigger/monitor/sync)

## Dev Agent Record

### Context Reference

**Story Type:** Technical Integration (CI/CD Monitoring)  
**Complexity:** Medium  
**Epic:** 4 - GitHub Integration & CI/CD Pipeline  
**Prerequisites:**

- Story 4.1 (GitHub API Client & Authentication)
- Story 4.2 (Feature Branch Creation)
- Story 4.3 (Git Commit Generation & Push)
- Story 4.4 (Pull Request Creation & Metadata)
- Story 2.1 (ClickUp Webhook & Integration)
- Story 1.11 (GitHub Actions CI/CD Pipeline)

**Key Decision Points:**

1. **Provider-Agnostic Design (CRITICAL):**
   - **Decision:** Support multiple CI/CD providers, prioritize GitHub Actions
   - **Rationale:** NFR-I9 requires provider-agnostic design for flexibility
   - **Implementation:** Detect provider from repository, fallback to generic webhook
   - **Accept:** GitHub Actions is primary, others are secondary

2. **Status Polling Strategy:**
   - **Decision:** Poll GitHub API every 30 seconds with exponential backoff
   - **Rationale:** Balance between responsiveness and API rate limits
   - **Implementation:** 30s → 60s → 90s intervals, timeout after 30 minutes
   - **Validation:** Monitor API usage metrics, adjust if nearing limits

3. **ClickUp Synchronization:**
   - **Decision:** Update ticket status and add deployment comment
   - **Rationale:** PMs need visibility into deployment status (FR78)
   - **Implementation:** Success/failure templates, graceful degradation if ClickUp fails
   - **Accept:** Do not block pipeline on ClickUp API failures

4. **Error Handling:**
   - **Decision:** Retry transient GitHub API failures, do not retry pipeline triggers
   - **Rationale:** Pipeline triggers are idempotent, retrying can cause duplicate deployments
   - **Implementation:** Retry status polling, timeout after 30 minutes
   - **Accept:** Manual intervention required for deployment failures

### File List

**Files to be created/modified in this story:**

- `src/github/services/deployment-orchestrator.service.ts` - NEW
- `src/github/services/deployment-orchestrator.service.spec.ts` - NEW
- `src/github/dto/trigger-deployment.dto.ts` - NEW
- `src/github/interfaces/deployment-config.interface.ts` - NEW
- `src/github/github.module.ts` - MODIFY (add DeploymentOrchestrator provider)
- `src/execution/execution.service.ts` - MODIFY (integrate deployment trigger after PR creation)
- `src/execution/execution.service.spec.ts` - MODIFY (add deployment tests)
- `prisma/schema.prisma` - VERIFY (deployments table should exist from architecture)
- `prisma/migrations/*_add_deployments_table.sql` - NEW (if not already created)

### Completion Checklist

**Before marking story as ready-for-dev:**

- [x] All acceptance criteria defined (AC#1-6)
- [x] Technical requirements documented
- [x] Architecture constraints identified
- [x] Previous story learnings incorporated
- [x] Testing requirements specified
- [x] Metrics to add documented
- [x] Security considerations noted
- [x] File structure defined
- [x] Context sources linked

**Before moving to review:**

- [ ] All tasks complete
- [ ] Unit tests passing (>80% coverage)
- [ ] Integration tests passing (if applicable)
- [ ] `pnpm lint`: 0 errors
- [ ] `pnpm build`: Success
- [ ] File list populated
- [ ] Completion notes added
- [ ] Change log updated

## Change Log

| Date       | Author | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-12-07 | SM     | Story created from epics.md Epic 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 2025-12-07 | SM     | Comprehensive context from ADR, architecture.md, previous stories                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2025-12-07 | SM     | Marked ready-for-dev                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2025-12-07 | SM     | Applied validation improvements: Added RabbitMQ consumer trigger (AC#1), workflow detection via GitHub API (AC#1), provider fallback sequence (AC#1), RabbitMQ polling pattern (AC#3), rate limit detection (AC#3), ClickUp status mapping (AC#4), template variable construction (AC#4), operator alerting via Sentry+PagerDuty (AC#5), async retry queue clarification (AC#5), success rate calculation (AC#6), ADR delegation decision context, config values, jest.useFakeTimers test example. Optimized Dev Notes: 339→120 lines (65% reduction). Story reduced from 845→691 lines with improved clarity and actionability. |
