# Story CS1.3: ai_trigger_status Field and Sync-Config API

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **DSF system**,
I want each PM tool integration to store the status name that triggers AI processing,
so that each team's workflow drives execution — not a global hardcoded value.

## Acceptance Criteria

### AC1 — `ai_trigger_status` field confirmed in schema (no migration needed)

- `ai_trigger_status String?` field exists on `ProjectIntegration` at `prisma/schema.prisma:1278`
- **No Prisma migration is required** — the field was added in CS0-1 (`prisma/migrations/`)
- Field is nullable (`String?`) — null means "not yet configured by PM"

### AC2 — `GET /api/v1/projects/:id/integrations` lists project integrations

- New endpoint `GET /api/v1/projects/:id/integrations` added to `ProjectController`
- Returns all `ProjectIntegration` records for the project via `prisma.projectIntegration.findMany({ where: { project_id: id } })` (use `PrismaService` directly in the controller method, or add `findByProjectId()` to `ProjectIntegrationService`)
- Response is an **array** of `SyncConfigResponseDto` (see Dev Notes — same DTO used by AC3/AC4)
- Returns empty array `[]` if no integrations found (not 404)
- Protected by `JwtAuthGuard`, `RolesGuard`, `ThrottlerGuard`; roles: `PM`, `MANAGER`, `ADMIN`
- **Why:** The CS0-7 frontend (`dsf-dasbhoard/src/api/integrationsApi.ts:29`) calls `GET /projects/:projectId/integrations` to display connected integrations in `PmIntegrationPanel`. Without this endpoint the panel renders empty/loading forever. This is the GET counterpart that makes AC5 (`PATCH sync-settings`) actually visible in the UI.

### AC3 — `GET /api/v1/projects/:id/integration/sync-config` returns sync configuration

- New endpoint `GET /api/v1/projects/:id/integration/sync-config` added to `ProjectController`
- Looks up the project's CLICKUP `ProjectIntegration` via `ProjectIntegrationService.findByProjectAndProvider(id, IntegrationProvider.CLICKUP)`
- Returns `SyncConfigResponseDto` (see Dev Notes for shape)
- Protected by `JwtAuthGuard`, `RolesGuard`, `ThrottlerGuard`; roles: `PM`, `MANAGER`, `ADMIN`
- Returns HTTP 404 with `{ message: 'No CLICKUP integration found for project <id>' }` if no integration exists

### AC4 — `PATCH /api/v1/projects/:id/integration/sync-config` updates `ai_trigger_status`

- New endpoint `PATCH /api/v1/projects/:id/integration/sync-config` added to `ProjectController`
- Accepts `UpdateSyncConfigDto` — see Dev Notes for DTO pattern with null support
- Validates: if `ai_trigger_status` is a non-null string, it must be non-empty (empty string → 400)
- Updates `ProjectIntegration.ai_trigger_status` via `ProjectIntegrationService.updateIntegration(integration.id, { ai_trigger_status })`
- Returns the updated `SyncConfigResponseDto` — use the shared `toSyncConfigResponse()` helper (see Dev Notes)
- Returns HTTP 404 if no integration found
- Protected by `JwtAuthGuard`, `RolesGuard`, `ThrottlerGuard`; roles: `PM`, `MANAGER`, `ADMIN`

### AC5 — `PATCH /api/v1/integrations/:id/sync-settings` updates polling/webhook settings

- New endpoint `PATCH /api/v1/integrations/:id/sync-settings` added to `IntegrationsController`
- `:id` is `ProjectIntegration.id` (UUID)
- Accepts `UpdateSyncSettingsDto`:
  ```typescript
  {
    polling_enabled: boolean;
    polling_interval_min: number;
    webhook_enabled: boolean;
  }
  ```

  - `polling_interval_min`: `@IsInt()`, `@Min(1)`, `@Max(1440)`
- Updates via `ProjectIntegrationService.updateIntegration(id, dto)`
- Returns the updated record mapped to `SyncConfigResponseDto` (no tokens in response)
- Returns HTTP 404 if integration not found (catch Prisma `P2025` — see Dev Notes)
- Protected by `JwtAuthGuard`, `RolesGuard`, `ThrottlerGuard`; roles: `PM`, `MANAGER`, `ADMIN`
- **Why:** CS0-7 frontend calls `PATCH /integrations/:id/sync-settings` with `{ polling_enabled, polling_interval_min, webhook_enabled }`. Backend endpoint was never implemented. Without it, saving sync settings silently fails.
- **Response shape:** Return **snake_case** fields. Frontend (`PmIntegrationPanel.tsx:64`) reads `newData.polling_enabled` (snake_case) from the response and maps to its camelCase state. No field-case transformation is needed in the backend.

