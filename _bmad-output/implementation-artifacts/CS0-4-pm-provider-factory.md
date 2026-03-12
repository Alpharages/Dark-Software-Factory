# Story CS0.4: PMProviderFactory — Token Refresh & Exception Hardening

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **DSF system**,
I want `PMProviderFactory` to transparently refresh OAuth tokens before they expire and
throw typed exceptions for unsupported providers or auth failures,
so that all callers receive a ready-to-use `IPMProvider` without managing token lifecycle themselves.

## Acceptance Criteria

### AC1 — Factory method signature matches Epic spec

- `PMProviderFactory.getProvider(integration: ProjectIntegration): Promise<IPMProvider>` is the
  primary public method (NOT `getProvider(integrationId: string)`).
- It accepts a decrypted `ProjectIntegration` record (already fetched by the caller via
  `findByProjectAndProvider()` or `getDecryptedIntegration()`) and returns a fully initialized `IPMProvider`.
- CS0-3 wired the CLICKUP case into the switch statement. CS0-4 adds refresh + exception logic on top.

### AC2 — Transparent token refresh (5-minute window)

- Before constructing the provider, the factory checks `integration.token_expiry`.
- If `integration.token_expiry` is non-null **and** `Date.now() + 300_000 > integration.token_expiry.getTime()`,
  the factory calls its private `refreshTokens(integration)` helper.
- `refreshTokens` sends `POST https://api.clickup.com/api/v2/oauth/token` with query params:
  `client_id`, `client_secret`, `grant_type=refresh_token`, `refresh_token`
- On success: calls `ProjectIntegrationService.updateIntegration(id, { access_token, refresh_token, token_expiry })`
  and returns the updated decrypted integration. Provider is constructed with the **new** access token.
- If `token_expiry` is null (non-expiring API key): skip refresh entirely.

### AC3 — Null guards before provider construction

- If `activeIntegration.access_token` is null after all refresh attempts:
  throw `IntegrationAuthException(integration.id, new Error('No access token available'))`.
- In `refreshTokens`: if `integration.refresh_token` is null:
  throw `IntegrationAuthException(integration.id, new Error('No refresh token available — cannot refresh'))`.
- These guards prevent non-null assertions from crashing at runtime with misleading errors.

### AC4 — Config wiring for OAuth credentials

- `PMProviderFactory` injects `ConfigService` from `@nestjs/config` and reads:
  - `config.get<string>('clickup.clientId')` → `CLICKUP_CLIENT_ID`
  - `config.get<string>('clickup.clientSecret')` → `CLICKUP_CLIENT_SECRET`
- Both keys are added to `src/config/configuration.ts` under the existing `clickup` block (optional, default `''`).
- Both keys are added to `src/config/env.validation.ts` as `Joi.string().optional().allow('')`.
- **DO NOT remove or change** `CLICKUP_API_KEY: Joi.string().required()` — it stays required until CS1.

### AC5 — Typed exception: UnsupportedProviderException

- File: `src/common/exceptions/unsupported-provider.exception.ts`
- Extends `HttpException` with `HttpStatus.BAD_REQUEST`.
- Constructor: `(provider: string)` → message `"PM provider '${provider}' is not supported by PMProviderFactory"`
- Thrown in the `default` case of the provider switch.

### AC6 — Typed exception: IntegrationAuthException

- File: `src/common/exceptions/integration-auth.exception.ts`
- Extends `HttpException` with `HttpStatus.UNAUTHORIZED`.
- Constructor: `(integrationId: string, cause?: unknown)` → message `"Token refresh failed for integration '${integrationId}'"`
- Thrown when: refresh HTTP call fails, OAuth credentials not configured, or token fields are null.
- Preserves the original error via `this.cause = cause`.

### AC7 — Config backward-compatibility

- Existing `CLICKUP_API_KEY` and `CLICKUP_WEBHOOK_SECRET` are untouched (stay required in env.validation.ts).
- New vars `CLICKUP_CLIENT_ID`, `CLICKUP_CLIENT_SECRET` are optional — server starts without them.
- If absent at refresh time: log `warn` and throw `IntegrationAuthException` with message
  `'OAuth credentials not configured'`.

### AC8 — Error logging with correlation context

- Logger: `private readonly logger = new Logger(PMProviderFactory.name)`.
- Log context on all errors: `{ integrationId: integration.id, provider: integration.provider }`.

### AC9 — Unit tests

