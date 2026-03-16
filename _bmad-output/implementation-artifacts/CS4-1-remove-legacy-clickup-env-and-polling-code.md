# Story CS4.1: Remove Legacy ClickUp Env Vars and Polling Code

Status: ready-for-dev

## Story

As a developer and DevOps engineer,
I want all legacy ClickUp environment variables and their associated dead code removed,
so that the codebase reflects the current OAuth + per-project configuration model and no longer requires misleading, deprecated, or retired env vars at startup.

## Background

Epics CS0–CS3 are all **done**. The following are fully implemented and active:

- **CS0:** `ProjectIntegration` model with per-project OAuth tokens, per-workspace `webhook_secret`, per-project polling config via DB
- **CS0-8:** `PmPollingOrchestrator` with per-integration polling interval (from DB) — global `CLICKUP_POLL_INTERVAL_MS` is obsolete
- **CS0-9:** `PmWebhookRouterService` does per-workspace HMAC verification using `ProjectIntegration.webhook_secret` — global `CLICKUP_WEBHOOK_SECRET` is obsolete
- **CS1-3:** `ai_trigger_status` per-project field replaces `ACTIONABLE_STATUSES` / `NON_ACTIONABLE_STATUSES`
- **CS1-7:** `CLICKUP_API_KEY` removed; OAuth-only path enforced
- **CS3-4:** `SYNC_PENDING` dashboard state complete — do NOT touch any CS3-4 artifacts

What remains: stale env vars labeled LEGACY/DEPRECATED in `.env.example`, their Joi validations, `configuration.ts` entries, and the code consuming them. Additionally, two fully dead code units exist that must be deleted.

## Webhook Endpoint Landscape (READ BEFORE TOUCHING ANYTHING)

There are **three** ClickUp webhook-related controllers. Understand this before making changes:

| Controller                                          | Route                                          | Status                                          | Notes                                                                                                      |
| --------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/webhooks/webhooks.controller.ts`               | `POST /api/v1/webhooks/clickup`                | **ACTIVE** (registered in WebhooksModule)       | Uses global `WebhookSignatureGuard` → reads `CLICKUP_WEBHOOK_SECRET`. Routes to `WebhooksService`. Legacy. |
| `src/clickup/clickup-webhook.controller.ts`         | `POST /webhooks/clickup`                       | **DEAD** (not in any module's `controllers:[]`) | Unregistered. Never receives traffic. Delete entirely.                                                     |
| `src/integrations/webhook/pm-webhook.controller.ts` | `POST /api/v1/integrations/webhooks/:provider` | **ACTIVE** (registered in PmWebhookModule)      | CS0-9. Uses `PmWebhookRouterService` with per-workspace `webhook_secret` from DB. Canonical.               |

`ClickUpWebhookConsumer` is only used by the dead `clickup-webhook.controller.ts` and its own module scaffolding — **nothing else imports it**. It is dead code.

## Acceptance Criteria

### AC1 — Remove LEGACY-labeled env vars from `.env.example`

Delete these vars and their comment blocks:

- `CLICKUP_USE_WEBHOOKS` (global feature flag, superseded by per-project `webhook_enabled` in `ProjectIntegration`)
- `CLICKUP_WEBHOOK_SECRET` (shared secret, superseded by per-workspace `webhook_secret` column in `ProjectIntegration`)

### AC2 — Remove DEPRECATED-labeled env vars from `.env.example`

Delete these vars and their comment blocks:

- `ACTIONABLE_STATUSES`, `NON_ACTIONABLE_STATUSES` (superseded by per-project `ai_trigger_status`)
- `CLICKUP_STATUS_DEPLOYED`, `CLICKUP_STATUS_DEPLOY_FAILED`, `CLICKUP_STATUS_ROLLED_BACK`
- The entire commented-out polling block (`# CLICKUP_POLL_INTERVAL_MS`, `# CLICKUP_MAX_POLL_INTERVAL_MS`)

### AC3 — Remove operational ClickUp env vars — replace with hardcoded constants