### AC6 — `ClickUpTaskUpdateConsumer.handleTaskUpdate()` gates ALL task processing by `ai_trigger_status`

- `ProjectIntegrationService` is injected into `ClickUpTaskUpdateConsumer` — add to constructor with `@Inject(forwardRef(() => ProjectIntegrationService))` (see Dev Notes for circular dep resolution)
- Add `IntegrationProvider` to the existing `@/prisma/client` import in the consumer
- The gate is placed **at the very top of `handleTaskUpdate()`**, immediately after the project is resolved and confirmed non-null — **before the ticket lookup** (`prisma.ticket.findUnique`)
- When gate fails, the function **returns early** — no ticket is created, no DB update happens, no queue publish. Tasks not at trigger status are completely discarded (FR-CS20: "silently discarded")
- Gate logic (4 cases):
  1. Load: `ProjectIntegrationService.findByProjectAndProvider(project.id, IntegrationProvider.CLICKUP)`
  2. **No integration:** log `warn` → return (proceed without gate — no CLICKUP integration means no per-project config; discard task silently)
  3. **Integration found, `ai_trigger_status` is null:** log `warn` `"project {projectId} integration has no ai_trigger_status configured — all tasks skipped. PM must set the trigger status in project settings"` → return
  4. **Integration found, status mismatch** (`message.status.toLowerCase() !== integration.ai_trigger_status.toLowerCase()`): log `debug` `"task {taskId} status '{status}' — not at trigger '{ai_trigger_status}', skipping"` → return
  5. **Status matches (case-insensitive):** fall through to existing ticket lookup / create / queue publish

### AC7 — Unit tests

**`ClickUpTaskUpdateConsumer` (update `src/clickup/clickup-task-update.consumer.spec.ts`):**

- No integration found → returns early, warn logged, no ticket lookup called
- Integration found, `ai_trigger_status` null → returns early, warn logged, no ticket lookup
- Integration found, status mismatch → returns early, debug logged, no ticket lookup
- Integration found, status matches exactly → ticket lookup proceeds, queue publish called
- Integration found, status matches with different casing (e.g., `"IN REVIEW"` vs `"in review"`) → queue publish called

**`ProjectController` (update `src/projects/project.controller.spec.ts`):**

- `GET :id/integrations` → 200 array with integration data
- `GET :id/integrations` → 200 empty array when none found
- `GET :id/integration/sync-config` → 200 with correct `SyncConfigResponseDto` shape
- `GET :id/integration/sync-config` → 404 when no CLICKUP integration
- `PATCH :id/integration/sync-config` with valid string → 200 updated
- `PATCH :id/integration/sync-config` with `ai_trigger_status: null` → 200 cleared
- `PATCH :id/integration/sync-config` with `ai_trigger_status: ""` → 400

**`IntegrationsController` (update `src/integrations/integrations.controller.spec.ts`):**

- `PATCH :id/sync-settings` with valid data → 200 updated
- `PATCH :id/sync-settings` with `polling_interval_min: 0` → 400
- `PATCH :id/sync-settings` with `polling_interval_min: 1441` → 400
- `PATCH :id/sync-settings` with unknown `id` → 404

### AC8 — TypeScript clean

- `pnpm typecheck` passes with zero errors
- `pnpm lint` passes with zero warnings/errors
- `pnpm test` — all existing tests pass + new tests pass

## Tasks / Subtasks

- [ ] Task 1: Create `UpdateSyncConfigDto` at `src/projects/dto/update-sync-config.dto.ts` (AC4)
  - [ ] Use `@Transform` + `@IsOptional()` + `@IsString()` + `@MinLength(1)` — see Dev Notes for exact pattern
  - [ ] Add `@ApiPropertyOptional()` decorator
- [ ] Task 2: Create `SyncConfigResponseDto` at `src/projects/dto/sync-config-response.dto.ts` (AC2–AC5)
  - [ ] Fields: `id`, `provider`, `ai_trigger_status`, `polling_enabled`, `polling_interval_min`, `webhook_enabled`, `webhook_id`
  - [ ] Add `@ApiProperty()` on all fields — follow `src/projects/dto/create-project.dto.ts` pattern
  - [ ] Add shared `toSyncConfigResponse(integration: ProjectIntegration): SyncConfigResponseDto` helper (plain function in same file)
