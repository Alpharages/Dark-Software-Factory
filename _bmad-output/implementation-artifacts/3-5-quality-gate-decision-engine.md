# Story 3.5: Quality Gate Decision Engine

**Epic:** 3 - Automated QA & Quality Gates  
**Status:** done  
**Priority:** P1 - HIGH  
**Effort:** 8 story points  
**ClickUp ID:** `86evnjwb8`  
**ClickUp URL:** https://app.clickup.com/t/86evnjwb8

---

## Story

As the system,
I want to enforce quality gates that block deployment if standards aren't met,
So that only validated code proceeds to human review.

---

## Acceptance Criteria

**Given** all QA checks have completed  
**When** the quality gate evaluates results  
**Then** the system:
- Aggregates results from linting, testing, coverage, security checks
- Applies configurable rules per project or globally
- Determines overall pass/fail status
- Calculates quality score (0-100)

**And** quality gate rules include:
- **Blocking issues:** Critical security vulnerabilities, test failures, linting errors (not warnings)
- **Warning issues:** Code complexity > threshold, coverage below target, dependency vulnerabilities (low severity)
- **Threshold configuration:** Per project settings override defaults

**And** if quality gate fails: execution blocked from GitHub push, ticket status set to QA_FAILED, PM notified with actionable summary

**And** if quality gate passes: execution proceeds to GitHub integration (Epic 4), ticket status updated to QA_REVIEW

---

## Quick Implementation Summary (TL;DR)

**17 Key Files in Implementation Order:**
1. `src/common/sentry/sentry.constants.ts` - MODIFY: ADD `QA_AUTOMATION` to ErrorCategory enum
2. `src/qa-automation/interfaces/quality-gate.interface.ts` - Types and interfaces
3. `src/qa-automation/interfaces/index.ts` - MODIFY: add exports
4. `src/qa-automation/dto/quality-gate.dto.ts` - DTOs (follow Story 3.3/3.4 pattern)
5. `src/qa-automation/dto/index.ts` - MODIFY: add exports
6. `src/qa-automation/quality-gates.service.ts` - Main quality gate engine
7. `src/qa-automation/qa-orchestrator.service.ts` - Orchestrates all QA services
8. `src/qa-automation/qa-orchestrator.consumer.ts` - RabbitMQ consumer for qa-check-queue
9. `src/qa-automation/qa-results.service.ts` - Storage and retrieval of QA results
10. `src/qa-automation/qa-results.controller.ts` - API endpoints for QA results
11. `src/common/metrics/metrics.constants.ts` - ADD quality gate metrics to QA_METRICS
12. `src/config/configuration.ts` - Add quality gate config
13. `src/config/env.validation.ts` - Add env var validation
14. `src/qa-automation/qa-automation.module.ts` - Wire all providers
15. `src/qa-automation/quality-gates.service.spec.ts` - Unit tests
16. `src/qa-automation/qa-orchestrator.service.spec.ts` - Unit tests
17. `test/qa-orchestrator.e2e-spec.ts` - E2E tests

**Database:** Uses existing `QAResult` model - no schema changes required.

---

## ⚠️ Anti-Patterns to Avoid

| ❌ DO NOT | ✅ DO INSTEAD |
|-----------|---------------|
| Hard-code thresholds | Use ConfigService with per-project overrides |
| Create separate metric files | ADD to existing `QA_METRICS` in `metrics.constants.ts` |
| Block on warnings only | Only block on errors (critical/high severity) |
| Skip correlationId | Propagate from caller for full audit trail |
| Use generic queue names | Use `QUEUE_NAMES.QA_CHECK` constant |
| Notify PM synchronously | Use Socket.IO event (async) per Story 10.4 pattern |
| Calculate score with magic numbers | Use named constants with clear weights |
| Store raw results | Store normalized JSON in `QAResult` fields |
| Evaluate partial results | Wait for ALL QA checks before evaluation |
| Run QA checks sequentially | Run independent checks in parallel |
| Use `ErrorCategory.UNKNOWN` for QA | Use `ErrorCategory.QA_AUTOMATION` (add if missing) |
| Skip RabbitMQ consumer class | Create `qa-orchestrator.consumer.ts` with `@RabbitSubscribe` |

---

## Integration Context

### How This Story Fits in the Pipeline

```
Story 3.1 (Linting) - lint checks complete
Story 3.2 (Test Execution) - tests run complete
Story 3.3 (Coverage) - coverage calculated
Story 3.4 (Security Checks) - security scan complete
    ↓ all checks complete
Story 3.5 (This Story) - QualityGatesService evaluates all results
    ↓ if passed
Story 4.x (GitHub Integration) - pushes code
    ↓ if failed
PM notified via Socket.IO, Ticket.status = QA_FAILED
```

### Key Integration Points

| From | Interface | To |
|------|-----------|-----|
| RabbitMQ `qa-check-queue` | `QaOrchestratorService.processQaCheck()` | This story |
| This story | reads `QAResult` | Database |
| This story | calls `linter.service.ts` | Story 3.1 |
| This story | calls `test-runner.service.ts` | Story 3.2 |
| This story | calls `coverage.service.ts` | Story 3.3 |
| This story | calls `code-review.service.ts` | Story 3.4 |
| This story | updates `QAResult.overall_passed` | Database |
| This story | updates `Ticket.status` | Database |
| This story | creates `AuditLog` entry | Database |
| This story | publishes to `deployment-queue` | RabbitMQ (if passed) |
| Story 10.4 | reads events, emits Socket.IO | PM Dashboard |

---

