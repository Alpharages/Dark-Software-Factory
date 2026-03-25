import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIProvider } from '@/prisma/client';
import { PrismaService } from '../database/prisma.service';
import { IProviderHealth } from './interfaces';
import { Counter, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';

/**
 * Provider Health Monitoring Service
 *
 * Tracks availability and load of AI providers:
 * - Cursor CLI Headless (primary)
 * - Claude Code (secondary)
 *
 * Per architecture: Auto-fallback when primary unavailable
 */
@Injectable()
export class ProviderHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProviderHealthService.name);

  // In-memory health cache (updated periodically)
  private healthStatus: Map<AIProvider, IProviderHealth> = new Map();
  private healthCheckInterval: NodeJS.Timeout | null = null;

  // Track unavailability duration for alerts
  private unavailableSince: Map<AIProvider, Date> = new Map();

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @InjectMetric('ai_provider_health')
    private readonly healthGauge: Gauge<string>,
    @InjectMetric('ai_provider_active_executions')
    private readonly activeExecutionsGauge: Gauge<string>,
    @InjectMetric('ai_provider_availability_total')
    private readonly availabilityCounter: Counter<string>,
  ) {}

  async onModuleInit(): Promise<void> {
    // Initialize health status for all providers
    await this.checkAllProviders();

    // Start periodic health checks (every 30 seconds)
    this.healthCheckInterval = setInterval(() => this.checkAllProviders(), 30000);

    this.logger.log('Provider health monitoring initialized');
  }

  onModuleDestroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Get health status for a specific provider
   */
  async getProviderHealth(provider: AIProvider): Promise<IProviderHealth> {
    // Check if provider is enabled
    const isEnabled = this.isProviderEnabled(provider);

    if (!isEnabled) {
      return {
        provider,
        isHealthy: false,
        lastChecked: new Date(),
        currentLoad: 0,
        maxConcurrent: 0,
        activeExecutions: 0,
        errorMessage: `Provider ${provider} is disabled in configuration`,
      };
    }

    // Get active execution count from database
    const activeExecutions = await this.prisma.execution.count({
      where: {
        ai_provider: provider,
        status: { in: ['QUEUED', 'IN_PROGRESS'] },
      },
    });

    const maxConcurrent = this.getMaxConcurrent(provider);
    const currentLoad = maxConcurrent > 0 ? (activeExecutions / maxConcurrent) * 100 : 0;
    const isHealthy = activeExecutions < maxConcurrent;

    const health: IProviderHealth = {
      provider,
      isHealthy,
      lastChecked: new Date(),
      currentLoad,
      maxConcurrent,
      activeExecutions,
    };

    // Update metrics
    this.healthGauge.set({ provider }, isHealthy ? 1 : 0);
    this.activeExecutionsGauge.set({ provider }, activeExecutions);

    // Track unavailability
    if (!isHealthy) {
      if (!this.unavailableSince.has(provider)) {
        this.unavailableSince.set(provider, new Date());
        this.availabilityCounter.inc({ provider, status: 'unavailable' });
      }
    } else {
      if (this.unavailableSince.has(provider)) {
        this.unavailableSince.delete(provider);
        this.availabilityCounter.inc({ provider, status: 'available' });
      }
    }

    // Cache the health status
    this.healthStatus.set(provider, health);

    return health;
  }

  /**
   * Get first available provider, with optional preferred provider
   */
  async getAvailableProvider(
    preferredProvider?: AIProvider,
  ): Promise<{ provider: AIProvider; health: IProviderHealth } | null> {
    // Try preferred provider first
    if (preferredProvider) {
      const health = await this.getProviderHealth(preferredProvider);
      if (health.isHealthy) {
        return { provider: preferredProvider, health };
      }
    }

    // Try all providers in priority order
    for (const provider of Object.values(AIProvider)) {
      if (provider === preferredProvider) continue; // Already checked

      const health = await this.getProviderHealth(provider);
      if (health.isHealthy) {
        return { provider, health };
      }
    }

    return null; // No providers available
  }

  /**
   * Get duration a provider has been unavailable
   */
  getUnavailableDuration(provider: AIProvider): number | null {
    const since = this.unavailableSince.get(provider);
    if (!since) return null;

    return Date.now() - since.getTime();
  }

  /**
   * Check if alert threshold exceeded for any provider
   */
  shouldAlert(provider: AIProvider): boolean {
    const duration = this.getUnavailableDuration(provider);
    if (!duration) return false;

    const alertThresholdMs =
      this.configService.get<number>('ai.routing.alertThresholdMinutes', 15) * 60 * 1000;
    return duration > alertThresholdMs;
  }

  /**
   * Check all providers periodically
   */
  private async checkAllProviders(): Promise<void> {
    for (const provider of Object.values(AIProvider)) {
      try {
        await this.getProviderHealth(provider);
      } catch (_error) {
        this.logger.error(`Failed to check provider ${provider}:`, _error);
      }
    }
  }

  /**
   * Convert AIProvider SCREAMING_SNAKE_CASE to camelCase config key segment.
   * CLAUDE_CODE → claudeCode, CURSOR_HEADLESS → cursorHeadless, GEMINI → gemini
   */
  private providerConfigKey(provider: AIProvider): string {
    return String(provider)
      .toLowerCase()
      .replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
  }

  /**
   * Check if provider is enabled in configuration
   */
  private isProviderEnabled(provider: AIProvider): boolean {
    const configKey = this.providerConfigKey(provider);
    return this.configService.get<boolean>(`ai.providers.${configKey}.enabled`, false);
  }

  /**
   * Get max concurrent executions for provider
   */
  private getMaxConcurrent(provider: AIProvider): number {
    const configKey = this.providerConfigKey(provider);
    return this.configService.get<number>(`ai.providers.${configKey}.maxConcurrent`, 3);
  }
}
