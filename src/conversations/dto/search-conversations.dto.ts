import { IsString, IsOptional, IsDateString, IsEnum, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SearchConversationsDto {
  @ApiPropertyOptional({ description: 'Keyword search (full-text)' })
  @IsString()
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Filter by project ID' })
  @IsString()
  @IsOptional()
  projectId?: string;

  @ApiPropertyOptional({
    enum: ['positive', 'neutral', 'negative'],
    description: 'Filter by sentiment',
  })
  @IsEnum(['positive', 'neutral', 'negative'])
  @IsOptional()
  sentiment?: 'positive' | 'neutral' | 'negative';

  @ApiPropertyOptional({ format: 'date', description: 'Start date for date range filter' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiPropertyOptional({ format: 'date', description: 'End date for date range filter' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({ default: 1, description: 'Page number (1-indexed)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page: number = 1;

  @ApiPropertyOptional({ default: 20, description: 'Items per page' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  limit: number = 20;
}
