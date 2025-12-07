/**
 * PR Task Interface
 * Defines AI delegation task structure for PR creation
 *
 * Story 4.4: Pull Request Creation & Metadata
 * AC#1: AI-Delegated PR Creation
 */

export interface PRTask {
  type: 'github-create-pr';
  instructions: string; // AI-readable instructions for gh pr create
  context: PRTaskContext;
}

export interface PRTaskContext {
  ticketId: string;
  ticketTitle: string;
  ticketDescription: string;
  acceptanceCriteria: string[];
  qaResults: QAResultsSummary;
  executionId: string;
  aiProvider: string;
  complexityScore: number;
  confidenceScore: number;
}

export interface QAResultsSummary {
  linting_passed: boolean;
  tests_passed: boolean;
  test_coverage?: number;
  code_review_passed: boolean;
  qa_summary_details: string;
}
