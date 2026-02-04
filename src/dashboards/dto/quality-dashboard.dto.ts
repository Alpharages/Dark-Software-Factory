import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';

export class QualityAlertDto {
  @ApiProperty({ enum: ['warning', 'critical'] })
  @IsString()
  @IsEnum(['warning', 'critical'])
  type!: 'warning' | 'critical';

  @ApiProperty()
  @IsString()
  message!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  project_id?: string;

  @ApiProperty()
  @IsString()
  metric!: string;
}

export class BugEscapeMetricsDto {
  @ApiProperty()
  @IsNumber()
  total!: number;

  @ApiProperty()
  @IsNumber()
  rate_percent!: number;

  @ApiProperty()
  @IsNumber()
  target_percent!: number;

  @ApiProperty({ enum: ['within_target', 'approaching_target', 'exceeded'] })
  @IsString()
  @IsEnum(['within_target', 'approaching_target', 'exceeded'])
  status!: 'within_target' | 'approaching_target' | 'exceeded';
}

export class DashboardSummaryDataDto {
  @ApiProperty()
  @IsNumber()
  total_tickets_processed!: number;

  @ApiProperty()
  @IsNumber()
  tickets_passed_qa!: number;

  @ApiProperty()
  @IsNumber()
  tickets_failed_qa!: number;

  @ApiProperty()
  @IsNumber()
  overall_pass_rate_percent!: number;

  @ApiProperty({ type: BugEscapeMetricsDto })
  @ValidateNested()
  @Type(() => BugEscapeMetricsDto)
  bug_escapes!: BugEscapeMetricsDto;

  @ApiProperty()
  @IsNumber()
  avg_test_coverage_percent!: number;

  @ApiProperty()
  @IsNumber()
  avg_test_pass_rate_percent!: number;

  @ApiProperty()
  @IsNumber()
  pending_reviews!: number;

  @ApiProperty()
  @IsNumber()
  deployment_success_rate_percent!: number;
}

export class QualityGatesSummaryDto {
  @ApiProperty()
  @IsNumber()
  projects_configured!: number;

  @ApiProperty()
  @IsNumber()
  projects_using_defaults!: number;

  @ApiProperty()
  @IsNumber()
  average_coverage_threshold!: number;
}

export class QualityDashboardSummaryDto {
  @ApiProperty()
  @IsString()
  period!: string;

  @ApiProperty({ type: DashboardSummaryDataDto })
  @ValidateNested()
  @Type(() => DashboardSummaryDataDto)
  summary!: DashboardSummaryDataDto;

  @ApiProperty({ type: QualityGatesSummaryDto })
  @ValidateNested()
  @Type(() => QualityGatesSummaryDto)
  quality_gates_summary!: QualityGatesSummaryDto;

  @ApiProperty({ type: [QualityAlertDto] })
  @ValidateNested({ each: true })
  @Type(() => QualityAlertDto)
  alerts!: QualityAlertDto[];
}

export class QualityMetricsQueryDto {
  @ApiPropertyOptional({ enum: ['7d', '30d', '90d', 'ytd'], default: '30d' })
  @IsOptional()
  @IsEnum(['7d', '30d', '90d', 'ytd'])
  period?: string = '30d';

  @ApiPropertyOptional({ enum: ['project', 'ai_provider', 'pm', 'project_type'] })
  @IsOptional()
  @IsEnum(['project', 'ai_provider', 'pm', 'project_type'])
  group_by?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  project_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ai_provider?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  pm_id?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class MetricItemDto {
  dashboard_id?: string; // Generic ID for the dimension (project, provider, etc.)

  @ApiProperty()
  @IsUUID()
  dimension_id!: string;

  @ApiProperty()
  @IsString()
  dimension_name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pm_name?: string;

  @ApiProperty({ type: Object }) // Flexible metrics object
  metrics!: {
    tickets_processed: number;
    qa_pass_rate_percent: number;
    avg_coverage_percent: number;
    bug_escapes: number;
    bug_escape_rate_percent: number;
    deployment_success_rate_percent: number;
  };

  @ApiProperty()
  @IsString()
  trend!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  alert?: string;

  @ApiProperty()
  last_updated!: Date;
}

export class QualityMetricsResponseDto {
  @ApiProperty()
  @IsString()
  period!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  group_by?: string;