## Technical Requirements

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/common/sentry/sentry.constants.ts` | MODIFY | ADD `QA_AUTOMATION` to ErrorCategory |
| `src/qa-automation/interfaces/quality-gate.interface.ts` | CREATE | Types and interfaces |
| `src/qa-automation/interfaces/index.ts` | MODIFY | Add exports |
| `src/qa-automation/dto/quality-gate.dto.ts` | CREATE | DTOs |
| `src/qa-automation/dto/index.ts` | MODIFY | Add exports |
| `src/qa-automation/quality-gates.service.ts` | CREATE | Decision engine |
| `src/qa-automation/qa-orchestrator.service.ts` | CREATE | QA orchestration |
| `src/qa-automation/qa-orchestrator.consumer.ts` | CREATE | RabbitMQ consumer |
| `src/qa-automation/qa-results.service.ts` | CREATE | Results storage |
| `src/qa-automation/qa-results.controller.ts` | CREATE | API endpoints |
| `src/common/metrics/metrics.constants.ts` | MODIFY | Add QG metrics |
| `src/config/configuration.ts` | MODIFY | Add QG config |
| `src/config/env.validation.ts` | MODIFY | Add env validation |
| `src/qa-automation/qa-automation.module.ts` | MODIFY | Wire providers |
| `src/qa-automation/quality-gates.service.spec.ts` | CREATE | Unit tests |
| `src/qa-automation/qa-orchestrator.service.spec.ts` | CREATE | Unit tests |
| `test/qa-orchestrator.e2e-spec.ts` | CREATE | E2E tests |

---

## Tasks

- [x] **Task 1: Verify/Add ErrorCategory.QA_AUTOMATION** (CRITICAL)
  - [x] Check `src/common/sentry/sentry.constants.ts` for `QA_AUTOMATION`
  - [x] ADD `QA_AUTOMATION = 'qa_automation'` to ErrorCategory enum if missing
  - [x] This may have been added by Story 3.3/3.4 - verify before adding

- [x] **Task 2: Create Interfaces** (AC: #1, #2)
  - [x] `IQualityGateRule`, `IQualityGateConfig`, `IQualityGateResult`
  - [x] `QualityGateStatus` enum (PASSED, FAILED, WARNING)
  - [x] `QualityCategory` enum (LINTING, TESTING, COVERAGE, SECURITY)
  - [x] `QUALITY_SCORE_WEIGHTS` constant (category weights for scoring)
  - [x] `DEFAULT_THRESHOLDS` constant
  - [x] `QA_CHECK_TIMEOUTS` constant (per-category timeouts)

- [x] **Task 3: Create DTOs** (AC: #1, #2)
  - [x] Follow DTO pattern from Story 3.3/3.4
  - [x] `QualityGateConfigDto`, `QualityGateResultDto`, `CategoryScoreDto`
  - [x] `BlockingIssueDto`, `WarningIssueDto`

- [x] **Task 4: Implement QualityGatesService** (AC: All)
  - [x] `evaluate(executionId, qaResult)` - main decision logic
  - [x] `calculateQualityScore(qaResult)` - 0-100 weighted score
  - [x] `loadConfig(projectId)` - per-project or default config
  - [x] `determineBlockingIssues(qaResult)` - extract blockers
  - [x] `determineWarningIssues(qaResult)` - extract warnings
  - [x] Add `SAMPLE_QA_RESULT` and `SAMPLE_FAILING_QA_RESULT` for testing

- [x] **Task 5: Implement QaOrchestratorService** (AC: All)
  - [x] `processQaCheck(message)` - main orchestration logic
  - [x] Run all QA services in parallel with per-category timeouts
  - [x] Aggregate results, call QualityGatesService
  - [x] Update ticket status based on result
  - [x] Publish to `deployment-queue` or emit failure event

- [x] **Task 6: Implement QaOrchestratorConsumer** (AC: All)
  - [x] Create `qa-orchestrator.consumer.ts`
  - [x] Add `@RabbitSubscribe({ queue: QUEUE_NAMES.QA_CHECK })` decorator
  - [x] Call `QaOrchestratorService.processQaCheck()`
  - [x] Handle errors with Sentry and dead-letter queue

- [x] **Task 7: Implement QaResultsService + Controller** (AC: #3)
  - [x] `saveResult(executionId, result)` - save to database
  - [x] `getResult(executionId)` - retrieve result
  - [x] `getResultsByTicket(ticketId)` - query by ticket
  - [x] `getResultsByProject(projectId, filters)` - query with filters
  - [x] Create `QaResultsController` with endpoints:
    - [x] GET `/api/v1/qa-results/:executionId`
    - [x] GET `/api/v1/qa-results?ticketId={id}`
    - [x] GET `/api/v1/qa-results?projectId={id}&status=failed`
    - [x] POST `/api/v1/quality-gate/:executionId/override` (emergency override)

- [x] **Task 8: Add Quality Gate Metrics** (AC: #2)
  - [x] ADD to existing `QA_METRICS` in metrics.constants.ts
  - [x] `QUALITY_GATE_EVALUATIONS_TOTAL`, `QUALITY_GATE_DURATION`, `QUALITY_SCORE_HISTOGRAM`

- [x] **Task 9: Configuration** (AC: #2)
  - [x] Add quality gate config to `configuration.ts`
  - [x] Update `env.validation.ts` with QG_* env vars
  - [x] Add per-category timeout configs

- [x] **Task 10: Wire Module + Tests** (AC: All)
  - [x] Update `QaAutomationModule` with all providers
  - [x] Unit tests for QualityGatesService (pass/fail/warning scenarios)
  - [x] Unit tests for QaOrchestratorService (parallel execution, timeout handling)
  - [x] E2E tests for full QA pipeline

---

## Implementation Guide

### Step 1: Interfaces

**File:** `src/qa-automation/interfaces/quality-gate.interface.ts`

```typescript
import { TicketStatus } from '@prisma/client';

/**
 * Quality Gate Decision Engine Interfaces
 * Architecture: docs/architecture.md line 158 (quality-gates.service.ts)
 * FR70: System blocks deployment if quality gates fail
 */

export enum QualityGateStatus {
  PASSED = 'passed',
  FAILED = 'failed',
  WARNING = 'warning',
}

export enum QualityCategory {
  LINTING = 'linting',
  TESTING = 'testing',
  COVERAGE = 'coverage',
  SECURITY = 'security',
}

export enum BlockerType {
  CRITICAL_SECURITY = 'critical_security',
  TEST_FAILURE = 'test_failure',
  LINTING_ERROR = 'linting_error',
  COVERAGE_BELOW_MINIMUM = 'coverage_below_minimum',
}

export enum WarningType {
  HIGH_COMPLEXITY = 'high_complexity',
  COVERAGE_BELOW_TARGET = 'coverage_below_target',
  LOW_SEVERITY_VULN = 'low_severity_vuln',
  LINTING_WARNING = 'linting_warning',
}

/**
 * Quality score weights per category (must sum to 100)
 * Adjust weights based on project priorities
 */
export const QUALITY_SCORE_WEIGHTS: Record<QualityCategory, number> = {
  [QualityCategory.LINTING]: 15,
  [QualityCategory.TESTING]: 35,
  [QualityCategory.COVERAGE]: 25,
  [QualityCategory.SECURITY]: 25,
} as const;

/**
 * Default thresholds - can be overridden per project
 */
export const DEFAULT_THRESHOLDS: IQualityThresholds = {
  minTestPassRate: 100, // 100% tests must pass
  minCoverage: 80, // 80% coverage minimum
  maxLintingErrors: 0, // Zero linting errors allowed
  maxLintingWarnings: 10, // Up to 10 warnings
  blockOnCriticalSecurity: true,
  blockOnHighSecurity: true,
  maxComplexity: 20,
  targetCoverage: 90, // Target for full score
} as const;

export interface IQualityThresholds {
  minTestPassRate: number; // 0-100, percentage
  minCoverage: number; // 0-100, percentage
  maxLintingErrors: number;
  maxLintingWarnings: number;
  blockOnCriticalSecurity: boolean;
  blockOnHighSecurity: boolean;
  maxComplexity: number;
  targetCoverage: number; // For quality score calculation
}

export interface IQualityGateConfig {
  projectId: string | null; // null = global default
  thresholds: IQualityThresholds;
  enabledCategories: QualityCategory[];
  allowOverride: boolean; // Emergency override with audit trail
  overrideRequiresApproval: boolean;
}

export interface IBlockingIssue {
  type: BlockerType;
  category: QualityCategory;
  message: string;
  details?: Record<string, any>;
}

export interface IWarningIssue {
  type: WarningType;
  category: QualityCategory;
  message: string;
  details?: Record<string, any>;
}

export interface ICategoryScore {
  category: QualityCategory;
  score: number; // 0-100 for this category
  weight: number; // Weight in overall score
  passed: boolean;
  details: {
    metric: string;
    value: number;
    threshold: number;
  }[];
}

export interface IQualityGateResult {
  executionId: string;
  correlationId: string;
  status: QualityGateStatus;
  overallScore: number; // 0-100
  passed: boolean;
  categoryScores: ICategoryScore[];
  blockingIssues: IBlockingIssue[];
  warningIssues: IWarningIssue[];
  appliedConfig: IQualityGateConfig;
  evaluatedAt: Date;
  durationMs: number;
  nextAction: 'proceed_to_github' | 'notify_pm_failure' | 'manual_review';
  ticketStatusUpdate: TicketStatus;
}

export interface IQaCheckMessage {
  executionId: string;
  ticketId: string;
  projectId: string;
  correlationId: string;
  workspacePath: string;
  skipCategories?: QualityCategory[];
}

