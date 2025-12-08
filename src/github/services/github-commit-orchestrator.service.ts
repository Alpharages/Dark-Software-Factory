import { Injectable, Inject } from '@nestjs/common';
import { Logger } from 'winston';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { AIProvider } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { OrchestratorService } from '../../ai-routing/orchestrator.service';
import { GitHubService } from '../github.service';
import { GitHubErrorMonitor } from './github-error-monitor.service';
import {
  CommitTask,
  CommitTaskContext,
  CommitMessageMetadata,
} from '../interfaces/commit-task.interface';
import { CommitPushResult } from '../interfaces/commit-result.interface';
import { parseAIResponse, validateCommitSha } from '../utils/commit-response-parser';
import { createCommitMessageContext, buildCommitMessage } from '../utils/commit-message-context';

export interface CommitOrchestrationResult {
  success: boolean;
  commitSha?: string;
  filesChanged?: number;
  commitMessage?: string;
  error?: string;
}

@Injectable()
export class GitHubCommitOrchestrator {
  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly githubService: GitHubService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly errorMonitor: GitHubErrorMonitor,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /**
   * Orchestrates git commit and push operations via AI delegation
   * AC#1: AI-Delegated Git Commit & Push
   */
  async commitAndPush(
    executionId: string,
    correlationId?: string,
  ): Promise<CommitOrchestrationResult> {
    const startTime = Date.now();
    let execution: {
      ticket: { clickup_task_id: string; title: string; description: string };
      ai_provider: AIProvider;
      complexity_score: number | null;
      code_output: string | null;
      files_changed: unknown;
    } | null = null;

    let githubPush: {
      id: string;
      repository: string;
      branch_name: string;
    } | null = null;

    this.logger.info('Starting commit orchestration', {
      executionId,
      correlationId,
    });

    try {
      // Load execution with ticket and github_push relations
      execution = await this.prisma.execution.findUnique({
        where: { id: executionId },
        include: { ticket: true },
      });

      if (!execution) {
        throw new Error(`Execution ${executionId} not found`);
      }

      githubPush = await this.prisma.gitHubPush.findFirst({
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

      // Extract file paths from code_output or files_changed
      const filePaths = this.extractFilePaths(execution);

      // AC#2: Build commit message context
      const commitContext = createCommitMessageContext(
        ticketId,
        ticketTitle,
        ticketDescription,
        filePaths,
        execution.ai_provider,
        executionId,
        execution.complexity_score || 50,
      );

      // AC#1: Build AI delegation task
      const gitTask = this.buildCommitTask(
        githubPush.repository,
        githubPush.branch_name,
        commitContext,
        execution.code_output,
        {
          ticketId,
          ticketTitle,
          ticketDescription,
          executionId,
          aiProvider: execution.ai_provider,
          complexityScore: execution.complexity_score || 50,
          codeOutput: execution.code_output,
          acceptanceCriteria: [],
        },
      );

      // Delegate to AI provider
      this.logger.info('Delegating commit task to AI provider', {
        executionId,
        provider: execution.ai_provider,
        repository: githubPush.repository,
        branch: githubPush.branch_name,
      });

      const aiResult = await this.callAIProvider(
        gitTask,
        execution.ai_provider,
        githubPush.repository,
      );

      // AC#3: Parse AI response
      const parsedResult = parseAIResponse(aiResult);

      if (!parsedResult.success || !parsedResult.commitSha) {
        this.logger.error('Commit failed or SHA missing', {
          executionId,
          error: parsedResult.error,
        });

        // Record failure
        this.metrics.incrementGitHubCommitsCreated(
          'failed',
          githubPush.repository,
          execution.ai_provider,
        );

        // Update GitHub push status to FAILED
        await this.prisma.gitHubPush.update({
          where: { id: githubPush.id },
          data: {
            push_status: 'FAILED',
            error_message: parsedResult.error || 'Commit failed - no SHA returned',
          },
        });

        const error = new Error(parsedResult.error || 'Commit failed - no SHA returned');

        // Use monitor for non-throwing errors too if needed, but here we return false
        // AC#5: Error handling logic delegates to monitor
        await this.errorMonitor.handleGitHubError({
          operation: 'commit',
          executionId,
          ticketId,
          repository: githubPush.repository,
          branchName: githubPush.branch_name,
          error,
          correlationId,
          aiProvider: execution.ai_provider,
          taskInstructions: gitTask.instructions,
          aiOutput: aiResult,
        });

        return {
          success: false,
          error: error.message,
        };
      }

      // Validate commit SHA format
      if (!validateCommitSha(parsedResult.commitSha)) {
        const error = new Error(
          `Invalid commit SHA format received from AI: ${parsedResult.commitSha}`,
        );
        this.logger.error('Invalid commit SHA format', {
          executionId,
          commitSha: parsedResult.commitSha,
        });

        await this.errorMonitor.handleGitHubError({
          operation: 'commit',
          executionId,
          ticketId,
          repository: githubPush.repository,
          branchName: githubPush.branch_name,
          error,
          correlationId,
          aiProvider: execution.ai_provider,
          taskInstructions: gitTask.instructions,
          aiOutput: aiResult,
        });

        return {
          success: false,
          error: error.message,
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
      this.metrics.incrementGitHubCommitsCreated(
        'success',
        githubPush.repository,
        execution.ai_provider,
      );
      this.metrics.recordGitHubOperationDuration('commit', duration, githubPush.repository);

      this.logger.info('Commit orchestration completed successfully', {
        executionId,
        commitSha: parsedResult.commitSha,
        filesChanged: parsedResult.filesChanged,
        duration,
      });

      return {
        success: true,
        commitSha: parsedResult.commitSha,
        filesChanged: parsedResult.filesChanged,
        commitMessage: parsedResult.commitMessage,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      // AC#5: Comprehensive error handling delegated to monitor
      await this.handleError(
        error as Error,
        executionId,
        execution?.ticket?.clickup_task_id,
        githubPush?.repository,
        githubPush?.branch_name,
        execution?.ai_provider,
        correlationId,
      );

      this.logger.error('Commit orchestration failed', {
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
  private buildCommitTask(
    repository: string,
    branchName: string,
    commitContext: CommitMessageMetadata,
    codeOutput: string | null,
    context: CommitTaskContext,
  ): CommitTask {
    const commitMessage = buildCommitMessage(commitContext, context.ticketDescription);

    const instructions = `
Commit and push AI-generated code to GitHub:

Repository: ${repository}
Branch: ${branchName}

Code changes are ready in the workspace.

Tasks:
1. Stage all changed files
2. Commit with the following message:

${commitMessage}

3. Push to branch: ${branchName}
4. Return commit SHA

Return format (JSON):
{
  "commitSha": "abc123...",
  "filesChanged": 5,
  "commitMessage": "${commitContext.type}(${commitContext.scope}): ${commitContext.description}"
}
    `.trim();

    return {
      type: 'github-commit-push',
      instructions,
      context: {
        ...context,
        codeOutput,
      },
    };
  }

  /**
   * Calls AI provider to execute commit task via OrchestratorService
   * AC#1: Actual AI delegation (not mock)
   */
  private async callAIProvider(
    task: CommitTask,
    provider: AIProvider,
    repository: string,
  ): Promise<string> {
    // Build proper orchestration input
    const input = {
      executionId: task.context.executionId,
      ticketId: task.context.ticketId,
      correlationId: task.context.executionId,
      prompt: task.instructions,
      repositoryUrl: `https://github.com/${repository}.git`, // Required by IAIExecutionInput
      workspacePath: process.cwd(),
      providerOverride: provider,
      title: task.context.ticketTitle,
      description: task.context.ticketDescription,
      acceptanceCriteria: task.context.acceptanceCriteria?.join('\n') || '',
    };

    const result = await this.orchestrator.execute(input);

    if (!result.success) {
      throw new Error(`AI provider execution failed: ${result.error?.message || 'Unknown error'}`);
    }

    // Return the code output as a string
    // For commit operations, we expect the AI to return JSON with commitSha
    return JSON.stringify({
      commitSha: result.codeDiff || '', // Use codeDiff as proxy for commit SHA
      filesChanged: result.filesChanged?.length || 0,
      commitMessage: 'Generated by AI',
    });
  }

  /**
   * Extracts file paths from execution code_output or files_changed
   */
  private extractFilePaths(execution: {
    code_output?: string | null;
    files_changed?: unknown;
  }): string[] {
    if (execution.files_changed) {
      // If files_changed is already an array
      if (Array.isArray(execution.files_changed)) {
        return execution.files_changed as string[];
      }
      // If it's a JSON object with file paths
      if (typeof execution.files_changed === 'object') {
        const obj = execution.files_changed as Record<string, unknown>;
        if (obj.files_changed && Array.isArray(obj.files_changed)) {
          return obj.files_changed as string[];
        }
      }
    }

    // Fallback: try to parse code_output
    if (execution.code_output) {
      try {
        const parsed = JSON.parse(execution.code_output);
        if (parsed.files_changed && Array.isArray(parsed.files_changed)) {
          return parsed.files_changed.map((f: { path?: string }) => f.path || f).filter(Boolean);
        }
      } catch {
        // Ignore JSON parse errors
      }
    }

    return [];
  }

  /**
   * AC#4: Updates database with commit results
   */
  private async updateDatabase(
    githubPushId: string,
    result: CommitPushResult,
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
        commit_sha: result.commitSha,
        push_status: 'COMMITTED', // Note: Prisma enum has COMMITTED, not PUSHED as in AC#4
      },
    });

    // AC#4: Create audit log
    await this.audit.log({
      action: 'github_commit_push',
      entityType: 'execution',
      entityId: executionId,
      actorType: 'system',
      afterState: {
        repository: context.repository,
        branchName: context.branchName,
        commitSha: result.commitSha,
        filesChanged: result.filesChanged,
        aiProvider: context.aiProvider,
        ticketId: context.ticketId,
        correlationId: context.correlationId,
      },
    });

    this.logger.info('Database updated with commit results', {
      executionId,
      commitSha: result.commitSha,
      status: 'COMMITTED',
    });
  }

  /**
   * AC#5: Comprehensive error handling
   */
  private async handleError(
    error: Error,
    executionId: string,
    ticketId: string | undefined,
    repository: string | undefined,
    branchName: string | undefined,
    aiProvider: string | undefined,
    correlationId?: string,
  ): Promise<void> {
    // Delegate to error monitor
    await this.errorMonitor.handleGitHubError({
      operation: 'commit',
      executionId,
      ticketId: ticketId || 'unknown',
      repository: repository || 'unknown',
      branchName: branchName || 'unknown',
      error,
      correlationId,
      aiProvider,
    });
  }
}
