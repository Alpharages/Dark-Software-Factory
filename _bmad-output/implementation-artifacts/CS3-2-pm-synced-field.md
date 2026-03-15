# Story CS3.2: Track PM Sync State on Ticket Model

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **DSF system**,
I want to track whether a completed ticket's status has been synced to the PM tool,
so that execution completion and PM tool sync are independent states.

## Acceptance Criteria

### AC1 — Prisma schema: `pm_synced` field on `Ticket`

**Given** the `Ticket` model in `prisma/schema.prisma`
**When** this story is implemented
**Then** `pm_synced  Boolean  @default(true)` is present on the `Ticket` model
**And** a Prisma migration is generated (`pnpm db:migrate`) and applied

Exact field to add (place after `completion_date` or `status` line for consistency):

```prisma
pm_synced   Boolean   @default(true)
```

**Note:** No `@map` directive is needed. The Prisma convention infers the PostgreSQL column name as `pm_synced` (already snake_case). Do NOT add `@map("pm_synced")` or `@map("pmSynced")` — the former is redundant, the latter would create a misnamed column.

### AC2 — Success path: set `pm_synced = true`

**Given** a call to `DeploymentStatusSyncService.syncToClickUp()` where `ClickUpService.updateStatus()` returns `true`
**When** the result is processed
**Then** `prisma.ticket.update({ where: { id: ticketInternalId }, data: { pm_synced: true } })` is called **immediately after `statusUpdated` is confirmed**, before the `addComment()` call
**And** failure of this update is caught and logged — it must NOT throw or block the happy path

**⚠️ Critical placement constraint:** `pm_synced = true` must be set BEFORE `addComment()`. If set after, a thrown exception from `addComment()` would reach the outer catch and mark `pm_synced = false` even though the status push succeeded. `addComment()` is best-effort and must not affect `pm_synced` state.

### AC3 — Soft failure path: set `pm_synced = false`

**Given** `ClickUpService.updateStatus()` returns `false` (graceful degradation path, lines 274-292 in current service)
**When** the graceful-degradation early return block is reached
**Then** `prisma.ticket.update({ where: { id: ticketInternalId }, data: { pm_synced: false } })` is called
**And** `AuditLogService.log()` is called with:

```typescript
{
  entityType: 'ticket',
  entityId: ticketInternalId,
  action: 'pm_sync_failed',
  actorType: 'system',
  afterState: {
    provider: 'CLICKUP',
    errorCode: 'STATUS_UPDATE_RETURNED_FALSE',
    correlationId: finalCorrelationId,
    ticketClickupId: ticketId,
  },
}
```

**And** the method still returns without throwing (graceful degradation preserved)

### AC4 — Exception path: set `pm_synced = false`

**Given** `syncToClickUp()` outer try block throws any exception (e.g. network, DB, `PMProviderClientError` from CS3-1)
**When** the outer catch at the end of `syncToClickUp()` is reached
**Then** if `ticketInternalId` is known (was resolved before the error), `prisma.ticket.update({ pm_synced: false })` is called
**And** `AuditLogService.log()` is called with:

```typescript
{
  entityType: 'ticket',
  entityId: ticketInternalId,
  action: 'pm_sync_failed',
  actorType: 'system',
  afterState: {
    provider: 'CLICKUP',
    errorCode: (_error as Error).name ?? 'UNKNOWN',
    correlationId: finalCorrelationId,
    ticketClickupId: ticketId ?? null,
  },
}
```

**And** if `ticketInternalId` is `undefined` (failure occurred before ticket fetch), the pm_synced update is skipped gracefully
**And** Sentry capture and metrics are still recorded (existing behaviour preserved)

### AC5 — `pm_synced = false` semantic meaning

**Given** a ticket has `pm_synced = false` and execution status `COMPLETED` or `DEPLOYED`
**When** the ticket state is evaluated (by dashboard, CS3-4, or any consumer)
**Then** this represents the "Work Done — Sync Pending" state
**Note**: CS3-4 will surface this state on the dashboard. CS3-2 only sets the field and records the audit log.

### AC6 — Unit tests

**Given** the implementation
**When** `pnpm test -- --testPathPattern="deployment-status-sync"` runs
**Then** all existing tests continue to pass
**And** the following new tests are added to `deployment-status-sync.service.spec.ts`:

| Test  | Description                                                                                                                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-PS1 | Success path: `prisma.ticket.update` called with `{ pm_synced: true }` when `updateStatus` returns `true`                                                                                                |
| T-PS2 | Soft failure: `prisma.ticket.update` called with `{ pm_synced: false }` when `updateStatus` returns `false`                                                                                              |
| T-PS3 | Soft failure: `auditLog.log` called with `action: 'pm_sync_failed'` when `updateStatus` returns `false`                                                                                                  |
| T-PS4 | Exception path: `prisma.ticket.update` called with `{ pm_synced: false }` when outer catch fires                                                                                                         |
| T-PS5 | Exception path: `auditLog.log` called with `action: 'pm_sync_failed'` when outer catch fires                                                                                                             |
| T-PS6 | `ticketInternalId` undefined (ticket fetch fails before resolution): pm_synced update is skipped, no throw                                                                                               |
| T-PS7 | pm_synced update itself throws → error is caught and logged, `syncToClickUp` does not throw                                                                                                              |
| T-PS8 | `updateStatus` returns `true` but `addComment` throws → `prisma.ticket.update` was already called with `{ pm_synced: true }` (outer catch fires but pm_synced=true was committed before comment attempt) |

### AC7 — TypeScript + lint clean

**Given** the implementation
**When** `pnpm typecheck` and `pnpm lint` run
**Then** zero errors on all CS3-2 modified files

## Tasks / Subtasks

- [ ] **Task 1**: Prisma schema + migration (AC1)
  - [ ] Add `pm_synced  Boolean  @default(true)` to `Ticket` model in `prisma/schema.prisma`
  - [ ] Run `pnpm db:migrate` — this creates the migration SQL, applies it to the DB, **and automatically regenerates the Prisma client** in one step (migration name suggestion: `add_pm_synced_to_ticket`)
  - [ ] Do NOT run `pnpm db:generate` before `pnpm db:migrate` — generating before migrating would produce a client from an unapplied schema, causing runtime column-not-found errors
  - [ ] Verify `@/prisma/client` types now include `pm_synced` on `Ticket`

- [ ] **Task 2**: Scoped ticket ID variable (required for AC3/AC4 error paths)
  - [ ] In `syncToClickUp()`, declare `let ticketInternalId: string | undefined` and `let ticketClickupId: string | undefined` **before** the outer try block
  - [ ] After `execution.ticket` is confirmed (line ~142 in current service), assign: `ticketInternalId = execution.ticket.id; ticketClickupId = execution.ticket.clickup_task_id;`
  - [ ] This allows the outer catch to reference the ticket even when exception occurred after ticket resolution

- [ ] **Task 3**: Success path — set `pm_synced = true` (AC2)
  - [ ] In `syncToClickUp()`, place the pm_synced=true update **immediately after the `if (!statusUpdated)` block closes** (i.e. right after the graceful-degradation early-return), **before** the `addComment()` call — this ensures the status-push success is recorded even if the comment call throws:

    ```typescript
    // ← Here: statusUpdated is confirmed true, status push succeeded
    try {
      await this.prisma.ticket.update({
        where: { id: ticketInternalId! },
        data: { pm_synced: true },
      });
    } catch (_pmSyncUpdateErr) {
      this.logger.warn(
        `[${finalCorrelationId}] CS3-2: failed to set pm_synced=true on ticket ${ticketInternalId}`,
      );
    }

    // AC#2: Add formatted comment  ← addComment() follows AFTER
    ```

  - [ ] **Do NOT** place this after `recordAuditLog()` (line ~315-324) — `addComment()` in between can throw and would bypass pm_synced=true

- [ ] **Task 4**: Soft failure path — set `pm_synced = false` (AC3)
  - [ ] In the `if (!statusUpdated)` block (around line 274-293 in current service), add pm_synced=false update and dedicated pm_sync_failed audit log **before** the `return`
  - [ ] Use the new `recordPmSyncFailedAuditLog()` private helper (created in Task 6)
  - [ ] Wrap pm_synced update in try/catch so it never throws

