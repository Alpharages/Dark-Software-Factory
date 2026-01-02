import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, IsNumberString } from 'class-validator';
import { ProjectProvider } from '@/prisma/enums';

export class ImportProjectDto {
  @ApiProperty({
    description: 'Integration provider source',
    enum: ProjectProvider,
    example: 'CLICKUP',
  })
  @IsEnum(ProjectProvider)
  @IsNotEmpty()
  provider!: ProjectProvider;

  @ApiProperty({
    description: 'Resource ID from the provider (e.g., ClickUp List ID)',
    example: '90120123456',
  })
  @IsNumberString()
  @IsNotEmpty()
  resourceId!: string;
}
