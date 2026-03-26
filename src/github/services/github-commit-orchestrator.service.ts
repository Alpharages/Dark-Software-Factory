import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { LoggerService } from '@/common/logger/logger.service';
import { PrismaService } from '@/database/prisma.service';
import { SentryService } from '@/common/sentry/sentry.service';
import { AuditLogService } from '@/common/audit/audit-log.service';
import { MetricsService } from '@/common/metrics/metrics.service';
import { GitOperationsService } from '@/ai-routing/providers/git-operations.service';
// Story 11.4: AI Decision Audit Logging
import { AIDecisionLoggerService } from '@/audit/ai-decision-logger.service';
// Fallback: static commit message generation when AI API is unavailable
import { createCommitMessageContext, buildCommitMessage } from '../utils/commit-message-context';
import {
  generateCommitMessageTool,
  GenerateCommitMessageInput,
} from '@/ai-routing/providers/anthropic-tools';
import { GitHubTokenResolverService } from '../github-token-resolver.service';

export interface CommitOrchestrationResult {
  success: boolean;
  commitSha?: string;
  filesChanged?: number;
  commitMessage?: string;
  error?: string;
}

@Injectable()
export class GitHubCommitOrchestrator {
  private readonly anthropic: Anthropic | null = null;
  private readonly anthropicModel: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly metrics: MetricsService,
    private readonly sentry: SentryService,
    private readonly logger: LoggerService,
    private readonly gitOps: GitOperationsService,
    private readonly config: ConfigService,
    // Story 11.4: AI Decision Audit Logging
    private readonly aiDecisionLogger: AIDecisionLoggerService,
    private readonly tokenResolver: GitHubTokenResolverService,
  ) {
    const apiKey = this.config.get<string>('anthropic.apiKey');
    // Use Haiku 3.5 for commit messages — cheap, fast, and more than capable
    // for analyzing diff stats and generating structured commit messages.
    this.anthropicModel =
      this.config.get<string>('anthropic.commitMessageModel') || 'claude-3-haiku-20240307';
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    }
  }

  /**
   * Orchestrates git commit and push via AI provider's executePrompt().
   *
   * Follows the same architecture pattern as GitHubPROrchestrator:
   *  1. Resolves the AI provider from the execution's ai_provider field
   *  2. Builds a prompt instructing the AI to stage, commit, and push
   *  3. Calls executePrompt() on the provider (ClaudeCodeProvider)
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

      const workspace = await this.prisma.workspace.findUnique({
        where: { execution_id: executionId },
      });
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
      await this.gitOps.ensureBranch(workspace.workspace_path, githubPush.branch_name);

      // Resolve per-project GitHub token once (used by both push paths below)
      const repositoryUrl = workspace.repository_url || githubPush.repository;
      let pushUrl = repositoryUrl;
      if (execution.ticket?.project_id) {
        const resolvedAuth = await this.tokenResolver.resolveForProject(
          execution.ticket.project_id,
          repositoryUrl,
        );
        pushUrl = resolvedAuth?.authenticatedUrl ?? repositoryUrl;
      }

      // Check if there are changes to commit
      const hasChanges = await this.gitOps.hasChanges(workspace.workspace_path);

      if (!hasChanges) {
        this.logger.warn(
          'No uncommitted changes found in workspace, checking for unpushed commits',
          {
            executionId,
            workspacePath: workspace.workspace_path,
          },
        );

        // Even if there are no uncommitted changes, there may be unpushed commits
        // (e.g., the AI already committed during code generation)
        try {
          await this.gitOps.push(workspace.workspace_path, pushUrl, githubPush.branch_name);
          const currentSha = await this.gitOps.getCurrentCommitSha(workspace.workspace_path);

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

      // Commit and push using direct git operations + AI-generated commit message
      const commitResult = await this.commitAndPushDirect(
        execution,
        githubPush,
        workspace,
        pushUrl, // Pass authenticated URL for push operation
        correlationId,
      );

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
    workspace: { workspace_path: string; repository_url?: string | null },
    pushUrl: string,
    _correlationId?: string,
  ): Promise<CommitOrchestrationResult> {
    this.logger.log('Performing direct git commit and push', {
      executionId: execution.id,
      repository: githubPush.repository,
      branch: githubPush.branch_name,
    });

    const changedFiles = await this.gitOps.getChangedFiles(workspace.workspace_path);

    // 2. Get git diff stat for commit body
    const diffStat = await this.gitOps.getDiff(workspace.workspace_path);

    // 3. Generate commit message — AI first, deterministic fallback
    let commitMessage: string;
    let commitMethod: string;

    try {
      commitMessage = await this.generateAICommitMessage({
        ticketId: execution.ticket.clickup_task_id,
        ticketTitle: execution.ticket.title,
        ticketDescription: execution.ticket.description ?? undefined,
        changedFiles,
        diffStat,
        executionId: execution.id,
        aiProvider: execution.ai_provider,
      });
      commitMethod = 'anthropic_tool_use';
      this.logger.log('AI-generated commit message created', {
        executionId: execution.id,
        messageLength: commitMessage.length,
      });
    } catch (aiError) {
      this.logger.warn('AI commit message generation failed, using deterministic fallback', {
        executionId: execution.id,
        error: (aiError as Error).message,
      });

      // Deterministic fallback
      const metadata = createCommitMessageContext(
        execution.ticket.clickup_task_id,
        execution.ticket.title,
        execution.ticket.description ?? undefined,
        changedFiles,
        execution.ai_provider,
        execution.id,
        execution.confidence_score ?? 80,
      );
      const bodyText = this.buildCommitBody(changedFiles, diffStat);
      commitMessage = buildCommitMessage(metadata, bodyText);
      commitMethod = 'deterministic_fallback';
    }

    // 4. Commit with --no-verify
    const commitSha = await this.gitOps.commit(workspace.workspace_path, commitMessage);

    this.logger.log('Git commit created successfully', {
      executionId: execution.id,
      commitSha,
      filesChanged: changedFiles.length,
      method: commitMethod,
    });

    // 5. Push with --no-verify
    await this.gitOps.push(workspace.workspace_path, pushUrl, githubPush.branch_name);

    this.logger.log('Git push completed successfully', {
      executionId: execution.id,
      commitSha,
      branch: githubPush.branch_name,
    });

    // Story 11.4: Log decision
    await this.aiDecisionLogger.logDecision({
      agentName: 'GitHubCommitOrchestrator',
      action: 'commit_and_push',
      reasoning: `Commit message generated via ${commitMethod} for ${changedFiles.length} changed files. Commit SHA: ${commitSha}.`,
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
        method: commitMethod,
      },
      confidence: commitMethod === 'anthropic_tool_use' ? 0.95 : 0.85,
    });

    return {
      success: true,
      commitSha,
      filesChanged: changedFiles.length,
      commitMessage,
    };
  }

  /**
   * Generate a commit message using Anthropic tool use.
   * Uses the generate_commit_message tool to get a structured response
   * with type, scope, subject, and body — no container needed.
   */
  private async generateAICommitMessage(context: {
    ticketId: string;
    ticketTitle: string;
    ticketDescription?: string;
    changedFiles: string[];
    diffStat: string;
    executionId: string;
    aiProvider: string;
  }): Promise<string> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not configured (missing ANTHROPIC_API_KEY)');
    }

    const { ticketId, ticketTitle, ticketDescription, changedFiles, diffStat } = context;

    const prompt = `You are a senior software engineer reviewing code changes for a commit message.

TICKET:
- ID: ${ticketId}
- Title: ${ticketTitle}
${ticketDescription ? `- Description: ${ticketDescription}` : ''}

CHANGED FILES (${changedFiles.length}):
${changedFiles
  .slice(0, 20)
  .map((f) => `  - ${f}`)
  .join('\n')}
${changedFiles.length > 20 ? `  ... and ${changedFiles.length - 20} more` : ''}

DIFF STAT:
${diffStat || 'No diff stat available'}

Generate a conventional commit message that accurately describes these changes. The commit footer must include "Implements: ${ticketId}" and "AI-Generated: true".`;

    const response = await this.anthropic.messages.create({
      model: this.anthropicModel,
      max_tokens: 500,
      temperature: 0.3,
      tools: [generateCommitMessageTool],
      tool_choice: { type: 'tool' as const, name: 'generate_commit_message' },
      messages: [{ role: 'user', content: prompt }],
    });

    // Extract tool use result (guaranteed by tool_choice)
    const toolUseBlock = response.content.find((block) => block.type === 'tool_use');
    if (!toolUseBlock || toolUseBlock.type !== 'tool_use') {
      throw new Error('Anthropic did not return a tool_use response');
    }

    const input = toolUseBlock.input as GenerateCommitMessageInput;

    // Assemble conventional commit message
    const header = `${input.type}(${input.scope}): ${input.subject}`;
    const footer = `\nImplements: ${ticketId}\nAI-Generated: true\nProvider: ${context.aiProvider}\nExecution-ID: ${context.executionId}`;

    return `${header}\n\n${input.body}\n${footer}`.trim();
  }

  /**
   * Build commit body text from changed files and diff stats (used in deterministic fallback).
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
