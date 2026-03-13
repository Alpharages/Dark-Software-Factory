# Story CS1.5: Auto-Assign DSF Bot to Task on Execution Start

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **PM**,
I want the PM tool task automatically assigned to the DSF bot when AI execution begins,
so that I can see at a glance in my PM tool which tasks the AI agent is working on.

## Acceptance Criteria

### AC1 — New `BotAssignmentService` created

- File: `src/integrations/bot-assignment.service.ts`
- Injectable NestJS service
- Method signature: `async assignBotToTask(ticketId: string, projectId: string, correlationId: string): Promise<void>`
- Steps inside the method:
  1. Look up `Ticket` via `PrismaService` where `id = ticketId`; if not found, log `warn` and return
  2. Call `ProjectIntegrationService.findFirstByProject(projectId)` to find the integration
  3. If no integration exists or `integration.bot_user_id` is null/empty → log `warn` ("no integration or bot_user_id for project {projectId}, skipping bot assignment") and return
  4. Call `PMProviderFactory.getProvider(integration)` to get the provider
  5. Call `provider.assignTask(ticket.clickup_task_id, integration.bot_user_id)`
  6. On success: log at `debug` level ("bot assigned to task {clickup_task_id}")
  7. On any error from steps 4–5: log `error` + call `SentryService.captureException(error)` — **do NOT rethrow**; execution must not be blocked

### AC2 — New `findFirstByProject()` method on `ProjectIntegrationService`

- File: `src/integrations/project-integration.service.ts` — MODIFY
- Add:
  ```typescript
  async findFirstByProject(projectId: string): Promise<ProjectIntegration | null> {
    const integration = await this.prisma.projectIntegration.findFirst({
      where: { project_id: projectId, bot_user_id: { not: null } },
    });
    if (!integration) return null;
    return this.decryptTokens(integration);
  }
  ```
- Filters at the DB level for integrations that have a `bot_user_id` set — skips provider records that have no bot identity, preventing a no-op lookup when a project has multiple integrations across providers. Returns `null` if none found. `decryptTokens()` handles decryption.

### AC3 — `BotAssignmentService` injected into `AIExecutionConsumer`

- File: `src/execution/ai-execution.consumer.ts` — MODIFY
- Add `BotAssignmentService` to the constructor
- After `await this.executionTracker.markInProgress(executionId, correlationId)` (current line 251), insert:
  ```typescript
  // CS1-5: Auto-assign bot to task on execution start (FR-CS13)
  await this.botAssignment.assignBotToTask(payload.ticketId, payload.projectId, correlationId);
  ```
- The call must be outside any try-catch that would block the rest of execution — `BotAssignmentService.assignBotToTask()` already handles its own errors internally

### AC4 — `IntegrationsModule` imported into `ExecutionModule`

- File: `src/execution/execution.module.ts` — MODIFY
- Add `IntegrationsModule` to the `imports` array (needed to provide `ProjectIntegrationService`, `PMProviderFactory`, and their dependencies to `BotAssignmentService`)
- Import statement: `import { IntegrationsModule } from '../integrations/integrations.module';`

### AC5 — `BotAssignmentService` registered in `IntegrationsModule`

- File: `src/integrations/integrations.module.ts` — MODIFY
- Add `SentryModule` to the `imports` array — **required** for `BotAssignmentService` to inject `SentryService`. Without this, NestJS throws `Nest can't resolve dependencies of BotAssignmentService` at startup. Every module that uses `SentryService` must import `SentryModule` explicitly (same pattern as `cost-tracking.module.ts`, `clickup.module.ts`, `pm-polling.module.ts`).
- Add `BotAssignmentService` to `providers` and `exports` arrays
- Import statements to add:
  ```typescript
  import { SentryModule } from '../common/sentry/sentry.module';
  import { BotAssignmentService } from './bot-assignment.service';
  ```
- Updated module decorator:
  ```typescript
  @Module({
    imports: [ClickUpModule, DatabaseModule, EncryptionModule, SentryModule],
    controllers: [IntegrationsController, ClickUpOAuthController],
    providers: [ProjectIntegrationService, ClickUpOAuthService, PMProviderFactory, BotAssignmentService],
    exports: [ProjectIntegrationService, ClickUpOAuthService, PMProviderFactory, BotAssignmentService],
  })
  ```

### AC6 — Unit tests for `BotAssignmentService`

