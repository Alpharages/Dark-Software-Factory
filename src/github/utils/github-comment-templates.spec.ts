/**
 * GitHub Comment Templates Unit Tests
 * Story 4.7: GitHub Push Error Handling & Rollback
 *
 * Tests comment generation for failures (AC#2) and rollbacks (AC#3)
 */

import { GitHubCommentTemplates, FailureContext, RollbackContext } from './github-comment-templates';

describe('GitHubCommentTemplates', () => {
    describe('failureComment', () => {
        const baseContext: FailureContext = {
            operationType: 'commit',
            environment: 'staging',
            timestamp: new Date('2025-12-08T15:30:00Z'),
            errorType: 'auth_failure',
            repository: 'org/my-repo',
            branchName: 'feature/DSF-123-implement-feature',
            sanitizedErrorMessage: 'Authentication failed: Token expired',
        };

        it('should generate failure comment with all fields', () => {
            const context = { ...baseContext, commitSha: 'abc123', sentryUrl: 'https://sentry.io/issue/123' };
            const result = GitHubCommentTemplates.failureComment(context);

            expect(result).toContain('⚠️ **GitHub Operation Failed**');
            expect(result).toContain('**Operation:** Git Commit');
            expect(result).toContain('**Environment:** staging');
            expect(result).toContain('**Failed At:** 2025-12-08 15:30:00 UTC');
            expect(result).toContain('**Error Type:** auth_failure');
            expect(result).toContain('**Repository:** org/my-repo');
            expect(result).toContain('**Branch:** feature/DSF-123-implement-feature');
            expect(result).toContain('**Commit SHA:** abc123');
            expect(result).toContain('Authentication failed: Token expired');
            expect(result).toContain('[View Error](https://sentry.io/issue/123)');
        });

        it('should include auth_failure-specific action', () => {
            const result = GitHubCommentTemplates.failureComment(baseContext);
            expect(result).toContain('Verify GitHub credentials and permissions');
        });

        it('should include merge_conflict-specific action', () => {
            const context: FailureContext = { ...baseContext, errorType: 'merge_conflict' };
            const result = GitHubCommentTemplates.failureComment(context);
            expect(result).toContain('Manually resolve merge conflicts and re-push');
        });

        it('should include rate_limit-specific action', () => {
            const context: FailureContext = { ...baseContext, errorType: 'rate_limit' };
            const result = GitHubCommentTemplates.failureComment(context);
            expect(result).toContain('Wait for rate limit reset or check API usage');
        });

        it('should include network_error-specific action', () => {
            const context: FailureContext = { ...baseContext, errorType: 'network_error' };
            const result = GitHubCommentTemplates.failureComment(context);
            expect(result).toContain('Check network connectivity and retry operation');
        });

        it('should include timeout-specific action', () => {
            const context: FailureContext = { ...baseContext, errorType: 'timeout' };
            const result = GitHubCommentTemplates.failureComment(context);
            expect(result).toContain('Check AI provider status and retry operation');
        });

        it('should include unknown-specific action', () => {
            const context: FailureContext = { ...baseContext, errorType: 'unknown' };
            const result = GitHubCommentTemplates.failureComment(context);
            expect(result).toContain('Investigate error details and determine root cause');
        });

        it('should format all operation types correctly', () => {
            const operations: Array<FailureContext['operationType']> = ['commit', 'push', 'pr_creation', 'deployment'];
            const labels = ['Git Commit', 'Git Push', 'Pull Request Creation', 'Deployment'];

            operations.forEach((op, index) => {
                const context: FailureContext = { ...baseContext, operationType: op };
                const result = GitHubCommentTemplates.failureComment(context);
                expect(result).toContain(`**Operation:** ${labels[index]}`);
            });
        });

        it('should omit optional fields when not provided', () => {
            const context: FailureContext = {
                operationType: 'push',
                timestamp: new Date('2025-12-08T15:30:00Z'),
                errorType: 'network_error',
                repository: 'org/repo',
                branchName: 'main',
                sanitizedErrorMessage: 'Connection reset',
            };
            const result = GitHubCommentTemplates.failureComment(context);

            expect(result).not.toContain('**Environment:**');
            expect(result).not.toContain('**Commit SHA:**');
            expect(result).not.toContain('[View Error]');
        });
    });

    describe('rollbackComment', () => {
        const baseContext: RollbackContext = {
            environment: 'production',
            timestamp: new Date('2025-12-08T16:00:00Z'),
            rollbackReason: 'Failed health check after deployment',
        };

        it('should generate rollback comment with required fields', () => {
            const result = GitHubCommentTemplates.rollbackComment(baseContext);

            expect(result).toContain('🔄 **Deployment Rolled Back**');
            expect(result).toContain('**Environment:** production');
            expect(result).toContain('**Rolled Back At:** 2025-12-08 16:00:00 UTC');
            expect(result).toContain('**Reason:** Failed health check after deployment');
            expect(result).toContain('**Previous Version:** Restored to last stable commit');
        });

        it('should include build link when provided', () => {
            const context: RollbackContext = {
                ...baseContext,
                buildId: '42',
                cicdBuildUrl: 'https://github.com/org/repo/actions/runs/12345',
            };
            const result = GitHubCommentTemplates.rollbackComment(context);

            expect(result).toContain('[Build #42](https://github.com/org/repo/actions/runs/12345)');
            expect(result).toContain('[View Logs](https://github.com/org/repo/actions/runs/12345)');
        });

        it('should include all next steps', () => {
            const result = GitHubCommentTemplates.rollbackComment(baseContext);

            expect(result).toContain('Fix identified issues in development');
            expect(result).toContain('Re-test before attempting redeployment');
            expect(result).toContain('Contact TL for architecture review if needed');
        });
    });
});
