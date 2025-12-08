/**
 * Error Sanitizer Unit Tests
 * Story 4.7: GitHub Push Error Handling & Rollback
 *
 * Tests secret redaction and truncation per AC#2
 */

import { ErrorSanitizer } from './error-sanitizer';

describe('ErrorSanitizer', () => {
    describe('sanitize', () => {
        // ============= Secret Redaction Tests =============
        describe('GitHub token redaction', () => {
            it('should redact GitHub Personal Access Tokens (classic)', () => {
                const message = 'Request failed with token ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
                const result = ErrorSanitizer.sanitize(message);
                expect(result).toBe('Request failed with token [REDACTED]');
                expect(result).not.toContain('ghp_');
            });

            it('should redact GitHub OAuth tokens', () => {
                const message = 'Auth error with ghs_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
                const result = ErrorSanitizer.sanitize(message);
                expect(result).not.toContain('ghs_');
            });

            it('should redact new format GitHub PATs', () => {
                const message = 'Token github_pat_abcdefghijklmnopqrstuv_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1';
                const result = ErrorSanitizer.sanitize(message);
                expect(result).not.toContain('github_pat_');
            });

            it('should redact GitHub App user tokens', () => {
                const message = 'Failed with ghu_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
                const result = ErrorSanitizer.sanitize(message);
                expect(result).not.toContain('ghu_');
            });

            it('should redact Bearer tokens in Authorization headers', () => {
                const message = 'Error: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0';
                const result = ErrorSanitizer.sanitize(message);
                expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
            });
        });

        describe('generic secret redaction', () => {
            it('should redact long alphanumeric strings (20+ chars)', () => {
                const message = 'API key: XYZ123ABC456DEF789GHI012JKL345';
                const result = ErrorSanitizer.sanitize(message);
                expect(result).not.toContain('XYZ123ABC456DEF789GHI012JKL345');
            });

            it('should preserve short strings that are not secrets', () => {
                const message = 'Error in file.ts at line 123';
                const result = ErrorSanitizer.sanitize(message);
                expect(result).toBe('Error in file.ts at line 123');
            });
        });

        // ============= Truncation Tests =============
        describe('truncation', () => {
            it('should truncate messages longer than 500 chars by default', () => {
                // Use mixed chars to avoid triggering alphanumeric secret pattern
                const longMessage = 'Error at line 1. '.repeat(50); // ~850 chars
                const result = ErrorSanitizer.sanitize(longMessage);
                expect(result.length).toBe(500);
                expect(result.endsWith('...')).toBe(true);
            });

            it('should not truncate messages under 500 chars', () => {
                const shortMessage = 'This is a short error message';
                const result = ErrorSanitizer.sanitize(shortMessage);
                expect(result).toBe(shortMessage);
            });

            it('should respect custom maxLength option', () => {
                // Use mixed chars to avoid triggering alphanumeric secret pattern
                const message = 'Error: file.ts. '.repeat(20); // ~320 chars
                const result = ErrorSanitizer.sanitize(message, { maxLength: 100 });
                expect(result.length).toBe(100);
                expect(result.endsWith('...')).toBe(true);
            });
        });
        // ============= Edge Cases =============
        describe('edge cases', () => {
            it('should handle null input', () => {
                const result = ErrorSanitizer.sanitize(null);
                expect(result).toBe('');
            });

            it('should handle undefined input', () => {
                const result = ErrorSanitizer.sanitize(undefined);
                expect(result).toBe('');
            });

            it('should handle empty string', () => {
                const result = ErrorSanitizer.sanitize('');
                expect(result).toBe('');
            });

            it('should use custom redaction marker', () => {
                const message = 'Token ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
                const result = ErrorSanitizer.sanitize(message, { redactionMarker: '***' });
                expect(result).toContain('***');
                expect(result).not.toContain('[REDACTED]');
            });

            it('should redact multiple secrets in same message', () => {
                const message = 'Keys: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789 and ghs_1234567890ABCDEFGHIJKLMNOPQRSTUVWxyz';
                const result = ErrorSanitizer.sanitize(message);
                expect(result).not.toContain('ghp_');
                expect(result).not.toContain('ghs_');
                expect(result.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(2);
            });
        });
    });

    describe('mayContainSecrets', () => {
        it('should return true for messages with GitHub tokens', () => {
            const message = 'Contains ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
            expect(ErrorSanitizer.mayContainSecrets(message)).toBe(true);
        });

        it('should return true for messages with long alphanumeric strings', () => {
            const message = 'API key is ABC123DEF456GHI789JKL012MNO';
            expect(ErrorSanitizer.mayContainSecrets(message)).toBe(true);
        });

        it('should return false for clean messages', () => {
            const message = 'Simple error at line 5';
            expect(ErrorSanitizer.mayContainSecrets(message)).toBe(false);
        });
    });
});
