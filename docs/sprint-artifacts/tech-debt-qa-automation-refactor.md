# Technical Debt: Refactor QA Automation Module Dependencies

**Status:** Ready for Dev
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
    -   Moving shared DTOs/Interfaces to a common isolated location if needed.
    -   removing standard barrel exports if they cause resolution order issues.
    -   Decoupling `QaResults` definitions from specific scanner implementations where possible.
3.  **Fix Tests:** Ensure `pnpm test src/qa-automation` passes 100% reliably.

## Tasks
- [ ] **Dependency Audit:** Use a tool (like `madge`) or manual inspection to list all circular dependencies in `src/qa-automation`.
- [ ] **Refactor DTOs/Interfaces:**
    -   Check `src/qa-automation/dto/index.ts` and `src/qa-automation/interfaces/index.ts`.
    -   Ensure low-level DTOs do not import high-level domain objects.
- [ ] **Fix Service Dependencies:** Verify `QaCheckConsumer`, `QaOrchestratorService`, and specific Scanner services do not have circular injection loops.
- [ ] **Verify Fix:** Run full test suite `pnpm test`.

## Acceptance Criteria
- [ ] All tests in `src/qa-automation` pass.
- [ ] No `ReferenceError` or module compilation errors during test execution.
- [ ] Build `pnpm build` completes successfully.
