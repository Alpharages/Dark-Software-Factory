# Story WR-4.1: Implement Hard QA Failure Provider Behaviour & State Transition

Status: done

## Story

As a **PM watching an execution**,
I want the system to recognise when all QA retries are exhausted, push the code branch to GitHub anyway, set the execution to `QA_FAILED`, and move the ClickUp ticket to the configured QA failure status,
So that the code is preserved on a branch and I'm notified immediately rather than having the execution silently fail with nothing pushed.

## Acceptance Criteria

**AC-1: QA_FAILED state set when provider returns qaStatus:'failed'**
**Given** the provider returns with `success: false` and `qaStatus: 'failed'`
**When** `ai-execution.consumer.ts` processes the result
**Then** the execution state is set to `QA_FAILED` (not `FAILED`)
**And** `prUrl` remains null in the execution record
**And** no auto-retry is triggered (QA_FAILED is a terminal PM-resolution state)

**AC-2: Branch name persisted on execution record**
**Given** the provider returns `branchName` populated in the result
**When** the execution is marked `QA_FAILED`
**Then** `branchName` is stored in the new `qa_failed_branch` column on the `Execution` record for use by WR-4.3's resolution endpoint

**AC-3: ClickUp ticket moved to qa_failure_status**
**Given** the execution is in `QA_FAILED` state
**When** `PMExecutionStatusService.notifyQAFailure()` runs
**Then** the ClickUp ticket is moved to the project's configured `qa_failure_status` via runtime discovery (`provider.getStatuses()` + name-match, no hardcoded strings)

**AC-4: Graceful handling when qa_failure_status not configured**
**Given** the project does NOT have `qa_failure_status` configured (field added by WR-4.2 — will be null at story boundary)
**When** `notifyQAFailure()` runs
**Then** a warning is logged and a ClickUp comment is posted noting the configuration gap
**And** no exception is thrown

**AC-5: Real-time UI event emitted with branch URL**
**Given** the execution reaches `QA_FAILED`
**When** `qaFailExecution()` runs
**Then** a `execution.qa_failed` WebSocket event is emitted containing `executionId`, `ticketId`, `projectId`, `branchName`, and `errorMessage`

**AC-6: QA failure does NOT trigger crash/revert path**
**Given** a result with `qaStatus: 'failed'`
**When** the consumer processes it
**Then** `revertToPreTriggerStatus()` is NOT called (that is only for PROCESS_CRASH/TIMEOUT without a result line — see WR-3.2)
**And** `updateByPhase(FAILED)` is NOT called

**AC-7: Build clean**
**Given** all changes applied
**When** `pnpm test -- --testPathPattern="pm-execution-status|ai-execution.consumer|execution-tracker"` runs
**Then** all tests pass with zero TypeScript errors (`pnpm typecheck`)

---

## Tasks / Subtasks

> **Context before starting:** WR-3.2 (crash detection) is a prerequisite — it adds `revertToPreTriggerStatus()` to `PMExecutionStatusService` and modifies the failure branch in `ai-execution.consumer.ts`. Ensure WR-3.2 is merged before implementing WR-4.1. All file line numbers below reflect the post-WR-3.2 codebase.

---

- [ ] Task 1: Add `QA_FAILED` to `ExecutionStatus` Prisma enum and `Execution` model (AC: 1, 2)
  - [ ] 1.0 **In `src/execution/execution.repository.ts`**, add `QA_FAILED` to the `updateStatus()` switch (E-3 fix — prevents silent data loss for any caller):

    ```typescript
    case ExecutionStatus.QA_FAILED:   // WR-4.1
    case ExecutionStatus.FAILED:
    case ExecutionStatus.TIMEOUT:
      updateData.failed_at = new Date();
      if (additionalData?.errorMessage !== undefined) {
        updateData.error_message = additionalData.errorMessage;
      }
      break;
    ```

    This ensures `failed_at` and `error_message` are persisted when status is set to `QA_FAILED` via any path.

  - [ ] 1.1 In `prisma/schema.prisma`, add `QA_FAILED` to the `ExecutionStatus` enum:
    ```prisma
    enum ExecutionStatus {
      QUEUED
      IN_PROGRESS
      PAUSED
      COMPLETED
      FAILED
      TIMEOUT
      CANCELLED
      AWAITING_APPROVAL
      EMERGENCY_STOPPED
      QA_FAILED          // WR-4.1: QA retries exhausted; awaiting PM resolution
    }
    ```
  - [ ] 1.2 In `prisma/schema.prisma`, add `qa_failed_branch` to the `Execution` model (after the `base_branch` field for proximity):
    ```prisma
    base_branch           String?
    qa_failed_branch      String?             // WR-4.1: branch pushed when QA exhausted retries
    ```
  - [ ] 1.3 Run `pnpm db:migrate` — name the migration `add_qa_failed_execution_status`
  - [ ] 1.4 Run `pnpm db:generate` to regenerate Prisma client

