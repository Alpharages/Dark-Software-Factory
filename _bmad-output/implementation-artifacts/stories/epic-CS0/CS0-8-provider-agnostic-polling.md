# Story CS0.8: Provider-Agnostic Polling Orchestrator

Status: ready-for-dev

## Story

As the **DSF system**,
I want the polling orchestrator to work across any connected PM tool,
so that ClickUp, Jira, and Asana tasks are all polled through the same pipeline without any provider-specific code in the scheduler.

## Acceptance Criteria

### AC1 — Provider-agnostic polling loop

- A new `PmPollingOrchestrator` service exists at `src/integrations/polling/pm-polling-orchestrator.service.ts`.
- A `@Cron('0 * * * * *')` job (every minute at second 0) iterates **all** `ProjectIntegration` records where `polling_enabled = true`.
- For each integration, it checks whether the integration is **due** for a poll:
  - `polling_last_run_at === null` → always due (first poll)
  - `Date.now() >= polling_last_run_at.getTime() + polling_interval_min * 60_000` → due
- Integrations **not yet due** are silently skipped.

### AC2 — Provider-agnostic task fetch via IPMProvider

- For each due integration, the orchestrator calls `PMProviderFactory.getProvider(integration)` to obtain an `IPMProvider`.
- The orchestrator calls `await provider.getUpdatedTasks(integration.workspace_id, since)` where `since` is `raw.polling_last_run_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000)` (24h fallback on first poll).
- `getUpdatedTasks(workspaceId: string, since: Date): Promise<NormalizedTask[]>` is a **new method** added to the `IPMProvider` interface.
- `ClickUpProvider` implements `getUpdatedTasks` by calling `GET /team/{workspaceId}/task?date_updated_gt={since.getTime()}&include_closed=true&subtasks=true&order_by=updated`.

### AC3 — `ITaskEvent` published to ticket-intake-queue (NOT deprecated `IRawTaskEvent`)

- For each `NormalizedTask` returned, the orchestrator builds an `ITaskEvent` directly and publishes it.
- **Do NOT publish `IRawTaskEvent`** — `processTaskEvent(IRawTaskEvent)` is `@deprecated`. New code publishes `ITaskEvent` directly.
- Build flow:
  1. Use `mapClickUpToTaskEvent(rawEvent, TaskTriggerSource.POLLING)` from `@/ticket-intake/dto` to produce an `ITaskEvent`.
  2. `rawEvent` is an internal `IRawTaskEvent` intermediary — it is **not** published.
  3. Publish the `ITaskEvent` to `QUEUE_NAMES.TICKET_INTAKE` via `RabbitMQService.publishToQueue()`.
- `correlationId` format: `polling-{integration.id}-{task.id}-{Date.now()}`.
- Message envelope: `{ messageId, correlationId, payload: taskEvent }` with options `{ persistent: true, correlationId, headers: { 'x-source': 'polling' } }`.
- **`TicketIntakeConsumer` already handles `ITaskEvent`**: it detects the event type via `'taskId' in event && !('externalId' in event)`. Publishing an `ITaskEvent` (which has `externalId`) bypasses the legacy `mapClickUpToTaskEvent` conversion and goes directly to `processNormalizedTaskEvent`. No consumer changes needed.

### AC4 — `polling_last_run_at` updated after each successful poll

- Regardless of whether tasks were found, after a successful poll `polling_last_run_at` is updated to `new Date()` via `ProjectIntegrationService.updateIntegration(integrationId, { polling_last_run_at: new Date() })`.
- The update uses `ProjectIntegrationService.updateIntegration()` — no direct Prisma calls.

### AC5 — Per-integration error isolation

- If `PMProviderFactory.getProvider()` or `provider.getUpdatedTasks()` throws, the error is:
  - Logged via `LoggerService.error()` with context: `{ integrationId, provider: integration.provider, workspaceId: integration.workspace_id }`.
  - Captured by `SentryService.captureException()`.
  - **Contained** — the error does NOT stop other integrations. Each integration is wrapped in its own `try/catch`.
- `polling_last_run_at` is NOT updated on error — the integration retries at the next cron tick when it's due again.

### AC6 — `IPMProvider` interface extended with `getUpdatedTasks`

- File: `src/integrations/providers/pm-provider.interface.ts`
- New method signature:
  ```typescript
  getUpdatedTasks(workspaceId: string, since: Date): Promise<NormalizedTask[]>;
  ```
- The `NormalizedTask` DTO (`src/integrations/providers/dto/normalized-task.dto.ts`) must include `listId: string` — verify it exists (CS0-3 added it); add if missing.

### AC7 — `ClickUpProvider` implements `getUpdatedTasks`

- File: `src/integrations/providers/clickup/clickup.provider.ts`
- Calls `GET /team/{workspaceId}/task` with params:
  - `date_updated_gt`: `since.getTime()` (Unix ms)
  - `include_closed`: `true`
  - `subtasks`: `true`
  - `order_by`: `'updated'`
