/**
 * Emitted when an implement run finishes without producing any file changes.
 *
 * The agent is not trusted to have "just done nothing" — a zero-diff implement
 * run means it stopped short and wants something from a human (most often a
 * scope clarification it refused to guess at). Its summary is the ask, and it
 * is worthless buried in `error_message` where nobody reads it, so the ask is
 * relayed to the PM tool as a task comment and the execution parks in PAUSED
 * until someone answers.
 *
 * Deliberately decoupled via the in-process EventBus: the OpenHarness module
 * must NOT import the Integrations module (that would close the
 * OpenHarness → Integrations → Dispatcher → OpenHarness cycle), exactly as with
 * [[OpenHarnessCodeReadyEvent]].
 */
export class OpenHarnessNeedsInputEvent {
  constructor(
    public readonly executionId: string,
    public readonly ticketId: string,
    public readonly projectId: string | null,
    /** PM-tool task id (e.g. ClickUp `86exzg6tz`) the comment is posted against. */
    public readonly externalTaskId: string,
    /** The agent's closing summary — the question to put in front of the PM. */
    public readonly question: string,
    /** The OpenHarness skill prompt that produced this leg (for traceability). */
    public readonly skill: string,
    public readonly correlationId: string,
  ) {}
}
