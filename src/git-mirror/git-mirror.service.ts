/**
 * Git Mirror Service
 * Story 23.1: Local Git Mirror Service
 *
 * Manages local bare mirrors of GitHub repositories for fast workspace cloning.
 * AC#1: Check for existing local mirror, clone from mirror instead of GitHub
 * AC#2: Create bare mirror if not exists
 * AC#3: Refresh stale mirrors
 * AC#4: Handle authentication properly
 * AC#5: LRU eviction when disk space low
 * AC#6: Prometheus metrics tracking
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Gauge, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { StorageManagerService } from '../storage/storage-manager.service';
import { GitHubAuthService } from '../github/github-auth.service';
import type { MirrorInfo } from './interfaces/mirror-info.interface';
import {
  MirrorMetadata,
  MirrorsMetadataFile,
  MirrorEvictionCandidate,
} from './interfaces/mirror-metadata.interface';
import {
  MirrorAuthError,
  MirrorNetworkError,
  MirrorDiskSpaceError,
  MirrorLockTimeoutError,
} from './exceptions/git-mirror.exception';

const execFileAsync = promisify(execFile);

/**
 * Retry configuration for operations
 */
interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/**
 * Lock holder for mirror operations
 */
interface MirrorLock {
  promise: Promise<void>;
  release: () => void;
}

