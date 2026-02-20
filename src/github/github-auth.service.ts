import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import { GitHubAuthError } from './exceptions/github.exceptions';
import { PrismaService } from '../database/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';

@Injectable()
export class GitHubAuthService {
  private readonly logger = new Logger(GitHubAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Get an authenticated Octokit instance.
   * Prioritizes stored user tokens if installationId is provided,
   * falls back to configured GITHUB_TOKEN (PAT) for MVP/legacy compatibility.
   */
  async getAuthenticatedClient(installationId?: string): Promise<Octokit> {
    try {
      // 1. If installationId is provided, try to find stored token
      if (installationId && installationId !== 'default') {
        const account = await this.prisma.gitHubAccount.findUnique({
          where: { installationId },
        });

        if (account && account.accessToken) {
          const token = this.encryption.decrypt(account.accessToken);
          return new Octokit({ auth: token });
        }

        this.logger.warn(
          `No stored token found for installationId: ${installationId}, falling back to default`,
        );
      }

      // 2. Fallback to PAT (Legacy/MVP)
      const token = this.config.get<string>('github.token');

      if (!token) {
        throw new GitHubAuthError('GitHub token not configured (PAT)');
      }

      return new Octokit({
        auth: token,
      });
    } catch (error: unknown) {
      if (error instanceof GitHubAuthError) throw error;
      throw new GitHubAuthError(
        `Authentication initialization failed: ${(error as Error).message}`,
      );
    }
  }
}