- Maps each raw ClickUp task to `NormalizedTask`:
  - `id`: `task.id`
  - `name`: `task.name`
  - `description`: `task.description || task.text_content || ''`
  - `status`: `task.status?.status || 'to do'`
  - `url`: `task.url || \`https://app.clickup.com/t/${task.id}\``
  - `listId`: `task.list?.id || ''` ← **critical**: this is the ClickUp list ID used by `TicketIntakeService` as `projectIdentifier` to resolve the DSF project. If `task.list?.id` is empty, project resolution fails silently.
- Wrapped in the existing `retryWithBackoff` private helper (3 attempts, 429 → immediate throw).

### AC8 — Prometheus metrics

- Four metrics via `MetricsService`:
  - `pm_polling_tasks_discovered_total` (labels: `provider`, `integration_id`) — per task published.
  - `pm_polling_errors_total` (labels: `provider`) — per integration error.
  - `pm_polling_runs_total` (labels: `provider`, `status: 'success' | 'error'`) — per integration attempt.
  - `pm_polling_duration_seconds` **histogram** (labels: `provider`) — wall-clock time of each integration poll (same pattern as `clickup_poll_duration_seconds` in `ClickUpPollingOrchestrator`).
- Use `MetricsService.incrementCounter()` for counters and `MetricsService.recordHistogram()` for duration.

### AC9 — `TaskTriggerSource.POLLING` enum value

- File: `src/ticket-intake/dto/task-event.dto.ts`
- Add `POLLING = 'POLLING'` to `TaskTriggerSource` enum:
  ```typescript
  export enum TaskTriggerSource {
    SYNC = 'SYNC',
    WEBHOOK = 'WEBHOOK',
    POLLING = 'POLLING', // ← add
  }
  ```
- This ensures polling-sourced events are correctly tagged in `dsf_ticket_intake_total{trigger=POLLING}` metrics, distinct from `WEBHOOK` and `SYNC`.

### AC10 — Module wiring

- New file: `src/integrations/polling/pm-polling.module.ts`
- `PmPollingModule` imports `IntegrationsModule` (gets `ProjectIntegrationService` + `PMProviderFactory`) plus `DatabaseModule`, `SentryModule`, `AppMetricsModule`, `LoggerModule`, `RabbitMQModule`.
- `PmPollingModule` declares only `PmPollingOrchestrator` as its own provider — do NOT re-declare `ProjectIntegrationService` or `PMProviderFactory`.
- **`PmPollingModule` is imported in `AppModule`** (not inside `IntegrationsModule`). This avoids circular dependency and duplicate provider instances.
- `ScheduleModule.forRoot()` is already in `AppModule` — no additional import needed anywhere.

### AC11 — Unit tests

- File: `src/integrations/polling/pm-polling-orchestrator.service.spec.ts`
- Must cover:
  1. **Skips integration not yet due** (last run 5 min ago, interval 15 min).
  2. **Polls integration that is due** (last run 20 min ago, interval 15 min).
  3. **Polls integration with null `polling_last_run_at`** (first poll — always due).
  4. **Publishes correct `ITaskEvent`** to `ticket-intake-queue` with `triggerSource: POLLING`.
  5. **Updates `polling_last_run_at`** after successful poll.
  6. **Does NOT update `polling_last_run_at`** on provider error.
  7. **Continues processing other integrations** when one throws.
  8. **Calls Sentry** on provider error.

### AC12 — Type safety

- `pnpm typecheck` passes with zero errors.
- No `as any` casts in `PmPollingOrchestrator`.

## Tasks / Subtasks

- [ ] Task 1: Add `POLLING` to `TaskTriggerSource` enum (AC: 9)
  - [ ] Open `src/ticket-intake/dto/task-event.dto.ts`.
  - [ ] Add `POLLING = 'POLLING'` to `TaskTriggerSource` enum after `WEBHOOK`.

- [ ] Task 2: Extend `IPMProvider` interface with `getUpdatedTasks` (AC: 2, 6)
  - [ ] Open `src/integrations/providers/pm-provider.interface.ts` and add `getUpdatedTasks(workspaceId: string, since: Date): Promise<NormalizedTask[]>`.
  - [ ] Verify `NormalizedTask` at `src/integrations/providers/dto/normalized-task.dto.ts` has `listId: string` — add if missing.

- [ ] Task 3: Implement `getUpdatedTasks` in `ClickUpProvider` (AC: 7)
  - [ ] Open `src/integrations/providers/clickup/clickup.provider.ts` — read it fully first.
  - [ ] Add `getUpdatedTasks(workspaceId: string, since: Date): Promise<NormalizedTask[]>`.
  - [ ] Use `GET /team/{workspaceId}/task` with correct query params (see AC7).
  - [ ] Map to `NormalizedTask[]`, ensuring `listId: task.list?.id || ''`.
  - [ ] Wrap in existing `retryWithBackoff` helper.

