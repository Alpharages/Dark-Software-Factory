export interface GitHubRepoDetails {
  owner: string;
  name: string;
  defaultBranch: string;
  visibility: 'public' | 'private' | 'internal';
  htmlUrl: string;
}

export interface GitHubFile {
  path: string;
  content: string;
}

export interface AuthenticatedClient {
  octokit: unknown; // Using any for Octokit instance to avoid strict typing issues with different versions/types for now, or import properly if possible
  installationId?: string;
  rateLimitRemaining?: number;
}
