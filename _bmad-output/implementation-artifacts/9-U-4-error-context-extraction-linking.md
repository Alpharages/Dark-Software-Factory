# Story 9-U-4: Error Context Extraction & Linking

**Epic**: 9-U (Production Error Management)  
**Status**: ready-for-dev  
**Priority**: High  
**Effort**: 2 days  
**Story Points**: 3  
**Type**: Feature

## Context

When production errors occur, developers need rich context to diagnose and fix issues quickly. This story enhances raw error data by extracting and linking relevant contextual information: stack traces, user context, deployment metadata, and code commits. This context is critical for the operations team to understand the full scope of an error.

This story builds on:

- Story 9-U-1: Production Error Monitoring Integration (error ingestion)
- Story 9-U-3: Automatic Fix Ticket Creation (ClickUp ticket linking)
- Epic 11.2: AI Decision Audit Logger (provides commit history and deployment context)

## Story

As the system,  
I want to automatically extract and link contextual information to production errors,  
so that developers have all the necessary details (stack traces, commits, deployments) to diagnose and resolve issues efficiently.

## Acceptance Criteria

### AC#1: Stack Trace Parsing & Analysis

- [ ] Parse stack traces from error payloads to extract:
  - File names and line numbers
  - Function/method names
  - Source code context (if available from source maps)
- [ ] Store parsed stack trace as structured JSON in `ProductionError` table (new field: `parsed_stack_trace`)
- [ ] Link stack trace frames to repository files (when file paths match project structure)
- [ ] Identify "top frame" (most likely source of error) vs "bottom frame" (entry point)

### AC#2: User Context Extraction

- [ ] Extract user context from error metadata:
  - User ID (if authenticated)
  - Session ID
  - IP address (anonymized for privacy)
  - User agent (browser/device info)
- [ ] Store in `ProductionError` table (new field: `user_context` as JSON)
- [ ] Link to `executions` table via correlation ID when available
- [ ] Track affected user count (increment on duplicate errors)

### AC#3: Deployment Context Linking

- [ ] Link errors to deployment records via `deployments` table:
  - Find deployment by `application` + time window (error occurred within 1 hour of deployment)
  - Store `deployment_id` in `ProductionError` table
- [ ] Extract deployment context:
  - Git commit SHA
  - Branch name
  - Deployed by (user)
  - Deployment timestamp
- [ ] If no deployment found within window, mark as "deployment unknown"

### AC#4: Code Commit Linking

- [ ] Link error to relevant code commits using stack trace file paths:
  - Query git history for commits touching affected files in last 7 days
  - Use `GitOperationsService` or `AIDecisionLog` (Epic 11.2) for commit history
- [ ] Store linked commits in new junction table: `production_error_commits`
  - Fields: `production_error_id`, `commit_sha`, `commit_message`, `author`, `committed_at`, `file_path`
- [ ] Prioritize commits: rank by recency and relevance to modified files
- [ ] Generate GitHub links for each commit using the project's `github_repository_url`

### AC#5: Error Context Aggregation Service

- [ ] Create `ErrorContextService` with methods:
  - `extractAndLinkContext(errorId: string): Promise<ErrorContext>`
  - `parseStackTrace(stackTrace: string): ParsedStackTrace`
  - `findRelatedDeployment(error: ProductionError): Promise<Deployment | null>`
  - `findRelatedCommits(error: ProductionError, filePaths: string[]): Promise<CommitInfo[]>`
- [ ] Context extraction is triggered asynchronously via RabbitMQ:
  - Consume from `production_events` exchange, routing key `error.ingested`
  - Queue: `error_context_extraction_queue`
  - Non-blocking to error ingestion flow

### AC#6: Enhanced Error Detail API

- [ ] Extend `GET /api/v1/monitoring/errors/:id` to include full context:
  ```json
  {
    "id": "error-uuid",
    "application": "api-service",
    "error_type": "TypeError",
    "error_message": "Cannot read property 'x' of undefined",
    "parsed_stack_trace": {
      "frames": [
        {
          "file": "src/services/payment.ts",
          "line": 42,
          "function": "processPayment",
          "source_context": "  const amount = data.amount;  // line 42"
        }
      ],
      "top_frame": { ... },
      "entry_frame": { ... }
    },
    "user_context": {
      "user_id": "user-123",
      "session_id": "sess-456",
      "ip_hash": "abc123...",
      "user_agent": "Mozilla/5.0..."
    },
    "deployment_context": {
      "deployment_id": "dep-789",
      "commit_sha": "a1b2c3d",
      "branch": "main",
      "deployed_at": "2026-02-04T19:00:00Z"
    },
    "related_commits": [
      {
        "sha": "a1b2c3d",
        "message": "feat: update payment flow",
        "author": "dev@example.com",
        "committed_at": "2026-02-04T18:30:00Z",
        "github_url": "https://github.com/org/repo/commit/a1b2c3d"
      }
    ],
    "affected_users": 5,
    "occurrence_count": 12
  }
  ```

