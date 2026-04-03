# Story FE-1.1: Detect QA_FAILED State & Surface Resolution Prompt

Status: ready-for-dev

## Story

As a **PM watching an execution**,
I want the execution card to immediately reflect `QA_FAILED` state when it occurs and show a prompt to act,
so that I know I need to make a decision without refreshing the page.

## Acceptance Criteria

**AC-1: QA_FAILED status badge on execution card**
Given the frontend has an active WebSocket connection
When the server emits `execution.qa_failed` with `executionId`
Then the execution card updates in real time to show a red `QA_FAILED` status badge — no page refresh required (FR-EXT9)

**AC-2: QA failure action prompt**
Given the execution card is showing `QA_FAILED`
When the PM views it
Then a visible prompt appears: "QA failed after [N] retries — action required" with a "Resolve" button
Where N is `qaRetryCount` from the WebSocket event payload (falls back to empty if absent)

**AC-3: Card does not auto-dismiss**
Given the execution card is in `QA_FAILED` state
When the PM has not yet clicked "Resolve"
Then the card remains in `QA_FAILED` state — it does NOT auto-redirect, auto-dismiss, or transition

**AC-4: Card updates when another PM resolves it**
Given the execution card is in `QA_FAILED` state
When another PM resolves it via the API (triggering `execution.completed` or `execution.failed` WebSocket event)
Then the card updates to `COMPLETED` or `FAILED` state in real time via the existing event handlers

**AC-5: TypeScript compiles clean**
Given all changes applied across dsf-dashboard repo
When `pnpm build` and `pnpm typecheck` run
Then zero TypeScript errors — `QA_FAILED` is a fully typed member of `ExecutionStatus`

---

## Tasks / Subtasks

### Task 1: Extend `ExecutionStatus` type and `Execution` interface (`src/types/execution.ts`)

- [ ] 1.1 Add `'QA_FAILED'` to the `ExecutionStatus` union after `'AWAITING_APPROVAL'`:

  ```typescript
  export type ExecutionStatus =
    | 'QUEUED'
    | 'IN_PROGRESS'
    | 'PAUSED'
    | 'COMPLETED'
    | 'FAILED'
    | 'TIMEOUT'
    | 'CANCELLED'
    | 'AWAITING_APPROVAL'
    | 'QA_FAILED'; // FE-1.1: hard QA failure state (WR-4.1)
  ```

- [ ] 1.2 Add `qaRetryCount` and `qaFailedBranch` to the `Execution` interface after `errorMessage`:

  ```typescript
  errorMessage?: string;
  qaRetryCount?: number;           // FE-1.1: populated from execution.qa_failed event
  qaFailedBranch?: string | null;  // FE-1.1: branch name for PM resolution (FE-1.2)
  ```

- [ ] 1.3 Add `'QA_FAILED': []` to `CONTROL_BUTTON_MATRIX` — QA_FAILED is a terminal/pending-PM state with no auto-controls:
  ```typescript
  'QA_FAILED': [],
  ```

---

### Task 2: Add `QA_FAILED` event to socket layer (`src/lib/socket/socketEvents.ts`)

- [ ] 2.1 Add `QA_FAILED: 'execution.qa_failed'` to `ExecutionEvents`:

  ```typescript
  export const ExecutionEvents = {
    ...
    // QA failure state (WR-4.1 backend, FE-1.1 frontend)
    QA_FAILED: 'execution.qa_failed',
  } as const;
  ```

- [ ] 2.2 Add `'QA_FAILED'` to the `status` union in `ExecutionEventPayload`:

  ```typescript
  status: 'QUEUED' |
    'IN_PROGRESS' |
    'PAUSED' |
    'COMPLETED' |
    'FAILED' |
    'TIMEOUT' |
    'CANCELLED' |
    'AWAITING_APPROVAL' |
    'QA_FAILED';
  ```

