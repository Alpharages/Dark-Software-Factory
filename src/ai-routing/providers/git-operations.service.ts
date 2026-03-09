/**
 * Git Operations Service
 * Story 2.6: AI Provider Integration - Cursor CLI Headless Mode
 *
 * Wrapper for git CLI commands used in workspace management.
 * Handles clone, branch, diff, and other git operations.
 */

import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { appendFile, readFile } from 'fs/promises';
import { join } from 'path';

const execFileAsync = promisify(execFile);

@Injectable()
export class GitOperationsService {
  private readonly logger = new Logger(GitOperationsService.name);

  /** Default timeout for git operations (2 minutes) */
  private readonly DEFAULT_TIMEOUT_MS = 120_000;

  /** Default max buffer for git stdout (50MB) */
  private readonly DEFAULT_MAX_BUFFER = 50 * 1024 * 1024;

  /**
   * Clone a repository to target path
   */
  async clone(
    repositoryUrl: string,
    targetPath: string,
    options: { depth?: number; branch?: string } = {},
  ): Promise<void> {
    const args = ['clone'];

    if (options.depth) {
      args.push('--depth', String(options.depth));
    }
    if (options.branch) {
      args.push('--branch', options.branch);
    }

    args.push(repositoryUrl, targetPath);

    await this.execGit(args, undefined, 'Clone repository');
  }

  /**
   * Configure git user for commits
   */
  async configureUser(workspacePath: string, name: string, email: string): Promise<void> {
    await this.execGit(['config', 'user.name', name], workspacePath, 'Configure git user name');
    await this.execGit(['config', 'user.email', email], workspacePath, 'Configure git user email');
  }

  /**
   * Checkout or create a branch
   */
  async checkoutBranch(
    workspacePath: string,
    branchName: string,
    create: boolean = false,
  ): Promise<void> {
    const args = ['checkout'];
    if (create) {
      args.push('-b');
    }
    args.push(branchName);

    await this.execGit(args, workspacePath, `Checkout branch ${branchName}`);
  }

  /**
   * Paths that should never be committed — package-manager stores, caches,
   * and build artefacts created at runtime inside the workspace
   * (e.g. when the AI agent runs `pnpm install` inside a Docker container).
   */
  private readonly EXCLUDED_PATHS = [
    '.pnpm-store',
    'node_modules',
    '.yarn/cache',
    '.npm',
    '__pycache__',
    '.cache',
  ];

  /**
   * Ensure the workspace `.gitignore` contains entries for runtime artefacts
   * that should never be staged (e.g. `.pnpm-store`).
   */
  private async ensureGitignoreExclusions(workspacePath: string): Promise<void> {
    const gitignorePath = join(workspacePath, '.gitignore');
    let existing = '';
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      existing = await readFile(gitignorePath, 'utf-8');
    } catch {
      // No .gitignore yet — will create one
    }

    const missing = this.EXCLUDED_PATHS.filter(
      (p) => !existing.split('\n').some((line) => line.trim() === p || line.trim() === `/${p}`),
    );