Remove from `.env.example` and replace `configService.get()` calls with constants in code:

- `CLICKUP_RETRY_ATTEMPTS` → `3` in `clickup.service.ts`
- `CLICKUP_RETRY_BACKOFF_MS` → `1000` in `clickup.service.ts`
- `CLICKUP_MAX_COMMENT_LENGTH` → `20000` in `clickup.service.ts`
- `CLICKUP_SYNC_BATCH_SIZE` → `50` in `project.service.ts`
- `CLICKUP_SYNC_BATCH_DELAY_MS` → `100` in `project.service.ts`
- `CLICKUP_API_BASE_URL` → hardcode `'https://api.clickup.com/api/v2'` at every call site

### AC4 — Remove from `env.validation.ts`

Delete these Joi schema entries from `src/config/env.validation.ts`:

- `CLICKUP_WEBHOOK_SECRET` — currently `required()`, **delete entirely** (not make optional)
- `CLICKUP_MAX_COMMENT_LENGTH`, `CLICKUP_RETRY_ATTEMPTS`, `CLICKUP_RETRY_BACKOFF_MS`, `CLICKUP_API_BASE_URL`

### AC5 — Remove from `configuration.ts`

From the `clickup:` block in `src/config/configuration.ts`:

- Remove `apiUrl: process.env.CLICKUP_API_BASE_URL || ...`
- Remove `webhookSecret: process.env.CLICKUP_WEBHOOK_SECRET || ''`

### AC6 — Delete `clickup-webhook.controller.ts` and `ClickUpWebhookConsumer` (dead code)

These are confirmed dead:

- `src/clickup/clickup-webhook.controller.ts` — `@Controller('webhooks/clickup')` is **unregistered** (`clickup.module.ts` has `controllers: []`). Never receives traffic. Delete the file.
- `src/clickup/clickup-webhook-consumer.service.ts` — only referenced by the dead controller and `clickup.module.ts` scaffolding. Nothing else imports it. Delete the file.
- `src/clickup/clickup.module.ts` — remove `ClickUpWebhookConsumer` from `providers:[]` and `exports:[]`. Remove its import. Update the JSDoc comment: remove "Feature flag: CLICKUP_USE_WEBHOOKS toggles mode" (line 19), "ClickUpWebhookConsumer: Processes webhook events" (line 23), and "ClickUpWebhookController: REST endpoint for webhooks" (line 24).

### AC7 — Remove the old active `POST /webhooks/clickup` endpoint and `WebhookSignatureGuard`

The `POST /api/v1/webhooks/clickup` endpoint in `src/webhooks/webhooks.controller.ts` (line 68–69) uses `@UseGuards(WebhookSignatureGuard)` which reads `CLICKUP_WEBHOOK_SECRET`. This endpoint is superseded by `POST /api/v1/integrations/webhooks/clickup` (CS0-9).

**Required actions:**

- Delete `src/webhooks/guards/webhook-signature.guard.ts` — global-secret pattern is fully replaced by per-workspace DB lookup in `PmWebhookRouterService`
- In `src/webhooks/webhooks.controller.ts`: remove the `@Post('clickup')` handler (`handleClickUpWebhook`) and `@Get('clickup/health')` handler, plus all imports referencing `WebhookSignatureGuard`, `ClickUpWebhookDto`, and the ClickUp webhook interfaces (only if used solely by these removed handlers)
- **DO NOT touch** `@Post('github')` or `GitHubWebhookSignatureGuard` — those are separate and unrelated
- **DO NOT touch** the health endpoint if it is used by non-ClickUp paths

### AC8 — Update `webhooks.module.ts`

In `src/webhooks/webhooks.module.ts`:

- Remove `WebhookSignatureGuard` from `providers:[]`
- Remove the comment `// Required for WebhookSignatureGuard (CLICKUP_WEBHOOK_SECRET)` from `ConfigModule` import
- Remove any imports that are now unused after the handler and guard deletion

### AC9 — Update test infrastructure

