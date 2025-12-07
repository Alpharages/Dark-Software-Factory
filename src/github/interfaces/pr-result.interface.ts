/**
 * PR Result Interface
 * Defines parsed PR creation result structure
 *
 * Story 4.4: Pull Request Creation & Metadata
 * AC#3: Parse AI Agent Output
 */

export interface PRCreationResult {
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  error?: string;
}

export interface PROrchestrationResult {
  success: boolean;
  prUrl?: string;
  prNumber?: number;
  error?: string;
}
