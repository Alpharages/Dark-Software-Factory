# Story CS0.5: ClickUp OAuth App Flow — Backend

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **DSF system**,
I want a ClickUp OAuth App flow that lets a PM or Admin connect their ClickUp workspace to a
project via OAuth,
so that DSF can operate as an integration bot (using `bot_user_id` captured at connect time)
without requiring a shared personal API key per project.

## Acceptance Criteria

### AC1 — Connect initiation endpoint (JWT-protected)

- `GET /api/v1/integrations/clickup/connect?project_id={id}` is implemented in a **new**
  `ClickUpOAuthController` (see E1 note in Dev Notes).
- Protected per-method with `@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)` and
  `@Roles(Role.PM, Role.MANAGER, Role.ADMIN)`.
- Validates `project_id` is non-empty; throws `NotFoundException` if project does not exist.
- Returns `{ url: string }` — the ClickUp OAuth authorization URL to which the frontend redirects.
- URL format:
  `https://app.clickup.com/api?client_id={CLICKUP_CLIENT_ID}&redirect_uri={CLICKUP_REDIRECT_URI}&state={projectId}:CLICKUP`
- Throws `BadRequestException` (`400`) if `CLICKUP_CLIENT_ID` or `CLICKUP_REDIRECT_URI` is empty.

### AC2 — Callback endpoint (public — `@Public()` required)

- `GET /api/v1/integrations/clickup/callback` is in `ClickUpOAuthController`.
- **Must be decorated with `@Public()`** from `@/common/decorators` — the `JwtAuthGuard` reads
  `IS_PUBLIC_KEY` metadata to skip JWT. Without `@Public()`, ClickUp's browser redirect will
  receive a **401** and the OAuth flow will permanently fail.
- No role guard on this method (no `@Roles()` → `RolesGuard` allows by default when no roles set).
- Accepts query params: `code: string`, `state: string` (format `{projectId}:CLICKUP`).
- Uses `@Res() reply: FastifyReply` + `reply.redirect(url, 302)` for the response — see Dev
  Notes for the mandatory Fastify redirect pattern.
- On success: browser is redirected (302) to:
  `{FRONTEND_URL}/projects/{projectId}/settings?integration=connected&provider=clickup`
- On any error: browser is redirected (302) to:
  `{FRONTEND_URL}/projects/{projectId}/settings?integration=error&provider=clickup`
- If `code` or `state` is missing/unparseable: browser is redirected (302) to
  `{FRONTEND_URL}?integration=error&provider=clickup` (fallback — `handleCallback` handles
  this internally; the controller always delegates to the service).

### AC3 — Token exchange with ClickUp API

