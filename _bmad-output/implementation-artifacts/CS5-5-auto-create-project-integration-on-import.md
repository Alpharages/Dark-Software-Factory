# Story CS5.5: Auto-Create ProjectIntegration on Import

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **PM**,
I want importing a ClickUp list to **automatically set up the project's PM integration**,
so that **I don't have to manually navigate to project settings and reconnect the same account I just used**.

## Acceptance Criteria

1. **Import DTO Updated:** `ImportProjectDto` gains an optional `accountId: string` field (`@IsOptional() @IsUUID()`).
2. **Auto-Create Logic:** In `ProjectService.importProject()`, after the `Project` record is created, if `accountId` is provided: fetch `ConnectedApp` by `accountId`, verify ownership (throw 403 if not owner), create `ProjectIntegration` using copied workspace data and decrypted tokens (re-encrypted for `ProjectIntegration` storage). Fields: `provider`, `workspace_id`, `workspace_name`, `access_token`, `refresh_token`, `token_expiry` copied from `ConnectedApp`. `metadata`-sourced fields (`bot_user_id`, `bot_username`) mapped from `metadata.botUserId` / `metadata.botUsername`. `polling_enabled: false`, `webhook_enabled: false`, `provider_config: {}`, `ai_trigger_status: null`.
3. **Ownership Guard:** `ConnectedAppsService.getDecrypted(accountId, userId)` already throws `ForbiddenException` (403) if `ConnectedApp.user_id !== userId` and `NotFoundException` (404) if not found — these propagate naturally, no additional guard needed.
4. **Atomicity:** Project creation and `ProjectIntegration` creation run in a `PrismaService.$transaction(async (tx) => { ... })`. If `ProjectIntegration` insert fails, the project is rolled back.
5. **Backwards Compatible:** If `accountId` is omitted from the request, import proceeds as before (project created, no `ProjectIntegration` auto-created). No breaking change.
6. **Response:** `ProjectService.importProject()` returns `{ project: Project, integrationCreated: boolean }`. Controller updated to return this shape. New `ImportProjectResponseDto` created.
7. **Frontend Update:** `ClickUpImportModal.tsx` success toast updated: if `integrationCreated: true` → "Project imported and ClickUp connected automatically."; otherwise → existing "Project imported successfully" message. `projectsApi.ts` updated to pass `accountId` in the request body.
8. **Unit Tests (backend):** In `project.service.spec.ts` — (T1) import with valid `accountId` creates both project and integration; (T2) import without `accountId` creates only project; (T3) import with wrong-owner `accountId` propagates ForbiddenException; (T4) DB error on integration insert rolls back project (transaction callback throws).

## Tasks / Subtasks

### Backend (`dsf-backend`)