- [ ] **Task 5**: Exception path — set `pm_synced = false` (AC4)
  - [ ] In the outer `catch (_error)` block (around line 345-366 in current service), after Sentry capture, add:
    - If `ticketInternalId` is defined: update `pm_synced = false` + call `recordPmSyncFailedAuditLog()`
    - Wrap in try/catch

- [ ] **Task 6**: `recordPmSyncFailedAuditLog()` private helper
  - [ ] Add private method to `DeploymentStatusSyncService`:
    ```typescript
    private async recordPmSyncFailedAuditLog(
      ticketInternalId: string,
      ticketClickupId: string | null,
      errorCode: string,
      correlationId: string,
    ): Promise<void> {
      try {
        await this.auditLog.log({
          entityType: 'ticket',
          entityId: ticketInternalId,
          action: 'pm_sync_failed',
          actorType: 'system',
          afterState: {
            provider: 'CLICKUP',
            errorCode,
            correlationId,
            ticketClickupId,
          },
        });
      } catch (_err) {
        this.logger.warn(`[${correlationId}] CS3-2: audit log for pm_sync_failed failed silently`);
      }
    }
    ```

- [ ] **Task 7**: Update existing test fixture + add new tests (AC6)
  - [ ] In `deployment-status-sync.service.spec.ts`, update `mockExecution.ticket` to include `id: 'ticket-001'`
  - [ ] In prisma mock setup, add `ticket: { update: jest.fn().mockResolvedValue({ id: 'ticket-001', pm_synced: true }) }` to the `PrismaService` mock (use `.mockResolvedValue()` since Prisma's `update()` returns the updated record — explicit return value improves test clarity and avoids `undefined` resolution surprises)
  - [ ] Add T-PS1 through T-PS8 test cases (see AC6 table)

- [ ] **Task 8**: TypeScript + lint verification (AC7)
  - [ ] `pnpm typecheck` — zero errors on CS3-2 modified files
  - [ ] `pnpm lint` — zero warnings/errors on CS3-2 modified files
  - [ ] `pnpm test -- --testPathPattern="deployment-status-sync"` — all tests pass

## Dev Notes

### What This Story Builds

CS3-2 is the second story of Epic CS3. It adds the `pm_synced` boolean field to the `Ticket` model and wires it into the sync outcome paths of `DeploymentStatusSyncService`. This field is the foundation for:

- **CS3-3**: Checks `pm_synced=false` to trigger actionable failure comments
- **CS3-4**: Dashboard reads `pm_synced=false` + `COMPLETED/DEPLOYED` execution status → amber `SYNC_PENDING` state

**CS3-2 scope is strictly:**

- Prisma schema migration (new field)
- Setting `pm_synced` to `true`/`false` based on sync outcome in `DeploymentStatusSyncService`
- pm_sync_failed audit log entry
- NO Socket.IO events (CS3-4)
- NO actionable failure comments (CS3-3)
- NO IPMProvider migration (the service still uses legacy `ClickUpService` — this is correct for now)

### Critical Implementation Detail: Scoped Ticket ID

The current `syncToClickUp()` method fetches `execution.ticket` inside the outer try block. The outer `catch` at line 345 cannot access local variables declared inside the try. To set `pm_synced=false` in the catch, **you must declare `ticketInternalId` before the try**:

```typescript
async syncToClickUp(deploymentId: string, correlationId?: string): Promise<void> {
  // ... existing correlationId setup ...
  let ticketInternalId: string | undefined;   // ← ADD THIS
  let ticketClickupId: string | undefined;     // ← ADD THIS

  try {
    // ... existing deployment fetch, execution fetch ...

    // After execution.ticket is confirmed (~line 142):
    ticketInternalId = execution.ticket.id;     // ← ASSIGN HERE
    ticketClickupId = execution.ticket.clickup_task_id;

    // ... rest of existing logic ...
  } catch (_error) {
    // ticketInternalId is accessible here if it was set before the error
    if (ticketInternalId) {
      // set pm_synced=false
    }
  }
}
```

### Current Service Structure (Reference Map)

> **Note:** Line numbers are approximate based on the current file. They will shift by ~2 lines after Task 2 adds the `let ticketInternalId` / `let ticketClickupId` declarations before the outer try block.

| Line range (approx.)             | What it does                                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 56-67                            | correlationId setup + logger.log                                                                         |
| 72-111                           | Fetch deployment + type assertion                                                                        |
| 113-140                          | Validate deployment + github_push                                                                        |
| 128-140                          | **Fetch execution + ticket** ← assign `ticketInternalId` + `ticketClickupId` here (Task 2)               |
| 144-257                          | CS2 pre-check/auto-fill pipeline (fail-open)                                                             |
| 259-293                          | Status push via `ClickUpService.updateStatus()`                                                          |
| 274-292                          | **`!statusUpdated` graceful degradation** ← set pm_synced=false + audit log here (Task 4), then `return` |
| ~293 end of `if(!statusUpdated)` | **← set pm_synced=true HERE (Task 3)** — immediately before addComment()                                 |
| 295-311                          | `addComment()` call (comment failure is warn-only, must NOT affect pm_synced)                            |
| 313-324                          | Success path: metrics + audit log                                                                        |
| 345-366                          | **Outer catch** ← set pm_synced=false here if `ticketInternalId` known (Task 5)                          |

### Test Fixture Update Required

Current `mockExecution.ticket` in the spec file lacks an `id` field:

```typescript
// BEFORE (missing id):
ticket: {
  project_id: 'proj-123',
  clickup_task_id: 'clickup-123',
  title: 'Fix Bug',
  description: 'The bug is here',
}

// AFTER (add id):
ticket: {
  id: 'ticket-001',  // ← ADD THIS
  project_id: 'proj-123',
  clickup_task_id: 'clickup-123',
  title: 'Fix Bug',
  description: 'The bug is here',
}
```

Also add `ticket.update` to the PrismaService mock:

```typescript
{
  provide: PrismaService,
  useValue: {
    deployment: { findUnique: jest.fn() },
    execution: { findUnique: jest.fn() },
    ticket: { update: jest.fn() },  // ← ADD THIS
  },
}
```

### pm_synced Default Value Rationale

The field defaults to `true` (`@default(true)`) because:

- Existing tickets in the DB (pre-migration) are assumed to have been synced (historical data clean)
- New tickets that haven't gone through the sync pipeline yet start as "not yet attempted" — the `true` default avoids false `SYNC_PENDING` states on pre-execution tickets
- The field only gets set to `false` explicitly when a sync attempt fails

### Audit Log: `pm_sync_failed`

The new audit log action follows the existing `AuditLogService.log()` pattern (no interface changes needed):

- `entityType: 'ticket'` — the entity that failed to sync
- `entityId: ticketInternalId` — DSF's internal ticket UUID
- `action: 'pm_sync_failed'` — new action string (consumed by CS3-4 dashboard)
- `afterState.provider: 'CLICKUP'` — hardcoded for now (provider abstraction is CS0+)
- `afterState.errorCode` — differs by failure type:
  - Soft failure (statusUpdated=false): `'STATUS_UPDATE_RETURNED_FALSE'`
  - Exception: use `(error as Error).name ?? 'UNKNOWN'` (e.g. `'PMProviderClientError'` from CS3-1)

### CS3-1 Dependency Note

CS3-1 creates `PMProviderClientError` (in `src/integrations/providers/pm-provider-client.error.ts`). CS3-2 does NOT need to check `instanceof PMProviderClientError` explicitly. The outer catch handles all errors generically. When CS3-1 is implemented and the service eventually migrates to IPMProvider, `PMProviderClientError` will flow through the same outer catch and get `pm_synced=false` set correctly with `errorCode = 'PMProviderClientError'`.

### NFR Compliance

- **NFR-CS4**: If PM API unavailable → DSF continues execution, marks `pm_synced=false` ✓ (outer catch + graceful degradation path both set it)
- **NFR-CS5**: All sync failures audited via `AuditLogService` with entity, action, provider, error code, correlation ID ✓

### Project Structure Notes

| File                                                                  | Change Type | Notes                                                                                                                           |
| --------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                                | **MODIFY**  | Add `pm_synced Boolean @default(true)` to `Ticket` model                                                                        |
| `prisma/migrations/<timestamp>_add_pm_synced_to_ticket/migration.sql` | **NEW**     | Auto-generated by `pnpm db:migrate`                                                                                             |
| `src/github/services/deployment-status-sync.service.ts`               | **MODIFY**  | Scope `ticketInternalId` var; add pm_synced updates in success/failure paths; add `recordPmSyncFailedAuditLog()` private helper |
| `src/github/services/deployment-status-sync.service.spec.ts`          | **MODIFY**  | Add `ticket.id` to mockExecution, add `ticket.update` mock, add T-PS1–T-PS7                                                     |

**Do NOT touch:**

- `src/integrations/providers/pm-provider-client.error.ts` — CS3-1 scope
- `src/integrations/providers/clickup/clickup.provider.ts` — CS3-1 scope
- Any CS3-3 or CS3-4 features (actionable comments, dashboard state, Socket.IO)
- `src/github/github.module.ts` — no new injectables (only `prisma.ticket.update` is new, PrismaService already injected)

### Architecture Compliance

- **`@/` path aliases**: All cross-directory imports use `@/` — never relative paths
- **Fail-open pattern**: All pm_synced updates are wrapped in try/catch — they must NEVER block the main flow (deployment recording must complete even if pm_synced update fails)
- **TypeScript strict**: No `any` on new code; explicit types on `ticketInternalId: string | undefined`
- **Private helper pattern**: `recordPmSyncFailedAuditLog()` private method follows the existing `recordAuditLog()` and `recordMetrics()` patterns in the same service

### Previous Story Intelligence (from CS3-1)

CS3-1 established:

- `PMProviderClientError` at `src/integrations/providers/pm-provider-client.error.ts` — error class with `httpStatus`, `providerErrorCode`, `providerErrorBody`
- `PMProviderClientError.isRetryable()` static method
- Refactored `ClickUpProvider.retryWithBackoff()` to use typed errors
- `DeploymentStatusSyncService` is explicitly NOT modified in CS3-1 (CS3-2 is the consumer)

From CS2-4:

- `DeploymentStatusSyncService` is the class name (was renamed from `DeploymentStatusSync`)
- The class integrates `PMFieldPreCheckService`, `PMFieldAutoFillService`, `PMVerificationCommentService` in CS2 pipeline
- Pattern: fail-open try/catch for optional pipeline steps

From CS2-2:

- `IntegrationsModule` is imported in `GitHubModule` (so `PrismaService` is already available in the sync service)
- All CS-series services use `private readonly logger = new Logger(ClassName.name)` pattern

### Git Intelligence (Recent Commits)

1. `c013ed1` — CS1-7: ClickUp credential transition. Pattern: `@/` import aliases throughout all modified files
2. `e2e103b` — CS2-4: Rename `DeploymentStatusSync` → `DeploymentStatusSyncService` + verification comment. Confirms current class name
3. `d914a79` — CS2-3: AI-powered field inference. Shows fail-open pattern in `syncToClickUp()`: `try { await pmAutoFillService... } catch (_err) { logger.warn(...); sentry.captureException(...); }`
4. `d1cf615` — CS2-2: `PMFieldAutoFillService`. Pattern: service in `src/integrations/`, mock testing with `jest.fn()`
5. `5f1973c` — CS2-1: `PMFieldPreCheckService` tests. NestJS unit test module setup with `Test.createTestingModule({ providers: [...] })`

### References

- FR-CS16: `pm_synced Boolean` field on Ticket model [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #FR-CS16]
- NFR-CS4: PM unavailable → continue execution, mark pm_synced=false [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #NFR-CS4]
- NFR-CS5: All sync failures audited [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #NFR-CS5]
- Story 3.2 acceptance criteria [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #Story-3.2]
- CS3-2 sprint entry [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml` #CS3-2-pm-synced-field]
- DeploymentStatusSyncService (primary file to modify) [Source: `src/github/services/deployment-status-sync.service.ts`]
- DeploymentStatusSyncService tests [Source: `src/github/services/deployment-status-sync.service.spec.ts`]
- AuditLogService.log() interface [Source: `src/common/audit/audit-log.service.ts`]
- Prisma Ticket model (current, no pm_synced yet) [Source: `prisma/schema.prisma`]
- IPMProvider interface [Source: `src/integrations/providers/pm-provider.interface.ts`]
- PMProviderClientError (CS3-1 output) [Source: `src/integrations/providers/pm-provider-client.error.ts`]

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
