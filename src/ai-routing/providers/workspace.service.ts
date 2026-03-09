/**
 * Workspace Service
 * Story 2.6: AI Provider Integration - Cursor CLI Headless Mode
 *
 * Manages isolated workspaces for AI code generation.
 * Each execution gets its own workspace to prevent conflicts.
 *
 * Architecture Reference: Workspace Isolation Strategy
 */

import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Gauge, Counter } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import * as fs from 'fs/promises';
import { Dirent } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import { IWorkspaceInfo, AIErrorCode, IAIExecutionError } from '../interfaces';
import { GitOperationsService } from './git-operations.service';
import { GitMirrorService } from '../../git-mirror/git-mirror.service';
import { safeMkdir, safeReaddir, safeStat } from '../../common/utils/safe-fs.util';
import { PrismaService } from '../../database/prisma.service';
import { WorkspaceStatus } from '@/prisma/client';
import { StorageManagerService } from '../../storage/storage-manager.service';
import { ExecutionTrackerService } from '../../execution/execution-tracker.service';
import { GitHubTokenResolverService } from '../../github/github-token-resolver.service';

/**
 * Maps AI provider names to their convention instruction filenames.
 * Each repo can have a single `.ai/instructions.md` that gets copied
 * to the provider-specific filename after cloning.
 */
