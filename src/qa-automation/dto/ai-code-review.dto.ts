import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsString,
  ValidateNested,
  IsOptional,
  IsBoolean,
  IsArray,
} from 'class-validator';

export enum AiCodeReviewRiskLevel {
  LOW_RISK = 'LOW_RISK',
  MODERATE_RISK = 'MODERATE_RISK',
  HIGH_RISK = 'HIGH_RISK',
}

export enum FindingSeverity {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export class AiFindingDto {
  @ApiProperty({ enum: FindingSeverity })
  @IsEnum(FindingSeverity)
  severity!: FindingSeverity;

  @ApiProperty()
  @IsString()
  file!: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  line?: number;

  @ApiProperty()
  @IsString()
  description!: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  suggestion?: string;
}

export class MissedIssueDto extends AiFindingDto {
  @ApiProperty()
  @IsString()
  category!: string; // LOGIC_BUG, EDGE_CASE, PERFORMANCE
}

export class CodeSmellDto extends AiFindingDto {
  @ApiProperty()
  @IsString()
  type!: string; // DUPLICATION, LONG_METHOD, etc.

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  refactoring_suggestion?: string;
}

export class ComplexLogicDto {
  @ApiProperty()
  @IsString()
  file!: string;

  @ApiProperty()
  @IsString()
  function!: string;

  @ApiProperty()
  @IsNumber()
  complexity_score!: number;

  @ApiProperty()
  @IsNumber()
  nesting_depth!: number;

  @ApiProperty()
  @IsNumber()
  lines_of_code!: number;

  @ApiProperty()
  @IsBoolean()
  attention_required!: boolean;

  @ApiProperty()
  @IsString()
  rationale!: string;
}

export class TestingGapDto {
  @ApiProperty()
  @IsString()
  file!: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  function?: string;

  @ApiProperty()
  @IsString()
  gap_type!: string; // MISSING_EDGE_CASE, etc.

  @ApiProperty()
  @IsString()
  suggestion!: string;
}

export class SecurityNoteDto {
  @ApiProperty({ enum: FindingSeverity })
  @IsEnum(FindingSeverity)
  severity!: FindingSeverity;

  @ApiProperty()
  @IsString()
  category!: string;

  @ApiProperty()
  @IsString()
  file!: string;

  @ApiProperty()
  @IsString()
  note!: string;
}

export class AiFindingsCollectionDto {
  @ApiProperty({ type: [MissedIssueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MissedIssueDto)
  missed_issues!: MissedIssueDto[];

  @ApiProperty({ type: [CodeSmellDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CodeSmellDto)
  code_smells!: CodeSmellDto[];

  @ApiProperty({ type: [ComplexLogicDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComplexLogicDto)
  complex_logic!: ComplexLogicDto[];

  @ApiProperty({ type: [TestingGapDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestingGapDto)
  testing_gaps!: TestingGapDto[];

  @ApiProperty({ type: [SecurityNoteDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SecurityNoteDto)
  security_notes!: SecurityNoteDto[];
}

export class AiCodeReviewResponseDto {
  @ApiProperty()
  @IsString()
  queue_item_id!: string;

  @ApiProperty()
  @IsNumber()
  review_version!: number;

  @ApiProperty()
  @IsString()
  generated_at!: string;

  @ApiProperty()
  @IsString()
  ai_model!: string;

  @ApiProperty()
  @IsNumber()
  confidence_score!: number;

  @ApiProperty({ enum: AiCodeReviewRiskLevel })
  @IsEnum(AiCodeReviewRiskLevel)
  overall_assessment!: AiCodeReviewRiskLevel;

  @ApiProperty()
  @IsString()
  summary!: string;

  @ApiProperty({ type: AiFindingsCollectionDto })
  @ValidateNested()
  @Type(() => AiFindingsCollectionDto)
  findings!: AiFindingsCollectionDto;

  @ApiProperty()
  @IsNumber()
  generation_duration_ms!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  token_usage?: unknown;

  @ApiProperty({ required: false })
  @IsOptional()
  cost_usd?: number;
}
