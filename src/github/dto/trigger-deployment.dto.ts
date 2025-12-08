import { IsString, IsOptional, IsEnum, IsInt, IsNotEmpty } from 'class-validator';

export class TriggerDeploymentDto {
  @IsString()
  @IsNotEmpty()
  githubPushId!: string;

  @IsString()
  @IsNotEmpty()
  repository!: string;

  @IsString()
  @IsNotEmpty()
  branchName!: string;

  @IsString()
  @IsNotEmpty()
  commitSha!: string;

  @IsEnum(['dev', 'staging', 'production'])
  environment!: 'dev' | 'staging' | 'production';

  @IsString()
  @IsOptional()
  workflowId?: string;

  @IsInt()
  @IsOptional()
  prNumber?: number;

  @IsString()
  @IsOptional()
  prUrl?: string;

  @IsString()
  @IsOptional()
  ticketId?: string;

  @IsString()
  @IsOptional()
  executionId?: string;
}

export class UpdateDeploymentStatusDto {
  @IsString()
  @IsNotEmpty()
  deploymentId!: string;

  @IsEnum(['TRIGGERED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLED_BACK'])
  status!: 'TRIGGERED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';

  @IsString()
  @IsOptional()
  errorMessage?: string;

  @IsString()
  @IsOptional()
  buildId?: string;
}
