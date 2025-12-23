# Story 1.8: Prometheus Metrics Endpoints

**Epic:** 1 - Foundation & Development Environment  
**Status:** done  
**Priority:** P0 - CRITICAL (Required for observability and GO/NO-GO decisions)  
**Effort:** 5 story points  
**ClickUp ID:** `86evnjw8t`  
**ClickUp URL:** https://app.clickup.com/t/86evnjw8t

---

## ⚠️ CRITICAL ARCHITECTURE NOTE

**Module Location Clarification:**
- `src/common/metrics/` → Prometheus infrastructure module (THIS STORY)
- `src/metrics/metrics.module.ts` → Domain-specific metrics aggregation service (FR91-95, future stories)

The existing `src/metrics/` module is a placeholder for business metrics aggregation logic. This story creates the Prometheus infrastructure in `src/common/metrics/` which provides the foundation that `src/metrics/` will use.

---

## Quick Implementation Reference (Expert Mode)

```bash
# 1. Install dependencies
npm install @willsoto/nestjs-prometheus prom-client

# 2. Create directories
mkdir -p src/common/metrics/{collectors,decorators,interceptors}

# 3. Key files to create (15 files in src/common/metrics/)
# - metrics.module.ts, metrics.service.ts, metrics.constants.ts
# - metrics.interface.ts, metrics.controller.ts, index.ts
# - collectors/: http, business, system, queue (4 files)
# - interceptors/: metrics.interceptor.ts, index.ts
# - decorators/: track-metric.decorator.ts, index.ts

# 4. Update existing files
# src/app.module.ts, src/main.ts, .env.example

# 5. Verify file count
find src/common/metrics -type f -name "*.ts" | wc -l  # Should be 15

# 6. Run tests
npm test -- --testPathPattern=metrics
```

---

## Story

As a developer,
I want Prometheus-compatible metrics exposed,
So that we can monitor system health and make GO/NO-GO decisions (NFR-O5).

---

## Acceptance Criteria

**Given** the application is running  
**When** I expose Prometheus metrics  
**Then** the following is available:
- `/metrics` endpoint returns Prometheus-formatted metrics
- HTTP metrics: request count, duration, status codes
- Business metrics: tickets processed, executions count, cost totals
- System metrics: memory usage, CPU, active connections

**And** custom metrics are registered:
- `tickets_received_total` (counter)
- `ai_executions_total` (counter by provider)
- `qa_checks_total` (counter by result)
- `deployment_success_rate` (gauge)
- `cost_per_project` (histogram)
- `pm_utilization_percent` (gauge per PM)

**And** metrics are tagged with labels (project, AI provider, status)  
**And** Prometheus can scrape `/metrics` every 15 seconds  
**And** Grafana dashboards can query these metrics

---

## Technical Requirements

### Quick Reference: Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/common/metrics/metrics.module.ts` | CREATE | Prometheus module with @willsoto/nestjs-prometheus |
| `src/common/metrics/metrics.service.ts` | CREATE | Metrics service for programmatic access |
| `src/common/metrics/metrics.constants.ts` | CREATE | Metric names, labels, and constants |
| `src/common/metrics/metrics.interface.ts` | CREATE | Metric types and interfaces |
| `src/common/metrics/collectors/http.collector.ts` | CREATE | HTTP request metrics collector |
| `src/common/metrics/collectors/business.collector.ts` | CREATE | Business metrics (tickets, executions, etc.) |
| `src/common/metrics/collectors/system.collector.ts` | CREATE | System metrics (memory, CPU, connections) |
| `src/common/metrics/collectors/index.ts` | CREATE | Collectors barrel export |
| `src/common/metrics/interceptors/metrics.interceptor.ts` | CREATE | HTTP metrics interceptor |
| `src/common/metrics/interceptors/index.ts` | CREATE | Interceptors barrel export |
| `src/common/metrics/decorators/track-metric.decorator.ts` | CREATE | @TrackMetric() decorator |
| `src/common/metrics/decorators/index.ts` | CREATE | Decorators barrel export |
| `src/common/metrics/index.ts` | CREATE | Metrics barrel export |
| `src/common/metrics/metrics.controller.ts` | CREATE | Health/ready endpoints with metrics |
| `src/app.module.ts` | MODIFY | Add PrometheusModule |
| `src/main.ts` | MODIFY | Configure Prometheus middleware |
| `.env.example` | MODIFY | Add metrics configuration |

**Install Command:**
```bash
npm install @willsoto/nestjs-prometheus prom-client
```

---

### Step 1: Install Prometheus Dependencies

```bash
npm install @willsoto/nestjs-prometheus prom-client
```

**Dependencies:**
- `@willsoto/nestjs-prometheus` - NestJS Prometheus integration with decorators
- `prom-client` - Official Prometheus client for Node.js (peer dependency)

---

### Step 2: Define Metrics Constants

**File:** `src/common/metrics/metrics.constants.ts`

```typescript
/**
 * Prometheus Metrics Constants
 * Per architecture.md "Observability" section (NFR-O5)
 */

export const METRICS_CONSTANTS = {
  PREFIX: 'dsf_', // Dark Software Factory prefix
  DEFAULT_BUCKETS: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  COST_BUCKETS: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 50, 100, 500],
} as const;

// HTTP Metrics
export const HTTP_METRICS = {
  REQUEST_DURATION: `${METRICS_CONSTANTS.PREFIX}http_request_duration_seconds`,
  REQUEST_TOTAL: `${METRICS_CONSTANTS.PREFIX}http_requests_total`,
  REQUEST_SIZE: `${METRICS_CONSTANTS.PREFIX}http_request_size_bytes`,
  RESPONSE_SIZE: `${METRICS_CONSTANTS.PREFIX}http_response_size_bytes`,
} as const;

// Business Metrics - Tickets
export const TICKET_METRICS = {
  RECEIVED_TOTAL: `${METRICS_CONSTANTS.PREFIX}tickets_received_total`,
  PROCESSED_TOTAL: `${METRICS_CONSTANTS.PREFIX}tickets_processed_total`,
  PROCESSING_DURATION: `${METRICS_CONSTANTS.PREFIX}ticket_processing_duration_seconds`,
  QUEUE_SIZE: `${METRICS_CONSTANTS.PREFIX}ticket_queue_size`,
} as const;

// Business Metrics - AI Executions
export const AI_METRICS = {
  EXECUTIONS_TOTAL: `${METRICS_CONSTANTS.PREFIX}ai_executions_total`,
  EXECUTION_DURATION: `${METRICS_CONSTANTS.PREFIX}ai_execution_duration_seconds`,
  TOKENS_USED: `${METRICS_CONSTANTS.PREFIX}ai_tokens_used_total`,
  PROVIDER_STATUS: `${METRICS_CONSTANTS.PREFIX}ai_provider_status`,
} as const;

// Business Metrics - QA
export const QA_METRICS = {
  CHECKS_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_checks_total`,
  CHECK_DURATION: `${METRICS_CONSTANTS.PREFIX}qa_check_duration_seconds`,
  COVERAGE_PERCENT: `${METRICS_CONSTANTS.PREFIX}qa_test_coverage_percent`,
  VULNERABILITIES: `${METRICS_CONSTANTS.PREFIX}qa_security_vulnerabilities_total`,
} as const;

// Business Metrics - Deployments
export const DEPLOYMENT_METRICS = {
  TOTAL: `${METRICS_CONSTANTS.PREFIX}deployments_total`,
  DURATION: `${METRICS_CONSTANTS.PREFIX}deployment_duration_seconds`,
  SUCCESS_RATE: `${METRICS_CONSTANTS.PREFIX}deployment_success_rate`,
} as const;

