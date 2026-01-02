import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsNumber, Min } from 'class-validator';

/**
 * Query parameters for ROI calculator endpoint
 */
export class RoiQueryDto {
  @ApiProperty({
    description: 'Project ID',
    example: 'project-123',
    required: true,
  })
  @IsString()
  projectId!: string;

  @ApiProperty({
    description: 'Time period for ROI calculation',
    enum: ['day', 'week', 'month'],
    example: 'month',
    required: true,
  })
  @IsIn(['day', 'week', 'month'])
  period!: 'day' | 'week' | 'month';

  @ApiProperty({
    description: 'Value per story point in USD (default: 500)',
    example: 500,
    required: false,
    default: 500,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  valuePerPoint?: number;
}

/**
 * Core ROI metrics
 */
export class RoiMetricsInnerDto {
  @ApiProperty({
    description: 'Total AI cost in USD',
    example: '1250.00',
  })
  totalCostUsd!: string;

  @ApiProperty({
    description: 'Total business value in USD',
    example: '3500.00',
  })
  totalValueUsd!: string;

  @ApiProperty({
    description: 'Story points delivered',
    example: 7,
  })
  storyPointsDelivered!: number;

  @ApiProperty({
    description: 'Value assigned per story point',
    example: 500,
  })
  valuePerPoint!: number;

  @ApiProperty({
    description: 'ROI percentage',
    example: 180.0,
  })
  roiPercentage!: number;

  @ApiProperty({
    description: 'Cost per story point in USD',
    example: '178.57',
  })
  costPerStoryPoint!: string;

  @ApiProperty({
    description: 'Break-even point (stories needed)',
    example: '3 stories',
  })
  breakEvenPoint!: string;
}

/**
 * Trend comparison with previous period
 */
export class RoiTrendDto {
  @ApiProperty({
    description: 'Previous period ROI percentage',
    example: 150.0,
  })
  previousPeriodRoi!: number;

  @ApiProperty({
    description: 'Change from previous period',
    example: '+30.0%',
  })
  change!: string;

  @ApiProperty({
    description: 'Trend direction',
    example: 'improving',
    enum: ['improving', 'declining', 'stable'],
  })
  direction!: 'improving' | 'declining' | 'stable';
}

/**
 * Response DTO for ROI calculator endpoint
 */
export class RoiMetricsDto {
  @ApiProperty({
    description: 'Project ID',
    example: 'project-123',
  })
  projectId!: string;

  @ApiProperty({
    description: 'Time period',
    example: 'month',
  })
  period!: string;

  @ApiProperty({
    description: 'ROI metrics',
    type: RoiMetricsInnerDto,
  })
  metrics!: RoiMetricsInnerDto;

  @ApiProperty({
    description: 'Trend comparison',
    type: RoiTrendDto,
  })
  trend!: RoiTrendDto;
}