- [ ] Task 3: Add `ProjectIntegrationService.findByProjectId()` method (AC2)
  - [ ] `findByProjectId(projectId: string): Promise<ProjectIntegration[]>` using `prisma.projectIntegration.findMany({ where: { project_id: projectId } })`
  - [ ] Add to `src/integrations/project-integration.service.ts`
- [ ] Task 4: Import `IntegrationsModule` into `ProjectModule` and add endpoints to `ProjectController` (AC2–AC4)
  - [ ] Add `IntegrationsModule` to `src/projects/project.module.ts` imports (no forwardRef needed)
  - [ ] Inject `ProjectIntegrationService` into `ProjectController` constructor
  - [ ] Add `GET :id/integrations` — calls `integrationService.findByProjectId(id)`, maps each with `toSyncConfigResponse()`
  - [ ] Add `GET :id/integration/sync-config` — calls `findByProjectAndProvider(id, IntegrationProvider.CLICKUP)`, throws 404 if null
  - [ ] Add `PATCH :id/integration/sync-config` — validates dto, calls `updateIntegration()`, returns `toSyncConfigResponse()`
  - [ ] Add Swagger decorators on all 3 handlers
  - [ ] Import `IntegrationProvider` from `@prisma/client` in `project.controller.ts`
- [ ] Task 5: Create `UpdateSyncSettingsDto` at `src/integrations/dto/update-sync-settings.dto.ts` (AC5)
  - [ ] `polling_enabled: boolean` — `@IsBoolean()`, `@ApiProperty()`
  - [ ] `polling_interval_min: number` — `@IsInt()`, `@Min(1)`, `@Max(1440)`, `@ApiProperty()`
  - [ ] `webhook_enabled: boolean` — `@IsBoolean()`, `@ApiProperty()`
- [ ] Task 6: Add `PATCH :id/sync-settings` to `IntegrationsController` (AC5)
  - [ ] Inject `ProjectIntegrationService` into `IntegrationsController` constructor
  - [ ] Add handler — call `updateIntegration(id, dto)`, catch `P2025` → 404, return `toSyncConfigResponse()`
  - [ ] Import `toSyncConfigResponse` from `src/projects/dto/sync-config-response.dto.ts`
  - [ ] Add Swagger decorators
- [ ] Task 7: Resolve circular dep + inject `ProjectIntegrationService` into `ClickUpTaskUpdateConsumer` (AC6)
  - [ ] Wrap `ClickUpModule` import in `src/integrations/integrations.module.ts` with `forwardRef()`
  - [ ] Add `forwardRef(() => IntegrationsModule)` to `src/clickup/clickup.module.ts` imports
  - [ ] Add `@Inject(forwardRef(() => ProjectIntegrationService)) private readonly integrationService: ProjectIntegrationService` to consumer constructor
  - [ ] Add `IntegrationProvider` to the `@/prisma/client` import line in `clickup-task-update.consumer.ts`
- [ ] Task 8: Add gate logic to `handleTaskUpdate()` (AC6)
  - [ ] Place gate immediately after `if (!project) return` (before `prisma.ticket.findUnique`)
  - [ ] Implement all 4 gate cases — see Dev Notes for exact code
  - [ ] Gate returns early on failure: no ticket lookup, no DB create/update, no queue publish
- [ ] Task 9: Write and update unit tests (AC7)
  - [ ] Update `clickup-task-update.consumer.spec.ts` — 5 gate tests; add `mockIntegrationService` to test module (see Dev Notes)
  - [ ] Update `project.controller.spec.ts` — 7 endpoint tests
  - [ ] Update `integrations.controller.spec.ts` — 4 endpoint tests
- [ ] Task 10: Verify build (AC8)
  - [ ] `pnpm typecheck` — zero errors
  - [ ] `pnpm lint` — zero errors
  - [ ] `pnpm test` — all tests pass

## Dev Notes

### No Prisma Migration Required

`ai_trigger_status String?` was added in CS0-1. Field is at `prisma/schema.prisma:1278`. Do **not** create a new migration. Confirm with `pnpm db:validate`.

### Module Architecture: Circular Dependency Between ClickUpModule and IntegrationsModule

**Current state:**

```
IntegrationsModule → imports ClickUpModule (for ClickUpService)
ClickUpModule      → does NOT import IntegrationsModule
```

**Required state after CS1-3:**