- `test/jest-setup.ts` line 9: delete `process.env.CLICKUP_WEBHOOK_SECRET = 'test-webhook-secret-16chars'`
- `src/clickup/clickup.service.spec.ts` lines 27–29: remove `CLICKUP_RETRY_ATTEMPTS`, `CLICKUP_RETRY_BACKOFF_MS`, `CLICKUP_MAX_COMMENT_LENGTH` from the mock ConfigService values map
- Search for any spec file in `src/webhooks/guards/` for `webhook-signature.guard.spec.ts` — if it exists, delete it (the class it tests is being deleted)
- Search for `clickup-webhook-consumer.service.spec.ts` — if it exists, delete it (the class is being deleted)
- Search for `clickup-webhook.controller.spec.ts` — if it exists, delete it

### AC10 — App starts without removed env vars

Boot successfully with `.env` that does NOT contain any removed vars. No Joi validation errors at startup.

### AC11 — All existing tests pass

`pnpm test` passes with no regressions. `pnpm typecheck` reports zero errors.

## Tasks / Subtasks

- [ ] Task 1 — Remove legacy/deprecated vars from `.env.example` (AC1, AC2)
  - [ ] 1.1 Delete `CLICKUP_USE_WEBHOOKS` + LEGACY comment block
  - [ ] 1.2 Delete `CLICKUP_WEBHOOK_SECRET` + LEGACY comment block
  - [ ] 1.3 Delete `ACTIONABLE_STATUSES`, `NON_ACTIONABLE_STATUSES` + DEPRECATED comments
  - [ ] 1.4 Delete `CLICKUP_STATUS_DEPLOYED`, `CLICKUP_STATUS_DEPLOY_FAILED`, `CLICKUP_STATUS_ROLLED_BACK` + DEPRECATED comment block
  - [ ] 1.5 Delete the entire commented-out polling block (`CLICKUP_POLL_INTERVAL_MS`, `CLICKUP_MAX_POLL_INTERVAL_MS`)

- [ ] Task 2 — Remove operational vars from `.env.example` (AC3)
  - [ ] 2.1 Delete `CLICKUP_RETRY_ATTEMPTS`, `CLICKUP_RETRY_BACKOFF_MS`, `CLICKUP_MAX_COMMENT_LENGTH` with comments
  - [ ] 2.2 Delete `CLICKUP_SYNC_BATCH_SIZE`, `CLICKUP_SYNC_BATCH_DELAY_MS` with comments
  - [ ] 2.3 Delete `CLICKUP_API_BASE_URL` with comment

- [ ] Task 3 — Update `env.validation.ts` (AC4)
  - [ ] 3.1 Delete `CLICKUP_WEBHOOK_SECRET` Joi entry entirely (currently `required()`)
  - [ ] 3.2 Delete `CLICKUP_MAX_COMMENT_LENGTH`, `CLICKUP_RETRY_ATTEMPTS`, `CLICKUP_RETRY_BACKOFF_MS`, `CLICKUP_API_BASE_URL` entries
  - [ ] 3.3 Clean up any now-empty Legacy ClickUp comment block

- [ ] Task 4 — Update `configuration.ts` (AC5)
  - [ ] 4.1 Remove `apiUrl` from `clickup:` block
  - [ ] 4.2 Remove `webhookSecret` from `clickup:` block

- [ ] Task 5 — Hardcode constants in `clickup.service.ts` (AC3)
  - [ ] 5.1 Replace `config.get('CLICKUP_RETRY_ATTEMPTS', 3)` → `3`
  - [ ] 5.2 Replace `config.get('CLICKUP_RETRY_BACKOFF_MS', 1000)` → `1000`
  - [ ] 5.3 Replace `config.get('CLICKUP_MAX_COMMENT_LENGTH', 20000)` → `20000`
  - [ ] 5.4 Remove `ConfigService` injection from constructor if it becomes unused after all removals