- `ClickUpOAuthService.exchangeCode(code: string): Promise<ClickUpTokenResponse>` performs:
  ```
  POST https://api.clickup.com/api/v2/oauth/token
  Query params: client_id, client_secret, code, redirect_uri
  ```
  **IMPORTANT:** ClickUp token exchange uses query params — NOT a JSON body. Pass via axios
  `params:` option (same pattern as CS0-4's `refreshTokens`).
- **ClickUp token response shape (authoritative):**
  ```typescript
  {
    access_token: string;
    token_type: string;
  }
  ```
  ClickUp workspace OAuth tokens are **non-expiring**. The response does **NOT** include
  `refresh_token` or `expires_in`. Store both `refresh_token = null` and `token_expiry = null`
  unconditionally. This is consistent with CS0-4's refresh logic which skips refresh when
  `token_expiry` is `null`.
- Throws `IntegrationAuthException('pending', cause)` if response does not contain `access_token`.

### AC4 — Capture bot identity via ClickUpProvider

- After token exchange, instantiate `ClickUpProvider` **directly** (not via `PMProviderFactory` —
  no persisted record exists yet at this stage):
  ```typescript
  const provider = new ClickUpProvider(access_token);
  const self = await provider.getSelf();
  ```
- `getSelf()` is defined in `IPMProvider` (CS0-2). The **expected return contract** is:
  ```typescript
  { id: string; name: string; email?: string }
  ```
  Read `src/integrations/providers/pm-provider.interface.ts` to confirm the actual shape after
  CS0-2 is implemented. Map `self.id → bot_user_id`, `self.name → bot_username`.
- Make a separate axios `GET` call to `{clickup.apiUrl}/team` to get workspace info. Use the
  **first** team: `workspace_id = String(teams[0].id)`, `workspace_name = teams[0].name`.
- If `getSelf()` **or** workspace lookup throws: log at `warn` level, do **not** abort the flow.
  Fall back to `bot_user_id = null`, `bot_username = null`, `workspace_id = 'unknown'`,
  `workspace_name = 'ClickUp Workspace'`. The integration record must still be persisted.

### AC5 — Upsert ProjectIntegration record

- Add `upsertIntegration(projectId: string, provider: IntegrationProvider, data:
UpsertIntegrationData): Promise<ProjectIntegration>` to `ProjectIntegrationService`.
  - `UpsertIntegrationData` is a typed interface (see Dev Notes scaffold) — do NOT use
    `Prisma.ProjectIntegrationUncheckedCreateInput` directly, as it conflates create vs update
    input types.
  - Uses `this.prisma.projectIntegration.upsert` on the `project_id_provider` unique key.
  - Encrypts `access_token` and `refresh_token` before persisting (same pattern as
    `createIntegration`). `refresh_token = null` is stored as-is (no encryption needed for null).
  - Returns decrypted `ProjectIntegration` via `decryptTokens`.
- `ClickUpOAuthService.handleCallback` calls upsert with:
  ```typescript
  { workspace_id, workspace_name, access_token, refresh_token: null, token_expiry: null,
    bot_user_id, bot_username, provider_config: {} }
  ```

### AC6 — Disconnect endpoint

- `DELETE /api/v1/integrations/clickup?project_id={id}` is in `ClickUpOAuthController`.
- Protected per-method with `@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)` and
  `@Roles(Role.PM, Role.MANAGER, Role.ADMIN)`.
- Calls `ProjectIntegrationService.deleteIntegration(projectId, IntegrationProvider.CLICKUP)`.
- Add `deleteIntegration(projectId: string, provider: IntegrationProvider): Promise<void>` to
  `ProjectIntegrationService`:
  - Requires `import { Prisma } from '@prisma/client'` (separate from `{ ProjectIntegration,
IntegrationProvider }`).
  - Catches `Prisma.PrismaClientKnownRequestError` with `error.code === 'P2025'` → re-throws as
    `NotFoundException`.
- Returns `{ message: 'ClickUp integration disconnected successfully' }`.

### AC7 — Config additions

**`src/config/configuration.ts`** — extend the `clickup` block. CS0-4 already added `clientId`
and `clientSecret`; add only `redirectUri`:

```typescript
clickup: {
  apiKey: process.env.CLICKUP_API_KEY,
  apiUrl: process.env.CLICKUP_API_URL || 'https://api.clickup.com/api/v2',
  webhookSecret: process.env.CLICKUP_WEBHOOK_SECRET,
  clientId: process.env.CLICKUP_CLIENT_ID || '',       // ← CS0-4 added
  clientSecret: process.env.CLICKUP_CLIENT_SECRET || '', // ← CS0-4 added
  redirectUri: process.env.CLICKUP_REDIRECT_URI || '', // ← CS0-5 adds this line only
},
```

**`src/config/env.validation.ts`** — add after the `CLICKUP_CLIENT_SECRET` entry (from CS0-4):

```typescript
CLICKUP_REDIRECT_URI: Joi.string().uri().optional().allow(''),
```

`CLICKUP_API_KEY` and `CLICKUP_WEBHOOK_SECRET` remain `required()` — do not touch them.

`FRONTEND_URL` is **already validated** as `Joi.string().uri().required()` in `env.validation.ts`
(line ~416). Do NOT add it again.

### AC8 — Unit tests

**New file:** `src/integrations/clickup-oauth.service.spec.ts`

1. `getConnectUrl(projectId)` returns URL with correct params.
2. `getConnectUrl(projectId)` throws `BadRequestException` when `CLICKUP_CLIENT_ID` is empty.
3. `getConnectUrl(projectId)` throws `BadRequestException` when `CLICKUP_REDIRECT_URI` is empty.
4. `getConnectUrl(projectId)` throws `NotFoundException` when project does not exist.
5. `exchangeCode(code)` calls `POST .../oauth/token` with query params, null body.
6. `exchangeCode(code)` throws `IntegrationAuthException` when response has no `access_token`.
7. `handleCallback(code, state)` calls `upsertIntegration` with `token_expiry: null` and
   `refresh_token: null`.
8. `handleCallback(code, state)` calls `upsertIntegration` with fallback bot fields when
   `getSelf()` throws.
9. `handleCallback('', 'bad')` returns error redirect URL without throwing.

**New file:** `src/integrations/clickup-oauth.controller.spec.ts` 10. `GET connect` returns `{ url }`. 11. `DELETE disconnect` returns `{ message }`.

**Extend:** `src/integrations/project-integration.service.spec.ts` 12. `upsertIntegration` creates new record when none exists. 13. `upsertIntegration` updates existing record (upsert path). 14. `deleteIntegration` deletes record successfully. 15. `deleteIntegration` throws `NotFoundException` on Prisma `P2025`.

### AC9 — Type safety

- `pnpm typecheck` passes with zero errors.
- No `!` non-null assertions on `access_token`, `workspace_id`, or `workspace_name`.
- `pnpm lint` passes with zero violations.

---

## Tasks / Subtasks

- [ ] Task 1: Extend `ProjectIntegrationService` (AC: 5, 6)
  - [ ] Read `src/integrations/project-integration.service.ts` in full before editing
  - [ ] Add `import { Prisma } from '@prisma/client'` to the existing `@prisma/client` import
        (on same line or separate — keep existing `{ ProjectIntegration, IntegrationProvider }`)
  - [ ] Add `import { NotFoundException } from '@nestjs/common'` if not already present
  - [ ] Define `UpsertIntegrationData` interface above the class (see Dev Notes scaffold)
  - [ ] Add `upsertIntegration(projectId, provider, data: UpsertIntegrationData)` — encrypt
        tokens (only if string, null passes through), Prisma upsert on `project_id_provider` key,
        return decrypted result
  - [ ] Add `deleteIntegration(projectId, provider)` — catch `P2025` → `NotFoundException`

- [ ] Task 2: Add config entry for `clickup.redirectUri` (AC: 7)
  - [ ] Read `src/config/configuration.ts` — find the `clickup` block
  - [ ] Add `redirectUri: process.env.CLICKUP_REDIRECT_URI || ''` (one line only)
  - [ ] Read `src/config/env.validation.ts` — find the ClickUp OAuth section added by CS0-4
  - [ ] Add `CLICKUP_REDIRECT_URI: Joi.string().uri().optional().allow('')` after
        `CLICKUP_CLIENT_SECRET`
  - [ ] **Do NOT add `FRONTEND_URL`** — it is already `required()` at line ~416

- [ ] Task 3: Create `ClickUpOAuthService` (AC: 1–6)
  - [ ] Create `src/integrations/clickup-oauth.service.ts`
  - [ ] Inject `ConfigService`, `ProjectIntegrationService`, `PrismaService`
  - [ ] Implement `getConnectUrl(projectId: string): Promise<string>` — validate project exists
        via `prisma.project.findUniqueOrThrow`, then build URL
  - [ ] Implement `exchangeCode(code: string): Promise<ClickUpTokenResponse>` — query params,
        no body, throws `IntegrationAuthException` on missing access_token
  - [ ] Implement `getBotIdentity(accessToken: string)` — `ClickUpProvider.getSelf()` + GET
        /team in parallel; warn-level log + fallback values on any error
  - [ ] Implement `handleCallback(code: string, state: string): Promise<string>` — guards empty
        inputs, orchestrates exchange → getBotIdentity → upsert → returns redirect URL; catches all
        errors and returns error redirect URL (never throws)
  - [ ] See complete scaffold in Dev Notes

- [ ] Task 4: Create `ClickUpOAuthController` (AC: 1, 2, 6)
  - [ ] Create `src/integrations/clickup-oauth.controller.ts`
  - [ ] **No class-level guards** — per-method only (follows `github-auth-flow.controller.ts`)
  - [ ] `GET connect` — `@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)` + `@Roles(...)`,
        calls `oauthService.getConnectUrl(project_id)`, returns `{ url }`
  - [ ] `GET callback` — `@Public()` (import from `@/common/decorators`) + no guards,
        `@Res() reply: FastifyReply`, calls `oauthService.handleCallback(code, state)`, then
        `reply.redirect(redirectUrl, 302)` — **never** use `@Redirect()` decorator
  - [ ] `DELETE disconnect` — same guards as connect, calls
        `integrationService.deleteIntegration(project_id, IntegrationProvider.CLICKUP)`, returns
        `{ message }`
  - [ ] Add Swagger decorators (see scaffold in Dev Notes)

- [ ] Task 5: Register in `IntegrationsModule` (AC: wiring)
  - [ ] Read `src/integrations/integrations.module.ts` before editing
  - [ ] Add `ClickUpOAuthController` to `controllers` array
  - [ ] Add `ClickUpOAuthService` to `providers` array
  - [ ] No new module `imports` needed (ConfigService is global, DatabaseModule already present)

- [ ] Task 6: Write unit tests (AC: 8)
  - [ ] Create `src/integrations/clickup-oauth.service.spec.ts` — 9 test cases (see scaffold)
  - [ ] Create `src/integrations/clickup-oauth.controller.spec.ts` — 2 test cases
  - [ ] Extend `src/integrations/project-integration.service.spec.ts` — 4 test cases

- [ ] Task 7: Type check and lint (AC: 9)
  - [ ] `pnpm typecheck` — zero errors
  - [ ] `pnpm lint` — zero violations

---

## Dev Notes

### Dependency Order — Critical

**CS0-2, CS0-3, and CS0-4 must be `done` before starting CS0-5.**

After those stories complete, the following will exist:

- `src/integrations/providers/pm-provider.interface.ts` — `IPMProvider` with `getSelf()`
  returning `{ id: string; name: string; email?: string }`
- `src/integrations/providers/clickup/clickup.provider.ts` — `ClickUpProvider` (plain class,
  constructed as `new ClickUpProvider(accessToken: string)`)
- `src/integrations/providers/pm-provider.factory.ts` — `PMProviderFactory`
- `src/common/exceptions/integration-auth.exception.ts` — `IntegrationAuthException`
- `src/config/configuration.ts` — `clickup.clientId`, `clickup.clientSecret` (CS0-4)
- `src/config/env.validation.ts` — `CLICKUP_CLIENT_ID`, `CLICKUP_CLIENT_SECRET` optional (CS0-4)

**Read each file before editing.** If actual `getSelf()` return shape differs from the expected
contract `{ id: string; name: string }`, update the field mappings in `getBotIdentity`.

### Why a Separate `ClickUpOAuthController` (Not Adding to `IntegrationsController`)

`IntegrationsController` has class-level `@UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)`.
The OAuth callback must be public (no JWT — it's a browser redirect from ClickUp). Adding
`@Public()` to a method inside a class-decorated-with-UseGuards works for `JwtAuthGuard` (which
checks `IS_PUBLIC_KEY`) but creates confusion and fragility.

The established project pattern is a **separate controller** with no class-level guards:

- Reference: `src/github/github-auth-flow.controller.ts` — separate from `github.service.ts`

Create `src/integrations/clickup-oauth.controller.ts` with `@Controller('integrations/clickup')`.

### Mandatory Fastify Redirect Pattern

There are **zero** `@Redirect()` usages in this codebase. The project uses `NestFastifyApplication`
with `FastifyAdapter`. Do **NOT** use `@Redirect()` — it is untested with this Fastify setup.

**Use this pattern for the callback:**

```typescript
import { FastifyReply } from 'fastify';
import { Res } from '@nestjs/common';

@Get('callback')
async callback(
  @Query('code') code: string,
  @Query('state') state: string,
  @Res() reply: FastifyReply,
): Promise<void> {
  const redirectUrl = await this.oauthService.handleCallback(code ?? '', state ?? '');
  return reply.redirect(redirectUrl, 302);
}
```

Fastify's `reply.redirect(url, statusCode)` is the authoritative redirect method — no decorator
needed. Note: argument order is `(url, statusCode)` in Fastify, opposite from Express.

### ClickUp OAuth — Exact API Details

**Auth URL (user redirect from frontend):**

```
https://app.clickup.com/api?client_id={clientId}&redirect_uri={redirectUri}&state={state}
```

Note: auth is at `app.clickup.com`, not `api.clickup.com`.

**Token Exchange (server-to-server POST):**

```
POST https://api.clickup.com/api/v2/oauth/token
Query params: client_id, client_secret, code, redirect_uri
Body: null
```

Use axios `params:` option, `null` body — identical to CS0-4's `refreshTokens`.

**ClickUp token response (authoritative — non-expiring tokens):**

```typescript
interface ClickUpTokenResponse {
  access_token: string; // e.g. "pk_abc123"
  token_type: string; // "Bearer"
  // NO refresh_token — ClickUp workspace tokens do not have refresh tokens
  // NO expires_in — ClickUp workspace tokens are non-expiring
}
```

Store `refresh_token = null` and `token_expiry = null`. This is consistent with CS0-4 which
skips refresh when `token_expiry` is `null`.

**Get user identity:**

```
GET https://api.clickup.com/api/v2/user
Authorization: Bearer {access_token}
Response: { user: { id: number, username: string, email: string } }
```

**Get workspace/team:**

```
GET https://api.clickup.com/api/v2/team
Authorization: Bearer {access_token}
Response: { teams: [{ id: number, name: string }, ...] }
```

### `@Public()` Decorator — How It Works

Located at `src/common/decorators/public.decorator.ts`, exported from
`src/common/decorators/index.ts`.

`JwtAuthGuard.canActivate()` calls `this.reflector.getAllAndOverride(IS_PUBLIC_KEY, [handler,
class])` — if any handler OR class has `@Public()`, JWT is skipped. The callback handler must
have `@Public()`. Established usage: `webhooks.controller.ts:67`, `auth.controller.ts:44`.

### `UpsertIntegrationData` Interface for `ProjectIntegrationService`

Define this interface above the service class to avoid mixing Prisma `UncheckedCreateInput` and
`UncheckedUpdateInput` types (they differ for required vs optional fields):

```typescript
// Add above ProjectIntegrationService class
interface UpsertIntegrationData {
  workspace_id: string;
  workspace_name: string;
  access_token?: string | null;
  refresh_token?: string | null;
  token_expiry?: Date | null;
  bot_user_id?: string | null;
  bot_username?: string | null;
  provider_config?: Record<string, unknown>;
  polling_enabled?: boolean;
  webhook_enabled?: boolean;
}
```

### Complete `ClickUpOAuthService` Scaffold

```typescript
// src/integrations/clickup-oauth.service.ts
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { IntegrationProvider } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ProjectIntegrationService } from './project-integration.service';
import { ClickUpProvider } from './providers/clickup/clickup.provider';
import { IntegrationAuthException } from '../common/exceptions/integration-auth.exception';

interface ClickUpTokenResponse {
  access_token: string;
  token_type: string;
  // ClickUp workspace tokens are non-expiring: no refresh_token, no expires_in
}

@Injectable()
export class ClickUpOAuthService {
  private readonly logger = new Logger(ClickUpOAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly integrationService: ProjectIntegrationService,
  ) {}

  async getConnectUrl(projectId: string): Promise<string> {
    const clientId = this.config.get<string>('clickup.clientId') ?? '';
    const redirectUri = this.config.get<string>('clickup.redirectUri') ?? '';

    if (!clientId) throw new BadRequestException('CLICKUP_CLIENT_ID is not configured');
    if (!redirectUri) throw new BadRequestException('CLICKUP_REDIRECT_URI is not configured');

    // Validate project exists
    await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } }).catch(() => {
      throw new NotFoundException(`Project ${projectId} not found`);
    });

    const state = `${projectId}:CLICKUP`;
    return (
      `https://app.clickup.com/api` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}`
    );
  }

  async exchangeCode(code: string): Promise<ClickUpTokenResponse> {
    const clientId = this.config.get<string>('clickup.clientId') ?? '';
    const clientSecret = this.config.get<string>('clickup.clientSecret') ?? '';
    const redirectUri = this.config.get<string>('clickup.redirectUri') ?? '';
    const apiUrl = this.config.get<string>('clickup.apiUrl') ?? 'https://api.clickup.com/api/v2';

    const response = await axios.post<ClickUpTokenResponse>(
      `${apiUrl}/oauth/token`,
      null, // No body — ClickUp uses query params
      {
        params: {
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        },
      },
    );

    if (!response.data.access_token) {
      throw new IntegrationAuthException(
        'pending',
        new Error('ClickUp token exchange returned no access_token'),
      );
    }

    return response.data;
  }

  async getBotIdentity(accessToken: string): Promise<{
    bot_user_id: string | null;
    bot_username: string | null;
    workspace_id: string;
    workspace_name: string;
  }> {
    const apiUrl = this.config.get<string>('clickup.apiUrl') ?? 'https://api.clickup.com/api/v2';

    try {
      const provider = new ClickUpProvider(accessToken);
      const [self, teamsResponse] = await Promise.all([
        provider.getSelf(), // Returns { id: string; name: string; email?: string }
        axios.get<{ teams: Array<{ id: number; name: string }> }>(`${apiUrl}/team`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      ]);

      const teams = teamsResponse.data.teams;
      return {
        bot_user_id: self?.id ?? null,
        bot_username: self?.name ?? null,
        workspace_id: teams.length > 0 ? String(teams[0].id) : 'unknown',
        workspace_name: teams.length > 0 ? teams[0].name : 'ClickUp Workspace',
      };
    } catch (error) {
      this.logger.warn(
        'Failed to fetch ClickUp bot identity or workspace — using fallback values',
        {
          error: error instanceof Error ? error.message : error,
        },
      );
      return {
        bot_user_id: null,
        bot_username: null,
        workspace_id: 'unknown',
        workspace_name: 'ClickUp Workspace',
      };
    }
  }

  async handleCallback(code: string, state: string): Promise<string> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL') ?? '';
    const parts = (state ?? '').split(':');
    const projectId = parts.length >= 2 ? parts[0] : '';
    const fallbackUrl = projectId
      ? `${frontendUrl}/projects/${projectId}/settings?integration=error&provider=clickup`
      : `${frontendUrl}?integration=error&provider=clickup`;

    try {
      if (!code || !projectId) {
        throw new Error(`Missing code or unparseable state: "${state}"`);
      }

      const tokenData = await this.exchangeCode(code);
      const identity = await this.getBotIdentity(tokenData.access_token);

      await this.integrationService.upsertIntegration(projectId, IntegrationProvider.CLICKUP, {
        workspace_id: identity.workspace_id,
        workspace_name: identity.workspace_name,
        access_token: tokenData.access_token,
        refresh_token: null, // ClickUp tokens are non-expiring
        token_expiry: null, // ClickUp tokens are non-expiring
        bot_user_id: identity.bot_user_id,
        bot_username: identity.bot_username,
        provider_config: {},
      });

      this.logger.log(
        `ClickUp OAuth connected project ${projectId} to workspace "${identity.workspace_name}"`,
      );
      return `${frontendUrl}/projects/${projectId}/settings?integration=connected&provider=clickup`;
    } catch (error) {
      this.logger.error('ClickUp OAuth callback failed', {
        projectId,
        error: error instanceof Error ? error.message : error,
      });
      return fallbackUrl;
    }
  }
}
```

### Complete `ClickUpOAuthController` Scaffold

```typescript
// src/integrations/clickup-oauth.controller.ts
import {
  Controller,
  Get,
  Delete,
  Query,
  UseGuards,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';
import { JwtAuthGuard } from '@/common/guards/auth.guard';
import { RolesGuard } from '@/common/guards/roles.guard';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Roles } from '@/common/decorators/roles.decorator';
import { Public } from '@/common/decorators'; // from src/common/decorators/index.ts
import { Role } from '@/auth/constants/roles.enum';
import { IntegrationProvider } from '@prisma/client';
import { ClickUpOAuthService } from './clickup-oauth.service';
import { ProjectIntegrationService } from './project-integration.service';