- [ ] Task 4: Create `PmPollingOrchestrator` service (AC: 1, 2, 3, 4, 5, 8)
  - [ ] Create `src/integrations/polling/pm-polling-orchestrator.service.ts`.
  - [ ] Inject: `PrismaService`, `ProjectIntegrationService`, `PMProviderFactory`, `RabbitMQService`, `MetricsService`, `SentryService`, `LoggerService`.
  - [ ] Implement `@Cron('0 * * * * *') async pollDueIntegrations()`.
  - [ ] Query integrations with `polling_enabled = true`, include `project { id, name }`.
  - [ ] Per-integration: check due, decrypt tokens, get provider, call `getUpdatedTasks`, build `ITaskEvent` via `mapClickUpToTaskEvent(rawEvent, TaskTriggerSource.POLLING)`, publish, update timestamp.
  - [ ] Per-integration error isolation with Sentry + metrics.
  - [ ] Duration histogram via `MetricsService.recordHistogram('pm_polling_duration_seconds', ...)`.

- [ ] Task 5: Create `PmPollingModule` (AC: 10)
  - [ ] Create `src/integrations/polling/pm-polling.module.ts`.
  - [ ] Imports: `IntegrationsModule`, `DatabaseModule`, `SentryModule`, `AppMetricsModule`, `LoggerModule`, `RabbitMQModule`.
  - [ ] Providers: `[PmPollingOrchestrator]` only.
  - [ ] Add `PmPollingModule` to `AppModule` imports array (NOT to `IntegrationsModule`).

- [ ] Task 6: Write unit tests (AC: 11)
  - [ ] Create `src/integrations/polling/pm-polling-orchestrator.service.spec.ts`.
  - [ ] All 8 test cases from AC11 (see Testing Strategy in Dev Notes).
  - [ ] Verify test 4 asserts `triggerSource: 'POLLING'` in the published payload.

- [ ] Task 7: Type check and lint (AC: 12)
  - [ ] `pnpm typecheck` — zero errors.
  - [ ] `pnpm lint` — zero violations.

## Dev Notes

### Architecture Context — Why a New Service, Not Modifying `ClickUpPollingOrchestrator`

The existing `src/clickup/clickup-polling-orchestrator.service.ts` is ClickUp-specific:

- Hardcoded to use `ClickUpService.getTasks()` directly
- Polls by ClickUp `list_id` (from `Project.clickup_list_id`)
- Uses env var `CLICKUP_USE_WEBHOOKS` as a global toggle
- Not integrated with `ProjectIntegration` model

CS0-8 creates a new `PmPollingOrchestrator` that:

- Works across all providers via `IPMProvider` abstraction
- Reads per-integration polling config from `ProjectIntegration` (not env vars)
- Uses `workspace_id` (ClickUp team ID) as the polling scope
- Is registered in `AppModule` directly, independent of `ClickUpModule`

**DO NOT modify** `ClickUpPollingOrchestrator` — it stays in place. Both services run in parallel during the transition period.

### Module Architecture — Why `AppModule`, Not `IntegrationsModule`

**`PmPollingModule` must be imported in `AppModule` directly, NOT nested inside `IntegrationsModule`.**

Reason: `PmPollingModule` imports `IntegrationsModule` (to get `ProjectIntegrationService` and `PMProviderFactory`). If `IntegrationsModule` also imported `PmPollingModule`, that would be a circular dependency. Additionally, nesting it inside `IntegrationsModule` would cause `PMProviderFactory` and `ProjectIntegrationService` to be re-declared as double providers.

Precedent: `CleanupModule` (which also has `@Cron` services) is imported directly in `AppModule` at line 98 — same pattern.

```typescript
// AppModule — ADD PmPollingModule here, alongside IntegrationsModule:
IntegrationsModule,   // line ~126 in src/app.module.ts
PmPollingModule,      // ← add after IntegrationsModule
```

### `ITaskEvent` vs `IRawTaskEvent` — Critical Design Decision

**Publish `ITaskEvent`, not `IRawTaskEvent`.**

`processTaskEvent(IRawTaskEvent)` is marked `@deprecated` in `TicketIntakeService` (line 90). New code must use `ITaskEvent` directly. The detection logic in `TicketIntakeConsumer`:

```typescript
// TicketIntakeService.processTaskEvent (line 96):
const isLegacyEvent = 'taskId' in event && !('externalId' in event);
```

Publishing an `ITaskEvent` (which has `externalId`, no `taskId`) → `isLegacyEvent = false` → goes directly to `processNormalizedTaskEvent` → **no double-mapping, correct `triggerSource`**. No changes needed to `TicketIntakeConsumer`.