export interface IQaOrchestrationResult {
  executionId: string;
  correlationId: string;
  lintingResult: any; // From Story 3.1
  testResult: any; // From Story 3.2
  coverageResult: any; // From Story 3.3
  securityResult: any; // From Story 3.4
  qualityGateResult: IQualityGateResult;
}
```

---

### Step 2: DTOs

**File:** `src/qa-automation/dto/quality-gate.dto.ts`

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNumber, IsString, IsArray, IsEnum, IsOptional, ValidateNested, IsObject, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { QualityGateStatus, QualityCategory, BlockerType, WarningType } from '../interfaces';

export class QualityThresholdsDto {
  @ApiProperty({ description: 'Minimum test pass rate (0-100)', minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  minTestPassRate: number;

  @ApiProperty({ description: 'Minimum coverage percentage', minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  minCoverage: number;

  @ApiProperty({ description: 'Maximum linting errors allowed' })
  @IsNumber()
  @Min(0)
  maxLintingErrors: number;

  @ApiProperty({ description: 'Maximum linting warnings allowed' })
  @IsNumber()
  @Min(0)
  maxLintingWarnings: number;

  @ApiProperty({ description: 'Block on critical security vulnerabilities' })
  @IsBoolean()
  blockOnCriticalSecurity: boolean;

  @ApiProperty({ description: 'Block on high security vulnerabilities' })
  @IsBoolean()
  blockOnHighSecurity: boolean;

  @ApiProperty({ description: 'Maximum cyclomatic complexity' })
  @IsNumber()
  @Min(1)
  maxComplexity: number;

  @ApiProperty({ description: 'Target coverage for full score', minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  targetCoverage: number;
}

export class QualityGateConfigDto {
  @ApiPropertyOptional({ description: 'Project ID (null for global)' })
  @IsOptional()
  @IsString()
  projectId?: string | null;

  @ApiProperty({ type: QualityThresholdsDto })
  @ValidateNested()
  @Type(() => QualityThresholdsDto)
  thresholds: QualityThresholdsDto;

  @ApiProperty({ enum: QualityCategory, isArray: true })
  @IsArray()
  @IsEnum(QualityCategory, { each: true })
  enabledCategories: QualityCategory[];

  @ApiProperty({ description: 'Allow emergency override' })
  @IsBoolean()
  allowOverride: boolean;

  @ApiProperty({ description: 'Override requires approval' })
  @IsBoolean()
  overrideRequiresApproval: boolean;
}

export class BlockingIssueDto {
  @ApiProperty({ enum: BlockerType })
  @IsEnum(BlockerType)
  type: BlockerType;

  @ApiProperty({ enum: QualityCategory })
  @IsEnum(QualityCategory)
  category: QualityCategory;

  @ApiProperty()
  @IsString()
  message: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  details?: Record<string, any>;
}

export class WarningIssueDto {
  @ApiProperty({ enum: WarningType })
  @IsEnum(WarningType)
  type: WarningType;

  @ApiProperty({ enum: QualityCategory })
  @IsEnum(QualityCategory)
  category: QualityCategory;

  @ApiProperty()
  @IsString()
  message: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  details?: Record<string, any>;
}

export class CategoryScoreDto {
  @ApiProperty({ enum: QualityCategory })
  @IsEnum(QualityCategory)
  category: QualityCategory;

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  score: number;

  @ApiProperty()
  @IsNumber()
  weight: number;

  @ApiProperty()
  @IsBoolean()
  passed: boolean;
}

export class QualityGateResultDto {
  @ApiProperty()
  @IsString()
  executionId: string;

  @ApiProperty()
  @IsString()
  correlationId: string;

  @ApiProperty({ enum: QualityGateStatus })
  @IsEnum(QualityGateStatus)
  status: QualityGateStatus;

  @ApiProperty({ description: 'Overall quality score (0-100)', minimum: 0, maximum: 100 })
  @IsNumber()
  @Min(0)
  @Max(100)
  overallScore: number;

  @ApiProperty()
  @IsBoolean()
  passed: boolean;

  @ApiProperty({ type: [CategoryScoreDto] })
  @ValidateNested({ each: true })
  @Type(() => CategoryScoreDto)
  categoryScores: CategoryScoreDto[];

  @ApiProperty({ type: [BlockingIssueDto] })
  @ValidateNested({ each: true })
  @Type(() => BlockingIssueDto)
  blockingIssues: BlockingIssueDto[];

  @ApiProperty({ type: [WarningIssueDto] })
  @ValidateNested({ each: true })
  @Type(() => WarningIssueDto)
  warningIssues: WarningIssueDto[];

  @ApiProperty()
  @IsString()
  nextAction: 'proceed_to_github' | 'notify_pm_failure' | 'manual_review';
}
```

---

### Step 3: QualityGatesService (Decision Engine)