- [ ] Task 1: Update `ImportProjectDto` (AC: #1)
  - [ ] Open `src/projects/dto/import-project.dto.ts`
  - [ ] Add `@IsOptional()`, `@IsUUID()` decorators from `class-validator`
  - [ ] Add `@ApiPropertyOptional` from `@nestjs/swagger`
  - [ ] Add field: `accountId?: string`

- [ ] Task 2: Create `ImportProjectResponseDto` (AC: #6)
  - [ ] Create `src/projects/dto/import-project-response.dto.ts`
  - [ ] Export class with:
    - `project: Record<string, unknown>` (typed loosely as Prisma `Project` doesn't have a generic DTO — or just use `any` with `@ApiProperty`)
    - `@ApiProperty({ description: 'Whether a ProjectIntegration was auto-created', example: false }) integrationCreated: boolean`
  - [ ] Alternatively: embed project fields directly and add `integrationCreated: boolean` (see architecture section)

- [ ] Task 3: Update `ProjectModule` (AC: #2 prerequisite)
  - [ ] Open `src/projects/project.module.ts`
  - [ ] Add `ConnectedAppsModule` to `imports` array (provides `ConnectedAppsService`)
  - [ ] Add `EncryptionModule` to `imports` array (provides `EncryptionService` for token re-encryption in transaction) — import from `@/common/encryption/encryption.module`

- [ ] Task 4: Modify `ProjectService.importProject()` (AC: #2–#6)
  - [ ] Open `src/projects/project.service.ts`
  - [ ] Add `ConnectedAppsService` injection: `private readonly connectedAppsService: ConnectedAppsService`
  - [ ] Add `EncryptionService` injection: `private readonly encryptionService: EncryptionService`
  - [ ] Update import of `EncryptionService` from `@/common/encryption/encryption.service`
  - [ ] Update method signature: `async importProject(importDto: ImportProjectDto, userId: string): Promise<{ project: Project; integrationCreated: boolean }>`
  - [ ] Implement `accountId` branch (see Architecture section for full implementation)
  - [ ] Wrap project creation + integration creation in `this.prisma.$transaction(async (tx) => { ... })`
  - [ ] Return `{ project, integrationCreated: !!importDto.accountId }`

- [ ] Task 5: Update `ProjectController` (AC: #6 + role fix)
  - [ ] Open `src/projects/project.controller.ts`
  - [ ] **Add `Role.PM` to the role guard** on the import endpoint — change line 64 from `@Roles(Role.ADMIN, Role.MANAGER)` to `@Roles(Role.ADMIN, Role.MANAGER, Role.PM)`. The story is "As a PM" but the existing guard excludes PM — this must be fixed.
  - [ ] Update `importProject()` return type annotation / `@ApiResponse` to reference `ImportProjectResponseDto`
  - [ ] Add `@ApiResponse({ status: 403, description: 'Forbidden — ConnectedApp not owned by user' })` and `@ApiResponse({ status: 404, description: 'ConnectedApp not found' })` decorators
  - [ ] Return value passes through from service (controller already returns service result)

- [ ] Task 6: Unit Tests in `project.service.spec.ts` (AC: #8)
  - [ ] Add `mockConnectedAppsService` with `getDecrypted: jest.fn()`
  - [ ] Add `mockEncryptionService` with `encrypt: jest.fn().mockReturnValue('encrypted-token')`
  - [ ] Register mocks in `providers` array
  - [ ] Add `mockPrismaTx.projectIntegration = { create: jest.fn() }` to `mockPrismaTx`
  - [ ] T1: import with `accountId` — `getDecrypted` returns app with tokens → both `tx.project.create` and `tx.projectIntegration.create` called → returns `{ project, integrationCreated: true }`
  - [ ] T2: import without `accountId` — `getDecrypted` NOT called → only project created → returns `{ project, integrationCreated: false }`
  - [ ] T3: `getDecrypted` throws `ForbiddenException` → `importProject` propagates it
  - [ ] T4: `tx.projectIntegration.create` rejects → `$transaction` callback throws → project rolled back (verify `tx.project.create` was called but transaction rejected)

### Frontend (`dsf-dasbhoard`)

- [ ] Task 7: Update `useImportProject.ts` response type (AC: #7 prerequisite)
  - [ ] Open `src/hooks/useImportProject.ts` (frontend repo)
  - [ ] Find the `ImportProjectResponse` interface — it currently types only flat project fields (`id`, `name`, etc.)
  - [ ] Update the interface to wrap project fields and add `integrationCreated`:
    ```typescript
    interface ImportProjectResponse {
      project: {
        id: string;
        name: string;
        provider: string;
        github_repository_url: string;
        monitor_tasks: boolean;
      };
      integrationCreated: boolean;
    }
    ```
  - [ ] The hook's POST call (`apiClient.post('/projects/import', data)`) already sends `accountId` if it was added by CS5-4. Verify `accountId` is in the request body — if not, add it.
  - [ ] **Note on `projectsApi.ts`:** `src/api/projectsApi.ts` does NOT contain an `importProject` function — the hook calls the API directly. No changes needed there.

- [ ] Task 8: Update success toast in `ClickUpImportModal.tsx` (AC: #7)
  - [ ] Open `src/components/projects/ClickUpImportModal.tsx` (frontend repo)
  - [ ] Find the `useImportProject` call — the `onSuccess` callback currently has signature `onSuccess: () => { ... }` (no parameter)
  - [ ] **Update the callback signature to accept the response:** `onSuccess: (response) => { ... }`
  - [ ] Inside the callback, add conditional toast:
    ```typescript
    onSuccess: (response) => {
      triggerConfetti();
      const message = response.integrationCreated
        ? 'Project imported and ClickUp connected automatically.'
        : 'Project imported successfully! 🎉';
      toast.success(message, { duration: 4000, icon: '🚀' });
      handleClose();
      onImportSuccess?.();
    },
    ```
  - [ ] Keep all other existing logic (`handleClose()`, `onImportSuccess?.()`, confetti) unchanged

## Dev Notes

### This is a Backend-Primary Story

**Backend repo:** `/Volumes/Data/project/products/alpharages/dsf-backend`
**Frontend repo:** `/Volumes/Data/project/products/alpharages/dsf-dasbhoard`

CS5-4 (`ready-for-dev`) is the dependency. CS5-4 already:

- Adds `accountId?: string` to `ImportProjectRequest` in `useImportProject.ts`
- Passes `accountId: selectedAccountId ?? undefined` in `handleImport()` to the POST body

CS5-5 primarily adds **backend logic** to handle that `accountId`. The frontend changes in this story are minimal (toast message update + API layer if CS5-4 left `projectsApi.ts` incomplete).

### Architecture: `importProject()` Implementation

```typescript
// src/projects/project.service.ts

async importProject(
  importDto: ImportProjectDto,
  userId: string,
): Promise<{ project: Project; integrationCreated: boolean }> {
  const { provider, resourceId, accountId } = importDto;

  if (provider !== PMProvider.CLICKUP) {
    throw new Error(`Provider ${provider} import not yet supported`);
  }

  try {
    // 1. Fetch ClickUp list details (before transaction)
    const listDetails = await this.clickupService.getList(resourceId);
    this.logger.log(`Importing ClickUp list: ${listDetails.name} (${listDetails.id})`);

    // 2. Check for duplicates (before transaction)
    const existing = await this.repository.findByListId(resourceId);
    if (existing) {
      throw new ConflictException(
        `A project has already been imported for ClickUp List ${resourceId}`,
      );
    }

    // 3. Fetch and validate ConnectedApp BEFORE transaction (ownership check built-in)
    //    getDecrypted throws NotFoundException (404) or ForbiddenException (403) automatically
    let decryptedApp: ConnectedAppModel | null = null;
    if (accountId) {
      decryptedApp = await this.connectedAppsService.getDecrypted(accountId, userId);
    }

    // 4. Pre-encrypt tokens for ProjectIntegration (needed inside $transaction)
    let encryptedAccessToken: string | null = null;
    let encryptedRefreshToken: string | null = null;
    if (decryptedApp) {
      if (decryptedApp.access_token) {
        encryptedAccessToken = this.encryptionService.encrypt(decryptedApp.access_token);
      }
      if (decryptedApp.refresh_token) {
        encryptedRefreshToken = this.encryptionService.encrypt(decryptedApp.refresh_token);
      }
    }

    // 5. Atomic creation inside transaction
    const project = await this.prisma.$transaction(async (tx) => {
      const newProject = await tx.project.create({
        data: {
          name: listDetails.name,
          clickup_list_id: listDetails.id,
          github_repository_url: '',
          default_branch: 'main',
          pm_id: userId,
          status: 'active',
          client_name: 'Internal',
          provider: PMProvider.CLICKUP,
          monitor_tasks: true,
        },
      });

      if (decryptedApp) {
        const meta = decryptedApp.metadata as Record<string, unknown> | null;
        await tx.projectIntegration.create({
          data: {
            project_id: newProject.id,
            provider: PMProvider.CLICKUP,
            workspace_id: decryptedApp.workspace_id,
            workspace_name: decryptedApp.workspace_name,
            access_token: encryptedAccessToken,
            refresh_token: encryptedRefreshToken,
            token_expiry: decryptedApp.token_expiry,
            bot_user_id: (meta?.botUserId as string | null) ?? null,
            bot_username: (meta?.botUsername as string | null) ?? null,
            polling_enabled: false,
            webhook_enabled: false,
            provider_config: {},
            ai_trigger_status: null,
          },
        });
      }

      return newProject;
    });

    this.operationsCounter.inc({ operation: 'import', status: 'success' });
    return { project, integrationCreated: !!decryptedApp };
  } catch (_error) {
    this.operationsCounter.inc({ operation: 'import', status: 'error' });
    const msg = _error instanceof Error ? _error.message : String(_error);
    this.logger.error(`Failed to import project: ${msg}`);
    throw _error;
  }
}
```

### Architecture: Key Types & Imports to Add to ProjectService

```typescript
// Add to import section:
import { ConnectedAppsService } from '@/connected-apps/connected-apps.service';
import { EncryptionService } from '@/common/encryption/encryption.service';
import { ConnectedAppModel } from '@/prisma/client';
```

Note: `ConnectedAppModel` is already imported in `connected-apps.service.ts` — check that `@/prisma/client` exports it (it re-exports Prisma client types).

### Architecture: `ImportProjectResponseDto`

```typescript
// src/projects/dto/import-project-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class ImportProjectResponseDto {
  @ApiProperty({ description: 'The imported project' })
  project!: Record<string, unknown>;

  @ApiProperty({
    description: 'Whether a ProjectIntegration record was auto-created from the connected account',
    example: false,
  })
  integrationCreated!: boolean;
}
```

### Architecture: `ImportProjectDto` Final Shape

```typescript
// src/projects/dto/import-project.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsEnum, IsNumberString, IsOptional, IsUUID } from 'class-validator';
import { PMProvider } from '@/prisma/enums';

export class ImportProjectDto {
  @ApiProperty({ description: 'Integration provider source', enum: PMProvider, example: 'CLICKUP' })
  @IsEnum(PMProvider)
  @IsNotEmpty()
  provider!: PMProvider;

  @ApiProperty({
    description: 'Resource ID from the provider (e.g., ClickUp List ID)',
    example: '90120123456',
  })
  @IsNumberString()
  @IsNotEmpty()
  resourceId!: string;

  @ApiPropertyOptional({
    description: 'ID of the ConnectedApp to use for auto-creating ProjectIntegration',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;
}
```

### Architecture: `ProjectModule` Updated Imports

```typescript
// src/projects/project.module.ts — ADD to imports array:
import { ConnectedAppsModule } from '@/connected-apps/connected-apps.module';
import { EncryptionModule } from '@/common/encryption/encryption.module';

@Module({
  imports: [
    DatabaseModule,
    forwardRef(() => ClickUpModule),
    AIDecisionLoggerModule,
    IntegrationsModule,
    ConnectedAppsModule,   // NEW — provides ConnectedAppsService
    EncryptionModule,      // NEW — provides EncryptionService for token re-encryption
  ],
  // ...
})
```

### Architecture: Metadata Key Convention

`ConnectedApp.metadata` is stored as JSON. The callback in `ConnectedAppsController` stores:

```json
{ "botUserId": "...", "botUsername": "..." }
```

Keys are **camelCase**: `botUserId`, `botUsername`.

When mapping to `ProjectIntegration`:

```typescript
const meta = decryptedApp.metadata as Record<string, unknown> | null;
bot_user_id: (meta?.botUserId as string | null) ?? null,
bot_username: (meta?.botUsername as string | null) ?? null,
```

### Architecture: Frontend — `useImportProject.ts` Response Type

`src/api/projectsApi.ts` does **NOT** contain an `importProject` function — the hook calls `apiClient.post('/projects/import', data)` directly. No changes to `projectsApi.ts` are needed.

The `ImportProjectResponse` interface in `useImportProject.ts` currently types only flat project fields. After CS5-5 the backend returns a wrapper object. Update to:

```typescript
// src/hooks/useImportProject.ts — BEFORE (current)
interface ImportProjectResponse {
  id: string;
  name: string;
  provider: string;
  github_repository_url: string;
  monitor_tasks: boolean;
}

// AFTER
interface ImportProjectResponse {
  project: {
    id: string;
    name: string;
    provider: string;
    github_repository_url: string;
    monitor_tasks: boolean;
  };
  integrationCreated: boolean;
}
```

### Architecture: Frontend — Success Toast in `ClickUpImportModal.tsx`

The current `onSuccess` callback has no parameter: `onSuccess: () => { ... }`. Update it to accept the response and use `integrationCreated`:

```typescript
// BEFORE
onSuccess: () => {
  triggerConfetti();
  toast.success('Project imported successfully! 🎉', { duration: 4000, icon: '🚀' });
  handleClose();
  onImportSuccess?.();
},

// AFTER
onSuccess: (response) => {
  triggerConfetti();
  const message = response.integrationCreated
    ? 'Project imported and ClickUp connected automatically.'
    : 'Project imported successfully! 🎉';
  toast.success(message, { duration: 4000, icon: '🚀' });
  handleClose();
  onImportSuccess?.();
},
```

### Architecture: Controller Role Guard Fix

The import endpoint at `src/projects/project.controller.ts` line 64 currently restricts to `ADMIN, MANAGER`. Add `PM`:

```typescript
// BEFORE
@Roles(Role.ADMIN, Role.MANAGER)

// AFTER
@Roles(Role.ADMIN, Role.MANAGER, Role.PM)
```

Without this change, **PMs cannot call `POST /projects/import`**, making the entire feature non-functional for the target user persona.

### Architecture: `project.service.spec.ts` — Test Setup Additions

```typescript
// Add to existing mocks:
const mockConnectedAppsService = {
  getDecrypted: jest.fn(),
};

const mockEncryptionService = {
  encrypt: jest.fn().mockReturnValue('encrypted-token'),
};

// In mockPrismaTx, add:
const mockPrismaTx = {
  project: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
  projectIntegration: { create: jest.fn() },
  // ... existing entries
};

// Add to providers array in TestingModule:
{ provide: ConnectedAppsService, useValue: mockConnectedAppsService },
{ provide: EncryptionService, useValue: mockEncryptionService },
```

Mock `ConnectedAppModel` fixture for tests:

```typescript
const mockConnectedApp = {
  id: 'ca-123',
  user_id: 'pm-123',
  provider: 'CLICKUP',
  workspace_id: 'ws-456',
  workspace_name: 'My ClickUp Workspace',
  access_token: 'plain-access-token',
  refresh_token: null,
  token_expiry: null,
  metadata: { botUserId: 'bot-789', botUsername: 'DSF Bot' },
  created_at: new Date(),
  updated_at: new Date(),
};
```

### Testing Standards

- **Framework:** Jest 30 + ts-jest (backend)
- **Pattern:** `describe('importProject')` nested block within existing `describe('ProjectService')`
- **Mocks:** Mock `$transaction` as `jest.fn((callback) => callback(mockPrismaTx))` — already set up
- **All tests must be in `project.service.spec.ts`** — no new test files needed
- **Frontend testing (Task 8):** If `ClickUpImportModal.test.tsx` exists from CS5-4, add one test: `integrationCreated: true` response → specific toast message

### Previous Story Intelligence (CS5-4)

CS5-4 (`ready-for-dev`) establishes:

- `useConnectedApps()` hook exists at `src/hooks/queries/useConnectedApps.ts`
- `connectedAppsApi.ts` at `src/api/connectedAppsApi.ts` with `getAppHierarchy`
- `ClickUpImportModal` Step 0 account selection (when CS5-4 is done)
- `handleImport()` in modal already passes `accountId: selectedAccountId ?? undefined`
- `ImportProjectRequest` in `useImportProject.ts` already has `accountId?: string`

**Verify before starting:** Check `src/api/projectsApi.ts` in frontend to see if `accountId` is already being passed. If CS5-4 Task 3 is complete, Task 7 here may be a no-op.

### Git Intelligence

Recent commits show active CS5 work:

- `a73e5c7 feat: add ConnectedAppsController with OAuth flow, APIs, and unit tests` — CS5-2 complete
- `4e1fb4c feat: implement ConnectedApp infrastructure with encryption and service layer` — CS5-1 complete

Pattern established in codebase: `EncryptionService.encrypt()` stores AES-256-GCM ciphertext, `EncryptionService.decrypt()` reverses it. Same service used by `ProjectIntegrationService` and `ConnectedAppsService`.

### Project Structure Notes

- All backend files under `src/projects/` — no new modules or folders needed
- `ConnectedAppsModule` lives at `src/connected-apps/connected-apps.module.ts`
- `EncryptionModule` lives at `src/common/encryption/encryption.module.ts`
- Path alias `@/` maps to `src/` — always use aliases, never relative paths

### References

- Epic: [Source: _bmad-output/planning-artifacts/epics-connected-apps.md#Story CS5-5]
- Previous story CS5-4: [Source: _bmad-output/implementation-artifacts/CS5-4-import-modal-account-selection.md]
- `ConnectedAppsService` (live): [Source: src/connected-apps/connected-apps.service.ts]
- `ConnectedAppsModule` (live): [Source: src/connected-apps/connected-apps.module.ts]
- `ProjectIntegration` schema: [Source: prisma/schema.prisma#model ProjectIntegration]
- `ConnectedApp` schema: [Source: prisma/schema.prisma#model ConnectedApp]
- `ProjectService.importProject()` (current): [Source: src/projects/project.service.ts#L195]
- `ImportProjectDto` (current): [Source: src/projects/dto/import-project.dto.ts]
- `ProjectModule` (current): [Source: src/projects/project.module.ts]
- `project.service.spec.ts` test patterns: [Source: src/projects/project.service.spec.ts]
- `ProjectIntegrationService.createIntegration()`: [Source: src/integrations/project-integration.service.ts]
- `EncryptionService`: [Source: src/common/encryption/encryption.service.ts]
- `ProjectController` import endpoint (role guard line 64): [Source: src/projects/project.controller.ts#L63]
- `useImportProject.ts` (ImportProjectResponse interface): [Source: src/hooks/useImportProject.ts (frontend)]
- `ClickUpImportModal.tsx` onSuccess callback: [Source: src/components/projects/ClickUpImportModal.tsx#L177 (frontend)]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

**Backend (`dsf-backend`):**

- `src/projects/dto/import-project.dto.ts` (modified — add optional `accountId` field)
- `src/projects/dto/import-project-response.dto.ts` (created — `{ project, integrationCreated }`)
- `src/projects/project.service.ts` (modified — `importProject()` auto-creates `ProjectIntegration` in `$transaction`, inject `ConnectedAppsService` + `EncryptionService`)
- `src/projects/project.module.ts` (modified — add `ConnectedAppsModule`, `EncryptionModule` to imports)
- `src/projects/project.controller.ts` (modified — add `Role.PM` to import endpoint role guard, add 403/404 `@ApiResponse` decorators)
- `src/projects/project.service.spec.ts` (modified — add T1–T4 for `importProject` with `accountId`)

**Frontend (`dsf-dasbhoard`):**

- `src/hooks/useImportProject.ts` (modified — update `ImportProjectResponse` interface to `{ project: {...}, integrationCreated: boolean }` wrapper shape)
- `src/components/projects/ClickUpImportModal.tsx` (modified — update `onSuccess` callback to accept response parameter, conditional toast based on `integrationCreated`)
