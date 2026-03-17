# Story CS5.2: ClickUp OAuth for User-Level Accounts

Status: ready-for-dev

## Story

As a **PM**,
I want to **connect my ClickUp account at the user level (not tied to a specific project)**,
so that **I can use that account to import projects and manage multiple ClickUp workspaces**.

## Acceptance Criteria

1. **Connect Endpoint:** `GET /api/v1/apps/clickup/connect` returns `{ url: string }`. Requires JWT auth, roles: PM/MANAGER/ADMIN. Query param `returnTo` (`"settings"` | `"import"`) is included in the OAuth state. State format: `{ type: "user", userId: string, returnTo: string }` — base64url encoded.

2. **Callback Endpoint:** `GET /api/v1/apps/clickup/callback` is public (no JWT). Reads `code` and `state`. Decodes state, exchanges code for token via ClickUp API, fetches bot identity via `getBotIdentity()`. Calls `ConnectedAppService.upsert()` to store `ConnectedApp` with encrypted token and `metadata: { botUserId, botUsername }`.

3. **Callback Redirect:** On success: `{FRONTEND_URL}/settings/pm-callback?integration=connected&returnTo={returnTo}&accountId={newId}`. On error: `{FRONTEND_URL}/settings/pm-callback?integration=error&returnTo={returnTo}`.

4. **Disconnect Endpoint:** `DELETE /api/v1/apps/:id` deletes `ConnectedApp`. Ownership guard enforced (via `ConnectedAppService.delete(id, userId)`). Returns `{ message: "Connected app disconnected successfully" }`.

5. **Hierarchy Endpoint:** `GET /api/v1/apps/:id/hierarchy` fetches ClickUp org/space/list tree using decrypted token from `ConnectedApp`. Returns `ClickUpHierarchy` (`{ organizations: [...] }`) — same type as `ClickUpService.getHierarchy()`. Returns 403 if not owner, 404 if not found.

6. **List Connected Apps Endpoint:** `GET /api/v1/apps/connected` returns `ConnectedAppResponseDto[]` for the authenticated user. Requires JWT auth, roles: PM/MANAGER/ADMIN. CS5-3 frontend depends on this endpoint.

7. **Controller:** `ConnectedAppsController` in `src/connected-apps/` handles all 5 endpoints. Swagger decorators on all endpoints. `@ApiTags('connected-apps')`.

8. **Reuse:** Reuse `ClickUpOAuthService.exchangeCode()` and `ClickUpOAuthService.getBotIdentity()` for token exchange. Reuse `ClickUpHierarchy` / `ClickUpOrganization` types from `@/clickup/clickup.service` for hierarchy response typing.

9. **Unit Tests:** Tests for controller covering: connect returns url, callback success path, callback error path (malformed state), list connected apps, disconnect own record, disconnect not-own 403, hierarchy own, hierarchy not-own 403.

## Tasks / Subtasks

> **🚨 PREREQUISITE:** CS5-1 must be fully implemented before starting. Verify
> `src/connected-apps/connected-apps.module.ts`, `connected-apps.service.ts`, and the
> `ConnectedApp` Prisma model + migration are all in place before proceeding.

> **🚨 EXECUTION ORDER:** T1 → T2 → T3 → T4 → T5

