# Story CS5.1: ConnectedApp Model & Service Infrastructure

Status: done

## Story

As a **developer**,
I want a **`ConnectedApp` Prisma model, migration, and service layer**,
so that **any feature can store and retrieve user-level OAuth connections with encrypted tokens in a provider-agnostic way**.

## Acceptance Criteria

1. **Enum Consolidation:** `IntegrationProvider` renamed to `PMProvider` in `prisma/schema.prisma`. `ProjectProvider` deleted (merged into `PMProvider` — they were identical). All model fields updated: `ProjectIntegration.provider: PMProvider`, `Project.provider: PMProvider`. All TypeScript source files referencing either enum updated to `PMProvider`.

2. **AppProvider Enum:** New `AppProvider` enum added to `prisma/schema.prisma` with values: `CLICKUP`, `JIRA`, `ASANA`, `GITHUB`, `GITLAB`, `BITBUCKET`, `GMAIL`, `GOOGLE_CALENDAR`, `SLACK`. Used **only** by `ConnectedApp.provider` — `ProjectIntegration` keeps `PMProvider`.

3. **ConnectedApp Model:** `ConnectedApp` model created in `prisma/schema.prisma`:

   ```prisma
   model ConnectedApp {
     id             String       @id @default(uuid())
     user_id        String
     provider       AppProvider
     workspace_id   String
     workspace_name String
     access_token   String?      // AES-256-GCM encrypted via EncryptionService
     refresh_token  String?      // AES-256-GCM encrypted, nullable
     token_expiry   DateTime?    // null = non-expiring (e.g. ClickUp)
     metadata       Json?        // provider-specific extras
     created_at     DateTime     @default(now())
     updated_at     DateTime     @updatedAt

     user           User         @relation(fields: [user_id], references: [id], onDelete: Cascade)

     @@unique([user_id, provider, workspace_id])
     @@index([user_id, provider])
     @@map("connected_apps")
   }
   ```

4. **User Relation:** `User` model gains `connectedApps ConnectedApp[]` relation.

5. **Migration:** One Prisma migration file handles all changes atomically. **⚠️ Prisma cannot rename enums natively — the generated SQL must be manually edited** (see Dev Notes — C5 Migration Warning).

6. **ConnectedAppService:** NestJS service at `src/connected-apps/connected-apps.service.ts`:
   - `create(data: CreateConnectedAppData): Promise<ConnectedAppResponseDto>`
   - `upsert(userId, provider, workspaceId, data): Promise<ConnectedAppResponseDto>` — composite key `(user_id, provider, workspace_id)`
   - `findByUser(userId: string): Promise<ConnectedAppResponseDto[]>`
   - `findByUserAndProvider(userId, provider): Promise<ConnectedAppResponseDto[]>`
   - `findById(id: string): Promise<ConnectedAppResponseDto | null>`
   - `getDecrypted(id: string, userId: string): Promise<ConnectedApp>` — throws `NotFoundException` | `ForbiddenException` (from `@nestjs/common`)
   - `delete(id: string, userId: string): Promise<void>` — throws `NotFoundException` | `ForbiddenException` (from `@nestjs/common`)

7. **ConnectedAppsModule:** `src/connected-apps/connected-apps.module.ts`. Imports: `DatabaseModule`, `EncryptionModule`. Providers + Exports: `ConnectedAppService`.

8. **ConnectedAppResponseDto:** `src/connected-apps/dto/connected-app-response.dto.ts`:

   ```typescript
   // Field mapping from Prisma model → DTO (snake_case → camelCase):
   // id             → id
   // provider       → provider
   // workspace_id   → workspaceId
   // workspace_name → workspaceName
   // metadata       → metadata  (Record<string, unknown> | null)
   // created_at     → connectedAt  (ISO string)
   // access_token, refresh_token → NEVER included
   ```

9. **`src/prisma/enums.ts` updated:** Remove `ProjectProvider` export, add `PMProvider` and `AppProvider` exports. Note: `IntegrationProvider` was **never** exported from this file — files using it import directly from `@prisma/client`.

10. **`src/prisma/client.ts` updated:** Add `export type ConnectedAppModel = ConnectedApp` type alias to stay consistent with the 52 existing aliases.

