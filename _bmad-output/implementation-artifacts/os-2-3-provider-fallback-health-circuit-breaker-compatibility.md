# Story OS-2.3: Provider Fallback and Health Circuit Breaker Compatibility

Status: ready-for-dev

## Story

As a **Developer**,
I want `FallbackStrategyService` and `ProviderHealthService` updated to work generically with any `ICodingAgentProvider`,
so that the fallback loop and circuit breaker work correctly for Claude Code today and all future providers without modification.

## Acceptance Criteria

1. **Given** `FallbackStrategyService.executeWithFallbackCodingProvider()` is called with any `ICodingAgentProvider` implementation
   **When** the primary provider fails with a retryable error
   **Then** it falls back to the fallback provider, recording the attempt — with zero provider-specific logic inside the method

2. **Given** `FallbackStrategyService.executeWithFallbackCodingProvider()` is called and `allowFallback=false` or fallback is null
   **When** primary fails
   **Then** it returns the primary failure result without attempting fallback

3. **Given** `ProviderHealthService.isProviderEnabled()` is called with any `AIProvider` value (`CLAUDE_CODE`, `CURSOR_HEADLESS`, or future `GEMINI`, `CODEX`, `KIMI`)
   **When** the method reads config
   **Then** it derives the config key dynamically (e.g., `CLAUDE_CODE` → `ai.providers.claudeCode.enabled`) — no hardcoded if-else per provider

4. **Given** `ProviderHealthService.getMaxConcurrent()` is called with any `AIProvider` value
   **When** the method reads config
   **Then** it derives the config key dynamically — no hardcoded if-else per provider

5. **Given** `ProviderHealthService.getAvailableProvider()` and `checkAllProviders()` are called
   **When** they iterate providers
   **Then** they use `Object.values(AIProvider)` — no hardcoded `[CURSOR_HEADLESS, CLAUDE_CODE]` arrays

6. **Given** `OrchestratorService.trackExecution()` is called with a provider not in the initialized maps
   **When** tracking usage/timing for a new provider name
   **Then** it does not throw — lazy initialization ensures any AIProvider key is handled

7. **Given** unit tests for `FallbackStrategyService`, `ProviderHealthService`, and `OrchestratorService`
   **When** `pnpm test` is run
   **Then** all tests pass with zero failures and zero TypeScript/ESLint errors

## Tasks / Subtasks

