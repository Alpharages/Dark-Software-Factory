/**
 * Emitted by the OpenHarness runner after a successful execution leg that ran in
 * an isolated per-ticket worktree, signalling that committed code is ready to be
 * delivered to GitHub (pushed, and — depending on the approval policy — opened as
 * a PR). Consumed by the GitHub code-delivery listener.
 *
 * This is deliberately decoupled via the in-process EventBus: the OpenHarness
 * module must NOT import the GitHub module (that would close the
 * OpenHarness → GitHub → ApprovalGate → Dispatcher → OpenHarness cycle).
 */
export class OpenHarnessCodeReadyEvent {
  constructor(
    public readonly executionId: string,
    public readonly ticketId: string,
    public readonly projectId: string | null,
    /** The git ref the agent committed to, e.g. `ohp/<clickupTaskId>`. */
    public readonly branch: string,
    /**
     * The persistent repository directory the branch lives in (the per-project
     * clone, or the configured workspace). The worktree is torn down after the
     * run, but the branch ref survives in this repo's object store — so the push
     * is performed from here, not from the (removed) worktree.
     */
    public readonly repoDir: string,
    /** Plain (unauthenticated) GitHub repository URL for the project. */
    public readonly repositoryUrl: string,
    /** The OpenHarness skill prompt that produced this leg (for traceability). */
    public readonly skill: string,
    public readonly correlationId: string,
  ) {}
}