- File: `src/integrations/providers/pm-provider.factory.spec.ts`
- Must cover:
  1. Returns `ClickUpProvider` for `IntegrationProvider.CLICKUP` (no refresh, valid token)
  2. Refreshes token when within 5-min window; uses new token for provider construction
  3. Does NOT refresh when `token_expiry` is null
  4. Does NOT refresh when token is far from expiry
  5. Throws `UnsupportedProviderException` for unknown provider
  6. Throws `IntegrationAuthException` when refresh HTTP call fails
  7. Throws `IntegrationAuthException` when `refresh_token` is null
  8. Throws `IntegrationAuthException` when `access_token` is null after refresh
  9. Updates DB with new tokens after successful refresh

### AC10 — Type safety

- `pnpm typecheck` passes with zero errors. No `!` non-null assertions on `access_token`.

## Tasks / Subtasks

- [ ] Task 1: Create `UnsupportedProviderException` (AC: 5)
  - [ ] Create `src/common/exceptions/unsupported-provider.exception.ts`
  - [ ] Extend `HttpException` with `HttpStatus.BAD_REQUEST`
  - [ ] Constructor: `(provider: string)` → message template as specified

- [ ] Task 2: Create `IntegrationAuthException` (AC: 6)
  - [ ] Create `src/common/exceptions/integration-auth.exception.ts`
  - [ ] Extend `HttpException` with `HttpStatus.UNAUTHORIZED`
  - [ ] Constructor: `(integrationId: string, cause?: unknown)` → store `this.cause = cause`

- [ ] Task 3: Add ClickUp OAuth config entries (AC: 4, 7)
  - [ ] In `src/config/configuration.ts`, extend the existing `clickup` block (add 2 lines only):
    ```typescript
    clickup: {
      apiKey: process.env.CLICKUP_API_KEY,
      apiUrl: process.env.CLICKUP_API_URL || 'https://api.clickup.com/api/v2',
      webhookSecret: process.env.CLICKUP_WEBHOOK_SECRET,
      clientId: process.env.CLICKUP_CLIENT_ID || '',      // ← add
      clientSecret: process.env.CLICKUP_CLIENT_SECRET || '', // ← add
    },
    ```
  - [ ] In `src/config/env.validation.ts`, add after the existing ClickUp block (do NOT touch `CLICKUP_API_KEY: Joi.string().required()`):
    ```typescript
    CLICKUP_CLIENT_ID: Joi.string().optional().allow(''),
    CLICKUP_CLIENT_SECRET: Joi.string().optional().allow(''),
    ```

- [ ] Task 4: Extend `PMProviderFactory` (AC: 1, 2, 3, 4, 5, 6, 7, 8)
  - [ ] **Read `src/integrations/providers/pm-provider.factory.ts` first** to understand CS0-3's state
  - [ ] Add `import { ConfigService } from '@nestjs/config'` (globally available — no module import needed)
  - [ ] Add `import axios from 'axios'` for the token refresh HTTP call
  - [ ] Inject `ConfigService` in constructor alongside existing `ProjectIntegrationService`
  - [ ] Add `private readonly logger = new Logger(PMProviderFactory.name)`
  - [ ] Remove any redundant `getDecryptedIntegration()` call CS0-3 may have added (callers already pass decrypted integration)
  - [ ] Implement `private async refreshTokens(integration: ProjectIntegration): Promise<ProjectIntegration>` — see full implementation in Dev Notes
  - [ ] In `getProvider()`: add the refresh check + null guards + replace bare `throw new Error()` default with `throw new UnsupportedProviderException()`

- [ ] Task 5: Write unit tests (AC: 9)
  - [ ] Create `src/integrations/providers/pm-provider.factory.spec.ts`
  - [ ] Use `jest.mock('axios')` at module level — then `(axios as jest.Mocked<typeof axios>).post`
  - [ ] All 9 test cases from AC9 (see Testing Strategy in Dev Notes for full scaffold)

- [ ] Task 6: Type check and lint (AC: 10)
  - [ ] `pnpm typecheck` — zero errors (no `!` assertions on nullable fields)
  - [ ] `pnpm lint` — zero ESLint violations

## Dev Notes

### Dependency Order — Critical

**CS0-3 must be `done` before starting CS0-4.** After CS0-3 completes, these will exist:

- `src/integrations/providers/pm-provider.factory.ts` — skeleton with CLICKUP switch case
- `src/integrations/providers/pm-provider.interface.ts` — IPMProvider interface (from CS0-2)
- `src/integrations/providers/dto/` — normalized DTOs (from CS0-2)
- `src/integrations/providers/clickup/clickup.provider.ts` — ClickUpProvider class (from CS0-3)
- `PMProviderFactory` registered in `IntegrationsModule` providers + exports (from CS0-3)

**Read `pm-provider.factory.ts` before editing.** CS0-4 extends it; do not rewrite what CS0-3 built.

### ConfigService — No Module Import Needed

`src/config/config.module.ts` is decorated `@Global()` and configures `NestConfigModule.forRoot({ isGlobal: true })`. This makes `ConfigService` from `@nestjs/config` injectable everywhere in the application **without** importing ConfigModule in individual modules.

```typescript
// Correct — just inject it:
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PMProviderFactory {
  constructor(
    private readonly integrationService: ProjectIntegrationService,
    private readonly config: ConfigService, // ← globally available, no module import needed
  ) {}
}
```

Pattern confirmed by: `src/integrations/aetherflow/aetherflow-client.service.ts` which injects `ConfigService` the same way.

**Do NOT add `ConfigModule` to `IntegrationsModule` imports** — it's already global.

### Factory Method Signature — IMPORTANT

Per Epic spec (`epics-clickup-smart-sync.md` Story 0.2):

```typescript
async getProvider(integration: ProjectIntegration): Promise<IPMProvider>
```

The integration is passed in **already decrypted** by the caller. The factory only needs to:

1. Check token expiry + refresh if needed
2. Null-guard the access_token
3. Dispatch to the correct provider constructor

Consistent with CS0-3's polling orchestrator migration:

```typescript
const provider = await this.providerFactory.getProvider(integration);
```

### What the CS0-3 Factory Looks Like (Expected Pre-CS0-4 State)

```typescript
@Injectable()
export class PMProviderFactory {
  constructor(private readonly integrationService: ProjectIntegrationService) {}

  async getProvider(integration: ProjectIntegration): Promise<IPMProvider> {
    const decrypted = await this.integrationService.getDecryptedIntegration(integration.id);
    switch (decrypted.provider) {
      case IntegrationProvider.CLICKUP:
        return new ClickUpProvider(decrypted.access_token!);
      default:
        throw new Error(`Unsupported provider: ${decrypted.provider}`);
    }
  }
}
```

**CS0-4 changes:**

- Remove the redundant `getDecryptedIntegration()` call — caller already passes decrypted integration
- Add ConfigService injection
- Add `refreshTokens()` private method
- Add null guards on `refresh_token` and `access_token`
- Replace bare `throw new Error(...)` with `throw new UnsupportedProviderException(...)`

### Complete Factory After CS0-4

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { ProjectIntegration, IntegrationProvider } from '@prisma/client';
import { ProjectIntegrationService } from '../project-integration.service';
import { IPMProvider } from './pm-provider.interface';
import { ClickUpProvider } from './clickup/clickup.provider';
import { UnsupportedProviderException } from '../../common/exceptions/unsupported-provider.exception';
import { IntegrationAuthException } from '../../common/exceptions/integration-auth.exception';

@Injectable()
export class PMProviderFactory {
  private readonly logger = new Logger(PMProviderFactory.name);

  constructor(
    private readonly integrationService: ProjectIntegrationService,
    private readonly config: ConfigService,
  ) {}

  async getProvider(integration: ProjectIntegration): Promise<IPMProvider> {
    try {
      let activeIntegration = integration;

      // Transparent token refresh — trigger within 5-minute expiry window
      if (
        integration.token_expiry !== null &&
        Date.now() + 300_000 > integration.token_expiry.getTime()
      ) {
        this.logger.debug('Token near expiry, refreshing', { integrationId: integration.id });
        activeIntegration = await this.refreshTokens(integration);
      }

      // Null guard — access_token must be present before constructing provider
      if (!activeIntegration.access_token) {
        throw new IntegrationAuthException(
          integration.id,
          new Error('No access token available for this integration'),
        );
      }

      switch (activeIntegration.provider) {
        case IntegrationProvider.CLICKUP:
          return new ClickUpProvider(activeIntegration.access_token);
        default:
          throw new UnsupportedProviderException(String(activeIntegration.provider));
      }
    } catch (error) {
      if (
        error instanceof UnsupportedProviderException ||
        error instanceof IntegrationAuthException
      ) {
        throw error; // Re-throw typed exceptions as-is
      }
      this.logger.error('getProvider failed unexpectedly', {
        integrationId: integration.id,
        provider: integration.provider,
        error,
      });
      throw error;
    }
  }