@ApiTags('Integrations')
@Controller('integrations/clickup') // routes: GET /api/v1/integrations/clickup/...
export class ClickUpOAuthController {
  private readonly logger = new Logger(ClickUpOAuthController.name);

  constructor(
    private readonly oauthService: ClickUpOAuthService,
    private readonly integrationService: ProjectIntegrationService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Roles(Role.PM, Role.MANAGER, Role.ADMIN)
  @Get('connect')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get ClickUp OAuth authorization URL for a project' })
  @ApiQuery({ name: 'project_id', required: true, description: 'Project UUID' })
  @ApiResponse({ status: 200, description: 'Returns { url } to redirect the user to ClickUp' })
  @ApiResponse({ status: 400, description: 'OAuth credentials not configured' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async connect(@Query('project_id') projectId: string) {
    return { url: await this.oauthService.getConnectUrl(projectId) };
  }

  @Public() // REQUIRED: bypasses JwtAuthGuard for ClickUp browser redirect
  @Get('callback')
  @ApiOperation({ summary: 'ClickUp OAuth callback — browser redirect from ClickUp' })
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'state', required: false })
  @ApiResponse({ status: 302, description: 'Redirects to frontend project settings' })
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    // handleCallback never throws — always returns a redirect URL
    const redirectUrl = await this.oauthService.handleCallback(code ?? '', state ?? '');
    return reply.redirect(redirectUrl, 302);
  }

