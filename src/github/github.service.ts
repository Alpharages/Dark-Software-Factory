import { Injectable } from '@nestjs/common';
import { GitHubClientService } from './github-client.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { SentryService } from '../common/sentry/sentry.service';
import { LoggerService } from '../common/logger/logger.service';
import { GitHubRepoDetails } from './interfaces/github.interfaces';
import { Octokit } from '@octokit/rest';

@Injectable()
export class GitHubService {
  constructor(
    private readonly clientService: GitHubClientService,
    private readonly auditLog: AuditLogService,
    private readonly sentry: SentryService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Get authenticated Octokit client for direct API access
   * Used by services that need low-level GitHub API operations
   */
  async getAuthenticatedClient(installationId?: string): Promise<Octokit> {
    return this.clientService.getClient(installationId);
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
    const [owner, repo] = repository.split('/');
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