**File:** `src/qa-automation/quality-gates.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { QA_METRICS } from '../common/metrics/metrics.constants';
import {
  IQualityGateResult,
  IQualityGateConfig,
  IQualityThresholds,
  IBlockingIssue,
  IWarningIssue,
  ICategoryScore,
  QualityGateStatus,
  QualityCategory,
  BlockerType,
  WarningType,
  QUALITY_SCORE_WEIGHTS,
  DEFAULT_THRESHOLDS,
} from './interfaces';
import { TicketStatus } from '@prisma/client';

// Sample QA results for testing
export const SAMPLE_QA_RESULT = {
  linting_passed: true,
  linting_errors: { errorCount: 0, warningCount: 2 },
  tests_passed: true,
  test_results: { passed: 50, failed: 0, skipped: 2 },
  test_coverage: 85.5,
  code_review_passed: true,
  code_review_issues: { summary: { criticalCount: 0, highCount: 0, mediumCount: 1 } },
};

export const SAMPLE_FAILING_QA_RESULT = {
  linting_passed: false,
  linting_errors: { errorCount: 3, warningCount: 5 },
  tests_passed: false,
  test_results: { passed: 45, failed: 5, skipped: 2 },
  test_coverage: 65.0,
  code_review_passed: false,
  code_review_issues: { 
    summary: { criticalCount: 1, highCount: 2, mediumCount: 3 },
    complexityIssues: [{ function: 'processData', complexity: 25 }],
  },
};

@Injectable()
export class QualityGatesService {
  private readonly logger = new Logger(QualityGatesService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectMetric(QA_METRICS.QUALITY_GATE_EVALUATIONS_TOTAL)
    private readonly evaluationsCounter: Counter<string>,
    @InjectMetric(QA_METRICS.QUALITY_GATE_DURATION)
    private readonly durationHistogram: Histogram<string>,
    @InjectMetric(QA_METRICS.QUALITY_SCORE_HISTOGRAM)
    private readonly scoreHistogram: Histogram<string>,
  ) {}

  /**
   * Main evaluation method - evaluates all QA results against quality gates
   */
  async evaluate(
    executionId: string,
    correlationId: string,
    projectId: string,
    qaResult: {
      linting_passed: boolean;
      linting_errors: any;
      tests_passed: boolean;
      test_results: any;
      test_coverage: number | null;
      code_review_passed: boolean;
      code_review_issues: any;
    },
  ): Promise<IQualityGateResult> {
    const startTime = Date.now();
    const endTimer = this.durationHistogram.startTimer();

    this.logger.log(`[${correlationId}] Evaluating quality gates for execution ${executionId}`);

    try {
      // Load configuration (per-project or default)
      const config = await this.loadConfig(projectId);
      
      // Calculate category scores
      const categoryScores = this.calculateCategoryScores(qaResult, config.thresholds);
      
      // Calculate overall score (weighted average)
      const overallScore = this.calculateOverallScore(categoryScores);
      
      // Identify blocking issues
      const blockingIssues = this.determineBlockingIssues(qaResult, config.thresholds);
      
      // Identify warning issues
      const warningIssues = this.determineWarningIssues(qaResult, config.thresholds);
      
      // Determine status
      const passed = blockingIssues.length === 0;
      const status = this.determineStatus(passed, warningIssues.length);
      
      // Determine next action
      const nextAction = this.determineNextAction(passed, warningIssues);
      
      // Track metrics
      this.evaluationsCounter.inc({ status, project_id: projectId });
      this.scoreHistogram.observe({ project_id: projectId }, overallScore);

      const result: IQualityGateResult = {
        executionId,
        correlationId,
        status,
        overallScore,
        passed,
        categoryScores,
        blockingIssues,
        warningIssues,
        appliedConfig: config,
        evaluatedAt: new Date(),
        durationMs: Date.now() - startTime,
        nextAction,
        ticketStatusUpdate: passed ? TicketStatus.QA_REVIEW : TicketStatus.QA_FAILED,
      };

      this.logger.log(
        `[${correlationId}] Quality gate evaluation complete: ` +
        `score=${overallScore}, passed=${passed}, ` +
        `blockers=${blockingIssues.length}, warnings=${warningIssues.length}`
      );

      return result;
    } finally {
      endTimer();
    }
  }

  /**
   * Load quality gate configuration - per-project or global default
   */
  async loadConfig(projectId: string): Promise<IQualityGateConfig> {
    // TODO: In future, load from database per project
    // For now, use environment-based configuration
    
    const thresholds: IQualityThresholds = {
      minTestPassRate: this.configService.get<number>('qualityGate.minTestPassRate', DEFAULT_THRESHOLDS.minTestPassRate),
      minCoverage: this.configService.get<number>('qualityGate.minCoverage', DEFAULT_THRESHOLDS.minCoverage),
      maxLintingErrors: this.configService.get<number>('qualityGate.maxLintingErrors', DEFAULT_THRESHOLDS.maxLintingErrors),
      maxLintingWarnings: this.configService.get<number>('qualityGate.maxLintingWarnings', DEFAULT_THRESHOLDS.maxLintingWarnings),
      blockOnCriticalSecurity: this.configService.get<boolean>('qualityGate.blockOnCriticalSecurity', DEFAULT_THRESHOLDS.blockOnCriticalSecurity),
      blockOnHighSecurity: this.configService.get<boolean>('qualityGate.blockOnHighSecurity', DEFAULT_THRESHOLDS.blockOnHighSecurity),
      maxComplexity: this.configService.get<number>('qualityGate.maxComplexity', DEFAULT_THRESHOLDS.maxComplexity),
      targetCoverage: this.configService.get<number>('qualityGate.targetCoverage', DEFAULT_THRESHOLDS.targetCoverage),
    };

    return {
      projectId,
      thresholds,
      enabledCategories: [
        QualityCategory.LINTING,
        QualityCategory.TESTING,
        QualityCategory.COVERAGE,
        QualityCategory.SECURITY,
      ],
      allowOverride: this.configService.get<boolean>('qualityGate.allowOverride', false),
      overrideRequiresApproval: true,
    };
  }

  /**
   * Calculate score for each quality category
   */
  private calculateCategoryScores(
    qaResult: any,
    thresholds: IQualityThresholds,
  ): ICategoryScore[] {
    const scores: ICategoryScore[] = [];

    // Linting Score (15%)
    scores.push(this.calculateLintingScore(qaResult, thresholds));

    // Testing Score (35%)
    scores.push(this.calculateTestingScore(qaResult, thresholds));

    // Coverage Score (25%)
    scores.push(this.calculateCoverageScore(qaResult, thresholds));

    // Security Score (25%)
    scores.push(this.calculateSecurityScore(qaResult, thresholds));

    return scores;
  }

  private calculateLintingScore(qaResult: any, thresholds: IQualityThresholds): ICategoryScore {
    const errors = qaResult.linting_errors?.errorCount || 0;
    const warnings = qaResult.linting_errors?.warningCount || 0;
    
    // 100 if passed, deduct for errors/warnings
    let score = 100;
    if (!qaResult.linting_passed) score -= 50;
    score -= Math.min(errors * 10, 40); // -10 per error, max -40
    score -= Math.min(warnings * 2, 10); // -2 per warning, max -10
    score = Math.max(0, score);

    return {
      category: QualityCategory.LINTING,
      score,
      weight: QUALITY_SCORE_WEIGHTS[QualityCategory.LINTING],
      passed: qaResult.linting_passed && errors <= thresholds.maxLintingErrors,
      details: [
        { metric: 'errors', value: errors, threshold: thresholds.maxLintingErrors },
        { metric: 'warnings', value: warnings, threshold: thresholds.maxLintingWarnings },
      ],
    };
  }

  private calculateTestingScore(qaResult: any, thresholds: IQualityThresholds): ICategoryScore {
    const testResults = qaResult.test_results || { passed: 0, failed: 0, skipped: 0 };
    const total = testResults.passed + testResults.failed;
    const passRate = total > 0 ? (testResults.passed / total) * 100 : 100;
    
    // Score based on pass rate
    const score = Math.min(100, passRate);
    
    return {
      category: QualityCategory.TESTING,
      score,
      weight: QUALITY_SCORE_WEIGHTS[QualityCategory.TESTING],
      passed: qaResult.tests_passed && passRate >= thresholds.minTestPassRate,
      details: [
        { metric: 'pass_rate', value: passRate, threshold: thresholds.minTestPassRate },
        { metric: 'passed', value: testResults.passed, threshold: 0 },
        { metric: 'failed', value: testResults.failed, threshold: 0 },
      ],
    };
  }

  private calculateCoverageScore(qaResult: any, thresholds: IQualityThresholds): ICategoryScore {
    const coverage = qaResult.test_coverage ?? 0;
    
    // Score scaled between min and target coverage
    // Below min = 0, at target = 100, linear in between
    let score: number;
    if (coverage >= thresholds.targetCoverage) {
      score = 100;
    } else if (coverage < thresholds.minCoverage) {
      score = (coverage / thresholds.minCoverage) * 50; // 0-50 below minimum
    } else {
      // Between min and target: 50-100
      const range = thresholds.targetCoverage - thresholds.minCoverage;
      const progress = coverage - thresholds.minCoverage;
      score = 50 + (progress / range) * 50;
    }

    return {
      category: QualityCategory.COVERAGE,
      score: Math.round(score),
      weight: QUALITY_SCORE_WEIGHTS[QualityCategory.COVERAGE],
      passed: coverage >= thresholds.minCoverage,
      details: [
        { metric: 'coverage', value: coverage, threshold: thresholds.minCoverage },
        { metric: 'target', value: coverage, threshold: thresholds.targetCoverage },
      ],
    };
  }

  private calculateSecurityScore(qaResult: any, thresholds: IQualityThresholds): ICategoryScore {
    const issues = qaResult.code_review_issues?.summary || {};
    const criticalCount = issues.criticalCount || 0;
    const highCount = issues.highCount || 0;
    const mediumCount = issues.mediumCount || 0;
    
    // Deduct heavily for critical/high, less for medium
    let score = 100;
    score -= criticalCount * 30;
    score -= highCount * 15;
    score -= mediumCount * 5;
    score = Math.max(0, score);

    const passed = qaResult.code_review_passed &&
      (thresholds.blockOnCriticalSecurity ? criticalCount === 0 : true) &&
      (thresholds.blockOnHighSecurity ? highCount === 0 : true);

    return {
      category: QualityCategory.SECURITY,
      score,
      weight: QUALITY_SCORE_WEIGHTS[QualityCategory.SECURITY],
      passed,
      details: [
        { metric: 'critical', value: criticalCount, threshold: 0 },
        { metric: 'high', value: highCount, threshold: 0 },
        { metric: 'medium', value: mediumCount, threshold: 0 },
      ],
    };
  }

  /**
   * Calculate overall weighted score
   */
  private calculateOverallScore(categoryScores: ICategoryScore[]): number {
    const weightedSum = categoryScores.reduce(
      (sum, cat) => sum + (cat.score * cat.weight),
      0
    );
    const totalWeight = categoryScores.reduce((sum, cat) => sum + cat.weight, 0);
    return Math.round(weightedSum / totalWeight);
  }

  /**
   * Identify blocking issues that fail the gate
   */
  private determineBlockingIssues(
    qaResult: any,
    thresholds: IQualityThresholds,
  ): IBlockingIssue[] {
    const blockers: IBlockingIssue[] = [];

    // Test failures
    if (!qaResult.tests_passed) {
      const testResults = qaResult.test_results || {};
      blockers.push({
        type: BlockerType.TEST_FAILURE,
        category: QualityCategory.TESTING,
        message: `${testResults.failed || 0} test(s) failed`,
        details: { testResults },
      });
    }

    // Linting errors (not warnings)
    if (!qaResult.linting_passed) {
      const errors = qaResult.linting_errors?.errorCount || 0;
      if (errors > thresholds.maxLintingErrors) {
        blockers.push({
          type: BlockerType.LINTING_ERROR,
          category: QualityCategory.LINTING,
          message: `${errors} linting error(s) found (max: ${thresholds.maxLintingErrors})`,
          details: { errors },
        });
      }
    }

    // Critical security vulnerabilities
    const securitySummary = qaResult.code_review_issues?.summary || {};
    if (thresholds.blockOnCriticalSecurity && securitySummary.criticalCount > 0) {
      blockers.push({
        type: BlockerType.CRITICAL_SECURITY,
        category: QualityCategory.SECURITY,
        message: `${securitySummary.criticalCount} critical security vulnerability(ies) found`,
        details: { criticalCount: securitySummary.criticalCount },
      });
    }

    // High security vulnerabilities (if configured to block)
    if (thresholds.blockOnHighSecurity && securitySummary.highCount > 0) {
      blockers.push({
        type: BlockerType.CRITICAL_SECURITY,
        category: QualityCategory.SECURITY,
        message: `${securitySummary.highCount} high-severity security vulnerability(ies) found`,
        details: { highCount: securitySummary.highCount },
      });
    }

    // Coverage below minimum
    const coverage = qaResult.test_coverage ?? 0;
    if (coverage < thresholds.minCoverage) {
      blockers.push({
        type: BlockerType.COVERAGE_BELOW_MINIMUM,
        category: QualityCategory.COVERAGE,
        message: `Coverage ${coverage.toFixed(1)}% is below minimum ${thresholds.minCoverage}%`,
        details: { coverage, minimum: thresholds.minCoverage },
      });
    }

    return blockers;
  }

  /**
   * Identify warning issues (don't block but worth noting)
   */
  private determineWarningIssues(
    qaResult: any,
    thresholds: IQualityThresholds,
  ): IWarningIssue[] {
    const warnings: IWarningIssue[] = [];

    // Linting warnings (if above threshold)
    const warningCount = qaResult.linting_errors?.warningCount || 0;
    if (warningCount > thresholds.maxLintingWarnings) {
      warnings.push({
        type: WarningType.LINTING_WARNING,
        category: QualityCategory.LINTING,
        message: `${warningCount} linting warning(s) (threshold: ${thresholds.maxLintingWarnings})`,
        details: { warnings: warningCount },
      });
    }

    // Coverage below target (but above minimum)
    const coverage = qaResult.test_coverage ?? 0;
    if (coverage >= thresholds.minCoverage && coverage < thresholds.targetCoverage) {
      warnings.push({
        type: WarningType.COVERAGE_BELOW_TARGET,
        category: QualityCategory.COVERAGE,
        message: `Coverage ${coverage.toFixed(1)}% is below target ${thresholds.targetCoverage}%`,
        details: { coverage, target: thresholds.targetCoverage },
      });
    }

    // Medium/low security issues
    const securitySummary = qaResult.code_review_issues?.summary || {};
    if (securitySummary.mediumCount > 0) {
      warnings.push({
        type: WarningType.LOW_SEVERITY_VULN,
        category: QualityCategory.SECURITY,
        message: `${securitySummary.mediumCount} medium-severity issue(s) found`,
        details: { mediumCount: securitySummary.mediumCount },
      });
    }

    // Complexity issues
    const complexityIssues = qaResult.code_review_issues?.complexityIssues || [];
    if (complexityIssues.length > 0) {
      warnings.push({
        type: WarningType.HIGH_COMPLEXITY,
        category: QualityCategory.SECURITY,
        message: `${complexityIssues.length} high-complexity function(s) detected`,
        details: { count: complexityIssues.length },
      });
    }

    return warnings;
  }

  private determineStatus(passed: boolean, warningCount: number): QualityGateStatus {
    if (!passed) return QualityGateStatus.FAILED;
    if (warningCount > 0) return QualityGateStatus.WARNING;
    return QualityGateStatus.PASSED;
  }

  private determineNextAction(
    passed: boolean,
    warnings: IWarningIssue[],
  ): IQualityGateResult['nextAction'] {
    if (!passed) return 'notify_pm_failure';
    if (warnings.length > 5) return 'manual_review'; // Many warnings = human review
    return 'proceed_to_github';
  }
}
```

