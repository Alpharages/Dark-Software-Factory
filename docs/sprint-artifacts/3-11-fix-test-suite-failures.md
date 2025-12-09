# Story 3.11: Fix Test Suite Failures (QA Module Dependency Issues)

**Status:** ready-for-dev

## Story

As a developer,
I want all unit tests passing with proper NestJS dependency injection,
So that the codebase is validated, CI/CD can run successfully, and future development has a stable foundation.

## Problem Context

### Test Failure Summary

**Test Run Results (2025-12-09):**

- ❌ **Test Suites:** 14 failed, 52 passed (66 total)
- ❌ **Tests:** 63 failed, 681 passed (744 total)
- ⏱️ **Time:** 11.164s

### Root Cause Analysis

**Primary Issue:** QaAutomationModule has an **undefined import at index [6]**

```
Nest cannot create the QaAutomationModule instance.
The module at index [6] of the QaAutomationModule "imports" array is undefined.

Potential causes:
- A circular dependency between modules
- The module at index [6] is of type "undefined"
```

**Impact Scope:**

1. `AppModule` tests failing (3/3 tests)
2. `ExecutionService` tests failing (all tests - dependency on `QaCheckPublisher`)
3. Other modules importing `QaAutomationModule` failing

**Related Context:**

- Story 3-10 (QA Automation AI Delegation Refactor) - Recently completed, deleted ~1800 LOC
- Story 3-9 (Tech Debt QA Automation Refactor) - Resolved circular dependencies
- Epic 3 refactor changed QA module architecture significantly

**Integration Context (Story 3.7 - RabbitMQ QA Queue Processing):**

Story 3.7 (completed 2025-12-05) integrated `QaCheckPublisher` into `ExecutionService.completeExecution()` method:

```typescript
// Story 3.7 AC#1: Publish QA check request after successful execution (line 95-118)
await this.qaCheckPublisher.publishQaCheck(
  dto.executionId,
  execution.ticket_id,
  projectId,
  codeFiles,
  execution.ai_provider,
  correlationId,
);
```

**This integration added a 3rd constructor dependency** that test mocks must now include.

