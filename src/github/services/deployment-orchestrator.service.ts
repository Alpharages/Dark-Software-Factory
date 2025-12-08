import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeploymentStatus, Deployment, GitHubPush } from '@prisma/client';
import * as yaml from 'js-yaml';
import { PrismaService } from '../../database/prisma.service';
import { LoggerService } from '../../common/logger/logger.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { GitHubService } from '../github.service';
import {
  DeploymentConfig,
  GitHubWorkflow,
  GitHubRunStatus,
} from '../interfaces/deployment-config.interface';
import { TriggerDeploymentDto } from '../dto/trigger-deployment.dto';

interface PollingState {
  deploymentId: string;
  runId: number;
  attempts: number;
  nextInterval: number;
  timeoutHandle: NodeJS.Timeout;
}

@Injectable()
export class DeploymentOrchestrator implements OnModuleDestroy {
  private pollingStates = new Map<string, PollingState>();
  private readonly DEFAULT_WORKFLOW_ID: string;
  private readonly POLL_INTERVAL_MS: number;
  private readonly TIMEOUT_MS: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GitHubService,
    private readonly webhooks: WebhooksService,
    private readonly metrics: MetricsService,
    private readonly auditLog: AuditLogService,
    private readonly sentry: SentryService,
    private readonly logger: LoggerService,
    private readonly config: ConfigService,
  ) {
    this.DEFAULT_WORKFLOW_ID = this.config.get<string>('github.defaultWorkflowId', 'deploy.yml');
    this.POLL_INTERVAL_MS = this.config.get<number>('deployment.pollInterval', 30000); // 30s
    this.TIMEOUT_MS = this.config.get<number>('deployment.timeout', 1800000); // 30min
  }

  onModuleDestroy() {
    // Clean up all active polling intervals
    this.pollingStates.forEach((state) => {
      clearTimeout(state.timeoutHandle);
    });
    this.pollingStates.clear();
    this.logger.log('Cleaned up all polling states', 'DeploymentOrchestrator');
  }

  /**
   * AC#1: Trigger deployment after PR creation
   */
  async triggerDeployment(dto: TriggerDeploymentDto): Promise<string | null> {
    this.logger.log('Triggering deployment', {
      githubPushId: dto.githubPushId,
      repository: dto.repository,
      environment: dto.environment,
    });

    try {
      // Validate PR metadata exists (AC#1)
      const githubPush = await this.prisma.gitHubPush.findUnique({
        where: { id: dto.githubPushId },
      });

      if (!githubPush) {
        throw new Error(`GitHub push ${dto.githubPushId} not found`);
      }

      if (!githubPush.pr_number || !githubPush.pr_url) {
        this.logger.warn('PR metadata missing, skipping deployment', {
          githubPushId: dto.githubPushId,
        });
        return null;
      }

      // Detect CI/CD provider (AC#1)
      const config = await this.detectProvider(dto.repository, dto.workflowId);

      // Trigger GitHub Actions workflow (AC#1)
      const runId = await this.triggerGitHubActions(
        dto.repository,
        dto.branchName,
        dto.commitSha,
        dto.environment,
        config.workflowId || this.DEFAULT_WORKFLOW_ID,
        {
          executionId: dto.executionId,
          ticketId: dto.ticketId,
        },
      );

      // Create deployment record (AC#2)
      const deployment = await this.createDeploymentRecord({
        githubPushId: dto.githubPushId,
        environment: dto.environment,
        cicdProvider: config.cicdProvider,
        buildId: runId.toString(),
        workflowId: config.workflowId || this.DEFAULT_WORKFLOW_ID,
      });

      // Start polling for status updates (AC#3)
      this.startPolling(deployment.id, runId, dto.repository);

      this.logger.log('Deployment triggered successfully', {
        deploymentId: deployment.id,
        runId,
        environment: dto.environment,
      });

      return deployment.id;
    } catch (error) {
      const err = error as Error;
      this.logger.error('Failed to trigger deployment', err.stack || err.message, {
        githubPushId: dto.githubPushId,
        repository: dto.repository,
      });

      this.sentry.captureException(err, {
        tags: {
          operation: 'trigger_deployment',
          repository: dto.repository,
          environment: dto.environment,
        },
        extra: {
          githubPushId: dto.githubPushId,
          branchName: dto.branchName,
        },
      });

      throw error;
    }
  }

  /**
   * AC#1: Detect CI/CD provider from repository configuration
   */
  private async detectProvider(
    repository: string,
    workflowIdOverride?: string,
  ): Promise<DeploymentConfig> {
    try {
      // Primary: GitHub Actions
      const workflows = await this.discoverGitHubWorkflows(repository);

      if (workflows.length > 0) {
        // Use override or first workflow with workflow_dispatch
        const workflowId =
          workflowIdOverride ||
          workflows.find((w) => w.hasWorkflowDispatch)?.name ||
          workflows[0].name;

        return {
          environment: 'dev',
          cicdProvider: 'github-actions',
          workflowId,
        };
      }

      // Fallback: Generic webhook (configured per repository)
      this.logger.warn('No GitHub Actions workflows found, using default', {
        repository,
        defaultWorkflowId: this.DEFAULT_WORKFLOW_ID,
      });

      return {
        environment: 'dev',
        cicdProvider: 'github-actions',
        workflowId: this.DEFAULT_WORKFLOW_ID,
      };
    } catch (error) {
      const err = error as Error;
      this.logger.warn('Provider detection failed, using default', {
        repository,
        error: err.message,
      });

      return {
        environment: 'dev',
        cicdProvider: 'github-actions',
        workflowId: this.DEFAULT_WORKFLOW_ID,
      };
    }
  }

  /**
   * AC#1: Discover GitHub Actions workflows using Contents API
   */
  private async discoverGitHubWorkflows(repository: string): Promise<GitHubWorkflow[]> {
    const [owner, repo] = repository.split('/');

    try {
      // Get workflow files from .github/workflows directory
      const octokit = await this.github.getAuthenticatedClient();
      const { data: contents } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: '.github/workflows',
      });

      if (!Array.isArray(contents)) {
        return [];
      }

      // Parse each workflow file to check for workflow_dispatch trigger
      const workflows: GitHubWorkflow[] = [];

      for (const file of contents) {
        if (file.type === 'file' && (file.name.endsWith('.yml') || file.name.endsWith('.yaml'))) {
          try {
            // Get file content
            const { data: fileData } = await octokit.rest.repos.getContent({
              owner,
              repo,
              path: file.path,
            });

            if ('content' in fileData) {
              const content = Buffer.from(fileData.content, 'base64').toString('utf-8');
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const workflowYaml = yaml.load(content) as any;

              workflows.push({
                id: 0, // Not available from Contents API
                name: file.name,
                path: file.path,
                state: 'active',
                hasWorkflowDispatch: workflowYaml?.on?.workflow_dispatch !== undefined,
              });
            }
          } catch (parseError) {
            const err = parseError as Error;
            this.logger.warn('Failed to parse workflow file', {
              file: file.name,
              error: err.message,
            });
          }
        }
      }

      return workflows;
    } catch (error) {
      const err = error as Error;
      this.logger.warn('Failed to discover workflows', {
        repository,
        error: err.message,
      });
      return [];
    }
  }

  /**
   * AC#1: Trigger GitHub Actions workflow via Workflow Dispatch API
   */
  private async triggerGitHubActions(
    repository: string,
    branchName: string,
    commitSha: string,
    environment: string,
    workflowId: string,
    context?: { executionId?: string; ticketId?: string },
  ): Promise<number> {
    const [owner, repo] = repository.split('/');
    const octokit = await this.github.getAuthenticatedClient();

    try {
      // Trigger workflow dispatch
      await octokit.rest.actions.createWorkflowDispatch({
        owner,
        repo,
        workflow_id: workflowId,
        ref: branchName,
        inputs: {
          environment,
          commit_sha: commitSha,
          ticket_id: context?.ticketId || '',
          execution_id: context?.executionId || '',
        },
      });

      // Get the latest workflow run for this branch
      const { data: runs } = await octokit.rest.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: workflowId,
        branch: branchName,
        per_page: 1,
      });

      if (runs.workflow_runs.length === 0) {
        throw new Error('Workflow triggered but run not found');
      }

      const runId = runs.workflow_runs[0].id;

      this.logger.log('GitHub Actions workflow triggered', {
        repository,
        workflowId,
        runId,
        branchName,
      });

      return runId;
    } catch (error) {
      const err = error as Error;
      this.logger.error('Failed to trigger GitHub Actions', err.stack || err.message, {
        repository,
        workflowId,
        branchName,
      });

      // Record CI/CD API call metric
      this.metrics.recordCICDPipeline('github-actions', 'error');

      throw error;
    }
  }

  /**
   * AC#2: Create deployment record in database
   */
  private async createDeploymentRecord(data: {
    githubPushId: string;
    environment: string;
    cicdProvider: string;
    buildId: string;
    workflowId: string;
  }): Promise<{ id: string; created_at: Date }> {
    const deployment = await this.prisma.deployment.create({
      data: {
        github_push_id: data.githubPushId,
        environment: data.environment,
        cicd_provider: data.cicdProvider,
        build_id: data.buildId,
        workflow_id: data.workflowId,
        status: DeploymentStatus.TRIGGERED,
      },
    });

    // Audit log (AC#6)
    await this.auditLog.log({
      entityType: 'deployment',
      entityId: deployment.id,
      action: 'created',
      actorType: 'system',
      afterState: {
        status: DeploymentStatus.TRIGGERED,
        environment: data.environment,
        cicdProvider: data.cicdProvider,
      },
    });

    return deployment;
  }

  /**
   * AC#3: Start polling for deployment status
   */
  private startPolling(deploymentId: string, runId: number, repository: string): void {
    const initialInterval = this.POLL_INTERVAL_MS;
    const startTime = Date.now();

    const poll = async (attempts: number, interval: number) => {
      try {
        // Check timeout (AC#5)
        if (Date.now() - startTime > this.TIMEOUT_MS) {
          await this.handleTimeout(deploymentId, repository);
          return;
        }

        // Poll status (AC#3)
        const status = await this.pollDeploymentStatus(repository, runId);

        // Update deployment (AC#3)
        await this.updateDeploymentStatus(deploymentId, status, repository);

        // Check if terminal status reached
        if (this.isTerminalStatus(status.conclusion)) {
          this.pollingStates.delete(deploymentId);
          return;
        }

        // Schedule next poll with exponential backoff
        const nextInterval = this.calculateBackoff(interval, attempts);
        const timeoutHandle = setTimeout(() => poll(attempts + 1, nextInterval), nextInterval);

        this.pollingStates.set(deploymentId, {
          deploymentId,
          runId,
          attempts: attempts + 1,
          nextInterval,
          timeoutHandle,
        });
      } catch (error) {
        const err = error as Error;
        this.logger.error('Polling error', err.stack || err.message, {
          deploymentId,
          runId,
          attempts,
        });

        // Retry on transient errors (AC#5)
        if (attempts < 3) {
          const nextInterval = this.calculateBackoff(interval, attempts);
          const timeoutHandle = setTimeout(() => poll(attempts + 1, nextInterval), nextInterval);

          this.pollingStates.set(deploymentId, {
            deploymentId,
            runId,
            attempts: attempts + 1,
            nextInterval,
            timeoutHandle,
          });
        } else {
          await this.handlePollingFailure(deploymentId, err, repository);
        }
      }
    };

    // Start initial poll
    const timeoutHandle = setTimeout(() => poll(0, initialInterval), initialInterval);

    this.pollingStates.set(deploymentId, {
      deploymentId,
      runId,
      attempts: 0,
      nextInterval: initialInterval,
      timeoutHandle,
    });
  }

  /**
   * AC#3: Poll GitHub Actions workflow run status
   */
  private async pollDeploymentStatus(repository: string, runId: number): Promise<GitHubRunStatus> {
    const [owner, repo] = repository.split('/');
    const octokit = await this.github.getAuthenticatedClient();

    try {
      // Check rate limit (AC#5)
      const { data: rateLimit } = await octokit.rest.rateLimit.get();
      if (rateLimit.rate.remaining < 100) {
        this.logger.warn('GitHub rate limit low', {
          remaining: rateLimit.rate.remaining,
          reset: new Date(rateLimit.rate.reset * 1000),
        });
      }

      // Get workflow run status
      const { data: run } = await octokit.rest.actions.getWorkflowRun({
        owner,
        repo,
        run_id: runId,
      });

      // Record CI/CD API call metric
      this.metrics.recordCICDPipeline('github-actions', 'success');

      return {
        id: run.id,
        status: run.status as 'queued' | 'in_progress' | 'completed',
        conclusion: run.conclusion as 'success' | 'failure' | 'cancelled' | 'skipped' | null,
        created_at: run.created_at,
        updated_at: run.updated_at,
      };
    } catch (error) {
      this.metrics.recordCICDPipeline('github-actions', 'error');
      throw error;
    }
  }

  /**
   * AC#3: Update deployment status based on GitHub run status
   */
  private async updateDeploymentStatus(
    deploymentId: string,
    runStatus: GitHubRunStatus,
    repository: string,
  ): Promise<void> {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { github_push: true },
    });

    if (!deployment) {
      this.logger.warn('Deployment not found for status update', { deploymentId });
      return;
    }

    const previousStatus = deployment.status;
    const newStatus = this.mapGitHubStatusToDeployment(runStatus);

    if (previousStatus === newStatus) {
      return; // No change
    }

    // Update deployment record
    const updatedDeployment = await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: newStatus,
        deployed_at: newStatus === DeploymentStatus.COMPLETED ? new Date() : undefined,
        error_message:
          newStatus === DeploymentStatus.FAILED && runStatus.conclusion === 'failure'
            ? 'Deployment failed in CI/CD pipeline'
            : undefined,
      },
    });

    // Audit log (AC#6)
    await this.auditLog.log({
      entityType: 'deployment',
      entityId: deploymentId,
      action: 'status_changed',
      actorType: 'system',
      beforeState: { status: previousStatus },
      afterState: { status: newStatus },
    });

    // Record metrics (AC#6)
    if (this.isTerminalStatus(runStatus.conclusion)) {
      const duration = deployment.created_at
        ? (new Date().getTime() - new Date(deployment.created_at).getTime()) / 1000
        : 0;

      // Map deployment status to metric status
      const metricStatus =
        newStatus === DeploymentStatus.COMPLETED
          ? 'success'
          : newStatus === DeploymentStatus.FAILED
            ? 'failed'
            : 'rolled_back';

      this.metrics.recordDeployment({
        environment: deployment.environment,
        status: metricStatus,
        duration,
      });

      // Update ClickUp (AC#4)
      await this.syncToClickUp(updatedDeployment, deployment.github_push, repository);
    }

    this.logger.log('Deployment status updated', {
      deploymentId,
      previousStatus,
      newStatus,
      runStatus: runStatus.status,
      conclusion: runStatus.conclusion,
    });
  }

  /**
   * AC#3: Map GitHub workflow status to Deployment status
   */
  private mapGitHubStatusToDeployment(runStatus: GitHubRunStatus): DeploymentStatus {
    if (runStatus.status === 'queued') {
      return DeploymentStatus.TRIGGERED;
    }

    if (runStatus.status === 'in_progress') {
      return DeploymentStatus.IN_PROGRESS;
    }

    if (runStatus.status === 'completed') {
      if (runStatus.conclusion === 'success') {
        return DeploymentStatus.COMPLETED;
      }
      if (runStatus.conclusion === 'failure' || runStatus.conclusion === 'cancelled') {
        return DeploymentStatus.FAILED;
      }
    }

    return DeploymentStatus.IN_PROGRESS; // Default for unknown states
  }

  /**
   * Determine if status is terminal (stop polling)
   */
  private isTerminalStatus(conclusion: string | null): boolean {
    return conclusion !== null;
  }

  /**
   * AC#3: Calculate exponential backoff (30s → 60s → 90s, max 120s)
   */
  private calculateBackoff(currentInterval: number, attempts: number): number {
    const base = this.POLL_INTERVAL_MS;
    const backoff = Math.min(base * (attempts + 1), 120000); // Max 2 minutes
    return backoff;
  }

  /**
   * AC#4: Sync deployment status to ClickUp
   *
   * TODO: ClickUp integration deferred - WebhooksService doesn't have updateTaskStatus/addTaskComment yet
   * This needs to be implemented in a future story or as part of Story 4.6
   */
  private async syncToClickUp(
    deployment: Deployment,
    githubPush: GitHubPush,
    repository: string,
  ): Promise<void> {
    try {
      // Get ticket ID from execution
      const execution = await this.prisma.execution.findFirst({
        where: { id: githubPush.execution_id },
        include: { ticket: true },
      });

      if (!execution?.ticket) {
        this.logger.warn('Cannot sync to ClickUp: ticket not found', {
          deploymentId: deployment.id,
          executionId: githubPush.execution_id,
        });
        return;
      }

      const ticketId = execution.ticket.clickup_task_id;
      const [owner, repo] = repository.split('/');

      // Prepare comment content
      const comment = this.buildClickUpComment(deployment, githubPush, owner, repo);

      // Update ticket status (DEFERRED: WebhooksService doesn't have these methods yet)
      // const statusName = this.getClickUpStatus(deployment.status, deployment.environment);
      // await this.webhooks.updateTaskStatus(ticketId, statusName);
      // await this.webhooks.addTaskComment(ticketId, comment);

      this.logger.log('ClickUp sync deferred - manually update ticket', {
        deploymentId: deployment.id,
        ticketId,
        comment: comment.substring(0, 100),
      });
    } catch (error) {
      const err = error as Error;
      // Graceful degradation (AC#5)
      this.logger.error('Failed to sync to ClickUp', err.stack || err.message, {
        deploymentId: deployment.id,
      });

      this.sentry.captureException(err, {
        tags: {
          operation: 'clickup_sync',
          deployment_id: deployment.id,
        },
      });
    }
  }

  /**
   * AC#4: Build ClickUp comment with deployment details
   */
  private buildClickUpComment(
    deployment: Deployment,
    githubPush: GitHubPush,
    owner: string,
    repo: string,
  ): string {
    const commitUrl = `https://github.com/${owner}/${repo}/commit/${githubPush.commit_sha}`;
    const buildUrl = `https://github.com/${owner}/${repo}/actions/runs/${deployment.build_id}`;

    if (deployment.status === DeploymentStatus.COMPLETED) {
      return `✅ **Deployment Successful** (${deployment.environment})

📦 **Environment:** ${deployment.environment}
🚀 **Deployed at:** ${deployment.deployed_at ? new Date(deployment.deployed_at).toISOString() : 'N/A'}
📝 **Commit:** [${githubPush.commit_sha?.substring(0, 7)}](${commitUrl})
🔗 **PR:** [#${githubPush.pr_number}](${githubPush.pr_url})
📊 **Build:** [View logs](${buildUrl})`;
    } else if (deployment.status === DeploymentStatus.FAILED) {
      return `❌ **Deployment Failed** (${deployment.environment})

📦 **Environment:** ${deployment.environment}
⚠️ **Error:** ${deployment.error_message || 'Pipeline failed'}
📝 **Commit:** [${githubPush.commit_sha?.substring(0, 7)}](${commitUrl})
🔗 **PR:** [#${githubPush.pr_number}](${githubPush.pr_url})
📊 **Build logs:** [View details](${buildUrl})

**Required Actions:**
- Review build logs for error details
- Fix issues and push new commit
- Deployment will auto-retry on new push`;
    } else if (deployment.status === DeploymentStatus.ROLLED_BACK) {
      return `🔄 **Deployment Rolled Back** (${deployment.environment})

📦 **Environment:** ${deployment.environment}
⚠️ **Reason:** ${deployment.error_message || 'Rollback triggered'}
📊 **Build logs:** [View details](${buildUrl})`;
    }

    return '';
  }

  /**
   * AC#4: Get ClickUp status name based on deployment status
   */
  private getClickUpStatus(status: DeploymentStatus, _environment: string): string {
    if (status === DeploymentStatus.COMPLETED) {
      return this.config.get<string>('clickup.statusDeployed', 'Deployed');
    } else if (status === DeploymentStatus.FAILED) {
      return this.config.get<string>('clickup.statusDeployFailed', 'Deployment Failed');
    } else if (status === DeploymentStatus.ROLLED_BACK) {
      return this.config.get<string>('clickup.statusRolledBack', 'Rolled Back');
    }
    return 'In Progress';
  }

  /**
   * AC#5: Handle deployment timeout (30 minutes)
   */
  private async handleTimeout(deploymentId: string, _repository: string): Promise<void> {
    this.logger.warn('Deployment timeout reached', { deploymentId });

    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: DeploymentStatus.FAILED,
        error_message: 'Deployment timed out after 30 minutes',
      },
    });

    this.sentry.captureMessage('Deployment timeout');

    this.pollingStates.delete(deploymentId);
  }

  /**
   * AC#5: Handle polling failure after retries
   */
  private async handlePollingFailure(
    deploymentId: string,
    error: Error,
    repository: string,
  ): Promise<void> {
    this.logger.error('Polling failed after retries', error.stack || error.message, {
      deploymentId,
    });

    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: DeploymentStatus.FAILED,
        error_message: `Status polling failed: ${error.message}`,
      },
    });

    this.sentry.captureException(error, {
      tags: {
        operation: 'deployment_polling',
        deployment_id: deploymentId,
        repository,
      },
    });

    this.pollingStates.delete(deploymentId);
  }
}