### AC#7: Audit Logging

- [ ] Log context extraction decisions to `ai_decision_logs` table (Epic 11.2)
  - Action: `ERROR_CONTEXT_EXTRACTED`
  - Include: error_id, deployment_id, commits_found_count, reasoning
- [ ] Log failures with error details for observability

### AC#8: Configuration

- [ ] `SystemConfig` key: `CONTEXT_EXTRACTION_ENABLED` (default: `true`)
- [ ] `SystemConfig` key: `DEPLOYMENT_LOOKUP_WINDOW_MINUTES` (default: `60`)
- [ ] `SystemConfig` key: `COMMIT_HISTORY_DAYS` (default: `7`)

## Tasks / Subtasks

### Task 1: Database Schema Updates (AC#1, AC#2, AC#3, AC#4)

- [ ] Add fields to `ProductionError` model:
  - `parsed_stack_trace` (Json?, stores structured stack trace)
  - `user_context` (Json?, stores user metadata)
  - `deployment_id` (String?, foreign key to deployments)
  - `affected_users` (Int, default: 1)
  - `occurrence_count` (Int, default: 1)
- [ ] Create new model `ProductionErrorCommit`:

  ```prisma
  model ProductionErrorCommit {
    id                  String   @id @default(uuid())
    production_error_id String
    commit_sha          String
    commit_message      String
    author              String
    committed_at        DateTime
    file_path           String
    relevance_score     Float    // 0-1, higher = more relevant
    github_url          String
    created_at          DateTime @default(now())

    production_error ProductionError @relation(fields: [production_error_id], references: [id])

    @@index([production_error_id])
    @@index([commit_sha])
    @@map("production_error_commits")
  }
  ```

- [ ] Add relation: `ProductionError` → `ProductionErrorCommit[]`
- [ ] Generate Prisma migration
- [ ] Regenerate Prisma client

### Task 2: Create ErrorContextService (AC#1, AC#3, AC#4, AC#5)

- [ ] Create `src/production-monitoring/error-context.service.ts`
- [ ] Implement `parseStackTrace(stackTrace: string): ParsedStackTrace`:
  - Use regex to extract file paths, line numbers, function names
  - Identify TypeScript/JavaScript patterns
  - Return structured object with frames array
- [ ] Implement `findRelatedDeployment(error: ProductionError): Promise<Deployment | null>`:
  - Query `deployments` table by application name
  - Filter: error.occurred_at within DEPLOYMENT_LOOKUP_WINDOW of deployment.created_at
  - Return most recent matching deployment
- [ ] Implement `findRelatedCommits(error: ProductionError, filePaths: string[]): Promise<CommitInfo[]>`:
  - Use `GitOperationsService` to query git history
  - Or query `AIDecisionLog` table for recent commits (Epic 11.2)
  - Filter commits touching affected files in last COMMIT_HISTORY_DAYS
  - Calculate relevance score based on file match and recency
- [ ] Implement `extractAndLinkContext(errorId: string): Promise<ErrorContext>`:
  - Load ProductionError from DB
  - Parse stack trace
  - Find related deployment
  - Find related commits
  - Update ProductionError with extracted context
  - Create ProductionErrorCommit records
  - Return full context object

### Task 3: Create ErrorContextConsumer (AC#5)

- [ ] Create `src/production-monitoring/error-context.consumer.ts`
- [ ] Implement `OnModuleInit` to set up RabbitMQ subscription
- [ ] Subscribe to `production_events` exchange, `error.ingested` routing key
- [ ] Queue name: `error_context_extraction_queue`
- [ ] Implement `handleErrorIngested(event: ErrorIngestedEvent)`:
  - Check `CONTEXT_EXTRACTION_ENABLED` config
  - Call `ErrorContextService.extractAndLinkContext()`
  - Handle errors with retry logic (3 attempts)
- [ ] Add exponential backoff retry (3 attempts: 1s, 2s, 4s delays)
- [ ] Log to Sentry if all retries fail

### Task 4: Update ProductionMonitoringModule (AC#5, AC#6)

