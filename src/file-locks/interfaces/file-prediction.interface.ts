export interface PredictFileModificationsInput {
  ticketId: string;
  executionId: string;
  repoFullName: string; // e.g. "org/repo"
  ticketTitle?: string;
  ticketDescription?: string;
}

export interface PredictFileModificationsResult {
  filePaths: string[];
  confidence: number; // 0..1
  reasoning: string;
}
