# Story CS0.3: ClickUpProvider — Full IPMProvider Implementation

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **DSF system**,
I want a complete ClickUp implementation of `IPMProvider`,
so that all existing ClickUp functionality works through the new provider abstraction and future PM tools can be added with zero changes to business logic.

## Acceptance Criteria

1. **ClickUpProvider Class exists and fully implements IPMProvider:**
   - File: `src/integrations/providers/clickup/clickup.provider.ts`
   - Class is a plain TypeScript class (NO `@Injectable()`) instantiated with `accessToken: string` (NOT `ConfigService`) and optional `baseURL` defaulting to `https://api.clickup.com/api/v2`
   - Implements all 11 methods of `IPMProvider`: `getSelf`, `getStatuses`, `getTask`, `updateStatus`, `addComment`, `assignTask`, `getRequiredFields`, `setFieldValue`, `registerWebhook`, `deregisterWebhook`, `normalizeEvent`

2. **getSelf():**
   - Calls `GET /user`
   - Returns `{ id: string, username: string }` — note: ClickUp returns `user.id` as an **integer**; cast with `String(data.user.id)`

3. **getStatuses(listId: string):**
   - Calls `GET /list/{listId}` and maps `list.statuses` to `NormalizedStatus[]`
   - Results cached in-memory keyed `clickup:{listId}` with **5-minute TTL** (300,000 ms)
   - Returns `NormalizedStatus[]` where each item has `id`, `name` (mapped from `status.status`), `color`, `type`

4. **getTask(taskId: string):**
   - Calls `GET /task/{taskId}`
   - Returns `NormalizedTask` with fields: `id`, `name`, `description` (`description || text_content || ''`), `status` (string from `task.status.status`), `url`, **and `listId` (from `task.list.id`)**
   - `listId` is required on `NormalizedTask` — verify it is declared in the CS0-2 DTO; add it if missing

5. **updateStatus(taskId: string, statusId: string):**
   - Calls `PUT /task/{taskId}` with body `{ status: statusId }`
   - **`statusId` is the ClickUp status string name** (e.g. `"in progress"`) — ClickUp v2 `PUT /task` accepts the status name, not an opaque ID
   - Returns `Promise<void>` (throws on error)

6. **addComment(taskId: string, comment: string):**
   - Calls `POST /task/{taskId}/comment` with body `{ comment_text: comment, notify_all: false }`
   - Returns `Promise<void>` (throws on error)

7. **assignTask(taskId: string, userId: string):**
   - Calls `POST /task/{taskId}/assignee` with body `{ assignee: parseInt(userId, 10) }`
   - ⚠️ **Verify against ClickUp API docs before coding**: the v2 API may expect `{ assignees: [{ id: number }] }` (array form) instead of singular `{ assignee: int }`. Test with a real ClickUp workspace or check the official API reference. If the singular form returns 400, switch to array form.
   - Returns `Promise<void>` (throws on error)

8. **getRequiredFields(listId: string):**
   - Calls `GET /list/{listId}/field`
   - Filters response to only `field.required === true`
   - Returns `NormalizedField[]` with `id`, `name`, `type`, `required: true`, `options` (from `field.type_config?.options?.map(o => ({id: o.id, name: o.name})) ?? []`)

9. **setFieldValue(taskId: string, fieldId: string, value: unknown):**
   - Calls `POST /task/{taskId}/field/{fieldId}` with body `{ value }`
   - Returns `Promise<void>` (throws on error)

10. **registerWebhook(workspaceId: string, endpoint: string):**
    - Calls `POST /team/{workspaceId}/webhook` with:
      ```json
      { "endpoint": endpoint, "events": ["taskCreated", "taskUpdated", "taskStatusUpdated"] }
      ```
    - Returns `{ id: string, secret: string }` from response

11. **deregisterWebhook(webhookId: string):**
    - Calls `DELETE /webhook/{webhookId}`
    - Returns `Promise<void>` (throws on error)

