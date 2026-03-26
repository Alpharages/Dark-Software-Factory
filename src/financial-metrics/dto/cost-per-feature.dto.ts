import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsISO8601 } from 'class-validator';
import { AIProvider } from '@/prisma/client';

/**
 * Query parameters for cost-per-feature endpoint
 */
export class CostPerFeatureQueryDto {
  @ApiProperty({
    description: 'Epic identifier (e.g., "epic-5" or "5")',
    example: 'epic-5',
    required: true,
  })
  @IsString()
  epicId!: string;

  @ApiProperty({
    description: 'Optional project ID filter',
    example: 'project-uuid',
    required: false,
  })
  @IsOptional()
  @IsString()
  projectId?: string;

  @ApiProperty({
    description: 'Optional start date filter (ISO 8601)',
    example: '2025-12-01T00:00:00Z',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiProperty({
    description: 'Optional end date filter (ISO 8601)',
    example: '2025-12-31T23:59:59Z',
    required: false,
  })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiProperty({
    description: 'Response format',
    enum: ['json', 'csv'],
    default: 'json',
    required: false,
  })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}

/**
 * Individual story cost breakdown
 */
export class StoryCostDto {
  @ApiProperty({
    description: 'Story identifier',
    example: '5-1',
  })
  storyId!: string;

  @ApiProperty({
    description: 'Story title',
    example: 'PM Dashboard API',
  })
  storyTitle!: string;

  @ApiProperty({
    description: 'Total cost in USD (Decimal as string)',
    example: '125.50',
  })
  costUsd!: string;

  @ApiProperty({
    description: 'Total tokens consumed',
    example: 350000,
  })
  tokensTotal!: number;

  @ApiProperty({
    description: 'Story completion date',
    example: '2025-12-23',
    required: false,
  })
  completionDate?: string;
}

/**
 * Cost breakdown by AI provider
 */
export class ProviderBreakdownDto {
  @ApiProperty({
    description: 'AI provider name',
    example: 'CLAUDE_CODE',
    enum: AIProvider,
  })
  provider!: AIProvider;

  @ApiProperty({
    description: 'Total cost in USD',
    example: '280.15',
  })
  costUsd!: string;

  @ApiProperty({
    description: 'Percentage of total cost',
    example: 62.2,
  })
  percentage!: number;
}

/**
 * Response DTO for cost-per-feature endpoint
 */
export class CostPerFeatureDto {
  @ApiProperty({
    description: 'Epic identifier',
    example: 'epic-5',
  })
  epicId!: string;

  @ApiProperty({
    description: 'Epic title',
    example: 'PM Dashboard',
  })
  epicTitle!: string;

  @ApiProperty({
    description: 'Total cost for epic in USD',
    example: '450.25',
  })
  totalCostUsd!: string;

  @ApiProperty({
    description: 'Number of stories in epic',
    example: 7,
  })
  storyCount!: number;

  @ApiProperty({
    description: 'Average cost per story',
    example: '64.32',
  })
  avgCostPerStory!: string;

  @ApiProperty({
    description: 'Cost breakdown by individual stories',
    type: [StoryCostDto],
  })
  storyCosts!: StoryCostDto[];

  @ApiProperty({
    description: 'Cost breakdown by AI provider',
    type: [ProviderBreakdownDto],
  })
  byProvider!: ProviderBreakdownDto[];
}