---

### Step 4: QaOrchestratorService

**File:** `src/qa-automation/qa-orchestrator.service.ts`

```typescript
import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { PrismaService } from '../database/prisma.service';
import { SentryService } from '../common/sentry/sentry.service';
import { ErrorCategory } from '../common/sentry/sentry.constants';
import { QA_METRICS } from '../common/metrics/metrics.constants';
import { QUEUE_NAMES, ROUTING_KEYS } from '../rabbitmq/rabbitmq.config';
import { QualityGatesService } from './quality-gates.service';
// Import QA services from Stories 3.1-3.4 when available
// import { LinterService } from './linter.service';
// import { TestRunnerService } from './test-runner.service';
// import { CoverageService } from './coverage.service';
// import { CodeReviewService } from './code-review.service';
import { 
  IQaCheckMessage, 
  IQaOrchestrationResult,
  QualityCategory,
} from './interfaces';
import { TicketStatus } from '@prisma/client';

@Injectable()
export class QaOrchestratorService {
  private readonly logger = new Logger(QaOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sentry: SentryService,
    private readonly qualityGatesService: QualityGatesService,
    // Inject QA services (from Stories 3.1-3.4) when available
    // private readonly linterService: LinterService,
    // private readonly testRunnerService: TestRunnerService,
    // private readonly coverageService: CoverageService,
    // private readonly codeReviewService: CodeReviewService,
    @Inject('RABBITMQ_SERVICE') private readonly client: ClientProxy,
    @InjectMetric(QA_METRICS.CHECKS_TOTAL)
    private readonly checksCounter: Counter<string>,
    @InjectMetric(QA_METRICS.CHECK_DURATION)
    private readonly checkDuration: Histogram<string>,
  ) {}

  /**
   * Main entry point - processes QA check message from RabbitMQ
   */
  async processQaCheck(message: IQaCheckMessage): Promise<IQaOrchestrationResult> {
    const { executionId, ticketId, projectId, correlationId, workspacePath, skipCategories = [] } = message;
    const startTime = Date.now();
    const endTimer = this.checkDuration.startTimer({ check_type: 'full' });

    this.logger.log(`[${correlationId}] Starting QA orchestration for execution ${executionId}`);

    try {
      // Update ticket status to show QA is in progress
      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: TicketStatus.QA_REVIEW },
      });

      // Run all QA checks in parallel
      const [lintingResult, testResult, coverageResult, securityResult] = await Promise.allSettled([
        this.runLinting(workspacePath, correlationId, skipCategories),
        this.runTests(workspacePath, correlationId, skipCategories),
        this.runCoverage(workspacePath, correlationId, skipCategories),
        this.runSecurityChecks(workspacePath, correlationId, skipCategories),
      ]);

      // Extract results (handle rejections gracefully)
      const qaResult = {
        linting_passed: this.extractPassed(lintingResult, true),
        linting_errors: this.extractValue(lintingResult, null),
        tests_passed: this.extractPassed(testResult, true),
        test_results: this.extractValue(testResult, { passed: 0, failed: 0 }),
        test_coverage: this.extractValue(coverageResult, null)?.coverage ?? null,
        code_review_passed: this.extractPassed(securityResult, true),
        code_review_issues: this.extractValue(securityResult, null),
      };

      // Save intermediate QA results to database
      await this.saveQaResult(executionId, qaResult);

      // Evaluate quality gates
      const qualityGateResult = await this.qualityGatesService.evaluate(
        executionId,
        correlationId,
        projectId,
        qaResult,
      );

      // Update QAResult with overall status
      await this.updateOverallStatus(executionId, qualityGateResult.passed);

      // Update ticket status based on gate result
      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: qualityGateResult.ticketStatusUpdate },
      });

      // Create audit log
      await this.createAuditLog(executionId, ticketId, qualityGateResult);

      // Determine next action
      if (qualityGateResult.passed) {
        // Publish to deployment queue for GitHub integration
        this.client.emit(ROUTING_KEYS.QA_CHECK_COMPLETED, {
          executionId,
          ticketId,
          correlationId,
          qualityScore: qualityGateResult.overallScore,
        });
        this.logger.log(`[${correlationId}] QA passed, published to deployment queue`);
      } else {
        // Emit failure event for PM notification (Story 10.4)
        this.client.emit(ROUTING_KEYS.QA_CHECK_FAILED, {
          executionId,
          ticketId,
          correlationId,
          blockingIssues: qualityGateResult.blockingIssues,
          qualityScore: qualityGateResult.overallScore,
        });
        this.logger.log(`[${correlationId}] QA failed, notifying PM`);
      }

      // Track metrics
      this.checksCounter.inc({ 
        result: qualityGateResult.passed ? 'passed' : 'failed',
        project_id: projectId,
      });

      return {
        executionId,
        correlationId,
        lintingResult: this.extractValue(lintingResult, null),
        testResult: this.extractValue(testResult, null),
        coverageResult: this.extractValue(coverageResult, null),
        securityResult: this.extractValue(securityResult, null),
        qualityGateResult,
      };
    } catch (error) {
      this.checksCounter.inc({ result: 'error', project_id: projectId });
      this.sentry.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId, ticketId, correlationId },
      });

      // Update ticket status to failed
      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: TicketStatus.QA_FAILED },
      });

      throw error;
    } finally {
      endTimer();
      this.logger.log(
        `[${correlationId}] QA orchestration completed in ${Date.now() - startTime}ms`
      );
    }
  }

  // Placeholder methods - will call actual services from Stories 3.1-3.4
  private async runLinting(workspacePath: string, correlationId: string, skip: QualityCategory[]): Promise<any> {
    if (skip.includes(QualityCategory.LINTING)) {
      return { passed: true, skipped: true };
    }
    // TODO: Call LinterService.lint(workspacePath, correlationId)
    this.logger.debug(`[${correlationId}] Running linting (placeholder)`);
    return { passed: true, errorCount: 0, warningCount: 0 };
  }

  private async runTests(workspacePath: string, correlationId: string, skip: QualityCategory[]): Promise<any> {
    if (skip.includes(QualityCategory.TESTING)) {
      return { passed: true, skipped: true };
    }
    // TODO: Call TestRunnerService.run(workspacePath, correlationId)
    this.logger.debug(`[${correlationId}] Running tests (placeholder)`);
    return { passed: true, total: 0, failed: 0, skipped: 0 };
  }

  private async runCoverage(workspacePath: string, correlationId: string, skip: QualityCategory[]): Promise<any> {
    if (skip.includes(QualityCategory.COVERAGE)) {
      return { passed: true, skipped: true, coverage: 100 };
    }
    // TODO: Call CoverageService.calculate(workspacePath, correlationId)
    this.logger.debug(`[${correlationId}] Calculating coverage (placeholder)`);
    return { passed: true, coverage: 85 };
  }

  private async runSecurityChecks(workspacePath: string, correlationId: string, skip: QualityCategory[]): Promise<any> {
    if (skip.includes(QualityCategory.SECURITY)) {
      return { passed: true, skipped: true };
    }
    // TODO: Call CodeReviewService.scan({ workspacePath, correlationId })
    this.logger.debug(`[${correlationId}] Running security checks (placeholder)`);
    return { passed: true, summary: { criticalCount: 0, highCount: 0 } };
  }

  private extractPassed(result: PromiseSettledResult<any>, defaultValue: boolean): boolean {
    if (result.status === 'fulfilled') {
      return result.value?.passed ?? defaultValue;
    }
    return false; // If rejected, treat as failed
  }

  private extractValue<T>(result: PromiseSettledResult<T>, defaultValue: T): T {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return defaultValue;
  }

  private async saveQaResult(executionId: string, qaResult: any): Promise<void> {
    const existing = await this.prisma.qAResult.findFirst({
      where: { execution_id: executionId },
    });

    if (existing) {
      await this.prisma.qAResult.update({
        where: { id: existing.id },
        data: {
          linting_passed: qaResult.linting_passed,
          linting_errors: qaResult.linting_errors,
          tests_passed: qaResult.tests_passed,
          test_results: qaResult.test_results,
          test_coverage: qaResult.test_coverage,
          code_review_passed: qaResult.code_review_passed,
          code_review_issues: qaResult.code_review_issues,
        },
      });
    } else {
      await this.prisma.qAResult.create({
        data: {
          execution_id: executionId,
          linting_passed: qaResult.linting_passed,
          linting_errors: qaResult.linting_errors,
          tests_passed: qaResult.tests_passed,
          test_results: qaResult.test_results,
          test_coverage: qaResult.test_coverage,
          code_review_passed: qaResult.code_review_passed,
          code_review_issues: qaResult.code_review_issues,
          overall_passed: false, // Will be updated after gate evaluation
        },
      });
    }
  }

  private async updateOverallStatus(executionId: string, passed: boolean): Promise<void> {
    await this.prisma.qAResult.updateMany({
      where: { execution_id: executionId },
      data: { overall_passed: passed },
    });
  }

  private async createAuditLog(
    executionId: string,
    ticketId: string,
    result: any,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        entity_type: 'execution',
        entity_id: executionId,
        action: 'quality_gate_evaluated',
        actor_type: 'system',
        changes: {
          passed: result.passed,
          score: result.overallScore,
          status: result.status,
          blockingIssues: result.blockingIssues.length,
          warningIssues: result.warningIssues.length,
          correlationId: result.correlationId,
        },
      },
    });
  }
}
```

