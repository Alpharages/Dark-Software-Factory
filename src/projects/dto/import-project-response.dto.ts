import { ApiProperty } from '@nestjs/swagger';
import { Project } from '@/prisma/client';

export class ImportProjectResponseDto {
  @ApiProperty({ description: 'The imported project' })
  project!: Project;

  @ApiProperty({
    description: 'Whether a ProjectIntegration record was auto-created from the connected account',
    example: false,
  })
  integrationCreated!: boolean;
}
