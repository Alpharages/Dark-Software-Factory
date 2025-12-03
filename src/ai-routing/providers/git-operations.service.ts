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

const execFileAsync = promisify(execFile);

@Injectable()
export class GitOperationsService {
  private readonly logger = new Logger(GitOperationsService.name);

  /** Default timeout for git operations (2 minutes) */
  private readonly DEFAULT_TIMEOUT_MS = 120_000;

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
   * Get diff of all changes
   */
  async getDiff(workspacePath: string): Promise<string> {
    // First add all files to staging to capture new files
    await this.execGit(['add', '-A'], workspacePath, 'Stage all changes');

    // Get diff of staged changes
    const result = await this.execGit(['diff', '--cached'], workspacePath, 'Get staged diff');

    return result.stdout;
  }

  /**
   * Get list of changed files
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
      .map((line) => line.substring(3).trim()); // Remove status prefix (e.g., "M  ", "A  ")

    return files;
  }

  /**
   * Create a commit
   */
  async commit(workspacePath: string, message: string): Promise<string> {
    // Add all changes
    await this.execGit(['add', '-A'], workspacePath, 'Stage changes');

    // Create commit
    await this.execGit(['commit', '-m', message], workspacePath, 'Create commit');

    // Get commit SHA
    const shaResult = await this.execGit(['rev-parse', 'HEAD'], workspacePath, 'Get commit SHA');

    return shaResult.stdout.trim();
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
      this.logger.debug(`${description || 'Git'}: git ${args.join(' ')}`);

      const result = await execFileAsync('git', args, {
        cwd,
        timeout: this.DEFAULT_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large diffs
      });

      return { stdout: result.stdout, stderr: result.stderr };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Git command failed: git ${args.join(' ')}`, errorMessage);
      throw new Error(`Git operation failed: ${errorMessage}`);
    }
  }
}