---

### Step 5: RabbitMQ Consumer

**File:** `src/qa-automation/qa-orchestrator.consumer.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe, Nack } from '@golevelup/nestjs-rabbitmq';
import { QUEUE_NAMES } from '../rabbitmq/rabbitmq.config';
import { SentryService } from '../common/sentry/sentry.service';
import { ErrorCategory } from '../common/sentry/sentry.constants';
import { QaOrchestratorService } from './qa-orchestrator.service';
import { IQaCheckMessage } from './interfaces';

@Injectable()
export class QaOrchestratorConsumer {
  private readonly logger = new Logger(QaOrchestratorConsumer.name);

  constructor(
    private readonly orchestratorService: QaOrchestratorService,
    private readonly sentry: SentryService,
  ) {}

  @RabbitSubscribe({
    queue: QUEUE_NAMES.QA_CHECK,
    queueOptions: { durable: true },
  })
  async handleQaCheck(message: IQaCheckMessage): Promise<void | Nack> {
    const { executionId, correlationId } = message;
    this.logger.log(`[${correlationId}] Received QA check message for execution ${executionId}`);

    try {
      await this.orchestratorService.processQaCheck(message);
      this.logger.log(`[${correlationId}] QA check completed for execution ${executionId}`);
    } catch (error) {
      this.logger.error(`[${correlationId}] QA check failed: ${(error as Error).message}`);
      this.sentry.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { executionId, correlationId },
      });
      // Return Nack to send to dead-letter queue
      return new Nack(false);
    }
  }
}
```

