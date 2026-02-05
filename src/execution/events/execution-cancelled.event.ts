export class ExecutionCancelledEvent {
  constructor(
    public readonly executionId: string,
    public readonly ticketId: string,
    public readonly projectId: string,
    public readonly provider: string,
    public readonly reason: string,
    public readonly correlationId: string,
  ) {}
}