12. **normalizeEvent(payload: unknown):**
    - Accepts a raw ClickUp webhook payload
    - Maps to `IRawTaskEvent` from `src/ticket-intake/interfaces/ticket-intake.interface.ts`
    - **Source for mapping logic:** `src/projects/project.service.ts` → `syncFromClickUp()` method (the inline `mapClickUpToTaskEvent` logic, lines ~421–447) — this is where the authoritative field-by-field mapping lives. Do NOT reference `clickup-webhook-consumer.service.ts` for this mapping (the consumer publishes a different, simpler queue payload — not an IRawTaskEvent).
    - Required `IRawTaskEvent` fields and their source: see "normalizeEvent Mapping" section in Dev Notes

13. **Retry and Rate-Limit Handling:**
    - All API calls wrapped in private `retryWithBackoff`: 3 attempts, exponential backoff (1 s → 2 s → 4 s)
    - HTTP 429 → throw `Error('ClickUp rate limit exceeded')` immediately (no retry)
    - Retryable: network errors (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `ECONNREFUSED`) + 5xx
    - Non-retryable: 4xx (except 429)

14. **PMProviderFactory registers ClickUpProvider:**
    - `pm-provider.factory.ts` `IntegrationProvider.CLICKUP` case → `new ClickUpProvider(decryptedIntegration.access_token)`

15. **NestJS DI registration — PMProviderFactory exported from IntegrationsModule:**
    - `PMProviderFactory` added to `IntegrationsModule` `providers` AND `exports`
    - Every NestJS module whose service now injects `PMProviderFactory` must import `IntegrationsModule`:
      - `src/github/github.module.ts`
      - `src/execution/execution.module.ts`
      - `src/production-monitoring/production-monitoring.module.ts`
      - `src/qa-automation/qa-automation.module.ts`
      - `src/architecture-review/architecture-review.module.ts`
      - `src/clickup/clickup.module.ts` — use `forwardRef(() => IntegrationsModule)` here to avoid circular module dependency (IntegrationsModule already imports ClickUpModule)

16. **ClickUpService marked @deprecated:**
    - Add `@deprecated Use PMProviderFactory.getProvider() + IPMProvider instead` JSDoc to class declaration in `src/clickup/clickup.service.ts`

17. **Caller migration — exact scope:**

    **MIGRATE these callers** (have project context, use IPMProvider-compatible methods):
    - `src/github/services/deployment-status-sync.service.ts` — migrate `updateStatus()` and `addComment()`; requires projectId lookup from execution → ticket → project
    - `src/execution/ai-execution.consumer.ts` — migrate `addComment()`; `payload.projectId` is available
    - `src/execution/self-healing-orchestrator.service.ts` — migrate `updateStatus()` and `addComment()`
    - `src/qa-automation/production-approval/production-approval.service.ts` — migrate ClickUp calls
    - `src/architecture-review/architecture-review-notification.service.ts` — migrate `addComment()`
    - `src/github/services/github-error-monitor.service.ts` — migrate `addComment()`
    - `src/production-monitoring/fix-ticket.service.ts` — migrate `addComment()` ONLY; keep `ClickUpService` injection for `createTask()` (`createTask` is NOT in IPMProvider and cannot be migrated here)

    **DO NOT MIGRATE these callers** (must keep ClickUpService — cannot use IPMProvider):
    - `src/dependencies/dependency-manager.service.ts` — **EXCLUDED**: (a) no projectId available, only ticketIds; (b) calls `getTask()` to access `custom_fields` (dependency data) which is NOT in `NormalizedTask`; migrating would silently break dependency tracking
    - `src/dependencies/circular-dependency-detector.service.ts` — **EXCLUDED**: same reasons as above; uses `getTask()` for dependency graph traversal via custom_fields
    - `src/projects/project.service.ts` — **EXCLUDED**: calls `getTasks()` (bulk paginated fetch) and `getList()` which are NOT IPMProvider methods; migration deferred
    - `src/integrations/integrations.controller.ts` — **EXCLUDED**: calls `getHierarchy()` which is not an IPMProvider method; leave as-is

    **Backward compat for missing integrations:** For any migrated caller where `findByProjectAndProvider()` returns `null` (no integration set up yet — pre-OAuth, pending CS0-5), log a warning and gracefully skip the provider call. Do NOT crash.

