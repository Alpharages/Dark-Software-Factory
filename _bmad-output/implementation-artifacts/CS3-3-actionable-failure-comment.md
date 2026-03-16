# Story CS3.3: Post Actionable Failure Comment on PM Tool Task

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **PM**,
I want a clear comment on my task whenever DSF cannot update its status,
so that I know exactly what happened and what I need to do manually.

## Acceptance Criteria

### AC1 — New `PMActionableFailureCommentService`

**Given** a PM tool status push fails permanently (after all retries or on a 4xx)
**When** the failure is handled
**Then** `PMActionableFailureCommentService.postActionableFailureComment(integration, taskId, context, correlationId)` posts a comment via `IPMProvider.addComment()` containing:

- Confirmation that DSF completed its work
- The target status DSF was trying to set
- The specific failure reason (from `PMProviderClientError` body, or generic string if soft failure)
- Provider error code if available (e.g. ClickUp `ECODE`)
- Numbered manual steps for the PM
- Any fields still requiring manual input (from `lastMissingFields`, if available)

**And** `PMActionableFailureCommentService` is `@Injectable()`, located at `src/integrations/pm-actionable-failure-comment.service.ts`
**And** it accepts `ProjectIntegration | null` — when `null`, it logs at debug level and returns immediately without throwing

---

### AC2 — Comment format

**Given** the failure comment is generated
**When** `buildComment()` is called
**Then** the comment text matches this structure (conditional lines are omitted entirely when the condition is false — never render `undefined`/`null`):

```
🚨 DSF Sync Failure — Action Required

DSF has completed development on this task but could not update the status in the PM tool.

**Target Status:** [targetStatus]
**Failure Reason:** [failureReason]
[ONLY IF context.providerErrorCode is truthy:]
**Provider Error Code:** [providerErrorCode]
[ONLY IF extractProviderMessage(providerErrorBody) returns a string:]
**Provider Message:** "[verbatim string]"

**Manual Steps:**
1. Open this task in your PM tool
2. Manually update the status to: [targetStatus]
[ONLY IF missingFields.length > 0:]
3. Fill in the following required fields:
   • [field.name] (type: [field.type])

This task is marked as "Sync Pending" on the DSF dashboard.
```

---

### AC3 — Soft failure path integration in `DeploymentStatusSyncService`

**Given** `ClickUpService.updateStatus()` returns `false` (the existing soft failure path)
**When** the `if (!statusUpdated)` block is reached
**Then** `pmActionableFailureCommentService.postActionableFailureComment()` is called with:

- `integration`: the scoped `integration` variable (may be `null` if CS2 pipeline failed open)
- `taskId`: `ticketId` (local `const` = `execution.ticket.clickup_task_id`)
- `context.targetStatus`: `clickUpStatus`
- `context.failureReason`: `'ClickUp status update returned false — graceful degradation'`
- `context.missingFields`: `lastMissingFields` (scoped `NormalizedField[]`, populated from pre-check if CS2 ran; empty array otherwise)
- `correlationId`: `finalCorrelationId`
  **And** the call is wrapped in best-effort try/catch — must NOT throw or block the `return`
  **And** `return` happens AFTER the comment attempt

---

### AC4 — Exception path integration in `DeploymentStatusSyncService`

**Given** the outer `catch (_error)` block is reached
**When** `ticketClickupId` is defined AND `integration` is not null
**Then** `pmActionableFailureCommentService.postActionableFailureComment()` is called with:

- `integration`: scoped `integration` variable
- `taskId`: `ticketClickupId` (scoped `let` — same value as `ticketId` but accessible in catch)
- `context.targetStatus`: `targetStatus ?? 'unknown'` (scoped `let`, assigned from `clickUpStatus`)
- `context.failureReason`: `(_error as Error).message`
- `context.providerErrorCode`: `(_error instanceof PMProviderClientError) ? _error.providerErrorCode : undefined`
- `context.providerErrorBody`: `(_error instanceof PMProviderClientError) ? _error.providerErrorBody : undefined`
- `context.missingFields`: `[]` (no pre-check context available in exception path)
- `correlationId`: `finalCorrelationId`
  **And** the call is wrapped in best-effort try/catch — must NOT throw or affect existing Sentry/metrics recording
  **And** if `ticketClickupId` is undefined OR `integration` is null, the call is silently skipped

