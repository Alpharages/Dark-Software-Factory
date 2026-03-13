# Story CS1.1: Remove Hardcoded Status Maps and Env-Var Configuration

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **developer maintaining DSF**,
I want all hardcoded status maps and env-var status configuration removed,
so that there is a clean baseline before the runtime discovery system (CS1-2) takes over.

## Acceptance Criteria

### AC1 — Remove env-var status config from `env.validation.ts`

- `CLICKUP_STATUS_DEPLOYED`, `CLICKUP_STATUS_DEPLOY_FAILED`, `CLICKUP_STATUS_ROLLED_BACK` are removed from `src/config/env.validation.ts`
- No references to these three Joi keys remain in `env.validation.ts`

### AC2 — Remove `webhooks` status config block from `configuration.ts`

- `webhooks.actionableStatuses` and `webhooks.nonActionableStatuses` are removed from `src/config/configuration.ts`
- The `process.env.ACTIONABLE_STATUSES` and `process.env.NON_ACTIONABLE_STATUSES` references are removed
- If the `webhooks` config block becomes empty after removal, it should be removed entirely (or retain non-status keys such as `dedupTtlMs`, `maxRetries`, `retryDelayMs`, `useRedisDeduplication`)

### AC3 — Remove `CLICKUP_STATUS_MAP` and `mapClickUpStatus()` from `status-evaluation.service.ts`

- The exported `CLICKUP_STATUS_MAP` constant is removed from `src/ticket-intake/services/status-evaluation.service.ts`
- The private `mapClickUpStatus()` method is removed from `StatusEvaluationService`
- The `actionableStatuses` and `nonActionableStatuses` private fields and their constructor-loading logic are removed
- The `getActionableStatuses()` and `getNonActionableStatuses()` public methods are removed
- The `webhooks.actionableStatuses` / `webhooks.nonActionableStatuses` config reads in the constructor are removed
- The `onModuleInit()` logging of actionable/non-actionable statuses is removed (or the method removed entirely if empty)
- The `ConfigService` constructor injection can be removed if it is no longer needed by any remaining code in the service
- The `evaluateStatus()` method that references `this.actionableStatuses` / `this.nonActionableStatuses` is removed or stubbed to return `{ isActionable: false, internalStatus: 'QUEUED', reason: 'legacy — use ai_trigger_status (CS1-3)' }` — **preferred: stub** to avoid breaking compilation until CS1-3 replaces the gate
- The `GENERIC_STATUS_MAP` constant and `mapGenericStatus()` private method are removed (provider-specific, replaced by CS1-2)
- `mapToInternalStatus()` public method — if it only called `mapClickUpStatus()` / `mapGenericStatus()`, remove it; if other code still calls it, stub it to return `'QUEUED'` temporarily

### AC4 — Remove `mapClickUpStatusToTicketStatus()` from `clickup-task-update.consumer.ts`

- The private `mapClickUpStatusToTicketStatus()` method is removed from `src/clickup/clickup-task-update.consumer.ts`
- All call sites of `mapClickUpStatusToTicketStatus()` within the consumer are updated — replace with a literal fallback `'QUEUED'` or remove the status-mapping logic pending CS1-3 (ai_trigger_status gate)
- Compilation passes after removal

### AC5 — Remove `getClickUpStatusName()` from `deployment-status-sync.service.ts`

- The private `getClickUpStatusName()` method is removed from `src/github/services/deployment-status-sync.service.ts`
- The `config.get<string>('CLICKUP_STATUS_DEPLOYED', ...)`, `config.get<string>('CLICKUP_STATUS_DEPLOY_FAILED', ...)`, `config.get<string>('CLICKUP_STATUS_ROLLED_BACK', ...)` calls are removed
- Call site of `getClickUpStatusName()` at line ~129 is replaced with hardcoded literal strings (`'Deployed'`, `'Deployment Failed'`, `'Rolled Back'`) — these will be replaced by the provider-agnostic IPMProvider approach in CS2
- If the `ConfigService` (`this.config`) was only used by `getClickUpStatusName()`, remove the injection from the constructor

### AC6 — Remove `mapClickUpStatus()` and update `isActionableStatus()` usage in `project.service.ts`

