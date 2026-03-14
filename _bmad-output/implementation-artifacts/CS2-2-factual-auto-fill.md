# Story CS2.2: Auto-Fill Factual Fields from DSF Execution Data

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **DSF system**,
I want to automatically populate PM tool fields where I have exact data from the execution record,
so that required fields are filled without AI inference or human intervention.

## Acceptance Criteria

### AC1 — `PMFieldAutoFillService.fillFactualFields()` signature and location

**Given** a resolved `ProjectIntegration`, a `taskId` (PM tool task ID), a `missingFields: NormalizedField[]` list from CS2-1, and an `executionContext: ExecutionContext`
**When** `PMFieldAutoFillService.fillFactualFields(integration, taskId, missingFields, executionContext, correlationId)` is called
**Then** the service exists at `src/integrations/pm-field-auto-fill.service.ts`
**And** returns `Promise<FactualFillResult>`
**And** a `debug` log is emitted: `[{correlationId}] CS2-2: factual fill for task {taskId}: {n} missing fields, {m} filled, {k} remaining`

### AC2 — `ExecutionContext` interface

**Given** the service is called from `DeploymentStatusSyncService.syncToClickUp()`
**When** the execution context is assembled before calling `fillFactualFields`
**Then** the `ExecutionContext` interface is exported from `src/integrations/pm-field-auto-fill.service.ts` with the following shape:

```typescript
export interface ExecutionContext {
  executionDurationMinutes?: number; // computed: (completed_at - started_at) / 60000 — undefined if either timestamp is null
  deployedAt?: Date | null; // Deployment.deployed_at
  prUrl?: string | null; // GitHubPush.pr_url
  branchName?: string | null; // GitHubPush.branch_name
}
```

### AC3 — `FactualFillResult` return type

**Given** `fillFactualFields()` completes (successfully or partially)
**When** the result is returned
**Then** it has the shape:

```typescript
export interface FactualFillResult {
  filledFields: Array<{ field: NormalizedField; value: FieldValue; source: string }>;
  remainingFields: NormalizedField[]; // fields with no matching factual pattern OR context value absent
  fillFailed?: boolean; // true only if a setFieldValue() call threw
}
```

### AC4 — Duration fill rule

**Given** a missing field where `field.type === NormalizedFieldType.NUMBER` AND `field.name` matches `/time|duration|estimate/i`
**When** `executionContext.executionDurationMinutes` is a defined, finite number
**Then** `IPMProvider.setFieldValue(taskId, field.id, executionDurationMinutes)` is called
**And** the field is added to `filledFields` with `source: 'execution_duration'`

**Given** the same field type/name match but `executionContext.executionDurationMinutes` is `undefined` or `NaN`
**Then** the field is added to `remainingFields` (no provider call)

### AC5 — Deployed-at date fill rule

**Given** a missing field where `field.type === NormalizedFieldType.DATE` AND `field.name` matches `/completion|deployed|done/i`
**When** `executionContext.deployedAt` is a non-null `Date`
**Then** `IPMProvider.setFieldValue(taskId, field.id, deployedAt.getTime())` is called (Unix milliseconds as a `number`)
**And** the field is added to `filledFields` with `source: 'deployed_at'`

**Given** `executionContext.deployedAt` is `null` or `undefined`
**Then** the field is added to `remainingFields`

### AC6 — PR URL fill rule

**Given** a missing field where `field.type` is `NormalizedFieldType.URL` **or** `NormalizedFieldType.TEXT` AND `field.name` matches `/pr|pull[\s_-]?request/i` (case-insensitive)
**When** `executionContext.prUrl` is a non-null, non-empty string
**Then** `IPMProvider.setFieldValue(taskId, field.id, prUrl)` is called
**And** the field is added to `filledFields` with `source: 'pr_url'`

**Given** `executionContext.prUrl` is `null`, `undefined`, or empty string
**Then** the field is added to `remainingFields`

### AC7 — Branch name fill rule

**Given** a missing field where `field.type === NormalizedFieldType.TEXT` AND `field.name` matches `/branch/i`
**When** `executionContext.branchName` is a non-null, non-empty string
**Then** `IPMProvider.setFieldValue(taskId, field.id, branchName)` is called
**And** the field is added to `filledFields` with `source: 'branch_name'`

**Given** `executionContext.branchName` is `null`, `undefined`, or empty string
**Then** the field is added to `remainingFields`

### AC8 — No-match fields go to `remainingFields`

