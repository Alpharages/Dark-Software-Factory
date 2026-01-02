/**
 * GitHub Error Monitor Service
 * Story 4.7: GitHub Push Error Handling & Rollback
 *
 * Centralized error monitoring for GitHub operations:
 * - AC#1: Error classification and Sentry logging
 * - AC#2: PM notification via ClickUp
 * - AC#3: Deployment rollback tracking
 * - AC#4: Observability (metrics, audit logs)
 * - AC#5: Graceful degradation
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { LoggerService } from '../../common/logger/logger.service';
import { ClickUpService } from '../../clickup/clickup.service';
import { ErrorSeverity } from '../../common/sentry/sentry.constants';
import { ErrorClassifier, GitHubErrorType, ErrorClassification } from '../utils/error-classifier';
import { ErrorSanitizer } from '../utils/error-sanitizer';
import {
  GitHubCommentTemplates,
  FailureContext,
  RollbackContext,
} from '../utils/github-comment-templates';

/**
 * Operation types for GitHub error tracking
 */
export type GitHubOperation = 'commit' | 'push' | 'pr_creation' | 'deployment';

/**
 * Context for GitHub operation errors
 */
export interface GitHubErrorContext {
  operation: GitHubOperation;
  executionId: string;
  ticketId: string;
  repository: string;
  branchName: string;
  error: Error | unknown;
  correlationId?: string;
  aiProvider?: string;
  commitSha?: string;
  environment?: string;
  taskInstructions?: string;
  aiOutput?: string;
}

/**
 * Context for deployment failures
 */
export interface DeploymentFailureContext {
  deploymentId: string;
  status: 'FAILED' | 'ROLLED_BACK';
  environment: string;
  ticketId: string;
  repository: string;
  branchName: string;
  errorMessage?: string;
  buildId?: string;
  cicdBuildUrl?: string;
  correlationId?: string;
}

/**
 * Centralized GitHub error monitoring and PM notification service
 */
