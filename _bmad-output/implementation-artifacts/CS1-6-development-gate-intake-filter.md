# Story CS1.6: Development Gate — Task Intake Filter

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **PM**,
I want DSF to only pull tasks into the development queue when they reach the status I configured as the AI trigger,
so that backlog tasks, in-progress human work, and completed tasks are never accidentally sent for AI development.

## Acceptance Criteria

### AC1 — Webhook path: gate blocks non-matching status tasks

**Given** a task event arrives via the `PmWebhookRouterService`
**When** the service resolves the `ProjectIntegration` (by `webhook_id`, already done for HMAC verification)
**And** the parsed body contains a task status
**Then** the service calls `DevelopmentGateService.check(taskId, taskStatus, integration, 'webhook', correlationId)`
**And** if the gate returns `allowed: false`, the method returns immediately — `WebhooksService.processWebhook()` is NOT called
**And** if the gate returns `allowed: true`, `WebhooksService.processWebhook()` is called as before

### AC2 — Polling path: gate blocks non-matching status tasks per task

**Given** `PmPollingOrchestrator.pollDueIntegrations()` fetches a batch of updated tasks
**When** it iterates over each task
**Then** before building `rawEvent` and publishing to queue, it calls `DevelopmentGateService.check(task.id, task.status.name, integration, 'polling', correlationId)`
**And** if the gate returns `allowed: false`, the task is skipped (no publish) — loop continues to next task
**And** if the gate returns `allowed: true`, the task is published as before

### AC3 — ai_trigger_status null/unset: all tasks discarded with warn

**Given** `ProjectIntegration.ai_trigger_status` is null or empty string for a project
**When** `DevelopmentGateService.check()` is called for any task
**Then** a `warn` log is emitted: `"[{correlationId}] CS1-6: project {project_id} integration has no ai_trigger_status configured — all tasks skipped. PM must set the trigger status in project settings"`
**And** the `pm_tasks_dropped_no_trigger_total` Prometheus counter is incremented (labels: `provider`, `project_id`)
**And** `{ allowed: false, reason: 'trigger_not_configured' }` is returned

### AC4 — Status mismatch: task silently discarded with debug log

**Given** `ProjectIntegration.ai_trigger_status` is set (e.g., `"Ready for Development"`)
**When** a task arrives with a different status (e.g., `"In Progress"`, `"backlog"`)
**Then** a `debug` log is emitted: `"[{correlationId}] CS1-6: task {taskId} status '{taskStatus}' — not at trigger '{ai_trigger_status}', skipping"`
**And** no error is thrown, no retry, no DB write
**And** if source is `'polling'`, the `pm_polling_tasks_skipped_total` counter is incremented (labels: `provider`, `project_id`)
**And** `{ allowed: false, reason: 'status_mismatch' }` is returned

### AC5 — Status match: task passes the gate (case-insensitive)

**Given** `ProjectIntegration.ai_trigger_status` is `"Ready for Dev"` (any casing)
**When** a task arrives with status `"ready for dev"` or `"READY FOR DEV"` or `"Ready for Dev"`
**Then** the comparison is case-insensitive
**And** `{ allowed: true, reason: 'allowed' }` is returned
**And** the task proceeds to the development queue

### AC6 — Deduplication: duplicate events discarded silently

**Given** a task is already in active execution in DSF (Execution with `status IN ['QUEUED', 'IN_PROGRESS']` for this task)
**When** a duplicate event arrives for the same task at the trigger status
**Then** `TicketIntakeService.processNormalizedTaskEvent()` (existing `checkActiveExecution()`) handles this deduplication
**And** the duplicate is discarded silently — this is the existing `(taskId, provider)` dedup behavior

### AC7 — StatusEvaluationService stub updated: gate is now upstream

**Given** the CS1-6 gate is applied in `PmWebhookRouterService` before `WebhooksService.processWebhook()`
**When** `WebhooksService.processWebhook()` is called (task has already passed the gate)
**Then** `StatusEvaluationService.evaluateStatus()` returns `{ isActionable: true, internalStatus: 'QUEUED', reason: 'ai_trigger_status gate passed upstream (CS1-6)' }`
**And** the legacy stub that returned `isActionable: false` is removed
**And** all existing tests in `webhooks.service.spec.ts` that expected `isActionable: false` are updated

### AC8 — Unit tests for DevelopmentGateService