**Given** a missing field that matches none of the patterns in AC4–AC7 (wrong type, non-matching name, or matching name but absent context value)
**When** `fillFactualFields` processes it
**Then** the field is added to `remainingFields` and no `setFieldValue()` call is made for it

### AC9 — `setFieldValue()` calls are sequential (not parallel)

**Given** multiple fields are matched
**When** `setFieldValue()` is called for each
**Then** the calls are made sequentially (not `Promise.all`) so that a failure in one does not cancel in-flight requests to the provider

### AC10 — Fail-partial on `setFieldValue()` error

**Given** `IPMProvider.setFieldValue()` throws for any matched field
**When** the error is caught
**Then** the service logs a `warn`: `[{correlationId}] CS2-2: setFieldValue failed for field {field.id} ({field.name}): {error.message} — adding to remainingFields`
**And** `sentry.captureException()` is called
**And** the failed field is added to `remainingFields` (not `filledFields`)
**And** processing continues for subsequent fields — the method **never throws**
**And** `fillFailed: true` is set in the result if at least one `setFieldValue()` failed

### AC11 — Empty `missingFields` fast-path

**Given** `missingFields` is an empty array
**When** `fillFactualFields()` is called
**Then** it immediately returns `{ filledFields: [], remainingFields: [], fillFailed: undefined }` without calling the provider

### AC12 — `PMFieldAutoFillService` exported from `IntegrationsModule`

**Given** `PMFieldAutoFillService` is implemented
**When** `IntegrationsModule` is configured
**Then** `PMFieldAutoFillService` is in the `providers` array of `src/integrations/integrations.module.ts`
**And** `PMFieldAutoFillService` is in the `exports` array of `src/integrations/integrations.module.ts`

### AC13 — Pipeline wired into `DeploymentStatusSyncService`

**Given** `DeploymentStatusSyncService.syncToClickUp()` is called for any deployment status (COMPLETED, FAILED, ROLLED_BACK, IN_PROGRESS)
**When** a `ProjectIntegration` exists for the ticket's project
**And** `containerId` is set in `integration.provider_config.containerId`
**Then** the following pipeline runs before `this.clickUp.updateStatus()`:

1. `PMFieldPreCheckService.checkRequiredFields(integration, ticketId, containerId, correlationId)` is called
2. If `preCheckResult.allFilled === false`, `PMFieldAutoFillService.fillFactualFields(integration, ticketId, preCheckResult.missingFields, executionContext, correlationId)` is called
3. The existing `this.clickUp.updateStatus()` call runs regardless of pre-check / fill results (fail-open)

**Given** no `ProjectIntegration` exists for the ticket's project
**When** `syncToClickUp()` runs
**Then** the pre-check + auto-fill pipeline is skipped entirely (no error, no log beyond `debug`)

**Given** `containerId` is empty or not set in `provider_config`
**Then** the pipeline is skipped (pre-check service handles the guard internally — AC8 of CS2-1)

### AC14 — `executionContext` populated from available Prisma data

**Given** `DeploymentStatusSyncService.syncToClickUp()` builds the `executionContext`
**When** the pipeline runs
**Then** the context is assembled as:

```typescript
const executionDurationMinutes =
  execution.started_at && execution.completed_at
    ? (execution.completed_at.getTime() - execution.started_at.getTime()) / 60000
    : undefined;

const ctx: ExecutionContext = {
  executionDurationMinutes:
    executionDurationMinutes !== undefined && isFinite(executionDurationMinutes)
      ? executionDurationMinutes
      : undefined,
  deployedAt: typedDeployment.deployed_at,
  prUrl: typedDeployment.github_push.pr_url,
  branchName: typedDeployment.github_push.branch_name,
};
```

**And** the Prisma query for `execution` includes `started_at` and `completed_at` fields
**And** the Prisma `select` for `github_push` includes `branch_name`

### AC15 — `IntegrationsModule` added to `GitHubModule` imports

**Given** `DeploymentStatusSyncService` now depends on `PMFieldPreCheckService` and `PMFieldAutoFillService`
**When** the `GitHubModule` is loaded
**Then** `IntegrationsModule` is in the `imports` array of `src/github/github.module.ts`
**And** no circular dependency warning appears on startup (`IntegrationsModule` does not import `GitHubModule`)

### AC16 — Unit tests (minimum coverage)

**Given** the service is implemented
**When** tests run via `pnpm test`
**Then** `pm-field-auto-fill.service.spec.ts` exists alongside the service file and covers:

