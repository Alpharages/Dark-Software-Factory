# Story 15.5: E2E Testing & Validation

Status: ready-for-dev

## Story

As a Technical Lead,
I want comprehensive end-to-end tests and concurrent load validation for the full v3 pipeline,
So that we can confidently certify the system handles production-scale concurrency (100 tickets) and critical edge cases (circular deps, file locks, metrics) before production rollout.

## Acceptance Criteria

1. **Full v3 Pipeline E2E:** A new spec `test/v3-pipeline.e2e-spec.ts` exercises the complete single-ticket lifecycle from `TicketIntakeService.processTaskEvent()` through dependency checks, file lock acquisition, and AI routing queue publish — asserting the correct `status` return value and `publishToQueue` call target at each branch.

2. **Load Test - 100 Concurrent Tickets:** A new spec `test/load-concurrent.e2e-spec.ts` fires 100 concurrent `routeTicket()` calls via `Promise.allSettled()`. At most 5 of 100 results may be rejected (< 5% failure rate). The mock's `publishToQueue` must be called ≥ 95 times across the batch.

3. **Circular Dependency Chain Validation:** A multi-ticket circular chain (A→B→C→A) is fully detected; all three calls to `intakeService.processTaskEvent()` return `status: BLOCKED_CIRCULAR` and `success: false`.

4. **File Lock Contention E2E:** Two concurrent tickets compete for the same file. The winner receives `QUEUED`; the loser receives `WAITING_FOR_LOCKS` and triggers `publishToQueue('ai-routing-wait-queue', ...)`.

5. **Metrics Validation:** After 10 sequential successful `orchestrator.execute()` calls, `orchestrator.getMetrics().totalExecutions >= 10` and `providerUsage` contains both `CURSOR_HEADLESS` and `CLAUDE_CODE` keys.

6. **Regression Gate:** `pnpm test:e2e` runs all existing specs without modification and all pass.

## Tasks / Subtasks