  @ApiProperty({ type: [MetricItemDto] })
  @ValidateNested({ each: true })
  @Type(() => MetricItemDto)
  items!: MetricItemDto[];

  @ApiProperty()
  pagination!: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export class ProviderComparisonItemDto {
  @ApiProperty()
  @IsString()
  provider!: string;

  @ApiProperty()
  @IsNumber()
  tickets_processed!: number;

  @ApiProperty()
  @IsNumber()
  qa_pass_rate_percent!: number;

  @ApiProperty()
  @IsNumber()
  avg_coverage_percent!: number;

  @ApiProperty()
  @IsNumber()
  avg_complexity_score!: number;

  @ApiProperty()
  @IsNumber()
  bug_escapes!: number;

  @ApiProperty()
  @IsNumber()
  bug_escape_rate_percent!: number;

  @ApiProperty()
  @IsNumber()
  deployment_success_rate_percent!: number;

  @ApiProperty({ type: [String] })
  @IsString({ each: true })
  common_escape_categories!: string[];

  @ApiProperty()
  @IsString()
  trend!: string;
}

export class ProviderAnalysisDto {
  @ApiProperty()
  @IsString()
  better_provider!: string;

  @ApiProperty({ type: [String] })
  @IsString({ each: true })
  key_differences!: string[];
}

export class ProviderComparisonResponseDto {
  @ApiProperty()
  @IsString()
  period!: string;

  @ApiProperty({ type: [ProviderComparisonItemDto] })
  @ValidateNested({ each: true })
  @Type(() => ProviderComparisonItemDto)
  comparison!: ProviderComparisonItemDto[];

  @ApiProperty({ type: ProviderAnalysisDto })
  @ValidateNested()
  @Type(() => ProviderAnalysisDto)
  analysis!: ProviderAnalysisDto;
}

export class QaResultBreakdownItemDto {
  @ApiProperty()
  @IsString()
  category!: string; // or bucket for complexity

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  pass_rate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  avg_issues?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  avg_failures?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  avg_coverage?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  count?: number;
}

export class QualityDrillDownDto {
  @ApiProperty()
  dimension!: {
    type: string;
    id: string;
    name: string;
    pm?: string;
  };

  @ApiProperty()
  @IsString()
  period!: string;

  @ApiProperty()
  overview!: {
    tickets_processed: number;
    qa_pass_rate_percent: number;
    deployment_success_rate_percent: number;
  };

  @ApiProperty()
  quality_gates!: {
    config: {
      min_coverage: number;
      min_test_pass_rate: number;
      max_complexity: number;
    };
    effectiveness: {
      tickets_blocked: number;
      tickets_passed: number;
      most_common_failure: string;
    };
  };

  @ApiProperty()
  qa_results_breakdown!: {
    by_category: QaResultBreakdownItemDto[];
    by_complexity_bucket: QaResultBreakdownItemDto[];
  };

  @ApiProperty()
  bug_escapes!: {
    total: number;
    by_category: { category: string; count: number }[];
    avg_resolution_time_hours: number;
  };

  @ApiProperty()
  recent_tickets!: {
    ticket_id: string;
    clickup_id: string;
    title: string;
    status: string;
    qa_result: string;
    coverage_percent: number;
    processed_at: Date;
  }[];
}

export class ExportQueryDto {
  @ApiProperty({ enum: ['pdf', 'csv', 'json'] })
  @IsString()
  @IsEnum(['pdf', 'csv', 'json'])
  format!: 'pdf' | 'csv' | 'json';

  @ApiPropertyOptional({ enum: ['7d', '30d', '90d', 'ytd'], default: '30d' })
  @IsOptional()
  @IsEnum(['7d', '30d', '90d', 'ytd'])
  period?: string = '30d';

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  project_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  group_by?: string;
}