| Test       | AC                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------- |
| T1 → AC4   | Fills `number/estimate` field with `executionDurationMinutes`                                  |
| T2 → AC4   | Leaves `number/estimate` in `remainingFields` when `executionDurationMinutes` is `undefined`   |
| T3 → AC5   | Fills `date/deployed` field with `deployedAt.getTime()` (Unix ms)                              |
| T4 → AC5   | Leaves `date/deployed` in `remainingFields` when `deployedAt` is `null`                        |
| T5 → AC6   | Fills `url/pr_url` field with `prUrl`                                                          |
| T6 → AC6   | Fills `text/pr` field with `prUrl` (text type also matches)                                    |
| T7 → AC6   | Leaves PR field in `remainingFields` when `prUrl` is `null`                                    |
| T8 → AC7   | Fills `text/branch` field with `branchName`                                                    |
| T9 → AC7   | Leaves branch field in `remainingFields` when `branchName` is empty string                     |
| T10 → AC8  | Unknown field type/name goes to `remainingFields`, no `setFieldValue` call                     |
| T11 → AC10 | `setFieldValue` throws → `warn` log + Sentry + field in `remainingFields` + `fillFailed: true` |
| T12 → AC10 | Failure on first field does not prevent processing subsequent fields                           |
| T13 → AC11 | Empty `missingFields` returns immediately, no provider calls                                   |
| T14 → AC9  | Sequential execution: second field not processed until first `setFieldValue` resolves          |

**And** `deployment-status-sync.service.spec.ts` is updated to cover:

| Test   | Description                                                                                  |
| ------ | -------------------------------------------------------------------------------------------- |
| T-DSS1 | When `findFirstByProject` returns `null`, `checkRequiredFields` is NOT called                |
| T-DSS2 | When integration exists and `allFilled === false`, `fillFactualFields` IS called             |
| T-DSS3 | When the pipeline block throws unexpectedly, `clickUp.updateStatus()` still runs (fail-open) |

### AC17 — TypeScript + lint clean

**Given** the implementation
**When** `pnpm typecheck` and `pnpm lint` run
**Then** zero errors on all CS2-2 files

---

## Tasks / Subtasks

- [ ] **Task 1**: Create `PMFieldAutoFillService` with interfaces (AC1, AC2, AC3)
  - [ ] Create `src/integrations/pm-field-auto-fill.service.ts`
  - [ ] Export `ExecutionContext`, `FactualFillResult` interfaces from the same file
  - [ ] Inject `PMProviderFactory` and `SentryService` (BotAssignmentService constructor pattern)
  - [ ] Use `private readonly logger = new Logger(PMFieldAutoFillService.name)`
  - [ ] Implement `fillFactualFields(integration, taskId, missingFields, executionContext, correlationId): Promise<FactualFillResult>`

- [ ] **Task 2**: Implement the four fill rules (AC4–AC8)
  - [ ] Define a private `matchAndFill()` helper or inline matching per field
  - [ ] Rule: `NUMBER` + `/time|duration|estimate/i` → `executionDurationMinutes` (number)
  - [ ] Rule: `DATE` + `/completion|deployed|done/i` → `deployedAt.getTime()` (Unix ms number)
  - [ ] Rule: `URL|TEXT` + `/pr|pull[\s_-]?request/i` → `prUrl` (string)
  - [ ] Rule: `TEXT` + `/branch/i` → `branchName` (string)
  - [ ] All other fields → `remainingFields`

- [ ] **Task 3**: Implement sequential execution + partial-fail handling (AC9, AC10, AC11)
  - [ ] `for...of` loop over matched fields (not `Promise.all`)
  - [ ] Each `setFieldValue` in its own try/catch → warn + Sentry + push to `remainingFields`, set `fillFailed = true`
  - [ ] Early return for empty `missingFields`

- [ ] **Task 4**: Register in `IntegrationsModule` (AC12)
  - [ ] Add `PMFieldAutoFillService` to `providers: [...]`
  - [ ] Add `PMFieldAutoFillService` to `exports: [...]`

- [ ] **Task 5**: Wire pipeline into `DeploymentStatusSyncService` (AC13, AC14, AC15)
  - [ ] Add `IntegrationsModule` to `GitHubModule` imports array (`src/github/github.module.ts`) — plain import, NO `forwardRef` (see module dep note below)
  - [ ] Inject `ProjectIntegrationService`, `PMFieldPreCheckService`, `PMFieldAutoFillService` into `DeploymentStatusSync` constructor
  - [ ] Expand `github_push` select to include `branch_name` in the Prisma query
  - [ ] Update `typedDeployment.github_push` type assertion to include `branch_name: string`
  - [ ] Access `execution.started_at` and `execution.completed_at` via type assertion (already returned by `include: { ticket: true }`)
  - [ ] Add pre-check + auto-fill pipeline block before `this.clickUp.updateStatus()` (fail-open: wrap in try/catch, status push must never be blocked)
  - [ ] Update `deployment-status-sync.service.spec.ts`: add 3 mock providers, add `branch_name` + `project_id` to mock fixtures, add T-DSS1/T-DSS2/T-DSS3 tests (AC16)

