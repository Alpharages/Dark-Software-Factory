import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { DeploymentStatus } from '@/prisma/client';
import { LoggerService } from '../../common/logger';

@Injectable()
export class DeploymentSuccessRateCalculator {
  private readonly QUERY_LIMIT = 1000; // E4: Prevent unbounded queries

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly logger: LoggerService,
  ) {}

  async update(environment: string, _status: DeploymentStatus): Promise<void> {
    await this.updateRateForWindow(environment, '1h');
    await this.updateRateForWindow(environment, '24h');
    await this.updateRateForWindow(environment, '7d');
  }

  private async updateRateForWindow(
    environment: string,
    timeWindow: '1h' | '24h' | '7d',
  ): Promise<void> {
    const windowMs = this.getWindowMilliseconds(timeWindow);
    const since = new Date(Date.now() - windowMs);

    // E4: Add LIMIT to prevent performance issues
    const deployments = await this.prisma.deployment.findMany({
      where: {
        environment,
        deployed_at: { gte: since },
        status: { in: ['COMPLETED', 'FAILED', 'ROLLED_BACK'] },
      },
      select: { status: true },
      take: this.QUERY_LIMIT,
      orderBy: { deployed_at: 'desc' },
    });

    // E4: Warn if limit reached
    if (deployments.length === this.QUERY_LIMIT) {
      this.logger.warn('Hit deployment query limit for success rate calculation', {
        environment,
        timeWindow,
        limit: this.QUERY_LIMIT,
      });
    }

    const successRate =
      deployments.length === 0
        ? 100 // Optimistic default
        : (deployments.filter((d) => d.status === 'COMPLETED').length / deployments.length) * 100;

    this.metrics.setGauge('deployment_success_rate', successRate, {
      environment,
      time_window: timeWindow,
    });
  }

  private getWindowMilliseconds(window: string): number {
    const windows: Record<string, number> = { '1h': 3600000, '24h': 86400000, '7d': 604800000 };
    // eslint-disable-next-line security/detect-object-injection
    return windows[window] || 3600000;
  }
}