- [ ] **T1: Create `ConnectedAppsController`** (AC: 1, 2, 3, 4, 5, 6, 7)
  - [ ] Create `src/connected-apps/connected-apps.controller.ts`
  - [ ] Add `@ApiTags('connected-apps')` and `@Controller('apps')` (base path `/api/v1/apps`)
  - [ ] **⚠️ Declaration order matters** — declare static routes (`/clickup/connect`, `/clickup/callback`, `/connected`) BEFORE param routes (`/:id`, `/:id/hierarchy`) to prevent NestJS routing collision (see Dev Notes — Route Order)
  - [ ] **List endpoint (declare first):** `GET /connected` — `@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)`, `@Roles(Role.PM, Role.MANAGER, Role.ADMIN)`, `@CurrentUser('id') userId: string` → `return this.connectedAppService.findByUser(userId)`
  - [ ] **Connect endpoint:** `GET /clickup/connect` — `@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)`, `@Roles(Role.PM, Role.MANAGER, Role.ADMIN)`, `@Query('returnTo') returnTo: string`, `@CurrentUser('id') userId: string` → `return { url: await this.oauthService.getUserConnectUrl(userId, returnTo) }`
  - [ ] **Callback endpoint:** `@Public()`, `GET /clickup/callback` — `@Query('code') code: string`, `@Query('state') state: string`, `@Res() reply: FastifyReply` → inline callback logic (see Dev Notes — Callback Inline Pattern), `reply.redirect(url, 302)`
  - [ ] **Disconnect endpoint:** `DELETE /:id` — `@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)`, `@Roles(Role.PM, Role.MANAGER, Role.ADMIN)`, `@Param('id') id: string`, `@CurrentUser('id') userId: string` → `await this.connectedAppService.delete(id, userId)` → return `{ message: 'Connected app disconnected successfully' }`
  - [ ] **Hierarchy endpoint (declare last):** `GET /:id/hierarchy` — `@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)`, `@Roles(Role.PM, Role.MANAGER, Role.ADMIN)`, `@Param('id') id: string`, `@Query('teamId') teamId?: string`, `@CurrentUser('id') userId: string` → `getDecrypted` then `oauthService.getHierarchyWithToken(token, teamId)`
  - [ ] Add Swagger decorators on all endpoints: `@ApiBearerAuth`, `@ApiOperation`, `@ApiResponse`, `@ApiQuery`, `@ApiParam`
  - [ ] Import: `import { CurrentUser, Public } from '@/common/decorators';` (barrel — not individual file paths)

- [ ] **T2: Add `getUserConnectUrl` and `getHierarchyWithToken` to `ClickUpOAuthService`** (AC: 1, 5, 8)
  - [ ] Add `getUserConnectUrl(userId: string, returnTo: string): Promise<string>` — builds OAuth URL with base64url state (see Dev Notes — State Encoding)
  - [ ] Add `getHierarchyWithToken(accessToken: string, teamId?: string): Promise<ClickUpHierarchy>` — create an ad-hoc axios client with `Authorization: accessToken` header and run the same traversal as `ClickUpService.getHierarchy()` (see Dev Notes — Hierarchy Reuse). Import `ClickUpHierarchy` type: `import type { ClickUpHierarchy } from '@/clickup/clickup.service'`
  - [ ] Callback logic (upsert after exchange) stays **inline in the controller** — do NOT add `handleUserCallback` to `ClickUpOAuthService` (would create circular dependency; see Dev Notes — Dependency Design)

- [ ] **T3: Update `ConnectedAppsModule`** (AC: 7)
  - [ ] Add `ConnectedAppsController` to `controllers` array
  - [ ] Add `IntegrationsModule` to `imports` array — this grants access to `ClickUpOAuthService` (already exported). No `forwardRef` needed.
  - [ ] Final module shape:
    ```typescript
    @Module({
      imports: [DatabaseModule, EncryptionModule, IntegrationsModule],
      controllers: [ConnectedAppsController],
      providers: [ConnectedAppService],
      exports: [ConnectedAppService],
    })
    ```

- [ ] **T4: Unit tests for controller** (AC: 9)
  - [ ] Create `src/connected-apps/connected-apps.controller.spec.ts`
  - [ ] Mock both `ConnectedAppService` and `ClickUpOAuthService` via `useValue` (see Dev Notes — Test Cases)
  - [ ] 8 test cases: connect, callback success, callback malformed-state error, list connected, disconnect own, disconnect 403, hierarchy own, hierarchy 403
  - [ ] Run `pnpm typecheck` and `pnpm test` — zero errors, all pass