- [ ] **Task 6**: Write unit tests for `PMFieldAutoFillService` (AC16)
  - [ ] Create `src/integrations/pm-field-auto-fill.service.spec.ts`
  - [ ] Mock `PMProviderFactory.getProvider()` → mock `IPMProvider`
  - [ ] Mock `SentryService.captureException()`
  - [ ] Cover all 14 test cases T1–T14

- [ ] **Task 7**: TypeScript + lint verification (AC17)
  - [ ] `pnpm typecheck` — zero errors on CS2-2 files
  - [ ] `pnpm lint` — zero warnings/errors
  - [ ] `pnpm test -- --testPathPattern="pm-field-auto-fill"` — all tests pass

---

## Dev Notes

### What This Story Builds

CS2-2 has **two deliverables**:

1. **`PMFieldAutoFillService`** — a pure mutation service that calls `IPMProvider.setFieldValue()` for each factual field it can fill, and returns which fields it filled vs. which remain for AI inference.
2. **Pipeline wiring** — modify `DeploymentStatusSyncService.syncToClickUp()` to call CS2-1's `PMFieldPreCheckService` + CS2-2's `PMFieldAutoFillService` before the existing `clickUp.updateStatus()` call. This is the first time the CS2 services actually run in the execution flow.

CS2-3 (AI-inferred fill) will consume `FactualFillResult.remainingFields` and is NOT in this story's scope.

### Pattern: `BotAssignmentService` as structural template

`src/integrations/bot-assignment.service.ts` is the canonical pattern:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ProjectIntegration } from '@prisma/client';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { SentryService } from '@/common/sentry/sentry.service';
import {
  NormalizedField,
  NormalizedFieldType,
  FieldValue,
} from '@/integrations/providers/dto/normalized-field.dto';

@Injectable()
export class PMFieldAutoFillService {
  private readonly logger = new Logger(PMFieldAutoFillService.name);

  constructor(
    private readonly providerFactory: PMProviderFactory,
    private readonly sentry: SentryService,
  ) {}
}
```

**Critical**: `PMProviderFactory` is injected by class type — no `@Inject()` string token needed.

### `PMProviderFactory.getProvider()` — must be awaited first

```typescript
// CORRECT: await getProvider() FIRST, then call provider methods
const provider = await this.providerFactory.getProvider(integration); // step 1: handles token refresh
// step 2: now make provider calls
await provider.setFieldValue(taskId, field.id, value);
```

`getProvider()` is `async` and handles OAuth token refresh internally. Never put it inside `Promise.all` — it must complete as a separate step.

### Field Matching Pattern Implementation

```typescript
private matchField(field: NormalizedField, ctx: ExecutionContext): { value: FieldValue; source: string } | null {
  const name = field.name.toLowerCase();

  if (field.type === NormalizedFieldType.NUMBER && /time|duration|estimate/.test(name)) {
    if (ctx.executionDurationMinutes !== undefined && isFinite(ctx.executionDurationMinutes)) {
      return { value: ctx.executionDurationMinutes, source: 'execution_duration' };
    }
    return null;
  }

  if (field.type === NormalizedFieldType.DATE && /completion|deployed|done/.test(name)) {
    if (ctx.deployedAt) {
      return { value: ctx.deployedAt.getTime(), source: 'deployed_at' };
    }
    return null;
  }

  if (
    (field.type === NormalizedFieldType.URL || field.type === NormalizedFieldType.TEXT) &&
    /pr|pull[\s_-]?request/.test(name)
  ) {
    if (ctx.prUrl) {
      return { value: ctx.prUrl, source: 'pr_url' };
    }
    return null;
  }

  if (field.type === NormalizedFieldType.TEXT && /branch/.test(name)) {
    if (ctx.branchName) {
      return { value: ctx.branchName, source: 'branch_name' };
    }
    return null;
  }

  return null; // no match
}
```

**Note**: Regex flags are not needed in `.test()` because `name` is already `.toLowerCase()`.

The two `null` return paths from `matchField()` have different semantics: (1) no pattern match at all — field not recognized as a factual type; (2) pattern matched but context value absent — field is a known factual type but DSF doesn't have the data this time. Both result in `remainingFields`. Optionally log a `debug` for case (2) to aid future debugging:

```typescript
// Inside matchField(), after pattern matched but no ctx value:
this.logger.debug(
  `[${correlationId}] CS2-2: field "${field.name}" matches pattern but context value is absent — skipping`,
);
return null;
```

### Sequential Fill Loop with Partial Fail

```typescript
const filledFields: Array<{ field: NormalizedField; value: FieldValue; source: string }> = [];
const remainingFields: NormalizedField[] = [];
let fillFailed: boolean | undefined;

