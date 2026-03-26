import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import { CleanupOptions } from './interfaces/cleanup-options.interface';
import { CleanupResult } from './interfaces/cleanup-result.interface';
import { CleanupTimeoutError } from './exceptions/cleanup.exceptions';

/**
 * Cleanup Service
 * Story 23.2: Automated Container Cleanup -> OS-3.2: Final DooD Elimination
 *
 * Orchestrates cleanup after execution completion.
 * OpenSandbox handles TTL-based cleanup; this service provides a no-op
 * orchestration layer to maintain metrics and backward compatibility.
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly executionTracker: ExecutionTrackerService,
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
   * Called after execution completion (success, failure, timeout, cancel).
   * Now orchestrates no-op calls wrapped in timeout to preserve metrics.
   */
  async cleanupAfterExecution(
    executionId: string,
    _options?: CleanupOptions,
  ): Promise<CleanupResult> {
    const startTime = Date.now();
    const timeout = this.configService.get<number>('CLEANUP_TIMEOUT_MS', 30000);

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

    this.logger.debug(
      `[${executionId}] Starting no-op cleanup orchestration (OpenSandbox TTL handles actual deletion)`,
    );

    const result: CleanupResult = {
      executionId,
      containerRemoved: false,
      workspaceCleaned: false,
      bytesReclaimed: 0,
      durationMs: 0,
      errors: [],
    };

    try {
      // Get execution details
      const execution = await this.executionTracker.getExecution(executionId);
      if (!execution) {
        throw new Error('Execution not found');
      }

      // 1. Remove Container (No-op)
      if (execution.container_id) {
        try {
          await this.runWithTimeout(
            this.removeContainer(execution.container_id),
            timeout,
            executionId,
          );
          result.containerRemoved = true;
          this.containerCounter.inc({ status: 'success' });

          // Clear container_id from execution record (DB management, not Docker)
          await this.executionTracker.assignContainer(executionId, '');
          this.logger.debug(`[${executionId}] Container ID cleared from execution record`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.warn(`[${executionId}] Container cleanup "failed": ${errorMessage}`);
          result.errors.push({ type: 'container', message: errorMessage });
          this.failuresCounter.inc({ type: 'container' });
        }
      } else {
        result.containerRemoved = true; // Nothing to remove
      }

      // 2. Cleanup Workspace (No-op)
      try {
        const bytesReclaimed = await this.runWithTimeout(
          this.cleanupWorkspaceFolder(executionId),
          timeout,
          executionId,
        );
        result.workspaceCleaned = true;
        result.bytesReclaimed = bytesReclaimed;
        this.bytesReclaimedCounter.inc(bytesReclaimed);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[${executionId}] Workspace cleanup "failed": ${errorMessage}`);
        result.errors.push({ type: 'workspace', message: errorMessage });
        this.failuresCounter.inc({ type: 'workspace' });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[${executionId}] Cleanup orchestration error: ${errorMessage}`);
      // Use 'container' as default category for general orchestration errors
      result.errors.push({ type: 'container', message: errorMessage });
      this.failuresCounter.inc({ type: 'container' });
    }

    result.durationMs = Date.now() - startTime;
    this.durationHistogram.observe(result.durationMs / 1000);

    return result;
  }

  /**
   * Remove a container (No-op)
   */
  async removeContainer(containerId: string, _force = false): Promise<void> {
    this.logger.debug(
      `Container cleanup delegated to OpenSandbox TTL (containerId: ${containerId})`,
    );
  }

  /**
   * Cleanup workspace folder (No-op)
   */
  async cleanupWorkspaceFolder(executionId: string, _preserve = false): Promise<number> {
    this.logger.debug(
      `Workspace cleanup delegated to OpenSandbox TTL (executionId: ${executionId})`,
    );
    return 0;
  }

  /**
   * Helper to run a promise with timeout
   */
  private async runWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    executionId: string,
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new CleanupTimeoutError(executionId));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      return result;
    } finally {
      clearTimeout(timeoutHandle!);
    }
  }
}