// Business Metrics - Costs
export const COST_METRICS = {
  PER_PROJECT: `${METRICS_CONSTANTS.PREFIX}cost_per_project`,
  PER_PROVIDER: `${METRICS_CONSTANTS.PREFIX}cost_per_provider`,
  TOTAL: `${METRICS_CONSTANTS.PREFIX}cost_total`,
  BUDGET_UTILIZATION: `${METRICS_CONSTANTS.PREFIX}budget_utilization_percent`,
} as const;

// Business Metrics - PM
export const PM_METRICS = {
  UTILIZATION_PERCENT: `${METRICS_CONSTANTS.PREFIX}pm_utilization_percent`,
  TICKETS_MANAGED: `${METRICS_CONSTANTS.PREFIX}pm_tickets_managed`,
  PROJECTS_ACTIVE: `${METRICS_CONSTANTS.PREFIX}pm_projects_active`,
} as const;

// System Metrics
export const SYSTEM_METRICS = {
  MEMORY_USAGE: `${METRICS_CONSTANTS.PREFIX}memory_usage_bytes`,
  CPU_USAGE: `${METRICS_CONSTANTS.PREFIX}cpu_usage_percent`,
  ACTIVE_CONNECTIONS: `${METRICS_CONSTANTS.PREFIX}active_connections`,
  UPTIME: `${METRICS_CONSTANTS.PREFIX}uptime_seconds`,
  EVENT_LOOP_LAG: `${METRICS_CONSTANTS.PREFIX}nodejs_event_loop_lag_seconds`,
} as const;

// RabbitMQ Queue Metrics (FR101 - Queue depth monitoring)
export const QUEUE_METRICS = {
  DEPTH: `${METRICS_CONSTANTS.PREFIX}queue_depth`,
  PROCESSING_RATE: `${METRICS_CONSTANTS.PREFIX}queue_processing_rate`,
  OLDEST_MESSAGE_AGE: `${METRICS_CONSTANTS.PREFIX}queue_oldest_message_age_seconds`,
  DEAD_LETTER_COUNT: `${METRICS_CONSTANTS.PREFIX}queue_dead_letter_count`,
  CONSUMER_COUNT: `${METRICS_CONSTANTS.PREFIX}queue_consumer_count`,
} as const;

// Database Metrics
export const DATABASE_METRICS = {
  CONNECTIONS: `${METRICS_CONSTANTS.PREFIX}database_connections`,
  QUERY_DURATION: `${METRICS_CONSTANTS.PREFIX}database_query_duration_seconds`,
  POOL_SIZE: `${METRICS_CONSTANTS.PREFIX}database_pool_size`,
} as const;

// WebSocket Metrics (Socket.IO for real-time features)
export const WEBSOCKET_METRICS = {
  CONNECTIONS_ACTIVE: `${METRICS_CONSTANTS.PREFIX}websocket_connections_active`,
  MESSAGES_TOTAL: `${METRICS_CONSTANTS.PREFIX}websocket_messages_total`,
  ROOMS_ACTIVE: `${METRICS_CONSTANTS.PREFIX}websocket_rooms_active`,
} as const;

// Error Metrics (NFR-O6 - Critical failure alerts)
export const ERROR_METRICS = {
  TOTAL: `${METRICS_CONSTANTS.PREFIX}errors_total`,
  UNHANDLED_EXCEPTIONS: `${METRICS_CONSTANTS.PREFIX}unhandled_exceptions_total`,
} as const;

// CI/CD Metrics
export const CICD_METRICS = {
  PIPELINE_TRIGGERS: `${METRICS_CONSTANTS.PREFIX}cicd_pipeline_triggers_total`,
  PIPELINE_DURATION: `${METRICS_CONSTANTS.PREFIX}cicd_pipeline_duration_seconds`,
} as const;

// Alert Thresholds Configuration (NFR-O6, NFR-O7, NFR-O8)
export const ALERT_THRESHOLDS = {
  QUEUE_DEPTH_WARNING: 50,
  QUEUE_DEPTH_CRITICAL: 100,
  PM_UTILIZATION_WARNING: 80,
  PM_UTILIZATION_CRITICAL: 95,
  COST_BUDGET_WARNING: 80, // percentage
  COST_BUDGET_CRITICAL: 100,
  ERROR_RATE_WARNING: 0.01, // 1%
  ERROR_RATE_CRITICAL: 0.05, // 5%
} as const;

// Queue Names (must match RabbitMQ configuration from Story 1.5)
export const QUEUE_NAMES = [
  'ai-execution-queue',
  'qa-check-queue',
  'deployment-queue',
  'monitoring-queue',
] as const;
export type QueueName = typeof QUEUE_NAMES[number];

// Common Labels
export const LABELS = {
  PROJECT: 'project_id',
  PROVIDER: 'provider',
  STATUS: 'status',
  METHOD: 'method',
  PATH: 'path',
  STATUS_CODE: 'status_code',
  CHECK_TYPE: 'check_type',
  SEVERITY: 'severity',
  PM_ID: 'pm_id',
  ENVIRONMENT: 'environment',
  QUEUE: 'queue',           // For RabbitMQ queue metrics
  ERROR_TYPE: 'error_type', // For error classification
  CONNECTION_STATE: 'state', // For database/websocket connections
  DIRECTION: 'direction',   // For websocket messages (in/out)
} as const;

// Provider names
export const AI_PROVIDERS = ['cursor', 'claude_code', 'fallback'] as const;
export type AIProvider = typeof AI_PROVIDERS[number];

// QA Check types
export const QA_CHECK_TYPES = ['linting', 'testing', 'security', 'coverage'] as const;
export type QACheckType = typeof QA_CHECK_TYPES[number];

// Status values
export const STATUS_VALUES = ['success', 'failed', 'pending', 'timeout'] as const;
export type StatusValue = typeof STATUS_VALUES[number];
```

---

### Step 3: Define Metrics Interfaces

**File:** `src/common/metrics/metrics.interface.ts`

```typescript
import { Histogram, Counter, Gauge, Summary } from 'prom-client';

/**
 * Metric registration options
 */
export interface MetricOptions {
  name: string;
  help: string;
  labelNames?: string[];
  buckets?: number[];
}

/**
 * Business metric increment options
 */
export interface MetricIncrementOptions {
  labels?: Record<string, string>;
  value?: number;
}

/**
 * HTTP request metric data
 */
export interface HttpMetricData {
  method: string;
  path: string;
  statusCode: number;
  duration: number;
  requestSize?: number;
  responseSize?: number;
}

/**
 * AI execution metric data
 */
export interface AIExecutionMetricData {
  provider: string;
  status: 'success' | 'failed' | 'timeout';
  duration: number;
  tokensUsed?: number;
  projectId?: string;
}

/**
 * QA check metric data
 */
export interface QACheckMetricData {
  checkType: string;
  status: 'passed' | 'failed';
  duration: number;
  projectId?: string;
  coverage?: number;
}

/**
 * Deployment metric data
 */
export interface DeploymentMetricData {
  environment: string;
  status: 'success' | 'failed' | 'rolled_back';
  duration: number;
  projectId?: string;
}

/**
 * Cost metric data
 */
export interface CostMetricData {
  provider: string;
  amount: number;
  projectId?: string;
}

/**
 * PM utilization metric data
 */
export interface PMUtilizationData {
  pmId: string;
  utilizationPercent: number;
  ticketsManaged: number;
  projectsActive: number;
}

/**
 * RabbitMQ queue metric data (FR101)
 */