for (const field of missingFields) {
  const match = this.matchField(field, executionContext);
  if (!match) {
    remainingFields.push(field);
    continue;
  }
  try {
    await provider.setFieldValue(taskId, field.id, match.value);
    filledFields.push({ field, value: match.value, source: match.source });
  } catch (error) {
    this.logger.warn(
      `[${correlationId}] CS2-2: setFieldValue failed for field ${field.id} (${field.name}): ${(error as Error).message} — adding to remainingFields`,
    );
    this.sentry.captureException(error as Error);
    remainingFields.push(field);
    fillFailed = true;
  }
}
```

### `DeploymentStatusSyncService` Modification Pattern

The full pipeline block to insert **before** `this.clickUp.updateStatus()` (after `execution` and `typedDeployment` are fetched):

```typescript
// CS2-2: Pre-check + factual auto-fill pipeline
const integration = await this.integrationService.findFirstByProject(execution.ticket.project_id);
if (integration) {
  const cfg = integration.provider_config as Record<string, unknown> | null;
  const containerId = typeof cfg?.containerId === 'string' ? cfg.containerId : '';

  const preCheckResult = await this.pmPreCheckService.checkRequiredFields(
    integration,
    ticketId,
    containerId,
    finalCorrelationId,
  );

  if (!preCheckResult.allFilled && preCheckResult.missingFields.length > 0) {
    const execStarted = (execution as Record<string, unknown>).started_at as Date | null;
    const execCompleted = (execution as Record<string, unknown>).completed_at as Date | null;
    const durationMs =
      execStarted && execCompleted ? execCompleted.getTime() - execStarted.getTime() : undefined;

    const ctx: ExecutionContext = {
      executionDurationMinutes:
        durationMs !== undefined && isFinite(durationMs) ? durationMs / 60000 : undefined,
      deployedAt: typedDeployment.deployed_at,
      prUrl: typedDeployment.github_push.pr_url,
      branchName: typedDeployment.github_push.branch_name,
    };

    await this.pmAutoFillService.fillFactualFields(
      integration,
      ticketId,
      preCheckResult.missingFields,
      ctx,
      finalCorrelationId,
    );
  }
}
// Existing status push continues below...
```

**Note**: Wrap the whole block in a `try/catch` to ensure the status push is never blocked by pre-check/fill failures (both services are already fail-open internally, but an unexpected error should not halt deployment sync).

### Prisma Query Change in `DeploymentStatusSyncService`

**Only one Prisma query change is needed** — add `branch_name` to the `github_push` select (line ~62):

```typescript
// BEFORE:
github_push: {
  select: {
    id: true, commit_sha: true, pr_url: true, pr_number: true,
    repository: true, execution_id: true, error_message: true,
  },
},

// AFTER (CS2-2 — only change):
github_push: {
  select: {
    id: true, commit_sha: true, pr_url: true, pr_number: true,
    repository: true, branch_name: true,   // ADD
    execution_id: true, error_message: true,
  },
},
```

Also update the `typedDeployment.github_push` type assertion block (line ~86) to add `branch_name: string`.

**No change to the `execution` query** — `include: { ticket: true }` already returns all scalar `Execution` fields including `started_at` and `completed_at`. Access them via type assertion (see "Execution `started_at`/`completed_at` Access" section above).

### `IntegrationsModule` → `GitHubModule` Import

```typescript
// src/github/github.module.ts — ADD to imports array:
import { IntegrationsModule } from '../integrations/integrations.module';

