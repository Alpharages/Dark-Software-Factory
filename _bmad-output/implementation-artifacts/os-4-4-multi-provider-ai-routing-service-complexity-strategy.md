# Story OS-4.4: Multi-Provider AIRoutingService with Complexity-Based Strategy

Status: ready-for-dev

## Story

As a **PM / Manager**,
I want `AIRoutingService` updated to route tickets across all four providers based on complexity score and feature flags,
So that simple tickets go to the fastest/cheapest provider and complex tickets go to the most capable one — automatically.

## Acceptance Criteria

1. **Given** `AIRoutingService` routes a ticket with complexity score < `MEDIUM_COMPLEXITY_THRESHOLD` (default 5) and `KIMI_ENABLED=true`
   **When** `routeTicket()` runs
   **Then** `KIMI` is selected as `preferredProvider` passed to `ProviderHealthService.getAvailableProvider()`, with `CLAUDE_CODE` as fallback if KIMI is unhealthy

2. **Given** complexity score >= `MEDIUM_COMPLEXITY_THRESHOLD` (5) and < `HIGH_COMPLEXITY_THRESHOLD` (10)
   **When** `routeTicket()` runs
   **Then** `CLAUDE_CODE` is selected as primary; if CLAUDE_CODE is unhealthy, GEMINI is next (if enabled)

3. **Given** complexity score >= `HIGH_COMPLEXITY_THRESHOLD` (10)
   **When** `routeTicket()` runs
   **Then** `CLAUDE_CODE` is selected as primary; if CLAUDE_CODE is unhealthy, CODEX is next (if enabled)

4. **Given** `AI_PRIMARY_PROVIDER=GEMINI` is set in environment
   **When** routing any ticket regardless of complexity score
   **Then** `GEMINI` is selected as primary (override mode, bypasses complexity routing)

5. **Given** a provider has `isEnabled=false` or `isHealthy()=false`
   **When** `AIRoutingService` selects providers
   **Then** that provider is skipped by `ProviderHealthService` and the next eligible provider is used

6. **Given** `ProviderFactoryService` is updated with all four providers
   **When** `selectByComplexityAndAvailability()` runs
   **Then** it implements the same complexity-tier routing logic (low→KIMI, medium→CLAUDE_CODE+GEMINI, high→CLAUDE_CODE+CODEX)

7. **Given** all four providers are registered in `ProviderFactoryService`'s `codingProviders` Map
   **When** `getCodingProvider(name)` is called for GEMINI/CODEX/KIMI
   **Then** the correct provider instance is returned (prerequisite: OS-4.2 and OS-4.3 complete)

8. **Given** `OrchestratorService` is the direct sandbox execution path
   **When** `selectProvider()` returns `AIProvider.KIMI` (or GEMINI/CODEX) as primary
   **Then** `mapAIProviderToProviderName()` resolves to the correct `ProviderName` and `getCodingProvider()` returns the registered instance (not undefined)

9. **Given** `pnpm typecheck` and `pnpm test` are run after all changes
   **Then** zero TypeScript errors and zero test failures

## Tasks / Subtasks