- New file: `src/integrations/bot-assignment.service.spec.ts`
- Test cases:
  1. **Happy path**: integration exists with `bot_user_id` → `assignTask` called with `(ticket.clickup_task_id, integration.bot_user_id)`; no error thrown
  2. **No ticket found**: `prisma.ticket.findUnique` returns null → logs `warn`, returns without calling `assignTask`
  3. **No integration**: `findFirstByProject` returns null → logs `warn`, returns without calling `assignTask`
  4. **bot_user_id is null**: integration exists but `bot_user_id = null` → logs `warn`, returns without calling `assignTask`
  5. **assignTask throws**: `assignTask` rejects → logs `error`, calls `SentryService.captureException()`, does NOT rethrow

### AC7 — `AIExecutionConsumer` spec updated

- File: `src/execution/ai-execution.consumer.spec.ts` — MODIFY
- Add import at top of file: `import { BotAssignmentService } from '../integrations/bot-assignment.service';`
- Add `BotAssignmentService` mock to the module providers:
  ```typescript
  { provide: BotAssignmentService, useValue: { assignBotToTask: jest.fn().mockResolvedValue(undefined) } }
  ```
- Do NOT remove or alter existing tests

### AC8 — TypeScript clean

- Backend: `pnpm typecheck` zero errors; `pnpm lint` zero warnings/errors; `pnpm test` all pass

---

## Tasks / Subtasks

- [x] Task 1: Add `findFirstByProject()` to `ProjectIntegrationService` (AC2)
  - [x] Add method with `prisma.projectIntegration.findFirst({ where: { project_id: projectId, bot_user_id: { not: null } } })`
  - [x] Pipe result through `decryptTokens()`
  - [x] Return `null` if not found

- [x] Task 2: Create `BotAssignmentService` (AC1)
  - [x] Create `src/integrations/bot-assignment.service.ts`
  - [x] Inject `PrismaService`, `ProjectIntegrationService`, `PMProviderFactory`, `SentryService`, `Logger`
  - [x] Implement `assignBotToTask(ticketId, projectId, correlationId): Promise<void>`
  - [x] Step 1: look up ticket; if not found → warn + return
  - [x] Step 2: `findFirstByProject(projectId)`; if null → warn + return
  - [x] Step 3: check `integration.bot_user_id`; if null/empty → warn + return
  - [x] Step 4–5: get provider + call `assignTask(ticket.clickup_task_id, integration.bot_user_id)` in try-catch
  - [x] On success: debug log
  - [x] On error: error log + `sentry.captureException()` — do NOT rethrow

- [x] Task 3: Register `BotAssignmentService` in `IntegrationsModule` (AC5)
  - [x] Add `SentryModule` to `imports` array — required for `SentryService` injection
  - [x] Add `BotAssignmentService` to `providers` array
  - [x] Add `BotAssignmentService` to `exports` array

- [x] Task 4: Import `IntegrationsModule` into `ExecutionModule` (AC4)
  - [x] Add `IntegrationsModule` to imports in `execution.module.ts`

- [x] Task 5: Inject `BotAssignmentService` into `AIExecutionConsumer` and call it (AC3)
  - [x] Add constructor parameter `private readonly botAssignment: BotAssignmentService`
  - [x] After `markInProgress()` call (line ~251), insert bot assignment call
  - [x] Add import for `BotAssignmentService`

- [x] Task 6: Write unit tests for `BotAssignmentService` (AC6)
  - [x] Create `src/integrations/bot-assignment.service.spec.ts`
  - [x] Mock `PrismaService`, `ProjectIntegrationService`, `PMProviderFactory`, `SentryService`
  - [x] Test: happy path → `assignTask` called with correct args
  - [x] Test: no ticket → warn + no `assignTask` call
  - [x] Test: no integration → warn + no `assignTask` call
  - [x] Test: `bot_user_id` null → warn + no `assignTask` call
  - [x] Test: `bot_user_id` empty string → warn + no `assignTask` call (added by code review)
  - [x] Test: `assignTask` throws → `captureException` called + `logger.error` called, no rethrow

- [x] Task 7: Update `AIExecutionConsumer` spec (AC7)
  - [x] Add `import { BotAssignmentService } from '../integrations/bot-assignment.service'`
  - [x] Add `BotAssignmentService` mock to module providers
  - [x] Verify existing tests still pass
  - [x] Add `processExecution (Bot Assignment)` test asserting `assignBotToTask` is called with correct args

