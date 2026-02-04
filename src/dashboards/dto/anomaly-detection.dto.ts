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
  IsDate,
  IsArray,
} from 'class-validator';

export enum AnomalyType {
  SUDDEN_DROP = 'sudden_drop',
  TREND_DECLINE = 'trend_decline',
  SPIKE = 'spike',
  THRESHOLD_BREACH = 'threshold_breach',
  BASELINE_DEVIATION = 'baseline_deviation',
}

export enum AnomalyMetric {
  TEST_PASS_RATE = 'test_pass_rate',
  TEST_COVERAGE = 'test_coverage',
  BUG_ESCAPE_RATE = 'bug_escape_rate',
  SECURITY_VULNERABILITIES = 'security_vulnerabilities',
}

export enum AnomalySeverity {
  CRITICAL = 'critical',
  WARNING = 'warning',
  INFO = 'info',
}

export enum AnomalyStatus {
  OPEN = 'open',
  ACKNOWLEDGED = 'acknowledged',
  INVESTIGATING = 'investigating',
  RESOLVED = 'resolved',
  FALSE_POSITIVE = 'false_positive',
}

export class ExpectedRangeDto {
  @ApiProperty()
  @IsNumber()
  min!: number;

  @ApiProperty()
  @IsNumber()
  max!: number;
}

export class AnomalyValuesDto {
  @ApiProperty()
  @IsNumber()
  current!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  previous?: number;

  @ApiPropertyOptional({ type: ExpectedRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExpectedRangeDto)
  expected_range?: ExpectedRangeDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  change_percent?: number;
}

export class AIAnalysisDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  possible_causes!: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  recommended_actions!: string[];

  @ApiProperty()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence!: number;
}

export class AnomalyResolutionInfoDto {
  @ApiProperty()
  @IsDate()
  @Type(() => Date)
  resolved_at!: Date;

  @ApiProperty()
  @IsString()
  resolved_by!: string;

  @ApiProperty()
  @IsString()
  notes!: string;
}

export class AnomalyDto {
  @ApiProperty()
  @IsUUID()
  id!: string;

  @ApiProperty({ enum: AnomalyType })
  @IsEnum(AnomalyType)
  type!: AnomalyType;

  @ApiProperty({ enum: AnomalyMetric })
  @IsEnum(AnomalyMetric)
  metric!: AnomalyMetric;

  @ApiProperty({ enum: AnomalySeverity })
  @IsEnum(AnomalySeverity)
  severity!: AnomalySeverity;

  @ApiProperty()
  @IsUUID()
  project_id!: string;

  @ApiProperty()
  @IsString()
  project_name!: string;

  @ApiProperty()
  @IsDate()
  @Type(() => Date)
  detected_at!: Date;

  @ApiProperty({ type: AnomalyValuesDto })
  @ValidateNested()
  @Type(() => AnomalyValuesDto)
  values!: AnomalyValuesDto;

  @ApiPropertyOptional({ type: AIAnalysisDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AIAnalysisDto)
  ai_analysis?: AIAnalysisDto;

  @ApiProperty({ enum: AnomalyStatus })
  @IsEnum(AnomalyStatus)
  status!: AnomalyStatus;

  @ApiPropertyOptional({ type: AnomalyResolutionInfoDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AnomalyResolutionInfoDto)
  resolution?: AnomalyResolutionInfoDto;
}

export class AnomalyQueryDto {
  @ApiPropertyOptional({ enum: AnomalyStatus })
  @IsOptional()
  @IsEnum(AnomalyStatus)
  status?: AnomalyStatus;

  @ApiPropertyOptional({ enum: AnomalySeverity })
  @IsOptional()
  @IsEnum(AnomalySeverity)
  severity?: AnomalySeverity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  project_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  from_date?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  to_date?: Date;

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

export class AnomalyConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  project_id?: string;

  @ApiProperty({ type: Object })
  @IsOptional()
  thresholds?: {
    [key in AnomalyMetric]?: {
      sudden_drop_percent?: number;
      trend_decline_days?: number;
      spike_percent?: number;
      absolute_min?: number;
    };
  };

  @ApiPropertyOptional()
  @IsOptional()
  notifications_enabled?: boolean = true;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsString({ each: true })
  slack_channels?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsString({ each: true })
  email_recipients?: string[];
}

export class AnomalyResolutionDto {
  @ApiProperty({ enum: AnomalyStatus })
  @IsEnum(AnomalyStatus)
  status!: AnomalyStatus;

  @ApiProperty()
  @IsString()
  notes!: string;
}
