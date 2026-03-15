# Story CS3.1: Fix PM Provider Error Classification — 4xx vs 5xx

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **DSF system**,
I want all PM provider implementations to treat 4xx errors as permanent and 5xx/network errors as transient,
so that automation-blocked or validation-rejected updates are never silently swallowed or endlessly retried.

## Acceptance Criteria

### AC1 — `PMProviderClientError` exception class

**Given** a PM provider (ClickUpProvider or future providers) receives a 4xx API response
**When** the error is classified
**Then** a `PMProviderClientError` is created and thrown with:

- `httpStatus: number` — the HTTP status code (e.g. 400, 403, 404, 422)
- `providerErrorCode: string | undefined` — provider-specific error code (e.g. ClickUp `ECODE` field from response body)
- `providerErrorBody: unknown` — raw response body preserved for downstream use (e.g. actionable comment in CS3-3)
- `message: string` — human-readable summary: `"PM provider returned {status}: {providerErrorCode ?? 'CLIENT_ERROR'}"`

**And** `PMProviderClientError` extends `Error` (NOT `HttpException` — this is an internal domain error, not an HTTP response)

**And** `PMProviderClientError` is exported from `src/integrations/providers/pm-provider-client.error.ts`

```typescript
export class PMProviderClientError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly providerErrorCode: string | undefined,
    public readonly providerErrorBody: unknown,
  ) {
    super(`PM provider returned ${httpStatus}: ${providerErrorCode ?? 'CLIENT_ERROR'}`);
    this.name = 'PMProviderClientError';
  }
}
```

### AC2 — `isRetryableError()` static method on `PMProviderClientError`

**Given** any error thrown from a provider API call
**When** `PMProviderClientError.isRetryable(error)` is called
**Then** it returns:

