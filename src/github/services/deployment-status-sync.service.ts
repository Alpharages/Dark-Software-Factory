import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DeploymentStatus } from '@/prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { ClickUpService } from '@/clickup/clickup.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { AuditLogService } from '@/common/audit/audit-log.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { ProjectIntegrationService } from '@/integrations/project-integration.service';
import { PMFieldPreCheckService } from '@/integrations/pm-field-pre-check.service';
import {
  PMFieldAutoFillService,
  ExecutionContext,
  InferenceContext,
  FactualFillResult,
  InferredFillResult,
} from '@/integrations/pm-field-auto-fill.service';
import { PMVerificationCommentService } from '@/integrations/pm-verification-comment.service';
import { PMActionableFailureCommentService } from '@/integrations/pm-actionable-failure-comment.service';
import { RealtimeService } from '@/realtime/realtime.service';
import { ProjectIntegration } from '@/prisma/client';
import { NormalizedField } from '@/integrations/providers/dto/normalized-field.dto';
import { PMProviderClientError } from '@/integrations/providers/pm-provider-client.error';

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
export class DeploymentStatusSyncService {
  private readonly logger = new Logger(DeploymentStatusSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly clickUp: ClickUpService,
    private readonly metrics: MetricsService,
    private readonly auditLog: AuditLogService,
    private readonly sentry: SentryService,
    private readonly integrationService: ProjectIntegrationService,
    private readonly pmPreCheckService: PMFieldPreCheckService,
    private readonly pmAutoFillService: PMFieldAutoFillService,
    private readonly pmVerificationCommentService: PMVerificationCommentService,
    private readonly pmFailureCommentService: PMActionableFailureCommentService,
    private readonly realtimeService: RealtimeService,
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
    let ticketInternalId: string | undefined;
    let ticketClickupId: string | undefined;

    // CS3-3: Scoped variables for actionable failure comments (AC6)
    let integration: ProjectIntegration | null = null;
    let targetStatus: string | undefined;
    let lastMissingFields: NormalizedField[] = [];
    let ticketProjectId: string | undefined;

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
              branch_name: true,
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
          branch_name: string | null;
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

      ticketInternalId = execution.ticket.id;
      ticketClickupId = execution.ticket.clickup_task_id;
      ticketProjectId = execution.ticket.project_id;

      const ticketId = execution.ticket.clickup_task_id;

      // CS2-2: Pre-check + factual auto-fill pipeline
      try {
        // Populate scoped integration (AC6)
        integration = await this.integrationService.findFirstByProject(execution.ticket.project_id);
        if (integration) {
          const cfg = integration.provider_config as Record<string, unknown> | null;
          const containerId = typeof cfg?.containerId === 'string' ? cfg.containerId : '';

          const preCheckResult = await this.pmPreCheckService.checkRequiredFields(
            integration,
            ticketId,
            containerId,
            finalCorrelationId,
          );

          // Populate scoped missing fields (AC6)
          lastMissingFields = preCheckResult.missingFields;

          if (!preCheckResult.allFilled && preCheckResult.missingFields.length > 0) {
            const execWithTiming = execution as typeof execution & {
              started_at: Date | null;
              completed_at: Date | null;
            };

            const durationMs =
              execWithTiming?.started_at && execWithTiming?.completed_at
                ? execWithTiming.completed_at.getTime() - execWithTiming.started_at.getTime()
                : undefined;

            const ctx: ExecutionContext = {
              executionDurationMinutes:
                durationMs !== undefined && isFinite(durationMs) ? durationMs / 60000 : undefined,
              deployedAt: typedDeployment.deployed_at,
              prUrl: typedDeployment.github_push.pr_url,
              branchName: typedDeployment.github_push.branch_name,
            };

            const factualResult: FactualFillResult = await this.pmAutoFillService.fillFactualFields(
              integration,
              ticketId,
              preCheckResult.missingFields,
              ctx,
              finalCorrelationId,
            );

            // CS2-3: AI-Inferred Field Fill (AC#4)
            let inferredResult: InferredFillResult | undefined;
            if (factualResult.remainingFields.length > 0) {
              const execData = execution as unknown as {
                ticket: { title: string; description: string };
                retry_count?: number;
                files_changed?: string[] | number | Record<string, unknown>;
              };

              const rawFilesChanged = execData.files_changed;
              const filesChangedCount = Array.isArray(rawFilesChanged)
                ? rawFilesChanged.length
                : typeof rawFilesChanged === 'number'
                  ? rawFilesChanged
                  : undefined;

              const inferenceCtx: InferenceContext = {
                ticketTitle: execData.ticket.title,
                ticketDescription: execData.ticket.description,
                executionDurationMinutes: ctx.executionDurationMinutes,
                retryCount: execData.retry_count ?? 0,
                filesChangedCount,
              };

              try {
                inferredResult = await this.pmAutoFillService.fillInferredFields(
                  integration,
                  ticketId,
                  factualResult.remainingFields,
                  inferenceCtx,
                  finalCorrelationId,
                );
              } catch (error) {
                const err = error as Error;
                this.logger.warn(
                  `[${finalCorrelationId}] AI inferred fill failed (fail-open): ${err.message}`,
                  { deploymentId, taskId: ticketId },
                );
                this.sentry.captureException(err, {
                  tags: { deploymentId, taskId: ticketId, operation: 'ai-inferred-fill' },
                  extra: { correlationId: finalCorrelationId },
                });
              }
            }

            // CS2-4: Post-Fill Verification Comment
            try {
              await this.pmVerificationCommentService.postVerificationComment(
                integration,
                ticketId,
                factualResult.filledFields,
                inferredResult?.filledFields ?? [],
                inferredResult?.manualFields ?? factualResult.remainingFields,
                finalCorrelationId,
              );
            } catch (_err) {
              this.logger.warn(
                `[${finalCorrelationId}] CS2-4: unexpected error in verification comment block — continuing`,
              );
            }
          }
        }
      } catch (pipelineError) {
        // Fail-open: pipeline failure must never block status push
        this.logger.warn(
          `[${finalCorrelationId}] CS2-2: pre-check/auto-fill pipeline failed (failing open): ${
            (pipelineError as Error).message
          }`,
        );
        this.sentry.captureException(pipelineError as Error);
      }

      // CS2: These literals will be replaced by provider-agnostic IPMProvider status push
      const clickUpStatus =
        typedDeployment.status === 'COMPLETED'
          ? 'Deployed'
          : typedDeployment.status === 'FAILED'
            ? 'Deployment Failed'
            : typedDeployment.status === 'ROLLED_BACK'
              ? 'Rolled Back'
              : 'In Progress';

      // Populate scoped target status (AC6)
      targetStatus = clickUpStatus;

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

        // CS3-2: Track sync failure
        try {
          await this.prisma.ticket.update({
            where: { id: ticketInternalId! },
            data: { pm_synced: false },
          });
        } catch (_err) {
          const errMsg = _err instanceof Error ? _err.message : String(_err);
          this.logger.warn(
            `[${finalCorrelationId}] CS3-2: failed to set pm_synced=false on ticket ${ticketInternalId}: ${errMsg}`,
          );
        }

        await this.recordPmSyncFailedAuditLog(
          ticketInternalId!,
          ticketClickupId ?? null,
          'STATUS_UPDATE_RETURNED_FALSE',
          finalCorrelationId,
        );

        // CS3-3: Post actionable failure comment on soft failure (AC3)
        try {
          await this.pmFailureCommentService.postActionableFailureComment(
            integration,
            ticketId,
            {
              targetStatus: targetStatus ?? 'unknown',
              failureReason: 'ClickUp status update returned false — graceful degradation',
              missingFields: lastMissingFields,
            },
            finalCorrelationId,
          );
        } catch (_err) {
          const errMsg = _err instanceof Error ? _err.message : String(_err);
          this.logger.warn(
            `[${finalCorrelationId}] CS3-3: actionable failure comment failed (soft failure): ${errMsg}`,
          );
        }

        // CS3-4: Emit pm-sync-failed Socket.IO event (best-effort)
        try {
          if (ticketProjectId) {
            this.realtimeService.emitToRole('PM', 'pm-sync-failed', {
              ticketId: ticketClickupId,
              projectId: ticketProjectId,
              provider: 'CLICKUP',
              reason: 'ClickUp status update returned false — graceful degradation',
              missingFields: lastMissingFields,
            });
          }
        } catch (_socketErr) {
          this.logger.warn(
            `[${finalCorrelationId}] CS3-4: unexpected error emitting pm-sync-failed event (soft failure path)`,
          );
        }

        return;
      }

