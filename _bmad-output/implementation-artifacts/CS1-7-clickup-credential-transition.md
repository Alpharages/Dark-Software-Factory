# Story CS1.7: ClickUp Credential Transition

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **platform operator**,
I want the CLICKUP_API_KEY env var to be fully removed as a required config and the legacy ClickUpPollingOrchestrator to be deleted,
so that new deployments run purely on OAuth-based ProjectIntegration credentials without any legacy API key bootstrapping requirement.

## Acceptance Criteria

### AC1 — Delete `ClickUpPollingOrchestrator` (legacy service + spec)

**Given** `PmPollingOrchestrator` (CS0-8) fully replaces the per-project polling loop
**When** CS1-7 is implemented
**Then** `src/clickup/clickup-polling-orchestrator.service.ts` is **deleted**
**And** `src/clickup/clickup-polling-orchestrator.service.spec.ts` is **deleted**
**And** `src/clickup/clickup.module.ts` no longer imports, provides, or exports `ClickUpPollingOrchestrator`

### AC2 — Remove `CLICKUP_API_KEY` required validation from `env.validation.ts`

**Given** OAuth tokens are now stored in `ProjectIntegration` (CS0-1, CS0-5) and accessed via `PMProviderFactory`
**When** CS1-7 is implemented
**Then** the line `CLICKUP_API_KEY: Joi.string().required()` in `src/config/env.validation.ts` is removed entirely
**And** the comment `// ClickUp Integration (REQUIRED)` is updated to `// ClickUp Integration (Legacy — CLICKUP_API_KEY removed; OAuth via ProjectIntegration)`
**And** startup no longer fails if `CLICKUP_API_KEY` is absent from the environment

### AC3 — Remove `CLICKUP_API_KEY` from `configuration.ts` and handle `ticket-intake.service.ts` dependency

**Given** `configuration.ts` exposes `clickup.apiKey: process.env.CLICKUP_API_KEY || ''`
**And** `src/ticket-intake/ticket-intake.service.ts:82` reads this via `configService.get<string>('clickup.apiKey') || ''` and uses it as an `Authorization` header for a direct ClickUp API call at line 636 (guarded by `if (!this.clickupApiKey)` at line 627)
**When** CS1-7 is implemented
**Then** the `apiKey` field is removed from the `clickup` config block in `src/config/configuration.ts`
**And** `configService.get<string>('clickup.apiKey')` in `ticket-intake.service.ts` returns `undefined` → `|| ''` → `this.clickupApiKey = ''`
**And** the existing guard `if (!this.clickupApiKey)` at line 627 prevents the direct API call from executing (empty string is falsy) — graceful degradation with no crash
**And** the comment describing CLICKUP_API_KEY in `configuration.ts` is updated to note it was removed in CS1-7
**And** `src/ticket-intake/ticket-intake.service.spec.ts:100` mocks `if (key === 'clickup.apiKey') return ''` — this remains valid (returns `''`) and needs no change

### AC4 — `ClickUpService` degrades gracefully when API key is absent

**Given** `ClickUpService` constructor currently throws `'CLICKUP_API_KEY is required but not configured in environment'`
**And** `ClickUpService` is still used by: `ai-execution.consumer.ts`, `deployment-status-sync.service.ts`, `fix-ticket.service.ts`, `production-approval.service.ts`, and `architecture-review/` tests
**When** `CLICKUP_API_KEY` is not set in the environment
**Then** the constructor emits a `warn` log: `'[CS1-7] CLICKUP_API_KEY not configured — ClickUpService is in legacy mode. All API calls will throw. Migrate to ProjectIntegration OAuth (CS0-5).'`
**And** does NOT throw on construction
**And** the `AxiosInstance` (`this.client`) is set to `null` when the API key is absent
**And** a private `assertClient()` method is added (defined after the constructor, before the first public method) that throws `'ClickUpService: no API key configured. Use ProjectIntegration OAuth via PMProviderFactory instead.'` when `this.client` is null
**And** `assertClient()` is called as the first line of each of these public methods: `updateStatus()`, `addComment()`, `getTasks()`, `createTask()`, `getHierarchy()` — and any other public methods that use `this.client`

