# Story 4.8: GitHub Integration Metrics & Monitoring

**Status:** ready-for-dev

## Story

As an operator,
I want GitHub integration metrics exposed via Prometheus,
So that I can monitor git operations, deployment success rates, and make informed GO/NO-GO decisions.

## Prerequisites

**Story Dependencies:**

- Story 1.8 (Prometheus Metrics Endpoints) - provides `MetricsService` facade and metrics infrastructure
- Stories 4.1-4.7 (GitHub Integration) - provide GitHub operations to instrument
  - Story 4.1: GitHub API Client & Authentication
  - Story 4.2: Feature Branch Creation
  - Story 4.3: Git Commit Generation & Push
  - Story 4.4: Pull Request Creation & Metadata
  - Story 4.5: CI/CD Pipeline Trigger & Monitoring
  - Story 4.6: Deployment Status Synchronization
  - Story 4.7: GitHub Push Error Handling & Rollback (simplified scope)

### Prerequisites Verification

> [!IMPORTANT]
> **MetricsService Integration (Story 1.8)**
>
> Before starting implementation, verify `MetricsService` has generic metric methods:
>
> - **Location:** `src/common/metrics/metrics.service.ts` ✅ CONFIRMED
> - **CRITICAL:** Current MetricsService (Lines 150-182) uses domain-specific methods. This story requires generic methods:
>   - `incrementCounter(name: string, labels?: Record<string, string>): void`
>   - `recordHistogram(name: string, value: number, labels?: Record<string, string>): void`
>   - `setGauge(name: string, value: number, labels?: Record<string, string>): void`
>
> **Action if Missing:** Add generic facade methods to MetricsService that delegate to BusinessCollector:
>
> ```typescript
> incrementCounter(name: string, labels?: Record<string, string>): void {
>   this.businessCollector.incrementGenericCounter(name, labels);
> }
> ```
>
> See Dev Notes "MetricsService Generic Methods" section for complete implementation.

### GitHub Services Context

**GitHub Operations to Instrument:**

1. **Branch Creation** (`github-branch.service.ts` from 4.2):
   - `createBranch()`: Track success/failure rates
   - GitHub API rate limits
   - Branch naming conflicts

2. **Commit & Push** (`github-commit-orchestrator.service.ts` from 4.3):
   - AI delegation for commit message generation
   - Commit push success/failure
   - Git operation duration

3. **Pull Request Creation** (`github-pr-orchestrator.service.ts` from 4.4):
   - PR creation success/failure
   - AI delegation for PR description
   - PR metadata validation

4. **CI/CD Monitoring** (`deployment-orchestrator.service.ts` from 4.5):
   - GitHub Actions workflow triggers
   - Deployment status polling
   - CI/CD pipeline duration

5. **Deployment Synchronization** (`deployment-status-sync.service.ts` from 4.6):
   - ClickUp status sync success/failure
   - Deployment completion tracking

## Acceptance Criteria

### AC#1: GitHub Operations Metrics

**Given** GitHub operations are executing (branch creation, commit push, PR creation)  
**When** metrics are collected  
**Then** Prometheus exposes the following counters:

| Metric Name               | Type    | Labels                                             | Description                           |
| ------------------------- | ------- | -------------------------------------------------- | ------------------------------------- |
| `github_push_total`       | Counter | `status="success\|failed"`, `error_type`           | Total GitHub push operations          |
| `github_pr_created_total` | Counter | `status="success\|failed"`, `repository`           | Total PR creation attempts            |
| `github_api_calls_total`  | Counter | `operation`, `status`, `account_type`              | Total GitHub API calls                |
| `github_rate_limit_hits`  | Counter | `installation_id`, `reset_time_bucket`             | Rate limit hits by installation       |
| `github_branch_total`     | Counter | `status="success\|failed\|conflict"`, `repository` | Branch creation operations            |
| `github_commit_total`     | Counter | `status="success\|failed"`, `repository`           | Commit generation and push operations |

**And** metrics include granular error classification:

- `error_type` values: `authentication`, `rate_limit`, `network`, `validation`, `conflict`, `timeout`, `unknown`
- `status` values: `success`, `failed`
- `operation` values: `create_branch`, `push_commit`, `create_pr`, `trigger_workflow`, `poll_status`

### AC#2: Deployment Metrics

**Given** deployments are running (triggering CI/CD, monitoring status)  
**When** deployment lifecycle events occur  
**Then** Prometheus exposes the following metrics:

| Metric Name                           | Type      | Labels                                                   | Description                             |
| ------------------------------------- | --------- | -------------------------------------------------------- | --------------------------------------- |
| `deployment_total`                    | Counter   | `environment`, `status="completed\|failed\|rolled_back"` | Total deployments by outcome            |
| `deployment_duration_seconds`         | Histogram | `environment`, `cicd_provider`                           | Deployment duration distribution        |
| `deployment_success_rate`             | Gauge     | `environment`, `time_window="1h\|24h\|7d"`               | Rolling success rate percentage (0-100) |
| `deployment_in_progress`              | Gauge     | `environment`                                            | Current deployments in progress         |
| `cicd_pipeline_trigger_total`         | Counter   | `provider="github_actions\|jenkins"`, `status`           | CI/CD pipeline trigger attempts         |
| `cicd_workflow_poll_duration_seconds` | Histogram | `environment`                                            | Time spent polling deployment status    |

**Histogram Buckets:**

- `deployment_duration_seconds`: `[30, 60, 120, 300, 600, 1200, 1800]` (seconds: 30s, 1m, 2m, 5m, 10m, 20m, 30m)
- `cicd_workflow_poll_duration_seconds`: `[5, 10, 30, 60, 120, 300]` (seconds)

### AC#3: Performance & Duration Metrics

**Given** GitHub and deployment operations have varying performance characteristics  
**When** operations complete  
**Then** Prometheus exposes timing histograms:

| Metric Name                           | Type      | Labels                            | Description                    |
| ------------------------------------- | --------- | --------------------------------- | ------------------------------ |
| `github_push_duration_seconds`        | Histogram | `repository`, `file_count_bucket` | Time to push commits to GitHub |
| `github_api_call_duration_seconds`    | Histogram | `operation`, `account_type`       | GitHub API call latency        |
| `github_pr_creation_duration_seconds` | Histogram | `repository`                      | Time to create PR via API      |

**Histogram Buckets:**

- `github_push_duration_seconds`: `[0.5, 1, 2, 5, 10, 30, 60]` (seconds)
- `github_api_call_duration_seconds`: `[0.1, 0.5, 1, 2, 5, 10]` (seconds)
- `github_pr_creation_duration_seconds`: `[0.5, 1, 2, 5, 10]` (seconds)

**File Count Buckets** (for `file_count_bucket` label):

- `empty` (0 files), `1-5`, `6-20`, `21-50`, `51-100`, `100+`

### AC#4: Alerting Rules Configuration

**Given** operators need to be alerted to GitHub integration issues  
**When** metrics exceed thresholds  
**Then** Prometheus alerting rules are documented for:

| Alert Name                   | Condition                                                                    | Severity | Action                                     |
| ---------------------------- | ---------------------------------------------------------------------------- | -------- | ------------------------------------------ |
| `GitHubPushFailureRateHigh`  | `github_push_total{status="failed"}` / total \u003e 10% (5m window)          | Warning  | Alert operations team                      |
| `DeploymentFailureRateHigh`  | `deployment_total{status="failed"}` / total \u003e 5% (1h window)            | Critical | Alert operations + TL                      |
| `GitHubRateLimitApproaching` | `github_rate_limit_hits` \u003e 0 in last 5m                                 | Warning  | Throttle task submission, alert operations |
| `DeploymentStuck`            | `deployment_in_progress{environment}` \u003e 0 for \u003e 30m without change | Critical | Alert operations, check CI/CD pipeline     |
| `GitHubAPIHighLatency`       | `github_api_call_duration_seconds` p95 \u003e 3s (5m)                        | Warning  | Check GitHub status, network connectivity  |

**Alert Definition Schema:**

