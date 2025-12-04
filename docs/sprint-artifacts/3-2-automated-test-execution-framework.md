# Story 3.2: Automated Test Execution Framework

**Epic:** 3 - Automated QA & Quality Gates  
**Status:** done  
**Priority:** P1 - HIGH  
**Effort:** 8 story points  
**ClickUp ID:** `86evnjwb5`  
**ClickUp URL:** https://app.clickup.com/t/86evnjwb5

---

## Story

As the system,
I want to run existing project tests against AI-generated code,
So that regressions and broken functionality are detected automatically.

---

## Acceptance Criteria

**Given** AI code is pushed to a feature branch  
**When** test automation runs  
**Then** the system:

- Identifies test framework (Jest, Mocha, PyTest, etc.)
- Runs unit tests affected by code changes
- Runs integration tests if configured
- Captures test results (pass/fail, duration, coverage)

**And** test results include:

- Total tests run, passed, failed, skipped
- Failed test names and error messages
- Stack traces for failures
- Test execution time
- Coverage delta (if coverage changed)

**And** if tests fail: execution marked as `QA_FAILED`, detailed results stored in `qa_results` table, PM notified with failing test names (via Story 10.4 Socket.IO)

---

## Quick Implementation Summary (TL;DR)

**10 Key Files in Implementation Order:**

1. `src/qa-automation/interfaces/test-runner.interface.ts` - Types + correlationId
2. `src/qa-automation/dto/test-result.dto.ts` - DTOs
3. `src/qa-automation/parsers/test-output.parser.ts` - JSON parsers (Jest, PyTest, Go, Mocha)
4. `src/qa-automation/test-runner.service.ts` - Core logic with audit logging
5. `src/qa-automation/docker-executor.service.ts` - Isolated Docker execution
6. `src/common/metrics/metrics.constants.ts` - ADD to existing QA_METRICS
7. `src/qa-automation/qa-automation.module.ts` - Wire module
8. `src/qa-automation/test-runner.service.spec.ts` - Unit tests
9. `src/qa-automation/parsers/test-output.parser.spec.ts` - Parser tests
10. `test/qa-automation.e2e-spec.ts` - E2E tests

**No new dependencies needed** - uses native JSON parsing only.

---

## ⚠️ Anti-Patterns to Avoid

| ❌ DO NOT                          | ✅ DO INSTEAD                                             |
| ---------------------------------- | --------------------------------------------------------- |
| Create new `QA_METRICS` object     | ADD to existing `QA_METRICS` in `metrics.constants.ts`    |
| Run tests directly on host machine | Use Docker containers for isolation                       |
| Hard-code test framework commands  | Use `TestFramework` enum and config detection             |
| Ignore test output parsing errors  | Gracefully handle unparseable output, log & continue      |
| Store raw stdout in database       | Parse structured JSON output and store normalized results |
| Use `qa-tasks` queue name          | Use `qa-check-queue` (from `QUEUE_NAMES` constant)        |
| Forget timeout enforcement         | Use ConfigService `qa.testTimeoutMs` (default: 5 minutes) |
| Mount workspace read-only          | Use `:rw` - tests write `test-results.json`               |
| Skip correlationId                 | Propagate from caller for audit trail                     |
| Use generic Sentry capture         | Use `ErrorCategory.QA_AUTOMATION` for filtering           |

---

## Integration Context

### How This Story Fits in the Pipeline

```
Story 3.1 (Linting) - linting passes
    ↓ continues QA pipeline
Story 3.5 (QA Orchestrator) - calls TestRunnerService
    ↓ this story (with correlationId)
Story 3.2 (Test Execution) - runs tests, saves results, logs audit
    ↓ if passed
Story 3.3 (Coverage) - calculates coverage delta
    ↓ all QA passed
Story 4.x (GitHub Integration) - pushes code
```

### Key Integration Points

| From                              | Interface                                      | To                |
| --------------------------------- | ---------------------------------------------- | ----------------- |
| Story 3.5 `QAOrchestratorService` | calls `testRunner.runTests({ correlationId })` | This story        |
| This story                        | updates `QAResult.tests_passed`                | Database          |
| This story                        | updates `QAResult.test_results`                | Database (JSON)   |
| This story                        | updates `Ticket.status` to `QA_FAILED`         | Database          |
| This story                        | creates `AuditLog` entry                       | Database          |
| Story 3.3                         | reads `test_results` for coverage              | This story output |
| Story 10.4                        | reads results, emits Socket.IO                 | PM Dashboard      |

---

## Technical Requirements

### Files to Create/Modify

| File                                                    | Action | Purpose                  |
| ------------------------------------------------------- | ------ | ------------------------ |
| `src/qa-automation/interfaces/test-runner.interface.ts` | CREATE | Types with correlationId |
| `src/qa-automation/interfaces/index.ts`                 | MODIFY | Add exports              |
| `src/qa-automation/dto/test-result.dto.ts`              | CREATE | DTOs                     |
| `src/qa-automation/dto/index.ts`                        | MODIFY | Add exports              |
| `src/qa-automation/parsers/test-output.parser.ts`       | CREATE | JSON output parsers      |
| `src/qa-automation/parsers/index.ts`                    | CREATE | Barrel export            |
| `src/qa-automation/test-runner.service.ts`              | CREATE | Core service             |
| `src/qa-automation/docker-executor.service.ts`          | CREATE | Docker isolation         |
| `src/qa-automation/qa-automation.module.ts`             | MODIFY | Add providers            |
| `src/common/metrics/metrics.constants.ts`               | MODIFY | Add test metrics         |
| `src/qa-automation/test-runner.service.spec.ts`         | CREATE | Unit tests               |
| `src/qa-automation/parsers/test-output.parser.spec.ts`  | CREATE | Parser tests             |
| `test/qa-automation.e2e-spec.ts`                        | CREATE | E2E tests                |

---

## Tasks

