# Story CS0.9: Multi-Tenant Webhook Routing & Signature Verification

Status: ready-for-dev

## Story

As the **DSF system**,
I want a single webhook endpoint that securely routes events from any connected PM
tool to the correct workspace pipeline,
so that multiple teams using different tools all receive updates through one endpoint
without any cross-tenant data leakage.

## Acceptance Criteria

### AC1 — Provider-parameterized webhook endpoint

- A new `PmWebhookController` exists at `src/integrations/webhook/pm-webhook.controller.ts`.
- `POST /api/v1/integrations/webhooks/{provider}` handles incoming webhook events. (Controller uses `@Controller('integrations/webhooks')` to avoid collision with the legacy `POST /api/v1/webhooks/clickup` endpoint — see Dev Notes, Route Naming Decision)
- Decorated `@Public()` — JWT auth is bypassed; security is via per-integration HMAC verification.
- Accepts `:provider` as a route param (case-insensitive, e.g. `clickup`, `jira`, `asana`).
- Returns `200 OK` for ALL outcomes (valid, invalid signature, unknown webhook, disabled) — never 401/403.
- The response body is `{ received: true }` in all cases (prevents information leakage to attackers).
- A separate `GET /api/v1/integrations/webhooks/{provider}/health` public health-check endpoint returns `{ status: 'ok', provider: string, timestamp: string }`.

### AC2 — Extract provider-specific webhook identifier from payload

