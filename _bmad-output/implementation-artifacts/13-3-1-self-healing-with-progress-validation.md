# Story 13.3.1: Self-Healing with Progress Validation

Status: ready-for-dev

## Story

**As a** Project Lead  
**I want** AI executions to use progress validation for self-healing with escalation  
**So that** I can prevent infinite loops during automated fixes and ensure human oversight when needed

## Context

This story implements the **deferred work from Story 13.3** (AC#2, AC#4, AC#6). Story 13.3 successfully implemented core cost tracking (AC#1, #3, #5), but self-healing with progress validation was identified as a substantial feature warranting its own implementation.

**Parent Story**: Story 13.3 - Update AI Execution Consumer with Cost Tracking  
**Reference**: See `13-3-update-ai-execution-with-cost-tracking.md` for completed cost tracking implementation

## Acceptance Criteria

### AC#1: Self-Healing Orchestration ✅ **(Deferred from 13.3 AC#2)**

**Given** a QA result with linting or test errors  
**When** the `QAOrchestrator` triggers self-healing  
**Then** the system should:

- Create a new `SelfHealingOrchestrator` to manage the fix attempt workflow
- Parse QA errors from `LinterService` and `TestRunnerService` results
- Track error counts before and after each fix attempt
- Enforce maximum of **2 fix attempts** (MAX_FIX_ATTEMPTS constant)
- Call `ProgressValidatorService.validateProgress()` before each retry
- Escalate to human via `ClickUpService.addComment()` if validation fails or max attempts reached

**Validation**:

- Self-healing stops after 2 failed attempts
- ClickUp comment includes error summary and AI decision log reference
- `AIDecisionLog` records each fix attempt with progress validation results

### AC#2: Progress Validation Integration

**Given** a self-healing fix attempt has completed  
**When** validating progress before the next attempt  
**Then** the system should:

- Extract error counts from QA results (lint errors, test failures)
- Compare error counts: `errorsBefore` vs `errorsAfter`
- Call `ProgressValidatorService.validateProgress({ errorsBefore, errorsAfter, maxAttempts: 2 })`
- If `ValidationResult.shouldContinue === false`, escalate instead of retrying
- If `ValidationResult.escalate === true`, create ClickUp comment with reasoning

**Validation**:

- Progress validator correctly identifies: improvement, no change, regression
- Escalation triggers when errors increase or remain unchanged after 2 attempts
- AI decision log captures validation reasoning

### AC#3: E2E Testing ✅ **(Deferred from 13.3 AC#4)**

**Given** the self-healing flow is implemented  
**When** running the E2E test suite  
**Then** the following scenarios should pass:

- **Basic Flow**: AI execution → QA failure → self-healing success
- **Progress Validation**: Fix attempt improves error count → retry continues
- **Max Attempts**: 2 failed fix attempts → escalation to ClickUp
- **No Progress**: Errors remain unchanged → escalation triggered

**Test File**: `test/self-healing-flow.e2e-spec.ts`

**Validation**:

- All 4 E2E scenarios pass
- Uses `testcontainers` for PostgreSQL and RabbitMQ
- Mocks AI provider responses for deterministic testing

### AC#4: Prometheus Metrics ✅ **(Deferred from 13.3 AC#6)**

**Given** self-healing attempts are occurring  
**When** metrics are recorded  
**Then** the following Prometheus metrics should be available:

- `ai_self_healing_attempts_total{ticket_id, outcome}` - Counter (outcome: success, escalated, max_attempts)
- `ai_self_healing_progress{ticket_id}` - Gauge (error count reduction %)

**Validation**:

- Metrics registered in `metrics.constants.ts`
- `BusinessCollector` increments counters correctly
- Grafana dashboard can query metrics (manual verification)

## Tasks / Subtasks

- [ ] **Create SelfHealingOrchestrator Service**
  - [ ] Create `src/execution/self-healing-orchestrator.service.ts`
  - [ ] Create `src/execution/interfaces/self-healing.interface.ts`
  - [ ] Inject `ProgressValidatorService`, `AIDecisionLoggerService`, `ClickUpService`
  - [ ] Implement `attemptFix(execution: Execution, qaResult: QAResult): Promise<SelfHealingResult>`
  - [ ] Track fix attempt count (max 2)
  - [ ] Parse QA errors to extract error counts

- [ ] **Progress Validation Integration**
  - [ ] Extract `errorsBefore` from previous QA result
  - [ ] Extract `errorsAfter` from current QA result
  - [ ] Call `ProgressValidatorService.validateProgress()`
  - [ ] Implement retry logic based on `ValidationResult.shouldContinue`
  - [ ] Implement escalation logic based on `ValidationResult.escalate`

- [ ] **ClickUp Escalation**
  - [ ] Format markdown comment with error summary
  - [ ] Include AI decision log reference (link to database query)
  - [ ] Call `ClickUpService.addComment(ticketId, markdownComment)`
  - [ ] Mark execution as `FAILED` with reason `ESCALATED_TO_HUMAN`

- [ ] **AI Decision Audit**
  - [ ] Log `self_healing_attempt` for each fix attempt
  - [ ] Log `progress_validation` after each attempt
  - [ ] Log `escalation_triggered` when human intervention needed
  - [ ] Include error counts, validation results, reasoning in logs

- [ ] **Prometheus Metrics** (AC#4)
  - [ ] Add `AI_SELF_HEALING_ATTEMPTS_TOTAL` to `metrics.constants.ts`
  - [ ] Add `AI_SELF_HEALING_PROGRESS` gauge to `metrics.constants.ts`
  - [ ] Register metrics in `BusinessCollector`
  - [ ] Increment counters in `SelfHealingOrchestrator`

- [ ] **E2E Tests** (AC#3)
  - [ ] Create `test/self-healing-flow.e2e-spec.ts`
  - [ ] Test: Basic self-healing success flow
  - [ ] Test: Progress validation stops retry when no improvement
  - [ ] Test: Max 2 attempts enforcement
  - [ ] Test: ClickUp escalation on max attempts
  - [ ] Use `testcontainers` for PostgreSQL/RabbitMQ

- [ ] **Unit Tests**
  - [ ] `SelfHealingOrchestrator.spec.ts`: Test all orchestration logic
  - [ ] Test MAX_FIX_ATTEMPTS enforcement
  - [ ] Test progress validation integration
  - [ ] Test escalation flow
  - [ ] Mock all dependencies (ProgressValidator, AIDecisionLogger, ClickUp)

## Dev Notes

### Architecture Compliance

**Integration Points**:

- **Story 13.3**: Cost tracking already integrated in `AIExecutionConsumer` ✅
- **Story 11.3**: `ProgressValidatorService` available (validates error count reduction)
- **Story 11.2**: `AIDecisionLoggerService` for audit trail
- **Story 3.1**: `LinterService` provides lint error counts
- **Story 3.2**: `TestRunnerService` provides test failure counts
- **Story 4.2**: `ClickUpService` for escalation comments

**Source Tree Components**:

- `src/execution/self-healing-orchestrator.service.ts` - NEW service
- `src/execution/interfaces/self-healing.interface.ts` - NEW interfaces
- `src/qa-automation/qa-orchestrator.service.ts` - Trigger point for self-healing (Story 13.4 will integrate)
- `src/common/metrics/metrics.constants.ts` - Add metrics definitions
- `src/common/metrics/collectors/business.collector.ts` - Register metrics

### Self-Healing Flow (Mermaid Diagram)

```mermaid
sequenceDiagram
    participant QA as QAOrchestrator
    participant SH as SelfHealingOrchestrator
    participant PV as ProgressValidatorService
    participant AI as AIExecutionConsumer
    participant CU as ClickUpService
    participant ADL as AIDecisionLoggerService

    QA->>SH: attemptFix(execution, qaResult)
    SH->>SH: Parse QA errors → errorsBefore
    SH->>SH: attempts = 0, MAX = 2

    loop Fix Attempts (max 2)
        SH->>AI: Trigger AI fix with error context
        AI-->>SH: Fix complete
        SH->>QA: Run QA checks
        QA-->>SH: New qaResult
        SH->>SH: Parse errors → errorsAfter

        SH->>PV: validateProgress(errorsBefore, errorsAfter, maxAttempts)
        PV-->>SH: ValidationResult { shouldContinue, escalate, reasoning }

        SH->>ADL: Log progress_validation decision

        alt Validation Success
            SH->>SH: attempts++
            SH->>SH: errorsBefore = errorsAfter
        else Validation Failed
            SH->>ADL: Log escalation_triggered
            SH->>CU: addComment(ticketId, errorSummary)
            SH-->>QA: ESCALATED
        end

        alt attempts >= MAX_FIX_ATTEMPTS
            SH->>ADL: Log max_attempts_reached
            SH->>CU: addComment(ticketId, maxAttemptsMessage)
            SH-->>QA: MAX_ATTEMPTS
        end
    end

    SH-->>QA: SUCCESS or ESCALATED
```

### Key Interfaces

```typescript
// src/execution/interfaces/self-healing.interface.ts

export interface ISelfHealingInput {
  executionId: string;
  ticketId: string;
  qaResult: QAResult; // From Prisma
  previousErrorCount: number;
}

export interface ISelfHealingResult {
  success: boolean;
  outcome: 'SUCCESS' | 'ESCALATED' | 'MAX_ATTEMPTS';
  attemptsMade: number;
  finalErrorCount: number;
  escalationReason?: string;
}

export interface IErrorCounts {
  lintErrors: number;
  testFailures: number;
  total: number;
}

export const MAX_FIX_ATTEMPTS = 2;
```

### SelfHealingOrchestrator Pseudocode

```typescript
// src/execution/self-healing-orchestrator.service.ts

async attemptFix(input: ISelfHealingInput): Promise<ISelfHealingResult> {
  const { executionId, ticketId, qaResult } = input;
  let attempts = 0;
  let errorsBefore = this.extractErrorCounts(qaResult);

  while (attempts < MAX_FIX_ATTEMPTS) {
    attempts++;

    // 1. Trigger AI fix
    await this.aiExecutionConsumer.retryWithContext(executionId, errorContext);

    // 2. Run QA checks
    const newQaResult = await this.qaOrchestrator.runChecks(executionId);
    const errorsAfter = this.extractErrorCounts(newQaResult);

    // 3. Validate progress
    const validation = await this.progressValidator.validateProgress({
      errorsBefore: errorsBefore.total,
      errorsAfter: errorsAfter.total,
      attemptNumber: attempts,
      maxAttempts: MAX_FIX_ATTEMPTS,
    });

    // 4. Log decision
    await this.aiDecisionLogger.logDecision({
      action: 'progress_validation',
      reasoning: validation.reasoning,
      inputData: { errorsBefore, errorsAfter, attempts },
      outputData: { shouldContinue: validation.shouldContinue },
    });

    // 5. Check validation result
    if (!validation.shouldContinue || validation.escalate) {
      return this.escalateToHuman(ticketId, errorsAfter, validation.reasoning);
    }

    errorsBefore = errorsAfter;
  }

  // Max attempts reached
  return this.escalateToHuman(ticketId, errorsBefore, 'Max fix attempts (2) reached');
}

private extractErrorCounts(qaResult: QAResult): IErrorCounts {
  const lintErrors = Array.isArray(qaResult.linting_errors)
    ? qaResult.linting_errors.length
    : 0;

  const testFailures = qaResult.test_results?.failed || 0;

  return {
    lintErrors,
    testFailures,
    total: lintErrors + testFailures,
  };
}

private async escalateToHuman(
  ticketId: string,
  errorCounts: IErrorCounts,
  reason: string
): Promise<ISelfHealingResult> {
  const markdown = `
## 🚨 Self-Healing Escalation

**Reason**: ${reason}

**Current Errors**:
- Lint Errors: ${errorCounts.lintErrors}
- Test Failures: ${errorCounts.testFailures}
- **Total**: ${errorCounts.total}

**AI Decision Log**: See \`ai_decision_logs\` table for execution details.

**Action Required**: Manual review and fix needed.
  `.trim();

  await this.clickupService.addComment(ticketId, markdown);

  await this.aiDecisionLogger.logDecision({
    action: 'escalation_triggered',
    reasoning: reason,
    outputData: { errorCounts },
  });

  return {
    success: false,
    outcome: 'ESCALATED',
    attemptsMade: attempts,
    finalErrorCount: errorCounts.total,
    escalationReason: reason,
  };
}
```

### Testing Strategy

**Unit Tests** (`self-healing-orchestrator.spec.ts`):

- Mock all dependencies (ProgressValidator, AIExecutionConsumer, QAOrchestrator, ClickUp)
- Test scenarios:
  - Success on first attempt (errors reduced to 0)
  - Success on second attempt (errors reduced but not to 0)
  - Escalation on no progress (errors unchanged)
  - Escalation on regression (errors increased)
  - Max attempts enforcement (stops at 2)
- Verify AI decision log calls
- Verify ClickUp comment format

**E2E Tests** (`self-healing-flow.e2e-spec.ts`):

- Use `testcontainers` for real PostgreSQL + RabbitMQ
- Mock AI provider responses for deterministic results
- Test full flow: Execution → QA Failure → Self-Healing → Escalation/Success
- Verify database state (Execution status, AIDecisionLog entries)
- Verify RabbitMQ message flow

### Dependencies

**Required Services** (must exist):

- ✅ Story 11.3: `ProgressValidatorService` - validates error reduction
- ✅ Story 11.2: `AIDecisionLoggerService` - audit trail
- ✅ Story 4.2: `ClickUpService` - escalation comments
- ✅ Story 3.1: `LinterService` - lint error parsing
- ✅ Story 3.2: `TestRunnerService` - test failure parsing

**Integration Points** (will be wired in Story 13.4):

- Story 13.4: `QAOrchestrator` triggers self-healing (this story creates the service, 13.4 integrates it)

### RabbitMQ Configuration

**Queue**: `qa-result-queue` (existing, from Story 3.7)

- Consumer: `QAOrchestrator` (Story 13.4 will call `SelfHealingOrchestrator`)
- Routing Key: `qa.result.failed`

**Self-Healing Retry Flow**:

1. QA failure detected
2. QAOrchestrator calls `SelfHealingOrchestrator.attemptFix()`
3. SelfHealingOrchestrator publishes to `ai-execution-queue` with retry context
4. AIExecutionConsumer processes retry
5. Result published to `qa-result-queue`
6. Loop continues until success or escalation

### Critical Context from Story 13.3

**Already Implemented** (do not re-implement):

- ✅ Cost tracking (pre/post-execution)
- ✅ Cost variance alerts (150%/200% thresholds)
- ✅ Model selection via `CostOptimizerService`
- ✅ AI decision audit for cost estimation

**Integration Notes**:

- `AIExecutionConsumer` already has cost tracking - self-healing retries will automatically log costs
- `Execution.selected_model` field available - self-healing can use same model or select cheaper model for fixes
- `AIDecisionLoggerService` already integrated - add new actions: `self_healing_attempt`, `progress_validation`, `escalation_triggered`

## Project Structure

```
src/
├── execution/
│   ├── self-healing-orchestrator.service.ts       # NEW: Self-healing orchestration
│   ├── self-healing-orchestrator.service.spec.ts  # NEW: Unit tests
│   ├── interfaces/
│   │   └── self-healing.interface.ts              # NEW: Interfaces
│   └── execution.module.ts                        # UPDATE: Register service
├── qa-automation/
│   └── qa-orchestrator.service.ts                 # UPDATE: Story 13.4 integration point
├── common/metrics/
│   ├── metrics.constants.ts                       # UPDATE: Add self-healing metrics
│   └── collectors/business.collector.ts           # UPDATE: Register metrics
test/
└── self-healing-flow.e2e-spec.ts                  # NEW: E2E test
```

## Definition of Done

- [ ] `SelfHealingOrchestrator` service created and registered
- [ ] MAX_FIX_ATTEMPTS constant enforced (2 attempts)
- [ ] Progress validation integrated with error count comparison
- [ ] ClickUp escalation working with formatted markdown comments
- [ ] AI decision logs for: `self_healing_attempt`, `progress_validation`, `escalation_triggered`
- [ ] Prometheus metrics registered and recording
- [ ] Unit tests: 95%+ coverage on `SelfHealingOrchestrator`
- [ ] E2E tests: 4 scenarios passing
- [ ] Build passing, lint clean
- [ ] Story file updated with Dev Agent Record
- [ ] Ready for integration in Story 13.4 (QA Orchestrator will call this service)

## References

- **Parent Story**: [13.3: Update AI Execution Consumer with Cost Tracking](./13-3-update-ai-execution-with-cost-tracking.md)
- **Story 11.3**: AI Progress Validator Service (dependency)
- **Story 11.2**: AI Decision Audit Logger (dependency)
- **Story 13.4**: Update QA Orchestrator with Self-Healing (integration point)
- **Epic 13**: AI Cost Tracking & Optimization

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