18. **Polling orchestrator partial migration:**
    - `src/clickup/clickup-polling-orchestrator.service.ts` — inject `ProjectIntegrationService`
    - Change project query: instead of querying `project` table with `provider: 'CLICKUP'`, query `ProjectIntegrationService.findAllByProvider(IntegrationProvider.CLICKUP)` (add this method to service if not present) to get all active CLICKUP integrations — extract `provider_config.listId` for polling
    - **Still use `ClickUpService.getTasks()`** for bulk task fetching (NOT in IPMProvider — do not attempt to replace with `provider.getTask()` which is single-task only)
    - Use `PMProviderFactory.getProvider(integration)` then `provider.normalizeEvent(task)` to convert each polled task to `IRawTaskEvent` instead of the inline mapping

19. **Type safety:** `pnpm typecheck` passes with zero errors.

20. **Unit tests:** `src/integrations/providers/clickup/clickup.provider.spec.ts` with full coverage of all 11 methods.

## Tasks / Subtasks

- [ ] Task 1: Create ClickUpProvider class with HTTP client and logger setup (AC: 1, 13)
  - [ ] Create directory `src/integrations/providers/clickup/`
  - [ ] Create `src/integrations/providers/clickup/clickup.provider.ts`
  - [ ] Constructor: `constructor(private readonly accessToken: string, private readonly baseURL = 'https://api.clickup.com/api/v2')`
  - [ ] `private readonly logger = new Logger(ClickUpProvider.name);` — required for non-injectable class
  - [ ] Initialize: `private readonly client = axios.create({ baseURL: this.baseURL, headers: { Authorization: \`Bearer ${accessToken}\`, 'Content-Type': 'application/json' }, timeout: 10000 })`
  - [ ] Auth header MUST use `Bearer` prefix — unlike legacy `ClickUpService` which uses raw API key without Bearer
  - [ ] Add private `retryWithBackoff<T>(operation: () => Promise<T>, correlationId: string): Promise<T>` — copy from retry logic pattern in Dev Notes
  - [ ] Add private `isRetryableError(error: AxiosError): boolean`
  - [ ] Per-method correlationId pattern: `const correlationId = \`clickup-provider-getSelf\`` (hardcoded string per method, not dynamic)

- [ ] Task 2: Implement getSelf() (AC: 2)
  - [ ] `GET /user`
  - [ ] Map: `{ id: String(data.user.id), username: data.user.username }` — cast id to string (ClickUp returns integer)

- [ ] Task 3: Implement getStatuses() with cache (AC: 3)
  - [ ] `private readonly statusCache = new Map<string, { data: NormalizedStatus[]; expiresAt: Date }>()`
  - [ ] `GET /list/{listId}` → map `response.data.statuses` (array directly on list response)
  - [ ] NormalizedStatus: `{ id: s.id, name: s.status, color: s.color, type: s.type }`
  - [ ] Cache key: `clickup:${listId}`, TTL: `new Date(Date.now() + 300_000)`

- [ ] Task 4: Implement getTask() (AC: 4)
  - [ ] `GET /task/{taskId}`
  - [ ] NormalizedTask: `{ id, name, description: task.description || task.text_content || '', status: task.status?.status || '', url: task.url || \`https://app.clickup.com/t/${taskId}\`, listId: task.list?.id || '' }`
  - [ ] **Verify `listId` is declared on `NormalizedTask` DTO in CS0-2 output** — if missing, add it before implementing

- [ ] Task 5: Implement updateStatus(), addComment(), assignTask(), getRequiredFields(), setFieldValue() (AC: 5–9)
  - [ ] `updateStatus(taskId, statusId)` → `PUT /task/{taskId}` with `{ status: statusId }` — statusId is the status name string for ClickUp v2
  - [ ] `addComment(taskId, comment)` → `POST /task/{taskId}/comment` with `{ comment_text: comment, notify_all: false }`
  - [ ] `assignTask(taskId, userId)` → `POST /task/{taskId}/assignee` — verify body format against ClickUp API before coding (see AC7 warning); start with `{ assignee: parseInt(userId, 10) }` and test
  - [ ] `getRequiredFields(listId)` → `GET /list/{listId}/field` → filter `field.required === true` → NormalizedField
  - [ ] `setFieldValue(taskId, fieldId, value)` → `POST /task/{taskId}/field/{fieldId}` with `{ value }`

