/**
 * Storage Manager Service
 * Story 14.3: Storage Manager Service
 *
 * Centralized service for workspace storage management including:
 * - Disk space monitoring
 * - Workspace archival using ZIP compression
 * - Retention policy enforcement
 * - Emergency cleanup on disk exhaustion
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { ArchiveStatus } from '@/prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import archiver from 'archiver';
import { createWriteStream } from 'fs';

export interface DiskUsageInfo {
  totalBytes: bigint;
  availableBytes: bigint;
  usedBytes: bigint;
  usedPercentage: number;
}

export interface ArchiveResult {
  archivePath: string;
  originalSizeBytes: bigint;
  compressedSizeBytes: bigint;
  compressionRatio: number;
}

@Injectable()
export class StorageManagerService implements OnModuleInit {
  private readonly logger = new Logger(StorageManagerService.name);

  // Configuration
  private workspacesRoot!: string;
  private archivesRoot!: string;
  private diskThresholdPercent!: number;
  private retentionDays!: number;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.workspacesRoot = this.config.get<string>(
      'cursor.workspacesRoot',
      '/tmp/cursor-workspaces',
    );
    this.archivesRoot = path.join(this.workspacesRoot, 'workspace-archives');
    this.diskThresholdPercent = this.config.get<number>('storage.diskThresholdPercent', 85);
    this.retentionDays = this.config.get<number>('storage.retentionDays', 30);

    // Validate configuration
    if (this.diskThresholdPercent < 0 || this.diskThresholdPercent > 100) {
      throw new Error(
        `Invalid diskThresholdPercent: ${this.diskThresholdPercent}. Must be between 0-100.`,
      );
    }
    if (this.retentionDays < 0) {
      throw new Error(`Invalid retentionDays: ${this.retentionDays}. Must be >= 0.`);
    }

    // Ensure archives directory exists
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.mkdir(this.archivesRoot, { recursive: true });

    this.logger.log(
      `Storage Manager initialized: root=${this.workspacesRoot}, threshold=${this.diskThresholdPercent}%, retention=${this.retentionDays}d`,
    );

    // Start periodic cleanup (runs daily at 2 AM)
    this.startCleanupScheduler();
  }

  /**
   * Get current disk usage for workspaces root
   * AC#2: Disk Space Monitoring
   */
  async getDiskUsage(): Promise<DiskUsageInfo> {
    const stats = await fs.statfs(this.workspacesRoot);

    const totalBytes = BigInt(stats.blocks) * BigInt(stats.bsize);
    const availableBytes = BigInt(stats.bavail) * BigInt(stats.bsize);
    const usedBytes = totalBytes - availableBytes;
    // Fix H4: Keep BigInt precision in intermediate calculation
    const usedPercentage = Number((usedBytes * 100n) / totalBytes);

    // Update Prometheus metrics (AC#6)
    this.metrics.setGauge('storage_disk_usage_bytes', Number(usedBytes), { type: 'used' });
    this.metrics.setGauge('storage_disk_usage_bytes', Number(availableBytes), {
      type: 'available',
    });
    this.metrics.setGauge('storage_disk_usage_bytes', Number(totalBytes), { type: 'total' });

    return { totalBytes, availableBytes, usedBytes, usedPercentage };
  }

  /**
   * Archive a workspace to ZIP format
   * AC#3: Workspace Archival
   */
  async archiveWorkspace(executionId: string): Promise<ArchiveResult> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { execution_id: executionId },
    });

    if (!workspace) {
      throw new Error(`Workspace not found for execution: ${executionId}`);
    }

    // Calculate original directory size
    const originalSizeBytes = await this.getDirectorySize(workspace.workspace_path);

    // Create archive path (Fix H3: Sanitize workspace_id to prevent path traversal)
    const sanitizedWorkspaceId = path.basename(workspace.workspace_id);
    const archiveFileName = `${sanitizedWorkspaceId}-${Date.now()}.zip`;
    const archivePath = path.join(this.archivesRoot, archiveFileName);

    // Update database: PENDING → ARCHIVING
    await this.prisma.workspaceArchive.upsert({
      where: { execution_id: executionId },
      create: {
        execution_id: executionId,
        workspace_path: workspace.workspace_path,
        size_bytes: originalSizeBytes,
        status: ArchiveStatus.ARCHIVING,
      },
      update: {
        status: ArchiveStatus.ARCHIVING,
      },
    });

    try {
      // Create ZIP archive using archiver library
      const compressedSizeBytes = await this.createZipArchive(
        workspace.workspace_path,
        archivePath,
      );

      // Update database: ARCHIVING → ARCHIVED
      await this.prisma.workspaceArchive.update({
        where: { execution_id: executionId },
        data: {
          archive_path: archivePath,
          compressed_size: compressedSizeBytes,
          status: ArchiveStatus.ARCHIVED,
          archived_at: new Date(),
        },
      });

      // Update Prometheus metrics (AC#6)
      this.metrics.incrementCounter('storage_archives_total', { status: 'success' });

      const compressionRatio = Number(compressedSizeBytes) / Number(originalSizeBytes);

      this.logger.log(
        `Archived workspace ${workspace.workspace_id}: ${this.formatBytes(originalSizeBytes)} → ${this.formatBytes(compressedSizeBytes)} (${(compressionRatio * 100).toFixed(1)}% compression)`,
      );

      return {
        archivePath,
        originalSizeBytes,
        compressedSizeBytes,
        compressionRatio,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Update database: ARCHIVING → FAILED (Fix C4: Set compressed_size=0 for data completeness)
      await this.prisma.workspaceArchive.update({
        where: { execution_id: executionId },
        data: {
          status: ArchiveStatus.FAILED,
          error_message: errorMessage,
          compressed_size: BigInt(0),
        },
      });

      this.metrics.incrementCounter('storage_archives_total', { status: 'failed' });

      throw new Error(`Failed to archive workspace: ${errorMessage}`);
    }
  }

  /**
   * Perform cleanup of old archives based on retention policy
   * AC#5: Retention Policy
   */
  async performCleanup(): Promise<void> {
    const diskUsage = await this.getDiskUsage();

    // Check if disk space is critical (above threshold)
    if (diskUsage.usedPercentage >= this.diskThresholdPercent) {
      this.logger.warn(
        `Disk usage at ${diskUsage.usedPercentage.toFixed(1)}% (threshold: ${this.diskThresholdPercent}%) - initiating emergency cleanup`,
      );
      await this.emergencyCleanup();
    }

    // Regular retention-based cleanup
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

    const oldArchives = await this.prisma.workspaceArchive.findMany({
      where: {
        status: ArchiveStatus.ARCHIVED,
        archived_at: {
          lt: cutoffDate,
        },
      },
    });

    this.logger.log(
      `Cleaning up ${oldArchives.length} archives older than ${this.retentionDays} days`,
    );

    let deletedCount = 0;
    for (const archive of oldArchives) {
      if (archive.archive_path) {
        try {
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          await fs.unlink(archive.archive_path);
          await this.prisma.workspaceArchive.delete({
            where: { id: archive.id },
          });
          deletedCount++;
          this.logger.log(`Deleted archive: ${path.basename(archive.archive_path)}`);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to delete archive ${archive.archive_path}: ${errorMessage}`);
        }
      }
    }

    this.logger.log(`Retention cleanup completed: ${deletedCount} archives deleted`);

    // Update archives total gauge
    await this.updateArchivesMetric();

    // Update Prometheus metrics (AC#6)
    this.metrics.incrementCounter('storage_cleanup_operations_total');
  }

  /**
   * Emergency cleanup: Delete oldest archives first when disk is critical
   * AC#5: Cleanup on Exhaustion
   * Fix H2: Loop until disk usage drops below target or max iterations reached
   */
  private async emergencyCleanup(): Promise<void> {
    this.logger.warn('Initiating emergency cleanup - deleting oldest archives');

    const targetThreshold = Math.max(this.diskThresholdPercent - 10, 70); // Target 10% below threshold
    const maxIterations = 10; // Prevent infinite loops
    let iteration = 0;
    let totalDeleted = 0;

    while (iteration < maxIterations) {
      // Check current disk usage
      const diskUsage = await this.getDiskUsage();
      if (diskUsage.usedPercentage < targetThreshold) {
        this.logger.log(
          `Emergency cleanup target reached: ${diskUsage.usedPercentage.toFixed(1)}% < ${targetThreshold}%`,
        );
        break;
      }

      // Find oldest archives (batch of 10)
      const oldestArchives = await this.prisma.workspaceArchive.findMany({
        where: {
          status: ArchiveStatus.ARCHIVED,
          archive_path: { not: null },
        },
        orderBy: { archived_at: 'asc' },
        take: 10,
      });

      if (oldestArchives.length === 0) {
        this.logger.warn('No more archives to delete, emergency cleanup incomplete');
        break;
      }

      // Delete batch
      for (const archive of oldestArchives) {
        if (archive.archive_path) {
          try {
            // eslint-disable-next-line security/detect-non-literal-fs-filename
            await fs.unlink(archive.archive_path);
            await this.prisma.workspaceArchive.delete({
              where: { id: archive.id },
            });
            totalDeleted++;
            this.logger.warn(
              `Emergency cleanup: Deleted archive ${path.basename(archive.archive_path)}`,
            );
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Emergency cleanup failed for ${archive.archive_path}: ${errorMessage}`,
            );
          }
        }
      }

      iteration++;
    }

    // Update archives total gauge
    await this.updateArchivesMetric();

    this.logger.warn(
      `Emergency cleanup completed: ${totalDeleted} archives deleted in ${iteration} iteration(s)`,
    );
  }

  /**
   * Create ZIP archive using archiver library
   * Returns the size of the compressed archive in bytes
   */
  private async createZipArchive(sourcePath: string, outputPath: string): Promise<bigint> {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const output = createWriteStream(outputPath);
      const archive = archiver('zip', {
        zlib: { level: 9 }, // Maximum compression
      });

      let compressedSize = 0;

      output.on('close', () => {
        compressedSize = archive.pointer();
        resolve(BigInt(compressedSize));
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);
      archive.directory(sourcePath, false);
      archive.finalize();
    });
  }

  /**
   * Calculate total size of a directory recursively
   */
  private async getDirectorySize(dirPath: string): Promise<bigint> {
    let totalSize = BigInt(0);

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
          totalSize += BigInt(stats.size);
        }
      }
    }

    await walkDir(dirPath);
    return totalSize;
  }

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: bigint): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = Number(bytes);
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    // eslint-disable-next-line security/detect-object-injection
    return `${value.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Start periodic cleanup scheduler
   * Fix H1: Automated retention policy execution
   */
  private startCleanupScheduler(): void {
    // Run cleanup daily at 2 AM (or on startup if missed)
    const runCleanup = async () => {
      try {
        this.logger.log('Running scheduled storage cleanup');
        await this.performCleanup();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Scheduled cleanup failed: ${errorMessage}`);
      }
    };

    // Calculate milliseconds until next 2 AM
    const now = new Date();
    const next2AM = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + (now.getHours() >= 2 ? 1 : 0),
      2,
      0,
      0,
      0,
    );
    const msUntil2AM = next2AM.getTime() - now.getTime();

    // Schedule first run
    setTimeout(() => {
      runCleanup();
      // Then run daily
      setInterval(runCleanup, 24 * 60 * 60 * 1000); // 24 hours
    }, msUntil2AM);

    this.logger.log(`Cleanup scheduler started, next run at: ${next2AM.toISOString()}`);
  }

  /**
   * Update archives total metric by querying database
   */
  private async updateArchivesMetric(): Promise<void> {
    try {
      const count = await this.prisma.workspaceArchive.count({
        where: { status: ArchiveStatus.ARCHIVED },
      });
      this.metrics.setGauge('storage_archives_total', count);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to update archives metric: ${errorMessage}`);
    }
  }
}