- [ ] 2.3 Add `QAFailedEventPayload` interface matching the backend's `ExecutionQAFailedEvent.payload` shape (from `src/realtime/realtime.types.ts` in dsf-backend):
  ```typescript
  /** Payload emitted with the 'execution.qa_failed' WebSocket event (FE-1.1) */
  export interface QAFailedEventPayload {
    executionId: string;
    ticketId: string;
    projectId: string | null;
    provider: string;
    status: string; // always 'QA_FAILED'
    timestamp: string;
    payload: {
      errorMessage: string;
      branchName: string | null;
      qaRetryCount?: number;
    };
  }
  ```

---

### Task 3: Add `onQAFailed` handler to `useExecutionEvents` (`src/lib/socket/useSocketIO.ts`)

- [ ] 3.1 Import `QAFailedEventPayload` from `./socketEvents`

- [ ] 3.2 Add `onQAFailed?: (payload: QAFailedEventPayload) => void` to the `handlers` parameter type of `useExecutionEvents`

- [ ] 3.3 In the `useEffect` inside `useExecutionEvents`, add the handler binding alongside existing ones:

  ```typescript
  const handleQAFailed = (payload: QAFailedEventPayload) =>
    handlersRef.current.onQAFailed?.(payload);

  socket.on(ExecutionEvents.QA_FAILED, handleQAFailed);
  // ...
  // cleanup:
  socket.off(ExecutionEvents.QA_FAILED, handleQAFailed);
  ```

  Follow the same ref-based dispatch pattern as `handleCompleted`, `handleFailed`, etc.

---

### Task 4: Add `QA_FAILED` status config and prompt to `ExecutionCard` (`src/components/execution/ExecutionCard.tsx`)

- [ ] 4.1 Add `QA_FAILED` entry to `statusConfig` using Traffic Light red (consistent with `FAILED`):

  ```typescript
  'QA_FAILED': {
    label: 'QA Failed',
    color: 'text-rose-500',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/30',
  },
  ```

- [ ] 4.2 Add `onResolve?: (executionId: string) => void` to `ExecutionCardProps` — this is the callback FE-1.2 will wire to the PM Resolution Modal:

  ```typescript
  interface ExecutionCardProps {
    execution: Execution;
    onViewLogs?: (executionId: string) => void;
    onResolve?: (executionId: string) => void; // FE-1.1: handler for QA_FAILED Resolve button
    socket?: ReturnType<typeof import('@/lib/socket/useSocketIO').useSocketIO>['socket'];
  }
  ```

- [ ] 4.3 Add `ShieldAlert` to the lucide-react import for the QA failure prompt icon

- [ ] 4.4 Add `onResolve` to the destructured component parameters

- [ ] 4.5 Inside the card JSX, add a QA failure prompt section rendered conditionally when `execution.status === 'QA_FAILED'`. Insert it after the progress bar area and before the footer controls:
  ```tsx
  {
    execution.status === 'QA_FAILED' && (
      <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-rose-400 text-sm">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>
            QA failed
            {execution.qaRetryCount !== undefined
              ? ` after ${execution.qaRetryCount} retr${execution.qaRetryCount === 1 ? 'y' : 'ies'}`
              : ''}{' '}
            — action required
          </span>
        </div>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => onResolve?.(execution.id)}
          aria-label={`Resolve QA failure for execution ${execution.id}`}
        >
          Resolve
        </Button>
      </div>
    );
  }
  ```

---

### Task 5: Wire `onQAFailed` event and `QA_FAILED` filter in `ExecutionMonitoringDashboard.tsx`

- [ ] 5.1 Add `QA_FAILED` to `statusFilters` array (after `'FAILED'`):

  ```typescript
  {
    label: 'QA Failed',
    value: 'QA_FAILED',
    icon: <ShieldAlert className="w-4 h-4" />,
    color: 'text-rose-500',
    activeColor: 'text-white',
    activeBg: 'bg-rose-600'
  },
  ```

  Import `ShieldAlert` from lucide-react.

- [ ] 5.2 Import `QAFailedEventPayload` from `@/lib/socket/socketEvents`

