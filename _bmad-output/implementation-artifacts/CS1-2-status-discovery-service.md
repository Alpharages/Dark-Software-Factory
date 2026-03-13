# Story CS1.2: IPMProvider Status Discovery with Per-Provider Cache

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **DSF system**,
I want workflow statuses fetched live from any PM tool per project,
so that every team's custom status names are discovered at runtime regardless of provider.

## Acceptance Criteria

### AC1 — `PMStatusService.getStatuses()` delegates to provider and caches results

- `PMStatusService.getStatuses(integration: ProjectIntegration, containerId: string)` calls `PMProviderFactory.getProvider(integration).getStatuses(containerId)`
- Results are cached in-memory in `PMStatusService` keyed by `{provider}:{containerId}` with a **5-minute TTL** (300,000 ms) — `NFR-CS1` specifies 5 min; sprint-status notes that say "15 min" are incorrect
- A second call within TTL returns cached data — `PMProviderFactory.getProvider()` is NOT called again

### AC2 — Cache expiry triggers a fresh API call

- When the cache entry for `{provider}:{containerId}` has expired
- `getStatuses()` makes a fresh API call via `PMProviderFactory` and updates the cache

### AC3 — API failure falls back to stale cache; Sentry notified

- When the PM tool API call throws (network error, 5xx)
- If a stale cache entry exists (any TTL age), it is returned with a `warn` log: `"PM tool API unavailable for {provider}:{containerId} — returning stale statuses"`
- `SentryService.captureException(error, { tags: { provider, containerId } })` is called on every API failure
- If no stale cache entry exists, the error is re-thrown

### AC4 — `PMStatusService.resolveStatusId()` returns matching status ID

- `PMStatusService.resolveStatusId(integration: ProjectIntegration, containerId: string, statusName: string)` calls `getStatuses()` to get the current list
- Comparison is **case-insensitive** (`statusName.toLowerCase() === status.name.toLowerCase()`)
- If a match is found, the matching `NormalizedStatus.id` is returned
- If no match is found, `statusName` (the raw input) is returned as fallback with a `warn` log: `"No status found matching '{statusName}' for {provider}:{containerId} — using raw value as fallback"`

### AC5 — `GET /api/v1/integrations/:id/statuses` endpoint returns live statuses

- A new endpoint `GET /api/v1/integrations/:id/statuses` is added to `IntegrationsController`
- Protected by `JwtAuthGuard`, `RolesGuard`, `ThrottlerGuard`; roles: `PM`, `MANAGER`, `ADMIN`
- The integration is looked up by `id` via `ProjectIntegrationService.getDecryptedIntegration(id)` — **must use this method to ensure tokens are decrypted before passing to `PMStatusService`**
- `containerId` is a **required** query parameter (`@Query('containerId')`); throw `BadRequestException` if absent or empty
- Returns `NormalizedStatus[]` with HTTP 200
- Returns 404 if integration not found
- Returns 400 if `containerId` query param is absent

### AC6 — Unit tests cover cache behavior, fallback, and status resolution

- Cache hit: second call returns cached data, provider not called again
- Cache miss: fresh provider call, result cached
- Expired cache: fresh provider call, cache updated
- API failure with stale cache: stale data returned with warn log + Sentry capture
- API failure without cache: error re-thrown
- `resolveStatusId` case-insensitive match: returns correct `id`
- `resolveStatusId` no match: returns raw `statusName` with warn log

### AC7 — TypeScript clean

- `pnpm typecheck` passes with zero errors
- `pnpm lint` passes with zero warnings/errors

## Tasks / Subtasks

- [x] Task 1: Create `PMStatusService` at `src/integrations/pm-status.service.ts` (AC1–AC4)
  - [x] Define in-memory cache `Map<string, { statuses: NormalizedStatus[]; expiresAt: number }>` with constant `private readonly CACHE_TTL_MS = 300_000`
  - [x] Implement `getStatuses(integration, containerId)` with 5-min TTL cache
  - [x] Implement stale fallback + Sentry capture on API error (AC3)
  - [x] Implement `resolveStatusId(integration, containerId, statusName)` with case-insensitive match (AC4)
- [x] Task 2: Register `PMStatusService` in `IntegrationsModule` (AC5)
  - [x] Add `PMStatusService` to `providers` and `exports` in `src/integrations/integrations.module.ts`
- [x] Task 3: Add `GET :id/statuses` endpoint to `IntegrationsController` (AC5)
  - [x] Inject `PMStatusService` and `ProjectIntegrationService` into the controller
  - [x] Add `@Get(':id/statuses')` handler with proper Swagger decorators
  - [x] Require `?containerId=` query param; throw `BadRequestException` if absent
  - [x] Call `getDecryptedIntegration(id)` before passing integration to `PMStatusService`
  - [x] Return `NormalizedStatus[]`