---

- [ ] Task 2: Add `QA_FAILED` to the local `ExecutionStatus` enum and `VALID_TRANSITIONS` (AC: 1)

  In `src/execution/enums/execution-status.enum.ts`:
  - [ ] 2.1 Add `QA_FAILED` to the `ExecutionStatus` enum (NB: this is a local enum that mirrors Prisma — it MUST stay in sync):
    ```typescript
    QA_FAILED = 'QA_FAILED',   // WR-4.1: QA retries exhausted; branch pushed; awaiting PM resolution
    ```
  - [ ] 2.2 Add `QA_FAILED` as a valid target from `IN_PROGRESS` in `VALID_TRANSITIONS`:
    ```typescript
    [ExecutionStatus.IN_PROGRESS]: [
      ExecutionStatus.COMPLETED,
      ExecutionStatus.FAILED,
      ExecutionStatus.TIMEOUT,
      ExecutionStatus.CANCELLED,
      ExecutionStatus.AWAITING_APPROVAL,
      ExecutionStatus.PAUSED,
      ExecutionStatus.EMERGENCY_STOPPED,
      ExecutionStatus.QA_FAILED, // WR-4.1
    ],
    ```
  - [ ] 2.3 Add `QA_FAILED` as a terminal pending-resolution state (PM must resolve via WR-4.3 endpoint):
    ```typescript
    [ExecutionStatus.QA_FAILED]: [
      ExecutionStatus.COMPLETED,  // After open_pr action (WR-4.3)
      ExecutionStatus.FAILED,     // After cancel action (WR-4.3)
    ],
    ```

---

- [ ] Task 3: Add `ExecutionQAFailedEvent` to `realtime.types.ts` (AC: 5)

  In `src/realtime/realtime.types.ts`, add after `ExecutionFailedEvent`:

  ```typescript
  export interface ExecutionQAFailedEvent {
    executionId: string;
    ticketId: string;
    projectId: string | null;
    provider: string;
    status: string;
    timestamp: string;
    payload: {
      errorMessage: string;
      branchName: string | null;
      qaRetryCount?: number;
    };
  }
  ```

---

- [ ] Task 4: Add `IExecutionQAFailure` interface to `execution.interface.ts` (AC: 1, 2)

  In `src/execution/interfaces/execution.interface.ts`, add after `IExecutionFailure`:

  ```typescript
  /**
   * QA failure data — QA retries exhausted, branch pushed, awaiting PM resolution
   */
  export interface IExecutionQAFailure {
    executionId: string;
    errorMessage: string;
    branchName: string | null;
    qaRetryCount?: number;
  }
  ```

  Also add `'qa_failed'` to `IExecutionAuditLog.action` union:

  ```typescript
  action: 'created' | 'status_changed' | 'completed' | 'failed' | 'retried' | 'qa_failed';
  ```

---

