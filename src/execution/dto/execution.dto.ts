import { AIProvider, ExecutionStatus } from '@/prisma/client';
import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsOptional,
  IsArray,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO for starting an execution
 */
export class StartExecutionDto {
  @IsString()
  @IsNotEmpty()
  correlationId!: string;

  @IsString()
  @IsNotEmpty()
  ticketId!: string;

  @IsString()
  @IsNotEmpty()
  clickupTaskId!: string;

  @IsEnum(AIProvider)
  provider!: AIProvider;

  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsNumber()
  complexityScore!: number;

  @ValidateNested()
  @Type(() => PromptMetadataSnapshotDto)
  promptMetadata!: PromptMetadataSnapshotDto;
}

/**
 * DTO for prompt metadata snapshot
 */
export class PromptMetadataSnapshotDto {
  @IsNumber()
  promptLength!: number;

  @IsNumber()
  estimatedTokens!: number;

  @IsString()
  templateVersion!: string;

  @IsString()
  generatedAt!: string;
}

/**
 * DTO for updating execution status
 */
export class UpdateExecutionStatusDto {
  @IsString()
  @IsNotEmpty()
  executionId!: string;

  @IsEnum(ExecutionStatus)
  status!: ExecutionStatus;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}

/**
 * DTO for completing an execution
 */
export class CompleteExecutionDto {
  @IsString()
  @IsNotEmpty()
  executionId!: string;

  @IsString()
  codeOutput!: string;

  @IsArray()
  @IsString({ each: true })
  filesChanged!: string[];

  @IsNumber()
  @Min(0)
  @Max(1)
  confidenceScore!: number;
}

/**
 * DTO for failing an execution
 */
export class FailExecutionDto {
  @IsString()
  @IsNotEmpty()
  executionId!: string;

  @IsString()
  @IsNotEmpty()
  errorMessage!: string;

  @IsOptional()
  @IsString()
  errorCode?: string;
}

/**
 * DTO for execution response
 */
export class ExecutionResponseDto {
  id!: string;
  ticketId!: string;
  provider!: AIProvider;
  status!: ExecutionStatus;
  confidenceScore!: number | null;
  startedAt!: Date | null;
  completedAt!: Date | null;
  failedAt!: Date | null;
  errorMessage!: string | null;
  retryCount!: number;
  filesChanged!: string[] | null;
  createdAt!: Date;
  updatedAt!: Date;
}

/**
 * DTO for execution with code output
 */
export class ExecutionWithOutputDto extends ExecutionResponseDto {
  codeOutput!: string | null;
  prompt!: string;
}
