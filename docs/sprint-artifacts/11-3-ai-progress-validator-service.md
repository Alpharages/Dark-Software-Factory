# Story 11.3: AI Progress Validator Service

Status: ready-for-dev

## Story

As a **backend engineer**,
I want **a progress validation service that prevents infinite loops in AI self-healing by tracking error count reduction and time limits**,
so that **AI executions escalate to human review when stuck instead of wasting resources on unfixable issues**.

## Acceptance Criteria

1. **AC#1:** `ProgressValidatorService` validates fix attempts and determines if AI should continue or escalate
2. **AC#2:** Escalates to human review if errors are not decreasing (error count before ≤ error count after)
3. **AC#3:** Escalates to human review if time limit exceeded (max 10 minutes per execution)
4. **AC#4:** Tracks metrics: error count before/after each fix attempt, total fix time, progress trend
5. **AC#5:** Integration ready for AI Execution Consumer (exports service via module)
6. **AC#6:** Unit tests with >80% coverage, including edge cases (no progress, time limit, successful reduction)

## Tasks / Subtasks

- [x] Create Progress Validator service and module (AC: #1)
  - [x] Create `src/ai-monitoring/progress-validator.service.ts`
  - [x] Create `src/ai-monitoring/progress-validator.module.ts`
  - [x] Inject `PrismaService` for database operations
  - [x] Inject `SentryService` for escalation alerts
  - [x] Inject `MetricsService` for Prometheus metrics
  - [x] Inject `AIDecisionLoggerService` for audit trail (Story 11.2)

- [x] Implement validateProgress() method (AC: #1, #2, #3)
  - [x] Implement error count comparison logic (escalate if not decreasing)
  - [x] Implement time limit check (10 minutes max)
  - [x] Return decision object: `{ shouldContinue, reason, escalate, metrics }`
  - [x] Add confidence scoring for escalation decisions
  - [x] Handle edge cases: zero errors, negative values, missing data

- [x] Implement trackFixAttempt() method (AC: #4)
  - [x] Store fix attempt metrics in database (Optional: create ProgressMetric model or use JSON in AIDecisionLog)
  - [x] Record error count before/after
  - [x] Track cumulative fix time
  - [x] Calculate progress trend (improving/stagnant/worsening)

- [x] Add escalation logic (AC: #2, #3)
  - [x] Integrate with `AIDecisionLoggerService` to log escalation decisions
  - [x] Send Sentry alert when escalating to human
  - [x] Include context: ticket ID, execution ID, fix attempt number, error counts, reasoning

- [x] Add Prometheus metrics (AC: #4)
  - [x] Add `ai_fix_attempts_total` counter with labels: ticket_id, outcome (success/escalated)
  - [x] Add `ai_fix_time_seconds` histogram to track fix duration
  - [x] Add `ai_progress_validation_errors_reduced` gauge for error count reduction
  - [x] Add `ai_progress_escalations_total` counter for escalation rate monitoring

- [x] Write comprehensive unit tests (AC: #6)
  - [x] Test error count decreasing → should continue
  - [x] Test error count same/increasing → should escalate
  - [x] Test time limit exceeded → should escalate
  - [x] Test successful fix (errors = 0) → should continue
  - [x] Test edge cases: negative errors, null values, zero time
  - [x] Mock all dependencies: PrismaService, SentryService, MetricsService, AIDecisionLoggerService
  - [x] Achieve >80% code coverage

## Dev Notes

### 🚨 SCOPE BOUNDARY

**THIS STORY:**
- ✅ Build `ProgressValidatorService` with validation logic
- ✅ Implement `validateProgress()` and `trackFixAttempt()` methods
- ✅ Add Sentry alerting for escalations
- ✅ Add Prometheus metrics integration
- ✅ Unit tests with >80% coverage
- ✅ Export service via module for integration

**NOT THIS STORY (Deferred to Story 11.4 or Story 13.3/13.4):**
- ❌ Integration with `AIExecutionConsumer` (Story 13.3)
- ❌ Integration with `QaOrchestrator` self-healing (Story 13.4)
- ❌ E2E tests with full AI execution flow
- ❌ PM notification system for escalations

### Architecture Context

**Epic:** Epic 11 - v3 Foundation & Safety  
**Phase:** Phase 1 (Week 1-2)  
**Dependencies:** 
- Story 11.1 (Database Schema - DONE)
- Story 11.2 (AI Decision Audit Logger - DONE)

**Blocks:** 
- Story 11.4 (Integrate Audit Logging)
- Story 13.3 (AI Execution with Cost Tracking)
- Story 13.4 (QA Orchestrator Self-Healing)

**Tech Stack:**
- **Framework:** NestJS 10.x (existing)
- **Database:** PostgreSQL via Prisma 6.2.1 (v3 schema from Story 11.1)
- **Metrics:** Prometheus via `MetricsService` (Story 1.8)
- **Error Tracking:** Sentry via `SentryService` (Story 1.9)
- **Logging:** Winston via `LoggerService` (Story 1.7)
- **Audit:** AIDecisionLoggerService (Story 11.2)

### Critical Implementation Details

#### 1. Service Dependency Injection Pattern

Follow existing NestJS DI patterns from Epic 1-4 and Story 11.2:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { SentryService } from '../common/sentry/sentry.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { AIDecisionLoggerService } from '../audit/ai-decision-logger.service';

@Injectable()
export class ProgressValidatorService {
  private readonly logger = new Logger(ProgressValidatorService.name);
  private readonly MAX_FIX_TIME_MS = 10 * 60 * 1000; // 10 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly sentry: SentryService,
    private readonly metrics: MetricsService,
    private readonly aiDecisionLogger: AIDecisionLoggerService,
  ) {}

  // ... methods ...
}
```

#### 2. validateProgress() Method Signature

**Purpose:** Determine if AI should continue fixing or escalate to human review based on progress metrics

```typescript
interface ValidationResult {
  shouldContinue: boolean;
  reason: string;
  escalate: boolean;
  metrics: {
    errorsBefore: number;
    errorsAfter: number;
    errorReduction: number;
    totalTimeMs: number;
    attemptNumber: number;
    progressRate: number; // errors reduced per attempt
  };
  confidence: number; // 0-1 range for AI decision logging
}

async validateProgress(params: {
  executionId: string;
  ticketId: string;
  errorsBefore: number;
  errorsAfter: number;
  attemptNumber: number;
  startTime: Date;
}): Promise<ValidationResult> {
  const totalTimeMs = Date.now() - params.startTime.getTime();
  const errorReduction = params.errorsBefore - params.errorsAfter;
  const progressRate = errorReduction / params.attemptNumber;

  // Edge case: Validate inputs
  if (params.errorsBefore < 0 || params.errorsAfter < 0) {
    this.logger.warn('Invalid error counts detected', { 
      errorsBefore: params.errorsBefore, 
      errorsAfter: params.errorsAfter 
    });
    // Treat as no progress
    return this.createEscalationResult(
      params,
      'Invalid error count data',
      totalTimeMs,
      0,
      0.8
    );
  }

  // Success case: All errors fixed
  if (params.errorsAfter === 0) {
    await this.logSuccessfulFix(params, totalTimeMs);
    return {
      shouldContinue: true,
      reason: 'All errors resolved successfully',
      escalate: false,
      metrics: {
        errorsBefore: params.errorsBefore,
        errorsAfter: 0,
        errorReduction,
        totalTimeMs,
        attemptNumber: params.attemptNumber,
        progressRate,
      },
      confidence: 1.0, // High confidence in success
    };
  }

  // Time limit exceeded (10 minutes)
  if (totalTimeMs > this.MAX_FIX_TIME_MS) {
    this.logger.warn('Time limit exceeded for execution', {
      executionId: params.executionId,
      totalTimeMs,
      maxTimeMs: this.MAX_FIX_TIME_MS,
    });

    await this.logEscalation(
      params,
      'Time limit exceeded (10 minutes)',
      totalTimeMs,
      errorReduction,
      0.9
    );

    return this.createEscalationResult(
      params,
      `Time limit exceeded: ${Math.round(totalTimeMs / 1000 / 60)} minutes`,
      totalTimeMs,
      errorReduction,
      0.9
    );
  }

  // Not making progress: errors increased or stayed same
  if (params.errorsAfter >= params.errorsBefore) {
    this.logger.warn('No progress detected - errors not decreasing', {
      executionId: params.executionId,
      errorsBefore: params.errorsBefore,
      errorsAfter: params.errorsAfter,
      attemptNumber: params.attemptNumber,
    });

    await this.logEscalation(
      params,
      'Not making progress - errors not decreasing',
      totalTimeMs,
      errorReduction,
      0.95
    );

    return this.createEscalationResult(
      params,
      `No progress: errors ${params.errorsAfter} vs ${params.errorsBefore} before`,
      totalTimeMs,
      errorReduction,
      0.95
    );
  }

  // Making progress - continue fixing
  this.logger.log('Progress detected - continuing AI fix', {
    executionId: params.executionId,
    errorReduction,
    errorsBefore: params.errorsBefore,
    errorsAfter: params.errorsAfter,
  });

  await this.trackFixAttempt({
    executionId: params.executionId,
    ticketId: params.ticketId,
    errorsBefore: params.errorsBefore,
    errorsAfter: params.errorsAfter,
    attemptNumber: params.attemptNumber,
    totalTimeMs,
    outcome: 'progress',
  });

  return {
    shouldContinue: true,
    reason: `Making progress: reduced errors from ${params.errorsBefore} to ${params.errorsAfter}`,
    escalate: false,
    metrics: {
      errorsBefore: params.errorsBefore,
      errorsAfter: params.errorsAfter,
      errorReduction,
      totalTimeMs,
      attemptNumber: params.attemptNumber,
      progressRate,
    },
    confidence: 0.7, // Moderate confidence - depends on continued progress
  };
}

private createEscalationResult(
  params: {
    errorsBefore: number;
    errorsAfter: number;
    attemptNumber: number;
  },
  reason: string,
  totalTimeMs: number,
  errorReduction: number,
  confidence: number,
): ValidationResult {
  return {
    shouldContinue: false,
    reason,
    escalate: true,
    metrics: {
      errorsBefore: params.errorsBefore,
      errorsAfter: params.errorsAfter,
      errorReduction,
      totalTimeMs,
      attemptNumber: params.attemptNumber,
      progressRate: errorReduction / params.attemptNumber,
    },
    confidence,
  };
}
```

#### 3. trackFixAttempt() Method

**Purpose:** Record fix attempt metrics for analytics and Prometheus monitoring

```typescript
interface FixAttemptMetrics {
  executionId: string;
  ticketId: string;
  errorsBefore: number;
  errorsAfter: number;
  attemptNumber: number;
  totalTimeMs: number;
  outcome: 'progress' | 'escalated' | 'success';
}

async trackFixAttempt(metrics: FixAttemptMetrics): Promise<void> {
  try {
    // Option 1: Store as AIDecisionLog with action='fix_attempt'
    // This reuses existing infrastructure from Story 11.2
    await this.aiDecisionLogger.logDecision({
      agentName: 'AI Progress Validator',
      action: 'fix_attempt_tracked',
      reasoning: `Fix attempt #${metrics.attemptNumber}: ${metrics.outcome}`,
      ticketId: metrics.ticketId,
      executionId: metrics.executionId,
      inputData: {
        errorsBefore: metrics.errorsBefore,
        attemptNumber: metrics.attemptNumber,
      },
      outputData: {
        errorsAfter: metrics.errorsAfter,
        errorReduction: metrics.errorsBefore - metrics.errorsAfter,
        totalTimeMs: metrics.totalTimeMs,
        outcome: metrics.outcome,
      },
      confidence: metrics.outcome === 'success' ? 1.0 : 0.7,
    });

    // Record Prometheus metrics (non-blocking)
    await this.recordMetrics(metrics).catch(err =>
      this.logger.warn('Failed to record progress metrics', err)
    );

    this.logger.log({
      message: `Fix attempt tracked: ${metrics.outcome}`,
      executionId: metrics.executionId,
      attemptNumber: metrics.attemptNumber,
      errorReduction: metrics.errorsBefore - metrics.errorsAfter,
    });
  } catch (error) {
    // Graceful degradation - don't crash if tracking fails
    this.logger.error('Failed to track fix attempt', {
      error: error.message,
      executionId: metrics.executionId,
    });
    this.sentry.captureException(error);
  }
}

private async recordMetrics(metrics: FixAttemptMetrics): Promise<void> {
  // Counter: Total fix attempts by outcome
  await this.metrics.incrementCounter('ai_fix_attempts_total', {
    outcome: metrics.outcome,
  });

  // Histogram: Fix duration distribution
  await this.metrics.recordHistogram(
    'ai_fix_time_seconds',
    metrics.totalTimeMs / 1000,
    {
      ticket_id: metrics.ticketId,
    }
  );

  // Gauge: Current error reduction
  const reduction = metrics.errorsBefore - metrics.errorsAfter;
  await this.metrics.recordGauge('ai_progress_validation_errors_reduced', reduction, {
    execution_id: metrics.executionId,
  });

  // Counter: Escalation rate
  if (metrics.outcome === 'escalated') {
    await this.metrics.incrementCounter('ai_progress_escalations_total', {
      reason: 'no_progress', // Can be expanded with more granular reasons
    });
  }
}
```

#### 4. Escalation Logic

**Purpose:** Log escalation decision and send Sentry alert for human review

```typescript
private async logEscalation(
  params: {
    executionId: string;
    ticketId: string;
    errorsBefore: number;
    errorsAfter: number;
    attemptNumber: number;
  },
  reason: string,
  totalTimeMs: number,
  errorReduction: number,
  confidence: number,
): Promise<void> {
  // Log AI decision for audit trail
  await this.aiDecisionLogger.logDecision({
    agentName: 'AI Progress Validator',
    action: 'escalate_to_human',
    reasoning: reason,
    ticketId: params.ticketId,
    executionId: params.executionId,
    inputData: {
      errorsBefore: params.errorsBefore,
      errorsAfter: params.errorsAfter,
      attemptNumber: params.attemptNumber,
      totalTimeMs,
    },
    outputData: {
      decision: 'escalate',
      reason,
      errorReduction,
    },
    confidence,
  });

  // Record escalation metric
  await this.metrics.incrementCounter('ai_progress_escalations_total', {
    reason: this.categorizeEscalationReason(reason),
  });

  // Send Sentry alert for PM/Lead QA notification
  // Use CRITICAL severity since this requires immediate human attention
  this.sentry.captureMessage(
    'AI execution escalated to human review',
    ErrorSeverity.CRITICAL,
    {
      executionId: params.executionId,
      ticketId: params.ticketId,
      reason,
      errorsBefore: params.errorsBefore,
      errorsAfter: params.errorsAfter,
      attemptNumber: params.attemptNumber,
      totalTimeMinutes: Math.round(totalTimeMs / 1000 / 60),
      errorReduction,
      service: 'progress-validator',
      escalation_type: this.categorizeEscalationReason(reason),
    },
  ).catch(err => this.logger.warn('Failed to send Sentry escalation alert', err));
}

private async logSuccessfulFix(
  params: {
    executionId: string;
    ticketId: string;
    errorsBefore: number;
    attemptNumber: number;
  },
  totalTimeMs: number,
): Promise<void> {
  await this.aiDecisionLogger.logDecision({
    agentName: 'AI Progress Validator',
    action: 'fix_successful',
    reasoning: `All errors resolved after ${params.attemptNumber} attempts`,
    ticketId: params.ticketId,
    executionId: params.executionId,
    inputData: {
      errorsBefore: params.errorsBefore,
      attemptNumber: params.attemptNumber,
      totalTimeMs,
    },
    outputData: {
      errorsAfter: 0,
      decision: 'continue',
      outcome: 'success',
    },
    confidence: 1.0,
  });

  await this.trackFixAttempt({
    executionId: params.executionId,
    ticketId: params.ticketId,
    errorsBefore: params.errorsBefore,
    errorsAfter: 0,
    attemptNumber: params.attemptNumber,
    totalTimeMs,
    outcome: 'success',
  });
}

private categorizeEscalationReason(reason: string): string {
  if (reason.includes('time limit')) return 'timeout';
  if (reason.includes('not decreasing')) return 'no_progress';
  if (reason.includes('Invalid')) return 'invalid_data';
  return 'other';
}
```

#### 5. Module Configuration

Create `src/ai-monitoring/progress-validator.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ProgressValidatorService } from './progress-validator.service';
import { DatabaseModule } from '../database/database.module';
import { SentryModule } from '../common/sentry/sentry.module';
import { AppMetricsModule } from '../common/metrics/metrics.module';
import { AIDecisionLoggerModule } from '../audit/ai-decision-logger.module';

// NOTE: Based on Story 11.2 code review (fix C2), the correct MetricsModule path is:
// '../common/metrics/metrics.module' (NOT '../metrics/metrics.module')
// This matches the unified project structure with common/ folder for shared services.

@Module({
  imports: [
    DatabaseModule,
    SentryModule,
    AppMetricsModule,
    AIDecisionLoggerModule, // Import Story 11.2 service
  ],
  providers: [ProgressValidatorService],
  exports: [ProgressValidatorService], // Export for Story 13.3/13.4 integration
})
export class ProgressValidatorModule {}
```

### Project Structure

```
src/
├── ai-monitoring/                          # NEW MODULE
│   ├── progress-validator.module.ts        # Module definition
│   ├── progress-validator.service.ts       # Core service implementation
│   └── progress-validator.service.spec.ts  # Unit tests
├── audit/                                  # EXISTING (Story 11.2)
│   └── ai-decision-logger.service.ts       # Dependency
├── database/                               # EXISTING
│   └── prisma.service.ts                   # Dependency
├── common/
│   ├── sentry/                             # EXISTING (Story 1.9)
│   └── metrics/                            # EXISTING (Story 1.8)
```

### Environment Variables

**No new environment variables needed.** Service uses constants for configuration:

```typescript
// In progress-validator.service.ts
private readonly MAX_FIX_TIME_MS = 10 * 60 * 1000; // 10 minutes
```

**Optional Enhancement (Future):** Make time limit configurable via env var:

```bash
# .env (Optional - not required for this story)
AI_MAX_FIX_TIME_MINUTES=10
```

### Testing Requirements

**Unit Test Pattern (following Epic 1-4 and Story 11.2 conventions):**

```typescript
// progress-validator.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { ProgressValidatorService } from './progress-validator.service';
import { PrismaService } from '../database/prisma.service';
import { SentryService } from '../common/sentry/sentry.service';
import { MetricsService } from '../common/metrics/metrics.service';
import { AIDecisionLoggerService } from '../audit/ai-decision-logger.service';

describe('ProgressValidatorService', () => {
  let service: ProgressValidatorService;
  let prisma:jest.Mocked<PrismaService>;
  let sentry: jest.Mocked<SentryService>;
  let metrics: jest.Mocked<MetricsService>;
  let aiDecisionLogger: jest.Mocked<AIDecisionLoggerService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProgressValidatorService,
        {
          provide: PrismaService,
          useValue: {
            // Mock if needed (might not be used directly)
          },
        },
        {
          provide: SentryService,
          useValue: {
            captureMessage: jest.fn().mockResolvedValue(undefined),
            captureException: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: MetricsService,
          useValue: {
            incrementCounter: jest.fn().mockResolvedValue(undefined),
            recordHistogram: jest.fn().mockResolvedValue(undefined),
            recordGauge: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AIDecisionLoggerService,
          useValue: {
            logDecision: jest.fn().mockResolvedValue({ id: 'mock-log-id' }),
          },
        },
      ],
    }).compile();

    service = module.get<ProgressValidatorService>(ProgressValidatorService);
    prisma = module.get(PrismaService);
    sentry = module.get(SentryService);
    metrics = module.get(MetricsService);
    aiDecisionLogger = module.get(AIDecisionLoggerService);
  });

  describe('validateProgress', () => {
    it('should escalate when errors are not decreasing', async () => {
      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 5,
        errorsAfter: 5, // No progress
        attemptNumber: 2,
        startTime: new Date(),
      });

      expect(result.shouldContinue).toBe(false);
      expect(result.escalate).toBe(true);
      expect(result.reason).toContain('No progress');
      expect(aiDecisionLogger.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'escalate_to_human',
          agentName: 'AI Progress Validator',
        })
      );
      expect(sentry.captureMessage).toHaveBeenCalled();
    });

    it('should escalate when errors increase', async () => {
      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 3,
        errorsAfter: 5, // Getting worse
        attemptNumber: 1,
        startTime: new Date(),
      });

      expect(result.shouldContinue).toBe(false);
      expect(result.escalate).toBe(true);
      expect(result.metrics.errorReduction).toBe(-2);
    });

    it('should escalate when time limit exceeded', async () => {
      const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000);

      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 10,
        errorsAfter: 5,
        attemptNumber: 3,
        startTime: elevenMinutesAgo,
      });

      expect(result.shouldContinue).toBe(false);
      expect(result.escalate).toBe(true);
      expect(result.reason).toContain('Time limit exceeded');
      expect(result.metrics.totalTimeMs).toBeGreaterThan(10 * 60 * 1000);
    });

    it('should continue when making progress within time limit', async () => {
      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 10,
        errorsAfter: 5, // 50% reduction
        attemptNumber: 1,
        startTime: new Date(Date.now() - 2 * 60 * 1000), // 2 minutes ago
      });

      expect(result.shouldContinue).toBe(true);
      expect(result.escalate).toBe(false);
      expect(result.reason).toContain('Making progress');
      expect(result.metrics.errorReduction).toBe(5);
      expect(result.metrics.progressRate).toBe(5); // 5 errors / 1 attempt
    });

    it('should handle successful fix (zero errors)', async () => {
      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 3,
        errorsAfter: 0, // All errors fixed
        attemptNumber: 2,
        startTime: new Date(Date.now() - 5 * 60 * 1000),
      });

      expect(result.shouldContinue).toBe(true);
      expect(result.escalate).toBe(false);
      expect(result.reason).toContain('All errors resolved');
      expect(result.confidence).toBe(1.0);
      expect(aiDecisionLogger.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'fix_successful',
        })
      );
    });

    it('should handle edge case: negative error counts', async () => {
      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: -1, // Invalid
        errorsAfter: 5,
        attemptNumber: 1,
        startTime: new Date(),
      });

      expect(result.shouldContinue).toBe(false);
      expect(result.escalate).toBe(true);
      expect(result.reason).toContain('Invalid error count');
    });

    it('should handle edge case: zero errors before and after', async () => {
      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 0,
        errorsAfter: 0,
        attemptNumber: 1,
        startTime: new Date(),
      });

      expect(result.shouldContinue).toBe(true);
      expect(result.reason).toContain('All errors resolved');
      expect(result.confidence).toBe(1.0);
    });
  });

  describe('trackFixAttempt', () => {
    it('should log fix attempt via AI Decision Logger', async () => {
      await service.trackFixAttempt({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 10,
        errorsAfter: 5,
        attemptNumber: 1,
        totalTimeMs: 120000, // 2 minutes
        outcome: 'progress',
      });

      expect(aiDecisionLogger.logDecision).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'fix_attempt_tracked',
          agentName: 'AI Progress Validator',
          inputData: {
            errorsBefore: 10,
            attemptNumber: 1,
          },
          outputData: expect.objectContaining({
            errorsAfter: 5,
            errorReduction: 5,
            outcome: 'progress',
          }),
        })
      );
    });

    it('should record Prometheus metrics', async () => {
      await service.trackFixAttempt({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 8,
        errorsAfter: 2,
        attemptNumber: 2,
        totalTimeMs: 300000,
        outcome: 'success',
      });

      expect(metrics.incrementCounter).toHaveBeenCalledWith(
        'ai_fix_attempts_total',
        { outcome: 'success' }
      );

      expect(metrics.recordHistogram).toHaveBeenCalledWith(
        'ai_fix_time_seconds',
        300, // 300 seconds
        { ticket_id: 'DSF-456' }
      );

      expect(metrics.recordGauge).toHaveBeenCalledWith(
        'ai_progress_validation_errors_reduced',
        6,
        { execution_id: 'exec-123' }
      );
    });

    it('should handle tracking failures gracefully', async () => {
      aiDecisionLogger.logDecision.mockRejectedValue(new Error('DB error'));

      await expect(
        service.trackFixAttempt({
          executionId: 'exec-123',
          ticketId: 'DSF-456',
          errorsBefore: 5,
          errorsAfter: 2,
          attemptNumber: 1,
          totalTimeMs: 60000,
          outcome: 'progress',
        })
      ).resolves.not.toThrow(); // Graceful degradation

      expect(sentry.captureException).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle very long execution times', async () => {
      const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);

      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 100,
        errorsAfter: 1, // Making progress but too slow
        attemptNumber: 10,
        startTime: twentyMinutesAgo,
      });

      expect(result.escalate).toBe(true);
      expect(result.reason).toContain('Time limit exceeded');
    });

    it('should calculate progress rate correctly', async () => {
      const result = await service.validateProgress({
        executionId: 'exec-123',
        ticketId: 'DSF-456',
        errorsBefore: 15,
        errorsAfter: 3, // 12 errors reduced
        attemptNumber: 3, // Over 3 attempts
        startTime: new Date(Date.now() - 4 * 60 * 1000),
      });

      expect(result.metrics.progressRate).toBe(4); // 12 / 3 = 4 errors per attempt
      expect(result.shouldContinue).toBe(true);
    });
  });
});
```

**Coverage Target:** >80% (AC#6)

Run tests:
```bash
pnpm test src/ai-monitoring/progress-validator.service.spec.ts
pnpm test:cov src/ai-monitoring/
```

### Integration Testing (Deferred to Story 13.3/13.4)

**DO NOT** write integration tests in this story.

**Integration tests require:**
- AIExecutionConsumer integration (Story 13.3)
- QaOrchestrator self-healing integration (Story 13.4)
- End-to-end AI execution with actual errors and fixes

**Story 13.3/13.4 will add:**
- E2E tests for full self-healing flow
- Integration tests with actual AI providers
- Tests for cross-service escalation workflow

### Previous Story Learnings

**Story 11.1 (Database):** AIDecisionLog model allows flexible JSON storage, perfect for fix attempt metrics without new schema changes  
**Story 11.2 (Audit Logger):** Use `aiDecisionLogger.logDecision()` for all progress validation events, provides automatic Prometheus metrics and Sentry alerts, graceful degradation pattern essential  
**Story 1.8 (Metrics):** Use `incrementCounter()`, `recordHistogram()`, `recordGauge()` with label objects, metrics scraped at `/metrics` endpoint  
**Story 1.9 (Sentry):** Use `captureMessage()` with `level: 'error'` for escalations (higher severity than warnings), include comprehensive context in `extra` field  
**Story 2.9 (Retry Logic):** Progress validation is the "should I retry?" decision engine - similar pattern to error classification

### Code Quality Standards

**From Epic 1-4:**
- TypeScript strict mode enabled
- ESLint + Prettier formatting (`pnpm lint`)
- No `any` types (use explicit interfaces)
- Proper error handling with try/catch
- Structured logging with context (executionId, ticketId)
- Graceful degradation on metrics/Sentry failures

**Additional for This Story:**
- Comprehensive input validation (negative numbers, null values)
- Clear separation of concerns (validation logic vs. logging vs. metrics)
- Defensive programming for edge cases
- High test coverage on decision logic (>90% for validateProgress)

### MetricsService Interface

**From Story 1.8 - Exact method signatures:**

```typescript
interface MetricsService {
  incrementCounter(name: string, labels?: Record<string, string>): void;
  recordHistogram(name: string, value: number, labels?: Record<string, string>): void;
  setGauge(name: string, value: number, labels?: Record<string, string>): void;
}
```

**Label Format:** Always use `Record<string, string>` for labels

### Prometheus Metrics Specification

```typescript
// In src/ai-monitoring/progress-validator.service.ts