- [ ] 5.3 Add `onQAFailed` handler inside the `useExecutionEvents(socket, { ... })` call. This handler must update the query cache with the full QA_FAILED context (status + qaRetryCount + qaFailedBranch). Use `queryClient.setQueryData` — NOT `updateExecutionStatus` (that only patches `status`):

  ```typescript
  onQAFailed: (payload: QAFailedEventPayload) => {
    toast.error(
      `Execution ${payload.executionId.slice(0, 8)} — QA failed after ${payload.payload.qaRetryCount ?? '?'} retries. Resolve required.`
    );
    queryClient.setQueryData(
      executionKeys.activeFiltered(undefined),
      (oldData: any[] | undefined) => {
        if (!oldData) return oldData;
        return oldData.map((exec) =>
          exec.id === payload.executionId
            ? {
                ...exec,
                status: 'QA_FAILED',
                qaRetryCount: payload.payload.qaRetryCount,
                qaFailedBranch: payload.payload.branchName,
                errorMessage: payload.payload.errorMessage,
              }
            : exec,
        );
      },
    );
  },
  ```

- [ ] 5.4 Add `onResolve` prop to `<ExecutionCard>` usage in the JSX. For FE-1.1, pass a no-op placeholder — FE-1.2 will replace this with the modal open handler:
  ```tsx
  <ExecutionCard
    key={execution.id}
    execution={execution}
    onViewLogs={handleViewLogs}
    onResolve={(_executionId) => {
      /* TODO FE-1.2: open PM Resolution Modal */
    }}
    socket={socket}
  />
  ```

---

### Task 6: Write unit tests for `ExecutionCard` QA_FAILED rendering

- [ ] 6.1 In `src/components/execution/__tests__/ExecutionCard.test.tsx` (create if absent), add test cases:

  **Test A** — QA_FAILED badge renders with red label:

  ```typescript
  it('renders QA_FAILED status badge with correct label', () => {
    const execution = buildMockExecution({ status: 'QA_FAILED', qaRetryCount: 3 });
    render(<ExecutionCard execution={execution} />);
    expect(screen.getByText('QA Failed')).toBeInTheDocument();
  });
  ```

  **Test B** — QA failure prompt with retry count renders:

  ```typescript
  it('renders QA failure prompt with retry count when status is QA_FAILED', () => {
    const execution = buildMockExecution({ status: 'QA_FAILED', qaRetryCount: 3 });
    render(<ExecutionCard execution={execution} />);
    expect(screen.getByText(/QA failed after 3 retries — action required/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resolve/i })).toBeInTheDocument();
  });
  ```

  **Test C** — Prompt hidden for other statuses:

  ```typescript
  it('does not render QA failure prompt for non-QA_FAILED status', () => {
    const execution = buildMockExecution({ status: 'IN_PROGRESS' });
    render(<ExecutionCard execution={execution} />);
    expect(screen.queryByRole('button', { name: /resolve/i })).not.toBeInTheDocument();
  });
  ```

  **Test D** — onResolve fires on button click:

  ```typescript
  it('calls onResolve with executionId when Resolve button is clicked', async () => {
    const onResolve = vi.fn();
    const execution = buildMockExecution({ status: 'QA_FAILED', qaRetryCount: 2 });
    render(<ExecutionCard execution={execution} onResolve={onResolve} />);
    await userEvent.click(screen.getByRole('button', { name: /resolve/i }));
    expect(onResolve).toHaveBeenCalledWith(execution.id);
  });
  ```

---

### Task 7: Verify build

- [ ] 7.1 Run `pnpm typecheck` — zero errors
- [ ] 7.2 Run `pnpm build` — zero errors
- [ ] 7.3 Run `pnpm test` — all tests pass (existing + new)

---

## Dev Notes

### THIS STORY SCOPE — FE-1.1 ONLY

FE-1.1 is the **detection + prompt layer** only:

- **In scope:** `QA_FAILED` type, socket subscription, card badge, "QA failed... action required" text, "Resolve" button (fires `onResolve` callback)
- **Out of scope:** The PM Resolution Modal (FE-1.2), the `POST /resolve-qa-failure` API call (FE-1.2), QA Results Panel (FE-1.3)

The "Resolve" button MUST fire `onResolve` callback — do NOT inline the modal in FE-1.1.

---

### Repo Clarification — This Is a Frontend Story

