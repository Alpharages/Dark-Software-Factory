/**
 * QA Review Metrics Service
 * Story 8.1: QA Review Queue & Sampling Configuration
 *
 * Manages Prometheus metrics for QA Review Queue:
 * - Queue depth by status
 * - Sampling rate
 * - Tickets sampled by strategy and risk
 * - Queue duration histogram
 * - Review decisions
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { Counter, Gauge, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaService } from '../../database/prisma.service';
import { QA_METRICS } from '../../common/metrics/metrics.constants';
import { QaReviewQueueService } from './qa-review-queue.service';

@Injectable()
export class QaReviewMetricsService implements OnModuleInit {
  constructor(
    @InjectMetric(QA_METRICS.REVIEW_QUEUE_DEPTH)
    private readonly queueDepthGauge: Gauge<string>,
    @InjectMetric(QA_METRICS.REVIEW_SAMPLING_RATE)
    private readonly samplingRateGauge: Gauge<string>,
    @InjectMetric(QA_METRICS.REVIEW_TICKETS_SAMPLED_TOTAL)
    private readonly ticketsSampledCounter: Counter<string>,
    @InjectMetric(QA_METRICS.REVIEW_TICKETS_BY_RISK_TOTAL)
    private readonly ticketsByRiskCounter: Counter<string>,
    @InjectMetric(QA_METRICS.REVIEW_QUEUE_DURATION_SECONDS)
    private readonly queueDurationHistogram: Histogram<string>,
    @InjectMetric(QA_METRICS.REVIEW_DECISIONS_TOTAL)
    private readonly decisionsCounter: Counter<string>,
    private readonly queueService: QaReviewQueueService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Initialize metrics on module startup
   */
  onModuleInit(): void {
    // Set initial queue depth metrics
    this.updateQueueDepth();

    // Periodically update queue depth (every 30 seconds)
    setInterval(() => {
      this.updateQueueDepth();
    }, 30000);
  }

  /**
   * Update queue depth gauge
   */
  async updateQueueDepth(): Promise<void> {
    try {
      const depths = await this.queueService.getQueueDepth();

      // Update gauge for each status
      Object.entries(depths).forEach(([status, count]) => {
        this.queueDepthGauge.set({ status }, count);
      });
    } catch {
      // Silently fail - metrics should not break the application
    }
  }

  /**
   * Set the current sampling rate
   * @param percentage - Sampling percentage (0-100)
   */
  setSamplingRate(percentage: number): void {
    this.samplingRateGauge.set(percentage);
  }

  /**
   * Record a ticket being sampled
   * @param strategy - Sampling strategy used
   * @param riskLevel - Risk level of the ticket
   */
  recordTicketSampled(strategy: string, riskLevel: string): void {
    this.ticketsSampledCounter.inc({
      strategy: strategy.toLowerCase(),
      risk_level: riskLevel.toLowerCase(),
    });
  }

  /**
   * Record a ticket by risk level
   * @param riskLevel - Risk level of the ticket
   */
  recordTicketByRisk(riskLevel: string): void {
    this.ticketsByRiskCounter.inc({
      risk_level: riskLevel.toLowerCase(),
    });
  }

  /**
   * Record queue duration
   * @param durationSeconds - Duration in seconds
   * @param riskLevel - Risk level of the ticket
   */
  recordQueueDuration(durationSeconds: number, riskLevel: string): void {
    this.queueDurationHistogram.observe(
      {
        risk_level: riskLevel.toLowerCase(),
      },
      durationSeconds,
    );
  }

  /**
   * Record a review decision
   * @param decision - Decision made (approved/rejected)
   */
  recordDecision(decision: string): void {
    this.decisionsCounter.inc({
      decision: decision.toLowerCase(),
    });
  }

  /**
   * Get current metric values for health checks
   * @returns Current metric snapshot
   */
  async getMetricsSnapshot(): Promise<{
    queueDepth: Record<string, number>;
    samplingRate: number;
  }> {
    const queueDepth = await this.queueService.getQueueDepth();

    // Get sampling rate from gauge
    const samplingRateMetric = await this.samplingRateGauge.get();
    const samplingRate = samplingRateMetric.values[0]?.value || 20;

    return {
      queueDepth,
      samplingRate,
    };
  }

  /**
   * Get aggregated metrics for the metrics API endpoint
   * @returns Aggregated sampling and queue metrics
   */
  async getAggregatedMetrics(): Promise<{
    totalTicketsProcessed: number;
    totalTicketsSampled: number;
    actualSampleRate: number;
    configuredSampleRate: number;
    riskDistribution: {
      high: number;
      medium: number;
      low: number;
    };
    strategyDistribution: {
      percentage: number;
      riskBased: number;
      random: number;
    };
    averageTimeInQueue: number;
  }> {
    // Get total tickets sampled
    const totalTicketsSampled = await this.prisma.qaReviewQueue.count();

    // Get risk distribution
    const riskDistribution = await this.prisma.qaReviewQueue.groupBy({
      by: ['risk_level'],
      _count: {
        risk_level: true,
      },
    });

    const riskDist = {
      high: 0,
      medium: 0,
      low: 0,
    };

    for (const item of riskDistribution) {
      const level = item.risk_level.toLowerCase() as 'high' | 'medium' | 'low';
      if (level in riskDist) {
        // eslint-disable-next-line security/detect-object-injection
        riskDist[level] = item._count.risk_level;
      }
    }

    // Get strategy distribution
    const strategyDistribution = await this.prisma.qaReviewQueue.groupBy({
      by: ['sampling_strategy'],
      _count: {
        sampling_strategy: true,
      },
    });

    const strategyDist = {
      percentage: 0,
      riskBased: 0,
      random: 0,
    };

    for (const item of strategyDistribution) {
      const strategy = item.sampling_strategy;
      if (strategy === 'PERCENTAGE') {
        strategyDist.percentage = item._count.sampling_strategy;
      } else if (strategy === 'RISK_BASED') {
        strategyDist.riskBased = item._count.sampling_strategy;
      } else if (strategy === 'RANDOM') {
        strategyDist.random = item._count.sampling_strategy;
      }
    }

    // Calculate average time in queue for completed reviews
    const completedTickets = await this.prisma.qaReviewQueue.findMany({
      where: {
        reviewed_at: {
          not: null,
        },
      },
      select: {
        created_at: true,
        reviewed_at: true,
      },
    });

    let averageTimeInQueue = 0;
    if (completedTickets.length > 0) {
      const totalDuration = completedTickets.reduce((sum, ticket) => {
        const createdAt = ticket.created_at.getTime();
        const reviewedAt = ticket.reviewed_at!.getTime();
        return sum + (reviewedAt - createdAt);
      }, 0);
      averageTimeInQueue = Math.round(totalDuration / completedTickets.length / 1000); // in seconds
    }

    // Get configured sampling rate
    const samplingRateMetric = await this.samplingRateGauge.get();
    const configuredSampleRate = samplingRateMetric.values[0]?.value || 20;

    // Estimate total tickets processed (sampled + estimated non-sampled based on rate)
    // This is an approximation - actual processed count would need to come from execution data
    const actualSampleRate =
      totalTicketsSampled > 0
        ? (totalTicketsSampled /
            Math.max(totalTicketsSampled / (configuredSampleRate / 100), totalTicketsSampled)) *
          100
        : 0;

    // For total processed, we estimate based on sampled tickets and sample rate
    // This is an approximation - actual processed count would require tracking all QA executions
    const totalProcessedResult =
      totalTicketsSampled > 0 && configuredSampleRate > 0
        ? Math.round(totalTicketsSampled / (configuredSampleRate / 100))
        : totalTicketsSampled;

    return {
      totalTicketsProcessed: totalProcessedResult,
      totalTicketsSampled,
      actualSampleRate: Math.min(actualSampleRate, 100),
      configuredSampleRate,
      riskDistribution: riskDist,
      strategyDistribution: strategyDist,
      averageTimeInQueue,
    };
  }
}
