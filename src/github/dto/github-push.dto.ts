import { GitHubStatus } from '@/prisma/client';

/**
 * DTO for GitHub push record
 * AC#4: Database record persistence
 */
export class GitHubPushDto {
  id!: string;
  executionId!: string;
  repository!: string;
  branchName!: string;
  commitSha!: string | null;
  prNumber!: number | null;
  prUrl!: string | null;
  pushStatus!: GitHubStatus;
  errorMessage!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}