- [ ] **T5: Verify no regressions**
  - [ ] Confirm `GET /integrations/:provider/hierarchy` (existing project-level endpoint) still works — it is NOT modified by this story
  - [ ] Confirm `GET /integrations/clickup/connect` (existing project-level OAuth) still works — it is NOT modified by this story

## Dev Notes

### Architecture: BACKEND-ONLY STORY

CS5-2 is backend only. Frontend (Connected Apps settings page, callback route update) comes in CS5-3. The hierarchy endpoint is consumed by CS5-4's import modal. Do not touch any files in `dsf-dasbhoard`.

### Prerequisite: CS5-1 Must Be Done

Confirm before writing any code:

- `prisma/schema.prisma`: `ConnectedApp` model, `AppProvider` enum, `IntegrationProvider` renamed to `PMProvider`
- `src/connected-apps/`: `connected-apps.service.ts` (7 methods), `connected-apps.module.ts`, `dto/connected-app-response.dto.ts`

If CS5-1 is not done, **STOP** and implement CS5-1 first.

### Route Declaration Order (Critical — C1/E1)

NestJS matches routes top-to-bottom. A wildcard param route like `@Get(':id/hierarchy')` will greedily match `/connected/hierarchy` or `/clickup/hierarchy` if declared before static paths.

**Required order in controller class body:**

```
1. GET /connected          ← static, no param
2. GET /clickup/connect    ← static, no param
3. GET /clickup/callback   ← static, no param (also @Public())
4. DELETE /:id             ← param route
5. GET /:id/hierarchy      ← param route — MUST be last
```

### Controller Base Path

`@Controller('apps')` → NestJS global prefix `api` + version `v1` → all routes under `/api/v1/apps/...`. Never hardcode `api/v1` in the decorator.

### State Encoding Pattern

```typescript
// Encode
const state = Buffer.from(JSON.stringify({ type: 'user', userId, returnTo })).toString('base64url');

// Decode (in callback — with null-safety)
let decoded: { type: string; userId: string; returnTo: string };
try {
  decoded = JSON.parse(Buffer.from(state ?? '', 'base64url').toString('utf-8'));
} catch {
  return reply.redirect(
    `${frontendUrl}/settings/pm-callback?integration=error&returnTo=settings`,
    302,
  );
}
if (!decoded?.userId || decoded.type !== 'user') {
  return reply.redirect(
    `${frontendUrl}/settings/pm-callback?integration=error&returnTo=settings`,
    302,
  );
}
```

Different from project-level state (`"projectId:CLICKUP"` plain string). Always use JSON/base64url for user-level.

### Callback Inline Pattern (Dependency Design)

Keep all callback logic (exchange → identity → upsert → redirect) **inline in the controller**. Do NOT add a `handleUserCallback()` method to `ClickUpOAuthService` — that would require injecting `ConnectedAppService` into `ClickUpOAuthService`, creating a circular module dependency (`IntegrationsModule` ↔ `ConnectedAppsModule`).

```
ConnectedAppsController
  ├── ClickUpOAuthService  (getUserConnectUrl, exchangeCode, getBotIdentity, getHierarchyWithToken)
  └── ConnectedAppService  (upsert, delete, getDecrypted, findByUser)
```

Full callback handler:

```typescript
@Public()
@Get('clickup/callback')
async callback(
  @Query('code') code: string,
  @Query('state') state: string,
  @Res() reply: FastifyReply,
): Promise<void> {
  const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? '';

  let decoded: { type: string; userId: string; returnTo: string };
  try {
    decoded = JSON.parse(Buffer.from(state ?? '', 'base64url').toString('utf-8'));
  } catch {
    return reply.redirect(`${frontendUrl}/settings/pm-callback?integration=error&returnTo=settings`, 302);
  }
  if (!decoded?.userId || decoded.type !== 'user') {
    return reply.redirect(`${frontendUrl}/settings/pm-callback?integration=error&returnTo=settings`, 302);
  }

  try {
    const tokenData = await this.oauthService.exchangeCode(code);
    const identity = await this.oauthService.getBotIdentity(tokenData.access_token);
    const connectedApp = await this.connectedAppService.upsert(
      decoded.userId,
      AppProvider.CLICKUP,
      identity.workspace_id,
      {
        workspace_name: identity.workspace_name,
        access_token: tokenData.access_token,
        refresh_token: null,
        token_expiry: null,
        metadata: { botUserId: identity.bot_user_id, botUsername: identity.bot_username },
      },
    );
    const returnTo = encodeURIComponent(decoded.returnTo ?? 'settings');
    return reply.redirect(
      `${frontendUrl}/settings/pm-callback?integration=connected&returnTo=${returnTo}&accountId=${connectedApp.id}`,
      302,
    );
  } catch (error) {
    this.logger.error('ClickUp user OAuth callback failed', { error: error instanceof Error ? error.message : error });
    const returnTo = encodeURIComponent(decoded.returnTo ?? 'settings');
    return reply.redirect(`${frontendUrl}/settings/pm-callback?integration=error&returnTo=${returnTo}`, 302);
  }
}
```

Note: inject `ConfigService` into controller constructor for `FRONTEND_URL`.

### Hierarchy Reuse — Do NOT Reinvent (Critical — C2)

`ClickUpService.getHierarchy()` at `src/clickup/clickup.service.ts:584` already implements the full Teams → Spaces → Folders/Lists traversal. **Do not duplicate this logic.** Instead, add `getHierarchyWithToken(accessToken, teamId?)` to `ClickUpOAuthService` that uses an ad-hoc axios client:

```typescript
import type { ClickUpHierarchy, ClickUpOrganization } from '@/clickup/clickup.service';
import axios from 'axios';

async getHierarchyWithToken(accessToken: string, teamId?: string): Promise<ClickUpHierarchy> {
  const client = axios.create({
    baseURL: 'https://api.clickup.com/api/v2',
    headers: { Authorization: accessToken },
    timeout: 10000,
  });

  const teamsRes = await client.get<{ teams: Array<{ id: string; name: string }> }>('/team');
  let teams = teamsRes.data.teams;
  if (teamId) {
    teams = teams.filter((t) => t.id === teamId);
  }

  const organizations: ClickUpOrganization[] = await Promise.all(
    teams.map(async (team) => {
      const spacesRes = await client.get<{ spaces: Array<{ id: string; name: string }> }>(
        `/team/${team.id}/space`,
      );
      const spaces = await Promise.all(
        spacesRes.data.spaces.map(async (space) => {
          try {
            const [foldersRes, listsRes] = await Promise.all([
              client.get<{ folders: Array<{ id: string; name: string; lists: Array<{ id: string; name: string }> }> }>(
                `/space/${space.id}/folder`,
              ),
              client.get<{ lists: Array<{ id: string; name: string }> }>(
                `/space/${space.id}/list`,
              ),
            ]);
            const lists: Array<{ id: string; name: string }> = [
              ...listsRes.data.lists.map((l) => ({ id: l.id, name: l.name })),
              ...foldersRes.data.folders.flatMap((f) =>
                (f.lists ?? []).map((l) => ({ id: l.id, name: `${f.name} > ${l.name}` })),
              ),
            ];
            return { id: space.id, name: space.name, lists };
          } catch {
            return { id: space.id, name: space.name, lists: [] };
          }
        }),
      );
      return { id: team.id, name: team.name, spaces };
    }),
  );

  return { organizations };
}
```

**Critical:** Folder list names use `"${folder.name} > ${l.name}"` format — same as `ClickUpService.getHierarchy()`. The CS5-4 import modal parses these names; diverging format would break list display.

