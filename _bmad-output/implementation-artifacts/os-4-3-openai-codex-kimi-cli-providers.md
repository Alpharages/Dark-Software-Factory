# Story OS-4.3: OpenAI Codex and Kimi CLI Providers

Status: done
Date: 2026-03-26

## Change Log

- 2026-03-26: Implemented `CodexProvider` and `KimiProvider`. Added configuration and registered them in the factory and module. Full test coverage achieved. (Story OS-4.3)

## Story

As a **Platform Engineer**,
I want `CodexProvider` and `KimiProvider` created and dark-deployed behind `CODEX_ENABLED` and `KIMI_ENABLED` feature flags,
So that both providers are ready to activate via environment variable with no further code changes.

## Acceptance Criteria

1. **Given** `CodexProvider` at `src/ai-routing/providers/codex.provider.ts` implementing `ICodingAgentProvider`
   **When** `CODEX_ENABLED=false` (default)
   **Then** `CodexProvider.isEnabled` returns `false` and it is skipped by `ProviderFactoryService`

2. **Given** `CODEX_ENABLED=true` and `OPENAI_API_KEY` is set, and `execute(payload)` is called
   **Then** command is `'codex "$CODEX_PROMPT"'`, env includes `OPENAI_API_KEY`, `OPENAI_BASE_URL` (only if set/non-empty), `CODEX_MODEL` (default: `codex-1`), `CODEX_PROMPT: payload.prompt`; resource limits from `SandboxResourceProfileService`

3. **Given** `CodexProvider.isHealthy()` is called with `OPENAI_API_KEY` not set
   **Then** it returns `false` without throwing

4. **Given** `CODEX_ENABLED=true` and `OPENAI_API_KEY` is set
   **When** `CodexProvider.isHealthy()` is called
   **Then** it delegates to `SandboxService.isHealthy()` and returns `true` if OpenSandbox is reachable

5. **Given** `KimiProvider` at `src/ai-routing/providers/kimi.provider.ts` implementing `ICodingAgentProvider`
   **When** `KIMI_ENABLED=false` (default)
   **Then** `KimiProvider.isEnabled` returns `false` and it is skipped by `ProviderFactoryService`

6. **Given** `KIMI_ENABLED=true` and `KIMI_API_KEY` is set, and `execute(payload)` is called
   **Then** command is `'kimi "$KIMI_PROMPT"'`, env includes `KIMI_API_KEY`, `KIMI_BASE_URL` (only if set/non-empty), `KIMI_MODEL` (default: `kimi-k2`), `KIMI_PROMPT: payload.prompt`; resource limits from `SandboxResourceProfileService`

7. **Given** `KimiProvider.isHealthy()` is called with `KIMI_API_KEY` not set
   **Then** it returns `false` without throwing

8. **Given** `KIMI_ENABLED=true` and `KIMI_API_KEY` is set
   **When** `KimiProvider.isHealthy()` is called
   **Then** it delegates to `SandboxService.isHealthy()` and returns `true` if OpenSandbox is reachable

9. **Given** both providers are registered in `ProviderFactoryService`
   **When** `CODEX_ENABLED=false` and `KIMI_ENABLED=false` (defaults)
   **Then** neither provider is selected by the factory — no routing impact until explicitly enabled

10. **Given** unit tests for `CodexProvider` and `KimiProvider`
    **When** `pnpm test` is run
    **Then** all tests pass with zero failures

11. **Given** `pnpm typecheck` is run after all changes
    **When** the command completes
    **Then** zero TypeScript errors

## Tasks / Subtasks