### AC5 — `clickup.service.spec.ts` updated to match new graceful behavior

**Given** test `'should throw error if CLICKUP_API_KEY is missing (C5 fix)'` expects constructor throw
**When** CS1-7 changes the constructor to warn instead of throw
**Then** this test is updated to assert: `warn` log emitted AND `service.client` is null AND no throw occurs
**And** the test name is updated to `'should warn and set client to null when CLICKUP_API_KEY is missing (CS1-7 graceful degradation)'`

### AC6 — Startup warning if no OAuth integrations AND no legacy key

**Given** the application starts
**When** both conditions are true:

- `CLICKUP_API_KEY` is absent from env
- No `ProjectIntegration` records exist in the database (OAuth not yet configured)
  **Then** a `warn` log is emitted via a `StartupChecksService` (new file: `src/common/startup/startup-checks.service.ts`):
  `'[CS1-7] WARNING: No CLICKUP_API_KEY set and no ProjectIntegration OAuth records found. ClickUp functionality is unavailable until a project connects via OAuth (/api/v1/integrations/:projectId/clickup/connect).'`
  **And** `StartupChecksService` implements `OnApplicationBootstrap` and is provided by a `StartupChecksModule` imported in `AppModule`
  **And** the application still starts successfully — this is a warning, not a fatal error

### AC7 — No legacy env-var references remain in active code paths

**Given** the codebase post-CS1-7
**When** `grep -r "CLICKUP_API_KEY" src/` is run (excluding test files and comments)
**Then** no active code path reads or depends on `CLICKUP_API_KEY`
**And** only tombstone/migration comments referencing it are acceptable

### AC8 — TypeScript clean

- `pnpm typecheck` — zero errors
- `pnpm lint` — zero warnings/errors
- `pnpm test` — all tests pass (updated specs green)

---

## Tasks / Subtasks

- [ ] **Task 1**: Delete `ClickUpPollingOrchestrator` (AC1)
  - [ ] Delete file: `src/clickup/clickup-polling-orchestrator.service.ts`
  - [ ] Delete file: `src/clickup/clickup-polling-orchestrator.service.spec.ts`
  - [ ] Edit `src/clickup/clickup.module.ts`:
    - Remove import of `ClickUpPollingOrchestrator`
    - Remove from `providers: [...]`
    - Remove from `exports: [...]`
  - [ ] Check if `ClickUpPollingOrchestrator` is imported anywhere else (it is NOT — only in `clickup.module.ts`)

- [ ] **Task 2**: Remove `CLICKUP_API_KEY` from env validation (AC2)
  - [ ] Edit `src/config/env.validation.ts`:
    - Remove line: `CLICKUP_API_KEY: Joi.string().required(),`
    - Update comment from `// ClickUp Integration (REQUIRED)` to `// ClickUp Integration (Legacy — CLICKUP_API_KEY removed CS1-7; OAuth via ProjectIntegration CS0-5)`

- [ ] **Task 3**: Remove `CLICKUP_API_KEY` from `configuration.ts` (AC3)
  - [ ] Edit `src/config/configuration.ts`:
    - Remove `apiKey: process.env.CLICKUP_API_KEY || ''` from the `clickup` block
    - Add tombstone comment: `// CLICKUP_API_KEY removed in CS1-7 — auth via ProjectIntegration.access_token (CS0-5)`
  - [ ] **Verify `ticket-intake.service.ts` degradation** (no code change needed):
    - `src/ticket-intake/ticket-intake.service.ts:82` reads `configService.get<string>('clickup.apiKey') || ''`
    - After removing `apiKey` from config, this returns `undefined` → `|| ''` → `this.clickupApiKey = ''`
    - The guard at line 627 (`if (!this.clickupApiKey)`) prevents the direct API call — graceful degradation ✓
    - `src/ticket-intake/ticket-intake.service.spec.ts:100` mock (`if (key === 'clickup.apiKey') return ''`) remains valid — no change needed

