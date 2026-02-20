import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateGithubRepoDto {
  @ApiProperty({ example: 'uuid-of-github-account' })
  @IsString()
  @IsNotEmpty()
  githubAccountId!: string;

  @ApiProperty({ example: 'owner/repo-name' })
  @IsString()
  @IsNotEmpty()
  repositoryFullName!: string;
}
