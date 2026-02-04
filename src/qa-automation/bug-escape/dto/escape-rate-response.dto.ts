import { ApiProperty } from '@nestjs/swagger';

class EscapeRateSummary {
  @ApiProperty({ description: 'Total deployed tickets' })
  total_deployed!: number;

  @ApiProperty({ description: 'Total bug escapes' })
  total_escapes!: number;

  @ApiProperty({ description: 'Escape rate percentage' })
  escape_rate_percent!: number;

  @ApiProperty({ description: 'Target escape rate percentage' })
  target_rate_percent!: number;

  @ApiProperty({ description: 'Status relative to target', enum: ['within_target', 'exceeded'] })
  status!: string;
}

class EscapeRateDimension {
  @ApiProperty({ description: 'Dimension value (e.g., cursor, claude)' })
  dimension!: string;

  @ApiProperty({ description: 'Deployed count for this dimension' })
  deployed_count!: number;

  @ApiProperty({ description: 'Escape count for this dimension' })
  escape_count!: number;

  @ApiProperty({ description: 'Escape rate percentage for this dimension' })
  escape_rate_percent!: number;
}

class EscapeRateTrend {
  @ApiProperty({ description: 'Trend direction', enum: ['improving', 'declining', 'stable'] })
  direction!: string;

  @ApiProperty({ description: 'Previous period rate' })
  previous_period_rate!: number;

  @ApiProperty({ description: 'Percentage change' })
  change_percent!: number;
}

export class EscapeRateResponseDto {
  @ApiProperty({ description: 'Period covered' })
  period!: string;

  @ApiProperty({ type: EscapeRateSummary })
  summary!: EscapeRateSummary;

  @ApiProperty({ type: [EscapeRateDimension] })
  breakdown!: EscapeRateDimension[];

  @ApiProperty({ type: EscapeRateTrend })
  trend!: EscapeRateTrend;
}