11. **All source files updated** — `IntegrationProvider` → `PMProvider` (9 files import from `@prisma/client`), `ProjectProvider` → `PMProvider` (3 files import from `@/prisma/enums`). See T3.

12. **All test files updated** — 9 spec files referencing old enum names updated to `PMProvider`. See T4.

13. **Unit Tests:** `src/connected-apps/connected-apps.service.spec.ts` covers:
    - `create()` — tokens encrypted before insert; plaintext never stored
    - `upsert()` — create path: new record with encrypted tokens
    - `upsert()` — update path: existing record updated, tokens re-encrypted
    - `findByUser()` — no token fields in result
    - `findByUserAndProvider()` — filters by provider correctly
    - `findById()` — returns null if not found
    - `getDecrypted()` — returns decrypted tokens for own record
    - `getDecrypted()` — throws `NotFoundException` if not found
    - `getDecrypted()` — throws `ForbiddenException` if userId mismatch
    - `delete()` — deletes own record
    - `delete()` — throws `ForbiddenException` if not owner
    - `delete()` — throws `NotFoundException` if missing

14. **`pnpm typecheck` + `pnpm test` pass** with zero errors and no regressions.

## Tasks / Subtasks

> **🚨 EXECUTION ORDER IS MANDATORY:** T1 → T2 (`pnpm db:generate`) → T3/T4/T5 (parallel) → T6 → T7 → T8 → T9 → T10

- [ ] **T1: Schema changes** (AC: 1, 2, 3, 4)
  - [ ] Rename `IntegrationProvider` → `PMProvider` in `prisma/schema.prisma`
  - [ ] Delete `ProjectProvider` enum; update `Project.provider` to use `PMProvider`
  - [ ] Add `AppProvider` enum with 9 values
  - [ ] Add `ConnectedApp` model (fields, unique constraint, index, table map)
  - [ ] Add `connectedApps ConnectedApp[]` to `User` model
  - [ ] Update comment block above enum definitions

- [ ] **T2: Generate client + create migration** (AC: 5)
  - [ ] Run `pnpm db:generate` — updates Prisma client with new enum/model names
  - [ ] Run `pnpm db:migrate` — generates migration SQL file
  - [ ] **⚠️ Manually edit migration SQL** — replace `DROP TYPE`/`CREATE TYPE` pattern with `ALTER TYPE "IntegrationProvider" RENAME TO "PMProvider"` and `DROP TYPE "ProjectProvider"` (see Dev Notes — Migration Warning)
  - [ ] Apply migration: `pnpm db:migrate` again to confirm it applies cleanly

- [ ] **T3: Update enum references — source files** (AC: 11)
  - [ ] `src/prisma/enums.ts` — remove `ProjectProvider`, add `PMProvider` and `AppProvider`
  - [ ] `src/prisma/client.ts` — add `export type ConnectedAppModel = ConnectedApp` (AC: 10)
  - [ ] Files importing `IntegrationProvider` from `@prisma/client` → rename to `PMProvider`:
    - `src/projects/project.controller.ts`
    - `src/clickup/clickup-task-update.consumer.ts`
    - `src/integrations/webhook/pm-webhook-router.service.ts`
    - `src/integrations/webhook/pm-webhook.controller.ts`
    - `src/integrations/providers/pm-provider.factory.ts`
    - `src/integrations/clickup-oauth.service.ts`
    - `src/integrations/project-integration.service.ts`
  - [ ] Files importing `ProjectProvider` from `@/prisma/enums` → rename to `PMProvider`:
    - `src/projects/project.service.ts`
    - `src/projects/dto/import-project.dto.ts`

- [ ] **T4: Update enum references — test files** (AC: 12)
  - [ ] `src/ticket-intake/services/development-gate.service.spec.ts`
  - [ ] `src/integrations/webhook/pm-webhook-router.service.spec.ts`
  - [ ] `src/integrations/polling/pm-polling-orchestrator.service.spec.ts`
  - [ ] `src/integrations/pm-verification-comment.service.spec.ts`
  - [ ] `src/integrations/providers/pm-provider.factory.spec.ts`
  - [ ] `src/integrations/integrations.controller.spec.ts`
  - [ ] `src/integrations/clickup-oauth.controller.spec.ts`
  - [ ] `src/integrations/pm-field-auto-fill.service.spec.ts`
  - [ ] `src/integrations/pm-status.service.spec.ts`

