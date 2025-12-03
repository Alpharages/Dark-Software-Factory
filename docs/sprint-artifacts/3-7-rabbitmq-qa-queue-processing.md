# Story 3.7: RabbitMQ QA Queue Processing

**Epic:** 3 - Automated QA & Quality Gates  
**Status:** ready-for-dev  
**Priority:** P1 - HIGH  
**Effort:** 8 story points  
**ClickUp ID:** `86evnjwba`  
**ClickUp URL:** https://app.clickup.com/t/86evnjwba

---

## Story

As the system,
I want QA checks to run asynchronously after AI code generation,
So that developers can work uninterrupted while quality is validated.

---

## Acceptance Criteria

**Given** AI execution completes successfully  
**When** code is ready for QA  
**Then** a message is published to `qa-check-queue` with:
- `execution_id`, `ticket_id`, `code_files`, `correlation_id`, `project_id`, `ai_provider`

**And** QA worker consumes messages:
- Creates QA result record via `qaResultsService.create()`
- Runs all QA checks in **parallel** with per-check timeouts
- Stores partial results incrementally via `savePartialResult()`
- Evaluates gate via `qualityGatesService.evaluate()`
- Publishes result to `orchestrator-events` exchange

**And** metrics exposed via Prometheus:
- `dsf_queue_depth{queue="qa-check"}` (uses existing `QUEUE_METRICS.DEPTH`)
- `dsf_queue_processing_rate{queue="qa-check"}` (uses `QUEUE_METRICS.PROCESSING_RATE`)
- `dsf_qa_check_duration_seconds{check_type}` (uses `QA_METRICS.CHECK_DURATION`)
- `dsf_queue_consumer_count{queue="qa-check"}` (uses `QUEUE_METRICS.CONSUMER_COUNT`)

**And** failed QA messages:
- Retry with exponential backoff (1s, 2s, 4s)
- Move to dead letter queue after 3 failures
- Capture to Sentry with `ErrorCategory.QA_AUTOMATION`

---

## Quick Implementation Summary

**16 Key Files:**

| # | File | Action | Purpose |
|---|------|--------|---------|
| 1 | `src/qa-automation/interfaces/qa-check-message.interface.ts` | CREATE | Message types |
| 2 | `src/qa-automation/interfaces/index.ts` | MODIFY | Export |
| 3 | `src/qa-automation/dto/qa-check-message.dto.ts` | CREATE | DTO validation |
| 4 | `src/qa-automation/dto/index.ts` | MODIFY | Export |
| 5 | `src/qa-automation/qa-check.publisher.ts` | CREATE | Publish QA requests |
| 6 | `src/qa-automation/qa-check.consumer.ts` | CREATE | **CORE** consumer |
| 7 | `src/qa-automation/qa-orchestrator.service.ts` | CREATE | Parallel execution |
| 8 | `src/qa-automation/qa-automation.module.ts` | MODIFY | Wire providers |
| 9 | `src/execution/execution.service.ts` | MODIFY | Publish to QA queue |
| 10 | `src/config/configuration.ts` | MODIFY | Add QA config |
| 11 | `src/qa-automation/qa-check.publisher.spec.ts` | CREATE | Unit tests |
| 12 | `src/qa-automation/qa-check.consumer.spec.ts` | CREATE | Unit tests |
| 13 | `src/qa-automation/qa-orchestrator.service.spec.ts` | CREATE | Unit tests |
| 14 | `test/qa-queue.e2e-spec.ts` | CREATE | E2E tests |
| 15 | `.env.example` | MODIFY | Document env vars |
| 16 | `src/common/sentry/sentry.constants.ts` | VERIFY | `ErrorCategory.QA_AUTOMATION` exists |

**Environment Variables:**
```env
QA_CHECK_CONCURRENCY=5
QA_CHECK_MAX_RETRIES=3
QA_CHECK_TIMEOUT_MS=300000
QA_QUEUE_DEPTH_INTERVAL_MS=30000
```

---

## ⚠️ Anti-Patterns to Avoid

