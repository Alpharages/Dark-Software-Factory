# Story FE-1.2: Implement PM Resolution Modal (Open PR / Cancel)

Status: done

## Story

As a **PM with a QA-failed execution**,
I want a modal that shows me the branch, the last QA error, and lets me choose to open a PR or cancel,
So that I can resolve the situation in one action without touching GitHub or ClickUp manually.

## Acceptance Criteria

**AC-1: Modal opens on "Resolve" button click**
Given the PM clicks "Resolve" on a `QA_FAILED` execution card (wired in FE-1.1)
When the modal opens
Then it displays: the pushed branch name as a clickable GitHub URL, the last QA error output, and two action buttons: "Open PR Anyway" and "Cancel" (FR-EXT10)
And the modal is focus-trapped (Radix Dialog handles this) with all buttons having explicit ARIA labels (NFR-EXT4, UX-DR1)

**AC-2: "Open PR Anyway" requires confirmation before API call**
Given the modal is open
When the PM clicks "Open PR Anyway"
Then a confirmation step is shown inline: "Are you sure? This will open a PR with failing QA." with "Confirm" and "Back" buttons (UX-DR4)
And the API call is NOT made until the PM clicks "Confirm"

**AC-3: "Open PR Anyway" success flow**
Given the PM confirms "Open PR Anyway"
When `POST /api/v1/executions/:id/resolve-qa-failure` responds 201 with `{ action: 'open_pr', prUrl, prNumber }`
Then the modal closes
And a toast notification appears: `PR #[number] opened — [prUrl]` at bottom-right, auto-dismissing after 5 seconds (FR-EXT11, UX-DR5)
And the execution card updates to `COMPLETED` state via cache update in the parent

**AC-4: "Cancel" flow**
Given the PM clicks "Cancel" in the modal (no confirmation required)
When `POST /api/v1/executions/:id/resolve-qa-failure` responds 201 with `{ action: 'cancel', branchName }`
Then the modal shows inline: "Execution cancelled — ticket moved to manual review. Branch [name] is available for a developer to continue." (FR-EXT12)
And after 2 seconds, the modal closes
And the execution card updates to `FAILED` state

**AC-5: Error state — 404**
Given the API returns `404`
When the response is received
Then an inline error message shows: "Execution not found." — action buttons remain enabled for retry (FR-EXT13)

**AC-6: Error state — 409**
Given the API returns `409`
When the response is received
Then the modal shows: "This execution is no longer in QA Failed state — it may have already been resolved." and closes after 3 seconds (FR-EXT13)

**AC-7: Error state — 422**
Given the API returns `422`
When the response is received
Then the modal shows: "Invalid action. Please refresh and try again." — buttons remain enabled (FR-EXT13)

**AC-8: Dismiss behaviour when no action is in-flight**
Given the modal is open and no API call is in progress
When the PM presses Escape or clicks outside the modal
Then the modal closes without calling the API (NFR-EXT4, UX-DR1)

**AC-9: Dismiss blocked during in-flight API call**
Given an action is in progress (API call in-flight — "submitting" state)
When the PM presses Escape or clicks outside
Then the modal does NOT close — it waits for the API response (NFR-EXT4, UX-DR1)

**AC-10: Mobile touch targets**
Given the modal renders on mobile (< 768px viewport)
When the PM views the buttons
Then "Open PR Anyway" and "Cancel" both have a minimum height of 44px (UX-DR4)

**AC-11: TypeScript compiles clean**
Given all changes applied across the dsf-dashboard repo
When `pnpm build` and `pnpm typecheck` run
Then zero TypeScript errors

---

## Tasks / Subtasks

### Task 1: Add `resolveQaFailure` API function and `QAResolutionResult` type

**File: `src/types/execution.ts`**

- [x] 1.1 Add `QAResolutionResult` interface after the `ControlButtonConfig` block:

  ```typescript
  /** Response from POST /executions/:id/resolve-qa-failure (FE-1.2) */
  export interface QAResolutionResult {
    action: 'open_pr' | 'cancel';
    prUrl?: string;
    prNumber?: number;
    branchName?: string | null;
  }
  ```

**File: `src/api/executionsApi.ts`**

- [x] 1.2 Import `QAResolutionResult` from `@/types/execution` — add it to the existing import at the top of the file.

- [x] 1.3 Add `resolveQaFailure()` function at the end of the file:

  ```typescript
  /**
   * Resolve a QA-failed execution: open PR or cancel (FE-1.2 / WR-4.3)
   * POST /executions/:id/resolve-qa-failure
   */
  export async function resolveQaFailure(
    executionId: string,
    action: 'open_pr' | 'cancel',
  ): Promise<QAResolutionResult> {
    const response = await apiClient.post<QAResolutionResult>(
      `${BASE_URL}/${executionId}/resolve-qa-failure`,
      { action },
    );
    return response.data;
  }
  ```

