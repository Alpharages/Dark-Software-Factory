/**
 * Commit Result Interface
 * Defines the parsed output from AI agent commit operations
 *
 * Story 4.3: Git Commit Generation & Push
 * AC#3: Parse AI Agent Output
 */

export interface CommitPushResult {
  success: boolean;
  commitSha?: string;
  filesChanged?: number;
  commitMessage?: string;
  error?: string;
}
