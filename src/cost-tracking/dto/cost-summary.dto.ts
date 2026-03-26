import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { AIProvider } from '@/prisma/client';

/**
 * DTO for period path parameter validation
 */
export class PeriodParamDto {
  @ApiProperty({
    description: 'Time period for cost summary aggregation',
    enum: ['day', 'week', 'month'],
    example: 'day',
  })
  @IsIn(['day', 'week', 'month'])
  period!: 'day' | 'week' | 'month';
}

/**
 * DTO for provider cost aggregation
 */
export class ProviderCostDto {
  @ApiProperty({
    description: 'AI provider name',
    enum: AIProvider,
    example: 'CLAUDE_CODE',
  })
  provider!: AIProvider;

  @ApiProperty({
    description: 'Total cost in USD for this provider',
    example: '30.50',
  })
  costUsd!: string;

  @ApiProperty({
    description: 'Total tokens consumed (input + output)',
    example: 150000,
  })
  tokens!: number;
}

/**
 * DTO for model cost aggregation
 */
export class ModelCostDto {
  @ApiProperty({
    description: 'AI model name',
    example: 'gpt-4o',
  })
  model!: string;

  @ApiProperty({
    description: 'Total cost in USD for this model',
    example: '30.50',
  })
  costUsd!: string;

  @ApiProperty({
    description: 'Total tokens consumed (input + output)',
    example: 150000,
  })
  tokens!: number;
}

/**
 * Response DTO for cost summary endpoint
 */
export class CostSummaryDto {
  @ApiProperty({
    description: 'Time period requested',
    enum: ['day', 'week', 'month'],
    example: 'day',
  })
  period!: string;

  @ApiProperty({
    description: 'Start date of the period (UTC)',
    example: '2025-12-24T17:11:00Z',
  })
  startDate!: string;

  @ApiProperty({
    description: 'End date of the period (UTC)',
    example: '2025-12-25T17:11:00Z',
  })
  endDate!: string;

  @ApiProperty({
    description: 'Total cost in USD for the period',
    example: '45.23',
  })
  totalCostUsd!: string;

  @ApiProperty({
    description: 'Total input tokens consumed',
    example: 125000,
  })
  totalTokensInput!: number;

  @ApiProperty({
    description: 'Total output tokens consumed',
    example: 78000,
  })
  totalTokensOutput!: number;

  @ApiProperty({
    description: 'Total number of AI invocations',
    example: 23,
  })
  invocationCount!: number;

  @ApiProperty({
    description: 'Cost breakdown by AI provider',
    type: [ProviderCostDto],
  })
  byProvider!: ProviderCostDto[];

  @ApiProperty({
    description: 'Cost breakdown by AI model',
    type: [ModelCostDto],
  })
  byModel!: ModelCostDto[];
}
