/**
 * GitHub PR Orchestrator Service
 *
 * Story 4.4: Pull Request Creation & Metadata
 * Delegates PR creation to AI agents following thin coordination pattern
 *
 * AC#1: AI-Delegated PR Creation
 * AC#3: Parse AI Agent Output
 * AC#4: Database Record Updates
 * AC#5: Error Handling & Resilience
 * AC#6: Observability & Metrics
 */

import { Injectable, Inject } from '@nestjs/common';
import { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { PrismaService } from '../../database/prisma.service';
import { SentryService } from '../../common/sentry/sentry.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { OrchestratorService } from '../../ai-routing/orchestrator.service';
import { GitHubService } from '../github.service';
import { PRTask, PRTaskContext, QAResultsSummary } from '../interfaces/pr-task.interface';
import { PROrchestrationResult } from '../interfaces/pr-result.interface';
import { parseAIPRResponse } from '../utils/pr-response-parser';
import { buildPRDescription, PRDescriptionContext } from '../utils/pr-description-builder';

@Injectable()
export class GitHubPROrchestrator {
  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly githubService: GitHubService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly sentry: SentryService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /**
   * Orchestrates PR creation via AI delegation
   * AC#1: AI-Delegated PR Creation
   */
  async createPullRequest(
    executionId: string,
    correlationId?: string,
  ): Promise<PROrchestrationResult> {
    const startTime = Date.now();

    this.logger.info('Starting PR orchestration', {
      executionId,
      correlationId,
    });

    try {
      // Load execution with ticket relation
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

      const { ticketId, ticketTitle, ticketDescription } = {
        ticketId: execution.ticket.clickup_task_id,
        ticketTitle: execution.ticket.title,
        ticketDescription: execution.ticket.description,
      };

      // Load QA results for PR description
      const qaResult = await this.prisma.qAResult.findFirst({
        where: { execution_id: executionId },
        orderBy: { created_at: 'desc' },
      });

      const qaResults: QAResultsSummary = qaResult
        ? {
            linting_passed: qaResult.linting_passed || false,
            tests_passed: qaResult.tests_passed || false,
            test_coverage: qaResult.test_coverage || undefined,
            code_review_passed: qaResult.code_review_passed || false,
            qa_summary_details: '', // TODO: Extract from qa_result details
          }
        : {
            linting_passed: false,
            tests_passed: false,
            code_review_passed: false,
            qa_summary_details: 'QA results not found',
          };

      // AC#2: Build PR description
      const prDescriptionContext: PRDescriptionContext = {
        ticketId,
        ticketUrl: `https://app.clickup.com/t/${ticketId}`,
        ticketTitle,
        acceptanceCriteria: [], // TODO: Extract from ticket if available
        aiProvider: execution.ai_provider,
        complexityScore: execution.complexity_score || 50,
        confidenceScore: execution.confidence_score || 70,
        executionId,
        fallbackUsed: false, // TODO: Track from OrchestratorService
        qaResults,
      };

      const prDescription = buildPRDescription(prDescriptionContext);

      // AC#1: Build AI delegation task
      const prTask = this.buildPRTask(
        githubPush.repository,
        githubPush.branch_name,
        prDescription,
        {
          ticketId,
          ticketTitle,
          ticketDescription,
          acceptanceCriteria: [],
          qaResults,
          executionId,
          aiProvider: execution.ai_provider,
          complexityScore: execution.complexity_score || 50,
          confidenceScore: execution.confidence_score || 70,
        },
      );

      // Delegate to AI provider
      this.logger.info('Delegating PR task to AI provider', {
        executionId,
        provider: execution.ai_provider,
        repository: githubPush.repository,
        branch: githubPush.branch_name,
      });

      const aiResult = await this.callAIProvider(
        prTask,
        execution.ai_provider,
        githubPush.repository,
      );

      // AC#3: Parse AI response
      const parsedResult = parseAIPRResponse(aiResult);

      if (!parsedResult.success || !parsedResult.prUrl) {
        this.logger.error('PR creation failed or URL missing', {
          executionId,
          error: parsedResult.error,
        });

        // Record failure
        this.metrics.incrementGitHubOperation('pr_create', 'failed');

        return {
          success: false,
          error: parsedResult.error || 'PR creation failed - no URL returned',
        };
      }

      // AC#4: Update database
      await this.updateDatabase(githubPush.id, parsedResult, executionId, {
        repository: githubPush.repository,
        branchName: githubPush.branch_name,
        ticketId,
        aiProvider: execution.ai_provider,
        correlationId,
      });

      // AC#6: Record metrics
      const duration = Date.now() - startTime;
      this.metrics.incrementGitHubOperation('pr_create', 'success');
      this.metrics.recordGitHubOperationDuration('pr_create', duration, githubPush.repository);

      this.logger.info('PR orchestration completed successfully', {
        executionId,
        prUrl: parsedResult.prUrl,
        prNumber: parsedResult.prNumber,
        duration,
      });

      return {
        success: true,
        prUrl: parsedResult.prUrl,
        prNumber: parsedResult.prNumber,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      // AC#5: Error handling
      await this.handleError(error as Error, executionId, correlationId);

      this.logger.error('PR orchestration failed', {
        executionId,
        error: (error as Error).message,
        duration,
      });

      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Builds AI delegation task structure
   * AC#1: AI delegation task format
   */
  private buildPRTask(
    repository: string,
    branchName: string,
    prDescription: string,
    context: PRTaskContext,
  ): PRTask {
    const instructions = `
Create GitHub Pull Request for this feature:

Repository: ${repository}
Branch: ${branchName}
Base: main

PR Title: "${context.ticketTitle}"

PR Description:
${prDescription}

Use the GitHub CLI to create the PR:
\`gh pr create --title "${context.ticketTitle}" --body "..." --head ${branchName} --base main\`

Return format (JSON):
{
  "prUrl": "https://github.com/${repository}/pull/XXX",
  "prNumber": XXX
}
    `.trim();

    return {
      type: 'github-create-pr',
      instructions,
      context,
    };
  }

  /**
   * Calls AI provider to execute PR creation task via OrchestratorService
   * AC#1: Actual AI delegation (not mock)
   */
  private async callAIProvider(
    task: PRTask,
    provider: string,
    repository: string,
  ): Promise<string> {
    // Build proper orchestration input
    const input = {
      executionId: task.context.executionId,
      ticketId: task.context.ticketId,
      correlationId: task.context.executionId,
      prompt: task.instructions,
      repositoryUrl: `https://github.com/${repository}.git`,
      workspacePath: process.cwd(),
      providerOverride: provider as 'CURSOR_HEADLESS' | 'CLAUDE_CODE',
      title: task.context.ticketTitle,
      description: task.context.ticketDescription,
      acceptanceCriteria: task.context.acceptanceCriteria.join('\n') || '',
    };

    const result = await this.orchestrator.execute(input);

    if (!result.success) {
      throw new Error(`AI provider execution failed: ${result.error?.message || 'Unknown error'}`);
    }

    // Return the codeDiff as PR creation output
    return result.codeDiff || '';
  }

  /**
   * AC#4: Updates database with PR results
   */
  private async updateDatabase(
    githubPushId: string,
    result: { prUrl?: string; prNumber?: number },
    executionId: string,
    context: {
      repository: string;
      branchName: string;
      ticketId: string;
      aiProvider: string;
      correlationId?: string;
    },
  ): Promise<void> {
    // Update GitHub push record
    await this.prisma.gitHubPush.update({
      where: { id: githubPushId },
      data: {
        pr_number: result.prNumber,
        pr_url: result.prUrl,
        push_status: 'PR_CREATED',
      },
    });

    // AC#4: Create audit log
    await this.audit.log({
      action: 'github_pr_create',
      entityType: 'execution',
      entityId: executionId,
      actorType: 'system',
      afterState: {
        repository: context.repository,
        branchName: context.branchName,
        prUrl: result.prUrl,
        prNumber: result.prNumber,
        aiProvider: context.aiProvider,
        ticketId: context.ticketId,
        correlationId: context.correlationId,
      },
    });

    this.logger.info('Database updated with PR results', {
      executionId,
      prUrl: result.prUrl,
      prNumber: result.prNumber,
      status: 'PR_CREATED',
    });
  }

  /**
   * AC#5: Comprehensive error handling
   */
  private async handleError(
    error: Error,
    executionId: string,
    correlationId?: string,
  ): Promise<void> {
    this.logger.error('PR orchestration error', {
      executionId,
      error: error.message,
      stack: error.stack,
      correlationId,
    });

    // Capture in Sentry
    this.sentry.captureException(error, {
      extra: {
        executionId,
        operation: 'github_pr_create',
        correlationId,
      },
    });

    // TODO: Notify PM via ClickUp (Story 2.1 integration)
    // await this.clickup.addComment(ticketId, '⚠️ PR creation failed - manual intervention required');
  }
}
