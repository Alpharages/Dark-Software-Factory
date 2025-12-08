/**
 * Linting Result DTOs
 * Story 3.1: Linting Integration for Multiple Languages
 *
 * DTOs for API responses and validation
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LintingSeverity, SupportedLanguage } from '../interfaces';
import { LintingFixDto } from './linting-fix.dto';

/**
 * DTO for a single linting issue
 */
export class LintingIssueDto {
  @ApiProperty({
    description: 'Relative path to the file containing the issue',
    example: 'src/services/user.service.ts',
  })
  @IsString()
  filePath!: string;

  @ApiProperty({
    description: '1-indexed line number where the issue starts',
    example: 42,
  })
  @IsInt()
  @Min(1)
  line!: number;

  @ApiProperty({
    description: '1-indexed column number where the issue starts',
    example: 10,
  })
  @IsInt()
  @Min(1)
  column!: number;

  @ApiPropertyOptional({
    description: '1-indexed line number where the issue ends',
    example: 42,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  endLine?: number;

  @ApiPropertyOptional({
    description: '1-indexed column number where the issue ends',
    example: 25,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  endColumn?: number;

  @ApiProperty({
    description: 'Severity level of the issue',
    enum: LintingSeverity,
    example: LintingSeverity.ERROR,
  })
  @IsEnum(LintingSeverity)
  severity!: LintingSeverity;

  @ApiProperty({
    description: 'Human-readable description of the issue',
    example: "Variable 'unused' is declared but never used",
  })
  @IsString()
  message!: string;

  @ApiProperty({
    description: 'Rule identifier that triggered this issue',
    example: 'no-unused-vars',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  ruleId!: string | null;

  @ApiPropertyOptional({
    description: 'Suggested fix information',
    type: () => LintingFixDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LintingFixDto)
  fix?: LintingFixDto;
}

/**
 * DTO for complete linting result
 */
export class LintingResultDto {
  @ApiProperty({
    description: 'Whether linting passed (no errors)',
    example: true,
  })
  @IsBoolean()
  passed!: boolean;

  @ApiProperty({
    description: 'Total count of error-severity issues',
    example: 0,
  })
  @IsInt()
  @Min(0)
  errorCount!: number;

  @ApiProperty({
    description: 'Total count of warning-severity issues',
    example: 3,
  })
  @IsInt()
  @Min(0)
  warningCount!: number;

  @ApiProperty({
    description: 'Total count of info-severity issues',
    example: 1,
  })
  @IsInt()
  @Min(0)
  infoCount!: number;

  @ApiProperty({
    description: 'List of all issues found',
    type: [LintingIssueDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LintingIssueDto)
  issues!: LintingIssueDto[];

  @ApiProperty({
    description: 'Primary language that was linted',
    enum: SupportedLanguage,
    example: SupportedLanguage.TYPESCRIPT,
  })
  @IsEnum(SupportedLanguage)
  language!: SupportedLanguage;

  @ApiProperty({
    description: 'List of files that were successfully linted',
    type: [String],
    example: ['src/main.ts', 'src/app.module.ts'],
  })
  @IsArray()
  @IsString({ each: true })
  filesLinted!: string[];

  @ApiProperty({
    description: 'Duration of the linting operation in milliseconds',
    example: 1234,
  })
  @IsNumber()
  @Min(0)
  durationMs!: number;

  @ApiPropertyOptional({
    description: 'Path to the configuration file used',
    example: 'eslint.config.mjs',
  })
  @IsOptional()
  @IsString()
  configFile?: string;

  @ApiPropertyOptional({
    description: 'Linter version used',
    example: '9.0.0',
  })
  @IsOptional()
  @IsString()
  linterVersion?: string;
}

/**
 * DTO for linting request options
 */
export class LintingOptionsDto {
  @ApiProperty({
    description: 'Absolute path to the workspace/project root',
    example: '/workspaces/my-project',
  })
  @IsString()
  workspacePath!: string;

  @ApiProperty({
    description: 'List of files to lint (relative to workspacePath)',
    type: [String],
    example: ['src/main.ts', 'src/app.module.ts'],
  })
  @IsArray()
  @IsString({ each: true })
  files!: string[];

  @ApiPropertyOptional({
    description: 'Path to a specific linter configuration file',
    example: '.eslintrc.json',
  })
  @IsOptional()
  @IsString()
  configPath?: string;

  @ApiPropertyOptional({
    description: 'Timeout for the linting operation in milliseconds',
    example: 60000,
    default: 60000,
  })
  @IsOptional()
  @IsInt()
  @Min(1000)
  timeoutMs?: number;

  @ApiPropertyOptional({
    description: 'Whether to attempt auto-fixing issues',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  autoFix?: boolean;

  @ApiPropertyOptional({
    description: 'Whether to treat warnings as errors',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  warningsAsErrors?: boolean;
}