- The private `mapClickUpStatus()` method is removed from `src/projects/project.service.ts` (lines ~517–540)
- All call sites of `mapClickUpStatus()` within the service are updated (replace with `'QUEUED'` or `TicketStatus.RECEIVED` as appropriate)
- `project.service.ts:27` imports `isActionableStatus` from `task-event.mapper.ts` — since AC7 removes that export, **this import must also be removed**
- The call site at `project.service.ts:455` that uses `isActionableStatus()` must be updated: replace with an inline check `(['AI_PROCESSING', 'QUEUED', 'VALIDATED'] as InternalTaskStatus[]).includes(status)` or remove the filtering logic pending CS1-3
- Compilation must pass after both removals

### AC7 — Update `task-event.mapper.ts` to remove `CLICKUP_STATUS_MAP` dependency

- The import of `CLICKUP_STATUS_MAP` from `status-evaluation.service` is removed from `src/ticket-intake/dto/task-event.mapper.ts`
- The `mapClickUpStatusToInternal()` exported function is removed (it wrapped `CLICKUP_STATUS_MAP`)
- All call sites of `mapClickUpStatusToInternal()` within the mapper (e.g., `internalStatus: mapClickUpStatusToInternal(rawEvent.taskStatus)`) are replaced with `internalStatus: 'QUEUED'` — a safe, temporary default pending CS1-3
- The `isActionableStatus()` exported function is **removed** from `task-event.mapper.ts`
- **Before removing `isActionableStatus()`**, verify `src/projects/project.service.ts:27` no longer imports it (that import is handled in AC6). Removing the export with an active import is a compilation error.

### AC8 — All affected unit tests updated

- `src/ticket-intake/services/status-evaluation.service.spec.ts` — remove all describe blocks and test cases for: `CLICKUP_STATUS_MAP`, `mapClickUpStatus`, `mapToInternalStatus` (10 call sites), `actionableStatuses`, `nonActionableStatuses`, `getActionableStatuses` (3 call sites), `getNonActionableStatuses` (1 call site), `evaluateStatus` tests that depend on config-injected status lists; rewrite remaining `evaluateStatus` tests to assert the stub return value `{ isActionable: false, internalStatus: 'QUEUED', ... }`
- `src/ticket-intake/dto/task-event.mapper.spec.ts` — remove the `mapClickUpStatusToInternal` import (line 6), all 5 `mapClickUpStatusToInternal(...)` test calls, the `isActionableStatus` import (line 7), and all 6 `isActionableStatus(...)` test calls
- `src/github/services/deployment-status-sync.service.spec.ts` — remove the `CLICKUP_STATUS_DEPLOYED: 'Done'` config mock (line ~99) and update the 4 `getClickUpStatusName`-related assertions (lines ~223, 231, 236, 244) to assert against hardcoded literals: `'Deployed'`, `'Deployment Failed'`, `'Rolled Back'`
- `src/webhooks/webhooks.service.spec.ts` — update the `evaluateStatus` mock (line ~56) and its 3 usage sites (lines ~132, 183, 253) to reflect the stub behavior: `evaluateStatus` now always returns `{ isActionable: false, internalStatus: 'QUEUED', reason: '...' }`; any test asserting that a webhook triggers AI processing will now assert it does NOT trigger (all webhooks are gated pending CS1-3)
- No new tests are required for this story (it is pure deletion/cleanup)
- All existing tests that are NOT related to removed functionality must continue to pass

### AC9 — TypeScript clean

- `pnpm typecheck` passes with **zero** errors after all removals
- `pnpm lint` passes with zero warnings/errors

## Tasks / Subtasks

- [x] Task 1: Remove env-var status keys from `env.validation.ts` (AC1)
  - [x] Remove `CLICKUP_STATUS_DEPLOYED`, `CLICKUP_STATUS_DEPLOY_FAILED`, `CLICKUP_STATUS_ROLLED_BACK` Joi entries
- [x] Task 2: Remove `webhooks` status config from `configuration.ts` (AC2)
  - [x] Remove `webhooks.actionableStatuses` and `webhooks.nonActionableStatuses` keys
  - [x] Remove `process.env.ACTIONABLE_STATUSES` and `process.env.NON_ACTIONABLE_STATUSES` references
  - [x] Retain remaining `webhooks` config keys (dedup, retries, etc.)
