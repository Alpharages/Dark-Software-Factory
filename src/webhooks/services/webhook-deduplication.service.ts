/**
 * Story 20.1: Webhook Deduplication Service
 *
 * Provides distributed idempotency for webhook processing using Redis.
 * Falls back to in-memory Map for single-instance deployments.
 *
 * AC2: Idempotent Job Queuing - ignore duplicate events within 5 minutes
 * AC6: Distributed Deduplication - Redis-based with fallback to memory
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class WebhookDeduplicationService implements OnModuleDestroy {
  private readonly logger = new Logger(WebhookDeduplicationService.name);
  private readonly redis: Redis | null = null;
  private readonly inMemoryCache = new Map<string, number>();
  private readonly dedupTtlMs: number;
  private readonly useRedis: boolean;
  private cleanupInterval: NodeJS.Timeout | null = null;

  // Redis key prefix for webhook deduplication
  private readonly REDIS_KEY_PREFIX = 'webhook:dedup:';

  constructor(private readonly configService: ConfigService) {
    this.dedupTtlMs = this.configService.get<number>('webhooks.dedupTtlMs', 300000);
    this.useRedis = this.configService.get<boolean>('webhooks.useRedisDeduplication', true);

    // Initialize Redis if URL is configured and Redis dedup is enabled
    const redisUrl = this.configService.get<string>('externalServices.redis.url');
    const redisEnabled = this.configService.get<boolean>('externalServices.redis.enabled', false);

    if (this.useRedis && redisEnabled && redisUrl) {
      try {
        this.redis = new Redis(redisUrl, {
          retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            this.logger.warn(`Redis retry attempt ${times}, delay ${delay}ms`);
            return delay;
          },
          maxRetriesPerRequest: 3,
        });

        this.redis.on('connect', () => {
          this.logger.log('Redis connected for webhook deduplication');
        });

        this.redis.on('error', (err) => {
          this.logger.error(`Redis error: ${err.message}`);
        });
      } catch (error) {
        this.logger.error(
          `Failed to initialize Redis: ${(error as Error).message}. Falling back to in-memory.`,
        );
      }
    }

    // Set up in-memory cleanup interval (runs every minute)
    const CLEANUP_INTERVAL_MS = 60 * 1000;
    this.cleanupInterval = setInterval(() => this.cleanupInMemoryCache(), CLEANUP_INTERVAL_MS);

    if (!this.redis) {
      this.logger.warn(
        'Using in-memory deduplication - not suitable for multi-instance deployments',
      );
    }
  }

  onModuleDestroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.redis) {
      this.redis.disconnect();
    }
  }

  /**
   * Check if a webhook is a duplicate and mark it as processed if not.
   *
   * AC2, AC6: Atomic check-and-set operation for idempotency
   *
   * @param webhookId - Unique webhook event ID
   * @param correlationId - Optional correlation ID for tracing
   * @returns Object with isDuplicate flag and metadata
   */
  async checkAndSet(
    webhookId: string,
    correlationId?: string,
  ): Promise<{
    isDuplicate: boolean;
    source: 'redis' | 'memory';
  }> {
    const logPrefix = correlationId ? `[${correlationId}]` : '';

    // Try Redis first if available
    if (this.redis) {
      try {
        const result = await this.checkAndSetRedis(webhookId);
        return result;
      } catch (error) {
        this.logger.warn(
          `${logPrefix} Redis deduplication failed for webhook ${webhookId}: ${(error as Error).message}. Falling back to in-memory.`,
        );
        // Fall through to in-memory fallback
      }
    }

    // In-memory fallback
    const result = this.checkAndSetMemory(webhookId);
    return { isDuplicate: result, source: 'memory' };
  }

  /**
   * Redis-based atomic check-and-set using SET NX (set if not exists)
   *
   * @param webhookId - Unique webhook event ID
   * @returns isDuplicate flag and source
   */
  private async checkAndSetRedis(webhookId: string): Promise<{
    isDuplicate: boolean;
    source: 'redis';
  }> {
    const key = `${this.REDIS_KEY_PREFIX}${webhookId}`;
    const ttlSeconds = Math.ceil(this.dedupTtlMs / 1000);

    // Use SET with NX (only if not exists) and EX (expire)
    // Returns 'OK' if set, null if key already exists
    const result = await this.redis!.set(key, Date.now().toString(), 'EX', ttlSeconds, 'NX');

    const isDuplicate = result === null;

    if (isDuplicate) {
      this.logger.debug(`Duplicate webhook detected in Redis: ${webhookId}`);
    }

    return { isDuplicate, source: 'redis' };
  }

  /**
   * In-memory check-and-set fallback
   *
   * @param webhookId - Unique webhook event ID
   * @returns true if duplicate, false if new
   */
  private checkAndSetMemory(webhookId: string): boolean {
    const now = Date.now();
    const processedAt = this.inMemoryCache.get(webhookId);

    if (processedAt && now - processedAt < this.dedupTtlMs) {
      this.logger.debug(`Duplicate webhook detected in memory: ${webhookId}`);
      return true;
    }

    // Mark as processed
    this.inMemoryCache.set(webhookId, now);
    return false;
  }

  /**
   * Clean up expired entries from in-memory cache
   */
  private cleanupInMemoryCache(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, timestamp] of this.inMemoryCache) {
      if (now - timestamp > this.dedupTtlMs) {
        this.inMemoryCache.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired webhook entries from memory cache`);
    }
  }

  /**
   * Check if Redis is connected and healthy
   */
  async isHealthy(): Promise<boolean> {
    if (!this.redis) {
      return true; // In-memory is always "healthy"
    }

    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get current deduplication backend type
   */
  getBackendType(): 'redis' | 'memory' {
    return this.redis ? 'redis' : 'memory';
  }

  /**
   * Get cache statistics (for monitoring)
   */
  getStats(): {
    backend: 'redis' | 'memory';
    inMemorySize: number;
    dedupTtlMs: number;
  } {
    return {
      backend: this.getBackendType(),
      inMemorySize: this.inMemoryCache.size,
      dedupTtlMs: this.dedupTtlMs,
    };
  }
}
