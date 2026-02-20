import { Injectable, Logger } from '@nestjs/common';
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

    // Using user-to-server flow to identify the PM
    return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo,user`;
  }

  /**
   * Exchanges authorization code for an access token and stores the account
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

    // 3. Fetch installations for this user to get an installationId (if available)
    // IMPROVEMENT: Use the first installation or the user's login as a fallback unique identifier.
    // This prevents '0' collisions for different users without apps installed.
    const { data: installations } = await octokit.apps.listInstallationsForAuthenticatedUser();
    const installationId = installations.installations[0]?.id.toString() || `user_${ghUser.id}`;

    // 4. Encrypt and store/update the account
    const encryptedToken = this.encryption.encrypt(access_token);

    try {
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
        `GitHub Auth Flow: Successfully connected account ${ghUser.login} (ID: ${installationId})`,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`GitHub Auth Flow: Database upsert failed for ${ghUser.login}`, stack);
      throw new Error(`Failed to store GitHub account: ${errorMessage}`);
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
}