```
IntegrationsModule → imports forwardRef(() => ClickUpModule)
ClickUpModule      → imports forwardRef(() => IntegrationsModule)  ← NEW
```

`src/integrations/integrations.module.ts` — wrap existing `ClickUpModule` import:

```typescript
import { Module, forwardRef } from '@nestjs/common';
imports: [forwardRef(() => ClickUpModule), DatabaseModule, EncryptionModule],
```

`src/clickup/clickup.module.ts` — add `IntegrationsModule`:

```typescript
import { Module, forwardRef } from '@nestjs/common';
imports: [
  DatabaseModule, SentryModule, AppMetricsModule, LoggerModule, RabbitMQModule, AuditLogModule,
  forwardRef(() => IntegrationsModule), // NEW
],
```

`ClickUpTaskUpdateConsumer` constructor — use `@Inject(forwardRef(...))` on the new param:

```typescript
import { Inject, forwardRef } from '@nestjs/common';
import { IntegrationProvider } from '@/prisma/client'; // ADD to existing TicketStatus import line

constructor(
  private readonly rabbitMQService: RabbitMQService,
  private readonly prisma: PrismaService,
  private readonly loggerService: LoggerService,
  private readonly metrics: MetricsService,
  private readonly sentry: SentryService,
  private readonly audit: AuditLogService,
  private readonly clickup: ClickUpService,
  private readonly config: ConfigService,
  @Inject(forwardRef(() => ProjectIntegrationService))
  private readonly integrationService: ProjectIntegrationService, // NEW
) { super(); }
```

### ProjectModule: Safe Direct Import of IntegrationsModule

`IntegrationsModule` does NOT import `ProjectModule`, so no circular dep exists:

```typescript
// src/projects/project.module.ts
imports: [
  DatabaseModule,
  forwardRef(() => ClickUpModule),  // unchanged
  AIDecisionLoggerModule,
  IntegrationsModule,               // NEW
],
```

### Gate Logic: Complete Discard Before Ticket Lookup

**Place the gate immediately after `project` is confirmed non-null and BEFORE `prisma.ticket.findUnique`.** Per FR-CS20, tasks not at trigger status are "silently discarded" — this means NO DB create, NO DB update, NO queue publish.

```typescript
// CS1-3: ai_trigger_status gate (FR-CS20) — place after project resolved, before ticket lookup
const integration = await this.integrationService.findByProjectAndProvider(
  project.id,
  IntegrationProvider.CLICKUP,
);

if (!integration) {
  this.loggerService.warn('project has no CLICKUP integration — all tasks discarded', {
    projectId: project.id,
    taskId: message.task_id,
  });
  return;
}

if (!integration.ai_trigger_status) {
  this.loggerService.warn(
    'integration has no ai_trigger_status configured — all tasks skipped. PM must set the trigger status in project settings',
    { projectId: project.id, taskId: message.task_id },
  );
  return;
}

if (message.status.toLowerCase() !== integration.ai_trigger_status.toLowerCase()) {
  this.loggerService.debug(
    `task ${message.task_id} status '${message.status}' — not at trigger '${integration.ai_trigger_status}', skipping`,
  );
  return;
}

// Gate passed — status matches trigger; proceed to ticket lookup / create / queue publish
```

### CS1-1 Interaction — What to Expect If It Has Already Landed

CS1-1 (`ready-for-dev`, may land before or after CS1-3) removes `mapClickUpStatusToTicketStatus()` from `ClickUpTaskUpdateConsumer` (lines ~357–369) and stubs the status-update block (lines ~282–319) to use `'QUEUED'`. If CS1-1 has already been merged when you implement CS1-3:

- `mapClickUpStatusToTicketStatus()` no longer exists — do not reference it
- The status update block (lines 282–319) may already be modified — that's fine; CS1-3's gate at the top of the function supersedes it
- CS1-3's gate does not depend on `mapClickUpStatusToTicketStatus()` at all — the gate is independent

If CS1-1 has NOT landed: the gate still works correctly alongside the existing status map code.

### `UpdateSyncConfigDto` — Null-Safe Pattern Using `@Transform`

The project uses `@Transform` in DTOs (see `src/projects/dto/create-project.dto.ts:16`). Use the same approach — cleaner than `@ValidateIf`:

```typescript
import { IsString, IsOptional, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSyncConfigDto {
  @ApiPropertyOptional({
    description: 'Status name that triggers AI processing. Pass null to clear.',
    example: 'In Review',
    nullable: true,
  })
  @Transform(({ value }) => (value === '' ? null : value)) // treat "" same as null
  @IsOptional() // skips validation for null and undefined
  @IsString()
  @MinLength(1, { message: 'ai_trigger_status must be a non-empty string or null' })
  ai_trigger_status?: string | null;
}
```