- [ ] Task 6: Implement registerWebhook() and deregisterWebhook() (AC: 10, 11)
  - [ ] `registerWebhook(workspaceId, endpoint)` → `POST /team/{workspaceId}/webhook` with `{ endpoint, events: ['taskCreated', 'taskUpdated', 'taskStatusUpdated'] }`
  - [ ] Return `{ id: response.data.webhook.id, secret: response.data.webhook.secret }` (verify response shape from ClickUp API docs)
  - [ ] `deregisterWebhook(webhookId)` → `DELETE /webhook/{webhookId}`

- [ ] Task 7: Implement normalizeEvent() (AC: 12)
  - [ ] Import `IRawTaskEvent` from `src/ticket-intake/interfaces/ticket-intake.interface.ts`
  - [ ] **Reference mapping from `src/projects/project.service.ts` → `syncFromClickUp()` lines ~421–447** — NOT from clickup-webhook-consumer
  - [ ] Import `import { v4 as uuid } from 'uuid'` (already in package.json via NestJS)
  - [ ] Apply full field mapping (see normalizeEvent section in Dev Notes)
  - [ ] Handle all optional fields with null coalescing — task may be absent in some event types

- [ ] Task 8: Register ClickUpProvider in PMProviderFactory (AC: 14)
  - [ ] In `pm-provider.factory.ts`: `case IntegrationProvider.CLICKUP: return new ClickUpProvider(decryptedIntegration.access_token)`
  - [ ] Confirm `getDecryptedIntegration(integration.id)` is called before constructing provider

- [ ] Task 9: Update IntegrationsModule — register and export PMProviderFactory (AC: 15)
  - [ ] Add `PMProviderFactory` to `IntegrationsModule` `providers` array
  - [ ] Add `PMProviderFactory` to `IntegrationsModule` `exports` array

- [ ] Task 10: Update consuming NestJS modules to import IntegrationsModule (AC: 15)
  - [ ] `src/github/github.module.ts` — add `IntegrationsModule` to imports
  - [ ] `src/execution/execution.module.ts` — add `IntegrationsModule` to imports
  - [ ] `src/production-monitoring/production-monitoring.module.ts` — add `IntegrationsModule` to imports
  - [ ] `src/qa-automation/qa-automation.module.ts` — add `IntegrationsModule` to imports
  - [ ] `src/architecture-review/architecture-review.module.ts` — add `IntegrationsModule` to imports
  - [ ] `src/clickup/clickup.module.ts` — add `forwardRef(() => IntegrationsModule)` to imports (circular guard: IntegrationsModule already imports ClickUpModule)

- [ ] Task 11: Deprecate ClickUpService (AC: 16)
  - [ ] Add JSDoc `/** @deprecated Use PMProviderFactory.getProvider() + IPMProvider instead */` above `export class ClickUpService` in `src/clickup/clickup.service.ts`

- [ ] Task 12: Migrate eligible callers (AC: 17)
  - [ ] `src/github/services/deployment-status-sync.service.ts` — inject `ProjectIntegrationService` + `PMProviderFactory`; resolve projectId from `execution.ticket.project_id`; migrate `updateStatus()` + `addComment()`
  - [ ] `src/execution/ai-execution.consumer.ts` — inject `ProjectIntegrationService` + `PMProviderFactory`; use `payload.projectId`; migrate `addComment()`
  - [ ] `src/execution/self-healing-orchestrator.service.ts` — inject + migrate `updateStatus()` + `addComment()`
  - [ ] `src/qa-automation/production-approval/production-approval.service.ts` — inject + migrate ClickUp calls
  - [ ] `src/architecture-review/architecture-review-notification.service.ts` — inject + migrate `addComment()`
  - [ ] `src/github/services/github-error-monitor.service.ts` — inject + migrate `addComment()`
  - [ ] `src/production-monitoring/fix-ticket.service.ts` — inject + migrate `addComment()` ONLY; keep `ClickUpService` for `createTask()` (NOT in IPMProvider)
  - [ ] For all: add null-check guard: if `findByProjectAndProvider()` returns null → log warn + return (no crash)
  - [ ] **Do NOT touch**: `dependency-manager.service.ts`, `circular-dependency-detector.service.ts`, `project.service.ts`, `integrations.controller.ts` (see AC17 exclusions)