- [x] Task 8: Verify build (AC8)
  - [x] `pnpm typecheck` — zero errors
  - [x] `pnpm lint` — zero warnings/errors
  - [x] `pnpm test` — all pass (7/7 BotAssignmentService, 31/31 consumer + project-integration)

---

## Dev Notes

### Dependency Context

**CS1-5 is independent of CS1-1 through CS1-4** — it does not depend on:

- CS1-1 (remove hardcoded status maps) — no interaction
- CS1-2 (StatusDiscoveryService) — no interaction
- CS1-3 (ai_trigger_status API) — no interaction
- CS1-4 (live status picker UI) — no interaction

CS1-5 **does** depend on CS0 (Epic CS0 is fully `done`):

- `ProjectIntegration` model with `bot_user_id` field ✅ (CS0-1)
- `IPMProvider.assignTask()` interface ✅ (CS0-2)
- `ClickUpProvider.assignTask()` implementation ✅ (CS0-3)
- `PMProviderFactory.getProvider()` ✅ (CS0-4)

### Trigger Point in `ai-execution.consumer.ts`

The hook goes **immediately after** `markInProgress()` at line ~251 in `processExecution()`:

```typescript
// 1. Mark execution as in-progress
await this.executionTracker.markInProgress(executionId, correlationId);

// CS1-5: Auto-assign bot to task on execution start (FR-CS13)
await this.botAssignment.assignBotToTask(payload.ticketId, payload.projectId, correlationId);
```

This is before the cost estimation block so the PM sees the assignment immediately when execution begins. The `assignBotToTask` method is internally error-proof and will never block the consumer.

### `BotAssignmentService` Full Implementation

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { ProjectIntegrationService } from './project-integration.service';
import { PMProviderFactory } from './providers/pm-provider.factory';
import { SentryService } from '../common/sentry/sentry.service';

@Injectable()
export class BotAssignmentService {
  private readonly logger = new Logger(BotAssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly integrationService: ProjectIntegrationService,
    private readonly providerFactory: PMProviderFactory,
    private readonly sentry: SentryService,
  ) {}

  /**
   * FR-CS13: Auto-assign DSF bot to PM task when execution starts.
   * Never throws — errors are logged + captured in Sentry but execution is never blocked.
   */
  async assignBotToTask(ticketId: string, projectId: string, correlationId: string): Promise<void> {
    // Step 1: Find ticket to get external task ID
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) {
      this.logger.warn(
        `[${correlationId}] CS1-5: Ticket ${ticketId} not found — skipping bot assignment`,
      );
      return;
    }

    // Step 2: Find integration for project
    const integration = await this.integrationService.findFirstByProject(projectId);
    if (!integration) {
      this.logger.warn(
        `[${correlationId}] CS1-5: No ProjectIntegration found for project ${projectId} — skipping bot assignment`,
      );
      return;
    }

    // Step 3: Check bot_user_id
    if (!integration.bot_user_id) {
      this.logger.warn(
        `[${correlationId}] CS1-5: Integration ${integration.id} has no bot_user_id — skipping bot assignment`,
      );
      return;
    }