export interface QueueMetricData {
  queueName: string;
  depth: number;
  processingRate: number; // messages per minute
  oldestMessageAge?: number; // seconds
  consumerCount: number;
  deadLetterCount?: number;
}

/**
 * Database connection metric data
 */
export interface DatabaseMetricData {
  activeConnections: number;
  idleConnections: number;
  waitingConnections: number;
  poolSize: number;
}

/**
 * WebSocket metric data
 */
export interface WebSocketMetricData {
  activeConnections: number;
  roomsActive: number;
}

/**
 * Error metric data
 */
export interface ErrorMetricData {
  errorType: 'validation' | 'runtime' | 'timeout' | 'integration';
  count?: number;
}

/**
 * All registered metrics container
 */
export interface RegisteredMetrics {
  // HTTP
  httpRequestDuration: Histogram;
  httpRequestTotal: Counter;
  
  // Tickets
  ticketsReceivedTotal: Counter;
  ticketsProcessedTotal: Counter;
  ticketQueueSize: Gauge;
  
  // AI
  aiExecutionsTotal: Counter;
  aiExecutionDuration: Histogram;
  aiTokensUsed: Counter;
  aiProviderStatus: Gauge;
  
  // QA
  qaChecksTotal: Counter;
  qaCheckDuration: Histogram;
  qaCoveragePercent: Gauge;
  qaVulnerabilities: Counter;
  
  // Deployments
  deploymentsTotal: Counter;
  deploymentDuration: Histogram;
  deploymentSuccessRate: Gauge;
  
  // Costs
  costPerProject: Histogram;
  costPerProvider: Counter;
  costTotal: Counter;
  budgetUtilization: Gauge;
  
  // PM
  pmUtilizationPercent: Gauge;
  pmTicketsManaged: Gauge;
  pmProjectsActive: Gauge;
  
  // System
  memoryUsage: Gauge;
  cpuUsage: Gauge;
  activeConnections: Gauge;
  uptime: Gauge;
}
```

---

### Step 4: Create Metrics Service

**File:** `src/common/metrics/metrics.service.ts`

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import {
  HTTP_METRICS,
  TICKET_METRICS,
  AI_METRICS,
  QA_METRICS,
  DEPLOYMENT_METRICS,
  COST_METRICS,
  PM_METRICS,
  SYSTEM_METRICS,
  METRICS_CONSTANTS,
  LABELS,
} from './metrics.constants';
import {
  HttpMetricData,
  AIExecutionMetricData,
  QACheckMetricData,
  DeploymentMetricData,
  CostMetricData,
  PMUtilizationData,
} from './metrics.interface';
import { LoggerService } from '../logger';

@Injectable()
export class MetricsService implements OnModuleInit {
  private systemMetricsInterval: NodeJS.Timeout;

  constructor(
    private readonly logger: LoggerService,

    // HTTP Metrics
    @InjectMetric(HTTP_METRICS.REQUEST_DURATION)
    private readonly httpRequestDuration: Histogram,

    @InjectMetric(HTTP_METRICS.REQUEST_TOTAL)
    private readonly httpRequestTotal: Counter,

    // Ticket Metrics
    @InjectMetric(TICKET_METRICS.RECEIVED_TOTAL)
    private readonly ticketsReceivedTotal: Counter,

    @InjectMetric(TICKET_METRICS.PROCESSED_TOTAL)
    private readonly ticketsProcessedTotal: Counter,

    @InjectMetric(TICKET_METRICS.QUEUE_SIZE)
    private readonly ticketQueueSize: Gauge,

    // AI Execution Metrics
    @InjectMetric(AI_METRICS.EXECUTIONS_TOTAL)
    private readonly aiExecutionsTotal: Counter,

    @InjectMetric(AI_METRICS.EXECUTION_DURATION)
    private readonly aiExecutionDuration: Histogram,

    @InjectMetric(AI_METRICS.TOKENS_USED)
    private readonly aiTokensUsed: Counter,

    @InjectMetric(AI_METRICS.PROVIDER_STATUS)
    private readonly aiProviderStatus: Gauge,

    // QA Metrics
    @InjectMetric(QA_METRICS.CHECKS_TOTAL)
    private readonly qaChecksTotal: Counter,

    @InjectMetric(QA_METRICS.CHECK_DURATION)
    private readonly qaCheckDuration: Histogram,

    @InjectMetric(QA_METRICS.COVERAGE_PERCENT)
    private readonly qaCoveragePercent: Gauge,

    @InjectMetric(QA_METRICS.VULNERABILITIES)
    private readonly qaVulnerabilities: Counter,

    // Deployment Metrics
    @InjectMetric(DEPLOYMENT_METRICS.TOTAL)
    private readonly deploymentsTotal: Counter,

    @InjectMetric(DEPLOYMENT_METRICS.DURATION)
    private readonly deploymentDuration: Histogram,

    @InjectMetric(DEPLOYMENT_METRICS.SUCCESS_RATE)
    private readonly deploymentSuccessRate: Gauge,

    // Cost Metrics
    @InjectMetric(COST_METRICS.PER_PROJECT)
    private readonly costPerProject: Histogram,

    @InjectMetric(COST_METRICS.TOTAL)
    private readonly costTotal: Counter,

    @InjectMetric(COST_METRICS.BUDGET_UTILIZATION)
    private readonly budgetUtilization: Gauge,

    // PM Metrics
    @InjectMetric(PM_METRICS.UTILIZATION_PERCENT)
    private readonly pmUtilizationPercent: Gauge,

    @InjectMetric(PM_METRICS.TICKETS_MANAGED)
    private readonly pmTicketsManaged: Gauge,

    @InjectMetric(PM_METRICS.PROJECTS_ACTIVE)
    private readonly pmProjectsActive: Gauge,

    // System Metrics
    @InjectMetric(SYSTEM_METRICS.MEMORY_USAGE)
    private readonly memoryUsage: Gauge,

    @InjectMetric(SYSTEM_METRICS.CPU_USAGE)
    private readonly cpuUsage: Gauge,

    @InjectMetric(SYSTEM_METRICS.ACTIVE_CONNECTIONS)
    private readonly activeConnections: Gauge,

    @InjectMetric(SYSTEM_METRICS.UPTIME)
    private readonly uptime: Gauge,
  ) {}

  onModuleInit() {
    this.startSystemMetricsCollection();
    this.logger.log('Prometheus metrics service initialized', 'MetricsService');
  }

  onModuleDestroy() {
    if (this.systemMetricsInterval) {
      clearInterval(this.systemMetricsInterval);
    }
  }

  // ============= HTTP Metrics =============

  recordHttpRequest(data: HttpMetricData): void {
    const labels = {
      [LABELS.METHOD]: data.method,
      [LABELS.PATH]: this.normalizePath(data.path),
      [LABELS.STATUS_CODE]: String(data.statusCode),
    };

    this.httpRequestDuration.observe(labels, data.duration);
    this.httpRequestTotal.inc(labels);
  }

  // ============= Ticket Metrics =============

  incrementTicketsReceived(projectId?: string): void {
    const labels = projectId ? { [LABELS.PROJECT]: projectId } : {};
    this.ticketsReceivedTotal.inc(labels);
  }

  incrementTicketsProcessed(projectId?: string, status: string = 'success'): void {
    const labels: Record<string, string> = { [LABELS.STATUS]: status };
    if (projectId) labels[LABELS.PROJECT] = projectId;
    this.ticketsProcessedTotal.inc(labels);
  }

  setTicketQueueSize(size: number): void {
    this.ticketQueueSize.set(size);
  }

  // ============= AI Execution Metrics =============

  recordAIExecution(data: AIExecutionMetricData): void {
    const labels: Record<string, string> = {
      [LABELS.PROVIDER]: data.provider,
      [LABELS.STATUS]: data.status,
    };
    if (data.projectId) labels[LABELS.PROJECT] = data.projectId;

    this.aiExecutionsTotal.inc(labels);
    this.aiExecutionDuration.observe(labels, data.duration);

    if (data.tokensUsed) {
      this.aiTokensUsed.inc({ [LABELS.PROVIDER]: data.provider }, data.tokensUsed);
    }
  }

  setAIProviderStatus(provider: string, isHealthy: boolean): void {
    this.aiProviderStatus.set({ [LABELS.PROVIDER]: provider }, isHealthy ? 1 : 0);
  }

  // ============= QA Metrics =============

  recordQACheck(data: QACheckMetricData): void {
    const labels: Record<string, string> = {
      [LABELS.CHECK_TYPE]: data.checkType,
      [LABELS.STATUS]: data.status,
    };
    if (data.projectId) labels[LABELS.PROJECT] = data.projectId;

    this.qaChecksTotal.inc(labels);
    this.qaCheckDuration.observe(labels, data.duration);

    if (data.coverage !== undefined) {
      this.qaCoveragePercent.set(
        { [LABELS.PROJECT]: data.projectId || 'unknown' },
        data.coverage,
      );
    }
  }

  incrementVulnerabilities(severity: string, count: number = 1): void {
    this.qaVulnerabilities.inc({ [LABELS.SEVERITY]: severity }, count);
  }

  // ============= Deployment Metrics =============

  recordDeployment(data: DeploymentMetricData): void {
    const labels: Record<string, string> = {
      [LABELS.ENVIRONMENT]: data.environment,
      [LABELS.STATUS]: data.status,
    };
    if (data.projectId) labels[LABELS.PROJECT] = data.projectId;

    this.deploymentsTotal.inc(labels);
    this.deploymentDuration.observe(labels, data.duration);
  }

  setDeploymentSuccessRate(environment: string, rate: number): void {
    this.deploymentSuccessRate.set({ [LABELS.ENVIRONMENT]: environment }, rate);
  }

  // ============= Cost Metrics =============

  recordCost(data: CostMetricData): void {
    const labels: Record<string, string> = { [LABELS.PROVIDER]: data.provider };
    if (data.projectId) labels[LABELS.PROJECT] = data.projectId;

    this.costPerProject.observe(labels, data.amount);
    this.costTotal.inc(labels, data.amount);
  }

  setBudgetUtilization(projectId: string, utilizationPercent: number): void {
    this.budgetUtilization.set({ [LABELS.PROJECT]: projectId }, utilizationPercent);
  }

  // ============= PM Metrics =============

  updatePMUtilization(data: PMUtilizationData): void {
    const labels = { [LABELS.PM_ID]: data.pmId };

    this.pmUtilizationPercent.set(labels, data.utilizationPercent);
    this.pmTicketsManaged.set(labels, data.ticketsManaged);
    this.pmProjectsActive.set(labels, data.projectsActive);
  }

  // ============= System Metrics =============

  setActiveConnections(count: number): void {
    this.activeConnections.set(count);
  }

  // ============= RabbitMQ Queue Metrics (FR101) =============

  updateQueueMetrics(data: QueueMetricData): void {
    const labels = { [LABELS.QUEUE]: data.queueName };
    
    this.queueDepth.set(labels, data.depth);
    this.queueProcessingRate.set(labels, data.processingRate);
    this.queueConsumerCount.set(labels, data.consumerCount);
    
    if (data.oldestMessageAge !== undefined) {
      this.queueOldestMessageAge.set(labels, data.oldestMessageAge);
    }
    if (data.deadLetterCount !== undefined) {
      this.queueDeadLetterCount.set(labels, data.deadLetterCount);
    }
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

  // ============= WebSocket Metrics =============

  updateWebSocketMetrics(data: WebSocketMetricData): void {
    this.websocketConnectionsActive.set(data.activeConnections);
    this.websocketRoomsActive.set(data.roomsActive);
  }

  incrementWebSocketMessages(direction: 'in' | 'out'): void {
    this.websocketMessagesTotal.inc({ [LABELS.DIRECTION]: direction });
  }

  // ============= Error Metrics (NFR-O6) =============

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

  // ============= Private Methods =============

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

  private normalizePath(path: string): string {
    // Normalize paths to prevent high cardinality
    // Replace UUIDs and numeric IDs with placeholders
    return path
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
      .replace(/\/\d+/g, '/:id')
      .replace(/\?.*/g, ''); // Remove query strings
  }
}
```