- [ ] Task 6 — Hardcode constants in `project.service.ts` (AC3)
  - [ ] 6.1 Replace `config.get('CLICKUP_SYNC_BATCH_SIZE', 50)` → `50`
  - [ ] 6.2 Replace `config.get('CLICKUP_SYNC_BATCH_DELAY_MS', 100)` → `100`

- [ ] Task 7 — Hardcode API URL at all call sites (AC3, AC5)
  - [ ] 7.1 `ticket-intake.service.ts`: replace `configService.get<string>('clickup.apiUrl') || '...'` with `'https://api.clickup.com/api/v2'`
  - [ ] 7.2 `clickup-oauth.service.ts`: replace both `config.get<string>('clickup.apiUrl') ?? '...'` occurrences

- [ ] Task 8 — Delete dead code: `ClickUpWebhookConsumer` + controller (AC6)
  - [ ] 8.1 Delete `src/clickup/clickup-webhook.controller.ts`
  - [ ] 8.2 Delete `src/clickup/clickup-webhook-consumer.service.ts`
  - [ ] 8.3 In `src/clickup/clickup.module.ts`: remove `ClickUpWebhookConsumer` from providers, exports, and import statement. Update JSDoc to remove the three stale bullet points (lines 19, 23, 24)

- [ ] Task 9 — Remove old webhook endpoint and `WebhookSignatureGuard` (AC7)
  - [ ] 9.1 Delete `src/webhooks/guards/webhook-signature.guard.ts`
  - [ ] 9.2 In `src/webhooks/webhooks.controller.ts`: remove `handleClickUpWebhook()` method, `healthCheck()` for ClickUp (line ~129), `WebhookSignatureGuard` import, and any interfaces/DTOs that become unused
  - [ ] 9.3 Verify `github-webhooks.controller.ts` and `GitHubWebhookSignatureGuard` are untouched
  - [ ] 9.4 Update `src/webhooks/guards/index.ts` to remove `WebhookSignatureGuard` export if present

- [ ] Task 10 — Update `webhooks.module.ts` (AC8)
  - [ ] 10.1 Remove `WebhookSignatureGuard` from `providers:[]`
  - [ ] 10.2 Remove the stale `CLICKUP_WEBHOOK_SECRET` comment from `ConfigModule` import
  - [ ] 10.3 Remove any imports that become unused

- [ ] Task 11 — Clean up tests (AC9)
  - [ ] 11.1 `test/jest-setup.ts` line 9: delete `process.env.CLICKUP_WEBHOOK_SECRET = ...`
  - [ ] 11.2 `src/clickup/clickup.service.spec.ts`: remove `CLICKUP_RETRY_ATTEMPTS`, `CLICKUP_RETRY_BACKOFF_MS`, `CLICKUP_MAX_COMMENT_LENGTH` from ConfigService mock
  - [ ] 11.3 Delete `src/webhooks/guards/webhook-signature.guard.spec.ts` if it exists
  - [ ] 11.4 Delete `src/clickup/clickup-webhook-consumer.service.spec.ts` if it exists
  - [ ] 11.5 Delete `src/clickup/clickup-webhook.controller.spec.ts` if it exists

- [ ] Task 12 — Final validation (AC10, AC11)
  - [ ] 12.1 Ensure `.env` does NOT contain any removed vars; confirm no Joi startup errors
  - [ ] 12.2 `pnpm test` — all tests pass
  - [ ] 12.3 `pnpm typecheck` — zero TypeScript errors

## Dev Notes

### Key Files — Action Required

