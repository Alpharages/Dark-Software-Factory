import { Injectable } from '@nestjs/common';
import { GitHubClientService } from './github-client.service';
import { AuditLogService } from '@/common/audit/audit-log.service';
import { PrismaService } from '@/database/prisma.service';
import { SentryService } from '@/common/sentry';
import { LoggerService } from '@/common/logger';
import { GitHubRepoDetails } from './interfaces/github.interfaces';
import { Octokit } from '@octokit/rest';

export interface GitHubPR {
  number: number;
  state: string;
  mergeable: boolean | null;
  merged: boolean;
  html_url: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
}

export interface GitHubMergeResult {
  sha: string;
  merged: boolean;
  message: string;
}

export interface PrMergeRateStats {
  prMergeRate: number;
  totalPrs: number;
  mergedWithoutRework: number;
}

@Injectable()
export class GitHubService {
  constructor(
    private readonly clientService: GitHubClientService,
    private readonly auditLog: AuditLogService,
    private readonly sentry: SentryService,
    private readonly logger: LoggerService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Get authenticated Octokit client for direct API access
   * Used by services that need low-level GitHub API operations
   */
  async getAuthenticatedClient(installationId?: string): Promise<Octokit> {
    return this.clientService.getClient(installationId);
  }

  async getPrMergeRateStats(options?: {
    pmId?: string;
    role?: 'PM' | 'MANAGER' | 'ADMIN';
    days?: number;
  }): Promise<PrMergeRateStats> {
    const { pmId, role = 'MANAGER', days = 30 } = options || {};

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    let executionIdsForScope: string[] | null = null;
    if (role === 'PM' && pmId) {
      const scopedExecutions = await this.prisma.execution.findMany({
        where: {
          ticket: {
            project: {
              pm_id: pmId,
            },
          },
        },
        select: { id: true },
      });
      executionIdsForScope = scopedExecutions.map((execution) => execution.id);
      if (executionIdsForScope.length === 0) {
        return { prMergeRate: 0, totalPrs: 0, mergedWithoutRework: 0 };
      }
    }

    const pushes = await this.prisma.gitHubPush.findMany({
      where: {
        pr_number: { not: null },
        created_at: { gte: since },
        ...(executionIdsForScope
          ? {
              execution_id: { in: executionIdsForScope },
            }
          : {}),
      },
      select: {
        execution_id: true,
        push_status: true,
      },
    });

    if (pushes.length === 0) {
      return { prMergeRate: 0, totalPrs: 0, mergedWithoutRework: 0 };
    }

    // GitHubPush has no Prisma relation to Execution — fetch retry counts separately.
    const executionIds = Array.from(new Set(pushes.map((push) => push.execution_id)));
    const executions = await this.prisma.execution.findMany({
      where: {
        id: { in: executionIds },
      },
      select: {
        id: true,
        retry_count: true,
      },
    });

    const retryCountByExecutionId = new Map(
      executions.map((execution) => [execution.id, execution.retry_count]),
    );

    const mergedWithoutRework = pushes.filter((push) => {
      if (push.push_status !== 'MERGED') {
        return false;
      }
      const retryCount = retryCountByExecutionId.get(push.execution_id) ?? 0;
      return retryCount === 0;
    }).length;

    const totalPrs = pushes.length;
    const prMergeRate = totalPrs > 0 ? mergedWithoutRework / totalPrs : 0;

    return { prMergeRate, totalPrs, mergedWithoutRework };
  }

  async getRepository(
    owner: string,
    repo: string,
    installationId?: string,
  ): Promise<GitHubRepoDetails> {
    return this.clientService.execute(
      async (client: Octokit) => {
        const { data } = await client.repos.get({ owner, repo });
        return {
          owner: data.owner.login,
          name: data.name,
          defaultBranch: data.default_branch,
          visibility: data.visibility as 'public' | 'private' | 'internal',
          htmlUrl: data.html_url,
        };
      },
      installationId,
      'getRepository',
    );
  }

  async createBranch(
    owner: string,
    repo: string,
    branchName: string,
    baseSha: string,
    installationId?: string,
  ): Promise<void> {
    await this.clientService.execute(
      async (client: Octokit) => {
        await client.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${branchName}`,
          sha: baseSha,
        });

        this.logger.log(`Created branch ${branchName} in ${owner}/${repo}`);

        await this.auditLog.log({
          action: 'create_branch',
          entityType: 'github_branch',
          entityId: `${owner}/${repo}/${branchName}`,
          actorType: 'system',
          afterState: { baseSha },
        });
      },
      installationId,
      'createBranch',
    );
  }

  async getBaseCommitSha(
    owner: string,
    repo: string,
    branch: string,
    installationId?: string,
  ): Promise<string> {
    return this.clientService.execute(
      async (client: Octokit) => {
        const { data } = await client.git.getRef({
          owner,
          repo,
          ref: `heads/${branch}`,
        });
        return data.object.sha;
      },
      installationId,
      'getBaseCommitSha',
    );
  }

  async createPullRequest(
    owner: string,
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string,
    installationId?: string,
  ): Promise<unknown> {
    return this.clientService.execute(
      async (client: Octokit) => {
        const { data } = await client.pulls.create({
          owner,
          repo,
          title,
          body,
          head,
          base,
        });

        await this.auditLog.log({
          action: 'create_pr',
          entityType: 'github_pr',
          entityId: `${owner}/${repo}/${data.number}`,
          actorType: 'system',
          afterState: { title, head, base, url: data.html_url },
        });

        return data;
      },
      installationId,
      'createPullRequest',
    );
  }

  async addPRComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
    installationId?: string,
  ): Promise<unknown> {
    return this.clientService.execute(
      async (client: Octokit) => {
        const { data } = await client.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body,
        });
        return data;
      },
      installationId,
      'addPRComment',
    );
  }

  /**
   * Add labels to a PR (creates labels if they don't exist — idempotent).
   * Uses issues API (GitHub PRs are issues under the hood).
   * Swallows label creation 422 ("already_exists") — safe to call multiple times.
   */
  async addLabelsToPR(
    owner: string,
    repo: string,
    prNumber: number,
    labels: string[],
    installationId?: string,
  ): Promise<void> {
    await this.clientService.execute(
      async (client: Octokit) => {
        // Ensure labels exist (idempotent — 422 means already exists, that's fine)
        for (const label of labels) {
          try {
            await client.issues.createLabel({ owner, repo, name: label, color: 'e11d48' });
          } catch (err: unknown) {
            // 422 = label already exists — expected and safe to ignore
            // Other errors (401/403/429) are unexpected — log a warning so they surface
            const status = (err as { status?: number })?.status;
            if (status !== 422) {
              this.logger.warn(
                `addLabelsToPR: createLabel("${label}") failed with status ${status ?? 'unknown'} — proceeding`,
              );
            }
          }
        }
        await client.issues.addLabels({ owner, repo, issue_number: prNumber, labels });
      },
      installationId,
      'addLabelsToPR',
    );
  }

  async getPullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    installationId?: string,
  ): Promise<GitHubPR> {
    return this.clientService.execute(
      async (client: Octokit) => {
        const { data } = await client.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
        });
        return data as unknown as GitHubPR;
      },
      installationId,
      'getPullRequest',
    );
  }

  async mergePullRequest(
    owner: string,
    repo: string,
    prNumber: number,
    mergeMethod: 'merge' | 'squash' | 'rebase' = 'squash',
    installationId?: string,
  ): Promise<GitHubMergeResult> {
    return this.clientService.execute(
      async (client: Octokit) => {
        const { data } = await client.pulls.merge({
          owner,
          repo,
          pull_number: prNumber,
          merge_method: mergeMethod,
        });

        await this.auditLog.log({
          action: 'merge_pr',
          entityType: 'github_pr',
          entityId: `${owner}/${repo}/${prNumber}`,
          actorType: 'system',
          afterState: { mergeMethod, sha: data.sha, message: data.message },
        });

        return data as unknown as GitHubMergeResult;
      },
      installationId,
      'mergePullRequest',
    );
  }

  async pushCommit(
    owner: string,
    repo: string,
    branch: string,
    files: Array<{ path: string; content: string }>,
    message: string,
    installationId?: string,
  ): Promise<void> {
    await this.clientService.execute(
      async (client: Octokit) => {
        // 1. Get current commit SHA

        const { data: refData } = await client.git.getRef({
          owner,
          repo,
          ref: `heads/${branch}`,
        });
        const currentCommitSha = refData.object.sha;

        // 2. Get current tree SHA

        const { data: commitData } = await client.git.getCommit({
          owner,
          repo,
          commit_sha: currentCommitSha,
        });
        const currentTreeSha = commitData.tree.sha;

        // 3. Create blobs for each file
        const blobs = await Promise.all(
          files.map(async (file) => {
            const { data: blobData } = await client.git.createBlob({
              owner,
              repo,
              content: file.content,
              encoding: 'utf-8',
            });
            return {
              path: file.path,
              mode: '100644' as const,
              type: 'blob' as const,
              sha: blobData.sha,
            };
          }),
        );

        // 4. Create new tree

        const { data: treeData } = await client.git.createTree({
          owner,
          repo,
          base_tree: currentTreeSha,
          tree: blobs,
        });
        const newTreeSha = treeData.sha;

        // 5. Create new commit

        const { data: newCommitData } = await client.git.createCommit({
          owner,
          repo,
          message,
          tree: newTreeSha,
          parents: [currentCommitSha],
        });
        const newCommitSha = newCommitData.sha;

        // 6. Update reference
        await client.git.updateRef({
          owner,
          repo,
          ref: `heads/${branch}`,
          sha: newCommitSha,
        });

        this.logger.log(`Pushed commit to ${owner}/${repo}/${branch}: ${message}`);

        await this.auditLog.log({
          action: 'push_commit',
          entityType: 'github_commit',
          entityId: `${owner}/${repo}/${newCommitSha}`,
          actorType: 'system',
          afterState: { branch, fileCount: files.length, message },
        });
      },
      installationId,
      'pushCommit',
    );
  }

  async updateCommitStatus(
    owner: string,
    repo: string,
    sha: string,
    state: 'error' | 'failure' | 'pending' | 'success',
    context: string,
    description?: string,
    targetUrl?: string,
    installationId?: string,
  ): Promise<void> {
    await this.clientService.execute(
      async (client: Octokit) => {
        await client.repos.createCommitStatus({
          owner,
          repo,
          sha,
          state,
          context,
          description,
          target_url: targetUrl,
        });

        await this.auditLog.log({
          action: 'update_commit_status',
          entityType: 'github_commit_status',
          entityId: `${owner}/${repo}/${sha}`,
          actorType: 'system',
          afterState: { state, context },
        });
      },
      installationId,
      'updateCommitStatus',
    );
  }

  /**
   * Get the diff of a pull request
   */
  async getPullRequestDiff(
    repository: string,
    prNumber: number,
    installationId?: string,
  ): Promise<string> {
    const clean = repository.replace(/\.git$/, '');
    const urlMatch = clean.match(/github\.com\/([^/]+)\/([^/]+)/);
    const [owner, repo] = urlMatch ? [urlMatch[1], urlMatch[2]] : repository.split('/');
    return this.clientService.execute(
      async (client: Octokit) => {
        const { data } = await client.pulls.get({
          owner,
          repo,
          pull_number: prNumber,
          headers: {
            accept: 'application/vnd.github.v3.diff',
          },
        });
        return data as unknown as string;
      },
      installationId,
      'getPullRequestDiff',
    );
  }
}
