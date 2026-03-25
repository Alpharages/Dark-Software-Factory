# Story OS-2.2: ClaudeCodeProvider Rewrite Using SandboxService

Status: ready-for-dev

## Story

As a **PM / AI Engineer**,
I want `ClaudeCodeProvider` rewritten to execute Claude Code CLI inside an OpenSandbox container via `SandboxService`,
so that tickets processed by Claude Code run in an isolated, secure sandbox environment end-to-end.

## Acceptance Criteria

1. **Given** `ClaudeCodeProvider` implements `ICodingAgentProvider`
   **When** it is registered in `ProviderFactoryService` via the provider map
   **Then** `ProviderFactoryService` selects it by `ProviderName.CLAUDE_CODE` without any hardcoded selection logic

2. **Given** `CLAUDE_CODE_ENABLED=true`
   **When** `ClaudeCodeProvider.isEnabled` is read
   **Then** it returns `true`

3. **Given** `ClaudeCodeProvider.execute(payload)` is called with a ticket execution payload
   **When** it calls `SandboxService.runAgentCommand()`
   **Then** the command is `claude "${escapedPrompt}"` (double quotes in prompt escaped), env includes:
   - `ANTHROPIC_AUTH_TOKEN` from `anthropic.apiKey` config
   - `ANTHROPIC_BASE_URL` if config value is non-empty
   - `ANTHROPIC_MODEL` from `anthropic.model` config
   - `IS_SANDBOX=1`
   - Resource limits come from `SandboxResourceProfileService.getProfile(payload.complexityScore ?? 5)`

4. **Given** `ClaudeCodeProvider.isHealthy()` is called
   **When** it checks health
   **Then** it delegates to `SandboxService.isHealthy()` — no Anthropic API calls made

5. **Given** a ClickUp ticket reaches the AI execution queue with a valid prompt
   **When** the full pipeline runs end-to-end (ClickUp webhook → AIRoutingConsumer → AIExecutionConsumer → OrchestratorService → ClaudeCodeProvider → SandboxService → OpenSandbox)
   **Then** Claude Code CLI runs inside an OpenSandbox container, output is captured, execution state transitions to `COMPLETED` (or `FAILED` on error)

6. **Given** `pnpm typecheck` and `pnpm lint` are run after the rewrite
   **When** the commands complete
   **Then** zero TypeScript errors and zero ESLint errors

## Tasks / Subtasks

