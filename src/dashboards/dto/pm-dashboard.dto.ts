import { IsOptional, IsString, IsEnum, IsInt, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ProjectStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  COMPLETED = 'completed',
}

export class ProjectQueryDto {
  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsEnum(ProjectStatus)
  @IsOptional()
  status?: ProjectStatus;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  client?: string;

  @ApiPropertyOptional()
  @IsOptional()
  has_blocked?: string; // 'true' or 'false'

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  min_activity?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sort_by?: string = 'last_activity';

  @ApiPropertyOptional()
  @IsEnum(['asc', 'desc'])
  @IsOptional()
  sort_order?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;
}

export class TicketCountsDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  in_progress!: number;

  @ApiProperty()
  completed!: number;

  @ApiProperty()
  blocked!: number;

  @ApiProperty()
  awaiting_approval!: number;

  @ApiProperty({
    description: 'Tickets with execution COMPLETED/DEPLOYED but pm_synced=false',
    default: 0,
  })
  sync_pending!: number;
}

export class ProviderDistributionItemDto {
  @ApiProperty({ example: 'CLAUDE' })
  provider!: string;

  @ApiProperty({ example: 52.4 })
  percentage!: number;

  @ApiProperty({ example: 22 })
  count!: number;
}

export class ProjectResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  client_name!: string;

  @ApiProperty()
  created_at!: Date;

  @ApiProperty()
  updated_at!: Date;

  @ApiProperty()
  pm_id!: string;

  @ApiProperty({ enum: ProjectStatus })
  status!: ProjectStatus;

  @ApiProperty()
  last_activity!: Date | null;

  @ApiProperty({ type: TicketCountsDto })
  tickets!: TicketCountsDto;
}

export class DashboardSummaryDto {
  @ApiProperty()
  total_projects!: number;

  @ApiProperty()
  active_projects!: number;

  @ApiProperty()
  total_tickets!: number;

  @ApiProperty()
  in_progress_tickets!: number;

  @ApiProperty()
  completed_tickets!: number;

  @ApiProperty()
  blocked_tickets!: number;

  @ApiProperty()
  awaiting_approval_tickets!: number;

  @ApiProperty()
  avg_completion_rate!: number;

  @ApiProperty()
  utilization_percent!: number;

  @ApiProperty()
  success_rate!: number;

  @ApiProperty()
  avg_completion_time_hours!: number;

  @ApiProperty()
  active_ai_executions!: number;

  @ApiProperty()
  queued_ai_executions!: number;

  @ApiProperty({
    type: [Number],
    description: '7-day daily average completion hours (index 0 = oldest day)',
  })
  daily_avg_completion_hours!: number[];

  @ApiProperty({
    description: 'Percentage of auto-generated pull requests merged without manual rework (0 to 1)',
    example: 0.82,
  })
  pr_merge_rate!: number;

  @ApiProperty({
    description: 'Percentage of executions that passed QA on first attempt (0 to 1)',
    example: 0.74,
  })
  qa_first_pass_rate!: number;

  @ApiProperty({
    type: [ProviderDistributionItemDto],
  })
  provider_distribution!: ProviderDistributionItemDto[];

  @ApiProperty({ description: 'Total tickets completed but not yet synced to PM tool', default: 0 })
  sync_pending_tickets!: number;
}

export class FinancialSummaryDto {
  @ApiProperty({
    description: 'Current calendar month total AI spend divided by completed ticket count',
    example: 42.53,
    nullable: true,
  })
  cost_per_ticket!: number | null;

  @ApiProperty({
    description: 'Daily spend values for the past 14 days (oldest to newest)',
    type: [Number],
    example: [12.5, 8.2, 0, 14.9],
  })
  daily_budget_burn!: number[];

  @ApiProperty({
    description: 'Configured monthly budget ceiling in USD',
    example: 12000,
  })
  budget_ceiling!: number;

  @ApiProperty({
    description: 'Projected total spend by end of current month in USD',
    example: 9800,
  })
  budget_forecast!: number;
}

export class TicketSearchQueryDto {
  @ApiProperty()
  @IsString()
  query!: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 10 })
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 10;
}

export class TicketSearchResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  project_name!: string;

  @ApiProperty()
  project_id!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  updated_at!: Date;
}
