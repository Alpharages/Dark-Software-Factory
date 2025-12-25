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
  avg_completion_rate!: number;

  @ApiProperty()
  utilization_percent!: number;
}
