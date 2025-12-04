# Story 3.1: Linting Integration for Multiple Languages

**Epic:** 3 - Automated QA & Quality Gates  
**Status:** Done  
**Priority:** P1 - HIGH  
**Effort:** 5 story points  
**ClickUp ID:** `86evnjwb4`  
**ClickUp URL:** https://app.clickup.com/t/86evnjwb4

---

## Story

As the system,
I want to run language-specific linters on AI-generated code,
So that code style and syntax errors are caught automatically.

---

## Acceptance Criteria

**Given** AI generates code for a ticket  
**When** QA automation runs  
**Then** appropriate linters execute based on file types:

- JavaScript/TypeScript: ESLint with project config
- Python: Flake8
- Go: golangci-lint

**And** linting results include:

- Error count and warning count
- Line numbers for each issue
- Error descriptions and suggested fixes
- Overall pass/fail status

**And** linting configuration uses project-specific rules (`.eslintrc`, `.flake8`, etc.)

**And** if linting fails:

- Execution marked as `QA_FAILED` in database
- Results stored in `qa_results` table
- PM notified with specific line numbers (via Story 10.4 Socket.IO)

---

## Quick Implementation Summary (TL;DR)

**7 Key Files in Implementation Order:**

1. `src/qa-automation/interfaces/linting.interface.ts` - Types
2. `src/qa-automation/dto/linting-result.dto.ts` - DTOs
3. `src/qa-automation/linter.service.ts` - Core logic
4. `src/qa-automation/qa-automation.module.ts` - Wire module
5. `src/common/metrics/metrics.constants.ts` - ADD to existing QA_METRICS
6. `src/app.module.ts` - Import QaAutomationModule
7. `src/qa-automation/linter.service.spec.ts` - Unit tests

**Install:**

```bash
npm install eslint @types/eslint
```

---

## ⚠️ Anti-Patterns to Avoid

| ❌ DO NOT                                            | ✅ DO INSTEAD                                            |
| ---------------------------------------------------- | -------------------------------------------------------- |
| Create new `QA_METRICS` object                       | ADD to existing `QA_METRICS` in `metrics.constants.ts`   |
| Use unprefixed metric names                          | Always use `dsf_` prefix from `METRICS_CONSTANTS.PREFIX` |
| Call external linters without checking binary exists | Check `flake8`/`golangci-lint` availability first        |
| Forget to import module in `app.module.ts`           | Add `QaAutomationModule` to imports                      |
| Use `qa-tasks` queue name                            | Use `qa-check-queue` (from `QUEUE_NAMES` constant)       |

---

## Integration Context

### How This Story Fits in the Pipeline

```
Story 2.5 (Execution Tracking)
    ↓ execution completes with code_output
Story 3.7 (RabbitMQ QA Queue) - publishes to qa-check-queue
    ↓ message consumed
Story 3.5 (QA Orchestrator) - calls LinterService
    ↓ this story
Story 3.1 (Linting) - runs linters, saves results
    ↓ if passed
Story 4.x (GitHub Integration) - pushes code
```

### Key Integration Points

| From                              | Interface                              | To           |
| --------------------------------- | -------------------------------------- | ------------ |
| Story 3.5 `QAOrchestratorService` | calls `linterService.lintFiles()`      | This story   |
| This story                        | updates `QAResult.linting_passed`      | Database     |
| This story                        | updates `Ticket.status` to `QA_FAILED` | Database     |
| Story 10.4                        | reads results, emits Socket.IO         | PM Dashboard |

---

## Technical Requirements

### Files to Create/Modify

| File                                                | Action | Purpose                   |
| --------------------------------------------------- | ------ | ------------------------- |
| `src/qa-automation/interfaces/linting.interface.ts` | CREATE | Types                     |
| `src/qa-automation/interfaces/index.ts`             | CREATE | Barrel                    |
| `src/qa-automation/dto/linting-result.dto.ts`       | CREATE | DTOs                      |
| `src/qa-automation/dto/index.ts`                    | CREATE | Barrel                    |
| `src/qa-automation/linter.service.ts`               | CREATE | Core service              |
| `src/qa-automation/qa-automation.module.ts`         | MODIFY | Add providers             |
| `src/common/metrics/metrics.constants.ts`           | MODIFY | Add linting metrics       |
| `src/app.module.ts`                                 | MODIFY | Import QaAutomationModule |
| `src/qa-automation/linter.service.spec.ts`          | CREATE | Unit tests                |

