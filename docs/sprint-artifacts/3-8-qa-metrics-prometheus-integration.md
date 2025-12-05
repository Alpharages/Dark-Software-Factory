# Story 3.8: QA Metrics & Prometheus Integration

**Epic:** 3 - Automated QA & Quality Gates  
**Status:** Ready for Review  
**Priority:** P2 - MEDIUM  
**Effort:** 3 story points  
**ClickUp ID:** `86evnjwbe`  
**ClickUp URL:** https://app.clickup.com/t/86evnjwbe

---

## Story

As an operator,
I want QA metrics exposed to Prometheus,
So that I can monitor quality trends and system health.

---

## Acceptance Criteria

**Given** QA checks are running  
**When** metrics are collected  
**Then** Prometheus metrics include:

- `dsf_qa_checks_total{status, check_type, project_id, provider}`
- `dsf_qa_check_duration_seconds{check_type, project_id, provider}`
- `dsf_qa_test_coverage_percent{project_id}`
- `dsf_qa_security_vulnerabilities_total{severity, project_id}`
- `dsf_queue_depth{queue="qa-check"}`

**And** Grafana queries can visualize:

- QA pass rate: `sum(rate(dsf_qa_checks_total{status="passed"}[5m])) / sum(rate(dsf_qa_checks_total[5m])) * 100`
- Check duration P95: `histogram_quantile(0.95, sum(rate(dsf_qa_check_duration_seconds_bucket[5m])) by (le, check_type))`
- Vulnerabilities: `sum by (severity) (dsf_qa_security_vulnerabilities_total)`
- Coverage: `dsf_qa_test_coverage_percent`

---

## Quick Implementation Summary

**6 Key Files:**

| #   | File                                                  | Action | Purpose                                                                 |
| --- | ----------------------------------------------------- | ------ | ----------------------------------------------------------------------- |
| 1   | `src/common/metrics/metrics.module.ts`                | MODIFY | Add `provider` label to QA metrics, add `project_id` to vulnerabilities |
| 2   | `src/common/metrics/metrics.interface.ts`             | MODIFY | Extend `QACheckMetricData` with `aiProvider`                            |
| 3   | `src/common/metrics/collectors/business.collector.ts` | MODIFY | Update `recordQACheck()` to use provider label                          |
| 4   | `src/qa-automation/qa-metrics.service.ts`             | CREATE | High-level QA metrics facade                                            |
| 5   | `src/qa-automation/qa-automation.module.ts`           | MODIFY | Import AppMetricsModule, add QaMetricsService                           |
| 6   | `src/qa-automation/qa-metrics.service.spec.ts`        | CREATE | Unit tests                                                              |

**🚨 CRITICAL:** This story EXTENDS Story 1.8 infrastructure. Do NOT create a new collector or parallel metrics system.

---

## ⚠️ Anti-Patterns to Avoid

