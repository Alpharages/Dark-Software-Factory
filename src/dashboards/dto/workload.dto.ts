import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, Min, Max, IsNotEmpty, IsOptional } from 'class-validator';

export class UpdateMaxTicketsDto {
  @ApiProperty({
    description: 'Maximum number of tickets PM can handle simultaneously',
    example: 25,
    minimum: 1,
    maximum: 100,
  })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsNotEmpty()
  max_tickets!: number;
}

export class HistoricalTrendsQueryDto {
  @ApiPropertyOptional({
    description: 'Number of days of historical data to retrieve',
    example: 30,
    default: 30,
    minimum: 1,
    maximum: 365,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number = 30;
}

export class UtilizationResponseDto {
  @ApiProperty({ description: 'PM user ID', example: 'pm-123' })
  pm_id!: string;

  @ApiProperty({ description: 'PM name', example: 'John Doe' })
  pm_name!: string;

  @ApiProperty({ description: 'PM email', example: 'john.doe@example.com' })
  pm_email!: string;

  @ApiProperty({ description: 'Number of active tickets', example: 15 })
  active_tickets!: number;

  @ApiProperty({ description: 'Maximum tickets capacity', example: 20 })
  max_tickets!: number;

  @ApiProperty({ description: 'Utilization percentage', example: 75.0 })
  utilization_pct!: number;

  @ApiProperty({
    description: 'Burnout risk level',
    enum: ['green', 'yellow', 'red'],
    example: 'yellow',
  })
  burnout_risk!: 'green' | 'yellow' | 'red';

  @ApiProperty({
    description: 'Human-readable burnout risk explanation',
    example: 'Moderate Risk - Approaching capacity limit',
  })
  burnout_risk_label!: string;
}

export class TeamCapacityResponseDto {
  @ApiProperty({ description: 'PM user ID', example: 'pm-123' })
  pm_id!: string;

  @ApiProperty({ description: 'PM name', example: 'John Doe' })
  pm_name!: string;

  @ApiProperty({ description: 'PM email', example: 'john.doe@example.com' })
  pm_email!: string;

  @ApiProperty({ description: 'Number of active tickets', example: 15 })
  active_tickets!: number;

  @ApiProperty({ description: 'Maximum tickets capacity', example: 20 })
  max_tickets!: number;

  @ApiProperty({ description: 'Utilization percentage', example: 75.0 })
  utilization_pct!: number;

  @ApiProperty({
    description: 'Burnout risk level',
    enum: ['green', 'yellow', 'red'],
    example: 'yellow',
  })
  burnout_risk!: 'green' | 'yellow' | 'red';
}

export class HistoricalTrendPointDto {
  @ApiProperty({ description: 'Snapshot date', example: '2024-12-01' })
  snapshot_date!: Date;

  @ApiProperty({ description: 'Active tickets on snapshot date', example: 15 })
  active_tickets!: number;

  @ApiProperty({ description: 'Max tickets capacity on snapshot date', example: 20 })
  max_tickets!: number;

  @ApiProperty({ description: 'Utilization percentage on snapshot date', example: 75.0 })
  utilization_pct!: number;
}

export class HistoricalTrendsResponseDto {
  @ApiProperty({
    description: 'Array of historical utilization data points',
    type: [HistoricalTrendPointDto],
  })
  data!: HistoricalTrendPointDto[];
}
