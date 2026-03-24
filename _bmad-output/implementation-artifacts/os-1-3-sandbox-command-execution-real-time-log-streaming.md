# Story OS-1.3: Sandbox Command Execution with Real-Time Log Streaming

Status: ready-for-dev

## Story

As a **Developer**,
I want `SandboxService.runAgentCommand()` to execute commands inside OpenSandbox containers while streaming stdout/stderr to the `ExecutionGateway` in real time,
So that execution logs appear on the dashboard as the agent works and sandbox leaks are impossible.

## Acceptance Criteria

1. **Given** a valid `AgentCommandOptions` object with `executionId`, `image`, `command`, `env`, `timeoutSeconds`, `cpuLimit`, `memoryLimit`
   **When** `runAgentCommand()` is called
   **Then** a sandbox is created via `Sandbox.create()`, the command runs, stdout and stderr lines are streamed in real-time to `ExecutionGateway` using the provided `executionId`, and an `AgentCommandResult` is returned with `sandboxId`, `stdout`, `stderr`, `exitCode`, `durationMs`, `timedOut`

2. **Given** `runAgentCommand()` is in progress and an exception is thrown (e.g., timeout, SDK error)
   **When** the error is caught
   **Then** the `finally` block always calls `sandbox.kill()` and `sandbox.close()` — no orphaned sandboxes exist

3. **Given** `env` in `AgentCommandOptions` contains values like `ANTHROPIC_AUTH_TOKEN` or `GEMINI_API_KEY`
   **When** `SandboxService` logs execution details
   **Then** API key values are redacted and never appear in log output (NFR-OS5)

4. **Given** a completed sandbox execution
   **When** the execution log is written
   **Then** it contains: sandbox ID, provider name (from metadata), execution ID, duration in ms, exit code, whether it timed out, stdout length in bytes, stderr length in bytes — but **not** stdout/stderr content

## Tasks / Subtasks