| ❌ DO NOT | ✅ DO INSTEAD |
|-----------|---------------|
| Use `AppLogger` | Use `LoggerService` from `src/common/logger/logger.service.ts` |
| Call `logger.setContext()` | Pass context as 2nd arg: `logger.log(msg, 'ClassName')` |
| Use `@SentryCapture()` decorator | Inject `SentryService` and call `captureException()` in catch blocks |
| Run checks without timeout | Wrap each check with `Promise.race()` using `QA_CHECK_TIMEOUT_MS` |
| Create new QA_METRICS keys | Use existing `QUEUE_METRICS` with `{queue: 'qa-check'}` label |
| Assume QA result exists | Call `qaResultsService.create()` before parallel checks |
| Skip graceful shutdown | Implement `OnModuleDestroy` to stop consuming cleanly |
| Hard-code monitoring interval | Use `QA_QUEUE_DEPTH_INTERVAL_MS` config |
| Use generic error category | Use `ErrorCategory.QA_AUTOMATION` for Sentry |

---

## Integration Context

### Pipeline Flow

```
Story 2.5-2.8 (AI Execution) completes
    ↓ ExecutionService.completeExecution() publishes to qa-check-queue
Story 3.7 (This Story) - QaCheckConsumer
    ↓ qaResultsService.create(executionId) - initialize record
    ↓ orchestrates parallel checks with timeouts
    ├─→ Story 3.1 (Linting)
    ├─→ Story 3.2 (Testing)  
    ├─→ Story 3.3 (Coverage)
    └─→ Story 3.4 (Security)
    ↓ stores results incrementally
Story 3.6 - qaResultsService.savePartialResult()
    ↓ evaluates gate
Story 3.5 - qualityGatesService.evaluate()
    ↓ publishes result event
Story 4.x (GitHub) or PM Dashboard receives event
```

### Key Integration Points

| From | Interface | To |
|------|-----------|-----|
| AI Execution (2.5-2.8) | publishes to `qa-check-queue` | This story |
| This story | calls `qaResultsService.create()` | Story 3.6 |
| This story | calls `qaResultsService.savePartialResult()` | Story 3.6 |
| This story | calls `qualityGatesService.evaluate()` | Story 3.5 |
| This story | publishes to `orchestrator-events` | Story 4.x, Epic 10 |

### Dependencies

| Story | Status | Required For |
|-------|--------|--------------|
| Story 1.5 (RabbitMQ) | ✅ done | `RabbitMQConsumerBase`, `QUEUE_NAMES.QA_CHECK` |
| Story 1.7 (Winston) | ✅ done | `LoggerService` |
| Story 1.8 (Prometheus) | ✅ done | `QUEUE_METRICS`, `QA_METRICS` |
| Story 1.9 (Sentry) | ✅ done | `SentryService`, `ErrorCategory` |
| Story 3.6 (QA Results) | ready-for-dev | `QaResultsService` |

---

## Tasks

- [ ] **Task 1: Create Interfaces & DTOs**
  - [ ] `IQaCheckMessage`, `IQaCheckResult`, `ICodeFile` interfaces
  - [ ] `QaCheckMessageDto` with class-validator
  - [ ] Export from index files

- [ ] **Task 2: Implement QaCheckPublisher**
  - [ ] Use `RabbitMQPublisherService.publishWithRetry()`
  - [ ] Use `QUEUE_NAMES.QA_CHECK`
  - [ ] Log with `LoggerService`

- [ ] **Task 3: Implement QaCheckConsumer**
  - [ ] Extend `RabbitMQConsumerBase`
  - [ ] Implement `OnModuleInit` and `OnModuleDestroy`
  - [ ] Configure prefetch from `qa.check.concurrency`
  - [ ] Use `QUEUE_METRICS.DEPTH` with `{queue: 'qa-check'}` label

- [ ] **Task 4: Implement QaOrchestratorService**
  - [ ] Inject `LoggerService`, `SentryService`, `QaResultsService`
  - [ ] Call `qaResultsService.create()` before parallel checks
  - [ ] Run checks with `Promise.allSettled()` + timeout wrapper
  - [ ] Store partial results after each check
  - [ ] Call `qualityGatesService.evaluate()` for gate decision
  - [ ] Capture errors with `SentryService.captureException()`

- [ ] **Task 5: Wire to ExecutionService**
  - [ ] Inject `QaCheckPublisher`
  - [ ] After `completeExecution()`, publish to QA queue

- [ ] **Task 6: Configuration**
  - [ ] Add `qa.check.*` config section
  - [ ] Document in `.env.example`

- [ ] **Task 7: Tests**
  - [ ] Unit tests (>80% coverage)
  - [ ] E2E tests for queue flow

---

## Implementation Guide

### Step 1: Message Interface