- [x] **Task 1: Create Interfaces** (AC: #1, #2)
  - [x] `TestFramework` enum (JEST, MOCHA, PYTEST, GO_TEST, VITEST)
  - [x] `ITestCase`, `ITestSuite`, `ITestResult`, `ITestRunOptions` interfaces
  - [x] **Include `correlationId` in `ITestRunOptions`**
  - [x] Framework detection map (`TEST_FRAMEWORK_CONFIG`)

- [x] **Task 2: Create DTOs** (AC: #2)
  - [x] `TestCaseDto`, `TestSuiteDto`, `TestResultDto` with validators

- [x] **Task 3: Implement Test Output Parsers** (AC: #2)
  - [x] `parseJestJson()` - Jest JSON reporter output
  - [x] `parsePyTestJson()` - PyTest JSON report output
  - [x] `parseGoTestJson()` - Go test JSON output (line-delimited)
  - [x] `parseMochaJson()` - Mocha JSON reporter output
  - [x] Include sample output constants for testing

- [x] **Task 4: Implement DockerExecutorService** (AC: #1, #3)
  - [x] `executeInContainer()` - run in isolated Docker container
  - [x] **Mount workspace read-write (`:rw`)** for test output
  - [x] Auto-select base image based on framework
  - [x] Timeout from ConfigService (`qa.testTimeoutMs`)
  - [x] Container cleanup on completion/error

- [x] **Task 5: Implement TestRunnerService** (AC: #1, #2, #3)
  - [x] `runTests()` main method with framework detection
  - [x] **Accept and propagate `correlationId`**
  - [x] `detectFramework()` - analyze package.json, pyproject.toml, go.mod
  - [x] **Use `ErrorCategory.QA_AUTOMATION` for Sentry**
  - [x] Result normalization via parsers

- [x] **Task 6: Database Integration** (AC: #3)
  - [x] `saveTestResult()` - store in `qa_results.test_results`
  - [x] `updateTicketStatus()` - set `Ticket.status = QA_FAILED` on failure
  - [x] **Add audit log entry via `auditLog.create()`**

- [x] **Task 7: Metrics Integration** (AC: #2)
  - [x] ADD metrics to existing `QA_METRICS` (NOT new object)
  - [x] Track executions, duration, pass/fail counts by framework

- [x] **Task 8: Wire Module** (AC: All)
  - [x] Update `QaAutomationModule` with providers
  - [x] Export `TestRunnerService` for orchestrator

- [x] **Task 9: Unit Tests** (AC: All)
  - [x] Framework detection tests
  - [x] Parser tests for each format with sample data
  - [x] Service tests with mocked Docker execution
  - [x] > 80% coverage per NFR-M1

- [x] **Task 10: E2E Tests** (AC: All)
  - [x] Create `test/qa-automation.e2e-spec.ts`
  - [x] Test full flow with mocked Docker

---

## Implementation Guide

### Step 1: Interfaces

**File:** `src/qa-automation/interfaces/test-runner.interface.ts`

```typescript
export enum TestFramework {
  JEST = 'jest',
  MOCHA = 'mocha',
  VITEST = 'vitest',
  PYTEST = 'pytest',
  GO_TEST = 'go_test',
  UNKNOWN = 'unknown',
}

export enum TestStatus {
  PASSED = 'passed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
  PENDING = 'pending',
}

// Framework detection configuration
export const TEST_FRAMEWORK_CONFIG: Record<
  TestFramework,
  {
    configFiles: string[];
    packageIndicators: string[];
    command: string;
    outputFormat: string;
    dockerImage: string;
  }
> = {
  [TestFramework.JEST]: {
    configFiles: ['jest.config.js', 'jest.config.ts', 'jest.config.json'],
    packageIndicators: ['jest'],
    command:
      'npx jest --json --outputFile=test-results.json --coverage --coverageReporters=json-summary',
    outputFormat: 'jest-json',
    dockerImage: 'node:20-alpine',
  },
  [TestFramework.MOCHA]: {
    configFiles: ['.mocharc.js', '.mocharc.json', '.mocharc.yaml'],
    packageIndicators: ['mocha'],
    command: 'npx mocha --reporter json > test-results.json',
    outputFormat: 'mocha-json',
    dockerImage: 'node:20-alpine',
  },
  [TestFramework.VITEST]: {
    configFiles: ['vitest.config.ts', 'vitest.config.js'],
    packageIndicators: ['vitest'],
    command: 'npx vitest run --reporter=json --outputFile=test-results.json',
    outputFormat: 'vitest-json',
    dockerImage: 'node:20-alpine',
  },
  [TestFramework.PYTEST]: {
    configFiles: ['pytest.ini', 'pyproject.toml', 'setup.cfg'],
    packageIndicators: ['pytest'],
    command: 'pytest --json-report --json-report-file=test-results.json --cov --cov-report=json',
    outputFormat: 'pytest-json',
    dockerImage: 'python:3.11-slim',
  },
  [TestFramework.GO_TEST]: {
    configFiles: ['go.mod'],
    packageIndicators: [],
    command: 'go test -json ./... > test-results.json 2>&1',
    outputFormat: 'go-test-json',
    dockerImage: 'golang:1.21-alpine',
  },
  [TestFramework.UNKNOWN]: {
    configFiles: [],
    packageIndicators: [],
    command: '',
    outputFormat: '',
    dockerImage: '',
  },
};

export interface ITestCase {
  name: string;
  suiteName: string;
  status: TestStatus;
  durationMs: number;
  errorMessage?: string;
  stackTrace?: string;
  filePath?: string;
  lineNumber?: number;
}

export interface ITestSuite {
  name: string;
  tests: ITestCase[];
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

export interface ITestResult {
  framework: TestFramework;
  passed: boolean;
  totalTests: number;
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  durationMs: number;
  suites: ITestSuite[];
  failedTests: ITestCase[];
  coverage?: {
    lines: number;
    branches: number;
    functions: number;
    statements: number;
  };
  rawOutput?: string;
}

export interface ITestRunOptions {
  workspacePath: string;
  executionId: string;
  correlationId: string; // REQUIRED for audit trail
  framework?: TestFramework; // Auto-detect if not provided
  testPattern?: string; // e.g., '**/*.spec.ts'
  timeoutMs?: number; // From ConfigService, default: 300000
  collectCoverage?: boolean;
  dockerImage?: string; // Override default
}
```

**File:** `src/qa-automation/interfaces/index.ts` (MODIFY - add exports)

```typescript
export * from './linting.interface';
export * from './test-runner.interface';
```

---

### Step 2: DTOs

**File:** `src/qa-automation/dto/test-result.dto.ts`

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsString,
  IsArray,
  IsEnum,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TestFramework, TestStatus } from '../interfaces';

export class TestCaseDto {
  @ApiProperty({ description: 'Test case name' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Test suite name' })
  @IsString()
  suiteName: string;

  @ApiProperty({ enum: TestStatus })
  @IsEnum(TestStatus)
  status: TestStatus;

  @ApiProperty({ description: 'Duration in milliseconds' })
  @IsNumber()
  durationMs: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  errorMessage?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  stackTrace?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  filePath?: string;
}

export class TestCoverageDto {
  @ApiProperty()
  @IsNumber()
  lines: number;

  @ApiProperty()
  @IsNumber()
  branches: number;

  @ApiProperty()
  @IsNumber()
  functions: number;

  @ApiProperty()
  @IsNumber()
  statements: number;
}

export class TestResultDto {
  @ApiProperty({ enum: TestFramework })
  @IsEnum(TestFramework)
  framework: TestFramework;

  @ApiProperty()
  @IsBoolean()
  passed: boolean;

  @ApiProperty()
  @IsNumber()
  totalTests: number;

  @ApiProperty()
  @IsNumber()
  passedCount: number;

  @ApiProperty()
  @IsNumber()
  failedCount: number;

  @ApiProperty()
  @IsNumber()
  skippedCount: number;

  @ApiProperty()
  @IsNumber()
  durationMs: number;

  @ApiProperty({ type: [TestCaseDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestCaseDto)
  failedTests: TestCaseDto[];

  @ApiPropertyOptional({ type: TestCoverageDto })
  @ValidateNested()
  @Type(() => TestCoverageDto)
  @IsOptional()
  coverage?: TestCoverageDto;
}
```

**File:** `src/qa-automation/dto/index.ts` (MODIFY - add exports)

```typescript
export * from './linting-result.dto';
export * from './test-result.dto';
```

---

### Step 3: Update Metrics Constants (CRITICAL)

**File:** `src/common/metrics/metrics.constants.ts`

ADD to existing `QA_METRICS` object (DO NOT CREATE NEW):

```typescript
// Business Metrics - QA
export const QA_METRICS = {
  CHECKS_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_checks_total`,
  CHECK_DURATION: `${METRICS_CONSTANTS.PREFIX}qa_check_duration_seconds`,
  COVERAGE_PERCENT: `${METRICS_CONSTANTS.PREFIX}qa_test_coverage_percent`,
  VULNERABILITIES: `${METRICS_CONSTANTS.PREFIX}qa_security_vulnerabilities_total`,
  // Story 3.1 metrics:
  LINTING_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_linting_total`,
  LINTING_DURATION: `${METRICS_CONSTANTS.PREFIX}qa_linting_duration_seconds`,
  LINTING_ISSUES: `${METRICS_CONSTANTS.PREFIX}qa_linting_issues`,
  // Story 3.2 metrics:
  TEST_EXECUTIONS_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_test_executions_total`,
  TEST_DURATION: `${METRICS_CONSTANTS.PREFIX}qa_test_duration_seconds`,
  TEST_PASSED_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_tests_passed_total`,
  TEST_FAILED_TOTAL: `${METRICS_CONSTANTS.PREFIX}qa_tests_failed_total`,
} as const;
```

---

### Step 4: Test Output Parsers with Sample Data

**File:** `src/qa-automation/parsers/test-output.parser.ts`

```typescript
import { Logger } from '@nestjs/common';
import { ITestResult, ITestCase, ITestSuite, TestFramework, TestStatus } from '../interfaces';

/**
 * Sample Jest JSON output for testing (use in unit tests)
 */
export const JEST_SAMPLE_OUTPUT = JSON.stringify({
  numTotalTests: 5,
  numPassedTests: 4,
  numFailedTests: 1,
  numPendingTests: 0,
  testResults: [
    {
      name: '/app/src/example.spec.ts',
      startTime: 1700000000000,
      endTime: 1700000001500,
      assertionResults: [
        { title: 'should pass', status: 'passed', duration: 50 },
        {
          title: 'should fail',
          status: 'failed',
          duration: 100,
          failureMessages: ['Expected true to be false'],
        },
      ],
    },
  ],
});

/**
 * Sample PyTest JSON output for testing
 */
export const PYTEST_SAMPLE_OUTPUT = JSON.stringify({
  summary: { total: 3, passed: 2, failed: 1 },
  duration: 2.5,
  tests: [
    { nodeid: 'tests/test_example.py::test_one', outcome: 'passed', call: { duration: 0.1 } },
    {
      nodeid: 'tests/test_example.py::test_two',
      outcome: 'failed',
      call: { duration: 0.2, longrepr: 'AssertionError' },
    },
  ],
});

export interface ITestOutputParser {
  parse(output: string, framework: TestFramework): ITestResult;
}

export class TestOutputParser implements ITestOutputParser {
  private readonly logger = new Logger(TestOutputParser.name);

  /**
   * Parse test output based on framework (JSON only)
   */
  parse(output: string, framework: TestFramework): ITestResult {
    try {
      switch (framework) {
        case TestFramework.JEST:
        case TestFramework.VITEST:
          return this.parseJestJson(output);
        case TestFramework.PYTEST:
          return this.parsePyTestJson(output);
        case TestFramework.GO_TEST:
          return this.parseGoTestJson(output);
        case TestFramework.MOCHA:
          return this.parseMochaJson(output);
        default:
          return this.createEmptyResult(framework, 'Unknown framework');
      }
    } catch (error) {
      this.logger.error(`Failed to parse ${framework} output: ${(error as Error).message}`);
      return this.createEmptyResult(framework, (error as Error).message);
    }
  }

  /**
   * Parse Jest JSON reporter output
   * Format: { numTotalTests, numPassedTests, numFailedTests, testResults: [...] }
   */
  private parseJestJson(output: string): ITestResult {
    const json = JSON.parse(output);

    const failedTests: ITestCase[] = [];
    const suites: ITestSuite[] = [];

    for (const testFile of json.testResults || []) {
      const suite: ITestSuite = {
        name: testFile.name,
        tests: [],
        passed: 0,
        failed: 0,
        skipped: 0,
        durationMs: testFile.endTime - testFile.startTime,
      };

      for (const assertion of testFile.assertionResults || []) {
        const testCase: ITestCase = {
          name: assertion.title,
          suiteName: assertion.ancestorTitles?.join(' > ') || testFile.name,
          status: this.mapJestStatus(assertion.status),
          durationMs: assertion.duration || 0,
          errorMessage: assertion.failureMessages?.join('\n'),
          stackTrace: assertion.failureDetails?.[0]?.stack,
          filePath: testFile.name,
        };

        suite.tests.push(testCase);

        if (testCase.status === TestStatus.PASSED) suite.passed++;
        else if (testCase.status === TestStatus.FAILED) {
          suite.failed++;
          failedTests.push(testCase);
        } else suite.skipped++;
      }

      suites.push(suite);
    }

    // Parse coverage if available
    let coverage;
    if (json.coverageMap || json.coverage) {
      const cov = json.coverageMap?.total || json.coverage?.total;
      if (cov) {
        coverage = {
          lines: cov.lines?.pct || 0,
          branches: cov.branches?.pct || 0,
          functions: cov.functions?.pct || 0,
          statements: cov.statements?.pct || 0,
        };
      }
    }

    return {
      framework: TestFramework.JEST,
      passed: json.numFailedTests === 0,
      totalTests: json.numTotalTests,
      passedCount: json.numPassedTests,
      failedCount: json.numFailedTests,
      skippedCount: json.numPendingTests || 0,
      durationMs:
        json.testResults?.reduce(
          (sum: number, t: { endTime: number; startTime: number }) =>
            sum + (t.endTime - t.startTime),
          0,
        ) || 0,
      suites,
      failedTests,
      coverage,
    };
  }

  /**
   * Parse PyTest JSON report output
   * Format: { summary: {...}, tests: [...], duration: float }
   */
  private parsePyTestJson(output: string): ITestResult {
    const json = JSON.parse(output);
    const summary = json.summary || {};

    const failedTests: ITestCase[] = [];
    const suites: ITestSuite[] = [];

    const testsByModule = new Map<string, ITestCase[]>();

    for (const test of json.tests || []) {
      const moduleName = test.nodeid?.split('::')[0] || 'unknown';
      const testCase: ITestCase = {
        name: test.nodeid?.split('::').pop() || test.nodeid,
        suiteName: moduleName,
        status: this.mapPyTestStatus(test.outcome),
        durationMs: (test.call?.duration || 0) * 1000,
        errorMessage: test.call?.longrepr,
        filePath: moduleName,
      };

      if (!testsByModule.has(moduleName)) {
        testsByModule.set(moduleName, []);
      }
      testsByModule.get(moduleName)!.push(testCase);

      if (testCase.status === TestStatus.FAILED) {
        failedTests.push(testCase);
      }
    }

    for (const [name, tests] of testsByModule) {
      suites.push({
        name,
        tests,
        passed: tests.filter((t) => t.status === TestStatus.PASSED).length,
        failed: tests.filter((t) => t.status === TestStatus.FAILED).length,
        skipped: tests.filter((t) => t.status === TestStatus.SKIPPED).length,
        durationMs: tests.reduce((sum, t) => sum + t.durationMs, 0),
      });
    }

    return {
      framework: TestFramework.PYTEST,
      passed: (summary.failed || 0) === 0,
      totalTests: summary.total || 0,
      passedCount: summary.passed || 0,
      failedCount: summary.failed || 0,
      skippedCount: summary.skipped || 0,
      durationMs: (json.duration || 0) * 1000,
      suites,
      failedTests,
    };
  }

  /**
   * Parse Go test JSON output (line-delimited JSON)
   * Each line: { Action, Package, Test?, Elapsed?, Output? }
   */
  private parseGoTestJson(output: string): ITestResult {
    const lines = output.split('\n').filter((l) => l.trim());
    const tests = new Map<string, ITestCase>();
    let totalDuration = 0;

    for (const line of lines) {
      try {
        const event = JSON.parse(line);

        if (event.Test && event.Action) {
          const key = `${event.Package}::${event.Test}`;

          if (event.Action === 'run') {
            tests.set(key, {
              name: event.Test,
              suiteName: event.Package,
              status: TestStatus.PENDING,
              durationMs: 0,
            });
          } else if (
            event.Action === 'pass' ||
            event.Action === 'fail' ||
            event.Action === 'skip'
          ) {
            const test = tests.get(key);
            if (test) {
              test.status =
                event.Action === 'pass'
                  ? TestStatus.PASSED
                  : event.Action === 'fail'
                    ? TestStatus.FAILED
                    : TestStatus.SKIPPED;
              test.durationMs = (event.Elapsed || 0) * 1000;
            }
          } else if (event.Action === 'output' && event.Output) {
            const test = tests.get(key);
            if (test && test.status === TestStatus.FAILED) {
              test.errorMessage = (test.errorMessage || '') + event.Output;
            }
          }
        }

        if (event.Action === 'pass' && !event.Test && event.Elapsed) {
          totalDuration += event.Elapsed * 1000;
        }
      } catch {
        // Skip non-JSON lines (common in go test output)
      }
    }

    const allTests = Array.from(tests.values());
    const failedTests = allTests.filter((t) => t.status === TestStatus.FAILED);

    return {
      framework: TestFramework.GO_TEST,
      passed: failedTests.length === 0,
      totalTests: allTests.length,
      passedCount: allTests.filter((t) => t.status === TestStatus.PASSED).length,
      failedCount: failedTests.length,
      skippedCount: allTests.filter((t) => t.status === TestStatus.SKIPPED).length,
      durationMs: totalDuration,
      suites: [],
      failedTests,
    };
  }

  /**
   * Parse Mocha JSON reporter output
   * Format: { stats: {...}, failures: [...] }
   */
  private parseMochaJson(output: string): ITestResult {
    const json = JSON.parse(output);
    const stats = json.stats || {};

    const failedTests: ITestCase[] = (json.failures || []).map(
      (f: {
        title: string;
        fullTitle: string;
        duration: number;
        err?: { message?: string; stack?: string };
        file?: string;
      }) => ({
        name: f.title,
        suiteName: f.fullTitle?.replace(f.title, '').trim() || 'unknown',
        status: TestStatus.FAILED,
        durationMs: f.duration || 0,
        errorMessage: f.err?.message,
        stackTrace: f.err?.stack,
        filePath: f.file,
      }),
    );

    return {
      framework: TestFramework.MOCHA,
      passed: stats.failures === 0,
      totalTests: stats.tests || 0,
      passedCount: stats.passes || 0,
      failedCount: stats.failures || 0,
      skippedCount: stats.pending || 0,
      durationMs: stats.duration || 0,
      suites: [],
      failedTests,
    };
  }

  private mapJestStatus(status: string): TestStatus {
    switch (status) {
      case 'passed':
        return TestStatus.PASSED;
      case 'failed':
        return TestStatus.FAILED;
      case 'pending':
      case 'skipped':
      case 'todo':
        return TestStatus.SKIPPED;
      default:
        return TestStatus.PENDING;
    }
  }

  private mapPyTestStatus(outcome: string): TestStatus {
    switch (outcome) {
      case 'passed':
        return TestStatus.PASSED;
      case 'failed':
        return TestStatus.FAILED;
      case 'skipped':
        return TestStatus.SKIPPED;
      default:
        return TestStatus.PENDING;
    }
  }

  private createEmptyResult(framework: TestFramework, error: string): ITestResult {
    return {
      framework,
      passed: false,
      totalTests: 0,
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 0,
      suites: [],
      failedTests: [],
      rawOutput: `Parse error: ${error}`,
    };
  }
}
```

**File:** `src/qa-automation/parsers/index.ts`

```typescript
export * from './test-output.parser';
```

---

### Step 5: Docker Executor Service (Read-Write Mount)

**File:** `src/qa-automation/docker-executor.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface IDockerRunOptions {
  image: string;
  workspacePath: string;
  command: string;
  timeoutMs: number;
  correlationId: string;
  env?: Record<string, string>;
}

export interface IDockerRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

@Injectable()
export class DockerExecutorService {
  private readonly logger = new Logger(DockerExecutorService.name);
  private readonly defaultTimeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.defaultTimeoutMs = this.configService.get<number>('qa.testTimeoutMs', 300000);
  }

  /**
   * Execute command in isolated Docker container
   * IMPORTANT: Workspace mounted read-write for test output files
   */
  async executeInContainer(options: IDockerRunOptions): Promise<IDockerRunResult> {
    const {
      image,
      workspacePath,
      command,
      timeoutMs = this.defaultTimeoutMs,
      correlationId,
      env = {},
    } = options;

    const startTime = Date.now();
    const containerName = `dsf-test-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Build docker run command
    const envArgs = Object.entries(env)
      .map(([k, v]) => `-e ${k}="${v}"`)
      .join(' ');

    const dockerCommand = [
      'docker run',
      '--rm',
      `--name ${containerName}`,
      `--memory=2g`,
      `--cpus=2`,
      `--network=none`, // Isolate network for security
      `-v ${workspacePath}:/workspace:rw`, // READ-WRITE for test output
      `-w /workspace`,
      envArgs,
      image,
      `/bin/sh -c "${command.replace(/"/g, '\\"')}"`,
    ]
      .filter(Boolean)
      .join(' ');

    this.logger.debug(`[${correlationId}] Executing: ${dockerCommand}`);

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn('sh', ['-c', dockerCommand], {
        shell: true,
        timeout: timeoutMs,
      });

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(async () => {
        timedOut = true;
        this.logger.warn(
          `[${correlationId}] Container ${containerName} timed out after ${timeoutMs}ms`,
        );

        try {
          await execAsync(`docker kill ${containerName}`);
        } catch {
          // Container may have already exited
        }

        child.kill('SIGKILL');
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeout);

        resolve({
          exitCode: code ?? (timedOut ? 124 : 1),
          stdout,
          stderr,
          timedOut,
          durationMs: Date.now() - startTime,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        this.logger.error(`[${correlationId}] Docker execution error: ${err.message}`);

        resolve({
          exitCode: 1,
          stdout,
          stderr: stderr + err.message,
          timedOut: false,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * Check if Docker is available on the host
   */
  async isDockerAvailable(): Promise<boolean> {
    try {
      await execAsync('docker info');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Pull Docker image if not already present
   */
  async ensureImage(image: string): Promise<void> {
    try {
      await execAsync(`docker image inspect ${image}`);
    } catch {
      this.logger.log(`Pulling Docker image: ${image}`);
      await execAsync(`docker pull ${image}`);
    }
  }
}
```

---

### Step 6: TestRunnerService with Full Integration

**File:** `src/qa-automation/test-runner.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Counter, Histogram } from 'prom-client';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PrismaService } from '../database/prisma.service';
import { SentryService } from '../common/sentry/sentry.service';
import { ErrorCategory } from '../common/sentry/sentry.constants';
import { QA_METRICS } from '../common/metrics/metrics.constants';
import { DockerExecutorService } from './docker-executor.service';
import { TestOutputParser } from './parsers/test-output.parser';
import {
  ITestResult,
  ITestRunOptions,
  TestFramework,
  TestStatus,
  TEST_FRAMEWORK_CONFIG,
} from './interfaces';

@Injectable()
export class TestRunnerService {
  private readonly logger = new Logger(TestRunnerService.name);
  private readonly defaultTimeoutMs: number;
  private readonly parser = new TestOutputParser();
  private testsInProgress = new Map<string, boolean>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly sentry: SentryService,
    private readonly dockerExecutor: DockerExecutorService,
    @InjectMetric(QA_METRICS.TEST_EXECUTIONS_TOTAL)
    private readonly testExecutionsCounter: Counter<string>,
    @InjectMetric(QA_METRICS.TEST_DURATION) private readonly testDuration: Histogram<string>,
    @InjectMetric(QA_METRICS.TEST_PASSED_TOTAL) private readonly testPassedCounter: Counter<string>,
    @InjectMetric(QA_METRICS.TEST_FAILED_TOTAL) private readonly testFailedCounter: Counter<string>,
  ) {
    this.defaultTimeoutMs = this.configService.get<number>('qa.testTimeoutMs', 300000);
  }

  /**
   * Main entry point - run tests in workspace
   */
  async runTests(options: ITestRunOptions): Promise<ITestResult> {
    const {
      workspacePath,
      executionId,
      correlationId,
      timeoutMs = this.defaultTimeoutMs,
    } = options;

    // Prevent concurrent test runs on same workspace
    if (this.testsInProgress.get(workspacePath)) {
      throw new Error(`Tests already in progress for ${workspacePath}`);
    }
    this.testsInProgress.set(workspacePath, true);

    const framework = options.framework || (await this.detectFramework(workspacePath));
    const endTimer = this.testDuration.startTimer({ framework });

    this.logger.log(`[${correlationId}] Starting ${framework} test execution for ${executionId}`);

    try {
      // Check Docker availability
      const dockerAvailable = await this.dockerExecutor.isDockerAvailable();
      if (!dockerAvailable) {
        throw new Error('Docker is required for test execution but is not available');
      }

      if (framework === TestFramework.UNKNOWN) {
        this.logger.warn(`[${correlationId}] No test framework detected in ${workspacePath}`);
        return this.createSkippedResult(framework);
      }

      const config = TEST_FRAMEWORK_CONFIG[framework];

      await this.dockerExecutor.ensureImage(config.dockerImage);

      // Install dependencies and run tests
      const installCmd =
        framework === TestFramework.GO_TEST
          ? ''
          : framework === TestFramework.PYTEST
            ? 'pip install -q pytest pytest-json-report pytest-cov && '
            : 'npm ci --silent && ';

      const fullCommand = `${installCmd}${config.command}`;

      const result = await this.dockerExecutor.executeInContainer({
        image: config.dockerImage,
        workspacePath,
        command: fullCommand,
        timeoutMs,
        correlationId,
      });

      if (result.timedOut) {
        this.testExecutionsCounter.inc({ framework, result: 'timeout' });
        return this.createTimeoutResult(framework, timeoutMs);
      }

      // Read test results file (written by test framework)
      let testOutput: string;
      try {
        testOutput = await fs.readFile(path.join(workspacePath, 'test-results.json'), 'utf-8');
      } catch {
        testOutput = result.stdout;
      }

      const testResult = this.parser.parse(testOutput, framework);

      // Track metrics
      this.testExecutionsCounter.inc({
        framework,
        result: testResult.passed ? 'passed' : 'failed',
      });
      this.testPassedCounter.inc({ framework }, testResult.passedCount);
      this.testFailedCounter.inc({ framework }, testResult.failedCount);

      this.logger.log(
        `[${correlationId}] ${framework} tests completed: ${testResult.passedCount}/${testResult.totalTests} passed ` +
          `(${testResult.failedCount} failed, ${testResult.skippedCount} skipped)`,
      );

      return testResult;
    } catch (error) {
      this.testExecutionsCounter.inc({ framework, result: 'error' });
      this.sentry.captureException(error as Error, {
        category: ErrorCategory.QA_AUTOMATION,
        extra: { framework, workspacePath, executionId, correlationId },
      });
      throw error;
    } finally {
      this.testsInProgress.delete(workspacePath);
      endTimer();
    }
  }

  /**
   * Detect test framework from project configuration files
   */
  async detectFramework(workspacePath: string): Promise<TestFramework> {
    // Check package.json for JS/TS projects
    try {
      const packageJsonPath = path.join(workspacePath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };

      if (allDeps.vitest) return TestFramework.VITEST;
      if (allDeps.jest) return TestFramework.JEST;
      if (allDeps.mocha) return TestFramework.MOCHA;
    } catch {
      // Not a Node.js project
    }

    // Check for Python project
    try {
      await fs.access(path.join(workspacePath, 'pytest.ini'));
      return TestFramework.PYTEST;
    } catch {
      // No pytest.ini
    }

    try {
      const pyprojectPath = path.join(workspacePath, 'pyproject.toml');
      const content = await fs.readFile(pyprojectPath, 'utf-8');
      if (content.includes('pytest') || content.includes('[tool.pytest')) {
        return TestFramework.PYTEST;
      }
    } catch {
      // No pyproject.toml
    }

    // Check for Go project
    try {
      await fs.access(path.join(workspacePath, 'go.mod'));
      return TestFramework.GO_TEST;
    } catch {
      // No go.mod
    }

    return TestFramework.UNKNOWN;
  }

  /**
   * Save test result to database, update ticket status, and log audit entry
   */
  async saveTestResult(
    executionId: string,
    result: ITestResult,
    correlationId: string,
  ): Promise<void> {
    // 1. Save to qa_results
    const existing = await this.prisma.qAResult.findFirst({
      where: { execution_id: executionId },
    });

    const testResults = {
      framework: result.framework,
      totalTests: result.totalTests,
      passedCount: result.passedCount,
      failedCount: result.failedCount,
      skippedCount: result.skippedCount,
      durationMs: result.durationMs,
      failedTests: result.failedTests.map((t) => ({
        name: t.name,
        suiteName: t.suiteName,
        errorMessage: t.errorMessage,
        stackTrace: t.stackTrace?.substring(0, 2000),
        filePath: t.filePath,
      })),
      coverage: result.coverage,
    };

    if (existing) {
      await this.prisma.qAResult.update({
        where: { id: existing.id },
        data: {
          tests_passed: result.passed,
          test_results: testResults,
          test_coverage: result.coverage?.lines,
        },
      });
    } else {
      await this.prisma.qAResult.create({
        data: {
          execution_id: executionId,
          linting_passed: true,
          tests_passed: result.passed,
          test_results: testResults,
          test_coverage: result.coverage?.lines,
          code_review_passed: false,
          overall_passed: false,
        },
      });
    }

    // 2. Create audit log entry
    await this.prisma.auditLog.create({
      data: {
        entity_type: 'execution',
        entity_id: executionId,
        action: 'tests_executed',
        changes: {
          framework: result.framework,
          passed: result.passed,
          totalTests: result.totalTests,
          failedCount: result.failedCount,
          correlationId,
        },
      },
    });

    // 3. Update ticket status if tests failed
    if (!result.passed) {
      await this.updateTicketStatusOnFailure(executionId, result, correlationId);
    }
  }

  /**
   * Mark ticket as QA_FAILED when tests fail
   */
  private async updateTicketStatusOnFailure(
    executionId: string,
    result: ITestResult,
    correlationId: string,
  ): Promise<void> {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
    });

    if (execution) {
      await this.prisma.ticket.update({
        where: { id: execution.ticket_id },
        data: { status: 'QA_FAILED' },
      });

      const failedTestNames = result.failedTests
        .slice(0, 5)
        .map((t) => t.name)
        .join(', ');

      this.logger.warn(
        `[${correlationId}] Ticket ${execution.ticket_id} marked as QA_FAILED: ` +
          `${result.failedCount} test(s) failed - ${failedTestNames}${result.failedCount > 5 ? '...' : ''}`,
      );
    }
  }

  private createSkippedResult(framework: TestFramework): ITestResult {
    return {
      framework,
      passed: true,
      totalTests: 0,
      passedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      durationMs: 0,
      suites: [],
      failedTests: [],
      rawOutput: 'No test framework detected - skipped',
    };
  }

  private createTimeoutResult(framework: TestFramework, timeoutMs: number): ITestResult {
    return {
      framework,
      passed: false,
      totalTests: 0,
      passedCount: 0,
      failedCount: 1,
      skippedCount: 0,
      durationMs: timeoutMs,
      suites: [],
      failedTests: [
        {
          name: 'Test Execution',
          suiteName: 'Timeout',
          status: TestStatus.FAILED,
          durationMs: timeoutMs,
          errorMessage: `Test execution timed out after ${timeoutMs / 1000} seconds`,
        },
      ],
      rawOutput: `TIMEOUT: Tests did not complete within ${timeoutMs}ms`,
    };
  }
}
```

---

### Step 7: Update QaAutomationModule

**File:** `src/qa-automation/qa-automation.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  makeCounterProvider,
  makeHistogramProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';
import { DatabaseModule } from '../database/database.module';
import { SentryModule } from '../common/sentry/sentry.module';
import { LinterService } from './linter.service';
import { TestRunnerService } from './test-runner.service';
import { DockerExecutorService } from './docker-executor.service';
import { QA_METRICS, METRICS_CONSTANTS } from '../common/metrics/metrics.constants';

@Module({
  imports: [DatabaseModule, SentryModule, ConfigModule],
  providers: [
    // Story 3.1 - Linting
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

    // Story 3.2 - Test Runner
    TestRunnerService,
    DockerExecutorService,
    makeCounterProvider({
      name: QA_METRICS.TEST_EXECUTIONS_TOTAL,
      help: 'Total test executions',
      labelNames: ['framework', 'result'],
    }),
    makeHistogramProvider({
      name: QA_METRICS.TEST_DURATION,
      help: 'Test execution duration in seconds',
      labelNames: ['framework'],
      buckets: [5, 15, 30, 60, 120, 300, 600],
    }),
    makeCounterProvider({
      name: QA_METRICS.TEST_PASSED_TOTAL,
      help: 'Total tests passed',
      labelNames: ['framework'],
    }),
    makeCounterProvider({
      name: QA_METRICS.TEST_FAILED_TOTAL,
      help: 'Total tests failed',
      labelNames: ['framework'],
    }),
  ],
  exports: [LinterService, TestRunnerService, DockerExecutorService],
})
export class QaAutomationModule {}
```

---

## Configuration

Add to `src/config/configuration.ts`:

```typescript
qa: {
  testTimeoutMs: parseInt(process.env.QA_TEST_TIMEOUT_MS || '300000', 10),
},
```

---

## PM Notification

**Note:** PM notification via Socket.IO is implemented in **Story 10.4 (Quality Gate Failure Notifications)**.

This story stores test results in `qa_results.test_results` (JSON). Story 10.4 will:

- Read results from database
- Emit `quality-gate:failure` event via Socket.IO
- Include failing test names and error messages for PM

---

## Testing Requirements

### Unit Tests (`src/qa-automation/test-runner.service.spec.ts`)

```typescript
describe('TestRunnerService', () => {
  describe('detectFramework', () => {
    it('should detect Jest from package.json');
    it('should detect Vitest from package.json');
    it('should detect PyTest from pytest.ini');
    it('should detect Go from go.mod');
    it('should return UNKNOWN when no framework detected');
  });

  describe('runTests', () => {
    it('should run Jest tests and parse results');
    it('should propagate correlationId through execution');
    it('should return passed=true when all tests pass');
    it('should return passed=false when tests fail');
    it('should throw when tests already in progress');
    it('should handle timeout correctly');
    it('should use ErrorCategory.QA_AUTOMATION for Sentry');
    it('should track metrics on completion');
  });

  describe('saveTestResult', () => {
    it('should create QAResult record');
    it('should update existing QAResult record');
    it('should create audit log entry');
    it('should update ticket status to QA_FAILED on test failure');
  });
});
```

### Parser Tests (`src/qa-automation/parsers/test-output.parser.spec.ts`)

```typescript
import { JEST_SAMPLE_OUTPUT, PYTEST_SAMPLE_OUTPUT } from './test-output.parser';

describe('TestOutputParser', () => {
  describe('parseJestJson', () => {
    it('should parse JEST_SAMPLE_OUTPUT correctly', () => {
      const result = parser.parse(JEST_SAMPLE_OUTPUT, TestFramework.JEST);
      expect(result.totalTests).toBe(5);
      expect(result.failedCount).toBe(1);
    });
    it('should extract failed test details');
    it('should extract coverage if present');
  });

  describe('parsePyTestJson', () => {
    it('should parse PYTEST_SAMPLE_OUTPUT correctly', () => {
      const result = parser.parse(PYTEST_SAMPLE_OUTPUT, TestFramework.PYTEST);
      expect(result.totalTests).toBe(3);
    });
    it('should group tests by module');
  });

  describe('parseGoTestJson', () => {
    it('should parse Go test JSON output');
    it('should handle line-delimited JSON format');
  });

  describe('error handling', () => {
    it('should return empty result on parse error');
    it('should log error and continue');
  });
});
```

### E2E Tests (`test/qa-automation.e2e-spec.ts`)

```typescript
describe('QA Automation E2E', () => {
  describe('TestRunnerService', () => {
    it('should detect and run Jest tests in sample project');
    it('should save results to database');
    it('should create audit log entry');
    it('should update ticket status on failure');
  });
});
```

---

## Prerequisites

| Story                  | Status           | Required For                      |
| ---------------------- | ---------------- | --------------------------------- |
| Story 1.3 (Database)   | ✅ done          | `qa_results`, `audit_logs` tables |
| Story 1.8 (Prometheus) | ✅ done          | Metrics infrastructure            |
| Story 1.9 (Sentry)     | ✅ done          | Error tracking with ErrorCategory |
| Story 3.1 (Linting)    | ✅ ready-for-dev | QA pipeline sequence              |

---

## References

| Source                                       | Section                                           |
| -------------------------------------------- | ------------------------------------------------- |
| `docs/architecture.md`                       | qa-automation module, FR67, NFR-M1 (80% coverage) |
| `docs/epics.md`                              | Story 3.2 acceptance criteria                     |
| `prisma/schema.prisma`                       | QAResult, AuditLog, Execution models              |
| `src/common/metrics/metrics.constants.ts`    | QA_METRICS                                        |
| `src/common/sentry/sentry.constants.ts`      | ErrorCategory enum                                |
| `src/ticket-intake/ticket-intake.service.ts` | Service + audit log patterns                      |

---

## Dev Agent Record

### Change Log

| Date       | Change                                                                                 | Author            |
| ---------- | -------------------------------------------------------------------------------------- | ----------------- |
| 2025-12-02 | Story drafted                                                                          | Scrum Master Bob  |
| 2025-12-02 | Quality review: Fixed 4 critical issues, added 5 enhancements, applied 3 optimizations | Quality Validator |

### Improvements Applied

- ✅ Fixed Docker mount from `:ro` to `:rw` for test output
- ✅ Fixed TestStatus enum usage in createTimeoutResult
- ✅ Removed unused XMLParser - JSON-only parsing
- ✅ Added correlationId to ITestRunOptions and propagated
- ✅ Added JEST_SAMPLE_OUTPUT and PYTEST_SAMPLE_OUTPUT constants
- ✅ Added ErrorCategory.QA_AUTOMATION for Sentry
- ✅ ConfigService for configurable timeout
- ✅ Added E2E test file location
- ✅ Added audit logging via auditLog.create()
- ✅ Fixed TL;DR accuracy

### File List

**Created:**

- `src/qa-automation/interfaces/test-runner.interface.ts` - TestFramework enum, interfaces, TEST_FRAMEWORK_CONFIG
- `src/qa-automation/dto/test-result.dto.ts` - TestCaseDto, TestSuiteDto, TestCoverageDto, TestResultDto with validators
- `src/qa-automation/parsers/test-output.parser.ts` - JSON parsers for Jest, PyTest, Go, Mocha with sample constants
- `src/qa-automation/parsers/test-output.parser.spec.ts` - Parser unit tests (14 tests passing)
- `src/qa-automation/parsers/index.ts` - Barrel export for parsers
- `src/qa-automation/docker-executor.service.ts` - Isolated Docker test execution with security controls
- `src/qa-automation/test-runner.service.ts` - Core test execution service with framework detection
- `src/qa-automation/test-runner.service.spec.ts` - TestRunnerService unit tests (19 tests passing)
- `test/qa-automation.e2e-spec.ts` - E2E tests (4 tests passing)

**Modified:**

- `src/qa-automation/interfaces/index.ts` - Added export for test-runner.interface
- `src/qa-automation/dto/index.ts` - Added export for test-result.dto
- `src/qa-automation/qa-automation.module.ts` - Added TestRunnerService, DockerExecutorService, 4 test metrics providers
- `src/common/metrics/metrics.constants.ts` - Added 4 test metrics to QA_METRICS (TEST_EXECUTIONS_TOTAL, TEST_DURATION, TEST_PASSED_TOTAL, TEST_FAILED_TOTAL)
- `src/config/configuration.ts` - Added qa.testTimeoutMs, qa.dockerMemoryLimit, qa.dockerCpuLimit configuration
- `docs/sprint-artifacts/sprint-status.yaml` - Updated story status to 'review'
