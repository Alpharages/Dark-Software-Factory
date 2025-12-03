/**
 * Workspace Service
 * Story 2.6: AI Provider Integration - Cursor CLI Headless Mode
 *
 * Manages isolated workspaces for AI code generation.
 * Each execution gets its own workspace to prevent conflicts.
 *
 * Architecture Reference: Workspace Isolation Strategy
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Gauge, Counter } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import * as fs from 'fs/promises';
import * as path from 'path';
import { IWorkspaceInfo, AIErrorCode, IAIExecutionError } from '../interfaces';
import { GitOperationsService } from './git-operations.service';

@Injectable()
export class WorkspaceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceService.name);

  /** Active workspaces map */
  private readonly workspaces: Map<string, IWorkspaceInfo> = new Map();

  /** Cleanup interval reference */
  private cleanupIntervalId?: NodeJS.Timeout;

  /** Configuration */
  private workspacesRoot!: string;
  private maxConcurrent!: number;
  private preserveFailed!: boolean;
  private cleanupAgeMs!: number;
  private gitUserName!: string;
  private gitUserEmail!: string;

  constructor(
    private readonly config: ConfigService,
    private readonly git: GitOperationsService,
    @InjectMetric('cursor_workspaces_active')
    private readonly activeGauge: Gauge<string>,
    @InjectMetric('cursor_workspace_operations_total')
    private readonly operationsCounter: Counter<string>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.workspacesRoot = this.config.get<string>(
      'cursor.workspacesRoot',
      '/tmp/cursor-workspaces',
    );
    this.maxConcurrent = this.config.get<number>('cursor.maxConcurrentWorkspaces', 10);
    this.preserveFailed = this.config.get<boolean>('cursor.preserveFailedWorkspaces', true);
    this.cleanupAgeMs = this.config.get<number>(
      'cursor.workspaceCleanupAgeMs',
      7 * 24 * 60 * 60 * 1000, // 7 days
    );
    this.gitUserName = this.config.get<string>('cursor.gitUserName', 'Dark Factory');
    this.gitUserEmail = this.config.get<string>('cursor.gitUserEmail', 'bot@darkfactory.ai');

    // Ensure workspace root exists
    await fs.mkdir(this.workspacesRoot, { recursive: true });

    this.logger.log(
      `Workspace service initialized: root=${this.workspacesRoot}, maxConcurrent=${this.maxConcurrent}`,
    );

    // Start periodic cleanup
    this.startCleanupScheduler();
  }

  async onModuleDestroy(): Promise<void> {
    // Clear cleanup interval to prevent memory leaks
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = undefined;
    }
    this.logger.log('Workspace service destroyed, cleanup scheduler stopped');
  }

  /**
   * Create a new isolated workspace for execution
   */
  async createWorkspace(
    executionId: string,
    ticketId: string,
    repositoryUrl: string,
    _baseBranch: string = 'main',
  ): Promise<IWorkspaceInfo> {
    // Check concurrency limit
    if (this.workspaces.size >= this.maxConcurrent) {
      throw this.createError(
        AIErrorCode.WORKSPACE_LIMIT,
        `Maximum concurrent workspaces (${this.maxConcurrent}) reached`,
        false,
      );
    }

    // Sanitize ticketId to prevent path traversal attacks
    const sanitizedTicketId = ticketId.replace(/[^a-zA-Z0-9-_]/g, '_');
    const workspaceId = `ticket-${sanitizedTicketId}-${Date.now()}`;
    const workspacePath = path.join(this.workspacesRoot, workspaceId);
    const branchName = `feature/ticket-${ticketId}`;

    const workspace: IWorkspaceInfo = {
      id: workspaceId,
      path: workspacePath,
      ticketId,
      executionId,
      repositoryUrl,
      branchName,
      createdAt: new Date(),
      status: 'CREATING',
    };

    this.workspaces.set(executionId, workspace);
    this.updateMetrics();

    try {
      this.logger.log(`[${executionId}] Creating workspace: ${workspacePath}`);

      // 1. Create directory
      await fs.mkdir(workspacePath, { recursive: true });

      // 2. Clone repository (shallow clone for speed)
      await this.git.clone(repositoryUrl, workspacePath, { depth: 1 });

      // 3. Configure git user for commits
      await this.git.configureUser(workspacePath, this.gitUserName, this.gitUserEmail);

      // 4. Create feature branch
      await this.git.checkoutBranch(workspacePath, branchName, true);

      workspace.status = 'READY';
      this.operationsCounter.inc({ operation: 'create', status: 'success' });

      this.logger.log(`[${executionId}] Workspace ready: ${workspacePath}`);
      return workspace;
    } catch (error: unknown) {
      workspace.status = 'FAILED';
      this.operationsCounter.inc({ operation: 'create', status: 'error' });

      // Cleanup failed workspace
      await this.cleanupWorkspace(executionId, true);

      const errorMessage = error instanceof Error ? error.message : String(error);
      throw this.createError(
        AIErrorCode.CLONE_FAILED,
        `Failed to create workspace: ${errorMessage}`,
        true,
        errorMessage,
      );
    }
  }

  /**
   * Get workspace info by execution ID
   */
  getWorkspace(executionId: string): IWorkspaceInfo | undefined {
    return this.workspaces.get(executionId);
  }

  /**
   * Update workspace status
   */
  updateWorkspaceStatus(executionId: string, status: IWorkspaceInfo['status']): void {
    const workspace = this.workspaces.get(executionId);
    if (workspace) {
      workspace.status = status;
    }
  }

  /**
   * Extract changes from workspace (git diff)
   */
  async extractChanges(executionId: string): Promise<{
    diff: string;
    filesChanged: string[];
  }> {
    const workspace = this.workspaces.get(executionId);
    if (!workspace) {
      throw new Error(`Workspace not found: ${executionId}`);
    }

    try {
      // Get diff against HEAD (captures all uncommitted changes)
      const diff = await this.git.getDiff(workspace.path);

      // Get list of changed files
      const filesChanged = await this.git.getChangedFiles(workspace.path);

      return { diff, filesChanged };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw this.createError(
        AIErrorCode.GIT_ERROR,
        `Failed to extract changes: ${errorMessage}`,
        false,
      );
    }
  }

  /**
   * Cleanup workspace after execution
   */
  async cleanupWorkspace(executionId: string, force: boolean = false): Promise<void> {
    const workspace = this.workspaces.get(executionId);
    if (!workspace) {
      return;
    }

    // Preserve failed workspaces if configured
    if (workspace.status === 'FAILED' && this.preserveFailed && !force) {
      this.logger.log(
        `[${executionId}] Preserving failed workspace for debugging: ${workspace.path}`,
      );
      return;
    }

    workspace.status = 'CLEANING';

    try {
      await fs.rm(workspace.path, { recursive: true, force: true });
      this.logger.log(`[${executionId}] Workspace cleaned: ${workspace.path}`);
      this.operationsCounter.inc({ operation: 'cleanup', status: 'success' });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[${executionId}] Failed to cleanup workspace: ${errorMessage}`);
      this.operationsCounter.inc({ operation: 'cleanup', status: 'error' });
      // Don't throw - cleanup failures shouldn't block execution
    } finally {
      this.workspaces.delete(executionId);
      this.updateMetrics();
    }
  }

  /**
   * Get all active workspaces
   */
  getActiveWorkspaces(): IWorkspaceInfo[] {
    return Array.from(this.workspaces.values());
  }

  /**
   * Get workspace count
   */
  getActiveCount(): number {
    return this.workspaces.size;
  }

  /**
   * Check disk space availability
   */
  async checkDiskSpace(): Promise<{ available: boolean; usedMB: number }> {
    try {
      const stats = await fs.statfs(this.workspacesRoot);
      const availableMB = (stats.bavail * stats.bsize) / (1024 * 1024);
      const minRequiredMB = 500; // Require at least 500MB free

      return {
        available: availableMB > minRequiredMB,
        usedMB: ((stats.blocks - stats.bfree) * stats.bsize) / (1024 * 1024),
      };
    } catch {
      // If statfs fails, assume space is available
      return { available: true, usedMB: 0 };
    }
  }

  /**
   * Start periodic cleanup of old workspaces
   */
  private startCleanupScheduler(): void {
    // Run cleanup every hour
    this.cleanupIntervalId = setInterval(
      async () => {
        await this.cleanupOldWorkspaces();
      },
      60 * 60 * 1000,
    );
  }

  /**
   * Cleanup workspaces older than configured age
   */
  private async cleanupOldWorkspaces(): Promise<void> {
    try {
      const entries = await fs.readdir(this.workspacesRoot, { withFileTypes: true });
      const now = Date.now();

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const dirPath = path.join(this.workspacesRoot, entry.name);
        const stats = await fs.stat(dirPath);
        const ageMs = now - stats.mtime.getTime();

        if (ageMs > this.cleanupAgeMs) {
          this.logger.log(`Cleaning up old workspace: ${entry.name}`);
          await fs.rm(dirPath, { recursive: true, force: true });
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to cleanup old workspaces: ${errorMessage}`);
    }
  }

  /**
   * Update Prometheus metrics
   */
  private updateMetrics(): void {
    this.activeGauge.set(this.workspaces.size);
  }

  /**
   * Create execution error
   */
  private createError(
    code: AIErrorCode,
    message: string,
    isRetryable: boolean,
    rawOutput?: string,
  ): IAIExecutionError {
    return {
      code,
      message,
      isRetryable,
      rawOutput,
    };
  }
}