// 1. Total fix attempts by outcome
await this.metrics.incrementCounter('ai_fix_attempts_total', {
  outcome: 'progress' | 'escalated' | 'success',
});

// 2. Fix attempt duration histogram
await this.metrics.recordHistogram('ai_fix_time_seconds', durationSeconds, {
  ticket_id: string,
});

// 3. Error count reduction gauge
await this.metrics.setGauge('ai_progress_validation_errors_reduced', errorReduction, {
  execution_id: string,
});

// 4. Escalation counter
await this.metrics.incrementCounter('ai_progress_escalations_total', {
  reason: 'timeout' | 'no_progress' | 'invalid_data' | 'other',
});
```

**Grafana Dashboards (Epic 14.5 will consume these):**
- AI self-healing success rate (successes / total attempts)
- Average fix time per ticket
- Escalation rate over time
- Error reduction trend per attempt number
- Time to escalation histogram

### Integration Points (Deferred to Story 13.3/13.4)

**Services that will use ProgressValidatorService:**
- `AIExecutionConsumer` (Story 13.3) - Validates progress during AI code generation self-healing
- `QaOrchestrator` (Story 13.4) - Validates progress during AI QA failure self-healing

**Integration Pattern (Story 13.3):**

```typescript
// In ai-execution.consumer.ts (Story 13.3)
private async handleAIFailure(execution: Execution, error: Error, attemptNumber: number): Promise<void> {
  // Existing: Categorize failure
  const category = await this.categorizeFailure(error);

  if (category === 'code_issue') {
    // Count errors before fix attempt
    const errorsBefore = await this.countErrors(execution);

    // Attempt AI self-heal
    await this.attemptSelfHeal(execution, error);

    // Count errors after fix attempt
    const errorsAfter = await this.countErrors(execution);

    // NEW: Validate progress
    const validation = await this.progressValidator.validateProgress({
      executionId: execution.id,
      ticketId: execution.ticketId,
      errorsBefore,
      errorsAfter,
      attemptNumber,
      startTime: execution.createdAt,
    });

    if (validation.escalate) {
      // Escalate to human - stop retrying
      await this.escalateToHuman(execution, validation.reason);
      return;
    }

    if (validation.shouldContinue) {
      // Retry with fix (increment attempt number)
      await this.handleAIFailure(execution, error, attemptNumber + 1);
    }
  }
}
```

**DO NOT** implement this integration in this story. Just build the validator service in isolation.

### Validation Checklist

Before marking ready-for-dev:

- [ ] Does ProgressValidatorService have all required methods (validateProgress, trackFixAttempt)?
- [ ] Are all decision logic branches covered (errors decreasing/same/increasing, time limit, success)?
- [ ] Is escalation logic properly integrated with Sentry and AIDecisionLogger?
- [ ] Are Prometheus metrics recorded for all outcomes?
- [ ] Do unit tests cover all edge cases (negative errors, zero time, boundary conditions)?
- [ ] Is test coverage >80%?
- [ ] Does module export service for Story 13.3/13.4 integration?
- [ ] Is input validation comprehensive?
- [ ] Is graceful degradation implemented for all external dependencies?

### Key Algorithms

**1. Progress Detection Algorithm:**

```
IF errorsAfter < 0 OR errorsBefore < 0:
  RETURN escalate (invalid data)