`ValidationPipe` in `app.module.ts` is configured with `transform: true` + `whitelist: true` globally — `@Transform` and class-validator decorators work without any extra setup.

### `SyncConfigResponseDto` — Shared DTO and Mapping Helper

Used by GET and PATCH sync-config (AC3/AC4), GET integrations (AC2), and PATCH sync-settings (AC5). Define it once with a shared mapping helper to avoid field-pick duplication across 4 handlers:

```typescript
import { ApiProperty } from '@nestjs/swagger';
import { ProjectIntegration } from '@prisma/client';

export class SyncConfigResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() provider!: string;
  @ApiProperty({ nullable: true }) ai_trigger_status!: string | null;
  @ApiProperty() polling_enabled!: boolean;
  @ApiProperty() polling_interval_min!: number;
  @ApiProperty() webhook_enabled!: boolean;
  @ApiProperty({ nullable: true }) webhook_id!: string | null;
}

export function toSyncConfigResponse(i: ProjectIntegration): SyncConfigResponseDto {
  return {
    id: i.id,
    provider: String(i.provider),
    ai_trigger_status: i.ai_trigger_status,
    polling_enabled: i.polling_enabled,
    polling_interval_min: i.polling_interval_min,
    webhook_enabled: i.webhook_enabled,
    webhook_id: i.webhook_id ?? null,
  };
}
```

Import `toSyncConfigResponse` in both `ProjectController` and `IntegrationsController`.

**Response is snake_case.** The CS0-7 frontend reads snake_case from the response (`newData.polling_enabled`, `newData.polling_interval_min`) — no camelCase transformation needed in the backend.

### `IntegrationsController` — 404 Handling for `PATCH :id/sync-settings`

`updateIntegration()` calls `prisma.projectIntegration.update()` which throws `P2025` if the record doesn't exist:

```typescript
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

try {
  const updated = await this.integrationService.updateIntegration(id, dto);
  return toSyncConfigResponse(updated);
} catch (error) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
    throw new NotFoundException(`Integration ${id} not found`);
  }
  throw error;
}
```

### Test Setup for `ClickUpTaskUpdateConsumer` Spec

The consumer has 9 injected dependencies (8 existing + 1 new `ProjectIntegrationService`). Add the mock to the existing test module setup:

```typescript
const mockIntegrationService = {
  findByProjectAndProvider: jest.fn(),
};

// In the TestingModule providers array:
{ provide: ProjectIntegrationService, useValue: mockIntegrationService }

// In beforeEach — reset:
mockIntegrationService.findByProjectAndProvider.mockReset();
```

Gate test cases:

```typescript
// Case: no integration → early return
mockIntegrationService.findByProjectAndProvider.mockResolvedValue(null);
// assert: prisma.ticket.findUnique NOT called, rabbitMQService.publishToQueue NOT called

// Case: null trigger status → early return
mockIntegrationService.findByProjectAndProvider.mockResolvedValue({ ai_trigger_status: null });
// assert: ticket lookup NOT called

// Case: status mismatch → early return
mockIntegrationService.findByProjectAndProvider.mockResolvedValue({
  ai_trigger_status: 'In Review',
});
// message.status = 'in progress' → ticket lookup NOT called

// Case: exact match → proceeds
mockIntegrationService.findByProjectAndProvider.mockResolvedValue({
  ai_trigger_status: 'In Review',
});
// message.status = 'In Review' → ticket lookup called, publish called

// Case: case-insensitive match → proceeds
mockIntegrationService.findByProjectAndProvider.mockResolvedValue({
  ai_trigger_status: 'in review',
});
// message.status = 'IN REVIEW' → ticket lookup called, publish called
```

### Frontend Endpoint Mapping

| Frontend call                                 | Backend AC | Status                             |
| --------------------------------------------- | ---------- | ---------------------------------- |
| `GET /projects/:id/integrations`              | AC2        | NEW — unblocks CS0-7 panel listing |
| `GET /projects/:id/integration/sync-config`   | AC3        | NEW — used by CS1-4 picker         |
| `PATCH /projects/:id/integration/sync-config` | AC4        | NEW — used by CS1-4 picker         |
| `PATCH /integrations/:id/sync-settings`       | AC5        | NEW — unblocks CS0-7 save mutation |