- `false` if it IS a `PMProviderClientError` (4xx is permanent — never retry)
- `false` if it is an AxiosError with status 4xx (any 400–499 except 429)
- `true` if it is an AxiosError with status 429 (rate limit — retry with backoff)
- `true` if it is an AxiosError with status 5xx
- `true` if it is a network error: no `.response`, or `error.code` is `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `ECONNABORTED`, `ECONNREFUSED`
- `false` for any other error (unknown — treat as permanent, do not loop)

```typescript
static isRetryable(error: unknown): boolean {
  if (error instanceof PMProviderClientError) return false;

  if (error instanceof AxiosError) {
    const status = error.response?.status;
    if (!status) return true; // network error
    if (status === 429) return true; // rate limit
    if (status >= 500) return true; // server error
    if (status >= 400 && status < 500) return false; // 4xx client error
  }

  const code = (error as { code?: string }).code;
  if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNABORTED', 'ECONNREFUSED'].includes(code ?? '')) {
    return true;
  }

  return false;
}
```

### AC3 — `ClickUpProvider.retryWithBackoff()` uses `PMProviderClientError.isRetryable()`

**Given** the current `ClickUpProvider.retryWithBackoff()` method
**When** it catches an error
**Then** it is refactored to use `PMProviderClientError.isRetryable(error)` instead of the inline status check

**And** when a 4xx (non-429) AxiosError is caught, it throws a `PMProviderClientError` wrapping the original response — preserving `httpStatus`, `providerErrorCode` (from `error.response.data.ECODE`), and `providerErrorBody`

**And** the retry delays remain unchanged: `backoffMs * 2^i` with default `backoffMs=1000` (producing: 1s, 2s, 4s for 3 attempts)

Refactored `retryWithBackoff()`:

```typescript
private async retryWithBackoff<T>(
  operation: () => Promise<T>,
  attempts: number = 3,
  backoffMs: number = 1000,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Wrap 4xx AxiosErrors into PMProviderClientError before classifying
      if (error instanceof AxiosError && error.response) {
        const status = error.response.status;
        if (status >= 400 && status < 500 && status !== 429) {
          const body = error.response.data as Record<string, unknown> | undefined;
          throw new PMProviderClientError(
            status,
            typeof body?.ECODE === 'string' ? body.ECODE : undefined,
            body,
          );
        }
      }

      if (!PMProviderClientError.isRetryable(error)) {
        throw error;
      }

      if (i < attempts - 1) {
        const delay = backoffMs * Math.pow(2, i);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}
```

### AC4 — `PMProviderClientError` propagates to callers of `IPMProvider` methods

**Given** `PMProviderClientError` is thrown inside `ClickUpProvider.retryWithBackoff()`
**When** it propagates out of any `IPMProvider` method (`updateStatus`, `addComment`, `setFieldValue`, `assignTask`, etc.)
**Then** it is NOT caught or swallowed inside `ClickUpProvider` — it propagates as-is to the caller

**Given** a caller (e.g. `DeploymentStatusSyncService`) catches the error
**When** `error instanceof PMProviderClientError` is checked
**Then** it evaluates to `true`, giving the caller full access to `httpStatus`, `providerErrorCode`, and `providerErrorBody`

**Note**: `DeploymentStatusSyncService` does NOT need to be modified in this story. CS3-2 will modify it to set `pm_synced=false` and CS3-3 will add the failure comment. CS3-1 only ensures the error type is correct when it propagates.

### AC5 — Unit tests for `PMProviderClientError`

**Given** the class is implemented
**When** tests run via `pnpm test`
**Then** `pm-provider-client.error.spec.ts` exists alongside the error file and covers:

| Test  | Description                                                                                |
| ----- | ------------------------------------------------------------------------------------------ |
| T-E1  | Constructor sets `httpStatus`, `providerErrorCode`, `providerErrorBody`, `message`, `name` |
| T-E2  | `isRetryable(new PMProviderClientError(...))` → `false`                                    |
| T-E3  | `isRetryable(AxiosError with status 400)` → `false`                                        |
| T-E4  | `isRetryable(AxiosError with status 403)` → `false`                                        |
| T-E5  | `isRetryable(AxiosError with status 404)` → `false`                                        |
| T-E6  | `isRetryable(AxiosError with status 422)` → `false`                                        |
| T-E7  | `isRetryable(AxiosError with status 429)` → `true`                                         |
| T-E8  | `isRetryable(AxiosError with status 500)` → `true`                                         |
| T-E9  | `isRetryable(AxiosError with status 503)` → `true`                                         |
| T-E10 | `isRetryable(AxiosError with no response — network error)` → `true`                        |
| T-E11 | `isRetryable(plain Error)` → `false`                                                       |
| T-E12 | `isRetryable(error with code 'ECONNRESET')` → `true`                                       |
| T-E13 | `isRetryable(error with code 'ETIMEDOUT')` → `true`                                        |
| T-E14 | `isRetryable(error with code 'ENOTFOUND')` → `true`                                        |

### AC6 — Unit tests for `ClickUpProvider.retryWithBackoff()` refactored behaviour

**Given** the refactored `retryWithBackoff()` is implemented
**When** tests run via `pnpm test`
**Then** `clickup.provider.spec.ts` covers the following new cases (add to existing tests if any exist, otherwise create):

| Test | Description                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-C1 | 4xx AxiosError → `retryWithBackoff` throws `PMProviderClientError` with correct `httpStatus`                                                                        |
| T-C2 | 4xx with `ECODE` in body → `PMProviderClientError.providerErrorCode` is set correctly                                                                               |
| T-C3 | 4xx with no `ECODE` in body → `PMProviderClientError.providerErrorCode` is `undefined`                                                                              |
| T-C4 | 4xx is NOT retried — operation called exactly once                                                                                                                  |
| T-C5 | 5xx → operation retried up to 3 attempts with exponential delays (**replaces** existing "should retry on 500 errors" test — update it to use `makeAxiosError(500)`) |
| T-C6 | 429 → operation retried (rate limit is transient)                                                                                                                   |
| T-C7 | Success on 2nd attempt after transient 5xx → returns result                                                                                                         |

### AC7 — TypeScript + lint clean

**Given** the implementation
**When** `pnpm typecheck` and `pnpm lint` run
**Then** zero errors on all CS3-1 modified files

## Tasks / Subtasks

- [x] **Task 1**: Create `PMProviderClientError` (AC1, AC2, AC5)
  - [x] Create `src/integrations/providers/pm-provider-client.error.ts`
  - [x] Implement class extending `Error` with `httpStatus`, `providerErrorCode`, `providerErrorBody`
  - [x] Implement static `isRetryable(error: unknown): boolean`
  - [x] Create `src/integrations/providers/pm-provider-client.error.spec.ts` with T-E1–T-E14

- [x] **Task 2**: Refactor `ClickUpProvider.retryWithBackoff()` (AC3, AC4, AC6)
  - [x] Import `PMProviderClientError` in `clickup.provider.ts`
  - [x] Replace inline 4xx check with `PMProviderClientError` wrapping + `isRetryable()` classification
  - [x] Update existing "should retry on 500 errors" test → replace `Object.assign(new Error('Server Error'), { response: { status: 500 } })` with `makeAxiosError(500)` — the refactored code uses `instanceof AxiosError`, plain Error objects will NOT match
  - [x] Update existing "should not retry on 404 errors" test → replace `Object.assign(new Error('Not Found'), { response: { status: 404 } })` with `makeAxiosError(404)` — same reason
  - [x] Replace the above two existing retry tests with T-C5/T-C4 equivalents (see AC6 table); T-C5 supersedes "should retry on 500 errors"
  - [x] Add remaining new tests T-C1–T-C7 to `clickup.provider.spec.ts`

- [x] **Task 3**: Export `PMProviderClientError` from `src/integrations/providers/index.ts`
  - [x] Add: `export { PMProviderClientError } from './pm-provider-client.error';`
  - [x] This barrel exists and currently exports `IPMProvider` and DTOs — add the new error class alongside them

- [x] **Task 4**: TypeScript + lint verification (AC7)
  - [x] `pnpm typecheck` — zero errors on CS3-1 modified files
  - [x] `pnpm lint` — zero warnings/errors on CS3-1 modified files
  - [x] `pnpm test -- --testPathPattern="pm-provider-client.error|clickup.provider"` — all tests pass

## Dev Notes

### What This Story Builds

CS3-1 is the foundation story of Epic CS3. It creates the typed error classification layer (`PMProviderClientError`) that downstream stories (CS3-2, CS3-3, CS3-4) rely on to:

- CS3-2: Set `pm_synced=false` when a `PMProviderClientError` is caught
- CS3-3: Use `providerErrorCode` + `providerErrorBody` in the actionable failure comment
- CS3-4: Surface the `SYNC_PENDING` amber state on the dashboard

**CS3-1 scope is limited:**

- New error class: `PMProviderClientError`
- Refactor `ClickUpProvider.retryWithBackoff()` to use it
- No changes to `DeploymentStatusSyncService` or any other consumer
- No Prisma schema changes (that is CS3-2)

### ⚠️ REGRESSION RISK: Existing Tests Use Plain `Error`, Not `AxiosError`

The current `retryWithBackoff()` uses `error as AxiosError` (unsafe type cast) — it accesses `.response.status` via cast on any error object. After refactoring, the code uses `error instanceof AxiosError` (real type guard).

**The existing retry tests in `clickup.provider.spec.ts` create errors like:**

```typescript
Object.assign(new Error('Server Error'), { response: { status: 500 } });
```

This is a **plain `Error`**, NOT an `AxiosError`. It will fail `instanceof AxiosError` → `isRetryable()` returns `false` → **the 500-error test will fail**.

**Fix (required in Task 2):** Replace both existing retry test error factories with `makeAxiosError()`:

```typescript
// Before (breaks after refactor):
const error = Object.assign(new Error('Server Error'), { response: { status: 500 } });

// After (correct):
const error = makeAxiosError(500);
```

Do this for both "should retry on 500 errors" and "should not retry on 404 errors" before running the test suite.

---

### Existing Pattern: `ClickUpProvider.retryWithBackoff()`

The current implementation (at `src/integrations/providers/clickup/clickup.provider.ts:329-359`) already has the 4xx/5xx split logic but it's inline and untested:

```typescript
// Don't retry on 4xx except 429
if (
  axiosError.response &&
  axiosError.response.status >= 400 &&
  axiosError.response.status < 500 &&
  axiosError.response.status !== 429
) {
  throw error; // ← throws raw AxiosError, loses provider error body
}
```

**CS3-1 changes this to** throw a typed `PMProviderClientError` instead of the raw `AxiosError`. This preserves the ClickUp `ECODE` from the response body which CS3-3 needs for the actionable comment.

### Reference Pattern: `AetherFlowClientService.isRetryableError()`

`src/integrations/aetherflow/aetherflow-client.service.ts` already implements an `isRetryableError()` private method with the same classification logic. Use it as a reference:

```typescript
private isRetryableError(error: Record<string, unknown>): boolean {
  if (error instanceof AxiosError) {
    const status = error.response?.status;
    if (!status) return true; // Network error
    if (status >= 500) return true; // Server error
    if (status === 429) return true;
    if (status >= 400 && status < 500) return false;
  }
  if (error.code === 'ECONNABORTED') return true;
  if (error.code === 'ETIMEDOUT') return true;
  if (error.code === 'ECONNREFUSED') return true;
  return false;
}
```

**CS3-1 extracts this logic as a static method on `PMProviderClientError`** so all providers share the same classification, not just ClickUp.

### ClickUp Error Body Shape

ClickUp API errors return JSON like:

```json
{ "ECODE": "OAUTH_017", "err": "Token not found" }
```

`providerErrorCode` should be extracted from `response.data.ECODE` (string or undefined).
`providerErrorBody` should be the full `response.data` for diagnostic purposes.

### Project Structure Notes

| File                                                          | Change Type            | Notes                                                                                      |
| ------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| `src/integrations/providers/pm-provider-client.error.ts`      | **NEW**                | `PMProviderClientError` class with static `isRetryable()`                                  |
| `src/integrations/providers/pm-provider-client.error.spec.ts` | **NEW**                | T-E1–T-E14 unit tests                                                                      |
| `src/integrations/providers/clickup/clickup.provider.ts`      | **MODIFY**             | Import `PMProviderClientError`; refactor `retryWithBackoff()` to wrap 4xx into typed error |
| `src/integrations/providers/clickup/clickup.provider.spec.ts` | **NEW or MODIFY**      | Add T-C1–T-C7                                                                              |
| `src/integrations/providers/index.ts`                         | **MODIFY (if exists)** | Add export for `PMProviderClientError`                                                     |

**Do NOT touch:**

- `src/github/services/deployment-status-sync.service.ts` — CS3-2/CS3-3 will handle consumers
- `src/integrations/integrations.module.ts` — no new providers to register (this is just an error class)
- `src/integrations/providers/pm-provider.interface.ts` — no interface changes needed
- `src/integrations/aetherflow/aetherflow-client.service.ts` — has its own `isRetryableError()`, do not consolidate in CS3-1 (out of scope)

### Architecture Compliance

- **`@/` path aliases**: All cross-directory imports use `@/` — never relative paths
- **`PMProviderClientError` extends `Error`**: NOT `HttpException` — this is an internal domain error for service-to-service propagation within DSF, not an HTTP response to a client
- **TypeScript strict**: All types explicit, no `any`
- **Static method pattern**: `isRetryable()` as `static` on the error class keeps classification co-located with the error type

### Previous Story Intelligence (from CS2-4)

From the previous Epic CS2 stories:

- `DeploymentStatusSyncService` (`src/github/services/deployment-status-sync.service.ts`) is the primary consumer of IPMProvider via `PMProviderFactory`
- The file currently has a graceful degradation pattern: sync errors are caught, logged, and execution continues — CS3-2 will change this to additionally set `pm_synced=false`
- `PMProviderFactory.getProvider(integration)` handles token refresh — no changes needed here
- `IntegrationsModule` is already imported in `GitHubModule` (added in CS2-2)
- Class was renamed to `DeploymentStatusSyncService` (from `DeploymentStatusSync`) in CS2-4

### Git Intelligence (Recent Commits)

1. `c013ed1 / f22683d` — `refactor: remove legacy CLICKUP_API_KEY usage and enforce OAuth-only integration` — CS1-7 scope, ClickUp credential transition. Shows pattern: `configService.get('clickup.apiKey')` usage and `@/` import aliases throughout
2. `e2e103b` — `rename DeploymentStatusSync → DeploymentStatusSyncService and add verification comment integration` — CS2-4. **Important**: class is now `DeploymentStatusSyncService` in `src/github/services/deployment-status-sync.service.ts`
3. `d914a79` — `implement AI-powered field inference and verification comment services` — CS2-3/CS2-4. Pattern: `PMProviderFactory.getProvider(integration)` + fail-open try/catch + `SentryService.captureException()`
4. `d1cf615` — `implement PMFieldAutoFillService with unit tests` — CS2-2. Pattern: service in `src/integrations/`, exported from `IntegrationsModule`, mock testing with `jest.fn()`
5. `5f1973c` — `add comprehensive unit tests and finalize PMFieldPreCheckService` — CS2-1. Shows NestJS unit test module setup pattern for integration services

**Key pattern established**: All CS-series services use `@Injectable()`, inject `PMProviderFactory` + `SentryService`, use `private readonly logger = new Logger(ClassName.name)`, and follow fail-open error handling.

### Testing AxiosError in Jest

To create mock AxiosErrors in tests:

```typescript
import { AxiosError } from 'axios';

function makeAxiosError(status: number, data?: unknown): AxiosError {
  const error = new AxiosError('Request failed');
  error.response = {
    status,
    data: data ?? {},
    headers: {},
    config: {} as any,
    statusText: String(status),
  };
  return error;
}

function makeNetworkError(code: string): AxiosError {
  const error = new AxiosError('Network error');
  error.code = code;
  // no error.response
  return error;
}
```

### References

- FR-CS14: IPMProvider 4xx non-retryable, 5xx retryable [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #FR-CS14]
- Story 3.1 acceptance criteria [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #Story-3.1]
- CS3-1 sprint entry [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml` #CS3-1-fix-4xx-5xx-classification]
- Existing retryWithBackoff (replace) [Source: `src/integrations/providers/clickup/clickup.provider.ts:329-359`]
- AetherFlow isRetryableError reference [Source: `src/integrations/aetherflow/aetherflow-client.service.ts`]
- IPMProvider interface [Source: `src/integrations/providers/pm-provider.interface.ts`]
- PMProviderFactory (token refresh pattern) [Source: `src/integrations/providers/pm-provider.factory.ts`]
- IntegrationsModule providers [Source: `src/integrations/integrations.module.ts`]
- DeploymentStatusSyncService (primary consumer — NOT modified in CS3-1) [Source: `src/github/services/deployment-status-sync.service.ts`]
- NFR-CS6: 4xx responses must never trigger retry [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #NFR-CS6]

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Code review (claude-sonnet-4-6, 2026-03-15): Fixed H1 (T-C2/T-C3 silent-pass tests — added `expect.assertions(1)`), H2 (`isRetryable` AxiosError 1xx/2xx/3xx fallthrough — added explicit `return false`), M2 (`body` null type assertion), M3 (`Object.setPrototypeOf` in constructor), M4 (documented 5xx exhausted-retry contract for CS3-2 callers). Low items deferred: makeAxiosError duplication (L1), delay verification in T-C5 (L2), comment wording (L3).

### File List

- [NEW] [pm-provider-client.error.ts](file:///src/integrations/providers/pm-provider-client.error.ts)
- [NEW] [pm-provider-client.error.spec.ts](file:///src/integrations/providers/pm-provider-client.error.spec.ts)
- [MODIFY] [clickup.provider.ts](file:///src/integrations/providers/clickup/clickup.provider.ts)
- [MODIFY] [clickup.provider.spec.ts](file:///src/integrations/providers/clickup/clickup.provider.spec.ts)
- [MODIFY] [index.ts](file:///src/integrations/providers/index.ts)
