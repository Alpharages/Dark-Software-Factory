import { Injectable, Logger } from '@nestjs/common';
import { ProjectIntegration } from '@prisma/client';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { NormalizedStatus } from './providers/dto/normalized-status.dto';
import { SentryService } from '@/common/sentry/sentry.service';
import { ErrorCategory, ErrorSeverity } from '@/common/sentry/sentry.constants';

interface CacheEntry {
  statuses: NormalizedStatus[];
  expiresAt: number;
}

@Injectable()
export class PMStatusService {
  private readonly logger = new Logger(PMStatusService.name);
  private readonly CACHE_TTL_MS = 300_000; // 5 minutes
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly providerFactory: PMProviderFactory,
    private readonly sentry: SentryService,
  ) {}

  /**
   * Fetches workflow statuses with a 5-minute in-memory cache.
   * On API failure, falls back to stale cache if available.
   */
  async getStatuses(
    integration: ProjectIntegration,
    containerId: string,
  ): Promise<NormalizedStatus[]> {
    const key = `${integration.provider}:${containerId}`;
    const entry = this.cache.get(key);

    if (entry && entry.expiresAt > Date.now()) {
      return entry.statuses;
    }

    try {
      const provider = await this.providerFactory.getProvider(integration);
      const statuses = await provider.getStatuses(containerId);

      this.cache.set(key, {
        statuses,
        expiresAt: Date.now() + this.CACHE_TTL_MS,
      });

      return statuses;
    } catch (error: unknown) {
      if (entry) {
        this.logger.warn(`PM tool API unavailable for ${key} — returning stale statuses`);
        this.sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
          severity: ErrorSeverity.MEDIUM,
          category: ErrorCategory.NETWORK,
          tags: {
            provider: String(integration.provider),
            containerId,
            operation: 'getStatuses',
          },
        });
        return entry.statuses;
      }
      throw error;
    }
  }

  /**
   * Resolves a status name to its normalized ID.
   * Performs case-insensitive matching.
   */
  async resolveStatusId(
    integration: ProjectIntegration,
    containerId: string,
    statusName: string,
  ): Promise<string> {
    const statuses = await this.getStatuses(integration, containerId);
    const normalizedName = statusName.toLowerCase();

    const match = statuses.find((s) => s.name.toLowerCase() === normalizedName);

    if (match) {
      return match.id;
    }

    this.logger.warn(
      `No status found matching '${statusName}' for ${integration.provider}:${containerId} — using raw value as fallback`,
    );
    return statusName;
  }
}
