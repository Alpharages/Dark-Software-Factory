/**
 * Error Classifier Unit Tests
 * Story 4.7: GitHub Push Error Handling & Rollback
 *
 * Tests all 6 error types from AC#1 classification table
 */

import { ErrorClassifier } from './error-classifier';

describe('ErrorClassifier', () => {
  describe('classify', () => {
    // ============= Auth Failure Tests (AC#1) =============
    describe('auth_failure classification', () => {
      it('should classify 401 status code as auth_failure', () => {
        const error = { message: 'Request failed', response: { status: 401 } };
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('auth_failure');
        expect(result.isRetryable).toBe(false);
        expect(result.requiresManualFix).toBe(true);
        expect(result.sentryLevel).toBe('error');
      });

      it('should classify 403 status code as auth_failure', () => {
        const error = { message: 'Forbidden', response: { status: 403 } };
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('auth_failure');
      });

      it('should classify "Bad credentials" message as auth_failure', () => {
        const error = new Error('Bad credentials - token invalid');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('auth_failure');
      });

      it('should classify "authentication failed" as auth_failure', () => {
        const error = new Error('GitHub authentication failed');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('auth_failure');
      });

      it('should classify "invalid token" as auth_failure', () => {
        const error = new Error('Invalid token provided');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('auth_failure');
      });
    });

    // ============= Merge Conflict Tests (AC#1) =============
    describe('merge_conflict classification', () => {
      it('should classify "Merge conflict" message as merge_conflict', () => {
        const error = new Error('Merge conflict in file.ts');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('merge_conflict');
        expect(result.isRetryable).toBe(false);
        expect(result.requiresManualFix).toBe(true);
        expect(result.sentryLevel).toBe('warning');
      });

      it('should classify "Updates were rejected" as merge_conflict', () => {
        const error = new Error('Updates were rejected because the remote contains work');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('merge_conflict');
      });

      it('should classify "non-fast-forward" as merge_conflict', () => {
        const error = new Error('error: failed to push some refs: non-fast-forward');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('merge_conflict');
      });

      it('should classify "tip of your current branch is behind" as merge_conflict', () => {
        const error = new Error('The tip of your current branch is behind its remote counterpart');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('merge_conflict');
      });
    });

    // ============= Rate Limit Tests (AC#1) =============
    describe('rate_limit classification', () => {
      it('should classify 429 status code as rate_limit', () => {
        const error = { message: 'Too many requests', response: { status: 429 } };
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('rate_limit');
        expect(result.isRetryable).toBe(true);
        expect(result.requiresManualFix).toBe(false);
        expect(result.sentryLevel).toBe('info');
      });

      it('should classify "rate limit exceeded" message as rate_limit', () => {
        const error = new Error('API rate limit exceeded for user');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('rate_limit');
      });

      it('should classify "secondary rate limit" as rate_limit', () => {
        const error = new Error('You have triggered a secondary rate limit');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('rate_limit');
      });
    });

    // ============= Network Error Tests (AC#1) =============
    describe('network_error classification', () => {
      it('should classify ECONNRESET as network_error', () => {
        const error = new Error('read ECONNRESET');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('network_error');
        expect(result.isRetryable).toBe(true);
        expect(result.requiresManualFix).toBe(false);
        expect(result.sentryLevel).toBe('warning');
      });

      it('should classify ETIMEDOUT as network_error', () => {
        const error = new Error('connect ETIMEDOUT');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('network_error');
      });

      it('should classify EAI_AGAIN as network_error', () => {
        const error = new Error('getaddrinfo EAI_AGAIN github.com');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('network_error');
      });

      it('should classify "socket hang up" as network_error', () => {
        const error = new Error('socket hang up');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('network_error');
      });

      it('should classify ECONNREFUSED as network_error', () => {
        const error = new Error('connect ECONNREFUSED 127.0.0.1:443');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('network_error');
      });
    });

    // ============= Timeout Tests (AC#1) =============
    describe('timeout classification', () => {
      it('should classify "AI timeout" as timeout', () => {
        const error = new Error('AI timeout exceeded');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('timeout');
        expect(result.isRetryable).toBe(true);
        expect(result.requiresManualFix).toBe(false);
        expect(result.sentryLevel).toBe('warning');
      });

      it('should classify "execution timeout" as timeout', () => {
        const error = new Error('Execution timeout after 300s');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('timeout');
      });

      it('should classify "request timed out" as timeout', () => {
        const error = new Error('Request timed out');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('timeout');
      });

      it('should classify "deadline exceeded" as timeout', () => {
        const error = new Error('DEADLINE_EXCEEDED: deadline exceeded');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('timeout');
      });
    });

    // ============= Unknown Error Tests (AC#1) =============
    describe('unknown classification', () => {
      it('should classify unrecognized errors as unknown', () => {
        const error = new Error('Something completely unexpected happened');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('unknown');
        expect(result.isRetryable).toBe(false);
        expect(result.requiresManualFix).toBe(true);
        expect(result.sentryLevel).toBe('error');
      });

      it('should classify null/undefined as unknown', () => {
        const result = ErrorClassifier.classify(null);
        expect(result.type).toBe('unknown');
      });

      it('should classify empty string as unknown', () => {
        const result = ErrorClassifier.classify('');
        expect(result.type).toBe('unknown');
      });
    });

    // ============= Edge Cases =============
    describe('edge cases', () => {
      it('should handle string errors', () => {
        const result = ErrorClassifier.classify('Bad credentials error');
        expect(result.type).toBe('auth_failure');
      });

      it('should handle Axios-style errors with nested response', () => {
        const error = {
          message: 'Request failed with status code 401',
          response: {
            status: 401,
            data: { message: 'Bad credentials' },
          },
        };
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('auth_failure');
      });

      it('should prioritize auth_failure over merge_conflict', () => {
        // Auth errors should be checked first
        const error = new Error('401 - Updates were rejected');
        const result = ErrorClassifier.classify(error);
        expect(result.type).toBe('auth_failure');
      });
    });
  });
});
