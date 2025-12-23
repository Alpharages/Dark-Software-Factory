export interface DependencyCheckResult {
  canProceed: boolean;
  unresolvedDependencies: string[];
  resolvedCount: number;
  totalCount: number;
  /**
   * If blocked: estimated time the ticket can proceed.
   * If circular dependency detected: null (cannot estimate).
   */
  estimatedETA: Date | null;
}

export interface ETAResult {
  estimatedCompletionTime: Date;
  estimatedWaitMinutes: number;
  confidence: number; // 0..1
  reasoning: string;
  historicalAverage: number | null; // minutes
  queuePosition: number;
}