- [ ] Task 1: Rewrite `ClaudeCodeProvider` to implement `ICodingAgentProvider` (AC: #1, #2, #3, #4)
  - [ ] Open `src/ai-routing/providers/claude-code.provider.ts`
  - [ ] Replace the entire class with a new implementation using `ICodingAgentProvider` (see Dev Notes for exact design)
  - [ ] Remove imports for: `BaseAIProvider`, `PtyExecutionService`, `WorkspaceService`, `CircuitBreaker`, `ContainerOutputParser`, `ExecutionTrackerService`, `IAIPromptExecutor`, `IAIPromptExecutionInput`, `IAIPromptExecutionResult`
  - [ ] Remove `@InjectMetric` constructor params (no new PTY metrics — `SandboxService` owns metrics)
  - [ ] Add these exact imports (see code snippet in Dev Notes for full file):
    - `import { Injectable } from '@nestjs/common';`
    - `import { ConfigService } from '@nestjs/config';`
    - `import { ICodingAgentProvider } from '../interfaces/coding-agent-provider.interface';`
    - `import { ProviderName } from '@/ai-routing/enums/provider-name.enum';`
    - `import { IAIExecutionPayload } from '@/execution/interfaces';`
    - `import { IAIExecutionResult, AIErrorCode } from './ai-provider.interface';`
    - `import { SandboxService } from '@/sandbox/sandbox.service';`
    - `import { SandboxResourceProfileService } from '@/sandbox/sandbox-resource-profile.service';`
  - [ ] Implement `readonly providerName = ProviderName.CLAUDE_CODE`
  - [ ] Implement `get isEnabled()` reading from `ai.providers.claudeCode.enabled` config key
  - [ ] Implement `isHealthy()` delegating to `this.sandboxService.isHealthy()`
  - [ ] Implement `execute(payload: IAIExecutionPayload)` — see Dev Notes for full design

- [ ] Task 2: Update `ProviderFactoryService` to add provider map (AC: #1)
  - [ ] Open `src/ai-routing/provider-factory.service.ts`
  - [ ] Add `ClaudeCodeProvider` to constructor injection
  - [ ] Add private `codingProviders: Map<ProviderName, ICodingAgentProvider>` initialized in constructor
  - [ ] Register `ProviderName.CLAUDE_CODE → claudeCodeProvider` in the map
  - [ ] Add public `getCodingProvider(name: ProviderName): ICodingAgentProvider | undefined` method

- [ ] Task 3: Add `complexityScore` to `IAIExecutionPayload` and extend `IOrchestrationInput` (AC: #5)
  - [ ] Open `src/execution/interfaces/queue.interface.ts`
  - [ ] Add `/** Complexity score (0-10) — used by ClaudeCodeProvider for sandbox resource profile selection */ complexityScore?: number;` to `IAIExecutionPayload` (after `allowFallback?`)
  - [ ] Open `src/ai-routing/interfaces/orchestration.interface.ts`
  - [ ] Add `/** Project ID — passed from AIExecutionConsumer for ICodingAgentProvider path */ projectId?: string;` to `IOrchestrationInput`
  - [ ] Add `/** Complexity score (0-10) — pre-fetched from DB, passed through to IAIExecutionPayload */ complexityScore?: number;` to `IOrchestrationInput`

- [ ] Task 4: Update `AIExecutionConsumer` to pass new fields to orchestrator (AC: #5)
  - [ ] Open `src/execution/ai-execution.consumer.ts`
  - [ ] In `processExecution()`, find the `this.orchestrator.execute({...})` call — search for `providerOverride: payload.aiProvider` to locate it
  - [ ] Add `projectId: payload.projectId` to the orchestrator call
  - [ ] Add `complexityScore: execution?.complexity_score ?? undefined` — `execution` is already fetched earlier in the same method via `this.executionTracker.getExecution(executionId)`; no new DB call needed

- [ ] Task 5: Update `OrchestratorService` to dispatch to `ICodingAgentProvider` (AC: #5)
  - [ ] Open `src/ai-routing/orchestrator.service.ts`
  - [ ] Inject `ProviderFactoryService` (already injected)
  - [ ] After `selectProvider()` call, check if selected provider has `ICodingAgentProvider` registration
  - [ ] If yes AND provider `isEnabled`, use new path: build `IAIExecutionPayload`, call `codingProvider.execute(payload)`
  - [ ] Map result directly to `IOrchestrationResult` (same `IAIExecutionResult` shape)
  - [ ] If no `ICodingAgentProvider` registered, fall through to old `FallbackStrategyService` path
  - [ ] See Dev Notes for the `mapAIProviderToProviderName()` helper and `buildExecutionPayload()` helper

- [ ] Task 6: Update `AiRoutingModule` provider registration (AC: #1, #5)
  - [ ] Open `src/ai-routing/ai-routing.module.ts`
  - [ ] Remove the `@InjectMetric` metric providers for `claude_executions_total`, `claude_execution_duration_seconds`, `claude_active_executions`, `claude_tokens_total`, `claude_cost_cents` from `providers` array (no longer used by new `ClaudeCodeProvider`) — NOTE: The `makeXxxProvider` calls in the module must be removed too
  - [ ] `ClaudeCodeProvider` is already listed in `providers` and `exports` — no change needed there
  - [ ] `SandboxModule` is `@Global()` so `SandboxService` and `SandboxResourceProfileService` are injectable without adding `SandboxModule` to imports
  - [ ] Verify whether `PtyExecutionService` is still used before removing it: run `grep -r "PtyExecutionService" src/ai-routing/providers/cursor-headless.provider.ts` — if any results, leave it in `providers` and `exports`; if no results, remove it

- [ ] Task 7: Write unit tests (AC: #2, #3, #4, #6)
  - [ ] Open (or replace) `src/ai-routing/providers/claude-code.provider.spec.ts`
  - [ ] T1: `isEnabled` returns `true` when config `ai.providers.claudeCode.enabled=true`
  - [ ] T2: `isEnabled` returns `false` when config `ai.providers.claudeCode.enabled=false`
  - [ ] T3: `isHealthy()` returns `true` when `SandboxService.isHealthy()` returns `true`
  - [ ] T4: `isHealthy()` returns `false` when `SandboxService.isHealthy()` returns `false`
  - [ ] T5: `execute()` calls `SandboxService.runAgentCommand()` with correct `image`, `env`, `timeoutSeconds`
  - [ ] T6: `execute()` escapes double quotes in prompt — verify command is `claude "prompt with \\"quotes\\""`
  - [ ] T7: `execute()` returns `success=true`, `codeDiff=stdout`, `durationMs` when `exitCode=0`
  - [ ] T8: `execute()` returns `success=false`, `error.code=TIMEOUT` when `timedOut=true`
  - [ ] T9: `execute()` returns `success=false`, `error.code=PROCESS_CRASH` when `exitCode≠0`
  - [ ] T10: `execute()` calls `SandboxResourceProfileService.getProfile(payload.complexityScore ?? 5)` and passes result as `cpuLimit`/`memoryLimit`
  - [ ] T10b: When `complexityScore` is `undefined` in payload, `getProfile` is called with `5` (medium default), not `undefined`
  - [ ] T11: `execute()` includes `IS_SANDBOX=1` in env
  - [ ] T12: `execute()` omits `ANTHROPIC_BASE_URL` from env when config value is empty string
  - [ ] Run `pnpm typecheck` and `pnpm lint` and fix all issues

- [ ] Task 8: Add `getCodingProvider` unit test to `ProviderFactoryService` spec
  - [ ] Open `src/ai-routing/provider-factory.service.spec.ts`
  - [ ] Add test: `getCodingProvider(ProviderName.CLAUDE_CODE)` returns the `ClaudeCodeProvider` instance
  - [ ] Add test: `getCodingProvider('UNKNOWN' as ProviderName)` returns `undefined`

## Dev Notes

### CRITICAL: What Already Exists from OS-2.1

**DO NOT recreate these — they were built in OS-2.1:**

- `src/ai-routing/enums/provider-name.enum.ts` — `ProviderName.CLAUDE_CODE`, `ProviderName.CURSOR_HEADLESS`
- `src/ai-routing/enums/index.ts` — exports `ProviderName`
- `src/ai-routing/interfaces/coding-agent-provider.interface.ts` — `ICodingAgentProvider` with `providerName`, `isEnabled`, `isHealthy()`, `execute()`
- `src/sandbox/sandbox-resource-profile.service.ts` — `SandboxResourceProfileService.getProfile(score)`
- `src/sandbox/index.ts` — exports `SandboxResourceProfileService`, `ResourceProfile`

**What OS-2.2 must add (NOT already present — Task 3 covers this):**

- `IAIExecutionPayload.complexityScore?: number` — must be added to `src/execution/interfaces/queue.interface.ts` in Task 3
- `IOrchestrationInput.projectId?: string` — must be added to `src/ai-routing/interfaces/orchestration.interface.ts` in Task 3
- `IOrchestrationInput.complexityScore?: number` — must be added to `src/ai-routing/interfaces/orchestration.interface.ts` in Task 3

**DO NOT redefine these — they already exist:**

- `SandboxService.isHealthy()` at `src/sandbox/sandbox.service.ts:100` — returns `Promise<boolean>`
- `SandboxService.runAgentCommand(options: AgentCommandOptions)` at line 122 — the main method
- `AgentCommandOptions` at `src/sandbox/interfaces/agent-command-options.interface.ts`
- `AgentCommandResult` at `src/sandbox/interfaces/agent-command-result.interface.ts`
- `IAIExecutionResult` at `src/ai-routing/interfaces/ai-provider.interface.ts` — reused as return type
- `AIErrorCode` at `src/ai-routing/interfaces/ai-provider.interface.ts`
- `anthropic.apiKey`, `anthropic.baseURL`, `anthropic.model` config keys in `src/config/configuration.ts:167-177`
- `opensandbox.agentImage`, `opensandbox.sandboxTimeoutS` config keys in `src/config/configuration.ts:335-348`
- `ai.providers.claudeCode.enabled` config key in `src/config/configuration.ts:38`

### New ClaudeCodeProvider — Full Design

```typescript
// src/ai-routing/providers/claude-code.provider.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ICodingAgentProvider } from '../interfaces/coding-agent-provider.interface';
import { ProviderName } from '@/ai-routing/enums/provider-name.enum';
import { IAIExecutionPayload } from '@/execution/interfaces';
import { IAIExecutionResult, AIErrorCode } from './ai-provider.interface';
// NOTE: SandboxModule is @Global() — injectable without importing SandboxModule
import { SandboxService } from '@/sandbox/sandbox.service';
import { SandboxResourceProfileService } from '@/sandbox/sandbox-resource-profile.service';

@Injectable()
export class ClaudeCodeProvider implements ICodingAgentProvider {
  readonly providerName = ProviderName.CLAUDE_CODE;

  get isEnabled(): boolean {
    return this.config.get<boolean>('ai.providers.claudeCode.enabled', false);
  }

  constructor(
    private readonly config: ConfigService,
    private readonly sandboxService: SandboxService,
    private readonly resourceProfileService: SandboxResourceProfileService,
  ) {}

  async isHealthy(): Promise<boolean> {
    return this.sandboxService.isHealthy();
  }

  async execute(payload: IAIExecutionPayload): Promise<IAIExecutionResult> {
    const startTime = Date.now();

    // Escape double quotes in prompt so the shell command is valid
    const escapedPrompt = payload.prompt.replace(/"/g, '\\"');

    // Get resource limits from complexity score (OS-2.1 contract)
    const profile = this.resourceProfileService.getProfile(payload.complexityScore ?? 5);

    // Build environment — never log raw env (NFR-OS5 from SandboxService)
    const apiKey = this.config.get<string>('anthropic.apiKey', '');
    const baseURL = this.config.get<string>('anthropic.baseURL', '');
    const model = this.config.get<string>('anthropic.model', 'claude-sonnet-4-20250514');

    const env: Record<string, string> = {
      ANTHROPIC_AUTH_TOKEN: apiKey, // Claude Code CLI uses ANTHROPIC_AUTH_TOKEN
      ANTHROPIC_MODEL: model,
      IS_SANDBOX: '1',
    };
    if (baseURL) {
      env['ANTHROPIC_BASE_URL'] = baseURL;
    }

    const result = await this.sandboxService.runAgentCommand({
      executionId: payload.executionId,
      image: this.config.get<string>(
        'opensandbox.agentImage',
        'opensandbox/code-interpreter:v1.0.2',
      ),
      command: `claude "${escapedPrompt}"`,
      env,
      timeoutSeconds: this.config.get<number>('opensandbox.sandboxTimeoutS', 3600),
      cpuLimit: profile.cpuLimit,
      memoryLimit: profile.memoryLimit,
      ticketId: payload.ticketId,
      metadata: {
        providerName: ProviderName.CLAUDE_CODE,
        executionId: payload.executionId,
        ticketId: payload.ticketId,
      },
    });

    const success = result.exitCode === 0 && !result.timedOut;

    return {
      success,
      codeDiff: success ? result.stdout : null,
      filesChanged: [],
      confidenceScore: success ? 0.8 : 0.0,
      durationMs: result.durationMs,
      workspacePath: '',
      ...(success
        ? {}
        : {
            error: {
              code: result.timedOut ? AIErrorCode.TIMEOUT : AIErrorCode.PROCESS_CRASH,
              message: result.stderr || 'Claude Code execution failed in sandbox',
              isRetryable: result.timedOut,
              rawOutput: `${result.stdout}\n${result.stderr}`.trim(),
              exitCode: result.exitCode,
            },
          }),
    };
  }
}
```

**Why `ANTHROPIC_AUTH_TOKEN` not `ANTHROPIC_API_KEY`:** Claude Code CLI inside a container reads `ANTHROPIC_AUTH_TOKEN` (not `ANTHROPIC_API_KEY`) per the Claude CLI documentation for sandbox/headless environments.

**Why `filesChanged: []`:** The sandbox stdout does not yet include a structured file list. Parsing detailed file changes from stdout is deferred to OS-4. The `codeDiff` (raw stdout) is sufficient for OS-2 E2E validation.

**Why `workspacePath: ''`:** There is no local workspace — execution is fully inside the sandbox container.

### ProviderFactoryService — Provider Map Addition

```typescript
// src/ai-routing/provider-factory.service.ts — additions only

import { ICodingAgentProvider } from './interfaces/coding-agent-provider.interface';
import { ProviderName } from '@/ai-routing/enums/provider-name.enum';

@Injectable()
export class ProviderFactoryService {
  private readonly codingProviders: Map<ProviderName, ICodingAgentProvider>;

  constructor(
    private readonly config: ConfigService,
    private readonly aiExecution: AIExecutionService,
    private readonly complexityScorer: ComplexityScorerService,
    @InjectMetric('orchestrator_provider_selections_total')
    private readonly selectionsCounter: Counter<string>,
    private readonly claudeCodeProvider: ClaudeCodeProvider, // ADD
  ) {
    // Build provider map — no hardcoded logic per AC #1
    this.codingProviders = new Map<ProviderName, ICodingAgentProvider>([
      [ProviderName.CLAUDE_CODE, claudeCodeProvider],
      // CURSOR_HEADLESS added in OS-4 when CursorHeadlessProvider implements ICodingAgentProvider
    ]);
    // ... existing threshold setup
  }

  getCodingProvider(name: ProviderName): ICodingAgentProvider | undefined {
    return this.codingProviders.get(name);
  }
}
```

**Import `ClaudeCodeProvider`** from `./providers` (it's already exported from that barrel).

### IOrchestrationInput Extension

```typescript
// src/ai-routing/interfaces/orchestration.interface.ts — add to IOrchestrationInput
export interface IOrchestrationInput extends IAIExecutionInput {
  // ... existing fields ...
  /** Project ID — passed from AIExecutionConsumer for ICodingAgentProvider path */
  projectId?: string;
  /** Complexity score (0-10) — pre-fetched from DB for sandbox resource profile selection */
  complexityScore?: number;
}
```

### AIExecutionConsumer — Pass New Fields

In `processExecution()`, find the `this.orchestrator.execute({...})` call — search for `providerOverride: payload.aiProvider` to locate it. Update it to:

```typescript
const result = await this.orchestrator.execute({
  correlationId,
  executionId,
  ticketId: payload.ticketId,
  prompt,
  repositoryUrl,
  allowFallback: payload.allowFallback ?? true,
  selectedModel,
  providerOverride: payload.aiProvider,
  projectId: payload.projectId, // ADD: needed by ICodingAgentProvider path
  complexityScore: execution?.complexity_score ?? undefined, // ADD: pre-fetched at line ~325
});
```

Note: `execution` is already fetched at line ~325 (`const execution = await this.executionTracker.getExecution(executionId)`). The `complexity_score` field is already available — no new DB call needed.

### OrchestratorService — ICodingAgentProvider Dispatch Path

Add private helpers and update `execute()` method. The new path dispatches to `ICodingAgentProvider` when available; falls through to old `FallbackStrategyService` path otherwise (preserving backward compatibility for Cursor):

```typescript
// src/ai-routing/orchestrator.service.ts

// Add to imports
import { ICodingAgentProvider } from './interfaces/coding-agent-provider.interface';
import { ProviderName } from '@/ai-routing/enums/provider-name.enum';
import { AIProvider } from '@/prisma/client';
import { IAIExecutionPayload } from '@/execution/interfaces';

// Map Prisma AIProvider → new ProviderName
private mapAIProviderToProviderName(provider: AIProvider): ProviderName | undefined {
  const map: Partial<Record<string, ProviderName>> = {
    [AIProvider.CLAUDE_CODE]: ProviderName.CLAUDE_CODE,
    // CURSOR_HEADLESS added in OS-4
  };
  return map[provider];
}

// Build IAIExecutionPayload from IOrchestrationInput (for ICodingAgentProvider.execute())
private buildExecutionPayload(
  input: IOrchestrationInput,
  complexityScore: number,
): IAIExecutionPayload {
  return {
    ticketId: input.ticketId,
    executionId: input.executionId,
    aiProvider: (input.providerOverride as AIProvider) ?? AIProvider.CLAUDE_CODE,
    priority: 1,
    prompt: input.prompt,
    repositoryUrl: input.repositoryUrl,
    projectId: input.projectId ?? '',
    // NOTE: IAIExecutionInput uses `baseBranch` (source branch to start from),
    // IAIExecutionPayload uses `targetBranch` (branch to push changes to).
    // These are the same concept with different names across the two interfaces.
    targetBranch: input.baseBranch,
    targetFiles: input.targetFiles,
    allowFallback: input.allowFallback,
    complexityScore,
  };
}

// In execute() method, AFTER selectProvider() and BEFORE fallbackStrategy.executeWithFallback():
const selection = await this.providerFactory.selectProvider(input);

// Check for ICodingAgentProvider path (OS-2.2+)
const providerName = this.mapAIProviderToProviderName(selection.primary);
const codingProvider = providerName
  ? this.providerFactory.getCodingProvider(providerName)
  : undefined;

if (codingProvider?.isEnabled) {
  // New sandbox path: directly execute via ICodingAgentProvider
  const payload = this.buildExecutionPayload(input, selection.complexityScore);
  const execResult = await codingProvider.execute(payload);

  const totalDurationMs = Date.now() - startTime;
  this.trackExecution(
    { result: execResult, executedBy: selection.primary, usedFallback: false, fallbackAttempts: [] },
    totalDurationMs,
  );

  return {
    success: execResult.success,
    executedBy: selection.primary,
    usedFallback: false,
    codeDiff: execResult.codeDiff,
    filesChanged: execResult.filesChanged,
    confidenceScore: execResult.confidenceScore,
    durationMs: execResult.durationMs,
    totalDurationMs,
    workspacePath: execResult.workspacePath,
    fallbackAttempts: [],
    estimatedCostCents: this.estimateCost(selection.primary, totalDurationMs),
    error: execResult.error,
    tokensInput: execResult.tokensInput,
    tokensOutput: execResult.tokensOutput,
    model: execResult.model,
  };
}

// Old path: Cursor/DooD via FallbackStrategyService (unchanged until OS-3)
const executionResult = await this.fallbackStrategy.executeWithFallback(...);
```

**Why check `isEnabled` before dispatching:** Guards against a provider registered in the map but disabled via env var.

**`trackExecution` adapter:** Before calling `trackExecution()`, read its signature in `orchestrator.service.ts` — search for `private trackExecution`. It accepts an execution result object and duration. Pass the `IAIExecutionResult` wrapped to match whatever shape `trackExecution` expects. If it expects an `IFallbackResult`-shaped object, wrap: `{ result: execResult, executedBy: selection.primary, usedFallback: false, fallbackAttempts: [] }`. If the method doesn't exist, update `providerUsage` and `executionTimes` inline (same pattern the old path uses after `fallbackStrategy.executeWithFallback`).

### AiRoutingModule — Metric Cleanup

**Remove these `makeXxxProvider` calls** from `providers` in `ai-routing.module.ts` (the new `ClaudeCodeProvider` does NOT inject them):

- `claude_executions_total`
- `claude_execution_duration_seconds`
- `claude_active_executions`
- `claude_tokens_total`
- `claude_cost_cents`

**Do NOT remove** `PtyExecutionService` — it is still used by `CursorHeadlessProvider`. Verify with `grep -r "PtyExecutionService" src/ai-routing/providers/cursor`.

**Do NOT remove** `WorkspaceService` — still used by `CursorHeadlessProvider`.

**Do NOT remove** `ClaudeCodePromptBuilder` — still used by `AIRoutingService`.

### AgentCommandOptions Reference

All fields for `SandboxService.runAgentCommand()` (from `src/sandbox/interfaces/agent-command-options.interface.ts`):

```typescript
interface AgentCommandOptions {
  executionId: string;
  image: string;
  command: string;
  env: Record<string, string>;
  timeoutSeconds: number;
  cpuLimit: string; // e.g., "0.5", "1", "2"
  memoryLimit: string; // e.g., "256Mi", "512Mi", "1Gi"
  networkPolicy?: { defaultAction: 'ALLOW' | 'DENY'; egressRules?: Array<{ target: string }> };
  metadata?: Record<string, string>;
  ticketId?: string; // correlates sandbox to parent ticket in ExecutionGateway
}
```

The `networkPolicy` field is omitted in `ClaudeCodeProvider` — `SandboxService` defaults to the `opensandbox.networkDefaultAction` config value (`ALLOW`). Claude needs network access to call the Anthropic API from inside the sandbox.

### Config Keys Reference (All Exist — Do NOT Re-add)

| Env Var                            | ConfigService Key                 | Default                                 |
| ---------------------------------- | --------------------------------- | --------------------------------------- |
| `CLAUDE_CODE_ENABLED`              | `ai.providers.claudeCode.enabled` | `false`                                 |
| `ANTHROPIC_API_KEY`                | `anthropic.apiKey`                | `''`                                    |
| `ANTHROPIC_BASE_URL`               | `anthropic.baseURL`               | `undefined`                             |
| `ANTHROPIC_MODEL`                  | `anthropic.model`                 | `'claude-sonnet-4-20250514'`            |
| `ANTHROPIC_TIMEOUT_MS`             | `anthropic.timeoutMs`             | `300000`                                |
| `OPENSANDBOX_AGENT_IMAGE`          | `opensandbox.agentImage`          | `'opensandbox/code-interpreter:v1.0.2'` |
| `OPENSANDBOX_SANDBOX_TIMEOUT_S`    | `opensandbox.sandboxTimeoutS`     | `3600`                                  |
| `OPENSANDBOX_DEFAULT_CPU_LIMIT`    | `opensandbox.defaultCpuLimit`     | `'1'`                                   |
| `OPENSANDBOX_DEFAULT_MEMORY_LIMIT` | `opensandbox.defaultMemoryLimit`  | `'512Mi'`                               |

### Testing Pattern

The old `ClaudeCodeProvider` spec used PTY mocks. The new spec is simpler — mock `SandboxService` and `SandboxResourceProfileService`:

```typescript
// src/ai-routing/providers/claude-code.provider.spec.ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClaudeCodeProvider } from './claude-code.provider';
import { SandboxService } from '@/sandbox/sandbox.service';
import { SandboxResourceProfileService } from '@/sandbox/sandbox-resource-profile.service';
import { ProviderName } from '@/ai-routing/enums/provider-name.enum';
import { AIErrorCode } from './ai-provider.interface';

describe('ClaudeCodeProvider', () => {
  let provider: ClaudeCodeProvider;
  let configGet: jest.Mock;
  let sandboxRunAgentCommand: jest.Mock;
  let sandboxIsHealthy: jest.Mock;
  let resourceGetProfile: jest.Mock;

  beforeEach(async () => {
    configGet = jest.fn((key: string, def?: unknown) => {
      const map: Record<string, unknown> = {
        'ai.providers.claudeCode.enabled': true,
        'anthropic.apiKey': 'test-key',
        'anthropic.baseURL': '',
        'anthropic.model': 'claude-sonnet-4-20250514',
        'opensandbox.agentImage': 'opensandbox/code-interpreter:v1.0.2',
        'opensandbox.sandboxTimeoutS': 3600,
      };
      return map[key] ?? def;
    });
    sandboxRunAgentCommand = jest.fn().mockResolvedValue({
      sandboxId: 'sb-123',
      stdout: 'diff output',
      stderr: '',
      exitCode: 0,
      durationMs: 1000,
      timedOut: false,
    });
    sandboxIsHealthy = jest.fn().mockResolvedValue(true);
    resourceGetProfile = jest.fn().mockReturnValue({ cpuLimit: '1', memoryLimit: '512Mi' });

    const module = await Test.createTestingModule({
      providers: [
        ClaudeCodeProvider,
        { provide: ConfigService, useValue: { get: configGet } },
        {
          provide: SandboxService,
          useValue: { runAgentCommand: sandboxRunAgentCommand, isHealthy: sandboxIsHealthy },
        },
        { provide: SandboxResourceProfileService, useValue: { getProfile: resourceGetProfile } },
      ],
    }).compile();
    provider = module.get(ClaudeCodeProvider);
  });

  afterEach(() => jest.resetAllMocks());
  // T1–T12 test cases...
});
```

**T6 (prompt escaping):**

```typescript
it('T6: escapes double quotes in prompt', async () => {
  const payload = makePayload({ prompt: 'fix the "broken" function' });
  await provider.execute(payload);
  const call = sandboxRunAgentCommand.mock.calls[0][0];
  expect(call.command).toBe('claude "fix the \\"broken\\" function"');
});
```

**T10 (resource profile):**

```typescript
it('T10: passes resource profile to runAgentCommand', async () => {
  resourceGetProfile.mockReturnValue({ cpuLimit: '2', memoryLimit: '1Gi' });
  const payload = makePayload({ complexityScore: 8 });
  await provider.execute(payload);
  expect(resourceGetProfile).toHaveBeenCalledWith(8);
  const call = sandboxRunAgentCommand.mock.calls[0][0];
  expect(call.cpuLimit).toBe('2');
  expect(call.memoryLimit).toBe('1Gi');
});
```

**T10b (default complexityScore fallback):**

```typescript
it('T10b: defaults to profile for score 5 when complexityScore is undefined', async () => {
  const payload = makePayload({ complexityScore: undefined });
  await provider.execute(payload);
  expect(resourceGetProfile).toHaveBeenCalledWith(5);
});
```

**T12 (baseURL omission):**

```typescript
it('T12: omits ANTHROPIC_BASE_URL from env when config value is empty', async () => {
  configGet.mockImplementation((k: string, def?: unknown) =>
    k === 'anthropic.baseURL' ? '' : (configGet.mock.results[0]?.value ?? def),
  );
  const payload = makePayload({});
  await provider.execute(payload);
  const call = sandboxRunAgentCommand.mock.calls[0][0];
  expect(call.env).not.toHaveProperty('ANTHROPIC_BASE_URL');
  expect(call.env).toHaveProperty('IS_SANDBOX', '1');
});
```

### Anti-Patterns to Avoid

1. **DO NOT touch `CursorHeadlessProvider`** — it still uses `IAIProvider` + `PtyExecutionService` until OS-3.
2. **DO NOT modify `FallbackStrategyService`** — that is OS-2.3 scope.
3. **DO NOT modify `ProviderHealthService`** — that is OS-2.3 scope.
4. **DO NOT add `SandboxModule` to `AiRoutingModule` imports** — `SandboxModule` is `@Global()`, making `SandboxService` and `SandboxResourceProfileService` injectable everywhere with no extra imports.
5. **DO NOT use `IAIExecutionInput` as the execute param** — the new interface uses `IAIExecutionPayload` (from queue). These are different types.
6. **DO NOT extend `BaseAIProvider`** — the new `ClaudeCodeProvider` is a clean `ICodingAgentProvider` with no inheritance chain.
7. **DO NOT add Prometheus metrics to `ClaudeCodeProvider`** — `SandboxService` already records `opensandbox_executions_total`, `opensandbox_execution_duration_seconds`, `opensandbox_active_sandboxes` per execution. No double-counting.
8. **DO NOT delete DooD/Docker imports from `ai-routing.module.ts`** — `DockerModule` is still needed by `CursorHeadlessProvider` and `WorkspaceService`.
9. **DO NOT remove `claudeCode` from existing `ai-routing.service.ts` provider availability checks** — `AIRoutingService` still uses `ai.providers.claudeCode.enabled` for routing decisions (line ~73).
10. **DO NOT hardcode `AIProvider.CLAUDE_CODE` in `mapAIProviderToProviderName`** — use the existing `AIProvider` enum from `@/prisma/client`.

### Project Structure Notes

**Files to modify:**

```
src/
├── ai-routing/
│   ├── providers/
│   │   ├── claude-code.provider.ts        ← REWRITE (new ICodingAgentProvider impl)
│   │   └── claude-code.provider.spec.ts   ← REPLACE (new test suite)
│   ├── interfaces/
│   │   └── orchestration.interface.ts     ← ADD projectId?, complexityScore? to IOrchestrationInput
│   ├── provider-factory.service.ts        ← ADD codingProviders map + getCodingProvider()
│   ├── orchestrator.service.ts            ← ADD ICodingAgentProvider dispatch path
│   └── ai-routing.module.ts               ← REMOVE claude_* metric providers
└── execution/
    ├── ai-execution.consumer.ts           ← ADD projectId, complexityScore to orchestrator call
    └── interfaces/
        └── queue.interface.ts             ← ADD complexityScore?: number to IAIExecutionPayload
```

**Files NOT to touch:**

```
src/sandbox/sandbox.service.ts             ← DO NOT TOUCH (complete from OS-1)
src/sandbox/sandbox.module.ts              ← DO NOT TOUCH
src/sandbox/sandbox-resource-profile.service.ts  ← DO NOT TOUCH (from OS-2.1)
src/ai-routing/interfaces/coding-agent-provider.interface.ts  ← DO NOT TOUCH (from OS-2.1)
src/ai-routing/enums/provider-name.enum.ts  ← DO NOT TOUCH (from OS-2.1)
src/ai-routing/providers/cursor-headless.provider.ts  ← DO NOT TOUCH
src/ai-routing/fallback-strategy.service.ts  ← DO NOT TOUCH (OS-2.3)
src/ai-routing/provider-health.service.ts   ← DO NOT TOUCH (OS-2.3)
```

### References

- OS-2.1 story (interface + resource profile): `_bmad-output/implementation-artifacts/os-2-1-coding-agent-provider-interface-resource-profile-service.md`
- ICodingAgentProvider interface: `src/ai-routing/interfaces/coding-agent-provider.interface.ts`
- ProviderName enum: `src/ai-routing/enums/provider-name.enum.ts`
- SandboxService.runAgentCommand(): `src/sandbox/sandbox.service.ts:122`
- SandboxService.isHealthy(): `src/sandbox/sandbox.service.ts:100`
- AgentCommandOptions: `src/sandbox/interfaces/agent-command-options.interface.ts`
- AgentCommandResult: `src/sandbox/interfaces/agent-command-result.interface.ts`
- IAIExecutionResult + AIErrorCode: `src/ai-routing/interfaces/ai-provider.interface.ts`
- IAIExecutionPayload: `src/execution/interfaces/queue.interface.ts` — Task 3 adds `complexityScore?` here
- IOrchestrationInput: `src/ai-routing/interfaces/orchestration.interface.ts`
- AIExecutionConsumer.processExecution(): `src/execution/ai-execution.consumer.ts:232`
- OrchestratorService.execute(): `src/ai-routing/orchestrator.service.ts:69`
- ProviderFactoryService: `src/ai-routing/provider-factory.service.ts`
- AiRoutingModule: `src/ai-routing/ai-routing.module.ts`
- Config keys: `src/config/configuration.ts:38, 167-177, 335-348`
- OpenSandbox PRD (FR-OS17, FR-OS18): `_bmad-output/planning-artifacts/prd-opensandbox-migration.md`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