- [ ] **T5: ConnectedAppResponseDto** (AC: 8) — _can run parallel with T3/T4 after T2_
  - [ ] Create `src/connected-apps/dto/connected-app-response.dto.ts`
  - [ ] Apply exact field mapping from AC-8 (snake_case → camelCase)
  - [ ] Add `@ApiProperty` Swagger decorators on all fields
  - [ ] No token fields

- [ ] **T6: ConnectedAppService** (AC: 6)
  - [ ] Create `src/connected-apps/connected-apps.service.ts`
  - [ ] Define `CreateConnectedAppData` interface (see Dev Notes)
  - [ ] Add `private readonly logger = new Logger(ConnectedAppService.name)`
  - [ ] Implement all 7 methods with encryption pattern (see Dev Notes)
  - [ ] Private `toResponseDto()` helper with explicit field mapping

- [ ] **T7: ConnectedAppsModule** (AC: 7)
  - [ ] Create `src/connected-apps/connected-apps.module.ts`

- [ ] **T8: Register in AppModule** (AC: 7)
  - [ ] Add `ConnectedAppsModule` to `src/app.module.ts` in the **External Integrations section** (alongside `IntegrationsModule`)

- [ ] **T9: Unit tests** (AC: 13)
  - [ ] Create `src/connected-apps/connected-apps.service.spec.ts`
  - [ ] Mock pattern: `{ provide: PrismaService, useValue: mockPrisma }` + `{ provide: EncryptionService, useValue: mockEncryption }`
  - [ ] Write all 12 test cases from AC-13

- [ ] **T10: Verify** (AC: 14)
  - [ ] `pnpm typecheck` — zero errors
  - [ ] `pnpm test` — all pass including existing suites

## Dev Notes

### Two Enums, Two Purposes — Never Mix

```
PMProvider    (CLICKUP | JIRA | ASANA)
  └─ ProjectIntegration.provider, Project.provider
  └─ renamed from: IntegrationProvider + merged ProjectProvider

AppProvider   (CLICKUP | JIRA | ASANA | GITHUB | GITLAB | BITBUCKET | GMAIL | GOOGLE_CALENDAR | SLACK)
  └─ ConnectedApp.provider only
  └─ broader — any user-level OAuth provider
```

**Never use `AppProvider` in `ProjectIntegration`** — allows nonsensical values like `GMAIL` in PM sync context.

### ⚠️ Migration Warning — Manual SQL Required (C5)

Prisma generates `DROP TYPE` + `CREATE TYPE` for enum renames, which **fails on columns with existing data**. After running `pnpm db:migrate` to generate the SQL file, open it and replace the drop/create pattern with:

```sql
-- Rename IntegrationProvider → PMProvider
ALTER TYPE "IntegrationProvider" RENAME TO "PMProvider";

-- Drop ProjectProvider (no data loss — only used in schema, same values as PMProvider)
DROP TYPE "ProjectProvider";
-- Note: Prisma already updated Project.provider column type in the migration
```

Apply after manual edit: `pnpm db:migrate` will detect the file is already generated and apply it.

### `CreateConnectedAppData` Interface (C3)

Define in `connected-apps.service.ts` (mirrors `UpsertIntegrationData` in `project-integration.service.ts`):

```typescript
export interface CreateConnectedAppData {
  workspace_id: string;
  workspace_name: string;
  access_token?: string | null;
  refresh_token?: string | null;
  token_expiry?: Date | null;
  metadata?: Record<string, unknown> | null;
}
```

### Logger — Use NestJS Logger (C4)

`ProjectIntegrationService` has no logger. `ConnectedAppService` needs one because `getDecrypted()` must warn on decryption failure. Use the same pattern as `ClickUpOAuthService`:

```typescript
import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';

@Injectable()
export class ConnectedAppService {
  private readonly logger = new Logger(ConnectedAppService.name);
  // ...
  try {
    decrypted = this.encryption.decrypt(record.access_token);
  } catch (_err) {
    this.logger.warn(`Failed to decrypt access_token for ConnectedApp ${record.id}`);
    decrypted = null;
  }
}
```

`ForbiddenException` and `NotFoundException` both come from `@nestjs/common` — not custom exceptions.

### Upsert Composite Key Name (E2)

Prisma generates the composite unique key name as `user_id_provider_workspace_id`:

```typescript
await this.prisma.connectedApp.upsert({
  where: {
    user_id_provider_workspace_id: {
      user_id: userId,
      provider,
      workspace_id: workspaceId,
    },
  },
  create: { user_id: userId, provider, workspace_id: workspaceId, ...encryptedData },
  update: { ...encryptedData },
});
```

### `toResponseDto()` Exact Field Mapping (E3)

```typescript
private toResponseDto(record: ConnectedApp): ConnectedAppResponseDto {
  return {
    id: record.id,
    provider: record.provider,
    workspaceId: record.workspace_id,        // snake_case → camelCase
    workspaceName: record.workspace_name,    // snake_case → camelCase
    metadata: record.metadata as Record<string, unknown> | null,
    connectedAt: record.created_at.toISOString(),  // created_at → connectedAt
    // access_token and refresh_token intentionally omitted
  };
}
```

### EncryptionService Pattern

```typescript
// AES-256-GCM. Format in DB: "iv_hex:authTag_hex:encryptedText_hex"
const encrypted = this.encryption.encrypt(plainToken); // before any DB write
const plain = this.encryption.decrypt(encryptedFromDb); // in getDecrypted() only
```

### `src/prisma/enums.ts` — What Changes (C1)

**Current state** (only `ProjectProvider` is exported — `IntegrationProvider` is NOT here):

```typescript
export { ProjectProvider, TicketStatus, ... } from '@prisma/client';
```

**After change:**

```typescript
export { PMProvider, AppProvider, TicketStatus, ... } from '@prisma/client';
// Remove: ProjectProvider
// Add: PMProvider, AppProvider
```

Files using `IntegrationProvider` import from `@prisma/client` directly — rename enum in schema regenerates client, then update the name in each file's import. No `enums.ts` change needed for those.

### Test Setup Pattern (E1)

`test/jest-setup.ts` sets all required env vars including `ENCRYPTION_KEY`. Do **not** instantiate real `EncryptionService` in unit tests — mock it:

```typescript
const mockEncryption = {
  encrypt: jest.fn().mockImplementation((val: string) => `enc_${val}`),
  decrypt: jest.fn().mockImplementation((val: string) => val.replace('enc_', '')),
};

const mockPrisma = {
  connectedApp: {
    create: jest.fn(),
    upsert: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
  },
};

beforeEach(async () => {
  const module = await Test.createTestingModule({
    providers: [
      ConnectedAppService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: EncryptionService, useValue: mockEncryption },
    ],
  }).compile();

  service = module.get<ConnectedAppService>(ConnectedAppService);
  jest.clearAllMocks();
});
```

### `app.module.ts` Placement (C5)

Add in the **External Integrations** comment section, alongside `IntegrationsModule`:

```typescript
// External Integrations
IntegrationsModule,
PmWebhookModule,
ClickUpModule,
ConnectedAppsModule,   // ← add here
ProjectModule,
PmPollingModule,
```

### Module Structure

```
src/connected-apps/
  ├── connected-apps.module.ts
  ├── connected-apps.service.ts
  ├── connected-apps.service.spec.ts
  └── dto/
      └── connected-app-response.dto.ts
```

No controller in this story — comes in CS5-2. Use `@/` path aliases throughout.

### References

- Enum definitions: `prisma/schema.prisma` lines 1049–1064
- `ProjectIntegration` model (pattern): `prisma/schema.prisma` lines 1261–1288
- `ProjectIntegrationService` (service pattern): `src/integrations/project-integration.service.ts`
- `UpsertIntegrationData` interface (data interface pattern): `src/integrations/project-integration.service.ts`
- `EncryptionService`: `src/common/encryption/encryption.service.ts`
- `IntegrationsModule` (module pattern): `src/integrations/integrations.module.ts`
- `app.module.ts` (placement): `src/app.module.ts` — External Integrations section
- Epic spec: `_bmad-output/planning-artifacts/epics-connected-apps.md` — Story CS5-1
- PRD: `_bmad-output/planning-artifacts/prd-connected-apps.md` — FR-CA1 through FR-CA3

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Fixed high-severity typecheck regression in `ConnectedAppsService`.
- Updated story with missing `clickup-oauth.controller.ts`.

