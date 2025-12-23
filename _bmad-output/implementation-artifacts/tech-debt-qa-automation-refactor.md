# Technical Debt: Refactor QA Automation Module Dependencies

**Status:** Done
**Priority:** High (Blocking Clean Build)
**Related Story:** Story 4.7 (Issue identified during review)

## Background

During the code review of Story 4.7 (GitHub Push Error Handling), persistent test failures were observed in the `qa-automation` module.

- **Symptoms:** `ReferenceError` during module initialization, `Cannot access 'X' before initialization`, tests failing to compile.
- **Root Cause:** Likely circular dependencies between DTOs, Interfaces, and Services, possibly exacerbated by "barrel" exports (`index.ts`) and tight coupling between `QaResults` and `Linting` sub-domains.
- **Attempted Fixes:** A specific `LintingFixDto` circular dependency was patched in Story 4.7, but deeper module-level issues remain.

## Objectives

1.  **Analyze & Visualize Dependencies:** Map out the imports in `src/qa-automation` to identify cycles.
2.  **Refactor Module Structure:** Break circular dependencies by:
    - Moving shared DTOs/Interfaces to a common isolated location if needed.
    - removing standard barrel exports if they cause resolution order issues.
    - Decoupling `QaResults` definitions from specific scanner implementations where possible.
3.  **Fix Tests:** Ensure `pnpm test src/qa-automation` passes 100% reliably.

## Tasks

- [x] **Dependency Audit:** Use a tool (like `madge`) or manual inspection to list all circular dependencies in `src/qa-automation`.
- [x] **Refactor DTOs/Interfaces:**
  - Check `src/qa-automation/dto/index.ts` and `src/qa-automation/interfaces/index.ts`.
  - Ensure low-level DTOs do not import high-level domain objects.
- [x] **Fix Service Dependencies:** Verify `QaCheckConsumer`, `QaOrchestratorService`, and specific Scanner services do not have circular injection loops.
- [x] **Verify Fix:** Run full test suite `pnpm test`.

## Acceptance Criteria

- [x] All tests in `src/qa-automation` pass.
- [x] No `ReferenceError` or module compilation errors during test execution.
- [x] Build `pnpm build` completes successfully.

## Dev Agent Record

### File List

- src/qa-automation/qa-check.consumer.spec.ts
- src/qa-automation/qa-orchestrator.service.spec.ts

### Completion Notes

- Analyzed `src/qa-automation` using `madge` and found no circular dependencies.
- Identified that test failures were due to missing Dependency Injection providers and mismatched metric tokens (uppercase vs lowercase) in the test environment, rather than actual circular dependencies in the source code.
- Fixed `qa-check.consumer.spec.ts` by adding alternate provider tokens for `PROM_METRIC_DSF_QUEUE_...`.
- Fixed `qa-orchestrator.service.spec.ts` by adding missing mocks for `ConfigService`, `LinterService`, `TestRunnerService`, `CoverageService`, `CodeReviewService`, and `QaMetricsService`.
- Verified all 159 tests in `src/qa-automation` pass.
- Verified `pnpm build` succeeds.
