# Story CS3.4: SYNC_PENDING Dashboard State & Real-Time Alert

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **PM**,
I want tickets where DSF finished but the PM tool needs a manual update shown as a distinct amber state on my dashboard,
so that I can action them without confusing them with execution failures.

## Acceptance Criteria

### AC1 — New scoped variable `ticketProjectId` in `DeploymentStatusSyncService`

**Given** CS3-3 is implemented (scoped variables: `integration`, `targetStatus`, `lastMissingFields` before outer try)
**When** CS3-4 is implemented
**Then** `let ticketProjectId: string | undefined;` is declared before the outer `try` block (alongside existing `ticketInternalId`/`ticketClickupId`)
**And** immediately after the lines assigning `ticketInternalId` and `ticketClickupId`, the following is added:

```typescript
ticketProjectId = execution.ticket.project_id;
```

---

### AC2 — `RealtimeService` injected into `DeploymentStatusSyncService`

**Given** `RealtimeModule` exports `RealtimeService`
**When** CS3-4 is implemented
**Then** `RealtimeModule` is added to the `imports` array in `src/github/github.module.ts`
**And** `import { RealtimeModule } from '@/realtime/realtime.module';` is added to github.module.ts
**And** `import { RealtimeService } from '@/realtime/realtime.service';` is added to deployment-status-sync.service.ts
**And** `DeploymentStatusSyncService` constructor receives `private readonly realtimeService: RealtimeService` as the last injected dependency

---

### AC3 — Socket.IO `pm-sync-failed` event emitted on soft failure path

**Given** `pm_synced=false` is set in the soft failure path (`if (!statusUpdated)` block)
**When** the update succeeds and `ticketProjectId` is defined
**Then** the following CS3-4 block is inserted AFTER the CS3-3 `pmActionableFailureCommentService` block and BEFORE `return;`:

```typescript
// CS3-4: Emit pm-sync-failed Socket.IO event (best-effort)
try {
  if (ticketProjectId) {
    this.realtimeService.emitToRole('PM', 'pm-sync-failed', {
      ticketId: ticketClickupId,
      projectId: ticketProjectId,
      provider: 'CLICKUP',
      reason: 'ClickUp status update returned false — graceful degradation',
      missingFields: lastMissingFields,
    });
  }
} catch (_socketErr) {
  this.logger.warn(
    `[${finalCorrelationId}] CS3-4: unexpected error emitting pm-sync-failed event (soft failure path)`,
  );
}
```

**And** the emission is best-effort — never throws and never blocks the `return`

---

### AC4 — Socket.IO `pm-sync-failed` event emitted on exception path

**Given** the outer `catch (_error)` block is reached
**When** `ticketProjectId` is defined
**Then** the following CS3-4 block is inserted AFTER the CS3-3 failure comment block in the outer catch:

```typescript
// CS3-4: Emit pm-sync-failed Socket.IO event (best-effort, exception path)
try {
  if (ticketProjectId) {
    this.realtimeService.emitToRole('PM', 'pm-sync-failed', {
      ticketId: ticketClickupId,
      projectId: ticketProjectId,
      provider: 'CLICKUP',
      reason: (_error as Error).message,
      missingFields: [],
    });
  }
} catch (_socketErr) {
  this.logger.warn(
    `[${finalCorrelationId}] CS3-4: unexpected error emitting pm-sync-failed event (exception path)`,
  );
}
```

**And** the emission is best-effort — never throws or affects existing error recording

---

### AC5 — Complete insertion order in soft failure path after CS3-4

Inside `if (!statusUpdated)` block, complete order after full CS3 stack:

1. `recordMetrics(...)` — existing
2. `recordAuditLog(...)` — existing
3. `prisma.ticket.update({ pm_synced: false })` — CS3-2
4. `recordPmSyncFailedAuditLog(...)` — CS3-2
5. `pmActionableFailureCommentService.postActionableFailureComment(...)` — CS3-3
6. ✅ **CS3-4 Socket.IO emission block** — this story
7. `return` — existing (unchanged position)

---

### AC6 — `sync_pending` count in `PmDashboardService.getProjects()`

**Given** the PM dashboard projects endpoint is called (`GET /pm-dashboard/projects`)
**When** tickets with `pm_synced=false` AND `status IN ('COMPLETED', 'DEPLOYED')` exist in a project
**Then** each project's `tickets` object includes `sync_pending: number`
**And** `sync_pending` equals the count of such tickets (done work, un-synced to PM tool)
**And** `sync_pending` is `0` when no affected tickets exist