---

### Step 5: Create HTTP Metrics Interceptor

**File:** `src/common/metrics/interceptors/metrics.interceptor.ts`

```typescript
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { FastifyRequest, FastifyReply } from 'fastify';
import { MetricsService } from '../metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<FastifyRequest>();
    const response = ctx.getResponse<FastifyReply>();

    const startTime = process.hrtime.bigint();

    return next.handle().pipe(
      tap(() => {
        this.recordMetrics(request, response, startTime);
      }),
      catchError((error) => {
        this.recordMetrics(request, response, startTime, error.status || 500);
        throw error;
      }),
    );
  }

  private recordMetrics(
    request: FastifyRequest,
    response: FastifyReply,
    startTime: bigint,
    errorStatus?: number,
  ): void {
    const duration = Number(process.hrtime.bigint() - startTime) / 1e9; // Convert to seconds
    const statusCode = errorStatus || response.statusCode;

    this.metricsService.recordHttpRequest({
      method: request.method,
      path: request.url,
      statusCode,
      duration,
    });
  }
}
```

**File:** `src/common/metrics/interceptors/index.ts`

```typescript
export { MetricsInterceptor } from './metrics.interceptor';
```

---

### Step 6: Create TrackMetric Decorator

**File:** `src/common/metrics/decorators/track-metric.decorator.ts`

```typescript
import { SetMetadata, applyDecorators, UseInterceptors } from '@nestjs/common';
import { MetricsInterceptor } from '../interceptors/metrics.interceptor';

export const TRACK_METRIC_KEY = 'track_metric';

export interface TrackMetricOptions {
  /** Name of the metric to track */
  metricName?: string;
  /** Additional labels for the metric */
  labels?: Record<string, string>;
  /** Whether to track execution duration */
  trackDuration?: boolean;
}

/**
 * Decorator to explicitly track metrics for a method
 * 
 * Usage:
 * @TrackMetric({ metricName: 'ai_execution', labels: { provider: 'cursor' } })
 * async executeAI() { ... }
 */
export function TrackMetric(options: TrackMetricOptions = {}) {
  return applyDecorators(
    SetMetadata(TRACK_METRIC_KEY, {
      trackDuration: true,
      ...options,
    }),
    UseInterceptors(MetricsInterceptor),
  );
}
```

**File:** `src/common/metrics/decorators/index.ts`

```typescript
export { TrackMetric, TRACK_METRIC_KEY, TrackMetricOptions } from './track-metric.decorator';
```

---

### Step 7: Create Metrics Module

**File:** `src/common/metrics/metrics.module.ts`