**File:** `src/qa-automation/interfaces/qa-check-message.interface.ts`

```typescript
/**
 * QA Check Message Interface
 * Story 3.7: RabbitMQ QA Queue Processing
 */

export interface ICodeFile {
  path: string;
  content: string;
  originalContent?: string;
  language?: 'typescript' | 'javascript' | 'python' | 'go' | 'unknown';
}

export interface IQaCheckMessage {
  executionId: string;
  ticketId: string;
  projectId: string;
  codeFiles: ICodeFile[];
  aiProvider: string;
  correlationId: string;
  completedAt: string;
}

export interface IQaCheckResult {
  executionId: string;
  passed: boolean;
  results: {
    linting: { passed: boolean; errors: unknown[]; duration: number };
    testing: { passed: boolean; results: unknown; duration: number };
    coverage: { percentage: number | null; passed: boolean; duration: number };
    security: { passed: boolean; issues: unknown[]; duration: number };
  };
  totalDuration: number;
  correlationId: string;
}

export type QaCheckType = 'linting' | 'testing' | 'coverage' | 'security';
```

---

### Step 2: QA Check Publisher

**File:** `src/qa-automation/qa-check.publisher.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { LoggerService } from '../common/logger/logger.service';
import { IQaCheckMessage, ICodeFile } from './interfaces';

@Injectable()
export class QaCheckPublisher {
  constructor(
    private readonly publisher: RabbitMQPublisherService,
    private readonly logger: LoggerService,
  ) {}

  async publishQaCheck(
    executionId: string,
    ticketId: string,
    projectId: string,
    codeFiles: ICodeFile[],
    aiProvider: string,
    correlationId: string,
  ): Promise<boolean> {
    const message: IQaCheckMessage = {
      executionId,
      ticketId,
      projectId,
      codeFiles,
      aiProvider,
      correlationId,
      completedAt: new Date().toISOString(),
    };

    this.logger.log(
      `Publishing QA check for execution ${executionId}`,
      { correlationId, ticketId, fileCount: codeFiles.length },
    );

    return this.publisher.publishWithRetry(
      QUEUE_NAMES.QA_CHECK,
      message,
      3,
      correlationId,
    );
  }
}
```

---

### Step 3: QA Check Consumer

**File:** `src/qa-automation/qa-check.consumer.ts`