- [ ] Task 13: Partial polling orchestrator migration (AC: 18)
  - [ ] Inject `ProjectIntegrationService` into `ClickUpPollingOrchestrator`
  - [ ] Add `findAllByProvider(provider: IntegrationProvider): Promise<ProjectIntegration[]>` to `ProjectIntegrationService` if not present
  - [ ] Replace `prisma.project.findMany({ where: { provider: 'CLICKUP' } })` with `this.integrations.findAllByProvider(IntegrationProvider.CLICKUP)` — use `integration.provider_config` for `listId`
  - [ ] Keep `ClickUpService.getTasks()` for bulk polling (not in IPMProvider)
  - [ ] Use `PMProviderFactory.getProvider(integration)` then `provider.normalizeEvent(task)` to build IRawTaskEvent instead of inline mapping

- [ ] Task 14: Write unit tests (AC: 20)
  - [ ] Create `src/integrations/providers/clickup/clickup.provider.spec.ts`
  - [ ] **Check if `axios-mock-adapter` is in `package.json` before using it**. If absent, mock axios instance using `jest.spyOn`: `jest.spyOn(axios, 'create').mockReturnValue(mockAxiosInstance as any)` or expose the client for testing
  - [ ] Preferred fallback: pass a mock axios instance via constructor for testability — consider adding optional `httpClient?: AxiosInstance` to constructor
  - [ ] Test all 11 methods: happy path + error path + retry path
  - [ ] Test cache: `getStatuses` same listId twice within 5 min → only 1 HTTP call
  - [ ] Test `normalizeEvent` with a full ClickUp webhook payload sample (task present and task absent)
  - [ ] Test `getSelf` returns string id even when API returns integer

- [ ] Task 15: Type check and lint (AC: 19)
  - [ ] `pnpm typecheck` — zero errors
  - [ ] `pnpm lint` — zero ESLint violations

## Dev Notes

### Key Architecture Constraints

- **ClickUpProvider is NOT a NestJS injectable.** Plain TypeScript class. No `@Injectable()` decorator. Instantiated by `PMProviderFactory` per scope.
- **Token-based construction:** Factory calls `projectIntegrationService.getDecryptedIntegration(integration.id)` then `new ClickUpProvider(decryptedIntegration.access_token)`. Sole instantiation path.
- **Logger in non-injectable class:** `private readonly logger = new Logger(ClickUpProvider.name)` — must be set manually; no DI injection.
- **Auth header:** `Authorization: Bearer {accessToken}` — **must include `Bearer` prefix**. Legacy `ClickUpService` uses raw API key without Bearer. ClickUp OAuth tokens require Bearer.
- **Transient lifecycle:** New `ClickUpProvider` instance per `factory.getProvider()` call — intentional, tokens are workspace-scoped.
- **Interface contract:** Implement `IPMProvider` exactly as defined in CS0-2. No extra public methods, no missing ones. TypeScript must enforce this at compile time.

### Circular Module Dependency — Critical

`IntegrationsModule` currently imports `ClickUpModule`. `ClickUpModule` (via PollingOrchestrator) now needs `IntegrationsModule`. This creates a circular module reference. Resolution:

```typescript
// src/clickup/clickup.module.ts
@Module({
  imports: [
    forwardRef(() => IntegrationsModule), // ← add this with forwardRef
    DatabaseModule,
    SentryModule,
    AppMetricsModule,
    LoggerModule,
    RabbitMQModule,
    AuditLogModule,
  ],
  // ...
})
export class ClickUpModule {}
```

NestJS handles circular module deps via `forwardRef`. Do NOT use `forwardRef` for the other 5 modules (github, execution, etc.) — they only need a one-way import.

### ClickUp API Quick Reference

| Method            | HTTP   | Endpoint                         | Body                                |
| ----------------- | ------ | -------------------------------- | ----------------------------------- |
| getSelf           | GET    | `/user`                          | —                                   |
| getStatuses       | GET    | `/list/{listId}`                 | —                                   |
| getTask           | GET    | `/task/{taskId}`                 | —                                   |
| updateStatus      | PUT    | `/task/{taskId}`                 | `{status: statusName}`              |
| addComment        | POST   | `/task/{taskId}/comment`         | `{comment_text, notify_all: false}` |
| assignTask        | POST   | `/task/{taskId}/assignee`        | `{assignee: int}` ⚠️ verify         |
| getRequiredFields | GET    | `/list/{listId}/field`           | —                                   |
| setFieldValue     | POST   | `/task/{taskId}/field/{fieldId}` | `{value}`                           |
| registerWebhook   | POST   | `/team/{workspaceId}/webhook`    | `{endpoint, events[]}`              |
| deregisterWebhook | DELETE | `/webhook/{webhookId}`           | —                                   |

