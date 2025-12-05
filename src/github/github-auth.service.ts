import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';
import { GitHubAuthError } from './exceptions/github.exceptions';

@Injectable()
export class GitHubAuthService {
  constructor(private readonly config: ConfigService) {}

  /**
   * Get an authenticated Octokit instance using PAT (MVP)
   * Future: Switch to GitHub App auth based on installationId
   */
  async getAuthenticatedClient(_installationId?: string): Promise<Octokit> {
    try {
      // Phase 1: PAT Authentication only
      const token = this.config.get<string>('github.token');

      if (!token) {
        throw new GitHubAuthError('GitHub token not configured');
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