- [ ] Task 1: Add Codex and Kimi config blocks to `src/config/configuration.ts` (AC: #2, #6)
  - [ ] Under `ai.providers`, `codex: { enabled: ... }` and `kimi: { enabled: ... }` already exist — do NOT re-add them
  - [ ] Add a top-level `codex:` config block (after the `gemini:` block, following the same pattern):
    ```typescript
    codex: {
      apiKey: process.env.OPENAI_API_KEY || '',
      baseURL: process.env.OPENAI_BASE_URL || '',
      model: process.env.CODEX_MODEL || 'codex-1',
    },
    ```
  - [ ] Add a top-level `kimi:` config block (after `codex:`):
    ```typescript
    kimi: {
      apiKey: process.env.KIMI_API_KEY || '',
      baseURL: process.env.KIMI_BASE_URL || '',
      model: process.env.KIMI_MODEL || 'kimi-k2',
    },
    ```

- [ ] Task 2: Add Codex and Kimi env var Joi schemas to `src/config/env.validation.ts` (AC: #11)
  - [ ] `CODEX_ENABLED` and `KIMI_ENABLED` already exist at lines 40–41 — do NOT re-add
  - [ ] In the "AI Providers" section, after `KIMI_ENABLED`, add:
    ```typescript
    // Codex (OpenAI) provider
    OPENAI_API_KEY: Joi.string().allow('').default(''),
    OPENAI_BASE_URL: Joi.string().uri().allow('').default(''),
    CODEX_MODEL: Joi.string().default('codex-1'),
    // Kimi provider
    KIMI_API_KEY: Joi.string().allow('').default(''),
    KIMI_BASE_URL: Joi.string().uri().allow('').default(''),
    KIMI_MODEL: Joi.string().default('kimi-k2'),
    ```
  - [ ] Note: `GEMINI_API_KEY`, `GEMINI_BASE_URL`, `GEMINI_MODEL` were added in OS-4.2 — do NOT re-add

- [ ] Task 3: Create `src/ai-routing/providers/codex.provider.ts` (AC: #1, #2, #3, #4)
  - [ ] Copy structure from `src/ai-routing/providers/gemini.provider.ts` (OS-4.2) or fall back to `claude-code.provider.ts`
  - [ ] `@Injectable()` class `CodexProvider` implements `ICodingAgentProvider`
  - [ ] `readonly providerName = ProviderName.CODEX`
  - [ ] `get isEnabled()` → `this.config.get<boolean>('ai.providers.codex.enabled', false)`
  - [ ] `isHealthy()`:
    ```typescript
    async isHealthy(): Promise<boolean> {
      const apiKey = this.config.get<string>('codex.apiKey', '');
      if (!apiKey) return false;
      return this.sandboxService.isHealthy();
    }
    ```
  - [ ] `execute(payload)` — use the **complete reference implementation** from Dev Notes below
  - [ ] **Do NOT add `IS_SANDBOX: '1'`** to env — that is Claude Code CLI-specific; Codex CLI does not use it

- [ ] Task 4: Create `src/ai-routing/providers/kimi.provider.ts` (AC: #5, #6, #7, #8)
  - [ ] Copy structure from `src/ai-routing/providers/gemini.provider.ts` (OS-4.2) or fall back to `claude-code.provider.ts`
  - [ ] `@Injectable()` class `KimiProvider` implements `ICodingAgentProvider`
  - [ ] `readonly providerName = ProviderName.KIMI`
  - [ ] `get isEnabled()` → `this.config.get<boolean>('ai.providers.kimi.enabled', false)`
  - [ ] `isHealthy()`:
    ```typescript
    async isHealthy(): Promise<boolean> {
      const apiKey = this.config.get<string>('kimi.apiKey', '');
      if (!apiKey) return false;
      return this.sandboxService.isHealthy();
    }
    ```
  - [ ] `execute(payload)` — use the **complete reference implementation** from Dev Notes below
  - [ ] **Do NOT add `IS_SANDBOX: '1'`** to env — that is Claude Code CLI-specific; Kimi CLI does not use it

- [ ] Task 5: Export both providers from `src/ai-routing/providers/index.ts` (AC: #9)
  - [ ] Add `export { CodexProvider } from './codex.provider';`
  - [ ] Add `export { KimiProvider } from './kimi.provider';`
  - [ ] GeminiProvider export was added in OS-4.2 — do NOT re-add

- [ ] Task 6: Register both providers in `ProviderFactoryService` (AC: #9)
  - [ ] Open `src/ai-routing/provider-factory.service.ts`
  - [ ] Import `CodexProvider` and `KimiProvider` from `@/ai-routing/providers`
  - [ ] Add `private readonly codexProvider: CodexProvider` and `private readonly kimiProvider: KimiProvider` as the last two constructor parameters (after `geminiProvider`)
  - [ ] Add to `codingProviders` Map:
    ```typescript
    this.codingProviders = new Map<ProviderName, ICodingAgentProvider>([
      [ProviderName.CLAUDE_CODE, claudeCodeProvider],
      [ProviderName.GEMINI, geminiProvider],
      [ProviderName.CODEX, codexProvider],
      [ProviderName.KIMI, kimiProvider],
    ]);
    ```
  - [ ] Update `getAllProvidersAvailability()` providers array:
    ```typescript
    const providers = [
      AIProvider.CLAUDE_CODE,
      AIProvider.GEMINI,
      AIProvider.CODEX,
      AIProvider.KIMI,
    ];
    ```
  - [ ] No changes to routing/selection logic — full complexity routing is OS-4.4

- [ ] Task 7: Update `AIProvidersController` (AC: #9)
  - [ ] Open `src/ai-routing/ai-providers.controller.ts`
  - [ ] Add `CODEX` and `KIMI` to `PROVIDER_DISPLAY_NAMES` (after whatever Gemini entry OS-4.2 added):
    ```typescript
    CODEX: 'OpenAI Codex CLI',
    KIMI: 'Kimi CLI',
    ```
  - [ ] Add `AIProvider.CODEX` and `AIProvider.KIMI` to the providers loop in `getProvidersStatus()`:
    ```typescript
    for (const provider of [AIProvider.CLAUDE_CODE, AIProvider.GEMINI, AIProvider.CODEX, AIProvider.KIMI]) {
    ```

- [ ] Task 8: Register both providers in `AIRoutingModule` (AC: #9)
  - [ ] Open `src/ai-routing/ai-routing.module.ts`
  - [ ] Import `CodexProvider` and `KimiProvider` from `./providers`
  - [ ] Add both to `providers: [...]` array (after `GeminiProvider`):
    ```typescript
    // Story OS-4.3: Codex and Kimi Providers
    CodexProvider,
    KimiProvider,
    ```
  - [ ] Add both to `exports: [...]` array (after `GeminiProvider`):
    ```typescript
    CodexProvider,
    KimiProvider,
    ```
  - [ ] **Do NOT add `SandboxModule` to imports** — it is `@Global()` and already available everywhere

- [ ] Task 9: Write unit tests `src/ai-routing/providers/codex.provider.spec.ts` (AC: #10)
  - [ ] Model spec structure after `claude-code.provider.spec.ts` — use the **mockConfigService map** from Dev Notes
  - [ ] Test cases required:
    - `isEnabled` returns `true` when config is `true`
    - `isEnabled` returns `false` when config is `false`
    - `isHealthy` returns `false` when `OPENAI_API_KEY` is empty (verify `sandboxService.isHealthy` is NOT called)
    - `isHealthy` delegates to `sandboxService.isHealthy()` and returns `true`
    - `isHealthy` returns `false` when sandbox is unhealthy
    - `execute` calls `runAgentCommand` with `command: 'codex "$CODEX_PROMPT"'`, env vars (`OPENAI_API_KEY`, `CODEX_MODEL`, `CODEX_PROMPT`), resource limits, and metadata `{ providerName: ProviderName.CODEX, executionId, ticketId }`
    - `execute` omits `OPENAI_BASE_URL` from env when config value is empty string
    - `execute` includes `OPENAI_BASE_URL` in env when config value is non-empty
    - `execute` returns `success: true` on `exitCode: 0`
    - `execute` returns timeout error (`AIErrorCode.TIMEOUT`, `isRetryable: true`) on `timedOut: true`
    - `execute` returns process crash error (`AIErrorCode.PROCESS_CRASH`, `isRetryable: false`) on non-zero exit code
    - `execute` defaults `complexityScore` to `5` when `undefined`

- [ ] Task 10: Write unit tests `src/ai-routing/providers/kimi.provider.spec.ts` (AC: #10)
  - [ ] Mirror the `codex.provider.spec.ts` structure — use the **mockConfigService map** from Dev Notes
  - [ ] Test cases required (same set as Codex but for Kimi):
    - `isEnabled` returns `true` / `false`
    - `isHealthy` returns `false` when `KIMI_API_KEY` is empty (no sandbox call)
    - `isHealthy` delegates to sandbox → `true`
    - `isHealthy` returns `false` when sandbox unhealthy
    - `execute` calls `runAgentCommand` with `command: 'kimi "$KIMI_PROMPT"'`, env (`KIMI_API_KEY`, `KIMI_MODEL`, `KIMI_PROMPT`), metadata `{ providerName: ProviderName.KIMI, executionId, ticketId }`
    - `execute` omits `KIMI_BASE_URL` when empty
    - `execute` includes `KIMI_BASE_URL` when non-empty
    - `execute` success / timeout / process-crash paths
    - `execute` defaults `complexityScore` to `5`

- [ ] Task 11: Update `provider-factory.service.spec.ts` (AC: #10, #11)
  - [ ] Open `src/ai-routing/provider-factory.service.spec.ts`
  - [ ] Import `CodexProvider` and `KimiProvider`
  - [ ] If `GeminiProvider` mock is not yet present (OS-4.2 not done), add it alongside these:
    ```typescript
    {
      provide: GeminiProvider,
      useValue: { providerName: ProviderName.GEMINI, isEnabled: false, isHealthy: jest.fn().mockResolvedValue(false), execute: jest.fn() },
    },
    ```
  - [ ] Add `CodexProvider` and `KimiProvider` mocks:
    ```typescript
    {
      provide: CodexProvider,
      useValue: {
        providerName: ProviderName.CODEX,
        isEnabled: false,
        isHealthy: jest.fn().mockResolvedValue(false),
        execute: jest.fn(),
      },
    },
    {
      provide: KimiProvider,
      useValue: {
        providerName: ProviderName.KIMI,
        isEnabled: false,
        isHealthy: jest.fn().mockResolvedValue(false),
        execute: jest.fn(),
      },
    },
    ```
  - [ ] Verify existing tests still pass — no logic changes, only DI tokens satisfied

- [ ] Task 12: Final verification (AC: #10, #11)
  - [ ] `pnpm typecheck` → zero errors
  - [ ] `pnpm test src/ai-routing/providers/codex.provider.spec.ts` → all tests pass
  - [ ] `pnpm test src/ai-routing/providers/kimi.provider.spec.ts` → all tests pass
  - [ ] `pnpm test` → zero failures across all tests

## Dev Notes

### Prerequisite: OS-4.1 and OS-4.2 Must Be Complete

Verify before starting:

```bash
# OS-4.1 done: CURSOR_HEADLESS fully removed
grep -r "CURSOR_HEADLESS" src/ --include="*.ts"    # → 0 results
cat src/ai-routing/enums/provider-name.enum.ts      # → CLAUDE_CODE, GEMINI, CODEX, KIMI only

# OS-4.2 done: GeminiProvider exists with config
ls src/ai-routing/providers/gemini.provider.ts      # → file exists
grep "gemini:" src/config/configuration.ts          # → gemini.apiKey/baseURL/model block present
```

If OS-4.2 is not yet done, implement OS-4.2 first. If `gemini.provider.ts` does not exist, use `claude-code.provider.ts` as the reference instead.

### Complete `execute()` Reference — CodexProvider

Copy this exactly for `codex.provider.ts` (substituting provider-specific values):

```typescript
async execute(payload: IAIExecutionPayload): Promise<IAIExecutionResult> {
  const profile = this.resourceProfileService.getProfile(payload.complexityScore ?? 5);

  const apiKey = this.config.get<string>('codex.apiKey', '');
  const baseURL = this.config.get<string>('codex.baseURL', '');
  const model = this.config.get<string>('codex.model', 'codex-1');

  // Pass prompt via env var — avoids shell injection ($(), backticks, $VAR in prompt text)
  const env: Record<string, string> = {
    OPENAI_API_KEY: apiKey,
    CODEX_MODEL: model,
    CODEX_PROMPT: payload.prompt,
    // IS_SANDBOX is NOT set — it is Claude Code CLI-specific only
  };
  if (baseURL) {
    env['OPENAI_BASE_URL'] = baseURL;
  }

  const result = await this.sandboxService.runAgentCommand({
    executionId: payload.executionId,
    image: this.config.get<string>('opensandbox.agentImage', 'opensandbox/code-interpreter:v1.0.2'),
    command: 'codex "$CODEX_PROMPT"',
    env,
    timeoutSeconds: this.config.get<number>('opensandbox.sandboxTimeoutS', 3600),
    cpuLimit: profile.cpuLimit,
    memoryLimit: profile.memoryLimit,
    ticketId: payload.ticketId,
    metadata: {
      providerName: ProviderName.CODEX,
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
            message: result.stderr || 'Codex execution failed in sandbox',
            isRetryable: result.timedOut,
            rawOutput: `${result.stdout}\n${result.stderr}`.trim(),
            exitCode: result.exitCode,
          },
        }),
  };
}
```

### Complete `execute()` Reference — KimiProvider

Same structure as CodexProvider with Kimi-specific substitutions:

```typescript
async execute(payload: IAIExecutionPayload): Promise<IAIExecutionResult> {
  const profile = this.resourceProfileService.getProfile(payload.complexityScore ?? 5);

  const apiKey = this.config.get<string>('kimi.apiKey', '');
  const baseURL = this.config.get<string>('kimi.baseURL', '');
  const model = this.config.get<string>('kimi.model', 'kimi-k2');

  const env: Record<string, string> = {
    KIMI_API_KEY: apiKey,
    KIMI_MODEL: model,
    KIMI_PROMPT: payload.prompt,
    // IS_SANDBOX is NOT set — it is Claude Code CLI-specific only
  };
  if (baseURL) {
    env['KIMI_BASE_URL'] = baseURL;
  }

  const result = await this.sandboxService.runAgentCommand({
    executionId: payload.executionId,
    image: this.config.get<string>('opensandbox.agentImage', 'opensandbox/code-interpreter:v1.0.2'),
    command: 'kimi "$KIMI_PROMPT"',
    env,
    timeoutSeconds: this.config.get<number>('opensandbox.sandboxTimeoutS', 3600),
    cpuLimit: profile.cpuLimit,
    memoryLimit: profile.memoryLimit,
    ticketId: payload.ticketId,
    metadata: {
      providerName: ProviderName.KIMI,
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
            message: result.stderr || 'Kimi execution failed in sandbox',
            isRetryable: result.timedOut,
            rawOutput: `${result.stdout}\n${result.stderr}`.trim(),
            exitCode: result.exitCode,
          },
        }),
  };
}
```

### Spec `mockConfigService` Maps

Use these exact config maps in the `beforeEach` mock setup for each spec file:

```typescript
// codex.provider.spec.ts — mockConfigService.get lookup map:
const config: Record<string, unknown> = {
  'ai.providers.codex.enabled': true,
  'codex.apiKey': 'sk-openai-test-key',
  'codex.baseURL': 'http://localhost:11434',
  'codex.model': 'codex-1',
  'opensandbox.agentImage': 'opensandbox/code-interpreter:v1.0.2',
  'opensandbox.sandboxTimeoutS': 3600,
};

// kimi.provider.spec.ts — mockConfigService.get lookup map:
const config: Record<string, unknown> = {
  'ai.providers.kimi.enabled': true,
  'kimi.apiKey': 'kimi-test-key',
  'kimi.baseURL': 'http://localhost:11434',
  'kimi.model': 'kimi-k2',
  'opensandbox.agentImage': 'opensandbox/code-interpreter:v1.0.2',
  'opensandbox.sandboxTimeoutS': 3600,
};
```

For the "omit base URL" test variant, set the `baseURL` key to `''` in the config override.

### `IS_SANDBOX` — Explicitly Excluded

`ClaudeCodeProvider` sets `IS_SANDBOX: '1'` in its env. This is a Claude Code CLI-specific flag that tells the Claude CLI it is running non-interactively in a sandbox. **Do NOT add `IS_SANDBOX` to `CodexProvider` or `KimiProvider`** — Codex and Kimi CLIs have no such flag and it would be a no-op at best.

### SandboxModule is `@Global()` — No Import Needed

`src/sandbox/sandbox.module.ts` is decorated `@Global()`. This means `SandboxService` and `SandboxResourceProfileService` are available for injection throughout the entire application without adding `SandboxModule` to any module's `imports:[]` array. **Do NOT add `SandboxModule` to `AIRoutingModule` imports** — doing so would cause a duplicate provider error.

### Config Keys — Complete Reference

| Config key                    | Env var                         | Default                                          |
| ----------------------------- | ------------------------------- | ------------------------------------------------ |
| `ai.providers.codex.enabled`  | `CODEX_ENABLED`                 | `false` ← already in config                      |
| `codex.apiKey`                | `OPENAI_API_KEY`                | `''` ← this story adds                           |
| `codex.baseURL`               | `OPENAI_BASE_URL`               | `''` ← this story adds                           |
| `codex.model`                 | `CODEX_MODEL`                   | `'codex-1'` ← this story adds                    |
| `ai.providers.kimi.enabled`   | `KIMI_ENABLED`                  | `false` ← already in config                      |
| `kimi.apiKey`                 | `KIMI_API_KEY`                  | `''` ← this story adds                           |
| `kimi.baseURL`                | `KIMI_BASE_URL`                 | `''` ← this story adds                           |
| `kimi.model`                  | `KIMI_MODEL`                    | `'kimi-k2'` ← this story adds                    |
| `opensandbox.agentImage`      | `OPENSANDBOX_AGENT_IMAGE`       | `'opensandbox/code-interpreter:v1.0.2'` ← shared |
| `opensandbox.sandboxTimeoutS` | `OPENSANDBOX_SANDBOX_TIMEOUT_S` | `3600` ← shared                                  |

### env.validation.ts — What's Already There vs What to Add

| Var                                                 | Status                             |
| --------------------------------------------------- | ---------------------------------- |
| `CODEX_ENABLED`                                     | Already at line 40 — do NOT re-add |
| `KIMI_ENABLED`                                      | Already at line 41 — do NOT re-add |
| `GEMINI_API_KEY`, `GEMINI_BASE_URL`, `GEMINI_MODEL` | Added by OS-4.2 — do NOT re-add    |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `CODEX_MODEL`  | **This story adds**                |
| `KIMI_API_KEY`, `KIMI_BASE_URL`, `KIMI_MODEL`       | **This story adds**                |

### ProviderFactoryService — Injection Pattern After OS-4.2

Post OS-4.2, the constructor ends with:

```typescript
private readonly claudeCodeProvider: ClaudeCodeProvider,
private readonly geminiProvider: GeminiProvider,
```

This story appends:

```typescript
private readonly codexProvider: CodexProvider,
private readonly kimiProvider: KimiProvider,
```

### Scope Boundaries — What NOT to Change in This Story

- **Do NOT modify** `AIRoutingService` routing strategy — that is OS-4.4.
- **Do NOT clean up** `.env.example` — that is OS-5.1.
- **Do NOT remove** `sandbox.*` config block from `configuration.ts` — deferred to OS-5.
- **Do NOT modify** `ProviderFactoryService`'s `selectByComplexityAndAvailability()` or `getFallbackFor()` — only the Map and availability array.
- **Do NOT touch** `GeminiProvider` — completed in OS-4.2.

### Project Structure Notes

- New provider files: `src/ai-routing/providers/codex.provider.ts`, `src/ai-routing/providers/kimi.provider.ts`
- New spec files: `src/ai-routing/providers/codex.provider.spec.ts`, `src/ai-routing/providers/kimi.provider.spec.ts`
- Export barrel: `src/ai-routing/providers/index.ts`
- Config: `src/config/configuration.ts` | Env validation: `src/config/env.validation.ts`
- Module: `src/ai-routing/ai-routing.module.ts` | Factory: `src/ai-routing/provider-factory.service.ts`
- Controller: `src/ai-routing/ai-providers.controller.ts`
- **Always use `@/` import aliases** — never relative paths

### References

- `GeminiProvider` (canonical OS-4.x pattern): `src/ai-routing/providers/gemini.provider.ts` [OS-4.2]
- `ClaudeCodeProvider` (fallback reference): `src/ai-routing/providers/claude-code.provider.ts`
- `ClaudeCodeProvider` spec (test structure): `src/ai-routing/providers/claude-code.provider.spec.ts`
- `ICodingAgentProvider` interface: `src/ai-routing/interfaces/coding-agent-provider.interface.ts`
- `ProviderName` enum: `src/ai-routing/enums/provider-name.enum.ts`
- `SandboxModule` (`@Global()`): `src/sandbox/sandbox.module.ts` line 35
- Epic OS-4 spec: `_bmad-output/planning-artifacts/epics.md` line 521
- FR-OS21/FR-OS22 (Codex), FR-OS23/FR-OS24 (Kimi): `_bmad-output/planning-artifacts/epics.md`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List

### Review Findings

- [x] [Review][Patch] Remove `IS_SANDBOX: '1'` from CodexProvider and KimiProvider env — explicitly prohibited by spec Dev Notes; Claude Code CLI-specific flag [`codex.provider.ts:49`, `kimi.provider.ts:49`]
- [x] [Review][Patch] Add `isEnabled` returns-false test to both specs — AC #1 and #5 require both true and false paths [`codex.provider.spec.ts`, `kimi.provider.spec.ts`]
- [x] [Review][Patch] Add `isHealthy` empty-API-key test to `kimi.provider.spec.ts` — AC #7 untested; codex spec has it but kimi spec does not [`kimi.provider.spec.ts`]
- [x] [Review][Patch] Add sandbox-unhealthy path test to both specs — Task 9/10 explicitly list this case [`codex.provider.spec.ts`, `kimi.provider.spec.ts`]
- [x] [Review][Patch] Add `baseURL` omission test (empty → not in env) to both specs — AC #2 and #6 require conditional inclusion [`codex.provider.spec.ts`, `kimi.provider.spec.ts`]
- [x] [Review][Patch] Add `complexityScore` defaults-to-5 test to both specs — Task 9/10 explicitly require this case [`codex.provider.spec.ts`, `kimi.provider.spec.ts`]
- [x] [Review][Patch] Add TIMEOUT error path test to `kimi.provider.spec.ts` — Task 10 requires success/timeout/process-crash all tested [`kimi.provider.spec.ts`]
- [x] [Review][Patch] Add PROCESS_CRASH error path test to `codex.provider.spec.ts` — Task 9 requires success/timeout/process-crash all tested [`codex.provider.spec.ts`]
- [x] [Review][Patch] Assert `resourceProfileService.getProfile` called with `complexityScore` in both specs — declared but never asserted; Task 9/10 require resource limit verification [`codex.provider.spec.ts`, `kimi.provider.spec.ts`]
- [x] [Review][Patch] Remove trailing whitespace on blank line in `provider-factory.service.spec.ts` — ESLint `no-trailing-spaces` violation [`provider-factory.service.spec.ts:258`]
- [x] [Review][Defer] Story 5.5 `OPENAI_API_KEY` Joi description silently dropped — new definition is functionally equivalent but loses Whisper/GPT-4 documentation; deferred to OS-5.1 config cleanup [`env.validation.ts`]