- [ ] Task 1: Verify OpenSandbox SDK Streaming API (AC: #1)
  - [ ] 1.1 **MANDATORY before writing any code:** Inspect `node_modules/@alibaba-group/opensandbox/dist/index.d.ts` (or equivalent) after OS-1.2 installs the SDK
  - [ ] 1.2 Confirm the exact: `Sandbox.create()` static method signature, constructor/options shape, how to get `sandboxId` from the instance, command execution method (`sandbox.run()` vs `sandbox.exec()` vs other), streaming callback names (`onStdout`/`onStderr` vs `stdout`/`stderr` vs event emitters), timeout handling (option vs `Promise.race`), return type of the run/exec method (`exitCode`, `timedOut` fields), kill/close method names
  - [ ] 1.3 Document any discrepancies between this story and actual SDK API in Dev Agent Record

- [ ] Task 2: Update `AgentCommandOptions` interface (AC: #1, #4)
  - [ ] 2.1 Open `src/sandbox/interfaces/agent-command-options.interface.ts` (created in OS-1.2)
  - [ ] 2.2 Add optional field: `ticketId?: string;` — comment: `// Optional: correlates sandbox execution with the parent ticket in ExecutionGateway log payloads`
  - [ ] 2.3 Update the barrel `src/sandbox/index.ts` if needed (no change expected — `AgentCommandOptions` is already re-exported)

- [ ] Task 3: Update `SandboxModule` to import `ExecutionModule` (AC: #1)
  - [ ] 3.1 Open `src/sandbox/sandbox.module.ts`
  - [ ] 3.2 Add `forwardRef(() => ExecutionModule)` to the `imports` array — **REQUIRED to prevent circular dep in OS-2** when `AiRoutingModule` imports `SandboxModule`
  - [ ] 3.3 Import `ExecutionModule` from `@/execution/execution.module` using `@/` alias and wrap in `forwardRef`
  - [ ] 3.4 `SandboxModule` must remain `@Global()` — do NOT remove that decorator

- [ ] Task 4: Inject `ExecutionGateway` into `SandboxService` (AC: #1, #3)
  - [ ] 4.1 Open `src/sandbox/sandbox.service.ts`
  - [ ] 4.2 Add `@Optional() @Inject(forwardRef(() => ExecutionGateway)) private readonly executionGateway: ExecutionGateway | null` to constructor
  - [ ] 4.3 Import `ExecutionGateway` from `@/execution/gateways/execution.gateway`
  - [ ] 4.4 Import `Optional, Inject, forwardRef` from `@nestjs/common` (add to existing import)
  - [ ] 4.5 `@Optional()` is **required** — `ExecutionGateway` might not be available in unit test context without full module wiring; service must gracefully handle `null`

- [ ] Task 5: Replace stub `runAgentCommand()` with full implementation (AC: #1, #2, #3, #4)
  - [ ] 5.1 Remove the stub (which throws `[OS-1.3]` error) added in OS-1.2
  - [ ] 5.2 Add `private redactEnvForLogging(env: Record<string, string>): Record<string, string>` — redacts any env key matching `/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i`
  - [ ] 5.3 Implement `runAgentCommand()` following the skeleton in Dev Notes below
  - [ ] 5.4 Import `Sandbox` from `@alibaba-group/opensandbox` — verify exact export name from SDK types
  - [ ] 5.5 Ensure `try/finally` structure is correct — `sandbox.kill()` AND `sandbox.close()` must both be called in `finally`, each wrapped in its own `try/catch` to prevent one failure from skipping the other

- [ ] Task 6: Write unit tests (AC: #1, #2, #3, #4)
  - [ ] 6.1 Open `src/sandbox/sandbox.service.spec.ts` (created in OS-1.2)
  - [ ] 6.2 Extend the existing mock for `@alibaba-group/opensandbox` to also mock `Sandbox.create()` as a static method returning a mock sandbox instance with `run`/`exec`, `kill`, `close` methods
  - [ ] 6.3 Add mock for `ExecutionGateway` — `jest.fn()` for `emitLog` method
  - [ ] 6.4 Write **9 new tests** (see Dev Notes for exact test cases T11–T19)

- [ ] Task 7: Verify the build (AC: #1, #2, #3, #4)
  - [ ] 7.1 Run `pnpm typecheck` — zero errors
  - [ ] 7.2 Run `pnpm lint` — zero errors
  - [ ] 7.3 Run `pnpm test -- sandbox.service` — all tests green (10 from OS-1.2 minus T8 stub + 9 new = **18 total**)
  - [ ] 7.4 Run `pnpm build` — zero compilation errors

## Dev Notes

### Scope Boundaries — What NOT to Do in This Story

**DO NOT implement in OS-1.3:**

- Do NOT add Prometheus metrics (`opensandbox_executions_total`, `opensandbox_execution_duration_seconds`, `opensandbox_active_sandboxes`) — that is OS-1.4 scope
- Do NOT implement `Semaphore` / concurrency limit enforcement (`OPENSANDBOX_MAX_CONCURRENT`) — that is OS-1.4 scope
- Do NOT add the background leak prevention job (every 5 min) — that is OS-1.4 scope
- Do NOT implement `SandboxResourceProfileService` — that is OS-2.1 scope
- Do NOT define `ICodingAgentProvider` interface — that is OS-2.1 scope
- Do NOT delete `DockerModule`, `DockerService`, `WorkspaceService`, or `PtyExecutionService` — that is Epic OS-3 scope
- Do NOT remove `DockerModule` from `AppModule` — that is OS-3 scope
- **Do NOT wire `runAgentCommand()` into the actual execution pipeline** — after this story the method exists and is tested in isolation only. `AIExecutionConsumer` still routes through `DockerService` / `CursorHeadlessProvider`. OS-2 is what wires providers to call this method.

### Architecture Compliance

| Rule               | Requirement                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Logger             | `private readonly logger = new Logger(SandboxService.name)` — NOT injected `LoggerService`                                                   |
| ConfigService      | Dot-notation keys: `this.config.get<string>('opensandbox.domain')` — NOT `process.env` direct                                                |
| Import alias       | `@/execution/...` NOT `../../execution/...`                                                                                                  |
| forwardRef         | Use `forwardRef(() => ExecutionModule)` in `SandboxModule.imports`                                                                           |
| Optional injection | `@Optional() @Inject(forwardRef(() => ExecutionGateway))` on the gateway param                                                               |
| try/finally        | Both `sandbox.kill()` AND `sandbox.close()` in finally — each in their own try/catch                                                         |
| NFR-OS5            | NEVER log raw env values — always call `redactEnvForLogging()` before logging env                                                            |
| NFR-OS9            | Log summary fields only (sandboxId, providerName, executionId, durationMs, exitCode, timedOut, byteCounts) — NEVER log stdout/stderr content |

### Critical: OS-1.2 Stub to Replace

In OS-1.2, `SandboxService.runAgentCommand()` was stubbed as:

```typescript
async runAgentCommand(options: AgentCommandOptions): Promise<AgentCommandResult> {
  throw new Error('[OS-1.3] runAgentCommand not yet implemented — awaiting streaming support');
}
```

**This entire method must be replaced** with the full implementation below. The T8 stub test from OS-1.2 — exact `it()` description: `'T8: runAgentCommand() — throws with [OS-1.3] prefix message (stub contract)'` — must be **deleted** and replaced with the new tests T11–T19.

### `runAgentCommand()` Implementation Skeleton

```typescript
import { Injectable, OnModuleInit, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SandboxManager, Sandbox } from '@alibaba-group/opensandbox'; // verify exact exports after install
import { AgentCommandOptions } from './interfaces/agent-command-options.interface';
import { AgentCommandResult } from './interfaces/agent-command-result.interface';
import { ExecutionGateway } from '@/execution/gateways/execution.gateway';

@Injectable()
export class SandboxService implements OnModuleInit {
  private readonly logger = new Logger(SandboxService.name);
  private manager: SandboxManager;

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(forwardRef(() => ExecutionGateway))
    private readonly executionGateway: ExecutionGateway | null,
  ) {}

  // ... onModuleInit, isHealthy, getSandboxInfo, killSandbox, listActiveSandboxes from OS-1.2 ...

  async runAgentCommand(options: AgentCommandOptions): Promise<AgentCommandResult> {
    // Guard: manager must be initialized by onModuleInit() before this is called
    if (!this.manager) {
      throw new Error(
        'SandboxService.runAgentCommand() called before onModuleInit() completed. ' +
          'Ensure SandboxModule is initialized before calling runAgentCommand().',
      );
    }

    const startTime = Date.now();
    const providerName = options.metadata?.providerName ?? 'unknown';

    // NFR-OS5: Redact API keys from logs — NEVER log raw env
    this.logger.debug(
      `Starting sandbox execution: executionId=${options.executionId}, ` +
        `image=${options.image}, provider=${providerName}, ` +
        `env=${JSON.stringify(this.redactEnvForLogging(options.env))}`,
    );

    let sandbox: Sandbox | null = null; // verify type name from SDK types
    let stdoutBuffer = ''; // full stdout captured in memory — acceptable trade-off for AgentCommandResult
    let stderrBuffer = ''; // full stderr captured in memory — see E2 note below
    let timedOut = false;

    try {
      // Create sandbox via SDK — verify exact Sandbox.create() signature from SDK types
      sandbox = await Sandbox.create(
        {
          image: options.image,
          env: options.env,
          cpuLimit: options.cpuLimit,
          memoryLimit: options.memoryLimit,
          networkPolicy: options.networkPolicy,
          metadata: options.metadata,
        },
        this.manager, // SandboxManager instance initialized in onModuleInit
      );

      const sandboxId: string = sandbox.id; // verify field name from SDK types

      this.logger.debug(
        `Sandbox created: sandboxId=${sandboxId}, executionId=${options.executionId}`,
      );

      // Execute command with streaming callbacks — verify exact run()/exec() API from SDK types
      const execResult = await sandbox.run(options.command, {
        timeout: options.timeoutSeconds * 1000,
        onStdout: (line: string) => {
          stdoutBuffer += line;
          // Stream to ExecutionGateway if available and subscribed
          this.executionGateway?.emitLog(
            options.executionId,
            options.ticketId ?? '',
            line,
            'stdout',
          );
        },
        onStderr: (line: string) => {
          stderrBuffer += line;
          this.executionGateway?.emitLog(
            options.executionId,
            options.ticketId ?? '',
            line,
            'stderr',
          );
        },
      });

      // verify execResult shape from SDK types — expect: { exitCode: number, timedOut?: boolean }
      timedOut = execResult.timedOut ?? false;
      const durationMs = Date.now() - startTime;

      // NFR-OS9: Log execution summary — NEVER log stdout/stderr content
      this.logger.log(
        `Sandbox execution complete: sandboxId=${sandboxId}, ` +
          `executionId=${options.executionId}, providerName=${providerName}, ` +
          `durationMs=${durationMs}, exitCode=${execResult.exitCode}, ` +
          `timedOut=${timedOut}, ` +
          `stdoutBytes=${Buffer.byteLength(stdoutBuffer)}, ` +
          `stderrBytes=${Buffer.byteLength(stderrBuffer)}`,
      );

      return {
        sandboxId,
        stdout: stdoutBuffer,
        stderr: stderrBuffer,
        exitCode: execResult.exitCode,
        durationMs,
        timedOut,
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const message = (err as Error).message ?? '';
      timedOut = /timed? out|timeout/i.test(message);

      this.logger.error(
        `Sandbox execution failed: executionId=${options.executionId}, ` +
          `providerName=${providerName}, durationMs=${durationMs}, ` +
          `timedOut=${timedOut}, error=${message}`,
      );

      throw err;
    } finally {
      // NFR-OS2: Always kill AND close — wrap each in try/catch so one failure cannot skip the other
      if (sandbox) {
        try {
          await sandbox.kill(); // verify method name from SDK types
        } catch (killErr) {
          this.logger.warn(
            `Failed to kill sandbox (executionId=${options.executionId}): ` +
              `${(killErr as Error).message}`,
          );
        }
        try {
          await sandbox.close(); // verify method name from SDK types
        } catch (closeErr) {
          this.logger.warn(
            `Failed to close sandbox (executionId=${options.executionId}): ` +
              `${(closeErr as Error).message}`,
          );
        }
      }
    }
  }

  /** NFR-OS5: Redact sensitive values from env before logging */
  private redactEnvForLogging(env: Record<string, string>): Record<string, string> {
    const SENSITIVE = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i;
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      result[key] = SENSITIVE.test(key) ? '[REDACTED]' : value;
    }
    return result;
  }
}
```

> **⚠️ SDK API verification is MANDATORY before writing any code.** The above uses expected method names based on PRD FR-OS11. After OS-1.2 installs the SDK, inspect `node_modules/@alibaba-group/opensandbox/dist/index.d.ts` and confirm:
>
> - `Sandbox.create()` static method exists and its signature (does it take `manager` as a 2nd arg, or is manager passed via options?)
> - `sandbox.id` vs `sandbox.sandboxId` — exact property name
> - `sandbox.run()` vs `sandbox.exec()` vs `sandbox.execute()` — exact execution method name
> - `execResult.exitCode` and `execResult.timedOut` — exact return type field names
> - `sandbox.kill()` and `sandbox.close()` — exact cleanup method names
>
> **⚠️ If the SDK does NOT support per-line callbacks (`onStdout`/`onStderr`), use one of these fallback patterns instead:**
>
> **Fallback A — AsyncIterable streaming:**
>
> ```typescript
> for await (const { stream, data } of sandbox.stream(options.command, { timeout: ... })) {
>   if (stream === 'stdout') { stdoutBuffer += data; this.executionGateway?.emitLog(..., data, 'stdout'); }
>   if (stream === 'stderr') { stderrBuffer += data; this.executionGateway?.emitLog(..., data, 'stderr'); }
> }
> ```
>
> **Fallback B — EventEmitter streaming:**
>
> ```typescript
> const proc = sandbox.run(options.command, { timeout: ... });
> proc.on('stdout', (data: string) => { stdoutBuffer += data; this.executionGateway?.emitLog(...); });
> proc.on('stderr', (data: string) => { stderrBuffer += data; this.executionGateway?.emitLog(...); });
> const execResult = await proc;
> ```
>
> **Fallback C — No streaming (batch result only):**
> If the SDK returns `{ stdout, stderr, exitCode }` with no streaming support, skip the `emitLog()` calls during execution and emit the complete stdout as a single log after completion. Document this limitation in Dev Agent Record.
>
> Document whichever approach is used and any SDK discrepancies in Dev Agent Record completion notes.

### `SandboxModule` Changes

Update `src/sandbox/sandbox.module.ts`:

```typescript
import { Global, Module, forwardRef } from '@nestjs/common';
import { SandboxService } from './sandbox.service';
import { ExecutionModule } from '@/execution/execution.module';

@Global()
@Module({
  imports: [
    forwardRef(() => ExecutionModule), // forwardRef prevents circular dep when OS-2 has AiRoutingModule → SandboxModule
  ],
  providers: [SandboxService],
  exports: [SandboxService],
})
export class SandboxModule {}
```

**Why `forwardRef`:** In OS-2, `AiRoutingModule` will import `SandboxModule`. `ExecutionModule` already uses `forwardRef(() => AiRoutingModule)`. Without `forwardRef` here, OS-2 creates an unresolved circular dependency chain:
`ExecutionModule` → `AiRoutingModule` → `SandboxModule` → `ExecutionModule`.

### `AgentCommandOptions` Interface Addition

Append one optional field to `src/sandbox/interfaces/agent-command-options.interface.ts`:

```typescript
export interface AgentCommandOptions {
  executionId: string;
  image: string;
  command: string;
  env: Record<string, string>;
  timeoutSeconds: number;
  cpuLimit: string;
  memoryLimit: string;
  networkPolicy?: {
    defaultAction: 'ALLOW' | 'DENY';
    egressRules?: Array<{ target: string }>;
  };
  metadata?: Record<string, string>;
  /** Optional: correlates sandbox execution to the parent ticket in ExecutionGateway log payloads */
  ticketId?: string;
}
```

This is a **backward-compatible, additive** change. No callers of this interface need to be updated.

### Unit Tests for `runAgentCommand()` (T11–T19)

Add to `src/sandbox/sandbox.service.spec.ts`. These tests supplement the 10 tests from OS-1.2.

```typescript
// Extend the mock from OS-1.2 — add Sandbox.create static mock
const mockSandboxRun = jest.fn();
const mockSandboxKill = jest.fn();
const mockSandboxClose = jest.fn();
const mockSandboxInstance = {
  id: 'sandbox-test-id',
  run: mockSandboxRun,
  kill: mockSandboxKill,
  close: mockSandboxClose,
};

// Update the existing @alibaba-group/opensandbox mock to include Sandbox:
jest.mock('@alibaba-group/opensandbox', () => ({
  SandboxManager: jest.fn().mockImplementation(() => ({
    listSandboxInfos: mockListSandboxInfos,
    getSandboxInfo: mockGetSandboxInfo,
    // ... other mocks from OS-1.2
  })),
  Sandbox: {
    create: jest.fn().mockResolvedValue(mockSandboxInstance),
  },
}));

// Mock ExecutionGateway
const mockEmitLog = jest.fn();
const mockExecutionGateway = { emitLog: mockEmitLog };

// Test cases:
describe('runAgentCommand()', () => {
  const baseOptions: AgentCommandOptions = {
    executionId: 'exec-1',
    image: 'opensandbox/code-interpreter:v1.0.2',
    command: 'claude "implement feature"',
    env: { ANTHROPIC_AUTH_TOKEN: 'sk-secret-key', IS_SANDBOX: '1' },
    timeoutSeconds: 3600,
    cpuLimit: '1',
    memoryLimit: '512Mi',
    ticketId: 'ticket-123',
    metadata: { providerName: 'CLAUDE_CODE' },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSandboxRun.mockResolvedValue({ exitCode: 0, timedOut: false });
    mockSandboxKill.mockResolvedValue(undefined);
    mockSandboxClose.mockResolvedValue(undefined);
    // Inject mock gateway into service (via service['executionGateway'] = mockExecutionGateway)
  });

  // T11: Happy path — creates sandbox, runs command, returns AgentCommandResult
  it('T11: returns AgentCommandResult with correct fields on success', async () => {
    mockSandboxRun.mockResolvedValue({ exitCode: 0, timedOut: false });
    const result = await service.runAgentCommand(baseOptions);
    expect(result).toMatchObject({
      sandboxId: 'sandbox-test-id',
      exitCode: 0,
      timedOut: false,
    });
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // T12: stdout is streamed to ExecutionGateway
  it('T12: streams stdout lines to ExecutionGateway.emitLog()', async () => {
    mockSandboxRun.mockImplementation(
      async (_cmd: string, opts: { onStdout: (line: string) => void }) => {
        opts.onStdout('line one\n');
        opts.onStdout('line two\n');
        return { exitCode: 0, timedOut: false };
      },
    );
    await service.runAgentCommand(baseOptions);
    expect(mockEmitLog).toHaveBeenCalledWith('exec-1', 'ticket-123', 'line one\n', 'stdout');
    expect(mockEmitLog).toHaveBeenCalledWith('exec-1', 'ticket-123', 'line two\n', 'stdout');
  });

  // T13: stderr is streamed to ExecutionGateway
  it('T13: streams stderr lines to ExecutionGateway.emitLog()', async () => {
    mockSandboxRun.mockImplementation(
      async (_cmd: string, opts: { onStderr: (line: string) => void }) => {
        opts.onStderr('error output\n');
        return { exitCode: 1, timedOut: false };
      },
    );
    await service.runAgentCommand(baseOptions);
    expect(mockEmitLog).toHaveBeenCalledWith('exec-1', 'ticket-123', 'error output\n', 'stderr');
  });

  // T14: kill() and close() are always called in finally (success path)
  it('T14: calls sandbox.kill() and sandbox.close() in finally block on success', async () => {
    await service.runAgentCommand(baseOptions);
    expect(mockSandboxKill).toHaveBeenCalledTimes(1);
    expect(mockSandboxClose).toHaveBeenCalledTimes(1);
  });

  // T15: kill() and close() are called even when run() throws
  it('T15: calls sandbox.kill() and sandbox.close() even when command execution throws', async () => {
    mockSandboxRun.mockRejectedValue(new Error('Sandbox execution crashed'));
    await expect(service.runAgentCommand(baseOptions)).rejects.toThrow('Sandbox execution crashed');
    expect(mockSandboxKill).toHaveBeenCalledTimes(1);
    expect(mockSandboxClose).toHaveBeenCalledTimes(1);
  });

  // T16: kill() failure does not prevent close() from being called
  it('T16: close() is still called even when kill() throws', async () => {
    mockSandboxKill.mockRejectedValue(new Error('kill failed'));
    await service.runAgentCommand(baseOptions);
    expect(mockSandboxClose).toHaveBeenCalledTimes(1); // close() called despite kill() failure
  });

  // T17: API keys are redacted from all log output (NFR-OS5)
  it('T17: ANTHROPIC_AUTH_TOKEN and other API keys do not appear in log output', async () => {
    const logSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    await service.runAgentCommand({
      ...baseOptions,
      env: { ANTHROPIC_AUTH_TOKEN: 'sk-real-secret', IS_SANDBOX: '1' },
    });
    const allLoggedText = logSpy.mock.calls.map((c) => c.join(' ')).join(' ');
    expect(allLoggedText).not.toContain('sk-real-secret');
    expect(allLoggedText).toContain('[REDACTED]');
  });

  // T18: timedOut is correctly reflected in result and logs
  it('T18: returns timedOut=true when SDK signals timeout', async () => {
    mockSandboxRun.mockResolvedValue({ exitCode: 124, timedOut: true });
    const result = await service.runAgentCommand(baseOptions);
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
  });

  // T19: works without ExecutionGateway (optional injection)
  it('T19: does not throw when ExecutionGateway is null (no gateway injected)', async () => {
    // Simulate gateway not available
    (service as unknown as { executionGateway: null }).executionGateway = null;
    mockSandboxRun.mockImplementation(
      async (_cmd: string, opts: { onStdout: (l: string) => void }) => {
        opts.onStdout('output\n');
        return { exitCode: 0, timedOut: false };
      },
    );
    await expect(service.runAgentCommand(baseOptions)).resolves.not.toThrow();
  });
});
```

### File Structure Modified in This Story

**Modified files only** (no new files created):

```
src/sandbox/
├── interfaces/
│   └── agent-command-options.interface.ts   ← ADD optional ticketId?: string
├── sandbox.module.ts                         ← ADD forwardRef(() => ExecutionModule) to imports
├── sandbox.service.ts                        ← REPLACE stub runAgentCommand() + inject ExecutionGateway + add redactEnvForLogging()
└── sandbox.service.spec.ts                   ← ADD 9 new tests (T11–T19), DELETE T8 stub test
```

**No other files are touched in this story.** Do NOT touch `AppModule`, `execution.module.ts`, `env.validation.ts`, `configuration.ts`, or any `ai-routing/` files.

### ExecutionGateway Integration Architecture

`ExecutionGateway` lives in `ExecutionModule` (`src/execution/execution.module.ts`) and is exported (line 298 of current `execution.module.ts`). The gateway uses namespace `'execution'` and emits to room `execution_logs_${executionId}`.

Key `ExecutionGateway` methods used by `runAgentCommand()`:

```typescript
// From src/execution/gateways/execution.gateway.ts (line 246-293)
emitLog(
  executionId: string,
  ticketId: string,          // pass options.ticketId ?? ''
  message: string,           // raw stdout/stderr line
  source: 'stdout' | 'stderr',
  level?: LogLevel,          // omit — auto-detected by ExecutionGateway
): void
```

The `emitLog()` method:

1. Checks if any client is subscribed to `executionId` — skips silently if none
2. **Already throttles rapid messages** (100ms batching, configured via `LOG_STREAM_THROTTLE_MS` env var) — do NOT add your own throttling or buffering layer in `runAgentCommand()`; `ExecutionGateway` handles this
3. Emits to room `execution_logs_${executionId}` only

**Gateway is `@Optional()`:** If `ExecutionGateway` is not wired (test context, or not yet fully initialized), `SandboxService` must NOT crash. Use optional chaining: `this.executionGateway?.emitLog(...)`.

**Memory note (E2):** `stdoutBuffer` and `stderrBuffer` accumulate the full output in memory for return in `AgentCommandResult`. For long AI agent executions (potentially MBs of output), this is a conscious trade-off in OS-1.3. Memory optimization (streaming-only result with no in-memory capture) is a future concern outside this story's scope.

### Previous Story Intelligence (OS-1.2)

OS-1.2 created the `SandboxService` skeleton with:

- `SandboxManager` initialized in `onModuleInit()` using `ConfigService`
- `pingServer()` private method using `Promise.race` with 10s timeout
- `isHealthy()` public method (called by OS-2 providers)
- Stub `runAgentCommand()` throwing `[OS-1.3] not yet implemented`
- `getSandboxInfo()`, `killSandbox()`, `listActiveSandboxes()` delegating to `SandboxManager`

OS-1.2 also established:

- Logger pattern: `private readonly logger = new Logger(SandboxService.name)` (NOT injected service)
- ConfigService key pattern: `this.config.get<string>('opensandbox.domain')` (dot-notation)
- No need to re-import `ConfigModule` in `SandboxModule` (it's globally available)
- `@Global()` on `SandboxModule` — do NOT remove

**Important:** The OS-1.2 story was `ready-for-dev` but may not be implemented yet. Before implementing OS-1.3, verify that `src/sandbox/sandbox.service.ts` exists and contains the expected stub. If OS-1.2 is not yet implemented, OS-1.3 cannot proceed.

### Git Intelligence

Recent commits establish the OpenSandbox migration context:

- `2029f7e` — `chore: prune obsolete DooD artifacts post migration to OpenSandbox` (planning docs)
- `2202fc0` — `feat: replace DooD with OpenSandbox for secure, provider-agnostic sandbox execution`
  - Modified: `src/config/configuration.ts` — added `opensandbox:` config block
  - Modified: `src/config/env.validation.ts` — added OPENSANDBOX\_\* Joi schemas

Before editing `env.validation.ts` or `configuration.ts`, run `grep -n "OPENSANDBOX" src/config/env.validation.ts src/config/configuration.ts` to check if they were already partially updated in OS-1.2.

### Testing Requirements

**Extend** `src/sandbox/sandbox.service.spec.ts` with 9 new tests (T11–T19 above).

**Delete** T8 from OS-1.2 (the stub test: `runAgentCommand() — throws with [OS-1.3] prefix message`). This test was explicitly marked as a stub contract test and must be replaced.

Total tests after this story: **18** (10 from OS-1.2 − 1 deleted T8 stub = 9 carried forward, + 9 new T11–T19 = **18 total**)

Use the same mocking patterns from OS-1.2:

- `jest.mock('@alibaba-group/opensandbox', ...)` — extend to include `Sandbox.create` static mock
- `jest.spyOn(Logger.prototype, 'debug').mockImplementation()` for redaction test
- `jest.restoreAllMocks()` in `afterEach`

### Source References

- [Source: _bmad-output/planning-artifacts/epics.md#Story OS-1.3]
- [Source: _bmad-output/planning-artifacts/epics.md#FR-OS11 — SandboxService.runAgentCommand() requirements]
- [Source: _bmad-output/planning-artifacts/epics.md#NFR-OS2 — try/finally sandbox cleanup]
- [Source: _bmad-output/planning-artifacts/epics.md#NFR-OS5 — API key redaction]
- [Source: _bmad-output/planning-artifacts/epics.md#NFR-OS9 — execution log fields (not content)]
- [Source: src/execution/gateways/execution.gateway.ts#line 246 — ExecutionGateway.emitLog() signature]
- [Source: src/execution/execution.module.ts#line 298 — ExecutionGateway exported from ExecutionModule]
- [Source: src/execution/execution.module.ts#line 81 — forwardRef(() => AiRoutingModule) pattern to mirror]
- [Source: _bmad-output/implementation-artifacts/os-1-2-sandbox-module-service-startup-health-validation.md#Dev Notes — SandboxService patterns]
- [Source: _bmad-output/implementation-artifacts/os-1-2-sandbox-module-service-startup-health-validation.md#Task 2.4 — stub runAgentCommand to replace]
- [Source: src/execution/services/execution-log-streaming.service.ts#line 242 — redactSecrets() pattern for NFR-OS5]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