**Reference:** [Story 3.7 Completion Notes](sprint-status.yaml#L217-228) - "Wired to ExecutionService"

## Prerequisites

**Code Context:**

- ✅ Story 3-10 (QA Automation AI Delegation Refactor) - Completed, architectural changes made
- ✅ Story 3-9 (Tech Debt QA Automation Refactor) - Completed, circular dependency cleanup

**Investigation Required:**

- Review `src/qa-automation/qa-automation.module.ts` imports array
- Check if deleted services from Story 3-10 are still referenced
- Verify `QaCheckPublisher` provider configuration
- Check `ExecutionModule` dependencies

## Acceptance Criteria

### AC#1: All Test Suites Pass

**Given** tests are run with `pnpm test`  
**When** all tests execute  
**Then**:

- ✅ **0 failed test suites** (currently 14 failing)
- ✅ **0 failed tests** (currently 63 failing)
- ✅ **Test coverage remains >80%** (NFR-M1)
- ✅ **All 744 tests pass**

### AC#2: QaAutomationModule Imports Fixed

**Given** `QaAutomationModule` has an imports array  
**When** the module is instantiated  
**Then**:

- ✅ **No undefined imports** at any index
- ✅ **All imported modules exist** and are properly exported
- ✅ **No circular dependencies** (validated by NestJS DI)
- ✅ **Module compiles** in test environment

**Investigation Steps:**

1. Check `src/qa-automation/qa-automation.module.ts` line-by-line
2. Verify all imports at top of file are valid
3. Confirm all modules in `imports: [...]` array are defined
4. Remove any stale references to deleted modules from Story 3-10

### AC#3: ExecutionService Tests Fixed

**Given** `ExecutionService` has dependencies  
**When** test module is created  
**Then**:

- ✅ **QaCheckPublisher** is available in test context
- ✅ **ExecutionTrackerService** is mocked correctly
- ✅ **ExecutionStateMachine** is mocked correctly
- ✅ **All ExecutionService tests pass**

**Fix Pattern:**

```typescript
beforeEach(async () => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ExecutionService,
      {
        provide: ExecutionTrackerService,
        useValue: mockTrackerService,
      },
      {
        provide: ExecutionStateMachine,
        useValue: mockStateMachine,
      },
      {
        provide: QaCheckPublisher, // ADD THIS
        useValue: {
          publishQaCheck: jest.fn(),
        },
      },
    ],
  }).compile();
});
```

### AC#4: AppModule Tests Fixed

**Given** `AppModule` imports all feature modules  
**When** test module compiles  
**Then**:

- ✅ **All 3 AppModule tests pass:**
  - `should import ConfigModule`
  - `should import DatabaseModule`
  - `should import all feature modules`
- ✅ **No module instantiation errors**
- ✅ **Dependency graph resolves correctly**

**Root Cause Analysis:**

- AppModule imports QaAutomationModule (transitive dependency)
- If QaAutomationModule fails to compile, AppModule tests cascade fail
- **Fix ExecutionService tests FIRST**, then AppModule tests should auto-resolve

**Verification:**

```bash
# Run AppModule tests AFTER ExecutionService fix
pnpm test -- app.module.spec.ts
# Expected: All 3 tests pass (previously failing due to QaAutomationModule compilation error)
```

### AC#5: No Regressions

**Given** test fixes are applied  
**When** tests are re-run  
**Then**:

- ✅ **All previously passing tests still pass** (681 tests remain passing)
- ✅ **No new test failures introduced**
- ✅ **CI/CD pipeline can run** (`pnpm lint && pnpm test && pnpm build` all succeed)

## Tasks / Subtasks

- [ ] **Root Cause Investigation** (AC#2)
  - [ ] View `src/qa-automation/qa-automation.module.ts` imports array
  - [ ] Check for undefined/deleted modules at index [6]
  - [ ] Review Story 3-10 changes (deleted services: `LintingService`, `TestRunnerService`, `CoverageService`, `SecurityScannerService`)
  - [ ] Verify `QaCheckPublisher` is exported from correct module
  - [ ] Check if any Epic 3 modules were deleted and need removal

- [ ] **Fix QaAutomationModule** (AC#2)
  - [ ] Remove undefined import at index [6]
  - [ ] Verify all remaining imports exist and are properly defined
  - [ ] Ensure `QaCheckPublisher` is in providers array
  - [ ] If circular dependency, apply `forwardRef()` pattern
  - [ ] Add exports array if `QaCheckPublisher` needs to be available to other modules

- [ ] **Fix ExecutionService Tests** (AC#3)
  - [ ] Add `QaCheckPublisher` mock to test providers
  - [ ] Verify `ExecutionService` constructor matches mocked dependencies
  - [ ] Run specific test: `pnpm test -- execution.service.spec.ts`
  - [ ] Confirm all ExecutionService tests pass

- [ ] **Fix AppModule Tests** (AC#4)
  - [ ] Run specific test: `pnpm test -- app.module.spec.ts`
  - [ ] Verify module dependency chain resolves
  - [ ] If needed, update test setup to handle QaAutomationModule properly

- [ ] **Verify All Tests Pass** (AC#1, #5)
  - [ ] Run full test suite: `pnpm test`
  - [ ] Verify: **Test Suites: 0 failed, 66 passed**
  - [ ] Verify: **Tests: 0 failed, 744 passed**
  - [ ] Check test coverage: `pnpm test:cov` (must be >80%)

- [ ] **CI/CD Validation** (AC#5)
  - [ ] Run lint: `pnpm lint` - 0 errors
  - [ ] Run build: `pnpm build` - TypeScript compilation succeeds
  - [ ] Confirm GitHub Actions CI would pass

- [ ] **Documentation**
  - [ ] Document fix in story file completion notes
  - [ ] Add comment in `qa-automation.module.ts` explaining index [6] fix
  - [ ] Update Story 3-10 if architectural changes need clarification

- [ ] **Story Completion**
  - [ ] Mark all tasks complete
  - [ ] Populate file list with modified files
  - [ ] Add completion notes (what was undefined, why, how fixed)
  - [ ] Update `sprint-status.yaml` to `done`

## Dev Notes

### Quick Diagnosis Commands

```bash
# Run full test suite
pnpm test

# Run specific failing tests
pnpm test -- app.module.spec.ts
pnpm test -- execution.service.spec.ts

# Run with verbose output
pnpm test -- --verbose --no-coverage

# Check QaAutomationModule structure
cat src/qa-automation/qa-automation.module.ts | grep -A 20 "imports:"
```

### Expected Fix Locations

**PRIMARY FIX:** `src/execution/execution.service.spec.ts`

**Current Issue:**

```typescript
// ExecutionService constructor (line 33-37):
constructor(
  private readonly tracker: ExecutionTrackerService,
  private readonly stateMachine: ExecutionStateMachine,
  private readonly qaCheckPublisher: QaCheckPublisher, // ← MISSING from test mocks
) {}
```

**Current Test Setup (BROKEN):**

```typescript
const module: TestingModule = await Test.createTestingModule({
  providers: [
    ExecutionService,
    { provide: ExecutionTrackerService, useValue: mockTrackerService },
    { provide: ExecutionStateMachine, useValue: mockStateMachine },
    // ❌ MISSING: QaCheckPublisher mock
  ],
}).compile();
```

**Expected Fix:**

```typescript
const mockQaCheckPublisher = {
  publishQaCheck: jest.fn().mockResolvedValue(undefined),
};

const module: TestingModule = await Test.createTestingModule({
  providers: [
    ExecutionService,
    { provide: ExecutionTrackerService, useValue: mockTrackerService },
    { provide: ExecutionStateMachine, useValue: mockStateMachine },
    { provide: QaCheckPublisher, useValue: mockQaCheckPublisher }, // ✅ ADD THIS
  ],
}).compile();
```

**SECONDARY INVESTIGATION:** Verify `qa-automation.module.ts` has no undefined imports

**Why This Matters:**

- Story 3.7 (RabbitMQ QA Queue Processing) added `QaCheckPublisher` dependency to `ExecutionService` (line 36)
- Story 3.7 completion notes confirm integration: "wired to ExecutionService" (sprint-status.yaml line 228)
- This is a **test configuration issue**, not a module structure issue

### Story 3-10 Deleted Services (Verification Reference)

**FROM Story 3-10 Completion Notes (2025-12-09):**

**Services DELETED (~1800 LOC):**

- ❌ `linter.service.ts` + `.spec.ts`
- ❌ `test-runner.service.ts` + `.spec.ts`
- ❌ `docker-executor.service.ts`
- ❌ `coverage.service.ts` + `.spec.ts`
- ❌ `coverage-baseline.service.ts`
- ❌ `coverage-file.parser.ts`
- ❌ `code-review.service.ts` + `.spec.ts`
- ❌ `parsers/` directory (3 files: eslint, flake8, pylint)
- ❌ `scanners/` directory (5 files: dependency, secrets, complexity, security-pattern, utils)

**Services ADDED (~450 LOC):**

- ✅ `AiQaOrchestrator` service - Replaces all deleted services
- ✅ 4 instruction templates for AI delegation

**CRITICAL: Story 3-10 deleted SERVICE files, NOT module imports**

**Modules Kept (Still in imports array):**

- ✅ `DatabaseModule`, `SentryModule`, `ConfigModule`, `RabbitMQModule`, `LoggerModule`, `AppMetricsModule`
- ✅ `AiRoutingModule` (NEW in Story 3-10)

**Verification Command:**

```bash
# Check if any deleted services are still referenced
rg "LinterService|TestRunnerService|CoverageService|CodeReviewService|DockerExecutor" src/qa-automation/
# Expected: 0 results (all cleaned up in Story 3-10)
```

**Reference:** [Story 3-10 File List](./3-10-qa-automation-ai-delegation-refactor.md#L612-630)

### QaAutomationModule Import Structure (Post-Story-3-10)

**Current Imports** (`qa-automation.module.ts` lines 35-42):

```typescript
imports: [
  DatabaseModule,      // [0] - Prisma for QA results storage (Story 3.6)
  SentryModule,        // [1] - Error tracking for QA failures (Story 1.9)
  ConfigModule,        // [2] - Environment config for quality gates (Story 1.4)
  RabbitMQModule,      // [3] - QA queue processing (Story 3.7)
  LoggerModule,        // [4] - Structured logging for QA operations (Story 1.7)
  AppMetricsModule,    // [5] - Prometheus metrics for QA checks (Story 3.8)
  AiRoutingModule,     // [6] - Story 3.10: AiQaOrchestrator needs OrchestratorService
],
```

**All 7 imports are valid and required.** No deletions needed.

**Anti-Pattern Prevention:**

- If you see "undefined import at index [6]" in production, check if `AiRoutingModule` export is missing
- `ExecutionModule` was NEVER imported here (it imports QaAutomationModule, not vice versa)
- Story 3-10 deleted services, NOT modules

### Test Mocking Pattern (ExecutionService)

**Pattern from similar test fixes in Epic 4:**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionService } from './execution.service';

describe('ExecutionService', () => {
  let service: ExecutionService;

  const mockTrackerService = {
    trackExecution: jest.fn(),
    updateStatus: jest.fn(),
  };

  const mockStateMachine = {
    transition: jest.fn(),
  };

  const mockQaCheckPublisher = {
    publishQaCheck: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExecutionService,
        {
          provide: ExecutionTrackerService,
          useValue: mockTrackerService,
        },
        {
          provide: ExecutionStateMachine,
          useValue: mockStateMachine,
        },
        {
          provide: QaCheckPublisher,
          useValue: mockQaCheckPublisher,
        },
      ],
    }).compile();

    service = module.get<ExecutionService>(ExecutionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
```

### Circular Dependency Pattern (If Needed)

```typescript
import { Module, forwardRef } from '@nestjs/common';

@Module({
  imports: [
    forwardRef(() => ExecutionModule), // If ExecutionModule also imports QaAutomationModule
  ],
})
export class QaAutomationModule {}
```

### Success Criteria Output

**Expected Test Output:**

```
Test Suites: 66 passed, 66 total
Tests:       744 passed, 744 total
Snapshots:   0 total
Time:        ~10-12s
Ran all test suites.
```

### Priority & Urgency

**Priority:** HIGH  
**Urgency:** CRITICAL

**Rationale:**

- ❌ **CI/CD is blocked** - Cannot merge PRs with failing tests
- ❌ **Development regression risk** - No test coverage validation
- ❌ **Epic 5 blocked** - Cannot safely start new development with broken tests
- ⏰ **Quick fix** - Add QaCheckPublisher mock to ExecutionService test

**Estimated Time Breakdown:**

- 🔍 Investigation: 10-15 minutes (verify root cause, check test output)
- 🔧 Implementation: 10-20 minutes (add QaCheckPublisher mock to ExecutionService tests)
- ✅ Verification: 10-25 minutes (run full test suite, verify coverage, check CI/CD)

**Total:** 30 minutes - 1 hour (REVISED - simple test configuration fix)

### References

- [Story 3-10: QA Automation AI Delegation Refactor](./3-10-qa-automation-ai-delegation-refactor.md) - Recent changes
- [Story 3-9: Tech Debt QA Automation Refactor](./tech-debt-qa-automation-refactor.md) - Circular dependency fixes
- [Story 3.7: RabbitMQ QA Queue Processing](./3-7-rabbitmq-qa-queue-processing.md) - QaCheckPublisher integration
- [Epic 4 Retrospective](./epic-4-retro-2025-12-08.md) - Lessons on integration testing and mock management
- [ADR-008: AI Delegation Pattern](../architecture/adr-008-ai-delegation-pattern.md) - Architecture decisions from Story 3.10
- [NestJS Circular Dependency Docs](https://docs.nestjs.com/fundamentals/circular-dependency)
- [NestJS Testing Best Practices](https://docs.nestjs.com/fundamentals/testing)

## Dev Agent Record

### Context Reference

<!-- Path(s) to story context XML will be added here by context workflow -->

### Agent Model Used

<!-- To be filled by dev agent -->

### Debug Log References

<!-- To be filled during implementation -->

### Completion Notes List

<!-- Document what was undefined at index [6], why it was undefined, and how it was fixed -->

### File List

<!-- Expected files:
- src/qa-automation/qa-automation.module.ts (FIX)
- src/ai-routing/execution/execution.service.spec.ts (ADD MOCK)
- src/app.module.spec.ts (VERIFY)
-->

## Change Log

| Date       | Author | Change                                                                                                                                            |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-12-09 | SM     | Story created based on test failure analysis. Root cause: ExecutionService tests missing QaCheckPublisher mock from Story 3.7 integration.        |
| 2025-12-09 | SM     | Marked ready-for-dev. Critical priority - blocks CI/CD and Epic 5 development. Expected quick fix (30min-1h). Test output shows 63 failing tests. |
| 2025-12-09 | SM     | CORRECTED root cause after validation: Primary fix is ExecutionService.spec.ts, not qa-automation.module.ts. Added Story 3.7 integration context. |
