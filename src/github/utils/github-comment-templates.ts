/**
 * GitHub Comment Templates
 * Story 4.7: GitHub Push Error Handling & Rollback
 *
 * Generates ClickUp comment templates for:
 * - GitHub operation failures (AC#2)
 * - Deployment rollbacks (AC#3)
 */

import { GitHubErrorType } from './error-classifier';

/**
 * Context for failure comment generation
 */
export interface FailureContext {
    operationType: 'commit' | 'push' | 'pr_creation' | 'deployment';
    environment?: string;
    timestamp: Date;
    errorType: GitHubErrorType;
    repository: string;
    branchName: string;
    commitSha?: string;
    sanitizedErrorMessage: string;
    sentryUrl?: string;
}

/**
 * Context for rollback comment generation
 */
export interface RollbackContext {
    environment: string;
    timestamp: Date;
    rollbackReason: string;
    buildId?: string;
    cicdBuildUrl?: string;
}

/**
 * Template generator for ClickUp comments
 */
export class GitHubCommentTemplates {
    /**
     * Generate failure comment for PM notification (AC#2)
     */
    static failureComment(context: FailureContext): string {
        const operationLabel = this.formatOperationType(context.operationType);
        const timestamp = this.formatTimestamp(context.timestamp);
        const actions = this.getRequiredActions(context.errorType, context.sentryUrl);

        const lines = [
            `⚠️ **GitHub Operation Failed**`,
            ``,
            `**Operation:** ${operationLabel}`,
        ];

        if (context.environment) {
            lines.push(`**Environment:** ${context.environment}`);
        }

        lines.push(
            `**Failed At:** ${timestamp}`,
            `**Error Type:** ${context.errorType}`,
            `**Repository:** ${context.repository}`,
            `**Branch:** ${context.branchName}`,
        );

        if (context.commitSha) {
            lines.push(`**Commit SHA:** ${context.commitSha}`);
        }

        lines.push(
            ``,
            `**Error Message:**`,
            context.sanitizedErrorMessage,
            ``,
            `**Required Actions:**`,
            ...actions.map((action) => `- ${action}`),
        );

        return lines.join('\n');
    }

    /**
     * Generate rollback comment for PM notification (AC#3)
     */
    static rollbackComment(context: RollbackContext): string {
        const timestamp = this.formatTimestamp(context.timestamp);

        const lines = [
            `🔄 **Deployment Rolled Back**`,
            ``,
            `**Environment:** ${context.environment}`,
            `**Rolled Back At:** ${timestamp}`,
            `**Reason:** ${context.rollbackReason}`,
            `**Previous Version:** Restored to last stable commit`,
        ];

        if (context.buildId && context.cicdBuildUrl) {
            lines.push(`**Failed Deployment:** [Build #${context.buildId}](${context.cicdBuildUrl})`);
        }

        lines.push(
            ``,
            `**Next Steps:**`,
            `- Fix identified issues in development`,
        );

        if (context.cicdBuildUrl) {
            lines.push(`- Review CI/CD logs: [View Logs](${context.cicdBuildUrl})`);
        }

        lines.push(
            `- Re-test before attempting redeployment`,
            `- Contact TL for architecture review if needed`,
        );

        return lines.join('\n');
    }

    /**
     * Format operation type for display
     */
    private static formatOperationType(
        operationType: 'commit' | 'push' | 'pr_creation' | 'deployment',
    ): string {
        const labels: Record<string, string> = {
            commit: 'Git Commit',
            push: 'Git Push',
            pr_creation: 'Pull Request Creation',
            deployment: 'Deployment',
        };
        return labels[operationType] || operationType;
    }

    /**
     * Format timestamp for display
     */
    private static formatTimestamp(date: Date): string {
        return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    }

    /**
     * Get required actions based on error type
     */
    private static getRequiredActions(
        errorType: GitHubErrorType,
        sentryUrl?: string,
    ): string[] {
        const actions: string[] = [];

        if (sentryUrl) {
            actions.push(`Review error details in Sentry: [View Error](${sentryUrl})`);
        }

        actions.push('Check GitHub repository for conflicts or access issues');

        switch (errorType) {
            case 'merge_conflict':
                actions.push('Manually resolve merge conflicts and re-push');
                break;
            case 'auth_failure':
                actions.push('Verify GitHub credentials and permissions');
                break;
            case 'rate_limit':
                actions.push('Wait for rate limit reset or check API usage');
                break;
            case 'network_error':
                actions.push('Check network connectivity and retry operation');
                break;
            case 'timeout':
                actions.push('Check AI provider status and retry operation');
                break;
            case 'unknown':
            default:
                actions.push('Investigate error details and determine root cause');
                break;
        }

        actions.push('Contact TL if architecture changes needed');

        return actions;
    }
}