  private async refreshTokens(integration: ProjectIntegration): Promise<ProjectIntegration> {
    // Guard: refresh_token must be present
    if (!integration.refresh_token) {
      throw new IntegrationAuthException(
        integration.id,
        new Error('No refresh token available — cannot refresh'),
      );
    }

    const clientId = this.config.get<string>('clickup.clientId') ?? '';
    const clientSecret = this.config.get<string>('clickup.clientSecret') ?? '';

    if (!clientId || !clientSecret) {
      this.logger.warn('CLICKUP_CLIENT_ID/SECRET not configured, cannot refresh token', {
        integrationId: integration.id,
      });
      throw new IntegrationAuthException(
        integration.id,
        new Error('OAuth credentials not configured'),
      );
    }

    try {
      // ClickUp OAuth token refresh uses query params (NOT JSON body)
      const response = await axios.post<{
        access_token: string;
        refresh_token: string;
        expires_in: number;
      }>('https://api.clickup.com/api/v2/oauth/token', null, {
        params: {
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: integration.refresh_token,
        },
      });

      const { access_token, refresh_token, expires_in } = response.data;
      const token_expiry = new Date(Date.now() + expires_in * 1000);

      // updateIntegration encrypts tokens on write and returns plaintext
      return this.integrationService.updateIntegration(integration.id, {
        access_token,
        refresh_token,
        token_expiry,
      });
    } catch (error) {
      if (error instanceof IntegrationAuthException) throw error;
      this.logger.error('Token refresh HTTP call failed', {
        integrationId: integration.id,
        error,
      });
      throw new IntegrationAuthException(integration.id, error);
    }
  }
}
```

### Exception Pattern — Match Existing Codebase

Reference: `src/common/exceptions/infrastructure.exception.ts`

```typescript
// src/common/exceptions/unsupported-provider.exception.ts
import { HttpException, HttpStatus } from '@nestjs/common';

