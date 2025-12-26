# Story 6-R-1: Automatic Cost Cap Enforcement

Status: done

<!-- Note: Code Review completed. Fixed: (1) Added fail-closed logic to budget check for safety, (2) Added test case for missing project context, (3) Updated File List accuracy. -->

## Story

As a **Project Manager**,
I want **the system to automatically stop AI execution when the project budget is exceeded**,
so that **we prevent unexpected cost overruns**.

## Acceptance Criteria

1. **Pre-Execution Budget Check**
   - The system MUST check if the project has sufficient remaining budget BEFORE starting any AI execution (Cursor or Claude).
   - **Validation Formula**: `Current_Spend + Estimated_Cost <= Total_Budget`.
   - **Budget Source**: Use `Project.budget_usd` from database (defaults to $100.00).
   - If budget is exceeded, the execution MUST be blocked immediately (do not proceed to Orchestrator).

2. **Cost Cap Blocking Logic**
   - Implement blocking in `AIExecutionConsumer.processExecution()` immediately after cost estimation.
   - **Service Integration**: Use `AICostTrackerService.checkBudgetAvailability()`.
   - **Action**: Throw a blocking exception (e.g., `BudgetExceededException`) if check fails.
   - **Blocking Decision Logging**: MUST be logged in `AIDecisionLogger` with confidence `1.0` and reason "Cost Cap Exceeded".

3. **PM Alerting & Notification**
   - When a cost cap is hit, the system MUST trigger an alert to the Project Manager.
   - Post a comment on the ClickUp ticket: "⚠️ **Execution Blocked**: Project budget exceeded. Please increase budget or override to proceed."
   - (Optional) Send an email or Slack notification if those channels are available.

4. **Integration with Cost Tracking (Epic 13)**
   - MUST use `AICostTrackerService` (from Story 13.1) to retrieve `current_spend` and `total_budget`.
   - MUST use existing `estimateCost` logic (from Story 13.3) to get `estimated_cost`.

5. **Override Mechanism (API Support)**
   - Verify that updating `Project.budget_usd` (via existing Project API) immediately unblocks retries.
   - No new API needed if Project update endpoint exists; just verify flow.

6. **Audit Trail**
   - All blocked attempts must be recorded in the `AIDecisionLog` table.
   - Include: `ticket_id`, `project_id`, `budget_limit`, `current_spend`, `estimated_cost`.

## Tasks / Subtasks

- [ ] **Implement Budget Check Logic** (Service Layer)
  - [ ] Update `AICostTrackerService` in `src/cost-tracking/ai-cost-tracker.service.ts`:
    - [ ] Add `checkBudgetAvailability(ticketId: string, estimatedCost: Decimal): Promise<{ allowed: boolean; reason?: string; budget?: number; spend?: number }>`
    - [ ] Logic: Fetch `Project.budget_usd` and aggregate `AICostLog` for the project.
    - [ ] Return `allowed: false` if `spend + estimated > budget`.
  - [ ] Add unit tests for `checkBudgetAvailability` (edge cases: exact match, overage).

- [ ] **Implement Blocking Logic** (Consumer Layer)
  - [ ] Update `AIExecutionConsumer` in `src/execution/ai-execution.consumer.ts`:
    - [ ] In `processExecution`, immediately after `aiCostTracker.estimateCost()`:
      - [ ] Call `checkBudgetAvailability(ticketId, estimatedCost)`.
      - [ ] IF `!allowed`:
        - [ ] Log decision logic (`AIDecisionLogger` block event).
        - [ ] Send ClickUp comment (Alert PM).
        - [ ] Throw blocking error (handled as NON-RETRYABLE failure).

- [ ] **Implement Alerting**
  - [ ] Use `ClickUpService.addComment(ticketId, message)` for the alert.
  - [ ] Message template: "⚠️ **Execution Blocked**: Project budget exceeded ($${spend} / $${budget}). Estimated cost of $${cost} would exceed limit."

- [ ] **Verification**
  - [ ] **Unit Test**: Mock `checkBudgetAvailability` to return false, verify consumer throws/blocks.
  - [ ] **Integration Check**: Verify `Project.budget_usd` updates are reflected immediately (no caching issues).

## Dev Notes

- **Architecture Patterns**:
  - **Blocking Point**: `AIExecutionConsumer` is the correct place (before `orchestrator.execute`).
  - **Service Reuse**: Extend `AICostTrackerService` (Story 13.1), do NOT create new service.
  - **Data Source**: Truth is in `prisma.project` and `prisma.ai_cost_log`.

- **Source Tree Components**:
  - [MODIFY] `src/cost-tracking/ai-cost-tracker.service.ts` (Add check logic)
  - [MODIFY] `src/execution/ai-execution.consumer.ts` (Add blocking call)
  - [REF] `src/common/audit/ai-decision-logger.service.ts`
  - [REF] `src/integration/clickup.service.ts`

- **Correct File Paths**:
  - `CostTrackingService` -> `AICostTrackerService`
  - `src/cost-tracking/cost-tracking.service.ts` -> `src/cost-tracking/ai-cost-tracker.service.ts`

### References

- **Cost Tracking Service**: [Story 13-1](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/13-1-ai-cost-tracking-service.md)
- **Execution Consumer**: [Story 13-3](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/13-3-update-ai-execution-with-cost-tracking.md)
- **AI Delegation Pattern**: [ADR-008](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/architecture/adr-008-ai-delegation-pattern.md)

## Dev Agent Record

### Agent Model Used

Antigravity (simulating BMad Workflow Engine)

### Debug Log References

- [Task MD](file:///Users/khakanali/.gemini/antigravity/brain/42736493-67a2-4984-a658-5afd5fa5ef10/task.md)
- **Validation Fixes**: Corrected service name (`AICostTrackerService`), file paths, and integration point (`AIExecutionConsumer`).

### Completion Notes List

- "Story validated and optimized for zero-mistake implementation."

### File List

- `src/cost-tracking/ai-cost-tracker.service.ts`
- `src/execution/ai-execution.consumer.ts`
- `src/cost-tracking/ai-cost-tracker.service.spec.ts`
- `src/execution/ai-execution.consumer.spec.ts`
