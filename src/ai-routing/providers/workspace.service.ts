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
import { Dirent } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { IWorkspaceInfo, AIErrorCode, IAIExecutionError } from '../interfaces';
import { GitOperationsService } from './git-operations.service';
import { safeMkdir, safeReaddir, safeStat } from '../../common/utils/safe-fs.util';
import { PrismaService } from '../../database/prisma.service';
import { WorkspaceStatus } from '@/prisma/client';

@Injectable()
export class WorkspaceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkspaceService.name);

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
    private readonly prisma: PrismaService,
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

    // Ensure workspace root exists using resolved absolute path
    // Use safeMkdir with "/" as root since workspacesRoot must be an absolute path
    this.workspacesRoot = path.resolve(this.workspacesRoot);
    await safeMkdir(this.workspacesRoot, path.parse(this.workspacesRoot).root, { recursive: true });

    this.logger.log(
      `Workspace service initialized: root=${this.workspacesRoot}, maxConcurrent=${this.maxConcurrent}`,
    );

    // Recover workspaces from database after restart
    await this.recoverWorkspaces();

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
    // Check if workspace already exists for this execution
    const existingWorkspace = await this.prisma.workspace.findUnique({
      where: { execution_id: executionId },
    });

    if (existingWorkspace) {
      // If workspace exists and is in a usable state, return it
      if (
        existingWorkspace.status === WorkspaceStatus.READY ||
        existingWorkspace.status === WorkspaceStatus.IN_USE
      ) {
        this.logger.log(
          `[${executionId}] Reusing existing workspace: ${existingWorkspace.workspace_path}`,
        );
        return this.mapToWorkspaceInfo(existingWorkspace);
      }

      // If workspace exists but is failed/cleaned, clean it up first
      if (
        existingWorkspace.status === WorkspaceStatus.FAILED ||
        existingWorkspace.status === WorkspaceStatus.CLEANED
      ) {
        this.logger.warn(
          `[${executionId}] Existing workspace in ${existingWorkspace.status} state, recreating`,
        );
        await this.cleanupWorkspace(executionId, true);
      }
    }

    // Check concurrency limit
    const activeCount = await this.getActiveCount();
    if (activeCount >= this.maxConcurrent) {
      throw this.createError(
        AIErrorCode.WORKSPACE_LIMIT,
        `Maximum concurrent workspaces (${this.maxConcurrent}) reached`,
        false,
      );
    }

    // Sanitize ticketId to prevent path traversal attacks
    const sanitizedTicketId = ticketId.replace(/[^a-zA-Z0-9-_]/g, '_');
    // Use UUID instead of timestamp to prevent collisions when multiple workspaces
    // are created simultaneously (e.g., parallel QA checks)
    const uniqueId = crypto.randomUUID();
    const workspaceId = `ticket-${sanitizedTicketId}-${uniqueId}`;
    const workspacePath = path.join(this.workspacesRoot, workspaceId);
    const branchName = `feature/ticket-${ticketId}`;

    // Create workspace record in database
    await this.prisma.workspace.create({
      data: {
        workspace_id: workspaceId,
        execution_id: executionId,
        ticket_id: ticketId,
        workspace_path: workspacePath,
        repository_url: repositoryUrl || null,
        branch_name: branchName,
        status: WorkspaceStatus.CREATING,
      },
    });
    await this.updateMetrics();

    try {
      this.logger.log(`[${executionId}] Creating workspace: ${workspacePath}`);

      // 1. Clean up any existing directory from previous failed runs
      // This prevents "directory already exists" errors from git clone
      try {
        await fs.rm(workspacePath, { recursive: true, force: true });
      } catch {
        // Directory may not exist, ignore
      }

      // 2. Clone repository only if URL is provided
      // Skip cloning if repositoryUrl is empty (e.g., for commit message generation)
      if (repositoryUrl && repositoryUrl.trim() !== '') {
        this.logger.log(`[${executionId}] Cloning repository`);
        // Note: git clone will create the target directory itself
        await this.git.clone(repositoryUrl, workspacePath, { depth: 1 });

        // 3. Configure git user for commits
        await this.git.configureUser(workspacePath, this.gitUserName, this.gitUserEmail);

        // 4. Create feature branch
        await this.git.checkoutBranch(workspacePath, branchName, true);
      } else {
        this.logger.log(`[${executionId}] Skipping git clone - no repository URL`);
        // Create workspace directory manually since git clone won't do it
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.mkdir(workspacePath, { recursive: true });
      }

      // Note: Dependencies are NOT installed here
      // AI providers (Cursor, Claude) will handle dependency installation
      // as part of their natural workflow when they detect missing deps

      // Update workspace status to READY
      await this.prisma.workspace.update({
        where: { execution_id: executionId },
        data: { status: WorkspaceStatus.READY },
      });

      this.operationsCounter.inc({ operation: 'create', status: 'success' });

      this.logger.log(`[${executionId}] Workspace ready: ${workspacePath}`);

      return this.mapToWorkspaceInfo(
        await this.prisma.workspace.findUniqueOrThrow({
          where: { execution_id: executionId },
        }),
      );
    } catch (error: unknown) {
      // Update workspace status to FAILED
      await this.prisma.workspace
        .update({
          where: { execution_id: executionId },
          data: { status: WorkspaceStatus.FAILED },
        })
        .catch(() => {});

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
  async getWorkspace(executionId: string): Promise<IWorkspaceInfo | undefined> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { execution_id: executionId },
    });
    return workspace ? this.mapToWorkspaceInfo(workspace) : undefined;
  }

  /**
   * Update workspace status
   */
  async updateWorkspaceStatus(
    executionId: string,
    status: IWorkspaceInfo['status'],
  ): Promise<void> {
    await this.prisma.workspace
      .update({
        where: { execution_id: executionId },
        data: { status: this.mapToDbStatus(status) },
      })
      .catch((error) => {
        this.logger.warn(`Failed to update workspace status for ${executionId}: ${error.message}`);
      });
  }

  /**
   * Extract changes from workspace (git diff)
   */
  async extractChanges(executionId: string): Promise<{
    diff: string;
    filesChanged: string[];
  }> {
    const workspace = await this.getWorkspace(executionId);
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
    const workspace = await this.getWorkspace(executionId);
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

    // Update status to CLEANING
    await this.prisma.workspace
      .update({
        where: { execution_id: executionId },
        data: { status: WorkspaceStatus.CLEANING },
      })
      .catch(() => {});

    try {
      await fs.rm(workspace.path, { recursive: true, force: true });
      this.logger.log(`[${executionId}] Workspace cleaned: ${workspace.path}`);

      // Update status to CLEANED
      await this.prisma.workspace.update({
        where: { execution_id: executionId },
        data: {
          status: WorkspaceStatus.CLEANED,
          cleaned_at: new Date(),
        },
      });

      this.operationsCounter.inc({ operation: 'cleanup', status: 'success' });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[${executionId}] Failed to cleanup workspace: ${errorMessage}`);
      this.operationsCounter.inc({ operation: 'cleanup', status: 'error' });
      // Don't throw - cleanup failures shouldn't block execution
    } finally {
      await this.updateMetrics();
    }
  }

  /**
   * Get all active workspaces
   */
  async getActiveWorkspaces(): Promise<IWorkspaceInfo[]> {
    const workspaces = await this.prisma.workspace.findMany({
      where: {
        status: {
          in: [WorkspaceStatus.CREATING, WorkspaceStatus.READY, WorkspaceStatus.IN_USE],
        },
      },
    });
    return workspaces.map((w) => this.mapToWorkspaceInfo(w));
  }

  /**
   * Get workspace count
   */
  async getActiveCount(): Promise<number> {
    return this.prisma.workspace.count({
      where: {
        status: {
          in: [WorkspaceStatus.CREATING, WorkspaceStatus.READY, WorkspaceStatus.IN_USE],
        },
      },
    });
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
      const entries = await safeReaddir(this.workspacesRoot, this.workspacesRoot, {
        withFileTypes: true,
      });
      const now = Date.now();

      for (const entry of entries as Dirent[]) {
        if (!entry.isDirectory()) continue;

        const dirPath = path.join(this.workspacesRoot, entry.name);
        const stats = await safeStat(dirPath, this.workspacesRoot);
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
  private async updateMetrics(): Promise<void> {
    const count = await this.getActiveCount();
    this.activeGauge.set(count);
  }

  /**
   * Recover workspaces from database after restart
   */
  private async recoverWorkspaces(): Promise<void> {
    try {
      const activeWorkspaces = await this.prisma.workspace.findMany({
        where: {
          status: {
            in: [WorkspaceStatus.CREATING, WorkspaceStatus.READY, WorkspaceStatus.IN_USE],
          },
        },
      });

      this.logger.log(`Recovering ${activeWorkspaces.length} workspace(s) from database`);

      for (const workspace of activeWorkspaces) {
        // Check if directory still exists
        const exists = await this.directoryExists(workspace.workspace_path);

        if (!exists) {
          // Directory gone, mark as cleaned
          this.logger.warn(
            `Workspace directory missing for ${workspace.execution_id}, marking as CLEANED`,
          );
          await this.prisma.workspace.update({
            where: { id: workspace.id },
            data: {
              status: WorkspaceStatus.CLEANED,
              cleaned_at: new Date(),
            },
          });
        } else {
          this.logger.log(
            `Recovered workspace for execution ${workspace.execution_id}: ${workspace.workspace_path}`,
          );
        }
      }

      await this.updateMetrics();
      this.logger.log('Workspace recovery completed');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to recover workspaces: ${errorMessage}`);
    }
  }

  /**
   * Check if directory exists
   */
  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Map database workspace to IWorkspaceInfo
   */
  private mapToWorkspaceInfo(workspace: {
    id: string;
    workspace_id: string;
    execution_id: string;
    ticket_id: string;
    workspace_path: string;
    repository_url: string | null;
    branch_name: string;
    status: WorkspaceStatus;
    created_at: Date;
    updated_at: Date;
    cleaned_at: Date | null;
  }): IWorkspaceInfo {
    return {
      id: workspace.workspace_id,
      path: workspace.workspace_path,
      ticketId: workspace.ticket_id,
      executionId: workspace.execution_id,
      repositoryUrl: workspace.repository_url || '',
      branchName: workspace.branch_name,
      createdAt: workspace.created_at,
      status: this.mapFromDbStatus(workspace.status),
    };
  }

  /**
   * Map IWorkspaceInfo status to database WorkspaceStatus
   */
  private mapToDbStatus(status: IWorkspaceInfo['status']): WorkspaceStatus {
    const statusMap: Partial<Record<IWorkspaceInfo['status'], WorkspaceStatus>> = {
      CREATING: WorkspaceStatus.CREATING,
      READY: WorkspaceStatus.READY,
      EXECUTING: WorkspaceStatus.IN_USE,
      COMPLETED: WorkspaceStatus.READY,
      FAILED: WorkspaceStatus.FAILED,
      CLEANING: WorkspaceStatus.CLEANING,
    };
    // eslint-disable-next-line security/detect-object-injection
    return statusMap[status] || WorkspaceStatus.READY;
  }

  /**
   * Map database WorkspaceStatus to IWorkspaceInfo status
   */
  private mapFromDbStatus(status: WorkspaceStatus): IWorkspaceInfo['status'] {
    const statusMap: Record<WorkspaceStatus, IWorkspaceInfo['status']> = {
      [WorkspaceStatus.CREATING]: 'CREATING',
      [WorkspaceStatus.READY]: 'READY',
      [WorkspaceStatus.IN_USE]: 'EXECUTING',
      [WorkspaceStatus.FAILED]: 'FAILED',
      [WorkspaceStatus.CLEANING]: 'CLEANING',
      [WorkspaceStatus.CLEANED]: 'COMPLETED',
    };
    // eslint-disable-next-line security/detect-object-injection
    return statusMap[status];
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
