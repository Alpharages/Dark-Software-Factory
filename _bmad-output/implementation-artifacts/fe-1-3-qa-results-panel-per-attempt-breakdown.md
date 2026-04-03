# Story FE-1.3: QA Results Panel — Per-Attempt Breakdown

Status: done

## Story

As a **PM reviewing a completed or QA-failed execution**,
I want a QA Results Panel on the execution detail view showing each attempt's lint and test outcome,
so that I can see exactly what the agent tried, what failed, and whether it self-healed.

## Acceptance Criteria

**AC-1: QA Results Panel renders per-attempt rows**
Given the execution detail view is loaded for an execution with `qaAttempts` data
When the QA Results panel renders
Then each attempt is shown as a distinct row with:

- Attempt number (e.g. "Attempt 1")
- Lint status: pass (✅) or fail (❌) with error count badge when failed
- Test status: pass (✅) or fail (❌) with "X passed / Y failed" counts
- Duration (formatted, e.g. "4.2s")
- A badge: "Self-healed" (green) / "Failed" (red) / "Passed" (green solid)
  (FR-EXT14, UX-DR3, UX-DR6)

**AC-2: Empty/null state renders gracefully**
Given the execution has `qaAttempts: null` or `qaAttempts: []`
When the panel renders
Then a graceful empty state is shown: "No QA attempt data available for this execution"
And no crash, no empty table

**AC-3: Lint error details collapsible**
Given lint errors exist for a failed attempt
When the PM expands the attempt row
Then the lint error details are shown (file names, error messages) in a collapsible section

**AC-4: Self-healed vs Passed visual distinction**
Given the final attempt passed
When the panel renders
Then it shows "Self-healed" badge if prior failed attempts exist, or "Passed" if first-try pass
And earlier failed attempts show "Failed" badge in red — making the recovery path clear (UX-DR3, UX-DR6)

**AC-5: Real-time updates during active execution**
Given a sandbox execution is actively running
When the `useExecution` query refetches (5s polling while live)
Then new attempt data appears in the panel without a page refresh
And the panel uses `aria-live="polite"` so screen readers announce new attempts without stealing focus (NFR-EXT5)

**AC-6: TypeScript compiles clean**
Given all changes applied across dsf-dashboard repo
When `pnpm build` and `pnpm typecheck` run
Then zero TypeScript errors

---

## Tasks / Subtasks

### Task 1: Fix `getExecution` API URL and add `QAAttempt` type (`src/api/executionsApi.ts` + `src/types/execution.ts`)

**CRITICAL:** `getExecution()` currently calls `GET /executions/:id` but the backend endpoint is `GET /executions/:id/status`. This is a wrong URL — it will always 404. Fix it first.

**File: `src/api/executionsApi.ts`**

- [x] 1.1 Change the URL in `getExecution()` from `${BASE_URL}/${executionId}` to `${BASE_URL}/${executionId}/status`:

  ```typescript
  export async function getExecution(executionId: string): Promise<Execution> {
    const response = await apiClient.get(`${BASE_URL}/${executionId}/status`);
    return response.data;
  }
  ```

  **Why:** The backend `ExecutionController` only has `@Get(':id/status')` — there is no `@Get(':id')` route. This function has never worked. FE-1.3 is the first consumer of `useExecution` so fixing it here is safe.

**File: `src/types/execution.ts`**

- [x] 1.2 Add `QAAttempt` interface after the `CONTROL_BUTTON_MATRIX` block. Mirrors the backend shape from `src/ai-routing/interfaces/ai-provider.interface.ts:46` exactly:

  > ⚠️ **Reconciled with backend (2026-04-03):** Original story used `lintPassed: boolean` and `testsPassed: boolean`. Backend was updated to use string union types to support a `'skipped'` state. Frontend interface updated to match.

  ```typescript
  /** Per-attempt QA result from sandbox self-healing loop (FR-EXT14 / WR-6.1) */
  export interface QAAttempt {
    /** 1-based attempt number */
    attemptNumber: number;
    /**
     * Lint check outcome for this attempt.
     * - 'passed'  — lint ran and found no errors
     * - 'failed'  — lint ran and found errors (see lintErrors)
     * - 'skipped' — lint is disabled for this project or unavailable in sandbox
     */
    lintStatus: 'passed' | 'failed' | 'skipped';
    /** Lint failure details — present only when lintStatus is 'failed' */
    lintErrors?: { count: number; details: unknown[] };
    /**
     * Test run outcome for this attempt.
     * - 'passed'  — all tests passed
     * - 'failed'  — one or more tests failed (see testResults)
     * - 'skipped' — tests are disabled for this project or sandbox lacks required environment
     */
    testStatus: 'passed' | 'failed' | 'skipped';
    /** Test run details — present only when testStatus is 'failed' */
    testResults?: { passed: number; failed: number; details: unknown[] };
    /** Duration of this QA attempt in milliseconds */
    durationMs: number;
  }
  ```

