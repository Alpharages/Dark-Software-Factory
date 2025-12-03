import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { Cache } from 'cache-manager';
import * as crypto from 'crypto';
import { IAggregatedContext } from './interfaces/context-document.interface';

/**
 * Context Cache Service - Story 2.12
 * Caches aggregated context for tickets to avoid repeated extraction
 * AC: Cache TTL configurable (default: 24 hours), invalidated on document update
 */
@Injectable()
export class ContextCacheService {
  private readonly logger = new Logger(ContextCacheService.name);
  private readonly cacheTtlMs: number;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {
    const ttlHours = this.configService.get<number>('context.cacheTtlHours', 24);
    this.cacheTtlMs = ttlHours * 60 * 60 * 1000;
  }

  /**
   * Generate cache key for a ticket's context
   * Key is based on ticket ID and document hashes to auto-invalidate on changes
   */
  generateCacheKey(ticketId: string, documentHashes: string[]): string {
    const sortedHashes = [...documentHashes].sort().join(':');
    const keyHash = crypto
      .createHash('sha256')
      .update(sortedHashes)
      .digest('hex')
      .substring(0, 16);
    return `context:${ticketId}:${keyHash}`;
  }

  /**
   * Get cached aggregated context
   */
  async getCachedContext(
    ticketId: string,
    documentHashes: string[],
  ): Promise<IAggregatedContext | null> {
    const cacheKey = this.generateCacheKey(ticketId, documentHashes);

    try {
      const cached = await this.cacheManager.get<IAggregatedContext>(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for ticket ${ticketId}`);
        return cached;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Cache get error: ${errorMessage}`);
    }

    return null;
  }

  /**
   * Store aggregated context in cache
   */
  async cacheContext(
    ticketId: string,
    documentHashes: string[],
    context: IAggregatedContext,
  ): Promise<void> {
    const cacheKey = this.generateCacheKey(ticketId, documentHashes);

    try {
      await this.cacheManager.set(cacheKey, context, this.cacheTtlMs);
      this.logger.debug(`Cached context for ticket ${ticketId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Cache set error: ${errorMessage}`);
    }
  }

  /**
   * Invalidate cache for a ticket
   * Called when documents are added or removed
   */
  async invalidateTicketCache(ticketId: string): Promise<void> {
    // With key-based invalidation, we don't need explicit deletion
    // since changing documents changes the hash in the cache key
    this.logger.debug(`Cache invalidation requested for ticket ${ticketId}`);
  }

  /**
   * Generate SHA-256 file hash for deduplication
   */
  generateFileHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Generate content hash for change detection
   */
  generateContentHash(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex').substring(0, 32);
  }
}
