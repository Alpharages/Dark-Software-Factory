import { IsString, IsNotEmpty, IsUrl, IsOptional, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProjectDto {
  @ApiProperty({ description: 'Name of the project' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ description: 'ClickUp List ID mapped to this project' })
  @IsString()
  @IsNotEmpty()
  clickup_list_id!: string;

  @ApiProperty({ description: 'GitHub Repository URL (must be https://github.com/)' })
  @IsUrl()
  @IsNotEmpty()
  @Matches(/^https:\/\/github\.com\/[\w-]+\/[\w.-]+(?:\.git)?$/, {
    message:
      'GitHub repository URL must be in format: https://github.com/owner/repo or https://github.com/owner/repo.git',
  })
  github_repository_url!: string;

  @ApiProperty({ description: 'Default branch for the repository', default: 'main' })
  @IsString()
  @IsOptional()
  default_branch?: string;
}