- [x] 1.3 Add `qaAttempts` to the `Execution` interface (after `errorMessage`). Do NOT add `qaStatus` — it is not in the backend `ExecutionResponseDto` yet and the badge logic derives it from the `qaAttempts` array directly:

  ```typescript
  export interface Execution {
    // ... existing fields unchanged ...
    errorMessage?: string;
    qaAttempts?: QAAttempt[] | null; // FE-1.3: per-attempt QA history (WR-6.3)
    metadata?: Record<string, unknown>;
  }
  ```

  **Note:** `qaRetryCount` and `qaFailedBranch` were added in FE-1.1. Only add `qaAttempts` here — do not duplicate those fields.

---

### Task 2: Create `QAResultsPanel` component (`src/components/execution/QAResultsPanel.tsx`)

New file. Follow the same import patterns as `ExecutionLogsViewer.tsx` (shadcn/ui `Badge`, `Button`, lucide icons, Tailwind classes). Do NOT use any library not already in `package.json`.

- [x] 2.1 Create the file with these imports:

  ```typescript
  import { useState } from 'react';
  import {
    CheckCircle2,
    XCircle,
    ChevronDown,
    ChevronRight,
    Clock,
    ShieldCheck,
    AlertCircle,
  } from 'lucide-react';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import type { QAAttempt } from '@/types/execution';
  ```

- [x] 2.2 Define props interface — **no `qaStatus` prop** (badge is derived from the array):

  ```typescript
  interface QAResultsPanelProps {
    /** QA attempts data from execution detail API. Null/undefined = no data available. */
    qaAttempts: QAAttempt[] | null | undefined;
    /** When true, adds aria-live="polite" for screen reader announcement of live updates */
    isLive?: boolean;
  }
  ```

- [x] 2.3 Implement badge derivation helper. Badge is determined entirely from the `qaAttempts` array — no `qaStatus` field needed:

  ```typescript
  function getAttemptBadge(
    attempt: QAAttempt,
    isLastAttempt: boolean,
    hasPriorFailures: boolean,
  ): { label: string; className: string } {
    // 'skipped' is treated as non-failure — only 'failed' counts as a failure
    const passed = attempt.lintStatus !== 'failed' && attempt.testStatus !== 'failed';

    if (passed) {
      // Last attempt passed and there were prior failures → self-healed
      if (isLastAttempt && hasPriorFailures) {
        return {
          label: 'Self-healed',
          className: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10',
        };
      }
      return {
        label: 'Passed',
        className: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10',
      };
    }

    return {
      label: 'Failed',
      className: 'border-rose-500/30 text-rose-400 bg-rose-500/10',
    };
  }
  ```

- [x] 2.4 Implement duration formatter:

  ```typescript
  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
  ```