const AI_INSTRUCTION_TARGETS: Record<string, string> = {
  CLAUDE_CODE: 'CLAUDE.md',
  CURSOR_HEADLESS: '.cursorrules',
};

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
    @Inject(forwardRef(() => StorageManagerService))
    private readonly storageManager: StorageManagerService,
    @Inject(forwardRef(() => GitMirrorService))
    private readonly gitMirrorService: GitMirrorService,
    @Inject(forwardRef(() => ExecutionTrackerService))
    private readonly executionTracker: ExecutionTrackerService,
    private readonly tokenResolver: GitHubTokenResolverService,
    @InjectMetric('cursor_workspaces_active')
    private readonly activeGauge: Gauge<string>,
    @InjectMetric('cursor_workspace_operations_total')
    private readonly operationsCounter: Counter<string>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.workspacesRoot = this.config.get<string>(
      'sandbox.workspacesRoot',
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
    onProgress?: (status: string) => void,
    provider?: string,
  ): Promise<IWorkspaceInfo> {
    // Trim repository URL to prevent whitespace issues in git commands
    const trimmedRepositoryUrl = repositoryUrl?.trim() || '';

    // 1. Idempotency Check: Check if workspace already exists for this EXECUTION
    const existingExecutionWorkspace = await this.prisma.workspace.findUnique({
      where: { execution_id: executionId },
    });

    if (existingExecutionWorkspace) {
      if (
        existingExecutionWorkspace.status === WorkspaceStatus.READY ||
        existingExecutionWorkspace.status === WorkspaceStatus.IN_USE
      ) {
        this.logger.log(
          `[${executionId}] Reusing existing workspace (idempotent): ${existingExecutionWorkspace.workspace_path}`,
        );
        return this.mapToWorkspaceInfo(existingExecutionWorkspace);
      }

      // If failed/cleaning, logic below will likely handle cleanup or re-creation
      // relying on the unique constraint of execution_id might cause issues if we don't clean it up?
      // actually, if we found it and it's failed, we should clean it.
      if (
        existingExecutionWorkspace.status === WorkspaceStatus.FAILED ||
        existingExecutionWorkspace.status === WorkspaceStatus.CLEANED
      ) {
        this.logger.warn(
          `[${executionId}] Existing workspace in ${existingExecutionWorkspace.status} state, recreating`,
        );
        await this.cleanupWorkspace(executionId, true);
      }
    }

    // 2. Persistence Check: Check if active workspace exists for this TICKET
    // We want to reuse the same workspace for all steps of a ticket
    // Need to handle potential race conditions if multiple steps start at once (uses transaction/upsert implicitly via Prisma?)
    // For now, simple findFirst is sufficient as normally steps are sequential.
    const existingTicketWorkspace = await this.prisma.workspace.findFirst({
      where: {
        ticket_id: ticketId,
        status: {
          in: [WorkspaceStatus.READY, WorkspaceStatus.IN_USE, WorkspaceStatus.CREATING],
        },
      },
      orderBy: { updated_at: 'desc' },
    });

    if (existingTicketWorkspace) {
      this.logger.log(
        `[${executionId}] Reusing existing workspace for ticket ${ticketId}: ${existingTicketWorkspace.workspace_path}`,
      );

      // Update the execution_id to the current one so we can track it
      // Validating "IN_USE": If it was IN_USE by a previous step that is done, it's fine.
      // If it's effectively "locked", we assume the Orchestrator manages concurrency.
      const updatedUserWorkspace = await this.prisma.workspace.update({
        where: { id: existingTicketWorkspace.id },
        data: {
          execution_id: executionId,
          updated_at: new Date(),
          // We don't verify status here, we trust it's usable.
        },
      });
      return this.mapToWorkspaceInfo(updatedUserWorkspace);
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
    await this.prisma.workspace.upsert({
      where: { execution_id: executionId },
      update: {
        workspace_id: workspaceId,
        workspace_path: workspacePath,
        repository_url: trimmedRepositoryUrl || null,
        branch_name: branchName,
        status: WorkspaceStatus.CREATING,
        ticket_id: ticketId,
        updated_at: new Date(),
      },
      create: {
        workspace_id: workspaceId,
        execution_id: executionId,
        ticket_id: ticketId,
        workspace_path: workspacePath,
        repository_url: trimmedRepositoryUrl || null,
        branch_name: branchName,
        status: WorkspaceStatus.CREATING,
      },
    });
    await this.updateMetrics();

    try {
      this.logger.log(
        `[WORKSPACE_CREATION] Creating workspace for execution ${executionId}: ${workspacePath}`,
      );
      await this.executionTracker.emitProgress(
        executionId,
        ticketId,
        null,
        'Workspace Creation',
        15,
      );

      // 1. Clean up any existing directory from previous failed runs
      try {
        await fs.rm(workspacePath, { recursive: true, force: true });
      } catch {
        // Directory may not exist, ignore
      }

      // 2. Clone repository only if URL is provided
      if (trimmedRepositoryUrl) {
        this.logger.log(`[GIT_CLONE] Cloning repository for execution ${executionId}`);
        await this.executionTracker.emitProgress(
          executionId,
          ticketId,
          null,
          'Cloning Repository',
          20,
        );
        onProgress?.('Cloning repository...');

        // AC#1: Try mirror-based clone first (if enabled)
        const gitMirroringEnabled = this.config.get<boolean>('ENABLE_GIT_MIRRORING', true);
        let clonedFromMirror = false;

        let authenticatedUrl: string | undefined;
        const ticket = await this.prisma.ticket.findUnique({
          where: { id: ticketId },
          select: { project_id: true },
        });

        if (ticket?.project_id) {
          const resolvedAuth = await this.tokenResolver.resolveForProject(
            ticket.project_id,
            trimmedRepositoryUrl,
          );
          if (resolvedAuth) {
            authenticatedUrl = resolvedAuth.authenticatedUrl;
          }
        }

        if (gitMirroringEnabled) {
          try {
            const mirror = await this.gitMirrorService.getOrCreateMirror(
              trimmedRepositoryUrl,
              authenticatedUrl,
            );
            await this.gitMirrorService.cloneFromMirror(
              mirror.mirrorPath,
              workspacePath,
              authenticatedUrl,
            );
            clonedFromMirror = true;
            this.logger.log(`[${executionId}] Cloned from local mirror: ${mirror.mirrorPath}`);
          } catch (mirrorError: unknown) {
            const errorMsg =
              mirrorError instanceof Error ? mirrorError.message : String(mirrorError);
            this.logger.warn(
              `[${executionId}] Mirror clone failed, falling back to direct clone: ${errorMsg}`,
            );
          }
        }

        // Fallback to direct clone if mirror failed or disabled
        if (!clonedFromMirror) {
          await this.git.clone(authenticatedUrl ?? trimmedRepositoryUrl, workspacePath, {
            depth: 1,
          });
        }

        // 3. Configure git user for commits
        await this.git.configureUser(workspacePath, this.gitUserName, this.gitUserEmail);

        // 4. Create feature branch
        onProgress?.('Checking out feature branch...');
        await this.git.checkoutBranch(workspacePath, branchName, true);

        // Log commit hash for reproducibility (AC #7)
        try {
          // Better: just use simple git command via the service if possible, OR just log that we are at HEAD of branch
          this.logger.log(`[${executionId}] Checked out ${branchName}`);
        } catch (e) {
          this.logger.warn(`[${executionId}] Could not retrieve commit hash: ${e}`);
        }
      } else {
        this.logger.log(`[${executionId}] Skipping git clone - no repository URL`);
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        await fs.mkdir(workspacePath, { recursive: true });
      }

      // Fix workspace ownership for container agent user (UID 1000).
      // dsf-app runs as root so git-cloned files are root:root, but the
      // sibling dsf-agent-base container runs as 'agent' (UID 1000).
      // Without this chown, Claude CLI gets EACCES permission denied errors.
      try {
        execSync(`chown -R 1000:1000 "${workspacePath}"`, { timeout: 30_000 });
        this.logger.log(`[${executionId}] Fixed workspace ownership for agent user (UID 1000)`);
      } catch (chownError: unknown) {
        const chownMsg = chownError instanceof Error ? chownError.message : String(chownError);
        this.logger.warn(
          `[${executionId}] Failed to fix workspace ownership (chown): ${chownMsg}. ` +
            `Container agent may encounter permission errors.`,
        );
      }

      // 5. Inject AI instructions for provider (copy .ai/instructions.md → provider convention file)
      if (provider) {
        await this.injectAIInstructions(workspacePath, provider, executionId);
      }

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
   * Inject project-level AI instructions into the provider's convention file.
   *
   * Copies `.ai/instructions.md` → provider-specific filename (e.g. CLAUDE.md, .cursorrules).
   * Skips if:
   *  - The provider has no known convention filename
   *  - The source `.ai/instructions.md` doesn't exist in the repo
   *  - The target file already exists (repo-level override takes precedence)
   */
  private async injectAIInstructions(
    workspacePath: string,
    provider: string,
    executionId: string,
  ): Promise<void> {
    // eslint-disable-next-line security/detect-object-injection
    const targetFilename = AI_INSTRUCTION_TARGETS[provider];
    if (!targetFilename) return;

    const sourceFile = path.join(workspacePath, '.ai', 'instructions.md');
    const targetFile = path.join(workspacePath, targetFilename);

    try {
      // Check if source exists
      await fs.access(sourceFile);
    } catch {
      // Source doesn't exist — no project instructions, skip silently
      return;
    }

    try {
      // Check if target already exists (repo override)
      await fs.access(targetFile);
      this.logger.log(
        `[${executionId}] Provider file ${targetFilename} already exists, skipping AI instructions injection`,
      );
      return;
    } catch {
      // Target doesn't exist — proceed with copy
    }

    try {
      await fs.copyFile(sourceFile, targetFile);
      this.logger.log(
        `[${executionId}] Injected AI instructions: .ai/instructions.md → ${targetFilename}`,
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[${executionId}] Failed to inject AI instructions: ${msg}`);
      // Non-fatal — don't fail workspace creation over this
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

    // Guard: workspace path must exist (may have been cleaned before this call)
    const pathExists = await this.directoryExists(workspace.path);
    if (!pathExists) {
      throw this.createError(
        AIErrorCode.GIT_ERROR,
        `Failed to extract changes: workspace path does not exist: ${workspace.path}`,
        false,
      );
    }

    // Guard: must be a valid git repo (cloned workspaces always have .git)
    const gitDirExists = await this.directoryExists(path.join(workspace.path, '.git'));
    if (!gitDirExists) {
      throw this.createError(
        AIErrorCode.GIT_ERROR,
        `Failed to extract changes: not a git repository: ${workspace.path}`,
        false,
      );
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
   * Delegates to StorageManagerService for archival and cleanup (Story 14.3: AC#7)
   */
  async cleanupWorkspace(executionId: string, force: boolean = false): Promise<void> {
    const workspace = await this.getWorkspace(executionId);
    if (!workspace) {
      return;
    }

    // Guard: prevent duplicate concurrent cleanup calls (ENOTEMPTY race condition).
    // If a parallel call already updated the DB to CLEANING or CLEANED, skip quietly.
    if (workspace.status === 'CLEANING' || workspace.status === 'COMPLETED') {
      this.logger.debug(
        `[${executionId}] Workspace already being cleaned/cleaned — skipping duplicate cleanup`,
      );
      return;
    }

    // Delegate to StorageManagerService for archival if failed workspace is preserved
    if (workspace.status === 'FAILED' && this.preserveFailed && !force) {
      try {
        this.logger.log(
          `[${executionId}] Archiving failed workspace for debugging: ${workspace.path}`,
        );
        await this.storageManager.archiveWorkspace(executionId);
        return;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[${executionId}] Failed to archive workspace, proceeding with cleanup: ${errorMessage}`,
        );
        // Fall through to normal cleanup if archival fails
      }
    }

    // Atomically mark as CLEANING to prevent other concurrent callers from entering
    const updated = await this.prisma.workspace
      .updateMany({
        where: {
          execution_id: executionId,
          status: { notIn: [WorkspaceStatus.CLEANING, WorkspaceStatus.CLEANED] },
        },
        data: { status: WorkspaceStatus.CLEANING },
      })
      .catch(() => ({ count: 0 }));

    if (updated.count === 0) {
      // Another call already claimed the CLEANING transition
      this.logger.debug(
        `[${executionId}] Workspace CLEANING already claimed by another call — skipping`,
      );
      return;
    }

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
   * Delegates to StorageManagerService (Story 14.3: AC#7)
   */
  async checkDiskSpace(): Promise<{ available: boolean; usedMB: number }> {
    try {
      const diskUsage = await this.storageManager.getDiskUsage();
      const availableMB = Number(diskUsage.availableBytes) / (1024 * 1024);
      const usedMB = Number(diskUsage.usedBytes) / (1024 * 1024);
      const minRequiredMB = 500; // Require at least 500MB free

      return {
        available: availableMB > minRequiredMB,
        usedMB,
      };
    } catch {
      // If getDiskUsage fails, assume space is available
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