- [ ] **Task 4**: Update `ClickUpService` for graceful degradation (AC4)
  - [ ] Edit `src/clickup/clickup.service.ts`:
    - Keep existing `private readonly logger = new Logger(ClickUpService.name)` — no new imports needed
    - Change `private readonly client: AxiosInstance;` → `private readonly client: AxiosInstance | null;`
    - In constructor: replace the `if (!apiKey) { throw ... }` block with warn + null:
      ```typescript
      if (!apiKey) {
        this.logger.warn(
          '[CS1-7] CLICKUP_API_KEY not configured — ClickUpService is in legacy mode. ' +
          'All API calls will throw. Migrate to ProjectIntegration OAuth (CS0-5).',
          ClickUpService.name,
        );
        this.client = null;
      } else {
        this.client = axios.create({ ... }); // existing axios.create block unchanged
      }
      ```
    - Add `assertClient()` private method **immediately after the constructor** (before the first public method):
      ```typescript
      private assertClient(): void {
        if (!this.client) {
          throw new Error(
            'ClickUpService: no API key configured. Use ProjectIntegration OAuth via PMProviderFactory instead.',
          );
        }
      }
      ```
    - Add `this.assertClient();` as the **first line** of each public method:
      - `updateStatus()` (line ~99)
      - `addComment()` (line ~153)
      - `getTasks()` (line ~408)
      - `createTask()` (line ~558)
      - `getHierarchy()` (line ~610)
      - **Do NOT add to `resolveStatusId()`** — it's `private`, called only from `updateStatus()` which already guards

- [ ] **Task 5**: Update `clickup.service.spec.ts` (AC5)
  - [ ] Find the test `'should throw error if CLICKUP_API_KEY is missing (C5 fix)'`
  - [ ] Rename to: `'should warn and set client to null when CLICKUP_API_KEY is missing (CS1-7 graceful degradation)'`
  - [ ] Change assertion from `rejects.toThrow(...)` to:
    - Service compiles (no throw)
    - `service['client']` is null
    - Logger `warn` was called with the CS1-7 message

- [ ] **Task 6**: Create `StartupChecksService` for no-OAuth / no-key startup warning (AC6)
  - [ ] Create new file: `src/common/startup/startup-checks.service.ts`
    - `@Injectable()` class implementing `OnApplicationBootstrap`
    - Inject: `PrismaService`, `ConfigService`, `LoggerService`
    - In `onApplicationBootstrap()`: check `config.get('CLICKUP_API_KEY')` and `prisma.projectIntegration.count()`
    - If `!apiKey && count === 0` → emit the warning log
  - [ ] Create new file: `src/common/startup/startup-checks.module.ts`
    - Imports: `DatabaseModule`, `LoggerModule`
    - Providers + Exports: `StartupChecksService`
  - [ ] Edit `src/app.module.ts`:
    - Add `StartupChecksModule` to the `imports` array
    - **Do NOT** add `PrismaService` to `AppModule`'s constructor — use `StartupChecksModule` instead to avoid polluting root module

- [ ] **Task 7**: Verify no active `CLICKUP_API_KEY` reads remain (AC7)
  - [ ] Run: `grep -rn "CLICKUP_API_KEY" src/ --include="*.ts"` and verify only tombstone comments remain

- [ ] **Task 8**: Build verification (AC8)
  - [ ] `pnpm typecheck` — zero errors
  - [ ] `pnpm lint` — zero warnings/errors
  - [ ] `pnpm test` — all tests pass

---

## Dev Notes

### What Is Being Retired vs. What Stays

