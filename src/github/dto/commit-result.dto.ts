/**
 * Commit Result DTO
 * Response from commit and push operation
 * AC#3: Git Tree and Commit Creation
 */

export class CommitResultDto {
  success!: boolean;
  commitSha!: string;
  branchName!: string;
  repository!: string;
  filesCount!: number;
  totalSizeBytes!: number;
  errorMessage?: string;
}
