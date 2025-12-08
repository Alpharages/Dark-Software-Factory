export interface DeploymentConfig {
  environment: 'dev' | 'staging' | 'production';
  cicdProvider: 'github-actions' | 'jenkins' | 'circleci' | 'webhook';
  workflowId?: string;
  buildId?: string;
}

export interface GitHubWorkflow {
  id: number;
  name: string;
  path: string;
  state: string;
  hasWorkflowDispatch: boolean;
}

export interface GitHubRunStatus {
  id: number;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null;
  created_at: string;
  updated_at: string;
}

export interface DeploymentTriggerContext {
  executionId: string;
  githubPushId: string;
  repository: string;
  branchName: string;
  commitSha: string;
  prUrl?: string;
  prNumber?: number;
  ticketId?: string;
}