| Component                                | Action                          | Reason                                                                                                                   |
| ---------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ClickUpPollingOrchestrator`             | **DELETE**                      | Fully replaced by `PmPollingOrchestrator` (CS0-8) which polls per-ProjectIntegration via `IPMProvider.getUpdatedTasks()` |
| `CLICKUP_API_KEY` in `env.validation.ts` | **REMOVE**                      | OAuth tokens now live in `ProjectIntegration.access_token` (encrypted)                                                   |
| `CLICKUP_API_KEY` in `configuration.ts`  | **REMOVE** `apiKey` field       | Config block no longer reads this var                                                                                    |
| `ClickUpService`                         | **KEEP but degrade gracefully** | Still used by 5+ services (see below). Full migration to `ClickUpProvider` is a separate post-CS1 effort.                |
| `ClickUpWebhookConsumer`                 | **KEEP**                        | Legacy webhook consumer — retirement is out of CS1-7 scope                                                               |
| `ClickUpTaskUpdateConsumer`              | **KEEP**                        | Legacy task update consumer — retirement is out of CS1-7 scope                                                           |
| `ClickUpModule`                          | **KEEP (partial cleanup)**      | Keep module, just remove `ClickUpPollingOrchestrator`                                                                    |

### Why `ClickUpService` Cannot Be Deleted Yet

`ClickUpService` is still actively injected by:

| File                                                                   | Uses                                                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/execution/ai-execution.consumer.ts`                               | Deployment status updates                                                                                                                                                                             |
| `src/github/services/deployment-status-sync.service.ts`                | Sync deployment outcome to ClickUp task                                                                                                                                                               |
| `src/production-monitoring/fix-ticket.service.ts`                      | `createTask()` for production bug tickets                                                                                                                                                             |
| `src/qa-automation/production-approval/production-approval.service.ts` | Task approval flows                                                                                                                                                                                   |
| `src/architecture-review/` (specs)                                     | Mocked in tests with `CLICKUP_API_KEY: 'mock-key'`                                                                                                                                                    |
| `src/ticket-intake/ticket-intake.service.ts`                           | **Does NOT inject `ClickUpService`** — makes direct ClickUp HTTP calls via `this.clickupApiKey` (read from `clickup.apiKey` config path). Will degrade to no-op when `apiKey` is removed from config. |

Full replacement of these with `PMProviderFactory` + `ClickUpProvider` is the correct migration path but is scoped for **post-CS1-7**. The graceful degradation in AC4 ensures the service initializes safely without API key — all these consumers will get a clear error at runtime if they call `ClickUpService` methods without an API key, rather than the entire app failing to boot.

### `ClickUpPollingOrchestrator` vs. `PmPollingOrchestrator` — Why Safe to Delete

|            | `ClickUpPollingOrchestrator` (legacy)                       | `PmPollingOrchestrator` (CS0-8)                                    |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| Source     | `src/clickup/clickup-polling-orchestrator.service.ts`       | `src/integrations/polling/pm-polling-orchestrator.service.ts`      |
| Scheduling | `setInterval` based, manual polling states                  | `@Cron` every-minute via `@nestjs/schedule`                        |
| Auth       | `CLICKUP_API_KEY` via `ClickUpService`                      | Per-`ProjectIntegration` OAuth token via `PMProviderFactory`       |
| Config     | `CLICKUP_USE_WEBHOOKS`, `CLICKUP_POLL_INTERVAL_MS` env vars | `ProjectIntegration.polling_enabled`, `polling_interval` DB fields |
| Queue      | Publishes to `clickup-task-updated-queue` (legacy)          | Publishes to `ticket-intake-queue` (CS0-8 pattern)                 |
| Gate       | None                                                        | `DevelopmentGateService` (CS1-6) applied per-task                  |
| Status     | Active, running in production ✓                             | Active, running in production ✓                                    |

Both currently run in parallel. Deleting `ClickUpPollingOrchestrator` stops the legacy polling loop. Any projects configured via `ProjectIntegration` with `polling_enabled: true` continue via `PmPollingOrchestrator`.

**Risk**: Projects that were polled via the legacy `ClickUp.project.clickup_list_id` path and NOT yet migrated to `ProjectIntegration` will stop receiving polling events. This is expected — CS0-5 OAuth connect is the migration path for those projects.