```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Gauge, Counter } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import * as amqp from 'amqplib';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RabbitMQConsumerBase } from '../rabbitmq/rabbitmq-consumer.base';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { LoggerService } from '../common/logger/logger.service';
import { SentryService } from '../common/sentry/sentry.service';
import { ErrorCategory } from '../common/sentry/sentry.constants';
import { QUEUE_METRICS } from '../common/metrics/metrics.constants';
import { QaOrchestratorService } from './qa-orchestrator.service';
import { IQaCheckMessage } from './interfaces';

@Injectable()
export class QaCheckConsumer extends RabbitMQConsumerBase implements OnModuleInit, OnModuleDestroy {
  protected readonly logger: LoggerService;
  private readonly concurrency: number;
  private readonly depthCheckInterval: number;
  private depthIntervalId?: NodeJS.Timeout;
  private isShuttingDown = false;

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly configService: ConfigService,
    private readonly qaOrchestratorService: QaOrchestratorService,
    private readonly sentryService: SentryService,
    logger: LoggerService,
    @InjectMetric(QUEUE_METRICS.DEPTH)
    private readonly queueDepthGauge: Gauge<string>,
    @InjectMetric(QUEUE_METRICS.CONSUMER_COUNT)
    private readonly consumerCountGauge: Gauge<string>,
    @InjectMetric(QUEUE_METRICS.PROCESSING_RATE)
    private readonly processingRateCounter: Counter<string>,
  ) {
    super();
    this.logger = logger;
    this.concurrency = this.configService.get<number>('qa.check.concurrency', 5);
    this.depthCheckInterval = this.configService.get<number>('qa.check.depthIntervalMs', 30000);
  }

  async onModuleInit(): Promise<void> {
    await this.startConsuming();
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;
    if (this.depthIntervalId) {
      clearInterval(this.depthIntervalId);
    }
    this.consumerCountGauge.dec({ queue: QUEUE_NAMES.QA_CHECK });
    this.logger.log('QA check consumer shutting down gracefully', 'QaCheckConsumer');
  }

  async startConsuming(): Promise<void> {
    this.logger.log(`Starting QA consumer for ${QUEUE_NAMES.QA_CHECK}`, 'QaCheckConsumer');

    try {
      const channel = this.rabbitMQService.getChannel();

      await channel.assertQueue(QUEUE_NAMES.QA_CHECK, {
        durable: true,
        deadLetterExchange: 'dlx-exchange',
        deadLetterRoutingKey: `dlx-${QUEUE_NAMES.QA_CHECK}`,
      });

      await channel.prefetch(this.concurrency);

      await channel.consume(
        QUEUE_NAMES.QA_CHECK,
        (message: amqp.ConsumeMessage | null) => {
          if (message && !this.isShuttingDown) {
            this.handleMessage(message, channel);
          }
        },
        { noAck: false },
      );

      this.consumerCountGauge.inc({ queue: QUEUE_NAMES.QA_CHECK });
      this.startQueueDepthMonitoring(channel);

      this.logger.log(`QA consumer started (concurrency=${this.concurrency})`, 'QaCheckConsumer');
    } catch (error) {
      this.sentryService.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { queue: QUEUE_NAMES.QA_CHECK },
      });
      throw error;
    }
  }

  protected async processMessage(payload: unknown, correlationId: string): Promise<void> {
    const message = payload as IQaCheckMessage;
    const startTime = Date.now();

    try {
      this.logger.log(
        `Processing QA check for execution ${message.executionId}`,
        { correlationId, ticketId: message.ticketId, fileCount: message.codeFiles.length },
      );

      const result = await this.qaOrchestratorService.runQaChecks(message, correlationId);

      this.processingRateCounter.inc({
        queue: QUEUE_NAMES.QA_CHECK,
        status: result.passed ? 'success' : 'failed',
      });

      this.logger.log(
        `QA check completed: ${result.passed ? 'PASSED' : 'FAILED'} (${Date.now() - startTime}ms)`,
        { correlationId, executionId: message.executionId },
      );
    } catch (error) {
      this.sentryService.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId: message.executionId, correlationId },
      });
      throw error;
    }
  }

  private startQueueDepthMonitoring(channel: amqp.Channel): void {
    const checkDepth = async () => {
      try {
        const queueInfo = await channel.checkQueue(QUEUE_NAMES.QA_CHECK);
        this.queueDepthGauge.set({ queue: QUEUE_NAMES.QA_CHECK }, queueInfo.messageCount);
      } catch (error) {
        this.logger.warn(`Failed to check queue depth: ${(error as Error).message}`, 'QaCheckConsumer');
      }
    };

    this.depthIntervalId = setInterval(checkDepth, this.depthCheckInterval);
    checkDepth();
  }
}
```

---

### Step 4: QA Orchestrator Service

**File:** `src/qa-automation/qa-orchestrator.service.ts`

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { LoggerService } from '../common/logger/logger.service';
import { SentryService } from '../common/sentry/sentry.service';
import { ErrorCategory } from '../common/sentry/sentry.constants';
import { QA_METRICS } from '../common/metrics/metrics.constants';
import { RabbitMQPublisherService } from '../rabbitmq/rabbitmq-publisher.service';
import { EXCHANGE_NAMES, ROUTING_KEYS } from '../rabbitmq/rabbitmq.config';
import { QaResultsService } from './qa-results.service';
import { IQaCheckMessage, IQaCheckResult, QaCheckType } from './interfaces';

interface CheckResult {
  type: QaCheckType;
  passed: boolean;
  data: unknown;
  error?: string;
  duration: number;
}

@Injectable()
export class QaOrchestratorService {
  private readonly checkTimeout: number;

  constructor(
    private readonly logger: LoggerService,
    private readonly sentryService: SentryService,
    private readonly configService: ConfigService,
    private readonly qaResultsService: QaResultsService,
    private readonly publisher: RabbitMQPublisherService,
    @InjectMetric(QA_METRICS.CHECK_DURATION)
    private readonly checkDurationHistogram: Histogram<string>,
  ) {
    this.checkTimeout = this.configService.get<number>('qa.check.timeoutMs', 300000);
  }

