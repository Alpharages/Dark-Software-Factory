import { Injectable } from '@nestjs/common';
import { LoggerService } from '@/common/logger/logger.service';
import { AIProvider } from '@prisma/client';
import { PrismaService } from '@/database/prisma.service';
import { AuditLogService } from '@/common/audit/audit-log.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { OrchestratorService } from '@/ai-routing/orchestrator.service';
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
import { getFileCountBucket } from '../utils/file-count-bucket.util';
import { classifyGitHubError } from '../utils/classify-github-error.util';
import { WorkspaceService } from '@/ai-routing/providers';
import { GitOperationsService } from '@/ai-routing/providers/git-operations.service';

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
    private readonly logger: LoggerService,
    private readonly workspaceService: WorkspaceService,
    private readonly gitOps: GitOperationsService,
  ) { }

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

    this.logger.log('Starting commit orchestration', {
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
      this.logger.log('Delegating commit task to AI provider', {
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
        this.logger.warn('Commit failed or SHA missing', {
          executionId,
          error: parsedResult.error,
        });

        // Record failure
        this.metrics.incrementGitHubCommitsCreated(
          'failed',
          githubPush.repository,
          execution.ai_provider,
        );

        // Story 4.8 Metric
        this.metrics.incrementCounter('github_push_total', {
          status: 'failed',
          repository: githubPush.repository,
          error_type: 'unknown',
        });
        this.metrics.incrementCounter('github_commit_total', {
          status: 'failed',
          repository: githubPush.repository,
        });

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
        this.logger.warn('Invalid commit SHA format', {
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

      // Count files for bucket
      const fileCount = parsedResult.filesChanged || 0;
      const bucket = getFileCountBucket(fileCount);

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

      // Story 4.8 Metrics
      this.metrics.incrementCounter('github_push_total', {
        status: 'success',
        error_type: 'none',
        repository: githubPush.repository,
      });
      this.metrics.incrementCounter('github_commit_total', {
        status: 'success',
        repository: githubPush.repository,
      });
      this.metrics.recordHistogram('github_push_duration_seconds', duration / 1000, {
        repository: githubPush.repository,
        file_count_bucket: bucket,
      });

      this.logger.log('Commit orchestration completed successfully', {
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

      this.logger.warn('Commit orchestration failed', {
        executionId,
        error: (error as Error).message,
        duration,
      });

      this.metrics.incrementCounter('github_push_total', {
        status: 'failed',
        error_type: classifyGitHubError(error),
        repository: githubPush?.repository || 'unknown',
      });
      this.metrics.incrementCounter('github_commit_total', {
        status: 'failed',
        repository: githubPush?.repository || 'unknown',
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
   * Performs git commit and push operations directly in the existing workspace
   * AC#1: Direct git operations (no AI delegation needed for commit/push)
   */
  private async callAIProvider(
    task: CommitTask,
    provider: AIProvider,
    repository: string,
  ): Promise<string> {
    const executionId = task.context.executionId;

    // Get existing workspace (where code was already generated)
    const workspace = await this.workspaceService.getWorkspace(executionId);

    if (!workspace) {
      throw new Error(`Workspace not found for execution ${executionId}`);
    }

    this.logger.log('Using existing workspace for commit and push', {
      executionId,
      workspacePath: workspace.path,
    });

    // Check if there are any changes to commit
    const hasChanges = await this.gitOps.hasChanges(workspace.path);

    if (!hasChanges) {
      this.logger.warn('No changes to commit', { executionId });
      throw new Error('No changes to commit in workspace');
    }

    // Get list of changed files before committing
    const filesChanged = await this.gitOps.getChangedFiles(workspace.path);

    // Build commit message from context
    const commitContext = createCommitMessageContext(
      task.context.ticketId,
      task.context.ticketTitle,
      task.context.ticketDescription,
      filesChanged,
      provider,
      executionId,
      task.context.complexityScore || 50,
    );

    const commitMessage = buildCommitMessage(commitContext, task.context.ticketDescription);

    this.logger.log('Creating commit', {
      executionId,
      message: commitMessage,
      filesCount: filesChanged.length,
    });

    // Perform git commit
    const commitSha = await this.gitOps.commit(
      workspace.path,
      commitMessage,
    );

    this.logger.log('Commit created successfully', {
      executionId,
      commitSha,
    });

    // Perform git push
    this.logger.log('Pushing to remote', {
      executionId,
      repository,
      branch: workspace.branchName,
    });

    await this.gitOps.push(
      workspace.path,
      repository,
      workspace.branchName,
    );

    this.logger.log('Push completed successfully', {
      executionId,
      commitSha,
    });

    // Return result in expected format
    return JSON.stringify({
      commitSha,
      filesChanged: filesChanged.length,
      commitMessage,
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

    this.logger.log('Database updated with commit results', {
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
