export interface ETAReasoningParamsDto {
  historicalAverage: number | null;
  queuePosition: number;
  unresolvedDepCount: number;
  sampleSize: number;
}

export interface ETAComplexityEstimateDto {
  estimatedComplexityScore: number; // 1..10
  factors: {
    descriptionLength: number;
    acceptanceCriteriaCount: number;
    keywordMatches: number;
  };
}