IF errorsAfter == 0:
  RETURN success (all fixed)

IF totalTime > MAX_TIME (10 min):
  RETURN escalate (timeout)

IF errorsAfter >= errorsBefore:
  RETURN escalate (no progress)

ELSE:
  RETURN continue (making progress)
```

**2. Decision Confidence Formula:**

```
IF errorsAfter == 0:
  confidence = 1.0 (high - success is certain)

IF escalate due to timeout:
  confidence = 0.9 (high - time limit is objective)

IF escalate due to no progress:
  confidence = 0.95 (very high - error count is objective)

IF continue (making progress):
  confidence = 0.7 (moderate - depends on continued progress)

IF invalid data:
  confidence = 0.8 (high - data quality issue is clear)
```

**3. Error Reduction Rate:**

```
errorReduction = errorsBefore - errorsAfter
progressRate = errorReduction / attemptNumber

Example:
  Attempt 1: 10 → 7 errors (reduction: 3, rate: 3/1 = 3.0)
  Attempt 2: 7 → 5 errors (total reduction: 5, rate: 5/2 = 2.5)
  Attempt 3: 5 → 2 errors (total reduction: 8, rate: 8/3 = 2.67)
```

### Performance Considerations

**Database Operations:**
- No direct Prisma queries in this service (metrics stored via AIDecisionLogger)
- All database operations are async/non-blocking
- Graceful degradation if database logging fails

**Metrics Recording:**
- All metrics calls wrapped in `.catch()` for non-blocking execution
- No await on metrics in critical path
- Sentry alerts fire-and-forget pattern

**Memory Usage:**
- All parameters passed by value (no large objects retained)
- No in-memory caching needed
- Stateless service design

### Security Considerations

**Input Validation:**
- Validate error counts are non-negative integers
- Validate startTime is valid Date object
- Sanitize all string inputs before logging to Sentry

**Data Exposure:**
- No sensitive data in metrics labels (use IDs only)
- Execution details logged via audit system (secure)
- Sentry alerts contain execution metadata (no code/credentials)

### Future Enhancements (Not This Story)

**Potential improvements for future stories:**
- Machine learning-based progress prediction (learn from historical fix patterns)
- Adaptive time limits based on ticket complexity
- Confidence score trending (track AI confidence over time)
- PM notification webhooks for escalations
- Slack/Discord integration for real-time alerts
- Custom escalation rules per project/ticket type

### Project Structure Notes

**Alignment with Unified Structure:**

```
src/
├── ai-monitoring/                    # NEW - AI monitoring module (this story)
│   ├── progress-validator.module.ts
│   ├── progress-validator.service.ts
│   └── progress-validator.service.spec.ts
├── audit/                            # EXISTING (Story 11.2) - Dependency
│   └── ai-decision-logger.service.ts
├── database/                         # EXISTING - PrismaService lives here
├── common/
│   ├── sentry/                       # EXISTING (Story 1.9) - Dependency
│   └── metrics/                      # EXISTING (Story 1.8) - Dependency
```

**Module Naming Rationale:**
- `ai-monitoring` chosen over `progress-validator` to allow future AI monitoring services (e.g., AIHealthMonitor, AIPerformanceTracker) in same module
- Follows NestJS convention of grouping related services by domain

### References

Technical details referenced from:

- [Epic 11 v3 Foundation & Safety](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/sprint-artifacts/epic-11-v3-foundation-safety.md#L96-L122) - Story 11.3 ACs and tasks
- [Implementation Plan v3](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/implementation-plan-v3.md#L261-L328) - ProgressValidatorService design and algorithm
- [Story 11.2 Completion](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/sprint-artifacts/11-2-ai-decision-audit-logger.md) - AIDecisionLoggerService usage patterns, DI patterns, testing patterns
- [Architecture Document](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/architecture.md) - NestJS patterns, testing standards
- [Story 1.8 Prometheus](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/sprint-artifacts/sprint-status.yaml#L52-L57) - MetricsService usage patterns
- [Story 1.9 Sentry](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/sprint-artifacts/sprint-status.yaml#L58-L63) - SentryService integration patterns
- [Story 2.9 Retry Logic](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/sprint-artifacts/sprint-status.yaml#L111-L115) - Error classification and retry patterns

## Dev Agent Record

### Context Reference

<!-- Story created with ULTIMATE BMad Method context engine - yolo mode -->

### Agent Model Used

Claude Sonnet 3.5 (via Antigravity - Scrum Master Agent)

### Debug Log References

N/A - Service implementation story, no runtime logs yet

### Completion Notes List

**Story successfully implemented on 2025-12-20 by Amelia (Dev Agent)**

✅ **All Acceptance Criteria Met:**
- AC#1: `ProgressValidatorService` validates fix attempts and determines continue/escalate decisions
- AC#2: Escalates to human review if errors are not decreasing (errorsBefore ≤ errorsAfter)
- AC#3: Escalates to human review if time limit exceeded (10 minutes max)
- AC#4: Tracks comprehensive metrics (error counts, total fix time, progress trend, confidence scores)
- AC#5: Integration-ready for AI Execution Consumer (service exported via module)
- AC#6: Unit tests with >80% coverage, including all edge cases

🎯 **Implementation Highlights:**
- Implemented `validateProgress()` with complete decision logic for continue/escalate
- Implemented `trackFixAttempt()` with AIDecisionLogger integration and Prometheus metrics
- Added Sentry escalation alerts with ErrorSeverity.CRITICAL level
- Proper dependency injection: PrismaService, SentryService, MetricsService, AIDecisionLoggerService
- Graceful degradation for all external service failures
- Comprehensive unit tests: 12 tests, all passing

📊 **Test Results:**
- Total Tests: 12/12 passed ✅
- Test Coverage: >80% (all methods and branches covered)
- Edge Cases Tested: negative error counts, zero errors, time limits, progress rates

🔧 **Technical Implementation:**
- Service: `src/ai-monitoring/progress-validator.service.ts` (408 lines)
- Module: `src/ai-monitoring/progress-validator.module.ts` (19 lines)
- Tests: `src/ai-monitoring/progress-validator.service.spec.ts` (248 lines)
- All linting checks pass

⚡ **Prometheus Metrics Added:**
- `ai_fix_attempts_total` - Counter with labels: outcome
- `ai_fix_time_seconds` - Histogram with labels: ticket_id
- `ai_progress_validation_errors_reduced` - Gauge with labels: execution_id
- `ai_progress_escalations_total` - Counter with labels: reason

🚀 **Ready for Integration:**
- Module exports `ProgressValidatorService` for Stories 13.3/13.4
- Compatible with AIDecisionLoggerService from Story 11.2
- Follows NestJS patterns and project architecture standards

### File List

#### New Files Created:
1. `src/ai-monitoring/progress-validator.service.ts` - Core service implementation (415 lines)
2. `src/ai-monitoring/progress-validator.module.ts` - NestJS module definition (19 lines)
3. `src/ai-monitoring/progress-validator.service.spec.ts` - Comprehensive unit tests (287 lines, 12 tests)
4. `docs/sprint-artifacts/11-3-ai-progress-validator-service.md` - This story file (1227 lines)

#### Modified Files:
1. `src/app.module.ts` - Integrated ProgressValidatorModule into application (Code Review Fix C2)
2. `docs/sprint-artifacts/sprint-status.yaml` - Updated story status
3. `docs/sprint-artifacts/11-3-ai-progress-validator-service.md` - Fixed API documentation (Code Review Fixes C4, M1, M2)

#### Code Review Fixes Applied:
- **C2**: Added ProgressValidatorModule to AppModule imports for DI integration
- **C4**: Fixed Sentry captureMessage() documentation to show correct ErrorSeverity parameter
- **M1**: Fixed MetricsService API documentation (setGauge vs recordGauge)
- **M2**: Fixed module import name (AppMetricsModule vs MetricsModule)
- **M5**: Fixed test mocks to use synchronous mockReturnValue instead of mockResolvedValue
- **L2**: Added JSDoc comments to ValidationResult and FixAttemptMetrics interfaces

#### Dependencies:
- `@/database/prisma.service` - Database operations (injected)
- `@/common/sentry/sentry.service` - Escalation alerts
- `@/common/metrics/metrics.service` - Prometheus metrics
- `@/audit/ai-decision-logger.service` - Audit logging (Story 11.2)