- [x] Task 4: Write `src/integrations/pm-status.service.spec.ts` (AC6)
  - [x] Test cache hit scenario
  - [x] Test cache miss scenario
  - [x] Test expired cache scenario
  - [x] Test API failure with stale cache (assert warn log + Sentry capture)
  - [x] Test API failure without cache (assert error re-thrown)
  - [x] Test `resolveStatusId` case-insensitive match
  - [x] Test `resolveStatusId` fallback with warn log
- [x] Task 5: Update `src/integrations/integrations.controller.spec.ts` for new endpoint (AC6)
  - [x] Add test for 200 response with statuses
  - [x] Add test for 404 when integration not found
  - [x] Add test for 400 when `containerId` query param is missing
- [x] Task 6: Verify build (AC7)
  - [x] `pnpm typecheck` — zero errors
  - [x] `pnpm lint` — zero errors
  - [x] `pnpm test` — all tests pass

## Dev Notes

### Service Location and Naming

Create the service at `src/integrations/pm-status.service.ts`. Class name: `PMStatusService`.

This service sits at the **integrations-module** level — not inside `providers/` (which is for `IPMProvider` implementations) and not in `providers/clickup/` (provider-specific). It is the cross-provider status orchestration layer.

### Logger: Use NestJS Built-in `Logger`, NOT `LoggerService`

Within `src/integrations/`, the pattern is the NestJS built-in `Logger`:

```typescript
private readonly logger = new Logger(PMStatusService.name);
```

`LoggerService` (custom, with Sentry context) is used in `PmPollingOrchestrator` because it orchestrates multi-integration loops with full Sentry context. `PMStatusService` is a cache/delegation layer — use the simple `Logger` just like `PMProviderFactory`, `ClickUpOAuthService`, and `ProjectIntegrationService` all do.

### Critical: ClickUpProvider Cache Does NOT Persist Across Calls

`PMProviderFactory.getProvider(integration)` creates a **new** `ClickUpProvider` instance each time it is called (`return new ClickUpProvider(activeIntegration.access_token)` at `src/integrations/providers/pm-provider.factory.ts:45`).

The `ClickUpProvider` has an instance-level `statusCache` Map with 1-hour TTL, but since a new instance is created per call, this cache is **thrown away** immediately. Therefore, **the `PMStatusService` is the only real cache layer** and must be implemented correctly.

Do NOT rely on the provider's cache. The service-level cache in `PMStatusService` is the authoritative persistence layer for AC1/AC2/AC3.

### Critical: Always Pass a Decrypted Integration

`PMProviderFactory.getProvider()` uses `integration.access_token` directly. If a raw (encrypted) Prisma record is passed, authentication will fail silently.

**Always** obtain the integration via `ProjectIntegrationService.getDecryptedIntegration(id)` before calling `PMStatusService.getStatuses()`. The endpoint handler must do this — the service itself trusts its caller to provide a decrypted record (it should not re-decrypt internally).

The polling orchestrator shows the same pattern:

```typescript
// CORRECT — decrypt first, then pass to factory
const integration = await this.integrationService.getDecryptedIntegration(raw.id);
const provider = await this.providerFactory.getProvider(integration);
```

### Cache Key Format

Cache key: `` `${integration.provider}:${containerId}` ``

Example: `"CLICKUP:123456"` — provider enum value + list ID.

For ClickUp, `containerId` = the **list ID** (ClickUp-specific term). The provider-agnostic term `containerId` is used in `IPMProvider.getStatuses(contextId)` and in the API endpoint. They refer to the same value.

### Cache Data Structure

```typescript
private readonly CACHE_TTL_MS = 300_000; // 5 minutes — per NFR-CS1

interface CacheEntry {
  statuses: NormalizedStatus[];
  expiresAt: number;  // Date.now() + CACHE_TTL_MS
}
private readonly cache = new Map<string, CacheEntry>();
```

**Stale fallback pattern**: Do NOT delete expired entries on expiry. Only overwrite on fresh fetch. On API failure, check if `this.cache.has(key)` (regardless of `expiresAt`) — if it exists, return the stale `.statuses` with a warn log + Sentry capture.

```typescript
async getStatuses(integration: ProjectIntegration, containerId: string): Promise<NormalizedStatus[]> {
  const key = `${integration.provider}:${containerId}`;
  const entry = this.cache.get(key);

  if (entry && entry.expiresAt > Date.now()) {
    return entry.statuses; // cache hit
  }

  try {
    const provider = await this.providerFactory.getProvider(integration);
    const statuses = await provider.getStatuses(containerId);
    this.cache.set(key, { statuses, expiresAt: Date.now() + this.CACHE_TTL_MS });
    return statuses;
  } catch (error) {
    if (entry) {
      // stale fallback
      this.logger.warn(`PM tool API unavailable for ${key} — returning stale statuses`);
      this.sentry.captureException(error, { tags: { provider: String(integration.provider), containerId } });
      return entry.statuses;
    }
    throw error;
  }
}
```