- [ ] Import required modules: `GitModule` (for git operations), `PrismaModule`, `AuditModule`
- [ ] Add providers: `ErrorContextService`, `ErrorContextConsumer`
- [ ] Update `ProductionMonitoringController`:
  - Extend `GET /api/v1/monitoring/errors/:id` to include full context
  - Use Prisma include to fetch related commits

### Task 5: Create DTOs and Types (AC#1, AC#5, AC#6)

- [ ] Create `src/production-monitoring/interfaces/parsed-stack-trace.interface.ts`:

  ```typescript
  interface StackTraceFrame {
    file: string;
    line: number;
    column?: number;
    function: string;
    source_context?: string;
  }

  interface ParsedStackTrace {
    frames: StackTraceFrame[];
    top_frame: StackTraceFrame;
    entry_frame: StackTraceFrame;
    raw: string;
  }
  ```

- [ ] Create `src/production-monitoring/interfaces/user-context.interface.ts`:
  ```typescript
  interface UserContext {
    user_id?: string;
    session_id?: string;
    ip_hash?: string;
    user_agent?: string;
  }
  ```
- [ ] Create `src/production-monitoring/interfaces/error-ingested.event.ts`:
  ```typescript
  interface ErrorIngestedEvent {
    production_error_id: string;
    application: string;
    occurred_at: Date;
  }
  ```
- [ ] Create `src/production-monitoring/dto/error-context.dto.ts`:
  - Response DTO for full error context (stack trace, user context, deployment, commits)

### Task 6: System Config Seeding (AC#8)

- [ ] Add default configs to `SystemConfig` seed or migration:
  - `CONTEXT_EXTRACTION_ENABLED` = "true"
  - `DEPLOYMENT_LOOKUP_WINDOW_MINUTES` = "60"
  - `COMMIT_HISTORY_DAYS` = "7"

### Task 7: Unit Tests

- [ ] Create `error-context.service.spec.ts`:
  - Test `parseStackTrace` with various stack trace formats
  - Test `findRelatedDeployment` with different time windows
  - Test `findRelatedCommits` with file path matching
  - Mock PrismaService, GitOperationsService
- [ ] Create `error-context.consumer.spec.ts`:
  - Test message handling
  - Test retry logic
  - Mock ErrorContextService, RabbitMQ

### Task 8: Integration Test & Manual Verification

- [ ] Start dev server: `npm run start:dev`
- [ ] Ensure RabbitMQ is running
- [ ] Publish test message to `production_events` exchange:
  ```json
  {
    "production_error_id": "test-error-456",
    "application": "api-service",
    "occurred_at": "2026-02-04T20:00:00Z"
  }
  ```
- [ ] Verify `parsed_stack_trace` is populated in database
- [ ] Verify related deployment is linked (if recent deployment exists)
- [ ] Verify related commits are created in `production_error_commits` table
- [ ] Test API endpoint: `GET /api/v1/monitoring/errors/{id}` returns full context

## Dev Notes

### Architecture Patterns

**Event-Driven Architecture:**

- Follows the existing pattern from `FixTicketConsumer` (Story 9-U-3)
- Non-blocking async processing ensures error ingestion remains fast
- Context extraction can be retried independently of error ingestion

**Database Relations:**

```
ProductionError
├── 1:N → ProductionErrorCommit (linked commits)
├── N:1 → Deployment (related deployment)
└── 1:N → AIDecisionLog (audit trail)
```

**Stack Trace Parsing:**

Example stack trace format to parse:

```
TypeError: Cannot read property 'x' of undefined
    at processPayment (/app/src/services/payment.ts:42:15)
    at async /app/src/routes/payments.ts:28:5
    at async Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)
```

Parsing regex pattern:

```typescript
const STACK_FRAME_REGEX = /at\s+(?:(.+?)\s+\()?([^\s(]+):(\d+):(\d+)\)?/;
```

### Git Integration

**Option 1: GitOperationsService (Recommended)**

- Reuse existing service from `GitModule`
- Use `getCommitHistory(filePaths, since)` method
- Requires local git repository access

**Option 2: AIDecisionLog (Epic 11.2)**

- Query `AIDecisionLog` table for recent commits
- Filter by `action = 'COMMIT_CREATED'` or similar
- Less direct but works without git repo access

### Privacy Considerations

- IP addresses must be hashed (not stored raw)
- User context should respect GDPR/privacy regulations
- Consider `user_context` retention policy (shorter than error retention)

### Rate Limiting & Performance

- Stack trace parsing is CPU-intensive for large traces
- Consider caching parsed results if same error fingerprint recurs
- Git history queries can be slow - implement timeout (5s max)
- Database queries should use proper indexes (see migrations)

### Error Deduplication Impact

