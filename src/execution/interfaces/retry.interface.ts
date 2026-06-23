import { AIErrorCode } from './ai-provider.interface';
import { ErrorSeverity } from '../../common/sentry/sentry.constants';

/**
 * Retry Interfaces
 * FR63: System retries failed executions with error context
 */

/**
 * Error classification result
 */
export interface IErrorClassification {
  /** Whether the error is retryable */
  isRetryable: boolean;

  /** Error code from AI provider */
  errorCode: AIErrorCode | string;

  /** Human-readable error message */
  message: string;

  /** Suggested wait time before retry (ms) */
  suggestedDelayMs: number;

  /** Whether to try a different provider */
  shouldFallback: boolean;

  /** Error severity for logging */
  severity: ErrorSeverity;
}

export { ErrorSeverity };

/**
 * Retry decision result
 */
export interface IRetryDecision {
  /** Whether to retry */
  shouldRetry: boolean;

  /** Delay before retry in milliseconds */
  delayMs: number;

  /** Current retry attempt (1-based) */
  attemptNumber: number;

  /** Maximum allowed retries */
  maxRetries: number;

  /** Reason for decision */
  reason: RetryDecisionReason;
}

/**
 * Reasons for retry decisions
 */
export enum RetryDecisionReason {
  /** Error is retryable and under limit */
  RETRYABLE = 'RETRYABLE',

  /** Max retries exceeded */
  MAX_RETRIES_EXCEEDED = 'MAX_RETRIES_EXCEEDED',

  /** Error is not retryable */
  NON_RETRYABLE_ERROR = 'NON_RETRYABLE_ERROR',

  /** Execution already succeeded */
  ALREADY_SUCCEEDED = 'ALREADY_SUCCEEDED',

  /** Execution cancelled */
  CANCELLED = 'CANCELLED',
}

/**
 * Retry context - preserved across retry attempts
 */
export interface IRetryContext {
  /** Original correlation ID */
  correlationId: string;

  /** Execution ID */
  executionId: string;

  /** Ticket ID */
  ticketId: string;

  /** Original request timestamp */
  originalRequestTime: Date;

  /** Previous attempt errors */
  previousErrors: IPreviousAttempt[];

  /** Cumulative execution time (ms) */
  cumulativeDurationMs: number;

  /** Current retry count */
  retryCount: number;
}

/**
 * Previous attempt record
 */
export interface IPreviousAttempt {
  /** Attempt number */
  attemptNumber: number;

  /** Provider used */
  provider: string;

  /** Error code */
  errorCode: string;

  /** Error message */
  errorMessage: string;

  /** Attempt duration (ms) */
  durationMs: number;

  /** Timestamp */
  timestamp: Date;
}

/**
 * Retry schedule entry - for delayed execution
 */
export interface IRetrySchedule {
  /** Execution ID to retry */
  executionId: string;

  /** Correlation ID for tracing */
  correlationId: string;

  /** Scheduled execution time */
  scheduledTime: Date;

  /** Delay from now (ms) */
  delayMs: number;

  /** Retry context */
  context: IRetryContext;
}

/**
 * Retry metrics
 */
export interface IRetryMetrics {
  /** Total retry attempts */
  totalRetries: number;

  /** Successful retries */
  successfulRetries: number;

  /** Failed after all retries */
  exhaustedRetries: number;

  /** Average retries per execution */
  avgRetriesPerExecution: number;

  /** Retry success rate */
  successRate: number;

  /** Retries by error code */
  retriesByErrorCode: Record<string, number>;
}