### Endpoint Design

```
GET /api/v1/integrations/:id/statuses?containerId={listId}
```

Route in controller: `@Get(':id/statuses')` — NestJS route param `:id` and `@Query('containerId')`.

`:id` is `ProjectIntegration.id` (UUID), NOT the project_id.

**`containerId` is REQUIRED.** The `?containerId=` query param must be present and non-empty. Throw `BadRequestException` if absent.

> **Why not `provider_config.containerId` fallback?**
> `ClickUpOAuthService.handleCallback()` stores `provider_config: {}` (empty object — `src/integrations/clickup-oauth.service.ts:128`). No existing code populates `containerId` in `provider_config`. That key will be written by CS1-4 (Live Status Picker UI) when the PM selects their list. Until CS1-4 is implemented, `?containerId=` is the only way to provide a list ID. **Do NOT implement a `provider_config` fallback in this story** — it will always return null and mislead.

### NormalizedStatus DTO and Swagger Serialization

```typescript
// src/integrations/providers/dto/normalized-status.dto.ts — current state
export class NormalizedStatus {
  id!: string; // ClickUp: status name used as ID (e.g., "in progress")
  name!: string; // Display name (e.g., "In Progress")
  color!: string | null;
  type!: NormalizedStatusType; // TODO | IN_PROGRESS | DONE | CANCELLED | OTHER
}
```

`NormalizedStatus` currently has no `@ApiProperty()` decorators. This means `@ApiResponse({ status: 200, type: [NormalizedStatus] })` will produce an empty Swagger schema. **Two options:**

1. **(Preferred — minimal scope)** Use `@ApiResponse({ status: 200, description: 'Array of workflow statuses' })` without `type:` — avoids touching the shared DTO
2. Add `@ApiProperty()` to `NormalizedStatus` fields — correct approach but modifies a shared DTO; acceptable if done cleanly

Choose option 1 to stay within story scope. Do not add `@ApiProperty()` unless it's a quick pass with no risk of breaking other Swagger docs.

### Swagger Decorators

```typescript
@Get(':id/statuses')
@Roles(Role.PM, Role.MANAGER, Role.ADMIN)
@ApiOperation({ summary: 'Get live workflow statuses for a PM tool integration' })
@ApiParam({ name: 'id', description: 'ProjectIntegration UUID' })
@ApiQuery({ name: 'containerId', required: true, description: 'List/board/project ID from the PM tool (for ClickUp: list ID)' })
@ApiResponse({ status: 200, description: 'Array of workflow statuses (NormalizedStatus[])' })
@ApiResponse({ status: 400, description: 'containerId query param is required' })
@ApiResponse({ status: 404, description: 'Integration not found' })
```

### Sentry Injection Pattern

`SentryService` is available at `src/common/sentry/sentry.service.ts`. Inject it the same way `PmPollingOrchestrator` does:

```typescript
constructor(
  private readonly providerFactory: PMProviderFactory,
  private readonly sentry: SentryService,
) {}
```

`SentryService` is provided by a global or shared module — check that it's accessible from `IntegrationsModule`. If not, add `SentryModule` (or equivalent) to `IntegrationsModule.imports`.

### Module Registration

Add to `src/integrations/integrations.module.ts`:

```typescript
providers: [ProjectIntegrationService, ClickUpOAuthService, PMProviderFactory, PMStatusService],
exports: [ProjectIntegrationService, ClickUpOAuthService, PMProviderFactory, PMStatusService],
```