- New file: `src/ticket-intake/services/development-gate.service.spec.ts`
- Test cases:
  1. `ai_trigger_status` null → `allowed: false`, reason `'trigger_not_configured'`, warn logged, counter incremented
  2. `ai_trigger_status` empty string → same as null
  3. Status mismatch (polling) → `allowed: false`, reason `'status_mismatch'`, debug logged, `pm_polling_tasks_skipped_total` incremented
  4. Status mismatch (webhook) → `allowed: false`, reason `'status_mismatch'`, debug logged, polling counter NOT incremented
  5. Status match (exact case) → `allowed: true`
  6. Status match (case-insensitive, different casing) → `allowed: true`
  7. Status match (leading/trailing whitespace trimmed) → `allowed: true`

### AC9 — Unit tests for PmWebhookRouterService gate integration

- File: `src/integrations/webhook/pm-webhook-router.service.spec.ts` — MODIFY
- Add `DevelopmentGateService` mock to test module with **default `allowed: true`** so ALL existing tests continue passing:
  ```typescript
  { provide: DevelopmentGateService, useValue: { check: jest.fn().mockReturnValue({ allowed: true, reason: 'allowed' }) } }
  ```
  **⚠️ CRITICAL**: Using bare `jest.fn()` (no return value) would make `gateDecision.allowed` undefined (falsy) → existing test 6 ("calls processWebhook when all guards pass") would break silently.
- Test cases to add:
  1. Gate returns `allowed: false` → `processWebhook` NOT called; override mock for this test only: `developmentGate.check.mockReturnValue({ allowed: false, reason: 'status_mismatch' })`
  2. Gate returns `allowed: true` (default) → `processWebhook` IS called — verified by the existing test 6 (no additional test needed; confirm it still passes)
  3. Payload missing `task.status` → `taskStatus` resolves to `''`; gate runs normally with `taskId = body.task_id ?? 'unknown'`; no special bypass logic — gate decides based on `ai_trigger_status`

### AC10 — Unit tests for PmPollingOrchestrator gate integration

- File: `src/integrations/polling/pm-polling-orchestrator.service.spec.ts` — MODIFY
- Add `DevelopmentGateService` mock with **default `allowed: true`** so ALL existing tests continue passing:
  ```typescript
  { provide: DevelopmentGateService, useValue: { check: jest.fn().mockReturnValue({ allowed: true, reason: 'allowed' }) } }
  ```
  **⚠️ CRITICAL**: Same reason as AC9 — bare `jest.fn()` breaks test 4 ("publishes correct ITaskEvent with triggerSource POLLING") because `continue` fires for every task.
- Test cases to add:
  1. Gate blocks all tasks: override `gate.check.mockReturnValue({ allowed: false, reason: 'status_mismatch' })` → `rabbitmq.publishToQueue` NOT called
  2. Gate allows some tasks: `gate.check.mockReturnValueOnce({ allowed: true, ... }).mockReturnValueOnce({ allowed: false, ... })` with two tasks → `publishToQueue` called exactly once
  3. Gate blocks (no trigger configured): `gate.check.mockReturnValue({ allowed: false, reason: 'trigger_not_configured' })` → `publishToQueue` NOT called; metrics counter incremented in `DevelopmentGateService` (verified by the gate service unit tests, not here)
- Use `makeTask({ status: { id: '1', name: 'Ready for Dev', color: null, type: 'custom' } })` for clarity in gate tests

### AC11 — TypeScript clean

- `pnpm typecheck` — zero errors
- `pnpm lint` — zero warnings/errors
- `pnpm test` — all pass (including updated `webhooks.service.spec.ts` expectations)

---

## Tasks / Subtasks

- [ ] Task 1: Create `DevelopmentGateService` (AC3–AC6)
  - [ ] Create `src/ticket-intake/services/development-gate.service.ts`
  - [ ] Inject `LoggerService` and `MetricsService`
  - [ ] Implement `check(taskId, taskStatus, integration, source, correlationId): DevelopmentGateDecision` (sync method)
  - [ ] Handle null/empty `ai_trigger_status` → warn log + `pm_tasks_dropped_no_trigger_total` counter
  - [ ] Handle status mismatch → debug log + `pm_polling_tasks_skipped_total` counter (if source === 'polling')
  - [ ] Handle status match (case-insensitive, trimmed) → return `{ allowed: true }`

- [ ] Task 2: Create `DevelopmentGateModule` (lightweight wrapper)
  - [ ] Create `src/ticket-intake/services/development-gate.module.ts`
  - [ ] Imports: `AppMetricsModule`, `LoggerModule`
  - [ ] Providers + Exports: `DevelopmentGateService`