@Injectable()
export class GitHubErrorMonitor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sentry: SentryService,
    private readonly metrics: MetricsService,
    private readonly audit: AuditLogService,
    private readonly clickup: ClickUpService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Handle GitHub operation error (AC#1, #2, #4, #5)
   * Used by GitHubCommitOrchestrator, GitHubPROrchestrator, DeploymentOrchestrator
   */
  async handleGitHubError(context: GitHubErrorContext): Promise<void> {
    const classification = ErrorClassifier.classify(context.error);

    this.logger.warn('GitHub operation failed', {
      operation: context.operation,
      executionId: context.executionId,
      ticketId: context.ticketId,
      repository: context.repository,
      branchName: context.branchName,
      errorType: classification.type,
      correlationId: context.correlationId,
      aiProvider: context.aiProvider,
    });

    // AC#1: Log to Sentry with full context
    await this.logToSentry(context, classification);

    // AC#4: Record metrics
    this.recordMetrics(context.operation, classification.type);

    // AC#4: Create audit log
    await this.createAuditLog(context, classification);

    // AC#2: Notify PM via ClickUp
    await this.notifyPM(context, classification);

    // AC#5: Update execution status (graceful degradation)
    await this.updateExecutionStatus(context.executionId, classification);
  }

  /**
   * Handle deployment failure (AC#3)
   */
  async handleDeploymentFailure(context: DeploymentFailureContext): Promise<void> {
    this.logger.warn('Deployment failed', {
      deploymentId: context.deploymentId,
      status: context.status,
      environment: context.environment,
      ticketId: context.ticketId,
      correlationId: context.correlationId,
    });

    // AC#3: Update deployment record
    await this.updateDeploymentStatus(context);

    // AC#4: Record rollback metrics
    if (context.status === 'ROLLED_BACK') {
      this.metrics.recordDeployment({
        environment: context.environment,
        status: 'rolled_back',
        duration: 0, // Rollback duration not tracked here
      });
      // AC#4: Increment specific rollback counter
      this.metrics.recordDeploymentRollback(context.environment);
    }

    // AC#3: Create audit log for rollback
    await this.audit.log({
      action: context.status === 'ROLLED_BACK' ? 'deployment_rollback' : 'deployment_failed',
      entityType: 'deployment',
      entityId: context.deploymentId,
      actorType: 'system',
      afterState: {
        status: context.status,
        environment: context.environment,
        repository: context.repository,
        branchName: context.branchName,
        errorMessage: context.errorMessage,
        correlationId: context.correlationId,
      },
    });

    // AC#3: Send rollback notification to PM
    await this.notifyDeploymentFailure(context);
  }

  /**
   * AC#1: Log error to Sentry with full context
   */
  private async logToSentry(
    context: GitHubErrorContext,
    classification: ErrorClassification,
  ): Promise<void> {
    const error = context.error instanceof Error ? context.error : new Error(String(context.error));

    this.sentry.captureException(error, {
      severity: this.mapToSentrySeverity(classification.sentryLevel),
      tags: {
        operation: context.operation,
        error_type: classification.type,
        repository: context.repository,
        ai_provider: context.aiProvider || 'unknown',
      },
      extra: {
        executionId: context.executionId,
        ticketId: context.ticketId,
        branchName: context.branchName,
        commitSha: context.commitSha,
        correlationId: context.correlationId,
        taskInstructions: context.taskInstructions,
        aiOutput: context.aiOutput,
      },
    });
  }

  /**
   * AC#4: Record Prometheus metrics
   */
  private recordMetrics(operation: GitHubOperation, errorType: GitHubErrorType): void {
    // Increment error counter
    this.metrics.incrementGitHubOperation(operation, 'error');

    // Record rate limit hits specifically
    if (errorType === 'rate_limit') {
      this.metrics.incrementGitHubRateLimitHit();
    }

    // Increment error type counter
    this.metrics.incrementErrors(`github_${operation}_${errorType}`);
  }

  /**
   * AC#4: Create audit log entry
   */
  private async createAuditLog(
    context: GitHubErrorContext,
    classification: ErrorClassification,
  ): Promise<void> {
    await this.audit.log({
      action: 'github_error_detected',
      entityType: 'execution',
      entityId: context.executionId,
      actorType: 'system',
      afterState: {
        operation: context.operation,
        errorType: classification.type,
        repository: context.repository,
        branchName: context.branchName,
        isRetryable: classification.isRetryable,
        requiresManualFix: classification.requiresManualFix,
        correlationId: context.correlationId,
      },
    });
  }

  /**
   * AC#2: Notify PM via ClickUp with failure comment
   */
  private async notifyPM(
    context: GitHubErrorContext,
    classification: ErrorClassification,
  ): Promise<void> {
    const errorMessage =
      context.error instanceof Error ? context.error.message : String(context.error);
    const sanitizedMessage = ErrorSanitizer.sanitize(errorMessage);

    const failureContext: FailureContext = {
      operationType: context.operation,
      environment: context.environment,
      timestamp: new Date(),
      errorType: classification.type,
      repository: context.repository,
      branchName: context.branchName,
      commitSha: context.commitSha,
      sanitizedErrorMessage: sanitizedMessage,
      // Sentry URL would be populated by Sentry integration in real implementation
      sentryUrl: undefined,
    };

    const comment = GitHubCommentTemplates.failureComment(failureContext);

    try {
      const success = await this.clickup.addComment(context.ticketId, comment, {
        correlationId: context.correlationId,
      });

      if (!success) {
        // AC#5: Fallback - log notification failure
        await this.handleNotificationFailure(context, comment, classification);
      }
    } catch (_error) {
      // AC#5: Graceful degradation - ClickUp failure should not block
      await this.handleNotificationFailure(context, comment, classification);
    }
  }

  /**
   * AC#3: Send rollback notification to PM
   */
  private async notifyDeploymentFailure(context: DeploymentFailureContext): Promise<void> {
    if (context.status === 'ROLLED_BACK') {
      const rollbackContext: RollbackContext = {
        environment: context.environment,
        timestamp: new Date(),
        rollbackReason: context.errorMessage || 'Unknown reason',
        buildId: context.buildId,
        cicdBuildUrl: context.cicdBuildUrl,
      };

      const comment = GitHubCommentTemplates.rollbackComment(rollbackContext);

      try {
        const success = await this.clickup.addComment(context.ticketId, comment, {
          correlationId: context.correlationId,
        });

        if (!success) {
          await this.logNotificationFallback(context.deploymentId, comment, 'deployment');
        }
      } catch {
        await this.logNotificationFallback(context.deploymentId, comment, 'deployment');
      }
    } else {
      // FAILED status - use failure template
      const failureContext: FailureContext = {
        operationType: 'deployment',
        environment: context.environment,
        timestamp: new Date(),
        errorType: 'unknown',
        repository: context.repository,
        branchName: context.branchName,
        sanitizedErrorMessage: ErrorSanitizer.sanitize(context.errorMessage),
      };

      const comment = GitHubCommentTemplates.failureComment(failureContext);

      try {
        await this.clickup.addComment(context.ticketId, comment, {
          correlationId: context.correlationId,
        });
      } catch {
        await this.logNotificationFallback(context.deploymentId, comment, 'deployment');
      }
    }
  }

  /**
   * AC#5: Handle PM notification failure with fallback
   */
  private async handleNotificationFailure(
    context: GitHubErrorContext,
    comment: string,
    classification: ErrorClassification,
  ): Promise<void> {
    // Log to audit_logs
    await this.audit.log({
      action: 'pm_notification_failed',
      entityType: 'execution',
      entityId: context.executionId,
      actorType: 'system',
      afterState: {
        ticketId: context.ticketId,
        operation: context.operation,
        errorType: classification.type,
        notificationContent: comment.substring(0, 500), // Truncate for storage
        correlationId: context.correlationId,
      },
    });

    // Send Sentry alert
    this.sentry.captureMessage('PM notification delivery failed', ErrorSeverity.CRITICAL, {
      operation: context.operation,
      ticketId: context.ticketId,
      executionId: context.executionId,
      correlationId: context.correlationId,
    });

    this.logger.warn('PM notification failed, using fallback', {
      executionId: context.executionId,
      ticketId: context.ticketId,
      correlationId: context.correlationId,
    });

    // AC#5: Update execution status with notification failure if not already failed
    // This persists the failure in the DB for visibility
    await this.updateExecutionStatus(context.executionId, {
      type: 'unknown',
      isRetryable: false,
      requiresManualFix: true,
      sentryLevel: 'error',
    });
  }

  /**
   * AC#5: Log notification fallback to audit
   */
  private async logNotificationFallback(
    entityId: string,
    comment: string,
    entityType: 'execution' | 'deployment',
  ): Promise<void> {
    await this.audit.log({
      action: 'pm_notification_failed',
      entityType,
      entityId,
      actorType: 'system',
      afterState: {
        notificationContent: comment.substring(0, 500),
      },
    });

    this.sentry.captureMessage('PM notification delivery failed', ErrorSeverity.CRITICAL, {
      entityId,
      entityType,
    });
  }

  /**
   * AC#3: Update deployment status in database
   */
  private async updateDeploymentStatus(context: DeploymentFailureContext): Promise<void> {
    try {
      await this.prisma.deployment.update({
        where: { id: context.deploymentId },
        data: {
          status: context.status,
          error_message: ErrorSanitizer.sanitize(context.errorMessage),
        },
      });
    } catch (_error) {
      this.logger.warn('Failed to update deployment status', {
        deploymentId: context.deploymentId,
        error: (_error as Error).message,
      });
    }
  }

  /**
   * AC#5: Update execution status (graceful degradation)
   */
  private async updateExecutionStatus(
    executionId: string,
    classification: ErrorClassification,
  ): Promise<void> {
    try {
      await this.prisma.execution.update({
        where: { id: executionId },
        data: {
          status: 'FAILED',
          error_message: `GitHub operation failed: ${classification.type}`,
        },
      });
    } catch (_error) {
      // AC#5: Log but don't fail - graceful degradation
      this.logger.warn('Failed to update execution status', {
        executionId,
        error: (_error as Error).message,
      });
    }
  }
  /**
   * Map internal sentry level to Sentry SDK severity
   */
  private mapToSentrySeverity(level: string): ErrorSeverity {
    switch (level) {
      case 'error':
        return ErrorSeverity.CRITICAL;
      case 'warning':
        return ErrorSeverity.HIGH;
      case 'info':
        return ErrorSeverity.MEDIUM;
      default:
        return ErrorSeverity.LOW;
    }
  }
}