      // CS3-2: Track sync success
      try {
        await this.prisma.ticket.update({
          where: { id: ticketInternalId! },
          data: { pm_synced: true },
        });
      } catch (_pmSyncUpdateErr) {
        const errMsg =
          _pmSyncUpdateErr instanceof Error ? _pmSyncUpdateErr.message : String(_pmSyncUpdateErr);
        this.logger.warn(
          `[${finalCorrelationId}] CS3-2: failed to set pm_synced=true on ticket ${ticketInternalId}: ${errMsg}`,
        );
      }

      // AC#2: Add formatted comment (best-effort — must NOT affect pm_synced state)
      const comment =
        typedDeployment.github_push.commit_sha && typedDeployment.github_push.repository
          ? this.buildDeploymentComment(typedDeployment, typedDeployment.github_push)
          : `**Deployment ${typedDeployment.status}**\n\nEnvironment: ${typedDeployment.environment}\nNo commit SHA available`;

      try {
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
      } catch (_commentErr) {
        // Comment is best-effort: do NOT let this reach the outer catch and corrupt pm_synced
        this.logger.warn(
          `[${finalCorrelationId}] addComment threw unexpectedly (status push already confirmed): ${(_commentErr as Error).message}`,
          { deploymentId, ticketId },
        );
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

      // CS3-2: Track sync failure in exception path
      if (ticketInternalId) {
        try {
          await this.prisma.ticket.update({
            where: { id: ticketInternalId },
            data: { pm_synced: false },
          });

          await this.recordPmSyncFailedAuditLog(
            ticketInternalId,
            ticketClickupId ?? null,
            _error instanceof Error ? _error.name : 'UNKNOWN_EXCEPTION',
            finalCorrelationId,
          );
        } catch (_pmSyncErr) {
          this.logger.warn(
            `[${finalCorrelationId}] CS3-2: failed to record sync failure in exception path`,
          );
        }
      }

      // CS3-3: Post actionable failure comment on hard failure (AC4)
      if (ticketClickupId && integration) {
        try {
          const isProviderError = _error instanceof PMProviderClientError;
          await this.pmFailureCommentService.postActionableFailureComment(
            integration,
            ticketClickupId,
            {
              targetStatus: targetStatus ?? 'unknown',
              failureReason: _error instanceof Error ? _error.message : 'Unknown exception',
              providerErrorCode: isProviderError ? _error.providerErrorCode : undefined,
              providerErrorBody: isProviderError ? _error.providerErrorBody : undefined,
              missingFields: [], // AC4: no pre-check context in exception path
            },
            finalCorrelationId,
          );
        } catch (_err) {
          const errMsg = _err instanceof Error ? _err.message : String(_err);
          this.logger.warn(
            `[${finalCorrelationId}] CS3-3: actionable failure comment failed (hard failure): ${errMsg}`,
          );
        }
      }

      // CS3-4: Emit pm-sync-failed Socket.IO event (best-effort, exception path)
      try {
        if (ticketProjectId) {
          this.realtimeService.emitToRole('PM', 'pm-sync-failed', {
            ticketId: ticketClickupId,
            projectId: ticketProjectId,
            provider: 'CLICKUP',
            reason: _error instanceof Error ? _error.message : 'Unknown exception',
            missingFields: [],
          });
        }
      } catch (_socketErr) {
        this.logger.warn(
          `[${finalCorrelationId}] CS3-4: unexpected error emitting pm-sync-failed event (exception path)`,
        );
      }
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

  /**
   * Record PM sync failure audit log
   * AC#3/4: Audit trail for sync failures
   */
  private async recordPmSyncFailedAuditLog(
    ticketInternalId: string,
    ticketClickupId: string | null,
    errorCode: string,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.auditLog.log({
        entityType: 'ticket',
        entityId: ticketInternalId,
        action: 'pm_sync_failed',
        actorType: 'system',
        afterState: {
          provider: 'CLICKUP',
          errorCode,
          correlationId,
          ticketClickupId,
        },
      });
    } catch (_err) {
      this.logger.warn(`[${correlationId}] CS3-2: audit log for pm_sync_failed failed silently`);
    }
  }
}
