import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'child_process';
import { PrismaService } from '@/database/prisma.service';
import { GitHubStatus } from '@/prisma/client';
import { GitHubTokenResolverService } from '../github-token-resolver.service';

export interface PushBranchParams {
  executionId: string;
  projectId: string;
  /** Persistent repo dir the branch ref lives in (the per-project clone). */
  repoDir: string;
  /** Branch to push, e.g. `ohp/<clickupTaskId>`. */
  branch: string;
  /** Plain GitHub repository URL (stored on the GitHubPush record). */
  repositoryUrl: string;
}

export interface PushBranchResult {
  pushed: boolean;
  /** Reason when `pushed` is false (e.g. 'no-commits', 'branch-missing'). */
  skippedReason?: string;
  commitSha?: string;
  gitHubPushId?: string;
}

/**
 * Pushes an execution's committed branch to its project's GitHub remote and
 * records a {@link GitHubPush} row (status BRANCH_CREATED) that the PR-creation
 * and approval-gate flows consume. This is the step that was missing after the
 * OpenHarness pivot: the agent committed to a local `ohp/<taskId>` branch that
 * was never pushed, so code never reached GitHub. No PR is opened here.
 */
@Injectable()
export class GitHubBranchPushService {
  private readonly logger = new Logger(GitHubBranchPushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tokenResolver: GitHubTokenResolverService,
  ) {}

  async pushExecutionBranch(params: PushBranchParams): Promise<PushBranchResult> {
    const { executionId, projectId, repoDir, branch, repositoryUrl } = params;

    if (!this.refExists(repoDir, branch)) {
      this.logger.warn(
        `[${executionId}] Branch ${branch} not found in ${repoDir} — nothing to push`,
      );
      return { pushed: false, skippedReason: 'branch-missing' };
    }

    const defaultBranch = await this.resolveDefaultBranch(projectId);
    if (this.commitsAhead(repoDir, defaultBranch, branch) === 0) {
      this.logger.log(
        `[${executionId}] Branch ${branch} has no commits ahead of ${defaultBranch} — skipping push`,
      );
      return { pushed: false, skippedReason: 'no-commits' };
    }

    const commitSha = this.git(repoDir, ['rev-parse', branch]).trim();
    const authUrl = await this.resolveAuthUrl(projectId, repositoryUrl);

    try {
      this.git(repoDir, [
        'push',
        '--force-with-lease',
        authUrl,
        `refs/heads/${branch}:refs/heads/${branch}`,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`[${executionId}] git push of ${branch} failed: ${this.redact(message)}`);
    }

    const gitHubPushId = await this.upsertPushRecord(executionId, repositoryUrl, branch, commitSha);
    this.logger.log(
      `[${executionId}] Pushed ${branch} (${commitSha.slice(0, 8)}) to ${repositoryUrl}`,
    );
    return { pushed: true, commitSha, gitHubPushId };
  }

  private async resolveDefaultBranch(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { default_branch: true },
    });
    return project?.default_branch || 'main';
  }

  private async resolveAuthUrl(projectId: string, repositoryUrl: string): Promise<string> {
    try {
      const resolved = await this.tokenResolver.resolveForProject(projectId, repositoryUrl);
      if (resolved?.authenticatedUrl) return resolved.authenticatedUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Per-project token resolution failed (${message}) — using global token`);
    }
    const token = this.config.get<string>('github.token');
    if (token && repositoryUrl.startsWith('https://')) {
      return repositoryUrl.replace('https://', `https://x-access-token:${token}@`);
    }
    return repositoryUrl;
  }

  private async upsertPushRecord(
    executionId: string,
    repository: string,
    branchName: string,
    commitSha: string,
  ): Promise<string> {
    const existing = await this.prisma.gitHubPush.findFirst({
      where: { execution_id: executionId, branch_name: branchName },
      orderBy: { created_at: 'desc' },
    });
    if (existing) {
      const updated = await this.prisma.gitHubPush.update({
        where: { id: existing.id },
        data: {
          commit_sha: commitSha,
          push_status: GitHubStatus.BRANCH_CREATED,
          error_message: null,
        },
      });
      return updated.id;
    }
    const created = await this.prisma.gitHubPush.create({
      data: {
        execution_id: executionId,
        repository,
        branch_name: branchName,
        commit_sha: commitSha,
        push_status: GitHubStatus.BRANCH_CREATED,
      },
    });
    return created.id;
  }

  private refExists(repoDir: string, branch: string): boolean {
    try {
      this.git(repoDir, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  private commitsAhead(repoDir: string, base: string, branch: string): number {
    try {
      const out = this.git(repoDir, ['rev-list', '--count', `${base}..${branch}`]).trim();
      return parseInt(out, 10) || 0;
    } catch {
      // If the base ref is unknown locally, assume there is something to push
      // rather than silently dropping the branch.
      return 1;
    }
  }

  private git(repoDir: string, args: string[]): string {
    return execFileSync('git', ['-C', repoDir, ...args], {
      stdio: 'pipe',
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
    });
  }

  private redact(message: string): string {
    return message.replace(/https:\/\/[^@\s]+@/g, 'https://***@');
  }
}
