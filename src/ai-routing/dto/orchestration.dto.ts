/**
 * Orchestration DTOs
 * Story 2.8: Multi-Provider Orchestration & Fallback Logic
 *
 * FR60-65: AI code generation orchestration
 */

import { AIProvider } from '@prisma/client';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  IsNumber,
  IsBoolean,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ComplexityGrade, ProviderSelectionReason } from '../interfaces/orchestration.interface';

/**
 * DTO for orchestration request
 */
export class OrchestrationRequestDto {
  @ApiProperty({ description: 'Correlation ID for request tracing' })
  @IsString()
  @IsNotEmpty()
  correlationId!: string;

  @ApiProperty({ description: 'Ticket ID' })
  @IsString()
  @IsNotEmpty()
  ticketId!: string;

  @ApiProperty({ description: 'Execution record ID from Story 2.5' })
  @IsString()
  @IsNotEmpty()
  executionId!: string;

  @ApiProperty({ description: 'Generated prompt from Story 2.4' })
  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @ApiProperty({ description: 'Repository URL to clone' })
  @IsString()
  @IsNotEmpty()
  repositoryUrl!: string;

  @ApiPropertyOptional({ description: 'Target branch (default: main)' })
  @IsOptional()
  @IsString()
  baseBranch?: string;

  @ApiPropertyOptional({ description: 'Files to focus on (optional hint to AI)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetFiles?: string[];

  @ApiPropertyOptional({ description: 'Tags from ticket for complexity calculation' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Estimated files to modify' })
  @IsOptional()
  @IsNumber()
  estimatedFilesCount?: number;

  @ApiPropertyOptional({ description: 'Provider override (bypasses selection)', enum: AIProvider })
  @IsOptional()
  @IsEnum(AIProvider)
  providerOverride?: AIProvider;

  @ApiPropertyOptional({ description: 'Accept fallback if primary fails', default: true })
  @IsOptional()
  @IsBoolean()
  allowFallback?: boolean = true;

  @ApiPropertyOptional({ description: 'Timeout in milliseconds (30000-600000)' })
  @IsOptional()
  @IsNumber()
  @Min(30000)
  @Max(600000)
  timeoutMs?: number;

  @ApiPropertyOptional({ description: 'Ticket title for complexity calculation' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Acceptance criteria text' })
  @IsOptional()
  @IsString()
  acceptanceCriteria?: string;
}

/**
 * DTO for fallback attempt
 */
export class FallbackAttemptDto {
  @ApiProperty({ description: 'Provider that was attempted', enum: AIProvider })
  provider!: AIProvider;

  @ApiProperty({ description: 'Error that triggered fallback' })
  error!: string;

  @ApiProperty({ description: 'Whether error was retryable' })
  wasRetryable!: boolean;

  @ApiProperty({ description: 'Duration of failed attempt (ms)' })
  durationMs!: number;

  @ApiProperty({ description: 'Timestamp of attempt' })
  timestamp!: Date;
}

/**
 * DTO for orchestration result
 */
export class OrchestrationResultDto {
  @ApiProperty({ description: 'Whether execution succeeded' })
  success!: boolean;

  @ApiProperty({ description: 'Provider that executed successfully', enum: AIProvider })
  executedBy!: AIProvider;

  @ApiProperty({ description: 'Whether fallback was used' })
  usedFallback!: boolean;

  @ApiProperty({ description: 'Generated code diff (git diff format)', nullable: true })
  codeDiff!: string | null;

  @ApiProperty({ description: 'List of files modified', type: [String] })
  filesChanged!: string[];

  @ApiProperty({ description: 'Confidence score (0.0-1.0)' })
  confidenceScore!: number;

  @ApiProperty({ description: 'Total execution time including fallbacks (ms)' })
  totalDurationMs!: number;

  @ApiProperty({ description: 'Cost estimate in cents' })
  estimatedCostCents!: number;

  @ApiPropertyOptional({ description: 'Error message if failed' })
  errorMessage?: string;

  @ApiProperty({ description: 'Fallback attempts if any', type: [FallbackAttemptDto] })
  fallbackAttempts!: FallbackAttemptDto[];
}

/**
 * DTO for provider selection result
 */
export class ProviderSelectionDto {
  @ApiProperty({ description: 'Selected primary provider', enum: AIProvider })
  primary!: AIProvider;

  @ApiProperty({
    description: 'Fallback provider if primary fails',
    nullable: true,
    enum: AIProvider,
  })
  fallback!: AIProvider | null;

  @ApiProperty({ description: 'Selection reason', enum: ProviderSelectionReason })
  reason!: ProviderSelectionReason;

  @ApiProperty({ description: 'Complexity score that influenced selection' })
  complexityScore!: number;

  @ApiProperty({ description: 'Complexity grade', enum: ComplexityGrade })
  complexityGrade!: ComplexityGrade;
}

/**
 * DTO for provider availability
 */
export class ProviderAvailabilityDto {
  @ApiProperty({ description: 'Provider identifier', enum: AIProvider })
  provider!: AIProvider;

  @ApiProperty({ description: 'Whether provider is available' })
  isAvailable!: boolean;

  @ApiPropertyOptional({ description: 'Reason if unavailable' })
  unavailableReason?: string;

  @ApiProperty({ description: 'Circuit breaker state', enum: ['CLOSED', 'OPEN', 'HALF_OPEN'] })
  circuitState!: string;

  @ApiProperty({ description: 'Current queue depth' })
  queueDepth!: number;

  @ApiProperty({ description: 'Estimated wait time in ms' })
  estimatedWaitMs!: number;
}

/**
 * DTO for orchestration metrics response
 */
export class OrchestrationMetricsDto {
  @ApiProperty({ description: 'Total executions' })
  totalExecutions!: number;

  @ApiProperty({ description: 'Successful executions' })
  successfulExecutions!: number;

  @ApiProperty({ description: 'Fallback triggers' })
  fallbackTriggers!: number;

  @ApiProperty({ description: 'Fallback success rate (0.0-1.0)' })
  fallbackSuccessRate!: number;

  @ApiProperty({ description: 'Provider usage distribution' })
  providerUsage!: Record<string, number>;

  @ApiProperty({ description: 'Average execution time by provider (ms)' })
  avgExecutionTimeMs!: Record<string, number>;
}
