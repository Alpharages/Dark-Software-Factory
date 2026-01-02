import { IsString, IsOptional, IsObject } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateConstraintDto {
  @ApiPropertyOptional({ description: 'Project ID for project-specific constraints' })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiProperty({ description: 'Scope of the constraint', enum: ['GLOBAL', 'PROJECT'] })
  @IsString()
  scope!: string;

  @ApiProperty({
    description: 'Type of constraint',
    enum: ['ALLOWED_TECH', 'FORBIDDEN_TECH', 'PATTERN', 'STANDARD'],
  })
  @IsString()
  type!: string;

  @ApiProperty({
    description: 'Flexible rule definition',
    example: { items: ['axios'], reason: 'Use fetch' },
  })
  @IsObject()
  rules!: Record<string, unknown>;
}