    // Step 4–5: Get provider and assign
    try {
      const provider = await this.providerFactory.getProvider(integration);
      await provider.assignTask(ticket.clickup_task_id, integration.bot_user_id);
      this.logger.debug(
        `[${correlationId}] CS1-5: Bot (${integration.bot_user_id}) assigned to task ${ticket.clickup_task_id}`,
      );
    } catch (error) {
      this.logger.error(
        `[${correlationId}] CS1-5: assignTask failed for task ${ticket.clickup_task_id}: ${(error as Error).message}`,
      );
      this.sentry.captureException(error as Error);
      // Intentionally not rethrowing — execution must not be blocked by PM sync issues
    }
  }
}
```

### `findFirstByProject()` Method on `ProjectIntegrationService`

Add after `findByWebhookId()` in `src/integrations/project-integration.service.ts`:

```typescript
async findFirstByProject(projectId: string): Promise<ProjectIntegration | null> {
  const integration = await this.prisma.projectIntegration.findFirst({
    where: { project_id: projectId, bot_user_id: { not: null } },
  });
  if (!integration) return null;
  return this.decryptTokens(integration);
}
```

**Why `findFirst` instead of `findUnique`?** The `@@unique([project_id, provider])` constraint means a project can have multiple integrations (one per provider). `findFirst` returns the first available one. The `bot_user_id: { not: null }` filter ensures we only return integrations that have a bot identity — if a project has a Jira integration without a bot and a ClickUp integration with one, we return the ClickUp record directly without a redundant null-check round-trip.

**`mockPrismaService.projectIntegration.findFirst` is already mocked** in `project-integration.service.spec.ts` — no test setup changes needed beyond adding the new `describe` block.

### `ProjectIntegrationService` Spec Update

Add tests for `findFirstByProject()` in `src/integrations/project-integration.service.spec.ts`:

```typescript
describe('findFirstByProject', () => {
  it('should return the first integration for a project (decrypted)', async () => { ... });
  it('should return null when no integration exists', async () => { ... });
});
```

### `AIExecutionConsumer` Constructor Change

Current constructor parameters (from `ai-execution.consumer.ts:81-106`):

```
config, rabbitmq, executionTracker, orchestrator, aiDecisionLogger,
aiCostTracker, capabilityTracker, costOptimizer, sentry, clickup,
...metric counters...
```

Add `botAssignment: BotAssignmentService` before the `@InjectMetric` parameters:

```typescript
constructor(
  private readonly config: ConfigService,
  private readonly rabbitmq: RabbitMQService,
  private readonly executionTracker: ExecutionTrackerService,
  @Inject(forwardRef(() => OrchestratorService))
  private readonly orchestrator: OrchestratorService,
  private readonly aiDecisionLogger: AIDecisionLoggerService,
  private readonly aiCostTracker: AICostTrackerService,
  private readonly capabilityTracker: AiCapabilityTrackerService,
  private readonly costOptimizer: CostOptimizerService,
  private readonly sentry: SentryService,
  private readonly clickup: ClickUpService,
  private readonly botAssignment: BotAssignmentService,  // CS1-5 NEW
  @InjectMetric('queue_messages_consumed_total')
  ...
```

### `ExecutionModule` Import

`IntegrationsModule` already exports `ProjectIntegrationService`, `PMProviderFactory`, and `ClickUpOAuthService`. Adding it to `ExecutionModule.imports` gives `BotAssignmentService` access to all its dependencies.

**Circular dependency check:** `ExecutionModule` already imports `ClickUpModule`. `IntegrationsModule` imports `ClickUpModule` too — but NestJS deduplicates module imports so no circular dependency will be created. The existing `forwardRef(() => AiRoutingModule)` pattern shows circular deps are already handled where needed; this import does not create a new circular path.

### Test Spec for `BotAssignmentService`

```typescript
describe('BotAssignmentService', () => {
  let service: BotAssignmentService;
  let prisma: jest.Mocked<PrismaService>;
  let integrationService: jest.Mocked<ProjectIntegrationService>;
  let providerFactory: jest.Mocked<PMProviderFactory>;
  let sentry: jest.Mocked<SentryService>;

  const mockTicket = {
    id: 'ticket-uuid',
    clickup_task_id: 'clickup-abc123',
    project_id: 'proj-uuid',
  };

  const mockIntegration = {
    id: 'int-uuid',
    bot_user_id: 'bot-user-123',
    provider: 'CLICKUP',
    access_token: 'tok-xyz',
  };

  // NOTE: ClickUpProvider is NOT a NestJS injectable — it is a plain class instantiated
  // by PMProviderFactory.getProvider(). Do NOT try to provide it via the testing module.
  // Mock PMProviderFactory (the injectable) and have getProvider return a plain mock object.
  const mockProvider = {
    assignTask: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    // Setup mocks and TestingModule
    prisma = { ticket: { findUnique: jest.fn() } } as any;
    integrationService = { findFirstByProject: jest.fn() } as any;
    providerFactory = { getProvider: jest.fn().mockResolvedValue(mockProvider) } as any;
    sentry = { captureException: jest.fn() } as any;
    // Create service with mocks
  });

  afterEach(() => {
    jest.clearAllMocks(); // Reset mock call counts between tests — prevents bleed-through
  });

  it('assigns bot to task on happy path', async () => {
    prisma.ticket.findUnique.mockResolvedValue(mockTicket as any);
    integrationService.findFirstByProject.mockResolvedValue(mockIntegration as any);
    providerFactory.getProvider.mockResolvedValue(mockProvider as any);

    await service.assignBotToTask('ticket-uuid', 'proj-uuid', 'corr-123');

    expect(mockProvider.assignTask).toHaveBeenCalledWith('clickup-abc123', 'bot-user-123');
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('skips when ticket not found', async () => {
    prisma.ticket.findUnique.mockResolvedValue(null);

    await service.assignBotToTask('ticket-uuid', 'proj-uuid', 'corr-123');

    expect(integrationService.findFirstByProject).not.toHaveBeenCalled();
    expect(mockProvider.assignTask).not.toHaveBeenCalled();
  });

  it('skips when no integration exists', async () => {
    prisma.ticket.findUnique.mockResolvedValue(mockTicket as any);
    integrationService.findFirstByProject.mockResolvedValue(null);

    await service.assignBotToTask('ticket-uuid', 'proj-uuid', 'corr-123');

    expect(providerFactory.getProvider).not.toHaveBeenCalled();
  });

  it('skips when bot_user_id is null', async () => {
    prisma.ticket.findUnique.mockResolvedValue(mockTicket as any);
    integrationService.findFirstByProject.mockResolvedValue({
      ...mockIntegration,
      bot_user_id: null,
    } as any);

    await service.assignBotToTask('ticket-uuid', 'proj-uuid', 'corr-123');

    expect(providerFactory.getProvider).not.toHaveBeenCalled();
  });

  it('logs error and calls Sentry when assignTask throws — does not rethrow', async () => {
    prisma.ticket.findUnique.mockResolvedValue(mockTicket as any);
    integrationService.findFirstByProject.mockResolvedValue(mockIntegration as any);
    providerFactory.getProvider.mockResolvedValue(mockProvider as any);
    mockProvider.assignTask.mockRejectedValue(new Error('ClickUp 403'));

    await expect(
      service.assignBotToTask('ticket-uuid', 'proj-uuid', 'corr-123'),
    ).resolves.not.toThrow();
    expect(sentry.captureException).toHaveBeenCalledWith(expect.any(Error));
  });
});
```

### `ClickUpProvider.assignTask()` — Behavioral Awareness

`src/integrations/providers/clickup/clickup.provider.ts:158` (CS0-3) implements:

```typescript
async assignTask(taskId: string, userId: string): Promise<void> {
  await this.retryWithBackoff(() =>
    this.client.put(`/task/${taskId}`, {
      assignees: [parseInt(userId, 10)],
    }),
  );
}
```

**Two behaviors to be aware of (do not change this implementation in CS1-5):**

1. **Replaces all assignees.** `PUT /task/{taskId}` with `{ assignees: [...] }` replaces the entire assignee list. If a human PM is already assigned, adding the bot removes them. This is intentional for CS1-5 — the bot takes ownership of the task for the execution duration. This is a known CS0-3 design choice.

2. **`bot_user_id` must be a numeric string.** ClickUp user IDs are integers (e.g., `"12345678"`). The `getSelf()` call during OAuth stores `user.id.toString()` as `bot_user_id` — so the value will always be a numeric string for valid ClickUp connections. `parseInt(userId, 10)` will produce `NaN` only if `bot_user_id` contains a non-numeric value, which indicates a corrupted OAuth record.

### SentryService Usage Pattern

`SentryService` is from `@/common/sentry/sentry.service`. It is provided by `SentryModule` (`src/common/sentry/sentry.module.ts`) which must be explicitly imported by any module that uses it — **it is NOT global**.

In `BotAssignmentService`: use `captureException(error as Error)` since we have an actual error object. `captureMessage` is for non-exception diagnostic strings. Method signature confirmed at `src/common/sentry/sentry.service.ts:116`: `captureException(error: Error, options?: CaptureErrorOptions): string`.

### Circular Dependency Check for ExecutionModule

Current `execution.module.ts` imports:

- `ConfigModule`, `DatabaseModule`, `RabbitMQModule`, `forwardRef(() => AiRoutingModule)`, `AIDecisionLoggerModule`, `CostTrackingModule`, `ProgressValidatorModule`, `ClickUpModule`, `AppMetricsModule`, `CapabilitiesModule`, `RealtimeModule`, `JwtModule`

Adding `IntegrationsModule`:

- `IntegrationsModule` imports (after this story): `ClickUpModule`, `DatabaseModule`, `EncryptionModule`, `SentryModule`
- None of these import `ExecutionModule` — **no circular dependency**

### Project Structure Notes

| File                                                   | Change Type | Notes                                                                          |
| ------------------------------------------------------ | ----------- | ------------------------------------------------------------------------------ |
| `src/integrations/bot-assignment.service.ts`           | NEW         | Core service: FR-CS13                                                          |
| `src/integrations/bot-assignment.service.spec.ts`      | NEW         | 5 test cases                                                                   |
| `src/integrations/project-integration.service.ts`      | MODIFY      | Add `findFirstByProject()`                                                     |
| `src/integrations/project-integration.service.spec.ts` | MODIFY      | Add tests for `findFirstByProject()`                                           |
| `src/integrations/integrations.module.ts`              | MODIFY      | Add `SentryModule` to imports; add `BotAssignmentService` to providers+exports |
| `src/execution/ai-execution.consumer.ts`               | MODIFY      | Inject `BotAssignmentService`, call after `markInProgress()`                   |
| `src/execution/ai-execution.consumer.spec.ts`          | MODIFY      | Add `BotAssignmentService` mock                                                |
| `src/execution/execution.module.ts`                    | MODIFY      | Add `IntegrationsModule` import                                                |

**Do NOT touch:**

- `prisma/schema.prisma` — `bot_user_id` already exists on `ProjectIntegration` (from CS0-1)
- `src/integrations/providers/clickup/clickup.provider.ts` — `assignTask()` already implemented (CS0-3)
- `src/integrations/providers/pm-provider.interface.ts` — `assignTask()` already defined (CS0-2)
- `src/integrations/providers/pm-provider.factory.ts` — no changes needed
- Any CS1-1/CS1-2/CS1-3/CS1-4 files — CS1-5 is independent

### References

- FR-CS13: "When DSF starts execution on a ticket, it must assign the task to the bot user stored in `ProjectIntegration.bot_user_id` via `IPMProvider.assignTask()`. If no integration exists, the step is skipped." [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #FR-CS13]
- Epic CS1 Story 1.5 acceptance criteria [Source: `_bmad-output/planning-artifacts/epics-clickup-smart-sync.md` #Story 1.5]
- `IPMProvider.assignTask(taskId, userId)` interface [Source: `src/integrations/providers/pm-provider.interface.ts:28`]
- `PMProviderFactory.getProvider(integration)` [Source: `src/integrations/providers/pm-provider.factory.ts:20`]
- `ProjectIntegrationService.findFirstByProject()` — NEW method to add [Source: `src/integrations/project-integration.service.ts`]
- `Ticket.clickup_task_id` — external PM task ID field [Source: `prisma/schema.prisma:42`]
- `AIExecutionConsumer.processExecution()` — trigger location after `markInProgress()` [Source: `src/execution/ai-execution.consumer.ts:251`]
- `SentryService.captureException()` pattern [Source: `src/execution/ai-execution.consumer.ts:441`]
- `IntegrationsModule` exports (`ProjectIntegrationService`, `PMProviderFactory`) [Source: `src/integrations/integrations.module.ts:15`]
- `ExecutionModule` existing imports pattern [Source: `src/execution/execution.module.ts:76-103`]
- Sprint status entry [Source: `_bmad-output/implementation-artifacts/sprint-status.yaml` #CS1-5-auto-assign-bot-on-execution]

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- All 8 ACs implemented and verified by code review (2026-03-14)
- Code review (2026-03-14) fixed: FR-CS13 reference added to consumer comment; `logger.error` assertion added to throws test; empty string `bot_user_id` test case added
- AC8 verified (2026-03-14): `pnpm typecheck` clean, `pnpm lint` clean, all 38 affected tests pass

### File List

- `src/integrations/bot-assignment.service.ts` — NEW: BotAssignmentService (AC1)
- `src/integrations/bot-assignment.service.spec.ts` — NEW: Unit tests for BotAssignmentService (AC6)
- `src/integrations/project-integration.service.ts` — MODIFIED: Added `findFirstByProject()` method (AC2)
- `src/integrations/project-integration.service.spec.ts` — MODIFIED: Added tests for `findFirstByProject()` (AC2)
- `src/integrations/integrations.module.ts` — MODIFIED: Added SentryModule to imports; BotAssignmentService to providers+exports (AC5)
- `src/execution/ai-execution.consumer.ts` — MODIFIED: Injected BotAssignmentService, added call after markInProgress (AC3)
- `src/execution/ai-execution.consumer.spec.ts` — MODIFIED: Added BotAssignmentService mock + bot assignment test (AC7)
- `src/execution/execution.module.ts` — MODIFIED: Added IntegrationsModule to imports (AC4)