```typescript
import { Module, Global } from '@nestjs/common';
import {
  PrometheusModule,
  makeCounterProvider,
  makeGaugeProvider,
  makeHistogramProvider,
} from '@willsoto/nestjs-prometheus';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import {
  HTTP_METRICS,
  TICKET_METRICS,
  AI_METRICS,
  QA_METRICS,
  DEPLOYMENT_METRICS,
  COST_METRICS,
  PM_METRICS,
  SYSTEM_METRICS,
  METRICS_CONSTANTS,
  LABELS,
} from './metrics.constants';

@Global()
@Module({
  imports: [
    PrometheusModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        path: '/metrics',
        defaultMetrics: {
          enabled: configService.get<boolean>('metrics.collectDefaultMetrics', true),
          config: {
            prefix: METRICS_CONSTANTS.PREFIX,
          },
        },
        defaultLabels: {
          app: 'ai-dev-orchestrator',
          environment: configService.get<string>('nodeEnv', 'development'),
        },
      }),
    }),
  ],
  controllers: [MetricsController],
  providers: [
    MetricsService,

    // HTTP Metrics
    makeHistogramProvider({
      name: HTTP_METRICS.REQUEST_DURATION,
      help: 'Duration of HTTP requests in seconds',
      labelNames: [LABELS.METHOD, LABELS.PATH, LABELS.STATUS_CODE],
      buckets: METRICS_CONSTANTS.DEFAULT_BUCKETS,
    }),
    makeCounterProvider({
      name: HTTP_METRICS.REQUEST_TOTAL,
      help: 'Total number of HTTP requests',
      labelNames: [LABELS.METHOD, LABELS.PATH, LABELS.STATUS_CODE],
    }),

    // Ticket Metrics
    makeCounterProvider({
      name: TICKET_METRICS.RECEIVED_TOTAL,
      help: 'Total number of tickets received from ClickUp',
      labelNames: [LABELS.PROJECT],
    }),
    makeCounterProvider({
      name: TICKET_METRICS.PROCESSED_TOTAL,
      help: 'Total number of tickets processed',
      labelNames: [LABELS.PROJECT, LABELS.STATUS],
    }),
    makeGaugeProvider({
      name: TICKET_METRICS.QUEUE_SIZE,
      help: 'Current number of tickets in processing queue',
    }),

    // AI Execution Metrics
    makeCounterProvider({
      name: AI_METRICS.EXECUTIONS_TOTAL,
      help: 'Total number of AI executions',
      labelNames: [LABELS.PROVIDER, LABELS.STATUS, LABELS.PROJECT],
    }),
    makeHistogramProvider({
      name: AI_METRICS.EXECUTION_DURATION,
      help: 'Duration of AI executions in seconds',
      labelNames: [LABELS.PROVIDER, LABELS.STATUS, LABELS.PROJECT],
      buckets: [1, 5, 10, 30, 60, 120, 300, 600], // Up to 10 minutes
    }),
    makeCounterProvider({
      name: AI_METRICS.TOKENS_USED,
      help: 'Total tokens used by AI providers',
      labelNames: [LABELS.PROVIDER],
    }),
    makeGaugeProvider({
      name: AI_METRICS.PROVIDER_STATUS,
      help: 'AI provider health status (1=healthy, 0=unhealthy)',
      labelNames: [LABELS.PROVIDER],
    }),

    // QA Metrics
    makeCounterProvider({
      name: QA_METRICS.CHECKS_TOTAL,
      help: 'Total number of QA checks performed',
      labelNames: [LABELS.CHECK_TYPE, LABELS.STATUS, LABELS.PROJECT],
    }),
    makeHistogramProvider({
      name: QA_METRICS.CHECK_DURATION,
      help: 'Duration of QA checks in seconds',
      labelNames: [LABELS.CHECK_TYPE, LABELS.STATUS, LABELS.PROJECT],
      buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
    }),
    makeGaugeProvider({
      name: QA_METRICS.COVERAGE_PERCENT,
      help: 'Test coverage percentage per project',
      labelNames: [LABELS.PROJECT],
    }),
    makeCounterProvider({
      name: QA_METRICS.VULNERABILITIES,
      help: 'Total security vulnerabilities detected',
      labelNames: [LABELS.SEVERITY],
    }),

    // Deployment Metrics
    makeCounterProvider({
      name: DEPLOYMENT_METRICS.TOTAL,
      help: 'Total number of deployments',
      labelNames: [LABELS.ENVIRONMENT, LABELS.STATUS, LABELS.PROJECT],
    }),
    makeHistogramProvider({
      name: DEPLOYMENT_METRICS.DURATION,
      help: 'Duration of deployments in seconds',
      labelNames: [LABELS.ENVIRONMENT, LABELS.STATUS, LABELS.PROJECT],
      buckets: [10, 30, 60, 120, 300, 600], // Up to 10 minutes
    }),
    makeGaugeProvider({
      name: DEPLOYMENT_METRICS.SUCCESS_RATE,
      help: 'Deployment success rate per environment',
      labelNames: [LABELS.ENVIRONMENT],
    }),

    // Cost Metrics
    makeHistogramProvider({
      name: COST_METRICS.PER_PROJECT,
      help: 'Cost per project in USD',
      labelNames: [LABELS.PROJECT, LABELS.PROVIDER],
      buckets: METRICS_CONSTANTS.COST_BUCKETS,
    }),
    makeCounterProvider({
      name: COST_METRICS.TOTAL,
      help: 'Total cost in USD',
      labelNames: [LABELS.PROVIDER],
    }),
    makeGaugeProvider({
      name: COST_METRICS.BUDGET_UTILIZATION,
      help: 'Budget utilization percentage per project',
      labelNames: [LABELS.PROJECT],
    }),

    // PM Metrics
    makeGaugeProvider({
      name: PM_METRICS.UTILIZATION_PERCENT,
      help: 'PM utilization percentage',
      labelNames: [LABELS.PM_ID],
    }),
    makeGaugeProvider({
      name: PM_METRICS.TICKETS_MANAGED,
      help: 'Number of tickets managed by PM',
      labelNames: [LABELS.PM_ID],
    }),
    makeGaugeProvider({
      name: PM_METRICS.PROJECTS_ACTIVE,
      help: 'Number of active projects per PM',
      labelNames: [LABELS.PM_ID],
    }),

    // System Metrics
    makeGaugeProvider({
      name: SYSTEM_METRICS.MEMORY_USAGE,
      help: 'Memory usage in bytes',
      labelNames: ['type'],
    }),
    makeGaugeProvider({
      name: SYSTEM_METRICS.CPU_USAGE,
      help: 'CPU usage in seconds',
    }),
    makeGaugeProvider({
      name: SYSTEM_METRICS.ACTIVE_CONNECTIONS,
      help: 'Number of active connections',
    }),
    makeGaugeProvider({
      name: SYSTEM_METRICS.UPTIME,
      help: 'Application uptime in seconds',
    }),
  ],
  exports: [MetricsService],
})
export class AppMetricsModule {}
```

---

### Step 8: Create Metrics Controller

**File:** `src/common/metrics/metrics.controller.ts`

```typescript
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';

@ApiTags('Health')
@Controller()
export class MetricsController {
  /**
   * Health check endpoint for load balancers and Kubernetes
   * This is in addition to /metrics which is handled by PrometheusModule
   */
  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  health(): { status: string; timestamp: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness check - indicates if the service is ready to receive traffic
   */
  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is ready' })
  ready(): { status: string; timestamp: string } {
    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Liveness check - indicates if the service is alive
   */
  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  live(): { status: string; timestamp: string; uptime: number } {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
```

---

### Step 9: Create Barrel Export

**File:** `src/common/metrics/index.ts`

```typescript
export { AppMetricsModule } from './metrics.module';
export { MetricsService } from './metrics.service';
export { MetricsController } from './metrics.controller';
export * from './metrics.constants';
export * from './metrics.interface';
export { MetricsInterceptor } from './interceptors';
export { TrackMetric, TRACK_METRIC_KEY, TrackMetricOptions } from './decorators';
```

---

### Step 10: Update Configuration

