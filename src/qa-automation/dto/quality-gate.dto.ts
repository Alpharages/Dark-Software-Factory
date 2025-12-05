import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsString,
  IsArray,
  IsEnum,
  IsOptional,
  ValidateNested,
  IsObject,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { QualityGateStatus, QualityCategory, BlockerType, WarningType } from '../interfaces';

export class QualityThresholdsDto {
  @ApiProperty({ description: 'Minimum test pass rate (0-100)', minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  minTestPassRate!: number;

  @ApiProperty({ description: 'Minimum coverage percentage', minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  minCoverage!: number;

  @ApiProperty({ description: 'Maximum linting errors allowed' })
  @IsNumber()
  @Min(0)
  maxLintingErrors!: number;

  @ApiProperty({ description: 'Maximum linting warnings allowed' })
  @IsNumber()
  @Min(0)
  maxLintingWarnings!: number;

  @ApiProperty({ description: 'Block on critical security vulnerabilities' })
  @IsBoolean()
  blockOnCriticalSecurity!: boolean;

  @ApiProperty({ description: 'Block on high security vulnerabilities' })
  @IsBoolean()
  blockOnHighSecurity!: boolean;

  @ApiProperty({ description: 'Maximum cyclomatic complexity' })
  @IsNumber()
  @Min(1)
  maxComplexity!: number;

  @ApiProperty({ description: 'Target coverage for full score', minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  targetCoverage!: number;
}

export class QualityGateConfigDto {
  @ApiPropertyOptional({ description: 'Project ID (null for global)' })
  @IsOptional()
  @IsString()
  projectId?: string | null;

  @ApiProperty({ type: QualityThresholdsDto })
  @ValidateNested()
  @Type(() => QualityThresholdsDto)
  thresholds!: QualityThresholdsDto;

  @ApiProperty({ enum: QualityCategory, isArray: true })
  @IsArray()
  @IsEnum(QualityCategory, { each: true })
  enabledCategories!: QualityCategory[];

  @ApiProperty({ description: 'Allow emergency override' })
  @IsBoolean()
  allowOverride!: boolean;

  @ApiProperty({ description: 'Override requires approval' })
  @IsBoolean()
  overrideRequiresApproval!: boolean;
}

export class BlockingIssueDto {
  @ApiProperty({ enum: BlockerType })
  @IsEnum(BlockerType)
  type!: BlockerType;

  @ApiProperty({ enum: QualityCategory })
  @IsEnum(QualityCategory)
  category!: QualityCategory;

  @ApiProperty()
  @IsString()
  message!: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  details?: Record<string, any>;
}

export class WarningIssueDto {
  @ApiProperty({ enum: WarningType })
  @IsEnum(WarningType)
  type!: WarningType;

  @ApiProperty({ enum: QualityCategory })
  @IsEnum(QualityCategory)
  category!: QualityCategory;

  @ApiProperty()
  @IsString()
  message!: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  details?: Record<string, any>;
}

export class CategoryScoreDto {
  @ApiProperty({ enum: QualityCategory })
  @IsEnum(QualityCategory)
  category!: QualityCategory;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  score!: number;

  @ApiProperty()
  @IsNumber()
  weight!: number;

  @ApiProperty()
  @IsBoolean()
  passed!: boolean;
}

export class QualityGateResultDto {
  @ApiProperty()
  @IsString()
  executionId!: string;

  @ApiProperty()
  @IsString()
  correlationId!: string;

  @ApiProperty({ enum: QualityGateStatus })
  @IsEnum(QualityGateStatus)
  status!: QualityGateStatus;

  @ApiProperty({ description: 'Overall quality score (0-100)', minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  overallScore!: number;

  @ApiProperty()
  @IsBoolean()
  passed!: boolean;

  @ApiProperty({ type: [CategoryScoreDto] })
  @ValidateNested({ each: true })
  @Type(() => CategoryScoreDto)
  categoryScores!: CategoryScoreDto[];

  @ApiProperty({ type: [BlockingIssueDto] })
  @ValidateNested({ each: true })
  @Type(() => BlockingIssueDto)
  blockingIssues!: BlockingIssueDto[];

  @ApiProperty({ type: [WarningIssueDto] })
  @ValidateNested({ each: true })
  @Type(() => WarningIssueDto)
  warningIssues!: WarningIssueDto[];

  @ApiProperty()
  @IsString()
  nextAction!: 'proceed_to_github' | 'notify_pm_failure' | 'manual_review';
}
