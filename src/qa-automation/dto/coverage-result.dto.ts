import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsString,
  IsArray,
  IsOptional,
  ValidateNested,
  IsDate,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CoverageDataDto {
  @ApiProperty({ description: 'Line coverage percentage (0-100)' })
  @IsNumber()
  lines!: number;

  @ApiProperty({ description: 'Branch coverage percentage (0-100)' })
  @IsNumber()
  branches!: number;

  @ApiProperty({ description: 'Function coverage percentage (0-100)' })
  @IsNumber()
  functions!: number;

  @ApiProperty({ description: 'Statement coverage percentage (0-100)' })
  @IsNumber()
  statements!: number;
}

export class CoverageDeltaDto {
  @ApiProperty({ description: 'Line coverage delta (positive = improvement)' })
  @IsNumber()
  lines!: number;

  @ApiProperty()
  @IsNumber()
  branches!: number;

  @ApiProperty()
  @IsNumber()
  functions!: number;

  @ApiProperty()
  @IsNumber()
  statements!: number;

  @ApiProperty({ description: 'Weighted average overall delta' })
  @IsNumber()
  overall!: number;
}

export class FileCoverageDto {
  @ApiProperty()
  @IsString()
  filePath!: string;

  @ApiProperty()
  @IsNumber()
  lines!: number;

  @ApiProperty()
  @IsNumber()
  branches!: number;

  @ApiProperty()
  @IsNumber()
  functions!: number;

  @ApiProperty()
  @IsNumber()
  statements!: number;

  @ApiProperty({ type: [Number], description: 'Line numbers not covered by tests' })
  @IsArray()
  uncoveredLines!: number[];

  @ApiProperty()
  @IsBoolean()
  isBelowThreshold!: boolean;
}

export class CoverageSummaryDto {
  @ApiProperty()
  @IsNumber()
  totalFiles!: number;

  @ApiProperty()
  @IsNumber()
  filesBelowThreshold!: number;

  @ApiProperty()
  @IsNumber()
  avgLineCoverage!: number;
}

export class CoverageAnalysisDto {
  @ApiProperty()
  @IsString()
  executionId!: string;

  @ApiProperty({ description: 'Correlation ID for audit trail' })
  @IsString()
  correlationId!: string;

  @ApiProperty({ type: CoverageDataDto })
  @ValidateNested()
  @Type(() => CoverageDataDto)
  current!: CoverageDataDto;

  @ApiPropertyOptional({ type: CoverageDataDto })
  @ValidateNested()
  @Type(() => CoverageDataDto)
  @IsOptional()
  baseline?: CoverageDataDto;

  @ApiProperty({ type: CoverageDeltaDto })
  @ValidateNested()
  @Type(() => CoverageDeltaDto)
  delta!: CoverageDeltaDto;

  @ApiProperty()
  @IsBoolean()
  passed!: boolean;

  @ApiProperty({ description: 'Threshold used for enforcement' })
  @IsNumber()
  threshold!: number;

  @ApiProperty({ type: [FileCoverageDto], description: 'Files below coverage threshold' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FileCoverageDto)
  failedFiles!: FileCoverageDto[];

  @ApiProperty({ type: CoverageSummaryDto })
  @ValidateNested()
  @Type(() => CoverageSummaryDto)
  summary!: CoverageSummaryDto;

  @ApiPropertyOptional({ description: 'Path to HTML coverage report' })
  @IsString()
  @IsOptional()
  reportPath?: string;

  @ApiProperty()
  @IsDate()
  @Type(() => Date)
  analyzedAt!: Date;
}
