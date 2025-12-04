import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsString,
  IsArray,
  IsEnum,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TestFramework, TestStatus } from '../interfaces';

export class TestCaseDto {
  @ApiProperty({ description: 'Test case name' })
  @IsString()
  name!: string;

  @ApiProperty({ description: 'Test suite name' })
  @IsString()
  suiteName!: string;

  @ApiProperty({ enum: TestStatus })
  @IsEnum(TestStatus)
  status!: TestStatus;

  @ApiProperty({ description: 'Duration in milliseconds' })
  @IsNumber()
  durationMs!: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  errorMessage?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  stackTrace?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  filePath?: string;
}

export class TestSuiteDto {
  @ApiProperty({ description: 'Test suite name' })
  @IsString()
  name!: string;

  @ApiProperty({ type: [TestCaseDto], description: 'Test cases in this suite' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestCaseDto)
  tests!: TestCaseDto[];

  @ApiProperty({ description: 'Number of tests passed' })
  @IsNumber()
  passed!: number;

  @ApiProperty({ description: 'Number of tests failed' })
  @IsNumber()
  failed!: number;

  @ApiProperty({ description: 'Number of tests skipped' })
  @IsNumber()
  skipped!: number;

  @ApiProperty({ description: 'Suite duration in milliseconds' })
  @IsNumber()
  durationMs!: number;
}

export class TestCoverageDto {
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
}

export class TestResultDto {
  @ApiProperty({ enum: TestFramework })
  @IsEnum(TestFramework)
  framework!: TestFramework;

  @ApiProperty()
  @IsBoolean()
  passed!: boolean;

  @ApiProperty()
  @IsNumber()
  totalTests!: number;

  @ApiProperty()
  @IsNumber()
  passedCount!: number;

  @ApiProperty()
  @IsNumber()
  failedCount!: number;

  @ApiProperty()
  @IsNumber()
  skippedCount!: number;

  @ApiProperty()
  @IsNumber()
  durationMs!: number;

  @ApiProperty({ type: [TestCaseDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestCaseDto)
  failedTests!: TestCaseDto[];

  @ApiPropertyOptional({ type: TestCoverageDto })
  @ValidateNested()
  @Type(() => TestCoverageDto)
  @IsOptional()
  coverage?: TestCoverageDto;
}