  @UseGuards(JwtAuthGuard, RolesGuard, ThrottlerGuard)
  @Roles(Role.PM, Role.MANAGER, Role.ADMIN)
  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect ClickUp integration from a project' })
  @ApiQuery({ name: 'project_id', required: true, description: 'Project UUID' })
  @ApiResponse({ status: 200, description: 'Integration disconnected' })
  @ApiResponse({ status: 404, description: 'Integration not found' })
  async disconnect(@Query('project_id') projectId: string) {
    await this.integrationService.deleteIntegration(projectId, IntegrationProvider.CLICKUP);
    return { message: 'ClickUp integration disconnected successfully' };
  }
}
```

### `ProjectIntegrationService` — New Methods Scaffold

```typescript
// Add BEFORE the class declaration in project-integration.service.ts
interface UpsertIntegrationData {
  workspace_id: string;
  workspace_name: string;
  access_token?: string | null;
  refresh_token?: string | null;
  token_expiry?: Date | null;
  bot_user_id?: string | null;
  bot_username?: string | null;
  provider_config?: Record<string, unknown>;
  polling_enabled?: boolean;
  webhook_enabled?: boolean;
}

// Update imports — add Prisma and NotFoundException:
// import { ProjectIntegration, IntegrationProvider, Prisma } from '@prisma/client';
// import { Injectable, NotFoundException } from '@nestjs/common';