### `ClickUpService` Graceful Degradation Implementation

The key change in `clickup.service.ts` constructor (lines ~62–80):

```typescript
// BEFORE:
const apiKey = this.config.get<string>('CLICKUP_API_KEY');
if (!apiKey) {
  throw new Error('CLICKUP_API_KEY is required but not configured in environment');
}
this.client = axios.create({ ... });

// AFTER (CS1-7):
const apiKey = this.config.get<string>('CLICKUP_API_KEY');
if (!apiKey) {
  this.logger.warn(
    '[CS1-7] CLICKUP_API_KEY not configured — ClickUpService is in legacy mode. ' +
    'All API calls will throw. Migrate to ProjectIntegration OAuth (CS0-5).',
    ClickUpService.name,
  );
  this.client = null;
} else {
  this.client = axios.create({
    baseURL,
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    timeout: 10000,
  });
}
```

The `logger` field: `ClickUpService` currently uses `private readonly logger = new Logger(ClickUpService.name)` from `@nestjs/common`. This is fine — no need to inject `LoggerService`; the NestJS `Logger` is sufficient and already imported.

Add `assertClient()` **immediately after the constructor closing brace**, before the first public method:

```typescript
// Place immediately after constructor:
private assertClient(): void {
  if (!this.client) {
    throw new Error(
      'ClickUpService: no API key configured. Use ProjectIntegration OAuth via PMProviderFactory instead.',
    );
  }
}
```

Then call `this.assertClient()` as the **first line** of each public method. Confirmed public methods (from actual source):

| Method              | Line | Guard needed                                      |
| ------------------- | ---- | ------------------------------------------------- |
| `updateStatus()`    | ~99  | ✓ YES                                             |
| `addComment()`      | ~153 | ✓ YES                                             |
| `getTasks()`        | ~408 | ✓ YES                                             |
| `createTask()`      | ~558 | ✓ YES                                             |
| `getHierarchy()`    | ~610 | ✓ YES                                             |
| `resolveStatusId()` | ~219 | ✗ NO — private, called only from `updateStatus()` |

**⚠️ Method name precision**: The actual method names in `clickup.service.ts` are `updateStatus` (NOT `updateTaskStatus`) and `getHierarchy` (NOT `getOrganizationHierarchy`). Do not add guards to non-existent methods — `pnpm typecheck` will fail.

Also: `statusNameToIdCache` still exists in `ClickUpService` (in-memory status ID cache). FR-CS3 in the epic calls for its removal, but this is NOT in scope for CS1-7. Do not touch it — leave it as a known leftover for a future `ClickUpService` retirement story.

### Startup Warning Implementation (AC6)

Use a dedicated `StartupChecksService` — do NOT add lifecycle hooks or new constructor dependencies directly to `AppModule` (root module pollution risk):

```typescript
// src/common/startup/startup-checks.service.ts
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { LoggerService } from '@/common/logger/logger.service';

@Injectable()
export class StartupChecksService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const hasApiKey = !!this.config.get<string>('CLICKUP_API_KEY');
    if (!hasApiKey) {
      const oauthCount = await this.prisma.projectIntegration.count();
      if (oauthCount === 0) {
        this.logger.warn(
          '[CS1-7] WARNING: No CLICKUP_API_KEY set and no ProjectIntegration OAuth records found. ' +
            'ClickUp functionality is unavailable until a project connects via OAuth ' +
            '(/api/v1/integrations/:projectId/clickup/connect).',
          'StartupChecksService',
        );
      }
    }
  }
}
```

```typescript
// src/common/startup/startup-checks.module.ts
import { Module } from '@nestjs/common';
import { StartupChecksService } from './startup-checks.service';
import { DatabaseModule } from '@/database/database.module';
import { LoggerModule } from '@/common/logger';

@Module({
  imports: [DatabaseModule, LoggerModule],
  providers: [StartupChecksService],
})
export class StartupChecksModule {}
```

