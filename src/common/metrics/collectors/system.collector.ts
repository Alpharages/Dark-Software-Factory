import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge, Histogram } from 'prom-client';
import {
  SYSTEM_METRICS,
  DATABASE_METRICS,
  ERROR_METRICS,
  CICD_METRICS,
  GITHUB_METRICS,
  LABELS,
} from '../metrics.constants';
import { DatabaseMetricData } from '../metrics.interface';

@Injectable()
export class SystemCollector implements OnModuleInit, OnModuleDestroy {
  private systemMetricsInterval!: NodeJS.Timeout;

  constructor(
    // System Metrics
    @InjectMetric(SYSTEM_METRICS.MEMORY_USAGE)
    private readonly memoryUsage: Gauge,

    @InjectMetric(SYSTEM_METRICS.CPU_USAGE)
    private readonly cpuUsage: Gauge,

    @InjectMetric(SYSTEM_METRICS.ACTIVE_CONNECTIONS)
    private readonly activeConnections: Gauge,

    @InjectMetric(SYSTEM_METRICS.UPTIME)
    private readonly uptime: Gauge,

    @InjectMetric(SYSTEM_METRICS.EVENT_LOOP_LAG)
    private readonly eventLoopLag: Gauge,

    // Database Metrics
    @InjectMetric(DATABASE_METRICS.CONNECTIONS)
    private readonly databaseConnections: Gauge,

    @InjectMetric(DATABASE_METRICS.QUERY_DURATION)
    private readonly databaseQueryDuration: Histogram,

    @InjectMetric(DATABASE_METRICS.POOL_SIZE)
    private readonly databasePoolSize: Gauge,

    // Error Metrics
    @InjectMetric(ERROR_METRICS.TOTAL)
    private readonly errorsTotal: Counter,

    @InjectMetric(ERROR_METRICS.UNHANDLED_EXCEPTIONS)
    private readonly unhandledExceptionsTotal: Counter,

    // CI/CD Metrics
    @InjectMetric(CICD_METRICS.PIPELINE_TRIGGERS)
    private readonly cicdPipelineTriggers: Counter,

    @InjectMetric(CICD_METRICS.PIPELINE_DURATION)
    private readonly cicdPipelineDuration: Histogram,

    // GitHub Metrics
    @InjectMetric(GITHUB_METRICS.OPERATIONS_TOTAL)
    private readonly githubOperationsTotal: Counter,

    @InjectMetric(GITHUB_METRICS.RATE_LIMIT_HITS)
    private readonly githubRateLimitHits: Counter,

    @InjectMetric(GITHUB_METRICS.RATE_LIMIT_REMAINING)
    private readonly githubRateLimitRemaining: Gauge,
  ) {}

  onModuleInit() {
    this.startSystemMetricsCollection();
  }

  onModuleDestroy() {
    if (this.systemMetricsInterval) {
      clearInterval(this.systemMetricsInterval);
    }
  }

  // ============= System Metrics =============

  setActiveConnections(count: number): void {
    this.activeConnections.set(count);
  }

  private startSystemMetricsCollection(): void {
    const collectSystemMetrics = () => {
      // Memory usage
      const memUsage = process.memoryUsage();
      this.memoryUsage.set({ type: 'heap_used' }, memUsage.heapUsed);
      this.memoryUsage.set({ type: 'heap_total' }, memUsage.heapTotal);
      this.memoryUsage.set({ type: 'rss' }, memUsage.rss);
      this.memoryUsage.set({ type: 'external' }, memUsage.external);

      // CPU usage (simplified - actual CPU% requires sampling)
      const cpuUsage = process.cpuUsage();
      const totalCpu = cpuUsage.user + cpuUsage.system;
      this.cpuUsage.set(totalCpu / 1000000); // Convert to seconds

      // Uptime
      this.uptime.set(process.uptime());

      // Event loop lag (use monitorEventLoopDelay in production)
      const start = process.hrtime.bigint();
      setImmediate(() => {
        const lag = Number(process.hrtime.bigint() - start) / 1e9;
        this.eventLoopLag.set(lag);
      });
    };

    // Collect immediately and then every 15 seconds
    collectSystemMetrics();
    this.systemMetricsInterval = setInterval(collectSystemMetrics, 15000);
  }

  // ============= Database Metrics =============

  updateDatabaseMetrics(data: DatabaseMetricData): void {
    this.databaseConnections.set({ [LABELS.CONNECTION_STATE]: 'active' }, data.activeConnections);
    this.databaseConnections.set({ [LABELS.CONNECTION_STATE]: 'idle' }, data.idleConnections);
    this.databaseConnections.set({ [LABELS.CONNECTION_STATE]: 'waiting' }, data.waitingConnections);
    this.databasePoolSize.set(data.poolSize);
  }

  recordDatabaseQuery(duration: number): void {
    this.databaseQueryDuration.observe(duration);
  }

  // ============= Error Metrics =============

  incrementErrors(errorType: string, count: number = 1): void {
    this.errorsTotal.inc({ [LABELS.ERROR_TYPE]: errorType }, count);
  }

  incrementUnhandledExceptions(): void {
    this.unhandledExceptionsTotal.inc();
  }

  // ============= CI/CD Metrics =============

  recordCICDPipeline(provider: string, status: string, duration?: number): void {
    this.cicdPipelineTriggers.inc({ [LABELS.PROVIDER]: provider, [LABELS.STATUS]: status });
    if (duration !== undefined) {
      this.cicdPipelineDuration.observe({ [LABELS.PROVIDER]: provider }, duration);
    }
  }

  // ============= GitHub Metrics =============

  incrementGitHubOperation(operation: string, status: string): void {
    this.githubOperationsTotal.inc({ operation, status });
  }

  incrementGitHubRateLimitHit(): void {
    this.githubRateLimitHits.inc();
  }

  setGitHubRateLimitRemaining(remaining: number): void {
    this.githubRateLimitRemaining.set(remaining);
  }
}