**Code Review Fixes (2026-03-17):**

- Added missing `findByUserAndProvider()` and `findById()` methods to `ConnectedAppService` (AC-6).
- Fixed `ConnectedAppResponseDto` to camelCase per AC-8: `workspaceId`, `workspaceName`, `connectedAt: string`; removed `user_id`, `updated_at`, `token_expiry`; fixed `metadata` type to `Record<string, unknown> | null`.
- Fixed `toResponseDto()` to match AC-8 field mapping.
- Fixed `getDecrypted(id, userId)` and `delete(id, userId)` parameter order to match AC-6 spec (was reversed — auth bypass risk).
- Added try/catch + logger.warn for decryption failures in `getDecrypted()` per Dev Notes C3.
- Fixed `access_token String?` nullable in schema (migration was already correct).
- Defined `CreateConnectedAppData` interface; refactored `create(userId, provider, data)` and `upsert(userId, provider, workspaceId, data)` to use it.
- Removed unauthorized `@Global()` from `ConnectedAppsModule`.
- Added all missing test cases from AC-13: `upsert` update path, `findByUserAndProvider`, `findById`, `delete` NotFoundException.
- Reverted unrelated `package.json` script changes.
- Deleted `prisma/schema.prisma.old` and `prisma/migrations/migration.sql.temp` temp files.

### File List

**Backend — Dark Software Factory**

_Schema & Migration:_

- `prisma/schema.prisma` (modified — rename `IntegrationProvider`→`PMProvider`, delete `ProjectProvider`, add `AppProvider`, add `ConnectedApp` model, add `User.connectedApps` relation)
- `prisma/migrations/{timestamp}_connected_apps_enum_consolidation/migration.sql` (created — requires manual SQL edit before applying)

_New module:_

- `src/connected-apps/connected-apps.module.ts` (created)
- `src/connected-apps/connected-apps.service.ts` (created)
- `src/connected-apps/connected-apps.service.spec.ts` (created)
- `src/connected-apps/dto/connected-app-response.dto.ts` (created)

_App registration:_

- `src/app.module.ts` (modified — add `ConnectedAppsModule` in External Integrations section)

_Prisma re-exports:_

- `src/prisma/enums.ts` (modified — remove `ProjectProvider`, add `PMProvider` and `AppProvider`)
- `src/prisma/client.ts` (modified — add `export type ConnectedAppModel = ConnectedApp`)

_Enum rename — source files (import from `@prisma/client`, rename only):_

- `src/projects/project.controller.ts`
- `src/clickup/clickup-task-update.consumer.ts`
- `src/integrations/webhook/pm-webhook-router.service.ts`
- `src/integrations/webhook/pm-webhook.controller.ts`
- `src/integrations/providers/pm-provider.factory.ts`
- `src/integrations/clickup-oauth.service.ts`
- `src/integrations/project-integration.service.ts`
- `src/integrations/clickup-oauth.controller.ts`

_Enum rename — source files (import from `@/prisma/enums`, rename + update import):_

- `src/projects/project.service.ts`
- `src/projects/dto/import-project.dto.ts`

_Enum rename — test files:_

- `src/ticket-intake/services/development-gate.service.spec.ts`
- `src/integrations/webhook/pm-webhook-router.service.spec.ts`
- `src/integrations/polling/pm-polling-orchestrator.service.spec.ts`
- `src/integrations/pm-verification-comment.service.spec.ts`
- `src/integrations/providers/pm-provider.factory.spec.ts`
- `src/integrations/integrations.controller.spec.ts`
- `src/integrations/clickup-oauth.controller.spec.ts`
- `src/integrations/pm-field-auto-fill.service.spec.ts`
- `src/integrations/pm-status.service.spec.ts`
