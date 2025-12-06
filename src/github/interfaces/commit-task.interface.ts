/**
 * Commit Task Interface
 * Defines the structure for delegating git commit operations to AI agents
 *
 * Story 4.3: Git Commit Generation & Push
 * AC#1: AI-Delegated Git Commit & Push
 */

export interface CommitTaskContext {
  ticketId: string;
  ticketTitle: string;
  ticketDescription?: string;
  acceptanceCriteria?: string[];
  codeOutput: unknown; // AI-generated files from execution.code_output
  aiProvider: string;
  executionId: string;
  complexityScore: number;
}

export interface CommitTask {
  type: 'github-commit-push';
  instructions: string;
  context: CommitTaskContext;
}

export interface CommitMessageMetadata {
  type: 'feat' | 'fix' | 'refactor' | 'test' | 'docs' | 'chore';
  scope: string;
  description: string;
  ticketId: string;
  aiProvider: string;
  executionId: string;
  complexityScore: number;
}
