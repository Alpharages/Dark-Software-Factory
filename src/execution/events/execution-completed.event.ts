export class ExecutionCompletedEvent {
  constructor(
    public readonly executionId: string,
    public readonly ticketId: string,
    public readonly projectId: string,
    public readonly filesChanged: string[],
    public readonly codeOutput: string,
    public readonly aiProvider: string,
    public readonly correlationId: string,
  ) {}
}