// In @Module imports — plain import, NO forwardRef:
IntegrationsModule,  // provides PMFieldPreCheckService, PMFieldAutoFillService, ProjectIntegrationService
```

**Module dependency notes — read carefully:**

- `IntegrationsModule` and `ClickUpModule` already have a **pre-existing mutual `forwardRef()` cycle**: `IntegrationsModule` uses `forwardRef(() => ClickUpModule)` and `ClickUpModule` uses `forwardRef(() => IntegrationsModule)`. Do NOT disturb this.
- `GitHubModule → IntegrationsModule` is a **new one-way dependency** — `IntegrationsModule` does NOT import `GitHubModule`, so there is NO cycle. Use a plain import (no `forwardRef`).
- `GitHubModule` already imports `ClickUpModule` directly and `IntegrationsModule` uses `forwardRef(() => ClickUpModule)` internally — NestJS handles this correctly via its IoC container. No action needed.

### `DeploymentStatusSync` Constructor Additions

```typescript
// ADD to existing constructor:
import { ProjectIntegrationService } from '@/integrations/project-integration.service';
import { PMFieldPreCheckService } from '@/integrations/pm-field-pre-check.service';
import { PMFieldAutoFillService, ExecutionContext } from '@/integrations/pm-field-auto-fill.service';

constructor(
  private readonly prisma: PrismaService,
  private readonly clickUp: ClickUpService,
  private readonly metrics: MetricsService,
  private readonly auditLog: AuditLogService,
  private readonly sentry: SentryService,
  private readonly integrationService: ProjectIntegrationService,   // ADD
  private readonly pmPreCheckService: PMFieldPreCheckService,        // ADD
  private readonly pmAutoFillService: PMFieldAutoFillService,        // ADD
) {}
```

### `deployment-status-sync.service.spec.ts` — Required Updates

The existing spec (`src/github/services/deployment-status-sync.service.spec.ts`) sets up `DeploymentStatusSync` with exactly 5 providers. Adding 3 new constructor deps will break the module compilation in tests. **These changes are mandatory — the spec will fail to compile otherwise.**

**1. Add 3 mock providers to `beforeEach` providers array:**

```typescript
{
  provide: ProjectIntegrationService,
  // Default: null → pipeline skips, existing tests continue to pass unchanged
  useValue: { findFirstByProject: jest.fn().mockResolvedValue(null) },
},
{
  provide: PMFieldPreCheckService,
  useValue: { checkRequiredFields: jest.fn() },
},
{
  provide: PMFieldAutoFillService,
  useValue: { fillFactualFields: jest.fn() },
},
```

**2. Update `mockDeployment.github_push` fixture — add `branch_name`:**

```typescript
github_push: {
  id: 'push-456',
  commit_sha: 'abc123def456',
  pr_url: 'https://github.com/org/repo/pull/42',
  pr_number: 42,
  repository: 'org/repo',
  branch_name: 'feature/test-branch',   // ADD
  execution_id: 'exec-789',
  error_message: null,
},
```

**3. Update `mockExecution.ticket` fixture — add `project_id`:**

```typescript
const mockExecution = {
  id: 'exec-789',
  ticket_id: 'ticket-001',
  started_at: new Date('2025-12-08T11:50:00Z'), // ADD
  completed_at: new Date('2025-12-08T12:00:00Z'), // ADD
  ticket: {
    clickup_task_id: 'clickup-123',
    project_id: 'project-001', // ADD
  },
};
```

**4. Add T-DSS1/T-DSS2/T-DSS3 tests** (see AC16 above).

---

### Execution `started_at` / `completed_at` Access

`prisma.execution.findUnique({ include: { ticket: true } })` returns all scalar `Execution` fields including `started_at` and `completed_at` — **no Prisma query change needed**. However, the existing code uses an implicit `any` cast on `execution`. Access the timing fields with a targeted type assertion:

```typescript
// After the existing: const execution = await this.prisma.execution.findUnique(...)
// Access timing fields:
const execWithTiming = execution as typeof execution & {
  started_at: Date | null;
  completed_at: Date | null;
};
const durationMs =
  execWithTiming?.started_at && execWithTiming?.completed_at
    ? execWithTiming.completed_at.getTime() - execWithTiming.started_at.getTime()
    : undefined;
```

This avoids touching the Prisma query and keeps the type system clean.

---

### Out-of-Scope Clarification

**Sprint notes say:** "Auto-fill factual fields: execution duration → Estimated Time, PR link, **start/end dates, commit count**."

The sprint-status.yaml entry is an aspirational planning note. The **authoritative spec** is `epics-clickup-smart-sync.md` Story 2.2, which defines exactly **4 fill rules** (duration, deployed_at, PR URL, branch). The following are explicitly **NOT** implemented in CS2-2:

- **Start date field fill** — not in Story 2.2 ACs
- **Commit count field fill** — not in Story 2.2 ACs; no commit count is stored on `Execution` or `GitHubPush`
- **Dropdown option_id mapping for factual fields** — all 4 factual fill types are number/date/url/text; dropdown mapping is CS2-3 (AI-inferred) scope per FR-CS12

Do not implement these extras. CS2-3 picks up remaining fields.

---

### Testing Approach for `PMFieldAutoFillService`

```typescript
const mockProvider = {
  setFieldValue: jest.fn().mockResolvedValue(undefined),
};
const mockProviderFactory = {
  getProvider: jest.fn().mockResolvedValue(mockProvider),
};
const mockSentry = { captureException: jest.fn() };