**File:** `src/config/configuration.ts` (UPDATE - add metrics section)

Add to the existing configuration object:

```typescript
metrics: {
  enabled: process.env.METRICS_ENABLED !== 'false',
  collectDefaultMetrics: process.env.METRICS_DEFAULT !== 'false',
  path: process.env.METRICS_PATH || '/metrics',
},
```

---

### Step 11: Update Environment Validation

**File:** `src/config/env.validation.ts` (UPDATE - add metrics validation)

Add to the existing Joi schema:

```typescript
METRICS_ENABLED: Joi.boolean()
  .default(true)
  .description('Enable Prometheus metrics endpoint'),

METRICS_DEFAULT: Joi.boolean()
  .default(true)
  .description('Collect default Node.js metrics'),

METRICS_PATH: Joi.string()
  .default('/metrics')
  .description('Path for Prometheus metrics endpoint'),
```

---

### Step 12: Update App Module

**File:** `src/app.module.ts` (UPDATE existing file)

Add import:
```typescript
import { AppMetricsModule } from './common/metrics';
```

Add to imports array (IMPORTANT: must be before other modules that inject metrics):
```typescript
@Module({
  imports: [
    // Global modules (order matters!)
    ConfigModule,
    LoggerModule,
    AppMetricsModule,  // Add early - provides metrics to other modules
    DatabaseModule,
    
    // ... rest of existing imports ...
  ],
  // ... rest of module
})
```

---

### Step 13: Update .env.example

**File:** `.env.example` (ADD metrics section)

```bash
# ===================
# Prometheus Metrics
# ===================
METRICS_ENABLED=true
METRICS_DEFAULT=true
METRICS_PATH=/metrics
```

---

## Testing Configuration

### Unit Test: Metrics Service

**File:** `src/common/metrics/metrics.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { getToken } from '@willsoto/nestjs-prometheus';
import { MetricsService } from './metrics.service';
import { LoggerService } from '../logger';
import {
  HTTP_METRICS,
  TICKET_METRICS,
  AI_METRICS,
  QA_METRICS,
  DEPLOYMENT_METRICS,
  COST_METRICS,
  PM_METRICS,
  SYSTEM_METRICS,
} from './metrics.constants';

describe('MetricsService', () => {
  let service: MetricsService;

  const mockHistogram = {
    observe: jest.fn(),
    startTimer: jest.fn(() => jest.fn()),
  };

  const mockCounter = {
    inc: jest.fn(),
    labels: jest.fn(() => ({ inc: jest.fn() })),
  };

  const mockGauge = {
    set: jest.fn(),
    inc: jest.fn(),
    dec: jest.fn(),
  };

  const mockLogger = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: LoggerService, useValue: mockLogger },
        
        // HTTP Metrics
        { provide: getToken(HTTP_METRICS.REQUEST_DURATION), useValue: mockHistogram },
        { provide: getToken(HTTP_METRICS.REQUEST_TOTAL), useValue: mockCounter },
        
        // Ticket Metrics
        { provide: getToken(TICKET_METRICS.RECEIVED_TOTAL), useValue: mockCounter },
        { provide: getToken(TICKET_METRICS.PROCESSED_TOTAL), useValue: mockCounter },
        { provide: getToken(TICKET_METRICS.QUEUE_SIZE), useValue: mockGauge },
        
        // AI Metrics
        { provide: getToken(AI_METRICS.EXECUTIONS_TOTAL), useValue: mockCounter },
        { provide: getToken(AI_METRICS.EXECUTION_DURATION), useValue: mockHistogram },
        { provide: getToken(AI_METRICS.TOKENS_USED), useValue: mockCounter },
        { provide: getToken(AI_METRICS.PROVIDER_STATUS), useValue: mockGauge },
        
        // QA Metrics
        { provide: getToken(QA_METRICS.CHECKS_TOTAL), useValue: mockCounter },
        { provide: getToken(QA_METRICS.CHECK_DURATION), useValue: mockHistogram },
        { provide: getToken(QA_METRICS.COVERAGE_PERCENT), useValue: mockGauge },
        { provide: getToken(QA_METRICS.VULNERABILITIES), useValue: mockCounter },
        
        // Deployment Metrics
        { provide: getToken(DEPLOYMENT_METRICS.TOTAL), useValue: mockCounter },
        { provide: getToken(DEPLOYMENT_METRICS.DURATION), useValue: mockHistogram },
        { provide: getToken(DEPLOYMENT_METRICS.SUCCESS_RATE), useValue: mockGauge },
        
        // Cost Metrics
        { provide: getToken(COST_METRICS.PER_PROJECT), useValue: mockHistogram },
        { provide: getToken(COST_METRICS.TOTAL), useValue: mockCounter },
        { provide: getToken(COST_METRICS.BUDGET_UTILIZATION), useValue: mockGauge },
        
        // PM Metrics
        { provide: getToken(PM_METRICS.UTILIZATION_PERCENT), useValue: mockGauge },
        { provide: getToken(PM_METRICS.TICKETS_MANAGED), useValue: mockGauge },
        { provide: getToken(PM_METRICS.PROJECTS_ACTIVE), useValue: mockGauge },
        
        // System Metrics
        { provide: getToken(SYSTEM_METRICS.MEMORY_USAGE), useValue: mockGauge },
        { provide: getToken(SYSTEM_METRICS.CPU_USAGE), useValue: mockGauge },
        { provide: getToken(SYSTEM_METRICS.ACTIVE_CONNECTIONS), useValue: mockGauge },
        { provide: getToken(SYSTEM_METRICS.UPTIME), useValue: mockGauge },
      ],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
  });

  afterEach(() => {
    // Clean up intervals
    service.onModuleDestroy?.();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('HTTP Metrics', () => {
    it('should record HTTP request', () => {
      service.recordHttpRequest({
        method: 'GET',
        path: '/api/tickets',
        statusCode: 200,
        duration: 0.5,
      });

      expect(mockHistogram.observe).toHaveBeenCalled();
      expect(mockCounter.inc).toHaveBeenCalled();
    });

    it('should normalize path with UUID', () => {
      service.recordHttpRequest({
        method: 'GET',
        path: '/api/tickets/123e4567-e89b-12d3-a456-426614174000',
        statusCode: 200,
        duration: 0.1,
      });

      expect(mockHistogram.observe).toHaveBeenCalledWith(
        expect.objectContaining({ path: '/api/tickets/:id' }),
        expect.any(Number),
      );
    });
  });

  describe('Ticket Metrics', () => {
    it('should increment tickets received', () => {
      service.incrementTicketsReceived('project-123');
      expect(mockCounter.inc).toHaveBeenCalledWith({ project_id: 'project-123' });
    });

    it('should increment tickets processed', () => {
      service.incrementTicketsProcessed('project-123', 'success');
      expect(mockCounter.inc).toHaveBeenCalled();
    });

    it('should set ticket queue size', () => {
      service.setTicketQueueSize(10);
      expect(mockGauge.set).toHaveBeenCalledWith(10);
    });
  });

  describe('AI Execution Metrics', () => {
    it('should record AI execution', () => {
      service.recordAIExecution({
        provider: 'cursor',
        status: 'success',
        duration: 30,
        tokensUsed: 1000,
        projectId: 'project-123',
      });

      expect(mockCounter.inc).toHaveBeenCalled();
      expect(mockHistogram.observe).toHaveBeenCalled();
    });

    it('should set AI provider status', () => {
      service.setAIProviderStatus('cursor', true);
      expect(mockGauge.set).toHaveBeenCalledWith({ provider: 'cursor' }, 1);
    });
  });

  describe('QA Metrics', () => {
    it('should record QA check', () => {
      service.recordQACheck({
        checkType: 'testing',
        status: 'passed',
        duration: 5,
        projectId: 'project-123',
        coverage: 85,
      });

      expect(mockCounter.inc).toHaveBeenCalled();
      expect(mockHistogram.observe).toHaveBeenCalled();
      expect(mockGauge.set).toHaveBeenCalled();
    });
  });

  describe('Deployment Metrics', () => {
    it('should record deployment', () => {
      service.recordDeployment({
        environment: 'staging',
        status: 'success',
        duration: 120,
        projectId: 'project-123',
      });

      expect(mockCounter.inc).toHaveBeenCalled();
      expect(mockHistogram.observe).toHaveBeenCalled();
    });

    it('should set deployment success rate', () => {
      service.setDeploymentSuccessRate('production', 0.95);
      expect(mockGauge.set).toHaveBeenCalledWith({ environment: 'production' }, 0.95);
    });
  });

  describe('Cost Metrics', () => {
    it('should record cost', () => {
      service.recordCost({
        provider: 'cursor',
        amount: 5.50,
        projectId: 'project-123',
      });

      expect(mockHistogram.observe).toHaveBeenCalled();
      expect(mockCounter.inc).toHaveBeenCalled();
    });
  });

  describe('PM Metrics', () => {
    it('should update PM utilization', () => {
      service.updatePMUtilization({
        pmId: 'pm-001',
        utilizationPercent: 75,
        ticketsManaged: 15,
        projectsActive: 5,
      });

      expect(mockGauge.set).toHaveBeenCalledTimes(3);
    });
  });

  describe('System Metrics', () => {
    it('should collect system metrics on init', () => {
      service.onModuleInit();
      // Wait for collection
      expect(mockGauge.set).toHaveBeenCalled();
    });
  });
});
```

