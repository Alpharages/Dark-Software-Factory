import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, IsOptional } from 'class-validator';

/**
 * Query parameters for budget trends endpoint
 */
export class BudgetTrendsQueryDto {
  @ApiProperty({
    description: 'Project ID',
    example: 'project-123',
    required: true,
  })
  @IsString()
  projectId!: string;

  @ApiProperty({
    description: 'Time period for trend analysis',
    enum: ['week', 'month', 'quarter'],
    example: 'month',
    required: true,
  })
  @IsIn(['week', 'month', 'quarter'])
  period!: 'week' | 'month' | 'quarter';

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
 * Single data point in time series
 */
export class TimeSeriesDataPointDto {
  @ApiProperty({
    description: 'Date of data point',
    example: '2025-12-01',
  })
  date!: string;

  @ApiProperty({
    description: 'Daily cost in USD',
    example: '45.20',
  })
  dailyCost!: string;

  @ApiProperty({
    description: 'Cumulative cost to date in USD',
    example: '45.20',
  })
  cumulativeCost!: string;

  @ApiProperty({
    description: 'Utilization percentage',
    example: 0.904,
  })
  utilizationPct!: number;
}

/**
 * Budget utilization summary
 */
export class BudgetSummaryDto {
  @ApiProperty({
    description: 'Total budget in USD',
    example: '5000.00',
  })
  totalBudgetUsd!: string;

  @ApiProperty({
    description: 'Amount spent in USD',
    example: '1850.50',
  })
  spentUsd!: string;

  @ApiProperty({
    description: 'Remaining budget in USD',
    example: '3149.50',
  })
  remainingUsd!: string;

  @ApiProperty({
    description: 'Utilization percentage',
    example: 37.01,
  })
  utilizationPercentage!: number;
}

/**
 * Trend forecasting metrics
 */
export class TrendForecastDto {
  @ApiProperty({
    description: 'Burn rate per day in USD',
    example: '61.68',
  })
  burnRatePerDay!: string;

  @ApiProperty({
    description: 'Forecast days until budget exhausted',
    example: 51,
  })
  forecastDaysRemaining!: number;

  @ApiProperty({
    description: 'Forecast exhaustion date',
    example: '2026-02-20',
  })
  forecastExhaustionDate!: string;

  @ApiProperty({
    description: 'Budget health status',
    example: 'healthy',
    enum: ['healthy', 'warning', 'critical'],
  })
  status!: 'healthy' | 'warning' | 'critical';
}

/**
 * Spending anomaly detection
 */
export class FinancialAnomalyDto {
  @ApiProperty({
    description: 'Date of anomaly',
    example: '2025-12-15',
  })
  date!: string;

  @ApiProperty({
    description: 'Cost on anomaly date in USD',
    example: '185.00',
  })
  cost!: string;

  @ApiProperty({
    description: 'Average cost for comparison',
    example: '62.00',
  })
  avgCost!: string;

  @ApiProperty({
    description: 'Spike percentage',
    example: '198%',
  })
  spike!: string;

  @ApiProperty({
    description: 'Reason for anomaly',
    example: 'Self-healing spike - Epic 3 QA refactor',
  })
  reason!: string;
}

/**
 * Response DTO for budget trends endpoint
 */
export class BudgetTrendsDto {
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
    description: 'Budget summary',
    type: BudgetSummaryDto,
  })
  budget!: BudgetSummaryDto;

  @ApiProperty({
    description: 'Trend forecasting metrics',
    type: TrendForecastDto,
  })
  trends!: TrendForecastDto;

  @ApiProperty({
    description: 'Time series data points',
    type: [TimeSeriesDataPointDto],
  })
  timeSeries!: TimeSeriesDataPointDto[];

  @ApiProperty({
    description: 'Detected anomalies',
    type: [FinancialAnomalyDto],
  })
  anomalies!: FinancialAnomalyDto[];
}
