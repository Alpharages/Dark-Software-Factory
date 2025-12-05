import { IsString, IsNotEmpty, MaxLength, Matches } from 'class-validator';

/**
 * DTO for creating a feature branch
 * AC#1: Branch naming convention validation
 */
export class CreateBranchDto {
  @IsString()
  @IsNotEmpty()
  executionId!: string;

  @IsString()
  @IsNotEmpty()
  repository!: string; // Format: "owner/repo"

  @IsString()
  @IsNotEmpty()
  @MaxLength(63)
  @Matches(/^ai\/[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'Branch name must match pattern: ai/{ticket_id}-{slug}',
  })
  branchName!: string;

  @IsString()
  @IsNotEmpty()
  baseSha!: string; // SHA of the commit to branch from
}