  async runQaChecks(message: IQaCheckMessage, correlationId: string): Promise<IQaCheckResult> {
    const startTime = Date.now();

    this.logger.log(
      `Starting parallel QA checks for execution ${message.executionId}`,
      { correlationId, fileCount: message.codeFiles.length },
    );

    // Initialize QA result record BEFORE running checks
    await this.qaResultsService.create({ executionId: message.executionId });

    // Run all checks in parallel with timeout wrapper
    const checkResults = await Promise.allSettled([
      this.withTimeout(this.runLinting(message, correlationId), 'linting'),
      this.withTimeout(this.runTesting(message, correlationId), 'testing'),
      this.withTimeout(this.runCoverage(message, correlationId), 'coverage'),
      this.withTimeout(this.runSecurity(message, correlationId), 'security'),
    ]);

    const results = {
      linting: this.extractResult(checkResults[0], 'linting'),
      testing: this.extractResult(checkResults[1], 'testing'),
      coverage: this.extractResult(checkResults[2], 'coverage'),
      security: this.extractResult(checkResults[3], 'security'),
    };

    // Evaluate gate (placeholder until Story 3.5)
    const overallPassed = Object.values(results).every(r => r.passed);

    await this.qaResultsService.updateOverallStatus(message.executionId, overallPassed);

    const totalDuration = Date.now() - startTime;

    const result: IQaCheckResult = {
      executionId: message.executionId,
      passed: overallPassed,
      results: {
        linting: { passed: results.linting.passed, errors: results.linting.data as unknown[], duration: results.linting.duration },
        testing: { passed: results.testing.passed, results: results.testing.data, duration: results.testing.duration },
        coverage: { percentage: results.coverage.passed ? (results.coverage.data as number) : null, passed: results.coverage.passed, duration: results.coverage.duration },
        security: { passed: results.security.passed, issues: results.security.data as unknown[], duration: results.security.duration },
      },
      totalDuration,
      correlationId,
    };

    await this.publishResultEvent(result, correlationId);

    this.logger.log(
      `QA checks completed: ${overallPassed ? 'PASSED' : 'FAILED'} (${totalDuration}ms)`,
      { correlationId, results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.passed])) },
    );

    return result;
  }

  private async withTimeout<T>(promise: Promise<T>, checkType: QaCheckType): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${checkType} check timed out after ${this.checkTimeout}ms`)), this.checkTimeout)
    );
    return Promise.race([promise, timeoutPromise]);
  }

  private async runLinting(message: IQaCheckMessage, correlationId: string): Promise<CheckResult> {
    const startTime = Date.now();
    const endTimer = this.checkDurationHistogram.startTimer({ check_type: 'linting' });

    try {
      // TODO: Replace with actual LinterService call (Story 3.1)
      const result = { passed: true, errors: [] };

      await this.qaResultsService.savePartialResult(message.executionId, {
        linting_passed: result.passed,
        linting_errors: result.errors,
      });

      endTimer();
      return { type: 'linting', passed: result.passed, data: result.errors, duration: Date.now() - startTime };
    } catch (error) {
      endTimer();
      this.sentryService.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId: message.executionId, checkType: 'linting' },
      });

      await this.qaResultsService.savePartialResult(message.executionId, {
        linting_passed: false,
        linting_errors: { error: (error as Error).message },
      });

      return { type: 'linting', passed: false, data: [], error: (error as Error).message, duration: Date.now() - startTime };
    }
  }

  private async runTesting(message: IQaCheckMessage, correlationId: string): Promise<CheckResult> {
    const startTime = Date.now();
    const endTimer = this.checkDurationHistogram.startTimer({ check_type: 'testing' });

    try {
      // TODO: Replace with actual TestRunnerService call (Story 3.2)
      const result = { passed: true, results: { total: 0, passed: 0, failed: 0 } };

      await this.qaResultsService.savePartialResult(message.executionId, {
        tests_passed: result.passed,
        test_results: result.results,
      });

      endTimer();
      return { type: 'testing', passed: result.passed, data: result.results, duration: Date.now() - startTime };
    } catch (error) {
      endTimer();
      this.sentryService.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId: message.executionId, checkType: 'testing' },
      });

      await this.qaResultsService.savePartialResult(message.executionId, {
        tests_passed: false,
        test_results: { error: (error as Error).message },
      });

      return { type: 'testing', passed: false, data: null, error: (error as Error).message, duration: Date.now() - startTime };
    }
  }

  private async runCoverage(message: IQaCheckMessage, correlationId: string): Promise<CheckResult> {
    const startTime = Date.now();
    const endTimer = this.checkDurationHistogram.startTimer({ check_type: 'coverage' });

    try {
      // TODO: Replace with actual CoverageService call (Story 3.3)
      const coverage = 80.0;
      const passed = coverage >= 70.0;

      await this.qaResultsService.savePartialResult(message.executionId, { test_coverage: coverage });

      endTimer();
      return { type: 'coverage', passed, data: coverage, duration: Date.now() - startTime };
    } catch (error) {
      endTimer();
      this.sentryService.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId: message.executionId, checkType: 'coverage' },
      });

      await this.qaResultsService.savePartialResult(message.executionId, { test_coverage: null });

      return { type: 'coverage', passed: false, data: null, error: (error as Error).message, duration: Date.now() - startTime };
    }
  }

  private async runSecurity(message: IQaCheckMessage, correlationId: string): Promise<CheckResult> {
    const startTime = Date.now();
    const endTimer = this.checkDurationHistogram.startTimer({ check_type: 'security' });

    try {
      // TODO: Replace with actual CodeReviewService call (Story 3.4)
      const result = { passed: true, issues: [] };

      await this.qaResultsService.savePartialResult(message.executionId, {
        code_review_passed: result.passed,
        code_review_issues: result.issues,
      });

      endTimer();
      return { type: 'security', passed: result.passed, data: result.issues, duration: Date.now() - startTime };
    } catch (error) {
      endTimer();
      this.sentryService.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId: message.executionId, checkType: 'security' },
      });

      await this.qaResultsService.savePartialResult(message.executionId, {
        code_review_passed: false,
        code_review_issues: { error: (error as Error).message },
      });

      return { type: 'security', passed: false, data: [], error: (error as Error).message, duration: Date.now() - startTime };
    }
  }

  private extractResult(result: PromiseSettledResult<CheckResult>, type: QaCheckType): CheckResult {
    if (result.status === 'fulfilled') return result.value;
    return { type, passed: false, data: null, error: result.reason?.message || 'Unknown error', duration: 0 };
  }

  private async publishResultEvent(result: IQaCheckResult, correlationId: string): Promise<void> {
    const routingKey = result.passed ? ROUTING_KEYS.QA_CHECK_COMPLETED : ROUTING_KEYS.QA_CHECK_FAILED;

    await this.publisher.publishToExchange(
      EXCHANGE_NAMES.ORCHESTRATOR_EVENTS,
      routingKey,
      result,
      correlationId,
    );
  }
}
```

