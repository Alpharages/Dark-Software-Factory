# Story CS2.1: Required Field Pre-Check Before Status Push

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **DSF system**,
I want to identify empty required fields on a task before attempting a status update,
so that I know exactly what needs filling before the push.

## Acceptance Criteria

### AC1 — `PMFieldPreCheckService.checkRequiredFields()` signature and location

**Given** a resolved `ProjectIntegration`, a `taskId` (PM tool task ID, e.g. ClickUp task ID), and a `containerId` (list/board ID from `integration.provider_config.containerId`)
**When** `PMFieldPreCheckService.checkRequiredFields(integration, taskId, containerId)` is called
**Then** the service exists at `src/integrations/pm-field-pre-check.service.ts`
**And** returns `Promise<FieldPreCheckResult>`

### AC2 — Parallel API calls within 2 seconds

**Given** a valid integration, taskId, and containerId
**When** `checkRequiredFields()` runs
**Then** `IPMProvider.getRequiredFields(containerId)` and `IPMProvider.getTask(taskId)` are called in **parallel** via `Promise.all()`
**And** the combined operation completes within 2 seconds (NFR-CS2)
**And** a `debug` log is emitted: `[{correlationId}] CS2-1: pre-check for task {taskId} in container {containerId}: {n} required fields found, {m} missing`

### AC3 — Return type `FieldPreCheckResult`

**Given** the parallel calls succeed
**When** the result is built
**Then** the return value has shape:

```typescript
interface FieldPreCheckResult {
  missingFields: NormalizedField[]; // required fields with no current value
  allFilled: boolean; // true iff missingFields.length === 0
  preCheckFailed?: boolean; // true only on API error
}
```

**And** this interface is exported from `src/integrations/pm-field-pre-check.service.ts`

### AC4 — Missing field detection logic

**Given** `NormalizedTask.customFields?: Record<string, unknown>` returned by `getTask()`
**When** comparing required fields against task's current values
**Then** a field is considered **present** if `customFields?.[field.id]` is a non-null, non-undefined, non-empty-string, non-empty-array value
**And** a field is considered **missing** under any of these conditions:

- `customFields` is `undefined` (task has no custom fields)
- the key is absent from `customFields`
- the value is `null`
- the value is `undefined`
- the value is `''` (empty string)
- the value is `[]` (empty array — applies to `NormalizedFieldType.LABELS` fields with no labels selected)
  **And** `false` and `0` are **not** missing — they are valid values (unchecked checkbox, zero duration)
  **Note** `getRequiredFields()` already returns **only** `required: true` fields — do NOT add an additional `.filter(f => f.required)` on the result; it is redundant and will cause confusion with future providers

### AC5 — `allFilled` flag

**Given** all required fields have non-empty values in `customFields`
**When** the pre-check completes
**Then** `allFilled === true` and `missingFields` is an empty array `[]`

**Given** one or more required fields are missing
**When** the pre-check completes
**Then** `allFilled === false` and `missingFields` contains those fields

### AC6 — Fail-open on API error

**Given** either `getRequiredFields()` or `getTask()` throws any error
**When** `checkRequiredFields()` catches the error
**Then** the service logs a `warn`: `[{correlationId}] CS2-1: pre-check failed for task {taskId}: {error.message} — failing open (status push will proceed)`
**And** the error is captured in Sentry
**And** returns `{ missingFields: [], allFilled: true, preCheckFailed: true }` — **never throws**

### AC7 — Exported from `IntegrationsModule`

**Given** `PMFieldPreCheckService` is implemented
**When** `IntegrationsModule` is configured
**Then** `PMFieldPreCheckService` is in the `providers` array of `IntegrationsModule`
**And** `PMFieldPreCheckService` is in the `exports` array of `IntegrationsModule`

### AC8 — `containerId` extraction helper

**Given** a `ProjectIntegration` record where `provider_config.containerId` may or may not be set
**When** `checkRequiredFields()` receives a `containerId` parameter
**Then** the caller is responsible for extracting it from `provider_config` before calling
**And** if `containerId` is empty or undefined, the service returns `{ missingFields: [], allFilled: true, preCheckFailed: true }` with a `warn` log: `[{correlationId}] CS2-1: containerId not configured for integration {integration.id} — skipping pre-check`

### AC9 — Unit tests (minimum coverage)

**Given** the service is implemented
**When** tests run via `pnpm test`
**Then** `pm-field-pre-check.service.spec.ts` exists alongside the service file
**And** covers (mapped to ACs):

