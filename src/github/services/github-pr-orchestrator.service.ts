/**
 * GitHub PR Orchestrator Service
 *
 * Story 4.4: Pull Request Creation & Metadata
 * Delegates PR creation to AI agents following thin coordination pattern
 *
 * Flow: Call AI provider → AI analyzes changes, generates PR title/description, and creates PR
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { AuditLogService } from '@/common/audit/audit-log.service';
import { LoggerService } from '@/common/logger/logger.service';
import { AIExecutionService } from '@/ai-routing/ai-execution.service';
import { WorkspaceService } from '@/ai-routing/providers';
import { IAIPromptExecutor } from '@/ai-routing/interfaces';
import { PROrchestrationResult } from '../interfaces/pr-result.interface';
import { RabbitMQService } from '@/rabbitmq/rabbitmq.service';
import { PRRiskAssessorService } from './pr-risk-assessor.service';
import { PRAutoMergeService } from './pr-auto-merge.service';
import { PRReminderService } from './pr-reminder.service';

@Injectable()
export class GitHubPROrchestrator {
  constructor(
    private readonly aiExecution: AIExecutionService,
    private readonly prisma: PrismaService,
    private readonly rabbitMQ: RabbitMQService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly sentry: SentryService,
    private readonly logger: LoggerService,
    private readonly workspaceService: WorkspaceService,
    private readonly riskAssessor: PRRiskAssessorService,
    private readonly autoMergeService: PRAutoMergeService,
    private readonly reminderService: PRReminderService,
  ) {}

  /**
   * Orchestrates PR creation via AI provider
   * Flow: Call AI provider → AI analyzes changes, generates PR title/description, and creates PR
   */
  async createPullRequest(
    executionId: string,
    correlationId?: string,
  ): Promise<PROrchestrationResult> {
    const startTime = Date.now();

    this.logger.log('Starting AI-delegated PR creation', {
      executionId,
      correlationId,
    });

    try {
      // Load execution with ticket data
      const execution = await this.prisma.execution.findUnique({
        where: { id: executionId },
        include: { ticket: true },
      });

      if (!execution) {
        throw new Error(`Execution ${executionId} not found`);
      }

      const githubPush = await this.prisma.gitHubPush.findFirst({
        where: { execution_id: executionId },
      });

      if (!githubPush) {
        throw new Error(`GitHub push record not found for execution ${executionId}`);
      }

      // Get existing workspace
      const workspace = await this.workspaceService.getWorkspace(executionId);

      if (!workspace) {
        throw new Error(`Workspace not found for execution ${executionId}`);
      }

      this.logger.log('Delegating PR creation to AI provider', {
        executionId,
        provider: execution.ai_provider,
        repository: githubPush.repository,
        branch: githubPush.branch_name,
      });

      // Build prompt for AI to handle PR creation
      // AI CLI is already in the workspace and can discover changes itself
      const prompt = this.buildPRPrompt({
        ticketId: execution.ticket.clickup_task_id,
        ticketTitle: execution.ticket.title,
        ticketDescription: execution.ticket.description,
        repository: githubPush.repository,
        branchName: githubPush.branch_name,
        baseBranch: 'main',
      });

      // Get AI provider instance and cast to IAIPromptExecutor
      const providerInstance = this.aiExecution['providers'].get(execution.ai_provider);

      if (!providerInstance) {
        throw new Error(`Provider ${execution.ai_provider} not available`);
      }

      const aiProvider = providerInstance as unknown as IAIPromptExecutor;

      // Call AI provider to execute PR creation
      const result = await aiProvider.executePrompt({
        workspacePath: workspace.path,
        prompt,
      });

      if (!result.success || !result.response) {
        throw new Error(
          `AI provider failed: ${result.error?.message || result.error ? JSON.stringify(result.error) : 'No response'}`,
        );
      }

      // Parse AI response to extract PR info
      const prInfo = this.parsePRResponse(result.response);

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
   * Build comprehensive prompt for AI to handle PR creation
   * AI CLI is already in the workspace and can discover changes itself
   */
  private buildPRPrompt(context: {
    ticketId: string;
    ticketTitle: string;
    ticketDescription?: string;
    repository: string;
    branchName: string;
    baseBranch: string;
  }): string {
    const { ticketId, ticketTitle, ticketDescription, branchName, baseBranch } = context;

    return `You are a senior software engineer creating a GitHub Pull Request. Execute the following tasks:

CONTEXT:
- Ticket ID: ${ticketId}
- Ticket Title: ${ticketTitle}
${ticketDescription ? `- Description: ${ticketDescription}` : ''}

TASKS:
1. Analyze the code changes in the workspace using git commands (git log, git diff, etc.)
2. Generate a comprehensive PR title following conventional commits format:
   - Format: <type>(<scope>): <description>
   - Types: feat, fix, refactor, docs, test, chore, perf
   - Example: "feat(auth): add OAuth2 authentication flow"
   
3. Generate a detailed PR description that includes:
   - Summary of changes (2-3 sentences)
   - Key changes made (3-5 bullet points)
   - Related ticket: ${ticketId}
   - Testing notes if applicable
   
4. Create the PR using GitHub CLI:
   \`gh pr create --title "<your title>" --body "<your description>" --head ${branchName} --base ${baseBranch}\`
   
5. Extract the PR URL and number from the output

REQUIRED OUTPUT FORMAT (JSON):
{
  "prUrl": "https://github.com/<owner>/<repo>/pull/<number>",
  "prNumber": <number>,
  "prTitle": "<your generated title>"
}

Execute these tasks now and return ONLY the JSON response.`;
  }

  /**
   * Parse AI response to extract PR information
   */
  /**
   * Strip Docker stream metadata and other non-JSON noise that can prefix
   * the AI response when output is captured from a container exec/attach stream.
   * Example noise: `{"stream":true,"stdout":true,"stderr":true,"stdin":true}`
   */
  private stripStreamNoise(raw: string): string {
    // Remove Docker attach/exec stream metadata objects (always at the start)
    let cleaned = raw.replace(/^\s*\{"stream"\s*:\s*true[^}]*\}\s*/g, '');
    // Also remove any ANSI escape codes
    // eslint-disable-next-line no-control-regex
    cleaned = cleaned.replace(/\x1b\[[0-9;]*m/g, '');
    return cleaned.trim();
  }

  private parsePRResponse(response: string): {
    prUrl: string;
    prNumber: number;
    prTitle?: string;
  } {
    try {
      const cleaned = this.stripStreamNoise(response);

      // Fallback first: Try to extract PR URL from text (most reliable)
      const urlMatch = cleaned.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
      if (urlMatch) {
        // Also try to extract prTitle from nearby JSON if available
        let prTitle: string | undefined;
        const jsonMatch = cleaned.match(/\{[^{}]*"prTitle"\s*:\s*"([^"]+)"[^{}]*\}/);
        if (jsonMatch) {
          prTitle = jsonMatch[1];
        }
        return {
          prUrl: urlMatch[0],
          prNumber: parseInt(urlMatch[1], 10),
          prTitle,
        };
      }

      // Try to parse JSON containing prUrl
      const jsonMatch = cleaned.match(/\{[^{}]*"prUrl"\s*:[^{}]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.prUrl && parsed.prNumber) {
          return {
            prUrl: parsed.prUrl,
            prNumber: parsed.prNumber,
            prTitle: parsed.prTitle,
          };
        }
      }

      throw new Error('Could not parse PR URL from AI response');
    } catch (_error) {
      this.logger.error('Failed to parse PR response', 'unknown', {
        error: (_error as Error).message,
        response: response.substring(0, 500),
      });
      throw new Error(`Failed to parse PR response: ${(_error as Error).message}`);
    }
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