// --- Add inside class ---

async upsertIntegration(
  projectId: string,
  provider: IntegrationProvider,
  data: UpsertIntegrationData,
): Promise<ProjectIntegration> {
  // Encrypt tokens — only string values; null passes through unchanged
  const encryptedData = { ...data } as Record<string, unknown>;
  if (typeof data.access_token === 'string') {
    encryptedData.access_token = this.encryption.encrypt(data.access_token);
  }
  if (typeof data.refresh_token === 'string') {
    encryptedData.refresh_token = this.encryption.encrypt(data.refresh_token);
  }

  const result = await this.prisma.projectIntegration.upsert({
    where: { project_id_provider: { project_id: projectId, provider } },
    create: { project_id: projectId, provider, ...encryptedData } as Prisma.ProjectIntegrationUncheckedCreateInput,
    update: encryptedData as Prisma.ProjectIntegrationUncheckedUpdateInput,
  });

  return this.decryptTokens(result);
}

async deleteIntegration(projectId: string, provider: IntegrationProvider): Promise<void> {
  try {
    await this.prisma.projectIntegration.delete({
      where: { project_id_provider: { project_id: projectId, provider } },
    });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new NotFoundException(`No ${provider} integration found for project ${projectId}`);
    }
    throw error;
  }
}
```

### `IntegrationsModule` Changes

```typescript
// src/integrations/integrations.module.ts (after changes)
import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { ClickUpOAuthController } from './clickup-oauth.controller'; // NEW
import { ClickUpModule } from '../clickup/clickup.module';
import { ProjectIntegrationService } from './project-integration.service';
import { ClickUpOAuthService } from './clickup-oauth.service'; // NEW
import { DatabaseModule } from '../database/database.module';
import { EncryptionModule } from '../common/encryption/encryption.module';

