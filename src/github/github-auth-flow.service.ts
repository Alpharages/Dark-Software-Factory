import { Injectable, Logger, ForbiddenException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { EncryptionService } from '../common/encryption/encryption.service';
import { Octokit } from '@octokit/rest';
import axios from 'axios';

@Injectable()
export class GitHubAuthFlowService {
  private readonly logger = new Logger(GitHubAuthFlowService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Generates the GitHub OAuth URL for App installation/authorization
   */
  getOAuthUrl(): string {
    const clientId = this.config.get<string>('github.clientId');
    if (!clientId) {
      throw new Error('GITHUB_CLIENT_ID not configured');
    }

    const redirectUri = `${this.config.get<string>('FRONTEND_URL')}/settings/github/callback`;

    // Using user-to-server flow to identify the PM.
    // GitHub Apps don't use 'scope' parameter for user-to-server tokens,
    // they inherit the App's permissions, fulfilling NFR-S11.
    return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }

  /**
   * Exchanges authorization code for an access token and stores the account(s)
   */
  async handleCallback(code: string, userId: string): Promise<void> {
    const clientId = this.config.get<string>('github.clientId');
    const clientSecret = this.config.get<string>('github.clientSecret');

    if (!clientId || !clientSecret) {
      throw new Error('GitHub OAuth credentials not configured');
    }

    // 1. Exchange code for token
    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${this.config.get<string>('FRONTEND_URL')}/settings/github/callback`,
      },
      {
        headers: { Accept: 'application/json' },
      },
    );

    const { access_token } = tokenResponse.data;

    if (!access_token) {
      throw new Error('Failed to obtain access token from GitHub');
    }

    // 2. Fetch user profile from GitHub
    const octokit = new Octokit({ auth: access_token });
    const { data: ghUser } = await octokit.users.getAuthenticated();

    // 3. Fetch installations for this user to save every connected App installation
    const { data: installations } = await octokit.apps.listInstallationsForAuthenticatedUser();

    // 4. Encrypt and store/update the account(s)
    const encryptedToken = this.encryption.encrypt(access_token);

    try {
      if (installations.installations.length === 0) {
        // Fallback for user without any installations yet
        const installationId = `user_${ghUser.id}`;
        await this.prisma.gitHubAccount.upsert({
          where: { installationId },
          update: {
            accessToken: encryptedToken,
            username: ghUser.login,
            avatarUrl: ghUser.avatar_url,
            userId,
          },
          create: {
            userId,
            installationId,
            accessToken: encryptedToken,
            username: ghUser.login,
            avatarUrl: ghUser.avatar_url,
          },
        });
        this.logger.log(
          `GitHub Auth Flow: Successfully connected fallback personal account ${ghUser.login} (ID: ${installationId})`,
        );
      } else {
        // Iterate over all installations to capture each org/account accurately
        for (const installation of installations.installations) {
          const installationId = installation.id.toString();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const targetAccount: any = installation.account || {};
          const username = targetAccount.login || ghUser.login;
          const avatarUrl = targetAccount.avatar_url || ghUser.avatar_url;

          await this.prisma.gitHubAccount.upsert({
            where: { installationId },
            update: {
              accessToken: encryptedToken,
              username,
              avatarUrl,
              userId,
            },
            create: {
              userId,
              installationId,
              accessToken: encryptedToken,
              username,
              avatarUrl,
            },
          });
          this.logger.log(
            `GitHub Auth Flow: Successfully connected installation account ${username} (ID: ${installationId})`,
          );
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `GitHub Auth Flow: Database upsert failed for installations tied to ${ghUser.login}`,
        stack,
      );
      throw new Error(`Failed to store GitHub accounts: ${errorMessage}`);
    }
  }

  async getConnectedAccounts(userId: string) {
    return this.prisma.gitHubAccount.findMany({
      where: { userId },
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        installationId: true,
        updatedAt: true,
      },
    });
  }

  async getReposForAccount(accountId: string, userId: string) {
    const account = await this.prisma.gitHubAccount.findUnique({
      where: { id: accountId },
    });

    if (!account || account.userId !== userId) {
      throw new ForbiddenException('Not your account');
    }

    const token = this.encryption.decrypt(account.accessToken);
    const octokit = new Octokit({ auth: token });

    try {
      const data = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
        per_page: 100,
        type: 'all',
      });

      return data.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        private: r.private,
        htmlUrl: r.html_url,
      }));
    } catch (err: unknown) {
      const error = err as Error;
      this.logger.error(`GitHub API error: ${error.message}`, error.stack);
      throw new HttpException('GitHub API error: ' + error.message, 502);
    }
  }
}