const module = await Test.createTestingModule({
  providers: [
    PMFieldAutoFillService,
    { provide: PMProviderFactory, useValue: mockProviderFactory },
    { provide: SentryService, useValue: mockSentry },
  ],
}).compile();
const service = module.get(PMFieldAutoFillService);

// Example test fixture:
const durationField: NormalizedField = {
  id: 'f-duration',
  name: 'Time Estimate',
  type: NormalizedFieldType.NUMBER,
  required: true,
};

const ctx: ExecutionContext = {
  executionDurationMinutes: 45,
  deployedAt: new Date('2026-03-14T12:00:00Z'),
  prUrl: 'https://github.com/org/repo/pull/123',
  branchName: 'feature/CS2-2-factual-fill',
};
```

**T14 (sequential execution)**: Verify with `jest.spyOn` that `setFieldValue` calls are ordered — the second call should not start until the first `await` resolves. Use `jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('fail'))` on two different fields and verify both are processed.

### `FieldValue` Type for `setFieldValue()`

```typescript
// From src/integrations/providers/dto/normalized-field.dto.ts:
export type FieldValue = string | number | boolean | string[] | null;
```

- `executionDurationMinutes` → `number` ✓
- `deployedAt.getTime()` → `number` ✓
- `prUrl` → `string` ✓
- `branchName` → `string` ✓

All factual fill values are valid `FieldValue` types.

### Prometheus Metrics (Not in CS2-2 Scope)

No new Prometheus counters in this story. A future story may add:

- `pm_fields_auto_filled_total{source="execution_duration|deployed_at|pr_url|branch_name"}`
- `pm_fields_remaining_after_factual_fill_total`

### Architecture Compliance

- **`@/` path aliases**: All imports use `@/` (never relative paths for cross-directory)
- **NestJS `Logger`**: Use `new Logger(PMFieldAutoFillService.name)` — NOT `LoggerService`
- **`SentryService`**: Inject from `@/common/sentry/sentry.service`
- **TypeScript strict**: All types explicit — `NormalizedField[]`, `FactualFillResult`, `FieldValue` — no `any`
- **Never throws**: catch errors in `fillFactualFields`, return `fillFailed: true`
- **Fail-open pipeline**: `DeploymentStatusSyncService` must continue to push status even if pre-check or fill throws unexpectedly

### Project Structure Notes

| File                                                         | Change Type | Notes                                                                                             |
| ------------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------- |
| `src/integrations/pm-field-auto-fill.service.ts`             | **NEW**     | Service + `ExecutionContext` + `FactualFillResult` interfaces                                     |
| `src/integrations/pm-field-auto-fill.service.spec.ts`        | **NEW**     | Unit tests T1–T14                                                                                 |
| `src/integrations/integrations.module.ts`                    | **MODIFY**  | Add `PMFieldAutoFillService` to providers + exports                                               |
| `src/github/github.module.ts`                                | **MODIFY**  | Add `IntegrationsModule` to imports (plain, no forwardRef)                                        |
| `src/github/services/deployment-status-sync.service.ts`      | **MODIFY**  | Inject 3 services; add `branch_name` to `github_push` select + type assertion; add pipeline block |
| `src/github/services/deployment-status-sync.service.spec.ts` | **MODIFY**  | Add 3 mock providers; update `mockDeployment`/`mockExecution` fixtures; add T-DSS1–T-DSS3 tests   |

**Do NOT touch:**

- `src/integrations/providers/pm-provider.interface.ts` — `setFieldValue` already exists
- `src/integrations/providers/dto/normalized-field.dto.ts` — `NormalizedFieldType` + `FieldValue` already complete
- `src/integrations/pm-field-pre-check.service.ts` — CS2-1 scope, no changes (only consume its result)
- `src/integrations/providers/clickup/clickup.provider.ts` — `setFieldValue` already implemented (line 178)
- Any execution consumer files — not the hook-in point for CS2

### Previous Story Intelligence (from CS2-1)

From CS2-1 (`required-field-pre-check`):

- `PMFieldPreCheckService` is at `src/integrations/pm-field-pre-check.service.ts`, exported from `IntegrationsModule`
- `FieldPreCheckResult` is exported from the same file
- `PMProviderFactory.getProvider()` must be `await`ed as a standalone step (never inside `Promise.all`)
- `NormalizedField` is imported from `@/integrations/providers/dto/normalized-field.dto`
- `SentryModule` is already imported in `IntegrationsModule` — no new module import needed for Sentry
- Test pattern: `{ provide: PMProviderFactory, useValue: mockProviderFactory }` — no `@Inject` string token
- The `IntegrationsModule` `providers` and `exports` arrays must be kept in sync

The `DeploymentStatusSyncService` has a `// CS2: These literals will be replaced by provider-agnostic IPMProvider status push` comment at line ~128 — this is the exact point where CS2-2 inserts its pipeline. The `clickUp.updateStatus()` call itself is **not** replaced in CS2-2 (that's future scope); CS2-2 only adds the pre-check + fill before it.

