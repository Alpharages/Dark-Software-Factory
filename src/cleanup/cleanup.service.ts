import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DockerService } from '@/docker/docker.service';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import { WorkspaceService } from '@/ai-routing/providers/workspace.service';
import { CleanupOptions } from './interfaces/cleanup-options.interface';
import { CleanupResult, CleanupError } from './interfaces/cleanup-result.interface';
import { ContainerCleanupError, CleanupTimeoutError } from './exceptions/cleanup.exceptions';

/**
 * Cleanup Service
 * Story 23.2: Automated Container Cleanup
 *
 * Orchestrates container and workspace cleanup after execution completion.
 * Features:
 * - Container removal via DockerService
 * - Workspace cleanup via WorkspaceService
 * - Debug mode support (preserves workspace when enabled)
 * - Prometheus metrics tracking
 * - Error handling with graceful degradation
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly dockerService: DockerService,
    private readonly executionTracker: ExecutionTrackerService,
    private readonly workspaceService: WorkspaceService,
    private readonly configService: ConfigService,
    @InjectMetric('cleanup_duration_seconds')
    private readonly durationHistogram: Histogram<string>,
    @InjectMetric('cleanup_containers_total')
    private readonly containerCounter: Counter<string>,
    @InjectMetric('cleanup_bytes_reclaimed_total')
    private readonly bytesReclaimedCounter: Counter<string>,
    @InjectMetric('cleanup_failures_total')
    private readonly failuresCounter: Counter<string>,
  ) {}

  /**
   * Main cleanup orchestration method
   * Called after execution completion (success, failure, timeout, cancel)
   *
   * @param executionId - Execution ID to cleanup
   * @param options - Cleanup options (force, preserve workspace, timeout)
   * @returns Cleanup result with status and metrics
   */
  async cleanupAfterExecution(
    executionId: string,
    options?: CleanupOptions,
  ): Promise<CleanupResult> {
    const startTime = Date.now();
    const errors: CleanupError[] = [];

    // Check if auto-cleanup is enabled
    if (!this.configService.get<boolean>('ENABLE_AUTO_CLEANUP', true)) {
      this.logger.log(`[${executionId}] Auto-cleanup disabled, skipping`);
      return {
        executionId,
        containerRemoved: false,
        workspaceCleaned: false,
        bytesReclaimed: 0,
        durationMs: 0,
        errors: [],
      };
    }

    this.logger.log(
      `[${executionId}] Starting cleanup (force=${options?.forceContainerRemove ?? false})`,
    );

    // Get execution details
    const execution = await this.executionTracker.getExecution(executionId);
    if (!execution) {
      this.logger.warn(`[${executionId}] Execution not found, skipping cleanup`);
      return {
        executionId,
        containerRemoved: false,
        workspaceCleaned: false,
        bytesReclaimed: 0,
        durationMs: Date.now() - startTime,
        errors: [{ type: 'container', message: 'Execution not found' }],
      };
    }

    // Get timeout from options or config (default: 30s)
    const timeoutMs =
      options?.timeoutMs ?? this.configService.get<number>('CLEANUP_TIMEOUT_MS', 30000);

    let containerRemoved = false;
    let workspaceCleaned = false;
    let bytesReclaimed = 0;

    // 1. Remove container if assigned (with timeout)
    if (execution.container_id) {
      try {
        await this.runWithTimeout(
          this.removeContainer(execution.container_id, options?.forceContainerRemove ?? false),
          timeoutMs,
          `Container removal for ${executionId}`,
        );
        containerRemoved = true;
        this.containerCounter.inc({ status: 'success' });
        this.logger.log(`[${executionId}] Container ${execution.container_id} removed`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[${executionId}] Failed to remove container ${execution.container_id}: ${errorMessage}`,
        );
        this.containerCounter.inc({ status: 'failure' });
        this.failuresCounter.inc({ type: 'container' });
        errors.push({ type: 'container', message: errorMessage });
      }
    } else {
      this.logger.debug(`[${executionId}] No container assigned, skipping container removal`);
    }

    // 2. Cleanup workspace (unless debug mode is enabled)
    const preserveWorkspace = options?.preserveWorkspace ?? execution.debug_mode;
    try {
      bytesReclaimed = await this.runWithTimeout(
        this.cleanupWorkspaceFolder(executionId, preserveWorkspace),
        timeoutMs,
        `Workspace cleanup for ${executionId}`,
      );
      if (!preserveWorkspace) {
        workspaceCleaned = true;
        this.bytesReclaimedCounter.inc(bytesReclaimed);
        this.logger.log(`[${executionId}] Workspace cleaned, ${bytesReclaimed} bytes reclaimed`);
      } else {
        this.logger.log(`[${executionId}] Workspace preserved (debug mode)`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[${executionId}] Failed to cleanup workspace: ${errorMessage}`);
      this.failuresCounter.inc({ type: 'workspace' });
      errors.push({ type: 'workspace', message: errorMessage });
    }

    // 3. Clear container_id from execution record after successful cleanup
    if (containerRemoved || !execution.container_id) {
      try {
        await this.executionTracker.assignContainer(executionId, '');
        this.logger.debug(`[${executionId}] Container ID cleared from execution record`);
      } catch (error) {
        this.logger.warn(`[${executionId}] Failed to clear container ID: ${error}`);
      }
    }

    const durationMs = Date.now() - startTime;
    this.durationHistogram.observe(durationMs / 1000);

    this.logger.log(
      `[${executionId}] Cleanup completed in ${durationMs}ms ` +
        `(container=${containerRemoved}, workspace=${workspaceCleaned}, bytes=${bytesReclaimed})`,
    );

    return {
      executionId,
      containerRemoved,
      workspaceCleaned,
      bytesReclaimed,
      durationMs,
      errors,
    };
  }

  /**
   * Remove a Docker container
   *
   * @param containerId - Docker container ID
   * @param force - Force removal even if running
   * @throws ContainerCleanupError if removal fails
   */
  async removeContainer(containerId: string, force = false): Promise<void> {
    try {
      // First kill if force is requested
      if (force) {
        await this.dockerService.killContainer(containerId, 'SIGKILL');
      }
      // Then remove the container
      await this.dockerService.removeContainer(containerId, force);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Check if container doesn't exist (idempotent)
      if (errorMessage.includes('No such container')) {
        this.logger.debug(`Container ${containerId} already removed`);
        return;
      }
      throw new ContainerCleanupError(containerId, errorMessage);
    }
  }

  /**
   * Cleanup workspace folder for an execution
   *
   * @param executionId - Execution ID
   * @param preserve - Whether to preserve the workspace (debug mode)
   * @returns Bytes reclaimed (0 if preserved)
   * @throws WorkspaceCleanupError if cleanup fails
   */
  async cleanupWorkspaceFolder(executionId: string, preserve = false): Promise<number> {
    if (preserve) {
      this.logger.debug(`[${executionId}] Preserving workspace for debug mode`);
      return 0;
    }

    // Get workspace info
    const workspace = await this.workspaceService.getWorkspace(executionId);
    if (!workspace) {
      this.logger.debug(`[${executionId}] No workspace found, skipping cleanup`);
      return 0;
    }

    // Calculate directory size before cleanup
    let bytesBefore = 0;
    try {
      bytesBefore = await this.calculateDirectorySize(workspace.path);
    } catch (error) {
      this.logger.debug(`[${executionId}] Could not calculate workspace size: ${error}`);
    }

    // Delegate to WorkspaceService for consistency
    await this.workspaceService.cleanupWorkspace(executionId, true); // force=true

    return bytesBefore;
  }

  /**
   * Calculate directory size recursively
   * @param dirPath - Directory path
   * @returns Total size in bytes
   */
  private async calculateDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;

    async function walkDir(currentPath: string): Promise<void> {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const entries = await fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else if (entry.isFile()) {
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          const stats = await fs.stat(fullPath);
          totalSize += stats.size;
        }
      }
    }

    await walkDir(dirPath);
    return totalSize;
  }

  /**
   * Run a promise with a timeout
   * @param promise - Promise to run
   * @param timeoutMs - Timeout in milliseconds
   * @param operationName - Name of the operation for error messages
   * @returns Promise result
   * @throws CleanupTimeoutError if timeout is exceeded
   */
  private async runWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string,
  ): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          reject(new CleanupTimeoutError(operationName));
        }, timeoutMs);
      }),
    ]);
  }
}