- [ ] Task 5: Add `qaFailExecution()` to `ExecutionTrackerService` (AC: 1, 2, 5)

  In `src/execution/execution-tracker.service.ts`:
  - [ ] 5.1 Add import for the new types at the top (with existing realtime imports):
    ```typescript
    import { ExecutionQAFailedEvent } from '@/realtime/realtime.types';
    import { IExecutionQAFailure } from './interfaces';
    ```
  - [ ] 5.2 Add the method after `failExecution()`.

    > **Confirmed:** `repository.update(id, data: Prisma.ExecutionUpdateInput)` already exists at `src/execution/execution.repository.ts:L147` — use it directly for field persistence. No need to add it.

    ```typescript
    /**
     * Transition execution to QA_FAILED state.
     * QA retries are exhausted; branch has been pushed but no PR created.
     * Terminal state until PM resolves via POST /executions/:id/resolve-qa-failure (WR-4.3).
     * Never triggers auto-retry.
     */
    async qaFailExecution(
      failure: IExecutionQAFailure,
      correlationId: string,
    ): Promise<IStateTransition> {
      const { executionId, errorMessage, branchName, qaRetryCount } = failure;
      const execution = await this.getExecutionOrThrow(executionId);

      const transition = this.stateMachine.transition(
        executionId,
        execution.status,
        ExecutionStatus.QA_FAILED,
        errorMessage,
      );

      try {
        // Update status (Task 1.0 adds QA_FAILED to the switch, so failed_at + error_message are set)
        await this.repository.updateStatus(executionId, ExecutionStatus.QA_FAILED, {
          errorMessage,
        });

        // Persist branch name for WR-4.3 resolution endpoint (uses existing repository.update())
        if (branchName) {
          await this.repository.update(executionId, { qa_failed_branch: branchName });
        }

        await this.repository.createAuditLog({
          entityType: 'execution',
          entityId: executionId,
          action: 'qa_failed',
          actorType: 'system',
          actorId: null,
          beforeState: { status: execution.status },
          afterState: {
            status: ExecutionStatus.QA_FAILED,
            errorMessage,
            branchName,
            qaRetryCount,
          },
          createdAt: new Date(),
        });

        await this.repository.updateTicketStatus(execution.ticket_id, 'QA_FAILED');

        await this.emitExecutionEvent({
          eventType: 'STATUS_CHANGED',
          correlationId,
          executionId,
          ticketId: execution.ticket_id,
          provider: execution.ai_provider,
          status: ExecutionStatus.QA_FAILED,
          timestamp: new Date().toISOString(),
          payload: { errorMessage, branchName, qaRetryCount },
        });

        this.executionCounter.inc({ provider: execution.ai_provider, status: 'qa_failed' });
        await this.updateStatusGauges();
      } catch (e) {
        this.logger.error(`[${correlationId}] Error in qaFailExecution:`, e);
        throw e;
      }

      // Emit real-time WebSocket event (AC-5)
      await this.emitWebSocketEvent<ExecutionQAFailedEvent>('execution.qa_failed', {
        executionId,
        ticketId: execution.ticket_id,
        projectId: execution.ticket?.project_id || null,
        provider: execution.ai_provider,
        status: ExecutionStatus.QA_FAILED,
        timestamp: new Date().toISOString(),
        payload: {
          errorMessage,
          branchName: branchName ?? null,
          qaRetryCount,
        },
      });

      return transition;
    }
    ```

---

