/**
 * Error Trend DTOs
 * Story 9-U-5: Production Error Dashboard - AC#5
 *
 * DTOs for the 7-day error trend chart.
 */

import { ApiProperty } from '@nestjs/swagger';

export class ErrorTrendsBySeverityDto {
  @ApiProperty({ description: 'CRITICAL error counts per day', type: [Number] })
  CRITICAL!: number[];

  @ApiProperty({ description: 'HIGH error counts per day', type: [Number] })
  HIGH!: number[];

  @ApiProperty({ description: 'MEDIUM error counts per day', type: [Number] })
  MEDIUM!: number[];

  @ApiProperty({ description: 'LOW error counts per day', type: [Number] })
  LOW!: number[];
}

export class ErrorTrendResponseDto {
  @ApiProperty({ description: 'Dates for the trend period (ISO format)', type: [String] })
  dates!: string[];

  @ApiProperty({ description: 'Error counts by severity', type: ErrorTrendsBySeverityDto })
  trendsBySeverity!: ErrorTrendsBySeverityDto;
}

export class ErrorTrendsQueryDto {
  @ApiProperty({ description: 'Number of days to include in trend', default: 7, required: false })
  days?: number;
}
