export class QaResultCompletedEvent {
  constructor(
    public readonly executionId: string,
    public readonly ticketId: string,
    public readonly projectId: string,
    public readonly overallPassed: boolean,
    public readonly metrics: {
      lintingPassed: boolean;
      testsPassed: boolean;
      coverage: number;
      codeReviewPassed: boolean;
    },
  ) {}
}
