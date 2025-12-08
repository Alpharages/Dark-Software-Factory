/**
 * Error Sanitizer Utility
 * Story 4.7: GitHub Push Error Handling & Rollback
 *
 * Sanitizes error messages before PM notification:
 * - Redacts secrets (GitHub tokens, long alphanumeric strings)
 * - Truncates to 500 characters
 *
 * Per AC#2: Do NOT use SecretsScannerService to avoid tight coupling
 */

/**
 * Sanitization options
 */
export interface SanitizeOptions {
  maxLength?: number;
  redactionMarker?: string;
}

const DEFAULT_OPTIONS: Required<SanitizeOptions> = {
  maxLength: 500,
  redactionMarker: '[REDACTED]',
};

/**
 * Error message sanitizer for PM notifications
 */
export class ErrorSanitizer {
  /**
   * Secret patterns to redact:
   * - GitHub Personal Access Tokens (ghp_...)
   * - GitHub OAuth tokens (ghs_...)
   * - New format GitHub PATs (github_pat_...)
   * - Generic long alphanumeric strings (20+ chars, potential secrets)
   */
  private static readonly SECRET_PATTERNS: RegExp[] = [
    // GitHub Personal Access Tokens (classic)
    /ghp_[a-zA-Z0-9]{36}/g,
    // GitHub OAuth tokens
    /ghs_[a-zA-Z0-9]{36}/g,
    // New format GitHub PATs
    /github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}/g,
    // GitHub App tokens
    /ghu_[a-zA-Z0-9]{36}/g,
    // GitHub App refresh tokens
    /ghr_[a-zA-Z0-9]{36}/g,
    // Bearer tokens in headers
    /Bearer\s+[a-zA-Z0-9._-]{20,}/gi,
    // Authorization headers
    /Authorization:\s*[^\s]+/gi,
    // Generic API keys (20+ alphanumeric characters)
    /[a-zA-Z0-9_-]{20,}/g,
  ];

  /**
   * Sanitize an error message for safe PM notification
   *
   * @param errorMessage - Raw error message (may contain secrets)
   * @param options - Sanitization options
   * @returns Sanitized error message with redacted secrets, truncated to maxLength
   */
  static sanitize(errorMessage: string | undefined | null, options?: SanitizeOptions): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Handle null/undefined
    if (!errorMessage) {
      return '';
    }

    let sanitized = errorMessage;

    // Apply all secret patterns
    for (const pattern of this.SECRET_PATTERNS) {
      // Reset regex lastIndex for global patterns
      pattern.lastIndex = 0;
      sanitized = sanitized.replace(pattern, opts.redactionMarker);
    }

    // Truncate if needed
    if (sanitized.length > opts.maxLength) {
      sanitized = sanitized.substring(0, opts.maxLength - 3) + '...';
    }

    return sanitized;
  }

  /**
   * Check if a string potentially contains secrets
   * Useful for logging decisions
   */
  static mayContainSecrets(text: string): boolean {
    for (const pattern of this.SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        return true;
      }
    }
    return false;
  }
}