---

### Step 6: QaResultsService + Controller

**File:** `src/qa-automation/qa-results.service.ts`

```typescript
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { IQualityGateResult } from './interfaces';

@Injectable()
export class QaResultsService {
  private readonly logger = new Logger(QaResultsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async saveResult(executionId: string, result: Partial<any>): Promise<void> {
    const existing = await this.prisma.qAResult.findFirst({
      where: { execution_id: executionId },
    });

    if (existing) {
      await this.prisma.qAResult.update({
        where: { id: existing.id },
        data: result,
      });
    } else {
      await this.prisma.qAResult.create({
        data: { execution_id: executionId, ...result },
      });
    }
  }

  async getResult(executionId: string): Promise<any> {
    const result = await this.prisma.qAResult.findFirst({
      where: { execution_id: executionId },
    });
    if (!result) throw new NotFoundException(`QA result not found for execution ${executionId}`);
    return result;
  }

  async getResultsByTicket(ticketId: string): Promise<any[]> {
    const executions = await this.prisma.execution.findMany({
      where: { ticket_id: ticketId },
      select: { id: true },
    });
    const executionIds = executions.map(e => e.id);
    
    return this.prisma.qAResult.findMany({
      where: { execution_id: { in: executionIds } },
      orderBy: { created_at: 'desc' },
    });
  }

  async getResultsByProject(projectId: string, filters?: { status?: 'passed' | 'failed' }): Promise<any[]> {
    const tickets = await this.prisma.ticket.findMany({
      where: { project_id: projectId },
      select: { id: true },
    });
    const ticketIds = tickets.map(t => t.id);
    
    const executions = await this.prisma.execution.findMany({
      where: { ticket_id: { in: ticketIds } },
      select: { id: true },
    });
    const executionIds = executions.map(e => e.id);

    return this.prisma.qAResult.findMany({
      where: {
        execution_id: { in: executionIds },
        ...(filters?.status === 'passed' && { overall_passed: true }),
        ...(filters?.status === 'failed' && { overall_passed: false }),
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async overrideQualityGate(
    executionId: string,
    reason: string,
    approvedBy: string,
  ): Promise<void> {
    // Update QA result to passed (emergency override)
    await this.prisma.qAResult.updateMany({
      where: { execution_id: executionId },
      data: { overall_passed: true },
    });

    // Create audit log for override
    await this.prisma.auditLog.create({
      data: {
        entity_type: 'qa_result',
        entity_id: executionId,
        action: 'quality_gate_override',
        actor_type: 'user',
        actor_id: approvedBy,
        changes: { reason, overrideAt: new Date().toISOString() },
      },
    });

    this.logger.warn(`Quality gate override for execution ${executionId} by ${approvedBy}: ${reason}`);
  }
}
```

**File:** `src/qa-automation/qa-results.controller.ts`

```typescript
import { Controller, Get, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { QaResultsService } from './qa-results.service';

@ApiTags('QA Results')
@Controller('api/v1/qa-results')
@UseGuards(JwtAuthGuard)
export class QaResultsController {
  constructor(private readonly qaResultsService: QaResultsService) {}

  @Get(':executionId')
  @ApiOperation({ summary: 'Get QA result by execution ID' })
  async getByExecutionId(@Param('executionId') executionId: string) {
    return this.qaResultsService.getResult(executionId);
  }

  @Get()
  @ApiOperation({ summary: 'Query QA results with filters' })
  async query(
    @Query('ticketId') ticketId?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: 'passed' | 'failed',
  ) {
    if (ticketId) {
      return this.qaResultsService.getResultsByTicket(ticketId);
    }
    if (projectId) {
      return this.qaResultsService.getResultsByProject(projectId, { status });
    }
    return [];
  }
}

@ApiTags('Quality Gate')
@Controller('api/v1/quality-gate')
@UseGuards(JwtAuthGuard, RolesGuard)
export class QualityGateController {
  constructor(private readonly qaResultsService: QaResultsService) {}

  @Post(':executionId/override')
  @Roles('lead_qa', 'manager')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Emergency override quality gate (requires approval)' })
  async override(
    @Param('executionId') executionId: string,
    @Body() body: { reason: string; approvedBy: string },
  ) {
    await this.qaResultsService.overrideQualityGate(executionId, body.reason, body.approvedBy);
    return { success: true, message: 'Quality gate overridden' };
  }
}
```

---

### Step 7: Add Metrics

**File:** `src/common/metrics/metrics.constants.ts` (ADD to QA_METRICS)

```typescript
// ADD these to existing QA_METRICS object:
QUALITY_GATE_EVALUATIONS_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_quality_gate_evaluations_total`,
QUALITY_GATE_DURATION: `${METRICS_CONSTANTS.PREFIX}qa_quality_gate_duration_seconds`,
QUALITY_SCORE_HISTOGRAM: `${METRICS_CONSTANTS.PREFIX}qa_quality_score`,
```

---

### Step 8: Configuration

**File:** `src/config/configuration.ts` (ADD)

```typescript
qualityGate: {
  minTestPassRate: parseInt(process.env.QG_MIN_TEST_PASS_RATE || '100', 10),
  minCoverage: parseInt(process.env.QG_MIN_COVERAGE || '80', 10),
  targetCoverage: parseInt(process.env.QG_TARGET_COVERAGE || '90', 10),
  maxLintingErrors: parseInt(process.env.QG_MAX_LINTING_ERRORS || '0', 10),
  maxLintingWarnings: parseInt(process.env.QG_MAX_LINTING_WARNINGS || '10', 10),
  blockOnCriticalSecurity: process.env.QG_BLOCK_CRITICAL !== 'false',
  blockOnHighSecurity: process.env.QG_BLOCK_HIGH !== 'false',
  maxComplexity: parseInt(process.env.QG_MAX_COMPLEXITY || '20', 10),
  allowOverride: process.env.QG_ALLOW_OVERRIDE === 'true',
  // Per-category timeouts (ms)
  lintingTimeoutMs: parseInt(process.env.QG_LINTING_TIMEOUT_MS || '60000', 10),
  testingTimeoutMs: parseInt(process.env.QG_TESTING_TIMEOUT_MS || '300000', 10),
  coverageTimeoutMs: parseInt(process.env.QG_COVERAGE_TIMEOUT_MS || '60000', 10),
  securityTimeoutMs: parseInt(process.env.QG_SECURITY_TIMEOUT_MS || '180000', 10),
},
```

**File:** `src/config/env.validation.ts` (ADD)

```typescript
// ADD these to EnvironmentVariables class:
@IsOptional()
@IsNumber()
@Transform(({ value }) => parseInt(value, 10))
QG_MIN_TEST_PASS_RATE?: number;

@IsOptional()
@IsNumber()
@Transform(({ value }) => parseInt(value, 10))
QG_MIN_COVERAGE?: number;

@IsOptional()
@IsNumber()
@Transform(({ value }) => parseInt(value, 10))
QG_TARGET_COVERAGE?: number;

