import { Injectable } from '@nestjs/common';
import { LoggerService } from '@/common/logger/logger.service';
import { PrismaService } from '@/database/prisma.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { AuditLogService } from '@/common/audit/audit-log.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { WorkspaceService } from '@/ai-routing/providers';
import { GitOperationsService } from '@/ai-routing/providers/git-operations.service';
import { AIExecutionService } from '@/ai-routing/ai-execution.service';
import { IAIPromptExecutor } from '@/ai-routing/interfaces';
// Story 11.4: AI Decision Audit Logging
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
// Fallback: static commit message generation when AI provider is unavailable
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
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly sentry: SentryService,
    private readonly logger: LoggerService,
    private readonly workspaceService: WorkspaceService,
    private readonly gitOps: GitOperationsService,
    private readonly aiExecution: AIExecutionService,
    // Story 11.4: AI Decision Audit Logging
    private readonly aiDecisionLogger: AIDecisionLoggerService,
  ) {}

  /**
   * Orchestrates git commit and push via AI provider's executePrompt().
   *
   * Follows the same architecture pattern as GitHubPROrchestrator:
   *  1. Resolves the AI provider from the execution's ai_provider field
   *  2. Builds a prompt instructing the AI to stage, commit, and push
   *  3. Calls executePrompt() on the provider (ClaudeCodeProvider / CursorHeadlessProvider)
   *  4. Parses the AI's response for commit SHA
   *
   * Fallback: If executePrompt() fails, falls back to direct GitOperationsService
   * to ensure the code is always pushed even if the AI provider has issues.
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
        throw new Error(
          `Workspace not found for execution ${executionId}. It may have been cleaned up before the push could complete.`,
        );
      }

      // CRITICAL: Ensure we are on the correct feature branch before committing/pushing.
      // The workspace may be on `main` or the default branch after clone.
      // Without this step, commits go to the wrong branch and push fails with
      // "src refspec feature/xxx does not match any".
      this.logger.log('Ensuring workspace is on the correct feature branch', {
        executionId,
        targetBranch: githubPush.branch_name,
      });
      await this.gitOps.ensureBranch(workspace.path, githubPush.branch_name);

      // Check if there are changes to commit
      const hasChanges = await this.gitOps.hasChanges(workspace.path);

      if (!hasChanges) {
        this.logger.warn(
          'No uncommitted changes found in workspace, checking for unpushed commits',
          {
            executionId,
            workspacePath: workspace.path,
          },
        );

        // Even if there are no uncommitted changes, there may be unpushed commits
        // (e.g., the AI already committed during code generation)
        try {
          const repositoryUrl = workspace.repositoryUrl || githubPush.repository;
          await this.gitOps.push(workspace.path, repositoryUrl, githubPush.branch_name);
          const currentSha = await this.gitOps.getCurrentCommitSha(workspace.path);

          this.logger.log('Pushed existing commits successfully', {
            executionId,
            commitSha: currentSha,
          });

          return {
            success: true,
            commitSha: currentSha,
            filesChanged: 0,
            commitMessage: 'Pushed existing commits',
          };
        } catch (pushError) {
          throw new Error(`No changes to commit and push failed: ${(pushError as Error).message}`);
        }
      }

      // Attempt AI-delegated commit and push
      const repositoryUrl = workspace.repositoryUrl || githubPush.repository;
      let commitResult: CommitOrchestrationResult | null = null;

      try {
        commitResult = await this.commitAndPushViaAI(
          execution,
          githubPush,
          workspace,
          repositoryUrl,
          correlationId,
        );
      } catch (aiError) {
        this.logger.warn('AI-delegated commit failed, falling back to direct git operations', {
          executionId,
          error: (aiError as Error).message,
        });
      }

      // Fallback: If AI delegation failed, use direct GitOperationsService
      if (!commitResult || !commitResult.success) {
        this.logger.log('Using direct GitOperationsService fallback for commit and push', {
          executionId,
        });
        commitResult = await this.commitAndPushDirect(
          execution,
          githubPush,
          workspace,
          repositoryUrl,
          correlationId,
        );
      }

      if (!commitResult.success) {
        throw new Error(commitResult.error || 'Commit and push failed');
      }

      // Update database with commit results
      await this.prisma.gitHubPush.update({
        where: { id: githubPush.id },
        data: {
          commit_sha: commitResult.commitSha,
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
          commitSha: commitResult.commitSha,
          filesChanged: commitResult.filesChanged,
          aiProvider: execution.ai_provider,
          ticketId: execution.ticket.clickup_task_id,
          correlationId,
        },
      });

      // Record comprehensive metrics
      const duration = Date.now() - startTime;

      this.metrics.incrementGitHubCommitsCreated(
        'success',
        githubPush.repository,
        execution.ai_provider,
      );

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

      this.logger.log('Commit and push completed successfully', {
        executionId,
        commitSha: commitResult.commitSha,
        filesChanged: commitResult.filesChanged,
        duration,
      });

      return commitResult;
    } catch (_error) {
      const duration = Date.now() - startTime;

      this.logger.error('Git commit and push failed', executionId, {
        error: (_error as Error).message,
        duration,
      });

      this.metrics.incrementCounter('github_push_total', {
        status: 'failed',
        error_type: 'git_ops_error',
        repository: 'unknown',
      });

      this.metrics.incrementCounter('github_commit_total', {
        status: 'failed',
        repository: 'unknown',
      });

      this.sentry.captureException(_error as Error, {
        extra: {
          operation: 'commit_and_push',
          executionId,
          correlationId,
        },
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
   * Primary path: Delegate commit and push to AI provider via executePrompt().
   * The AI analyzes changes, generates a meaningful commit message,
   * stages, commits (--no-verify), and pushes (--no-verify).
   */
  private async commitAndPushViaAI(
    execution: {
      id: string;
      ai_provider: string;
      confidence_score: number | null;
      ticket: { id: string; clickup_task_id: string; title: string; description: string | null };
    },
    githubPush: { id: string; repository: string; branch_name: string },
    workspace: { path: string; repositoryUrl?: string },
    repositoryUrl: string,
    _correlationId?: string,
  ): Promise<CommitOrchestrationResult> {
    this.logger.log('Delegating commit and push to AI provider', {
      executionId: execution.id,
      provider: execution.ai_provider,
      repository: githubPush.repository,
      branch: githubPush.branch_name,
    });

    // Get AI provider instance (same pattern as GitHubPROrchestrator)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const providerInstance = this.aiExecution.getProvider(execution.ai_provider as any);

    if (!providerInstance) {
      throw new Error(`Provider ${execution.ai_provider} not available for commit generation`);
    }

    const aiProvider = providerInstance as unknown as IAIPromptExecutor;

    // Build the commit prompt
    const prompt = this.buildCommitPrompt({
      ticketId: execution.ticket.clickup_task_id,
      ticketTitle: execution.ticket.title,
      ticketDescription: execution.ticket.description ?? undefined,
      repository: githubPush.repository,
      branchName: githubPush.branch_name,
      repositoryUrl,
    });

    // Call AI provider to execute commit and push
    const result = await aiProvider.executePrompt({
      workspacePath: workspace.path,
      prompt,
      timeoutMs: 120_000, // 2 minutes for commit+push operations
    });

    if (!result.success || !result.response) {
      throw new Error(
        `AI provider failed to commit and push: ${result.error?.message || 'No response'}`,
      );
    }

    // Parse AI response to extract commit info
    const commitInfo = this.parseCommitResponse(result.response);

    // Story 11.4: Log AI commit decision
    await this.aiDecisionLogger.logDecision({
      agentName: 'GitHubCommitOrchestrator',
      action: 'ai_commit_and_push',
      reasoning: `AI provider generated commit message and pushed ${commitInfo.filesChanged || 0} files. Commit SHA: ${commitInfo.commitSha}. Method: ai_provider_executePrompt.`,
      ticketId: execution.ticket.id,
      executionId: execution.id,
      inputData: {
        ticketTitle: execution.ticket.title,
        repository: githubPush.repository,
        provider: execution.ai_provider,
      },
      outputData: {
        commitSha: commitInfo.commitSha,
        commitMessage: commitInfo.commitMessage,
        success: true,
        method: 'ai_provider_executePrompt',
      },
      confidence: 0.95,
    });

    this.logger.log('AI-delegated commit and push completed', {
      executionId: execution.id,
      commitSha: commitInfo.commitSha,
    });

    return {
      success: true,
      commitSha: commitInfo.commitSha,
      filesChanged: commitInfo.filesChanged,
      commitMessage: commitInfo.commitMessage,
    };
  }

  /**
   * Fallback path: Use direct GitOperationsService when AI provider fails.
   * Uses static commit message utilities for reliable, deterministic push.
   */
  private async commitAndPushDirect(
    execution: {
      id: string;
      ai_provider: string;
      confidence_score: number | null;
      ticket: { id: string; clickup_task_id: string; title: string; description: string | null };
    },
    githubPush: { id: string; repository: string; branch_name: string },
    workspace: { path: string; repositoryUrl?: string },
    repositoryUrl: string,
    _correlationId?: string,
  ): Promise<CommitOrchestrationResult> {
    this.logger.log('Performing direct git commit and push (fallback)', {
      executionId: execution.id,
      repository: githubPush.repository,
      branch: githubPush.branch_name,
    });

    // 1. Get changed files for commit message context
    const changedFiles = await this.gitOps.getChangedFiles(workspace.path);

    // 2. Get git diff for commit body
    const diff = await this.gitOps.getDiff(workspace.path);

    // 3. Generate commit message using static utilities (fallback)
    const metadata = createCommitMessageContext(
      execution.ticket.clickup_task_id,
      execution.ticket.title,
      execution.ticket.description ?? undefined,
      changedFiles,
      execution.ai_provider,
      execution.id,
      execution.confidence_score ?? 80,
    );

    const bodyText = this.buildCommitBody(changedFiles, diff);
    const commitMessage = buildCommitMessage(metadata, bodyText);

    // 4. Commit with --no-verify
    const commitSha = await this.gitOps.commit(workspace.path, commitMessage);

    this.logger.log('Git commit created successfully (fallback)', {
      executionId: execution.id,
      commitSha,
      filesChanged: changedFiles.length,
    });

    // 5. Push with --no-verify
    await this.gitOps.push(workspace.path, repositoryUrl, githubPush.branch_name);

    this.logger.log('Git push completed successfully (fallback)', {
      executionId: execution.id,
      commitSha,
      branch: githubPush.branch_name,
    });

    // Story 11.4: Log fallback decision
    await this.aiDecisionLogger.logDecision({
      agentName: 'GitHubCommitOrchestrator',
      action: 'commit_message_generation_fallback',
      reasoning: `AI provider unavailable/failed. Used static commit message utilities as fallback for ${changedFiles.length} changed files. Commit SHA: ${commitSha}.`,
      ticketId: execution.ticket.id,
      executionId: execution.id,
      inputData: {
        ticketTitle: execution.ticket.title,
        filesChanged: changedFiles.length,
        repository: githubPush.repository,
      },
      outputData: {
        commitSha,
        commitMessageLength: commitMessage.length,
        success: true,
        method: 'direct_git_ops_fallback',
      },
      confidence: 0.85,
    });

    return {
      success: true,
      commitSha,
      filesChanged: changedFiles.length,
      commitMessage,
    };
  }

  /**
   * Build prompt for AI to handle commit and push.
   * The AI is already in the workspace and can discover + analyze changes itself.
   */
  private buildCommitPrompt(context: {
    ticketId: string;
    ticketTitle: string;
    ticketDescription?: string;
    repository: string;
    branchName: string;
    repositoryUrl: string;
  }): string {
    const { ticketId, ticketTitle, ticketDescription, branchName, repositoryUrl } = context;

    return `You are a senior software engineer committing and pushing code changes to GitHub. Execute the following tasks:

CONTEXT:
- Ticket ID: ${ticketId}
- Ticket Title: ${ticketTitle}
${ticketDescription ? `- Description: ${ticketDescription}` : ''}
- Branch: ${branchName}
- Remote URL: ${repositoryUrl}

TASKS:
1. Ensure you are on the correct branch:
   - Run \`git branch --show-current\` to check the current branch
   - If NOT on "${branchName}", run \`git checkout -b ${branchName}\` to create and switch to it
   - If the branch already exists, run \`git checkout ${branchName}\`
2. Analyze the code changes in the workspace using \`git diff\` and \`git status\`
3. Generate a meaningful commit message following conventional commits format:
   - Format: <type>(<scope>): <description>
   - Types: feat, fix, refactor, docs, test, chore, perf
   - The scope should be inferred from the changed files (e.g., "auth", "api", "ui")
   - The description should be a concise summary of the actual changes
   - Include a body with key changes and ticket reference
   
4. Stage all changes: \`git add -A\`
5. Commit with the generated message: \`git commit --no-verify -m "<your message>"\`
6. Push to remote: \`git push --no-verify origin ${branchName}\`
7. Get the commit SHA using: \`git rev-parse HEAD\`

IMPORTANT:
- Use --no-verify flag for both commit and push to bypass pre-commit/pre-push hooks
- The commit message MUST reference the ticket: "Implements: ${ticketId}"
- Include "AI-Generated: true" in the commit footer

REQUIRED OUTPUT FORMAT (JSON):
{
  "commitSha": "<the full SHA from git rev-parse HEAD>",
  "commitMessage": "<the commit message you generated>",
  "filesChanged": <number of files changed>
}

Execute these tasks now and return ONLY the JSON response.`;
  }

  /**
   * Parse AI response to extract commit information
   */
  private parseCommitResponse(response: string): {
    commitSha: string;
    commitMessage?: string;
    filesChanged?: number;
  } {
    try {
      // Try to parse as JSON first
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.commitSha) {
          return {
            commitSha: parsed.commitSha,
            commitMessage: parsed.commitMessage,
            filesChanged: parsed.filesChanged,
          };
        }
      }

      // Fallback: Try to extract commit SHA from text (40-char hex string)
      const shaMatch = response.match(/\b[0-9a-f]{40}\b/);
      if (shaMatch) {
        return { commitSha: shaMatch[0] };
      }

      throw new Error('Could not parse commit SHA from AI response');
    } catch (_error) {
      this.logger.error('Failed to parse commit response', 'unknown', {
        error: (_error as Error).message,
        response: response.substring(0, 500),
      });
      throw new Error(`Failed to parse commit response: ${(_error as Error).message}`);
    }
  }

  /**
   * Build commit body text from changed files and diff stats (used in fallback).
   */
  private buildCommitBody(changedFiles: string[], diff: string): string {
    const lines: string[] = [];

    lines.push(`Changed ${changedFiles.length} file(s):`);
    const maxFiles = 10;
    for (const file of changedFiles.slice(0, maxFiles)) {
      lines.push(`  - ${file}`);
    }
    if (changedFiles.length > maxFiles) {
      lines.push(`  ... and ${changedFiles.length - maxFiles} more`);
    }

    if (diff) {
      const addedLines = (diff.match(/^\+[^+]/gm) || []).length;
      const removedLines = (diff.match(/^-[^-]/gm) || []).length;
      lines.push('');
      lines.push(`+${addedLines} -${removedLines} lines`);
    }

    return lines.join('\n');
  }
}
