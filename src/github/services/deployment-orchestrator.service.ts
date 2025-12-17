import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeploymentStatus } from '@/prisma/client';
import * as yaml from 'js-yaml';
import { PrismaService } from '../../database/prisma.service';
import { LoggerService } from '../../common/logger/logger.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { WebhooksService } from '../../webhooks/webhooks.service';
import { GitHubService } from '../github.service';
import { DeploymentStatusSync } from './deployment-status-sync.service';
import { GitHubErrorMonitor } from './github-error-monitor.service';
import { DeploymentSuccessRateCalculator } from './deployment-success-rate-calculator.service';
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
  environment: string;
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
    private readonly deploymentStatusSync: DeploymentStatusSync,
    private readonly errorMonitor: GitHubErrorMonitor,
    private readonly successRateCalculator: DeploymentSuccessRateCalculator,
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

      // Story 4.8 Metric: Increment in-progress gauge
      this.metrics.incrementGauge('deployment_in_progress', 1, {
        environment: dto.environment,
      });

      // Start polling for status updates (AC#3)
      this.startPolling(deployment.id, runId, dto.repository, dto.environment);

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

      await this.errorMonitor.handleGitHubError({
        operation: 'deployment',
        executionId: dto.executionId || '',
        ticketId: dto.ticketId || '',
        repository: dto.repository || '',
        branchName: dto.branchName || '',
        error: err,
        environment: dto.environment || '',
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any, // Cast to any to resolve generated type mismatch
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
   * AC#3: Start polling for status updates
   */
  private startPolling(
    deploymentId: string,
    runId: number,
    repository: string,
    environment: string,
  ): void {
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
        const pollStart = Date.now();
        const status = await this.pollDeploymentStatus(repository, runId);
        const pollDuration = (Date.now() - pollStart) / 1000;

        // AC#2: Record polling duration metric
        this.metrics.recordHistogram('cicd_workflow_poll_duration_seconds', pollDuration, {
          environment,
        });

        // Update deployment (AC#3)
        await this.updateDeploymentStatus(deploymentId, status, repository);

        // Check if terminal status reached
        if (this.isTerminalStatus(status.conclusion)) {
          // Decrement in-progress gauge on failure
          const deployment = await this.prisma.deployment.findUnique({
            where: { id: deploymentId },
          });
          if (deployment) {
            this.metrics.decrementGauge('deployment_in_progress', 1, {
              environment: deployment.environment,
            });
            await this.successRateCalculator.update(
              deployment.environment,
              DeploymentStatus.FAILED,
            );
          }

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
          environment,
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
            environment,
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
      environment,
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
      include: {
        github_push: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    if (!deployment) {
      this.logger.warn('Deployment not found for status update', { deploymentId });
      return;
    }

    const previousStatus = deployment.status;
    const newStatus = this.mapGitHubStatusToDeployment(runStatus);

    if (previousStatus === newStatus) {
      return; // No change
    }

    // Handle FAILURE with ErrorMonitor
    if ((newStatus as DeploymentStatus) === DeploymentStatus.FAILED) {
      // Load execution details to get tickets
      const ghPush = await this.prisma.gitHubPush.findUnique({
        where: { id: deployment.github_push_id },
      });
      const execution = await this.prisma.execution.findUnique({
        where: { id: ghPush?.execution_id || '' },
        include: { ticket: true },
      });

      await this.errorMonitor.handleDeploymentFailure({
        deploymentId,
        status: 'FAILED',
        environment: deployment.environment,
        ticketId: execution?.ticket?.clickup_task_id || 'unknown',
        repository,
        branchName: ghPush?.branch_name || 'unknown',
        errorMessage: 'Deployment failed in CI/CD pipeline',
        buildId: deployment.build_id || undefined,
        cicdBuildUrl: undefined,
        correlationId: execution?.id,
      });
      return;
    }

    // Update deployment record
    await this.prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        status: newStatus,
        deployed_at: newStatus === DeploymentStatus.COMPLETED ? new Date() : undefined,
        error_message: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any, // Cast to any for error_message metadata
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
      // Story 4.8 Metric: Decrement in-progress gauge
      this.metrics.decrementGauge('deployment_in_progress', 1, {
        environment: deployment.environment,
      });

      // Update success rate
      await this.successRateCalculator.update(deployment.environment, newStatus);

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

      // Update ClickUp (AC#4) - Story 4.6 integration
      // Fire-and-forget: Do NOT await, do NOT block deployment updates
      this.deploymentStatusSync.syncToClickUp(deploymentId).catch((error) => {
        // Logged to Sentry within syncToClickUp, just prevent unhandled rejection
        this.logger.error('ClickUp sync failed (non-blocking)', error.message, { deploymentId });
      });
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
   * AC#5: Handle deployment timeout (30 minutes)
   */
  private async handleTimeout(deploymentId: string, repository: string): Promise<void> {
    this.logger.warn('Deployment timeout reached', { deploymentId });

    // Delegate to error monitor
    const deployment = await this.prisma.deployment.findUnique({ where: { id: deploymentId } });
    const ghPush = await this.prisma.gitHubPush.findUnique({
      where: { id: deployment?.github_push_id || '' },
    });
    const execution = await this.prisma.execution.findUnique({
      where: { id: ghPush?.execution_id || '' },
      include: { ticket: true },
    });

    await this.errorMonitor.handleDeploymentFailure({
      deploymentId,
      status: 'FAILED',
      environment: deployment?.environment || 'unknown',
      ticketId: execution?.ticket?.clickup_task_id || 'unknown',
      repository,
      branchName: ghPush?.branch_name || 'unknown',
      errorMessage: 'Deployment timed out after 30 minutes',
      buildId: deployment?.build_id || undefined,
    });

    // Decrement in-progress gauge on timeout
    if (deployment) {
      this.metrics.decrementGauge('deployment_in_progress', 1, {
        environment: deployment.environment,
      });
      // Update success rate logic? Timeout implies FAILED.
      // errorMonitor handles DB update to FAILED, so eventually successRateCalculator needs update?
      // Since we don't call updateDeploymentStatus here, we should update rates manually or rely on errorMonitor?
      // errorMonitor doesn't call successRateCalculator.
      // So update here.
      await this.successRateCalculator.update(deployment.environment, DeploymentStatus.FAILED);
    }

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

    // Delegate to error monitor
    const deployment = await this.prisma.deployment.findUnique({ where: { id: deploymentId } });
    const ghPush = await this.prisma.gitHubPush.findUnique({
      where: { id: deployment?.github_push_id || '' },
    });
    const execution = await this.prisma.execution.findUnique({
      where: { id: ghPush?.execution_id || '' },
      include: { ticket: true },
    });

    await this.errorMonitor.handleDeploymentFailure({
      deploymentId,
      status: 'FAILED',
      environment: deployment?.environment || 'unknown',
      ticketId: execution?.ticket?.clickup_task_id || 'unknown',
      repository,
      branchName: ghPush?.branch_name || 'unknown',
      errorMessage: `Status polling failed: ${error.message}`,
      buildId: deployment?.build_id || undefined,
    });

    // Decrement in-progress gauge on polling failure
    if (deployment) {
      this.metrics.decrementGauge('deployment_in_progress', 1, {
        environment: deployment.environment,
      });
      await this.successRateCalculator.update(deployment.environment, DeploymentStatus.FAILED);
    }

    this.pollingStates.delete(deploymentId);
  }
}