### Git Intelligence (Recent Commits)

1. `1d70c54` — `StartupChecksService` added — confirms `src/common/startup/` location for lifecycle services
2. `d31bb7c` — `DevelopmentGateService` — `src/ticket-intake/` new service; Logger + SentryService pattern confirmed
3. `eb3d381` — `BotAssignmentService` — **direct structural template for CS2-2** — same `src/integrations/` location, same constructor injection pattern
4. `c60a2fc` — Live status picker completion — confirms `IntegrationsModule` exports pattern (CS1-4)

### References

- FR-CS10: Auto-fill factual fields [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #FR-CS10]
- FR-CS12: Dropdown option_id resolution (AC6 precedent for PR text field matching) [Source: `epics-clickup-smart-sync.md` #FR-CS12]
- Story 2.2 acceptance criteria [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #Story-2.2]
- CS2-2 sprint entry [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml` #CS2-2-factual-auto-fill]
- CS2-1 story (PMFieldPreCheckService — consumed by this story) [Source: `_bmad-output/implementation-artifacts/CS2-1-required-field-pre-check.md`]
- `IPMProvider.setFieldValue()` signature [Source: `src/integrations/providers/pm-provider.interface.ts:34`]
- `ClickUpProvider.setFieldValue()` implementation [Source: `src/integrations/providers/clickup/clickup.provider.ts:178`]
- `NormalizedFieldType` enum + `FieldValue` type [Source: `src/integrations/providers/dto/normalized-field.dto.ts`]
- `BotAssignmentService` (structural template) [Source: `src/integrations/bot-assignment.service.ts`]
- `PMFieldPreCheckService` (structural template + result consumer) [Source: `src/integrations/pm-field-pre-check.service.ts`]
- `IntegrationsModule` providers/exports [Source: `src/integrations/integrations.module.ts:17-30`]
- `GitHubModule` imports (no `IntegrationsModule` yet) [Source: `src/github/github.module.ts:41-56`]
- `DeploymentStatusSync.syncToClickUp()` — integration point [Source: `src/github/services/deployment-status-sync.service.ts:42`]
- CS2 comment marker in DeploymentStatusSync [Source: `src/github/services/deployment-status-sync.service.ts:127`]
- `Deployment.deployed_at` field [Source: `prisma/schema.prisma:222`]
- `GitHubPush.pr_url`, `branch_name` fields [Source: `prisma/schema.prisma:205,203`]
- `Execution.started_at`, `completed_at` fields [Source: `prisma/schema.prisma:78-79`]
- `ProjectIntegrationService.findFirstByProject()` [Source: `src/integrations/project-integration.service.ts`]

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `src/integrations/pm-field-auto-fill.service.ts` — NEW: `PMFieldAutoFillService` + `ExecutionContext` + `FactualFillResult` interfaces (AC1–AC11)
- `src/integrations/pm-field-auto-fill.service.spec.ts` — NEW: unit tests T1–T14 (AC16)
- `src/integrations/integrations.module.ts` — MODIFY: add `PMFieldAutoFillService` to providers + exports (AC12)
- `src/github/github.module.ts` — MODIFY: add `IntegrationsModule` to imports, no forwardRef (AC15)
- `src/github/services/deployment-status-sync.service.ts` — MODIFY: inject 3 services, add `branch_name` to select + type assertion, add pipeline block (AC13, AC14)
- `src/github/services/deployment-status-sync.service.spec.ts` — MODIFY: add 3 mock providers, update fixtures with `branch_name`/`project_id`/timing fields, add T-DSS1–T-DSS3 (AC16)