- [x] Task 3: Clean up `status-evaluation.service.ts` (AC3)
  - [x] Remove `CLICKUP_STATUS_MAP` exported const
  - [x] Remove `GENERIC_STATUS_MAP` const
  - [x] Remove `actionableStatuses` / `nonActionableStatuses` fields + constructor loading
  - [x] Remove `getActionableStatuses()` / `getNonActionableStatuses()` methods
  - [x] Remove `mapClickUpStatus()` / `mapGenericStatus()` private methods
  - [x] Stub or remove `evaluateStatus()` / `mapToInternalStatus()` methods
  - [x] Remove `ConfigService` injection if no longer used
  - [x] Update/remove `onModuleInit()` if it only logged status config
- [x] Task 4: Remove `mapClickUpStatusToTicketStatus()` from `clickup-task-update.consumer.ts` (AC4)
  - [x] Delete the private method
  - [x] Replace call sites with `'QUEUED'` fallback
- [x] Task 5: Remove `getClickUpStatusName()` from `deployment-status-sync.service.ts` (AC5)
  - [x] Delete the private method
  - [x] Replace call site with hardcoded literal strings
  - [x] Remove `ConfigService` injection if unused
- [x] Task 6: Remove `mapClickUpStatus()` and fix `isActionableStatus()` import in `project.service.ts` (AC6)
  - [x] Delete the private `mapClickUpStatus()` method
  - [x] Update `mapClickUpStatus()` call sites
  - [x] Remove `isActionableStatus` import from line 27
  - [x] Update `isActionableStatus()` call site at line 455 with inline check
- [x] Task 7: Update `task-event.mapper.ts` (AC7)
  - [x] Remove `CLICKUP_STATUS_MAP` import
  - [x] Remove `mapClickUpStatusToInternal()` exported function and replace call sites with `'QUEUED'`
  - [x] Remove `isActionableStatus()` exported function (only after AC6 import is removed)
- [x] Task 8: Update affected unit test files (AC8)
  - [x] Update `status-evaluation.service.spec.ts`
  - [x] Update `task-event.mapper.spec.ts`
  - [x] Update `deployment-status-sync.service.spec.ts`
  - [x] Update `webhooks.service.spec.ts`
- [x] Task 9: Verify build (AC9)
  - [x] `pnpm typecheck` — zero errors
  - [x] `pnpm lint` — zero errors
  - [x] `pnpm test` — all remaining tests pass (65 tests across 5 suites)

## Dev Notes

### What This Story Is (and Is NOT)

This is a **cleanup-only** story. It removes hardcoded status configuration to create a clean baseline. It does **not** implement any replacement logic:

- The replacement for status discovery → CS1-2 (`StatusDiscoveryService` + `IPMProvider.getStatuses()`)
- The replacement for AI trigger gating → CS1-3 (`ai_trigger_status` on `ProjectIntegration`)
- The replacement for hardcoded `getClickUpStatusName` → CS2 (IPMProvider-aware status push)

Where code is removed that was needed for actual runtime logic, use safe defaults (`'QUEUED'` or hardcoded string literals) as temporary stubs. Do NOT leave the application in a broken state.

### Files to Change (Exhaustive List)