---

### Step 5: Configuration

**File:** `src/config/configuration.ts` (ADD to existing config)

```typescript
qa: {
  // Story 3.6
  results: {
    defaultPageSize: parseInt(process.env.QA_RESULTS_DEFAULT_PAGE_SIZE || '20', 10),
    maxPageSize: parseInt(process.env.QA_RESULTS_MAX_PAGE_SIZE || '100', 10),
  },
  // Story 3.7
  check: {
    concurrency: parseInt(process.env.QA_CHECK_CONCURRENCY || '5', 10),
    maxRetries: parseInt(process.env.QA_CHECK_MAX_RETRIES || '3', 10),
    timeoutMs: parseInt(process.env.QA_CHECK_TIMEOUT_MS || '300000', 10),
    depthIntervalMs: parseInt(process.env.QA_QUEUE_DEPTH_INTERVAL_MS || '30000', 10),
  },
},
```

**File:** `.env.example` (ADD)

```env
# QA Queue Processing (Story 3.7)
QA_CHECK_CONCURRENCY=5
QA_CHECK_MAX_RETRIES=3
QA_CHECK_TIMEOUT_MS=300000
QA_QUEUE_DEPTH_INTERVAL_MS=30000
```

---

### Step 6: Wire Module

**File:** `src/qa-automation/qa-automation.module.ts` (UPDATE)