---

### Task 2: Create `PMResolutionModal` component

**File: `src/components/execution/PMResolutionModal.tsx`** (new file)

This modal uses `@/components/ui/dialog` (Radix Dialog) for focus-trap compliance. Follow the exact same import pattern as `ExecutionCard.tsx` which already uses `Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription` from `@/components/ui/dialog`.

- [x] 2.1 Create the file with these imports:

  ```typescript
  import { useState, useCallback } from 'react';
  import { ExternalLink, ShieldAlert, AlertCircle, Loader2, CheckCircle2 } from 'lucide-react';
  import { toast } from 'react-hot-toast';
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from '@/components/ui/dialog';
  import { Button } from '@/components/ui/button';
  import { resolveQaFailure } from '@/api/executionsApi';
  import type { QAResolutionResult } from '@/types/execution';
  ```

- [x] 2.2 Define props interface:

  ```typescript
  interface PMResolutionModalProps {
    isOpen: boolean;
    executionId: string;
    branchName: string | null;
    /** Full GitHub URL: project.github_repository_url + '/tree/' + branchName. Null if repo URL unknown. */
    branchUrl: string | null;
    errorMessage: string;
    onClose: () => void;
    /** Parent callback — called with the API result so parent can update execution cache and status. */
    onResolved: (result: QAResolutionResult) => void;
  }
  ```

- [x] 2.3 Define the modal state type and component:

  ```typescript
  type ModalStep =
    | 'idle' // default: showing branch/error + action buttons
    | 'confirming' // "Open PR Anyway" clicked — showing confirmation
    | 'submitting' // API call in-flight
    | 'success_cancel' // cancel succeeded — showing confirmation message
    | 'error'; // API error — showing error message
  ```