| Action                 | File                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------ |
| **MODIFY**             | `.env.example` — remove LEGACY/DEPRECATED/operational blocks                               |
| **MODIFY**             | `src/config/env.validation.ts` — remove Joi entries                                        |
| **MODIFY**             | `src/config/configuration.ts` — remove `apiUrl` + `webhookSecret` from clickup block       |
| **MODIFY**             | `src/clickup/clickup.service.ts` — replace config.get calls with constants                 |
| **MODIFY**             | `src/projects/project.service.ts` — replace batch config.get calls with constants          |
| **MODIFY**             | `src/ticket-intake/ticket-intake.service.ts` — hardcode API URL                            |
| **MODIFY**             | `src/integrations/clickup-oauth.service.ts` — hardcode API URL (2 occurrences)             |
| **MODIFY**             | `src/clickup/clickup.module.ts` — remove ClickUpWebhookConsumer scaffolding + fix JSDoc    |
| **MODIFY**             | `src/webhooks/webhooks.controller.ts` — remove ClickUp handlers                            |
| **MODIFY**             | `src/webhooks/webhooks.module.ts` — remove guard + stale comment                           |
| **MODIFY**             | `src/webhooks/guards/index.ts` — remove WebhookSignatureGuard export                       |
| **MODIFY**             | `test/jest-setup.ts` — remove CLICKUP_WEBHOOK_SECRET mock                                  |
| **MODIFY**             | `src/clickup/clickup.service.spec.ts` — remove 3 ConfigService mock entries                |
| **DELETE**             | `src/clickup/clickup-webhook.controller.ts` — unregistered dead code                       |
| **DELETE**             | `src/clickup/clickup-webhook-consumer.service.ts` — only used by dead controller           |
| **DELETE**             | `src/webhooks/guards/webhook-signature.guard.ts` — global-secret pattern replaced by CS0-9 |
| **DELETE (if exists)** | `src/webhooks/guards/webhook-signature.guard.spec.ts`                                      |
| **DELETE (if exists)** | `src/clickup/clickup-webhook-consumer.service.spec.ts`                                     |
| **DELETE (if exists)** | `src/clickup/clickup-webhook.controller.spec.ts`                                           |

### DO NOT TOUCH — These are correct and must be preserved

- `src/webhooks/guards/github-webhook-signature.guard.ts` — GitHub guard, completely separate
- `src/integrations/webhook/pm-webhook-router.service.ts` — CS0-9 canonical implementation
- `src/integrations/webhook/pm-webhook.controller.ts` — new active endpoint
- `src/clickup/clickup-task-update.consumer.ts` — queue consumer, unrelated
- `src/clickup/clickup.service.ts` — keep the service, only remove config.get for 3 vars
- `CLICKUP_CLIENT_ID`, `CLICKUP_CLIENT_SECRET`, `CLICKUP_REDIRECT_URI` — OAuth vars, keep
- `WEBHOOK_DEDUP_TTL_MS`, `WEBHOOK_MAX_RETRIES`, `WEBHOOK_RETRY_DELAY_MS`, `WEBHOOK_USE_REDIS_DEDUP` — not ClickUp-specific, keep

### Architecture: Why These Are Dead

**`clickup-webhook.controller.ts` is dead** because `clickup.module.ts` declares `controllers: []` (empty array). NestJS only registers controllers listed in the module's `controllers` property. This controller was never wired up after `ClickUpPollingOrchestrator` was removed in CS1-7.

**`ClickUpWebhookConsumer` is dead** because:

1. Only the dead controller (`clickup-webhook.controller.ts`) calls `webhookConsumer.processWebhook()` and `webhookConsumer.healthCheck()`
2. No other file imports `ClickUpWebhookConsumer` outside of `clickup.module.ts` itself
3. The CS0-9 `PmWebhookRouterService` does equivalent work (signature verification + queue publish) for all active webhook traffic

**`WebhookSignatureGuard` is replaceable** because:

- It reads a single global `CLICKUP_WEBHOOK_SECRET` from env
- `PmWebhookRouterService` (CS0-9) already performs per-workspace HMAC verification by loading `integration.webhook_secret` from the DB — this is strictly more correct
- After removing the old `POST /webhooks/clickup` handler from `webhooks.controller.ts`, nothing uses `WebhookSignatureGuard`

### Exact Code Snippets to Remove

**`src/config/env.validation.ts`** — lines ~110–116:

```ts
// ClickUp Integration (Legacy — CLICKUP_API_KEY removed CS1-7; OAuth via ProjectIntegration CS0-5)
// CLICKUP_API_KEY was removed — no longer validated at startup
CLICKUP_WEBHOOK_SECRET: Joi.string().min(16).required().messages({
  'any.required': 'CLICKUP_WEBHOOK_SECRET is required for webhook signature verification',
  'string.min': 'CLICKUP_WEBHOOK_SECRET must be at least 16 characters',
}),
```

**`src/config/env.validation.ts`** — lines ~218–221:

```ts
CLICKUP_MAX_COMMENT_LENGTH: Joi.number().integer().min(1000).max(50000).default(20000),
CLICKUP_RETRY_ATTEMPTS: Joi.number().integer().min(1).max(10).default(3),
CLICKUP_RETRY_BACKOFF_MS: Joi.number().integer().min(100).max(5000).default(1000),
CLICKUP_API_BASE_URL: Joi.string().uri().default('https://api.clickup.com/api/v2'),
```

**`src/clickup/clickup.service.ts`** — lines ~62–63, 155:

```ts
this.retryAttempts = this.config.get<number>('CLICKUP_RETRY_ATTEMPTS', 3);
this.retryBackoffMs = this.config.get<number>('CLICKUP_RETRY_BACKOFF_MS', 1000);
// ...
const maxLength = this.config.get<number>('CLICKUP_MAX_COMMENT_LENGTH', 20000);
```

Replace with: `private readonly retryAttempts = 3;` and `private readonly retryBackoffMs = 1000;` as class fields, and `const maxLength = 20000;` inline.

**`src/projects/project.service.ts`** — lines ~380–381:

```ts
const BATCH_SIZE = this.config.get<number>('CLICKUP_SYNC_BATCH_SIZE', 50);
const BATCH_DELAY_MS = this.config.get<number>('CLICKUP_SYNC_BATCH_DELAY_MS', 100);
```

Replace with: `const BATCH_SIZE = 50; const BATCH_DELAY_MS = 100;`

**`test/jest-setup.ts`** — line 9:

```ts
process.env.CLICKUP_WEBHOOK_SECRET = 'test-webhook-secret-16chars';
```

**`src/clickup/clickup.service.spec.ts`** — lines 27–29:

```ts
CLICKUP_RETRY_ATTEMPTS: 3,
CLICKUP_RETRY_BACKOFF_MS: 100,
CLICKUP_MAX_COMMENT_LENGTH: 20000,
```

### References

- [Source: src/config/env.validation.ts#110-116] — CLICKUP_WEBHOOK_SECRET required validation
- [Source: src/config/env.validation.ts#218-221] — CLICKUP\_\* operational validations
- [Source: src/config/configuration.ts#71-77] — clickup config block
- [Source: src/clickup/clickup.service.ts#62-63,155] — config.get calls
- [Source: src/projects/project.service.ts#380-381] — batch config.get calls
- [Source: src/ticket-intake/ticket-intake.service.ts#80] — clickup.apiUrl usage
- [Source: src/integrations/clickup-oauth.service.ts#50,72] — clickup.apiUrl usage (2x)
- [Source: src/clickup/clickup.module.ts#19,23,24,38-40] — dead code scaffolding
- [Source: src/clickup/clickup-webhook.controller.ts] — dead unregistered controller
- [Source: src/clickup/clickup-webhook-consumer.service.ts#41-42] — ENABLED/WEBHOOK_SECRET fields
- [Source: src/webhooks/webhooks.controller.ts#68-69] — old POST /webhooks/clickup with guard
- [Source: src/webhooks/guards/webhook-signature.guard.ts] — global-secret guard
- [Source: src/webhooks/webhooks.module.ts#36,48] — stale comment + guard provider
- [Source: src/integrations/webhook/pm-webhook-router.service.ts#128] — per-workspace secret (new canonical approach)
- [Source: test/jest-setup.ts#9] — CLICKUP_WEBHOOK_SECRET mock
- [Source: src/clickup/clickup.service.spec.ts#27-29] — ConfigService mock entries

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