### `projectIdentifier` → DSF Project Lookup Chain

`mapClickUpToTaskEvent` maps `rawEvent.listId → ITaskEvent.projectIdentifier`. The `TicketIntakeService` uses `projectIdentifier` (the ClickUp list ID) to resolve the DSF `Project` via `ProjectService.findByClickUpListId()` or equivalent. This means:

**`NormalizedTask.listId` must be the ClickUp list ID of the task** (`task.list?.id` from `GET /team/{workspaceId}/task` response). If this field is absent from the API response or mapped incorrectly, project resolution will silently fail — the ticket will be created without a project association.

### Idempotency — Existing Protection

`TicketIntakeService.processNormalizedTaskEvent` already guards against duplicate processing:

```typescript
// Line 129 — existing check:
const existingExecution = await this.checkActiveExecution(event.externalId);
if (existingExecution) {
  return { success: true, status: 'AI_PROCESSING', ticketId: existingExecution.ticket_id };
}
```

If the same task is polled twice (e.g., due to an error that prevented `polling_last_run_at` from updating), the second event is silently deduplicated. CS1-6 will add an explicit `pm_polling_tasks_skipped_total` counter for this, but the correctness protection is already in place.

### `PmPollingOrchestrator` — Complete Implementation

```typescript
// src/integrations/polling/pm-polling-orchestrator.service.ts
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '@/database/prisma.service';
import { ProjectIntegrationService } from '../project-integration.service';
import { PMProviderFactory } from '../providers/pm-provider.factory';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { LoggerService } from '@/common/logger/logger.service';
import { QUEUE_NAMES } from '@/rabbitmq/rabbitmq.config';
import { IRawTaskEvent } from '@/ticket-intake/interfaces';
import { ITaskEvent, TaskTriggerSource, mapClickUpToTaskEvent } from '@/ticket-intake/dto';
import type { NormalizedTask } from '../providers/dto/normalized-task.dto';

@Injectable()
export class PmPollingOrchestrator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationService: ProjectIntegrationService,
    private readonly providerFactory: PMProviderFactory,
    private readonly rabbitmq: RabbitMQService,
    private readonly metrics: MetricsService,
    private readonly sentry: SentryService,
    private readonly logger: LoggerService,
  ) {}

  @Cron('0 * * * * *') // every minute at second 0 — matches project cron convention
  async pollDueIntegrations(): Promise<void> {
    const integrations = await this.prisma.projectIntegration.findMany({
      where: { polling_enabled: true },
      include: { project: { select: { id: true, name: true } } },
    });

    for (const raw of integrations) {
      // Check if due — use raw.polling_last_run_at from this query (not re-fetched)
      const intervalMs = raw.polling_interval_min * 60_000;
      const isDue =
        raw.polling_last_run_at === null ||
        Date.now() >= raw.polling_last_run_at.getTime() + intervalMs;

      if (!isDue) continue;

      // Decrypt tokens via service (needed for PMProviderFactory.getProvider)
      const integration = await this.integrationService.getDecryptedIntegration(raw.id);
      if (!integration) continue;

      const start = Date.now();

      try {
        // Since is from raw query (avoids race between findMany and getDecryptedIntegration)
        const since = raw.polling_last_run_at ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
        const provider = await this.providerFactory.getProvider(integration);
        const tasks = await provider.getUpdatedTasks(integration.workspace_id, since);

        for (const task of tasks) {
          const messageId = `polling-${integration.id}-${task.id}-${Date.now()}`;

          // Build internal IRawTaskEvent then map to ITaskEvent with POLLING trigger source
          // IRawTaskEvent is an internal intermediary — NOT published directly
          const rawEvent: IRawTaskEvent = {
            correlationId: messageId,
            webhookEventId: '',
            eventType: 'taskUpdated',
            taskId: task.id,
            taskName: task.name,
            taskDescription: task.description ?? null,
            taskStatus: task.status,
            listId: task.listId, // ← ClickUp list ID → used as projectIdentifier for DSF project lookup
            listName: '', // not available from GET /team/task; acceptable gap
            spaceId: '', // not available from NormalizedTask; acceptable gap
            projectId: raw.project.id,
            projectName: raw.project.name,
            taskUrl: task.url,
            tags: [],
            customFields: {},
            creatorEmail: '',
            eventTimestamp: new Date().toISOString(),
            receivedAt: new Date().toISOString(),
          };

          // Publish ITaskEvent (not IRawTaskEvent) — avoids deprecated legacy path
          const taskEvent: ITaskEvent = mapClickUpToTaskEvent(rawEvent, TaskTriggerSource.POLLING);

          await this.rabbitmq.publishToQueue(
            QUEUE_NAMES.TICKET_INTAKE,
            { messageId, correlationId: messageId, payload: taskEvent },
            { persistent: true, correlationId: messageId, headers: { 'x-source': 'polling' } },
          );

          this.metrics.incrementCounter('pm_polling_tasks_discovered_total', {
            provider: integration.provider,
            integration_id: integration.id,
          });
        }

        await this.integrationService.updateIntegration(integration.id, {
          polling_last_run_at: new Date(),
        });

        this.metrics.incrementCounter('pm_polling_runs_total', {
          provider: integration.provider,
          status: 'success',
        });

        this.metrics.recordHistogram('pm_polling_duration_seconds', (Date.now() - start) / 1000, {
          provider: integration.provider,
        });

        this.logger.log(
          `Polled ${integration.provider}/${integration.workspace_id}: ${tasks.length} tasks`,
          { integrationId: integration.id },
        );
      } catch (error) {
        this.logger.error(
          'Polling failed for integration',
          error instanceof Error ? error.stack : String(error),
          {
            integrationId: integration.id,
            provider: integration.provider,
            workspaceId: integration.workspace_id,
          },
        );

        this.sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
          tags: { operation: 'pm_polling' },
          extra: { integrationId: integration.id, provider: integration.provider },
        });

        this.metrics.incrementCounter('pm_polling_errors_total', {
          provider: integration.provider,
        });

        this.metrics.incrementCounter('pm_polling_runs_total', {
          provider: integration.provider,
          status: 'error',
        });
        // NOTE: polling_last_run_at is NOT updated on error — integration retries next cron tick
      }
    }
  }
}
```