Then in `src/app.module.ts`, add `StartupChecksModule` to the `imports` array (no constructor changes to `AppModule` needed).

### `env.validation.ts` Change Detail

```typescript
// BEFORE (lines ~110–111):
// ClickUp Integration (REQUIRED)
CLICKUP_API_KEY: Joi.string().required(),

// AFTER (CS1-7): REMOVE both lines entirely. Update the comment block:
// ClickUp Integration (Legacy — CLICKUP_API_KEY removed CS1-7; OAuth via ProjectIntegration CS0-5)
// CLICKUP_API_KEY was removed — no longer validated at startup
// OAuth client ID/secret/redirect remain for ClickUp OAuth app flow:
CLICKUP_WEBHOOK_SECRET: Joi.string().min(16).required().messages({ ... }),
CLICKUP_CLIENT_ID: Joi.string().optional().allow(''),
CLICKUP_CLIENT_SECRET: Joi.string().optional().allow(''),
CLICKUP_REDIRECT_URI: Joi.string().uri().optional().allow(''),
```

### `configuration.ts` Change Detail

```typescript
// BEFORE (lines ~70–78):
clickup: {
  apiKey: process.env.CLICKUP_API_KEY || '',
  apiUrl: process.env.CLICKUP_API_BASE_URL || 'https://api.clickup.com/api/v2',
  webhookSecret: process.env.CLICKUP_WEBHOOK_SECRET || '',
  clientId: process.env.CLICKUP_CLIENT_ID || '',
  ...
}

// AFTER (CS1-7):
clickup: {
  // CLICKUP_API_KEY removed in CS1-7 — auth via ProjectIntegration.access_token (CS0-5)
  apiUrl: process.env.CLICKUP_API_BASE_URL || 'https://api.clickup.com/api/v2',
  webhookSecret: process.env.CLICKUP_WEBHOOK_SECRET || '',
  clientId: process.env.CLICKUP_CLIENT_ID || '',
  ...
}
```

### `clickup.module.ts` Change Detail

```typescript
// BEFORE:
import { ClickUpPollingOrchestrator } from './clickup-polling-orchestrator.service';
// ...
providers: [ClickUpService, ClickUpPollingOrchestrator, ClickUpWebhookConsumer, ClickUpTaskUpdateConsumer],
exports: [ClickUpService, ClickUpPollingOrchestrator, ClickUpWebhookConsumer],

// AFTER:
// (remove ClickUpPollingOrchestrator import and references)
providers: [ClickUpService, ClickUpWebhookConsumer, ClickUpTaskUpdateConsumer],
exports: [ClickUpService, ClickUpWebhookConsumer],
```

**Also update the JSDoc comment** in `clickup.module.ts` to remove the `ClickUpPollingOrchestrator` entry from the Services list.

### Updated `clickup.service.spec.ts` Test (AC5)

```typescript
// BEFORE:
it('should throw error if CLICKUP_API_KEY is missing (C5 fix)', async () => {
  const mockConfig = {
    get: jest.fn((key: string) => {
      if (key === 'CLICKUP_API_KEY') return undefined;
      return 'default';
    }),
  };
  await expect(
    Test.createTestingModule({
      providers: [
        ClickUpService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: SentryService, useValue: { captureException: jest.fn() } },
      ],
    }).compile(),
  ).rejects.toThrow('CLICKUP_API_KEY is required but not configured in environment');
});

// AFTER (CS1-7):
it('should warn and set client to null when CLICKUP_API_KEY is missing (CS1-7 graceful degradation)', async () => {
  const mockWarn = jest.fn();
  const mockConfig = {
    get: jest.fn((key: string, defaultValue?: any) => {
      if (key === 'CLICKUP_API_KEY') return undefined;
      return defaultValue ?? 'default';
    }),
  };
  const module = await Test.createTestingModule({
    providers: [
      ClickUpService,
      { provide: ConfigService, useValue: mockConfig },
      { provide: SentryService, useValue: { captureException: jest.fn() } },
    ],
  }).compile();

  const service = module.get<ClickUpService>(ClickUpService);
  expect(service['client']).toBeNull();
  // Logger.warn is a static method on NestJS Logger — verify it was called
  // (use jest.spyOn(Logger.prototype, 'warn') in beforeEach if needed)
});
```