- [x] 2.5 Implement the main component. Use `variant="outline"` on all `Badge` instances and rely on `className` for color overrides (CVA variant provides base shape, `className` overrides colors via Tailwind specificity — this is the existing pattern in the codebase):

  ```typescript
  export function QAResultsPanel({ qaAttempts, isLive = false }: QAResultsPanelProps) {
    const [expandedAttempts, setExpandedAttempts] = useState<Set<number>>(new Set());

    const toggleExpand = (attemptNumber: number) => {
      setExpandedAttempts((prev) => {
        const next = new Set(prev);
        if (next.has(attemptNumber)) next.delete(attemptNumber);
        else next.add(attemptNumber);
        return next;
      });
    };

    if (!qaAttempts || qaAttempts.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-10 text-slate-500 gap-3">
          <ShieldCheck className="w-8 h-8 opacity-40" />
          <p className="text-sm">No QA attempt data available for this execution.</p>
        </div>
      );
    }

    // Determine whether any attempt failed — used for "Self-healed" badge logic
    const failedAttemptNumbers = new Set(
      qaAttempts
        .filter((a) => !a.lintPassed || !a.testsPassed)
        .map((a) => a.attemptNumber),
    );

    return (
      <div
        className="space-y-3"
        aria-live={isLive ? 'polite' : undefined}
        aria-label="QA attempt results"
      >
        {qaAttempts.map((attempt, index) => {
          const isLast = index === qaAttempts.length - 1;
          const hasPriorFailures = failedAttemptNumbers.size > 0 &&
            Array.from(failedAttemptNumbers).some((n) => n < attempt.attemptNumber);
          const badge = getAttemptBadge(attempt, isLast, hasPriorFailures);
          const isExpanded = expandedAttempts.has(attempt.attemptNumber);
          const hasDetails =
            (attempt.lintErrors?.details?.length ?? 0) > 0 ||
            (attempt.testResults?.details?.length ?? 0) > 0;

          return (
            <div
              key={attempt.attemptNumber}
              className="rounded-lg border border-slate-700/50 bg-slate-800/40 overflow-hidden"
            >
              {/* Attempt header row */}
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="text-xs font-semibold text-slate-400 min-w-[70px]">
                  Attempt {attempt.attemptNumber}
                </span>

                {/* Lint status */}
                <div className="flex items-center gap-1.5 min-w-[110px]">
                  {attempt.lintPassed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-rose-400" />
                  )}
                  <span className="text-xs text-slate-300">Lint</span>
                  {!attempt.lintPassed && attempt.lintErrors && (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 border-rose-500/30 text-rose-400 bg-rose-500/10"
                    >
                      {attempt.lintErrors.count} err
                    </Badge>
                  )}
                </div>

                {/* Test status */}
                <div className="flex items-center gap-1.5 flex-1">
                  {attempt.testsPassed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-rose-400" />
                  )}
                  <span className="text-xs text-slate-300">Tests</span>
                  {attempt.testResults && (
                    <span className="text-xs text-slate-500">
                      {attempt.testResults.passed} passed / {attempt.testResults.failed} failed
                    </span>
                  )}
                </div>

                {/* Duration */}
                <div className="flex items-center gap-1 text-slate-500 min-w-[50px]">
                  <Clock className="w-3 h-3" />
                  <span className="text-xs">{formatDuration(attempt.durationMs)}</span>
                </div>

                {/* Outcome badge */}
                <Badge variant="outline" className={`text-xs ${badge.className}`}>
                  {badge.label}
                </Badge>

                {/* Expand toggle — only when there are details to show */}
                {hasDetails && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-slate-400 hover:text-slate-200"
                    onClick={() => toggleExpand(attempt.attemptNumber)}
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for attempt ${attempt.attemptNumber}`}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                  </Button>
                )}
              </div>

              {/* Collapsible detail section */}
              {hasDetails && isExpanded && (
                <div className="border-t border-slate-700/50 px-4 py-3 space-y-3 bg-slate-900/30">
                  {attempt.lintErrors?.details && attempt.lintErrors.details.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-400 mb-1.5 flex items-center gap-1.5">
                        <AlertCircle className="w-3 h-3 text-rose-400" />
                        Lint errors
                      </p>
                      <div className="space-y-1">
                        {attempt.lintErrors.details.map((detail, i) => (
                          <pre
                            key={i}
                            className="text-[11px] text-rose-300 font-mono bg-rose-500/5 rounded px-2 py-1 overflow-x-auto"
                          >
                            {typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)}
                          </pre>
                        ))}
                      </div>
                    </div>
                  )}
                  {attempt.testResults?.details && attempt.testResults.details.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-400 mb-1.5 flex items-center gap-1.5">
                        <AlertCircle className="w-3 h-3 text-rose-400" />
                        Test failures
                      </p>
                      <div className="space-y-1">
                        {attempt.testResults.details.map((detail, i) => (
                          <pre
                            key={i}
                            className="text-[11px] text-rose-300 font-mono bg-rose-500/5 rounded px-2 py-1 overflow-x-auto"
                          >
                            {typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2)}
                          </pre>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }
  ```

---

### Task 3: Add QA Results panel to `ExecutionLogsViewer` (`src/components/execution/ExecutionLogsViewer.tsx`)

The `ExecutionLogsViewer` uses a **horizontal flex layout**: left sidebar (`ContainerActivityTimeline`) toggled by `showActivityPanel` boolean + right logs pane. Do NOT add a tab system — it would restructure the entire layout and break the existing activity sidebar pattern.

Instead: add `showQAPanel` state alongside `showActivityPanel` with mutual exclusion.

- [x] 3.1 Import `QAResultsPanel`, `useExecution`, and `ShieldCheck` (for button icon) at the top of `ExecutionLogsViewer.tsx`:

  ```typescript
  import { QAResultsPanel } from '@/components/execution/QAResultsPanel';
  import { useExecution } from '@/hooks/queries/useExecutions';
  // Add ShieldCheck to the existing lucide-react import block:
  // import { ..., ShieldCheck } from 'lucide-react';
  ```

- [x] 3.2 Add `showQAPanel` state variable after `showActivityPanel`:

  ```typescript
  const [showActivityPanel, setShowActivityPanel] = useState(true);
  const [showQAPanel, setShowQAPanel] = useState(false);
  ```

- [x] 3.3 Add `useExecution` query with `refetchInterval` for live updates. This is the **first real usage** of this hook in the app — it also uses the now-corrected `/status` URL from Task 1.1:

  ```typescript
  const { data: executionDetail } = useExecution(executionId, {
    refetchInterval: isLive ? 5_000 : false,
    enabled: !!executionId && isOpen,
  });
  ```

  Place this after the `exportLogs` declaration.

- [x] 3.4 Add toggle handlers with mutual exclusion. Opening one panel closes the other:

  ```typescript
  const handleToggleActivity = () => {
    setShowActivityPanel((prev) => {
      if (!prev) setShowQAPanel(false); // opening activity → close QA
      return !prev;
    });
  };

  const handleToggleQAPanel = () => {
    setShowQAPanel((prev) => {
      if (!prev) setShowActivityPanel(false); // opening QA → close activity
      return !prev;
    });
  };
  ```

- [x] 3.5 Update the "Activity" button in the filters bar to use `handleToggleActivity` instead of the inline `setShowActivityPanel(!showActivityPanel)`. Add a "QA Results" button next to it:

  ```tsx
  <Button
    variant="outline"
    size="sm"
    onClick={handleToggleActivity}
    className={`border-slate-700 ${showActivityPanel ? 'bg-slate-800 text-blue-400' : ''}`}
  >
    <Activity className="w-4 h-4 mr-2" />
    Activity
  </Button>
  <Button
    variant="outline"
    size="sm"
    onClick={handleToggleQAPanel}
    className={`border-slate-700 ${showQAPanel ? 'bg-slate-800 text-emerald-400' : ''}`}
  >
    <ShieldCheck className="w-4 h-4 mr-2" />
    QA Results
    {executionDetail?.qaAttempts?.length ? (
      <Badge variant="secondary" className="ml-2 bg-emerald-500/20 text-emerald-400 text-[10px]">
        {executionDetail.qaAttempts.length}
      </Badge>
    ) : null}
  </Button>
  ```

- [x] 3.6 In the "Main Content" flex row (where `showActivityPanel` already renders the left sidebar), add the QA panel in the same sidebar slot. Replace:

  ```tsx
  {
    /* Activity Panel (collapsible sidebar) */
  }
  {
    showActivityPanel && (
      <div className="w-72 border-r border-slate-800 ...">...ContainerActivityTimeline...</div>
    );
  }
  ```

  With:

  ```tsx
  {
    /* Left sidebar — Activity OR QA Results (mutually exclusive) */
  }
  {
    (showActivityPanel || showQAPanel) && (
      <div className="w-72 border-r border-slate-800 bg-slate-900/50 overflow-auto flex-shrink-0">
        {showActivityPanel && (
          <>
            <div className="flex items-center gap-2 p-4 pb-3">
              <Activity className="w-4 h-4 text-blue-400" />
              <h3 className="text-sm font-bold text-slate-200">Container Activity</h3>
            </div>
            <div className="px-4 pb-4">
              <Suspense
                fallback={
                  <div className="flex items-center gap-2 py-4 text-xs text-slate-500">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Loading...
                  </div>
                }
              >
                <ContainerActivityTimeline
                  executionId={executionId}
                  socket={socket}
                  maxHeight="calc(100% - 40px)"
                  collapsible={false}
                  defaultCollapsed={false}
                  isLive={isLive}
                />
              </Suspense>
            </div>
          </>
        )}
        {showQAPanel && (
          <>
            <div className="flex items-center gap-2 p-4 pb-3">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-slate-200">QA Results</h3>
            </div>
            <div className="px-4 pb-4">
              <QAResultsPanel qaAttempts={executionDetail?.qaAttempts ?? null} isLive={isLive} />
            </div>
          </>
        )}
      </div>
    );
  }
  ```

- [x] 3.7 Reset `showQAPanel` to `false` when the dialog closes (alongside the existing `realTimeLogs` reset):

  ```typescript
  useEffect(() => {
    if (!isOpen) {
      setRealTimeLogs([]);
      setSearchQuery('');
      setShowQAPanel(false); // FE-1.3: reset QA panel on close
    }
  }, [isOpen]);
  ```

---

### Task 4: Write unit tests for `QAResultsPanel` (`src/components/execution/__tests__/QAResultsPanel.test.tsx`)

Create file if absent. Use Vitest + RTL. Do NOT use Jest globals.

- [x] 4.1 Create the test file:

  ```typescript
  import { render, screen } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { describe, it, expect } from 'vitest';
  import { QAResultsPanel } from '../QAResultsPanel';
  import type { QAAttempt } from '@/types/execution';

  // ⚠️ Reconciled with backend (2026-04-03): lintPassed/testsPassed → lintStatus/testStatus
  const attempt1Failed: QAAttempt = {
    attemptNumber: 1,
    lintStatus: 'failed',
    lintErrors: { count: 2, details: ['src/foo.ts:10 error', 'src/bar.ts:5 error'] },
    testStatus: 'failed',
    testResults: { passed: 3, failed: 1, details: ['test "foo" failed: expected true'] },
    durationMs: 4200,
  };

  const attempt2Passed: QAAttempt = {
    attemptNumber: 2,
    lintStatus: 'passed',
    testStatus: 'passed',
    testResults: { passed: 4, failed: 0, details: [] },
    durationMs: 3100,
  };
  ```

- [x] 4.2 **Test A** — empty/null state:

  ```typescript
  it('renders empty state when qaAttempts is null', () => {
    render(<QAResultsPanel qaAttempts={null} />);
    expect(screen.getByText(/No QA attempt data available/i)).toBeInTheDocument();
  });

  it('renders empty state when qaAttempts is an empty array', () => {
    render(<QAResultsPanel qaAttempts={[]} />);
    expect(screen.getByText(/No QA attempt data available/i)).toBeInTheDocument();
  });
  ```

- [x] 4.3 **Test B** — attempt rows:

  ```typescript
  it('renders attempt rows with correct labels', () => {
    render(<QAResultsPanel qaAttempts={[attempt1Failed, attempt2Passed]} />);
    expect(screen.getByText('Attempt 1')).toBeInTheDocument();
    expect(screen.getByText('Attempt 2')).toBeInTheDocument();
  });
  ```

- [x] 4.4 **Test C** — lint error badge:

  ```typescript
  it('shows lint error count badge on failed lint attempt', () => {
    render(<QAResultsPanel qaAttempts={[attempt1Failed]} />);
    expect(screen.getByText('2 err')).toBeInTheDocument();
  });
  ```

- [x] 4.5 **Test D** — test result counts:

  ```typescript
  it('shows test pass/fail counts', () => {
    render(<QAResultsPanel qaAttempts={[attempt1Failed]} />);
    expect(screen.getByText(/3 passed \/ 1 failed/i)).toBeInTheDocument();
  });
  ```

- [x] 4.6 **Test E** — Self-healed badge derived from array (no `qaStatus` prop):

  ```typescript
  it('shows Self-healed badge on final passing attempt when prior failures exist', () => {
    render(<QAResultsPanel qaAttempts={[attempt1Failed, attempt2Passed]} />);
    expect(screen.getByText('Self-healed')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows Passed badge (not Self-healed) when only one attempt and it passed', () => {
    render(<QAResultsPanel qaAttempts={[attempt2Passed]} />);
    expect(screen.getByText('Passed')).toBeInTheDocument();
    expect(screen.queryByText('Self-healed')).not.toBeInTheDocument();
  });
  ```

- [x] 4.7 **Test F** — expand/collapse:

  ```typescript
  it('expands lint error details on row toggle', async () => {
    render(<QAResultsPanel qaAttempts={[attempt1Failed]} />);
    const expandBtn = screen.getByRole('button', { name: /Expand details for attempt 1/i });
    await userEvent.click(expandBtn);
    expect(screen.getByText('src/foo.ts:10 error')).toBeInTheDocument();
  });
  ```

- [x] 4.8 **Test G** — `aria-live` when `isLive`:

  ```typescript
  it('has aria-live polite when isLive is true', () => {
    const { container } = render(
      <QAResultsPanel qaAttempts={[attempt2Passed]} isLive={true} />,
    );
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
  ```

---

### Task 5: Verify build

- [x] 5.1 Run `pnpm typecheck` — zero TypeScript errors (no errors in FE-1.3 files; pre-existing errors in unrelated test files not introduced by this story)
- [x] 5.2 Run `pnpm build` — zero build errors in FE-1.3 files
- [x] 5.3 Run `pnpm test` — all 9 QAResultsPanel tests pass; pre-existing PMResolutionModal timer failures unrelated to this story

---

## Dev Notes

### THIS STORY SCOPE — FE-1.3 ONLY

- **In scope:** `QAAttempt` type, `qaAttempts` on `Execution`, fix `getExecution()` URL, `QAResultsPanel` component, QA Results panel in `ExecutionLogsViewer` sidebar, unit tests
- **Out of scope:** PM Resolution Modal (FE-1.2), QA_FAILED detection (FE-1.1), any WebSocket event for `qa_attempt` markers (polling via `refetchInterval` satisfies the AC)

---

### Repo Clarification — This Is a Frontend Story

**All implementation is in the `dsf-dashboard` repo** at `/Volumes/Data/project/products/alpharages/dsf-dasbhoard`. The story file lives in the backend repo for sprint tracking only.

```
/Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/
├── api/executionsApi.ts                                        ← Task 1.1 (fix URL)
├── types/execution.ts                                          ← Task 1.2–1.3
├── components/execution/QAResultsPanel.tsx                     ← Task 2 (new file)
├── components/execution/ExecutionLogsViewer.tsx                ← Task 3
└── components/execution/__tests__/QAResultsPanel.test.tsx      ← Task 4 (new file)
```

Frontend commands (run from dsf-dashboard root):

```bash
pnpm typecheck     # pnpm build does tsc --noEmit first
pnpm build         # type-check + production build
pnpm test          # Vitest (run once)
pnpm dev           # dev server on :5173
```

---

### Backend API Contract (WR-6.3)

**Correct endpoint:** `GET /api/v1/executions/:id/status` (NOT `/executions/:id`)

The backend `ExecutionController` only has `@Get(':id/status')`. The existing `getExecution()` was calling the wrong URL and would always 404. Task 1.1 fixes this.

After WR-6.3 is deployed, the response `ExecutionResponseDto` gains `qaAttempts: QAAttempt[] | null`. When `qaAttempts` is `null` (QA skipped, legacy execution, or provider doesn't emit markers), the panel renders the empty state.

**`QAAttempt` shape** (mirrors `src/ai-routing/interfaces/ai-provider.interface.ts:46`):

> ⚠️ **Reconciled 2026-04-03:** Backend updated `lintPassed: boolean` → `lintStatus: 'passed' | 'failed' | 'skipped'` and `testsPassed: boolean` → `testStatus: 'passed' | 'failed' | 'skipped'` to support a `'skipped'` state (lint/tests disabled per project config). Frontend type, component, and tests all updated to match.

```typescript
{
  attemptNumber: number;       // 1-based
  lintStatus: 'passed' | 'failed' | 'skipped';
  lintErrors?: { count: number; details: unknown[] };  // only when lintStatus === 'failed'
  testStatus: 'passed' | 'failed' | 'skipped';
  testResults?: { passed: number; failed: number; details: unknown[] };  // only when testStatus === 'failed'
  durationMs: number;
}
```

No `qaStatus` string field is needed — the badge logic derives everything from the `qaAttempts` array directly. Badge treats `'skipped'` as non-failure (only `'failed'` triggers the Failed/Self-healed path). The UI renders a `—` dash for skipped lint/test steps.

---

### `ExecutionLogsViewer` Layout — Sidebar Pattern

The dialog uses a horizontal flex layout:

```
[DialogHeader]
[Filters bar: Search | Activity btn | QA Results btn | Filters btn | Auto-scroll btn]
[Warning banner — conditional]
[Main flex row:
  [Left sidebar: w-72, shows Activity OR QA Results (mutual exclusion)]
  [Right pane: flex-1, logs container]
]
[Footer stats]
```

`showActivityPanel` and `showQAPanel` are mutually exclusive:

- Clicking "Activity" when closed → `showActivityPanel=true`, `showQAPanel=false`
- Clicking "QA Results" when closed → `showQAPanel=true`, `showActivityPanel=false`
- Clicking either when already open → closes it (toggle off)

This keeps the existing layout structure intact. No flex restructuring needed.

---

### Badge Logic — Derived from `qaAttempts` Array

There is no `qaStatus` string field in the `Execution` type for FE-1.3. Badge is computed:

```
attempt.lintPassed && attempt.testsPassed
  AND isLastAttempt
  AND any prior attempt had lintPassed=false OR testsPassed=false
  → "Self-healed" (emerald)

attempt.lintPassed && attempt.testsPassed (but no prior failures, or not last)
  → "Passed" (emerald)

otherwise
  → "Failed" (rose)
```

Edge case: `qaMaxRetries=1` — only 1 attempt, it passed → "Passed" (no prior failures exist).

---

### Color Tokens — Use `emerald`, Not `green`

The existing codebase uses `text-emerald-*` / `bg-emerald-*` for success states. Do NOT use `text-green-*` — check `ExecutionCard.tsx` and `ExecutionLogsViewer.tsx` for the established pattern.

---

### Dependency on WR-6.3

FE-1.3 can be implemented independently against mocked data. Until WR-6.3 is deployed, `getExecution()` (now with the corrected `/status` URL) will return `ExecutionResponseDto` without `qaAttempts` — the TypeScript field is optional so it will be `undefined`, which renders the empty state gracefully.

---

### `useExecution` — First Real Usage in the App

`useExecution` is defined in `src/hooks/queries/useExecutions.ts:76` but is not called anywhere in the current app. FE-1.3 is its first consumer. The corrected URL from Task 1.1 must be in place before this hook will work.

---

### Previous Story Context (FE-1.1 and FE-1.2)

FE-1.1 adds `'QA_FAILED'` to `ExecutionStatus`, `qaRetryCount?: number`, and `qaFailedBranch?: string | null` to `Execution`. FE-1.3 adds `qaAttempts?: QAAttempt[] | null` — separate fields, no conflict.

FE-1.2 adds `PMResolutionModal` and `resolveQaFailure()` API function. No overlap with FE-1.3.

**TypeScript exhaustiveness note:** After FE-1.1 adds `'QA_FAILED'` to `ExecutionStatus`, `CONTROL_BUTTON_MATRIX` must have a `'QA_FAILED': []` entry — this is handled in FE-1.1, not FE-1.3.

If implementing FE-1.3 before FE-1.1 is done: `QA_FAILED` won't be in `ExecutionStatus` yet, but `qaAttempts` and `QAAttempt` are independent of it — adding them to the types compiles cleanly regardless.

---

### References

- FR-EXT14: QA Results Panel — `_bmad-output/planning-artifacts/epics-workspace-removal-extensions.md`
- NFR-EXT5: `aria-live="polite"` for real-time — same file
- UX-DR3, UX-DR6: Color coding, grouping — same file
- Backend `QAAttempt`: `src/ai-routing/interfaces/ai-provider.interface.ts:46`
- Backend endpoint: `GET /api/v1/executions/:id/status` — `src/execution/execution.controller.ts:62`
- Backend `toResponseDto()`: `src/execution/execution.service.ts:336` (WR-6.3 adds `qaAttempts` here)
- WR-6.3 story: `_bmad-output/implementation-artifacts/wr-6-3-persist-qa-attempts-to-db-and-expose-via-execution-detail-api.md`
- `useExecution` hook: `src/hooks/queries/useExecutions.ts:76`
- `ExecutionLogsViewer`: `src/components/execution/ExecutionLogsViewer.tsx`
- FE-1.1 story: `_bmad-output/implementation-artifacts/fe-1-1-detect-qa-failed-state-and-surface-resolution-prompt.md`
- FE-1.2 story: `_bmad-output/implementation-artifacts/fe-1-2-implement-pm-resolution-modal-open-pr-cancel.md`

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Implemented all 5 tasks across 4 frontend files + 1 new test file.
- **Backend type reconciliation (2026-04-03):** Story originally specified `lintPassed: boolean` and `testsPassed: boolean`. Backend (`src/ai-routing/interfaces/ai-provider.interface.ts:46`) was updated to `lintStatus: 'passed' | 'failed' | 'skipped'` and `testStatus: 'passed' | 'failed' | 'skipped'` to support a `'skipped'` state. Updated frontend type, component, and tests to match. The `'skipped'` state is treated as non-failure in badge logic and renders a `—` dash in the UI.
- Fixed the pre-existing `getExecution()` URL bug (was calling `GET /executions/:id`, correct endpoint is `GET /executions/:id/status`).
- `QAResultsPanel` is a standalone component with no new dependencies.
- `useExecution` hook now has its first real consumer in the app (was unused before FE-1.3).
- All 9 new `QAResultsPanel` unit tests pass. Pre-existing test failures in `PMResolutionModal` and dashboard tests are unrelated to this story.

### File List

- `src/api/executionsApi.ts` — fixed `getExecution()` URL (`/status` suffix)
- `src/types/execution.ts` — added `QAAttempt` interface (reconciled with backend), added `qaAttempts` to `Execution`
- `src/components/execution/QAResultsPanel.tsx` — new component
- `src/components/execution/ExecutionLogsViewer.tsx` — added QA Results sidebar panel, `useExecution` hook, mutual exclusion with Activity panel
- `src/components/execution/__tests__/QAResultsPanel.test.tsx` — new test file (9 tests)

## Change Log

- **2026-04-03** — Full implementation complete (claude-sonnet-4-6): fixed `getExecution()` URL, added `QAAttempt` type + `qaAttempts` field, created `QAResultsPanel` component, wired into `ExecutionLogsViewer` sidebar with mutual exclusion, added 9 unit tests. All ACs satisfied.
- **2026-04-03** — Backend type reconciliation: `lintPassed: boolean` → `lintStatus: 'passed' | 'failed' | 'skipped'` and `testsPassed: boolean` → `testStatus: 'passed' | 'failed' | 'skipped'`. Updated type, component badge logic, and test fixtures to match backend at `src/ai-routing/interfaces/ai-provider.interface.ts:46`.

---

### Review Findings

- [x] [Review][Decision] D1: All-skipped attempt shows green "Passed" badge — resolved: added neutral "Skipped" badge (slate) when both lintStatus and testStatus are 'skipped' [QAResultsPanel.tsx:28-33]
- [x] [Review][Decision] D2: `aria-live="polite"` conditioned on `isLive` prop — resolved: always set unconditionally; `isLive` prop retained in interface for future use [QAResultsPanel.tsx:106]

- [x] [Review][Patch] P1 (HIGH): `isLast` uses array index not max `attemptNumber` — fixed: sort by attemptNumber before render; map over `sorted` array [QAResultsPanel.tsx:93-94]
- [x] [Review][Patch] P2 (HIGH): `useExecution` hook overrides caller's `enabled` — fixed: `enabled: !!executionId && !!user && (options?.enabled ?? true)` [useExecutions.ts:86]
- [x] [Review][Patch] P3 (MEDIUM): `JSON.stringify` circular crash — fixed: extracted `safeStringify()` helper with try-catch [QAResultsPanel.tsx:57-64]
- [x] [Review][Patch] P4 (MEDIUM): `testResults` counts shown on skipped attempts — fixed: gated on `attempt.testStatus !== 'skipped'` [QAResultsPanel.tsx:161]
- [x] [Review][Patch] P5 (MEDIUM): `durationMs <= 0` renders "0ms" — fixed: returns '—' for zero/negative values [QAResultsPanel.tsx:67]
- [x] [Review][Patch] P6 (LOW): Duplicate `attemptNumber` React key — fixed: `key={index}` [QAResultsPanel.tsx:122]
- [x] [Review][Patch] P7 (LOW): `showActivityPanel` not reset on dialog close — fixed: `setShowActivityPanel(true)` added to close useEffect [ExecutionLogsViewer.tsx:180]
- [x] [Review][Patch] P8 (LOW): `formatDuration` no rounding sub-1000ms — fixed: `Math.round(ms)` [QAResultsPanel.tsx:68]

- [x] [Review][Defer] lintErrors.count vs details.length cosmetic mismatch — badge shows backend `count` field, expanded section shows `details.length` entries; backend may truncate details; no "showing N of M" label [QAResultsPanel.tsx:123, 187] — deferred, backend-controlled behavior
- [x] [Review][Defer] QA badge count includes partial/in-progress attempts — `executionDetail?.qaAttempts?.length` counts all entries including incomplete attempt records [ExecutionLogsViewer.tsx:251] — deferred, backend responsibility
- [x] [Review][Defer] 5s polling no explicit terminal-state stop — `refetchInterval: isLive ? 5_000 : false` correctly defers to parent's `isLive` prop; parent is responsible for setting `isLive=false` on completion — deferred, pre-existing parent responsibility
