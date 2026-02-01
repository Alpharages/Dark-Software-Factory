# Story 20.1: Implement Robust Webhook Handler

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Orchestrator,
I want to process ClickUp webhooks reliably,
So that I never miss a task update even if I receive duplicate events or network blips occur.

## Acceptance Criteria

### AC1: Webhook Signature Validation
**Given** A valid webhook payload from ClickUp  
**When** The `WebhookController` receives it  
**Then** It MUST validate the signature (if `CLICKUP_WEBHOOK_SECRET` is configured)  
**And** It MUST extract the Task ID and Status from the payload  
**And** It MUST return 200 OK immediately to ClickUp (NFR-P1 compliance).

### AC2: Idempotent Job Queuing
**Given** A webhook payload for a task  
**When** The system processes it  
**Then** It MUST idempotently queue a job for processing  
**And** It MUST ignore duplicate events within a short window (5 minutes)  
**And** It MUST NOT create multiple executions for the same task state.

### AC3: Status-Based Routing
**Given** A webhook with task status update  
**When** The status is "In Progress" AND assignee is "AI Agent" (or configured bot user)  
**Then** It MUST queue an AI execution job  
**And** It MUST normalize the payload to `ITaskEvent` format before queuing  
**And** It MUST include metadata: `triggerSource: 'WEBHOOK'`, `providerType: 'CLICKUP'`.

### AC4: Non-Actionable Status Filtering
**Given** A webhook with task status update  
**When** The status is "Done", "Blocked", or "Closed"  
**Then** It MUST acknowledge receipt (200 OK)  
**And** It MUST NOT queue an AI execution job  
**And** It MUST log the ignored event for audit purposes.

### AC5: Error Handling & Resilience
**Given** A webhook processing error occurs  
**When** Validation fails or queue is unavailable  
**Then** It MUST return appropriate HTTP error code (400 for validation, 500 for system errors)  
**And** It MUST log the error with correlation ID  
**And** Failed events SHOULD be retried via dead-letter queue pattern.

## Tasks / Subtasks

- [ ] Create Webhook Controller
  - [ ] Implement `POST /api/v1/webhooks/clickup` endpoint
  - [ ] Add signature validation middleware (HMAC-SHA256 if secret configured)
  - [ ] Extract task ID, status, and assignee from ClickUp payload
  - [ ] Return 200 OK immediately (fire-and-forget pattern)

- [ ] Implement Webhook Service
  - [ ] Create `WebhooksService.parseAndValidate()` method
  - [ ] Implement ClickUp payload to `ITaskEvent` mapping
  - [ ] Add status normalization (ClickUp status → internal status)
  - [ ] Add assignee bot detection logic

- [ ] Add Idempotency Protection
  - [ ] Implement deduplication cache (Redis/memory-store with TTL)
  - [ ] Generate unique key: `webhook:{taskId}:{status}:{timestamp_window}`
  - [ ] Skip processing if key exists in cache
  - [ ] Set TTL to 5 minutes for webhook deduplication

- [ ] Integrate with Ticket Intake Queue
  - [ ] Publish normalized `ITaskEvent` to `ticket-intake-queue`
  - [ ] Include all required fields: `externalId`, `providerType`, `internalStatus`, `title`, `description`, `triggerSource`
  - [ ] Add retry logic for queue publish failures

- [ ] Add Comprehensive Logging
  - [ ] Log all incoming webhooks (sanitized, no sensitive data)
  - [ ] Log queuing decisions (accepted/rejected with reason)
  - [ ] Add correlation ID for tracing webhook → execution flow
  - [ ] Structure logs as JSON for aggregation

- [ ] Write Unit & Integration Tests
  - [ ] Test signature validation (valid/invalid/missing secret)
  - [ ] Test idempotency (duplicate webhooks within window)
  - [ ] Test status filtering (actionable vs non-actionable)
  - [ ] Test error handling (malformed payload, queue failure)
  - [ ] Integration test: full webhook → queue flow

## Dev Notes

### Architecture Pattern
```
ClickUp Webhook → WebhookController → WebhooksService → Deduplication Check → ITaskEvent Normalization → RabbitMQ (ticket-intake-queue)
```