### `ClickUpProvider.getUpdatedTasks` — Full Implementation

```typescript
// Add to src/integrations/providers/clickup/clickup.provider.ts

async getUpdatedTasks(workspaceId: string, since: Date): Promise<NormalizedTask[]> {
  return this.retryWithBackoff(async () => {
    const response = await axios.get<{ tasks: ClickUpRawTask[] }>(
      `${this.baseURL}/team/${workspaceId}/task`,
      {
        headers: { Authorization: this.accessToken },
        params: {
          date_updated_gt: since.getTime(),
          include_closed: true,
          subtasks: true,
          order_by: 'updated',
        },
      },
    );

    return response.data.tasks.map((task): NormalizedTask => ({
      id: task.id,
      name: task.name,
      description: task.description || task.text_content || '',
      status: task.status?.status || 'to do',
      url: task.url || `https://app.clickup.com/t/${task.id}`,
      listId: task.list?.id || '', // must not be empty — used for DSF project lookup
    }));
  });
}

// Add to private types section (if ClickUpRawTask not already defined):
interface ClickUpRawTask {
  id: string;
  name: string;
  description?: string;
  text_content?: string;
  status?: { status: string };
  url?: string;
  list?: { id: string; name?: string };
}
```

### `IPMProvider` Interface Diff

```typescript
// src/integrations/providers/pm-provider.interface.ts — add:
getUpdatedTasks(workspaceId: string, since: Date): Promise<NormalizedTask[]>;
```

### `NormalizedTask` DTO — Required `listId` Field

```typescript
// src/integrations/providers/dto/normalized-task.dto.ts (expected after CS0-3):
export class NormalizedTask {
  id: string;
  name: string;
  description: string;
  status: string;
  url: string;
  listId: string; // ← Must exist. Add if missing.
}
```

### `PmPollingModule` Setup

```typescript
// src/integrations/polling/pm-polling.module.ts
import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations.module'; // ← gets PMProviderFactory + ProjectIntegrationService
import { DatabaseModule } from '@/database/database.module';
import { SentryModule } from '@/common/sentry/sentry.module';
import { AppMetricsModule } from '@/common/metrics/metrics.module';
import { LoggerModule } from '@/common/logger/logger.module';
import { RabbitMQModule } from '@/rabbitmq/rabbitmq.module';
import { PmPollingOrchestrator } from './pm-polling-orchestrator.service';

@Module({
  imports: [
    IntegrationsModule,
    DatabaseModule,
    SentryModule,
    AppMetricsModule,
    LoggerModule,
    RabbitMQModule,
  ],
  providers: [PmPollingOrchestrator], // only the new service — PMProviderFactory + ProjectIntegrationService come from IntegrationsModule
})
export class PmPollingModule {}
```

Then in `AppModule`:

```typescript
// src/app.module.ts — add import + array entry alongside IntegrationsModule (~line 126):
import { PmPollingModule } from './integrations/polling/pm-polling.module';