---

### AC5 — Comment failure is fully best-effort

**Given** `IPMProvider.addComment()` throws any error during the failure comment
**When** the error is caught inside `postActionableFailureComment()`
**Then** it is logged at `warn` level: `[correlationId] CS3-3: failed to post actionable failure comment for task [taskId]: [message]`
**And** `SentryService.captureException()` is called with the error
**And** no exception propagates from `postActionableFailureComment()`
**And** `pm_synced` state is NOT affected — it was already set to `false` by CS3-2 before this call

---

### AC6 — Scoped variables in `DeploymentStatusSyncService`

**Given** the CS2 pipeline currently declares `const integration` inside its own try block
**When** CS3-3 is implemented
**Then** the following variables are declared **before** the outer try block (alongside existing `ticketInternalId`/`ticketClickupId`):

```typescript
let integration: ProjectIntegration | null = null; // ← new
let targetStatus: string | undefined; // ← new
let lastMissingFields: NormalizedField[] = []; // ← new
let ticketInternalId: string | undefined; // existing (CS3-2)
let ticketClickupId: string | undefined; // existing (CS3-2)
```

**And** inside the CS2 try block: `const integration = ...` → `integration = ...` (remove `const`)
**And** inside the CS2 pre-check block: after `preCheckResult` is computed, add `lastMissingFields = preCheckResult.missingFields;`
**And** after `const clickUpStatus = ...` is computed: `targetStatus = clickUpStatus;`

---

### AC7 — Module registration

**Given** the new service is implemented
**When** `IntegrationsModule` is inspected
**Then** `PMActionableFailureCommentService` is listed in both `providers` and `exports` arrays
**And** `DeploymentStatusSyncService` constructor receives the new service injected

---

### AC8 — Unit tests for `PMActionableFailureCommentService`

**Given** the service is implemented
**When** `pnpm test` runs
**Then** `pm-actionable-failure-comment.service.spec.ts` covers:

| Test   | Description                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------ |
| T-AF1  | `null` integration → returns immediately, `provider.addComment()` never called                   |
| T-AF2  | Successful comment: `provider.addComment()` called with correctly formatted text                 |
| T-AF3  | Comment body contains `targetStatus` value                                                       |
| T-AF4  | Comment body contains `failureReason` value                                                      |
| T-AF5  | Comment includes `**Provider Error Code:**` line when `providerErrorCode` is truthy              |
| T-AF6  | Comment does NOT include `**Provider Error Code:**` line when `providerErrorCode` is `undefined` |
| T-AF7  | Comment includes `**Provider Message:**` line with verbatim `err` from `providerErrorBody`       |
| T-AF8  | Comment includes manual step 3 with field names when `missingFields` is non-empty                |
| T-AF9  | Comment does NOT include step 3 when `missingFields` is empty                                    |
| T-AF10 | `addComment()` throws → error caught, Sentry notified, no throw from service                     |
| T-AF11 | `providerFactory.getProvider()` throws → error caught, Sentry notified, no throw                 |

---

### AC9 — Updated tests in `DeploymentStatusSyncService` spec

**Given** the integration in `DeploymentStatusSyncService`
**When** `pnpm test -- --testPathPattern="deployment-status-sync"` runs
**Then** all existing tests continue to pass
**And** new tests are added:

| Test  | Description                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-FC1 | Soft failure: `postActionableFailureComment` called when `updateStatus` returns `false` (requires `findFirstByProject` mock returning a non-null `mockIntegration`) |
| T-FC2 | Soft failure: `context.targetStatus` is `'Deployed'` for a `COMPLETED` deployment                                                                                   |
| T-FC3 | Soft failure: comment call throws → caught silently, method still returns without throwing                                                                          |
| T-FC4 | Exception path: `postActionableFailureComment` called when outer catch fires AND `ticketClickupId` is known AND `integration` is non-null                           |
| T-FC5 | Exception path: comment skipped when `ticketClickupId` is undefined                                                                                                 |
| T-FC6 | Exception path: comment skipped when `integration` is null                                                                                                          |
| T-FC7 | Exception path with `PMProviderClientError`: `providerErrorCode` and `providerErrorBody` passed through to context                                                  |

---

### AC10 — TypeScript + lint clean

**Given** the implementation
**When** `pnpm typecheck` and `pnpm lint` run
**Then** zero errors on all CS3-3 modified files
**And** no `any` introduced without an `// eslint-disable-next-line` with justification
**And** all imports use `@/` path aliases — no relative `../../` paths

---

## Tasks / Subtasks

- [x] **Task 1**: Create `PMActionableFailureCommentService` (AC1, AC2, AC5)
  - [x] Create `src/integrations/pm-actionable-failure-comment.service.ts`
  - [x] Import `ProjectIntegration` from `@/prisma/client`
  - [x] Import `NormalizedField` from `@/integrations/providers/dto/normalized-field.dto`
  - [x] Import `PMProviderFactory` from `@/integrations/providers/pm-provider.factory`
  - [x] Import `SentryService` from `@/common/sentry/sentry.service`
  - [x] Export `ActionableFailureContext` interface (see Dev Notes for definition — use `NormalizedField[]` for `missingFields`)
  - [x] Declare `@Injectable()` class with `Logger`, inject `PMProviderFactory` and `SentryService`
  - [x] Implement `postActionableFailureComment(integration: ProjectIntegration | null, taskId: string, context: ActionableFailureContext, correlationId: string): Promise<void>`
  - [x] Guard: if `integration` is null → `logger.debug(...)` + `return`
  - [x] Implement `private buildComment(context: ActionableFailureContext): string` following the template in AC2
  - [x] Implement `private extractProviderMessage(body: unknown): string | undefined` (see Dev Notes for implementation)
  - [x] In `buildComment()`: only include `**Provider Error Code:**` line if `context.providerErrorCode` is truthy; only include `**Provider Message:**` line if `extractProviderMessage(context.providerErrorBody)` returns a string; only include step 3 if `context.missingFields?.length > 0`

- [x] **Task 2**: Create unit tests for `PMActionableFailureCommentService` (AC8)
  - [x] Create `src/integrations/pm-actionable-failure-comment.service.spec.ts`
  - [x] Mock `PMProviderFactory`: `{ getProvider: jest.fn().mockResolvedValue({ addComment: jest.fn().mockResolvedValue(undefined) }) }`
  - [x] Mock `SentryService`: `{ captureException: jest.fn() }`
  - [x] Use `const mockIntegration = { id: 'int-001', provider: 'CLICKUP' } as unknown as ProjectIntegration` for tests that need a non-null integration
  - [x] Add T-AF1 through T-AF11

- [x] **Task 3**: Register in `IntegrationsModule` (AC7)
  - [x] Import `PMActionableFailureCommentService` in `integrations.module.ts`
  - [x] Add to `providers` array
  - [x] Add to `exports` array

- [x] **Task 4**: Scope variables in `DeploymentStatusSyncService` (AC6)
  - [x] **Fix import**: change `import { DeploymentStatus } from '@/prisma/client';` → `import { DeploymentStatus, ProjectIntegration } from '@/prisma/client';`
  - [x] Import `NormalizedField` from `@/integrations/providers/dto/normalized-field.dto`
  - [x] Declare before the outer `try` block (alongside existing `ticketInternalId`/`ticketClickupId`):
    ```typescript
    let integration: ProjectIntegration | null = null;
    let targetStatus: string | undefined;
    let lastMissingFields: NormalizedField[] = [];
    ```
  - [x] Inside CS2 try block (line ~151): change `const integration = await ...` → `integration = await ...`
  - [x] Inside the `if (!preCheckResult.allFilled && preCheckResult.missingFields.length > 0)` block: add `lastMissingFields = preCheckResult.missingFields;` after `preCheckResult` is evaluated
  - [x] After `const clickUpStatus = ...` computation (~line 265): add `targetStatus = clickUpStatus;`

