import { ApiProperty } from '@nestjs/swagger';

export class QueueMetricsDto {
  @ApiProperty()
  current_depth: number = 0;

  @ApiProperty()
  average_wait_time_minutes: number = 0;
}

export class AdrMetricsDto {
  @ApiProperty()
  review_volume: Record<string, number> = {};

  @ApiProperty()
  approval_rate: Record<string, number> = {};

  @ApiProperty()
  risk_distribution: Record<string, number> = {};

  @ApiProperty()
  top_rejection_reasons: Record<string, number> = {};

  @ApiProperty({ type: QueueMetricsDto })
  queue_metrics: QueueMetricsDto = new QueueMetricsDto();
}

export class TrendPointDto {
  @ApiProperty()
  date: string = '';

  @ApiProperty()
  value: number = 0;
}

export class AdrTrendsDto {
  @ApiProperty({ type: [TrendPointDto] })
  approval_rate_trend: TrendPointDto[] = [];

  @ApiProperty({ type: [TrendPointDto] })
  review_volume_trend: TrendPointDto[] = [];

  @ApiProperty()
  learning_insights: string[] = [];
}
