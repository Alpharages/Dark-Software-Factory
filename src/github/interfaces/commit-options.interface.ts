/**
 * Commit Options Interface
 * Configuration for commit creation
 * AC#3: Git Tree and Commit Creation
 */

export interface CommitOptions {
  executionId: string;
  branchName: string;
  repository: string;
  correlationId?: string;
  installationId?: string;
}

/**
 * Commit author/committer information
 */
export interface GitAuthor {
  name: string;
  email: string;
  date?: string; // ISO 8601 format
}

/**
 * Result of commit creation and push
 */
export interface CommitResult {
  commitSha: string;
  branchName: string;
  repository: string;
  filesCount: number;
  totalSizeBytes: number;
  success: boolean;
}
