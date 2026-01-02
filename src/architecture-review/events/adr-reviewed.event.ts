export class AdrReviewedEvent {
  constructor(
    public readonly adrId: string,
    public readonly ticketId: string,
    public readonly action: string,
    public readonly notes?: string,
    public readonly previousExecutionId?: string,
  ) {}
}
