export class ExecutionFailedEvent {
  constructor(
    public readonly executionId: string,
    public readonly ticketId: string,
    public readonly projectId: string,
    public readonly provider: string,
    public readonly errorMessage: string,
    public readonly errorCode: string,
    public readonly isRetryable: boolean,
    public readonly correlationId: string,
  ) {}
}
