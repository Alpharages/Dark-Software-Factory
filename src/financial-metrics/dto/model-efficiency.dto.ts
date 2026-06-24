import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsISO8601 } from 'class-validator';
import { AIProvider } from '@/prisma/client';

/**
 * Query parameters for model efficiency endpoint
 */
export class ModelEfficiencyQueryDto {
  @ApiProperty({
    description: 'Project ID',
    example: 'project-123',
    required: true,
  })
  @IsString()
  projectId!: string;

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
}

/**
 * Individual model performance metrics
 */
export class ModelMetricsDto {
  @ApiProperty({
    description: 'AI model name',
    example: 'gpt-4o',
  })
  modelName!: string;

  @ApiProperty({
    description: 'AI provider',
    example: 'CLAUDE_CODE',
    enum: AIProvider,
  })
  provider!: AIProvider;

  @ApiProperty({
    description: 'Total cost in USD',
    example: '850.00',
  })
  totalCostUsd!: string;

  @ApiProperty({
    description: 'Total execution count',
    example: 45,
  })
  executionCount!: number;

  @ApiProperty({
    description: 'Success rate percentage',
    example: 88.9,
  })
  successRate!: number;

  @ApiProperty({
    description: 'Cost per execution in USD',
    example: '18.89',
  })
  costPerExecution!: string;

  @ApiProperty({
    description: 'Cost per 1000 tokens in USD',
    example: '0.0425',
  })
  costPer1kTokens!: string;

  @ApiProperty({
    description: 'Average execution time in seconds',
    example: 125,
  })
  avgExecutionTimeSec!: number;
}

/**
 * Model recommendation
 */
export class ModelRecommendationDto {
  @ApiProperty({
    description: 'Most efficient model',
    example: 'claude-3.5-sonnet',
  })
  mostEfficient!: string;

  @ApiProperty({
    description: 'Reasoning for recommendation',
    example: 'Lower cost per execution, higher success rate, faster execution',
  })
  reason!: string;

  @ApiProperty({
    description: 'Potential cost savings',
    example: '15-20% if migrating all GEMINI tasks to CLAUDE',
  })
  potentialSavings!: string;
}

/**
 * Response DTO for model efficiency endpoint
 */
export class ModelEfficiencyDto {
  @ApiProperty({
    description: 'Model performance metrics',
    type: [ModelMetricsDto],
  })
  models!: ModelMetricsDto[];

  @ApiProperty({
    description: 'Efficiency recommendation',
    type: ModelRecommendationDto,
  })
  recommendation!: ModelRecommendationDto;
}