**Type imports only** — `ClickUpHierarchy`/`ClickUpOrganization` are TypeScript type imports (`import type`). No `ClickUpModule` import needed in `ConnectedAppsModule`.

### `getUserConnectUrl` Method

```typescript
async getUserConnectUrl(userId: string, returnTo: string): Promise<string> {
  const clientId = this.config.get<string>('clickup.clientId') ?? '';
  const redirectUri = this.config.get<string>('clickup.redirectUri') ?? '';

  if (!clientId) throw new BadRequestException('CLICKUP_CLIENT_ID is not configured');
  if (!redirectUri) throw new BadRequestException('CLICKUP_REDIRECT_URI is not configured');

  const state = Buffer.from(JSON.stringify({ type: 'user', userId, returnTo })).toString('base64url');

  return (
    `https://app.clickup.com/api` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`
  );
}
```

Same OAuth URL base as `getConnectUrl()` (project-level). Both flows share the same ClickUp app redirect_uri.

### `upsert()` Call — Encryption Is Automatic

`ConnectedAppService.upsert()` encrypts tokens internally. **Never** pre-encrypt before calling it:

```typescript
const connectedApp = await this.connectedAppService.upsert(
  decoded.userId,
  AppProvider.CLICKUP, // import { AppProvider } from '@prisma/client'
  identity.workspace_id,
  {
    workspace_name: identity.workspace_name,
    access_token: tokenData.access_token, // plain — service encrypts
    refresh_token: null,
    token_expiry: null,
    metadata: { botUserId: identity.bot_user_id, botUsername: identity.bot_username },
  },
);
// connectedApp.id → use as accountId in redirect URL
```

### `getBotIdentity()` Fallback Behavior

If ClickUp API is unreachable, `getBotIdentity()` returns `{ workspace_id: 'unknown', workspace_name: 'ClickUp Workspace', bot_user_id: null, bot_username: null }` — it does NOT throw. The upsert proceeds with these fallback values. Acceptable behavior (matches project-level OAuth). The unique key `(user_id, provider, workspace_id)` will use `'unknown'` — subsequent retries will upsert cleanly.

### Per-Method Guards Required (Not Class-Level)

Because the callback endpoint uses `@Public()` (which bypasses `JwtAuthGuard`), guards cannot be applied at the class level — they must be per-method. Do NOT do:

```typescript
// ❌ WRONG — breaks @Public() on callback
@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
@Controller('apps')
export class ConnectedAppsController { ... }
```

Instead, apply `@UseGuards(...)` on each protected method individually (as shown in `ClickUpOAuthController` — the direct pattern to follow).

### AppProvider vs PMProvider

- `AppProvider.CLICKUP` from `@prisma/client` → used for `ConnectedApp.provider` ✅
- `PMProvider.CLICKUP` from `@prisma/client` → used for `ProjectIntegration.provider` ❌ wrong enum for this story

### Existing Hierarchy Endpoint — Do NOT Touch

`IntegrationsController.getHierarchy()` at `GET /api/v1/integrations/:provider/hierarchy` uses `ClickUpService` with the global API key. **Leave it untouched.** The new endpoint at `GET /api/v1/apps/:id/hierarchy` is different — it uses the user's own `ConnectedApp` token. Both endpoints coexist and serve different flows.

### Module Import: No `forwardRef` Needed

`IntegrationsModule` already exports `ClickUpOAuthService` (confirmed). `ClickUpModule` does NOT import `ConnectedAppsModule` — so no circular dependency.

```typescript
@Module({
  imports: [DatabaseModule, EncryptionModule, IntegrationsModule],
  controllers: [ConnectedAppsController],
  providers: [ConnectedAppService],
  exports: [ConnectedAppService],
})
export class ConnectedAppsModule {}
```

### Test Cases for Controller Spec

```typescript
const mockOauthService = {
  getUserConnectUrl: jest.fn(),
  exchangeCode: jest.fn(),
  getBotIdentity: jest.fn(),
  getHierarchyWithToken: jest.fn(),
};
const mockConnectedAppService = {
  upsert: jest.fn(),
  delete: jest.fn(),
  getDecrypted: jest.fn(),
  findByUser: jest.fn(),
};

