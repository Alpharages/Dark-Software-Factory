# Story OS-1.4: Sandbox Prometheus Metrics, Concurrency Enforcement, and Leak Prevention

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Platform Engineer**,
I want sandbox execution metrics emitted to Prometheus and concurrent sandbox count enforced via a semaphore,
so that I can monitor execution health, prevent resource exhaustion, and automatically recover from leaked sandboxes.

## Acceptance Criteria

1. **Given** a sandbox execution completes successfully
   **When** the `/metrics` endpoint is scraped by Prometheus
   **Then** `dsf_opensandbox_executions_total` counter is incremented with labels `provider` and `status=success`; `dsf_opensandbox_execution_duration_seconds` histogram has a new observation for that provider

2. **Given** a sandbox execution fails or times out
   **When** the error is handled
   **Then** `dsf_opensandbox_executions_total` is incremented with `status=failed` or `status=timeout` respectively

3. **Given** `OPENSANDBOX_MAX_CONCURRENT` is set (e.g., `10`)
   **When** the number of active sandboxes reaches the limit and a new `runAgentCommand()` call arrives
   **Then** the new call waits in a queue (does not reject); queue depth is logged at WARN level and emitted as `dsf_opensandbox_concurrency_queue_depth` Prometheus gauge

4. **Given** the background leak-prevention job runs every 5 minutes
   **When** it finds any running sandbox older than `OPENSANDBOX_SANDBOX_TIMEOUT_S * 1.5` seconds
   **Then** it calls `killSandbox()` on each such sandbox and logs the cleanup action

5. **Given** `listActiveSandboxes()` is polled as part of the 5-minute background job
   **When** active sandboxes are counted
   **Then** `dsf_opensandbox_active_sandboxes` gauge reflects the current count

## Tasks / Subtasks