### E2E Test: Metrics Endpoint

**File:** `test/metrics.e2e-spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Metrics (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/metrics (GET)', () => {
    it('should return Prometheus-formatted metrics', async () => {
      const response = await request(app.getHttpServer())
        .get('/metrics')
        .expect(200);

      // Check content type
      expect(response.headers['content-type']).toContain('text/plain');

      // Check for expected metric prefixes
      expect(response.text).toContain('dsf_');
      
      // Check for default Node.js metrics
      expect(response.text).toContain('process_');
      expect(response.text).toContain('nodejs_');
    });

    it('should include custom business metrics', async () => {
      const response = await request(app.getHttpServer())
        .get('/metrics')
        .expect(200);

      // Check for our custom metrics (they may be 0 initially)
      expect(response.text).toContain('dsf_http_request');
      expect(response.text).toContain('dsf_tickets_received_total');
      expect(response.text).toContain('dsf_ai_executions_total');
      expect(response.text).toContain('dsf_qa_checks_total');
      expect(response.text).toContain('dsf_deployments_total');
      expect(response.text).toContain('dsf_pm_utilization_percent');
    });

    it('should include system metrics', async () => {
      const response = await request(app.getHttpServer())
        .get('/metrics')
        .expect(200);

      expect(response.text).toContain('dsf_memory_usage_bytes');
      expect(response.text).toContain('dsf_uptime_seconds');
    });
  });

  describe('/health (GET)', () => {
    it('should return health status', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('/ready (GET)', () => {
    it('should return readiness status', async () => {
      const response = await request(app.getHttpServer())
        .get('/ready')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'ready');
    });
  });

  describe('/live (GET)', () => {
    it('should return liveness status with uptime', async () => {
      const response = await request(app.getHttpServer())
        .get('/live')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'alive');
      expect(response.body).toHaveProperty('uptime');
      expect(typeof response.body.uptime).toBe('number');
    });
  });

  describe('HTTP metrics recording', () => {
    it('should increment HTTP request counter after requests', async () => {
      // Make some requests
      await request(app.getHttpServer()).get('/health').expect(200);
      await request(app.getHttpServer()).get('/health').expect(200);
      await request(app.getHttpServer()).get('/ready').expect(200);

      // Check metrics
      const response = await request(app.getHttpServer())
        .get('/metrics')
        .expect(200);

      // Should see incremented request counters
      expect(response.text).toContain('dsf_http_requests_total');
    });
  });
});
```

---

## Validation Checklist

**Installation & Setup:**
- [ ] `@willsoto/nestjs-prometheus` and `prom-client` installed

**Metrics Module (15 files in src/common/metrics/):**
- [ ] `metrics.module.ts` - PrometheusModule configuration
- [ ] `metrics.service.ts` - Metrics service with all business methods
- [ ] `metrics.constants.ts` - All metric names, labels, and alert thresholds
- [ ] `metrics.interface.ts` - TypeScript interfaces
- [ ] `metrics.controller.ts` - Health/ready/live endpoints
- [ ] `index.ts` - Barrel export
- [ ] `interceptors/metrics.interceptor.ts` - HTTP metrics interceptor
- [ ] `interceptors/index.ts` - Interceptors barrel
- [ ] `decorators/track-metric.decorator.ts` - @TrackMetric decorator
- [ ] `decorators/index.ts` - Decorators barrel
- [ ] `collectors/http.collector.ts` - HTTP request metrics
- [ ] `collectors/business.collector.ts` - Business metrics
- [ ] `collectors/system.collector.ts` - System metrics
- [ ] `collectors/queue.collector.ts` - RabbitMQ queue metrics (FR101)
- [ ] `collectors/index.ts` - Collectors barrel

**Metrics Endpoints:**
- [ ] `/metrics` returns Prometheus-formatted metrics
- [ ] `/health` returns health status
- [ ] `/ready` returns readiness status
- [ ] `/live` returns liveness status with uptime

**Core Business Metrics (from acceptance criteria):**
- [ ] `dsf_tickets_received_total` (counter)
- [ ] `dsf_ai_executions_total` (counter with provider label)
- [ ] `dsf_qa_checks_total` (counter with check_type, status labels)
- [ ] `dsf_deployment_success_rate` (gauge)
- [ ] `dsf_cost_per_project` (histogram)
- [ ] `dsf_pm_utilization_percent` (gauge with pm_id label)

**RabbitMQ Queue Metrics (FR101):**
- [ ] `dsf_queue_depth{queue}` (gauge per queue)
- [ ] `dsf_queue_processing_rate{queue}` (gauge - msgs/min)
- [ ] `dsf_queue_oldest_message_age_seconds{queue}` (gauge)
- [ ] `dsf_queue_dead_letter_count{queue}` (gauge)
- [ ] `dsf_queue_consumer_count{queue}` (gauge)

**HTTP Metrics:**
- [ ] Request duration histogram
- [ ] Request total counter
- [ ] Path normalization (UUIDs replaced with :id)

**System Metrics:**
- [ ] Memory usage (heap, rss, external)
- [ ] CPU usage
- [ ] Uptime
- [ ] Event loop lag

**Infrastructure Metrics:**
- [ ] Database connections (active, idle, waiting)
- [ ] Database query duration histogram
- [ ] WebSocket active connections
- [ ] WebSocket messages total

**Error Metrics (NFR-O6):**
- [ ] `dsf_errors_total{error_type}` (counter)
- [ ] `dsf_unhandled_exceptions_total` (counter)

**Alert Thresholds Configured:**
- [ ] Queue depth warning (50) and critical (100)
- [ ] PM utilization warning (80%) and critical (95%)
- [ ] Cost budget warning (80%) and critical (100%)

**Integration:**
- [ ] AppMetricsModule in AppModule (early in imports)
- [ ] MetricsInterceptor available for injection
- [ ] MetricsService globally exported
- [ ] Default metrics collection enabled