- **T1 → AC5**: `allFilled: true`, `missingFields: []` when all required fields have values
- **T2 → AC4**: `missingFields` includes field when value is `null`
- **T3 → AC4**: `missingFields` includes field when value is `undefined`
- **T4 → AC4**: `missingFields` includes field when value is `''` (empty string)
- **T5 → AC4**: `missingFields` includes field when value is `[]` (empty array — LABELS)
- **T6 → AC4**: field NOT in `missingFields` when value is `false` (valid checkbox value)
- **T7 → AC4**: field NOT in `missingFields` when value is `0` (valid number value)
- **T8 → AC4**: `missingFields` includes field when key is absent from `customFields`
- **T9 → AC4**: all fields missing when `customFields` is `undefined`
- **T10 → AC2**: `Promise.all` called — both `getRequiredFields` and `getTask` invoked in parallel
- **T11 → AC6**: fail-open + `sentry.captureException` when `getRequiredFields()` throws
- **T12 → AC6**: fail-open + `sentry.captureException` when `getTask()` throws
- **T13 → AC8**: fail-open (no provider call) when `containerId` is empty string

### AC10 — TypeScript + lint clean

**Given** the implementation
**When** `pnpm typecheck` and `pnpm lint` run
**Then** zero errors on all CS2-1 files

---

## Tasks / Subtasks

- [ ] **Task 1**: Create `FieldPreCheckResult` interface and `PMFieldPreCheckService` (AC1, AC2, AC3)
  - [ ] Create file `src/integrations/pm-field-pre-check.service.ts`
  - [ ] Export `FieldPreCheckResult` interface from the same file
  - [ ] Inject `PMProviderFactory` and `SentryService` (follow `BotAssignmentService` constructor pattern)
  - [ ] Use `private readonly logger = new Logger(PMFieldPreCheckService.name)` (NestJS Logger, not LoggerService)
  - [ ] Implement `checkRequiredFields(integration: ProjectIntegration, taskId: string, containerId: string, correlationId: string): Promise<FieldPreCheckResult>`

- [ ] **Task 2**: Implement missing-field detection logic (AC4, AC5)
  - [ ] Call `Promise.all([provider.getRequiredFields(containerId), provider.getTask(taskId)])`
  - [ ] For each field in `requiredFields` (already filtered to required=true — no additional filter needed), check `task.customFields?.[field.id]` using optional chaining
  - [ ] Missing conditions: absent key, `null`, `undefined`, `''`, or `[]` (empty array for LABELS)
  - [ ] Present (not missing): `false`, `0`, any non-empty string/number/array
  - [ ] Build `missingFields` array and set `allFilled = missingFields.length === 0`

- [ ] **Task 3**: Implement fail-open and empty-containerId guard (AC6, AC8)
  - [ ] Early-return guard: if `!containerId` → warn + return fail-open result
  - [ ] Wrap `Promise.all` in try/catch → warn + Sentry + return fail-open result

- [ ] **Task 4**: Register in `IntegrationsModule` (AC7)
  - [ ] Add `PMFieldPreCheckService` to `providers: [...]` in `src/integrations/integrations.module.ts`
  - [ ] Add `PMFieldPreCheckService` to `exports: [...]` in `src/integrations/integrations.module.ts`

- [ ] **Task 5**: Write unit tests (AC9)
  - [ ] Create `src/integrations/pm-field-pre-check.service.spec.ts`
  - [ ] Mock `PMProviderFactory.getProvider()` to return a mock `IPMProvider`
  - [ ] Mock `SentryService.captureException()`
  - [ ] Cover all 13 test cases T1–T13 mapped in AC9

- [ ] **Task 6**: TypeScript + lint verification (AC10)
  - [ ] `pnpm typecheck` — zero errors on CS2-1 files
  - [ ] `pnpm lint` — zero warnings/errors
  - [ ] `pnpm test -- --testPathPattern="pm-field-pre-check"` — all tests pass

---

## Dev Notes

### What This Story Builds

`PMFieldPreCheckService` is a pure **query service** — it reads field definitions and current task values from the PM provider, compares them, and returns a structured result. It makes **no mutations**. Future stories (CS2-2, CS2-3, CS2-4) consume its result to perform auto-fill and post verification comments.

This service will be called **before** any status push — the insertion point in the execution pipeline is scoped to CS2-2/CS2-3, not this story. CS2-1 only builds the service; the integration into the execution flow happens when auto-fill stories are implemented.

### Pattern to Follow: `BotAssignmentService`

`BotAssignmentService` (`src/integrations/bot-assignment.service.ts`) is the canonical pattern for CS2-1:

- **Constructor**: inject `PMProviderFactory` and `SentryService` (no `PrismaService` needed for CS2-1 since we receive `integration` directly)
- **Error handling**: never rethrows — catches, logs, captures in Sentry, returns graceful result
- **Logger**: `private readonly logger = new Logger(PMFieldPreCheckService.name)` (NestJS `Logger` from `@nestjs/common`, NOT `LoggerService`)
- **Correlation prefix**: all log messages prefixed `[{correlationId}] CS2-1: ...`

```typescript
// Required imports (BotAssignmentService pattern — src/integrations/bot-assignment.service.ts)
import { Injectable, Logger } from '@nestjs/common'; // @Injectable() is required — do not omit
import { ProjectIntegration } from '@prisma/client';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { SentryService } from '@/common/sentry/sentry.service';
import { NormalizedField } from '@/integrations/providers/dto/normalized-field.dto';

// PMProviderFactory is injected by class type — no @Inject() string token needed:
// constructor(private readonly providerFactory: PMProviderFactory, ...) {}
```

### `PMProviderFactory.getProvider()` Usage

```typescript
// getProvider() MUST be awaited first — it is async (handles OAuth token refresh)
// Do NOT put getProvider() inside Promise.all — it must complete before the provider calls start
const provider = await this.providerFactory.getProvider(integration); // step 1: await this
const [requiredFields, task] = await Promise.all([
  // step 2: then parallel
  provider.getRequiredFields(containerId),
  provider.getTask(taskId),
]);
```

**Critical**: `getProvider()` is `async` and handles OAuth token refresh internally. It must be `await`ed as a separate step before constructing the `Promise.all`. Putting it inside the array would cause a type error and bypass token refresh.

### `NormalizedTask.customFields` Shape

```typescript
// From src/integrations/providers/dto/normalized-task.dto.ts
customFields?: Record<string, unknown>; // keyed by field ID
```

**How ClickUp populates this** (`clickup.provider.ts:268`):

```typescript
customFields: task.custom_fields?.reduce<Record<string, unknown>>((acc, f) => {
  acc[f.id] = f.value; // f.value is null when field is unset in ClickUp
  return acc;
}, {});
```

`customFields` is `undefined` (not `{}`) when `task.custom_fields` is absent — the optional chaining `?.reduce` returns `undefined`. **Always use `?.` when accessing `customFields`.**

**Missing detection — complete helper:**

```typescript
function isFieldMissing(
  customFields: Record<string, unknown> | undefined,
  fieldId: string,
): boolean {
  if (!customFields) return true; // entire map absent
  const val = customFields[fieldId]; // no need for ?. here — customFields is defined
  if (val === undefined || val === null || val === '') return true;
  if (Array.isArray(val) && val.length === 0) return true; // empty LABELS field
  return false;
}
```

**Valid falsy values that are NOT missing**: `false` (unchecked checkbox), `0` (numeric zero). Do not use a truthy check — it would incorrectly flag these as missing.

### `containerId` Source

`containerId` is stored in `integration.provider_config.containerId` (camelCase). Callers extract it before calling `checkRequiredFields()`:

```typescript
// How callers will extract it (informational — not implemented in CS2-1):
const cfg = integration.provider_config as Record<string, unknown> | null;
const containerId = typeof cfg?.containerId === 'string' ? cfg.containerId : '';
```

The service **validates** that `containerId` is non-empty and returns fail-open early if not. It does NOT do the extraction itself.

### `FieldPreCheckResult` Interface

```typescript
// Export this from pm-field-pre-check.service.ts
export interface FieldPreCheckResult {
  missingFields: NormalizedField[];
  allFilled: boolean;
  preCheckFailed?: boolean;
}
```

`NormalizedField` is imported from `@/integrations/providers/dto/normalized-field.dto`:

```typescript
export class NormalizedField {
  id!: string;
  name!: string;
  type!: NormalizedFieldType; // text, number, date, dropdown, labels, user, checkbox, url, other
  required!: boolean;
  options?: NormalizedFieldOption[];
  description?: string;
}
```

### `IntegrationsModule` Update

Add to both `providers` and `exports` arrays in `src/integrations/integrations.module.ts`:

```typescript
// BEFORE (line 17–23):
providers: [
  ProjectIntegrationService,
  ClickUpOAuthService,
  PMProviderFactory,
  PMStatusService,
  BotAssignmentService,
],
exports: [
  ProjectIntegrationService,
  ClickUpOAuthService,
  PMProviderFactory,
  PMStatusService,
  BotAssignmentService,
],

// AFTER (CS2-1):
providers: [
  ProjectIntegrationService,
  ClickUpOAuthService,
  PMProviderFactory,
  PMStatusService,
  BotAssignmentService,
  PMFieldPreCheckService,    // ADD
],
exports: [
  ProjectIntegrationService,
  ClickUpOAuthService,
  PMProviderFactory,
  PMStatusService,
  BotAssignmentService,
  PMFieldPreCheckService,    // ADD
],
```

### `PMStatusService` as Secondary Precedent

See `src/integrations/pm-status.service.ts` for another example of the module-pattern. **Key difference from CS2-1**: `PMStatusService` caches results; `PMFieldPreCheckService` does NOT — pre-checks always need fresh data from the PM tool. Do not add caching.

### Fail-Open Constant — Avoid Object Literal Duplication

Two code paths return the same fail-open result (empty-containerId guard + catch block). Define it as a static constant to avoid duplicating the literal and ensure both paths return an identical shape:

```typescript
private static readonly FAIL_OPEN: FieldPreCheckResult = {
  missingFields: [],
  allFilled: true,
  preCheckFailed: true,
};
```

Use `return PMFieldPreCheckService.FAIL_OPEN;` in both guard and catch. This also makes test assertions cleaner.

### NFR-CS2 — 2-Second Budget and `retryWithBackoff`

NFR-CS2 requires the pre-check to complete within 2 seconds. The `ClickUpProvider` wraps all API calls in `retryWithBackoff` (3 attempts: 1s, 2s, 4s delays on 5xx). On a 5xx error, the combined retry time can reach ~7 seconds — exceeding the budget. **Do not add a timeout wrapper** — this is a "sunny day" expectation. The fail-open behavior in AC6 ensures that even a slow/failing API call eventually results in a graceful return. CS2-1 does not implement circuit breaking; that is out of scope.

### `SentryService.captureException()` Pattern

```typescript
this.sentry.captureException(error as Error);
```

No extra metadata needed — keep it simple. `SentryModule` is already imported in `IntegrationsModule`; no module change needed.

### Project Structure Notes

| File                                                  | Change Type | Notes                                               |
| ----------------------------------------------------- | ----------- | --------------------------------------------------- |
| `src/integrations/pm-field-pre-check.service.ts`      | **NEW**     | Main service + `FieldPreCheckResult` interface      |
| `src/integrations/pm-field-pre-check.service.spec.ts` | **NEW**     | Unit tests                                          |
| `src/integrations/integrations.module.ts`             | **MODIFY**  | Add `PMFieldPreCheckService` to providers + exports |

**Do NOT touch:**

- `src/integrations/providers/pm-provider.interface.ts` — `getRequiredFields` and `getTask` already exist
- `src/integrations/providers/dto/normalized-field.dto.ts` — `NormalizedField` already complete
- `src/integrations/providers/clickup/clickup.provider.ts` — `getRequiredFields` already implemented (line 170)
- `src/integrations/pm-status.service.ts` — separate concern, no changes needed
- `src/integrations/bot-assignment.service.ts` — no changes needed
- Any execution consumer — the hook-in point is CS2-2/CS2-3 scope

### Testing Approach

Use `Test.createTestingModule` with mock providers (follow `BotAssignmentService` spec pattern):

```typescript
const mockProvider = {
  getRequiredFields: jest.fn(),
  getTask: jest.fn(),
};
// PMProviderFactory injected by class type — useValue mock is sufficient, no @Inject token
const mockProviderFactory = {
  getProvider: jest.fn().mockResolvedValue(mockProvider),
};
const mockSentry = { captureException: jest.fn() };

const module = await Test.createTestingModule({
  providers: [
    PMFieldPreCheckService,
    { provide: PMProviderFactory, useValue: mockProviderFactory },
    { provide: SentryService, useValue: mockSentry },
  ],
}).compile();
const service = module.get(PMFieldPreCheckService);
```

All 13 test cases (T1–T13) are defined in AC9 with AC mappings. Key setup notes:

- Set up a `requiredField` fixture: `{ id: 'f1', name: 'Estimate', type: NormalizedFieldType.NUMBER, required: true }`
- For each test, configure `mockProvider.getRequiredFields.mockResolvedValue([requiredField])` and `mockProvider.getTask.mockResolvedValue({ customFields: { f1: <value> } })`
- For `customFields` absent tests: `mockProvider.getTask.mockResolvedValue({ customFields: undefined })`
- For throw tests: `mockProvider.getRequiredFields.mockRejectedValue(new Error('API down'))`
- T8 (absent key): `mockProvider.getTask.mockResolvedValue({ customFields: {} })` — `f1` key not present
- T10 (parallel): spy on both `getRequiredFields` and `getTask` and assert both were called once per `checkRequiredFields` invocation