@Injectable()
export class GitMirrorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GitMirrorService.name);

  // Configuration
  private mirrorBasePath!: string;
  private mirrorTtlHours!: number;
  private mirrorMaxSizeGb!: number;
  private mirrorMinFreeSpaceGb!: number;
  private mirrorCleanupIntervalMs!: number;
  private enabled!: boolean;
  private gitToken!: string;

  // Git configuration
  private readonly DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes
  private readonly LOCK_TIMEOUT_MS = 30_000; // 30 seconds
  private readonly RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
  };

  // Cleanup interval reference
  private cleanupIntervalId?: NodeJS.Timeout;

  // Metadata cache
  private metadataCache: Map<string, MirrorMetadata> = new Map();
  private metadataFilePath!: string;
  private metadataWriteTimeout?: NodeJS.Timeout;
  private readonly METADATA_WRITE_DEBOUNCE_MS = 1000;

  // Mirror locks for concurrent access control
  private mirrorLocks = new Map<string, MirrorLock>();

  constructor(
    private readonly config: ConfigService,
    private readonly storageManager: StorageManagerService,
    private readonly githubAuthService: GitHubAuthService,
    @InjectMetric('git_mirror_total') private readonly mirrorGauge: Gauge<string>,
    @InjectMetric('git_mirror_hit_total') private readonly hitCounter: Counter<string>,
    @InjectMetric('git_mirror_clone_duration_seconds')
    private readonly cloneHistogram: Histogram<string>,
    @InjectMetric('git_mirror_update_duration_seconds')
    private readonly updateHistogram: Histogram<string>,
    @InjectMetric('git_mirror_size_bytes')
    private readonly sizeGauge: Gauge<string>,
    @InjectMetric('git_mirror_evicted_total')
    private readonly evictedCounter: Counter<string>,
  ) {}

  async onModuleInit(): Promise<void> {
    // Load configuration - using flat env var style keys
    this.mirrorBasePath = this.config.get<string>('GIT_MIRROR_BASE_PATH', '/tmp/dsf/git-mirrors');
    this.mirrorTtlHours = this.config.get<number>('GIT_MIRROR_TTL_HOURS', 24);
    this.mirrorMaxSizeGb = this.config.get<number>('GIT_MIRROR_MAX_SIZE_GB', 50);
    this.mirrorMinFreeSpaceGb = this.config.get<number>('GIT_MIRROR_MIN_FREE_SPACE_GB', 10);
    this.mirrorCleanupIntervalMs = this.config.get<number>(
      'GIT_MIRROR_CLEANUP_INTERVAL_MS',
      3600000,
    );
    this.enabled = this.config.get<boolean>('ENABLE_GIT_MIRRORING', true);
    // Use github.token config key to match GitHubAuthService pattern
    this.gitToken =
      this.config.get<string>('github.token') || this.config.get<string>('GITHUB_TOKEN', '');

    this.metadataFilePath = path.join(this.mirrorBasePath, '.metadata', 'mirrors.json');

    this.logger.log(
      `GitMirrorService initialized: enabled=${this.enabled}, basePath=${this.mirrorBasePath}, ttl=${this.mirrorTtlHours}h`,
    );

    if (this.enabled) {
      // Ensure mirror directory exists
      await this.ensureDirectoryExists(this.mirrorBasePath);
      await this.ensureDirectoryExists(path.dirname(this.metadataFilePath));

      // Load existing metadata
      await this.loadMetadata();

      // Start cleanup scheduler
      this.startCleanupScheduler();

      // Update metrics gauge
      await this.updateMirrorGauge();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = undefined;
    }
    // Flush any pending metadata writes
    if (this.metadataWriteTimeout) {
      clearTimeout(this.metadataWriteTimeout);
      await this.persistMetadata();
    }
    this.logger.log('GitMirrorService destroyed');
  }

  /**
   * Get or create a mirror for a repository
   * AC#1, AC#2: Check for existing mirror, create if not exists
   */
  async getOrCreateMirror(repoUrl: string): Promise<MirrorInfo> {
    if (!this.enabled) {
      throw new Error('Git mirroring is disabled');
    }

    const { owner, repo } = this.parseRepositoryUrl(repoUrl);
    const mirrorKey = `${owner}/${repo}`;

    // Acquire lock for this specific mirror to prevent concurrent modifications
    const lockRelease = await this.acquireMirrorLock(mirrorKey);

    try {
      const mirrorPath = this.getMirrorPath(owner, repo);

      // Check if mirror exists and is valid
      const exists = await this.directoryExists(mirrorPath);

      if (exists) {
        // Check for corruption first
        const isCorrupted = await this.isMirrorCorrupted(mirrorPath);
        if (isCorrupted) {
          this.logger.warn(`Mirror for ${mirrorKey} is corrupted, recreating...`);
          await this.removeMirror(owner, repo);
          await this.createBareMirror(owner, repo);
        } else {
          // Check if stale
          const metadata = this.metadataCache.get(mirrorKey);
          if (metadata) {
            const lastUpdated = new Date(metadata.lastUpdated);
            if (this.isMirrorStale(lastUpdated)) {
              this.logger.log(`Mirror for ${mirrorKey} is stale, updating...`);
              await this.updateBareMirror(owner, repo);
            }
          } else {
            // Mirror exists but no metadata - recreate
            this.logger.warn(`Mirror exists but metadata missing for ${mirrorKey}, recreating...`);
            await this.removeMirror(owner, repo);
            await this.createBareMirror(owner, repo);
          }
        }
      } else {
        // Check disk space before creating
        await this.checkDiskSpaceForMirror();

        // Create new mirror with retry logic
        this.logger.log(`Creating new mirror for ${mirrorKey}...`);
        await this.createBareMirrorWithRetry(owner, repo);
      }

      // Get current mirror info
      const info = await this.getMirrorInfo(owner, repo);

      // Update metadata
      await this.updateMetadata(owner, repo, {
        lastUsed: new Date().toISOString(),
        cloneCount: info.cloneCount + 1,
      });

      return info;
    } finally {
      lockRelease();
    }
  }

  /**
   * Clone from mirror to workspace
   * AC#1: Clone from local mirror instead of GitHub
   */
  async cloneFromMirror(mirrorPath: string, targetPath: string): Promise<void> {
    const startTime = Date.now();

    try {
      // Ensure target directory exists
      await this.ensureDirectoryExists(path.dirname(targetPath));

      const { owner, repo } = this.parseMirrorPath(mirrorPath);
      const repoUrl = `https://github.com/${owner}/${repo}.git`;

      // Use --reference for object sharing, with proper authentication via env
      await this.execGitWithAuth(
        ['clone', '--reference', mirrorPath, repoUrl, targetPath],
        undefined,
        'Clone from mirror',
      );

      // Record metrics
      const durationMs = Date.now() - startTime;
      this.cloneHistogram.observe({ source: 'mirror', status: 'success' }, durationMs / 1000);
      this.hitCounter.inc({ result: 'hit' });

      this.logger.debug(`Cloned from mirror to ${targetPath} in ${durationMs}ms`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Record failure metrics
      const durationMs = Date.now() - startTime;
      this.cloneHistogram.observe({ source: 'mirror', status: 'failed' }, durationMs / 1000);
      this.hitCounter.inc({ result: 'miss' });

      throw new MirrorNetworkError(mirrorPath, errorMessage);
    }
  }

  /**
   * Create a bare mirror from GitHub with retry logic
   * AC#2: Fetch from GitHub and create bare mirror
   */
  private async createBareMirrorWithRetry(owner: string, repo: string): Promise<string> {
    return this.withRetry(
      () => this.createBareMirror(owner, repo),
      `create mirror for ${owner}/${repo}`,
    );
  }

  /**
   * Create a bare mirror from GitHub
   */
  private async createBareMirror(owner: string, repo: string): Promise<string> {
    const mirrorPath = this.getMirrorPath(owner, repo);
    const repoUrl = `https://github.com/${owner}/${repo}.git`;

    try {
      // Check authentication token
      if (!this.gitToken) {
        throw new MirrorAuthError(repoUrl);
      }

      // Create parent directory
      await this.ensureDirectoryExists(path.dirname(mirrorPath));

      // Clone as bare mirror with authentication embedded in URL
      const authenticatedUrl = repoUrl.replace(
        'https://',
        `https://x-access-token:${this.gitToken}@`,
      );

      await this.execGitWithAuth(
        ['clone', '--mirror', authenticatedUrl, mirrorPath],
        undefined,
        'Create bare mirror',
      );

      // Get mirror size
      const sizeBytes = await this.getDirectorySize(mirrorPath);

      // Create metadata
      const now = new Date().toISOString();
      const metadata: MirrorMetadata = {
        owner,
        repo,
        mirrorPath,
        sizeBytes,
        lastUpdated: now,
        lastUsed: now,
        cloneCount: 0,
        updateCount: 0,
        repositoryUrl: repoUrl,
        createdAt: now,
      };

      await this.saveMetadata(owner, repo, metadata);

      // Update metrics
      await this.updateMirrorGauge();
      this.sizeGauge.set({ owner, repo }, sizeBytes);

      this.logger.log(`Created mirror for ${owner}/${repo}: ${this.formatBytes(sizeBytes)}`);

      return mirrorPath;
    } catch (error: unknown) {
      // Clean up on failure
      await this.removeMirror(owner, repo).catch(() => {});

      if (error instanceof MirrorAuthError) throw error;

      const errorMessage = error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes('401') ||
        errorMessage.includes('403') ||
        errorMessage.includes('authentication')
      ) {
        throw new MirrorAuthError(repoUrl);
      }
      throw new MirrorNetworkError(repoUrl, errorMessage);
    }
  }

  /**
   * Update existing bare mirror with retry logic
   * AC#3: Refresh stale mirror with git fetch --prune
   */
  async updateBareMirror(owner: string, repo: string): Promise<void> {
    return this.withRetry(
      () => this.doUpdateBareMirror(owner, repo),
      `update mirror for ${owner}/${repo}`,
    );
  }

  private async doUpdateBareMirror(owner: string, repo: string): Promise<void> {
    const mirrorPath = this.getMirrorPath(owner, repo);
    const startTime = Date.now();

    try {
      // Check if mirror exists
      if (!(await this.directoryExists(mirrorPath))) {
        throw new Error(`Mirror does not exist: ${mirrorPath}`);
      }

      // Run git fetch --prune in the mirror with authentication
      // We need to pass the authenticated URL explicitly since the remote might not have the token saved
      const repoUrl = `https://github.com/${owner}/${repo}.git`;
      const authenticatedUrl = repoUrl.replace(
        'https://',
        `https://x-access-token:${this.gitToken}@`,
      );

      await this.execGitWithAuth(
        ['fetch', authenticatedUrl, '--prune'],
        mirrorPath,
        'Update bare mirror',
      );

      // Update metadata
      const now = new Date().toISOString();
      const metadata = this.metadataCache.get(`${owner}/${repo}`);
      if (metadata) {
        metadata.lastUpdated = now;
        metadata.updateCount = (metadata.updateCount || 0) + 1;
        await this.saveMetadata(owner, repo, metadata);
      }

      // Record metrics
      const durationMs = Date.now() - startTime;
      this.updateHistogram.observe({ status: 'success' }, durationMs / 1000);

      this.logger.log(`Updated mirror for ${owner}/${repo} in ${durationMs}ms`);
    } catch (error: unknown) {
      const durationMs = Date.now() - startTime;
      this.updateHistogram.observe({ status: 'failed' }, durationMs / 1000);

      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new MirrorNetworkError(`${owner}/${repo}`, errorMessage);
    }
  }

  /**
   * Check if mirror is corrupted using git fsck
   */
  private async isMirrorCorrupted(mirrorPath: string): Promise<boolean> {
    try {
      await this.execGit(['fsck', '--full'], mirrorPath, 'Check mirror integrity');
      return false;
    } catch {
      return true;
    }
  }

  /**
   * Check if mirror is stale (older than TTL)
   * AC#3: Staleness detection
   */
  isMirrorStale(lastUpdated: Date): boolean {
    const ttlMs = this.mirrorTtlHours * 60 * 60 * 1000;
    return Date.now() - lastUpdated.getTime() > ttlMs;
  }

  /**
   * Get mirror information
   */
  async getMirrorInfo(owner: string, repo: string): Promise<MirrorInfo> {
    const mirrorPath = this.getMirrorPath(owner, repo);
    const metadata = this.metadataCache.get(`${owner}/${repo}`);

    if (!metadata) {
      throw new Error(`No metadata found for ${owner}/${repo}`);
    }

    // Recalculate size in case it changed
    const sizeBytes = await this.getDirectorySize(mirrorPath);

    return {
      owner,
      repo,
      mirrorPath,
      sizeBytes,
      lastUpdated: new Date(metadata.lastUpdated),
      lastUsed: new Date(metadata.lastUsed),
      cloneCount: metadata.cloneCount,
    };
  }

  /**
   * Remove a mirror
   */
  async removeMirror(owner: string, repo: string): Promise<void> {
    const mirrorPath = this.getMirrorPath(owner, repo);
    const mirrorKey = `${owner}/${repo}`;

    try {
      // Remove directory
      await fs.rm(mirrorPath, { recursive: true, force: true });

      // Remove metadata
      this.metadataCache.delete(mirrorKey);
      await this.scheduleMetadataWrite();

      // Update gauge
      await this.updateMirrorGauge();

      this.logger.log(`Removed mirror for ${mirrorKey}`);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to remove mirror ${mirrorKey}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Clean up stale mirrors
   * AC#3, AC#5: Periodic cleanup of stale mirrors
   */
  async cleanupStaleMirrors(): Promise<number> {
    const now = Date.now();
    const ttlMs = this.mirrorTtlHours * 60 * 60 * 1000;
    let removed = 0;

    for (const [key, metadata] of this.metadataCache.entries()) {
      const lastUpdated = new Date(metadata.lastUpdated).getTime();
      if (now - lastUpdated > ttlMs) {
        const [owner, repo] = key.split('/');
        this.logger.log(`Cleaning up stale mirror: ${key}`);
        await this.removeMirror(owner, repo);
        removed++;
      }
    }

    if (removed > 0) {
      this.logger.log(`Cleaned up ${removed} stale mirrors`);
    }

    return removed;
  }

  /**
   * Evict oldest mirrors if disk space is low
   * AC#5: LRU eviction when space falls below threshold
   */
  async evictOldestMirrorsIfNeeded(): Promise<number> {
    // Get disk usage using StorageManagerService
    const diskUsage = await this.storageManager.getDiskUsage();
    const minFreeBytes = this.mirrorMinFreeSpaceGb * 1024 * 1024 * 1024;

    if (Number(diskUsage.availableBytes) > minFreeBytes) {
      return 0; // No eviction needed
    }

    this.logger.warn(
      `Disk space low: ${this.formatBytes(Number(diskUsage.availableBytes))} available, need ${this.mirrorMinFreeSpaceGb}GB`,
    );

    // Get all mirrors sorted by lastUsed (oldest first)
    const candidates: MirrorEvictionCandidate[] = Array.from(this.metadataCache.entries()).map(
      ([, metadata]) => ({
        owner: metadata.owner,
        repo: metadata.repo,
        mirrorPath: metadata.mirrorPath,
        sizeBytes: metadata.sizeBytes,
        lastUsed: new Date(metadata.lastUsed),
        cloneCount: metadata.cloneCount,
      }),
    );

    // Sort by lastUsed (oldest first), then by cloneCount (lowest first)
    candidates.sort((a, b) => {
      const timeDiff = a.lastUsed.getTime() - b.lastUsed.getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.cloneCount - b.cloneCount;
    });

    let evicted = 0;

    for (const candidate of candidates) {
      // Check if we have enough space now
      const currentUsage = await this.storageManager.getDiskUsage();
      if (Number(currentUsage.availableBytes) > minFreeBytes) {
        break;
      }

      // Evict this mirror
      try {
        await this.removeMirror(candidate.owner, candidate.repo);
        this.evictedCounter.inc({ reason: 'disk_space' });
        this.logger.log(
          `Evicted mirror ${candidate.owner}/${candidate.repo} (${this.formatBytes(candidate.sizeBytes)})`,
        );
        evicted++;
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to evict mirror ${candidate.owner}/${candidate.repo}: ${errorMessage}`,
        );
      }
    }

    if (evicted > 0) {
      this.logger.log(`Evicted ${evicted} mirrors due to low disk space`);
    }

    return evicted;
  }

  /**
   * Get all mirrors
   */
  async getAllMirrors(): Promise<MirrorInfo[]> {
    const mirrors: MirrorInfo[] = [];

    for (const [key] of this.metadataCache.entries()) {
      const [owner, repo] = key.split('/');
      try {
        const info = await this.getMirrorInfo(owner, repo);
        mirrors.push(info);
      } catch (error: unknown) {
        this.logger.warn(`Failed to get info for ${key}: ${error}`);
      }
    }

    return mirrors;
  }

  // ============= Private Helper Methods =============

  /**
   * Acquire a lock for a specific mirror
   * Prevents concurrent operations on the same mirror
   */
  private async acquireMirrorLock(mirrorKey: string): Promise<() => void> {
    const existingLock = this.mirrorLocks.get(mirrorKey);

    if (existingLock) {
      // Wait for existing lock with timeout
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(new MirrorLockTimeoutError(mirrorKey, this.LOCK_TIMEOUT_MS));
        }, this.LOCK_TIMEOUT_MS);
      });

      await Promise.race([existingLock.promise, timeoutPromise]);
    }

    // Create new lock
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = () => {
        this.mirrorLocks.delete(mirrorKey);
        resolve();
      };
    });

    this.mirrorLocks.set(mirrorKey, {
      promise: lockPromise,
      release: releaseLock!,
    });

    return releaseLock!;
  }

  /**
   * Retry wrapper with exponential backoff
   */
  private async withRetry<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < this.RETRY_CONFIG.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry auth errors
        if (error instanceof MirrorAuthError) {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt === this.RETRY_CONFIG.maxRetries - 1) {
          break;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          this.RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt),
          this.RETRY_CONFIG.maxDelayMs,
        );

        this.logger.warn(
          `${operationName} failed (attempt ${attempt + 1}/${this.RETRY_CONFIG.maxRetries}), ` +
            `retrying in ${delay}ms: ${lastError.message}`,
        );

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Parse repository URL to extract owner and repo
   */
  private parseRepositoryUrl(url: string): { owner: string; repo: string } {
    // Handle HTTPS URLs: https://github.com/owner/repo.git or https://github.com/owner/repo
    const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
    if (httpsMatch) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    throw new Error(`Invalid repository URL format: ${url}`);
  }

  /**
   * Parse mirror path to extract owner and repo
   */
  private parseMirrorPath(mirrorPath: string): { owner: string; repo: string } {
    const relativePath = path.relative(this.mirrorBasePath, mirrorPath);
    const parts = relativePath.split(path.sep);
    if (parts.length >= 2) {
      const owner = parts[0];
      const repo = parts[1].replace(/\.git$/, '');
      return { owner, repo };
    }
    throw new Error(`Invalid mirror path: ${mirrorPath}`);
  }

  /**
   * Get mirror path for owner/repo
   */
  private getMirrorPath(owner: string, repo: string): string {
    return path.join(this.mirrorBasePath, owner, `${repo}.git`);
  }

  /**
   * Check disk space before creating new mirror
   */
  private async checkDiskSpaceForMirror(): Promise<void> {
    const diskUsage = await this.storageManager.getDiskUsage();
    const minFreeBytes = this.mirrorMinFreeSpaceGb * 1024 * 1024 * 1024;

    if (Number(diskUsage.availableBytes) < minFreeBytes) {
      // Try eviction first
      await this.evictOldestMirrorsIfNeeded();

      // Check again
      const updatedUsage = await this.storageManager.getDiskUsage();
      if (Number(updatedUsage.availableBytes) < minFreeBytes) {
        throw new MirrorDiskSpaceError(minFreeBytes, Number(updatedUsage.availableBytes));
      }
    }
  }

  /**
   * Load metadata from file
   */
  private async loadMetadata(): Promise<void> {
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const content = await fs.readFile(this.metadataFilePath, 'utf-8');
      const data: MirrorsMetadataFile = JSON.parse(content);

      this.metadataCache.clear();
      for (const [key, mirrorMetadata] of Object.entries(data.mirrors)) {
        this.metadataCache.set(key, mirrorMetadata);
      }

      this.logger.log(`Loaded metadata for ${this.metadataCache.size} mirrors`);
    } catch {
      // File doesn't exist or is corrupt - start fresh
      this.metadataCache.clear();
      this.logger.log('No existing metadata found, starting fresh');
    }
  }

  /**
   * Persist metadata to file immediately
   */
  private async persistMetadata(): Promise<void> {
    const data: MirrorsMetadataFile = {
      version: '1.0',
      lastUpdated: new Date().toISOString(),
      mirrors: Object.fromEntries(this.metadataCache),
    };

    await this.ensureDirectoryExists(path.dirname(this.metadataFilePath));
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.writeFile(this.metadataFilePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Schedule a debounced metadata write
   */
  private async scheduleMetadataWrite(): Promise<void> {
    if (this.metadataWriteTimeout) {
      clearTimeout(this.metadataWriteTimeout);
    }

    this.metadataWriteTimeout = setTimeout(async () => {
      try {
        await this.persistMetadata();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to persist metadata: ${errorMessage}`);
      }
    }, this.METADATA_WRITE_DEBOUNCE_MS);
  }

  /**
   * Save metadata for a mirror (with debounced persist)
   */
  private async saveMetadata(
    owner: string,
    repo: string,
    _metadata: MirrorMetadata,
  ): Promise<void> {
    const key = `${owner}/${repo}`;
    this.metadataCache.set(key, _metadata);
    await this.scheduleMetadataWrite();
  }

  /**
   * Update metadata fields for a mirror (with debounced persist)
   */
  private async updateMetadata(
    owner: string,
    repo: string,
    updates: Partial<MirrorMetadata>,
  ): Promise<void> {
    const key = `${owner}/${repo}`;
    const existing = this.metadataCache.get(key);
    if (existing) {
      Object.assign(existing, updates);
      await this.scheduleMetadataWrite();
    }
  }

  /**
   * Start periodic cleanup scheduler
   */
  private startCleanupScheduler(): void {
    // Skip scheduler in test environment or if interval is 0/negative
    if (this.mirrorCleanupIntervalMs <= 0 || process.env.NODE_ENV === 'test') {
      return;
    }

    this.cleanupIntervalId = setInterval(async () => {
      try {
        this.logger.debug('Running scheduled mirror cleanup');
        await this.cleanupStaleMirrors();
        await this.evictOldestMirrorsIfNeeded();
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Scheduled cleanup failed: ${errorMessage}`);
      }
    }, this.mirrorCleanupIntervalMs);

    this.logger.log(`Cleanup scheduler started, interval: ${this.mirrorCleanupIntervalMs}ms`);
  }

  /**
   * Update Prometheus gauge with current mirror count
   */
  private async updateMirrorGauge(): Promise<void> {
    this.mirrorGauge.set(this.metadataCache.size);
  }

  /**
   * Ensure directory exists
   */
  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await fs.mkdir(dirPath, { recursive: true });
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
   * Calculate directory size recursively
   */
  private async getDirectorySize(dirPath: string): Promise<number> {
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

    try {
      await walkDir(dirPath);
    } catch {
      // Directory may not exist
      return 0;
    }

    return totalSize;
  }

  /**
   * Execute git command safely using execFile
   */
  private async execGit(
    args: string[],
    cwd?: string,
    description?: string,
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      this.logger.debug(`${description || 'Git'}: git ${this.sanitizeGitArgs(args)}`);

      const result = await execFileAsync('git', args, {
        cwd,
        timeout: this.DEFAULT_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      return { stdout: result.stdout, stderr: result.stderr };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // Sanitize error message to prevent token exposure
      const sanitizedError = this.sanitizeErrorMessage(errorMessage);
      this.logger.error(`Git command failed: git ${this.sanitizeGitArgs(args)}`, sanitizedError);
      throw new Error(`Git operation failed: ${sanitizedError}`);
    }
  }

  /**
   * Execute git command with authentication options
   * Note: We now use URL embedding for auth, so this method mainly handles execution and logging
   */
  private async execGitWithAuth(
    args: string[],
    cwd?: string,
    description?: string,
  ): Promise<string> {
    const commandDesc = description || `git ${args[0]}`;
    const sanitizedArgs = this.sanitizeGitArgs(args);

    this.logger.debug(`Executing: git ${sanitizedArgs}`);

    try {
      const { stdout } = await execFileAsync('git', args, {
        cwd,
        timeout: this.DEFAULT_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        env: {
          ...process.env,
          // Disable interactive prompts
          GIT_TERMINAL_PROMPT: '0',
          // Ensure we don't use any other credentials
          GIT_ASKPASS: 'echo',
        },
      });

      return stdout;
    } catch (error: unknown) {
      const errorMessage = this.sanitizeErrorMessage(
        error instanceof Error ? error.message : String(error),
      );

      this.logger.error(`Failed to ${commandDesc}: ${errorMessage}`);
      throw error;
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

  /**
   * Format bytes to human-readable string
   */
  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    // eslint-disable-next-line security/detect-object-injection
    return `${value.toFixed(2)} ${units[unitIndex]}`;
  }
}