Also update the `IntegrationsController` constructor to inject `PMStatusService` and `ProjectIntegrationService` (already injected via the factory — confirm it's available).

### Test Pattern for PMStatusService

Mock `PMProviderFactory` and `SentryService`. Do NOT create a real `ClickUpProvider`.

```typescript
const mockProvider = { getStatuses: jest.fn() };
const mockFactory = { getProvider: jest.fn().mockResolvedValue(mockProvider) };
const mockSentry = { captureException: jest.fn() };

beforeEach(() => {
  service = new PMStatusService(mockFactory as any, mockSentry as any);
});
```

Example test for stale fallback + Sentry:

```typescript
it('should return stale cache and call Sentry on API failure', async () => {
  mockProvider.getStatuses.mockResolvedValueOnce(statuses);
  await service.getStatuses(mockIntegration, containerId); // populate cache

  // Expire the cache
  jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 400_000);

  mockProvider.getStatuses.mockRejectedValueOnce(new Error('API down'));
  const result = await service.getStatuses(mockIntegration, containerId);

  expect(result).toEqual(statuses); // stale returned
  expect(mockSentry.captureException).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('returning stale statuses'));
});
```

### Dependencies: CS1-1 and CS1-3

**CS1-1**: No dependency. CS1-2 adds new files; CS1-1 deletes code in unrelated files. Can run in parallel, though CS1-1 is already `ready-for-dev` and may land first.

**CS1-3**: No dependency for CS1-2. `ai_trigger_status String?` already exists on `ProjectIntegration` at `prisma/schema.prisma:1278` (added in CS0-1). **No Prisma migration needed for CS1-2.**

### Project Structure Notes

All new/modified files for this story:

| File                                               | Change Type                                         |
| -------------------------------------------------- | --------------------------------------------------- |
| `src/integrations/pm-status.service.ts`            | NEW — `PMStatusService` with 5-min cache            |
| `src/integrations/pm-status.service.spec.ts`       | NEW — unit tests                                    |
| `src/integrations/integrations.module.ts`          | MODIFY — add `PMStatusService` to providers/exports |
| `src/integrations/integrations.controller.ts`      | MODIFY — add `GET :id/statuses` endpoint            |
| `src/integrations/integrations.controller.spec.ts` | MODIFY — add tests for new endpoint                 |

**Do NOT touch**:

- `src/integrations/providers/clickup/clickup.provider.ts` — already implements `getStatuses()` correctly
- `src/integrations/providers/pm-provider.interface.ts` — already has `getStatuses(contextId: string)`
- `src/integrations/providers/pm-provider.factory.ts` — factory already works
- `src/integrations/providers/dto/normalized-status.dto.ts` — do NOT add `@ApiProperty()` unless trivial (use option 1 in Swagger section)
- `src/clickup/` — legacy module; untouched until CS1-7

### References

- Epic CS1 spec: [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #Story 1.2]
- Requirements FR-CS3, FR-CS5, NFR-CS1: [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #Requirements Inventory]
- Sprint status: [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml` #CS1-2-status-discovery-service]
- Previous story: [Source: `_bmad-output/implementation-artifacts/CS1-1-remove-hardcoded-status-maps.md`]
- `IPMProvider.getStatuses()`: [Source: `src/integrations/providers/pm-provider.interface.ts:16`]
- `ClickUpProvider.getStatuses()` + instance cache: [Source: `src/integrations/providers/clickup/clickup.provider.ts:111–133`]
- `PMProviderFactory.getProvider()` creates new instance: [Source: `src/integrations/providers/pm-provider.factory.ts:45`]
- `provider_config: {}` (empty at OAuth time): [Source: `src/integrations/clickup-oauth.service.ts:128`]
- `PmPollingOrchestrator` decrypt + factory pattern: [Source: `src/integrations/polling/pm-polling-orchestrator.service.ts:45–50`]
- `IntegrationsModule`: [Source: `src/integrations/integrations.module.ts`]
- `IntegrationsController`: [Source: `src/integrations/integrations.controller.ts`]
- `NormalizedStatus` DTO: [Source: `src/integrations/providers/dto/normalized-status.dto.ts`]
- `ProjectIntegration` Prisma model + `ai_trigger_status`: [Source: `prisma/schema.prisma:1260–1287`]
- `ProjectIntegrationService.getDecryptedIntegration()`: [Source: `src/integrations/project-integration.service.ts:153–161`]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- All ACs implemented. `PMStatusService` uses 5-min in-memory TTL cache keyed by `{provider}:{containerId}`; stale fallback on API error with Sentry capture; `resolveStatusId` is case-insensitive with warn log fallback.
- `SentryModule` explicitly imported in `IntegrationsModule` for clarity (it is `@Global()` but explicit import is consistent with other modules).
- `ErrorCategory.NETWORK` used in Sentry capture instead of `ErrorCategory.CLICKUP` to maintain provider-agnostic semantics.
- Code review (2026-03-13): Fixed `ErrorCategory.CLICKUP` → `ErrorCategory.NETWORK`, added explicit `SentryModule` import, added warn log assertion in stale-cache test, updated `@/` path aliases on imports in `pm-status.service.ts` and `integrations.module.ts`.

### File List

- `src/integrations/pm-status.service.ts` — NEW: `PMStatusService` with 5-min TTL cache, stale fallback, Sentry capture
- `src/integrations/pm-status.service.spec.ts` — NEW: unit tests (cache hit/miss/expiry/stale-fallback/re-throw, resolveStatusId)
- `src/integrations/integrations.module.ts` — MODIFIED: added `PMStatusService` to providers/exports, added `SentryModule` import
- `src/integrations/integrations.controller.ts` — MODIFIED: added `GET :id/statuses` endpoint with guards and Swagger decorators
- `src/integrations/integrations.controller.spec.ts` — MODIFIED: added tests for 200/400/404 on new endpoint