| File                                                           | Change Type                                                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/config/env.validation.ts`                                 | Remove 3 Joi keys (`CLICKUP_STATUS_DEPLOYED/FAILED/ROLLED_BACK`)                                         |
| `src/config/configuration.ts`                                  | Remove `webhooks.actionableStatuses` + `webhooks.nonActionableStatuses`                                  |
| `src/ticket-intake/services/status-evaluation.service.ts`      | Major cleanup: remove maps, methods, config injection; stub `evaluateStatus()` + `mapToInternalStatus()` |
| `src/ticket-intake/services/status-evaluation.service.spec.ts` | Remove tests for all removed items; update `evaluateStatus` tests to assert stub return                  |
| `src/ticket-intake/dto/task-event.mapper.ts`                   | Remove `CLICKUP_STATUS_MAP` import, `mapClickUpStatusToInternal()`, `isActionableStatus()`               |
| `src/ticket-intake/dto/task-event.mapper.spec.ts`              | Remove all `mapClickUpStatusToInternal` + `isActionableStatus` test cases (11 total)                     |
| `src/clickup/clickup-task-update.consumer.ts`                  | Remove `mapClickUpStatusToTicketStatus()` + update 2 call sites                                          |
| `src/github/services/deployment-status-sync.service.ts`        | Remove `getClickUpStatusName()` + inline 3 literal strings at call site                                  |
| `src/github/services/deployment-status-sync.service.spec.ts`   | Remove `CLICKUP_STATUS_DEPLOYED` mock; update 4 status name assertions                                   |
| `src/projects/project.service.ts`                              | Remove `mapClickUpStatus()`; remove `isActionableStatus` import; update call sites                       |
| `src/webhooks/webhooks.service.spec.ts`                        | Update `evaluateStatus` mock + 3 test assertions to match stub behavior                                  |

### INTENTIONAL BEHAVIOR CHANGE: All Webhooks Silently Discarded After This Story

`src/webhooks/webhooks.service.ts:195` calls `StatusEvaluationService.evaluateStatus()` to decide whether an inbound webhook triggers AI processing. After this story stubs `evaluateStatus()` to always return `{ isActionable: false }`, **all incoming webhook events will be silently dropped** — no tickets will enter the dev queue.

**This is correct and intentional.** The development gate moves to `ai_trigger_status` in CS1-3. Until that story is complete, DSF will not process any new tickets from webhooks. This is a safe state — no silent regressions, no data corruption, just a paused intake queue.

The dev agent must NOT try to "fix" this by restoring old logic. If you see tests failing because webhooks no longer trigger AI, update the tests to assert the new gated behavior, not the old behavior.

### Critical: Do NOT Remove These Items

The following are part of the legacy ClickUp polling path (`ClickUpPollingOrchestrator`) which is retired in CS1-7, **not** this story:

- `src/clickup/clickup-polling-orchestrator.service.ts` — leave untouched
- `src/clickup/clickup.service.ts` — leave untouched
- Any other code in `src/clickup/` not explicitly named above

The `webhooks` config block in `configuration.ts` has other keys that must **not** be removed:

- `dedupTtlMs` — used by webhook deduplication
- `maxRetries` / `retryDelayMs` — used by retry logic
- `useRedisDeduplication` — feature flag for Redis dedup

### Architecture Pattern: NestJS ConfigService

The `ConfigService` is injected via NestJS DI. When removing it from a constructor, ensure:

1. The constructor signature still compiles
2. If it was the only injected dependency, an empty constructor is fine
3. Do not remove it if other methods in the same service still use it

Pattern currently used in `status-evaluation.service.ts`:

```typescript
constructor(private readonly configService: ConfigService) {
  const actionableList = this.configService.get<string[]>('webhooks.actionableStatuses', [...]);
  // ...
}
```

After removal, if `ConfigService` is no longer used anywhere else in that service, remove the injection.

### Architecture Pattern: Temporary Stubs for QUEUED

The `evaluateStatus()` / `mapToInternalStatus()` in `StatusEvaluationService` may still be called by other services during this sprint. The recommended stub:

```typescript
// CS1-3: This method is replaced by ai_trigger_status gate in ProjectIntegration
evaluateStatus(providerStatus: string, _providerType?: TaskProviderType): StatusEvaluationResult {
  return {
    isActionable: false,
    internalStatus: 'QUEUED',
    reason: 'legacy status evaluation removed — pending CS1-3 ai_trigger_status gate',
  };
}
```

This ensures compilation succeeds and no tasks are accidentally queued while CS1-3 is not yet implemented.

`mapToInternalStatus()` is also a public method — stub it too rather than removing it, since `status-evaluation.service.spec.ts` has 10 call sites and other consumers may exist:

```typescript
// CS1-2: Replaced by IPMProvider.getStatuses() + ai_trigger_status gate
mapToInternalStatus(_providerStatus: string, _providerType?: TaskProviderType): InternalTaskStatus {
  return 'QUEUED';
}
```

### Test Update Pattern

For `deployment-status-sync.service.spec.ts`, the test currently mocks:

```typescript
// Before (line ~99 in spec):
CLICKUP_STATUS_DEPLOYED: 'Done',
```

After this story, the `getClickUpStatusName()` method is gone. The 4 test assertions at lines ~223, 231, 236, 244 that called through `getClickUpStatusName()` must now assert against the hardcoded literals inlined at the call site:

- `COMPLETED` deployment → `'Deployed'`
- `FAILED` deployment → `'Deployment Failed'`
- `ROLLED_BACK` deployment → `'Rolled Back'`

Remove the `CLICKUP_STATUS_DEPLOYED` config mock entirely — the env var no longer influences the output.

For `task-event.mapper.spec.ts`, these test cases are removed:

- `mapClickUpStatusToInternal('to do')` → 'QUEUED'
- `mapClickUpStatusToInternal('in progress')` → 'AI_PROCESSING'
- `mapClickUpStatusToInternal('review')` → 'QA_REVIEW'
- `mapClickUpStatusToInternal('done')` → 'COMPLETED'
- `mapClickUpStatusToInternal('unknown-status')` → fallback

For `status-evaluation.service.spec.ts`, any describe blocks for `CLICKUP_STATUS_MAP`, `mapClickUpStatus`, `getActionableStatuses`, `getNonActionableStatuses` are removed. Tests for `evaluateStatus()` that rely on config-injected actionable lists are removed (or rewritten to match the stub behavior).

### Git Context from CS0

Recent commits show the CS0 implementation pattern:

- `ff5b621` — Mark Epic CS0 as complete (retro artifacts)
- `cd8480d` — `PmWebhookModule` (CS0-9)
- `81ea737` — `PmPollingOrchestrator` (CS0-8)
- `789ba59` — ClickUp OAuth (CS0-5)
- `522acd1` — `PMProviderFactory` + token refresh (CS0-4)

The CS0 work established:

- `src/integrations/` — new home for provider-agnostic integration code
- `src/clickup/pm-polling-orchestrator.service.ts` — new polling path (replaces `ClickUpPollingOrchestrator` in CS1-7)
- `ProjectIntegration` model in Prisma schema (`prisma/schema.prisma`)
- `IPMProvider` interface at `src/integrations/interfaces/pm-provider.interface.ts`
- `PMProviderFactory` at `src/integrations/factory/pm-provider.factory.ts`

This story removes **old, pre-CS0 status infrastructure** from the original ClickUp-specific modules. It does NOT touch the new `src/integrations/` structure from CS0.

### Project Structure Notes

- Backend root: `/Volumes/Data/project/products/alpharages/Dark Software Factory`
- NestJS modules follow strict module boundaries — do not cross-import between unrelated modules
- Config files: `src/config/configuration.ts` (runtime config factory) and `src/config/env.validation.ts` (Joi schema for `.env`)
- `src/ticket-intake/` — contains `StatusEvaluationService`, `task-event.mapper.ts`
- `src/clickup/` — legacy ClickUp consumer (`clickup-task-update.consumer.ts`)
- `src/github/services/` — deployment sync service
- `src/projects/` — project service

### References

- Epic CS1 spec: [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #Story 1.1]
- Architecture: [Source: `_bmad-output/planning-artifacts/architecture.md` #Config Management]
- Sprint status: [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml` #epic-CS1]
- Source files:
  - `src/config/env.validation.ts:216–219`
  - `src/config/configuration.ts:130–150`
  - `src/ticket-intake/services/status-evaluation.service.ts:31–273`
  - `src/ticket-intake/dto/task-event.mapper.ts`
  - `src/clickup/clickup-task-update.consumer.ts:357–369`
  - `src/github/services/deployment-status-sync.service.ts:242–258`
  - `src/projects/project.service.ts:517–540`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

- `src/config/env.validation.ts`
- `src/config/configuration.ts`
- `src/ticket-intake/services/status-evaluation.service.ts`
- `src/ticket-intake/services/status-evaluation.service.spec.ts`
- `src/ticket-intake/dto/task-event.mapper.ts`
- `src/ticket-intake/dto/task-event.mapper.spec.ts`
- `src/clickup/clickup-task-update.consumer.ts`
- `src/github/services/deployment-status-sync.service.ts`
- `src/github/services/deployment-status-sync.service.spec.ts`
- `src/projects/project.service.ts`
- `src/webhooks/webhooks.service.spec.ts`