---

## Tasks

- [x] **Task 1: Create Interfaces** (AC: #1, #2)
  - [x] `SupportedLanguage` enum, `LintingSeverity` enum
  - [x] `ILintingIssue`, `ILintingResult`, `ILintingOptions` interfaces
  - [x] `FILE_EXTENSION_MAP` constant

- [x] **Task 2: Create DTOs** (AC: #2)
  - [x] `LintingIssueDto`, `LintingResultDto` with validators

- [x] **Task 3: Implement LinterService** (AC: #1, #3)
  - [x] `lintFiles()` main method with language detection
  - [x] `lintTypeScript()` using ESLint Node.js API
  - [x] `lintPython()` using Flake8 CLI
  - [x] `lintGo()` using golangci-lint CLI
  - [x] Config file auto-detection
  - [x] **Linter binary availability check**

- [x] **Task 4: Database Integration** (AC: #4)
  - [x] `saveLintingResult()` - store in `qa_results`
  - [x] `updateTicketStatus()` - set `Ticket.status = QA_FAILED` on failure

- [x] **Task 5: Metrics Integration** (AC: #2)
  - [x] ADD metrics to existing `QA_METRICS` (NOT new object)
  - [x] Track executions, duration, issues by language

- [x] **Task 6: Wire Module** (AC: All)
  - [x] Update `QaAutomationModule` with providers
  - [x] **Add `QaAutomationModule` to `app.module.ts` imports** (already done)

- [x] **Task 7: Unit Tests** (AC: All)
  - [x] Language detection tests
  - [x] ESLint execution tests
  - [x] Result persistence tests
  - [x] > 80% coverage per NFR-M1

---

## Implementation Guide

### Step 1: Interfaces

**File:** `src/qa-automation/interfaces/linting.interface.ts`

```typescript
export enum SupportedLanguage {
  TYPESCRIPT = 'typescript',
  JAVASCRIPT = 'javascript',
  PYTHON = 'python',
  GO = 'go',
  UNKNOWN = 'unknown',
}

export const FILE_EXTENSION_MAP: Record<string, SupportedLanguage> = {
  '.ts': SupportedLanguage.TYPESCRIPT,
  '.tsx': SupportedLanguage.TYPESCRIPT,
  '.js': SupportedLanguage.JAVASCRIPT,
  '.jsx': SupportedLanguage.JAVASCRIPT,
  '.py': SupportedLanguage.PYTHON,
  '.go': SupportedLanguage.GO,
};

export enum LintingSeverity {
  ERROR = 'error',
  WARNING = 'warning',
  INFO = 'info',
}

export interface ILintingIssue {
  filePath: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: LintingSeverity;
  message: string;
  ruleId: string | null;
  fix?: { description: string; replacementText?: string };
}

export interface ILintingResult {
  passed: boolean;
  errorCount: number;
  warningCount: number;
  issues: ILintingIssue[];
  language: SupportedLanguage;
  filesLinted: string[];
  durationMs: number;
  configFile?: string;
}

export interface ILintingOptions {
  workspacePath: string;
  files: string[];
  configPath?: string;
  timeoutMs?: number; // Default: 60000
  autoFix?: boolean;
}
```

**File:** `src/qa-automation/interfaces/index.ts`

```typescript
export * from './linting.interface';
```

---

### Step 2: DTOs

**File:** `src/qa-automation/dto/linting-result.dto.ts`

Follow pattern from `src/webhooks/dto/task-event.dto.ts`:

- Use `class-validator` decorators
- Use `@nestjs/swagger` ApiProperty decorators
- Export `LintingIssueDto` and `LintingResultDto`

---

### Step 3: Update Metrics Constants (CRITICAL)

**File:** `src/common/metrics/metrics.constants.ts`

ADD to existing `QA_METRICS` object (lines 46-51):

```typescript
// Business Metrics - QA
export const QA_METRICS = {
  CHECKS_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_checks_total`,
  CHECK_DURATION: `${METRICS_CONSTANTS.PREFIX}qa_check_duration_seconds`,
  COVERAGE_PERCENT: `${METRICS_CONSTANTS.PREFIX}qa_test_coverage_percent`,
  VULNERABILITIES: `${METRICS_CONSTANTS.PREFIX}qa_security_vulnerabilities_total`,
  // ADD these for Story 3.1:
  LINTING_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_linting_total`,
  LINTING_DURATION: `${METRICS_CONSTANTS.PREFIX}qa_linting_duration_seconds`,
  LINTING_ISSUES: `${METRICS_CONSTANTS.PREFIX}qa_linting_issues`,
} as const;
```

---

### Step 4: LinterService Core

**File:** `src/qa-automation/linter.service.ts`

**Key Implementation Points:**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Counter, Histogram, Gauge } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { ESLint } from 'eslint';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PrismaService } from '../database/prisma.service';
import { SentryService } from '../common/sentry/sentry.service';
import { QA_METRICS } from '../common/metrics/metrics.constants';
import { ILintingResult, ILintingOptions, SupportedLanguage /* ... */ } from './interfaces';

const execAsync = promisify(exec);

@Injectable()
export class LinterService {
  private readonly logger = new Logger(LinterService.name);
  private readonly DEFAULT_TIMEOUT_MS = 60000;
  private lintingInProgress = new Map<string, boolean>(); // Prevent concurrent linting

  constructor(
    private readonly prisma: PrismaService,
    private readonly sentry: SentryService,
    @InjectMetric(QA_METRICS.LINTING_TOTAL) private readonly lintingCounter: Counter<string>,
    @InjectMetric(QA_METRICS.LINTING_DURATION) private readonly lintingDuration: Histogram<string>,
    @InjectMetric(QA_METRICS.LINTING_ISSUES) private readonly lintingIssues: Gauge<string>,
  ) {}

  /**
   * Main entry point - lint files in workspace
   */
  async lintFiles(options: ILintingOptions): Promise<ILintingResult> {
    const { workspacePath, files, timeoutMs = this.DEFAULT_TIMEOUT_MS } = options;

    // Prevent concurrent linting of same workspace
    if (this.lintingInProgress.get(workspacePath)) {
      throw new Error(`Linting already in progress for ${workspacePath}`);
    }
    this.lintingInProgress.set(workspacePath, true);

    const language = this.detectPrimaryLanguage(files);
    const endTimer = this.lintingDuration.startTimer({ language });

    try {
      let result: ILintingResult;

      switch (language) {
        case SupportedLanguage.TYPESCRIPT:
        case SupportedLanguage.JAVASCRIPT:
          result = await this.lintTypeScript(files, workspacePath, timeoutMs);
          break;
        case SupportedLanguage.PYTHON:
          await this.checkBinaryExists('flake8');
          result = await this.lintPython(files, workspacePath, timeoutMs);
          break;
        case SupportedLanguage.GO:
          await this.checkBinaryExists('golangci-lint');
          result = await this.lintGo(files, workspacePath, timeoutMs);
          break;
        default:
          result = this.createEmptyResult(language, files, Date.now());
      }

      // Track metrics
      this.lintingCounter.inc({ language, result: result.passed ? 'passed' : 'failed' });
      this.lintingIssues.set({ language, severity: 'error' }, result.errorCount);
      this.lintingIssues.set({ language, severity: 'warning' }, result.warningCount);

      return result;
    } catch (error) {
      this.lintingCounter.inc({ language, result: 'error' });
      this.sentry.captureException(error as Error);
      throw error;
    } finally {
      this.lintingInProgress.delete(workspacePath);
      endTimer();
    }
  }

  /**
   * Check if external linter binary is available
   */
  private async checkBinaryExists(binary: string): Promise<void> {
    try {
      await execAsync(`which ${binary}`);
    } catch {
      throw new Error(
        `Linter binary '${binary}' not found. Install with: ` +
          (binary === 'flake8'
            ? 'pip install flake8'
            : 'go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest'),
      );
    }
  }

  /**
   * Save result and update ticket status on failure
   */
  async saveLintingResult(executionId: string, result: ILintingResult): Promise<void> {
    // 1. Save to qa_results
    const existing = await this.prisma.qAResult.findFirst({
      where: { execution_id: executionId },
    });

    if (existing) {
      await this.prisma.qAResult.update({
        where: { id: existing.id },
        data: {
          linting_passed: result.passed,
          linting_errors: result.issues as unknown as object,
        },
      });
    } else {
      await this.prisma.qAResult.create({
        data: {
          execution_id: executionId,
          linting_passed: result.passed,
          linting_errors: result.issues as unknown as object,
          tests_passed: false,
          code_review_passed: false,
          overall_passed: false,
        },
      });
    }

    // 2. Update ticket status if linting failed
    if (!result.passed) {
      await this.updateTicketStatusOnFailure(executionId);
    }
  }

  /**
   * Mark ticket as QA_FAILED when linting fails
   */
  private async updateTicketStatusOnFailure(executionId: string): Promise<void> {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
    });

    if (execution) {
      await this.prisma.ticket.update({
        where: { id: execution.ticket_id },
        data: { status: 'QA_FAILED' },
      });

      this.logger.warn(`Ticket ${execution.ticket_id} marked as QA_FAILED due to linting failure`);
    }
  }

  // ... remaining methods: detectPrimaryLanguage, lintTypeScript, lintPython, lintGo
  // Follow patterns from webhooks.service.ts for error handling and logging
}
```

---

### Step 5: Update QaAutomationModule

**File:** `src/qa-automation/qa-automation.module.ts`

```typescript
import { Module } from '@nestjs/common';
import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';
import { DatabaseModule } from '../database/database.module';
import { SentryModule } from '../common/sentry/sentry.module';
import { LinterService } from './linter.service';
import { QA_METRICS, METRICS_CONSTANTS } from '../common/metrics/metrics.constants';

@Module({
  imports: [DatabaseModule, SentryModule],
  providers: [
    LinterService,
    makeCounterProvider({
      name: QA_METRICS.LINTING_TOTAL,
      help: 'Total linting executions',
      labelNames: ['language', 'result'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.LINTING_DURATION,
      help: 'Linting duration in seconds',
      labelNames: ['language'],
      buckets: METRICS_CONSTANTS.DEFAULT_BUCKETS,
    }),
    makeGaugeProvider({
      name: QA_METRICS.LINTING_ISSUES,
      help: 'Current linting issue count',
      labelNames: ['language', 'severity'],
    }),
  ],
  exports: [LinterService],
})
export class QaAutomationModule {}
```

---

### Step 6: Update AppModule (CRITICAL)

**File:** `src/app.module.ts`

```typescript
// ADD import
import { QaAutomationModule } from './qa-automation/qa-automation.module';

@Module({
  imports: [
    // ... existing imports
    QaAutomationModule, // ADD THIS LINE
  ],
  // ...
})
export class AppModule {}
```

---

## PM Notification

**Note:** PM notification via Socket.IO is implemented in **Story 10.4 (Quality Gate Failure Notifications)**.

This story stores linting results in `qa_results` table. Story 10.4 will:

- Read results from database
- Emit `quality-gate:failure` event via Socket.IO
- Include line numbers and error details for PM

---

## Testing Requirements

### Unit Tests (`src/qa-automation/linter.service.spec.ts`)

```typescript
describe('LinterService', () => {
  describe('detectPrimaryLanguage', () => {
    it('should detect TypeScript from .ts files');
    it('should detect Python from .py files');
    it('should return UNKNOWN for unsupported extensions');
  });

  describe('lintFiles', () => {
    it('should lint TypeScript files with ESLint');
    it('should return passed=true when no errors');
    it('should return passed=false when errors exist');
    it('should throw when linting already in progress');
    it('should throw when flake8 binary not found');
  });

  describe('saveLintingResult', () => {
    it('should create QAResult record');
    it('should update ticket status to QA_FAILED on failure');
  });
});
```

---

## References

| Source                                    | Section                         |
| ----------------------------------------- | ------------------------------- |
| `docs/architecture.md`                    | qa-automation module structure  |
| `docs/epics.md`                           | Story 3.1 acceptance criteria   |
| `prisma/schema.prisma`                    | QAResult, Ticket models         |
| `src/common/metrics/metrics.constants.ts` | QA_METRICS, METRICS_CONSTANTS   |
| `src/webhooks/webhooks.service.ts`        | Service implementation patterns |

---

## Dev Agent Record

### Change Log

| Date       | Change                                                                                 | Author             |
| ---------- | -------------------------------------------------------------------------------------- | ------------------ |
| 2025-12-02 | Story drafted                                                                          | Scrum Master Bob   |
| 2025-12-02 | Quality review: Fixed 5 critical issues, added 4 enhancements, applied 3 optimizations | Quality Validator  |
| 2025-12-04 | Implementation complete: All 7 tasks done, 31 unit tests passing                       | Amelia (Dev Agent) |
| 2025-12-04 | Code review: Fixed 1 CRITICAL, 2 HIGH, 1 MEDIUM, 1 LOW issues. 33 tests now.           | Code Reviewer      |

### File List

| Action | File                                                |
| ------ | --------------------------------------------------- |
| CREATE | `src/qa-automation/interfaces/linting.interface.ts` |
| CREATE | `src/qa-automation/interfaces/index.ts`             |
| CREATE | `src/qa-automation/dto/linting-result.dto.ts`       |
| CREATE | `src/qa-automation/dto/index.ts`                    |
| CREATE | `src/qa-automation/linter.service.ts`               |
| MODIFY | `src/qa-automation/qa-automation.module.ts`         |
| MODIFY | `src/common/metrics/metrics.constants.ts`           |
| MODIFY | `src/common/sentry/sentry.constants.ts`             |
| CREATE | `src/qa-automation/linter.service.spec.ts`          |

### Implementation Notes

- **Interfaces**: Comprehensive types (SupportedLanguage, LintingSeverity, ILintingIssue, ILintingResult, ILintingOptions, ILinterConfig, LINTER_CONFIGS)
- **LinterService**: Implements multi-language linting using ESLint Node.js API for TS/JS, Flake8 CLI for Python, golangci-lint CLI for Go
- **Database Integration**: Saves results to qa_results table, updates ticket status to QA_FAILED on linting failure
- **Metrics**: Added LINTING_TOTAL, LINTING_DURATION, LINTING_ISSUES to QA_METRICS
- **Tests**: 33 unit tests covering language detection, ESLint execution, metrics tracking, database persistence, binary checks
- **Pre-existing test failures**: 15 tests in app.module.spec.ts fail due to SENTRY_DSN config (not related to this story)

### Code Review Fixes Applied (2025-12-04)

| Issue                                                          | Severity | Fix                                                    |
| -------------------------------------------------------------- | -------- | ------------------------------------------------------ |
| QaAutomationModule missing DatabaseModule/SentryModule imports | CRITICAL | Added `imports: [DatabaseModule, SentryModule]`        |
| Infinite recursion in lintPython error handling                | HIGH     | Created `parseFlake8Output()` helper to parse directly |
| Missing tests for binary not found scenarios                   | HIGH     | Added 2 tests for flake8/golangci-lint missing         |
| eslint.config.mjs not in config detection                      | MEDIUM   | Added mjs/cjs extensions, prioritized flat config      |
| File List used EXISTS instead of CREATE                        | LOW      | Corrected to CREATE for new files                      |
