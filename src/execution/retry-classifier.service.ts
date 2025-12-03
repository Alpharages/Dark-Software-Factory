import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIErrorCode } from '../ai-routing/interfaces';
import {
    IErrorClassification,
    ErrorSeverity,
} from './interfaces';

/**
 * Retry Classifier Service
 * 
 * Classifies errors to determine if they are retryable.
 * Maps error codes to retry behavior and severity.
 * 
 * FR63: System retries failed executions with error context
 */
@Injectable()
export class RetryClassifierService {
    private readonly logger = new Logger(RetryClassifierService.name);

    /** Error classifications */
    private readonly errorClassifications: Map<string, Partial<IErrorClassification>>;

    constructor(private readonly config: ConfigService) {
        this.errorClassifications = this.initializeClassifications();
    }

    /**
     * Classify an error to determine retry behavior
     */
    classifyError(
        errorCode: AIErrorCode | string,
        errorMessage: string,
        correlationId: string,
    ): IErrorClassification {
        const baseClassification = this.errorClassifications.get(errorCode as string);

        if (baseClassification) {
            this.logger.debug(
                `[${correlationId}] Error classified: ${errorCode} → ` +
                `retryable=${baseClassification.isRetryable}, severity=${baseClassification.severity}`,
            );

            return {
                isRetryable: baseClassification.isRetryable ?? false,
                errorCode,
                message: errorMessage,
                suggestedDelayMs: baseClassification.suggestedDelayMs ?? 1000,
                shouldFallback: baseClassification.shouldFallback ?? false,
                severity: baseClassification.severity ?? ErrorSeverity.MEDIUM,
            };
        }

        // Unknown error - default to retryable with medium severity
        this.logger.warn(
            `[${correlationId}] Unknown error code: ${errorCode}, defaulting to retryable`,
        );

        return {
            isRetryable: true,
            errorCode,
            message: errorMessage,
            suggestedDelayMs: 2000,
            shouldFallback: true,
            severity: ErrorSeverity.MEDIUM,
        };
    }

    /**
     * Check if error code is retryable
     */
    isRetryable(errorCode: AIErrorCode | string): boolean {
        const classification = this.errorClassifications.get(errorCode as string);
        return classification?.isRetryable ?? true;
    }

    /**
     * Get all error codes and their classifications
     */
    getAllClassifications(): Record<string, Partial<IErrorClassification>> {
        return Object.fromEntries(this.errorClassifications);
    }

    /**
     * Initialize error classifications
     * Based on AIErrorCode enum from Story 2.6/2.7
     */
    private initializeClassifications(): Map<string, Partial<IErrorClassification>> {
        return new Map([
            // Retryable errors - transient issues
            ['TIMEOUT', {
                isRetryable: true,
                suggestedDelayMs: 5000,
                shouldFallback: true,
                severity: ErrorSeverity.MEDIUM,
            }],
            ['PROCESS_CRASH', {
                isRetryable: true,
                suggestedDelayMs: 3000,
                shouldFallback: true,
                severity: ErrorSeverity.MEDIUM,
            }],
            ['NETWORK_ERROR', {
                isRetryable: true,
                suggestedDelayMs: 2000,
                shouldFallback: false,
                severity: ErrorSeverity.LOW,
            }],
            ['RATE_LIMITED', {
                isRetryable: true,
                suggestedDelayMs: 30000, // Wait longer for rate limits
                shouldFallback: true,
                severity: ErrorSeverity.LOW,
            }],
            ['SERVICE_UNAVAILABLE', {
                isRetryable: true,
                suggestedDelayMs: 10000,
                shouldFallback: true,
                severity: ErrorSeverity.MEDIUM,
            }],
            ['WORKSPACE_LIMIT', {
                isRetryable: true,
                suggestedDelayMs: 60000, // Wait for workspace cleanup
                shouldFallback: false,
                severity: ErrorSeverity.MEDIUM,
            }],
            ['NO_CHANGES', {
                isRetryable: true,
                suggestedDelayMs: 2000,
                shouldFallback: true,
                severity: ErrorSeverity.LOW,
            }],
            ['GIT_CONFLICT', {
                isRetryable: true,
                suggestedDelayMs: 5000,
                shouldFallback: false,
                severity: ErrorSeverity.MEDIUM,
            }],

            // Non-retryable errors - permanent failures
            ['INVALID_PROMPT', {
                isRetryable: false,
                suggestedDelayMs: 0,
                shouldFallback: false,
                severity: ErrorSeverity.HIGH,
            }],
            ['INVALID_REPOSITORY', {
                isRetryable: false,
                suggestedDelayMs: 0,
                shouldFallback: false,
                severity: ErrorSeverity.HIGH,
            }],
            ['AUTHENTICATION_ERROR', {
                isRetryable: false,
                suggestedDelayMs: 0,
                shouldFallback: false,
                severity: ErrorSeverity.CRITICAL,
            }],
            ['PERMISSION_DENIED', {
                isRetryable: false,
                suggestedDelayMs: 0,
                shouldFallback: false,
                severity: ErrorSeverity.HIGH,
            }],
            ['UNSUPPORTED_LANGUAGE', {
                isRetryable: false,
                suggestedDelayMs: 0,
                shouldFallback: true,
                severity: ErrorSeverity.MEDIUM,
            }],
            ['CANCELLED', {
                isRetryable: false,
                suggestedDelayMs: 0,
                shouldFallback: false,
                severity: ErrorSeverity.LOW,
            }],
            ['CONFIGURATION_ERROR', {
                isRetryable: false,
                suggestedDelayMs: 0,
                shouldFallback: false,
                severity: ErrorSeverity.CRITICAL,
            }],

            // Unknown/generic errors - retry with caution
            ['UNKNOWN', {
                isRetryable: true,
                suggestedDelayMs: 5000,
                shouldFallback: true,
                severity: ErrorSeverity.HIGH,
            }],
            ['ORCHESTRATION_ERROR', {
                isRetryable: true,
                suggestedDelayMs: 3000,
                shouldFallback: true,
                severity: ErrorSeverity.MEDIUM,
            }],
        ]);
    }
}