- [ ] Task 3: Apply gate in `PmWebhookRouterService` (AC1)
  - [ ] Import `DevelopmentGateService` in `pm-webhook-router.service.ts`
  - [ ] Add `DevelopmentGateService` to constructor
  - [ ] Extract `taskId = body.task_id` and `taskStatus = body.task?.status?.status ?? ''` from parsed body
  - [ ] Call `this.developmentGate.check(taskId, taskStatus, integration, 'webhook', correlationId)` before `webhooksService.processWebhook()`
  - [ ] If not allowed → return early (no call to `processWebhook`)

- [ ] Task 4: Add `DevelopmentGateModule` to `PmWebhookModule` (AC1)
  - [ ] File: `src/integrations/webhook/pm-webhook.module.ts`
  - [ ] Add `DevelopmentGateModule` to `imports` array

- [ ] Task 5: Apply gate in `PmPollingOrchestrator` (AC2)
  - [ ] Import `DevelopmentGateService` in `pm-polling-orchestrator.service.ts`
  - [ ] Add `DevelopmentGateService` to constructor
  - [ ] Before building `rawEvent` in the task loop, call `this.developmentGate.check(task.id, task.status.name, integration, 'polling', messageId)`
  - [ ] If not allowed → `continue` to next task (skip `rawEvent` + `taskEvent` + `publishToQueue`)

- [ ] Task 6: Add `DevelopmentGateModule` to `PmPollingModule` (AC2)
  - [ ] File: `src/integrations/polling/pm-polling.module.ts`
  - [ ] Add `DevelopmentGateModule` to `imports` array

- [ ] Task 7: Update `StatusEvaluationService.evaluateStatus()` stub and its spec (AC7)
  - [ ] File: `src/ticket-intake/services/status-evaluation.service.ts`
  - [ ] Change return value: `isActionable: true`, `reason: 'ai_trigger_status gate passed upstream (CS1-6)'`
  - [ ] Remove the CS1-3 comment about "pending ai_trigger_status gate"
  - [ ] File: `src/ticket-intake/services/status-evaluation.service.spec.ts` — MODIFY
  - [ ] Test "should always return non-actionable QUEUED result (legacy stub)": change `expect(result.isActionable).toBe(false)` → `.toBe(true)` and `expect(result.reason).toContain('legacy status evaluation removed')` → `.toContain('CS1-6')`
  - [ ] Update test name to reflect new behavior: `'should always return actionable QUEUED result (gate upstream CS1-6)'`
  - [ ] Test "should handle different provider types with same stub result": change `expect(result.isActionable).toBe(false)` → `.toBe(true)`

