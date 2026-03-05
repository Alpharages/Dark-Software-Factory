import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';

export interface ResolvedGitHubToken {
  /** Plain repository URL with embedded x-access-token credential */
  authenticatedUrl: string;
  /** Username associated with the account — safe to log */
  username: string;
  /** Account UUID — safe to log */
  accountId: string;
}

@Injectable()
export class GitHubTokenResolverService {
  private readonly logger = new Logger(GitHubTokenResolverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Build an authenticated HTTPS clone/push URL for the given project.
   *
   * Returns null if the project has no linked GitHub account
   * (graceful fallback — caller must use plain URL).
   *
   * Throws NotFoundException if the linked account has been deleted.
   * Throws on decryption failure (corrupted data).
   *
   * SECURITY: never log the returned authenticatedUrl or any intermediate token value.
   */
  async resolveForProject(
    projectId: string,
    plainRepositoryUrl: string,
  ): Promise<ResolvedGitHubToken | null> {
    // 1. Load project's github_account_id
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { github_account_id: true },
    });

    if (!project?.github_account_id) {
      this.logger.warn(
        `[TokenResolver] Project ${projectId} has no github_account_id — using plain URL (no per-project auth)`,
      );
      return null;
    }

    const accountId = project.github_account_id;

    // 2. Fetch the linked GitHubAccount
    const account = await this.prisma.gitHubAccount.findUnique({
      where: { id: accountId },
      select: { id: true, username: true, accessToken: true },
    });

    if (!account) {
      throw new NotFoundException(
        `GitHubAccount ${accountId} linked to project ${projectId} no longer exists. ` +
          `PM must re-connect their GitHub account before execution can proceed.`,
      );
    }

    // 3. Decrypt — throws if token data is corrupted
    const decryptedToken = this.encryption.decrypt(account.accessToken);

    // 4. Build authenticated URL (x-access-token convention — works for OAuth user tokens AND fine-grained PATs)
    const authenticatedUrl = plainRepositoryUrl.replace(
      'https://',
      `https://x-access-token:${decryptedToken}@`,
    );

    // SECURITY: do NOT log authenticatedUrl or decryptedToken. Log only account metadata.
    this.logger.log(
      `[TokenResolver] Resolved GitHub token for project ${projectId} via account ${accountId} (${account.username})`,
    );

    // Discard reference to decryptedToken as soon as URL is built
    return { authenticatedUrl, username: account.username, accountId: account.id };
  }
}
