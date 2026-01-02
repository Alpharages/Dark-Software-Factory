import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeploymentStatus } from '@/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ClickUpService } from '../../clickup/clickup.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { SentryService } from '../../common/sentry/sentry.service';

/**
 * Deployment Status Synchronization Service
 * Story 4.6: AC#1-4
 *
 * Responsibilities:
 * - Sync deployment status (COMPLETED/FAILED/ROLLED_BACK) to ClickUp tickets
 * - Generate formatted comments with deployment details
 * - Redact secrets from error messages
 * - Graceful degradation (do not fail deployment if ClickUp down)
 * - Comprehensive observability (metrics, audit logs, structured logging)
 */
@Injectable()
export class DeploymentStatusSync {
  private readonly logger = new Logger(DeploymentStatusSync.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clickUp: ClickUpService,
    private readonly metrics: MetricsService,
    private readonly auditLog: AuditLogService,
    private readonly sentry: SentryService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Main entry point: Synchronize deployment status to ClickUp
   * AC#1: Update ClickUp ticket status
   * AC#2: Add formatted comment
   * AC#3: Graceful error handling
   * AC#4: Audit trail and metrics
   *
   * @param deploymentId - Deployment record ID
   * @param correlationId - Optional correlation ID from deployment context
   */
  async syncToClickUp(deploymentId: string, correlationId?: string): Promise<void> {
    const finalCorrelationId =
      correlationId ||
      (await this.getDeploymentCorrelationId(deploymentId)) ||
      this.generateCorrelationId();

    const startTime = Date.now();

    try {
      this.logger.log('Starting ClickUp deployment sync', {
        deploymentId,
        correlationId: finalCorrelationId,
      });

      // Fetch deployment with related GitHub push record and nested execution/ticket

      const deployment = await this.prisma.deployment.findUnique({
        where: { id: deploymentId },
        include: {
          github_push: {
            select: {
              id: true,
              commit_sha: true,
              pr_url: true,
              pr_number: true,
              repository: true,
              execution_id: true,
              error_message: true,
            },
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any); // Type assertion: Prisma include type complexity

      // Type assertion: Deployment with included github_push relation
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const typedDeployment = deployment as any as {
        id: string;
        status: DeploymentStatus;
        environment: string;
        deployed_at: Date | null;
        build_id: string | null;
        error_message: string | null;
        created_at: Date;
        github_push: {
          id: string;
          commit_sha: string | null;
          pr_url: string | null;
          pr_number: number | null;
          repository: string;
          execution_id: string;
          error_message: string | null;
        };
      };

      // Validation: Deployment exists
      if (!typedDeployment) {
        throw new NotFoundException(`Deployment ${deploymentId} not found`);
      }

      // Validate required relations exist
      if (!typedDeployment.github_push) {
        this.logger.warn('Deployment missing github_push relation, skipping ClickUp sync', {
          deploymentId,
          correlationId: finalCorrelationId,
        });
        return; // Graceful skip
      }

      // Fetch execution to get ticket (AC#1: ClickUp task ID)
      const execution = await this.prisma.execution.findUnique({
        where: { id: typedDeployment.github_push.execution_id },
        include: { ticket: true },
      });

      if (!execution?.ticket) {
        this.logger.warn('Cannot sync to ClickUp: ticket not found', {
          deploymentId: typedDeployment.id,
          executionId: typedDeployment.github_push.execution_id,
        });
        this.recordMetrics(typedDeployment.environment, false, `execution_${typedDeployment.id}`);
        return;
      }

      const ticketId = execution.ticket.clickup_task_id;
      const clickUpStatus = this.getClickUpStatusName(
        typedDeployment.status,
        typedDeployment.environment,
      );

      // AC#1: Update ClickUp ticket status
      const statusUpdated = await this.clickUp.updateStatus(ticketId, clickUpStatus, {
        correlationId: finalCorrelationId,
      });

      if (!statusUpdated) {
        // Graceful degradation: log but don't throw
        this.logger.error('ClickUp status update failed, but deployment continues', {
          deploymentId,
          ticketId,
          clickUpStatus,
          correlationId: finalCorrelationId,
        });

        this.recordMetrics(typedDeployment.environment, false, 'status_update_failed');
        await this.recordAuditLog(
          deploymentId,
          ticketId,
          typedDeployment.status,
          typedDeployment.environment,
          false,
          finalCorrelationId,
        );
        return;
      }

      // AC#2: Add formatted comment
      const comment =
        typedDeployment.github_push.commit_sha && typedDeployment.github_push.repository
          ? this.buildDeploymentComment(typedDeployment, typedDeployment.github_push)
          : `**Deployment ${typedDeployment.status}**\n\nEnvironment: ${typedDeployment.environment}\nNo commit SHA available`;

      const commentAdded = await this.clickUp.addComment(ticketId, comment, {
        correlationId: finalCorrelationId,
      });

      if (!commentAdded) {
        this.logger.warn('ClickUp comment failed (status updated successfully)', {
          deploymentId,
          ticketId,
          correlationId: finalCorrelationId,
        });
      }

      // AC#4: Record metrics and audit logs
      const duration = (Date.now() - startTime) / 1000;
      this.recordMetrics(typedDeployment.environment, true, undefined, duration);
      await this.recordAuditLog(
        deploymentId,
        ticketId,
        typedDeployment.status,
        typedDeployment.environment,
        true,
        finalCorrelationId,
        clickUpStatus,
      );

      // TODO: AC#5 - Emit Socket.IO event when RealtimeGateway available (Epic 10)
      // this.realtimeGateway.emit('deployment-status-updated', {
      //   ticketId,
      //   deploymentId,
      //   environment,
      //   status: deploymentStatus,
      //   deployedAt: deployment.deployed_at,
      //   clickupStatus: clickUpStatus,
      //   cicdBuildUrl: `https://github.com/${owner}/${repo}/actions/runs/${deployment.build_id}`,
      // });

      this.logger.log('ClickUp deployment sync completed successfully', {
        deploymentId,
        ticketId,
        environment: typedDeployment.environment,
        status: typedDeployment.status,
        correlationId: finalCorrelationId,
        duration,
      });
    } catch (_error) {
      // AC#3: Graceful degradation - log error but do NOT throw
      this.logger.error('ClickUp sync failed (graceful degradation)', (_error as Error).message, {
        deploymentId,
        correlationId: finalCorrelationId,
      });

      this.sentry.captureException(_error as Error, {
        tags: {
          operation: 'deployment_status_sync',
          deployment_id: deploymentId,
        },
        extra: { correlationId: finalCorrelationId },
      });

      // Record failed metrics
      const deployment = await this.prisma.deployment.findUnique({
        where: { id: deploymentId },
        select: { environment: true },
      });
      this.recordMetrics(deployment?.environment || 'unknown', false, finalCorrelationId);
    }
  }

  /**
   * Get ClickUp status name based on deployment status
   * AC#1: Environment-specific status mapping
   *
   * @param status - Deployment status
   * @param environment - Deployment environment
   * @returns ClickUp status name
   */
  private getClickUpStatusName(status: DeploymentStatus, environment: string): string {
    switch (status) {
      case 'COMPLETED':
        // Use environment-specific status if configured
        return this.config.get<string>('CLICKUP_STATUS_DEPLOYED', 'Deployed');

      case 'FAILED':
        return this.config.get<string>('CLICKUP_STATUS_DEPLOY_FAILED', 'Deployment Failed');

      case 'ROLLED_BACK':
        return this.config.get<string>('CLICKUP_STATUS_ROLLED_BACK', 'Rolled Back');

      default:
        this.logger.warn('Unknown deployment status, using default', { status, environment });
        return 'In Progress';
    }
  }

  /**
   * Build deployment comment with markdown formatting
   * AC#2: Structured comment templates
   *
   * @param deployment - Deployment record
   * @param githubPush - GitHub push record
   * @returns Markdown-formatted comment
   */
  private buildDeploymentComment(
    deployment: {
      status: DeploymentStatus;
      environment: string;
      deployed_at: Date | null;
      build_id: string | null;
      error_message: string | null;
    },
    githubPush: {
      commit_sha: string | null;
      pr_url: string | null;
      pr_number: number | null;
      repository: string;
    },
  ): string {
    const [owner, repo] = githubPush.repository.split('/');
    const commitShort = githubPush.commit_sha?.substring(0, 7) || 'unknown';
    const commitUrl = githubPush.commit_sha
      ? `https://github.com/${owner}/${repo}/commit/${githubPush.commit_sha}`
      : '';
    const buildUrl = deployment.build_id
      ? `https://github.com/${owner}/${repo}/actions/runs/${deployment.build_id}`
      : '';
    const timestamp = deployment.deployed_at?.toISOString() || new Date().toISOString();

    if (deployment.status === 'COMPLETED') {
      return this.buildSuccessComment(
        deployment.environment,
        timestamp,
        commitShort,
        commitUrl,
        buildUrl,
        githubPush,
      );
    }

    if (deployment.status === 'FAILED') {
      const sanitizedError = deployment.error_message
        ? this.sanitizeErrorMessage(deployment.error_message)
        : 'No error details available';

      return this.buildFailureComment(
        deployment.environment,
        timestamp,
        commitShort,
        commitUrl,
        buildUrl,
        sanitizedError,
      );
    }

    if (deployment.status === 'ROLLED_BACK') {
      return this.buildRollbackComment(deployment.environment, timestamp, buildUrl);
    }

    // Default generic comment
    return `**Deployment Status Update**\n\nEnvironment: ${deployment.environment}\nStatus: ${deployment.status}\nBuild: [View Logs](${buildUrl})`;
  }

  /**
   * Build success comment template
   */
  private buildSuccessComment(
    environment: string,
    timestamp: string,
    shortSha: string,
    commitUrl: string,
    buildUrl: string,
    githubPush: { pr_url: string | null; pr_number: number | null },
  ): string {
    const prLine = githubPush.pr_url
      ? `**PR:** [#${githubPush.pr_number}](${githubPush.pr_url})  \n`
      : '';

    return `🚀 **Deployment Successful**

**Environment:** ${environment}  
**Deployed At:** ${timestamp}  
**Commit SHA:** [${shortSha}](${commitUrl})  
**Build ID:** [View Build](${buildUrl})  
${prLine}**Deployment Logs:** [View Logs](${buildUrl})`;
  }

  /**
   * Build failure comment template
   */
  private buildFailureComment(
    environment: string,
    timestamp: string,
    shortSha: string,
    commitUrl: string,
    buildUrl: string,
    sanitizedError: string,
  ): string {
    return `❌ **Deployment Failed**

**Environment:** ${environment}  
**Failed At:** ${timestamp}  
**Commit SHA:** [${shortSha}](${commitUrl})  
**Build ID:** [View Build](${buildUrl})  
**Error:** ${sanitizedError}  
**Deployment Logs:** [View Logs](${buildUrl})

**Required Actions:**
- Review build logs for detailed error information
- Check CI/CD pipeline configuration
- Verify environment variables and secrets
- Contact TL if architecture changes needed`;
  }

  /**
   * Build rollback comment template
   */
  private buildRollbackComment(environment: string, timestamp: string, buildUrl: string): string {
    return `🔄 **Deployment Rolled Back**

**Environment:** ${environment}  
**Rolled Back At:** ${timestamp}  
**Reason:** Critical error detected in deployment  
**Failed Deployment:** [View Build](${buildUrl})

**Next Steps:**
- Fix identified issues in development
- Re-test before attempting redeployment`;
  }

  /**
   * Sanitize error message: redact secrets and truncate
   * AC#2: Secret redaction (simplified approach without private SecretsScannerService method)
   *
   * @param error - Raw error message
   * @returns Sanitized error message (max 500 chars)
   */
  private sanitizeErrorMessage(error: string): string {
    // Simple secret redaction: mask long alphanumeric strings (likely tokens/secrets)
    let sanitized = error.replace(/([a-zA-Z0-9_-]{20,})/g, (match) => {
      // Basic masking: show first 4 and last 4 chars
      if (match.length <= 8) return '****';
      return `${match.slice(0, 4)}***${match.slice(-4)}`;
    });

    // Truncate to 500 characters as per AC#2
    if (sanitized.length > 500) {
      sanitized = sanitized.substring(0, 500) + '... (truncated)';
    }

    return sanitized;
  }

  /**
   * Get correlation ID from deployment execution context
   *
   * @param deploymentId - Deployment ID
   * @returns Correlation ID or null
   */
  private async getDeploymentCorrelationId(deploymentId: string): Promise<string | null> {
    try {
      const deployment = await this.prisma.deployment.findUnique({
        where: { id: deploymentId },
        select: { github_push_id: true },
      });

      if (deployment?.github_push_id) {
        // Correlation ID typically stored in execution context
        // For now, return deployment ID as fallback
        return `deployment-${deploymentId}`;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Generate new correlation ID
   *
   * @returns UUID correlation ID
   */
  private generateCorrelationId(): string {
    return `sync-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Record Prometheus metrics
   * AC#4: Observability metrics
   *
   * @param environment - Deployment environment
   * @param success - Whether sync succeeded
   * @param errorType - Error type if failed
   * @param duration - Operation duration in seconds
   */
  private recordMetrics(
    environment: string,
    success: boolean,
    errorType?: string,
    duration?: number,
  ): void {
    const statusLabel = success ? 'success' : 'failed';

    // Use specific sync metrics (Story 4.6/4.8)
    this.metrics.incrementCounter('deployment_status_sync_total', {
      environment,
      status: statusLabel,
    });

    if (duration !== undefined) {
      this.metrics.recordHistogram('deployment_status_sync_duration_seconds', duration, {
        environment,
      });
    }

    // Record errors if failed
    if (!success && errorType) {
      this.metrics.incrementErrors(errorType, 1);
    }
  }

  /**
   * Record audit log entry
   * AC#4: Audit trail
   *
   * @param deploymentId - Deployment ID
   * @param ticketId - ClickUp ticket ID
   * @param status - Deployment status
   * @param environment - Deployment environment
   * @param success - Whether sync succeeded
   * @param correlationId - Correlation ID
   * @param clickUpStatus - ClickUp status name (optional)
   */
  private async recordAuditLog(
    deploymentId: string,
    ticketId: string,
    status: DeploymentStatus,
    environment: string,
    success: boolean,
    correlationId: string,
    clickUpStatus?: string,
  ): Promise<void> {
    try {
      await this.auditLog.log({
        entityType: 'deployment',
        entityId: deploymentId,
        action: 'deployment_status_sync',
        actorType: 'system',
        afterState: {
          ticketId,
          deploymentStatus: status,
          clickUpStatus,
          environment,
          success,
          correlationId,
        },
      });
    } catch (_error) {
      this.logger.error('Failed to create audit log', {
        deploymentId,
        error: (_error as Error).message,
      });
    }
  }
}
