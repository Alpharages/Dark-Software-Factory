import { IsNotEmpty, IsUrl, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateRepositoryDto {
  @ApiProperty({
    description: 'GitHub Repository URL (must be https://github.com/)',
    example: 'https://github.com/owner/repo',
  })
  @IsUrl()
  @IsNotEmpty()
  @Matches(/^https:\/\/github\.com\/[\w-]+\/[\w.-]+(?:\.git)?$/, {
    message:
      'GitHub repository URL must be in format: https://github.com/owner/repo or https://github.com/owner/repo.git',
  })
  repositoryUrl!: string;
}
