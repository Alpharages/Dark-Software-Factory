import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';

export class QualityTrendsQueryDto {
  @ApiProperty({
    description: 'Metric to trend',
    enum: ['escape_rate', 'coverage', 'test_pass_rate', 'review_findings'],
  })
  @IsEnum(['escape_rate', 'coverage', 'test_pass_rate', 'review_findings'])
  metric!: string;

  @ApiPropertyOptional({
    description: 'Time granularity',
    enum: ['daily', 'weekly', 'monthly'],
    default: 'weekly',
  })
  @IsOptional()
  @IsEnum(['daily', 'weekly', 'monthly'])
  granularity?: string = 'weekly';

  @ApiPropertyOptional({
    description: 'Time period',
    enum: ['30d', '90d', '6m', '1y'],
    default: '90d',
  })
  @IsOptional()
  @IsEnum(['30d', '90d', '6m', '1y'])
  period?: string = '90d';

  @ApiPropertyOptional({ description: 'Filter by project ID' })
  @IsOptional()
  @IsUUID()
  project_id?: string;
}
