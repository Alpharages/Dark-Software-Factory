/**
 * ClickUp Sync Strategy
 *
 * Strategy pattern for switching between webhook and polling modes
 * Automatically handles fallback and mode switching
 */

export interface IClickUpSyncStrategy {
  /**
   * Check if this strategy is enabled
   */
  isEnabled(): boolean;

  /**
   * Get strategy mode name
   */
  getMode(): 'webhook' | 'polling';

  /**
   * Health check for this strategy
   */
  healthCheck(): Promise<{ healthy: boolean; message: string }>;
}

/**
 * Webhook-based sync strategy
 */
export class WebhookSyncStrategy implements IClickUpSyncStrategy {
  constructor(
    private readonly webhookEnabled: boolean,
    private readonly hasSecret: boolean,
  ) {}

  isEnabled(): boolean {
    return this.webhookEnabled && this.hasSecret;
  }

  getMode(): 'webhook' {
    return 'webhook';
  }

  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    if (!this.webhookEnabled) {
      return {
        healthy: false,
        message: 'Webhooks disabled in configuration',
      };
    }

    if (!this.hasSecret) {
      return {
        healthy: false,
        message: 'Webhook secret not configured',
      };
    }

    return {
      healthy: true,
      message: 'Webhook mode active and configured',
    };
  }
}

/**
 * Polling-based sync strategy
 */
export class PollingSyncStrategy implements IClickUpSyncStrategy {
  constructor(
    private readonly pollingEnabled: boolean,
    private readonly hasMonitoredLists: boolean,
  ) {}

  isEnabled(): boolean {
    return this.pollingEnabled && this.hasMonitoredLists;
  }

  getMode(): 'polling' {
    return 'polling';
  }

  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    if (!this.pollingEnabled) {
      return {
        healthy: false,
        message: 'Polling disabled - webhooks enabled',
      };
    }

    if (!this.hasMonitoredLists) {
      return {
        healthy: false,
        message: 'No active ClickUp projects configured for monitoring in database',
      };
    }

    return {
      healthy: true,
      message: 'Polling mode active',
    };
  }
}

/**
 * Hybrid strategy - uses webhooks with polling as fallback
 */
export class HybridSyncStrategy {
  private primaryStrategy: IClickUpSyncStrategy;
  private fallbackStrategy: IClickUpSyncStrategy;

  constructor(webhookStrategy: WebhookSyncStrategy, pollingStrategy: PollingSyncStrategy) {
    // Prefer webhooks if available, fallback to polling
    if (webhookStrategy.isEnabled()) {
      this.primaryStrategy = webhookStrategy;
      this.fallbackStrategy = pollingStrategy;
    } else {
      this.primaryStrategy = pollingStrategy;
      this.fallbackStrategy = webhookStrategy;
    }
  }

  /**
   * Get current active strategy
   */
  getActiveStrategy(): IClickUpSyncStrategy {
    return this.primaryStrategy.isEnabled() ? this.primaryStrategy : this.fallbackStrategy;
  }

  /**
   * Get current mode
   */
  getCurrentMode(): 'webhook' | 'polling' | 'none' {
    const active = this.getActiveStrategy();
    if (!active.isEnabled()) {
      return 'none';
    }
    return active.getMode();
  }

  /**
   * Check if fallback is active
   */
  isFallbackActive(): boolean {
    return !this.primaryStrategy.isEnabled() && this.fallbackStrategy.isEnabled();
  }

  /**
   * Health check for hybrid mode
   */
  async healthCheck(): Promise<{
    mode: string;
    primary: { mode: string; healthy: boolean; message: string };
    fallback: { mode: string; healthy: boolean; message: string };
  }> {
    const primaryHealth = await this.primaryStrategy.healthCheck();
    const fallbackHealth = await this.fallbackStrategy.healthCheck();

    return {
      mode: this.getCurrentMode(),
      primary: {
        mode: this.primaryStrategy.getMode(),
        healthy: primaryHealth.healthy,
        message: primaryHealth.message,
      },
      fallback: {
        mode: this.fallbackStrategy.getMode(),
        healthy: fallbackHealth.healthy,
        message: fallbackHealth.message,
      },
    };
  }
}