When duplicate errors are detected (same `application` + `error_type`):

- Increment `occurrence_count`
- Increment `affected_users` (if different user)
- DO NOT re-run context extraction (wasteful)
- DO update `user_context` if new user info available

### Project Structure

```
src/production-monitoring/
├── production-monitoring.module.ts    (update)
├── production-monitoring.controller.ts (update - extend GET endpoint)
├── error-context.service.ts           (new)
├── error-context.consumer.ts          (new)
├── fix-ticket.service.ts              (existing from 9-U-3)
├── fix-ticket.consumer.ts             (existing from 9-U-3)
├── dto/
│   ├── create-fix-ticket.dto.ts       (existing)
│   └── error-context.dto.ts           (new)
└── interfaces/
    ├── error-stored.event.ts          (existing)
    ├── error-ingested.event.ts        (new)
    ├── parsed-stack-trace.interface.ts (new)
    └── user-context.interface.ts      (new)
```

### Database Schema

```prisma
model ProductionError {
  // ... existing fields ...

  // Context extraction fields
  parsed_stack_trace  Json?
  user_context        Json?
  deployment_id       String?
  affected_users      Int       @default(1)
  occurrence_count    Int       @default(1)

  // Relations
  deployment          Deployment? @relation(fields: [deployment_id], references: [id])
  related_commits     ProductionErrorCommit[]
}

model ProductionErrorCommit {
  id                  String   @id @default(uuid())
  production_error_id String
  commit_sha          String
  commit_message      String
  author              String
  committed_at        DateTime
  file_path           String
  relevance_score     Float
  github_url          String
  created_at          DateTime @default(now())

  production_error ProductionError @relation(fields: [production_error_id], references: [id])

  @@index([production_error_id])
  @@index([commit_sha])
  @@map("production_error_commits")
}
```

### Dependencies

- **GitOperationsService**: From `GitModule` (for commit history)
- **PrismaService**: From `DatabaseModule`
- **RabbitMQService**: From `RabbitmqModule`
- **SystemConfigService**: From `SystemSettingsModule`
- **AIDecisionLogger**: From `AuditModule` (Epic 11.2)

### Environment Variables

No new environment variables required. Uses existing:

- `FRONTEND_URL` (for error detail links)

### Repository URL Resolution

Instead of environment variables, resolve the GitHub repository URL dynamically:

```typescript
async function resolveGitHubRepoUrl(application: string): Promise<string | null> {
  // 1. Find project by application name
  const project = await prisma.project.findFirst({
    where: { name: application },
  });

  if (project?.github_repository_url) {
    return project.github_repository_url;
  }

  // 2. Fallback: Check SystemConfig for default
  const defaultRepo = await systemConfigService.get('DEFAULT_GITHUB_REPOSITORY_URL');
  return defaultRepo || null;
}
```

**Why database over env var?**

- DSF monitors **multiple applications** (each with different repos)
- `Project.github_repository_url` is the single source of truth
- Matches the pattern from Story 4-9 (Projects table)

### References

- Story 9-U-1: Production Error Monitoring Integration
- Story 9-U-3: Automatic Fix Ticket Creation
- Epic 11.2: AI Decision Audit Logger (commit history source)
- [Stack Trace Parser Pattern](https://github.com/felixge/node-stack-trace)
- [Git log command for file history](https://git-scm.com/docs/git-log)

## Dev Agent Record

### Agent Model Used

_To be filled by dev agent_

### Debug Log References

_To be filled by dev agent_

### Completion Notes List

_To be filled by dev agent_

### File List

**Created:**

- `src/production-monitoring/error-context.service.ts`
- `src/production-monitoring/error-context.consumer.ts`
- `src/production-monitoring/dto/error-context.dto.ts`
- `src/production-monitoring/interfaces/error-ingested.event.ts`
- `src/production-monitoring/interfaces/parsed-stack-trace.interface.ts`
- `src/production-monitoring/interfaces/user-context.interface.ts`
- `src/production-monitoring/error-context.service.spec.ts`
- `src/production-monitoring/error-context.consumer.spec.ts`
- `prisma/migrations/YYYYMMDDHHMMSS_add_error_context/migration.sql`

**Modified:**

- `prisma/schema.prisma` (add fields to ProductionError, add ProductionErrorCommit model)
- `src/production-monitoring/production-monitoring.module.ts`
- `src/production-monitoring/production-monitoring.controller.ts` (extend GET endpoint)
- `src/prisma/models/ProductionError.ts` (regenerated)
- `src/prisma/models/ProductionErrorCommit.ts` (new generated)