Implementation detail — tickets select must include `pm_synced`:

```typescript
tickets: {
  select: {
    status: true,
    pm_synced: true,   // ← CS3-4: add this field
    updated_at: true,
  },
},
```

In `projects.map()` lambda, add:

```typescript
const sync_pending = tickets.filter(
  (t) => !t.pm_synced && ['COMPLETED', 'DEPLOYED'].includes(t.status),
).length;
```

And return `sync_pending` in the `tickets` object:

```typescript
tickets: {
  total,
  in_progress,
  completed,
  blocked,
  awaiting_approval,
  sync_pending,   // ← CS3-4: add this
},
```

---

### AC7 — `sync_pending_tickets` KPI in `PmDashboardService.getSummary()`

**Given** the PM dashboard summary endpoint is called (`GET /pm-dashboard/summary`)
**When** tickets with `pm_synced=false` AND `status IN ('COMPLETED', 'DEPLOYED')` exist
**Then** the summary includes `sync_pending_tickets: number` (0 when none exist)

Add an 8th query to the existing `Promise.all()`:

```typescript
this.prisma.ticket.count({
  where: {
    ...ticketsWhere,
    pm_synced: false,
    status: { in: ['COMPLETED', 'DEPLOYED'] },
  },
}),
```

Destructure as:

```typescript
const [
  projectStats,
  ticketStats,
  aiExecutionTimes,
  aiExecutionCounts,
  activeProjectsCount,
  qaTotal,
  qaPassed,
  syncPendingTickets,   // ← CS3-4 adds
] = await Promise.all([...]);
```

Add to result:

```typescript
const result: DashboardSummaryDto = {
  // ... existing fields ...
  sync_pending_tickets: syncPendingTickets, // ← CS3-4 adds
};
```

---

### AC8 — Backend DTOs updated

**Given** the new fields are computed
**When** `src/dashboards/dto/pm-dashboard.dto.ts` is inspected
**Then** `TicketCountsDto` has:

```typescript
@ApiProperty({ description: 'Tickets with execution COMPLETED/DEPLOYED but pm_synced=false', default: 0 })
sync_pending!: number;
```

**And** `DashboardSummaryDto` has:

```typescript
@ApiProperty({ description: 'Total tickets completed but not yet synced to PM tool', default: 0 })
sync_pending_tickets!: number;
```

---

### AC9 — Frontend: `TicketCounts` type updated

**Given** the backend now returns `sync_pending` in the `tickets` object
**When** `src/types/index.ts` (frontend repo) is inspected
**Then** `TicketCounts` interface has `sync_pending?: number`

---

### AC10 — Frontend: `DashboardSummary` type updated

**Given** the backend now returns `sync_pending_tickets` in summary
**When** `src/types/index.ts` (frontend repo) is inspected
**Then** `DashboardSummary` interface has `sync_pending_tickets?: number`

---

### AC11 — Frontend: `ProjectCard.tsx` displays amber SYNC PENDING badge

**Given** a project has `project.tickets.sync_pending > 0`
**When** the `ProjectCard` renders
**Then** an amber badge is displayed in the card header `flex gap-2` container (same area as the APPROVAL badge, before the menu button)
**And** the badge uses amber styling: `bg-amber-500/20 text-amber-400 border border-amber-500/30`
**And** the badge uses `Clock` icon (already imported from lucide-react in the file)
**And** the badge label is "SYNC PENDING" with ticket count below it
**And** it is visually distinct from the red `blocked` count and the blue `APPROVAL` badge

Badge implementation (mirrors the existing APPROVAL badge pattern at lines 82–92):

```tsx
{
  (project.tickets.sync_pending ?? 0) > 0 && (
    <div className="flex flex-col items-end gap-1">
      <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-md text-[10px] font-bold animate-pulse flex items-center gap-1">
        <Clock className="w-3 h-3" />
        SYNC PENDING
      </span>
      <span className="text-[10px] text-muted-foreground">
        {project.tickets.sync_pending} ticket(s)
      </span>
    </div>
  );
}
```

Place this block immediately before the `awaiting_approval` badge block (so both can appear side by side).

---

### AC12 — Frontend: `useProjectUpdates.ts` handles `pm-sync-failed` event

**Given** the socket receives a `pm-sync-failed` event
**When** the event payload contains `{ projectId: string, ticketId: string, provider: string, reason: string, missingFields: unknown[] }`
**Then** the matching project's `tickets.sync_pending` count is incremented by 1 without a page refresh:

```typescript
socket.on(
  'pm-sync-failed',
  (data: {
    projectId: string;
    ticketId: string;
    provider: string;
    reason: string;
    missingFields: unknown[];
  }) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === data.projectId
          ? { ...p, tickets: { ...p.tickets, sync_pending: (p.tickets.sync_pending ?? 0) + 1 } }
          : p,
      ),
    );
  },
);
```

**And** the listener is cleaned up in the useEffect return:

```typescript
socket.off('pm-sync-failed');
```

---

### AC13 — Frontend: `Dashboard.tsx` shows amber toast on `pm-sync-failed` event

**Given** the socket receives a `pm-sync-failed` event
**When** the `Dashboard` component is mounted and socket is connected
**Then** an amber toast is shown: `"PM tool update needed — CLICKUP sync failed"` (or `"PM tool update needed — [provider] sync failed"`)
**And** the `import { toast } from 'react-hot-toast';` line (currently commented out at line 6) is uncommented
**And** a dedicated `useEffect` in `Dashboard.tsx` listens for `pm-sync-failed` and calls `toast(...)`:

```tsx
useEffect(() => {
  if (!socket) return;
  socket.on('pm-sync-failed', (data: { provider: string }) => {
    toast(`PM tool update needed — ${data.provider} sync failed`, {
      icon: '⚠️',
      style: { background: '#92400e', color: '#fef3c7' },
    });
  });
  return () => {
    socket.off('pm-sync-failed');
  };
}, [socket]);
```

**And** this `useEffect` handles ONLY the toast — the project state update is handled exclusively by `useProjectUpdates` (no duplication)

---

### AC14 — Backend: Unit tests for `DeploymentStatusSyncService` (CS3-4 socket emission)

**Given** the service is updated
**When** `pnpm test -- --testPathPattern="deployment-status-sync"` runs
**Then** all existing tests continue to pass
**And** `RealtimeService` is mocked in `TestingModule` providers:

```typescript
{
  provide: RealtimeService,
  useValue: { emitToRole: jest.fn() },
}
```

**And** new tests are added:

| Test  | Description                                                                                                                                                                                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-SE1 | Soft failure: `realtimeService.emitToRole` called with `('PM', 'pm-sync-failed', ...)` when `updateStatus` returns `false` AND `ticketProjectId` is known (requires `execution.ticket.project_id` in mock) |
| T-SE2 | Soft failure: payload includes `{ provider: 'CLICKUP', reason: 'ClickUp status update returned false — graceful degradation' }`                                                                            |
| T-SE3 | Soft failure: `emitToRole` NOT called when `ticketProjectId` is undefined (e.g. `execution.ticket.project_id` is null/undefined in mock)                                                                   |
| T-SE4 | Soft failure: `emitToRole` throws → caught silently, method still returns without throwing                                                                                                                 |
| T-SE5 | Exception path: `realtimeService.emitToRole` called when outer catch fires AND `ticketProjectId` is known                                                                                                  |
| T-SE6 | Exception path: `emitToRole` NOT called when `ticketProjectId` is undefined                                                                                                                                |

---

### AC15 — Backend: Unit tests for `PmDashboardService` (sync_pending)