### Dependency on CS1-1 and CS1-2

- **CS1-1** (`ready-for-dev`): Removes `mapClickUpStatusToTicketStatus()` from the consumer. CS1-3's gate is independent and placed before the code CS1-1 modifies. Safe to merge in any order.
- **CS1-2** (`ready-for-dev`): Adds `PMStatusService`. No dependency from CS1-3.

### Project Structure Notes

All new/modified files for this story:

| File                                               | Change Type                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/projects/dto/update-sync-config.dto.ts`       | NEW — `UpdateSyncConfigDto`                                                 |
| `src/projects/dto/sync-config-response.dto.ts`     | NEW — `SyncConfigResponseDto` + `toSyncConfigResponse()`                    |
| `src/projects/project.controller.ts`               | MODIFY — 3 new endpoints + inject `ProjectIntegrationService`               |
| `src/projects/project.module.ts`                   | MODIFY — add `IntegrationsModule` to imports                                |
| `src/integrations/project-integration.service.ts`  | MODIFY — add `findByProjectId()` method                                     |
| `src/integrations/dto/update-sync-settings.dto.ts` | NEW — `UpdateSyncSettingsDto`                                               |
| `src/integrations/integrations.controller.ts`      | MODIFY — add `PATCH :id/sync-settings` + inject `ProjectIntegrationService` |
| `src/integrations/integrations.module.ts`          | MODIFY — wrap `ClickUpModule` with `forwardRef()`                           |
| `src/clickup/clickup.module.ts`                    | MODIFY — add `forwardRef(() => IntegrationsModule)`                         |
| `src/clickup/clickup-task-update.consumer.ts`      | MODIFY — inject service, add `IntegrationProvider` import, add gate         |
| `src/projects/project.controller.spec.ts`          | MODIFY — add 7 tests                                                        |
| `src/integrations/integrations.controller.spec.ts` | MODIFY — add 4 tests                                                        |
| `src/clickup/clickup-task-update.consumer.spec.ts` | MODIFY — add mock + 5 gate tests                                            |

**Do NOT touch:**

- `prisma/schema.prisma` — field already exists; no migration
- `src/integrations/providers/` — provider implementations; unchanged
- `src/webhooks/webhooks.service.ts` — full webhook gate is CS1-6

### References

- Epic CS1 spec + Story 1.3: [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #Story 1.3]
- FR-CS6 (`ai_trigger_status` field): [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #FR-CS6]
- FR-CS20 (development gate — complete discard): [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #FR-CS20]
- Sprint status: [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml` #CS1-3]
- CS1-1 story: [Source: `_bmad-output/implementation-artifacts/CS1-1-remove-hardcoded-status-maps.md`]
- CS1-2 story: [Source: `_bmad-output/implementation-artifacts/CS1-2-status-discovery-service.md`]
- `ProjectIntegration` schema: [Source: `prisma/schema.prisma:1260–1287`]
- `ProjectIntegrationService`: [Source: `src/integrations/project-integration.service.ts`]
- `IntegrationsModule`: [Source: `src/integrations/integrations.module.ts`]
- `IntegrationsController`: [Source: `src/integrations/integrations.controller.ts`]
- `ProjectController`: [Source: `src/projects/project.controller.ts`]
- `ProjectModule`: [Source: `src/projects/project.module.ts`]
- `ClickUpModule`: [Source: `src/clickup/clickup.module.ts`]
- `ClickUpTaskUpdateConsumer` constructor + `handleTaskUpdate()`: [Source: `src/clickup/clickup-task-update.consumer.ts:36–351`]
- Global `ValidationPipe` config (`transform: true`, `whitelist: true`): [Source: `src/app.module.ts:195–204`]
- `@Transform` DTO pattern: [Source: `src/projects/dto/create-project.dto.ts:16,31`]
- `@ValidateIf` DTO pattern: [Source: `src/projects/dto/update-project-status.dto.ts`]
- Frontend `getPmIntegrations()` (`GET /projects/:id/integrations`): [Source: `dsf-dasbhoard/src/api/integrationsApi.ts:29`]
- Frontend `updateSyncSettings()` (`PATCH /integrations/:id/sync-settings`): [Source: `dsf-dasbhoard/src/api/integrationsApi.ts:53`]
- Frontend `PmIntegrationPanel` (snake_case response mapping): [Source: `dsf-dasbhoard/src/pages/settings/panels/PmIntegrationPanel.tsx:64`]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
