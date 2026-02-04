import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsUUID, IsDateString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class BugEscapeQueryDto {
  @ApiPropertyOptional({
    description: 'Predefined period',
    enum: ['7d', '30d', '90d', 'ytd', 'custom'],
  })
  @IsOptional()
  @IsEnum(['7d', '30d', '90d', 'ytd', 'custom'])
  period?: string = '30d';

  @ApiPropertyOptional({ description: 'Start date (ISO 8601)', example: '2026-01-01' })
  @IsOptional()
  @IsDateString()
  start_date?: string;

  @ApiPropertyOptional({ description: 'End date (ISO 8601)', example: '2026-01-31' })
  @IsOptional()
  @IsDateString()
  end_date?: string;

  @ApiPropertyOptional({ description: 'Filter by project ID' })
  @IsOptional()
  @IsUUID()
  project_id?: string;

  @ApiPropertyOptional({
    description: 'Group by dimension',
    enum: ['provider', 'project', 'complexity', 'category'],
  })
  @IsOptional()
  @IsEnum(['provider', 'project', 'complexity', 'category'])
  group_by?: string;

  @ApiPropertyOptional({ description: 'Page number', minimum: 1, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Page size', minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 20;
}