// In @Module imports array:
IntegrationsModule,
PmPollingModule,   // ← add here
```

> **IntegrationsModule must export `ProjectIntegrationService` and `PMProviderFactory`** after CS0-3/CS0-4 complete. Verify `exports: [ProjectIntegrationService, PMProviderFactory]` in `src/integrations/integrations.module.ts` before starting CS0-8.

### `PMProviderFactory` — Pre-CS0-8 State

After CS0-4 is done, `PMProviderFactory` at `src/integrations/providers/pm-provider.factory.ts` will have:

- `getProvider(integration: ProjectIntegration): Promise<IPMProvider>` — accepts **already-decrypted** integration
- Transparent token refresh within 5-min window
- `UnsupportedProviderException` for unregistered providers
- `IntegrationAuthException` for auth failures

CS0-8 passes the decrypted result of `getDecryptedIntegration(id)` to `getProvider()` — never the encrypted raw DB record.

### `QUEUE_NAMES` — Import Path

```typescript
import { QUEUE_NAMES } from '@/rabbitmq/rabbitmq.config';
// QUEUE_NAMES.TICKET_INTAKE = 'ticket-intake-queue'
```

### Cron Expression — `'0 * * * * *'`

6-field cron (second-level): fires at second 0 of every minute. Matches project convention from `CleanupSchedulerService` which uses `'0 */5 * * * *'`. `ScheduleModule.forRoot()` is in `AppModule` line 81 — no re-import needed anywhere.

### Testing Strategy

```typescript
// src/integrations/polling/pm-polling-orchestrator.service.spec.ts
import { PmPollingOrchestrator } from './pm-polling-orchestrator.service';
import { PrismaService } from '@/database/prisma.service';
import { ProjectIntegrationService } from '../project-integration.service';
import { PMProviderFactory } from '../providers/pm-provider.factory';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { LoggerService } from '@/common/logger/logger.service';
import { IntegrationProvider } from '@prisma/client';
import { TaskTriggerSource } from '@/ticket-intake/dto';

const makeIntegration = (overrides = {}) => ({
  id: 'int-1',
  project_id: 'proj-1',
  provider: IntegrationProvider.CLICKUP,
  workspace_id: 'ws-1',
  polling_enabled: true,
  polling_interval_min: 15,
  polling_last_run_at: new Date(Date.now() - 20 * 60_000), // 20 min ago — due
  access_token: 'token',
  refresh_token: null,
  token_expiry: null,
  project: { id: 'proj-1', name: 'My Project' },
  ...overrides,
});