- [ ] Task 8: Update `webhooks.service.spec.ts` — 7 tests need rewriting (AC7)
  - [ ] Update `beforeEach` mock: `evaluateStatus: jest.fn().mockReturnValue({ isActionable: true, internalStatus: 'QUEUED', reason: 'ai_trigger_status gate passed upstream (CS1-6)' })`
  - [ ] Also add `mockRabbitMQ.publishToQueue.mockResolvedValue(undefined)` to `beforeEach` (already set globally but confirm it's clear)
  - [ ] **Test 1** (line ~143) "should process valid webhook but NOT queue": rename to "should process valid webhook and queue to ticket-intake"; change `expect(result.willProcess).toBe(false)` → `.toBe(true)`; add `expect(mockRabbitMQ.publishToQueue).toHaveBeenCalledWith(QUEUE_NAMES.TICKET_INTAKE, expect.any(Object), expect.any(Object))`
  - [ ] **Test 3** (line ~170) "should not queue any webhook (all statuses gated by CS1-3)": this test is now obsolete — **delete it** (its intent is covered by the dedup and event-type filter tests)
  - [ ] **Test 5** (line ~195) "should process taskUpdated events (but not queue — gated pending CS1-3)": rename "should process taskUpdated events and queue"; change `willProcess: false` → `true`; add `publishToQueue` called assertion
  - [ ] **Test 6** (line ~208) "should return correct correlationId and not publish": rename "should return correct correlationId and publish"; change `willProcess: false` → `true`; change `publishToQueue` not called → called
  - [ ] **Test 7** (line ~232) "should return gated result without publishing for any event (CS1-1)": **delete** — identical intent to Test 1 after the update; duplicated
  - [ ] **Test 8** (line ~243) "should accept payloads with custom fields without error (gated, not published)": rename "should accept payloads with custom fields and queue"; change `willProcess: false` → `true`; add `publishToQueue` called
  - [ ] **Test 9** (line ~271) "should handle audit logging failures gracefully": keep `willProcess: false` only if audit failure aborts processing — verify behaviour; if processing continues despite audit fail, change to `willProcess: true`
  - [ ] Successful `processWebhook()` response shape (for assertions): `{ success: true, correlationId: string, message: 'Webhook received and queued', willProcess: true }`
  - [ ] Ensure all non-actionable-path tests (dedup, event type filter, error DLQ) are untouched and still pass

- [ ] Task 9: Write unit tests for `DevelopmentGateService` (AC8)
  - [ ] Create `src/ticket-intake/services/development-gate.service.spec.ts`
  - [ ] All 7 test cases as listed in AC8

- [ ] Task 10: Update `PmWebhookRouterService` spec (AC9)
  - [ ] Add `DevelopmentGateService` mock
  - [ ] Add 3 gate test cases as listed in AC9

- [ ] Task 11: Update `PmPollingOrchestrator` spec (AC10)
  - [ ] Add `DevelopmentGateService` mock
  - [ ] Add gate test cases as listed in AC10

- [ ] Task 12: Verify build (AC11)
  - [ ] `pnpm typecheck` — zero errors
  - [ ] `pnpm lint` — zero warnings/errors
  - [ ] `pnpm test` — all pass

---

## Dev Notes

### Dependency Context

CS1-6 depends on:

- **CS0-1 (done)**: `ProjectIntegration` model with `ai_trigger_status String?` field — already in schema at `prisma/schema.prisma:1278`
- **CS0-8 (done)**: `PmPollingOrchestrator` that iterates tasks — already exists at `src/integrations/polling/pm-polling-orchestrator.service.ts`
- **CS0-9 (done)**: `PmWebhookRouterService` that resolves integration — already exists at `src/integrations/webhook/pm-webhook-router.service.ts`
- **CS1-1 (done)**: Removed hardcoded status maps; `StatusEvaluationService.evaluateStatus()` stubbed to `isActionable: false`

CS1-6 is **independent** of:

- CS1-2 (StatusDiscoveryService) — no interaction
- CS1-3 (ai_trigger_status API) — CS1-6 uses the field, CS1-3 adds the PATCH endpoint; they can be developed in parallel
- CS1-4 (live status picker UI) — frontend only
- CS1-5 (bot assignment) — CS1-5 runs AFTER the task reaches AI processing; CS1-6 runs BEFORE

### `DevelopmentGateService` Full Implementation

```typescript
// src/ticket-intake/services/development-gate.service.ts

import { Injectable } from '@nestjs/common';
import { MetricsService } from '../../common/metrics/metrics.service';
import { LoggerService } from '../../common/logger/logger.service';

export interface DevelopmentGateDecision {
  allowed: boolean;
  reason: 'allowed' | 'trigger_not_configured' | 'status_mismatch';
}

interface GateIntegration {
  ai_trigger_status: string | null;
  provider: string;
  project_id: string;
}

@Injectable()
export class DevelopmentGateService {
  constructor(
    private readonly metrics: MetricsService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * FR-CS20: Development gate — compare task status against ai_trigger_status.
   * Sync method — no DB calls needed (integration is already resolved at both call sites).
   *
   * @param taskId     - External task ID (for logging)
   * @param taskStatus - Raw status string from PM provider
   * @param integration - Resolved ProjectIntegration (partial — only fields needed)
   * @param source     - 'webhook' | 'polling' (affects which counter is incremented on mismatch)
   * @param correlationId - For structured logging
   */
  check(
    taskId: string,
    taskStatus: string,
    integration: GateIntegration,
    source: 'webhook' | 'polling',
    correlationId: string,
  ): DevelopmentGateDecision {
    const { ai_trigger_status, provider, project_id } = integration;

    // AC3: Null/empty trigger status — discard all tasks with warn
    if (!ai_trigger_status || ai_trigger_status.trim() === '') {
      this.logger.warn(
        `[${correlationId}] CS1-6: project ${project_id} integration has no ai_trigger_status configured — all tasks skipped. PM must set the trigger status in project settings`,
        { taskId, provider, project_id, source },
      );
      this.metrics.incrementCounter('pm_tasks_dropped_no_trigger_total', { provider, project_id });
      return { allowed: false, reason: 'trigger_not_configured' };
    }

    // AC4/AC5: Case-insensitive, trimmed comparison
    const normalizedTaskStatus = taskStatus.trim().toLowerCase();
    const normalizedTrigger = ai_trigger_status.trim().toLowerCase();

    if (normalizedTaskStatus !== normalizedTrigger) {
      this.logger.debug(
        `[${correlationId}] CS1-6: task ${taskId} status '${taskStatus}' — not at trigger '${ai_trigger_status}', skipping`,
        { taskId, taskStatus, ai_trigger_status, provider, source },
      );
      if (source === 'polling') {
        this.metrics.incrementCounter('pm_polling_tasks_skipped_total', { provider, project_id });
      }
      return { allowed: false, reason: 'status_mismatch' };
    }

    // Gate passed
    return { allowed: true, reason: 'allowed' };
  }
}
```

### `DevelopmentGateModule` Implementation

```typescript
// src/ticket-intake/services/development-gate.module.ts

import { Module } from '@nestjs/common';
import { DevelopmentGateService } from './development-gate.service';
import { AppMetricsModule } from '@/common/metrics';
import { LoggerModule } from '@/common/logger';

@Module({
  imports: [AppMetricsModule, LoggerModule],
  providers: [DevelopmentGateService],
  exports: [DevelopmentGateService],
})
export class DevelopmentGateModule {}
```

**Import path note**: Use `@/` aliases, not relative paths — consistent with `pm-polling.module.ts` which uses `import { LoggerModule } from '@/common/logger'`. The `DevelopmentGateService` itself uses relative imports (same as `BotAssignmentService` — either `@/` or relative works; pick one style and stick to it, prefer `@/` for cross-directory imports).

### Changes to `PmWebhookRouterService`

The gate is applied at **Step 2.5** — after finding the integration and verifying the signature, before calling `webhooksService.processWebhook()`.

**Constructor addition:**

```typescript
constructor(
  private readonly projectIntegrationService: ProjectIntegrationService,
  private readonly webhooksService: WebhooksService,
  private readonly logger: LoggerService,
  private readonly developmentGate: DevelopmentGateService,  // CS1-6 NEW
  @InjectMetric('pm_webhook_invalid_signature_total')
  private readonly invalidSignatureCounter: Counter,
) {}
```

**Gate insertion in `handleWebhook()`** — after `integration.webhook_enabled` check, before `webhooksService.processWebhook()`. Parse `rawBody` **once** into `parsedBody` and reuse for both the gate and the `processWebhook` call (replaces the existing `JSON.parse(rawBody)` call at line 70):

```typescript
// Step 2.5: CS1-6 Development Gate — check ai_trigger_status
// Parse once — reused for gate AND passed to processWebhook below (replaces JSON.parse at line 70)
const parsedBody = JSON.parse(rawBody) as Record<string, unknown>;
const taskId = typeof parsedBody['task_id'] === 'string' ? parsedBody['task_id'] : 'unknown';
const taskStatusRaw = (parsedBody['task'] as Record<string, unknown> | undefined)?.['status'];
const taskStatus =
  typeof taskStatusRaw === 'object' && taskStatusRaw !== null
    ? ((taskStatusRaw as Record<string, unknown>)['status'] as string) ?? ''
    : '';

const gateDecision = this.developmentGate.check(taskId, taskStatus, integration, 'webhook', correlationId);
if (!gateDecision.allowed) {
  return; // silently discard — no error, no retry
}

// Step 3: Route to existing WebhooksService — pass parsedBody (already parsed above)
try {
  await this.webhooksService.processWebhook(parsedBody as IClickUpWebhookPayload, correlationId);
```

**`IClickUpWebhookPayload` import**: already imported in `pm-webhook-router.service.ts`? Check — if not, add `import { IClickUpWebhookPayload } from '@/webhooks/interfaces'`. The cast is safe since `rawBody` passed HMAC verification and `extractWebhookId()` parsed it successfully.

**Existing test assertion** at `pm-webhook-router.service.spec.ts:144` checks:

```typescript
expect(webhooksService.processWebhook).toHaveBeenCalledWith(validBody, correlationId);
```

`JSON.parse(JSON.stringify(validBody))` deep-equals `validBody` by value, so this assertion still passes with `parsedBody`. ✓

### Changes to `PmPollingOrchestrator`

Gate is applied **inside the task loop**, before `rawEvent` construction:

```typescript
for (const task of tasks) {
  const messageId = `polling-${integration.id}-${task.id}-${Date.now()}`;

  // CS1-6: Development gate — only tasks at trigger status enter the dev queue
  const gateDecision = this.developmentGate.check(
    task.id,
    task.status.name,
    integration,
    'polling',
    messageId,
  );
  if (!gateDecision.allowed) {
    continue; // silently skip this task
  }

  // Build IRawTaskEvent (unchanged from here)
  const rawEvent: IRawTaskEvent = { ... };
  ...
}
```

**Constructor addition:**

```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly integrationService: ProjectIntegrationService,
  private readonly providerFactory: PMProviderFactory,
  private readonly rabbitmq: RabbitMQService,
  private readonly metrics: MetricsService,
  private readonly sentry: SentryService,
  private readonly logger: LoggerService,
  private readonly developmentGate: DevelopmentGateService,  // CS1-6 NEW
) {}
```

**Note**: `integration` at the gate call site is the **decrypted** integration (returned from `integrationService.getDecryptedIntegration(raw.id)`). It has all fields including `ai_trigger_status`.

### Updated `StatusEvaluationService.evaluateStatus()`

```typescript
evaluateStatus(
  providerStatus: string,
  _providerType: TaskProviderType = TaskProviderType.CLICKUP,
): StatusEvaluationResult {
  // CS1-6: Gate is now applied upstream in PmWebhookRouterService.
  // Tasks reaching this point have already passed ai_trigger_status check.
  return {
    isActionable: true,
    internalStatus: 'QUEUED',
    reason: 'ai_trigger_status gate passed upstream (CS1-6)',
  };
}
```

### Updated `webhooks.service.spec.ts` expectations

The `beforeEach` mock in `webhooks.service.spec.ts` currently sets:

```typescript
evaluateStatus: jest.fn().mockReturnValue({
  isActionable: false,
  internalStatus: 'QUEUED',
  reason: 'legacy status evaluation removed — pending CS1-3 ai_trigger_status gate',
});
```

This must be updated to:

```typescript
evaluateStatus: jest.fn().mockReturnValue({
  isActionable: true,
  internalStatus: 'QUEUED',
  reason: 'ai_trigger_status gate passed upstream (CS1-6)',
});
```

**`WebhookResponseDto` shape for spec assertions** — when `isActionable: true` and task successfully queued, `processWebhook()` returns:

```typescript
{ success: true, correlationId: string, message: 'Webhook received and queued', willProcess: true }
```

When filtered (dedup, event type, etc.): `{ success: true/false, correlationId, message: string, willProcess: false }`.

**Ripple effect — 7 tests in `webhooks.service.spec.ts` need updating** (detailed in Task 8 above):

- Tests expecting `willProcess: false` + `publishToQueue` not called → change to `willProcess: true` + `publishToQueue` called with `QUEUE_NAMES.TICKET_INTAKE`
- 2 duplicate/redundant tests can be deleted
- Dedup tests, event-type filter tests, error/DLQ tests are **unaffected** — they return early before the status check

### `DevelopmentGateService` Unit Tests

```typescript
// src/ticket-intake/services/development-gate.service.spec.ts

describe('DevelopmentGateService', () => {
  let service: DevelopmentGateService;
  let metrics: jest.Mocked<MetricsService>;
  let logger: jest.Mocked<LoggerService>;

  const baseIntegration = {
    ai_trigger_status: 'Ready for Dev',
    provider: 'CLICKUP',
    project_id: 'proj-uuid',
  };

  beforeEach(async () => {
    metrics = { incrementCounter: jest.fn() } as any;
    logger = { debug: jest.fn(), warn: jest.fn(), log: jest.fn(), error: jest.fn() } as any;

    const module = await Test.createTestingModule({
      providers: [
        DevelopmentGateService,
        { provide: MetricsService, useValue: metrics },
        { provide: LoggerService, useValue: logger },
      ],
    }).compile();

    service = module.get(DevelopmentGateService);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns trigger_not_configured when ai_trigger_status is null', () => {
    const result = service.check(
      'task-1',
      'Ready for Dev',
      { ...baseIntegration, ai_trigger_status: null },
      'polling',
      'corr-1',
    );
    expect(result).toEqual({ allowed: false, reason: 'trigger_not_configured' });
    expect(logger.warn).toHaveBeenCalled();
    expect(metrics.incrementCounter).toHaveBeenCalledWith('pm_tasks_dropped_no_trigger_total', {
      provider: 'CLICKUP',
      project_id: 'proj-uuid',
    });
  });

  it('returns trigger_not_configured when ai_trigger_status is empty string', () => {
    const result = service.check(
      'task-1',
      'Ready for Dev',
      { ...baseIntegration, ai_trigger_status: '' },
      'polling',
      'corr-1',
    );
    expect(result).toEqual({ allowed: false, reason: 'trigger_not_configured' });
  });

  it('returns status_mismatch and increments polling counter when source is polling', () => {
    const result = service.check('task-1', 'In Progress', baseIntegration, 'polling', 'corr-1');
    expect(result).toEqual({ allowed: false, reason: 'status_mismatch' });
    expect(logger.debug).toHaveBeenCalled();
    expect(metrics.incrementCounter).toHaveBeenCalledWith('pm_polling_tasks_skipped_total', {
      provider: 'CLICKUP',
      project_id: 'proj-uuid',
    });
  });

  it('returns status_mismatch but does NOT increment polling counter when source is webhook', () => {
    const result = service.check('task-1', 'In Progress', baseIntegration, 'webhook', 'corr-1');
    expect(result).toEqual({ allowed: false, reason: 'status_mismatch' });
    expect(metrics.incrementCounter).not.toHaveBeenCalled();
  });

  it('returns allowed when status matches exactly', () => {
    const result = service.check('task-1', 'Ready for Dev', baseIntegration, 'webhook', 'corr-1');
    expect(result).toEqual({ allowed: true, reason: 'allowed' });
    expect(metrics.incrementCounter).not.toHaveBeenCalled();
  });

  it('returns allowed when status matches case-insensitively', () => {
    const result = service.check('task-1', 'READY FOR DEV', baseIntegration, 'webhook', 'corr-1');
    expect(result).toEqual({ allowed: true, reason: 'allowed' });
  });

  it('returns allowed when status matches after trimming whitespace', () => {
    const result = service.check(
      'task-1',
      '  Ready for Dev  ',
      baseIntegration,
      'webhook',
      'corr-1',
    );
    expect(result).toEqual({ allowed: true, reason: 'allowed' });
  });
});
```

### Webhook Body Structure for Status Extraction

ClickUp webhook payload structure (from `IClickUpWebhookPayload` at `src/webhooks/interfaces/`):

```typescript
{
  webhook_id: string;   // Used for integration lookup
  event: string;        // e.g., 'taskStatusUpdated'
  task_id: string;      // External task ID
  task?: {
    status?: {
      status: string;   // The raw status string — THIS is what we compare
    }
  }
}
```

In `PmWebhookRouterService`, `rawBody` is already parsed once in `extractWebhookId()`. To avoid triple parsing, introduce `parsedBody` variable early in `handleWebhook()`:

- Parse once → use for both `extractWebhookId()` call AND gate check AND `webhooksService.processWebhook()`
- Refactor `extractWebhookId()` to accept `Record<string, unknown>` instead of re-parsing internally (optional optimization, not required)

If refactoring is deemed too risky (it changes the signature of a private method with tests), just parse the body a second time for the gate check — it's acceptable since the body is small.

### Module Import Chain (Circular Dependency Check)

**`DevelopmentGateModule` imports:**

- `AppMetricsModule` (no circular risk — a leaf module)
- `LoggerModule` (no circular risk — a leaf module)

**`PmWebhookModule` new import: `DevelopmentGateModule`**

- `PmWebhookModule` currently imports: `IntegrationsModule`, `WebhooksModule`
- `DevelopmentGateModule` does NOT import `WebhooksModule` or `IntegrationsModule` → no circular dep

**`PmPollingModule` new import: `DevelopmentGateModule`**

- `PmPollingModule` currently imports: `IntegrationsModule`, `DatabaseModule`, `RabbitMQModule`, `LoggerModule`, `AppMetricsModule`, `SentryModule`
- `DevelopmentGateModule` only imports `AppMetricsModule` + `LoggerModule` (already in `PmPollingModule`) → NestJS deduplicates → no issue

### Prometheus Counter Names

Two new counters in CS1-6:

1. `pm_tasks_dropped_no_trigger_total` — labels: `provider`, `project_id`
   - Incremented when `ai_trigger_status` is null/empty
   - Both webhook and polling paths
2. `pm_polling_tasks_skipped_total` — labels: `provider`, `project_id`
   - Incremented when task status does NOT match `ai_trigger_status`
   - Polling path only

Both use `MetricsService.incrementCounter()` (generic auto-registering counter method at `src/common/metrics/metrics.service.ts:209`). No `makeCounterProvider()` registration needed.

### Previous Story Intelligence (from CS1-5)

CS1-5 (`BotAssignmentService`) established these patterns for CS1-6:

- **Error handling**: Errors in integration-aware services are caught, logged, and captured in Sentry — never rethrown (don't block the main flow)
- **`SentryModule` must be explicitly imported** by modules that use `SentryService` (it's NOT global). `DevelopmentGateService` does NOT use `SentryService` (it's not needed for pure gate logic), so this is not a concern here.
- **`findFirstByProject()` pattern** on `ProjectIntegrationService` was added in CS1-5 for projects with `bot_user_id`. CS1-6 does NOT need this — the integration is already resolved at both call sites.
- **`IntegrationsModule` import pattern**: CS1-5 added `IntegrationsModule` to `ExecutionModule`. CS1-6 adds `DevelopmentGateModule` to `PmWebhookModule` and `PmPollingModule` instead.

### Git Intelligence (Recent Commits)

From recent commits:

1. `fa78c1c` — "refactor: remove hardcoded status maps and env-var configurations" (CS1-1) — confirms that `StatusEvaluationService.evaluateStatus()` was stubbed to `isActionable: false`. CS1-6 updates this stub.
2. `cd8480d` — "feat: implement provider-agnostic webhook handling via `PmWebhookModule`" (CS0-9) — established `PmWebhookRouterService` as the primary webhook processing path. CS1-6 inserts the gate here.
3. `81ea737` — "feat: implement `PmPollingOrchestrator` and provider-agnostic polling" (CS0-8) — established the polling loop. CS1-6 inserts the gate per-task.

### Project Structure Notes

| File                                                               | Change Type | Notes                                                           |
| ------------------------------------------------------------------ | ----------- | --------------------------------------------------------------- |
| `src/ticket-intake/services/development-gate.service.ts`           | NEW         | Core gate logic (FR-CS20)                                       |
| `src/ticket-intake/services/development-gate.module.ts`            | NEW         | Lightweight NestJS module                                       |
| `src/ticket-intake/services/development-gate.service.spec.ts`      | NEW         | 7 unit tests                                                    |
| `src/integrations/webhook/pm-webhook-router.service.ts`            | MODIFY      | Inject gate + apply before processWebhook()                     |
| `src/integrations/webhook/pm-webhook.module.ts`                    | MODIFY      | Add DevelopmentGateModule to imports                            |
| `src/integrations/webhook/pm-webhook-router.service.spec.ts`       | MODIFY      | Add DevelopmentGateService mock + 3 tests                       |
| `src/integrations/polling/pm-polling-orchestrator.service.ts`      | MODIFY      | Inject gate + apply per-task in loop                            |
| `src/integrations/polling/pm-polling.module.ts`                    | MODIFY      | Add DevelopmentGateModule to imports                            |
| `src/integrations/polling/pm-polling-orchestrator.service.spec.ts` | MODIFY      | Add DevelopmentGateService mock + 3 tests                       |
| `src/ticket-intake/services/status-evaluation.service.ts`          | MODIFY      | Update stub: isActionable: true (gate now upstream)             |
| `src/ticket-intake/services/status-evaluation.service.spec.ts`     | MODIFY      | Update 2 tests: isActionable false→true, reason string updated  |
| `src/webhooks/webhooks.service.spec.ts`                            | MODIFY      | Update evaluateStatus mock + rewrite 7 gated tests (see Task 8) |

**Do NOT touch:**

- `prisma/schema.prisma` — `ai_trigger_status String?` already on `ProjectIntegration` (from CS0-1)
- `src/integrations/project-integration.service.ts` — no new methods needed (integration already resolved at call sites)
- `src/ticket-intake/ticket-intake.service.ts` — `checkActiveExecution()` already handles `(taskId, provider)` dedup; no changes needed
- `src/webhooks/webhooks.service.ts` — the status evaluation block (lines 193–224) remains; stub now returns `isActionable: true`
- `src/webhooks/webhooks.controller.ts` — **KNOWN BYPASS: intentionally NOT gated in CS1-6.** This legacy `POST /api/v1/webhooks/clickup` endpoint calls `webhooksService.processWebhook()` directly without going through `PmWebhookRouterService`. After CS1-6 sets `evaluateStatus()` to `isActionable: true`, webhooks arriving at this legacy endpoint bypass the `ai_trigger_status` gate. This is acceptable for CS1-6 scope — the PM-integrated webhook path via `PmWebhookRouterService` is the authoritative path (CS0-9). The legacy endpoint is guarded by `WebhookSignatureGuard` (HMAC) but NOT by `ai_trigger_status`. **Do NOT add the gate here** — that is out of scope for this story. Document as a known limitation if needed.

### References

- FR-CS20: Development gate requirement [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #FR-CS20]
- Story 1.6 acceptance criteria (BDD) [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #Story 1.6]
- `ProjectIntegration.ai_trigger_status` schema field [Source: `prisma/schema.prisma:1278`]
- `PmWebhookRouterService.handleWebhook()` [Source: `src/integrations/webhook/pm-webhook-router.service.ts:20`]
- `PmPollingOrchestrator.pollDueIntegrations()` [Source: `src/integrations/polling/pm-polling-orchestrator.service.ts:32`]
- `StatusEvaluationService.evaluateStatus()` stub [Source: `src/ticket-intake/services/status-evaluation.service.ts:52-61`]
- `MetricsService.incrementCounter()` generic method [Source: `src/common/metrics/metrics.service.ts:209`]
- `WebhooksService.processWebhook()` status evaluation block [Source: `src/webhooks/webhooks.service.ts:193-224`]
- `webhooks.service.spec.ts` evaluateStatus mock [Source: `src/webhooks/webhooks.service.spec.ts:131-135`]
- Sprint status entry [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml` #CS1-6-development-gate-intake-filter]

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