export class UnsupportedProviderException extends HttpException {
  constructor(provider: string) {
    super(
      {
        status: HttpStatus.BAD_REQUEST,
        error: 'Unsupported Provider',
        message: `PM provider '${provider}' is not supported by PMProviderFactory`,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

// src/common/exceptions/integration-auth.exception.ts
import { HttpException, HttpStatus } from '@nestjs/common';

export class IntegrationAuthException extends HttpException {
  constructor(integrationId: string, cause?: unknown) {
    super(
      {
        status: HttpStatus.UNAUTHORIZED,
        error: 'Integration Auth Failed',
        message: `Token refresh failed for integration '${integrationId}'`,
        details: cause instanceof Error ? cause.message : cause,
      },
      HttpStatus.UNAUTHORIZED,
    );
    this.cause = cause;
  }
}
```

### ClickUp OAuth Refresh — Key Details

- **URL:** `POST https://api.clickup.com/api/v2/oauth/token`
- **Body format:** Query params (NOT JSON body) — pass via axios `params:` option
- **Response shape:** `{ access_token: string, refresh_token: string, token_type: string, expires_in: number }`
  where `expires_in` is in **seconds**
- `axios` is already in `package.json` (`"axios": "^1.13.2"`) — import directly, no installation needed

### configuration.ts — Exact Clickup Block Diff

File: `src/config/configuration.ts` (~line 71). Add 2 lines only:

```typescript
// BEFORE:
clickup: {
  apiKey: process.env.CLICKUP_API_KEY,
  apiUrl: process.env.CLICKUP_API_URL || 'https://api.clickup.com/api/v2',
  webhookSecret: process.env.CLICKUP_WEBHOOK_SECRET,
},

// AFTER:
clickup: {
  apiKey: process.env.CLICKUP_API_KEY,
  apiUrl: process.env.CLICKUP_API_URL || 'https://api.clickup.com/api/v2',
  webhookSecret: process.env.CLICKUP_WEBHOOK_SECRET,
  clientId: process.env.CLICKUP_CLIENT_ID || '',
  clientSecret: process.env.CLICKUP_CLIENT_SECRET || '',
},
```

### env.validation.ts — Exact Diff

File: `src/config/env.validation.ts` (~line 111). Currently:

```typescript
// ClickUp Integration (REQUIRED)
CLICKUP_API_KEY: Joi.string().required(),             // ← DO NOT TOUCH
CLICKUP_WEBHOOK_SECRET: Joi.string().min(16).required(), // ← DO NOT TOUCH
```

Add **after** the existing ClickUp block:

```typescript
// ClickUp OAuth App (optional until CS0-5)
CLICKUP_CLIENT_ID: Joi.string().optional().allow(''),
CLICKUP_CLIENT_SECRET: Joi.string().optional().allow(''),
```

`CLICKUP_API_KEY` stays `required()` — it is removed in CS1, not here.

### Testing Strategy

Use `jest.mock('axios')` at module level for reliable interception of `axios.post`:

```typescript
import axios from 'axios';
import { PMProviderFactory } from './pm-provider.factory';
import { ProjectIntegrationService } from '../project-integration.service';
import { ConfigService } from '@nestjs/config';
import { ClickUpProvider } from './clickup/clickup.provider';
import { UnsupportedProviderException } from '../../common/exceptions/unsupported-provider.exception';
import { IntegrationAuthException } from '../../common/exceptions/integration-auth.exception';
import { IntegrationProvider, ProjectIntegration } from '@prisma/client';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('PMProviderFactory', () => {
  let factory: PMProviderFactory;
  let integrationService: jest.Mocked<ProjectIntegrationService>;
  let configService: jest.Mocked<ConfigService>;

  const makeIntegration = (overrides: Partial<ProjectIntegration> = {}): ProjectIntegration =>
    ({
      id: 'integration-1',
      project_id: 'project-1',
      provider: IntegrationProvider.CLICKUP,
      access_token: 'decrypted-access-token',
      refresh_token: 'refresh-token',
      token_expiry: new Date(Date.now() + 30 * 60 * 1000), // 30 min ahead — no refresh
      workspace_id: 'ws-1',
      workspace_name: 'Test Workspace',
      bot_user_id: null,
      bot_username: null,
      polling_enabled: false,
      polling_interval_min: 10,
      polling_last_run_at: null,
      webhook_enabled: false,
      webhook_id: null,
      webhook_secret: null,
      provider_config: {},
      ai_trigger_status: null,
      created_at: new Date(),
      updated_at: new Date(),
      ...overrides,
    }) as ProjectIntegration;

  beforeEach(() => {
    integrationService = {
      updateIntegration: jest.fn(),
    } as any;
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'clickup.clientId') return 'test-client-id';
        if (key === 'clickup.clientSecret') return 'test-client-secret';
        return undefined;
      }),
    } as any;
    factory = new PMProviderFactory(integrationService, configService);
    jest.clearAllMocks();
  });

  describe('getProvider', () => {
    it('returns ClickUpProvider for CLICKUP with valid non-expiring token', async () => {
      const provider = await factory.getProvider(makeIntegration());
      expect(provider).toBeInstanceOf(ClickUpProvider);
      expect(integrationService.updateIntegration).not.toHaveBeenCalled();
    });

    it('skips refresh when token_expiry is null', async () => {
      const provider = await factory.getProvider(makeIntegration({ token_expiry: null }));
      expect(provider).toBeInstanceOf(ClickUpProvider);
      expect(integrationService.updateIntegration).not.toHaveBeenCalled();
    });

    it('does NOT refresh when token is far from expiry (30 min)', async () => {
      await factory.getProvider(
        makeIntegration({ token_expiry: new Date(Date.now() + 30 * 60 * 1000) }),
      );
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('refreshes token when within 5-min window (2 min left)', async () => {
      const nearExpiry = makeIntegration({ token_expiry: new Date(Date.now() + 2 * 60 * 1000) });
      const refreshed = { ...nearExpiry, access_token: 'new-access-token' };
      mockedAxios.post.mockResolvedValue({
        data: { access_token: 'new-access-token', refresh_token: 'new-refresh', expires_in: 3600 },
      });
      integrationService.updateIntegration.mockResolvedValue(refreshed as any);

      const provider = await factory.getProvider(nearExpiry);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.clickup.com/api/v2/oauth/token',
        null,
        expect.objectContaining({
          params: expect.objectContaining({ grant_type: 'refresh_token' }),
        }),
      );
      expect(integrationService.updateIntegration).toHaveBeenCalledWith(
        'integration-1',
        expect.objectContaining({ access_token: 'new-access-token' }),
      );
      expect(provider).toBeInstanceOf(ClickUpProvider);
    });

    it('throws UnsupportedProviderException for JIRA (not yet registered)', async () => {
      const integration = makeIntegration({
        provider: 'JIRA' as IntegrationProvider,
        token_expiry: null,
      });
      await expect(factory.getProvider(integration)).rejects.toThrow(UnsupportedProviderException);
    });

    it('throws IntegrationAuthException when refresh HTTP call fails', async () => {
      const nearExpiry = makeIntegration({ token_expiry: new Date(Date.now() + 60_000) });
      mockedAxios.post.mockRejectedValue(new Error('Network error'));
      await expect(factory.getProvider(nearExpiry)).rejects.toThrow(IntegrationAuthException);
    });

    it('throws IntegrationAuthException when refresh_token is null', async () => {
      const integration = makeIntegration({
        token_expiry: new Date(Date.now() + 60_000),
        refresh_token: null,
      });
      await expect(factory.getProvider(integration)).rejects.toThrow(IntegrationAuthException);
    });

    it('throws IntegrationAuthException when access_token is null after refresh', async () => {
      const nearExpiry = makeIntegration({ token_expiry: new Date(Date.now() + 60_000) });
      const refreshedWithNullToken = { ...nearExpiry, access_token: null };
      mockedAxios.post.mockResolvedValue({
        data: { access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 3600 },
      });
      integrationService.updateIntegration.mockResolvedValue(refreshedWithNullToken as any);

      await expect(factory.getProvider(nearExpiry)).rejects.toThrow(IntegrationAuthException);
    });
  });
});
```

### Files to Create

| File                                                      | Action |
| --------------------------------------------------------- | ------ |
| `src/common/exceptions/unsupported-provider.exception.ts` | CREATE |
| `src/common/exceptions/integration-auth.exception.ts`     | CREATE |
| `src/integrations/providers/pm-provider.factory.spec.ts`  | CREATE |

### Files to Modify

| File                                                | Change                                                          |
| --------------------------------------------------- | --------------------------------------------------------------- |
| `src/integrations/providers/pm-provider.factory.ts` | Add refresh logic, ConfigService, null guards, typed exceptions |
| `src/config/configuration.ts`                       | Add `clickup.clientId` and `clickup.clientSecret` (2 lines)     |
| `src/config/env.validation.ts`                      | Add 2 optional Joi keys after existing ClickUp block            |

### DO NOT MODIFY

- `src/integrations/integrations.module.ts` — ConfigService is globally available; no import needed
- `src/integrations/providers/clickup/clickup.provider.ts` — no changes needed
- `src/integrations/project-integration.service.ts` — already has `updateIntegration()` with encryption
- Any caller files migrated in CS0-3
- `src/clickup/clickup.service.ts` — deprecated in CS0-3, no further changes

### Previous Story Learnings

**CS0-1 (done):**

- `ProjectIntegrationService.updateIntegration(id, data)` — encrypts tokens on write, returns decrypted plaintext
- `IntegrationProvider` enum from `@prisma/client`: `CLICKUP`, `JIRA`, `ASANA`
- `ProjectIntegration.token_expiry` is `DateTime?` → TypeScript `Date | null`
- `ProjectIntegration.access_token` and `refresh_token` are both `String?` (nullable)

**CS0-2 (must be done):**

- `IPMProvider` interface → `src/integrations/providers/pm-provider.interface.ts`
- Normalized DTOs → `src/integrations/providers/dto/`

**CS0-3 (must be done):**

- `ClickUpProvider` at `src/integrations/providers/clickup/clickup.provider.ts` — plain class, not injectable
- Constructed as `new ClickUpProvider(accessToken: string)` — one argument
- `PMProviderFactory` registered in `IntegrationsModule` providers + exports
- Switch case for `IntegrationProvider.CLICKUP` already added in factory

### References

- [Source: _bmad-output/planning-artifacts/epics-clickup-smart-sync.md#Story 0.2 — factory+refresh spec]
- [Source: _bmad-output/planning-artifacts/epics-clickup-smart-sync.md#FR-CS0D]
- [Exception pattern: src/common/exceptions/infrastructure.exception.ts]
- [ConfigService pattern: src/integrations/aetherflow/aetherflow-client.service.ts]
- [ProjectIntegrationService: src/integrations/project-integration.service.ts]
- [configuration.ts clickup block: src/config/configuration.ts#L71]
- [env.validation.ts ClickUp section: src/config/env.validation.ts#L111]
- [ClickUp OAuth token refresh: https://clickup.com/api/developer-portal/oauth/]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