- [x] **Task 5**: Inject `PMActionableFailureCommentService` into `DeploymentStatusSyncService` (AC3, AC4)
  - [x] Add import: `import { PMProviderClientError } from '@/integrations/providers/pm-provider-client.error';`
  - [x] Add import: `import { PMActionableFailureCommentService, ActionableFailureContext } from '@/integrations/pm-actionable-failure-comment.service';`
  - [x] Add to constructor: `private readonly pmActionableFailureCommentService: PMActionableFailureCommentService`
  - [x] **Soft failure path** — add AFTER `recordPmSyncFailedAuditLog()`, BEFORE `return`:
    ```typescript
    // CS3-3: Post actionable failure comment (best-effort)
    try {
      await this.pmActionableFailureCommentService.postActionableFailureComment(
        integration,
        ticketId,
        {
          targetStatus: clickUpStatus,
          failureReason: 'ClickUp status update returned false — graceful degradation',
          missingFields: lastMissingFields,
        },
        finalCorrelationId,
      );
    } catch (_commentErr) {
      this.logger.warn(
        `[${finalCorrelationId}] CS3-3: unexpected error in failure comment block (soft failure path)`,
      );
    }
    return;
    ```
  - [x] **Exception path** — add AFTER the `if (ticketInternalId) { pm_synced=false + audit }` block:
    ```typescript
    // CS3-3: Post actionable failure comment (best-effort, exception path)
    if (ticketClickupId && integration) {
      try {
        const isProviderError = _error instanceof PMProviderClientError;
        await this.pmActionableFailureCommentService.postActionableFailureComment(
          integration,
          ticketClickupId,
          {
            targetStatus: targetStatus ?? 'unknown',
            failureReason: (_error as Error).message,
            providerErrorCode: isProviderError
              ? (_error as PMProviderClientError).providerErrorCode
              : undefined,
            providerErrorBody: isProviderError
              ? (_error as PMProviderClientError).providerErrorBody
              : undefined,
            missingFields: [],
          },
          finalCorrelationId,
        );
      } catch (_fcErr) {
        this.logger.warn(
          `[${finalCorrelationId}] CS3-3: unexpected error in failure comment block (exception path)`,
        );
      }
    }
    ```

- [x] **Task 6**: Update `DeploymentStatusSyncService` spec (AC9)
  - [x] Import `PMActionableFailureCommentService` at top of spec file
  - [x] Add to `TestingModule` providers in `beforeEach`:
    ```typescript
    {
      provide: PMActionableFailureCommentService,
      useValue: { postActionableFailureComment: jest.fn().mockResolvedValue(undefined) },
    }
    ```
  - [x] Resolve service variable: `pmActionableFailureCommentService = module.get(PMActionableFailureCommentService);`
  - [x] For T-FC1/T-FC2/T-FC3: configure `integrationService.findFirstByProject` to return `mockIntegration` (a minimal non-null object). Without this, `integration` stays `null` and the comment call is silently skipped — the test would pass vacuously. Example:
    ```typescript
    const mockIntegration = { id: 'int-001', provider: 'CLICKUP' } as unknown as ProjectIntegration;
    (integrationService.findFirstByProject as jest.Mock).mockResolvedValue(mockIntegration);
    ```
  - [x] Add T-FC1 through T-FC7

- [x] **Task 7**: TypeScript + lint verification (AC10)
  - [x] `pnpm typecheck` — zero errors on all CS3-3 modified files
  - [x] `pnpm lint` — zero warnings on all CS3-3 modified files
  - [x] `pnpm test -- --testPathPattern="pm-actionable-failure-comment|deployment-status-sync"` — all tests pass

---

## Dev Notes

### What This Story Builds