describe('PmPollingOrchestrator', () => {
  let orchestrator: PmPollingOrchestrator;
  let prisma: jest.Mocked<PrismaService>;
  let integrationService: jest.Mocked<ProjectIntegrationService>;
  let providerFactory: jest.Mocked<PMProviderFactory>;
  let rabbitmq: jest.Mocked<RabbitMQService>;
  let metrics: jest.Mocked<MetricsService>;
  let sentry: jest.Mocked<SentryService>;
  let logger: jest.Mocked<LoggerService>;

  beforeEach(() => {
    prisma = { projectIntegration: { findMany: jest.fn() } } as any;
    integrationService = {
      getDecryptedIntegration: jest.fn(),
      updateIntegration: jest.fn(),
    } as any;
    providerFactory = { getProvider: jest.fn() } as any;
    rabbitmq = { publishToQueue: jest.fn() } as any;
    metrics = { incrementCounter: jest.fn(), recordHistogram: jest.fn() } as any;
    sentry = { captureException: jest.fn() } as any;
    logger = { log: jest.fn(), error: jest.fn(), debug: jest.fn(), warn: jest.fn() } as any;

    orchestrator = new PmPollingOrchestrator(
      prisma,
      integrationService,
      providerFactory,
      rabbitmq,
      metrics,
      sentry,
      logger,
    );
  });

  it('skips integration not yet due (5 min ago, 15 min interval)', async () => {
    const integration = makeIntegration({ polling_last_run_at: new Date(Date.now() - 5 * 60_000) });
    prisma.projectIntegration.findMany.mockResolvedValue([integration] as any);

    await orchestrator.pollDueIntegrations();

    expect(providerFactory.getProvider).not.toHaveBeenCalled();
  });

  it('polls integration that is due (20 min ago, 15 min interval)', async () => {
    const raw = makeIntegration();
    prisma.projectIntegration.findMany.mockResolvedValue([raw] as any);
    integrationService.getDecryptedIntegration.mockResolvedValue(raw as any);
    const provider = { getUpdatedTasks: jest.fn().mockResolvedValue([]) };
    providerFactory.getProvider.mockResolvedValue(provider as any);
    integrationService.updateIntegration.mockResolvedValue(raw as any);

    await orchestrator.pollDueIntegrations();

    expect(providerFactory.getProvider).toHaveBeenCalledWith(raw);
    expect(provider.getUpdatedTasks).toHaveBeenCalled();
    expect(integrationService.updateIntegration).toHaveBeenCalledWith('int-1', {
      polling_last_run_at: expect.any(Date),
    });
  });

  it('polls integration with null polling_last_run_at (first poll)', async () => {
    const raw = makeIntegration({ polling_last_run_at: null });
    prisma.projectIntegration.findMany.mockResolvedValue([raw] as any);
    integrationService.getDecryptedIntegration.mockResolvedValue(raw as any);
    const provider = { getUpdatedTasks: jest.fn().mockResolvedValue([]) };
    providerFactory.getProvider.mockResolvedValue(provider as any);
    integrationService.updateIntegration.mockResolvedValue(raw as any);

    await orchestrator.pollDueIntegrations();

    expect(provider.getUpdatedTasks).toHaveBeenCalled();
  });

  it('publishes ITaskEvent with triggerSource POLLING for each task', async () => {
    const raw = makeIntegration();
    const task = {
      id: 'task-1',
      name: 'Build Feature',
      description: 'Do it',
      status: 'in progress',
      url: 'https://app.clickup.com/t/task-1',
      listId: 'list-1',
    };
    prisma.projectIntegration.findMany.mockResolvedValue([raw] as any);
    integrationService.getDecryptedIntegration.mockResolvedValue(raw as any);
    providerFactory.getProvider.mockResolvedValue({
      getUpdatedTasks: jest.fn().mockResolvedValue([task]),
    } as any);
    integrationService.updateIntegration.mockResolvedValue(raw as any);
    rabbitmq.publishToQueue.mockResolvedValue(undefined);

    await orchestrator.pollDueIntegrations();

    expect(rabbitmq.publishToQueue).toHaveBeenCalledWith(
      'ticket-intake-queue',
      expect.objectContaining({
        payload: expect.objectContaining({
          externalId: 'task-1', // ITaskEvent shape (not IRawTaskEvent)
          triggerSource: TaskTriggerSource.POLLING,
          projectIdentifier: 'list-1', // ClickUp list ID for project lookup
        }),
      }),
      expect.any(Object),
    );
  });

  it('does NOT update polling_last_run_at on provider error', async () => {
    const raw = makeIntegration();
    prisma.projectIntegration.findMany.mockResolvedValue([raw] as any);
    integrationService.getDecryptedIntegration.mockResolvedValue(raw as any);
    providerFactory.getProvider.mockRejectedValue(new Error('Provider down'));

    await orchestrator.pollDueIntegrations();

    expect(integrationService.updateIntegration).not.toHaveBeenCalled();
    expect(sentry.captureException).toHaveBeenCalled();
    expect(metrics.incrementCounter).toHaveBeenCalledWith(
      'pm_polling_errors_total',
      expect.any(Object),
    );
  });

  it('continues processing other integrations when one throws', async () => {
    const raw1 = makeIntegration({ id: 'int-1' });
    const raw2 = makeIntegration({ id: 'int-2' });
    prisma.projectIntegration.findMany.mockResolvedValue([raw1, raw2] as any);
    integrationService.getDecryptedIntegration
      .mockResolvedValueOnce(raw1 as any)
      .mockResolvedValueOnce(raw2 as any);
    providerFactory.getProvider
      .mockRejectedValueOnce(new Error('Int 1 failed'))
      .mockResolvedValueOnce({ getUpdatedTasks: jest.fn().mockResolvedValue([]) } as any);
    integrationService.updateIntegration.mockResolvedValue(raw2 as any);

    await orchestrator.pollDueIntegrations();

    expect(providerFactory.getProvider).toHaveBeenCalledTimes(2);
    expect(integrationService.updateIntegration).toHaveBeenCalledWith('int-2', expect.any(Object));
  });

  it('records duration histogram on successful poll', async () => {
    const raw = makeIntegration();
    prisma.projectIntegration.findMany.mockResolvedValue([raw] as any);
    integrationService.getDecryptedIntegration.mockResolvedValue(raw as any);
    providerFactory.getProvider.mockResolvedValue({
      getUpdatedTasks: jest.fn().mockResolvedValue([]),
    } as any);
    integrationService.updateIntegration.mockResolvedValue(raw as any);

    await orchestrator.pollDueIntegrations();

    expect(metrics.recordHistogram).toHaveBeenCalledWith(
      'pm_polling_duration_seconds',
      expect.any(Number),
      { provider: IntegrationProvider.CLICKUP },
    );
  });
});
```

### File Structure

New files to create:

| File                                                               | Action |
| ------------------------------------------------------------------ | ------ |
| `src/integrations/polling/pm-polling-orchestrator.service.ts`      | CREATE |
| `src/integrations/polling/pm-polling-orchestrator.service.spec.ts` | CREATE |
| `src/integrations/polling/pm-polling.module.ts`                    | CREATE |

Files to modify:

| File                                                     | Change                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/ticket-intake/dto/task-event.dto.ts`                | Add `POLLING = 'POLLING'` to `TaskTriggerSource` enum                     |
| `src/integrations/providers/pm-provider.interface.ts`    | Add `getUpdatedTasks` method signature                                    |
| `src/integrations/providers/dto/normalized-task.dto.ts`  | Verify/add `listId: string` field                                         |
| `src/integrations/providers/clickup/clickup.provider.ts` | Implement `getUpdatedTasks` method                                        |
| `src/integrations/integrations.module.ts`                | Verify `PMProviderFactory` in exports (CS0-3/CS0-4 should have done this) |
| `src/app.module.ts`                                      | Import `PmPollingModule` and add to `@Module` imports array               |

