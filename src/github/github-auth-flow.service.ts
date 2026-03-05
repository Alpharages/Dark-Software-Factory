import {
  Injectable,
  Logger,
  ForbiddenException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
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
    const appSlug = this.config.get<string>('github.appSlug');

    if (appSlug) {
      // GitHub App installation URL — shows the repo/org selection page.
      // Users can choose "All repositories" or specific repos, and pick which org to install on.
      // After installation GitHub redirects back with an installation_id instead of a code.
      // We append redirect_uri so GitHub sends the user back after installation.
      return `https://github.com/apps/${appSlug}/installations/new?redirect_uri=${encodeURIComponent(redirectUri)}`;
    }

    // Fallback: plain OAuth user-authorization URL with repo + read:org scopes.
    // This does NOT show a repo-selection screen. Only used if GITHUB_APP_SLUG is not set.
    return `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo,read:org`;
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
        // Fallback: store the personal account
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

        // Also store one entry per org the user belongs to so they appear in the account dropdown
        const orgs = await octokit.paginate(octokit.orgs.listForAuthenticatedUser, {
          per_page: 100,
        });
        for (const org of orgs) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const orgAny = org as any;
          const orgInstallationId = `org_${orgAny.id}`;
          await this.prisma.gitHubAccount.upsert({
            where: { installationId: orgInstallationId },
            update: {
              accessToken: encryptedToken,
              username: orgAny.login,
              avatarUrl: orgAny.avatar_url ?? null,
              userId,
            },
            create: {
              userId,
              installationId: orgInstallationId,
              accessToken: encryptedToken,
              username: orgAny.login,
              avatarUrl: orgAny.avatar_url ?? null,
            },
          });
          this.logger.log(
            `GitHub Auth Flow: Stored org account ${orgAny.login} (ID: ${orgInstallationId})`,
          );
        }
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

  async disconnectAccount(
    accountId: string,
    userId: string,
  ): Promise<{ message: string; affectedProjects: number }> {
    const account = await this.prisma.gitHubAccount.findUnique({
      where: { id: accountId },
      include: { projects: { select: { id: true } } },
    });

    if (!account) {
      throw new NotFoundException(`GitHub account ${accountId} not found.`);
    }

    if (account.userId !== userId) {
      throw new ForbiddenException('You do not own this GitHub account.');
    }

    const affectedProjects = account.projects.length;

    try {
      await this.prisma.gitHubAccount.delete({ where: { id: accountId } });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to delete GitHub account ${accountId} (${account.username}) for user ${userId}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new Error(`Failed to disconnect GitHub account: ${errorMessage}`);
    }

    this.logger.log(
      `GitHub account ${accountId} (${account.username}) disconnected by user ${userId}. ` +
        `${affectedProjects} project(s) affected.`,
    );

    return {
      message: `GitHub account @${account.username} disconnected successfully.`,
      affectedProjects,
    };
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
      // 1. User's own repos (owned + direct collaborator)
      const userRepos = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
        per_page: 100,
        type: 'all',
      });

      // 2. Fetch all orgs the user belongs to, then their repos
      const orgs = await octokit.paginate(octokit.orgs.listForAuthenticatedUser, {
        per_page: 100,
      });

      const orgRepoArrays = await Promise.all(
        orgs.map((org) =>
          octokit.paginate(octokit.repos.listForOrg, {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            org: (org as any).login as string,
            per_page: 100,
            type: 'all',
          }),
        ),
      );

      // 3. Merge + deduplicate by repo id
      const seenIds = new Set<number>();
      const data = [...userRepos, ...orgRepoArrays.flat()].filter((r) => {
        if (seenIds.has(r.id)) return false;
        seenIds.add(r.id);
        return true;
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
