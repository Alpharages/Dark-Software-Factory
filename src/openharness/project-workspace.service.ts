import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { PrismaService } from '@/database/prisma.service';
import { EncryptionService } from '@/common/encryption/encryption.service';

export interface ResolvedWorkspace {
  /** Directory the agent should run in (a clone of the project repo, or fallback). */
  dir: string;
  /** Resolved project, or null when no per-project repo could be resolved. */
  project: { id: string; repositoryUrl: string; defaultBranch: string } | null;
}

/**
 * Resolves the git working directory for an OpenHarness run.
 *
 * Before the OpenHarness pivot wired this in, every run executed inside
 * `process.cwd()` (the DSF backend repo) regardless of which project the ticket
 * belonged to — so generated code was committed into the wrong repository and
 * never reached the project's GitHub remote. This service clones the ticket's
 * own project repo (idempotently, one clone per project) and returns that path,
 * so the agent works in — and the branch is later pushed to — the correct repo.
 *
 * Dependency-light by design (Prisma + the global EncryptionService only): it
 * must NOT pull in the GitHub or GitMirror modules, which would close the
 * OpenHarness → GitHub → ApprovalGate → Dispatcher → OpenHarness module cycle.
 */
@Injectable()
export class ProjectWorkspaceService {
  private readonly logger = new Logger(ProjectWorkspaceService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Ensure a local clone of the ticket's project repo exists and is up to date,
   * returning its path. Falls back to `fallbackDir` only when the project has no
   * repository configured; if a repo IS configured but cloning fails, this throws
   * so the run fails loudly rather than committing into the wrong repository.
   */
  async resolveWorkspaceDir(ticketId: string, fallbackDir: string): Promise<ResolvedWorkspace> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        project: {
          select: {
            id: true,
            github_repository_url: true,
            default_branch: true,
            gitHubAccount: { select: { accessToken: true } },
          },
        },
      },
    });

    const project = ticket?.project;
    if (!project?.github_repository_url) {
      this.logger.warn(
        `Ticket ${ticketId} has no project repository configured — using fallback workspace ${fallbackDir}`,
      );
      return { dir: fallbackDir, project: null };
    }

    const plainUrl = this.normalizeHttpsUrl(project.github_repository_url);
    const defaultBranch = project.default_branch || 'main';
    const clonePath = path.join(this.workspacesRoot(), project.id);
    const authUrl = this.buildAuthenticatedUrl(
      plainUrl,
      project.gitHubAccount?.accessToken ?? null,
    );

    try {
      if (this.isGitRepo(clonePath)) {
        this.refreshClone(clonePath, authUrl, defaultBranch);
      } else {
        this.createClone(clonePath, authUrl, plainUrl, defaultBranch);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Never let a token leak through an error message (auth URL embeds it).
      throw new Error(
        `Failed to prepare project workspace for ${project.id}: ${this.redact(message)}`,
      );
    }

    return {
      dir: clonePath,
      project: { id: project.id, repositoryUrl: plainUrl, defaultBranch },
    };
  }

  private workspacesRoot(): string {
    return (
      this.config.get<string>('openharness.projectWorkspacesRoot') ||
      path.join(os.tmpdir(), 'dsf-project-workspaces')
    );
  }

  private isGitRepo(dir: string): boolean {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    return fs.existsSync(path.join(dir, '.git'));
  }

  private createClone(
    clonePath: string,
    authUrl: string,
    plainUrl: string,
    defaultBranch: string,
  ): void {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    fs.mkdirSync(path.dirname(clonePath), { recursive: true });
    this.git(['clone', '--branch', defaultBranch, authUrl, clonePath]);
    // Drop the token-bearing URL from the persisted remote; pushes/fetches always
    // pass a freshly-built authenticated URL explicitly.
    this.git(['-C', clonePath, 'remote', 'set-url', 'origin', plainUrl]);
    this.logger.log(`Cloned project repo into ${clonePath} (branch ${defaultBranch})`);
  }

  private refreshClone(clonePath: string, authUrl: string, defaultBranch: string): void {
    // Best-effort refresh so new branches fork from the latest default-branch tip.
    this.git(['-C', clonePath, 'fetch', '--prune', authUrl, defaultBranch]);
    this.git(['-C', clonePath, 'checkout', defaultBranch]);
    this.git(['-C', clonePath, 'reset', '--hard', 'FETCH_HEAD']);
    this.logger.debug(`Refreshed project clone ${clonePath} to latest ${defaultBranch}`);
  }

  private git(args: string[]): void {
    execFileSync('git', args, {
      stdio: 'pipe',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
    });
  }

  /** Convert an ssh/scp-form GitHub URL to https; pass https/other through. */
  private normalizeHttpsUrl(url: string): string {
    const scp = url.match(/^git@github\.com:(.+?)(?:\.git)?$/);
    if (scp) return `https://github.com/${scp[1]}.git`;
    const ssh = url.match(/^ssh:\/\/git@github\.com\/(.+?)(?:\.git)?$/);
    if (ssh) return `https://github.com/${ssh[1]}.git`;
    return url;
  }

  private buildAuthenticatedUrl(plainHttpsUrl: string, encryptedToken: string | null): string {
    if (!plainHttpsUrl.startsWith('https://')) return plainHttpsUrl;
    let token: string | undefined;
    if (encryptedToken) {
      try {
        token = this.encryption.decrypt(encryptedToken);
      } catch {
        this.logger.warn('Failed to decrypt project GitHub token — falling back to global token');
      }
    }
    token = token || this.config.get<string>('github.token') || undefined;
    if (!token) return plainHttpsUrl;
    return plainHttpsUrl.replace('https://', `https://x-access-token:${token}@`);
  }

  /** Strip any embedded credentials from a string before it is logged/thrown. */
  private redact(message: string): string {
    return message.replace(/https:\/\/[^@\s]+@/g, 'https://***@');
  }
}