- [ ] Task 1: Add `SANDBOX_METRICS` constants to `metrics.constants.ts` (AC: #1, #2, #3, #5)
  - [ ] 1.1 Open `src/common/metrics/metrics.constants.ts`
  - [ ] 1.2 Add after the `CONTAINER_METRICS` block (line ~185):
    ```typescript
    // Epic OS-1: OpenSandbox Metrics (Story OS-1.4)
    export const SANDBOX_METRICS = {
      EXECUTIONS_TOTAL: `${METRICS_CONSTANTS.PREFIX}opensandbox_executions_total`,
      EXECUTION_DURATION_SECONDS: `${METRICS_CONSTANTS.PREFIX}opensandbox_execution_duration_seconds`,
      ACTIVE_SANDBOXES: `${METRICS_CONSTANTS.PREFIX}opensandbox_active_sandboxes`,
      CONCURRENCY_QUEUE_DEPTH: `${METRICS_CONSTANTS.PREFIX}opensandbox_concurrency_queue_depth`,
    } as const;
    ```
  - [ ] 1.3 Verify the file compiles (no syntax errors near the insertion point)

- [ ] Task 2: Register metric providers in `SandboxModule` (AC: #1, #2, #3, #5)
  - [ ] 2.1 Open `src/sandbox/sandbox.module.ts`
  - [ ] 2.2 Add the following imports at the top:
    ```typescript
    import {
      makeCounterProvider,
      makeGaugeProvider,
      makeHistogramProvider,
    } from '@willsoto/nestjs-prometheus';
    import { AppMetricsModule } from '@/common/metrics/metrics.module';
    import { SANDBOX_METRICS } from '@/common/metrics/metrics.constants';
    ```
  - [ ] 2.3 Define a local `sandboxMetricProviders` constant (before the `@Global()` decorator):
    ```typescript
    const sandboxMetricProviders = [
      makeCounterProvider({
        name: SANDBOX_METRICS.EXECUTIONS_TOTAL,
        help: 'Total OpenSandbox executions by provider and status',
        labelNames: ['provider', 'status'],
      }),
      makeHistogramProvider({
        name: SANDBOX_METRICS.EXECUTION_DURATION_SECONDS,
        help: 'OpenSandbox execution duration in seconds',
        labelNames: ['provider'],
        buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800], // up to 30 min
      }),
      makeGaugeProvider({
        name: SANDBOX_METRICS.ACTIVE_SANDBOXES,
        help: 'Current number of active OpenSandbox sandboxes',
      }),
      makeGaugeProvider({
        name: SANDBOX_METRICS.CONCURRENCY_QUEUE_DEPTH,
        help: 'Number of runAgentCommand() calls waiting for a concurrency slot',
      }),
    ];
    ```
  - [ ] 2.4 Update `SandboxModule` to import `AppMetricsModule` and spread `sandboxMetricProviders` into `providers`:
    ```typescript
    @Global()
    @Module({
      imports: [
        AppMetricsModule, // ← ADD: needed for PrometheusModule and global metrics
        forwardRef(() => ExecutionModule),
      ],
      providers: [SandboxService, ...sandboxMetricProviders],
      exports: [SandboxService],
    })
    export class SandboxModule {}
    ```
    **Why local providers, not AppMetricsModule:** `@InjectMetric()` resolves by DI token from the module's provider scope. `AppMetricsModule` only exports `[MetricsService, PrometheusModule, 'PROMETHEUS_REGISTRY']` — individual metric tokens are not re-exported globally. This matches the `CleanupModule` and `GitMirrorModule` patterns.
  - [ ] 2.5 Run `pnpm typecheck` — zero errors

- [ ] Task 3: Add Semaphore and inject metrics into `SandboxService` (AC: #1, #2, #3, #5)
  - [ ] 3.1 Open `src/sandbox/sandbox.service.ts`
  - [ ] 3.2 Add imports at the top:
    ```typescript
    import { Counter, Histogram, Gauge } from 'prom-client';
    import { InjectMetric } from '@willsoto/nestjs-prometheus';
    import { Semaphore } from '@/common/utils/semaphore.util';
    import { SANDBOX_METRICS } from '@/common/metrics/metrics.constants';
    ```
  - [ ] 3.3 Add private class fields for semaphore (after `private manager: SandboxManager`):
    ```typescript
    private semaphore: Semaphore;
    private maxConcurrent = 10; // overridden in onModuleInit() from config
    ```
    **IMPORTANT:** Do NOT use `readonly` — this field is assigned in `onModuleInit()`, not the constructor. `readonly` would cause a TypeScript compilation error in strict mode. Follow the `PtyExecutionService` pattern: `private maxConcurrentContainers = 10;` overridden in the constructor/init method.
  - [ ] 3.4 Add 4 `@InjectMetric` constructor parameters:
    ```typescript
    @InjectMetric(SANDBOX_METRICS.EXECUTIONS_TOTAL)
    private readonly executionsCounter: Counter<string>,
    @InjectMetric(SANDBOX_METRICS.EXECUTION_DURATION_SECONDS)
    private readonly durationHistogram: Histogram<string>,
    @InjectMetric(SANDBOX_METRICS.ACTIVE_SANDBOXES)
    private readonly activeSandboxesGauge: Gauge<string>,
    @InjectMetric(SANDBOX_METRICS.CONCURRENCY_QUEUE_DEPTH)
    private readonly queueDepthGauge: Gauge<string>,
    ```
    **Note:** These parameters come AFTER the existing `ConfigService` and `ExecutionGateway` parameters. Preserve the existing order.
  - [ ] 3.5 Initialize the semaphore in `onModuleInit()` BEFORE the health ping call:
    ```typescript
    this.maxConcurrent = this.config.get<number>('opensandbox.maxConcurrent', 10);
    this.semaphore = new Semaphore(this.maxConcurrent);
    this.logger.log(`SandboxService: concurrency limit set to ${this.maxConcurrent}`);
    ```

- [ ] Task 4: Wrap `runAgentCommand()` with Semaphore and emit metrics (AC: #1, #2, #3)
  - [ ] 4.1 Modify the existing `runAgentCommand()` from OS-1.3. The semaphore wraps the **entire** execution including the try/finally sandbox cleanup block. The structure becomes:

    ```typescript
    async runAgentCommand(options: AgentCommandOptions): Promise<AgentCommandResult> {
      if (!this.manager) {
        throw new Error(
          'SandboxService.runAgentCommand() called before onModuleInit() completed.',
        );
      }

      const providerName = options.metadata?.providerName ?? 'unknown';

      // NFR-OS4: Enforce concurrency limit — queue if at max, never reject
      const queueLength = this.semaphore.getQueueLength();
      const availablePermits = this.semaphore.getAvailablePermits();

      if (availablePermits === 0) {
        this.logger.warn(
          `SandboxService: concurrency limit reached (max=${this.maxConcurrent}), ` +
          `queuing execution executionId=${options.executionId}, ` +
          `provider=${providerName}, queue depth=${queueLength + 1}`,
        );
      }

      // Update queue depth gauge before acquiring (reflects waiting callers)
      this.queueDepthGauge.set(queueLength + (availablePermits === 0 ? 1 : 0));

      await this.semaphore.acquire();

      // Reset queue depth after slot acquired (one less waiter)
      this.queueDepthGauge.set(this.semaphore.getQueueLength());

      const startTime = Date.now();
      let executionStatus: 'success' | 'failed' | 'timeout' = 'success';

      try {
        // ... (existing sandbox create + run logic from OS-1.3) ...

        // After successful run:
        const durationSeconds = (Date.now() - startTime) / 1000;
        executionStatus = result.timedOut ? 'timeout' : 'success';
        this.executionsCounter.inc({ provider: providerName, status: executionStatus });
        this.durationHistogram.observe({ provider: providerName }, durationSeconds);

        return result;
      } catch (err) {
        const durationSeconds = (Date.now() - startTime) / 1000;
        const message = (err as Error).message ?? '';
        executionStatus = /timed? out|timeout/i.test(message) ? 'timeout' : 'failed';
        this.executionsCounter.inc({ provider: providerName, status: executionStatus });
        this.durationHistogram.observe({ provider: providerName }, durationSeconds);
        throw err;
      } finally {
        // ORDER IS CRITICAL: clean up the sandbox resource BEFORE releasing the semaphore slot.
        // Releasing the slot first would allow the next caller to start while this sandbox
        // is still alive, potentially exceeding the true concurrency limit.
        if (sandbox) {
          try {
            await sandbox.kill();
          } catch (killErr) {
            this.logger.warn(`Failed to kill sandbox: ${(killErr as Error).message}`);
          }
          try {
            await sandbox.close();
          } catch (closeErr) {
            this.logger.warn(`Failed to close sandbox: ${(closeErr as Error).message}`);
          }
        }
        // Release the concurrency slot AFTER sandbox cleanup
        this.semaphore.release();
        this.queueDepthGauge.set(this.semaphore.getQueueLength());
      }
    }
    ```

  - [ ] 4.2 **IMPORTANT:** Preserve ALL existing OS-1.3 logic — the `redactEnvForLogging()` call, the `executionGateway?.emitLog()` streaming. The `sandbox.kill()` and `sandbox.close()` calls shown above **replace** the identical block from OS-1.3; do not duplicate them. The skeleton above is the complete `finally` block.
  - [ ] 4.3 Move the `startTime` variable initialization to AFTER `semaphore.acquire()` — the timer should only measure sandbox execution time, not queue wait time.

- [ ] Task 5: Add background leak-prevention cron job (AC: #4, #5)
  - [ ] 5.1 Add `@Cron` import to the `@nestjs/schedule` import in `sandbox.service.ts`
  - [ ] 5.2 Add the `checkForLeakedSandboxes()` method to `SandboxService`:

    ```typescript
    /**
     * NFR-OS3: Background leak prevention — runs every 5 minutes.
     * Kills any sandbox running longer than OPENSANDBOX_SANDBOX_TIMEOUT_S * 1.5 seconds.
     * Also updates the active sandboxes Prometheus gauge.
     */
    @Cron('0 */5 * * * *')
    async checkForLeakedSandboxes(): Promise<void> {
      this.logger.debug('SandboxService: running leak prevention check');

      if (!this.manager) {
        this.logger.debug('SandboxService: manager not initialized, skipping leak check');
        return;
      }

      try {
        const activeSandboxes = await this.listActiveSandboxes();
        this.activeSandboxesGauge.set(activeSandboxes.length);

        const timeoutThresholdMs =
          this.config.get<number>('opensandbox.sandboxTimeoutS', 3600) * 1.5 * 1000;

        const now = Date.now();
        let killedCount = 0;

        for (const sandbox of activeSandboxes) {
          // Verify the exact SandboxInfo field name for creation time from SDK types.
          // Expected: sandbox.created_at (ISO string) or sandbox.startedAt (ms timestamp).
          // Adapt the line below to the actual SDK field name:
          const startedAt = new Date(sandbox.created_at ?? sandbox.startedAt ?? 0).getTime();
          const ageMs = now - startedAt;

          if (ageMs > timeoutThresholdMs) {
            this.logger.warn(
              `SandboxService: killing leaked sandbox sandboxId=${sandbox.id}, ` +
              `ageMs=${ageMs}, threshold=${timeoutThresholdMs}`,
            );
            try {
              await this.killSandbox(sandbox.id);
              killedCount++;
            } catch (killErr) {
              this.logger.warn(
                `SandboxService: failed to kill leaked sandbox sandboxId=${sandbox.id}: ` +
                `${(killErr as Error).message}`,
              );
            }
          }
        }

        if (killedCount > 0) {
          this.logger.log(
            `SandboxService: leak prevention killed ${killedCount} sandbox(es)`,
          );
          // Update gauge after kills
          const remaining = await this.listActiveSandboxes();
          this.activeSandboxesGauge.set(remaining.length);
        }
      } catch (err) {
        this.logger.error(
          `SandboxService: leak prevention check failed: ${(err as Error).message}`,
        );
      }
    }
    ```

  - [ ] 5.3 **MANDATORY: Verify the `SandboxInfo` timestamp field name from the SDK.** After OS-1.2 installs the SDK, inspect the `SandboxInfo` type definition and confirm the exact field for sandbox start/creation time (`created_at`, `startedAt`, `started_at`, or other). Update the field access in `checkForLeakedSandboxes()` accordingly. Document any discrepancy in Dev Agent Record.

- [ ] Task 6: Write unit tests (AC: #1, #2, #3, #4, #5)
  - [ ] 6.1 Open `src/sandbox/sandbox.service.spec.ts` (which has 18 tests from OS-1.2 + OS-1.3)
  - [ ] 6.2 Extend the mock for `@alibaba-group/opensandbox` to mock `listSandboxInfos()` for leak prevention tests
  - [ ] 6.3 Add mocks for 4 Prometheus metrics (counter `inc`, histogram `observe`, gauge `set`):
    ```typescript
    const mockExecutionsCounter = { inc: jest.fn() };
    const mockDurationHistogram = { observe: jest.fn() };
    const mockActiveSandboxesGauge = { set: jest.fn() };
    const mockQueueDepthGauge = { set: jest.fn() };
    ```
  - [ ] 6.4 Inject mock metrics into service via `service['executionsCounter'] = mockExecutionsCounter` etc. in `beforeEach`
  - [ ] 6.5 Write **12 new tests** (T20–T31):

    ```typescript
    describe('Prometheus metrics in runAgentCommand()', () => {
      // T20: Counter incremented with status=success on successful execution
      it('T20: increments executions_total counter with status=success on success', async () => {
        mockSandboxRun.mockResolvedValue({ exitCode: 0, timedOut: false });
        await service.runAgentCommand(baseOptions);
        expect(mockExecutionsCounter.inc).toHaveBeenCalledWith({
          provider: 'CLAUDE_CODE',
          status: 'success',
        });
      });

      // T21: Counter incremented with status=timeout when timedOut=true
      it('T21: increments executions_total counter with status=timeout when timedOut', async () => {
        mockSandboxRun.mockResolvedValue({ exitCode: 124, timedOut: true });
        await service.runAgentCommand(baseOptions);
        expect(mockExecutionsCounter.inc).toHaveBeenCalledWith({
          provider: 'CLAUDE_CODE',
          status: 'timeout',
        });
      });

      // T22: Counter incremented with status=failed when execution throws
      it('T22: increments executions_total counter with status=failed when run() throws', async () => {
        mockSandboxRun.mockRejectedValue(new Error('exec crash'));
        await expect(service.runAgentCommand(baseOptions)).rejects.toThrow();
        expect(mockExecutionsCounter.inc).toHaveBeenCalledWith({
          provider: 'CLAUDE_CODE',
          status: 'failed',
        });
      });

      // T23: Counter incremented with status=timeout when error message contains "timeout"
      it('T23: increments counter with status=timeout when error message contains "timeout"', async () => {
        mockSandboxRun.mockRejectedValue(new Error('execution timed out'));
        await expect(service.runAgentCommand(baseOptions)).rejects.toThrow();
        expect(mockExecutionsCounter.inc).toHaveBeenCalledWith({
          provider: 'CLAUDE_CODE',
          status: 'timeout',
        });
      });

      // T24: Histogram observed on success
      it('T24: observes duration histogram on successful execution', async () => {
        mockSandboxRun.mockResolvedValue({ exitCode: 0, timedOut: false });
        await service.runAgentCommand(baseOptions);
        expect(mockDurationHistogram.observe).toHaveBeenCalledWith(
          { provider: 'CLAUDE_CODE' },
          expect.any(Number),
        );
      });

      // T25: Histogram observed even when execution fails
      it('T25: observes duration histogram even when execution throws', async () => {
        mockSandboxRun.mockRejectedValue(new Error('exec crash'));
        await expect(service.runAgentCommand(baseOptions)).rejects.toThrow();
        expect(mockDurationHistogram.observe).toHaveBeenCalled();
      });
    });

    describe('Semaphore concurrency enforcement', () => {
      // T26: Semaphore acquire and release are called on each runAgentCommand()
      it('T26: acquires semaphore before execution and releases in finally', async () => {
        const acquireSpy = jest.spyOn(service['semaphore'], 'acquire');
        const releaseSpy = jest.spyOn(service['semaphore'], 'release');
        await service.runAgentCommand(baseOptions);
        expect(acquireSpy).toHaveBeenCalledTimes(1);
        expect(releaseSpy).toHaveBeenCalledTimes(1);
      });

      // T27: Semaphore is released even when execution throws
      it('T27: releases semaphore in finally even when execution throws', async () => {
        const releaseSpy = jest.spyOn(service['semaphore'], 'release');
        mockSandboxRun.mockRejectedValue(new Error('exec crash'));
        await expect(service.runAgentCommand(baseOptions)).rejects.toThrow();
        expect(releaseSpy).toHaveBeenCalledTimes(1);
      });

      // T28: Queue depth gauge is set to 0 after execution completes
      it('T28: sets concurrency queue depth gauge to 0 after execution completes', async () => {
        mockSandboxRun.mockResolvedValue({ exitCode: 0, timedOut: false });
        await service.runAgentCommand(baseOptions);
        // Final call sets queue depth to 0 (empty queue after release)
        expect(mockQueueDepthGauge.set).toHaveBeenLastCalledWith(0);
      });
    });

    describe('checkForLeakedSandboxes() leak prevention', () => {
      // T29: Active sandboxes gauge is updated with current count
      it('T29: sets active_sandboxes gauge with count from listActiveSandboxes()', async () => {
        mockListSandboxInfos.mockResolvedValue([
          { id: 'sb-1', created_at: new Date().toISOString() },
          { id: 'sb-2', created_at: new Date().toISOString() },
        ]);
        await service.checkForLeakedSandboxes();
        expect(mockActiveSandboxesGauge.set).toHaveBeenCalledWith(2);
      });

      // T30: Old sandboxes beyond threshold are killed
      it('T30: kills sandboxes older than sandboxTimeoutS * 1.5', async () => {
        const oldTimestamp = new Date(Date.now() - 6000 * 1000).toISOString(); // 100 min ago
        // sandboxTimeoutS=3600 default → threshold = 5400s = 90min; old sandbox is 100min old
        mockListSandboxInfos.mockResolvedValue([{ id: 'sb-old', created_at: oldTimestamp }]);
        const killSpy = jest.spyOn(service, 'killSandbox').mockResolvedValue(undefined);
        await service.checkForLeakedSandboxes();
        expect(killSpy).toHaveBeenCalledWith('sb-old');
      });

      // T31: Recent sandboxes within threshold are NOT killed
      it('T31: does NOT kill sandboxes younger than sandboxTimeoutS * 1.5', async () => {
        const recentTimestamp = new Date(Date.now() - 60 * 1000).toISOString(); // 1 min ago
        mockListSandboxInfos.mockResolvedValue([{ id: 'sb-new', created_at: recentTimestamp }]);
        const killSpy = jest.spyOn(service, 'killSandbox').mockResolvedValue(undefined);
        await service.checkForLeakedSandboxes();
        expect(killSpy).not.toHaveBeenCalled();
      });
    });
    ```

- [ ] Task 7: Verify the build (AC: #1–#5)
  - [ ] 7.1 Run `pnpm typecheck` — zero errors (confirms `maxConcurrent` not `readonly`, sandbox module types correct)
  - [ ] 7.2 Run `pnpm lint` — zero errors
  - [ ] 7.3 Run `pnpm test -- sandbox.service` — all tests green (18 from OS-1.2/1.3 + 12 new = **30 total**)
  - [ ] 7.4 Run `pnpm build` — zero compilation errors

## Dev Notes

### Scope Boundaries — What NOT to Do in This Story

**DO NOT implement in OS-1.4:**

- Do NOT implement `SandboxResourceProfileService` — that is OS-2.1 scope
- Do NOT define `ICodingAgentProvider` interface — that is OS-2.1 scope
- Do NOT delete `DockerModule`, `DockerService`, `WorkspaceService`, or `PtyExecutionService` — that is Epic OS-3 scope
- Do NOT remove `DockerModule` from `AppModule` — that is OS-3 scope
- Do NOT wire `runAgentCommand()` into the actual execution pipeline — `AIExecutionConsumer` still routes through `DockerService`. OS-2 wires providers.
- Do NOT modify `env.validation.ts` or `configuration.ts` — the `opensandbox.*` config block was added in OS-1.2. This story only reads from it.
- Do NOT add new env vars — all needed vars (`OPENSANDBOX_MAX_CONCURRENT`, `OPENSANDBOX_SANDBOX_TIMEOUT_S`) were added in OS-1.2.

### Dependency on Previous Stories

**OS-1.4 requires OS-1.2 and OS-1.3 to be implemented first.** Before writing any code:

1. Verify `src/sandbox/sandbox.service.ts` exists and contains:
   - `SandboxManager` initialized in `onModuleInit()`
   - `listActiveSandboxes()`, `killSandbox()`, `getSandboxInfo()` methods
   - Full `runAgentCommand()` implementation from OS-1.3 (NOT the stub)
   - `redactEnvForLogging()` private method
   - `@Optional() @Inject(forwardRef(() => ExecutionGateway))` injection

2. Verify `opensandbox.*` config block exists in `src/config/configuration.ts` (added in OS-1.2)

If OS-1.2/OS-1.3 are not yet implemented, this story cannot proceed.

### Architecture Compliance

| Rule                          | Requirement                                                                                                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Logger                        | `private readonly logger = new Logger(SandboxService.name)` — already established in OS-1.2                                                                                |
| ConfigService                 | Dot-notation keys: `this.config.get<number>('opensandbox.maxConcurrent', 10)`                                                                                              |
| Import alias                  | `@/common/utils/semaphore.util`, `@/common/metrics/metrics.constants`                                                                                                      |
| Semaphore                     | Use existing `Semaphore` from `@/common/utils/semaphore.util` — do NOT create a new class                                                                                  |
| Metrics registration          | Register 4 providers in `SandboxModule.providers` (NOT `AppMetricsModule`); import `AppMetricsModule` in `SandboxModule`; inject via `@InjectMetric()` in `SandboxService` |
| Cron scheduling               | `@Cron('0 */5 * * * *')` from `@nestjs/schedule` — `ScheduleModule.forRoot()` is already in `AppModule`                                                                    |
| No external semaphore library | Use the project's existing `Semaphore` class — do NOT add `async-mutex` or `p-limit` to package.json                                                                       |
| Metrics prefix                | All metric names include `dsf_` prefix via `METRICS_CONSTANTS.PREFIX` — follow `CONTAINER_METRICS` pattern                                                                 |

### Semaphore Usage Pattern

The existing `Semaphore` class (`src/common/utils/semaphore.util.ts`) was used by `PtyExecutionService` (the DooD predecessor). It has:

```typescript
// Methods:
await this.semaphore.acquire(); // Waits if at capacity — never rejects
this.semaphore.release(); // Frees a slot; wakes next waiter if any
this.semaphore.getAvailablePermits(); // How many slots are free
this.semaphore.getQueueLength(); // How many callers are waiting
```

**Critical — `finally` block order:** The semaphore MUST be released AFTER sandbox cleanup, not before. Correct order:

1. `if (sandbox)` → `sandbox.kill()` in its own try/catch
2. `sandbox.close()` in its own try/catch
3. `this.semaphore.release()` — slot freed only after sandbox is gone
4. `this.queueDepthGauge.set(this.semaphore.getQueueLength())` — gauge updated after release

The Task 4.1 skeleton shows this exact order. Do NOT put `semaphore.release()` first.

### `@Cron` Decorator in `SandboxService`

`ScheduleModule.forRoot()` is already in `AppModule`. Adding `@Cron` to a method on `SandboxService` works because NestJS automatically scans all providers for `@Cron` decorators when `ScheduleModule` is imported.

```typescript
import { Cron } from '@nestjs/schedule';

@Cron('0 */5 * * * *')
async checkForLeakedSandboxes(): Promise<void> {
  // runs every 5 minutes at :00 seconds
}
```

No changes to `SandboxModule` or `AppModule` are needed for the cron job to work.

### Metrics Registration Pattern

The codebase has two patterns for Prometheus metrics:

- **Cross-system metrics** (HTTP, AI, GitHub…) → registered in `AppMetricsModule` (`metrics.module.ts`)
- **Module-specific metrics** (git mirror, cleanup, sandbox) → registered **locally** in the owning module's `providers` array

`@InjectMetric()` resolves its DI token from the module's local scope. `AppMetricsModule` only exports `[MetricsService, PrometheusModule, 'PROMETHEUS_REGISTRY']` — individual metric tokens are NOT re-exported. Registering only in `AppMetricsModule` will fail injection in `SandboxService`.

**Correct pattern** (follows `CleanupModule` and `GitMirrorModule`):

```typescript
// 1. In metrics.constants.ts — naming only:
export const SANDBOX_METRICS = {
  EXECUTIONS_TOTAL: `${METRICS_CONSTANTS.PREFIX}opensandbox_executions_total`,
  ...
} as const;

// 2. In sandbox.module.ts — actual registration:
const sandboxMetricProviders = [
  makeCounterProvider({ name: SANDBOX_METRICS.EXECUTIONS_TOTAL, ... }),
  ...
];

@Global()
@Module({
  imports: [AppMetricsModule, forwardRef(() => ExecutionModule)],
  providers: [SandboxService, ...sandboxMetricProviders],
  exports: [SandboxService],
})
export class SandboxModule {}

// 3. In sandbox.service.ts — injection:
@InjectMetric(SANDBOX_METRICS.EXECUTIONS_TOTAL)
private readonly executionsCounter: Counter<string>,
```

`src/common/metrics/index.ts` already exports `* from './metrics.constants'`, so `SANDBOX_METRICS` is automatically available via `@/common/metrics` once added to `metrics.constants.ts`.

### Metrics Timing — Important Detail

The `startTime = Date.now()` for execution duration MUST be recorded AFTER `await this.semaphore.acquire()`. This ensures the histogram measures only sandbox execution time, not queue wait time. Queue wait time is separately observable via the `queueDepthGauge`.

### SandboxInfo SDK Field for Timestamp

The `checkForLeakedSandboxes()` method needs the sandbox creation/start timestamp from `SandboxInfo`. The exact field name must be verified from the SDK after OS-1.2 installs it. Likely candidates:

- `sandbox.created_at` (ISO 8601 string)
- `sandbox.startedAt` (epoch ms number)
- `sandbox.start_time` (epoch ms number)

Use a defensive fallback: `new Date(sandbox.created_at ?? sandbox.startedAt ?? 0).getTime()`. If neither field is available, log a warning and skip the sandbox (do not kill it). Document the actual field name in Dev Agent Record.

### Previous Story Intelligence (OS-1.3)

OS-1.3 established the full `runAgentCommand()` implementation:

- `Sandbox.create()` static method via SDK
- `sandbox.run()` with `onStdout`/`onStderr` callbacks (or Fallback A/B/C patterns)
- `try/catch/finally` with `sandbox.kill()` and `sandbox.close()` each in their own try/catch
- `redactEnvForLogging()` for NFR-OS5
- `@Optional() @Inject(forwardRef(() => ExecutionGateway))` for log streaming
- Logger pattern: `private readonly logger = new Logger(SandboxService.name)` (NOT injected `LoggerService`)

**OS-1.4 MODIFIES the existing `runAgentCommand()` from OS-1.3 — do NOT rewrite it from scratch.** Add semaphore wrapping and metrics emission on top of the existing implementation.

### Git Intelligence

Recent commits confirm the OpenSandbox migration context:

- `2202fc0` — `feat: replace DooD with OpenSandbox for secure, provider-agnostic sandbox execution`
  - Modified `src/config/configuration.ts` — `opensandbox:` config block
  - Modified `src/config/env.validation.ts` — OPENSANDBOX\_\* Joi schemas
- `2029f7e` — `chore: prune obsolete DooD artifacts post migration to OpenSandbox`

Before modifying `SandboxService`, run:

```bash
grep -n "maxConcurrent\|sandboxTimeoutS\|opensandbox\." src/config/configuration.ts
```

to confirm the exact config key names added in OS-1.2.

### Testing Requirements

**Add to** `src/sandbox/sandbox.service.spec.ts` (currently 18 tests from OS-1.2/OS-1.3).

**Total after this story: 30 tests** (18 carried forward + 12 new T20–T31).

Mock pattern for metrics (add alongside existing mocks):

```typescript
// Add to module-level mock declarations:
const mockExecutionsCounter = { inc: jest.fn() };
const mockDurationHistogram = { observe: jest.fn() };
const mockActiveSandboxesGauge = { set: jest.fn() };
const mockQueueDepthGauge = { set: jest.fn() };

// In beforeEach, inject mocks AND initialize the semaphore:
(service as unknown as { executionsCounter: typeof mockExecutionsCounter }).executionsCounter =
  mockExecutionsCounter;
(service as unknown as { durationHistogram: typeof mockDurationHistogram }).durationHistogram =
  mockDurationHistogram;
(
  service as unknown as { activeSandboxesGauge: typeof mockActiveSandboxesGauge }
).activeSandboxesGauge = mockActiveSandboxesGauge;
(service as unknown as { queueDepthGauge: typeof mockQueueDepthGauge }).queueDepthGauge =
  mockQueueDepthGauge;

// CRITICAL: Initialize the semaphore manually — onModuleInit() is not called in unit tests.
// Without this, T26/T27 (which spy on service['semaphore'].acquire/release) will throw
// "TypeError: Cannot read properties of undefined (reading 'acquire')".
(service as unknown as { semaphore: Semaphore }).semaphore = new Semaphore(10);

jest.clearAllMocks();
```

Also mock `listActiveSandboxes` for the cron job tests — it calls `this.manager.listSandboxInfos()` which is already mocked from OS-1.2.

### File Structure Modified in This Story

**Modified files only** (no new files created):

```
src/
├── common/metrics/
│   └── metrics.constants.ts        ← ADD SANDBOX_METRICS constants block
└── sandbox/
    ├── sandbox.module.ts            ← ADD AppMetricsModule import + sandboxMetricProviders spread
    ├── sandbox.service.ts           ← ADD Semaphore field + 4 InjectMetric params + metrics in runAgentCommand() + checkForLeakedSandboxes() @Cron
    └── sandbox.service.spec.ts      ← ADD 12 new tests (T20–T31)
```

**No other files are touched in this story.** Do NOT modify `AppModule`, `common/metrics/metrics.module.ts`, `env.validation.ts`, `configuration.ts`, or any `ai-routing/` files.

### Source References

- [Source: _bmad-output/planning-artifacts/epics.md#Story OS-1.4 — Acceptance Criteria]
- [Source: _bmad-output/planning-artifacts/epics.md#FR-OS12 — Prometheus metrics requirements]
- [Source: _bmad-output/planning-artifacts/epics.md#NFR-OS3 — Background leak prevention every 5 min]
- [Source: _bmad-output/planning-artifacts/epics.md#NFR-OS4 — Semaphore concurrency enforcement]
- [Source: src/common/utils/semaphore.util.ts — existing Semaphore class (acquire/release/getQueueLength/getAvailablePermits)]
- [Source: src/common/metrics/metrics.constants.ts#line 180 — CONTAINER_METRICS pattern to follow]
- [Source: src/common/metrics/metrics.module.ts#line 467 — CONTAINER_METRICS provider registration pattern]
- [Source: src/cleanup/cleanup-scheduler.service.ts#line 31 — @Cron('0 */5 * * * *') pattern]
- [Source: src/git-mirror/git-mirror.service.ts#line 17 — @InjectMetric import pattern]
- [Source: src/app.module.ts#line 85 — ScheduleModule.forRoot() already registered]
- [Source: _bmad-output/implementation-artifacts/os-1-2-sandbox-module-service-startup-health-validation.md#Dev Notes — configuration.ts opensandbox block keys]
- [Source: _bmad-output/implementation-artifacts/os-1-3-sandbox-command-execution-real-time-log-streaming.md#Dev Notes — runAgentCommand() implementation to extend]
- [Source: src/ai-routing/services/pty-execution.service.ts#line 90 — previous Semaphore usage pattern in DooD layer]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