```typescript
import { Module } from '@nestjs/common';
import { makeCounterProvider, makeHistogramProvider, makeGaugeProvider } from '@willsoto/nestjs-prometheus';
import { DatabaseModule } from '../database/database.module';
import { ConfigModule } from '../config/config.module';
import { LoggerModule } from '../common/logger/logger.module';
import { SentryModule } from '../common/sentry/sentry.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';
import { QA_METRICS, QUEUE_METRICS } from '../common/metrics/metrics.constants';
import { QaResultsService } from './qa-results.service';
import { QaResultsController } from './qa-results.controller';
import { QaCheckPublisher } from './qa-check.publisher';
import { QaCheckConsumer } from './qa-check.consumer';
import { QaOrchestratorService } from './qa-orchestrator.service';

@Module({
  imports: [DatabaseModule, ConfigModule, LoggerModule, SentryModule, RabbitMQModule],
  controllers: [QaResultsController],
  providers: [
    QaResultsService,
    QaCheckPublisher,
    QaCheckConsumer,
    QaOrchestratorService,
    
    // Story 3.6 metrics
    makeCounterProvider({
      name: QA_METRICS.QA_RESULTS_QUERIES_TOTAL,
      help: 'Total QA results queries',
      labelNames: ['query_type'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.QA_RESULTS_QUERY_DURATION,
      help: 'QA results query duration',
      labelNames: ['query_type'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    }),
    
    // Story 3.7 metrics - use existing QUEUE_METRICS with labels
    makeGaugeProvider({
      name: QUEUE_METRICS.DEPTH,
      help: 'Queue depth',
      labelNames: ['queue'],
    }),
    makeGaugeProvider({
      name: QUEUE_METRICS.CONSUMER_COUNT,
      help: 'Consumer count',
      labelNames: ['queue'],
    }),
    makeCounterProvider({
      name: QUEUE_METRICS.PROCESSING_RATE,
      help: 'Processing rate',
      labelNames: ['queue', 'status'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.CHECK_DURATION,
      help: 'QA check duration by type',
      labelNames: ['check_type'],
      buckets: [1, 5, 10, 30, 60, 120, 300],
    }),
  ],
  exports: [QaResultsService, QaCheckPublisher],
})
export class QaAutomationModule {}
```

---

## Testing Requirements

### Unit Tests (>80% Coverage)

```typescript
describe('QaCheckConsumer', () => {
  it('should implement OnModuleInit and OnModuleDestroy');
  it('should set prefetch from config');
  it('should use QUEUE_METRICS.DEPTH with queue label');
  it('should stop gracefully on shutdown');
  it('should capture errors to Sentry with ErrorCategory.QA_AUTOMATION');
});

describe('QaOrchestratorService', () => {
  it('should call qaResultsService.create() before parallel checks');
  it('should timeout individual checks using Promise.race');
  it('should continue if one check fails');
  it('should capture errors to Sentry');
  it('should use QA_METRICS.CHECK_DURATION histogram');
});
```

---

## Prerequisites

| Story | Status | Required For |
|-------|--------|--------------|
| Story 1.5 (RabbitMQ) | ✅ done | `RabbitMQConsumerBase` |
| Story 1.7 (Winston) | ✅ done | `LoggerService` |
| Story 1.8 (Prometheus) | ✅ done | `QUEUE_METRICS`, `QA_METRICS` |
| Story 1.9 (Sentry) | ✅ done | `SentryService`, `ErrorCategory.QA_AUTOMATION` |
| Story 3.6 (QA Results) | ready-for-dev | `QaResultsService.create()`, `savePartialResult()` |

---

## References

| Source | Section |
|--------|---------|
| `src/common/logger/logger.service.ts` | `LoggerService` implementation |
| `src/common/sentry/sentry.service.ts` | `SentryService.captureException()` |
| `src/common/sentry/sentry.constants.ts` | `ErrorCategory.QA_AUTOMATION` |
| `src/common/metrics/metrics.constants.ts` | `QUEUE_METRICS`, `QA_METRICS` |
| `src/rabbitmq/rabbitmq-consumer.base.ts` | Consumer base class |
| `src/ai-routing/ai-routing.consumer.ts` | Example consumer pattern |

---

## Dev Agent Record

### Critical Implementation Notes

1. **Use `LoggerService`** not `AppLogger` - pass context as 2nd argument
2. **Use `SentryService.captureException()`** not `@SentryCapture()` decorator
3. **Use `ErrorCategory.QA_AUTOMATION`** from `sentry.constants.ts`
4. **Use existing `QUEUE_METRICS`** with `{queue: 'qa-check'}` label
5. **Call `qaResultsService.create()`** before running parallel checks
6. **Implement `OnModuleDestroy`** for graceful shutdown
7. **Use `Promise.race()`** for per-check timeouts

### Change Log

| Date | Change | Author |
|------|--------|--------|
| 2025-12-03 | Story drafted | Scrum Master Bob |
| 2025-12-03 | Quality review: Fixed 5 critical issues, added 4 enhancements, 3 optimizations | Quality Validator |

### File List

<!-- Populated during implementation -->
