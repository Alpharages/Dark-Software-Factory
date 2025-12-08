import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * DTO for linting fix suggestion
 */
export class LintingFixDto {
  @ApiProperty({
    description: 'Description of the suggested fix',
    example: 'Remove unused variable',
  })
  @IsString()
  description!: string;

  @ApiPropertyOptional({
    description: 'Replacement text if available',
    example: '',
  })
  @IsOptional()
  @IsString()
  replacementText?: string;
}
