import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
import { CleanupOptions } from './interfaces/cleanup-options.interface';
import { CleanupResult } from './interfaces/cleanup-result.interface';

/**
 * Cleanup Service
 * Story 23.2: Automated Container Cleanup -> OS-3.1: DooD Elimination
 *
 * Orchestrates cleanup after execution completion.
 * OpenSandbox handles TTL-based cleanup; this service is now a no-op trace.
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
   * Called after execution completion (success, failure, timeout, cancel)
   */
  async cleanupAfterExecution(
    executionId: string,
    _options?: CleanupOptions,
  ): Promise<CleanupResult> {
    const startTime = Date.now();

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
      `[${executionId}] Starting cleanup (DooD Elimination: skipping local cleanup)`,
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

    // DooD Elimination: Containers and Workspaces are handled by OpenSandbox TTL
    this.logger.debug(`[${executionId}] Skip cleanup, handled by OpenSandbox TTL`);

    // 1. Mark container as removed in metrics for backward compatibility
    if (execution.container_id) {
      this.containerCounter.inc({ status: 'success' });
      // Clear container_id from execution record
      try {
        await this.executionTracker.assignContainer(executionId, '');
        this.logger.debug(`[${executionId}] Container ID cleared from execution record`);
      } catch (error) {
        this.logger.warn(`[${executionId}] Failed to clear container ID: ${error}`);
      }
    }

    const durationMs = Date.now() - startTime;
    this.durationHistogram.observe(durationMs / 1000);

    return {
      executionId,
      containerRemoved: true,
      workspaceCleaned: true,
      bytesReclaimed: 0,
      durationMs,
      errors: [],
    };
  }

  /**
   * Remove a container (Legacy)
   */
  async removeContainer(containerId: string, _force = false): Promise<void> {
    this.logger.log(`[DEBUG] removeContainer(${containerId}) skipped, handled by OpenSandbox`);
  }

  /**
   * Cleanup workspace folder (Legacy)
   */
  async cleanupWorkspaceFolder(executionId: string, _preserve = false): Promise<number> {
    this.logger.log(
      `[DEBUG] cleanupWorkspaceFolder(${executionId}) skipped, handled by OpenSandbox`,
    );
    return 0;
  }
}