### Prometheus Metrics (Not in CS2-1 Scope)

No new Prometheus counters are added in this story. Future stories may add `pm_field_pre_check_missing_total` or similar.

### Architecture Compliance

- **`@/` path aliases**: All imports use `@/` (never relative paths for cross-directory)
- **NestJS `Logger`**: Use `new Logger(PMFieldPreCheckService.name)` — NOT `LoggerService`
- **`SentryService`**: Inject from `@/common/sentry/sentry.service` — always in `SentryModule`
- **`SentryModule`** is already imported in `IntegrationsModule` — no new module import needed
- **TypeScript strict**: `NormalizedField[]`, `FieldPreCheckResult` must be fully typed — no `any`
- **Never throws**: catch all errors, return fail-open result

### Previous Story Intelligence (from CS1-7)

From CS1-7 (`clickup-credential-transition`):

- **Module import pattern**: `@/` path aliases everywhere
- **Error handling**: errors are logged + Sentry-captured, never rethrown
- **`AppMetricsModule` + `LoggerModule` are leaf modules** — `IntegrationsModule` already has `SentryModule`
- **Test mock pattern**: `{ provide: SentryService, useValue: { captureException: jest.fn() } }` is established

From CS1-5 (`BotAssignmentService`):

- `BotAssignmentService` is the direct structural precedent for `PMFieldPreCheckService`
- Same constructor injection pattern: `PMProviderFactory` + `SentryService` (+ `PrismaService` if DB lookups needed — CS2-1 has none)
- Same try/catch → log + Sentry + return pattern

### Git Intelligence (Recent Commits)

1. `1d70c54` — `StartupChecksService` added — confirms `src/common/startup/` pattern for lifecycle hooks
2. `d31bb7c` — `DevelopmentGateService` — new service in `src/ticket-intake/` following same Logger + SentryService pattern
3. `eb3d381` — `BotAssignmentService` — **direct template for CS2-1** — same file location pattern in `src/integrations/`

### References

- FR-CS8: IPMProvider.getRequiredFields() pre-check [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #FR-CS8]
- FR-CS9: IPMProvider.getTask() field value cross-reference [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #FR-CS9]
- NFR-CS2: Pre-check must complete within 2 seconds [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #NFR-CS2]
- Story 2.1 BDD acceptance criteria [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #Story-2.1]
- CS2-1 sprint entry [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml` #CS2-1-required-field-pre-check]
- `IPMProvider.getRequiredFields()` signature [Source: `src/integrations/providers/pm-provider.interface.ts:31`]
- `IPMProvider.getTask()` signature [Source: `src/integrations/providers/pm-provider.interface.ts:19`]
- `NormalizedField` type [Source: `src/integrations/providers/dto/normalized-field.dto.ts`]
- `NormalizedTask.customFields` shape [Source: `src/integrations/providers/dto/normalized-task.dto.ts:12`]
- `BotAssignmentService` (structural template) [Source: `src/integrations/bot-assignment.service.ts`]
- `PMStatusService` (service-in-module pattern) [Source: `src/integrations/pm-status.service.ts`]
- `IntegrationsModule` providers/exports [Source: `src/integrations/integrations.module.ts:17-30`]
- `PMProviderFactory.getProvider()` is async — handles token refresh [Source: `src/integrations/providers/pm-provider.factory.ts`]
- `ClickUpProvider.getRequiredFields()` implementation [Source: `src/integrations/providers/clickup/clickup.provider.ts:170`]
- `ClickUpProvider.getTask()` implementation [Source: `src/integrations/providers/clickup/clickup.provider.ts:135`]
- `container_id` stored in `provider_config.containerId` [Source: `src/projects/project.controller.ts:260-265`]
- `SentryService.captureException()` mock pattern [Source: `src/integrations/bot-assignment.service.spec.ts`]

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `src/integrations/pm-field-pre-check.service.ts` — NEW: `PMFieldPreCheckService` + `FieldPreCheckResult` interface (AC1–AC8)
- `src/integrations/pm-field-pre-check.service.spec.ts` — NEW: unit tests (AC9)
- `src/integrations/integrations.module.ts` — MODIFY: add `PMFieldPreCheckService` to providers + exports (AC7)
