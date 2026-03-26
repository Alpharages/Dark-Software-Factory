# Story OS-4.2: Gemini CLI Provider

Status: ready-for-dev

## Story

As a **Platform Engineer**,
I want a `GeminiProvider` that executes Gemini CLI inside an OpenSandbox container when `GEMINI_ENABLED=true`,
so that I can dark-deploy the provider and enable it when a `GEMINI_API_KEY` is ready, without code changes.

## Acceptance Criteria

1. **Given** `GeminiProvider` is created at `src/ai-routing/providers/gemini.provider.ts` implementing `ICodingAgentProvider`
   **When** `GEMINI_ENABLED=false` (default)
   **Then** `GeminiProvider.isEnabled` returns `false` and it is skipped by `ProviderFactoryService`

2. **Given** `GEMINI_ENABLED=true` and `GEMINI_API_KEY` is set
   **When** `GeminiProvider.execute(payload)` is called
   **Then** `SandboxService.runAgentCommand()` is called with:
   - `command: 'gemini "$GEMINI_PROMPT"'` (prompt passed via env var, not CLI arg)
   - `env.GEMINI_API_KEY` = config value
   - `env.GEMINI_BASE_URL` = config value (only if set/non-empty)
   - `env.GEMINI_MODEL` = config value (default: `gemini-2.5-pro`)
   - `env.GEMINI_PROMPT` = `payload.prompt`
   - Resource limits from `SandboxResourceProfileService.getProfile(complexityScore ?? 5)`

3. **Given** `GEMINI_API_KEY` is not configured
   **When** `GeminiProvider.isHealthy()` is called
   **Then** it returns `false` without throwing

4. **Given** `GEMINI_ENABLED=true` and `GEMINI_API_KEY` is set
   **When** `GeminiProvider.isHealthy()` is called
   **Then** it delegates to `SandboxService.isHealthy()` and returns `true` if OpenSandbox is reachable

5. **Given** `GeminiProvider` is registered in `ProviderFactoryService`
   **When** `ProviderFactoryService` builds the `codingProviders` map
   **Then** `ProviderName.GEMINI` maps to the `GeminiProvider` instance, and `getAllProvidersAvailability()` includes `AIProvider.GEMINI`

6. **Given** config entries are added for the Gemini provider
   **When** `src/config/configuration.ts` is inspected
   **Then** `ai.providers.gemini.enabled`, `gemini.apiKey`, `gemini.baseURL`, `gemini.model` config keys exist

7. **Given** `AIProvidersController.getProvidersStatus()` is called
   **When** the Observability page loads `/api/v1/ai-providers/status`
   **Then** the response includes a Gemini entry with display name `'Gemini CLI'` alongside the Claude Code entry

8. **Given** unit tests for `GeminiProvider` in `src/ai-routing/providers/gemini.provider.spec.ts`
   **When** `pnpm test` is run
   **Then** all tests pass with zero failures — covering: `isEnabled` true/false, `isHealthy` with/without API key, `execute` happy path, timeout error, process crash error, missing `GEMINI_BASE_URL` omitted from env

9. **Given** `pnpm typecheck` is run after all changes
   **When** the command completes
   **Then** zero TypeScript errors

## Tasks / Subtasks

