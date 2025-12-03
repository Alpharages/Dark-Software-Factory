import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsEnum,
  IsArray,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ErrorSeverity, RetryDecisionReason } from '../interfaces';

/**
 * DTO for retry request
 */
export class RetryRequestDto {
  @IsString()
  @IsNotEmpty()
  executionId!: string;

  @IsString()
  @IsNotEmpty()
  correlationId!: string;

  @IsString()
  @IsNotEmpty()
  errorCode!: string;

  @IsString()
  @IsNotEmpty()
  errorMessage!: string;

  @IsBoolean()
  isRetryable!: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  durationMs?: number;

  @IsOptional()
  @IsString()
  provider?: string;
}

/**
 * DTO for retry decision
 */
export class RetryDecisionDto {
  shouldRetry!: boolean;
  delayMs!: number;
  attemptNumber!: number;
  maxRetries!: number;
  reason!: RetryDecisionReason;
}

/**
 * DTO for previous attempt
 */
export class PreviousAttemptDto {
  attemptNumber!: number;
  provider!: string;
  errorCode!: string;
  errorMessage!: string;
  durationMs!: number;
  timestamp!: Date;
}

/**
 * DTO for retry context
 */
export class RetryContextDto {
  correlationId!: string;
  executionId!: string;
  ticketId!: string;
  originalRequestTime!: Date;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreviousAttemptDto)
  previousErrors!: PreviousAttemptDto[];

  cumulativeDurationMs!: number;
  retryCount!: number;
}

/**
 * DTO for error classification
 */
export class ErrorClassificationDto {
  isRetryable!: boolean;
  errorCode!: string;
  message!: string;
  suggestedDelayMs!: number;
  shouldFallback!: boolean;
  severity!: ErrorSeverity;
}

/**
 * DTO for retry metrics response
 */
export class RetryMetricsDto {
  totalRetries!: number;
  successfulRetries!: number;
  exhaustedRetries!: number;
  avgRetriesPerExecution!: number;
  successRate!: number;
  retriesByErrorCode!: Record<string, number>;
}

/**
 * DTO for permanent failure notification
 */
export class PermanentFailureDto {
  executionId!: string;
  ticketId!: string;
  correlationId!: string;
  totalAttempts!: number;
  lastError!: string;
  previousAttempts!: PreviousAttemptDto[];
  totalDurationMs!: number;
  failureTime!: Date;
}
