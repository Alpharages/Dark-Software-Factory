import { IsString, IsOptional, IsBoolean, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskType } from '@/prisma/client';

export class CreateLimitationDto {
  @ApiProperty({ enum: TaskType, description: 'Type of task to apply limitation to' })
  @IsEnum(TaskType)
  taskType: TaskType = TaskType.CODE_GENERATION;

  @ApiPropertyOptional({ description: 'Description of known issues' })
  @IsOptional()
  @IsString()
  knownIssues?: string;

  @ApiPropertyOptional({ description: 'Manual workaround steps' })
  @IsOptional()
  @IsString()
  workaround?: string;

  @ApiPropertyOptional({ description: 'Disable AI from attempting this task type' })
  @IsOptional()
  @IsBoolean()
  isDisabled?: boolean;
}

export class UpdateLimitationDto {
  @ApiPropertyOptional({ description: 'Description of known issues' })
  @IsOptional()
  @IsString()
  knownIssues?: string;

  @ApiPropertyOptional({ description: 'Manual workaround steps' })
  @IsOptional()
  @IsString()
  workaround?: string;

  @ApiPropertyOptional({ description: 'Disable AI from attempting this task type' })
  @IsOptional()
  @IsBoolean()
  isDisabled?: boolean;
}

export class CapabilityDashboardResponseDto {
  @ApiProperty({ description: 'Capabilities by task type' })
  capabilities: CapabilityMetricDto[] = [];

  @ApiProperty({ description: 'Top limitations requiring attention' })
  topLimitations: LimitationDto[] = [];
}

export class CapabilityMetricDto {
  @ApiProperty({ enum: TaskType })
  taskType: TaskType = TaskType.CODE_GENERATION;

  @ApiProperty({ description: 'Success rate percentage' })
  successRate: number = 0;

  @ApiProperty({ description: 'Trend indicator' })
  trend: 'UP' | 'DOWN' | 'STABLE' = 'STABLE';
}

export class LimitationDto {
  @ApiProperty({ enum: TaskType })
  taskType: TaskType = TaskType.CODE_GENERATION;

  @ApiProperty({ description: 'Current failure rate' })
  failureRate: number = 0;

  @ApiPropertyOptional({ description: 'Known issues description' })
  knownIssues?: string;

  @ApiPropertyOptional({ description: 'Workaround steps' })
  workaround?: string;

  @ApiProperty({ description: 'Whether AI is disabled for this task' })
  isDisabled: boolean = false;
}