- [ ] Task 1: Create `test/v3-pipeline.e2e-spec.ts` — full pipeline integration (AC: #1, #3, #4)
  - [ ] Bootstrap `AppModule` with full overrides: PrismaService, RabbitMQService, RabbitMQPublisherService, ClickUpService, BranchStrategistService, PromptGeneratorService, ProviderHealthService (see Mock Shapes section below)
  - [ ] Happy path: no deps, no locks → `status === 'QUEUED'`, `publishToQueue('ai-execution-queue', ...)` called
  - [ ] Circular dep path: spy on `CircularDependencyDetectorService.detectCircularDependencies` → `hasCycle: true` → assert `BLOCKED_CIRCULAR`
  - [ ] Dependency wait path: spy on `DependencyManagerService.checkDependencies` → `canProceed: false` → assert `WAITING`
  - [ ] File lock conflict path: spy on `FileLockManagerService.acquireLocks` → `acquired: false` → assert `WAITING_FOR_LOCKS` + `ai-routing-wait-queue`
  - [ ] Multi-ticket circular chain (A→B→C→A): three intake calls all return `BLOCKED_CIRCULAR` (AC: #3)
  - [ ] Concurrent lock contention: two `routeTicket()` calls for same file — first `acquired: true`, second `acquired: false` (AC: #4)
  - [ ] Add `afterEach(() => jest.clearAllMocks())` to prevent mock state bleed between tests

- [ ] Task 2: Create `test/load-concurrent.e2e-spec.ts` — 100 concurrent tickets (AC: #2)
  - [ ] Set `jest.setTimeout(120000)` at file level
  - [ ] Bootstrap with `AppModule` + overrides (same pattern as Task 1 — module inits once in `beforeAll`, NOT per call)
  - [ ] ConfigModule must set `ai.providers.cursorHeadless.enabled: true` — otherwise service throws before any routing logic
  - [ ] Mock `ProviderHealthService.getAvailableProvider` to return `{ provider: AIProvider.CURSOR_HEADLESS }`
  - [ ] Mock `FileLockManagerService.acquireLocks` to return `{ acquired: true }` (baseline — no contention)
  - [ ] Mock `FileLockManagerService.predictFileModifications` to return `{ filePaths: ['src/file-${i}.ts'], confidence: 0.9, reasoning: 'test' }` (distinct per ticket via closure)
  - [ ] Mock `PrismaService.execution.create` to return `{ id: 'exec-${i}' }` — required for subsequent `execution.update` calls
  - [ ] Mock `PromptGeneratorService.generatePrompt` to return `{ prompt: 'test prompt' }`
  - [ ] Mock `BranchStrategistService.selectBaseBranch` to return `{ selectedBranch: 'main', reasoning: 'test' }`
  - [ ] Fire 100 concurrent `routeTicket()` calls via `Promise.allSettled()`
  - [ ] Assert `failures.length <= 5`
  - [ ] Assert `rabbitMQ.publishToQueue` call count ≥ 95
  - [ ] Add `afterEach(() => jest.clearAllMocks())`

- [ ] Task 3: Create `test/metrics-validation.e2e-spec.ts` — Prometheus metrics (AC: #5)
  - [ ] Use isolated module pattern from `test/orchestrator.e2e-spec.ts` (not AppModule)
  - [ ] Mock `AIExecutionService.executeWithProvider` to return `success: true` for all calls
  - [ ] Run 10 sequential `orchestrator.execute()` calls
  - [ ] Assert `getMetrics().totalExecutions >= 10`
  - [ ] Assert `getMetrics().successfulExecutions >= 10`
  - [ ] Assert `getMetrics().providerUsage` has `CURSOR_HEADLESS` and `CLAUDE_CODE` keys
  - [ ] Assert `getMetrics().avgExecutionTimeMs` is defined

- [ ] Task 4: Regression gate (AC: #6)
  - [ ] Run `pnpm test:e2e` — all specs must pass (including new ones)
  - [ ] Note any flaky test behavior (do not suppress; fix or document)

## Dev Notes

### V3 Full Pipeline Architecture

The complete flow under test:

```
ClickUp webhook event
  └─ TicketIntakeService.processTaskEvent()          [src/ticket-intake/]
       ├─ TicketValidatorService (quality check)
       ├─ CircularDependencyDetectorService           [src/dependencies/]
       │    └─ hasCycle → return { status: BLOCKED_CIRCULAR, success: false }
       ├─ DependencyManagerService.checkDependencies [src/dependencies/]
       │    └─ !canProceed → return { status: WAITING }
       └─ publish to 'ai-routing-queue'

AIRoutingService.routeTicket()                       [src/ai-routing/]
  ├─ prisma.project.findUnique()  ← throws if null — mock MUST return valid project
  ├─ prisma.execution.create()    ← returns { id } used in all subsequent calls
  ├─ FileLockManagerService.predictFileModifications → { filePaths: string[] }
  ├─ FileLockManagerService.acquireLocks
  │    ├─ acquired: false → WAITING_FOR_LOCKS, publish to 'ai-routing-wait-queue'
  │    └─ acquired: true → continue
  ├─ ProviderHealthService.getAvailableProvider()  ← returns null → throws
  ├─ BranchStrategistService.selectBaseBranch()   ← required on happy path
  ├─ PromptGeneratorService.generatePrompt()      ← required on happy path
  └─ rabbitMQ.publishToQueue('ai-execution-queue', ...) → return { status: 'QUEUED' }
```

### Key Service Locations

| Service                             | Path                                                       |
| ----------------------------------- | ---------------------------------------------------------- |
| `TicketIntakeService`               | `src/ticket-intake/ticket-intake.service.ts`               |
| `AIRoutingService`                  | `src/ai-routing/ai-routing.service.ts`                     |
| `CircularDependencyDetectorService` | `src/dependencies/circular-dependency-detector.service.ts` |
| `DependencyManagerService`          | `src/dependencies/dependency-manager.service.ts`           |
| `FileLockManagerService`            | `src/file-locks/file-lock-manager.service.ts`              |
| `OrchestratorService`               | `src/ai-routing/orchestrator.service.ts`                   |
| `ProviderFactoryService`            | `src/ai-routing/provider-factory.service.ts`               |
| `BranchStrategistService`           | `src/github/services/branch-strategist.service.ts`         |
| `PromptGeneratorService`            | `src/ai-routing/prompt-generator.service.ts`               |
| `ProviderHealthService`             | `src/ai-routing/provider-health.service.ts`                |

### Test Infrastructure — Module Bootstrap Pattern

**All tests using AIRoutingService** (v3-pipeline and load-concurrent) must use `AppModule` with `.overrideProvider()` calls. Do NOT attempt a custom lightweight module — `AIRoutingService` injects ConfigService, PrismaService, BranchStrategistService, PromptGeneratorService, ProviderHealthService, and four Prometheus metrics. The AppModule approach mocks all of these cleanly.

The module initialises **once** in `beforeAll`. All 100 concurrent calls in the load test share that single initialised app — there is no per-call overhead.

```typescript
// Pattern for v3-pipeline and load-concurrent
const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(PrismaService)
  .useValue(mockPrisma)
  .overrideProvider(RabbitMQService)
  .useValue(mockRabbitMQService)
  .overrideProvider(RabbitMQPublisherService)
  .useValue(mockRabbitMQ)
  .overrideProvider(ClickUpService)
  .useValue({
    updateStatus: jest.fn().mockResolvedValue(true),
    addComment: jest.fn().mockResolvedValue(true),
  })
  .overrideProvider(BranchStrategistService)
  .useValue({
    selectBaseBranch: jest.fn().mockResolvedValue({ selectedBranch: 'main', reasoning: 'test' }),
  })
  .overrideProvider(PromptGeneratorService)
  .useValue({ generatePrompt: jest.fn().mockResolvedValue({ prompt: 'test prompt' }) })
  .overrideProvider(ProviderHealthService)
  .useValue({
    getAvailableProvider: jest.fn().mockResolvedValue({ provider: AIProvider.CURSOR_HEADLESS }),
    shouldAlert: jest.fn().mockReturnValue(false),
  })
  .compile();
```

**Isolated-module tests** (metrics-validation.e2e-spec.ts): follow `test/orchestrator.e2e-spec.ts` — use `Test.createTestingModule({ providers: [...] })` with explicit providers only.

### Required PrismaService Mock Shape (for AIRoutingService tests)

`AIRoutingService.routeTicket()` makes these Prisma calls in sequence. All must be mocked:

```typescript
const mockPrisma = {
  $connect: jest.fn(),
  $disconnect: jest.fn(),
  $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]),
  project: {
    findUnique: jest.fn().mockResolvedValue({
      id: 'proj-123',
      github_repository_url: 'https://github.com/org/repo',
      default_branch: 'main',
    }),
    findFirst: jest.fn().mockResolvedValue({ id: 'proj-123' }),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
  execution: {
    // CRITICAL: must return { id } — used in all subsequent execution.update calls
    create: jest.fn().mockResolvedValue({ id: 'exec-test-123', status: 'QUEUED' }),
    update: jest.fn().mockResolvedValue({ id: 'exec-test-123' }),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  ticket: {
    update: jest.fn().mockResolvedValue({}),
    create: jest.fn().mockResolvedValue({ id: 'ticket-123' }),
    findUnique: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue({}),
  },
  ticketDependency: {
    findMany: jest.fn().mockResolvedValue([]), // empty = no dependencies
    create: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  auditLog: {
    create: jest.fn().mockResolvedValue({}),
  },
  aIDecisionLog: {
    create: jest.fn().mockResolvedValue({}),
  },
  fileLock: {
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  // ... include qaResult, workspace, providerHealth as in dependency-flow.e2e-spec.ts:35-107
};
```

### ConfigModule — AI Provider Must Be Enabled

`AIRoutingService` validates at startup that at least one provider is enabled. If neither `ai.providers.cursorHeadless.enabled` nor `ai.providers.claudeCode.enabled` is `true`, it **throws before any routing logic runs**, failing all 100 load test calls immediately.

The `jest-setup.ts` does NOT set these env vars. You must supply them via ConfigModule in the test module:

```typescript
// Option A: Set env var in beforeAll before module init (simplest)
process.env.CURSOR_HEADLESS_ENABLED = 'true';

// Option B: Override ConfigService in the module builder chain
const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(ConfigService)
  .useValue({
    get: jest.fn((key: string) => {
      const config: Record<string, unknown> = {
        'ai.providers.cursorHeadless.enabled': true,
        'ai.routing.complexityThreshold': 10,
      };
      return config[key];
    }),
  })
  // ... other overrides
  .compile();
```

### `predictFileModifications` Mock Return Shape

The service calls: `const predictionResult = await this.fileLockManager.predictFileModifications(...)` and uses `predictionResult.filePaths` (an array of strings). The mock must return this exact shape:

```typescript
jest.spyOn(fileLockService, 'predictFileModifications').mockResolvedValue({
  filePaths: ['src/feature.ts', 'src/feature.spec.ts'],
  confidence: 0.9,
  reasoning: 'Predicted from ticket title',
});
```

For the load test, generate distinct paths per ticket to avoid accidental lock collisions across the 100 calls:

```typescript
// In the load test, mock at module level with an incrementing counter
let callCount = 0;
jest.spyOn(fileLockService, 'predictFileModifications').mockImplementation(async () => ({
  filePaths: [`src/feature-${callCount++}.ts`],
  confidence: 0.9,
  reasoning: 'test',
}));
```

### File Lock Mock for Concurrent Contention (AC: #4)

```typescript
let lockHeld = false;
jest.spyOn(fileLockService, 'acquireLocks').mockImplementation(async () => {
  if (!lockHeld) {
    lockHeld = true;
    return { acquired: true };
  }
  return {
    acquired: false,
    conflicts: { filePaths: ['src/app.ts'], ownerTicketIds: ['tick-1'] },
  };
});
```

### Load Test Implementation Pattern

```typescript
// test/load-concurrent.e2e-spec.ts
jest.setTimeout(120_000);

// In beforeAll: set env var before module init
process.env.CURSOR_HEADLESS_ENABLED = 'true';

// Bootstrap AppModule with overrides (see Module Bootstrap Pattern above)
// Then get service instances:
// routingService = app.get<AIRoutingService>(AIRoutingService);
// rabbitMQ = app.get<RabbitMQPublisherService>(RabbitMQPublisherService);

afterEach(() => {
  jest.clearAllMocks();
});

it('should handle 100 concurrent ticket routings with <5% failure', async () => {
  const tickets = Array.from({ length: 100 }, (_, i) =>
    routingService.routeTicket({
      correlationId: `load-${i}`,
      ticketId: `tick-${i}`,
      clickupTaskId: `cu-${i}`,
      projectId: 'proj-123',
      title: `Load test ticket ${i}`,
      description: 'desc',
      acceptanceCriteria: 'ac',
      tags: [],
      qualityScore: 80,
      qualityGrade: 'excellent',
      timestamp: new Date().toISOString(),
    }),
  );

  const results = await Promise.allSettled(tickets);
  const failures = results.filter((r) => r.status === 'rejected');
  expect(failures.length).toBeLessThanOrEqual(5);

  const queueCalls = (rabbitMQ.publishToQueue as jest.Mock).mock.calls.length;
  expect(queueCalls).toBeGreaterThanOrEqual(95);
});
```

**CRITICAL**: Use `Promise.allSettled()` — NOT `Promise.all()`. `Promise.all()` short-circuits on first rejection, hiding the actual failure rate.

### Metrics Module Provider Tokens

For `test/metrics-validation.e2e-spec.ts` (isolated module, follows `test/orchestrator.e2e-spec.ts`):

**OrchestratorService** (`src/ai-routing/orchestrator.service.ts`) injects:

- `'PROM_METRIC_ORCHESTRATOR_EXECUTIONS_TOTAL'` (`@InjectMetric('orchestrator_executions_total')`)
- `'PROM_METRIC_ORCHESTRATOR_EXECUTION_DURATION_SECONDS'` (`@InjectMetric('orchestrator_execution_duration_seconds')`)
- `'PROM_METRIC_ORCHESTRATOR_COST_CENTS'` (`@InjectMetric('orchestrator_cost_cents')`)
- `'PROM_METRIC_ADR_CREATION_TOTAL'` (`@InjectMetric('adr_creation_total')`)

**ProviderFactoryService** (`src/ai-routing/provider-factory.service.ts`) injects:

- `'PROM_METRIC_ORCHESTRATOR_PROVIDER_SELECTIONS_TOTAL'` (`@InjectMetric('orchestrator_provider_selections_total')`)

**FallbackStrategyService** (`src/ai-routing/fallback-strategy.service.ts`) injects:

- `'PROM_METRIC_ORCHESTRATOR_FALLBACK_TOTAL'` (`@InjectMetric('orchestrator_fallback_total')`)
- `'PROM_METRIC_ORCHESTRATOR_FALLBACK_SUCCESS_TOTAL'` (`@InjectMetric('orchestrator_fallback_success_total')`)
- `'PROM_METRIC_ORCHESTRATOR_FALLBACK_DURATION_SECONDS'` (`@InjectMetric('orchestrator_fallback_duration_seconds')`)

All mocked as: `{ inc: jest.fn(), observe: jest.fn(), set: jest.fn(), startTimer: jest.fn().mockReturnValue(jest.fn()) }`.

Note: `OrchestratorService.getMetrics()` returns in-memory counters (not Prometheus — those are just the `inc/observe` side-channel). The assertions on `totalExecutions`, `successfulExecutions`, `providerUsage`, `avgExecutionTimeMs` read from private fields updated in `trackExecution()`.

### Anti-Patterns — DO NOT

- **Do NOT** attempt a custom "lightweight" module for `AIRoutingService` — it requires PrismaService, BranchStrategistService, PromptGeneratorService, ProviderHealthService, and 4 Prometheus metrics. Use AppModule with overrides.
- **Do NOT** return `{}` from `prisma.execution.create` — the service reads `execution.id` immediately after and uses it in every subsequent Prisma call. Return `{ id: 'exec-test-123' }`.
- **Do NOT** omit `CURSOR_HEADLESS_ENABLED=true` (or equivalent) — the service throws at line 82 if no provider is enabled, failing all calls before any routing logic.
- **Do NOT** mock `predictFileModifications` to return `{ filePaths: undefined }` — use the exact shape `{ filePaths: string[], confidence: number, reasoning: string }`.
- **Do NOT** use `Promise.all()` for the 100-ticket load test — one rejection aborts all.
- **Do NOT** install Artillery, k6, or autocannon — they are not in the project's dependencies.
- **Do NOT** duplicate provider selection assertions from `orchestrator.e2e-spec.ts`.
- **Do NOT** use `jest.useFakeTimers()` in load tests — real async timing is required.
- **Do NOT** modify `jest-setup.ts` or `jest-e2e.json` — only add new spec files.
- **Do NOT** touch `src/` — this story is test-only. No production code changes.
- **Do NOT** omit `afterEach(() => jest.clearAllMocks())` — mock call counts accumulate across tests and will break assertions.

### Project Structure Notes

All new files land in `test/`:

```
test/
  v3-pipeline.e2e-spec.ts        # new — full pipeline AC #1, #3, #4
  load-concurrent.e2e-spec.ts    # new — 100 concurrent AC #2
  metrics-validation.e2e-spec.ts # new — Prometheus metrics AC #5
```

Run specific test during development:

```bash
pnpm test:e2e -- --testPathPattern=v3-pipeline
pnpm test:e2e -- --testPathPattern=load-concurrent
pnpm test:e2e -- --testPathPattern=metrics-validation
pnpm test:e2e  # run all (regression gate)
```

### NFR Coverage

| NFR     | Description                   | Covered By                                |
| ------- | ----------------------------- | ----------------------------------------- |
| NFR-P7  | 10+ concurrent AI executions  | load-concurrent.e2e-spec.ts (100 tickets) |
| NFR-SC2 | 50+ concurrent AI executions  | load-concurrent.e2e-spec.ts               |
| NFR-SC7 | 100+ webhook events/hour      | v3-pipeline + load-concurrent             |
| NFR-O5  | Prometheus metrics endpoint   | metrics-validation.e2e-spec.ts            |
| NFR-R3  | Failed executions recoverable | v3-pipeline retry/wait paths              |
| NFR-M1  | >80% test coverage            | All new E2E specs                         |

### References

- [Source: test/dependency-flow.e2e-spec.ts] — Full AppModule E2E bootstrap + PrismaService mock shape (lines 35-107)
- [Source: test/orchestrator.e2e-spec.ts] — Isolated module pattern + all Prometheus mock provider tokens
- [Source: src/ai-routing/ai-routing.service.ts:27-45] — AIRoutingService full dependency list
- [Source: src/ai-routing/ai-routing.service.ts:82-88] — AI provider enabled guard (throws if neither enabled)
- [Source: src/ai-routing/ai-routing.service.ts:127-139] — execution.create call (id required downstream)
- [Source: test/jest-e2e.json] — E2E config (moduleNameMapper, testRegex, setup file)
- [Source: test/jest-setup.ts] — Required env vars (DATABASE_URL, RABBITMQ_URL, JWT_SECRET, etc.)
- [Source: src/rabbitmq/rabbitmq.config.ts:46,48] — QUEUE_NAMES.AI_ROUTING_WAIT, AI_EXECUTION constants
- [Source: src/file-locks/file-lock-manager.concurrency.spec.ts] — Existing unit-level concurrency (don't duplicate)
- [Source: sprint-status.yaml:57-61] — Story notes: '100 concurrent tickets. Validate circular deps, file locks, metrics.'

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
