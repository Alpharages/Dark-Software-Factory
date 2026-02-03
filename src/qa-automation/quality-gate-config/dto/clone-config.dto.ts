import { IsArray, IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CloneConfigDto {
  @IsArray()
  @IsString({ each: true })
  @ApiProperty({
    example: ['target-uuid-1', 'target-uuid-2'],
    description: 'List of target project IDs',
  })
  targetProjectIds!: string[];

  @IsString()
  @IsOptional()
  @ApiProperty({ example: 'Standardizing quality gates across client portals', required: false })
  reason?: string;
}
