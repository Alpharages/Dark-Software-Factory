/**
 * Options for branch creation and resolution strategies
 * AC#3: Branch existence validation and resolution
 */
export interface BranchOptions {
  /**
   * Whether this is a retry of an existing execution
   * - If true: Reuse existing branch (idempotent)
   * - If false: Generate unique name with timestamp if branch exists
   */
  isRetry: boolean;

  /**
   * Correlation ID for request tracing
   */
  correlationId?: string;

  /**
   * Installation ID for GitHub App authentication (optional, future use)
   */
  installationId?: string;
}

/**
 * Result of branch creation operation
 */
export interface BranchCreationResult {
  branchName: string;
  commitSha: string;
  wasReused: boolean; // True if existing branch was reused for retry
}
