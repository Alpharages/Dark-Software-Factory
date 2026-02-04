import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';

export class QAWorkloadSummaryDto {
  @ApiProperty()
  @IsString()
  period!: string;

  @ApiProperty()
  @ValidateNested()
  @Type(() => Object)
  summary!: {
    total_reviews_completed: number;
    total_reviews_pending: number;
    reviews_by_decision: {
      approved: number;
      rejected: number;
      escalated: number;
    };
    avg_review_time_minutes: number;
    median_review_time_minutes: number;
    sla_compliance_percent: number;
    reviews_per_day_average: number;
  };

  @ApiProperty()
  @ValidateNested()
  @Type(() => Object)
  queue_health!: {
    current_depth: number;
    oldest_pending_hours: number;
    avg_wait_time_hours: number;
    at_risk_count: number;
    trend: 'improving' | 'stable' | 'declining';
  };

  @ApiProperty()
  @ValidateNested()
  @Type(() => Object)
  capacity!: {
    active_reviewers: number;
    target_reviews_per_day: number;
    current_utilization_percent: number;
    projected_clear_time_hours: number;
  };
}

export class ReviewerPerformanceDto {
  @ApiProperty()
  @IsUUID()
  reviewer_id!: string;

  @ApiProperty()
  @IsString()
  reviewer_name!: string;

  @ApiProperty()
  @IsString()
  role!: string;

  @ApiProperty()
  @ValidateNested()
  @Type(() => Object)
  metrics!: {
    reviews_completed: number;
    reviews_pending: number;
    avg_review_time_minutes: number;
    approval_rate_percent: number;
    rejection_rate_percent: number;
    escalation_rate_percent: number;
    sla_compliance_percent: number;
    bug_escapes_caught: number;
    false_positive_rate: number;
  };

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateNested()
  @Type(() => Object)
  daily_pattern?: {
    peak_hours: string[];
    avg_reviews_per_day: number;
  };

  @ApiProperty()
  @IsString()
  @IsEnum(['improving', 'stable', 'declining'])
  trend!: 'improving' | 'stable' | 'declining';
}

export class ReviewerPerformanceResponseDto {
  @ApiProperty()
  @IsString()
  period!: string;

  @ApiProperty({ type: [ReviewerPerformanceDto] })
  @ValidateNested({ each: true })
  @Type(() => ReviewerPerformanceDto)
  reviewers!: ReviewerPerformanceDto[];

  @ApiProperty()
  @ValidateNested()
  @Type(() => Object)
  aggregates!: {
    total_reviewers: number;
    team_avg_review_time: number;
    team_sla_compliance: number;
  };
}

export class QueueFlowDataPointDto {
  @ApiProperty()
  timestamp!: Date;

  @ApiProperty()
  @IsNumber()
  inflow_count!: number;

  @ApiProperty()
  @IsNumber()
  outflow_count!: number;

  @ApiProperty()
  @IsNumber()
  net_change!: number;

  @ApiProperty()
  @IsNumber()
  ending_depth!: number;

  @ApiProperty()
  @IsNumber()
  avg_wait_time_hours!: number;

  @ApiProperty()
  @IsNumber()
  sla_breaches!: number;
}

export class QueueFlowResponseDto {
  @ApiProperty()
  @IsString()
  period!: string;

  @ApiProperty()
  @IsString()
  granularity!: string;

  @ApiProperty({ type: [QueueFlowDataPointDto] })
  @ValidateNested({ each: true })
  @Type(() => QueueFlowDataPointDto)
  data_points!: QueueFlowDataPointDto[];

  @ApiProperty()
  @ValidateNested()
  @Type(() => Object)
  summary!: {
    total_inflow: number;
    total_outflow: number;
    avg_daily_inflow: number;
    avg_processing_rate: number;
    peak_inflow_day: string;
    peak_inflow_count: number;
  };
}

export class WorkloadAlertDto {
  @ApiProperty()
  @IsUUID()
  alert_id!: string;

  @ApiProperty()
  @IsString()
  type!: string;

  @ApiProperty({ enum: ['warning', 'critical'] })
  @IsString()
  @IsEnum(['warning', 'critical'])
  severity!: 'warning' | 'critical';

  @ApiProperty()
  @IsString()
  message!: string;

  @ApiProperty()
  @IsNumber()
  current_value!: number;

  @ApiProperty()
  @IsNumber()
  threshold!: number;

  @ApiProperty()
  timestamp!: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recommended_action?: string;
}

export class WorkloadSummaryQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d', '90d'], default: '30d' })
  @IsOptional()
  @IsEnum(['7d', '30d', '90d'])
  period?: string = '30d';
}

export class ReviewerPerformanceQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d', '90d'], default: '30d' })
  @IsOptional()
  @IsEnum(['7d', '30d', '90d'])
  period?: string = '30d';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reviewer_id?: string;
}

export class QueueFlowQueryDto {
  @ApiPropertyOptional({ enum: ['24h', '7d', '30d'], default: '7d' })
  @IsOptional()
  @IsEnum(['24h', '7d', '30d'])
  period?: string = '7d';

  @ApiPropertyOptional({ enum: ['hour', 'day'], default: 'day' })
  @IsOptional()
  @IsEnum(['hour', 'day'])
  granularity?: string = 'day';
}

export class WorkloadExportQueryDto {
  @ApiProperty({ enum: ['pdf', 'csv', 'json'] })
  @IsEnum(['pdf', 'csv', 'json'])
  format!: 'pdf' | 'csv' | 'json';

  @ApiPropertyOptional({ enum: ['7d', '30d', '90d'], default: '30d' })
  @IsOptional()
  @IsEnum(['7d', '30d', '90d'])
  period?: string = '30d';

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Type(() => Boolean)
  include_reviewer_details?: boolean = true;
}