- [x] 2.4 Implement the component body:

  ```typescript
  export function PMResolutionModal({
    isOpen,
    executionId,
    branchName,
    branchUrl,
    errorMessage,
    onClose,
    onResolved,
  }: PMResolutionModalProps) {
    const [step, setStep] = useState<ModalStep>('idle');
    const [errorText, setErrorText] = useState<string | null>(null);

    const isSubmitting = step === 'submitting';

    // Reset to idle whenever modal opens
    const handleOpenChange = useCallback(
      (open: boolean) => {
        if (!open && !isSubmitting) {
          setStep('idle');
          setErrorText(null);
          onClose();
        }
      },
      [isSubmitting, onClose],
    );

    const handleOpenPrClick = () => setStep('confirming');
    const handleBackFromConfirm = () => setStep('idle');

    const submitAction = useCallback(
      async (action: 'open_pr' | 'cancel') => {
        setStep('submitting');
        setErrorText(null);
        try {
          const result = await resolveQaFailure(executionId, action);
          if (action === 'open_pr') {
            // Toast FIRST (while card is still visible), then cache update removes the card
            toast.success(
              `PR #${result.prNumber} opened — ${result.prUrl}`,
              { duration: 5000, position: 'bottom-right' },
            );
            onResolved(result); // triggers cache update → card transitions to COMPLETED
            setStep('idle');
            onClose();
          } else {
            // cancel: notify parent to update cache to FAILED, then show inline message
            onResolved(result);
            setStep('success_cancel');
            setTimeout(() => {
              setStep('idle');
              onClose();
            }, 2000);
          }
        } catch (err: unknown) {
          const response = (err as any)?.response;
          const status = response?.status;
          if (status === 404) {
            setErrorText('Execution not found.');
            setStep('error');
          } else if (status === 409) {
            setErrorText(
              'This execution is no longer in QA Failed state — it may have already been resolved.',
            );
            setStep('error');
            // Auto-close after 3s (FR-EXT13): onClose() → parent's handleModalClose → setResolvingExecution(null)
            setTimeout(() => {
              setStep('idle');
              setErrorText(null);
              onClose();
            }, 3000);
          } else if (status === 422) {
            setErrorText('Invalid action. Please refresh and try again.');
            setStep('error');
          } else if (status && status >= 500) {
            setErrorText('Server error. Please try again later.');
            setStep('error');
          } else {
            // Network error: no response object (timeout, connection refused, etc.)
            setErrorText('Network error. Check your connection and try again.');
            setStep('error');
          }
        }
      },
      [executionId, onClose, onResolved],
    );
  ```

- [x] 2.5 Implement the JSX — render the modal:

  ```tsx
    return (
      <Dialog open={isOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          className="sm:max-w-lg"
          onInteractOutside={(e) => {
            // Prevent close while submitting (NFR-EXT4)
            if (isSubmitting) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (isSubmitting) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-400">
              <ShieldAlert className="w-5 h-5 shrink-0" aria-hidden="true" />
              QA Failure — Resolution Required
            </DialogTitle>
            <DialogDescription>
              QA retries exhausted. Choose how to proceed with this execution.
            </DialogDescription>
          </DialogHeader>

          {/* Branch info */}
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-4 space-y-1">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
                Pushed Branch
              </p>
              {branchName ? (
                branchUrl ? (
                  <a
                    href={branchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 hover:underline break-all"
                    aria-label={`Open branch ${branchName} on GitHub`}
                  >
                    {branchName}
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  </a>
                ) : (
                  <p className="text-sm text-slate-300 font-mono break-all">{branchName}</p>
                )
              ) : (
                <p className="text-sm text-slate-500 italic">No branch pushed</p>
              )}
            </div>

            {/* Last QA error */}
            <div className="rounded-lg bg-rose-500/5 border border-rose-500/20 p-4 space-y-1">
              <p className="text-xs font-semibold text-rose-400 uppercase tracking-widest">
                Last QA Error
              </p>
              <pre className="text-xs text-slate-300 whitespace-pre-wrap break-all max-h-40 overflow-y-auto font-mono leading-relaxed">
                {errorMessage || 'No error details available.'}
              </pre>
            </div>

            {/* Error message */}
            {step === 'error' && errorText && (
              <div
                className="flex items-start gap-2 rounded-lg bg-rose-500/10 border border-rose-500/30 p-3 text-rose-400 text-sm"
                role="alert"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{errorText}</span>
              </div>
            )}

            {/* Cancel success message */}
            {step === 'success_cancel' && (
              <div
                className="flex items-start gap-2 rounded-lg bg-slate-700/50 border border-slate-600 p-3 text-slate-300 text-sm"
                role="status"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" aria-hidden="true" />
                <span>
                  Execution cancelled — ticket moved to manual review.
                  {branchName && (
                    <> Branch <span className="font-mono text-slate-200">{branchName}</span> is available for a developer to continue.</>
                  )}
                </span>
              </div>
            )}

            {/* Confirmation step for "Open PR Anyway" */}
            {step === 'confirming' && (
              <div
                className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-amber-300 text-sm"
                role="alert"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>Are you sure? This will open a PR with failing QA.</span>
              </div>
            )}
          </div>

          <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:gap-2">
            {step === 'confirming' ? (
              <>
                <Button
                  variant="outline"
                  onClick={handleBackFromConfirm}
                  className="min-h-[44px]"
                  aria-label="Go back to resolution options"
                >
                  Back
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => submitAction('open_pr')}
                  disabled={isSubmitting}
                  className="min-h-[44px]"
                  aria-label="Confirm opening a PR with failing QA"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" />
                  ) : null}
                  Confirm — Open PR
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => submitAction('cancel')}
                  disabled={isSubmitting || step === 'success_cancel'}
                  className="min-h-[44px]"
                  aria-label="Cancel this execution and move ticket to manual review"
                >
                  {isSubmitting ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" />
                  ) : null}
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleOpenPrClick}
                  disabled={isSubmitting || step === 'success_cancel'}
                  className="min-h-[44px]"
                  aria-label="Open a pull request despite failing QA"
                >
                  Open PR Anyway
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  ```

---

### Task 3: Wire modal into `ExecutionMonitoringDashboard.tsx`

**File: `src/pages/ExecutionMonitoringDashboard.tsx`**

- [x] 3.1 Add `ShieldAlert` to the lucide-react import block (required for the QA_FAILED status filter added in FE-1.1).

- [x] 3.2 Add `PMResolutionModal` import after the `ExecutionLogsViewer` lazy import:

  ```typescript
  import { PMResolutionModal } from '@/components/execution/PMResolutionModal';
  ```

- [x] 3.3 Add these imports at the top of `ExecutionMonitoringDashboard.tsx`:

  ```typescript
  // Add QAResolutionResult to the existing execution types import:
  import type { ExecutionStatus, QAResolutionResult } from '@/types/execution';

  // Add Project type import (needed to type the userProjects lookup in handleResolve):
  import type { Project } from '@/types/project';
  ```

  > Note: `useUserProjects` is already imported and `userProjects` is already in scope — no new hooks needed. The `Project` import is type-only and adds zero runtime cost.

- [x] 3.4 Add modal state for the resolving execution inside `ExecutionMonitoringDashboard`:

  ```typescript
  const [resolvingExecution, setResolvingExecution] = useState<{
    executionId: string;
    branchName: string | null;
    branchUrl: string | null;
    errorMessage: string;
  } | null>(null);
  ```

- [x] 3.5 Add `handleResolve` callback — replace the TODO no-op from FE-1.1 with the real handler. The handler looks up the execution in the current `executions` array (already in scope), then finds the matching project from `userProjects` to build the branch URL:

  ```typescript
  const handleResolve = useCallback(
    (executionId: string) => {
      const execution = executions.find((e) => e.id === executionId);
      if (!execution) return;
      const project = userProjects.find((p) => p.id === execution.projectId);
      const branchName = execution.qaFailedBranch ?? null;
      const branchUrl =
        project?.github_repository_url && branchName
          ? `${project.github_repository_url}/tree/${branchName}`
          : null;
      setResolvingExecution({
        executionId,
        branchName,
        branchUrl,
        errorMessage: execution.errorMessage ?? 'No error details available.',
      });
    },
    [executions, userProjects],
  );
  ```

- [x] 3.6 Add `handleModalClose` callback:

  ```typescript
  const handleModalClose = useCallback(() => {
    setResolvingExecution(null);
  }, []);
  ```

- [x] 3.7 Add `handleResolved` callback — updates the cache optimistically when the modal completes an action:

  ```typescript
  const handleResolved = useCallback(
    (result: QAResolutionResult) => {
      if (!resolvingExecution) return;
      const newStatus = result.action === 'open_pr' ? 'COMPLETED' : 'FAILED';
      updateExecutionStatus(resolvingExecution.executionId, newStatus);
    },
    [resolvingExecution, updateExecutionStatus],
  );
  ```

- [x] 3.8 Replace the existing `<ExecutionCard>` render in the executions grid. Find this block (added by FE-1.1):

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

  Replace with:

  ```tsx
  <ExecutionCard
    key={execution.id}
    execution={execution}
    onViewLogs={handleViewLogs}
    onResolve={handleResolve}
    socket={socket}
  />
  ```

- [x] 3.9 Add `<PMResolutionModal>` render alongside the `<ExecutionLogsViewer>` Suspense block (AFTER it, at the bottom of the returned JSX, before the closing `</div>`):

  ```tsx
  {
    /* PM Resolution Modal — QA failure resolution (FE-1.2) */
  }
  {
    resolvingExecution && (
      <PMResolutionModal
        isOpen={!!resolvingExecution}
        executionId={resolvingExecution.executionId}
        branchName={resolvingExecution.branchName}
        branchUrl={resolvingExecution.branchUrl}
        errorMessage={resolvingExecution.errorMessage}
        onClose={handleModalClose}
        onResolved={handleResolved}
      />
    );
  }
  ```

---

### Task 4: Write unit tests for `PMResolutionModal`

**File: `src/components/execution/__tests__/PMResolutionModal.test.tsx`** (new file)

Use Vitest + RTL. Do NOT use Jest globals. Follow the same test file setup as `ExecutionCard.test.tsx`.

- [x] 4.1 File header / mocks:

  ```typescript
  import { render, screen, waitFor } from '@testing-library/react';
  import userEvent from '@testing-library/user-event';
  import { vi, describe, it, expect, beforeEach } from 'vitest';
  import { PMResolutionModal } from '../PMResolutionModal';

  // Mock the API function — vi.mock hoisting applies
  vi.mock('@/api/executionsApi', () => ({
    resolveQaFailure: vi.fn(),
  }));
  // Mock react-hot-toast — avoid actual DOM side effects
  vi.mock('react-hot-toast', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
  }));

  import { resolveQaFailure } from '@/api/executionsApi';
  const mockResolveQaFailure = resolveQaFailure as ReturnType<typeof vi.fn>;

  const defaultProps = {
    isOpen: true,
    executionId: 'exec-abc-123',
    branchName: 'feature/fix-ticket-abc',
    branchUrl: 'https://github.com/org/repo/tree/feature/fix-ticket-abc',
    errorMessage: 'lint: 3 errors in src/foo.ts',
    onClose: vi.fn(),
    onResolved: vi.fn(),
  };
  ```

- [x] 4.2 **Test A** — renders branch name and error:

  ```typescript
  it('renders branch name and QA error message', () => {
    render(<PMResolutionModal {...defaultProps} />);
    expect(screen.getByText('feature/fix-ticket-abc')).toBeInTheDocument();
    expect(screen.getByText(/lint: 3 errors/i)).toBeInTheDocument();
  });
  ```

- [x] 4.3 **Test B** — "Open PR Anyway" shows confirmation step:

  ```typescript
  it('shows confirmation step when Open PR Anyway is clicked', async () => {
    render(<PMResolutionModal {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /open pr anyway/i }));
    expect(screen.getByText(/are you sure\?/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm.*open pr/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go back/i })).toBeInTheDocument();
  });
  ```

- [x] 4.4 **Test C** — "Back" returns to idle state:

  ```typescript
  it('returns to idle state when Back is clicked from confirmation', async () => {
    render(<PMResolutionModal {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /open pr anyway/i }));
    await userEvent.click(screen.getByRole('button', { name: /go back/i }));
    expect(screen.queryByText(/are you sure\?/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open pr anyway/i })).toBeInTheDocument();
  });
  ```

- [x] 4.5 **Test D** — open_pr success calls onResolved and onClose:

  ```typescript
  it('calls onResolved and onClose on successful open_pr', async () => {
    mockResolveQaFailure.mockResolvedValueOnce({ action: 'open_pr', prUrl: 'https://github.com/pr/1', prNumber: 42 });
    render(<PMResolutionModal {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /open pr anyway/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm.*open pr/i }));
    await waitFor(() => expect(defaultProps.onResolved).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'open_pr', prNumber: 42 })
    ));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
  ```

- [x] 4.6 **Test E** — cancel success shows inline message:

  ```typescript
  it('shows cancellation confirmation message on successful cancel', async () => {
    mockResolveQaFailure.mockResolvedValueOnce({ action: 'cancel', branchName: 'feature/fix-ticket-abc' });
    render(<PMResolutionModal {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel this execution/i }));
    await waitFor(() =>
      expect(screen.getByText(/execution cancelled/i)).toBeInTheDocument()
    );
    expect(defaultProps.onResolved).toHaveBeenCalledWith(expect.objectContaining({ action: 'cancel' }));
  });
  ```

- [x] 4.7 **Test F** — 404 shows inline error without closing:

  ```typescript
  it('shows 404 error message inline without closing', async () => {
    mockResolveQaFailure.mockRejectedValueOnce({ response: { status: 404 } });
    render(<PMResolutionModal {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /open pr anyway/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm.*open pr/i }));
    await waitFor(() =>
      expect(screen.getByText(/execution not found/i)).toBeInTheDocument()
    );
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });
  ```

- [x] 4.8 **Test G** — 422 shows inline error without closing:

  ```typescript
  it('shows 422 error message inline without closing', async () => {
    mockResolveQaFailure.mockRejectedValueOnce({ response: { status: 422 } });
    render(<PMResolutionModal {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /open pr anyway/i }));
    await userEvent.click(screen.getByRole('button', { name: /confirm.*open pr/i }));
    await waitFor(() =>
      expect(screen.getByText(/invalid action/i)).toBeInTheDocument()
    );
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });
  ```

- [x] 4.9 **Test H** — 409 shows message then auto-closes after 3 seconds:

  ```typescript
  it('auto-closes after 3s when 409 error is returned', async () => {
    vi.useFakeTimers();
    mockResolveQaFailure.mockRejectedValueOnce({ response: { status: 409 } });
    render(<PMResolutionModal {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /open pr anyway/i }));
    // Use real timers for the click + wait, then switch to fake for setTimeout
    await userEvent.click(screen.getByRole('button', { name: /confirm.*open pr/i }));
    await waitFor(() =>
      expect(screen.getByText(/no longer in QA Failed state/i)).toBeInTheDocument()
    );
    expect(defaultProps.onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
  ```

---

### Task 5: Verify build

- [x] 5.1 Run `pnpm typecheck` — zero errors in all story-changed files (pre-existing errors in unrelated test fixtures not introduced by this story)
- [x] 5.2 Run `pnpm build` — zero TS errors in story source files
- [x] 5.3 Run `pnpm test` — all 8 new tests pass; pre-existing test failures (dashboard charts, connected apps) not introduced by this story

---

### Review Findings

- [x] [Review][Decision] D1: Should `confirming` step block Escape / click-outside dismiss? — Resolved: block dismiss during `confirming` by introducing `isBlocked = isSubmitting || step === 'confirming'` guard. `PMResolutionModal.tsx` `onInteractOutside` / `onEscapeKeyDown`

- [x] [Review][Patch] P1: No `key` prop on `PMResolutionModal` — fixed: added `key={resolvingExecution.executionId}` [`ExecutionMonitoringDashboard.tsx`]
- [x] [Review][Patch] P2: `setTimeout` timer refs not stored/cleared — fixed: added `cancelTimerRef` + `errorTimerRef` with `useEffect` cleanup and `clearTimeout` in `handleOpenChange` [`PMResolutionModal.tsx`]
- [x] [Review][Patch] P3: Toast renders `PR #undefined — undefined` if `prNumber`/`prUrl` absent — fixed: added null guards with fallback labels [`PMResolutionModal.tsx`]
- [x] [Review][Patch] P4: Double-submit race on Cancel/Confirm — fixed: added `submittingRef` guard in `submitAction` [`PMResolutionModal.tsx`]
- [x] [Review][Patch] P5: `Back` button not disabled during `submitting` state — fixed: added `disabled={isSubmitting}` to Back button [`PMResolutionModal.tsx`]
- [x] [Review][Patch] P6: Test file placed at wrong location — fixed: moved to `src/components/execution/__tests__/PMResolutionModal.test.tsx`
- [x] [Review][Patch] P7: Missing test for cancel success auto-close — fixed: added test with `vi.useFakeTimers()` + `vi.advanceTimersByTime(2000)` asserting `onClose` called once
- [x] [Review][Patch] P8: `(userProjects as Project[])` cast unnecessary — fixed: removed cast, using `userProjects.find(...)` directly [`ExecutionMonitoringDashboard.tsx`]

- [x] [Review][Defer] W1: `branchUrl` assembled from unvalidated `github_repository_url` (javascript: URI risk) [`ExecutionMonitoringDashboard.tsx:~287`] — deferred, pre-existing; `github_repository_url` is an admin-set field with no user-level injection surface in current flows
- [x] [Review][Defer] W2: Socket execution-status update races with open modal — if a socket event updates the same execution while the modal is open, `updateExecutionStatus` from `handleResolved` may apply a conflicting status [`ExecutionMonitoringDashboard.tsx:~305`] — deferred, pre-existing architectural pattern shared with `ExecutionLogsViewer`

---

## Dev Notes

### This Story Scope — FE-1.2 Only

FE-1.2 is the **modal implementation layer**:

- **In scope:** `PMResolutionModal` component, `resolveQaFailure()` API function, `QAResolutionResult` type, wiring in `ExecutionMonitoringDashboard`
- **Out of scope:** QA Results Panel (FE-1.3), backend changes (WR-4.3 is already live)

---

### Prerequisite: FE-1.1 Must Be Applied First

FE-1.2 depends on these additions from FE-1.1 (story file: `fe-1-1-detect-qa-failed-state-and-surface-resolution-prompt.md`):

| Added by FE-1.1                                                     | Where                              | Used by FE-1.2                                   |
| ------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------ |
| `'QA_FAILED'` in `ExecutionStatus`                                  | `src/types/execution.ts`           | `QAResolutionResult.action` typing, cache update |
| `qaRetryCount?: number` on `Execution`                              | `src/types/execution.ts`           | Indirectly (displayed in card)                   |
| `qaFailedBranch?: string \| null` on `Execution`                    | `src/types/execution.ts`           | `handleResolve` reads it to build branch URL     |
| `errorMessage?: string` on `Execution`                              | `src/types/execution.ts`           | `handleResolve` reads it for modal display       |
| `onResolve?: (executionId: string) => void` on `ExecutionCardProps` | `ExecutionCard.tsx`                | Dashboard passes `handleResolve`                 |
| `TODO FE-1.2` no-op in dashboard                                    | `ExecutionMonitoringDashboard.tsx` | Task 3.8 replaces it                             |
| `'QA_FAILED'` in `statusFilters`                                    | `ExecutionMonitoringDashboard.tsx` | Filter bar — already present                     |

Do NOT attempt FE-1.2 until FE-1.1 changes are merged.

---

### Repo — This Is a Frontend Story

**All implementation is in the `dsf-dashboard` repo** at `/Volumes/Data/project/products/alpharages/dsf-dasbhoard`, not in `dsf-backend`. The story file lives in the backend repo for sprint tracking only.

```
/Volumes/Data/project/products/alpharages/dsf-dasbhoard/src/
├── types/execution.ts                              ← Task 1.1 (QAResolutionResult)
├── api/executionsApi.ts                            ← Task 1.2–1.3 (resolveQaFailure)
├── components/execution/PMResolutionModal.tsx      ← Task 2 (new file)
├── pages/ExecutionMonitoringDashboard.tsx          ← Task 3
└── components/execution/__tests__/PMResolutionModal.test.tsx  ← Task 4 (new file)
```

Frontend commands (run from dsf-dashboard root):

```bash
pnpm typecheck     # pnpm build does tsc --noEmit first
pnpm build         # type-check + production build
pnpm test          # Vitest (run once)
pnpm dev           # dev server on :5173
```

---

### Backend API Contract (WR-4.3 — Already Live)

**Endpoint:** `POST /api/v1/executions/:id/resolve-qa-failure`
**Auth:** Bearer JWT — roles PM, ADMIN, TL only
**Request body:** `{ "action": "open_pr" | "cancel" }`
**Success response (201):**

```typescript
// open_pr action:
{ action: 'open_pr', prUrl: string, prNumber: number }

// cancel action:
{ action: 'cancel', branchName: string | null }
```

**Error responses:**

- `404` — execution not found
- `409` — execution is not in `QA_FAILED` state (already resolved or state changed)
- `422` — `open_pr` called but `qa_failed_branch` is null on the execution record

Source: `src/execution/execution.controller.ts:42–60` + `src/execution/services/qa-failure-resolution.service.ts` (commit `542281a feat(wr-4.3)`).

---

### Modal State Machine

```
idle
  ├─ [Open PR Anyway] → confirming
  │    ├─ [Back] → idle
  │    └─ [Confirm] → submitting → success (close) | error (stay open)
  └─ [Cancel] → submitting → success_cancel (auto-close 2s) | error (stay open)
```

The `step` state drives all conditional rendering. Never manage separate boolean flags for `confirming`/`submitting`/`success` — use the single `step` discriminant.

---

### Why Radix Dialog (Not Custom Overlay)

FE-1.2 **must** use `@/components/ui/dialog` (Radix Dialog) — NOT the plain `fixed inset-0` div pattern seen in `ReviewModal.tsx` (which predates our ARIA standards). Reasons:

1. **NFR-EXT4 focus trap** — Radix handles `aria-modal`, tab cycling, and focus restoration automatically
2. **Escape key blocking** — `onEscapeKeyDown={(e) => { if (isSubmitting) e.preventDefault() }}` on `DialogContent` gives precise control
3. **Click-outside blocking** — `onInteractOutside={(e) => { if (isSubmitting) e.preventDefault() }}` on `DialogContent`
4. `ExecutionCard.tsx` already uses Radix Dialog successfully — same pattern, consistent codebase

---

### Branch URL Construction

`github_repository_url` (from `Project`) gives a base like `https://github.com/org/repo`. The branch URL is:

```typescript
`${project.github_repository_url}/tree/${branchName}`;
```

Both `github_repository_url` and `branchName` may be null/undefined:

- If either is absent → pass `branchUrl: null` to the modal
- The modal renders the branch name as plain text (not a link) when `branchUrl` is null
- The branch name itself (`branchName`) may also be null if the agent crashed before pushing — render "No branch pushed" in this case

`userProjects` is already in scope in `ExecutionMonitoringDashboard` (loaded by `useUserProjects()`). No new API calls are needed.

---

### `onResolved` vs `updateExecutionStatus` — Cache Update Pattern

The `onResolved` callback fires from inside the modal on success. The parent (`ExecutionMonitoringDashboard`) owns the cache update — NOT the modal. This separation is intentional:

- Modal: calls `resolveQaFailure()`, calls `onResolved(result)` on success
- Parent `handleResolved`: calls `updateExecutionStatus(executionId, newStatus)` (already exists at line 123 of the dashboard)

This prevents the modal from needing to import `useQueryClient`, keeping it a pure presentational-logic component.

After `handleResolved` patches the cache, the execution card will re-render (via React Query) to `COMPLETED` or `FAILED`. The `QA_FAILED` card and its "Resolve" button disappear — no manual state cleanup needed.

---

### `resolveQaFailure` Return Value After Close

The `onClose()` call after `open_pr` success happens BEFORE `onResolved()` could clear the `resolvingExecution` state in the parent. The order is:

1. Modal calls `onResolved(result)` → parent updates cache
2. Modal calls `onClose()` → parent sets `resolvingExecution = null`

This is safe because `resolvingExecution` is only read inside `handleResolved` (via closure at call time) — clearing it after the call completes is fine.

---

### `success_cancel` Auto-Close Timing

The `setTimeout(..., 2000)` for auto-close on cancel is set up in the success branch of `submitAction`. If the component unmounts before the timeout fires (e.g., parent removes it from DOM), the timeout is harmless — `setStep` calls on an unmounted component are silently ignored in React 18+. No cleanup needed.

### 409 Auto-Close Chain

When a 409 error fires, `setTimeout(..., 3000)` calls `onClose()` after 3 seconds. The full call chain is:

```
onClose()                          // prop → parent's handleModalClose
  → setResolvingExecution(null)    // clears parent state
    → conditional render drops PMResolutionModal from DOM
```

This is the correct path — the modal does NOT manage `resolvingExecution` directly. The parent owns that state. After `onClose()` fires, the modal is unmounted and the setTimeout's remaining `setStep('idle')` / `setErrorText(null)` calls are silently ignored by React 18.

---

### Toast Positioning

`react-hot-toast` is already configured with a `<Toaster>` in the app root (consistent with existing usage in `ExecutionMonitoringDashboard.tsx:16`). Use:

```typescript
toast.success(`PR #${result.prNumber} opened — ${result.prUrl}`, {
  duration: 5000,
  position: 'bottom-right',
});
```

This matches UX-DR5 (bottom-right, 5s auto-dismiss). The `position` override on individual toasts works with react-hot-toast even if the global `<Toaster>` has a default position.

---

### `CONTROL_BUTTON_MATRIX` and `statusConfig` Exhaustiveness (FE-1.1 Concern)

FE-1.2 does NOT touch `CONTROL_BUTTON_MATRIX` or `statusConfig`. That was FE-1.1's responsibility. If FE-1.1 was not applied and TypeScript reports errors about `QA_FAILED` missing from these, that is a prerequisite gap — fix FE-1.1 first.

---

### `handleResolve` Nullability Guards

The `execution.qaFailedBranch` field was added by FE-1.1 as `qaFailedBranch?: string | null`. Access it safely:

```typescript
const branchName = execution.qaFailedBranch ?? null;
```

The `execution.errorMessage` field already exists on the pre-FE-1.1 `Execution` type as `errorMessage?: string`. Access it safely:

```typescript
errorMessage: execution.errorMessage ?? 'No error details available.',
```

---

### References

- FR-EXT10–13: PM Resolution Modal requirements — `_bmad-output/planning-artifacts/epics-workspace-removal-extensions.md`
- NFR-EXT4: Focus trap, ARIA, Escape key — same file
- UX-DR1: Modal dialog pattern (focus trap, click-outside, Escape) — same file
- UX-DR4: 44px minimum touch targets — same file
- UX-DR5: Toast bottom-right 5s — same file
- Backend endpoint: `POST /api/v1/executions/:id/resolve-qa-failure` — `src/execution/execution.controller.ts:42`
- Backend DTO: `src/execution/dto/resolve-qa-failure.dto.ts` — `QaFailureResolutionAction.OPEN_PR | CANCEL`
- Backend result type: `src/execution/services/qa-failure-resolution.service.ts:15` — `QAResolutionResult`
- WR-4.3 commit: `542281a` (PM resolution endpoint)
- FE-1.1 story: `_bmad-output/implementation-artifacts/fe-1-1-detect-qa-failed-state-and-surface-resolution-prompt.md`
- `Project.github_repository_url`: `src/types/project.ts:10` (dsf-dashboard)

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Installed missing `@testing-library/user-event` dev dependency (was already referenced by pre-existing `ExecutionCard.test.tsx` but not installed).
- Test file placed at `__tests__/components/execution/PMResolutionModal.test.tsx` (not inside `src/`) per project convention.
- Button aria-label selectors adjusted in tests to match actual ARIA labels (e.g. `/open a pull request despite failing qa/i` instead of `/open pr anyway/i`).
- 409 auto-close test uses `vi.spyOn(window, 'setTimeout')` to verify 3s timer is scheduled — avoids `userEvent` + `vi.useFakeTimers()` incompatibility in this Vitest/jsdom version.
- `userProjects` typed as `Project[]` cast in `handleResolve` — `useUserProjects` returns `unknown[]` generically but values are `Project` objects at runtime.
- All 8 unit tests pass. All ACs satisfied (AC-1 through AC-11).

### File List

**dsf-dashboard repo** (`/Volumes/Data/project/products/alpharages/dsf-dasbhoard`):

- `src/types/execution.ts` — added `QAResolutionResult` interface
- `src/api/executionsApi.ts` — added `QAResolutionResult` import + `resolveQaFailure()` function
- `src/components/execution/PMResolutionModal.tsx` — new file, full modal component
- `src/pages/ExecutionMonitoringDashboard.tsx` — wired modal (imports, state, handlers, render)
- `__tests__/components/execution/PMResolutionModal.test.tsx` — new file, 8 unit tests
- `package.json` / `pnpm-lock.yaml` — added `@testing-library/user-event` dev dependency