Base URL: `https://api.clickup.com/api/v2`

### Normalized DTO Mapping

DTOs are defined in CS0-2 at `src/integrations/providers/dto/`. Verify these fields exist exactly:

```typescript
// NormalizedStatus
{ id: s.id, name: s.status, color: s.color, type: s.type }
// Note: ClickUp response field is "status" (not "name") — s.status → name

// NormalizedTask — MUST include listId (add to DTO if CS0-2 omitted it)
{
  id: task.id,
  name: task.name,
  description: task.description || task.text_content || '',
  status: task.status?.status || '',
  url: task.url || `https://app.clickup.com/t/${task.id}`,
  listId: task.list?.id || '',   // required for caller status resolution
}

// NormalizedField (required fields only)
{
  id: field.id,
  name: field.name,
  type: field.type,
  required: true,
  options: field.type_config?.options?.map((o: {id:string;name:string}) => ({ id: o.id, name: o.name })) ?? [],
}
```

### normalizeEvent — IRawTaskEvent Mapping

**Source reference:** `src/projects/project.service.ts` → `syncFromClickUp()` method contains the authoritative `mapClickUpToTaskEvent` logic. The `ClickUpWebhookConsumerService` does NOT map to IRawTaskEvent — it publishes a simpler ClickUp-specific queue message.

```typescript
// ClickUp raw webhook payload (from IClickUpWebhookPayload in src/webhooks/interfaces/)
{
  webhook_id: string,
  event: string,        // "taskCreated" | "taskUpdated" | "taskStatusUpdated" | ...
  task_id: string,
  task?: IClickUpTask   // may be absent for deletion events
}

// IRawTaskEvent mapping:
import { v4 as uuid } from 'uuid';
import { IRawTaskEvent } from '../../ticket-intake/interfaces';

normalizeEvent(payload: unknown): IRawTaskEvent {
  const p = payload as IClickUpWebhookPayload;
  const task = p.task;
  return {
    correlationId: uuid(),
    webhookEventId: p.webhook_id ?? '',
    eventType: p.event ?? 'taskUpdated',
    taskId: p.task_id,
    taskName: task?.name ?? '',
    taskDescription: task?.description || task?.text_content || null,
    taskStatus: task?.status?.status ?? '',
    listId: task?.list?.id ?? '',
    listName: task?.list?.name ?? '',
    spaceId: task?.space?.id ?? '',
    projectId: task?.project?.id ?? '',
    projectName: task?.project?.name ?? '',
    taskUrl: task?.url ?? `https://app.clickup.com/t/${p.task_id}`,
    tags: task?.tags?.map((t) => t.name) ?? [],
    customFields: Object.fromEntries(
      (task?.custom_fields ?? []).map((f) => [f.name, f.value]),
    ),
    creatorEmail: task?.creator?.email ?? '',
    eventTimestamp: task?.date_updated ?? new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  };
}
```

### Caller Migration Pattern

**Pattern for callers that have projectId:**

```typescript
// BEFORE:
await this.clickup.updateStatus(taskId, 'Deployed', { correlationId });

// AFTER:
const integration = await this.integrations.findByProjectAndProvider(
  projectId,
  IntegrationProvider.CLICKUP,
);
if (!integration) {
  this.logger.warn('No ClickUp integration for project — skipping status update', { projectId });
  return;
}
const provider = await this.providerFactory.getProvider(integration);
await provider.updateStatus(taskId, 'Deployed'); // status name string for ClickUp v2
```

**Callers without projectId (dependency services — DO NOT MIGRATE):**
`DependencyManagerService` and `CircularDependencyDetectorService` only have `ticketId`. They also use `getTask()` to read `custom_fields` (dependency relationships), which is NOT in `NormalizedTask`. Do not touch these files.

**fix-ticket.service.ts — PARTIAL MIGRATION:**

```typescript
// Migrate addComment → IPMProvider
await provider.addComment(ticketId, message);