- [ ] Task 1: Add `executeWithFallbackCodingProvider()` to `FallbackStrategyService` (AC: #1, #2)
  - [ ] Open `src/ai-routing/fallback-strategy.service.ts`
  - [ ] Add import: `import { ICodingAgentProvider } from './interfaces/coding-agent-provider.interface';`
  - [ ] Add import: `import { IAIExecutionPayload } from '@/execution/interfaces';`
  - [ ] Add new public method `executeWithFallbackCodingProvider(primary: ICodingAgentProvider, fallback: ICodingAgentProvider | null, payload: IAIExecutionPayload): Promise<IFallbackExecutionResult>` — see Dev Notes for full implementation
  - [ ] DO NOT modify the existing `executeWithFallback()` method — it remains the path for `CursorHeadlessProvider` (old DooD path)

- [ ] Task 2: Update `ProviderHealthService` for dynamic provider support (AC: #3, #4, #5)
  - [ ] Open `src/ai-routing/provider-health.service.ts`
  - [ ] Add private helper `providerConfigKey(provider: AIProvider): string` — see Dev Notes for regex implementation
  - [ ] Replace `isProviderEnabled()` if-else chain with dynamic config key lookup
  - [ ] Replace `getMaxConcurrent()` if-else chain with dynamic config key lookup
  - [ ] Replace `getAvailableProvider()` hardcoded array with `Object.values(AIProvider)`
  - [ ] Replace `checkAllProviders()` hardcoded array with `Object.values(AIProvider)`

- [ ] Task 3: Fix `OrchestratorService` metrics initialization for new providers (AC: #6)
  - [ ] Open `src/ai-routing/orchestrator.service.ts`
  - [ ] Change `providerUsage` initialization from `{ [AIProvider.CURSOR_HEADLESS]: 0, [AIProvider.CLAUDE_CODE]: 0 }` to `{} as Partial<Record<AIProvider, number>>`
  - [ ] Change `executionTimes` initialization from `{ [AIProvider.CURSOR_HEADLESS]: [], [AIProvider.CLAUDE_CODE]: [] }` to `{} as Partial<Record<AIProvider, number[]>>`
  - [ ] Update `trackExecution()`: replace `this.providerUsage[result.executedBy]++` with `this.providerUsage[result.executedBy] = (this.providerUsage[result.executedBy] ?? 0) + 1`
  - [ ] Update `trackExecution()`: guard `executionTimes` push: `if (!this.executionTimes[result.executedBy]) { this.executionTimes[result.executedBy] = []; }` before `.push()`
  - [ ] Update `calculateAvgExecutionTimes()` to not crash on new providers — see Dev Notes

- [ ] Task 4: Wire ICodingAgentProvider path through `FallbackStrategyService` in `OrchestratorService` (AC: #1)
  - [ ] Open `src/ai-routing/orchestrator.service.ts`
  - [ ] Locate the ICodingAgentProvider dispatch block added in OS-2.2 (search for `codingProvider?.isEnabled`)
  - [ ] Replace the direct `codingProvider.execute(payload)` call with the fallback-aware path using `this.fallbackStrategy.executeWithFallbackCodingProvider()` — see Dev Notes for the full block

- [ ] Task 5: Update `FallbackStrategyService` tests (AC: #7)
  - [ ] Open `src/ai-routing/fallback-strategy.service.spec.ts`
  - [ ] Add `describe('executeWithFallbackCodingProvider')` block with tests:
    - [ ] T-FS1: Primary ICodingAgentProvider succeeds → returns result, `usedFallback=false`, `fallbackAttempts=[]`
    - [ ] T-FS2: Primary fails with retryable error, fallback succeeds → `usedFallback=true`, `fallbackAttempts` has 1 entry with correct provider
    - [ ] T-FS3: Primary fails with **non-retryable** error (`error.isRetryable=false`) → no fallback called, returns primary failure
    - [ ] T-FS3b: Primary fails with **retryable** error (`error.isRetryable=true`) → fallback IS called (guards the `if (!isRetryable)` branch)
    - [ ] T-FS4: `allowFallback=false` in payload → no fallback called even if error is retryable
    - [ ] T-FS5: `fallback=null` → no fallback called even if error is retryable
    - [ ] T-FS6: Both primary and fallback fail → `fallbackAttempts` has 2 entries, `usedFallback=true`

- [ ] Task 6: Update `ProviderHealthService` tests (AC: #7)
  - [ ] Open `src/ai-routing/provider-health.service.spec.ts`
  - [ ] Remove `console.log` calls (stale debug logging from old tests)
  - [ ] Update existing test for `isProviderEnabled` to test the dynamic config key pattern
  - [ ] Add test: `isProviderEnabled` with `CLAUDE_CODE` reads `ai.providers.claudeCode.enabled`
  - [ ] Add test: `getMaxConcurrent` with `CURSOR_HEADLESS` reads `ai.providers.cursorHeadless.maxConcurrent`
  - [ ] Add test: `getAvailableProvider` iterates all `Object.values(AIProvider)`, not just two hardcoded ones — use `jest.spyOn(service as any, 'getProviderHealth')` to assert it was called for each value in `Object.values(AIProvider)`
  - [ ] Add test: `providerConfigKey` converts correctly: `CLAUDE_CODE` → `'claudeCode'`, `CURSOR_HEADLESS` → `'cursorHeadless'` — use `(service as any).providerConfigKey(AIProvider.CLAUDE_CODE)` pattern
  - [ ] Run `pnpm typecheck` and `pnpm lint` and fix all issues

## Dev Notes

### CRITICAL: Prerequisite — Story OS-2.2 Must Be Complete

OS-2.3 directly extends the ICodingAgentProvider dispatch block in `OrchestratorService` that is built in OS-2.2. Before starting Task 4, **grep or search for each item** to confirm it exists:

| Artifact                                       | Location                                               | Search term                   |
| ---------------------------------------------- | ------------------------------------------------------ | ----------------------------- |
| `IOrchestrationInput.projectId?`               | `src/ai-routing/interfaces/orchestration.interface.ts` | `projectId`                   |
| `IOrchestrationInput.complexityScore?`         | `src/ai-routing/interfaces/orchestration.interface.ts` | `complexityScore`             |
| `ProviderFactoryService.getCodingProvider()`   | `src/ai-routing/provider-factory.service.ts`           | `getCodingProvider`           |
| ICodingAgentProvider dispatch block            | `src/ai-routing/orchestrator.service.ts`               | `codingProvider?.isEnabled`   |
| `buildExecutionPayload()` private helper       | `src/ai-routing/orchestrator.service.ts`               | `buildExecutionPayload`       |
| `mapAIProviderToProviderName()` private helper | `src/ai-routing/orchestrator.service.ts`               | `mapAIProviderToProviderName` |

**If any of these are missing, implement the missing OS-2.2 pieces first before proceeding with OS-2.3.**

The ICodingAgentProvider dispatch block added in OS-2.2 Task 5 should look like:

```typescript
// In execute(), AFTER selectProvider() and BEFORE fallbackStrategy.executeWithFallback():
const providerName = this.mapAIProviderToProviderName(selection.primary);
const codingProvider = providerName
  ? this.providerFactory.getCodingProvider(providerName)
  : undefined;

if (codingProvider?.isEnabled) {
  const payload = this.buildExecutionPayload(input, selection.complexityScore);
  const execResult = await codingProvider.execute(payload); // ← OS-2.3 replaces this with fallback-aware version
  // ... return IOrchestrationResult
}
// Falls through to old executeWithFallback() path
```

If this block exists but calls `codingProvider.execute()` directly, that is the line OS-2.3 Task 4 replaces.

### DO NOT Recreate These — Already Exist from OS-2.1 and OS-2.2

- `src/ai-routing/interfaces/coding-agent-provider.interface.ts` — `ICodingAgentProvider` interface
- `src/ai-routing/enums/provider-name.enum.ts` — `ProviderName.CLAUDE_CODE`, `ProviderName.CURSOR_HEADLESS`
- `src/ai-routing/fallback-strategy.service.ts` — existing `executeWithFallback()` method (for old Cursor path)
- `IFallbackExecutionResult` in `fallback-strategy.service.ts` — reuse as return type for new method
- `IFallbackAttempt` in `src/ai-routing/interfaces/orchestration.interface.ts`

### Critical Type Note: ProviderName ↔ AIProvider Cast

`ProviderName` (from OS-2.1 enum) and `AIProvider` (from Prisma) have identical string values:

- `ProviderName.CLAUDE_CODE === 'CLAUDE_CODE' === AIProvider.CLAUDE_CODE`
- `ProviderName.CURSOR_HEADLESS === 'CURSOR_HEADLESS' === AIProvider.CURSOR_HEADLESS`

`IFallbackAttempt.provider` and `IFallbackExecutionResult.executedBy` are typed as `AIProvider`. When building these from `ICodingAgentProvider.providerName: ProviderName`, use:

```typescript
provider.providerName as unknown as AIProvider;
```

Do NOT change the `IFallbackAttempt` or `IFallbackExecutionResult` interfaces — they are used throughout the codebase.

### New Method: `executeWithFallbackCodingProvider()`

Add this method to `FallbackStrategyService` **after** the existing `executeWithFallback()` method. Do not touch the existing method.

```typescript
/**
 * Execute with fallback for ICodingAgentProvider implementations (FR-OS29)
 * No provider-specific logic — works with any ICodingAgentProvider.
 */
async executeWithFallbackCodingProvider(
  primary: ICodingAgentProvider,
  fallback: ICodingAgentProvider | null,
  payload: IAIExecutionPayload,
): Promise<IFallbackExecutionResult> {
  const fallbackAttempts: IFallbackAttempt[] = [];
  const startTime = Date.now();

  this.logger.log(`[${payload.executionId}] Executing with coding provider: ${primary.providerName}`);

  const primaryResult = await primary.execute(payload);

  if (primaryResult.success) {
    return {
      result: primaryResult,
      executedBy: primary.providerName as unknown as AIProvider,
      usedFallback: false,
      fallbackAttempts: [],
    };
  }

  if (payload.allowFallback === false || !fallback) {
    this.logger.warn(`[${payload.executionId}] Coding provider failed, no fallback available or allowed`);
    return {
      result: primaryResult,
      executedBy: primary.providerName as unknown as AIProvider,
      usedFallback: false,
      fallbackAttempts: [],
    };
  }

  const isRetryable = primaryResult.error?.isRetryable ?? true;

  if (!isRetryable) {
    this.logger.warn(`[${payload.executionId}] Coding provider failed with non-retryable error`);
    return {
      result: primaryResult,
      executedBy: primary.providerName as unknown as AIProvider,
      usedFallback: false,
      fallbackAttempts: [],
    };
  }

  fallbackAttempts.push({
    provider: primary.providerName as unknown as AIProvider,
    error: primaryResult.error?.message || 'Unknown error',
    wasRetryable: isRetryable,
    durationMs: primaryResult.durationMs,
    timestamp: new Date(),
  });

  this.fallbackCounter.inc({
    from_provider: primary.providerName,
    to_provider: fallback.providerName,
    reason: primaryResult.error?.code || 'UNKNOWN',
  });

  if (this.fallbackDelayMs > 0) {
    await this.delay(this.fallbackDelayMs);
  }

  this.logger.log(`[${payload.executionId}] Falling back to coding provider: ${fallback.providerName}`);

  const fallbackResult = await fallback.execute(payload);

  const totalDuration = (Date.now() - startTime) / 1000;
  this.fallbackDuration.observe(
    { from_provider: primary.providerName, to_provider: fallback.providerName },
    totalDuration,
  );

  if (fallbackResult.success) {
    this.fallbackSuccessCounter.inc({
      from_provider: primary.providerName,
      to_provider: fallback.providerName,
    });
    this.logger.log(`[${payload.executionId}] Fallback successful with ${fallback.providerName}`);
  } else {
    fallbackAttempts.push({
      provider: fallback.providerName as unknown as AIProvider,
      error: fallbackResult.error?.message || 'Unknown error',
      wasRetryable: fallbackResult.error?.isRetryable ?? false,
      durationMs: fallbackResult.durationMs,
      timestamp: new Date(),
    });
    this.logger.error(`[${payload.executionId}] Both coding providers failed - escalating to DLQ`);
  }

  return {
    result: fallbackResult,
    executedBy: fallback.providerName as unknown as AIProvider,
    usedFallback: true,
    fallbackAttempts,
  };
}
```

The `delay()` private method already exists in `FallbackStrategyService` — do not recreate it.

### ProviderHealthService — Dynamic Config Key Pattern

Replace the hardcoded if-else checks in `isProviderEnabled()` and `getMaxConcurrent()` with a shared private helper:

```typescript
/**
 * Convert AIProvider SCREAMING_SNAKE_CASE to camelCase config key segment.
 * CLAUDE_CODE → claudeCode, CURSOR_HEADLESS → cursorHeadless, GEMINI → gemini
 */
private providerConfigKey(provider: AIProvider): string {
  return String(provider)
    .toLowerCase()
    .replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
}

private isProviderEnabled(provider: AIProvider): boolean {
  const configKey = this.providerConfigKey(provider);
  return this.configService.get<boolean>(`ai.providers.${configKey}.enabled`, false);
}

private getMaxConcurrent(provider: AIProvider): number {
  const configKey = this.providerConfigKey(provider);
  return this.configService.get<number>(`ai.providers.${configKey}.maxConcurrent`, 3);
}
```

Replace the hardcoded arrays in `getAvailableProvider()` and `checkAllProviders()`:

```typescript
async getAvailableProvider(
  preferredProvider?: AIProvider,
): Promise<{ provider: AIProvider; health: IProviderHealth } | null> {
  if (preferredProvider) {
    const health = await this.getProviderHealth(preferredProvider);
    if (health.isHealthy) return { provider: preferredProvider, health };
  }

  for (const provider of Object.values(AIProvider)) {
    if (provider === preferredProvider) continue;
    const health = await this.getProviderHealth(provider);
    if (health.isHealthy) return { provider, health };
  }

  return null;
}

private async checkAllProviders(): Promise<void> {
  for (const provider of Object.values(AIProvider)) {
    try {
      await this.getProviderHealth(provider);
    } catch (_error) {
      this.logger.error(`Failed to check provider ${provider}:`, _error);
    }
  }
}
```

### OrchestratorService — Lazy Provider Maps

Change the two hardcoded initialized maps to empty lazy maps:

```typescript
// BEFORE (breaks with new providers):
private providerUsage: Record<AIProvider, number> = {
  [AIProvider.CURSOR_HEADLESS]: 0,
  [AIProvider.CLAUDE_CODE]: 0,
};
private executionTimes: Record<AIProvider, number[]> = {
  [AIProvider.CURSOR_HEADLESS]: [],
  [AIProvider.CLAUDE_CODE]: [],
};

// AFTER (works with any AIProvider value):
private providerUsage: Partial<Record<AIProvider, number>> = {};
private executionTimes: Partial<Record<AIProvider, number[]>> = {};
```

Update `trackExecution()` for safe lazy initialization:

```typescript
this.providerUsage[result.executedBy] = (this.providerUsage[result.executedBy] ?? 0) + 1;

if (!this.executionTimes[result.executedBy]) {
  this.executionTimes[result.executedBy] = [];
}
this.executionTimes[result.executedBy]!.push(result.result.durationMs);

if (this.executionTimes[result.executedBy]!.length > 100) {
  this.executionTimes[result.executedBy]!.shift();
}
```

Update `calculateAvgExecutionTimes()` to handle the `Partial` type and return all active providers (not just the two hardcoded ones):

```typescript
/**
 * Calculate average execution times for all providers with recorded data.
 * Uses Object.entries() on the Partial map — only includes providers that have run.
 * The final cast to Record<AIProvider, number> is safe: the map keys are always
 * valid AIProvider string values written by trackExecution().
 */
private calculateAvgExecutionTimes(): Record<AIProvider, number> {
  const result: Record<string, number> = {};
  for (const [provider, times] of Object.entries(this.executionTimes)) {
    const t = times ?? [];
    result[provider] = t.length > 0
      ? t.reduce((a, b) => a + b, 0) / t.length
      : 60_000; // default fallback estimate
  }
  return result as Record<AIProvider, number>;
}
```

Note: `getMetrics()` returns `IOrchestrationMetrics` which has `providerUsage: Record<AIProvider, number>` and `avgExecutionTimeMs: Record<AIProvider, number>`. The cast is safe since by runtime the map only contains valid `AIProvider` string values that were set by `trackExecution()`. If `providerUsage` or `avgExecutionTimeMs` are ever read as a `Partial<Record<...>>` in calling code, update `IOrchestrationMetrics` accordingly — that is out of scope for OS-2.3.

### OrchestratorService — Wire ICodingAgentProvider Path Through FallbackStrategyService

In `OrchestratorService.execute()`, locate the block added in OS-2.2 that checks `codingProvider?.isEnabled`. **Replace the direct `codingProvider.execute(payload)` call** with the fallback-aware version:

```typescript
if (codingProvider?.isEnabled) {
  const payload = this.buildExecutionPayload(input, selection.complexityScore);

  // Resolve fallback ICodingAgentProvider if available (FR-OS29)
  const fallbackProviderName = selection.fallback
    ? this.mapAIProviderToProviderName(selection.fallback)
    : undefined;
  const fallbackCodingProvider = fallbackProviderName
    ? (this.providerFactory.getCodingProvider(fallbackProviderName) ?? null)
    : null;
  // Only use fallback if it's both registered AND enabled
  const enabledFallback = fallbackCodingProvider?.isEnabled ? fallbackCodingProvider : null;

  // Use FallbackStrategyService for unified fallback behavior (OS-2.3)
  const fallbackResult = await this.fallbackStrategy.executeWithFallbackCodingProvider(
    codingProvider,
    enabledFallback,
    payload,
  );

  const totalDurationMs = Date.now() - startTime;
  this.trackExecution(fallbackResult, totalDurationMs);

  return {
    success: fallbackResult.result.success,
    executedBy: fallbackResult.executedBy,
    usedFallback: fallbackResult.usedFallback,
    codeDiff: fallbackResult.result.codeDiff,
    filesChanged: fallbackResult.result.filesChanged,
    confidenceScore: fallbackResult.result.confidenceScore,
    durationMs: fallbackResult.result.durationMs,
    totalDurationMs,
    workspacePath: fallbackResult.result.workspacePath,
    fallbackAttempts: fallbackResult.fallbackAttempts,
    estimatedCostCents: this.estimateCost(fallbackResult.executedBy, totalDurationMs),
    error: fallbackResult.result.error,
    tokensInput: fallbackResult.result.tokensInput,
    tokensOutput: fallbackResult.result.tokensOutput,
  };
}
// Falls through to old FallbackStrategyService.executeWithFallback() path for CURSOR_HEADLESS
```

### Test Patterns for FallbackStrategyService

Use mock ICodingAgentProvider instances with `jest.fn()`. The mocks need `providerName`, `isEnabled`, `isHealthy()`, and `execute()`:

```typescript
const mockPrimaryProvider: jest.Mocked<ICodingAgentProvider> = {
  providerName: ProviderName.CLAUDE_CODE,
  isEnabled: true,
  isHealthy: jest.fn().mockResolvedValue(true),
  execute: jest.fn(),
};

const mockFallbackProvider: jest.Mocked<ICodingAgentProvider> = {
  providerName: ProviderName.CURSOR_HEADLESS,
  isEnabled: true,
  isHealthy: jest.fn().mockResolvedValue(true),
  execute: jest.fn(),
};

const basePayload: IAIExecutionPayload = {
  executionId: 'exec-123',
  ticketId: 'ticket-456',
  aiProvider: AIProvider.CLAUDE_CODE,
  priority: 1,
  prompt: 'Test prompt',
  repositoryUrl: 'https://github.com/test/repo.git',
  projectId: 'proj-789',
  allowFallback: true,
};
```

Import `IAIExecutionPayload` from `@/execution/interfaces` and `ProviderName` from `@/ai-routing/enums/provider-name.enum`.

### Project Structure Notes

Files to modify:

- `src/ai-routing/fallback-strategy.service.ts` — add `executeWithFallbackCodingProvider()`
- `src/ai-routing/fallback-strategy.service.spec.ts` — add T-FS1 through T-FS6
- `src/ai-routing/provider-health.service.ts` — remove hardcoded arrays/checks
- `src/ai-routing/provider-health.service.spec.ts` — update tests for dynamic config
- `src/ai-routing/orchestrator.service.ts` — fix maps + wire ICodingAgentProvider fallback path

Files to NOT touch:

- `src/ai-routing/interfaces/orchestration.interface.ts` — IFallbackAttempt stays as-is
- `src/ai-routing/fallback-strategy.service.ts` existing `executeWithFallback()` — do not modify
- `src/ai-routing/interfaces/ai-provider.interface.ts` — no changes needed
- `src/sandbox/sandbox.service.ts` — not touched in OS-2.3

### References

- FR-OS29: FallbackStrategyService must work with any ICodingAgentProvider [Source: _bmad-output/planning-artifacts/epics.md#Story OS-2.3]
- FR-OS30: ProviderHealthService circuit breaker must work with all new provider names [Source: _bmad-output/planning-artifacts/epics.md#FR Coverage Map]
- ICodingAgentProvider interface: `src/ai-routing/interfaces/coding-agent-provider.interface.ts`
- IFallbackExecutionResult: `src/ai-routing/fallback-strategy.service.ts:27`
- IFallbackAttempt: `src/ai-routing/interfaces/orchestration.interface.ts:109`
- ProviderName enum: `src/ai-routing/enums/provider-name.enum.ts`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