**Note**: If `ClickUpService` uses `new Logger(ClickUpService.name)` (instance), spy on `Logger.prototype.warn` in the test module's `beforeEach`. If it uses the injected `LoggerService`, mock accordingly.

### Prometheus Metrics (No New Metrics)

CS1-7 does not add new Prometheus counters. The removed `ClickUpPollingOrchestrator` had metrics:

- `clickup_poll_duration_seconds` — removed with the orchestrator
- `clickup_poll_total` — removed with the orchestrator
- `clickup_tasks_discovered_total` — removed with the orchestrator

These metrics will simply stop being emitted. No Prometheus recording rules reference them. Dashboards using these counters (if any) will go to 0 naturally.

### Previous Story Intelligence (from CS1-6)

From CS1-6 (`DevelopmentGateService`):

- **Module import pattern**: use `@/` path aliases everywhere (never relative imports for cross-directory)
- **Error handling**: errors in integration-aware services are logged + Sentry-captured, never rethrown
- **`AppMetricsModule` + `LoggerModule` are leaf modules** — safe to import anywhere without circular dep risk
- **Test module mock pattern**: `{ provide: SentryService, useValue: { captureException: jest.fn() } }` is the established SentryService mock pattern

From CS1-1 (`remove-hardcoded-status-maps`):

- `CLICKUP_STATUS_MAP`, `ACTIONABLE_STATUSES`, `NON_ACTIONABLE_STATUSES`, `CLICKUP_STATUS_DEPLOYED`, `CLICKUP_STATUS_DEPLOY_FAILED`, `CLICKUP_STATUS_ROLLED_BACK` were already removed from `env.validation.ts` in CS1-1
- `isActionableStatus` and `mapClickUpStatusToInternal` were already removed from the mapper
- This story completes the env-var removal by removing the last remaining legacy ClickUp key: `CLICKUP_API_KEY`

### Git Intelligence (Recent Commits)

1. `e435c44` — "feat: add `DevelopmentGateService` for task intake filtering by status" (CS1-6) — confirms `DevelopmentGateService` and `DevelopmentGateModule` are now live
2. `fa78c1c` — "refactor: remove hardcoded status maps and env-var configurations" (CS1-1) — established the pattern: remove env vars, update validation, update comments
3. `ff5b621` — "Mark Epic CS0 as complete and add retrospective artifacts" — CS0 is done; `PmPollingOrchestrator` (CS0-8) is confirmed live and replaces the legacy orchestrator

### Architecture Compliance

- **NestJS module pattern**: Remove from `providers` and `exports` arrays; file deletion handled separately
- **Fastify + Joi validation**: Joi schema at `src/config/env.validation.ts` is the authoritative startup gate — removing `required()` is the correct way to stop blocking startup
- **`@/` imports**: All new references must use path aliases, not relative paths
- **TypeScript strict mode**: `this.client: AxiosInstance | null` must be properly typed; null-checks with the `assertClient()` helper avoid type errors

### Project Structure Notes