// createTask stays on ClickUpService — it is NOT in IPMProvider
await this.clickup.createTask(listId, data); // keep ClickUpService injected for this
```

### Polling Orchestrator Migration Detail

Current orchestrator queries:

```typescript
// BEFORE (queries Project table directly):
const projects = await this.prisma.project.findMany({
  where: { provider: 'CLICKUP', monitor_tasks: true, status: 'active' },
  select: { clickup_list_id: true },
});
```

After migration:

```typescript
// AFTER (queries ProjectIntegration table):
const integrations = await this.integrations.findAllByProvider(IntegrationProvider.CLICKUP);
// Each integration.provider_config contains { listId: string } (set during connect flow)

// Bulk task fetch STAYS on ClickUpService (not in IPMProvider):
const { tasks } = await this.clickupService.getTasks({ list_id: listId, ... });

// normalizeEvent via provider:
const provider = await this.providerFactory.getProvider(integration);
const rawEvent = provider.normalizeEvent({ task_id: task.id, event: 'taskUpdated', task });
```

### Retry Logic Pattern

Copy exactly from `src/clickup/clickup.service.ts`:

```typescript
private async retryWithBackoff<T>(
  operation: () => Promise<T>,
  correlationId: string,
): Promise<T> {
  let lastError: Error | null = null;
  const retryAttempts = 3;
  const retryBackoffMs = 1000;

  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      const axiosError = error as AxiosError;
      if (axiosError.response?.status === 429) {
        throw new Error('ClickUp rate limit exceeded');
      }
      if (!this.isRetryableError(axiosError) || attempt === retryAttempts) {
        throw error;
      }
      const delay = retryBackoffMs * Math.pow(2, attempt - 1);
      this.logger.warn(`ClickUp retry ${attempt}/${retryAttempts}`, { correlationId, delay });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError!;
}

private isRetryableError(error: AxiosError): boolean {
  if (!error.response) {
    return ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED'].includes(error.code ?? '');
  }
  return error.response.status >= 500 && error.response.status < 600;
}
```

### Testing Strategy

**First check if `axios-mock-adapter` is available:**

```bash
grep "axios-mock-adapter" package.json
```

If not present, use this testable constructor pattern instead (recommended):

```typescript
// Make provider testable by accepting optional axios instance
constructor(
  private readonly accessToken: string,
  private readonly baseURL = 'https://api.clickup.com/api/v2',
  httpClient?: AxiosInstance,
) {
  this.client = httpClient ?? axios.create({ ... });
}

