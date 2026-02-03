import { IsInt, IsOptional, IsBoolean, IsArray, IsString, IsEnum, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { QualityCategory } from '../../interfaces';

export class CreateQualityThresholdsDto {
  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  @ApiProperty({ example: 100, required: false })
  minTestPassRate?: number;

  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  @ApiProperty({ example: 80, required: false })
  minCoverage?: number;

  @IsInt()
  @Min(0)
  @Max(100)
  @IsOptional()
  @ApiProperty({ example: 90, required: false })
  targetCoverage?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  @ApiProperty({ example: 0, required: false })
  maxLintingErrors?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  @ApiProperty({ example: 10, required: false })
  maxLintingWarnings?: number;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({ example: true, required: false })
  blockOnCriticalSecurity?: boolean;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({ example: true, required: false })
  blockOnHighSecurity?: boolean;

  @IsInt()
  @Min(1)
  @IsOptional()
  @ApiProperty({ example: 20, required: false })
  maxComplexity?: number;
}

export class CreateQualityGateConfigDto {
  @IsOptional()
  @ApiProperty({ type: CreateQualityThresholdsDto, required: false })
  thresholds?: CreateQualityThresholdsDto;

  @IsArray()
  @IsEnum(QualityCategory, { each: true })
  @IsOptional()
  @ApiProperty({ enum: QualityCategory, isArray: true, required: false })
  enabledCategories?: QualityCategory[];

  @IsBoolean()
  @IsOptional()
  @ApiProperty({ example: false, required: false })
  allowOverride?: boolean;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({ example: true, required: false })
  overrideRequiresApproval?: boolean;

  @IsString()
  @IsOptional()
  @ApiProperty({ example: 'Initial global defaults', required: false })
  reason?: string;
}