- [ ] Task 1: Add Gemini config to `src/config/configuration.ts` (AC: #6)
  - [ ] Under `ai.providers`, add:
    ```typescript
    gemini: {
      enabled: process.env.GEMINI_ENABLED === 'true',
    },
    ```
  - [ ] Add a top-level `gemini:` config block:
    ```typescript
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '',
      baseURL: process.env.GEMINI_BASE_URL || '',
      model: process.env.GEMINI_MODEL || 'gemini-2.5-pro',
    },
    ```
  - [ ] Follow the exact structure already used by `anthropic:` and `claudeCode` in the same file

- [ ] Task 2: Add Gemini env var Joi schemas to `src/config/env.validation.ts` (AC: #9)
  - [ ] Add `GEMINI_ENABLED: Joi.boolean().default(false)` (matches pattern of `CLAUDE_CODE_ENABLED: Joi.boolean().default(false)`)
  - [ ] Add `GEMINI_API_KEY: Joi.string().allow('').default('')`
  - [ ] Add `GEMINI_BASE_URL: Joi.string().uri().allow('').default('')`
  - [ ] Add `GEMINI_MODEL: Joi.string().default('gemini-2.5-pro')`
  - [ ] Place them in the "AI Providers" section near `CLAUDE_CODE_ENABLED` (line ~37–40)

- [ ] Task 3: Create `src/ai-routing/providers/gemini.provider.ts` (AC: #1, #2, #3, #4)
  - [ ] Create file following the exact `ClaudeCodeProvider` pattern at `src/ai-routing/providers/claude-code.provider.ts`
  - [ ] `@Injectable()` class `GeminiProvider` implements `ICodingAgentProvider`
  - [ ] `readonly providerName = ProviderName.GEMINI`
  - [ ] `get isEnabled()` → `this.config.get<boolean>('ai.providers.gemini.enabled', false)`
  - [ ] `isHealthy()`: if `!this.config.get<string>('gemini.apiKey', '')` → return `false`; else → `return this.sandboxService.isHealthy()`
  - [ ] `execute(payload)`:
    - Get profile: `this.resourceProfileService.getProfile(payload.complexityScore ?? 5)`
    - Read: `apiKey = this.config.get<string>('gemini.apiKey', '')`
    - Read: `baseURL = this.config.get<string>('gemini.baseURL', '')`
    - Read: `model = this.config.get<string>('gemini.model', 'gemini-2.5-pro')`
    - Build `env`: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_PROMPT: payload.prompt` — only add `GEMINI_BASE_URL` if non-empty
    - Call `sandboxService.runAgentCommand({ executionId, image, command: 'gemini "$GEMINI_PROMPT"', env, timeoutSeconds, cpuLimit, memoryLimit, ticketId, metadata })`
    - Return `IAIExecutionResult` using same `success / error` shape as `ClaudeCodeProvider`

- [ ] Task 4: Export `GeminiProvider` from `src/ai-routing/providers/index.ts` (AC: #5)
  - [ ] Add `export { GeminiProvider } from './gemini.provider';`

- [ ] Task 5: Register `GeminiProvider` in `ProviderFactoryService` (AC: #5)
  - [ ] Open `src/ai-routing/provider-factory.service.ts`
  - [ ] Import `GeminiProvider` from `@/ai-routing/providers`
  - [ ] Add `private readonly geminiProvider: GeminiProvider` as constructor parameter (last, after `claudeCodeProvider`)
  - [ ] Add `[ProviderName.GEMINI, geminiProvider]` to the `codingProviders` Map in the constructor
  - [ ] Update `getAllProvidersAvailability()` providers array — after OS-4.1 it will be `[AIProvider.CLAUDE_CODE]`; change it to `[AIProvider.CLAUDE_CODE, AIProvider.GEMINI]`
  - [ ] No changes to routing/selection logic — full complexity routing is OS-4.4

- [ ] Task 6: Update `AIProvidersController` (AC: #7)
  - [ ] Open `src/ai-routing/ai-providers.controller.ts`
  - [ ] Add `GEMINI: 'Gemini CLI'` to the `PROVIDER_DISPLAY_NAMES` map (line ~23)
  - [ ] Add `AIProvider.GEMINI` to the providers loop in `getProvidersStatus()` (line ~62)
  - [ ] After OS-4.1 removes `CURSOR_HEADLESS` from this loop, the loop becomes `[AIProvider.CLAUDE_CODE]` — change to `[AIProvider.CLAUDE_CODE, AIProvider.GEMINI]`

- [ ] Task 7: Register `GeminiProvider` in `AIRoutingModule` (AC: #5)
  - [ ] Open `src/ai-routing/ai-routing.module.ts`
  - [ ] Import `GeminiProvider` from `./providers`
  - [ ] Add `GeminiProvider` to `providers: [...]` array (alongside `ClaudeCodeProvider`)
  - [ ] Add `GeminiProvider` to `exports: [...]` array (alongside `ClaudeCodeProvider`)

- [ ] Task 8: Write unit tests `src/ai-routing/providers/gemini.provider.spec.ts` (AC: #8)
  - [ ] Model spec structure directly after `claude-code.provider.spec.ts`
  - [ ] Test cases required:
    - `isEnabled` returns `true` when config is `true`
    - `isEnabled` returns `false` when config is `false`
    - `isHealthy` returns `false` when `GEMINI_API_KEY` is empty (no sandbox call made)
    - `isHealthy` delegates to `sandboxService.isHealthy()` and returns `true`
    - `isHealthy` returns `false` when sandbox is unhealthy
    - `execute` calls `runAgentCommand` with correct `command: 'gemini "$GEMINI_PROMPT"'`, env vars (GEMINI_API_KEY, GEMINI_MODEL, GEMINI_PROMPT), resource limits, metadata
    - `execute` omits `GEMINI_BASE_URL` from env when config value is empty
    - `execute` includes `GEMINI_BASE_URL` in env when config value is non-empty
    - `execute` returns `success: true` on `exitCode: 0`
    - `execute` returns timeout error (`AIErrorCode.TIMEOUT`, `isRetryable: true`) on `timedOut: true`
    - `execute` returns process crash error (`AIErrorCode.PROCESS_CRASH`, `isRetryable: false`) on non-zero exit code
    - `execute` defaults `complexityScore` to `5` when `undefined`

- [ ] Task 9: Update `provider-factory.service.spec.ts` (AC: #8, #9)
  - [ ] Open `src/ai-routing/provider-factory.service.spec.ts`
  - [ ] Add a `GeminiProvider` mock to the `TestingModule` providers array (mirroring how `ClaudeCodeProvider` is mocked)
  - [ ] Add `GeminiProvider` to the `provide:` entry or as a direct mock:
    ```typescript
    { provide: GeminiProvider, useValue: { providerName: ProviderName.GEMINI, isEnabled: false, isHealthy: jest.fn().mockResolvedValue(false), execute: jest.fn() } }
    ```
  - [ ] Verify existing tests still pass — no logic changes needed, only the new DI token is satisfied

- [ ] Task 10: Final verification (AC: #8, #9)
  - [ ] `pnpm typecheck` → zero errors
  - [ ] `pnpm test src/ai-routing/providers/gemini.provider.spec.ts` → all tests pass
  - [ ] `pnpm test` → zero failures across all tests (including `provider-factory.service.spec.ts`)

## Dev Notes

### Critical: Use `ClaudeCodeProvider` as the Exact Reference Template

`src/ai-routing/providers/claude-code.provider.ts` is the **canonical provider implementation**. Copy its structure exactly for `GeminiProvider`. Key decisions already made in that file that must NOT be re-invented:

- **Shell injection prevention:** Prompt is passed via `GEMINI_PROMPT` env var, NOT embedded in the CLI command string. The command is always the fixed string `'gemini "$GEMINI_PROMPT"'`. This is the established pattern — never interpolate `payload.prompt` into the command string.
- **`isEnabled` uses `get()` getter pattern** (not a field set in constructor) so it reads live config on each call.
- **`isHealthy()` delegates to `sandboxService.isHealthy()`** for sandbox connectivity check (plus the API key guard for Gemini — see below).
- **IAIExecutionResult shape:** `success`, `codeDiff`, `filesChanged: []`, `confidenceScore`, `durationMs`, `workspacePath: ''`, `error` — exact same shape.

### Gemini CLI Command — Definitive Spec

Use `'gemini "$GEMINI_PROMPT"'` as the command string — matching the `ClaudeCodeProvider` pattern exactly (`'claude "$CLAUDE_PROMPT"'`). The `ClaudeCodeProvider` was implemented without a `npm install` prefix (OS-2), establishing that `opensandbox/code-interpreter:v1.0.2` is expected to have the CLI available OR the install is handled at the ops layer. Follow that same decision for Gemini.

If `pnpm test` reveals that the sandbox image doesn't have `gemini` in `$PATH` (integration test failure, not unit test), the command becomes:

```typescript
command: 'npm i -g @google/gemini-cli@latest && gemini "$GEMINI_PROMPT"';
```

But default to the short form matching `ClaudeCodeProvider` — do not add the install step unless integration tests prove it's needed.

### `isHealthy()` — API Key Guard Before Sandbox Check

Unlike `ClaudeCodeProvider` (which only checks sandbox connectivity), `GeminiProvider.isHealthy()` must also verify the API key is configured. Implementation:

```typescript
async isHealthy(): Promise<boolean> {
  const apiKey = this.config.get<string>('gemini.apiKey', '');
  if (!apiKey) return false;
  return this.sandboxService.isHealthy();
}
```

This matches FR-OS20: "must check that `GEMINI_API_KEY` is configured AND OpenSandbox is reachable. Must return `false` (not throw) if not configured."

### Config Keys (Follow Existing Pattern)

The `configuration.ts` file organizes config into nested objects. Existing pattern for `claudeCode`:

- `ai.providers.claudeCode.enabled` → `process.env.CLAUDE_CODE_ENABLED === 'true'`
- `anthropic.apiKey` → `process.env.ANTHROPIC_API_KEY || ''`
- `anthropic.model` → `process.env.ANTHROPIC_MODEL || '...'`

Follow the same two-level pattern for Gemini:

- `ai.providers.gemini.enabled` → `process.env.GEMINI_ENABLED === 'true'`
- `gemini.apiKey` → `process.env.GEMINI_API_KEY || ''`
- `gemini.baseURL` → `process.env.GEMINI_BASE_URL || ''`
- `gemini.model` → `process.env.GEMINI_MODEL || 'gemini-2.5-pro'`

The `cursorHeadless` config block is still present in `configuration.ts` after OS-4.1 (`.env.example` cleanup deferred to OS-5). Leave it — don't remove it in this story.

### ProviderFactoryService — Injection Pattern

Current constructor (post OS-4.1):

```typescript
constructor(
  private readonly config: ConfigService,
  private readonly aiExecution: AIExecutionService,
  private readonly complexityScorer: ComplexityScorerService,
  @InjectMetric('orchestrator_provider_selections_total')
  private readonly selectionsCounter: Counter<string>,
  private readonly claudeCodeProvider: ClaudeCodeProvider,
)
```

Add `private readonly geminiProvider: GeminiProvider` as the **last** constructor parameter. Update both the `codingProviders` map AND `getAllProvidersAvailability()`:

```typescript
// constructor:
this.codingProviders = new Map<ProviderName, ICodingAgentProvider>([
  [ProviderName.CLAUDE_CODE, claudeCodeProvider],
  [ProviderName.GEMINI, geminiProvider],
]);

// getAllProvidersAvailability():
const providers = [AIProvider.CLAUDE_CODE, AIProvider.GEMINI];
```

NestJS DI resolves the new constructor parameter automatically once `GeminiProvider` is in the module's `providers` array.

### AIProvidersController — Observability Dashboard

`src/ai-routing/ai-providers.controller.ts` is the `/api/v1/ai-providers/status` endpoint consumed by the Observability page. After OS-4.1 removes `AIProvider.CURSOR_HEADLESS`, add `AIProvider.GEMINI`:

```typescript
// PROVIDER_DISPLAY_NAMES map (line ~23):
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  CLAUDE_CODE: 'Antigravity',
  GEMINI: 'Gemini CLI',
};

// getProvidersStatus() providers loop (line ~62):
for (const provider of [AIProvider.CLAUDE_CODE, AIProvider.GEMINI]) {
```

Without this update, Gemini never appears in the Observability dashboard regardless of being registered in the factory.

### AIRoutingModule Registration

Current `ai-routing.module.ts` already registers `ClaudeCodeProvider` in both `providers:[]` and `exports:[]`. Replicate the same pattern for `GeminiProvider` — it needs to be in both arrays.

### ProviderName Enum — Already Updated in OS-4.1

As part of OS-4.1, `ProviderName.GEMINI` was added to `src/ai-routing/enums/provider-name.enum.ts`. Do NOT re-add it. Verify it exists before touching the enum file.

### provider-factory.service.spec.ts — Must Add GeminiProvider Mock

The spec creates `ProviderFactoryService` via `TestingModule`. After adding `geminiProvider` as a constructor parameter, the test module will fail to resolve `GeminiProvider` unless a mock is registered:

```typescript
{
  provide: GeminiProvider,
  useValue: {
    providerName: ProviderName.GEMINI,
    isEnabled: false,
    isHealthy: jest.fn().mockResolvedValue(false),
    execute: jest.fn(),
  },
}
```

Add this to the `providers:[]` array in the spec's `TestingModule`. No test logic changes needed — only satisfying the DI token.

### Scope Boundaries — What NOT to Change in This Story

- **Do NOT modify** `AIRoutingService` routing strategy — that is OS-4.4.
- **Do NOT add** `CodexProvider` or `KimiProvider` — those are OS-4.3.
- **Do NOT clean up** `.env.example` — that is OS-5.1.
- **Do NOT remove** `cursorHeadless` from `configuration.ts` — deferred to OS-5.
- **Do NOT modify** `ProviderFactoryService`'s `selectByComplexityAndAvailability()` or `getFallbackFor()` — only the Map and availability array.

### Project Structure Notes

- All provider files: `src/ai-routing/providers/` — `gemini.provider.ts` goes here
- All provider specs: `src/ai-routing/providers/gemini.provider.spec.ts` (same folder as implementation)
- Export barrel: `src/ai-routing/providers/index.ts` — add the export
- Config file: `src/config/configuration.ts`
- Env validation: `src/config/env.validation.ts`
- Module registration: `src/ai-routing/ai-routing.module.ts`
- ProviderFactory: `src/ai-routing/provider-factory.service.ts`
- Observability controller: `src/ai-routing/ai-providers.controller.ts`
- **Always use `@/` import aliases** (e.g. `@/sandbox/sandbox.service`) — never relative paths

### Previous Story OS-4.1 Outcomes

OS-4.1 (ready-for-dev, not yet implemented) performs the groundwork:

- Adds `GEMINI`, `CODEX`, `KIMI` to `ProviderName` enum
- Removes `CURSOR_HEADLESS` from all references including `AIProvidersController` and `getAllProvidersAvailability()`
- Updates `ProviderFactoryService` to simplify routing to CLAUDE_CODE-only

**This story (OS-4.2) assumes OS-4.1 has been completed.** If `ProviderName.GEMINI` does not yet exist in the enum, complete OS-4.1 first.

### References

- `ClaudeCodeProvider` (canonical pattern): `src/ai-routing/providers/claude-code.provider.ts`
- `ClaudeCodeProvider` spec (test template): `src/ai-routing/providers/claude-code.provider.spec.ts`
- `ICodingAgentProvider` interface: `src/ai-routing/interfaces/coding-agent-provider.interface.ts`
- `ProviderName` enum: `src/ai-routing/enums/provider-name.enum.ts`
- `ProviderFactoryService`: `src/ai-routing/provider-factory.service.ts` (constructor line ~39–57, `getAllProvidersAvailability` line ~306)
- `AIProvidersController`: `src/ai-routing/ai-providers.controller.ts` (display names line ~23, loop line ~62)
- `AIRoutingModule`: `src/ai-routing/ai-routing.module.ts`
- `SandboxResourceProfileService`: `src/sandbox/sandbox-resource-profile.service.ts`
- `SandboxService.isHealthy()`: `src/sandbox/sandbox.service.ts`
- Config structure: `src/config/configuration.ts` (line ~32–57 for ai.providers pattern)
- Env validation: `src/config/env.validation.ts` (line ~37–40 for boolean provider flags)
- Epic OS-4 spec: `_bmad-output/planning-artifacts/epics.md` line 473
- PRD FR-OS19, FR-OS20: `_bmad-output/planning-artifacts/prd-opensandbox-migration.md` section 5.6
- PRD env vars: section 5.13.2 Gemini Provider table

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