// 8 test cases:
// 1. listConnected() → calls findByUser(userId) → returns array
// 2. connect() → calls getUserConnectUrl(userId, returnTo) → returns { url }
// 3. callback() success → exchangeCode + getBotIdentity + upsert → reply.redirect success URL with accountId
// 4. callback() malformed state → reply.redirect error URL (no 500)
// 5. disconnect() own record → calls delete(id, userId) → returns success message
// 6. disconnect() not-owner → delete throws ForbiddenException → propagates 403
// 7. hierarchy() own → getDecrypted + getHierarchyWithToken → returns { organizations }
// 8. hierarchy() not-owner → getDecrypted throws ForbiddenException → propagates 403
```

Guards are NOT active in unit tests — test service calls and response shapes only. Use `Test.createTestingModule({ controllers: [ConnectedAppsController], providers: [mockOauth, mockConnectedApp, mockConfig] }).compile()`.

### Project Structure Notes

```
src/connected-apps/
  ├── connected-apps.module.ts      ← MODIFY (add controller + IntegrationsModule)
  ├── connected-apps.service.ts     ← no change (CS5-1 owns this)
  ├── connected-apps.controller.ts  ← CREATE
  ├── connected-apps.controller.spec.ts  ← CREATE
  └── dto/
      └── connected-app-response.dto.ts  ← no change (CS5-1 owns this)

src/integrations/
  └── clickup-oauth.service.ts      ← MODIFY (add getUserConnectUrl + getHierarchyWithToken)
```

**Do NOT modify:**

- `src/integrations/clickup-oauth.controller.ts` — project-level OAuth, untouched
- `src/integrations/integrations.module.ts` — already exports what's needed
- `src/integrations/integrations.controller.ts` — existing hierarchy endpoint, untouched
- Any Prisma schema files — CS5-1 owns the schema

### References

- Epic spec + AC source: `_bmad-output/planning-artifacts/epics-connected-apps.md` — Story CS5-2
- PRD requirements: `_bmad-output/planning-artifacts/prd-connected-apps.md` — FR-CA4 through FR-CA8
- Previous story (model + service): `_bmad-output/implementation-artifacts/stories/epic-CS5/CS5-1-connected-app-model-service-infrastructure.md`
- Project-level OAuth controller (guard/decorator pattern): `src/integrations/clickup-oauth.controller.ts`
- Existing hierarchy implementation (traversal pattern + types): `src/clickup/clickup.service.ts:584` (`getHierarchy`, `ClickUpHierarchy`, `ClickUpOrganization`)
- ClickUpOAuthService (methods to extend): `src/integrations/clickup-oauth.service.ts`
- IntegrationsModule (exports): `src/integrations/integrations.module.ts`
- Decorators barrel: `src/common/decorators/index.ts` (`CurrentUser`, `Public`)
- AuthenticatedUser interface: `src/auth/interfaces/jwt-payload.interface.ts`
- Role enum: `src/auth/constants/roles.enum.ts`
- AppProvider enum (post CS5-1): `@prisma/client`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

**Backend — Dark Software Factory**

_New files:_

- `src/connected-apps/connected-apps.controller.ts` (created)
- `src/connected-apps/connected-apps.controller.spec.ts` (created)

_Modified files:_

- `src/connected-apps/connected-apps.module.ts` (modified — add `ConnectedAppsController` + `IntegrationsModule` import)
- `src/integrations/clickup-oauth.service.ts` (modified — add `getUserConnectUrl()` and `getHierarchyWithToken()`)