@Module({
  imports: [ClickUpModule, DatabaseModule, EncryptionModule],
  controllers: [IntegrationsController, ClickUpOAuthController], // NEW controller
  providers: [ProjectIntegrationService, ClickUpOAuthService], // NEW service
  exports: [ProjectIntegrationService],
})
export class IntegrationsModule {}
```

### Test Scaffold for `ClickUpOAuthService`

```typescript
// src/integrations/clickup-oauth.service.spec.ts
import axios from 'axios';
import { ClickUpOAuthService } from './clickup-oauth.service';
import { ProjectIntegrationService } from './project-integration.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { IntegrationAuthException } from '../common/exceptions/integration-auth.exception';
import { ClickUpProvider } from './providers/clickup/clickup.provider';

jest.mock('axios');
jest.mock('./providers/clickup/clickup.provider');
const mockedAxios = axios as jest.Mocked<typeof axios>;
const MockedClickUpProvider = ClickUpProvider as jest.MockedClass<typeof ClickUpProvider>;

const MOCK_CONFIG: Record<string, string> = {
  'clickup.clientId': 'test-client-id',
  'clickup.clientSecret': 'test-client-secret',
  'clickup.redirectUri': 'https://api.example.com/api/v1/integrations/clickup/callback',
  'clickup.apiUrl': 'https://api.clickup.com/api/v2',
  FRONTEND_URL: 'https://app.example.com',
};

