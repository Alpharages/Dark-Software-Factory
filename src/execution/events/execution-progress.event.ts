export interface ExecutionProgressEvent {
  executionId: string;
  ticketId: string;
  projectId: string | null;
  currentStep: string;
  percentComplete: number;
  lastUpdated: string;
  metadata?: {
    startTime?: Date;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
}