### Project Structure
```
src/
├── webhooks/
│   ├── webhooks.module.ts
│   ├── webhooks.controller.ts      # POST /api/v1/webhooks/clickup
│   ├── webhooks.service.ts         # Parse, validate, normalize
│   ├── dto/
│   │   ├── clickup-webhook.dto.ts  # ClickUp payload structure
│   │   └── task-event.dto.ts       # ITaskEvent interface
│   └── guards/
│       └── webhook-signature.guard.ts # HMAC validation
```

### Key Implementation Details

**1. ClickUp Webhook Payload Structure:**
```typescript
interface ClickUpWebhookPayload {
  event: 'taskStatusUpdated' | 'taskCreated' | 'taskUpdated';
  task_id: string;
  task: {
    id: string;
    name: string;
    description?: string;
    status: {
      status: string;  // e.g., "in progress", "done", "blocked"
    };
    assignees: Array<{ id: number; username: string }>;
    // ... other fields
  };
}
```

**2. ITaskEvent Interface (Normalized Format):**
```typescript
interface ITaskEvent {
  externalId: string;        // ClickUp task ID
  providerType: 'CLICKUP' | 'ASANA' | 'JIRA';
  internalStatus: 'AI_PROCESSING' | 'DONE' | 'BLOCKED' | 'BACKLOG';
  title: string;
  description?: string;
  triggerSource: 'SYNC' | 'WEBHOOK';
  receivedAt: Date;
  metadata?: Record<string, unknown>;
}
```

**3. Idempotency Key Generation:**
```typescript
const dedupKey = `webhook:${taskId}:${status}:${Math.floor(Date.now() / 300000)}`; // 5-min window
```

**4. Status Mapping Configuration:**
```typescript
const statusMapping: Record<string, string> = {
  'in progress': 'AI_PROCESSING',
  'ready for ai': 'AI_PROCESSING',
  'done': 'DONE',
  'closed': 'DONE',
  'blocked': 'BLOCKED',
  // ... configurable per project
};
```

**5. Bot User Detection:**
- Check if assignee username matches configured bot pattern (e.g., "AI Agent", "dsf-bot")
- OR check if task has a specific tag indicating AI processing

### Environment Variables Required
```bash
# Webhook Configuration
CLICKUP_WEBHOOK_SECRET=optional_secret_for_signature_validation

# Bot Identification
AI_AGENT_USERNAMES=AI Agent,dsf-bot,automation

# Status Mapping (JSON or comma-separated)
ACTIONABLE_STATUSES=in progress,ready for ai,ai processing
NON_ACTIONABLE_STATUSES=done,closed,blocked,cancelled

# Deduplication
WEBHOOK_DEDUP_TTL_MS=300000  # 5 minutes
```

### Error Handling Strategy

| Error Type | HTTP Response | Action | Logging |
|------------|--------------|--------|---------|
| Invalid signature | 401 Unauthorized | Reject, no retry | ERROR level |
| Malformed payload | 400 Bad Request | Reject, no retry | WARN level |
| Queue unavailable | 503 Service Unavailable | Retry with backoff | ERROR level |
| Non-actionable status | 200 OK | Acknowledge, skip | DEBUG level |
| Duplicate webhook | 200 OK | Acknowledge, skip | DEBUG level |

### Performance Requirements (NFR-P1)
- Webhook response time: < 500ms (p95)
- End-to-end processing: < 5 seconds (async)
- Use fire-and-forget: Return 200 immediately, process async

### Testing Strategy

**Unit Tests:**
- Mock ClickUp payloads for different event types
- Test signature validation with known good/bad signatures
- Test idempotency with time-based window logic

**Integration Tests:**
- Use RabbitMQ test container
- Verify message published to queue with correct format
- Test end-to-end flow with real ClickUp payload samples

### Dependencies
- `@nestjs/platform-express` - Controller decorators
- `@nestjs/microservices` - RabbitMQ client
- `crypto` - HMAC-SHA256 signature validation
- `class-validator` - DTO validation
- Existing `TicketIntakeModule` - Queue publishing

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 20: AI Task Pickup Reliability]
- [Source: _bmad-output/planning-artifacts/architecture.md#FR Category to Architecture Mapping - FR56-59]
- [Source: _bmad-output/planning-artifacts/prd.md#FR56-59 Webhook & Task Intake]
- [Source: src/webhooks/ - Architecture folder structure]

### Related Stories
- Story 20.2: Unified Intake Status Check (shared status evaluation logic)
- Story 20.3: Prevent Duplicate Executions (database-level deduplication)
- Story 2-1: ClickUp Webhook Endpoint (legacy webhook implementation - review for patterns)

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