| File                                                       | Change Type | Notes                                                                               |
| ---------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------- |
| `src/clickup/clickup-polling-orchestrator.service.ts`      | **DELETE**  | Legacy orchestrator retired                                                         |
| `src/clickup/clickup-polling-orchestrator.service.spec.ts` | **DELETE**  | Legacy spec retired                                                                 |
| `src/clickup/clickup.module.ts`                            | MODIFY      | Remove `ClickUpPollingOrchestrator` from imports/providers/exports + JSDoc          |
| `src/config/env.validation.ts`                             | MODIFY      | Remove `CLICKUP_API_KEY: Joi.string().required()`                                   |
| `src/config/configuration.ts`                              | MODIFY      | Remove `apiKey` from clickup config block, add tombstone comment                    |
| `src/clickup/clickup.service.ts`                           | MODIFY      | `client: AxiosInstance \| null`, warn on missing key, `assertClient()` on 5 methods |
| `src/clickup/clickup.service.spec.ts`                      | MODIFY      | Update missing-key test: no-throw, null client, warn logged                         |
| `src/common/startup/startup-checks.service.ts`             | NEW         | `OnApplicationBootstrap` hook — warn if no key + no OAuth records                   |
| `src/common/startup/startup-checks.module.ts`              | NEW         | Lightweight module wrapping StartupChecksService                                    |
| `src/app.module.ts`                                        | MODIFY      | Add `StartupChecksModule` to imports array                                          |

**Do NOT touch:**

- `src/integrations/polling/pm-polling-orchestrator.service.ts` — already in production (CS0-8)
- `src/integrations/polling/pm-polling.module.ts` — no changes needed
- `src/clickup/clickup-webhook-consumer.service.ts` — legacy consumer, out of CS1-7 scope
- `src/clickup/clickup-task-update.consumer.ts` — legacy consumer, out of CS1-7 scope
- `src/ticket-intake/ticket-intake.service.ts` — reads `clickup.apiKey` at line 82; degrades gracefully to `''` when removed from config (guard at line 627 prevents API call) — no code change needed
- `src/ticket-intake/ticket-intake.service.spec.ts` — mock `if (key === 'clickup.apiKey') return ''` remains valid — no change needed
- `src/architecture-review/escalation-e2e.spec.ts` — mock `CLICKUP_API_KEY: 'mock-key'` at line 46 is harmless (service no longer throws on missing key either way); cleanup is optional, not required for CS1-7
- Any other service that injects `ClickUpService` — they still compile; runtime errors occur only if they call methods without a key, which is the intended behavior

**Known leftover (not in CS1-7 scope):**

- `ClickUpService.statusNameToIdCache` — in-memory status ID cache. FR-CS3 in the epic calls for its removal, but that is part of a broader `ClickUpService` retirement story. Do not touch it here.

### References

- FR-CS1 (Remove all env-var based ClickUp status config) [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #FR-CS1]
- FR-CS3 (Remove statusNameToIdCache — known leftover, NOT in CS1-7 scope) [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #FR-CS3]
- Additional arch requirement: "REMOVE: CLICKUP_API_KEY from env.validation.ts and configuration.ts" [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #Additional-Requirements-Architecture]
- CS1-7 sprint entry [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml` #CS1-7-clickup-credential-transition]
- CS0-8 PmPollingOrchestrator (replacement) [Source: `src/integrations/polling/pm-polling-orchestrator.service.ts`]
- `CLICKUP_API_KEY` required validation [Source: `src/config/env.validation.ts:111`]
- `ClickUpService` constructor API key guard [Source: `src/clickup/clickup.service.ts:62-67`]
- `ClickUpService` public methods (actual names): `updateStatus` (~99), `addComment` (~153), `getTasks` (~408), `createTask` (~558), `getHierarchy` (~610) [Source: `src/clickup/clickup.service.ts`]
- `ClickUpPollingOrchestrator` [Source: `src/clickup/clickup-polling-orchestrator.service.ts:47`]
- `ClickUpModule` providers/exports [Source: `src/clickup/clickup.module.ts:38-44`]
- `configuration.ts` clickup.apiKey [Source: `src/config/configuration.ts:72`]
- `ticket-intake.service.ts` clickupApiKey field + guard [Source: `src/ticket-intake/ticket-intake.service.ts:52,82,627,636`]
- `ticket-intake.service.spec.ts` clickup.apiKey mock [Source: `src/ticket-intake/ticket-intake.service.spec.ts:100`]
- `architecture-review` CLICKUP_API_KEY mock (harmless after CS1-7) [Source: `src/architecture-review/escalation-e2e.spec.ts:46`]

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