| ❌ DO NOT                                          | ✅ DO INSTEAD                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| Create new `QaCollector` class                     | Use existing `BusinessCollector` (already has QA metrics)             |
| Inject individual `@InjectMetric()` in QA services | Inject `MetricsService` or `QaMetricsService` facade                  |
| Reference `MetricsModule`                          | Use `AppMetricsModule` (actual class name)                            |
| Call `.inc()` on `QUEUE_METRICS.PROCESSING_RATE`   | Use `QueueCollector.updateQueueMetrics()` (it's a Gauge, not Counter) |
| Register duplicate metric providers                | Update existing providers in `AppMetricsModule`                       |
| Add labels not in registration                     | First update `labelNames` array in provider registration              |

---

## Existing Infrastructure (Story 1.8)

### Already Implemented - USE THESE:

**BusinessCollector** (`src/common/metrics/collectors/business.collector.ts`):

- `recordQACheck(data)` - Records check count + duration
- `incrementVulnerabilities(severity, count)` - Records security issues

**MetricsService** (`src/common/metrics/metrics.service.ts`):

- `recordQACheck(data)` - Facade for BusinessCollector
- `incrementVulnerabilities(severity, count)` - Facade for BusinessCollector

**QueueCollector** (`src/common/metrics/collectors/queue.collector.ts`):

- `updateQueueMetrics(data)` - Sets queue depth, processing rate, consumer count

---

## Tasks

- [x] **Task 1: Update Metric Registrations** (CRITICAL - do this first)
  - [x] Add `LABELS.PROVIDER` to `QA_METRICS.CHECKS_TOTAL` labelNames
  - [x] Add `LABELS.PROVIDER` to `QA_METRICS.CHECK_DURATION` labelNames
  - [x] Add `LABELS.PROJECT` to `QA_METRICS.VULNERABILITIES` labelNames

- [x] **Task 2: Extend Interface**
  - [x] Add `aiProvider?: string` to `QACheckMetricData`

- [x] **Task 3: Update BusinessCollector**
  - [x] Update `recordQACheck()` to include provider in labels
  - [x] Update `incrementVulnerabilities()` to accept projectId parameter

- [x] **Task 4: Create QaMetricsService**
  - [x] Inject `MetricsService` (NOT individual metrics)
  - [x] Implement convenience methods for QA module

- [x] **Task 5: Wire Module**
  - [x] Import `AppMetricsModule` in `QaAutomationModule`
  - [x] Add `QaMetricsService` to providers and exports

- [x] **Task 6: Tests**
  - [x] Unit tests for QaMetricsService (18/18 passing, >80% coverage)

---

## Implementation Guide

### Step 1: Update Metric Registrations

**File:** `src/common/metrics/metrics.module.ts`

Find and update these provider registrations:

```typescript
// BEFORE (line ~141-145):
makeCounterProvider({
  name: QA_METRICS.CHECKS_TOTAL,
  help: 'Total number of QA checks performed',
  labelNames: [LABELS.CHECK_TYPE, LABELS.STATUS, LABELS.PROJECT],
}),

// AFTER:
makeCounterProvider({
  name: QA_METRICS.CHECKS_TOTAL,
  help: 'Total number of QA checks performed',
  labelNames: [LABELS.CHECK_TYPE, LABELS.STATUS, LABELS.PROJECT, LABELS.PROVIDER],
}),
```

```typescript
// BEFORE (line ~146-151):
makeHistogramProvider({
  name: QA_METRICS.CHECK_DURATION,
  help: 'Duration of QA checks in seconds',
  labelNames: [LABELS.CHECK_TYPE, LABELS.STATUS, LABELS.PROJECT],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
}),

// AFTER:
makeHistogramProvider({
  name: QA_METRICS.CHECK_DURATION,
  help: 'Duration of QA checks in seconds',
  labelNames: [LABELS.CHECK_TYPE, LABELS.STATUS, LABELS.PROJECT, LABELS.PROVIDER],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120, 300],
}),
```

```typescript
// BEFORE (line ~157-160):
makeCounterProvider({
  name: QA_METRICS.VULNERABILITIES,
  help: 'Total security vulnerabilities detected',
  labelNames: [LABELS.SEVERITY],
}),

// AFTER:
makeCounterProvider({
  name: QA_METRICS.VULNERABILITIES,
  help: 'Total security vulnerabilities detected',
  labelNames: [LABELS.SEVERITY, LABELS.PROJECT],
}),
```

---

### Step 2: Extend Interface

**File:** `src/common/metrics/metrics.interface.ts`

Update `QACheckMetricData` (around line 47-53):

```typescript
// BEFORE:
export interface QACheckMetricData {
  checkType: string;
  status: 'passed' | 'failed';
  duration: number;
  projectId?: string;
  coverage?: number;
}

// AFTER:
export interface QACheckMetricData {
  checkType: string;
  status: 'passed' | 'failed' | 'timeout' | 'error';
  duration: number;
  projectId?: string;
  aiProvider?: string;
  coverage?: number;
}
```

---

### Step 3: Update BusinessCollector

**File:** `src/common/metrics/collectors/business.collector.ts`

Update `recordQACheck` method (around line 129-144):

```typescript
// BEFORE:
recordQACheck(data: QACheckMetricData): void {
  const labels: Record<string, string> = {
    [LABELS.CHECK_TYPE]: data.checkType,
    [LABELS.STATUS]: data.status,
  };
  if (data.projectId) labels[LABELS.PROJECT] = data.projectId;

  this.qaChecksTotal.inc(labels);
  this.qaCheckDuration.observe(labels, data.duration);

  if (data.coverage !== undefined) {
    this.qaCoveragePercent.set({ [LABELS.PROJECT]: data.projectId || 'unknown' }, data.coverage);
  }
}

// AFTER:
recordQACheck(data: QACheckMetricData): void {
  const labels: Record<string, string> = {
    [LABELS.CHECK_TYPE]: data.checkType,
    [LABELS.STATUS]: data.status,
  };
  if (data.projectId) labels[LABELS.PROJECT] = data.projectId;
  if (data.aiProvider) labels[LABELS.PROVIDER] = data.aiProvider;

  this.qaChecksTotal.inc(labels);
  this.qaCheckDuration.observe(labels, data.duration);

  if (data.coverage !== undefined) {
    this.qaCoveragePercent.set({ [LABELS.PROJECT]: data.projectId || 'unknown' }, data.coverage);
  }
}
```

Update `incrementVulnerabilities` method (around line 146-148):

```typescript
// BEFORE:
incrementVulnerabilities(severity: string, count: number = 1): void {
  this.qaVulnerabilities.inc({ [LABELS.SEVERITY]: severity }, count);
}

// AFTER:
incrementVulnerabilities(severity: string, count: number = 1, projectId?: string): void {
  const labels: Record<string, string> = { [LABELS.SEVERITY]: severity };
  if (projectId) labels[LABELS.PROJECT] = projectId;
  this.qaVulnerabilities.inc(labels, count);
}
```

---

### Step 4: Create QaMetricsService

**File:** `src/qa-automation/qa-metrics.service.ts` (CREATE)

```typescript
import { Injectable } from '@nestjs/common';
import { MetricsService } from '../common/metrics/metrics.service';
import { LoggerService } from '../common/logger/logger.service';

/**
 * QA Metrics Service - Convenience wrapper for QA automation module
 * Story 3.8: QA Metrics & Prometheus Integration
 *
 * Wraps MetricsService with QA-specific convenience methods.
 * All metrics flow through existing BusinessCollector.
 */
@Injectable()
export class QaMetricsService {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Record completion of a QA check
   * @param checkType - linting, testing, security, or coverage
   * @param passed - whether check passed
   * @param durationMs - duration in milliseconds
   * @param context - projectId, aiProvider, executionId
   */
  recordCheckComplete(
    checkType: 'linting' | 'testing' | 'security' | 'coverage',
    passed: boolean,
    durationMs: number,
    context: { projectId?: string; aiProvider?: string; executionId?: string } = {},
  ): void {
    this.metricsService.recordQACheck({
      checkType,
      status: passed ? 'passed' : 'failed',
      duration: durationMs / 1000, // Convert ms to seconds
      projectId: context.projectId,
      aiProvider: context.aiProvider,
    });

    this.logger.debug(
      `QA metric: ${checkType} ${passed ? 'passed' : 'failed'} in ${(durationMs / 1000).toFixed(2)}s`,
      'QaMetricsService',
    );
  }

  /**
   * Record check timeout or error
   */
  recordCheckError(
    checkType: 'linting' | 'testing' | 'security' | 'coverage',
    errorType: 'timeout' | 'error',
    durationMs: number,
    context: { projectId?: string; aiProvider?: string } = {},
  ): void {
    this.metricsService.recordQACheck({
      checkType,
      status: errorType,
      duration: durationMs / 1000,
      projectId: context.projectId,
      aiProvider: context.aiProvider,
    });
  }

  /**
   * Set test coverage for a project
   */
  setCoverage(projectId: string, coveragePercent: number): void {
    this.metricsService.recordQACheck({
      checkType: 'coverage',
      status: 'passed',
      duration: 0,
      projectId,
      coverage: coveragePercent,
    });
  }

  /**
   * Record security vulnerabilities
   */
  recordVulnerabilities(
    severity: 'critical' | 'high' | 'medium' | 'low',
    count: number,
    projectId?: string,
  ): void {
    if (count <= 0) return;
    this.metricsService.incrementVulnerabilities(severity, count, projectId);
  }

  /**
   * Record quality gate decision
   */
  recordGateDecision(
    passed: boolean,
    context: { projectId?: string; aiProvider?: string } = {},
  ): void {
    this.metricsService.recordQACheck({
      checkType: 'gate',
      status: passed ? 'passed' : 'failed',
      duration: 0,
      projectId: context.projectId,
      aiProvider: context.aiProvider,
    });
  }
}
```

---

### Step 5: Update MetricsService

**File:** `src/common/metrics/metrics.service.ts`

Update the `incrementVulnerabilities` method signature (around line 70-73):

```typescript
// BEFORE:
incrementVulnerabilities(severity: string, count: number = 1): void {
  this.businessCollector.incrementVulnerabilities(severity, count);
}

// AFTER:
incrementVulnerabilities(severity: string, count: number = 1, projectId?: string): void {
  this.businessCollector.incrementVulnerabilities(severity, count, projectId);
}
```

---

### Step 6: Wire Module

**File:** `src/qa-automation/qa-automation.module.ts` (UPDATE)

```typescript
import { Module } from '@nestjs/common';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { LoggerModule } from '../common/logger/logger.module';
import { QaMetricsService } from './qa-metrics.service';
// ... other imports

@Module({
  imports: [
    AppMetricsModule, // NOT MetricsModule
    LoggerModule,
    // ... other imports
  ],
  providers: [
    QaMetricsService,
    // ... other providers
  ],
  exports: [
    QaMetricsService,
    // ... other exports
  ],
})
export class QaAutomationModule {}
```

---

## Testing Requirements

**File:** `src/qa-automation/qa-metrics.service.spec.ts` (CREATE)

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { QaMetricsService } from './qa-metrics.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { LoggerService } from '../common/logger/logger.service';

describe('QaMetricsService', () => {
  let service: QaMetricsService;
  let mockMetricsService: Partial<MetricsService>;
  let mockLogger: Partial<LoggerService>;

  beforeEach(async () => {
    mockMetricsService = {
      recordQACheck: jest.fn(),
      incrementVulnerabilities: jest.fn(),
    };
    mockLogger = { debug: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QaMetricsService,
        { provide: MetricsService, useValue: mockMetricsService },
        { provide: LoggerService, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<QaMetricsService>(QaMetricsService);
  });

  describe('recordCheckComplete', () => {
    it('should convert ms to seconds and call metricsService', () => {
      service.recordCheckComplete('linting', true, 5500, {
        projectId: 'proj-1',
        aiProvider: 'cursor',
      });

      expect(mockMetricsService.recordQACheck).toHaveBeenCalledWith({
        checkType: 'linting',
        status: 'passed',
        duration: 5.5,
        projectId: 'proj-1',
        aiProvider: 'cursor',
      });
    });

    it('should record failed status', () => {
      service.recordCheckComplete('testing', false, 10000, {});

      expect(mockMetricsService.recordQACheck).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', duration: 10 }),
      );
    });
  });

  describe('recordVulnerabilities', () => {
    it('should skip if count is 0', () => {
      service.recordVulnerabilities('low', 0);
      expect(mockMetricsService.incrementVulnerabilities).not.toHaveBeenCalled();
    });

    it('should call metricsService with severity, count, and projectId', () => {
      service.recordVulnerabilities('critical', 3, 'proj-2');

      expect(mockMetricsService.incrementVulnerabilities).toHaveBeenCalledWith(
        'critical',
        3,
        'proj-2',
      );
    });
  });

  describe('setCoverage', () => {
    it('should record coverage via recordQACheck', () => {
      service.setCoverage('proj-3', 87.5);

      expect(mockMetricsService.recordQACheck).toHaveBeenCalledWith(
        expect.objectContaining({
          checkType: 'coverage',
          projectId: 'proj-3',
          coverage: 87.5,
        }),
      );
    });
  });

  describe('recordGateDecision', () => {
    it('should record gate check type', () => {
      service.recordGateDecision(true, { projectId: 'proj-4' });

      expect(mockMetricsService.recordQACheck).toHaveBeenCalledWith({
        checkType: 'gate',
        status: 'passed',
        duration: 0,
        projectId: 'proj-4',
        aiProvider: undefined,
      });
    });
  });
});
```

---

## Integration with Other Stories

### Story 3.7 (QaOrchestratorService) Integration

After implementing this story, update `QaOrchestratorService` to use `QaMetricsService`:

```typescript
// In QaOrchestratorService constructor:
private readonly qaMetricsService: QaMetricsService,

// After each check completes:
this.qaMetricsService.recordCheckComplete(
  'linting',
  result.passed,
  result.duration,
  { projectId: message.projectId, aiProvider: message.aiProvider },
);

// After gate decision:
this.qaMetricsService.recordGateDecision(overallPassed, {
  projectId: message.projectId,
  aiProvider: message.aiProvider,
});
```

---

## Grafana Dashboard Queries

```promql
# QA Pass Rate (5m window)
sum(rate(dsf_qa_checks_total{status="passed"}[5m])) /
sum(rate(dsf_qa_checks_total[5m])) * 100

# Check Duration P95 by Type
histogram_quantile(0.95,
  sum(rate(dsf_qa_check_duration_seconds_bucket[5m])) by (le, check_type)
)

# Vulnerabilities by Severity
sum by (severity) (dsf_qa_security_vulnerabilities_total)

# Coverage per Project
dsf_qa_test_coverage_percent

# Failed Checks by Type (last hour)
sum by (check_type) (increase(dsf_qa_checks_total{status="failed"}[1h]))

# Check Duration by Provider
avg by (provider) (
  rate(dsf_qa_check_duration_seconds_sum[5m]) /
  rate(dsf_qa_check_duration_seconds_count[5m])
)
```

---

## Prerequisites

| Story                  | Status  | Required For                                              |
| ---------------------- | ------- | --------------------------------------------------------- |
| Story 1.8 (Prometheus) | ✅ done | `AppMetricsModule`, `MetricsService`, `BusinessCollector` |
| Story 1.7 (Winston)    | ✅ done | `LoggerService`                                           |

---

## References

| Source                                                | Section                                            |
| ----------------------------------------------------- | -------------------------------------------------- |
| `src/common/metrics/metrics.module.ts`                | `AppMetricsModule` - update provider registrations |
| `src/common/metrics/metrics.service.ts`               | `MetricsService` - facade pattern                  |
| `src/common/metrics/collectors/business.collector.ts` | `BusinessCollector` - QA metric methods            |
| `src/common/metrics/metrics.constants.ts`             | `QA_METRICS`, `LABELS` constants                   |

---

## Dev Agent Record

### Critical Implementation Notes

1. **Module name is `AppMetricsModule`** not `MetricsModule`
2. **Use `MetricsService` facade** - don't inject individual metrics
3. **BusinessCollector already has QA metrics** - extend, don't duplicate
4. **Update label registrations FIRST** - before using new labels
5. **Convert ms to seconds** before recording duration
6. **QUEUE_METRICS.PROCESSING_RATE is a Gauge** - use `.set()` not `.inc()`

### Implementation Summary

**Completed:** 2025-12-05

**All Acceptance Criteria Met:**

- ✅ AC#1: Prometheus metrics include provider and project_id labels
- ✅ AC#2: Grafana queries supported (P95, pass rate, vulnerabilities, coverage)
- ✅ QaMetricsService facade created for QA module convenience
- ✅ Extended existing BusinessCollector (no duplicate metrics)
- ✅ 18 unit tests passing with >80% coverage

**Technical Implementation:**

- Updated 3 metric registrations in AppMetricsModule (CHECKS_TOTAL, CHECK_DURATION, VULNERABILITIES)
- Extended QACheckMetricData interface with aiProvider field and additional status types
- Updated BusinessCollector.recordQACheck() to include provider label
- Updated BusinessCollector.incrementVulnerabilities() to accept projectId parameter
- Created QaMetricsService with 5 convenience methods (recordCheckComplete, recordCheckError, setCoverage, recordVulnerabilities, recordGateDecision)
- Wired AppMetricsModule into QaAutomationModule

**Testing:**

- 18/18 unit tests passing
- Build: ✅ Successful
- Lint: 0 errors on Story 3.8 files

### Change Log

| Date       | Change                                                                                                                                                      | Author                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 2025-12-03 | Story drafted                                                                                                                                               | Scrum Master Bob            |
| 2025-12-03 | Quality review: Fixed 5 critical issues, 4 enhancements, 3 LLM optimizations                                                                                | Quality Validator           |
| 2025-12-05 | Implementation complete: All 6 tasks done, 18 unit tests passing                                                                                            | Amelia (Dev Agent)          |
| 2025-12-05 | Code review completed: Fixed 3 HIGH, 4 MEDIUM issues (duplicate metrics, QaOrchestratorService integration, error handling, validation, file list accuracy) | Code Reviewer (Adversarial) |

### File List

**New Files (2):**

- `src/qa-automation/qa-metrics.service.ts` - QA metrics facade service with error handling and validation
- `src/qa-automation/qa-metrics.service.spec.ts` - Unit tests (18 tests)

**Modified Files (6):**

- `src/common/metrics/metrics.module.ts` - Added provider labels to QA metrics
- `src/common/metrics/metrics.interface.ts` - Extended QACheckMetricData with aiProvider
- `src/common/metrics/collectors/business.collector.ts` - Updated recordQACheck and incrementVulnerabilities
- `src/common/metrics/metrics.service.ts` - Updated incrementVulnerabilities signature
- `src/qa-automation/qa-automation.module.ts` - Imported AppMetricsModule, added QaMetricsService, removed duplicate QUEUE_METRICS
- `src/qa-automation/qa-orchestrator.service.ts` - Integrated QaMetricsService facade (Story 3.8 requirement)
