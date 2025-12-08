# Story 4.8: GitHub Integration Metrics & Monitoring

**Status:** Done

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

- [x] Register GitHub metrics in `BusinessCollector` (reuse Story 1.8 pattern) (AC#1, #2, #3)
  - [x] Define counter providers for `github_push_total`, `github_pr_created_total`, `github_branch_total`, `github_commit_total`
  - [x] Define histogram providers for `github_push_duration_seconds`, `deployment_duration_seconds`, `cicd_workflow_poll_duration_seconds`
  - [x] Define gauge providers for `deployment_success_rate`, `deployment_in_progress`
- [x] Instrument GitHub services with metrics calls (AC#6)
  - [x] Add metrics to `GitHubBranchService` (Story 4.2)
  - [x] Add metrics to `GitHubCommitOrchestrator` (Story 4.3)
  - [x] Add metrics to `GitHubPROrchestrator` (Story 4.4)
  - [x] Add metrics to `DeploymentOrchestrator` (Story 4.5)
  - [x] Add metrics to `DeploymentStatusSync` (Story 4.6)
- [x] Create `deployment_success_rate` gauge calculator service (AC#2)
  - [x] Calculate rolling success rate (1h, 24h, 7d windows)
  - [x] Update gauge on each deployment completion
- [x] Document Prometheus alerting rules in Dev Notes (AC#4)
- [x] Unit tests (\u003e80% coverage): metric registration, label validation, gauge calculations
- [x] Pre-review checks (lint, test, build)
- [x] Update story file (mark tasks complete, populate file list, add completion notes)

## Dev Agent Record

### Agent Model Used

Antigravity (gemini-2.0-flash-exp)

### File List

**Files created/modified in this story:**

- [src/common/metrics/metrics.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/common/metrics/metrics.service.ts)
- [src/common/metrics/metrics.constants.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/common/metrics/metrics.constants.ts)
- [src/common/metrics/metrics.module.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/common/metrics/metrics.module.ts)
- [src/common/metrics/collectors/business.collector.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/common/metrics/collectors/business.collector.ts)
- [src/common/metrics/collectors/system.collector.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/common/metrics/collectors/system.collector.ts)
- [src/github/services/deployment-orchestrator.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/services/deployment-orchestrator.service.ts)
- [src/github/services/deployment-orchestrator.service.spec.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/services/deployment-orchestrator.service.spec.ts)
- [src/github/services/deployment-success-rate-calculator.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/services/deployment-success-rate-calculator.service.ts)
- [src/github/services/deployment-success-rate-calculator.service.spec.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/services/deployment-success-rate-calculator.service.spec.ts)
- [src/github/utils/file-count-bucket.util.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/utils/file-count-bucket.util.ts)
- [src/github/utils/file-count-bucket.util.spec.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/utils/file-count-bucket.util.spec.ts)
- [src/github/utils/classify-github-error.util.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/utils/classify-github-error.util.ts)
- [src/github/utils/classify-github-error.util.spec.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/utils/classify-github-error.util.spec.ts)
- [src/github/services/github-branch.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/services/github-branch.service.ts)
- [src/github/services/github-commit-orchestrator.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/services/github-commit-orchestrator.service.ts)
- [src/github/services/github-pr-orchestrator.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/services/github-pr-orchestrator.service.ts)
- [src/github/services/deployment-status-sync.service.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/services/deployment-status-sync.service.ts)
- [src/github/github.module.ts](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/github/github.module.ts)
- [docs/prometheus-alerts/github-integration-alerts.yml](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/prometheus-alerts/github-integration-alerts.yml)

### Completion Notes List

1.  **Generic Metrics Implementation:** Implemented a robust generic metrics facade in `MetricsService`.
2.  **Orchestrator Instrumentation:** Successfully instrumented all GitHub orchestrators (`Branch`, `Commit`, `PR`, `Deployment`, `StatusSync`).
3.  **Deployment Success Rate:** Created `DeploymentSuccessRateCalculator` and integrated it.
4.  **Utilities:** Added `classifyGitHubError` and `getFileCountBucket`.
5.  **Testing:** Verified all new components with unit tests.
6.  **Code Review Fixes:** Added missing `cicd_workflow_poll_duration_seconds` metric and registered `DeploymentSuccessRateCalculator` in `GitHubModule`.

### Debug Log References

- See logs for lint fixes in `DeploymentOrchestrator` and `DeploymentStatusSync`.
- See test output for verification of new utilities and services.

## Change Log

| Date       | Author | Change                                                                                                                                                           |
| ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-12-07 | SM     | Story created from epics.md Epic 4 Story 4.8                                                                                                                     |
| 2025-12-07 | SM     | Marked ready-for-dev with comprehensive context: MetricsService integration (Story 1.8), GitHub services instrumentation (4.1-4.7), Prometheus alerting rules... |
| 2025-12-08 | AI     | Completed implementation. Status updated to Done.                                                                                                                |