- Severity levels: `info`, `warning`, `critical`
- Notification channels: Slack (#operations), PagerDuty (critical only)
- Evaluation interval: 15 seconds (matches Prometheus scrape interval from architecture.md)

> [!NOTE]
> **Alerting Rules Delivery Format**
>
> Provide alert rules as **Prometheus alerting rule YAML** in Dev Notes section (not Grafana alerts). Operations team will configure these in Prometheus Alert Manager.

### AC#5: Dashboard Metrics for PM & Manager Views

**Given** PMs and managers need visibility into deployment timelines (FR96-99)  
**When** dashboard APIs query metrics  
**Then** metrics support the following aggregations:

**PM Dashboard (FR96-99):**

- Deployment timeline: `deployment_total`, `deployment_duration_seconds` by `environment` and time
- Success rate trend: `deployment_success_rate{environment, time_window}`
- Current status: `deployment_in_progress{environment}`

**GO/NO-GO Decision Dashboard:**

- GitHub push reliability: `github_push_total{status="success"}` / total (last 24h)
- Deployment success rate: `deployment_success_rate{time_window="24h"}` by environment
- Rate limit impact: `github_rate_limit_hits` (last 24h)

**Manager Business Oversight:**

- Deployment frequency: Count of `deployment_total` per day/week
- Mean time to deploy: Average of `deployment_duration_seconds`
- Error budget consumption: Percentage of failed deployments vs SLO target

**Data Freshness:** All metrics must be collectible with < 15s staleness (Prometheus scrape interval).

> [!NOTE]
> **Real-Time Dashboard Updates**
>
> Socket.IO integration for real-time PM dashboard updates is deferred to Epic 10 (Real-Time Updates & Orchestrator Monitoring). Metrics will be queryable via REST API; Socket.IO push events will be wired when `RealtimeGateway` is implemented.
>
> See Story 4.6 for Socket.IO deferral pattern.

### AC#6: Metrics Integration with Existing Services

**Given** GitHub services exist from Stories 4.1-4.7  
**When** implementing metrics instrumentation  
**Then** the implementation:

- ✅ **Reuses `MetricsService`** from Story 1.8 (no direct Prometheus client access)
- ✅ **Instruments existing service methods** without breaking changes
- ✅ **Registers metrics once** in `BusinessCollector` or `SystemCollector` (Story 1.8 pattern)
- ✅ **Uses consistent label naming** with existing metrics (e.g., `environment`, `status`)
- ✅ **Adds metrics calls** to orchestrator services (`GitHubBranchService`, `GitHubCommitOrchestrator`, `GitHubPROrchestrator`, `DeploymentOrchestrator`, `DeploymentStatusSync`)
- ❌ **Does NOT create new MetricsService** (reuse existing)
- ❌ **Does NOT modify `/metrics` endpoint** (auto-exposed by Story 1.8)

**Integration Points:**

1. **Story 4.2 Integration:** Add `incrementCounter('github_branch_total')` in `GitHubBranchService.createBranch()`
2. **Story 4.3 Integration:** Add `recordHistogram('github_push_duration_seconds')` in `GitHubCommitOrchestrator.execute()`
3. **Story 4.4 Integration:** Add `incrementCounter('github_pr_created_total')` in `GitHubPROrchestrator.execute()`
4. **Story 4.5 Integration:** Add `recordHistogram('deployment_duration_seconds')` in `DeploymentOrchestrator.pollDeploymentStatus()`
5. **Story 4.6 Integration:** Add `incrementCounter('deployment_total')` in `DeploymentStatusSync.syncToClickUp()`

## Tasks

- [ ] Register GitHub metrics in `BusinessCollector` (reuse Story 1.8 pattern) (AC#1, #2, #3)
  - [ ] Define counter providers for `github_push_total`, `github_pr_created_total`, `github_branch_total`, `github_commit_total`
  - [ ] Define histogram providers for `github_push_duration_seconds`, `deployment_duration_seconds`, `cicd_workflow_poll_duration_seconds`
  - [ ] Define gauge providers for `deployment_success_rate`, `deployment_in_progress`
- [ ] Instrument GitHub services with metrics calls (AC#6)
  - [ ] Add metrics to `GitHubBranchService` (Story 4.2)
  - [ ] Add metrics to `GitHubCommitOrchestrator` (Story 4.3)
  - [ ] Add metrics to `GitHubPROrchestrator` (Story 4.4)
  - [ ] Add metrics to `DeploymentOrchestrator` (Story 4.5)
  - [ ] Add metrics to `DeploymentStatusSync` (Story 4.6)
- [ ] Create `deployment_success_rate` gauge calculator service (AC#2)
  - [ ] Calculate rolling success rate (1h, 24h, 7d windows)
  - [ ] Update gauge on each deployment completion
- [ ] Document Prometheus alerting rules in Dev Notes (AC#4)
- [ ] Unit tests (\u003e80% coverage): metric registration, label validation, gauge calculations
- [ ] Pre-review checks (lint, test, build)
- [ ] Update story file (mark tasks complete, populate file list, add completion notes)

## Dev Notes

### MetricsService Generic Methods Implementation

**CRITICAL:** This story requires generic metric methods in `MetricsService`. If not present, add before implementation:

**File:** `src/common/metrics/metrics.service.ts`

```typescript
// Add these methods after existing domain-specific methods (after line ~182)

// ============= Generic Metrics Facade (Story 4.8) =============

incrementCounter(name: string, labels?: Record<string, string>): void {
  // Delegate to appropriate collector based on metric name
  if (name.startsWith('github_') || name.startsWith('deployment_') || name.startsWith('cicd_')) {
    this.systemCollector.incrementGenericCounter(name, labels);
  } else {
    this.businessCollector.incrementGenericCounter(name, labels);
  }
}

recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
  if (name.startsWith('github_') || name.startsWith('deployment_') || name.startsWith('cicd_')) {
    this.systemCollector.recordGenericHistogram(name, value, labels);
  } else {
    this.businessCollector.recordGenericHistogram(name, value, labels);
  }
}

setGauge(name: string, value: number, labels?: Record<string, string>): void {
  if (name.startsWith('github_') || name.startsWith('deployment_') || name.startsWith('cicd_')) {
    this.systemCollector.setGenericGauge(name, value, labels);
  } else {
    this.businessCollector.setGenericGauge(name, value, labels);
  }
}
```

**Then add to SystemCollector:**

**File:** `src/common/metrics/collectors/system.collector.ts`

```typescript
// Add generic methods
incrementGenericCounter(name: string, labels?: Record<string, string>): void {
  const counter = this.getOrCreateCounter(name);
  counter.inc(labels || {});
}

recordGenericHistogram(name: string, value: number, labels?: Record<string, string>): void {
  const histogram = this.getOrCreateHistogram(name);
  histogram.observe(labels || {}, value);
}

setGenericGauge(name: string, value: number, labels?: Record<string, string>): void {
  const gauge = this.getOrCreateGauge(name);
  gauge.set(labels || {}, value);
}

private getOrCreateCounter(name: string): Counter {
  // Implementation: lookup from registered metrics or throw error
}
```

> [!NOTE]
> **E1: Histogram Bucket Verification**
>
> Before finalizing bucket values in GITHUB_METRICS registration, verify against actual performance data from Stories 4.1-4.7:
>
> - Review GitHub operation durations in logs/monitoring
> - Adjust buckets if actual values cluster outside defined ranges
> - Prevents histogram inefficiency and query performance issues

### Metrics Registration Pattern (Story 1.8)

**Location:** `src/common/metrics/collectors/business.collector.ts`

**Pattern from Previous Stories:**

```typescript
import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';

export const GITHUB_METRICS = [
  // Counters
  makeCounterProvider({
    name: 'github_push_total',
    help: 'Total GitHub push operations',
    labelNames: ['status', 'error_type', 'repository'],
  }),
  makeCounterProvider({
    name: 'github_pr_created_total',
    help: 'Total pull request creation attempts',
    labelNames: ['status', 'repository'],
  }),
  makeCounterProvider({
    name: 'github_branch_total',
    help: 'Total branch creation operations',
    labelNames: ['status', 'repository'],
  }),
  makeCounterProvider({
    name: 'github_commit_total',
    help: 'Total commit generation and push operations',
    labelNames: ['status', 'repository'],
  }),
  makeCounterProvider({
    name: 'github_api_calls_total',
    help: 'Total GitHub API calls',
    labelNames: ['operation', 'status', 'account_type'],
  }),
  makeCounterProvider({
    name: 'github_rate_limit_hits',
    help: 'GitHub rate limit hits by installation',
    labelNames: ['installation_id', 'reset_time_bucket'],
  }),
  makeCounterProvider({
    name: 'deployment_total',
    help: 'Total deployments by outcome',
    labelNames: ['environment', 'status'],
  }),
  makeCounterProvider({
    name: 'cicd_pipeline_trigger_total',
    help: 'CI/CD pipeline trigger attempts',
    labelNames: ['provider', 'status'],
  }),

  // Histograms
  makeHistogramProvider({
    name: 'github_push_duration_seconds',
    help: 'Time to push commits to GitHub',
    labelNames: ['repository', 'file_count_bucket'],
    buckets: [0.5, 1, 2, 5, 10, 30, 60],
  }),
  makeHistogramProvider({
    name: 'deployment_duration_seconds',
    help: 'Deployment duration distribution',
    labelNames: ['environment', 'cicd_provider'],
    buckets: [30, 60, 120, 300, 600, 1200, 1800],
  }),
  makeHistogramProvider({
    name: 'github_api_call_duration_seconds',
    help: 'GitHub API call latency',
    labelNames: ['operation', 'account_type'],
    buckets: [0.1, 0.5, 1, 2, 5, 10],
  }),
  makeHistogramProvider({
    name: 'github_pr_creation_duration_seconds',
    help: 'Time to create PR via GitHub API',
    labelNames: ['repository'],
    buckets: [0.5, 1, 2, 5, 10],
  }),
  makeHistogramProvider({
    name: 'cicd_workflow_poll_duration_seconds',
    help: 'Time spent polling deployment status',
    labelNames: ['environment'],
    buckets: [5, 10, 30, 60, 120, 300],
  }),

  // Gauges
  makeGaugeProvider({
    name: 'deployment_success_rate',
    help: 'Rolling deployment success rate percentage (0-100)',
    labelNames: ['environment', 'time_window'],
  }),
  makeGaugeProvider({
    name: 'deployment_in_progress',
    help: 'Current deployments in progress',
    labelNames: ['environment'],
  }),
];

// Add to BusinessCollector providers array in business.collector.ts
export const BusinessCollectorProviders = [...EXISTING_METRICS, ...GITHUB_METRICS];
```

**Module Registration:**

```typescript
// src/common/metrics/app-metrics.module.ts
import { GITHUB_METRICS } from './collectors/business.collector';

@Module({
  imports: [
    PrometheusModule.register({
      defaultMetrics: {
        enabled: true,
      },
    }),
  ],
  providers: [
    MetricsService,
    ...GITHUB_METRICS,
    // ... existing metrics
  ],
  exports: [MetricsService],
})
export class AppMetricsModule {}
```

### MetricsService Integration Pattern

**Standard Pattern** (apply to all GitHub services):

```typescript
async operation(): Promise<Result> {
  const startTime = Date.now();

  try {
    // Existing operation logic
    const result = await this.doWork();

    // ✅ Success metrics
    this.metricsService.incrementCounter('metric_name', {
      status: 'success',
      ...additionalLabels
    });

    // ✅ Duration metrics (if applicable)
    if (needsDuration) {
      const duration = (Date.now() - startTime) / 1000;
      this.metricsService.recordHistogram('metric_duration', duration, labels);
    }

    return result;
  } catch (error) {
    // ✅ Error metrics
    const errorType = classifyError(error); // Use classify-github-error.util
    this.metricsService.incrementCounter('metric_name', {
      status: 'failed',
      error_type: errorType,
      ...additionalLabels
    });

    throw error;
  }
}
```

**Apply Metrics To:**

| Service (Story)                  | Counter Metrics                                   | Histogram Metrics                                                    | Labels                                                    | See AC |
| -------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------- | ------ |
| `GitHubBranchService` (4.2)      | `github_branch_total`                             | None                                                                 | `status`, `repository`                                    | #1     |
| `GitHubCommitOrchestrator` (4.3) | `github_push_total`, `github_commit_total`        | `github_push_duration_seconds`                                       | `status`, `error_type`, `repository`, `file_count_bucket` | #1, #3 |
| `GitHubPROrchestrator` (4.4)     | `github_pr_created_total`                         | `github_pr_creation_duration_seconds`                                | `status`, `repository`                                    | #1, #3 |
| `DeploymentOrchestrator` (4.5)   | `deployment_total`, `cicd_pipeline_trigger_total` | `deployment_duration_seconds`, `cicd_workflow_poll_duration_seconds` | `environment`, `status`, `provider`, `cicd_provider`      | #2, #3 |
| `DeploymentStatusSync` (4.6)     | `deployment_total` (on sync)                      | None                                                                 | `environment`, `status`                                   | #2     |

**Integration Notes:**

- Inject `MetricsService` in constructor
- Use `getFileCountBucket()` utility for `file_count_bucket` label (CommitOrchestrator)
- Use `classifyGitHubError()` utility for `error_type` label
- Call `DeploymentSuccessRateCalculator.update()` in DeploymentOrchestrator after terminal status

### Deployment Success Rate Calculator

**Purpose:** Calculate rolling success rate for `deployment_success_rate` gauge (AC#2).

**Service:** `src/github/services/deployment-success-rate-calculator.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MetricsService } from '../../common/metrics/metrics.service';
import { DeploymentStatus } from '@prisma/client';
import { LoggerService } from '../../common/logger';

@Injectable()
export class DeploymentSuccessRateCalculator {
  private readonly QUERY_LIMIT = 1000; // E4: Prevent unbounded queries

  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly logger: LoggerService,
  ) {}

  async update(environment: string, status: DeploymentStatus): Promise<void> {
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
    const windows = { '1h': 3600000, '24h': 86400000, '7d': 604800000 };
    return windows[window] || 3600000;
  }
}
```

### File Count Bucket Calculation

**Purpose:** Label histogram with file count bucket for `github_push_duration_seconds`.

**Utility Function:**

```typescript
// src/github/utils/file-count-bucket.util.ts

export function getFileCountBucket(fileCount: number): string {
  if (fileCount === 0) return 'empty'; // E2: Handle empty commits
  if (fileCount <= 5) return '1-5';
  if (fileCount <= 20) return '6-20';
  if (fileCount <= 50) return '21-50';
  if (fileCount <= 100) return '51-100';
  return '100+';
}
```

**Usage in GitHubCommitOrchestrator:**

```typescript
import { getFileCountBucket } from '../utils/file-count-bucket.util';

async execute(taskId: string): Promise<void> {
  const startTime = Date.now();
  const fileCount = await this.getChangedFilesCount(taskId);

  try {
    // Existing push logic
    await this.pushCommit(taskId);

    // ✅ Record duration with file count bucket
    const duration = (Date.now() - startTime) / 1000;
    this.metricsService.recordHistogram('github_push_duration_seconds', duration, {
      repository: execution.repository,
      file_count_bucket: getFileCountBucket(fileCount),
    });

    this.metricsService.incrementCounter('github_push_total', {
      status: 'success',
      error_type: 'none',
    });
  } catch (error) {
    // ... error handling
  }
}
```

### Prometheus Alerting Rules (AC#4)

**File:** `docs/prometheus-alerts/github-integration-alerts.yml`

```yaml
groups:
  - name: github_integration
    interval: 15s
    rules:
      - alert: GitHubPushFailureRateHigh
        expr: |
          (
            rate(github_push_total{status="failed"}[5m])
            /
            rate(github_push_total[5m])
          ) > 0.1
        for: 5m
        labels:
          severity: warning
          component: github_integration
        annotations:
          summary: 'GitHub push failure rate above 10%'
          description: '{{ $value | humanizePercentage }} of GitHub pushes failed in the last 5 minutes'
          runbook: 'https://docs.darkfactory.io/runbooks/github-push-failures'

      - alert: DeploymentFailureRateHigh
        expr: |
          (
            rate(deployment_total{status="failed"}[1h])
            /
            rate(deployment_total[1h])
          ) > 0.05
        for: 10m
        labels:
          severity: critical
          component: deployment
        annotations:
          summary: 'Deployment failure rate above 5% (environment: {{ $labels.environment }})'
          description: '{{ $value | humanizePercentage }} of deployments failed in the last hour'
          action: 'Alert operations team and tech lead immediately'

      - alert: GitHubRateLimitApproaching
        expr: github_rate_limit_hits > 0
        for: 5m
        labels:
          severity: warning
          component: github_api
        annotations:
          summary: 'GitHub rate limit hit (installation: {{ $labels.installation_id }})'
          description: 'GitHub API rate limit was hit. System will throttle automatically.'
          action: 'Monitor task queue depth. Reduce concurrent GitHub operations if needed.'

      - alert: DeploymentStuck
        expr: deployment_in_progress > 0
        for: 30m
        labels:
          severity: critical
          component: deployment
        annotations:
          summary: 'Deployment stuck in progress (environment: {{ $labels.environment }})'
          description: 'Deployment has been in progress for > 30 minutes without status change'
          action: 'Check CI/CD pipeline logs. May need manual intervention or rollback.'

      - alert: GitHubAPIHighLatency
        expr: histogram_quantile(0.95, rate(github_api_call_duration_seconds_bucket[5m])) > 3
        for: 5m
        labels:
          severity: warning
          component: github_api
        annotations:
          summary: 'GitHub API p95 latency above 3 seconds'
          description: '95th percentile GitHub API latency: {{ $value }}s'
          action: 'Check GitHub status page. Verify network connectivity.'

  - name: deployment_sla
    interval: 15s
    rules:
      - alert: DeploymentSuccessRateBelowSLO
        expr: deployment_success_rate{time_window="24h"} < 95
        for: 10m
        labels:
          severity: warning
          component: deployment
        annotations:
          summary: 'Deployment success rate below SLO (environment: {{ $labels.environment }})'
          description: '24h success rate: {{ $value }}% (SLO: 95%)'
          action: 'Review failed deployments. Identify recurring failure patterns.'
```

**Alert Manager Configuration:** Operations team will configure routing and receivers per [Observability Runbook](https://docs.darkfactory.io/runbooks/prometheus-alerting).

> [!NOTE]
> **E5: Testing Alert Rules Before Production**
>
> Validate alert syntax and test evaluation:
>
> ```bash
> # Validate syntax
> promtool check rules docs/prometheus-alerts/github-integration-alerts.yml
>
> # Test alert evaluation with sample metrics
> promtool test rules docs/prometheus-alerts/test-cases.yml
> ```
>
> Create `test-cases.yml` with sample metric values to verify alert thresholds trigger correctly.

### Error Type Classification

**Purpose:** Consistent `error_type` label values across GitHub operations (AC#1).

**Utility Function:**

````typescript
// src/github/utils/classify-github-error.util.ts

export function classifyGitHubError(error: any): string {
  // HTTP status codes
  if (error.status === 401 || error.status === 403) return 'authentication';
  if (error.status === 429) return 'rate_limit';
  if (error.status === 400 || error.status === 422) return 'validation';
  if (error.status === 409) return 'conflict';

  // E3: GitHub-specific error codes from Octokit
  if (error.message?.includes('abuse')) return 'abuse_limit';
  if (error.message?.includes('blocked')) return 'blocked';
  if (error.message?.includes('invalid_request')) return 'invalid_request';

  // Network errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' ||
      error.code === 'ENOTFOUND') return 'network';

  return 'unknown';
      status: 'failed',
      repository: 'test/repo',
    });
  });
});

### Metric Label Cardinality Warning

> [!CAUTION]
> **E7: Prometheus Performance - Label Cardinality Limits**
>
> High-cardinality labels degrade Prometheus query performance. Guidelines:
>
> **Safe Labels** (low cardinality):
> - `status`: 2-3 values (success/failed)
> - `environment`: 3-4 values (dev/staging/prod)
> - `error_type`: 7 defined values
> - `file_count_bucket`: 6 values
> - `cicd_provider`: 2-3 values
>
> **Medium Cardinality** (monitor if exceeds limits):
> - `repository`: Expected ≤ 100 repos (OK)
> - `installation_id`: Expected ≤ 50 installations (OK)
>
> **Avoid** (unbounded cardinality):
> - ❌ `ticket_id`, `execution_id`, `commit_sha` - use as log fields, NOT metric labels
> - ❌ Dynamic user-generated values
>
> **Action if Repository Count > 100:** Aggregate by `project_id` instead of individual `repository` names.

### Testing Strategy

**Unit Test Coverage (>80% - NFR-M1):**

**New Utilities:**
- [ ] `file-count-bucket.util.spec.ts`: Test all bucket boundaries (0, 1, 5, 6, 20, 21, 50, 51, 100, 101, 1000)
- [ ] `classify-github-error.util.spec.ts`: Test all error types (HTTP codes, network errors, GitHub-specific codes)
- [ ] `deployment-success-rate-calculator.service.spec.ts`: Test 0%, 50%, 100% success rates, empty dataset, time windows, query limit warning

**Business Collector:**
- [ ] `business.collector.spec.ts`: Verify all GITHUB_METRICS registered with correct labels and buckets

**E8: Service Integration Tests** (modify existing test files):
- [ ] `src/github/services/github-branch.service.spec.ts` - Assert `github_branch_total` incremented on success/failure
- [ ] `src/github/services/github-commit-orchestrator.service.spec.ts` - Assert `github_push_total`, `github_commit_total`, `github_push_duration_seconds` recorded
- [ ] `src/github/services/github-pr-orchestrator.service.spec.ts` - Assert `github_pr_created_total`, `github_pr_creation_duration_seconds` recorded
- [ ] `src/github/services/deployment-orchestrator.service.spec.ts` - Assert `deployment_total`, `deployment_duration_seconds`, `deployment_in_progress` gauge, success rate calculator called
- [ ] `src/github/services/deployment-status-sync.service.spec.ts` - Assert `deployment_total` incremented on sync

**Manual Verification:**
```bash
# Start application
npm run start:dev

# Trigger GitHub operations (branch, commit, PR, deployment)
# ...

# Verify metrics exposed
curl http://localhost:3000/metrics | grep github_
curl http://localhost:3000/metrics | grep deployment_
````

**No New E2E Tests:** Metrics auto-exposed at `/metrics` endpoint (Story 1.8). Manual verification sufficient.

### 🚫 Critical Anti-Patterns

- ❌ **DO NOT** create new MetricsService (reuse Story 1.8)
- ❌ **DO NOT** use inconsistent label names (follow AC#1-3 specs exactly)
- ❌ **DO NOT** instrument with breaking changes (metrics = additive only)

### Architecture Compliance

| Requirement                    | Status           | Reference                   |
| ------------------------------ | ---------------- | --------------------------- |
| Reuse Story 1.8 MetricsService | ✅ Required      | AC#6 line 190               |
| 15s Prometheus scrape interval | ✅ Configured    | architecture.md:869, NFR-O5 |
| Alert on critical failures     | ✅ Implemented   | AC#4 lines 138-151, NFR-O6  |
| Support GO/NO-GO decisions     | ✅ Enabled       | AC#5 lines 169-174, NFR-O5  |
| No breaking changes            | ✅ Additive only | AC#6 line 191               |

### File Structure

**Files (16 total):**

**NEW (8):**

- `src/github/services/deployment-success-rate-calculator.service.ts` + `.spec.ts`
- `src/github/utils/file-count-bucket.util.ts` + `.spec.ts`
- `src/github/utils/classify-github-error.util.ts` + `.spec.ts`
- `docs/prometheus-alerts/github-integration-alerts.yml`
- `docs/prometheus-alerts/test-cases.yml` (E5: alert testing)

**MODIFIED (8):**

- `src/common/metrics/collectors/business.collector.ts` (add GITHUB_METRICS providers)
- `src/common/metrics/app-metrics.module.ts` (register GITHUB_METRICS)
- `src/github/services/github-branch.service.ts` + `.spec.ts` (add metrics calls + tests)
- `src/github/services/github-commit-orchestrator.service.ts` + `.spec.ts`
- `src/github/services/github-pr-orchestrator.service.ts` + `.spec.ts`
- `src/github/services/deployment-orchestrator.service.ts` + `.spec.ts` (add success rate calculator)
- `src/github/services/deployment-status-sync.service.ts` (covered in Story 4.6)
- `src/github/github.module.ts` (add DeploymentSuccessRateCalculator provider)

**Database:** No schema changes (reuses `deployments` table)

### References

- [Source: docs/epics.md#Story-4.8] - Story requirements and acceptance criteria
- [Source: docs/architecture.md#Observability] - Prometheus metrics architecture (architecture.md:542-564)
- [Source: docs/sprint-artifacts/4-6-deployment-status-synchronization.md] - Previous story pattern, MetricsService usage
- [Source: Story 1.8] - MetricsService facade, BusinessCollector pattern

## Dev Agent Record

### Agent Model Used

_To be populated during implementation_

### File List

**Files created/modified in this story:**
_To be populated during implementation_

### Completion Notes List

_To be populated during implementation_

### Debug Log References

_To be populated during implementation_

## Change Log

| Date       | Author | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-12-07 | SM     | Story created from epics.md Epic 4 Story 4.8                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2025-12-07 | SM     | Marked ready-for-dev with comprehensive context: MetricsService integration (Story 1.8), GitHub services instrumentation (4.1-4.7), Prometheus alerting rules, deployment success rate calculator, file count bucket util, error classification util. Added detailed wiring instructions for all 5 GitHub orchestrator integrations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2025-12-07 | SM     | Applied validation improvements: **C1** - Added MetricsService generic methods requirement + implementation guide; **E1** - Histogram bucket verification note; **E2** - Empty commit handling in file count bucket; **E3** - GitHub-specific error codes (abuse_limit, blocked, invalid_request); **E4** - Query LIMIT for success rate calculator; **E5** - Prometheus alert testing guidance (promtool); **E6** - Socket.IO deferral note (Epic 10); **E7** - Cardinality warning for labels; **E8** - Exact test file modification list; **L1-L6** - Token optimization: consolidated code examples into pattern table, removed Alert Manager config (out-of-scope), optimized architecture compliance/file structure/testing/anti-patterns sections. Reduced 943→884 lines (6%). Story now 99% implementation-ready. |