- A `PmWebhookRouterService` at `src/integrations/webhook/pm-webhook-router.service.ts` handles routing logic.
- For ClickUp: the webhook identifier is `payload.webhook_id` (top-level field in ClickUp webhook payloads, matching `ProjectIntegration.webhook_id`). (Note: the `webhook_id` field comment in the existing `IClickUpWebhookPayload` interface says 'Unique webhook event ID — used for idempotency', but in ClickUp's API this is also the webhook subscription UUID — the same UUID returned when registering the webhook via CS0-8. Trust the field value, not the comment.)
- For future providers (Jira, Asana): the identifier extraction is delegated to a provider-specific method. Use a `switch` on the normalized `provider` string.
- If the identifier cannot be extracted (missing field or unrecognized provider): log a warning and return silently (`200 OK`, no processing).
- `correlationId` is injected from `@CorrelationId()` decorator for tracing.

### AC3 — Lookup `ProjectIntegration` by `webhook_id`

- `PmWebhookRouterService` calls `ProjectIntegrationService.findByWebhookId(webhookId: string): Promise<ProjectIntegration | null>`.
- This is a **new method** on `ProjectIntegrationService`:
  ```typescript
  async findByWebhookId(webhookId: string): Promise<ProjectIntegration | null> {
    const integration = await this.prisma.projectIntegration.findFirst({
      where: { webhook_id: webhookId },
    });
    if (!integration) return null;
    return this.decryptTokens(integration); // returns decrypted webhook_secret
  }
  ```
- If no integration matches: log a warning (`Unknown webhook_id: {webhookId}`) and return `200 OK` silently — no error thrown.

### AC4 — Per-integration HMAC signature verification

- Signature verification is performed using the **per-integration** `webhook_secret` from `ProjectIntegration` (decrypted by `ProjectIntegrationService.findByWebhookId`).
- **NOT** the global `CLICKUP_WEBHOOK_SECRET` env var — that is the legacy single-tenant approach and must NOT be used here.
- ClickUp signature format: ClickUp sends `X-Signature` header containing HMAC-SHA256 hex digest of the raw body signed with `webhook_secret`.
- Verification: `crypto.createHmac('sha256', integration.webhook_secret).update(rawBody).digest('hex')` compared with `timingSafeEqual`.
- If signature is invalid:
  - Return `200 OK` silently (no information leakage).
  - Log a security warning: `"Webhook signature mismatch for integration {id} (provider: {provider}, workspace: {workspace_id})"`.
  - Increment `pm_webhook_invalid_signature_total` Prometheus counter (labels: `provider`).
  - Do NOT process the event.
- If `integration.webhook_secret` is null (webhook registered without a secret): treat as unverifiable → reject silently with the same counter increment.

### AC5 — `webhook_enabled` gate

- After successful signature verification, check `integration.webhook_enabled`.
- If `webhook_enabled = false`: acknowledge (`200 OK`) and discard — no processing, no logging beyond a single debug line.
- This handles the case where a webhook was registered but then disabled without calling `deregisterWebhook` on the provider side.

### AC6 — Route normalized event through existing `WebhooksService.processWebhook()`

- After all guards pass (webhook_id lookup, signature, enabled), extract the raw body as a parsed JSON object.
- For ClickUp: cast payload to `IClickUpWebhookPayload` — same interface used by existing `WebhooksService`.
- Call `WebhooksService.processWebhook(payload, correlationId)` — **reuse the existing service** with its deduplication, status filtering, DLQ, and Prometheus metrics.
- This means CS0-9 does NOT duplicate webhook processing logic — it only adds multi-tenant routing on top of the existing single-tenant processing.
- `processWebhook` re-throws errors after DLQ processing. Wrap the call in a try/catch and return `{ received: true }` regardless of outcome to preserve the 200 OK guarantee.

### AC7 — Cross-tenant isolation guarantee

- Each incoming webhook event is processed exclusively within the context of its matched `ProjectIntegration`.
- No data from one integration leaks to another:
  - `webhook_secret` is fetched per `webhook_id` — no shared secrets.
  - `access_token` and other fields from the matched integration are decrypted independently.
  - Each `processWebhook` call is isolated in its own stack.
- Integration IDs and workspace IDs are included in all logs for traceability.

### AC8 — `pm_webhook_invalid_signature_total` Prometheus counter

- Counter name: `pm_webhook_invalid_signature_total`
- Labels: `provider` (e.g. `'clickup'`)
- Registered via `makeCounterProvider` in `PmWebhookModule`.
- Injected via `@InjectMetric('pm_webhook_invalid_signature_total')` into `PmWebhookRouterService`.
- Incremented on every failed signature verification (null secret counts as failure).

### AC9 — Module wiring

- New file: `src/integrations/webhook/pm-webhook.module.ts`
- `PmWebhookModule` imports:
  - `IntegrationsModule` (gets `ProjectIntegrationService`)
  - `WebhooksModule` (gets `WebhooksService` for event processing)
  - `ConfigModule` (for `DSF_PUBLIC_URL` if needed)
  - `PrometheusModule` (for `@InjectMetric`)
- `PmWebhookModule` declares `PmWebhookController` in its `controllers` array and `PmWebhookRouterService` in its `providers` array.
- **`PmWebhookModule` is imported in `AppModule`** (NOT inside `IntegrationsModule` or `WebhooksModule`).
- Add import to `AppModule` alongside `WebhooksModule` and `IntegrationsModule`.

### AC10 — `WebhooksModule` must export `WebhooksService`

- Verify that `WebhooksModule` already exports `WebhooksService` (it does — see `src/webhooks/webhooks.module.ts` line 100: `exports: [WebhooksService, WebhookDeduplicationService]`).
- If not already exported: add to `WebhooksModule.exports`. No other changes to `WebhooksModule`.

### AC11 — Unit tests

- File: `src/integrations/webhook/pm-webhook-router.service.spec.ts`
- Must cover:
  1. **Unknown provider** — unrecognized provider string → silent `200 OK`, no processing.
  2. **Unknown webhook_id** — `findByWebhookId` returns `null` → silent `200 OK`, warning logged.
  3. **Invalid signature** — HMAC mismatch → silent `200 OK`, counter incremented.
  4. **Null webhook_secret** — `integration.webhook_secret` is null → silent `200 OK`, counter incremented.
  5. **webhook_enabled = false** — valid signature but disabled → discarded, not forwarded.
  6. **Valid ClickUp event** — all guards pass → `WebhooksService.processWebhook` called with correct payload.
  7. **Cross-tenant isolation** — two concurrent integrations each use their own secrets (mock two integrations with different secrets, verify each gets its own).
  8. **Counter incremented** on invalid signature.
  9. **processWebhook throws** — `processWebhook` rejects with an error → endpoint still returns `{ received: true }` with 200 OK (never propagates error).
- File: `src/integrations/webhook/pm-webhook-router.service.spec.ts` (service spec, not controller spec).

### AC12 — Type safety

- `pnpm typecheck` passes with zero errors.
- No `as any` casts in `PmWebhookController` or `PmWebhookRouterService` (except the necessary Fastify `rawBody` access pattern — see Dev Notes).
- `provider` route param is narrowed to `IntegrationProvider` enum or handled with a default case.

## Tasks / Subtasks

- [ ] Task 1: Add `findByWebhookId` to `ProjectIntegrationService` (AC: 3)
  - [ ] Open `src/integrations/project-integration.service.ts` — read it fully first.
  - [ ] Add `findByWebhookId(webhookId: string): Promise<ProjectIntegration | null>` using `findFirst({ where: { webhook_id: webhookId } })`.
  - [ ] Call `this.decryptTokens(integration)` before returning (returns plaintext `webhook_secret`).
  - [ ] Add corresponding unit test in `src/integrations/project-integration.service.spec.ts`.

- [ ] Task 2: Create `PmWebhookRouterService` (AC: 2, 3, 4, 5, 6, 7, 8)
  - [ ] Create `src/integrations/webhook/pm-webhook-router.service.ts`.
  - [ ] Inject: `ProjectIntegrationService`, `WebhooksService`, `LoggerService`, `Counter` via `@InjectMetric('pm_webhook_invalid_signature_total')`.
  - [ ] Implement `routeWebhook(provider: string, rawBody: Buffer, signature: string | undefined, correlationId: string): Promise<{ received: true }>`.
  - [ ] Step 1: Extract `webhookId` from parsed body based on provider (ClickUp: `body.webhook_id`).
  - [ ] Step 2: Call `findByWebhookId(webhookId)` → null → return silently with warning.
  - [ ] Step 3: Verify HMAC signature against `integration.webhook_secret` using `crypto.timingSafeEqual`.
  - [ ] Step 4: Check `integration.webhook_enabled`.
  - [ ] Step 5: Call `WebhooksService.processWebhook(payload, correlationId)`.
  - [ ] Increment counter on invalid signature or null secret.

- [ ] Task 3: Create `PmWebhookController` (AC: 1, 2)
  - [ ] Create `src/integrations/webhook/pm-webhook.controller.ts`.
  - [ ] `@Public()` decorator on both `POST /:provider` and `GET /:provider/health`.
  - [ ] `POST /:provider`: extract `rawBody` from Fastify request, `X-Signature` header, `correlationId` → delegate to `PmWebhookRouterService.routeWebhook()`.
  - [ ] `GET /:provider/health`: return `{ status: 'ok', provider, timestamp: new Date().toISOString() }`.
  - [ ] Return `{ received: true }` on all outcomes from `POST` (always 200 OK).
  - [ ] Use `@HttpCode(HttpStatus.OK)` on POST endpoint.

- [ ] Task 4: Create `PmWebhookModule` (AC: 9)
  - [ ] Create `src/integrations/webhook/pm-webhook.module.ts`.
  - [ ] Imports: `IntegrationsModule`, `WebhooksModule`, `ConfigModule`, `PrometheusModule`.
  - [ ] Providers: `PmWebhookController`, `PmWebhookRouterService`, plus `makeCounterProvider` for `pm_webhook_invalid_signature_total`.
  - [ ] Add `PmWebhookModule` to `AppModule` imports (alongside `WebhooksModule` and `IntegrationsModule`).
  - [ ] Verify `DSF_PUBLIC_URL` is present in the Joi config validation schema at `src/config/` — if missing, add it (used by CS0-8 to build webhook registration URLs but must be validated at startup).

- [ ] Task 5: Write unit tests (AC: 11)
  - [ ] Create `src/integrations/webhook/pm-webhook-router.service.spec.ts`.
  - [ ] All 9 test cases from AC11 using Jest mocks.
  - [ ] Verify that cross-tenant test (test 7) uses distinct mock secrets.

- [ ] Task 6: Type check and lint (AC: 12)
  - [ ] `pnpm typecheck` — zero errors.
  - [ ] `pnpm lint` — zero violations.

- [ ] Task 7: Add index on `ProjectIntegration.webhook_id` (AC: 3)
  - [ ] Open `prisma/schema.prisma`, find `ProjectIntegration` model.
  - [ ] Add `@@index([webhook_id])` to the model (after existing indexes).
  - [ ] Run `pnpm db:migrate` to generate and apply the migration.
  - [ ] Run `pnpm db:generate` to regenerate the Prisma client.

## Dev Notes

### Architecture Context — Why a New Controller, Not Modifying `WebhooksController`

The existing `WebhooksController` at `src/webhooks/webhooks.controller.ts` handles `POST /api/v1/webhooks/clickup` with a **hardcoded** route and uses the **global** `WebhookSignatureGuard` which reads from `CLICKUP_WEBHOOK_SECRET` env var. This is the legacy single-tenant approach:

```typescript
// EXISTING (single-tenant, single-secret):
@UseGuards(WebhookSignatureGuard)      // ← reads CLICKUP_WEBHOOK_SECRET globally
@Post('clickup')                       // ← hardcoded ClickUp route
```

CS0-9 introduces a **multi-tenant** endpoint using `POST /api/v1/integrations/webhooks/{provider}` (parameterized) with per-integration secrets:

- **Both endpoints coexist** during transition — `POST /api/v1/webhooks/clickup` (legacy) and `POST /api/v1/webhooks/clickup` from new controller would conflict! Resolve by placing the new controller at a distinct path: `POST /api/v1/integrations/webhooks/{provider}`.
- **Recommended path**: `@Controller('integrations/webhooks')` → `POST /api/v1/integrations/webhooks/:provider` to avoid route collision with legacy `WebhooksController`.
- The legacy `WebhooksController` at `POST /api/v1/webhooks/clickup` stays untouched. ClickUp webhook URLs registered via CS0-8 flow will point to the NEW endpoint.

**DO NOT modify** `WebhooksController`, `WebhooksService`, or `WebhookSignatureGuard` — legacy route stays.

### Route Naming Decision

Place `PmWebhookController` under `@Controller('integrations/webhooks')`:

```
POST /api/v1/integrations/webhooks/:provider   ← NEW multi-tenant endpoint
GET  /api/v1/integrations/webhooks/:provider/health
```

This avoids any conflict with:

- `POST /api/v1/webhooks/clickup` (legacy `WebhooksController`)
- `GET  /api/v1/webhooks/clickup/health` (legacy health check)
- `POST /api/v1/webhooks/github` (`GitHubWebhooksController`)

The DSF_PUBLIC_URL webhook registered via `IPMProvider.registerWebhook()` in CS0-8 must point to this new path:

```
{DSF_PUBLIC_URL}/api/v1/integrations/webhooks/clickup
```

### `rawBody` Access on Fastify

Fastify stores the raw body buffer on the request when `rawBody: true` is configured (already set in `src/main.ts` for the existing `WebhookSignatureGuard`). Access it the same way as `WebhookSignatureGuard`:

```typescript
// In controller:
import { FastifyRequest } from 'fastify';
import { Req } from '@nestjs/common';

@Post(':provider')
async handleWebhook(
  @Param('provider') provider: string,
  @Req() req: FastifyRequest,
  @CorrelationId() correlationId: string,
): Promise<{ received: true }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawBody = (req as any).rawBody as Buffer | undefined;
  const signature = req.headers['x-signature'] as string | undefined;
  const body = req.body as Record<string, unknown>;
  // ...
}
```

The `as any` cast for `rawBody` is an accepted pattern in this codebase — see existing `WebhookSignatureGuard` line 50.

### `ProjectIntegrationService.findByWebhookId` — Full Implementation

```typescript
// Add to src/integrations/project-integration.service.ts:

async findByWebhookId(webhookId: string): Promise<ProjectIntegration | null> {
  const integration = await this.prisma.projectIntegration.findFirst({
    where: { webhook_id: webhookId },
  });

  if (!integration) return null;

  return this.decryptTokens(integration);
}
```

Note: `decryptTokens` is already private in `ProjectIntegrationService` but accessible from within the class. The returned `ProjectIntegration` has `webhook_secret` as plaintext (decrypted).

### HMAC Signature Verification — Complete Implementation

```typescript
// In PmWebhookRouterService:
import * as crypto from 'crypto';

private verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
  try {
    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(rawBody).digest('hex');

    const sigBuffer = Buffer.from(signature, 'utf8');
    const digestBuffer = Buffer.from(digest, 'utf8');

    if (sigBuffer.length !== digestBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuffer, digestBuffer);
  } catch {
    return false;
  }
}
```

### Webhook Identifier Extraction per Provider

```typescript
// In PmWebhookRouterService:
private extractWebhookId(provider: string, body: Record<string, unknown>): string | null {
  switch (provider.toLowerCase()) {
    case 'clickup':
      // ClickUp payloads contain webhook_id at top level (matches ProjectIntegration.webhook_id)
      return typeof body['webhook_id'] === 'string' ? body['webhook_id'] : null;
    case 'jira':
      // Future: Jira uses webhookEvent or similar — not implemented yet
      return null;
    case 'asana':
      // Future: Asana uses X-Hook-Secret header — not implemented yet
      return null;
    default:
      return null;
  }
}
```

### Complete `PmWebhookRouterService` Implementation

```typescript
// src/integrations/webhook/pm-webhook-router.service.ts
import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';
import * as crypto from 'crypto';
import { ProjectIntegrationService } from '../project-integration.service';
import { WebhooksService } from '@/webhooks/webhooks.service';
import { LoggerService } from '@/common/logger/logger.service';
import { IClickUpWebhookPayload } from '@/webhooks/interfaces';

@Injectable()
export class PmWebhookRouterService {
  constructor(
    private readonly integrationService: ProjectIntegrationService,
    private readonly webhooksService: WebhooksService,
    private readonly logger: LoggerService,
    @InjectMetric('pm_webhook_invalid_signature_total')
    private readonly invalidSigCounter: Counter<string>,
  ) {}

  async routeWebhook(
    provider: string,
    rawBody: Buffer | undefined,
    body: Record<string, unknown>,
    signature: string | undefined,
    correlationId: string,
  ): Promise<{ received: true }> {
    // Step 1: Extract provider-specific webhook identifier
    const webhookId = this.extractWebhookId(provider, body);
    if (!webhookId) {
      this.logger.warn(
        `[${correlationId}] Cannot extract webhook_id for provider "${provider}" — discarding`,
        { provider, correlationId },
      );
      return { received: true };
    }

    // Step 2: Lookup integration by webhook_id
    const integration = await this.integrationService.findByWebhookId(webhookId);
    if (!integration) {
      this.logger.warn(
        `[${correlationId}] Unknown webhook_id "${webhookId}" (provider: ${provider}) — discarding`,
        { provider, webhookId, correlationId },
      );
      return { received: true };
    }

    // Step 3: Verify HMAC signature using per-integration secret
    if (!integration.webhook_secret || !signature || !rawBody) {
      this.logger.warn(
        `[${correlationId}] Webhook signature unverifiable for integration ${integration.id} (missing secret, signature, or raw body)`,
        { integrationId: integration.id, provider, workspaceId: integration.workspace_id },
      );
      this.invalidSigCounter.inc({ provider: integration.provider });
      return { received: true };
    }

    const isValid = this.verifySignature(rawBody, signature, integration.webhook_secret);
    if (!isValid) {
      this.logger.warn(
        `[${correlationId}] Webhook signature mismatch for integration ${integration.id} (provider: ${integration.provider}, workspace: ${integration.workspace_id})`,
        {
          integrationId: integration.id,
          provider: integration.provider,
          workspaceId: integration.workspace_id,
        },
      );
      this.invalidSigCounter.inc({ provider: integration.provider });
      return { received: true };
    }

    // Step 4: Check webhook_enabled gate
    if (!integration.webhook_enabled) {
      this.logger.debug(
        `[${correlationId}] Webhook disabled for integration ${integration.id} — discarding`,
      );
      return { received: true };
    }

    // Step 5: Route to existing WebhooksService for processing
    // Reuse existing deduplication, status filtering, DLQ, and metrics
    // Note: processWebhook re-throws after DLQ — catch to preserve 200 OK guarantee
    try {
      const payload = body as unknown as IClickUpWebhookPayload;
      await this.webhooksService.processWebhook(payload, correlationId);
    } catch (err) {
      this.logger.error(
        `[${correlationId}] processWebhook threw for integration ${integration.id} — acknowledging to prevent webhook replay`,
        err instanceof Error ? err.stack : String(err),
        { integrationId: integration.id, provider },
      );
    }

    return { received: true };
  }

  private extractWebhookId(provider: string, body: Record<string, unknown>): string | null {
    switch (provider.toLowerCase()) {
      case 'clickup':
        return typeof body['webhook_id'] === 'string' ? body['webhook_id'] : null;
      default:
        return null;
    }
  }

  private verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
    try {
      const hmac = crypto.createHmac('sha256', secret);
      const digest = hmac.update(rawBody).digest('hex');
      const sigBuffer = Buffer.from(signature, 'utf8');
      const digestBuffer = Buffer.from(digest, 'utf8');
      if (sigBuffer.length !== digestBuffer.length) return false;
      return crypto.timingSafeEqual(sigBuffer, digestBuffer);
    } catch {
      return false;
    }
  }
}
```

### Complete `PmWebhookController` Implementation

```typescript
// src/integrations/webhook/pm-webhook.controller.ts
import { Controller, Post, Get, Param, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { FastifyRequest } from 'fastify';
import { Public } from '@/common/decorators';
import { CorrelationId } from '@/common/decorators/correlation-id.decorator';
import { PmWebhookRouterService } from './pm-webhook-router.service';

@ApiTags('integrations')
@Controller('integrations/webhooks')
export class PmWebhookController {
  constructor(private readonly routerService: PmWebhookRouterService) {}

  @Public()
  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive PM tool webhook events (multi-tenant, per-integration HMAC)' })
  @ApiHeader({
    name: 'x-signature',
    description: 'HMAC-SHA256 signature from PM tool',
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Event acknowledged (always 200 regardless of validity)',
  })
  async handleWebhook(
    @Param('provider') provider: string,
    @Req() req: FastifyRequest,
    @CorrelationId() correlationId: string,
  ): Promise<{ received: true }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawBody = (req as any).rawBody as Buffer | undefined;
    const signature = req.headers['x-signature'] as string | undefined;
    const body = (req.body ?? {}) as Record<string, unknown>;

    return this.routerService.routeWebhook(provider, rawBody, body, signature, correlationId);
  }

  @Public()
  @Get(':provider/health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook endpoint health check' })
  async healthCheck(
    @Param('provider') provider: string,
  ): Promise<{ status: string; provider: string; timestamp: string }> {
    return { status: 'ok', provider, timestamp: new Date().toISOString() };
  }
}
```

### Complete `PmWebhookModule` Implementation

```typescript
// src/integrations/webhook/pm-webhook.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrometheusModule, makeCounterProvider } from '@willsoto/nestjs-prometheus';
import { IntegrationsModule } from '../integrations.module';
import { WebhooksModule } from '@/webhooks/webhooks.module';
import { PmWebhookController } from './pm-webhook.controller';
import { PmWebhookRouterService } from './pm-webhook-router.service';
// LoggerModule is @Global() — registered in AppModule, no need to re-import

@Module({
  imports: [
    IntegrationsModule, // ProjectIntegrationService (with findByWebhookId)
    WebhooksModule, // WebhooksService (processWebhook, dedup, DLQ)
    ConfigModule,
    PrometheusModule,
  ],
  controllers: [PmWebhookController],
  providers: [
    PmWebhookRouterService,
    makeCounterProvider({
      name: 'pm_webhook_invalid_signature_total',
      help: 'Total number of webhook requests rejected due to invalid HMAC signature',
      labelNames: ['provider'],
    }),
  ],
})
export class PmWebhookModule {}
```

Then in `AppModule`:

```typescript
// src/app.module.ts — add import + array entry:
import { PmWebhookModule } from './integrations/webhook/pm-webhook.module';

// In @Module imports array (alongside WebhooksModule and IntegrationsModule):
WebhooksModule,
IntegrationsModule,
PmWebhookModule,   // ← add here
```

### Environment Variable: `DSF_PUBLIC_URL`

CS0-8 builds the webhook registration URL as `{DSF_PUBLIC_URL}/api/v1/integrations/webhooks/clickup`. Confirm `DSF_PUBLIC_URL` is declared in the Joi config validation schema (`src/config/config.schema.ts` or equivalent). If not present, add: `DSF_PUBLIC_URL: Joi.string().uri().optional()`. This is a shared concern with CS0-8 — coordinate.

### `IntegrationsModule` — Current State and Required Exports

Current state (from `src/integrations/integrations.module.ts`):

```typescript
@Module({
  imports: [ClickUpModule, DatabaseModule, EncryptionModule],
  controllers: [IntegrationsController],
  providers: [ProjectIntegrationService],
  exports: [ProjectIntegrationService], // ← already exports the service
})
export class IntegrationsModule {}
```

`ProjectIntegrationService` is already exported. `PmWebhookModule` will receive it via `IntegrationsModule` import. No changes to `IntegrationsModule` are required for CS0-9 (CS0-4 may add `PMProviderFactory` to exports — verify but don't change if not needed here).

### `WebhooksModule` — Already Exports `WebhooksService`

From `src/webhooks/webhooks.module.ts` line 100:

```typescript
exports: [WebhooksService, WebhookDeduplicationService],
```

`WebhooksService` is already exported. `PmWebhookModule` can import `WebhooksModule` and receive `WebhooksService`. No changes to `WebhooksModule` are required.

### ClickUp Webhook Payload — `webhook_id` Field

The ClickUp webhook payload shape (from `src/webhooks/interfaces/clickup-webhook.interface.ts` and `src/webhooks/dto/clickup-webhook.dto.ts`):

```typescript
interface IClickUpWebhookPayload {
  webhook_id: string; // ← This is the webhook identifier, matches ProjectIntegration.webhook_id
  event: string; // "taskCreated" | "taskUpdated" | "taskStatusUpdated" | ...
  task_id: string;
  task?: IClickUpTask;
  history_items?: IClickUpHistoryItem[];
}
```

`webhook_id` in the payload is the ClickUp-assigned webhook UUID — the same value stored on `ProjectIntegration.webhook_id` when the webhook was registered via `IPMProvider.registerWebhook()` in CS0-8. Use this to perform the lookup.

### `ProjectIntegration.webhook_secret` Schema

From `prisma/schema.prisma` (line 1276):

```prisma
webhook_secret  String?   // stored encrypted via EncryptionService
```

`ProjectIntegrationService.decryptTokens()` already decrypts `webhook_secret`:

```typescript
// From project-integration.service.ts line 91-94:
webhook_secret: integration.webhook_secret
  ? this.encryption.decrypt(integration.webhook_secret)
  : null,
```

So `findByWebhookId` returns the plaintext (decrypted) secret ready for HMAC verification. No additional decryption step needed in `PmWebhookRouterService`.

### Testing Strategy

```typescript
// src/integrations/webhook/pm-webhook-router.service.spec.ts
import { PmWebhookRouterService } from './pm-webhook-router.service';
import { ProjectIntegrationService } from '../project-integration.service';
import { WebhooksService } from '@/webhooks/webhooks.service';
import { LoggerService } from '@/common/logger/logger.service';
import { IntegrationProvider } from '@prisma/client';
import * as crypto from 'crypto';

const makeIntegration = (overrides = {}) => ({
  id: 'int-1',
  project_id: 'proj-1',
  provider: IntegrationProvider.CLICKUP,
  workspace_id: 'ws-123',
  webhook_id: 'wh-abc',
  webhook_secret: 'super-secret-key', // decrypted plaintext
  webhook_enabled: true,
  ...overrides,
});

const makeRawBody = (body: object, secret: string): { rawBody: Buffer; signature: string } => {
  const rawBody = Buffer.from(JSON.stringify(body));
  const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return { rawBody, signature };
};

describe('PmWebhookRouterService', () => {
  let service: PmWebhookRouterService;
  let integrationService: jest.Mocked<ProjectIntegrationService>;
  let webhooksService: jest.Mocked<WebhooksService>;
  let logger: jest.Mocked<LoggerService>;
  let counter: { inc: jest.Mock };

  beforeEach(() => {
    integrationService = { findByWebhookId: jest.fn() } as any;
    webhooksService = { processWebhook: jest.fn().mockResolvedValue({ success: true }) } as any;
    logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
    counter = { inc: jest.fn() };

    service = new PmWebhookRouterService(
      integrationService,
      webhooksService,
      logger,
      counter as any,
    );
  });

  it('returns { received: true } for unknown provider', async () => {
    const result = await service.routeWebhook(
      'unknown',
      Buffer.from('{}'),
      {},
      undefined,
      'corr-1',
    );
    expect(result).toEqual({ received: true });
    expect(webhooksService.processWebhook).not.toHaveBeenCalled();
  });

  it('returns { received: true } silently when webhook_id not found', async () => {
    integrationService.findByWebhookId.mockResolvedValue(null);
    const body = { webhook_id: 'unknown-wh', event: 'taskUpdated', task_id: 't1' };
    const result = await service.routeWebhook(
      'clickup',
      Buffer.from(JSON.stringify(body)),
      body,
      undefined,
      'corr-2',
    );
    expect(result).toEqual({ received: true });
    expect(logger.warn).toHaveBeenCalled();
    expect(webhooksService.processWebhook).not.toHaveBeenCalled();
  });

  it('rejects invalid signature silently and increments counter', async () => {
    const integration = makeIntegration({ webhook_secret: 'correct-secret' });
    integrationService.findByWebhookId.mockResolvedValue(integration as any);
    const body = { webhook_id: 'wh-abc', event: 'taskUpdated', task_id: 't1' };
    const rawBody = Buffer.from(JSON.stringify(body));
    const wrongSignature = 'deadbeefdeadbeef';

    const result = await service.routeWebhook('clickup', rawBody, body, wrongSignature, 'corr-3');
    expect(result).toEqual({ received: true });
    expect(counter.inc).toHaveBeenCalledWith({ provider: IntegrationProvider.CLICKUP });
    expect(webhooksService.processWebhook).not.toHaveBeenCalled();
  });

  it('rejects null webhook_secret silently and increments counter', async () => {
    const integration = makeIntegration({ webhook_secret: null });
    integrationService.findByWebhookId.mockResolvedValue(integration as any);
    const body = { webhook_id: 'wh-abc', event: 'taskUpdated', task_id: 't1' };

    const result = await service.routeWebhook(
      'clickup',
      Buffer.from(JSON.stringify(body)),
      body,
      'sig',
      'corr-4',
    );
    expect(result).toEqual({ received: true });
    expect(counter.inc).toHaveBeenCalledWith({ provider: IntegrationProvider.CLICKUP });
    expect(webhooksService.processWebhook).not.toHaveBeenCalled();
  });

  it('discards event when webhook_enabled = false', async () => {
    const secret = 'my-secret';
    const integration = makeIntegration({ webhook_secret: secret, webhook_enabled: false });
    integrationService.findByWebhookId.mockResolvedValue(integration as any);
    const body = { webhook_id: 'wh-abc', event: 'taskUpdated', task_id: 't1' };
    const { rawBody, signature } = makeRawBody(body, secret);

    const result = await service.routeWebhook('clickup', rawBody, body, signature, 'corr-5');
    expect(result).toEqual({ received: true });
    expect(webhooksService.processWebhook).not.toHaveBeenCalled();
  });

  it('calls processWebhook when all guards pass (valid ClickUp event)', async () => {
    const secret = 'valid-secret';
    const integration = makeIntegration({ webhook_secret: secret });
    integrationService.findByWebhookId.mockResolvedValue(integration as any);
    webhooksService.processWebhook.mockResolvedValue({
      success: true,
      correlationId: 'corr-6',
      willProcess: true,
      message: 'ok',
      timestamp: '',
    } as any);
    const body = { webhook_id: 'wh-abc', event: 'taskUpdated', task_id: 't1' };
    const { rawBody, signature } = makeRawBody(body, secret);

    const result = await service.routeWebhook('clickup', rawBody, body, signature, 'corr-6');
    expect(result).toEqual({ received: true });
    expect(webhooksService.processWebhook).toHaveBeenCalledWith(body, 'corr-6');
  });

  it('isolates two concurrent integrations — each uses its own secret', async () => {
    const secret1 = 'secret-workspace-1';
    const secret2 = 'secret-workspace-2';
    const integration1 = makeIntegration({
      id: 'int-1',
      webhook_id: 'wh-1',
      webhook_secret: secret1,
    });
    const integration2 = makeIntegration({
      id: 'int-2',
      webhook_id: 'wh-2',
      webhook_secret: secret2,
    });

    integrationService.findByWebhookId.mockImplementation(async (id) =>
      id === 'wh-1' ? (integration1 as any) : (integration2 as any),
    );

    const body1 = { webhook_id: 'wh-1', event: 'taskUpdated', task_id: 't1' };
    const body2 = { webhook_id: 'wh-2', event: 'taskUpdated', task_id: 't2' };
    const { rawBody: raw1, signature: sig1 } = makeRawBody(body1, secret1);
    const { rawBody: raw2, signature: sig2 } = makeRawBody(body2, secret2);

    await Promise.all([
      service.routeWebhook('clickup', raw1, body1, sig1, 'corr-7a'),
      service.routeWebhook('clickup', raw2, body2, sig2, 'corr-7b'),
    ]);

    expect(webhooksService.processWebhook).toHaveBeenCalledTimes(2);
    // Using sig1 with int-2's secret would have failed — proves isolation
    expect(counter.inc).not.toHaveBeenCalled();
  });

  it('increments pm_webhook_invalid_signature_total on HMAC mismatch', async () => {
    const integration = makeIntegration({ webhook_secret: 'real-secret' });
    integrationService.findByWebhookId.mockResolvedValue(integration as any);
    const body = { webhook_id: 'wh-abc', event: 'taskUpdated', task_id: 't1' };
    const rawBody = Buffer.from(JSON.stringify(body));

    await service.routeWebhook('clickup', rawBody, body, 'wrong-sig', 'corr-8');
    expect(counter.inc).toHaveBeenCalledWith({ provider: IntegrationProvider.CLICKUP });
  });

  it('returns { received: true } even when processWebhook throws', async () => {
    const secret = 'valid-secret';
    const integration = makeIntegration({ webhook_secret: secret });
    integrationService.findByWebhookId.mockResolvedValue(integration as any);
    webhooksService.processWebhook.mockRejectedValue(new Error('DLQ failure'));
    const body = { webhook_id: 'wh-abc', event: 'taskUpdated', task_id: 't1' };
    const { rawBody, signature } = makeRawBody(body, secret);

    const result = await service.routeWebhook('clickup', rawBody, body, signature, 'corr-9');
    expect(result).toEqual({ received: true });
  });
});
```

### File Structure

New files to create:

| File                                                         | Action |
| ------------------------------------------------------------ | ------ |
| `src/integrations/webhook/pm-webhook.controller.ts`          | CREATE |
| `src/integrations/webhook/pm-webhook-router.service.ts`      | CREATE |
| `src/integrations/webhook/pm-webhook-router.service.spec.ts` | CREATE |
| `src/integrations/webhook/pm-webhook.module.ts`              | CREATE |

Files to modify:

| File                                                   | Change                                                      |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| `src/integrations/project-integration.service.ts`      | Add `findByWebhookId(webhookId: string)` method             |
| `src/integrations/project-integration.service.spec.ts` | Add unit test for `findByWebhookId`                         |
| `src/app.module.ts`                                    | Import `PmWebhookModule` and add to `@Module` imports array |
| `prisma/schema.prisma`                                 | Add `@@index([webhook_id])` to `ProjectIntegration` model   |

### DO NOT MODIFY

- `src/webhooks/webhooks.controller.ts` — legacy single-tenant ClickUp endpoint stays
- `src/webhooks/webhooks.service.ts` — reused as-is via `PmWebhookModule` importing `WebhooksModule`
- `src/webhooks/guards/webhook-signature.guard.ts` — legacy guard using global env var stays
- `src/integrations/integrations.module.ts` — `ProjectIntegrationService` already exported; no changes needed
- `src/webhooks/webhooks.module.ts` — already exports `WebhooksService`; no changes needed

### Dependency Order — Critical

CS0-9 can be implemented independently of CS0-8. However, the full end-to-end flow (webhook arriving at the new endpoint) requires:

- **CS0-1** (done) — `ProjectIntegration` model with `webhook_id`, `webhook_secret` fields exists.
- **CS0-5** (ready-for-dev) — ClickUp OAuth App stores `bot_user_id` and connection; webhook registration endpoint is in CS0-8.
- **CS0-8** (ready-for-dev) — `IPMProvider.registerWebhook()` stores the `webhook_id` and `webhook_secret` on `ProjectIntegration`. CS0-9 reads these values.

CS0-9 can be coded and tested with mocks before CS0-8 is complete, since `findByWebhookId` only needs a DB row with `webhook_id` and `webhook_secret` set.

### Previous Story Learnings

**From CS0-1 (done):**

- `ProjectIntegration.webhook_secret` is stored encrypted; `ProjectIntegrationService.decryptTokens()` handles decryption automatically.
- `webhook_id` and `webhook_secret` fields exist on the schema — no migration needed.

**From CS0-8 (ready-for-dev):**

- `IPMProvider.registerWebhook(workspaceId, endpoint)` returns `{ id: string, secret: string }` (see CS0-3).
- The `webhook_id` stored on `ProjectIntegration` is the ClickUp webhook UUID returned by `POST /team/{workspaceId}/webhook`.
- The `webhook_secret` is the ClickUp-provided HMAC secret from the same response.
- CS0-8 stores these via `ProjectIntegrationService.updateIntegration(id, { webhook_id, webhook_secret })`.

**From CS0-4 (`PMProviderFactory` pattern):**

- Always use `ProjectIntegrationService.getDecryptedIntegration()` or equivalent before passing to any provider — CS0-9's `findByWebhookId` follows this pattern (calls `decryptTokens` internally).

**From existing `WebhookSignatureGuard`:**

- Fastify `rawBody` is accessed via `(req as any).rawBody as Buffer | undefined`.
- HMAC verification uses `crypto.timingSafeEqual` — use identical approach.
- `rawBody: true` must be configured in the Fastify adapter (already done in `src/main.ts`).

**From `WebhooksService.processWebhook()`:**

- Signature: `processWebhook(payload: IClickUpWebhookPayload, correlationId: string): Promise<WebhookResponseDto>`.
- Already handles: Redis dedup, status filtering, DLQ, Prometheus metrics.
- Returns `WebhookResponseDto` — CS0-9 discards this and always returns `{ received: true }` to the HTTP client.

**From `LoggerService` (`@/common/logger`):**

- Project convention: use `LoggerService` from `@/common/logger` (not NestJS built-in `Logger`).
- Constructor injection, not `new Logger(ContextName)`.
- Methods: `log(message, context?)`, `warn(message, context?)`, `error(message, stack?, context?)`, `debug(message, context?)`.

### Project Structure Notes

- New files go in `src/integrations/webhook/` (sub-folder of `src/integrations/`).
- This is consistent with `src/integrations/polling/` (created by CS0-8) and `src/integrations/providers/` (CS0-2/CS0-3).
- Module imports must NOT create circular dependencies:
  - `PmWebhookModule` → imports `IntegrationsModule` (OK, not circular)
  - `PmWebhookModule` → imports `WebhooksModule` (OK, not circular)
  - Neither `IntegrationsModule` nor `WebhooksModule` import `PmWebhookModule` — no circularity.

### References

- [Source: _bmad-output/planning-artifacts/epics-clickup-smart-sync.md#Story 0.9]
- [FR-CS0K: Multi-tenant webhook routing + per-integration signature verification]
- [FR-CS0J: Webhook registration/deregistration via IPMProvider]
- [ProjectIntegration schema: prisma/schema.prisma#ProjectIntegration (lines 1260-1286)]
- [ProjectIntegrationService: src/integrations/project-integration.service.ts]
- [Existing WebhooksService: src/webhooks/webhooks.service.ts]
- [Existing WebhookSignatureGuard (rawBody pattern): src/webhooks/guards/webhook-signature.guard.ts#L50]
- [WebhooksModule exports: src/webhooks/webhooks.module.ts#L100]
- [IntegrationsModule exports: src/integrations/integrations.module.ts]
- [CS0-8 polling story (module patterns): _bmad-output/implementation-artifacts/stories/epic-CS0/CS0-8-provider-agnostic-polling.md]
- [AppModule imports: src/app.module.ts]
- [CorrelationId decorator: src/common/decorators/correlation-id.decorator.ts]
- [IClickUpWebhookPayload interface: src/webhooks/interfaces/clickup-webhook.interface.ts]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