### DO NOT MODIFY

- `src/clickup/clickup-polling-orchestrator.service.ts` — legacy service stays; both run in parallel
- `src/ticket-intake/ticket-intake.consumer.ts` — already handles `ITaskEvent` via detection logic on line 96
- `src/ticket-intake/ticket-intake.service.ts` — no changes needed
- `src/rabbitmq/rabbitmq.config.ts` — `QUEUE_NAMES.TICKET_INTAKE` already defined
- `src/integrations/integrations.module.ts` — only verify exports; do not change imports

### Dependency Order — Critical

CS0-8 requires all of these **done** before starting:

- **CS0-2** — `IPMProvider` interface exists at `src/integrations/providers/pm-provider.interface.ts`
- **CS0-3** — `ClickUpProvider` exists; `PMProviderFactory` registered + exported from `IntegrationsModule`
- **CS0-4** — `PMProviderFactory` has token refresh and typed exceptions

Pre-flight check before starting: verify `src/integrations/integrations.module.ts` exports both `ProjectIntegrationService` and `PMProviderFactory`. If not, add them — this is required for `PmPollingModule` to import them via `IntegrationsModule`.

Calling sequence at runtime: `PmPollingOrchestrator` → `PMProviderFactory.getProvider(decrypted)` → `ClickUpProvider.getUpdatedTasks(workspaceId, since)` → `mapClickUpToTaskEvent(rawEvent, POLLING)` → `RabbitMQService.publishToQueue('ticket-intake-queue', ITaskEvent)`

### Previous Story Learnings

**CS0-1 (done):**

- `ProjectIntegrationService.updateIntegration(id, data)` encrypts tokens on write, returns decrypted plaintext.
- `polling_last_run_at` is `DateTime?` → TypeScript `Date | null`.

**CS0-4 (must complete first):**

- `PMProviderFactory.getProvider(integration)` takes **already-decrypted** integration.
- Throws `IntegrationAuthException` (token refresh fails) or `UnsupportedProviderException`.
- Always call `getDecryptedIntegration()` before `getProvider()`.

**From `CleanupSchedulerService`:**

- `@Cron('0 */5 * * * *')` — project uses 6-field cron. Use `'0 * * * * *'` for every-minute.
- `ScheduleModule.forRoot()` in `AppModule` (line 81) covers all modules — no re-import needed.
- `LoggerService` from `@/common/logger` is the project convention (not NestJS built-in `Logger`).

**From `TicketIntakeService`:**

- `processTaskEvent(IRawTaskEvent)` is `@deprecated` since Story 20.1.
- New code publishes `ITaskEvent` with `triggerSource` set explicitly.
- `ITaskEvent.projectIdentifier` = ClickUp list ID = used for DSF project lookup.

**N+1 query — acknowledged trade-off:**
`findMany` (list query) + `getDecryptedIntegration` per due integration = 2 DB calls per due integration. Acceptable: `ProjectIntegrationService` has no bulk-decrypt method, and the number of concurrent polling integrations is small in practice.

### References

- [Source: _bmad-output/planning-artifacts/epics-clickup-smart-sync.md#Story 0.7: Provider-Agnostic Polling Orchestrator]
- [Source: _bmad-output/planning-artifacts/epics-clickup-smart-sync.md#FR-CS0I]
- [ProjectIntegration model: prisma/schema.prisma#ProjectIntegration]
- [Existing polling service (ClickUp-specific): src/clickup/clickup-polling-orchestrator.service.ts]
- [IRawTaskEvent interface: src/ticket-intake/interfaces/ticket-intake.interface.ts]
- [ITaskEvent + TaskTriggerSource + mapClickUpToTaskEvent: src/ticket-intake/dto/task-event.mapper.ts]
- [QUEUE_NAMES.TICKET_INTAKE: src/rabbitmq/rabbitmq.config.ts]
- [ScheduleModule pattern + LoggerService: src/cleanup/cleanup-scheduler.service.ts]
- [processTaskEvent deprecated path: src/ticket-intake/ticket-intake.service.ts#L90]
- [TicketIntakeConsumer detection logic: src/ticket-intake/ticket-intake.consumer.ts#L96]
- [PMProviderFactory story: _bmad-output/implementation-artifacts/CS0-4-pm-provider-factory.md]
- [AppModule imports: src/app.module.ts#L78]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