CS3-3 adds the actionable failure comment that fires on every permanent PM sync failure. Epic CS3 chain:

- **CS3-1** (done): `PMProviderClientError` with `providerErrorCode` + `providerErrorBody` — used here for rich error context
- **CS3-2** (done): `pm_synced=false` on `Ticket` — CS3-3 fires AFTER CS3-2 sets the flag; this comment is best-effort and does NOT affect `pm_synced`
- **CS3-3** (this story): Post the actionable comment via `IPMProvider.addComment()`
- **CS3-4** (next): Dashboard SYNC_PENDING amber state + Socket.IO event

### New Service: `PMActionableFailureCommentService`

Follows the exact structure of `PMVerificationCommentService` (`src/integrations/pm-verification-comment.service.ts`). Reference it directly when building this service — same constructor pattern, same try/catch around `addComment`, same Sentry capture.

### `ActionableFailureContext` Interface

```typescript
import { NormalizedField } from '@/integrations/providers/dto/normalized-field.dto';

export interface ActionableFailureContext {
  targetStatus: string;
  failureReason: string;
  providerErrorCode?: string;
  providerErrorBody?: unknown;
  missingFields?: NormalizedField[]; // NormalizedField, NOT Array<{name,type}>
}
```

`NormalizedField` (from `normalized-field.dto.ts`) has: `id`, `name`, `type` (enum `NormalizedFieldType`), `required`, `options?`, `description?`. In `buildComment()`, render `field.type` in a template literal — TypeScript enum values coerce to string automatically.

### `extractProviderMessage()` Helper

ClickUp API errors have shape `{ ECODE: "OAUTH_017", err: "Token not found" }`. Extract the verbatim message for the comment:

```typescript
private extractProviderMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.err === 'string') return b.err;
  if (typeof b.message === 'string') return b.message;
  return undefined;
}
```

Only include the `**Provider Message:**` line in the comment when this returns a non-undefined string.

### Variable Naming: `ticketId` vs `ticketClickupId`

Both hold `execution.ticket.clickup_task_id` (the ClickUp external task ID). They differ only in scope:

- `ticketId` — local `const` declared inside the main try block (in scope during soft failure path)
- `ticketClickupId` — scoped `let` declared before the try block (accessible in the outer catch)

Use `ticketId` in the soft failure path; use `ticketClickupId` in the exception path. This is intentional — do not consolidate them.

### `lastMissingFields` Placement in CS2 Block

The `preCheckResult` is computed inside the `if (integration)` block inside the CS2 try. Assign `lastMissingFields` immediately after evaluation:

```typescript
if (integration) {
  const preCheckResult = await this.pmPreCheckService.checkRequiredFields(...);
  lastMissingFields = preCheckResult.missingFields;  // ← add this line

  if (!preCheckResult.allFilled && preCheckResult.missingFields.length > 0) {
    // ... existing auto-fill pipeline ...
  }
}
```

This means the soft failure comment will list actual unfilled required fields if the pre-check ran successfully. If the CS2 pipeline failed open (caught by the outer CS2 catch), `lastMissingFields` stays `[]`.

### Soft Failure Path — Insertion Order

Inside `if (!statusUpdated)` block, complete order after CS3-3:

1. `recordMetrics(...)` — existing
2. `recordAuditLog(...)` — existing
3. `prisma.ticket.update({ pm_synced: false })` — CS3-2
4. `recordPmSyncFailedAuditLog(...)` — CS3-2
5. ✅ `pmActionableFailureCommentService.postActionableFailureComment(...)` — **CS3-3**
6. `return` — existing

### Exception Path — Insertion Order

Inside outer `catch (_error)` block, complete order after CS3-3:

1. `logger.error(...)` — existing
2. `sentry.captureException(...)` — existing
3. `recordMetrics(...)` — existing
4. `if (ticketInternalId) { pm_synced=false + audit }` — CS3-2
5. ✅ `if (ticketClickupId && integration) { failure comment }` — **CS3-3**

### Comment Does NOT Include Deep Link

