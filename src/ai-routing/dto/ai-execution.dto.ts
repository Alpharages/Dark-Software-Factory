/**
 * AI Execution DTOs
 * Story 2.6: AI Provider Integration - Cursor CLI Headless Mode
 * FR65: Execute AI code generation
 */

import { AIProvider } from '@/prisma/client';
import { IsString, IsNotEmpty, IsOptional, IsArray, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for AI execution request
 */
export class AIExecutionRequestDto {
  @ApiProperty({ description: 'Correlation ID for request tracing' })
  @IsString()
  @IsNotEmpty()
  correlationId!: string;

  @ApiProperty({ description: 'Execution record ID from Story 2.5' })
  @IsString()
  @IsNotEmpty()
  executionId!: string;

  @ApiProperty({ description: 'Ticket ID' })
  @IsString()
  @IsNotEmpty()
  ticketId!: string;

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

  @ApiPropertyOptional({
    description: 'Timeout in milliseconds (30000-600000)',
    minimum: 30000,
    maximum: 600000,
  })
  @IsOptional()
  @IsNumber()
  @Min(30000)
  @Max(600000)
  timeoutMs?: number;
}

/**
 * DTO for AI execution result
 */
export class AIExecutionResultDto {
  @ApiProperty({ description: 'Whether generation succeeded' })
  success!: boolean;

  @ApiProperty({ description: 'Generated code diff (git diff format)', nullable: true })
  codeDiff!: string | null;

  @ApiProperty({ description: 'List of files modified', type: [String] })
  filesChanged!: string[];

  @ApiProperty({ description: 'Confidence score (0.0-1.0)' })
  confidenceScore!: number;

  @ApiProperty({ description: 'Execution duration in milliseconds' })
  durationMs!: number;

  @ApiProperty({ description: 'Workspace path (for debugging)' })
  workspacePath!: string;

  @ApiPropertyOptional({ description: 'Error code if failed' })
  errorCode?: string;

  @ApiPropertyOptional({ description: 'Error message if failed' })
  errorMessage?: string;

  @ApiPropertyOptional({ description: 'Whether error is retryable' })
  isRetryable?: boolean;
}

/**
 * DTO for workspace status
 */
export class WorkspaceStatusDto {
  @ApiProperty({ description: 'Unique workspace ID' })
  id!: string;

  @ApiProperty({ description: 'Filesystem path' })
  path!: string;

  @ApiProperty({ description: 'Ticket ID' })
  ticketId!: string;

  @ApiProperty({ description: 'Execution ID' })
  executionId!: string;

  @ApiProperty({ description: 'Current status' })
  status!: string;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: Date;

  @ApiPropertyOptional({ description: 'Size in bytes' })
  sizeBytes?: number;
}

/**
 * DTO for provider health response
 */
export class ProviderHealthDto {
  @ApiProperty({ description: 'Provider identifier', enum: AIProvider })
  provider!: AIProvider;

  @ApiProperty({ description: 'Whether provider is healthy' })
  isHealthy!: boolean;

  @ApiProperty({ description: 'Last successful execution timestamp', nullable: true })
  lastSuccessAt!: Date | null;

  @ApiProperty({ description: 'Last failure timestamp', nullable: true })
  lastFailureAt!: Date | null;

  @ApiProperty({ description: 'Consecutive failure count' })
  consecutiveFailures!: number;

  @ApiProperty({ description: 'Circuit breaker state', enum: ['CLOSED', 'OPEN', 'HALF_OPEN'] })
  circuitState!: string;

  @ApiProperty({ description: 'Active execution count' })
  activeExecutions!: number;
}
