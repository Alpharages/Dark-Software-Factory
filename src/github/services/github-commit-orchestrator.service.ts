import { Injectable } from '@nestjs/common';
import { LoggerService } from '@/common/logger/logger.service';
import { PrismaService } from '@/database/prisma.service';
import { AuditLogService } from '@/common/audit/audit-log.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { AIExecutionService } from '@/ai-routing/ai-execution.service';
import { WorkspaceService } from '@/ai-routing/providers';
import { GitOperationsService } from '@/ai-routing/providers/git-operations.service';
import { IAIPromptExecutor } from '@/ai-routing/interfaces';

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
    private readonly aiExecution: AIExecutionService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly logger: LoggerService,
    private readonly workspaceService: WorkspaceService,
    private readonly gitOps: GitOperationsService,
  ) {}

  /**
   * Orchestrates git commit and push via AI provider
   * Flow: Call AI provider → AI does git add, writes comprehensive message, and pushes to GitHub
   */
  async commitAndPush(
    executionId: string,
    correlationId?: string,
  ): Promise<CommitOrchestrationResult> {
    const startTime = Date.now();

    this.logger.log('Starting AI-delegated commit and push', {
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

      // Check if there are changes to commit
      const hasChanges = await this.gitOps.hasChanges(workspace.path);

      if (!hasChanges) {
        throw new Error('No changes to commit in workspace');
      }

      this.logger.log('Delegating commit and push to AI provider', {
        executionId,
        provider: execution.ai_provider,
        repository: githubPush.repository,
        branch: githubPush.branch_name,
      });

      // Build prompt for AI to handle git operations
      // AI CLI is already in the workspace and can discover changes itself
      const prompt = this.buildGitCommitPushPrompt({
        ticketId: execution.ticket.clickup_task_id,
        ticketTitle: execution.ticket.title,
        ticketDescription: execution.ticket.description,
        repository: githubPush.repository,
        branchName: githubPush.branch_name,
      });

      // Get AI provider instance and cast to IAIPromptExecutor
      // Provider implementations (e.g., CursorHeadlessProvider) implement both IAIProvider and IAIPromptExecutor
      const providerInstance = this.aiExecution['providers'].get(execution.ai_provider);

      if (!providerInstance) {
        throw new Error(`Provider ${execution.ai_provider} not available`);
      }

      const aiProvider = providerInstance as unknown as IAIPromptExecutor;

      // Call AI provider to execute git operations
      const result = await aiProvider.executePrompt({
        workspacePath: workspace.path,
        prompt,
      });

      if (!result.success || !result.response) {
        throw new Error(`AI provider failed: ${result.error || 'No response'}`);
      }

      // Parse AI response to extract commit info
      const commitInfo = this.parseCommitResponse(result.response);

      // Update database with commit results
      await this.prisma.gitHubPush.update({
        where: { id: githubPush.id },
        data: {
          commit_sha: commitInfo.commitSha,
          push_status: 'COMMITTED',
        },
      });

      // Create audit log for commit and push operation
      await this.audit.log({
        action: 'github_commit_push',
        entityType: 'execution',
        entityId: executionId,
        actorType: 'system',
        afterState: {
          repository: githubPush.repository,
          branchName: githubPush.branch_name,
          commitSha: commitInfo.commitSha,
          filesChanged: commitInfo.filesChanged,
          aiProvider: execution.ai_provider,
          ticketId: execution.ticket.clickup_task_id,
          correlationId,
        },
      });

      // Record comprehensive metrics
      const duration = Date.now() - startTime;

      // Legacy metric for backward compatibility
      this.metrics.incrementGitHubCommitsCreated(
        'success',
        githubPush.repository,
        execution.ai_provider,
      );

      // Detailed metrics with labels
      this.metrics.incrementCounter('github_push_total', {
        status: 'success',
        error_type: 'none',
        repository: githubPush.repository,
        provider: execution.ai_provider,
      });

      this.metrics.incrementCounter('github_commit_total', {
        status: 'success',
        repository: githubPush.repository,
        provider: execution.ai_provider,
      });

      this.metrics.recordHistogram('github_push_duration_seconds', duration / 1000, {
        repository: githubPush.repository,
        provider: execution.ai_provider,
      });

      this.metrics.recordGitHubOperationDuration('commit', duration, githubPush.repository);

      this.logger.log('AI-delegated commit and push completed successfully', {
        executionId,
        commitSha: commitInfo.commitSha,
        filesChanged: commitInfo.filesChanged,
        duration,
      });

      return {
        success: true,
        commitSha: commitInfo.commitSha,
        filesChanged: commitInfo.filesChanged,
        commitMessage: commitInfo.commitMessage,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error('AI-delegated commit and push failed', executionId, {
        error: (error as Error).message,
        duration,
      });

      this.metrics.incrementCounter('github_push_total', {
        status: 'failed',
        error_type: 'ai_delegation_error',
        repository: 'unknown',
      });

      this.metrics.incrementCounter('github_commit_total', {
        status: 'failed',
        repository: 'unknown',
      });

      // Update GitHub push status to FAILED
      try {
        const githubPush = await this.prisma.gitHubPush.findFirst({
          where: { execution_id: executionId },
        });

        if (githubPush) {
          await this.prisma.gitHubPush.update({
            where: { id: githubPush.id },
            data: {
              push_status: 'FAILED',
              error_message: (error as Error).message,
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
        error: (error as Error).message,
      };
    }
  }

  /**
   * Build comprehensive prompt for AI to handle git commit and push
   * AI CLI is already in the workspace and can discover changes itself
   */
  private buildGitCommitPushPrompt(context: {
    ticketId: string;
    ticketTitle: string;
    ticketDescription?: string;
    repository: string;
    branchName: string;
  }): string {
    const { ticketId, ticketTitle, ticketDescription, branchName } = context;

    return `You are a senior software engineer performing git operations. Execute the following tasks:

CONTEXT:
- Ticket ID: ${ticketId}
- Ticket Title: ${ticketTitle}
${ticketDescription ? `- Description: ${ticketDescription}` : ''}

TASKS:
1. Analyze the code changes in the workspace using git commands (git status, git diff, etc.)
2. Stage all changes: \`git add .\`
3. Write a comprehensive, professional commit message following conventional commits format:
   - Format: <type>(<scope>): <description>
   
     <body with 2-5 bullet points>
     
     Refs: ${ticketId}
   
   - Types: feat, fix, refactor, docs, test, chore, perf
   - Scope: Most relevant module/area affected by changes
   - Description: Clear, concise summary (max 72 chars)
   - Body: 2-5 bullet points describing WHAT changed (technical details)
   - Use present tense ("add" not "added")
   
4. Commit with the generated message: \`git commit -m "<your message>"\`
5. Push to branch: \`git push origin ${branchName}\`
6. Extract and return the commit SHA from the git commit output

REQUIRED OUTPUT FORMAT (JSON):
{
  "commitSha": "<40-character SHA from git commit>",
  "filesChanged": <number of files changed>,
  "commitMessage": "<your complete commit message>"
}

Execute these tasks now and return ONLY the JSON response.`;
  }

  /**
   * Parse AI response to extract commit information
   */
  private parseCommitResponse(response: string): {
    commitSha: string;
    filesChanged: number;
    commitMessage: string;
  } {
    try {
      // Try to parse as JSON first
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.commitSha && parsed.commitMessage) {
          return {
            commitSha: parsed.commitSha,
            filesChanged: parsed.filesChanged || 0,
            commitMessage: parsed.commitMessage,
          };
        }
      }

      // Fallback: Try to extract SHA from text
      const shaMatch = response.match(/[a-f0-9]{40}/);
      if (shaMatch) {
        return {
          commitSha: shaMatch[0],
          filesChanged: 0,
          commitMessage: 'AI-generated commit',
        };
      }

      throw new Error('Could not parse commit SHA from AI response');
    } catch (error) {
      this.logger.error('Failed to parse commit response', 'unknown', {
        error: (error as Error).message,
        response: response.substring(0, 500),
      });
      throw new Error(`Failed to parse commit response: ${(error as Error).message}`);
    }
  }
}