**All implementation is in the `dsf-dashboard` repo** at `/Volumes/Data/project/products/alpharages/dsf-dasbhoard`, not in `dsf-backend`. The story file lives in the backend repo for sprint tracking only.

```
/Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/
├── types/execution.ts                    ← Task 1
├── lib/socket/socketEvents.ts            ← Task 2
├── lib/socket/useSocketIO.ts             ← Task 3
├── components/execution/ExecutionCard.tsx   ← Task 4
├── pages/ExecutionMonitoringDashboard.tsx  ← Task 5
└── components/execution/__tests__/ExecutionCard.test.tsx  ← Task 6
```

Frontend commands (run from dsf-dashboard root):

```bash
pnpm typecheck     # pnpm build does tsc --noEmit first
pnpm build         # type-check + production build
pnpm test          # Vitest (run once)
pnpm dev           # dev server on :5173
```

---

### Backend WebSocket Event Contract (Already Implemented — WR-4.1)

The backend emits `execution.qa_failed` (NOT `execution.failed`) when QA retries are exhausted. Source: `src/execution/execution-tracker.service.ts:495`.

**`ExecutionQAFailedEvent` shape** (from `src/realtime/realtime.types.ts` in dsf-backend):

```typescript
{
  executionId: string;    // e.g. "abc-123"
  ticketId: string;       // e.g. "ticket-456"
  projectId: string | null;
  provider: string;       // e.g. "claude-code"
  status: string;         // always "QA_FAILED"
  timestamp: string;      // ISO-8601
  payload: {
    errorMessage: string;  // last QA error output
    branchName: string | null;  // pushed branch, e.g. "feature/fix-bug-abc"
    qaRetryCount?: number; // number of retries exhausted
  };
}
```

`QAFailedEventPayload` in `socketEvents.ts` (Task 2.3) must exactly mirror this shape.

---

### Socket Event Name: `execution.qa_failed`

The backend emits to the project room: `realtimeService.emitToProject(projectId, 'execution.qa_failed', payload)`.

The frontend must subscribe to the **exact string** `'execution.qa_failed'`. This is already captured as `ExecutionEvents.QA_FAILED` after Task 2.1.

**`useExecutionEvents` uses string literals** in the `socket.on()` calls (e.g. `socket.on('execution.failed', handleFailed)`). After Task 3, use `ExecutionEvents.QA_FAILED` (i.e. the constant) rather than the raw string — for consistency with how `ExecutionEvents.ACTIVITY` is used in `useActivityEvents`.

---

### Pattern: `useExecutionEvents` handler signature mismatch

The existing `useExecutionEvents` handlers all accept `ExecutionEventPayload`. The `execution.qa_failed` event has a **different** payload shape (`QAFailedEventPayload`). This is intentional — the backend uses a dedicated typed event.

In `useSocketIO.ts`, the `onQAFailed` handler must use `QAFailedEventPayload`, NOT `ExecutionEventPayload`. The `handlersRef` ref holds all handlers together — TypeScript will enforce the typing on the handler field.

---

### Pattern: `updateExecutionStatus` is NOT sufficient for QA_FAILED

`updateExecutionStatus` in `ExecutionMonitoringDashboard.tsx:123` only patches `status`. For `QA_FAILED`, the card also needs `qaRetryCount` and `qaFailedBranch` from the event payload to render the correct prompt text and pass the branch to FE-1.2 modal.

**Use `queryClient.setQueryData` directly** in the `onQAFailed` handler (Task 5.3) — it merges all three fields atomically. Do NOT call `updateExecutionStatus` and then patch separately.

---

### Pattern: Cache key for active executions

The active executions TanStack Query cache key is:

```typescript
executionKeys.activeFiltered(undefined); // ['executions', 'active', { filters: undefined }]
```

This is the same key used by `updateExecutionStatus` and `onProgress`. When `onQAFailed` fires, always patch this key (not `executionKeys.detail(id)`) because `ExecutionMonitoringDashboard` renders from the active list, not individual detail queries.

---

### `ExecutionCard` statusConfig — TypeScript exhaustiveness