- [ ] Task 6: Add `notifyQAFailure()` to `PMExecutionStatusService` (AC: 3, 4)

  In `src/integrations/pm-execution-status.service.ts`:
  - [ ] 6.1 Add the method after `updateByPhase()`. It bypasses the AI skill entirely — uses project-configured status directly:

    ```typescript
    /**
     * Move ClickUp ticket to the project's configured qa_failure_status.
     * If qa_failure_status is not configured (field added by WR-4.2), logs a
     * warning and posts a configuration-gap comment instead — never throws.
     *
     * @param projectId     DSF project UUID
     * @param ticketId      Internal DSF ticket UUID
     * @param branchName    The pushed feature branch (included in comment)
     * @param correlationId For log tracing
     */
    async notifyQAFailure(
      projectId: string,
      ticketId: string,
      branchName: string | null,
      correlationId?: string,
    ): Promise<void> {
      const tag = correlationId ? `[${correlationId}] ` : '';

      try {
        // 1. Resolve clickup_task_id
        const ticket = await this.prisma.ticket.findUnique({
          where: { id: ticketId },
          select: { clickup_task_id: true },
        });
        if (!ticket?.clickup_task_id) {
          this.logger.warn(`${tag}No clickup_task_id for ticket ${ticketId} — skipping`);
          return;
        }
        const clickupTaskId = ticket.clickup_task_id;

        // 2. Resolve integration
        const integration = await this.integrationService.findByProjectAndProvider(
          projectId,
          PMProvider.CLICKUP,
        );
        if (!integration) {
          this.logger.warn(`${tag}No CLICKUP integration for project ${projectId} — skipping`);
          return;
        }

        // 3. Get provider
        const provider = await this.providerFactory.getProvider(integration);

        // 4. Read qa_failure_status from project settings (added by WR-4.2).
        //    Field doesn't exist in schema yet — bypass type with (as any) until WR-4.2 lands.
        const project = await this.prisma.project.findUnique({ where: { id: projectId } });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const qaFailureStatus = (project as any)?.qa_failure_status as string | null ?? null;

        if (!qaFailureStatus) {
          // AC-4: Not configured — warn + post comment, never throw
          this.logger.warn(
            `${tag}Project ${projectId} has no qa_failure_status configured — posting comment`,
          );
          const gapComment =
            `⚠️ **QA Failure — Configuration Gap**\n\n` +
            `The AI agent exhausted all QA retries. The branch \`${branchName ?? 'unknown'}\` has been pushed but no PR was created.\n\n` +
            `**Action required:** Configure \`qa_failure_status\` in project settings so this ticket can be moved to the correct ClickUp status automatically.`;
          await provider.addComment(clickupTaskId, gapComment);
          return;
        }

        // 5. Runtime discovery — resolve qa_failure_status name to a live status (hallucination guard)
        const task = await provider.getTask(clickupTaskId);
        if (!task.listId) {
          this.logger.warn(`${tag}Task ${clickupTaskId} has no listId — skipping`);
          return;
        }
        const statuses = await provider.getStatuses(task.listId);
        const target = statuses.find(
          (s) => s.name.toLowerCase() === qaFailureStatus.toLowerCase(),
        );
        if (!target) {
          this.logger.warn(
            `${tag}qa_failure_status '${qaFailureStatus}' not found in list statuses — skipping`,
          );
          return;
        }

        // 6. Apply transition
        await provider.updateStatus(clickupTaskId, target.name);
        this.logger.log(
          `${tag}ClickUp ${clickupTaskId}: '${task.status.name}' → '${target.name}' (QA_FAILED)`,
        );
      } catch (error: unknown) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `${tag}QA failure notification skipped for ticket ${ticketId}: ${err.message}`,
        );
      }
    }
    ```

  > **Note:** `project.qa_failure_status` does NOT exist in the Prisma schema until WR-4.2. The `(project as any)?.qa_failure_status` pattern compiles cleanly in strict mode and returns `undefined` (treated as `null`) before WR-4.2 lands — triggering the config-gap comment path. After WR-4.2 the field is properly populated. Do NOT add `qa_failure_status` to `schema.prisma` here — that belongs in WR-4.2.

---

- [ ] Task 7: Wire QA failure path in `ai-execution.consumer.ts` (AC: 1, 2, 3, 4, 5, 6)

  In `src/execution/ai-execution.consumer.ts`:
  - [ ] 7.1 Import `IExecutionQAFailure` (add to existing `./interfaces` import):

    ```typescript
    import {
      IAIExecutionMessage,
      IConsumerState,
      IProcessingResult,
      IExecutionFailure,
      IExecutionQAFailure, // WR-4.1
    } from './interfaces';
    ```

  - [ ] 7.2 **Insert** a new `else if (result.qaStatus === 'failed')` branch **immediately before** the existing `} else {` failure block. Do NOT remove or modify the existing `else` block — it handles crashes and timeouts (WR-3.2). The result is a three-way branch: `if (result.success)` → `else if (result.qaStatus === 'failed')` → `else`.

    Insert this block between the closing `}` of the `if (result.success)` block and the existing `} else {`:

    ```typescript
    } else if (result.qaStatus === 'failed') {
      // WR-4.1: QA retries exhausted — branch pushed, no PR, awaiting PM resolution
      this.logger.warn(
        `[${correlationId}] Execution ${executionId} QA_FAILED — branch: ${result.branchName}`,
      );

      // Story 11.4: Audit log for QA failure outcome
      await this.aiDecisionLogger.logDecision({
        agentName: 'AIExecutionConsumer',
        action: 'ai_execution_failed',
        reasoning: `QA_FAILED: agent exhausted QA retries (count: ${result.qaRetryCount ?? 'unknown'}). Branch pushed: ${result.branchName ?? 'unknown'}. Awaiting PM resolution.`,
        ticketId: payload.ticketId,
        executionId,
        inputData: { qaRetryCount: result.qaRetryCount, branchName: result.branchName },
        outputData: { isRetryable: false, willRetry: false },
        confidence: 0.95,
      });

      const qaFailure: IExecutionQAFailure = {
        executionId,
        errorMessage: result.error?.message || 'Agentic delivery failed: QA self-healing exhausted retries',
        branchName: result.branchName ?? null,
        qaRetryCount: result.qaRetryCount,
      };
      await this.executionTracker.qaFailExecution(qaFailure, correlationId);

      // Move ClickUp to qa_failure_status (best-effort, never throws)
      await this.pmExecutionStatus.notifyQAFailure(
        payload.projectId,
        payload.ticketId,
        result.branchName ?? null,
        correlationId,
      );

      // Story 7.7: Track AI capability failure
      await this.capabilityTracker.trackExecution(
        false,
        payload.prompt,
        undefined,
        qaFailure.errorMessage,
      );

      return {
        success: false,
        executionId,
        durationMs: Date.now() - startTime,
        executedBy: result.executedBy,
      };
    // } else { ← existing WR-3.2 failure block continues unchanged below — do not remove
    ```

  > **Order matters:** The `result.qaStatus === 'failed'` check MUST come before the crash check. Both produce `error.code === AIErrorCode.PROCESS_CRASH` from the provider (`claude-code.provider.ts:L142`). Without the early `qaStatus` guard, QA failures would invoke `revertToPreTriggerStatus()` — wrong behaviour.

---

- [ ] Task 8: Tests for `ExecutionTrackerService.qaFailExecution()` (AC: 1, 2, 5)

  In `src/execution/execution-tracker.service.spec.ts` (or `execution-tracker.websocket.spec.ts`), add describe block `'qaFailExecution'`:
  - `'should set execution status to QA_FAILED'` — assert `repository.updateStatus` called with `ExecutionStatus.QA_FAILED`
  - `'should persist branchName via repository.update'` — assert `repository.update` called with `{ qa_failed_branch: 'feature/test-branch' }`
  - `'should emit execution.qa_failed WebSocket event'` — assert `emitWebSocketEvent` called with `'execution.qa_failed'` and payload containing `branchName`
  - `'should NOT trigger auto-retry'` — assert `scheduleRetry` never called (mock it, confirm it's never invoked)
  - `'should create audit log with action qa_failed'` — assert `repository.createAuditLog` called with `action: 'qa_failed'`

---

- [ ] Task 9: Tests for `PMExecutionStatusService.notifyQAFailure()` (AC: 3, 4)

  In `src/integrations/pm-execution-status.service.spec.ts`, add describe block `'notifyQAFailure'`:
  - `'should move ticket to qa_failure_status when configured'` — mock `prisma.project.findUnique` returning `{ qa_failure_status: 'QA Failed' }`, mock `provider.getStatuses` returning `[{ name: 'QA Failed', id: 'status-abc' }]`, assert `provider.updateStatus` called with `(clickupTaskId, 'QA Failed')`, assert `provider.addComment` NOT called
  - `'should post config-gap comment when qa_failure_status is null'` — mock `prisma.project.findUnique` returning `{ qa_failure_status: null }`, assert `provider.updateStatus` NOT called, assert `provider.addComment` called with comment containing "Configuration Gap"
  - `'should use case-insensitive status name matching'` — mock `qa_failure_status: 'qa failed'`, mock statuses including `{ name: 'QA Failed' }`, assert `provider.updateStatus` called (name mismatch only in casing)
  - `'should never throw — swallows all errors'` — mock `provider.getTask` throws, assert method resolves without throwing

---

- [ ] Task 10: Tests for QA failure path in `ai-execution.consumer.ts` (AC: 1, 2, 3, 6)

  In the consumer spec file, update mocks:

  `PMExecutionStatusService` mock — add `notifyQAFailure`:

  ```typescript
  useValue: {
    updateByPhase: jest.fn().mockResolvedValue(undefined),
    revertToPreTriggerStatus: jest.fn().mockResolvedValue(undefined),
    notifyQAFailure: jest.fn().mockResolvedValue(undefined),   // WR-4.1
  }
  ```

  `ExecutionTrackerService` mock — add `qaFailExecution`:

  ```typescript
  qaFailExecution: jest.fn().mockResolvedValue({ newStatus: 'QA_FAILED' }),
  ```

  `AIDecisionLoggerService` mock — verify `logDecision` is already mocked (it's used in all other paths); if not, add:

  ```typescript
  logDecision: jest.fn().mockResolvedValue(undefined),
  ```

  Add test cases:
  - `'should call qaFailExecution and notifyQAFailure when qaStatus is failed'` — mock orchestrator returns `{ success: false, qaStatus: 'failed', branchName: 'feature/test', error: { code: 'PROCESS_CRASH', message: '...' } }`, assert `executionTracker.qaFailExecution` called, `pmExecutionStatus.notifyQAFailure` called, `executionTracker.failExecution` NOT called, `pmExecutionStatus.updateByPhase` NOT called, `pmExecutionStatus.revertToPreTriggerStatus` NOT called
  - `'should pass branchName to notifyQAFailure'` — assert `notifyQAFailure` called with `payload.projectId`, `payload.ticketId`, `'feature/test'`
  - `'should NOT call qaFailExecution for PROCESS_CRASH without qaStatus'` — mock `{ success: false, error: { code: 'PROCESS_CRASH' }, qaStatus: undefined }`, assert `qaFailExecution` NOT called, `failExecution` IS called

---

- [ ] Task 11: Run and verify (AC: 7)
  - [ ] 11.1 `pnpm db:migrate` → migration applied cleanly
  - [ ] 11.2 `pnpm db:generate` → Prisma client generated with `QA_FAILED` and `qa_failed_branch`
  - [ ] 11.3 `pnpm test -- --testPathPattern="execution-tracker"` → green
  - [ ] 11.4 `pnpm test -- --testPathPattern="pm-execution-status"` → green
  - [ ] 11.5 `pnpm test -- --testPathPattern="ai-execution.consumer"` → green
  - [ ] 11.6 `pnpm typecheck` → zero errors
  - [ ] 11.7 `pnpm build` → clean build

---

## Dev Notes

### Dependency: WR-3.2 Must Be Merged First

WR-3.2 adds `revertToPreTriggerStatus()` to `PMExecutionStatusService` and restructures the failure branch in `ai-execution.consumer.ts` to call it for `PROCESS_CRASH`/`TIMEOUT` errors. WR-4.1's Task 7 inserts a new `else if (result.qaStatus === 'failed')` branch that must come **before** the WR-3.2 crash check. If you are implementing both stories simultaneously, apply WR-3.2 first, then apply WR-4.1 on top.

### What Is Already Built (Do NOT Re-implement)

**Provider layer (complete — do not modify):**

- All 4 providers already return `{ success: false, qaStatus: 'failed', branchName: '...', error: { code: 'PROCESS_CRASH', message: 'Agentic delivery failed: QA self-healing exhausted retries' } }` when QA fails after all retries.
- `ClaudeCodeProvider` (`src/ai-routing/providers/claude-code.provider.ts:L121-L154`) sets `qaFailed = agentResult.qaStatus === 'failed'`, sets `success = false` when `qaFailed`.
- `branchName` is already populated: `agentResult.branchName || env.FEATURE_BRANCH` (L135).
- Codex, Kimi, Gemini providers have identical QA failure logic (same `qaFailed` detection, same return shape).

**ExecutionPhase.QA_FAILED (already exists):**

- `src/ai-routing/agent-skills/skills/execution-phase.enum.ts:L13` — already defined.
- `ClickUpStatusSkill` already has a description for `QA_FAILED` phase (L42-L43) — but WR-4.1 does NOT use the AI skill for status selection (see critical note below).

### Critical: QA_FAILED Uses Project Config, NOT the AI Skill

`updateByPhase()` uses the `ClickUpStatusSkill` (an LLM call) to select the target ClickUp status. **`notifyQAFailure()` must NOT use this.** It reads the project's `qa_failure_status` string directly from DB and does a name-match against live statuses. Reasons:

1. The AI skill cannot know the project's configured QA failure status name.
2. It's deterministic — no LLM needed for a direct config lookup.
3. FR-WR11 explicitly prohibits hardcoded status name strings; runtime discovery via `provider.getStatuses()` + name-match is the required pattern.

### QA_FAILED vs FAILED — Key Differences

| Attribute      | FAILED                                | QA_FAILED                                 |
| -------------- | ------------------------------------- | ----------------------------------------- |
| Branch pushed? | No                                    | Yes — `qa_failed_branch` populated        |
| PR created?    | No                                    | No                                        |
| Auto-retry?    | Yes (if `isRetryable`)                | **Never** — PM resolves manually          |
| ClickUp action | `revertToPreTriggerStatus()` (WR-3.2) | `notifyQAFailure()` → `qa_failure_status` |
| Terminal?      | Pending retry                         | Pending PM resolution (WR-4.3)            |

### IAIExecutionResult Fields Already Defined

`src/ai-routing/interfaces/ai-provider.interface.ts` — `IAIExecutionResult` already has:

```typescript
qaStatus?: 'passed' | 'self_healed' | 'failed' | 'skipped';
branchName?: string;
qaRetryCount?: number;
prUrl?: string;
commitSha?: string;
```

These fields are populated by the provider and available in `result` inside the consumer. Do NOT modify this interface.

### ExecutionStatus Enum: Local vs Prisma

There are **two** `ExecutionStatus` enums that must stay in sync:

1. `prisma/schema.prisma` — the source of truth (Task 1)
2. `src/execution/enums/execution-status.enum.ts` — a TypeScript mirror used in business logic (Task 2)

After adding `QA_FAILED` to schema.prisma and running `pnpm db:generate`, Prisma generates its own `ExecutionStatus` enum. The local enum in `execution-status.enum.ts` must be updated manually to match. The import at `src/execution/interfaces/execution.interface.ts:L7` uses `{ ExecutionStatus } from '@/prisma/client'` — this is the Prisma-generated one. The tracker service uses the local one from `enums/execution-status.enum.ts`. Ensure both have `QA_FAILED`.

### Prisma Access Pattern for qa_failure_status (Pre-WR-4.2)

`notifyQAFailure()` (Task 6) reads `qa_failure_status` from the project record using `(project as any)?.qa_failure_status`. This is intentional — the field doesn't exist in the Prisma schema until WR-4.2:

- Before WR-4.2: `project` doesn't have the field → `(project as any)?.qa_failure_status` returns `undefined` → treated as `null` → config gap comment path ✅
- After WR-4.2: Field exists in schema, properly stored in DB → returned and cast to `string | null` ✅

The `eslint-disable-next-line @typescript-eslint/no-explicit-any` comment is required — do not remove it. Do NOT add `qa_failure_status` to `schema.prisma` here; that belongs in WR-4.2.

### `repository.update()` Is Already Available

`ExecutionRepository.update(id: string, data: Prisma.ExecutionUpdateInput)` exists at `src/execution/execution.repository.ts:L147`. Use it directly — no changes needed to the repository for this purpose. Once Task 1 adds `qa_failed_branch` to the Prisma schema and `pnpm db:generate` runs (Task 1.4), `Prisma.ExecutionUpdateInput` will include `qa_failed_branch` and the call in Task 5.2 will type-check.

### Files to Modify (Complete List)

| File                                              | Change                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                            | Add `QA_FAILED` to `ExecutionStatus` enum; add `qa_failed_branch` to `Execution` model |
| `src/execution/execution.repository.ts`           | Add `QA_FAILED` case to `updateStatus()` switch (Task 1.0)                             |
| `src/execution/enums/execution-status.enum.ts`    | Add `QA_FAILED` to local enum + `VALID_TRANSITIONS`                                    |
| `src/realtime/realtime.types.ts`                  | Add `ExecutionQAFailedEvent` interface                                                 |
| `src/execution/interfaces/execution.interface.ts` | Add `IExecutionQAFailure`; extend `IExecutionAuditLog.action`                          |
| `src/execution/execution-tracker.service.ts`      | Add `qaFailExecution()` method                                                         |
| `src/integrations/pm-execution-status.service.ts` | Add `notifyQAFailure()` method                                                         |
| `src/execution/ai-execution.consumer.ts`          | Insert `else if (result.qaStatus === 'failed')` branch before existing `else`          |

### Test Files to Create/Update

| File                                                   | Change                                  |
| ------------------------------------------------------ | --------------------------------------- |
| `src/execution/execution-tracker.service.spec.ts`      | Add `qaFailExecution` test suite        |
| `src/integrations/pm-execution-status.service.spec.ts` | Add `notifyQAFailure` test suite        |
| `src/execution/ai-execution.consumer.spec.ts`          | Update mocks; add QA failure path tests |

---

### Review Findings

- [x] [Review][Patch] P1 — `QA_FAILED` missing from early-exit terminal-status guard: redelivered messages re-run full AI orchestration [src/execution/ai-execution.consumer.ts ~L249] — CRITICAL. The early-exit guard that checks for already-terminal executions (COMPLETED, FAILED, TIMEOUT, CANCELLED) does not include `QA_FAILED`. A RabbitMQ redelivery before ACK confirmation causes `markInProgress` to be called on a terminal execution, then re-runs the orchestration and calls `qaFailExecution` + `notifyQAFailure` a second time. Add `ExecutionStatus.QA_FAILED` to the terminal-status skip list.

- [x] [Review][Patch] P2 — `emitWebSocketEvent` outside try/catch: Socket.IO fault triggers crash-cascade and prevents ACK [src/execution/execution-tracker.service.ts ~L503] — HIGH. The `emitWebSocketEvent<ExecutionQAFailedEvent>(...)` call is placed **after** the closing brace of the try/catch block. If it throws (gateway down, serialisation error), the exception propagates to `ai-execution.consumer.ts`'s outer catch, which calls `failExecution` + `revertToPreTriggerStatus` on an execution already set to `QA_FAILED` — the exact crash-cascade AC-6 forbids. Move the emit inside the try block.

- [x] [Review][Patch] P3 — Two-step non-atomic write: execution can be stranded in `QA_FAILED` with `qa_failed_branch = null` [src/execution/execution-tracker.service.ts ~L452-L460] — HIGH. `repository.updateStatus(QA_FAILED)` and the subsequent `repository.update({ qa_failed_branch })` are separate DB calls. A crash/kill between them leaves the execution in `QA_FAILED` with no branch name — WR-4.3's resolution endpoint depends on that field. Fix: include `qa_failed_branch` in the `updateStatus` call's `additionalData`, or merge into a single `repository.update()` call.

- [x] [Review][Patch] P4 — Empty `result.error.message` bypasses QA guard, falls through to crash-cascade [src/execution/ai-execution.consumer.ts ~L683] — HIGH. The guard requires `result.error?.message` to be truthy. A provider returning `qaStatus: 'failed'` and `branchName: 'feature/x'` but `error: { code: ..., message: '' }` (empty string) passes all three conditions as false, and the code falls through to `failExecution` + `revertToPreTriggerStatus`. Fix: replace `result.error?.message` guard with a fallback: `const errorMessage = result.error?.message || 'Agentic delivery failed: QA self-healing exhausted retries'` and use `errorMessage` in the condition.

- [x] [Review][Patch] P5 — `aiDecisionLogger.logDecision` not called in QA failure path; generic pre-QA log records `willRetry: true` [src/execution/ai-execution.consumer.ts ~L677] — MEDIUM. Spec Task 7.2 explicitly requires a `logDecision` call inside the QA block with `reasoning: 'QA_FAILED: agent exhausted QA retries...'` and `outputData: { isRetryable: false, willRetry: false }`. The implementation omits this. The existing generic `ai_execution_failed` logDecision that runs before the guard records `willRetry: isRetryable` (evaluates true), making every QA-failed execution appear in audit logs as "will retry" — incorrect.

- [x] [Review][Patch] P6 — `capabilityTracker.trackExecution` not called on QA_FAILED path [src/execution/ai-execution.consumer.ts ~L702] — MEDIUM. The QA early-return exits before the `capabilityTracker.trackExecution(false, ...)` call that runs for all other failure paths. QA failures are invisible to provider reliability scoring, skewing metrics over time. Add `await this.capabilityTracker.trackExecution(false, payload.prompt, undefined, qaFailure.errorMessage)` before the return.

- [x] [Review][Patch] P7 — `errorCode: 'QA_FAILED'` raw string literal: rename risk and ACK-path type safety [src/execution/ai-execution.consumer.ts ~L172, L703] — MEDIUM. The ACK condition `result.errorCode === 'QA_FAILED'` and the return value `errorCode: 'QA_FAILED'` use a bare string. Use `ExecutionStatus.QA_FAILED` (or a dedicated const) so a future rename catches both sites at compile time.

- [x] [Review][Patch] P8 — Missing consumer test: `'should NOT call qaFailExecution for PROCESS_CRASH without qaStatus'` [src/execution/ai-execution.consumer.spec.ts] — LOW. Spec Task 10 explicitly requires this test case: mock `{ success: false, error: { code: 'PROCESS_CRASH' }, qaStatus: undefined }`, assert `qaFailExecution` NOT called and `failExecution` IS called. It is absent from the diff.

- [x] [Review][Patch] P9 — Missing tracker tests: `'should emit execution.qa_failed WebSocket event'`, `'should NOT trigger auto-retry'`, `'should create audit log with action qa_failed'` [src/execution/execution-tracker.service.spec.ts] — LOW. Spec Task 8 enumerates five distinct test cases; only one combined test was added. The three listed are missing.

- [x] [Review][Patch] P10 — Missing PM-status test: `'should use case-insensitive status name matching'` [src/integrations/pm-execution-status.service.spec.ts] — LOW. Spec Task 9 requires this test: mock `qa_failure_status: 'qa failed'`, statuses include `{ name: 'QA Failed' }`, assert `updateStatus` called (case mismatch resolved). Absent from the diff.

- [x] [Review][Defer] D1 — State-machine transition() called before DB writes: split-brain on crash [src/execution/execution-tracker.service.ts ~L448] — pre-existing pattern across all tracker methods (failExecution, timeoutExecution, etc.), not introduced by this story.

- [x] [Review][Defer] D2 — TOCTOU: `execution.ticket?.project_id` fetched at start, used after two DB writes in WebSocket payload — pre-existing pattern across all tracker methods.

- [x] [Review][Defer] D3 — `repository.update` silent miss on deleted row for `qa_failed_branch` — pre-existing `updateMany`-based repository contract documented in the repository.