describe('ClickUpOAuthService', () => {
  let service: ClickUpOAuthService;
  let integrationService: jest.Mocked<ProjectIntegrationService>;
  let configService: jest.Mocked<ConfigService>;
  let prismaService: { project: { findUniqueOrThrow: jest.Mock } };

  beforeEach(() => {
    integrationService = { upsertIntegration: jest.fn().mockResolvedValue({ id: 'int-1' }) } as any;
    configService = { get: jest.fn((key: string) => MOCK_CONFIG[key] ?? '') } as any;
    prismaService = {
      project: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'project-1' }) },
    };
    service = new ClickUpOAuthService(configService, prismaService as any, integrationService);
    jest.clearAllMocks();
  });

  describe('getConnectUrl', () => {
    it('returns correct ClickUp auth URL', async () => {
      const url = await service.getConnectUrl('project-1');
      expect(url).toContain('app.clickup.com/api');
      expect(url).toContain('client_id=test-client-id');
      expect(url).toContain('project-1');
      expect(prismaService.project.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'project-1' },
      });
    });

    it('throws BadRequestException when clientId empty', async () => {
      configService.get.mockReturnValue('');
      await expect(service.getConnectUrl('p-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when redirectUri empty', async () => {
      configService.get.mockImplementation((k: string) => (k === 'clickup.clientId' ? 'id' : ''));
      await expect(service.getConnectUrl('p-1')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when project does not exist', async () => {
      prismaService.project.findUniqueOrThrow.mockRejectedValue(new Error('Not found'));
      await expect(service.getConnectUrl('bad-project')).rejects.toThrow(NotFoundException);
    });
  });

  describe('exchangeCode', () => {
    it('calls token endpoint with query params and null body', async () => {
      mockedAxios.post.mockResolvedValue({
        data: { access_token: 'pk_abc', token_type: 'Bearer' },
      });
      const result = await service.exchangeCode('auth-code');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('/oauth/token'),
        null,
        expect.objectContaining({ params: expect.objectContaining({ code: 'auth-code' }) }),
      );
      expect(result.access_token).toBe('pk_abc');
    });

    it('throws IntegrationAuthException when access_token missing', async () => {
      mockedAxios.post.mockResolvedValue({ data: {} });
      await expect(service.exchangeCode('bad')).rejects.toThrow(IntegrationAuthException);
    });
  });

  describe('handleCallback', () => {
    beforeEach(() => {
      // ClickUp response has NO expires_in or refresh_token
      mockedAxios.post.mockResolvedValue({
        data: { access_token: 'pk_abc', token_type: 'Bearer' },
      });
      MockedClickUpProvider.prototype.getSelf = jest
        .fn()
        .mockResolvedValue({ id: '123', name: 'Bot' });
      mockedAxios.get.mockResolvedValue({ data: { teams: [{ id: 99, name: 'Test WS' }] } });
    });

    it('upserts with token_expiry: null and refresh_token: null', async () => {
      await service.handleCallback('code', 'project-1:CLICKUP');
      expect(integrationService.upsertIntegration).toHaveBeenCalledWith(
        'project-1',
        expect.anything(),
        expect.objectContaining({ token_expiry: null, refresh_token: null }),
      );
    });

    it('returns connected URL on success', async () => {
      const url = await service.handleCallback('code', 'project-1:CLICKUP');
      expect(url).toContain('integration=connected&provider=clickup');
    });

    it('upserts with fallback values when getSelf throws', async () => {
      MockedClickUpProvider.prototype.getSelf = jest.fn().mockRejectedValue(new Error('down'));
      mockedAxios.get.mockRejectedValue(new Error('down'));
      await service.handleCallback('code', 'project-1:CLICKUP');
      expect(integrationService.upsertIntegration).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ bot_user_id: null, bot_username: null }),
      );
    });

    it('returns error URL without throwing when code is empty', async () => {
      const url = await service.handleCallback('', 'project-1:CLICKUP');
      expect(url).toContain('integration=error');
      expect(integrationService.upsertIntegration).not.toHaveBeenCalled();
    });
  });
});
```

### Files to Create

| File                                                | Action |
| --------------------------------------------------- | ------ |
| `src/integrations/clickup-oauth.service.ts`         | CREATE |
| `src/integrations/clickup-oauth.controller.ts`      | CREATE |
| `src/integrations/clickup-oauth.service.spec.ts`    | CREATE |
| `src/integrations/clickup-oauth.controller.spec.ts` | CREATE |

### Files to Modify

| File                                                   | Change                                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `src/integrations/project-integration.service.ts`      | Add `UpsertIntegrationData` interface, `upsertIntegration`, `deleteIntegration`; add `Prisma` to `@prisma/client` import |
| `src/integrations/project-integration.service.spec.ts` | Add 4 new test cases                                                                                                     |
| `src/integrations/integrations.module.ts`              | Add `ClickUpOAuthController` + `ClickUpOAuthService`                                                                     |
| `src/config/configuration.ts`                          | Add `clickup.redirectUri` (one line only)                                                                                |
| `src/config/env.validation.ts`                         | Add `CLICKUP_REDIRECT_URI` optional Joi entry after CS0-4's entries                                                      |

### DO NOT MODIFY

- `src/integrations/integrations.controller.ts` — no changes needed (new controller handles OAuth)
- `src/integrations/providers/clickup/clickup.provider.ts` — no changes
- `src/integrations/providers/pm-provider.factory.ts` — CS0-4's work
- `src/integrations/providers/pm-provider.interface.ts` — CS0-2's work
- `src/clickup/clickup.service.ts` — deprecated; CS0-3 migrated it
- `src/config/env.validation.ts` — do NOT add `FRONTEND_URL`; it's already `required()` at ~line 416

### Previous Story Learnings

**CS0-1 (done):**

- `ProjectIntegration` Prisma unique constraint: `@@unique([project_id, provider])` →
  Prisma where key: `{ project_id_provider: { project_id, provider } }`
- `workspace_id String` and `workspace_name String` are **non-nullable** — must always provide
  fallback strings, not null
- `access_token String?`, `refresh_token String?` — nullable, encrypted by `EncryptionService`
- `ProjectIntegrationService.decryptTokens()` is `private` — only usable within the service

**CS0-4 (must be done before CS0-5):**

- `CLICKUP_CLIENT_ID` and `CLICKUP_CLIENT_SECRET` already in config as `clickup.clientId` /
  `clickup.clientSecret`; CS0-5 adds only `redirectUri`
- `IntegrationAuthException(integrationId, cause?)` constructor signature

**GitHub OAuth pattern (existing, established):**

- `github-auth-flow.controller.ts` — separate controller, per-method `@UseGuards(JwtAuthGuard)`
- `github-auth-flow.service.ts` — injects `ConfigService`, `PrismaService`, `EncryptionService`
  directly; does NOT go through a service layer for DB writes
- `this.config.get<string>('FRONTEND_URL')` — reads directly from env (top-level key, not nested)

### References

- [Source: _bmad-output/planning-artifacts/epics-clickup-smart-sync.md#Story 0.4 — Generic OAuth Flow Backend]
- [Source: epics-clickup-smart-sync.md#FR-CS0A, FR-CS0C]
- [GitHub OAuth pattern: src/github/github-auth-flow.service.ts]
- [GitHub OAuth controller: src/github/github-auth-flow.controller.ts]
- [Public decorator: src/common/decorators/public.decorator.ts]
- [Auth guard @Public() usage: src/webhooks/webhooks.controller.ts:67]
- [ProjectIntegrationService: src/integrations/project-integration.service.ts]
- [IntegrationsModule: src/integrations/integrations.module.ts]
- [Prisma schema ProjectIntegration: prisma/schema.prisma#L1260]
- [IntegrationAuthException: src/common/exceptions/integration-auth.exception.ts]
- [FRONTEND_URL validation: src/config/env.validation.ts#L416]

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