`statusConfig` is typed as `Record<ExecutionStatus, ...>`. After adding `'QA_FAILED'` to `ExecutionStatus` (Task 1.1), TypeScript will immediately report a type error in `ExecutionCard.tsx` because `statusConfig` is missing the `QA_FAILED` key. Task 4.1 adds it — both tasks must be completed together before `pnpm typecheck` passes.

The same applies to `CONTROL_BUTTON_MATRIX` in `execution.ts` — it must have an entry for every member of `ExecutionStatus`.

---

### `ExecutionCard` render location for the QA prompt

Insert the QA prompt **after** the progress bar section and **before** the footer/controls row. Looking at the existing ExecutionCard JSX structure, the recommended insertion point is after the `{/* Progress section */}` block (if present for IN_PROGRESS) and before the `{/* Controls */}` block. Render it at the bottom of the card body.

---

### Pluralisation of "retry/retries"

Use: `execution.qaRetryCount === 1 ? 'retry' : 'retries'`. This handles the edge case of `qaMaxRetries=1`.

When `qaRetryCount` is `undefined` (older executions before WR-6.2 lands), the text degrades to "QA failed — action required" (no retry count). This is the correct graceful fallback.

---

### ARIA label on "Resolve" button

The `aria-label` must include the execution ID to be distinguishable for screen readers when multiple QA_FAILED cards are present on the dashboard at once:

```tsx
aria-label={`Resolve QA failure for execution ${execution.id}`}
```

---

### No new API functions in FE-1.1

Do NOT add `resolveQaFailure()` to `src/api/executionsApi.ts` in this story. That is FE-1.2 work. The `onResolve` callback in `ExecutionCard` is a UI wiring point only — the API call happens in the modal (FE-1.2).

---

### Test setup: `buildMockExecution` helper

If `buildMockExecution` doesn't exist in the test file, define a simple factory:

```typescript
function buildMockExecution(overrides: Partial<Execution>): Execution {
  return {
    id: 'exec-test-1',
    ticketId: 'ticket-1',
    projectId: 'proj-1',
    projectName: 'Test Project',
    status: 'IN_PROGRESS',
    aiProvider: 'claude-code',
    currentStep: 'Building',
    percentComplete: 50,
    startTime: new Date().toISOString(),
    duration: 120,
    ...overrides,
  };
}
```

---

### Verify CONTROL_BUTTON_MATRIX exhaustiveness

`CONTROL_BUTTON_MATRIX` in `src/types/execution.ts` is typed as `Record<ExecutionStatus, ControlAction[]>`. After adding `'QA_FAILED'` to `ExecutionStatus`, the matrix must have a `'QA_FAILED': []` entry or TypeScript errors. Add it alongside `'COMPLETED': []` (both are terminal-ish states with no available controls).

---

### Previous Story Context (WR-6.1, last story in this sprint)

WR-6.1 (current `ready-for-dev`) adds the `QAAttempt` interface and `qa_attempts` DB column. It is a **backend-only** story and does not touch the frontend or the WebSocket event. FE-1.1 is independent of WR-6.1 — the `execution.qa_failed` WebSocket event was implemented in WR-4.1 (committed: `a10ca84 feat(wr-4.1)`).

The PM Resolution endpoint `POST /api/v1/executions/:id/resolve-qa-failure` is live (committed: `542281a feat(wr-4.3)`). FE-1.2 will call it; FE-1.1 only surfaces the "Resolve" button.

---

### References

- FR-EXT9: WebSocket detects `QA_FAILED` state — `_bmad-output/planning-artifacts/epics-workspace-removal-extensions.md`
- UX-DR2: Traffic Light red for `qa-failed` — same file
- NFR-EXT4: ARIA labels on buttons — same file
- Backend `ExecutionQAFailedEvent`: `src/realtime/realtime.types.ts:93`
- Backend event emit: `src/execution/execution-tracker.service.ts:495`
- Backend endpoint: `POST /api/v1/executions/:id/resolve-qa-failure` — `src/execution/execution.controller.ts:42`
- WR-4.1 commit: `a10ca84` (QA_FAILED state machine, includes WebSocket event emission)
- WR-4.3 commit: `542281a` (PM resolution endpoint)

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
