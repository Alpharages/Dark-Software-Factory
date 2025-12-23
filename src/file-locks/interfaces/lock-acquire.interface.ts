export interface AcquireLocksRequest {
  ticketId: string;
  executionId: string;
  filePaths: string[];
}

export interface AcquireLocksResult {
  acquired: boolean;
  // filled when acquired=false
  conflicts?: {
    filePaths: string[];
    ownerTicketIds: string[];
    queuePositionByFile?: Map<string, number>;
  };
  estimatedReleaseTime?: Date;
}