// In tests:
const mockClient = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
const provider = new ClickUpProvider('test-token', undefined, mockClient as any);
```

```typescript
describe('ClickUpProvider', () => {
  describe('getSelf', () => {
    it('returns string id even when API returns integer');
    it('retries on 503 and succeeds on 2nd attempt');
    it('throws after 3 failed attempts');
    it('throws immediately on 429');
  });
  describe('getStatuses', () => {
    it('calls GET /list/{listId} and returns NormalizedStatus[]');
    it('maps status.status field to NormalizedStatus.name correctly');
    it('returns cached result on 2nd call within 5 min (no HTTP call)');
    it('makes new HTTP call after TTL expires');
  });
  describe('getTask', () => {
    it('returns NormalizedTask with listId populated');
    it('falls back description to text_content when description absent');
  });
  describe('updateStatus', () => {
    it('sends PUT with status name in body');
  });
  describe('addComment', () => {
    it('sends POST with comment_text and notify_all: false');
  });
  describe('assignTask', () => {
    it('sends assignee as integer');
  });
  describe('normalizeEvent', () => {
    it('maps full ClickUp webhook payload to IRawTaskEvent correctly');
    it('handles absent task field gracefully (all null-coalesced)');
    it('generates unique correlationId (uuid) for each call');
    it('maps string id from integer user id');
  });
});
```

### Files to Create

| File                                                          | Action |
| ------------------------------------------------------------- | ------ |
| `src/integrations/providers/clickup/clickup.provider.ts`      | CREATE |
| `src/integrations/providers/clickup/clickup.provider.spec.ts` | CREATE |

### Files to Modify

| File                                                                   | Change                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------- |
| `src/integrations/providers/pm-provider.factory.ts`                    | Register ClickUpProvider for CLICKUP              |
| `src/integrations/integrations.module.ts`                              | Add PMProviderFactory to providers + exports      |
| `src/clickup/clickup.module.ts`                                        | Add `forwardRef(() => IntegrationsModule)`        |
| `src/github/github.module.ts`                                          | Import IntegrationsModule                         |
| `src/execution/execution.module.ts`                                    | Import IntegrationsModule                         |
| `src/production-monitoring/production-monitoring.module.ts`            | Import IntegrationsModule                         |
| `src/qa-automation/qa-automation.module.ts`                            | Import IntegrationsModule                         |
| `src/architecture-review/architecture-review.module.ts`                | Import IntegrationsModule                         |
| `src/clickup/clickup.service.ts`                                       | Add @deprecated JSDoc                             |
| `src/clickup/clickup-polling-orchestrator.service.ts`                  | Inject integrations service; use normalizeEvent() |
| `src/github/services/deployment-status-sync.service.ts`                | Migrate updateStatus + addComment                 |
| `src/execution/ai-execution.consumer.ts`                               | Migrate addComment                                |
| `src/execution/self-healing-orchestrator.service.ts`                   | Migrate updateStatus + addComment                 |
| `src/production-monitoring/fix-ticket.service.ts`                      | Migrate addComment only                           |
| `src/qa-automation/production-approval/production-approval.service.ts` | Migrate ClickUp calls                             |
| `src/architecture-review/architecture-review-notification.service.ts`  | Migrate addComment                                |
| `src/github/services/github-error-monitor.service.ts`                  | Migrate addComment                                |

**DO NOT MODIFY:**

- `src/dependencies/dependency-manager.service.ts`
- `src/dependencies/circular-dependency-detector.service.ts`
- `src/projects/project.service.ts`
- `src/integrations/integrations.controller.ts`

### Previous Story Learnings (CS0-1 & CS0-2)

**From CS0-1 (DONE):**

- `ProjectIntegrationService` → `src/integrations/project-integration.service.ts`
- `getDecryptedIntegration(id)` → returns plaintext tokens; use `access_token` for provider construction
- `findByProjectAndProvider(projectId, provider)` → returns `ProjectIntegration | null`
- `IntegrationProvider` enum (CLICKUP, JIRA, ASANA) → from `@prisma/client`
- `@@unique([project_id, provider])` — one integration per provider per project

**From CS0-2 (must be done before CS0-3):**

- Confirm CS0-2 is `done` in sprint-status.yaml before starting
- `IPMProvider` interface → `src/integrations/providers/pm-provider.interface.ts`
- Normalized DTOs → `src/integrations/providers/dto/`
- `PMProviderFactory` → `src/integrations/providers/pm-provider.factory.ts`
- `UnsupportedProviderException` → `src/common/exceptions/`
- `NormalizedTask` must have `listId` field — if CS0-2 omitted it, add it now (required for callers to resolve status IDs by name)
- Token refresh (within 5 min of expiry) handled in PMProviderFactory — no need to implement in ClickUpProvider

### Dependency Order

**CS0-2 must be `done` before starting CS0-3.** Required artifacts:

- `src/integrations/providers/pm-provider.interface.ts` — interface to implement
- `src/integrations/providers/dto/` — normalized DTOs to use
- `src/integrations/providers/pm-provider.factory.ts` — factory to register in

### References

- [Source: _bmad-output/planning-artifacts/epics-clickup-smart-sync.md#Story 0.3]
- [normalizeEvent mapping source: src/projects/project.service.ts#syncFromClickUp lines ~421-447]
- [IRawTaskEvent: src/ticket-intake/interfaces/ticket-intake.interface.ts]
- [IClickUpWebhookPayload: src/webhooks/interfaces/clickup-webhook.interface.ts]
- [Retry pattern: src/clickup/clickup.service.ts]
- [ProjectIntegrationService: src/integrations/project-integration.service.ts]
- [IntegrationsModule: src/integrations/integrations.module.ts]
- [ClickUpModule: src/clickup/clickup.module.ts]
- [IPMProvider interface: src/integrations/providers/pm-provider.interface.ts] (CS0-2)
- [Normalized DTOs: src/integrations/providers/dto/] (CS0-2)
- [PMProviderFactory: src/integrations/providers/pm-provider.factory.ts] (CS0-2)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