    if (missing.length > 0) {
      const suffix =
        (existing.length > 0 && !existing.endsWith('\n') ? '\n' : '') +
        `\n# Auto-added by DSF (runtime artefacts)\n` +
        missing.map((p) => p).join('\n') +
        '\n';
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await appendFile(gitignorePath, suffix);
      this.logger.debug(`Appended ${missing.length} exclusions to .gitignore`);
    }
  }

  /**
   * Get diff summary of all changes (stat only).
   * Uses --stat to avoid maxBuffer issues with large diffs.
   * The full diff content is not needed — only file names and line counts.
   */
  async getDiff(workspacePath: string): Promise<string> {
    // Ensure runtime artefacts (.pnpm-store, etc.) are ignored before staging
    await this.ensureGitignoreExclusions(workspacePath);

    // Stage all tracked + new files (git respects .gitignore)
    await this.execGit(['add', '-A'], workspacePath, 'Stage all changes');

    // Get stat summary of staged changes (always small output)
    const result = await this.execGit(
      ['diff', '--cached', '--stat'],
      workspacePath,
      'Get staged diff stat',
    );

    return result.stdout;
  }

  /**
   * Get list of changed files (excludes package-manager stores / caches)
   */
  async getChangedFiles(workspacePath: string): Promise<string[]> {
    // Get status in porcelain format for easy parsing
    const result = await this.execGit(
      ['status', '--porcelain'],
      workspacePath,
      'Get changed files',
    );

    const files = result.stdout
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => line.substring(3).trim()) // Remove status prefix (e.g., "M  ", "A  ")
      .filter((file) => !this.EXCLUDED_PATHS.some((p) => file === p || file.startsWith(p + '/')));

    return files;
  }

  /**
   * Create a commit
   * Uses --no-verify to skip pre-commit hooks that may block AI-generated commits
   * (e.g., projects with pre-existing lint errors that trigger hook failures)
   */
  async commit(workspacePath: string, message: string): Promise<string> {
    // Ensure runtime artefacts are ignored before staging
    await this.ensureGitignoreExclusions(workspacePath);

    // Add all changes
    await this.execGit(['add', '-A'], workspacePath, 'Stage changes');

    // Create commit with --no-verify to bypass pre-commit hooks
    await this.execGit(
      ['commit', '--no-verify', '-m', message],
      workspacePath,
      'Create commit (--no-verify)',
    );

    // Get commit SHA
    const shaResult = await this.execGit(['rev-parse', 'HEAD'], workspacePath, 'Get commit SHA');

    return shaResult.stdout.trim();
  }

  /**
   * Push commits to remote repository
   * Uses --no-verify to skip pre-push hooks that may block AI-generated pushes
   * (e.g., projects with pre-existing broken tests that trigger hook failures)
   */
  async push(workspacePath: string, repositoryUrl: string, branchName: string): Promise<void> {
    // Set remote URL (in case it changed or has auth tokens)
    await this.execGit(
      ['remote', 'set-url', 'origin', repositoryUrl],
      workspacePath,
      'Set remote URL',
    );

    // Push to remote with --no-verify to bypass pre-push hooks
    await this.execGit(
      ['push', '--no-verify', 'origin', branchName],
      workspacePath,
      `Push to ${branchName} (--no-verify)`,
    );
  }

  /**
   * Check if there are any changes
   */
  async hasChanges(workspacePath: string): Promise<boolean> {
    const result = await this.execGit(
      ['status', '--porcelain'],
      workspacePath,
      'Check for changes',
    );
    return result.stdout.trim().length > 0;
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(workspacePath: string): Promise<string> {
    const result = await this.execGit(
      ['branch', '--show-current'],
      workspacePath,
      'Get current branch',
    );
    return result.stdout.trim();
  }

  /**
   * Get current HEAD commit SHA
   */
  async getCurrentCommitSha(workspacePath: string): Promise<string> {
    const result = await this.execGit(
      ['rev-parse', 'HEAD'],
      workspacePath,
      'Get current commit SHA',
    );
    return result.stdout.trim();
  }

  /**
   * Ensure we are on the specified branch.
   * If the branch exists locally, switches to it.
   * If not, creates a new branch from the current HEAD.
   */
  async ensureBranch(workspacePath: string, branchName: string): Promise<void> {
    const currentBranch = await this.getCurrentBranch(workspacePath);

    if (currentBranch === branchName) {
      this.logger.debug(`Already on branch ${branchName}`);
      return;
    }

    // Try switching to existing local branch first
    try {
      await this.execGit(['checkout', branchName], workspacePath, `Switch to branch ${branchName}`);
      this.logger.log(`Switched to existing branch ${branchName}`);
      return;
    } catch {
      // Branch doesn't exist locally — create it
    }

    // Try switching to remote tracking branch
    try {
      await this.execGit(
        ['checkout', '-b', branchName, `origin/${branchName}`],
        workspacePath,
        `Checkout remote branch ${branchName}`,
      );
      this.logger.log(`Checked out remote branch ${branchName}`);
      return;
    } catch {
      // Remote branch doesn't exist either — create fresh
    }

    // Create new branch from current HEAD
    await this.execGit(
      ['checkout', '-b', branchName],
      workspacePath,
      `Create new branch ${branchName}`,
    );
    this.logger.log(`Created new branch ${branchName}`);
  }

  /**
   * Reset all changes (discard modifications)
   */
  async resetChanges(workspacePath: string): Promise<void> {
    await this.execGit(['reset', '--hard', 'HEAD'], workspacePath, 'Reset changes');
    await this.execGit(['clean', '-fd'], workspacePath, 'Clean untracked files');
  }

  /**
   * Execute git command safely using execFile (prevents command injection)
   */
  private async execGit(
    args: string[],
    cwd?: string,
    description?: string,
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      this.logger.debug(`${description || 'Git'}: git ${this.sanitizeGitArgs(args)}`);

      // Inject '-c safe.directory=*' to bypass dubious ownership checks.
      // dsf-app runs as root, but workspaces are chowned to agent (1000:1000).
      const safeArgs = ['-c', 'safe.directory=*', ...args];

      const result = await execFileAsync('git', safeArgs, {
        cwd,
        timeout: this.DEFAULT_TIMEOUT_MS,
        maxBuffer: this.DEFAULT_MAX_BUFFER,
      });

      return { stdout: result.stdout, stderr: result.stderr };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const sanitizedError = this.sanitizeErrorMessage(errorMessage);
      this.logger.error(`Git command failed: git ${this.sanitizeGitArgs(args)}`, sanitizedError);
      throw new Error(`Git operation failed: ${sanitizedError}`);
    }
  }

  /**
   * Sanitize git arguments for logging (remove sensitive data)
   */
  private sanitizeGitArgs(args: string[]): string {
    return args
      .map((arg) => {
        // Mask any URL that might contain credentials
        if (arg.includes('@') && (arg.includes('http') || arg.includes('://'))) {
          return arg.replace(/:\/\/[^:]+:[^@]+@/, '://***@');
        }
        return arg;
      })
      .join(' ');
  }

  /**
   * Sanitize error message to remove potential tokens
   */
  private sanitizeErrorMessage(message: string): string {
    // Remove URLs with embedded credentials
    return message
      .replace(/:\/\/[^:]+:[^@]+@/g, '://***@')
      .replace(/x-access-token:[^@\s]+/g, 'x-access-token:***')
      .replace(/ghp_[a-zA-Z0-9]+/g, '***')
      .replace(/ghs_[a-zA-Z0-9]+/g, '***')
      .replace(/github_pat_[a-zA-Z0-9_]+/g, '***');
  }
}