FR-CS15 mentions "deep link to ClickUp task" — DSF stores only the `clickup_task_id` string, not a full URL. Do NOT fabricate a URL. Omit the deep link entirely.

### Project Structure Notes

| File                                                             | Change Type | Notes                                                                        |
| ---------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| `src/integrations/pm-actionable-failure-comment.service.ts`      | **NEW**     | `PMActionableFailureCommentService` + `ActionableFailureContext` interface   |
| `src/integrations/pm-actionable-failure-comment.service.spec.ts` | **NEW**     | T-AF1–T-AF11 unit tests                                                      |
| `src/integrations/integrations.module.ts`                        | **MODIFY**  | Add to providers + exports                                                   |
| `src/github/services/deployment-status-sync.service.ts`          | **MODIFY**  | Fix `ProjectIntegration` import; scope vars; inject service; add CS3-3 calls |
| `src/github/services/deployment-status-sync.service.spec.ts`     | **MODIFY**  | Mock new service; add T-FC1–T-FC7                                            |

**Do NOT touch:**

- `src/integrations/providers/pm-provider-client.error.ts` — CS3-1 (done)
- `src/integrations/providers/clickup/clickup.provider.ts` — CS3-1 (done)
- `prisma/schema.prisma` — CS3-2 (done, `pm_synced` exists)
- Any CS3-4 features (dashboard, Socket.IO, SYNC_PENDING)
- `src/github/github.module.ts` — `IntegrationsModule` already imported (CS2-2)

### Architecture Compliance

- **`@/` path aliases** — no relative `../../` paths
- **Fail-open** — both failure comment calls in try/catch, never block main path
- **TypeScript strict** — `ProjectIntegration | null` explicit union; `NormalizedField[]` aligned with CS2 types
- **Private methods** — `buildComment()` and `extractProviderMessage()` are private, same as `PMVerificationCommentService`
- **Service placement** — `src/integrations/` for all PM provider services

### Previous Story Intelligence (CS3-2)

- `ticketInternalId` and `ticketClickupId` already scoped before outer try (CS3-2)
- Outer catch already sets `pm_synced=false` + audit before CS3-3 comment call
- `PMVerificationCommentService` already injected — CS3-3 follows the identical pattern
- `IntegrationsModule` already exports `PMVerificationCommentService`
- `ProjectIntegration` is NOT currently imported in `deployment-status-sync.service.ts` — must add

### References

- FR-CS15: Actionable failure comment [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #FR-CS15]
- Story 3.3 ACs [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #Story-3.3]
- DeploymentStatusSyncService [Source: `src/github/services/deployment-status-sync.service.ts`]
- DeploymentStatusSyncService spec [Source: `src/github/services/deployment-status-sync.service.spec.ts`]
- PMVerificationCommentService (reference pattern) [Source: `src/integrations/pm-verification-comment.service.ts`]
- IntegrationsModule [Source: `src/integrations/integrations.module.ts`]
- PMProviderClientError [Source: `src/integrations/providers/pm-provider-client.error.ts`]
- NormalizedField DTO [Source: `src/integrations/providers/dto/normalized-field.dto.ts`]
- IPMProvider.addComment() [Source: `src/integrations/providers/pm-provider.interface.ts`]

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### File List

- `src/integrations/pm-actionable-failure-comment.service.ts`
- `src/integrations/pm-actionable-failure-comment.service.spec.ts`
- `src/integrations/integrations.module.ts`
- `src/github/services/deployment-status-sync.service.ts`
- `src/github/services/deployment-status-sync.service.spec.ts`

### Completion Notes List

- Implemented `PMActionableFailureCommentService` with markdown template matching AC2.
- Integrated service into `DeploymentStatusSyncService` soft and hard failure paths.
- Fixed logic error in exception path guard (requires `integration` now).
- Removed `any` casts in favor of type-safe `instanceof PMProviderClientError` checks.
- Added missing integration tests T-FC1 through T-FC7.
- Verified zero type/lint errors and 100% test pass rate.
