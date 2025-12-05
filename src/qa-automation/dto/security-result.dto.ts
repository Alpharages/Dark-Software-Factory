import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsString,
  IsArray,
  IsEnum,
  IsOptional,
  ValidateNested,
  IsDate,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SecuritySeverity, SecurityCheckType } from '../interfaces';

export class SecurityVulnerabilityDto {
  @ApiProperty({ enum: SecurityCheckType })
  @IsEnum(SecurityCheckType)
  checkType!: SecurityCheckType.DEPENDENCY;

  @ApiProperty({ enum: SecuritySeverity })
  @IsEnum(SecuritySeverity)
  severity!: SecuritySeverity;

  @ApiProperty()
  @IsString()
  package!: string;

  @ApiProperty()
  @IsString()
  version!: string;

  @ApiProperty()
  @IsString()
  vulnerableVersions!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  patchedVersions?: string;

  @ApiProperty()
  @IsString()
  title!: string;

  @ApiProperty()
  @IsString()
  description!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cveId?: string;

  @ApiProperty()
  @IsString()
  recommendation!: string;
}

export class SecretFindingDto {
  @ApiProperty({ enum: SecurityCheckType })
  @IsEnum(SecurityCheckType)
  checkType!: SecurityCheckType.SECRET;

  @ApiProperty({ enum: SecuritySeverity })
  @IsEnum(SecuritySeverity)
  severity!: SecuritySeverity;

  @ApiProperty()
  @IsString()
  filePath!: string;

  @ApiProperty()
  @IsNumber()
  lineNumber!: number;

  @ApiProperty()
  @IsString()
  secretType!: string;

  @ApiProperty({ description: 'Masked secret value (First 4 + *** + last 4)' })
  @IsString()
  maskedValue!: string;

  @ApiProperty()
  @IsString()
  recommendation!: string;
}

export class ComplexityIssueDto {
  @ApiProperty({ enum: SecurityCheckType })
  @IsEnum(SecurityCheckType)
  checkType!: SecurityCheckType.COMPLEXITY;

  @ApiProperty({ enum: SecuritySeverity })
  @IsEnum(SecuritySeverity)
  severity!: SecuritySeverity;

  @ApiProperty()
  @IsString()
  filePath!: string;

  @ApiProperty()
  @IsString()
  functionName!: string;

  @ApiProperty()
  @IsNumber()
  lineNumber!: number;

  @ApiProperty({ enum: ['cyclomatic', 'function_length', 'nesting_depth'] })
  @IsString()
  metric!: 'cyclomatic' | 'function_length' | 'nesting_depth';

  @ApiProperty()
  @IsNumber()
  value!: number;

  @ApiProperty()
  @IsNumber()
  threshold!: number;

  @ApiProperty()
  @IsString()
  recommendation!: string;
}

export class SecurityPatternFindingDto {
  @ApiProperty({ enum: SecurityCheckType })
  @IsEnum(SecurityCheckType)
  checkType!: SecurityCheckType.PATTERN;

  @ApiProperty({ enum: SecuritySeverity })
  @IsEnum(SecuritySeverity)
  severity!: SecuritySeverity;

  @ApiProperty()
  @IsString()
  filePath!: string;

  @ApiProperty()
  @IsNumber()
  lineNumber!: number;

  @ApiProperty()
  @IsString()
  patternType!: string;

  @ApiProperty()
  @IsString()
  matchedCode!: string;

  @ApiProperty()
  @IsString()
  owaspCategory!: string;

  @ApiProperty()
  @IsString()
  recommendation!: string;
}

export class SecurityScanSummaryDto {
  @ApiProperty()
  @IsNumber()
  totalFindings!: number;

  @ApiProperty()
  @IsNumber()
  criticalCount!: number;

  @ApiProperty()
  @IsNumber()
  highCount!: number;

  @ApiProperty()
  @IsNumber()
  mediumCount!: number;

  @ApiProperty()
  @IsNumber()
  lowCount!: number;

  @ApiProperty()
  @IsNumber()
  infoCount!: number;
}

export class ScannerResultDetailDto {
  @ApiProperty()
  @IsBoolean()
  ran!: boolean;

  @ApiProperty()
  @IsBoolean()
  passed!: boolean;

  @ApiProperty()
  @IsNumber()
  durationMs!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  error?: string;
}

export class SecurityScanResultDto {
  @ApiProperty()
  @IsBoolean()
  passed!: boolean;

  @ApiProperty()
  @IsString()
  executionId!: string;

  @ApiProperty()
  @IsString()
  correlationId!: string;

  @ApiProperty()
  @IsNumber()
  scanDurationMs!: number;

  @ApiProperty({ type: SecurityScanSummaryDto })
  @ValidateNested()
  @Type(() => SecurityScanSummaryDto)
  summary!: SecurityScanSummaryDto;

  @ApiProperty({ type: [SecurityVulnerabilityDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SecurityVulnerabilityDto)
  vulnerabilities!: SecurityVulnerabilityDto[];

  @ApiProperty({ type: [SecretFindingDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SecretFindingDto)
  secrets!: SecretFindingDto[];

  @ApiProperty({ type: [ComplexityIssueDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComplexityIssueDto)
  complexityIssues!: ComplexityIssueDto[];

  @ApiProperty({ type: [SecurityPatternFindingDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SecurityPatternFindingDto)
  patternFindings!: SecurityPatternFindingDto[];

  @ApiProperty({
    description: 'Individual scanner results with timing and status',
  })
  scannerResults!: {
    dependency: ScannerResultDetailDto;
    secrets: ScannerResultDetailDto;
    complexity: ScannerResultDetailDto;
    patterns: ScannerResultDetailDto;
  };

  @ApiProperty()
  @IsDate()
  @Type(() => Date)
  scannedAt!: Date;
}
