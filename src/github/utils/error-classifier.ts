/**
 * Error Classification Utility
 * Story 4.7: GitHub Push Error Handling & Rollback
 *
 * Classifies GitHub operation errors into categories for metrics, logging, and PM notifications.
 * Based on AC#1 error classification table.
 */

/**
 * Supported GitHub error types for metrics and reporting
 */
export type GitHubErrorType =
    | 'auth_failure'
    | 'merge_conflict'
    | 'rate_limit'
    | 'network_error'
    | 'timeout'
    | 'unknown';

/**
 * Error classification result with metadata
 */
export interface ErrorClassification {
    type: GitHubErrorType;
    isRetryable: boolean;
    requiresManualFix: boolean;
    sentryLevel: 'info' | 'warning' | 'error';
}

/**
 * Pattern-based error classifier
 * Uses AC#1 table for classification logic
 */
export class ErrorClassifier {
    // Auth failure patterns: 401, 403, "Bad credentials"
    private static readonly AUTH_PATTERNS = [
        /401/i,
        /403/i,
        /bad credentials/i,
        /authentication failed/i,
        /unauthorized/i,
        /forbidden/i,
        /invalid token/i,
        /token expired/i,
    ];

    // Merge conflict patterns
    private static readonly MERGE_CONFLICT_PATTERNS = [
        /merge conflict/i,
        /updates were rejected/i,
        /cannot lock ref/i,
        /failed to push/i,
        /non-fast-forward/i,
        /tip of your current branch is behind/i,
    ];

    // Rate limit patterns: 429, "rate limit exceeded"
    private static readonly RATE_LIMIT_PATTERNS = [
        /429/i,
        /rate limit/i,
        /too many requests/i,
        /api rate limit exceeded/i,
        /secondary rate limit/i,
    ];

    // Network error patterns
    private static readonly NETWORK_PATTERNS = [
        /ECONNRESET/i,
        /ETIMEDOUT/i,
        /EAI_AGAIN/i,
        /ENOTFOUND/i,
        /ECONNREFUSED/i,
        /network error/i,
        /socket hang up/i,
        /getaddrinfo/i,
    ];

    // Timeout patterns
    private static readonly TIMEOUT_PATTERNS = [
        /timeout/i,
        /timed out/i,
        /execution timeout/i,
        /ai timeout/i,
        /request timed out/i,
        /deadline exceeded/i,
    ];

    /**
     * Classify an error based on message, code, and status
     *
     * @param error - Error object to classify
     * @returns Classification with type, retryability, and Sentry level
     */
    static classify(error: Error | unknown): ErrorClassification {
        const errorMessage = this.extractErrorMessage(error);
        const statusCode = this.extractStatusCode(error);

        // Check patterns in priority order
        if (this.matchesPatterns(errorMessage, statusCode, this.AUTH_PATTERNS)) {
            return {
                type: 'auth_failure',
                isRetryable: false,
                requiresManualFix: true,
                sentryLevel: 'error',
            };
        }

        if (this.matchesPatterns(errorMessage, statusCode, this.MERGE_CONFLICT_PATTERNS)) {
            return {
                type: 'merge_conflict',
                isRetryable: false,
                requiresManualFix: true,
                sentryLevel: 'warning',
            };
        }

        if (this.matchesPatterns(errorMessage, statusCode, this.RATE_LIMIT_PATTERNS)) {
            return {
                type: 'rate_limit',
                isRetryable: true, // Story 4.1 handles this, but mark retryable for completeness
                requiresManualFix: false,
                sentryLevel: 'info',
            };
        }

        if (this.matchesPatterns(errorMessage, statusCode, this.NETWORK_PATTERNS)) {
            return {
                type: 'network_error',
                isRetryable: true, // Transient, may self-resolve
                requiresManualFix: false,
                sentryLevel: 'warning',
            };
        }

        if (this.matchesPatterns(errorMessage, statusCode, this.TIMEOUT_PATTERNS)) {
            return {
                type: 'timeout',
                isRetryable: true, // AI may succeed on retry
                requiresManualFix: false,
                sentryLevel: 'warning',
            };
        }

        // Default: unknown error
        return {
            type: 'unknown',
            isRetryable: false,
            requiresManualFix: true,
            sentryLevel: 'error',
        };
    }

    /**
     * Extract error message from various error types
     */
    private static extractErrorMessage(error: Error | unknown): string {
        if (error instanceof Error) {
            return `${error.message} ${error.stack || ''}`;
        }
        if (typeof error === 'string') {
            return error;
        }
        if (error && typeof error === 'object') {
            // Handle Axios-like errors
            const axiosError = error as { message?: string; response?: { data?: { message?: string } } };
            const parts: string[] = [];
            if (axiosError.message) parts.push(axiosError.message);
            if (axiosError.response?.data?.message) parts.push(axiosError.response.data.message);
            return parts.join(' ');
        }
        return String(error);
    }

    /**
     * Extract HTTP status code from error
     */
    private static extractStatusCode(error: Error | unknown): number | undefined {
        if (error && typeof error === 'object') {
            // Axios-style error
            const axiosError = error as { response?: { status?: number }; status?: number };
            return axiosError.response?.status || axiosError.status;
        }
        return undefined;
    }

    /**
     * Check if error matches any pattern
     */
    private static matchesPatterns(
        errorMessage: string,
        statusCode: number | undefined,
        patterns: RegExp[],
    ): boolean {
        // Check message against patterns
        for (const pattern of patterns) {
            if (pattern.test(errorMessage)) {
                return true;
            }
        }

        // Check status code directly if applicable
        if (statusCode !== undefined) {
            const statusStr = statusCode.toString();
            for (const pattern of patterns) {
                if (pattern.test(statusStr)) {
                    return true;
                }
            }
        }

        return false;
    }
}