- [ ] Task 1: Add `AI_PRIMARY_PROVIDER` env var to config (AC: #4)
  - [ ] In `src/config/env.validation.ts`, after the existing AI provider flags block (after line 52), add:
    ```typescript
    AI_PRIMARY_PROVIDER: Joi.string()
      .valid('CLAUDE_CODE', 'GEMINI', 'CODEX', 'KIMI')
      .optional()
      .allow('')
      .default('')
      .description('Override: force all tickets to this provider regardless of complexity'),
    ```
  - [ ] In `src/config/configuration.ts`, inside the `ai.routing` object (lines 51-55), add:
    ```typescript
    primaryProvider: process.env.AI_PRIMARY_PROVIDER || '',
    ```
  - [ ] Result: `ai.routing.primaryProvider` config key, default `''` (no override)

- [ ] Task 2: Update `AIRoutingService.routeTicket()` for complexity-based routing (AC: #1, #2, #3, #4, #5)
  - [ ] Open `src/ai-routing/ai-routing.service.ts`
  - [ ] Replace the entire "Determine preferred provider" block (the one that has the `// Simplified for OS-4.1` comment) with the new routing logic:

    ```typescript
    // At least CLAUDE_CODE must be enabled as the guaranteed fallback
    const claudeEnabled = this.configService.get<boolean>('ai.providers.claudeCode.enabled', false);
    if (!claudeEnabled) {
      this.logger.error(
        `[${correlationId}] CRITICAL: CLAUDE_CODE provider is not enabled. ` +
          `Set CLAUDE_CODE_ENABLED=true in .env`,
      );
      throw new Error('No AI providers enabled in configuration');
    }

    // OS-4.4: Complexity-based routing strategy
    // Thresholds align with ProviderFactoryService (orchestrator.complexityThresholdMedium/High)
    const mediumThreshold = this.configService.get<number>(
      'orchestrator.complexityThresholdMedium',
      5,
    );
    const highThreshold = this.configService.get<number>(
      'orchestrator.complexityThresholdHigh',
      10,
    );
    const kimiEnabled = this.configService.get<boolean>('ai.providers.kimi.enabled', false);

    // Override mode: AI_PRIMARY_PROVIDER env var forces a specific provider
    const primaryOverride = this.configService.get<string>('ai.routing.primaryProvider', '');
    let preferredProvider: AIProvider;

    if (primaryOverride) {
      // Platform override — bypasses complexity routing entirely
      preferredProvider = primaryOverride as AIProvider;
      this.logger.log(`[${correlationId}] Override: AI_PRIMARY_PROVIDER=${primaryOverride}`);
    } else if (complexityScore < mediumThreshold && kimiEnabled) {
      // Low complexity: Kimi is fastest/cheapest; CLAUDE_CODE is the ProviderHealth fallback
      preferredProvider = AIProvider.KIMI;
    } else {
      // Medium/high complexity: Claude Code primary; GEMINI/CODEX fallbacks handled by ProviderHealthService
      preferredProvider = AIProvider.CLAUDE_CODE;
    }

    const tier =
      complexityScore < mediumThreshold
        ? 'low'
        : complexityScore >= highThreshold
          ? 'high'
          : 'medium';
    this.logger.log(
      `[${correlationId}] Complexity tier=${tier} (score=${complexityScore}): preferredProvider=${preferredProvider}`,
    );
    ```

  - [ ] Update `handleNoProviderAvailable()` to iterate all 4 providers instead of just `[AIProvider.CLAUDE_CODE]`:
    ```typescript
    for (const provider of [
      AIProvider.CLAUDE_CODE,
      AIProvider.GEMINI,
      AIProvider.CODEX,
      AIProvider.KIMI,
    ]) {
      if (this.providerHealth.shouldAlert(provider)) {
        this.logger.error(
          `[${correlationId}] ALERT: Provider ${provider} unavailable for extended period`,
        );
      }
    }
    ```
  - [ ] Update `determineRoutingReason()` to return proper tier reasons:
    ```typescript
    private determineRoutingReason(complexityScore: number, fallbackUsed: boolean): RoutingReason {
      if (fallbackUsed) return RoutingReason.PRIMARY_UNAVAILABLE;
      if (complexityScore >= this.configService.get<number>('orchestrator.complexityThresholdHigh', 10)) {
        return RoutingReason.COMPLEXITY_HIGH;
      }
      return RoutingReason.COMPLEXITY_LOW;
    }
    ```
  - [ ] **IMPORTANT**: No changes to lock acquisition, execution creation, or queue publishing logic — only the `preferredProvider` selection block changes

- [ ] Task 3: Update `ProviderFactoryService` constructor and Map (AC: #6, #7)
  - [ ] Open `src/ai-routing/provider-factory.service.ts`
  - [ ] Import `GeminiProvider`, `CodexProvider`, `KimiProvider` from `./providers`:
    ```typescript
    import { ClaudeCodeProvider } from './providers/claude-code.provider';
    import { GeminiProvider } from './providers/gemini.provider';
    import { CodexProvider } from './providers/codex.provider';
    import { KimiProvider } from './providers/kimi.provider';
    ```
  - [ ] Add the three new providers as the last constructor parameters (after `claudeCodeProvider`):
    ```typescript
    private readonly claudeCodeProvider: ClaudeCodeProvider,
    private readonly geminiProvider: GeminiProvider,
    private readonly codexProvider: CodexProvider,
    private readonly kimiProvider: KimiProvider,
    ```
  - [ ] Update `this.codingProviders` Map in the constructor body:
    ```typescript
    this.codingProviders = new Map<ProviderName, ICodingAgentProvider>([
      [ProviderName.CLAUDE_CODE, claudeCodeProvider],
      [ProviderName.GEMINI, geminiProvider],
      [ProviderName.CODEX, codexProvider],
      [ProviderName.KIMI, kimiProvider],
    ]);
    ```

- [ ] Task 4: Update `ProviderFactoryService.selectProvider()` to honour `AI_PRIMARY_PROVIDER` config (AC: #4, #6)
  - [ ] Open `src/ai-routing/provider-factory.service.ts`, find the `selectProvider()` method
  - [ ] After the existing `if (providerOverride)` block (which handles input-level overrides), add a config-level override check:
    ```typescript
    // Config-level override: AI_PRIMARY_PROVIDER env var (applies when no input providerOverride)
    if (!providerOverride) {
      const configOverride = this.config.get<string>('ai.routing.primaryProvider', '');
      if (configOverride) {
        this.logger.log(
          `[${correlationId}] Config override: AI_PRIMARY_PROVIDER=${configOverride}`,
        );
        this.selectionsCounter.inc({
          reason: ProviderSelectionReason.OVERRIDE,
          provider: configOverride,
        });
        return {
          primary: configOverride as AIProvider,
          fallback: this.getFallbackFor(configOverride as AIProvider),
          reason: ProviderSelectionReason.OVERRIDE,
          complexityScore: preCalculatedComplexity ?? 0,
          complexityGrade: ComplexityGrade.MEDIUM,
        };
      }
    }
    ```
  - [ ] Insert this block **between** the `providerOverride` block and the complexity calculation block — order matters

- [ ] Task 5: Update `ProviderFactoryService.selectByComplexityAndAvailability()` (AC: #6)
  - [ ] Replace the entire method body with:

    ```typescript
    private selectByComplexityAndAvailability(
      correlationId: string,
      score: number,
      grade: ComplexityGrade,
      claudeAvailable: boolean,
    ): IProviderSelection {
      const claudeEnabled = this.config.get<boolean>('ai.providers.claudeCode.enabled', false);
      const geminiEnabled = this.config.get<boolean>('ai.providers.gemini.enabled', false);
      const codexEnabled = this.config.get<boolean>('ai.providers.codex.enabled', false);
      const kimiEnabled = this.config.get<boolean>('ai.providers.kimi.enabled', false);

      if (!claudeEnabled) {
        this.logger.error(`[${correlationId}] No providers ENABLED in configuration!`);
        throw new Error('No AI providers enabled. Set CLAUDE_CODE_ENABLED=true');
      }

      // Low complexity: prefer Kimi (fast/cheap) with Claude Code as fallback
      if (grade === ComplexityGrade.LOW && kimiEnabled) {
        return {
          primary: AIProvider.KIMI,
          fallback: AIProvider.CLAUDE_CODE,
          reason: ProviderSelectionReason.COMPLEXITY,
          complexityScore: score,
          complexityGrade: grade,
        };
      }

      // High complexity: Claude Code with Codex fallback
      if (grade === ComplexityGrade.HIGH && codexEnabled) {
        return {
          primary: AIProvider.CLAUDE_CODE,
          fallback: AIProvider.CODEX,
          reason: ProviderSelectionReason.COMPLEXITY,
          complexityScore: score,
          complexityGrade: grade,
        };
      }

      // Medium complexity (or Kimi/Codex not enabled): Claude Code with Gemini fallback
      return {
        primary: AIProvider.CLAUDE_CODE,
        fallback: geminiEnabled ? AIProvider.GEMINI : null,
        reason: claudeAvailable ? ProviderSelectionReason.COMPLEXITY : ProviderSelectionReason.AVAILABILITY,
        complexityScore: score,
        complexityGrade: grade,
      };
    }
    ```

- [ ] Task 6: Update `ProviderFactoryService.getFallbackFor()` (AC: #6)
  - [ ] Replace the stub with:
    ```typescript
    private getFallbackFor(provider: AIProvider): AIProvider | null {
      const geminiEnabled = this.config.get<boolean>('ai.providers.gemini.enabled', false);
      const codexEnabled = this.config.get<boolean>('ai.providers.codex.enabled', false);
      switch (provider) {
        case AIProvider.KIMI:
          return AIProvider.CLAUDE_CODE;
        case AIProvider.CLAUDE_CODE:
          return geminiEnabled ? AIProvider.GEMINI : null;
        case AIProvider.GEMINI:
          return AIProvider.CLAUDE_CODE;
        case AIProvider.CODEX:
          return codexEnabled ? AIProvider.CLAUDE_CODE : null;
        default:
          return null;
      }
    }
    ```

- [ ] Task 7: Update `ProviderFactoryService.getAllProvidersAvailability()` (AC: #7)
  - [ ] Update the `providers` array to include all four:
    ```typescript
    const providers = [
      AIProvider.CLAUDE_CODE,
      AIProvider.GEMINI,
      AIProvider.CODEX,
      AIProvider.KIMI,
    ];
    ```

- [ ] Task 8: Fix `OrchestratorService.mapAIProviderToProviderName()` to include all 4 providers (AC: #6, #7)
  - [ ] Open `src/ai-routing/orchestrator.service.ts`
  - [ ] Find `mapAIProviderToProviderName()` at line ~63. Currently it only maps `CLAUDE_CODE`:
    ```typescript
    // BEFORE (broken — GEMINI/CODEX/KIMI all return undefined → "No suitable provider" error)
    const map: Partial<Record<string, ProviderName>> = {
      [AIProvider.CLAUDE_CODE]: ProviderName.CLAUDE_CODE,
    };
    ```
  - [ ] Replace the map with all four entries:
    ```typescript
    const map: Partial<Record<string, ProviderName>> = {
      [AIProvider.CLAUDE_CODE]: ProviderName.CLAUDE_CODE,
      [AIProvider.GEMINI]: ProviderName.GEMINI,
      [AIProvider.CODEX]: ProviderName.CODEX,
      [AIProvider.KIMI]: ProviderName.KIMI,
    };
    ```
  - [ ] Also fix `buildExecutionPayload()` at line ~79: replace the hardcoded `AIProvider.CLAUDE_CODE` fallback with the actual selection:

    ```typescript
    // BEFORE (broken — always uses CLAUDE_CODE even when KIMI was selected)
    aiProvider: (input.providerOverride as AIProvider) ?? AIProvider.CLAUDE_CODE,

    // AFTER — caller must pass selection.primary explicitly via providerOverride, OR
    // this method signature needs the selection. Simplest fix: use the resolved provider
    // from selection.primary that OrchestratorService.execute() already has in scope.
    ```

    **Practical fix:** In `OrchestratorService.execute()`, when calling `buildExecutionPayload(input, selection.complexityScore)`, pass `selection.primary` as the provider. Update the method call and signature:

    ```typescript
    // In execute(), change the buildExecutionPayload call to:
    const payload = this.buildExecutionPayload(input, selection.complexityScore, selection.primary);

    // Update buildExecutionPayload signature:
    private buildExecutionPayload(
      input: IOrchestrationInput,
      complexityScore: number,
      resolvedProvider: AIProvider,   // ← add this
    ): IAIExecutionPayload {
      return {
        ...
        aiProvider: resolvedProvider,   // ← use this instead of (input.providerOverride ?? CLAUDE_CODE)
        ...
      };
    }
    ```

  - [ ] Add `OrchestratorService` to the file list in the story footer

- [ ] Task 9: Register new providers in `AIRoutingModule` (AC: #7, #8)
  - [ ] **First, check if OS-4.2/OS-4.3 already registered them** (they should have):
    ```bash
    grep -n "GeminiProvider\|CodexProvider\|KimiProvider" src/ai-routing/ai-routing.module.ts
    ```
  - [ ] **If the grep returns results** — the providers are already registered. Skip this task entirely.
  - [ ] **If grep returns nothing** — open `src/ai-routing/ai-routing.module.ts` and add imports + registrations:
    ```typescript
    import { GeminiProvider } from './providers/gemini.provider';
    import { CodexProvider } from './providers/codex.provider';
    import { KimiProvider } from './providers/kimi.provider';
    ```
    Add to `providers: [...]` array (after ClaudeCodeProvider):
    ```typescript
    GeminiProvider,   // OS-4.2
    CodexProvider,    // OS-4.3
    KimiProvider,     // OS-4.3
    ```
    Add identically to `exports: [...]`
  - [ ] **Do NOT add SandboxModule to imports** — it is `@Global()` already available

- [ ] Task 10: Update `ai-routing.service.spec.ts` for complexity routing (AC: #8)
  - [ ] Open `src/ai-routing/ai-routing.service.spec.ts`
  - [ ] Update `mockConfigService.get` to return values for the new config keys:
    ```typescript
    if (key === 'ai.providers.claudeCode.enabled') return true;
    if (key === 'ai.providers.gemini.enabled') return geminiEnabled; // parameterize per test
    if (key === 'ai.providers.kimi.enabled') return kimiEnabled;
    if (key === 'ai.providers.codex.enabled') return codexEnabled;
    if (key === 'ai.routing.primaryProvider') return '';
    if (key === 'orchestrator.complexityThresholdMedium') return 5;
    if (key === 'orchestrator.complexityThresholdHigh') return 10;
    return defaultValue;
    ```
  - [ ] **Add test cases** for new routing behavior:
    - Low complexity (score=3) + `KIMI_ENABLED=true` → `preferredProvider = KIMI` → `providerHealth.getAvailableProvider` called with `AIProvider.KIMI`
    - Low complexity (score=3) + `KIMI_ENABLED=false` → falls back to CLAUDE_CODE path
    - Medium complexity (score=6) → `providerHealth.getAvailableProvider` called with `AIProvider.CLAUDE_CODE`
    - High complexity (score=12) → `providerHealth.getAvailableProvider` called with `AIProvider.CLAUDE_CODE`
    - `AI_PRIMARY_PROVIDER=GEMINI` override → `providerHealth.getAvailableProvider` called with `AIProvider.GEMINI` regardless of score
  - [ ] Existing tests for lock conflicts, no-provider, and audit log remain unchanged — only re-check what `preferredProvider` is passed to `getAvailableProvider`

- [ ] Task 11: Update `provider-factory.service.spec.ts` for new providers and routing (AC: #8)
  - [ ] Open `src/ai-routing/provider-factory.service.spec.ts`
  - [ ] Import `GeminiProvider`, `CodexProvider`, `KimiProvider`
  - [ ] Add mock providers to the module setup (after ClaudeCodeProvider mock):
    ```typescript
    {
      provide: GeminiProvider,
      useValue: { providerName: ProviderName.GEMINI, isEnabled: false, isHealthy: jest.fn().mockResolvedValue(false), execute: jest.fn() },
    },
    {
      provide: CodexProvider,
      useValue: { providerName: ProviderName.CODEX, isEnabled: false, isHealthy: jest.fn().mockResolvedValue(false), execute: jest.fn() },
    },
    {
      provide: KimiProvider,
      useValue: { providerName: ProviderName.KIMI, isEnabled: false, isHealthy: jest.fn().mockResolvedValue(false), execute: jest.fn() },
    },
    ```
  - [ ] Update `mockConfig.get` to return all provider flags:
    ```typescript
    if (key === 'ai.providers.claudeCode.enabled') return true;
    if (key === 'ai.providers.gemini.enabled') return false;
    if (key === 'ai.providers.codex.enabled') return false;
    if (key === 'ai.providers.kimi.enabled') return false;
    return defaultValue;
    ```
  - [ ] **Add test cases** for `selectByComplexityAndAvailability` routing tiers:
    - LOW grade + kimiEnabled=true → primary=KIMI, fallback=CLAUDE_CODE, reason=COMPLEXITY
    - LOW grade + kimiEnabled=false → primary=CLAUDE_CODE, fallback=GEMINI-if-enabled (else null)
    - MEDIUM grade → primary=CLAUDE_CODE, fallback=GEMINI (if enabled)
    - HIGH grade + codexEnabled=true → primary=CLAUDE_CODE, fallback=CODEX
    - HIGH grade + codexEnabled=false → primary=CLAUDE_CODE, fallback=GEMINI-or-null
  - [ ] **Add test cases** for `getFallbackFor()`:
    - KIMI → CLAUDE_CODE
    - CLAUDE_CODE → GEMINI (if enabled)
    - GEMINI → CLAUDE_CODE
  - [ ] **Add test cases** for `getAllProvidersAvailability()` returns 4 entries
  - [ ] **Add test case** for `getCodingProvider(ProviderName.GEMINI)` returns GeminiProvider instance
  - [ ] Existing `selectProvider` override and SINGLE_PROVIDER tests remain valid — verify they pass

- [ ] Task 12: Final verification (AC: #8, #9)
  - [ ] `pnpm typecheck` → zero errors
  - [ ] `pnpm test src/ai-routing/ai-routing.service.spec.ts` → all pass
  - [ ] `pnpm test src/ai-routing/provider-factory.service.spec.ts` → all pass
  - [ ] `pnpm test` → zero failures across all tests

## Dev Notes

### Prerequisite Checks — OS-4.1, OS-4.2, OS-4.3 Must Be Complete

Before starting, verify:

```bash
# OS-4.1: CURSOR_HEADLESS fully removed
grep -r "CURSOR_HEADLESS" src/ --include="*.ts"   # → 0 results

# OS-4.2: GeminiProvider exists
ls src/ai-routing/providers/gemini.provider.ts     # → file exists

# OS-4.3: Codex and Kimi providers exist
ls src/ai-routing/providers/codex.provider.ts      # → file exists
ls src/ai-routing/providers/kimi.provider.ts       # → file exists

# Prisma: All 4 AIProvider enum values exist (already in schema.prisma)
grep -A6 "enum AIProvider" prisma/schema.prisma
# → CLAUDE_CODE, GEMINI, CODEX, KIMI
```

If OS-4.2/4.3 story files are not implemented yet, implement them first. `ProviderFactoryService` DI will fail if those provider classes don't exist.

### Complexity Score Scale — Important Clarification

The epic AC writes "complexity score 0–3", "4–7", "8–10" as if the range is 0–10. **The actual implementation uses 0–20** (5 factors × max 4 points each; see `IComplexityBreakdown` in `src/ai-routing/interfaces/ai-routing.interface.ts`).

The routing thresholds to use are from config:

- `orchestrator.complexityThresholdMedium` (default **5**) — LOW/MEDIUM boundary
- `orchestrator.complexityThresholdHigh` (default **10**) — MEDIUM/HIGH boundary

These match what `ProviderFactoryService` already uses for `getComplexityGrade()`. Do **not** hardcode 5/10 — always read from `ConfigService`.

### `ProviderHealthService.getAvailableProvider()` — Built-in Fallback

`ProviderHealthService.getAvailableProvider(preferredProvider?)` at `src/ai-routing/provider-health.service.ts:122` already implements "try preferred, then fall through all enabled providers in `Object.values(AIProvider)` order". This means:

- Pass `AIProvider.KIMI` as preferred for low complexity: if KIMI is unhealthy/disabled, it automatically tries CLAUDE_CODE, GEMINI, CODEX in enum order
- Pass `AIProvider.CLAUDE_CODE` as preferred for medium: if Claude is unhealthy, it tries GEMINI, CODEX, KIMI

You do **not** need to wire an explicit fallback chain in `AIRoutingService`. The health service handles it. Just pass the right `preferredProvider`.

### Two Independent Routing Paths

There are **two separate routing flows** in the codebase, and both need updating:

| Service                  | Method             | Used by                         | Context                                                                                       |
| ------------------------ | ------------------ | ------------------------------- | --------------------------------------------------------------------------------------------- |
| `AIRoutingService`       | `routeTicket()`    | Ticket intake queue consumer    | Full execution pipeline: creates DB execution record, acquires file locks, publishes to queue |
| `ProviderFactoryService` | `selectProvider()` | `OrchestratorService.execute()` | Direct sandbox execution path; uses `AIExecutionService.isProviderAvailable()` for health     |

Both must implement the same routing strategy so behavior is consistent regardless of which path a ticket takes.

### `OrchestratorService.mapAIProviderToProviderName()` — CURRENTLY BROKEN FOR GEMINI/CODEX/KIMI

This is a **silent execution blocker**. At `src/ai-routing/orchestrator.service.ts:63`, the method only maps `CLAUDE_CODE`:

```typescript
// Current — ALL other providers return undefined
const map = { [AIProvider.CLAUDE_CODE]: ProviderName.CLAUDE_CODE };
return map[provider]; // → undefined for GEMINI, CODEX, KIMI
```

When `selectProvider()` returns `AIProvider.KIMI` as primary, `OrchestratorService.execute()` calls `mapAIProviderToProviderName(KIMI)` → `undefined` → `getCodingProvider(undefined)` → `undefined` → falls to the `else` branch → `return { success: false, error: 'No suitable provider found or enabled' }`. **Every KIMI-routed ticket silently fails.**

Task 8 fixes this. Do NOT skip it.

### `AI_PRIMARY_PROVIDER` Override Semantics

When set, `AI_PRIMARY_PROVIDER` bypasses complexity scoring entirely and forces a specific provider. This is intended for:

- Testing a new provider in production before full rollout
- Emergency fallback when one provider is degraded
- Platform engineering overrides

The `ProviderHealthService` override path already exists via `providerOverride` in `ProviderFactoryService.selectProvider()` — but that uses `ProviderSelectionReason.OVERRIDE`. The new `AI_PRIMARY_PROVIDER` uses the same semantics.

In `AIRoutingService`, implement the override as a simple config check before the complexity tiers. If the override provider isn't enabled/healthy, `ProviderHealthService.getAvailableProvider()` will fall back naturally.

### `ProviderFactoryService` Constructor Injection — Current vs Target State

**Current state** (post OS-4.1, pre OS-4.4):

```typescript
constructor(
  ...
  private readonly claudeCodeProvider: ClaudeCodeProvider,  // ← only one
) {
  this.codingProviders = new Map([
    [ProviderName.CLAUDE_CODE, claudeCodeProvider],
  ]);
}
```

**Target state** (post OS-4.3 + OS-4.4):

```typescript
constructor(
  ...
  private readonly claudeCodeProvider: ClaudeCodeProvider,
  private readonly geminiProvider: GeminiProvider,   // OS-4.2
  private readonly codexProvider: CodexProvider,     // OS-4.3
  private readonly kimiProvider: KimiProvider,       // OS-4.3
) {
  this.codingProviders = new Map([
    [ProviderName.CLAUDE_CODE, claudeCodeProvider],
    [ProviderName.GEMINI, geminiProvider],
    [ProviderName.CODEX, codexProvider],
    [ProviderName.KIMI, kimiProvider],
  ]);
}
```

OS-4.2 and OS-4.3 may have already added GeminiProvider/CodexProvider/KimiProvider to the module. If so, DO NOT re-add them to `AIRoutingModule` providers/exports — check first.

### `OPENAI_API_KEY` Already Exists in env.validation.ts

**Do not add `OPENAI_API_KEY` again.** It already exists at line 339 (Story 5.5 for Whisper/GPT-4). OS-4.3 adds it for Codex — it's the same env var. This story does not touch `OPENAI_API_KEY`.

### Scope Boundaries — What NOT to Change

- **Do NOT modify** `ProviderHealthService` — it already supports all 4 AIProvider enum values via `Object.values(AIProvider)`
- **Do NOT modify** `ComplexityScorerService` — complexity calculation is unchanged
- **Do NOT modify** `PromptGeneratorService` — no routing changes there
- **Do NOT clean up** `.env.example` — deferred to OS-5.1
- **Do NOT add** any new Prisma schema changes — AIProvider enum already has all 4 values
- **Do NOT change** the queue publishing logic in `routeTicket()` — only the `preferredProvider` selection block changes
- **Do NOT change** `FallbackStrategyService` — that is a separate fallback path for OS-2.3
- **Do NOT change** `OrchestratorService.execute()` flow beyond what Task 8 specifies — only `mapAIProviderToProviderName()` and `buildExecutionPayload()` are touched

### `ProviderSelectionReason.SINGLE_PROVIDER` — Retire Usage

The `SINGLE_PROVIDER` reason was used in the old simplified routing code:

```typescript
reason: ProviderSelectionReason.SINGLE_PROVIDER,  // ← remove this
```

Replace all `SINGLE_PROVIDER` usages with `ProviderSelectionReason.COMPLEXITY` in the updated routing logic.

### Config Keys Summary

| Config key                               | Env var               | Default | Where used          |
| ---------------------------------------- | --------------------- | ------- | ------------------- |
| `ai.providers.claudeCode.enabled`        | `CLAUDE_CODE_ENABLED` | `false` | Already in config   |
| `ai.providers.gemini.enabled`            | `GEMINI_ENABLED`      | `false` | Already in config   |
| `ai.providers.codex.enabled`             | `CODEX_ENABLED`       | `false` | Already in config   |
| `ai.providers.kimi.enabled`              | `KIMI_ENABLED`        | `false` | Already in config   |
| `ai.routing.primaryProvider`             | `AI_PRIMARY_PROVIDER` | `''`    | **This story adds** |
| `orchestrator.complexityThresholdMedium` | _(none, config only)_ | `5`     | Already in config   |
| `orchestrator.complexityThresholdHigh`   | _(none, config only)_ | `10`    | Already in config   |

### `AIRoutingService` — Exact Lines to Change

The current routing block in `src/ai-routing/ai-routing.service.ts` to replace starts at:

```typescript
// 2. Determine preferred provider based on enabled providers
const claudeEnabled = ...
```

and ends at:

```typescript
this.logger.log(`[${correlationId}] Using CLAUDE_CODE (primary provider)`);
```

Replace this entire block with the complexity-based routing logic from Task 2. The rest of the method (lock acquisition, DB writes, queue publishing) is unchanged.

### Test Mock Pattern — ConfigService

Use this pattern in `ai-routing.service.spec.ts` to handle the new config keys:

```typescript
const mockConfigService = {
  get: jest.fn((key: string, defaultValue?: unknown) => {
    const configMap: Record<string, unknown> = {
      'ai.providers.claudeCode.enabled': true,
      'ai.providers.gemini.enabled': false,
      'ai.providers.codex.enabled': false,
      'ai.providers.kimi.enabled': false,
      'ai.routing.primaryProvider': '',
      'orchestrator.complexityThresholdMedium': 5,
      'orchestrator.complexityThresholdHigh': 10,
      'ai.routing.retryDelayMinutes': 5,
      'ai.routing.alertThresholdMinutes': 15,
    };
    return key in configMap ? configMap[key] : defaultValue;
  }),
};
```

For tests that need KIMI enabled, override: `mockConfigService.get.mockImplementation((key, def) => key === 'ai.providers.kimi.enabled' ? true : ...)`.

### Project Structure Notes

Files modified in this story:

- `src/config/configuration.ts` — add `ai.routing.primaryProvider`
- `src/config/env.validation.ts` — add `AI_PRIMARY_PROVIDER` Joi entry
- `src/ai-routing/ai-routing.service.ts` — routing logic update
- `src/ai-routing/provider-factory.service.ts` — inject 3 new providers, update routing + fallback + config override
- `src/ai-routing/orchestrator.service.ts` — fix `mapAIProviderToProviderName()` and `buildExecutionPayload()`
- `src/ai-routing/ai-routing.module.ts` — register GeminiProvider/CodexProvider/KimiProvider (if not already added by OS-4.2/4.3)
- `src/ai-routing/ai-routing.service.spec.ts` — add complexity routing test cases
- `src/ai-routing/provider-factory.service.spec.ts` — add new provider mocks + routing tests

No new files created. No Prisma migrations needed.

Always use `@/` import aliases — never relative paths.

### References

- Epic OS-4 spec (story 4.4): `_bmad-output/planning-artifacts/epics.md` line 551
- FR-OS28 (AIRoutingService routing strategy): `_bmad-output/planning-artifacts/epics.md` line 159
- `AIRoutingService`: `src/ai-routing/ai-routing.service.ts`
- `ProviderFactoryService`: `src/ai-routing/provider-factory.service.ts`
- `ProviderHealthService.getAvailableProvider()`: `src/ai-routing/provider-health.service.ts:122`
- `ProviderName` enum: `src/ai-routing/enums/provider-name.enum.ts`
- `AIProvider` Prisma enum: `prisma/schema.prisma` line 1135 (CLAUDE_CODE, GEMINI, CODEX, KIMI)
- `ProviderSelectionReason`: `src/ai-routing/interfaces/orchestration.interface.ts:34`
- `IComplexityBreakdown` (0–20 scale explanation): `src/ai-routing/interfaces/ai-routing.interface.ts`
- OS-4.3 story (Codex/Kimi providers, config keys): `_bmad-output/implementation-artifacts/os-4-3-openai-codex-kimi-cli-providers.md`
- Epic OS-4 retro (OS-3 patterns): `_bmad-output/implementation-artifacts/epic-os-3-retro-2026-03-26.md`
- `OrchestratorService` (mapAIProviderToProviderName bug + buildExecutionPayload): `src/ai-routing/orchestrator.service.ts:63,74`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