**Given** `PmDashboardService` is updated
**When** `pnpm test -- --testPathPattern="pm-dashboard"` runs (create spec file if it doesn't exist)
**Then** tests added or updated:

| Test  | Description                                                                                                                                  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| T-SD1 | `getProjects()`: project with ticket where `pm_synced=false, status=COMPLETED` → `tickets.sync_pending=1`                                    |
| T-SD2 | `getProjects()`: project with ticket where `pm_synced=true, status=COMPLETED` → `tickets.sync_pending=0`                                     |
| T-SD3 | `getProjects()`: project with ticket where `pm_synced=false, status=AI_PROCESSING` → `tickets.sync_pending=0` (non-terminal status excluded) |
| T-SD4 | `getSummary()`: returns `sync_pending_tickets` matching the prisma count result for `pm_synced=false, status in COMPLETED/DEPLOYED`          |

---

### AC16 — TypeScript + lint clean

**Given** the implementation
**When** `pnpm typecheck` and `pnpm lint` run (backend repo)
**Then** zero errors on all CS3-4 modified backend files
**And** all imports use `@/` path aliases — no relative `../../` paths
**And** no `any` introduced without an `// eslint-disable-next-line` with justification

---

## Tasks / Subtasks

- [x] **Task 1**: Scope `ticketProjectId` variable in `DeploymentStatusSyncService` (AC1)
  - [x] Add `let ticketProjectId: string | undefined;` before the outer try block (after `ticketClickupId` declaration on line 64)
  - [x] Add `ticketProjectId = execution.ticket.project_id;` after line 155 (alongside `ticketInternalId = execution.ticket.id` and `ticketClickupId = execution.ticket.clickup_task_id` assignments, currently at lines 154–155)

- [x] **Task 2**: Add `RealtimeModule` to `GitHubModule` and inject `RealtimeService` (AC2)
  - [x] In `src/github/github.module.ts`: add `import { RealtimeModule } from '@/realtime/realtime.module';`
  - [x] Add `RealtimeModule` to the `imports` array (after `IntegrationsModule`)
  - [x] In `src/github/services/deployment-status-sync.service.ts`: add `import { RealtimeService } from '@/realtime/realtime.service';`
  - [x] Add `private readonly realtimeService: RealtimeService` to the constructor (last position)

- [x] **Task 3**: Emit `pm-sync-failed` event in soft failure path (AC3, AC5)
  - [x] Locate the soft failure path (`if (!statusUpdated)` block, currently around line 279)
  - [x] After the CS3-3 `pmActionableFailureCommentService` block and before `return;`, add the CS3-4 socket emission try/catch block

- [x] **Task 4**: Emit `pm-sync-failed` event in exception path (AC4)
  - [x] Locate the outer `catch (_error)` block (currently around line 393)
  - [x] After the CS3-3 failure comment block (CS3-3 adds it after the pm_synced=false block), add the CS3-4 socket emission try/catch block

- [x] **Task 5**: Update `PmDashboardService.getProjects()` to compute `sync_pending` (AC6)
  - [x] In `prisma.project.findMany` include → tickets select: add `pm_synced: true` (line ~153-157)
  - [x] In `projects.map()` lambda: add `const sync_pending = tickets.filter(t => !t.pm_synced && ['COMPLETED', 'DEPLOYED'].includes(t.status)).length;`
  - [x] Add `sync_pending` to the returned `tickets` object in the mapped result

- [x] **Task 6**: Update `PmDashboardService.getSummary()` to add `sync_pending_tickets` KPI (AC7)
  - [x] Add 8th query to `Promise.all()`: `this.prisma.ticket.count({ where: { ...ticketsWhere, pm_synced: false, status: { in: ['COMPLETED', 'DEPLOYED'] } } })`
  - [x] Destructure `syncPendingTickets` from the `Promise.all` result
  - [x] Add `sync_pending_tickets: syncPendingTickets` to the `DashboardSummaryDto` result object

- [x] **Task 7**: Update backend DTOs (AC8)
  - [x] In `src/dashboards/dto/pm-dashboard.dto.ts`: add `@ApiProperty()` + `sync_pending!: number` to `TicketCountsDto`
  - [x] Add `@ApiProperty()` + `sync_pending_tickets!: number` to `DashboardSummaryDto`

- [x] **Task 8**: Update frontend types (AC9, AC10)
  - [x] In `/Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/types/index.ts`:
  - [x] Add `sync_pending?: number` to `TicketCounts` interface
  - [x] Add `sync_pending_tickets?: number` to `DashboardSummary` interface

- [x] **Task 9**: Update `ProjectCard.tsx` to show amber SYNC PENDING badge (AC11)
  - [x] `Clock` is already imported (line 8) — verify it's in the imports list
  - [x] In the card header `flex gap-2` div (around lines 81–95), add the amber SYNC PENDING badge block before the `awaiting_approval` badge block

- [x] **Task 10**: Update `useProjectUpdates.ts` to handle `pm-sync-failed` event (AC12)
  - [x] In `/Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/hooks/useProjectUpdates.ts`
  - [x] Add `socket.on('pm-sync-failed', ...)` listener inside the `useEffect`
  - [x] Increment `sync_pending` on the matching project (using `??` default to 0)
  - [x] Add `socket.off('pm-sync-failed');` in the cleanup return

- [x] **Task 11**: Update `Dashboard.tsx` to show amber toast (AC13)
  - [x] Uncomment `import { toast } from 'react-hot-toast';` (line 6)
  - [x] Add a new `useEffect` after the `useProjectUpdates(socket, setProjects)` call on line 65
  - [x] The effect listens for `pm-sync-failed`, calls `toast(...)`, and cleans up on unmount

- [x] **Task 12**: Write backend unit tests (AC14, AC15)
  - [x] In `deployment-status-sync.service.spec.ts`: add `RealtimeService` mock with `{ emitToRole: jest.fn() }`
  - [x] Resolve `realtimeService = module.get(RealtimeService);`
  - [x] Add T-SE1 through T-SE6 (note: `mockExecution.ticket.project_id = 'proj-123'` already exists — for T-SE3/T-SE6 use a variant with `project_id: undefined`)
  - [x] Modify existing `src/dashboards/services/pm-dashboard.service.spec.ts` to add T-SD1 through T-SD4 (file already exists — do NOT create a new one)

- [x] **Task 13**: TypeScript + lint verification (AC16)
  - [x] `pnpm typecheck` — zero errors on all CS3-4 modified files
  - [x] `pnpm lint` — zero warnings
  - [x] `pnpm test -- --testPathPattern="deployment-status-sync|pm-dashboard"` — all tests pass
  - [x] `pnpm build` — verifies no circular dependency from `RealtimeModule` import in `GitHubModule`

---

## Dev Notes

### What This Story Builds

CS3-4 adds the SYNC_PENDING amber dashboard state that surfaces when `pm_synced=false` on a COMPLETED/DEPLOYED ticket. It is the final story in Epic CS3:

- **CS3-1** (done): `PMProviderClientError` with `providerErrorCode` + `providerErrorBody`
- **CS3-2** (done): `pm_synced` field on `Ticket` — set `false` on failure, `true` on success
- **CS3-3** (ready-for-dev): Actionable failure comment via `PMActionableFailureCommentService` — **CS3-4 must be implemented after CS3-3 is merged**
- **CS3-4** (this story): SYNC_PENDING amber state on dashboard + `pm-sync-failed` Socket.IO event + frontend banner

### Critical: Dependency on CS3-3

CS3-3 scopes these variables before the outer `try` block in `DeploymentStatusSyncService.syncToClickUp()`:

```typescript
let integration: ProjectIntegration | null = null;
let targetStatus: string | undefined;
let lastMissingFields: NormalizedField[] = [];
let ticketInternalId: string | undefined; // already from CS3-2
let ticketClickupId: string | undefined; // already from CS3-2
```

CS3-4 adds one more scoped variable:

```typescript
let ticketProjectId: string | undefined; // ← CS3-4 adds this
```

All 6 variables are declared before the outer try and assigned inside the main try block once `execution.ticket` is resolved. The final declaration block before the outer try:

```typescript
let ticketInternalId: string | undefined;
let ticketClickupId: string | undefined;
let ticketProjectId: string | undefined; // ← CS3-4
let integration: ProjectIntegration | null = null; // CS3-3
let targetStatus: string | undefined; // CS3-3
let lastMissingFields: NormalizedField[] = []; // CS3-3
```

Assignment inside main try (around line 144):

```typescript
ticketInternalId = execution.ticket.id;
ticketClickupId = execution.ticket.clickup_task_id;
ticketProjectId = execution.ticket.project_id; // ← CS3-4
```

**If CS3-3 has NOT yet been merged when implementing CS3-4**: include all CS3-3 variable declarations and the `postActionableFailureComment` integration as well (both stories can be merged together).

### Socket.IO Event Design

**Event name:** `pm-sync-failed`

**Emission target:** `role:PM` via `RealtimeService.emitToRole('PM', ...)`. PMs auto-join the `role:PM` room on socket connection via `handleConnection()` in `RealtimeGateway` — they receive events without needing to explicitly join a project room.

**Payload interface:**

```typescript
{
  ticketId: string | undefined;   // ClickUp external task ID (from ticketClickupId)
  projectId: string;              // Internal DSF project UUID — used by frontend to update correct project card
  provider: string;               // 'CLICKUP'
  reason: string;                 // Human-readable failure reason
  missingFields: NormalizedField[] | [];  // Fields that could not be filled (from CS3-2/CS3-3 context)
}
```

**Do NOT emit** to `role:MANAGER` or `role:ADMIN` — the spec (FR-CS18) specifies "PM's room". PMs are the direct stakeholders for sync failures.

**Note:** `RealtimeService.emitToRole()` is synchronous (not async). No `await` needed. Wrap in try/catch as best-effort only.

### `getProjects()` Ticket Select Change

Current (before CS3-4):

```typescript
tickets: {
  select: {
    status: true,
    updated_at: true,
  },
},
```

After CS3-4:

```typescript
tickets: {
  select: {
    status: true,
    pm_synced: true,   // ← CS3-4: must add for computation below
    updated_at: true,
  },
},
```

The `pm_synced` field exists on the `Ticket` model (added in CS3-2, `pm_synced Boolean @default(true)` in `prisma/schema.prisma`). No migration needed.

### `getSummary()` Promise.all Expansion

Current has 7 parallel queries. CS3-4 adds 8th. The existing destructuring must match the expanded array:

```typescript
const [
  projectStats,
  ticketStats,
  aiExecutionTimes,
  aiExecutionCounts,
  activeProjectsCount,
  qaTotal,
  qaPassed,
  syncPendingTickets,   // ← 8th query result
] = await Promise.all([
  // query 1: projectStats (existing)
  this.prisma.project.aggregate({ where: projectWhere, _count: { id: true } }),
  // query 2: ticketStats (existing)
  this.prisma.ticket.groupBy({ by: ['status'], where: ticketsWhere, _count: { id: true } }),
  // query 3: aiExecutionTimes (existing)
  this.prisma.execution.findMany({ ... }),
  // query 4: aiExecutionCounts (existing)
  this.prisma.execution.groupBy({ ... }),
  // query 5: activeProjectsCount (existing)
  this.prisma.project.count({ where: { ...projectWhere, status: 'active' } }),
  // query 6: qaTotal (existing)
  this.prisma.qAResult.count({ where: { execution: { ticket: ticketsWhere } } }),
  // query 7: qaPassed (existing)
  this.prisma.qAResult.count({ where: { execution: { ticket: ticketsWhere }, overall_passed: true } }),
  // query 8: syncPendingTickets ← CS3-4 NEW
  this.prisma.ticket.count({
    where: {
      ...ticketsWhere,
      pm_synced: false,
      status: { in: ['COMPLETED', 'DEPLOYED'] },
    },
  }),
]);
```

### Module Registration: RealtimeModule → GitHubModule

`RealtimeModule` is a standalone module that exports `RealtimeService`. There is no circular dependency between `RealtimeModule` and `GitHubModule`. Use a plain import (no `forwardRef` needed):

```typescript
// github.module.ts
import { RealtimeModule } from '@/realtime/realtime.module';

@Module({
  imports: [
    // ... existing imports ...
    IntegrationsModule,
    RealtimeModule, // ← CS3-4 adds
    forwardRef(() => ExecutionModule),
  ],
  // ...
})
export class GitHubModule {}
```

Run `pnpm build` after this change to confirm no circular dependency is introduced.

### Frontend ProjectCard Badge Placement

The current card header area (lines 81–95) shows the `APPROVAL` badge when `project.tickets.awaiting_approval > 0`. The SYNC PENDING badge follows the same pattern:

```tsx
{
  /* Header */
}
<div className="flex justify-between items-start mb-4">
  <div className="flex-1 min-w-0">{/* ... project name and client ... */}</div>
  <div className="flex items-center gap-2">
    {/* ← CS3-4: SYNC PENDING badge (amber) */}
    {(project.tickets.sync_pending ?? 0) > 0 && (
      <div className="flex flex-col items-end gap-1">
        <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-md text-[10px] font-bold animate-pulse flex items-center gap-1">
          <Clock className="w-3 h-3" />
          SYNC PENDING
        </span>
        <span className="text-[10px] text-muted-foreground">
          {project.tickets.sync_pending} ticket(s)
        </span>
      </div>
    )}
    {/* existing APPROVAL badge */}
    {project.tickets.awaiting_approval > 0 && (
      <div className="flex flex-col items-end gap-1">
        <span className="bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-md text-[10px] font-bold animate-pulse flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          APPROVAL
        </span>
        <span className="text-[10px] text-muted-foreground">
          {project.tickets.awaiting_approval} ticket(s)
        </span>
      </div>
    )}
    <button className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-[var(--surface-1)] transition-colors">
      <MoreVertical className="w-4 h-4" />
    </button>
  </div>
</div>;
```

`Clock` is already imported at line 8 of `ProjectCard.tsx`. No new imports needed.

### Frontend Toast: `react-hot-toast` Already Installed

The `import { toast } from 'react-hot-toast';` is already present in `Dashboard.tsx` at line 6 but commented out. Simply uncomment it. The `react-hot-toast` library is already installed and the `<Toaster>` component is likely mounted at the app root (check `App.tsx` if toast doesn't render — add `<Toaster />` there if missing).

### `useProjectUpdates` — Event Listener Pattern

Follow the exact same cleanup pattern as existing listeners in the hook:

```typescript
export const useProjectUpdates = (
  socket: Socket | null,
  setProjects: React.Dispatch<React.SetStateAction<Project[]>>,
) => {
  useEffect(() => {
    if (!socket) return;

    socket.on('project-updated', (updatedProject: Project) => {
      setProjects((prev) => prev.map((p) => (p.id === updatedProject.id ? updatedProject : p)));
    });

    socket.on('ticket-updated', (data: { project_id: string; tickets: any }) => {
      setProjects((prev) =>
        prev.map((p) => (p.id === data.project_id ? { ...p, tickets: data.tickets } : p)),
      );
    });

    // CS3-4: pm-sync-failed event — increment sync_pending count on affected project
    socket.on(
      'pm-sync-failed',
      (data: {
        projectId: string;
        ticketId: string;
        provider: string;
        reason: string;
        missingFields: unknown[];
      }) => {
        setProjects((prev) =>
          prev.map((p) =>
            p.id === data.projectId
              ? { ...p, tickets: { ...p.tickets, sync_pending: (p.tickets.sync_pending ?? 0) + 1 } }
              : p,
          ),
        );
      },
    );

    return () => {
      socket.off('project-updated');
      socket.off('ticket-updated');
      socket.off('pm-sync-failed'); // ← CS3-4: add cleanup
    };
  }, [socket, setProjects]);
};
```

### Previous Story Intelligence (CS3-3 → CS3-4)

From CS3-3 (`CS3-3-actionable-failure-comment.md`):

- `PMActionableFailureCommentService` will be injected into `DeploymentStatusSyncService` as the last constructor dependency
- CS3-4's `RealtimeService` is added AFTER `PMActionableFailureCommentService` in the constructor
- Both CS3-3 and CS3-4 comment blocks in the soft failure path use best-effort try/catch
- CS3-4 block is always AFTER CS3-3 block in both soft failure and exception paths
- `IntegrationsModule` is already imported in `GitHubModule` (added in CS2) — do NOT add it again

From CS3-2 (done):

- `pm_synced Boolean @default(true)` exists on `Ticket` model — field is queryable
- `ticketInternalId` and `ticketClickupId` are already scoped before outer try
- Both soft failure and exception paths already set `pm_synced=false` and record audit logs

From git history (`bda831f feat: add pm_synced tracking for ticket sync status`) and current working tree:

- CS3-2 is fully implemented and committed
- **CS3-3 is already implemented** (status: `completed` in sprint-status, working tree changes unstaged):
  - `PMActionableFailureCommentService` is imported (line 18) and injected as `pmFailureCommentService` (line 48)
  - CS3-3 scoped variables already declared at lines 71–74: `integration`, `targetStatus`, `lastMissingFields`
  - CS3-3 soft failure comment block already in `if (!statusUpdated)` path (lines 333–350)
  - CS3-3 hard failure comment block already in `catch (_error)` path (lines 470–492)
  - `pm-actionable-failure-comment.service.ts` and `.spec.ts` exist as untracked files in `src/integrations/`
- **CS3-4 adds on top of the existing CS3-3 implementation** — do NOT re-add CS3-3 blocks

### SYNC_PENDING State: Not a Ticket Status Enum Value

`SYNC_PENDING` is a **derived state**, not a new `TicketStatus` enum value in Prisma. It is computed from:

- `ticket.status IN ('COMPLETED', 'DEPLOYED')` — execution is done
- `ticket.pm_synced = false` — but PM tool not updated

Do NOT add `SYNC_PENDING` to the `TicketStatus` enum in `prisma/schema.prisma`. This avoids a migration and keeps the existing execution state machine intact.

### Project Structure Notes

| File                                                         | Change Type       | Repo     | Notes                                                                                                |
| ------------------------------------------------------------ | ----------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `src/github/services/deployment-status-sync.service.ts`      | **MODIFY**        | Backend  | Scope `ticketProjectId`; inject `RealtimeService`; add CS3-4 emission blocks in both failure paths   |
| `src/github/services/deployment-status-sync.service.spec.ts` | **MODIFY**        | Backend  | Mock `RealtimeService`; add T-SE1–T-SE6                                                              |
| `src/github/github.module.ts`                                | **MODIFY**        | Backend  | Add `RealtimeModule` to imports                                                                      |
| `src/dashboards/dto/pm-dashboard.dto.ts`                     | **MODIFY**        | Backend  | Add `sync_pending` to `TicketCountsDto`; `sync_pending_tickets` to `DashboardSummaryDto`             |
| `src/dashboards/services/pm-dashboard.service.ts`            | **MODIFY**        | Backend  | Add `pm_synced` to ticket select; compute `sync_pending`; add `sync_pending_tickets` KPI query       |
| `src/dashboards/services/pm-dashboard.service.spec.ts`       | **NEW or MODIFY** | Backend  | T-SD1–T-SD4                                                                                          |
| `src/types/index.ts`                                         | **MODIFY**        | Frontend | Add `sync_pending?: number` to `TicketCounts`; `sync_pending_tickets?: number` to `DashboardSummary` |
| `src/components/dashboard/ProjectCard.tsx`                   | **MODIFY**        | Frontend | Amber SYNC PENDING badge (amber, uses existing `Clock` import)                                       |
| `src/hooks/useProjectUpdates.ts`                             | **MODIFY**        | Frontend | Add `pm-sync-failed` socket listener; increment `sync_pending`; cleanup in return                    |
| `src/pages/Dashboard.tsx`                                    | **MODIFY**        | Frontend | Uncomment `toast` import; add `useEffect` for `pm-sync-failed` toast                                 |

**Do NOT touch:**

- `prisma/schema.prisma` — `pm_synced` field already exists (CS3-2)
- `src/integrations/pm-actionable-failure-comment.service.ts` — CS3-3 story owns this
- `src/integrations/integrations.module.ts` — already modified by CS3-3
- Any CS3-1 or CS3-2 files (done)
- `RealtimeModule` or `RealtimeService` internals — only consume via injection

### Architecture Compliance

- **`@/` path aliases** — backend imports; frontend uses relative or `@/` as configured
- **Fail-open** — all CS3-4 socket emission blocks in try/catch, never block the main execution path
- **Synchronous emission** — `RealtimeService.emitToRole()` is synchronous; no `await` needed
- **TypeScript strict** — `ticketProjectId: string | undefined` explicit union; no implicit `any`
- **No page refresh** — frontend state updated optimistically via socket event; no API refetch triggered

### References

- FR-CS17: PM dashboard SYNC_PENDING state [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #FR-CS17]
- FR-CS18: `pm-sync-failed` Socket.IO event [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #FR-CS18]
- Story 3.4 ACs [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #Story-3.4]
- NFR-CS4: Dashboard surfacing when PM tool unavailable [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #NFR-CS4]
- `DeploymentStatusSyncService` [Source: `src/github/services/deployment-status-sync.service.ts`]
- `PmDashboardService` [Source: `src/dashboards/services/pm-dashboard.service.ts`]
- PM Dashboard DTOs [Source: `src/dashboards/dto/pm-dashboard.dto.ts`]
- `RealtimeService` [Source: `src/realtime/realtime.service.ts`]
- `RealtimeModule` [Source: `src/realtime/realtime.module.ts`]
- `GitHubModule` [Source: `src/github/github.module.ts`]
- `ProjectCard` [Source: `src/components/dashboard/ProjectCard.tsx` — frontend repo]
- `useProjectUpdates` [Source: `src/hooks/useProjectUpdates.ts` — frontend repo]
- `Dashboard` page [Source: `src/pages/Dashboard.tsx` — frontend repo]
- Frontend types [Source: `src/types/index.ts` — frontend repo]
- CS3-3 story (predecessor) [Source: `_bmad-output/implementation-artifacts/CS3-3-actionable-failure-comment.md`]

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `src/github/services/deployment-status-sync.service.ts` — scoped `ticketProjectId`; injected `RealtimeService`; CS3-4 socket emission blocks (soft failure + exception paths); fixed emission guard and correlation-ID log format
- `src/github/services/deployment-status-sync.service.spec.ts` — mocked `RealtimeService`; added T-SE1–T-SE6
- `src/github/github.module.ts` — added `RealtimeModule` to imports with `@/` path alias
- `src/dashboards/dto/pm-dashboard.dto.ts` — added `sync_pending` to `TicketCountsDto`; `sync_pending_tickets` to `DashboardSummaryDto` with descriptions and defaults
- `src/dashboards/services/pm-dashboard.service.ts` — added `pm_synced` to ticket select; computed `sync_pending`; added 8th `syncPendingTickets` query
- `src/dashboards/services/pm-dashboard.service.spec.ts` — added T-SD1–T-SD3 labeled tests; fixed mock data to include `client_name` and `pm_synced`
- `/Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/types/index.ts` — `sync_pending: number` in `TicketCounts`; `sync_pending_tickets: number` in `DashboardSummary`
- `/Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/components/dashboard/ProjectCard.tsx` — amber SYNC PENDING badge with `flex-col` wrapper, `animate-pulse`, ticket count label
- `/Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/hooks/useProjectUpdates.ts` — `pm-sync-failed` socket listener; `?? 0` guard; removed `onSyncFailed` callback (toast separated to Dashboard)
- `/Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/pages/Dashboard.tsx` — dedicated `useEffect` for amber toast on `pm-sync-failed` with correct message format and amber styling
