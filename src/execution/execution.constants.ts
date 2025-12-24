/**
 * Execution Module Constants
 * Story 13.3: AI Execution with Cost Tracking
 */

/**
 * Default complexity score used when Execution record is missing complexity_score
 * Range: 0-20 (from Story 2.3 ComplexityScorerService)
 * Default: 10 = Medium complexity
 */
export const DEFAULT_COMPLEXITY_SCORE = 10;

/**
 * Default estimated output tokens for cost estimation
 * Used when provider doesn't specify expected response size
 * Average response: 500 tokens (~2000 characters)
 */
export const DEFAULT_ESTIMATED_OUTPUT_TOKENS = 500;
