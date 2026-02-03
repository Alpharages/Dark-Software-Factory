/**
 * QA Sampling Configuration DTOs
 * Story 8.1: QA Review Queue & Sampling Configuration
 */

import {
  IsNumber,
  IsBoolean,
  IsOptional,
  IsString,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * File count risk rule DTO
 */
export class FileCountRiskRuleDto {
  @ApiProperty({ description: 'High risk threshold (files > this)', default: 10 })
  @IsNumber()
  @IsOptional()
  highThreshold?: number;

  @ApiProperty({ description: 'Medium risk threshold (files >= this)', default: 5 })
  @IsNumber()
  @IsOptional()
  mediumThreshold?: number;

  @ApiProperty({ description: 'High risk multiplier', default: 100 })
  @IsNumber()
  @IsOptional()
  highMultiplier?: number;

  @ApiProperty({ description: 'Medium risk multiplier', default: 2.0 })
  @IsNumber()
  @IsOptional()
  mediumMultiplier?: number;
}

/**
 * Complexity risk rule DTO
 */
export class ComplexityRiskRuleDto {
  @ApiProperty({ description: 'High risk threshold (score >= this)', default: 10 })
  @IsNumber()
  @IsOptional()
  highThreshold?: number;

  @ApiProperty({ description: 'Medium risk threshold (score >= this)', default: 5 })
  @IsNumber()
  @IsOptional()
  mediumThreshold?: number;

  @ApiProperty({ description: 'High risk multiplier', default: 100 })
  @IsNumber()
  @IsOptional()
  highMultiplier?: number;

  @ApiProperty({ description: 'Medium risk multiplier', default: 1.5 })
  @IsNumber()
  @IsOptional()
  mediumMultiplier?: number;
}

/**
 * AI Provider risk rule DTO
 */
export class AIProviderRiskRuleDto {
  @ApiProperty({ description: 'Cursor multiplier', default: 1.2 })
  @IsNumber()
  @IsOptional()
  cursorMultiplier?: number;

  @ApiProperty({ description: 'Claude multiplier', default: 1.0 })
  @IsNumber()
  @IsOptional()
  claudeMultiplier?: number;
}

/**
 * Risk rules DTO
 */
export class RiskRulesDto {
  @ApiPropertyOptional({ description: 'File count risk rules', type: FileCountRiskRuleDto })
  @ValidateNested()
  @Type(() => FileCountRiskRuleDto)
  @IsOptional()
  fileCount?: FileCountRiskRuleDto;

  @ApiPropertyOptional({ description: 'Complexity risk rules', type: ComplexityRiskRuleDto })
  @ValidateNested()
  @Type(() => ComplexityRiskRuleDto)
  @IsOptional()
  complexity?: ComplexityRiskRuleDto;

  @ApiPropertyOptional({ description: 'AI Provider risk rules', type: AIProviderRiskRuleDto })
  @ValidateNested()
  @Type(() => AIProviderRiskRuleDto)
  @IsOptional()
  aiProvider?: AIProviderRiskRuleDto;
}

/**
 * Update sampling configuration request DTO
 */
export class UpdateSamplingConfigDto {
  @ApiProperty({
    description: 'Sampling percentage (0-100)',
    default: 20,
    minimum: 0,
    maximum: 100,
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage!: number;

  @ApiProperty({ description: 'Enable risk-based sampling', default: true })
  @IsBoolean()
  riskBasedEnabled!: boolean;

  @ApiPropertyOptional({ description: 'Risk rules configuration', type: RiskRulesDto })
  @ValidateNested()
  @Type(() => RiskRulesDto)
  @IsOptional()
  riskRules?: RiskRulesDto;

  @ApiPropertyOptional({ description: 'Random seed for reproducible testing' })
  @IsString()
  @IsOptional()
  randomSeed?: string;
}

/**
 * Sampling configuration response DTO
 */
export class SamplingConfigResponseDto {
  @ApiProperty({ description: 'Configuration ID' })
  @IsString()
  id!: string;

  @ApiProperty({ description: 'Sampling percentage (0-100)' })
  @IsNumber()
  percentage!: number;

  @ApiProperty({ description: 'Risk-based sampling enabled' })
  @IsBoolean()
  riskBasedEnabled!: boolean;

  @ApiPropertyOptional({ description: 'Risk rules configuration', type: RiskRulesDto })
  riskRules?: RiskRulesDto;

  @ApiPropertyOptional({ description: 'Random seed' })
  @IsString()
  @IsOptional()
  randomSeed?: string;

  @ApiProperty({ description: 'Created at' })
  createdAt!: Date;

  @ApiProperty({ description: 'Updated at' })
  updatedAt!: Date;
}

/**
 * Sampling metrics response DTO
 */
export class SamplingMetricsResponseDto {
  @ApiProperty({ description: 'Total tickets processed' })
  @IsNumber()
  totalTicketsProcessed!: number;

  @ApiProperty({ description: 'Total tickets sampled' })
  @IsNumber()
  totalTicketsSampled!: number;

  @ApiProperty({ description: 'Actual sample rate (0-100)' })
  @IsNumber()
  actualSampleRate!: number;

  @ApiProperty({ description: 'Configured sample rate (0-100)' })
  @IsNumber()
  configuredSampleRate!: number;

  @ApiProperty({
    description: 'Risk distribution',
    type: 'object',
    additionalProperties: true,
  })
  riskDistribution!: {
    high: number;
    medium: number;
    low: number;
  };

  @ApiProperty({
    description: 'Strategy distribution',
    type: 'object',
    additionalProperties: true,
  })
  strategyDistribution!: {
    percentage: number;
    riskBased: number;
    random: number;
  };

  @ApiProperty({ description: 'Average time in queue (seconds)' })
  @IsNumber()
  averageTimeInQueue!: number;
}