@IsOptional()
@IsNumber()
@Transform(({ value }) => parseInt(value, 10))
QG_MAX_LINTING_ERRORS?: number;

@IsOptional()
@IsNumber()
@Transform(({ value }) => parseInt(value, 10))
QG_MAX_LINTING_WARNINGS?: number;

@IsOptional()
@IsString()
QG_BLOCK_CRITICAL?: string;

@IsOptional()
@IsString()
QG_BLOCK_HIGH?: string;

@IsOptional()
@IsNumber()
@Transform(({ value }) => parseInt(value, 10))
QG_MAX_COMPLEXITY?: number;

@IsOptional()
@IsString()
QG_ALLOW_OVERRIDE?: string;

// Per-category timeouts
@IsOptional()
@IsNumber()
@Transform(({ value }) => parseInt(value, 10))
QG_LINTING_TIMEOUT_MS?: number;

@IsOptional()
@IsNumber()
@Transform(({ value }) => parseInt(value, 10))
QG_TESTING_TIMEOUT_MS?: number;

@IsOptional()
@IsNumber()
@Transform(({ value }) => parseInt(value, 10))
QG_COVERAGE_TIMEOUT_MS?: number;

@IsOptional()
@IsNumber()
@Transform(({ value }) => parseInt(value, 10))
QG_SECURITY_TIMEOUT_MS?: number;
```

---

## Testing Requirements

### Unit Tests

```typescript
describe('QualityGatesService', () => {
  it('should return PASSED with score=100 when SAMPLE_QA_RESULT used');
  it('should return FAILED with blockers when SAMPLE_FAILING_QA_RESULT used');
  it('should fail when tests_passed=false (BlockerType.TEST_FAILURE)');
  it('should fail when criticalCount > 0 (BlockerType.CRITICAL_SECURITY)');
  it('should fail when coverage < minCoverage (BlockerType.COVERAGE_BELOW_MINIMUM)');
  it('should warn when coverage >= 80 but < 90 (WarningType.COVERAGE_BELOW_TARGET)');
  it('should calculate weighted score: (15*lint + 35*test + 25*cov + 25*sec) / 100');
  it('should return nextAction="proceed_to_github" when passed with no warnings');
  it('should return nextAction="manual_review" when passed with >5 warnings');
  it('should return nextAction="notify_pm_failure" when failed');
});

describe('QaOrchestratorService', () => {
  it('should run all 4 QA checks in parallel via Promise.allSettled');
  it('should handle individual check failures gracefully (extractPassed returns false)');
  it('should update ticket.status to QA_REVIEW when passed');
  it('should update ticket.status to QA_FAILED when failed');
  it('should emit ROUTING_KEYS.QA_CHECK_COMPLETED when passed');
  it('should emit ROUTING_KEYS.QA_CHECK_FAILED when failed');
  it('should create audit log with score, status, blockingIssues count');
  it('should respect skipCategories in message');
});

describe('QaResultsService', () => {
  it('should save new QA result when none exists');
  it('should update existing QA result when one exists');
  it('should throw NotFoundException when getResult called with invalid id');
  it('should return results filtered by overall_passed status');
});

describe('QaOrchestratorConsumer', () => {
  it('should call orchestratorService.processQaCheck on message');
  it('should return Nack(false) on error to send to DLQ');
  it('should capture exception to Sentry on error');
});
```

---

## Prerequisites

| Story | Status | Required For |
|-------|--------|--------------|
| Story 1.3 (Database) | ✅ done | `qa_results`, `audit_logs` tables |
| Story 1.5 (RabbitMQ) | ✅ done | Message queues |
| Story 1.8 (Prometheus) | ✅ done | Metrics infrastructure |
| Story 1.9 (Sentry) | ✅ done | Error tracking |
| Story 3.1 (Linting) | ready-for-dev | LinterService integration |
| Story 3.2 (Test Execution) | ready-for-dev | TestRunnerService integration |
| Story 3.3 (Coverage) | ready-for-dev | CoverageService integration |
| Story 3.4 (Security) | ready-for-dev | CodeReviewService integration |

---

## References

| Source | Section |
|--------|---------|
| `docs/architecture.md` | Line 158: `quality-gates.service.ts`, Line 153: `qa-orchestrator.service.ts` |
| `docs/epics.md` | Story 3.5 acceptance criteria |
| `docs/prd.md` | FR70: System blocks deployment if quality gates fail |
| `prisma/schema.prisma` | QAResult model |

---

## Dev Agent Record

### Context Reference

- Uses `quality-gates.service.ts` per architecture.md line 158
- Uses `qa-orchestrator.service.ts` per architecture.md line 153
- Orchestrates Stories 3.1-3.4 QA services
- Publishes to `deployment-queue` per rabbitmq.config.ts

### Agent Model Used

{{agent_model_name_version}}

### Change Log

| Date | Change | Author |
|------|--------|--------|
| 2025-12-03 | Story drafted with full implementation guide | Scrum Master Bob |
| 2025-12-03 | Quality review: Fixed 3 critical, 4 enhancements, 3 optimizations | Quality Validator |
| 2025-12-05 | Code review fixes: Security guards, RabbitMQ consumer, ESLint errors, QA service integration | Adversarial Code Review |

### Improvements Applied

- ✅ **CRITICAL:** Added Task 1 to verify/add `ErrorCategory.QA_AUTOMATION` to sentry.constants.ts
- ✅ **CRITICAL:** Fixed typo in runTests() - duplicate `passed` key → `total`
- ✅ **CRITICAL:** Added QaResultsService + QaResultsController full implementation (Step 6)
- ✅ **ENHANCEMENT:** Added QaOrchestratorConsumer with `@RabbitSubscribe` decorator (Step 5)
- ✅ **ENHANCEMENT:** Added per-category timeout configuration (QG_*_TIMEOUT_MS env vars)
- ✅ **ENHANCEMENT:** Added `SAMPLE_FAILING_QA_RESULT` constant for testing failure paths
- ✅ **ENHANCEMENT:** Added full env.validation.ts implementation with all QG_* variables
- ✅ **OPTIMIZATION:** Fixed anti-patterns table (removed confusing row, added relevant ones)
- ✅ **OPTIMIZATION:** Added emergency override API endpoint: `POST /api/v1/quality-gate/:executionId/override`
- ✅ **OPTIMIZATION:** Enhanced unit tests with specific expected values and edge cases
- ✅ **LLM:** Updated file count from 15 → 17 to reflect all new files

### File List

**Created/Modified for Story 3.5:**
- `src/qa-automation/interfaces/quality-gate.interface.ts` - Types and interfaces
- `src/qa-automation/interfaces/index.ts` - Barrel export (modified)
- `src/qa-automation/dto/quality-gate.dto.ts` - DTOs with validation
- `src/qa-automation/dto/index.ts` - Barrel export (modified)
- `src/qa-automation/quality-gates.service.ts` - Main quality gate engine
- `src/qa-automation/quality-gates.service.spec.ts` - Unit tests
- `src/qa-automation/qa-orchestrator.service.ts` - Orchestrates QA services
- `src/qa-automation/qa-orchestrator.service.spec.ts` - Unit tests
- `src/qa-automation/qa-orchestrator.consumer.ts` - RabbitMQ consumer
- `src/qa-automation/qa-results.service.ts` - Storage and retrieval
- `src/qa-automation/qa-results.controller.ts` - API endpoints
- `src/qa-automation/qa-automation.module.ts` - Module wiring (modified)
- `src/common/metrics/metrics.constants.ts` - Quality gate metrics (modified)
- `src/config/configuration.ts` - Quality gate config (modified)
- `src/config/env.validation.ts` - Env var validation (modified)
- `test/qa-orchestrator.e2e-spec.ts` - E2E tests

