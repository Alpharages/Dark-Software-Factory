import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsEnum,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsArray,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AIProvider } from '@/prisma/client';

/**
 * DTO for AI Execution queue message payload
 */
export class AIExecutionPayloadDto {
  @IsString()
  @IsNotEmpty()
  ticketId!: string;

  @IsUUID()
  executionId!: string;

  @IsEnum(AIProvider)
  aiProvider!: AIProvider;

  @IsNumber()
  @Min(1)
  @Max(5)
  priority!: number;

  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsString()
  @IsNotEmpty()
  repositoryUrl!: string;

  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsOptional()
  @IsString()
  targetBranch?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetFiles?: string[];

  @IsOptional()
  @IsBoolean()
  allowFallback?: boolean;

  /**
   * Force new execution even if there's an active one (for retries)
   * Task 20-3: Prevent duplicate executions
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

/**
 * DTO for complete queue message
 */
export class AIExecutionMessageDto {
  @IsUUID()
  messageId!: string;

  @IsString()
  timestamp!: string;

  @IsUUID()
  correlationId!: string;

  @ValidateNested()
  @Type(() => AIExecutionPayloadDto)
  payload!: AIExecutionPayloadDto;
}

/**
 * DTO for queue publish request
 */
export class PublishExecutionDto {
  @IsString()
  @IsNotEmpty()
  ticketId!: string;

  @IsString()
  @IsNotEmpty()
  prompt!: string;

  @IsString()
  @IsNotEmpty()
  repositoryUrl!: string;

  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsOptional()
  @IsEnum(AIProvider)
  preferredProvider?: AIProvider;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  priority?: number;

  @IsOptional()
  @IsString()
  targetBranch?: string;

  @IsOptional()
  @IsBoolean()
  allowFallback?: boolean;

  /**
   * Force new execution even if there's an active one (for retries)
   * Task 20-3: Prevent duplicate executions
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

/**
 * DTO for processing result
 */
export class ProcessingResultDto {
  success!: boolean;
  executionId!: string;
  durationMs!: number;
  errorMessage?: string;
  errorCode?: string;
  executedBy?: AIProvider;
}

/**
 * DTO for queue statistics
 */
export class QueueStatsDto {
  queueName!: string;
  messageCount!: number;
  consumerCount!: number;
  processingRate!: number;
  avgProcessingTimeMs!: number;
}
