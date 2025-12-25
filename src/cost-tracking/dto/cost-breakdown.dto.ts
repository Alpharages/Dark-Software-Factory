import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsInt, Min, Max, IsISO8601 } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query DTO for breakdown endpoint with pagination and filters
 */
export class BreakdownQueryDto {
  @ApiProperty({
    description: 'Group costs by agent or model',
    enum: ['agent', 'model'],
    example: 'model',
  })
  @IsIn(['agent', 'model'])
  groupBy!: 'agent' | 'model';

  @ApiProperty({
    description: 'Page number for pagination',
    example: 1,
    required: false,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({
    description: 'Results per page (max 100)',
    example: 50,
    required: false,
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @ApiProperty({
    description: 'Filter by start date (ISO 8601 format)',
    example: '2025-12-01T00:00:00Z',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiProperty({
    description: 'Filter by end date (ISO 8601 format)',
    example: '2025-12-31T23:59:59Z',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  endDate?: string;
}

/**
 * DTO for grouped cost data
 */
export class GroupedCostDto {
  @ApiProperty({
    description: 'Group key (model name or agent:operation combination)',
    example: 'gpt-4o',
  })
  groupKey!: string;

  @ApiProperty({
    description: 'Total cost in USD for this group',
    example: '150.25',
  })
  totalCostUsd!: string;

  @ApiProperty({
    description: 'Total tokens consumed (input + output)',
    example: 500000,
  })
  totalTokens!: number;

  @ApiProperty({
    description: 'Number of invocations in this group',
    example: 12,
  })
  invocationCount!: number;
}

/**
 * DTO for pagination metadata
 */
export class PaginationMetaDto {
  @ApiProperty({
    description: 'Current page number',
    example: 1,
  })
  page!: number;

  @ApiProperty({
    description: 'Results per page',
    example: 50,
  })
  limit!: number;

  @ApiProperty({
    description: 'Total number of results',
    example: 2,
  })
  total!: number;

  @ApiProperty({
    description: 'Total number of pages',
    example: 1,
  })
  totalPages!: number;

  @ApiProperty({
    description: 'Whether more pages exist',
    example: false,
  })
  hasMore!: boolean;
}

/**
 * Response DTO for cost breakdown endpoint
 */
export class BreakdownDto {
  @ApiProperty({
    description: 'Grouping method used',
    enum: ['agent', 'model'],
    example: 'model',
  })
  groupBy!: string;

  @ApiProperty({
    description: 'Grouped cost data',
    type: [GroupedCostDto],
  })
  data!: GroupedCostDto[];

  @ApiProperty({
    description: 'Pagination information',
    type: PaginationMetaDto,
  })
  meta!: PaginationMetaDto;
}
