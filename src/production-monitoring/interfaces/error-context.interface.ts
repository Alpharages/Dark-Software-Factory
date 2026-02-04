/**
 * Error Context Interface
 * Story 9-U-4: Error Context Extraction & Linking
 */

import { ParsedStackTrace } from './parsed-stack-trace.interface';
import { UserContext } from './user-context.interface';

export interface DeploymentContext {
  /** Deployment ID */
  deployment_id: string;
  /** Git commit SHA */
  commit_sha: string;
  /** Branch name */
  branch: string;
  /** When the deployment occurred */
  deployed_at: Date;
}

export interface CommitInfo {
  /** Commit SHA */
  sha: string;
  /** Commit message */
  message: string;
  /** Commit author */
  author: string;
  /** When the commit was made */
  committed_at: Date;
  /** GitHub URL for the commit */
  github_url: string;
}

export interface ErrorContext {
  /** Error ID */
  id: string;
  /** Application name */
  application: string;
  /** Error type */
  error_type: string;
  /** Error message */
  error_message: string;
  /** Parsed stack trace */
  parsed_stack_trace?: ParsedStackTrace;
  /** User context */
  user_context?: UserContext;
  /** Deployment context */
  deployment_context?: DeploymentContext;
  /** Related commits */
  related_commits: CommitInfo[];
  /** Number of affected users */
  affected_users: number;
  /** Total occurrence count */
  occurrence_count: number;
}