**Configuration:**
- [ ] metrics section in configuration.ts
- [ ] Metrics env vars in env.validation.ts
- [ ] .env.example updated

**Tests:**
- [ ] Unit tests pass for MetricsService
- [ ] E2E tests pass for /metrics endpoint
- [ ] E2E tests pass for health endpoints
- [ ] `npm run test` passes
- [ ] `npm run test:e2e` passes

**Code Quality:**
- [ ] `npm run lint` - no errors
- [ ] TypeScript compiles without errors

---

## Grafana Dashboard Examples

Once Prometheus is scraping metrics, you can create Grafana dashboards. Here are some useful queries:

### Request Rate
```promql
rate(dsf_http_requests_total[5m])
```

### Request Duration P95
```promql
histogram_quantile(0.95, rate(dsf_http_request_duration_seconds_bucket[5m]))
```

### AI Execution Success Rate
```promql
sum(rate(dsf_ai_executions_total{status="success"}[5m])) / sum(rate(dsf_ai_executions_total[5m]))
```

### Ticket Processing Throughput
```promql
rate(dsf_tickets_processed_total[5m])
```

### Memory Usage
```promql
dsf_memory_usage_bytes{type="heap_used"}
```

### Queue Depth (FR101)
```promql
dsf_queue_depth{queue="ai-execution-queue"}
```

### Queue Backlog Alert
```promql
dsf_queue_depth > 50  # Warning threshold
dsf_queue_depth > 100 # Critical threshold
```

### Error Rate
```promql
sum(rate(dsf_errors_total[5m])) / sum(rate(dsf_http_requests_total[5m]))
```

---

## ⚠️ Metric Cardinality Warning

**CRITICAL: Avoid high-cardinality labels that can cause metric explosion!**

**❌ NEVER use these as label values:**
- User IDs, email addresses, or usernames
- Request IDs, correlation IDs, or trace IDs
- Timestamps or dates
- IP addresses
- Full file paths or URLs with query strings
- Free-form text fields

**✅ SAFE label values:**
- Fixed enums: `status="success|failed|timeout"`
- Known categories: `provider="cursor|claude_code"`
- Environments: `environment="dev|staging|production"`
- Normalized paths: `/api/tickets/:id` (not `/api/tickets/123e4567-...`)

**Cardinality Rule of Thumb:**
- Each unique label combination creates a time series
- Target: <10,000 active time series per metric
- The `normalizePath()` function exists specifically to prevent path cardinality explosion

---

## 📊 Histogram Bucket Tuning

**Default histogram buckets are starting points - tune based on actual P50/P95/P99 observations after production deployment.**

```typescript
// Current buckets - adjust after collecting baseline data
DEFAULT_BUCKETS: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

// Example tuning for AI executions (typically 30-300 seconds)
AI_BUCKETS: [1, 5, 10, 30, 60, 120, 300, 600]
```

**Tuning Process:**
1. Deploy with default buckets
2. Collect 1-2 weeks of data
3. Use `histogram_quantile(0.5, ...)` to find P50
4. Adjust buckets to cluster around P50 with finer granularity
5. Ensure buckets cover P99 with some margin

---

## 🔗 Future Story Integration

This story provides the Prometheus infrastructure foundation. Future stories will ADD metrics using this pattern:

| Story | Epic | Metrics Added | Integration Point |
|-------|------|---------------|-------------------|
| **3.8** | QA Automation | `qa_queue_depth`, `qa_processing_rate`, `qa_review_duration` | `MetricsService.recordQACheck()` |
| **4.8** | GitHub Integration | `github_push_total`, `github_push_duration`, `deployment_success_rate` | `MetricsService.recordDeployment()` |
| **7.8** | Architecture Review | `adr_reviews_total`, `adr_approval_rate`, `tl_queue_depth` | New TL metrics methods |
| **8.8** | QA Review | `qa_review_queue_depth`, `qa_review_duration_seconds` | QA review metrics methods |
| **9.7** | Self-Healing | `production_errors_detected`, `fixes_attempted`, `fix_success_rate` | Self-healing metrics methods |
| **10.6** | Queue Monitoring | Queue depth alerts, Socket.IO real-time updates | `updateQueueMetrics()` |

**Pattern for Adding New Metrics:**
1. Add metric constant to `metrics.constants.ts`
2. Add interface to `metrics.interface.ts`
3. Add provider in `metrics.module.ts`
4. Add method in `metrics.service.ts`
5. Call method from domain service

---

## References

| Source | Section | Relevance |
|--------|---------|-----------|
| Architecture | Technology Stack (Prometheus + Grafana) | Primary stack decision |
| Architecture | Project Structure (metrics/) | Module location |
| Architecture | FR91-95 Execution Metrics | Metrics requirements |
| Epics | Story 1.8 acceptance criteria | Core requirements |
| Epics | Story 10.6 Queue Depth Monitoring | Queue metrics requirements |
| Epics | Story 3.8 QA Metrics | QA metrics pattern |
| PRD | NFR-O5 Prometheus-compatible metrics | Primary NFR |
| PRD | NFR-O6 Critical failure alerts | Alert thresholds |
| PRD | NFR-O7 Cost threshold alerts | Budget alerts |
| PRD | NFR-O8 PM burnout alerts | Utilization alerts |
| PRD | FR101 Queue depth monitoring | Queue metrics |
| PRD | FR91-95 Execution Metrics & Logging | Business metrics |

---

## Dev Agent Record

**Story Status:** Ready for developer implementation  
**Context Completeness:** ✅ COMPREHENSIVE + QUALITY VALIDATED  
**Developer Readiness:** ✅ ULTIMATE IMPLEMENTATION GUIDE

**Key Implementation Notes:**
- Uses `@willsoto/nestjs-prometheus` for NestJS integration
- All metric names prefixed with `dsf_` for namespace isolation
- Path normalization prevents high cardinality (UUIDs → :id)
- System metrics collected every 15 seconds (matches Prometheus scrape interval)
- Health/ready/live endpoints for Kubernetes compatibility
- Labels follow best practices (project_id, provider, status, etc.)

**Dependencies from Previous Stories:**
- Story 1.5 (RabbitMQ): Queue names must match for queue metrics
- Story 1.7 (Winston Logging): LoggerService is injected into MetricsService
- Story 1.4 (Configuration): ConfigService used for metrics configuration
- Story 1.6 (JWT Auth): @Public() decorator for health endpoints

**Future Stories Using This:**
- Story 3.8: QA Metrics & Prometheus Integration
- Story 4.8: GitHub Integration Metrics & Monitoring
- Story 7.8: Architecture Review Metrics
- Story 8.8: QA Review Metrics
- Story 9.7: Self-Healing Metrics
- Story 10.6: Queue Depth Monitoring & Alerts

**Quality Validation Applied:**
- ✅ Added RabbitMQ queue depth metrics (FR101)
- ✅ Added queue processing rate metrics
- ✅ Added alert threshold configuration (NFR-O6, NFR-O7, NFR-O8)
- ✅ Clarified module location (src/common/metrics vs src/metrics)
- ✅ Added event loop lag metric
- ✅ Added database connection pool metrics
- ✅ Added WebSocket connection metrics
- ✅ Added error rate metrics
- ✅ Added CI/CD pipeline metrics
- ✅ Added histogram bucket tuning guidance
- ✅ Added metric cardinality warning
- ✅ Added future story integration table

**Document prepared by:** Bob (Scrum Master)  
**Quality validated by:** Independent LLM Reviewer  
**Preparation date:** 2025-11-28

