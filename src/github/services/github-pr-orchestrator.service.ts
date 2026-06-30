/**
 * GitHub PR Orchestrator Service
 *
 * Story 4.4: Pull Request Creation & Metadata
 * Generates PR title/description via the Claude subscription, then creates the
 * PR directly via GitHub REST API (Octokit) — not via AI CLI in container.
 *
 * Flow: SubscriptionCompletionService → generate title/body → GitHubService.createPullRequest (Octokit)
 */

import { Injectable } from '@nestjs/common';
import { SubscriptionCompletionService } from '@/common/ai/subscription-completion.service';
import { PrismaService } from '@/database/prisma.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { AuditLogService } from '@/common/audit/audit-log.service';
import { LoggerService } from '@/common/logger/logger.service';
import { PROrchestrationResult } from '../interfaces/pr-result.interface';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { PRRiskAssessorService } from './pr-risk-assessor.service';
import { PRAutoMergeService } from './pr-auto-merge.service';
import { PRReminderService } from './pr-reminder.service';
import { GitHubService } from '../github.service';

@Injectable()
export class GitHubPROrchestrator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly sentry: SentryService,
    private readonly logger: LoggerService,
    private readonly riskAssessor: PRRiskAssessorService,
    private readonly autoMergeService: PRAutoMergeService,
    private readonly reminderService: PRReminderService,
    private readonly githubService: GitHubService,
    private readonly subscription: SubscriptionCompletionService,
  ) {}

  /**
   * Orchestrates PR creation.
   * Flow: Anthropic SDK generates title/body → GitHubService (Octokit) creates the PR.
   * The container-based AI provider is NOT used here because it lacks `gh` CLI auth.
   */
  async createPullRequest(
    executionId: string,
    correlationId?: string,
  ): Promise<PROrchestrationResult> {
    const startTime = Date.now();

    this.logger.log('Starting PR creation via GitHub REST API', {
      executionId,
      correlationId,
    });

    try {
      // Load execution with ticket + project data (project carries the default
      // branch the PR must target).
      const execution = await this.prisma.execution.findUnique({
        where: { id: executionId },
        include: { ticket: { include: { project: true } } },
      });

      if (!execution) {
        throw new Error(`Execution ${executionId} not found`);
      }

      // Target the project's configured default branch, not a hardcoded 'main'.
      // The per-ticket `ohp/<id>` branch is forked from the project's default
      // branch, so opening the PR against the wrong base fails with
      // "no history in common with main".
      const baseBranch = execution.ticket.project?.default_branch || 'main';

      const githubPush = await this.prisma.gitHubPush.findFirst({
        where: { execution_id: executionId },
      });

      if (!githubPush) {
        throw new Error(`GitHub push record not found for execution ${executionId}`);
      }

      this.logger.log('Generating PR title/description via Claude subscription', {
        executionId,
        repository: githubPush.repository,
        branch: githubPush.branch_name,
      });

      // Step 1: Generate PR title and description via the Claude subscription
      // (not via container provider — containers lack `gh` CLI auth)
      const { prTitle, prBody } = await this.generatePRTitleAndBody({
        ticketId: execution.ticket.clickup_task_id,
        ticketTitle: execution.ticket.title,
        ticketDescription: execution.ticket.description ?? undefined,
        branchName: githubPush.branch_name,
        baseBranch,
      });

      // Step 2: Parse owner/repo from repository URL
      const { owner, repo } = this.parseRepositoryUrl(githubPush.repository);

      // Step 3: Resolve per-project GitHub installationId for Octokit auth
      const installationId = execution.ticket.project_id
        ? await this.resolveInstallationId(execution.ticket.project_id)
        : undefined;

      // Step 4: Create the PR via GitHub REST API (Octokit) — reliable server-side call
      this.logger.log('Creating PR via GitHub REST API', {
        executionId,
        owner,
        repo,
        head: githubPush.branch_name,
        base: baseBranch,
      });

      const prData = (await this.githubService.createPullRequest(
        owner,
        repo,
        prTitle,
        prBody,
        githubPush.branch_name,
        baseBranch,
        installationId,
      )) as { number: number; html_url: string };

      const prInfo = {
        prNumber: prData.number,
        prUrl: prData.html_url,
        prTitle,
      };

      // Update database with PR results
      await this.prisma.gitHubPush.update({
        where: { id: githubPush.id },
        data: {
          pr_number: prInfo.prNumber,
          pr_url: prInfo.prUrl,
          push_status: 'PR_CREATED',
        },
      });

      // Create audit log for PR creation
      await this.audit.log({
        action: 'github_pr_create',
        entityType: 'execution',
        entityId: executionId,
        actorType: 'system',
        afterState: {
          repository: githubPush.repository,
          branchName: githubPush.branch_name,
          prUrl: prInfo.prUrl,
          prNumber: prInfo.prNumber,
          aiProvider: execution.ai_provider,
          ticketId: execution.ticket.clickup_task_id,
          correlationId,
        },
      });

      // Record comprehensive metrics
      const duration = Date.now() - startTime;

      // Legacy metrics for backward compatibility
      this.metrics.incrementGitHubOperation('pr_create', 'success');
      this.metrics.recordGitHubOperationDuration('pr_create', duration, githubPush.repository);

      // Detailed metrics with labels
      this.metrics.incrementCounter('github_pr_created_total', {
        status: 'success',
        repository: githubPush.repository,
        provider: execution.ai_provider,
      });

      this.metrics.recordHistogram('github_pr_creation_duration_seconds', duration / 1000, {
        repository: githubPush.repository,
        provider: execution.ai_provider,
      });

      // Story 4.5: Publish deployment trigger message
      await this.publishDeploymentTrigger(
        {
          executionId,
          githubPushId: githubPush.id,
          repository: githubPush.repository,
          branchName: githubPush.branch_name,
          commitSha: githubPush.commit_sha || '',
          prUrl: prInfo.prUrl,
          prNumber: prInfo.prNumber,
          ticketId: execution.ticket.clickup_task_id,
          environment: 'dev',
        },
        correlationId,
      );

      this.logger.log('PR created successfully via AI delegation', {
        executionId,
        prUrl: prInfo.prUrl,
        prNumber: prInfo.prNumber,
        duration,
      });

      // Story 14.1: Trigger PR risk assessment
      try {
        await this.riskAssessor.assess(
          executionId,
          githubPush.repository,
          prInfo.prNumber,
          correlationId,
        );

        // Story 14.2: Trigger PR auto-merge and reminders
        await this.autoMergeService.attemptAutoMerge(
          executionId,
          githubPush.repository,
          prInfo.prNumber,
          correlationId,
        );

        await this.reminderService.scheduleInitialReminder(
          executionId,
          githubPush.repository,
          prInfo.prNumber,
        );
      } catch (riskError) {
        // Log but don't fail PR creation if risk assessment/auto-merge fails
        this.logger.warn('PR assessment, auto-merge or reminder scheduling failed', {
          executionId,
          error: (riskError as Error).message,
        });
      }

      return {
        success: true,
        prUrl: prInfo.prUrl,
        prNumber: prInfo.prNumber,
      };
    } catch (_error) {
      const duration = Date.now() - startTime;

      this.logger.error('AI-delegated PR creation failed', executionId, {
        error: (_error as Error).message,
        duration,
      });

      this.metrics.incrementCounter('github_pr_created_total', {
        status: 'failed',
        error_type: 'ai_delegation_error',
        repository: 'unknown',
      });

      // Capture critical error in Sentry
      this.sentry.captureException(_error as Error, {
        extra: {
          operation: 'pr_creation',
          executionId,
          correlationId,
        },
      });

      // Update GitHub push status to FAILED if possible
      try {
        const githubPush = await this.prisma.gitHubPush.findFirst({
          where: { execution_id: executionId },
        });

        if (githubPush) {
          await this.prisma.gitHubPush.update({
            where: { id: githubPush.id },
            data: {
              push_status: 'FAILED',
              error_message: (_error as Error).message,
            },
          });
        }
      } catch (dbError) {
        this.logger.error('Failed to update GitHub push status', executionId, {
          error: (dbError as Error).message,
        });
      }

      return {
        success: false,
        error: (_error as Error).message,
      };
    }
  }

  /**
   * Generate PR title and description via the Claude subscription.
   * Falls back to a template if the CLI is unavailable or the response is unparseable.
   */
  private async generatePRTitleAndBody(context: {
    ticketId: string;
    ticketTitle: string;
    ticketDescription?: string;
    branchName: string;
    baseBranch: string;
  }): Promise<{ prTitle: string; prBody: string }> {
    const { ticketId, ticketTitle, ticketDescription, branchName, baseBranch } = context;

    const fallback = {
      prTitle: `feat(${ticketId}): ${ticketTitle}`,
      prBody: `## Ticket\n\nClickUp: ${ticketId}\n\n## Changes\n\n_AI-generated code changes for: ${ticketTitle}_\n\n## Branch\n\n\`${branchName}\` → \`${baseBranch}\``,
    };

    if (!(await this.subscription.isAvailable())) {
      this.logger.warn('Claude subscription not available — using fallback PR title/body');
      return fallback;
    }

    try {
      const prompt = `Generate a GitHub Pull Request title and description for the following ticket.

Ticket ID: ${ticketId}
Ticket Title: ${ticketTitle}
${ticketDescription ? `Description: ${ticketDescription}` : ''}
Branch: ${branchName} → ${baseBranch}

Requirements:
- Title must follow conventional commits format: <type>(<scope>): <description>
- Body must be markdown with: summary, key changes (bullet points), and ticket reference

Return ONLY valid JSON with no other text:
{"prTitle": "<title>", "prBody": "<markdown body>"}`;

      const text = (await this.subscription.complete(prompt)).trim();

      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*"prTitle"[\s\S]*"prBody"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.prTitle && parsed.prBody) {
          return { prTitle: parsed.prTitle, prBody: parsed.prBody };
        }
      }

      this.logger.warn('Could not parse Anthropic PR content response — using fallback');
      return fallback;
    } catch (_error) {
      this.logger.warn('Anthropic PR content generation failed — using fallback', {
        error: (_error as Error).message,
      });
      return fallback;
    }
  }

  /**
   * Parse "owner/repo" from a repository URL or "owner/repo" slug.
   * Handles: https://github.com/owner/repo, https://github.com/owner/repo.git, owner/repo
   */
  private parseRepositoryUrl(repository: string): { owner: string; repo: string } {
    // Strip .git suffix
    const clean = repository.replace(/\.git$/, '');
    // Try full URL
    const urlMatch = clean.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (urlMatch) {
      return { owner: urlMatch[1], repo: urlMatch[2] };
    }
    // Try owner/repo slug
    const slugMatch = clean.match(/^([^/]+)\/([^/]+)$/);
    if (slugMatch) {
      return { owner: slugMatch[1], repo: slugMatch[2] };
    }
    throw new Error(`Cannot parse owner/repo from repository: "${repository}"`);
  }

  /**
   * Look up the GitHub installationId for the project's linked account.
   * Returns undefined if the project has no linked account (falls back to global PAT).
   */
  private async resolveInstallationId(projectId: string): Promise<string | undefined> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { github_account_id: true },
    });
    if (!project?.github_account_id) return undefined;

    const account = await this.prisma.gitHubAccount.findUnique({
      where: { id: project.github_account_id },
      select: { installationId: true },
    });
    return account?.installationId ?? undefined;
  }

  /**
   * Story 4.5 Integration: Publish deployment trigger message
   */
  private async publishDeploymentTrigger(
    payload: {
      executionId: string;
      githubPushId: string;
      repository: string;
      branchName: string;
      commitSha: string;
      prUrl: string;
      prNumber: number;
      ticketId: string;
      environment: 'dev' | 'staging' | 'production';
    },
    correlationId?: string,
  ): Promise<void> {
    try {
      await this.rabbitMQ.publishToQueue('github-pr-created-queue', payload, {
        correlationId: correlationId || payload.executionId,
        persistent: true,
        headers: {
          'x-correlation-id': correlationId || payload.executionId,
          'x-execution-id': payload.executionId,
          'x-pr-number': payload.prNumber.toString(),
        },
      });

      this.logger.log('Published deployment trigger message', {
        executionId: payload.executionId,
        prNumber: payload.prNumber,
        queue: 'github-pr-created-queue',
      });
    } catch (_error) {
      // Log error but don't fail PR creation
      this.logger.warn('Failed to publish deployment trigger', {
        executionId: payload.executionId,
        error: (_error as Error).message,
      });
    }
  }
}
