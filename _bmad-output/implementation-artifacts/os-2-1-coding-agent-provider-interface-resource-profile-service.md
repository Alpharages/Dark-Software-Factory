# Story OS-2.1: ICodingAgentProvider Interface and Resource Profile Service

Status: done

## Story

As a **Developer**,
I want a standardized `ICodingAgentProvider` interface and a `SandboxResourceProfileService` that maps complexity scores to resource limits,
So that all current and future providers share a single contract and no provider hardcodes CPU/memory values.

## Acceptance Criteria

1. **Given** `src/ai-routing/interfaces/coding-agent-provider.interface.ts` is created
   **When** a developer inspects the interface
   **Then** it exposes `readonly providerName: ProviderName`, `readonly isEnabled: boolean`, `isHealthy(): Promise<boolean>`, and `execute(payload: IAIExecutionPayload): Promise<IAIExecutionResult>`

2. **Given** `ProviderName` enum at `src/ai-routing/enums/provider-name.enum.ts`
   **When** a developer views the enum
   **Then** it contains `CLAUDE_CODE`, and `CURSOR_HEADLESS` is still present (removal deferred to Epic OS-4) — no regression

3. **Given** `SandboxResourceProfileService` at `src/sandbox/sandbox-resource-profile.service.ts`
   **When** `getProfile(score)` is called with complexity score 0–3
   **Then** it returns `{ cpuLimit: '0.5', memoryLimit: '256Mi' }` (small profile)

4. **When** `getProfile(score)` is called with complexity score 4–7
   **Then** it returns `{ cpuLimit: '1', memoryLimit: '512Mi' }` (medium profile), unless overridden by `OPENSANDBOX_DEFAULT_CPU_LIMIT` / `OPENSANDBOX_DEFAULT_MEMORY_LIMIT`

5. **When** `getProfile(score)` is called with complexity score 8–10
   **Then** it returns `{ cpuLimit: '2', memoryLimit: '1Gi' }` (large profile)

6. **Given** `OPENSANDBOX_DEFAULT_CPU_LIMIT=2` and `OPENSANDBOX_DEFAULT_MEMORY_LIMIT=1Gi` are set
   **When** `getProfile(5)` is called (medium range)
   **Then** it returns the env-var overrides instead of the hardcoded medium defaults

7. **Given** `IAIExecutionPayload` in `src/execution/interfaces/queue.interface.ts`
   **When** a developer inspects it
   **Then** it has a new optional field `complexityScore?: number` so providers can retrieve the resource profile

8. **Given** `SandboxResourceProfileService` is added to `SandboxModule`
   **When** any module that imports `SandboxModule` resolves DI
   **Then** `SandboxResourceProfileService` is injectable

9. **Given** `pnpm test`, `pnpm typecheck`, and `pnpm lint` are run
   **When** the commands complete
   **Then** zero failures across all three

## Tasks / Subtasks

- [x] Task 1: Create `ProviderName` enum (AC: #2)
  - [x] Create `src/ai-routing/enums/provider-name.enum.ts` with `CLAUDE_CODE = 'CLAUDE_CODE'` and `CURSOR_HEADLESS = 'CURSOR_HEADLESS'`
  - [x] Create `src/ai-routing/enums/index.ts` exporting `ProviderName`

- [x] Task 2: Create `ICodingAgentProvider` interface (AC: #1)
  - [x] Create `src/ai-routing/interfaces/coding-agent-provider.interface.ts`
  - [x] Import `ProviderName` from enums, `IAIExecutionPayload` from `@/execution/interfaces`, `IAIExecutionResult` from `./ai-provider.interface`
  - [x] Export `ICodingAgentProvider` interface with: `providerName`, `isEnabled`, `isHealthy()`, `execute()`
  - [x] Update `src/ai-routing/interfaces/index.ts` to export `ICodingAgentProvider`

- [x] Task 3: Add `complexityScore` to `IAIExecutionPayload` (AC: #7)
  - [x] Open `src/execution/interfaces/queue.interface.ts`
  - [x] Add `/** Complexity score (0-10) for resource profile selection */ complexityScore?: number;` field to `IAIExecutionPayload`

- [x] Task 4: Create `SandboxResourceProfileService` (AC: #3, #4, #5, #6)
  - [x] Create `src/sandbox/sandbox-resource-profile.service.ts`
  - [x] Inject `ConfigService` to read `opensandbox.defaultCpuLimit` and `opensandbox.defaultMemoryLimit`
  - [x] Implement `getProfile(score: number): ResourceProfile` with small/medium/large tiers
  - [x] Medium profile uses env-var overrides if present
  - [x] Export `ResourceProfile` interface: `{ cpuLimit: string; memoryLimit: string }`
  - [x] Update `src/sandbox/index.ts` to export `SandboxResourceProfileService` and `ResourceProfile`

- [x] Task 5: Register in SandboxModule (AC: #8)
  - [x] Open `src/sandbox/sandbox.module.ts`
  - [x] Add `SandboxResourceProfileService` to `providers` array
  - [x] Add `SandboxResourceProfileService` to `exports` array

- [x] Task 6: Write unit tests (AC: #9)
  - [x] Create `src/sandbox/sandbox-resource-profile.service.spec.ts`
  - [x] T1: score 0 → small profile (cpuLimit='0.5', memoryLimit='256Mi')
  - [x] T2: score 3 → small profile
  - [x] T3: score 4 → medium profile (no overrides)
  - [x] T4: score 7 → medium profile (no overrides)
  - [x] T5: score 5 with OPENSANDBOX_DEFAULT_CPU_LIMIT='2' and OPENSANDBOX_DEFAULT_MEMORY_LIMIT='1Gi' → overridden medium
  - [x] T6: score 8 → large profile (cpuLimit='2', memoryLimit='1Gi')
  - [x] T7: score 10 → large profile
  - [x] T8: score 2 (small range) with overrides set → still returns `{ cpuLimit: '0.5', memoryLimit: '256Mi' }` (env overrides do NOT affect small or large profiles)
  - [x] Run `pnpm typecheck` and `pnpm lint` and fix all issues

## Dev Notes

### Critical: Understand What Already Exists Before Touching Anything

**DO NOT create any of these — they already exist:**

- `src/ai-routing/interfaces/ai-provider.interface.ts` — defines `IAIProvider`, `IAIExecutionInput`, `IAIExecutionResult`, `IAIExecutionError`, `AIErrorCode` — **reuse `IAIExecutionResult` in the new interface**
- `src/sandbox/sandbox.service.ts` — full `SandboxService` with metrics, semaphore, leak prevention (OS-1.2–1.4)
- `src/sandbox/sandbox.module.ts` — already a global module with 4 Prometheus metrics registered
- `src/sandbox/interfaces/agent-command-options.interface.ts` — `AgentCommandOptions` with all fields
- `src/sandbox/interfaces/agent-command-result.interface.ts` — `AgentCommandResult`
- `src/common/metrics/metrics.constants.ts` — `SANDBOX_METRICS` block already has all 4 sandbox metric names
- `src/config/env.validation.ts` — `OPENSANDBOX_DEFAULT_CPU_LIMIT` (default `'1'`) and `OPENSANDBOX_DEFAULT_MEMORY_LIMIT` (default `'512Mi'`) **already validated** — do NOT re-add
- `src/config/configuration.ts` — `opensandbox.defaultCpuLimit` and `opensandbox.defaultMemoryLimit` keys **already exist** — use exactly these keys

**DO NOT implement yet (out of scope for OS-2.1):**

- `ClaudeCodeProvider` rewrite (OS-2.2)
- `FallbackStrategyService` / `ProviderHealthService` updates (OS-2.3)
- Any deletion of DooD code (Epic OS-3)
- New providers Gemini, Codex, Kimi (Epic OS-4)

### ICodingAgentProvider Interface Design

The new `ICodingAgentProvider` interface is **separate** from the existing `IAIProvider` interface (which uses the Prisma `AIProvider` enum and is tightly coupled to DooD patterns). The new interface is the OS-2 clean contract:

```typescript
// src/ai-routing/interfaces/coding-agent-provider.interface.ts
import { ProviderName } from '@/ai-routing/enums/provider-name.enum';
import { IAIExecutionPayload } from '@/execution/interfaces';
import { IAIExecutionResult } from './ai-provider.interface';

export interface ICodingAgentProvider {
  readonly providerName: ProviderName;
  readonly isEnabled: boolean;
  isHealthy(): Promise<boolean>;
  execute(payload: IAIExecutionPayload): Promise<IAIExecutionResult>;
}
```

**Why `IAIExecutionPayload` from `@/execution/interfaces`:** That's the RabbitMQ message payload that flows through the queue consumer to providers. The `execute()` contract mirrors the queue contract, so no data transformation is needed.

**Why `IAIExecutionResult` from `./ai-provider.interface`:** Reuses the existing result type (`success`, `codeDiff`, `filesChanged`, `confidenceScore`, `durationMs`, etc.) — no new types needed.

### ProviderName Enum — NOT the Same as Prisma AIProvider

The Prisma `AIProvider` enum lives in `@/prisma/client` and is used by the database model. `ProviderName` is a **new app-level enum** that decouples provider identity from the DB model:

```typescript
// src/ai-routing/enums/provider-name.enum.ts
export enum ProviderName {
  CLAUDE_CODE = 'CLAUDE_CODE',
  CURSOR_HEADLESS = 'CURSOR_HEADLESS', // Keep — removal deferred to OS-4
}
```

The existing `ProviderFactoryService` and `provider-health.service.ts` continue using `AIProvider` from Prisma — **do NOT change them in this story**. The new `ICodingAgentProvider` uses `ProviderName`. The two enums intentionally coexist until OS-4 cleans up the legacy.

### SandboxResourceProfileService Design

```typescript
// src/sandbox/sandbox-resource-profile.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ResourceProfile {
  cpuLimit: string;
  memoryLimit: string;
}

@Injectable()
export class SandboxResourceProfileService {
  // Small: scores 0-3
  private readonly SMALL: ResourceProfile = { cpuLimit: '0.5', memoryLimit: '256Mi' };
  // Large: scores 8-10
  private readonly LARGE: ResourceProfile = { cpuLimit: '2', memoryLimit: '1Gi' };

  constructor(private readonly config: ConfigService) {}

  getProfile(score: number): ResourceProfile {
    if (score <= 3) return this.SMALL;
    if (score >= 8) return this.LARGE;
    // Medium (4-7): check env overrides
    return {
      cpuLimit: this.config.get<string>('opensandbox.defaultCpuLimit', '1'),
      memoryLimit: this.config.get<string>('opensandbox.defaultMemoryLimit', '512Mi'),
    };
  }
}
```

**Key rule:** env-var overrides (`OPENSANDBOX_DEFAULT_CPU_LIMIT`, `OPENSANDBOX_DEFAULT_MEMORY_LIMIT`) apply **only to the medium profile (scores 4–7)**. Small and large are hardcoded. This matches the epic spec exactly.

### Updating IAIExecutionPayload

`IAIExecutionPayload` is in `src/execution/interfaces/queue.interface.ts`. Add `complexityScore` as **optional** (backward-compatible — existing messages without it default to undefined, and providers can treat `undefined` as 0 or medium):

```typescript
/** Complexity score (0-10) for sandbox resource profile selection */
complexityScore?: number;
```

This is a non-breaking additive change. No existing callers need to be updated in this story — that's OS-2.2's responsibility (when `ClaudeCodeProvider.execute()` calls `getProfile(payload.complexityScore ?? 5)`).

### SandboxModule Update Pattern

The actual `sandbox.module.ts` uses a `const sandboxMetricProviders` spread array (do NOT flatten this into a list). Follow the existing pattern exactly:

```typescript
// sandbox.module.ts — the const above @Module stays untouched
const sandboxMetricProviders = [
  makeCounterProvider({ name: SANDBOX_METRICS.EXECUTIONS_TOTAL, ... }),
  makeHistogramProvider({ name: SANDBOX_METRICS.EXECUTION_DURATION_SECONDS, ... }),
  makeGaugeProvider({ name: SANDBOX_METRICS.ACTIVE_SANDBOXES, ... }),
  makeGaugeProvider({ name: SANDBOX_METRICS.CONCURRENCY_QUEUE_DEPTH, ... }),
];

@Global()
@Module({
  imports: [AppMetricsModule, forwardRef(() => ExecutionModule)],
  providers: [SandboxService, SandboxResourceProfileService, ...sandboxMetricProviders],  // ADD SandboxResourceProfileService
  exports: [SandboxService, SandboxResourceProfileService],  // ADD SandboxResourceProfileService
})
export class SandboxModule {}
```

**`SandboxModule` is `@Global()`** — once `SandboxResourceProfileService` is in its `exports`, it is injectable everywhere in the app with no additional `imports:` needed in other modules (e.g., `ai-routing.module.ts` does NOT need to import `SandboxModule`).

### Env Config Keys (Already Exist — Exact Keys to Use)

| Env Var                            | ConfigService Key                | Default   |
| ---------------------------------- | -------------------------------- | --------- |
| `OPENSANDBOX_DEFAULT_CPU_LIMIT`    | `opensandbox.defaultCpuLimit`    | `'1'`     |
| `OPENSANDBOX_DEFAULT_MEMORY_LIMIT` | `opensandbox.defaultMemoryLimit` | `'512Mi'` |

These are confirmed in `src/config/configuration.ts` (opensandbox block, lines ~335-348) and validated in `src/config/env.validation.ts` (lines ~408-460). Do NOT re-add them.

### Testing Pattern (from OS-1.4)

Mock ConfigService using NestJS `createMock` pattern:

```typescript
// sandbox-resource-profile.service.spec.ts
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SandboxResourceProfileService } from './sandbox-resource-profile.service';

describe('SandboxResourceProfileService', () => {
  let service: SandboxResourceProfileService;
  let configGet: jest.Mock;

  beforeEach(async () => {
    configGet = jest.fn();
    const module = await Test.createTestingModule({
      providers: [
        SandboxResourceProfileService,
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();
    service = module.get(SandboxResourceProfileService);
  });

  afterEach(() => jest.resetAllMocks());

  it('T1: score 0 returns small profile', () => {
    expect(service.getProfile(0)).toEqual({ cpuLimit: '0.5', memoryLimit: '256Mi' });
  });
  // ... T2-T8
});
```

For T5 (medium with overrides): configure `configGet` to return `'2'` for `opensandbox.defaultCpuLimit` and `'1Gi'` for `opensandbox.defaultMemoryLimit`. Assert that `service.getProfile(5)` returns `{ cpuLimit: '2', memoryLimit: '1Gi' }`.

For T8 (overrides do not affect small/large): configure `configGet` to return overrides, then assert `getProfile(2)` still returns `{ cpuLimit: '0.5', memoryLimit: '256Mi' }` without calling `configGet`.

### Project Structure Notes

**New files to create:**

```
src/
├── ai-routing/
│   ├── enums/
│   │   ├── provider-name.enum.ts     ← NEW
│   │   └── index.ts                  ← NEW
│   └── interfaces/
│       └── coding-agent-provider.interface.ts  ← NEW
└── sandbox/
    └── sandbox-resource-profile.service.ts     ← NEW
    └── sandbox-resource-profile.service.spec.ts ← NEW
```

**Files to modify:**

```
src/
├── ai-routing/
│   └── interfaces/
│       └── index.ts                  ← ADD ICodingAgentProvider export
├── execution/
│   └── interfaces/
│       └── queue.interface.ts        ← ADD complexityScore?: number to IAIExecutionPayload
└── sandbox/
    ├── sandbox.module.ts             ← ADD SandboxResourceProfileService to providers + exports
    └── index.ts                      ← ADD SandboxResourceProfileService + ResourceProfile exports
```

**Import alias rule:** All imports use `@/` prefix. Never use relative paths like `../../`.

### Anti-Patterns to Avoid

1. **Do NOT modify `IAIProvider`** in `ai-provider.interface.ts` — it is the legacy interface used by `ClaudeCodeProvider` (current PTY-based implementation). `ICodingAgentProvider` is the new interface for OS-2 providers. They coexist until OS-3.
2. **Do NOT change `ProviderFactoryService`** — it still uses `AIProvider` (Prisma enum). Updating it is OS-2.2 scope.
3. **Do NOT change `provider-health.service.ts`** — still uses `AIProvider`. Updating is OS-2.3 scope.
4. **Do NOT add new Prometheus metrics** — all sandbox metrics are already registered in `sandbox.module.ts` (from OS-1.4). `SandboxResourceProfileService` does not need metrics.
5. **Do NOT create a separate `ResourceProfile` module** — it belongs in `sandbox/` since it configures sandbox execution resources.
6. **Do NOT hardcode** `'opensandbox.defaultCpuLimit'` as a string literal in tests — mock `ConfigService` properly.

### References

- Epic OS-2 story 2.1 spec: `_bmad-output/planning-artifacts/epics.md` → Epic OS-2 section
- OpenSandbox PRD: `_bmad-output/planning-artifacts/prd-opensandbox-migration.md` (FR-OS14, FR-OS25, FR-OS26, FR-OS27)
- Existing sandbox module: `src/sandbox/sandbox.module.ts` (global module pattern, metric registration)
- Existing sandbox service: `src/sandbox/sandbox.service.ts` (ConfigService dot-notation pattern)
- Env validation: `src/config/env.validation.ts` (lines ~408-460, opensandbox block)
- Configuration: `src/config/configuration.ts` (opensandbox block ~lines 335-348)
- IAIExecutionPayload: `src/execution/interfaces/queue.interface.ts`
- IAIExecutionResult: `src/ai-routing/interfaces/ai-provider.interface.ts`
- OS-1.4 story (SandboxModule metric pattern): `_bmad-output/implementation-artifacts/os-1-4-sandbox-prometheus-metrics-concurrency-leak-prevention.md`

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Implemented `ProviderName` enum and `ICodingAgentProvider` interface.
- Updated `IAIExecutionPayload` to include an optional `complexityScore` field.
- Created `SandboxResourceProfileService` mapping 0-10 complexity scores to CPU and Memory limits.
- Wired the new resource profile service globally in `SandboxModule`.
- Defined and passed all 8 unit tests, plus typecheck and lint.

### File List

- `src/ai-routing/enums/provider-name.enum.ts` (new)
- `src/ai-routing/enums/index.ts` (new)
- `src/ai-routing/interfaces/coding-agent-provider.interface.ts` (new)
- `src/ai-routing/interfaces/index.ts` (modified — add ICodingAgentProvider export)
- `src/execution/interfaces/queue.interface.ts` (modified — add complexityScore to IAIExecutionPayload)
- `src/sandbox/sandbox-resource-profile.service.ts` (new)
- `src/sandbox/sandbox-resource-profile.service.spec.ts` (new)
- `src/sandbox/sandbox.module.ts` (modified — add SandboxResourceProfileService to providers + exports)
- `src/sandbox/index.ts` (modified — export SandboxResourceProfileService + ResourceProfile)

### Review Findings

- [x] [Review][Patch] NaN input silently routes to medium branch [sandbox-resource-profile.service.ts:18-25] — Fixed: added `!Number.isFinite(score)` guard that collapses NaN/invalid inputs into the small profile. T9 (NaN) and T10 (negative) added to spec. T6/T7 now assert `configGet` not called.
- [x] [Review][Defer] Large-profile tests don't assert configGet not called [sandbox-resource-profile.service.spec.ts:49-55] — T6/T7 verify the return value for scores 8 and 10 but don't assert `expect(configGet).not.toHaveBeenCalled()`. If someone accidentally plumbed config into the large branch it would go undetected. Deferred — spec only required the guard for T8; adding it to T6/T7 is a test-quality improvement for a future hardening pass.
- [x] [Review][Defer] ICodingAgentProvider missing JSDoc block [coding-agent-provider.interface.ts:5] — All other interfaces in this codebase (IAIProvider, IPMProvider) carry a JSDoc block explaining purpose and ADR references. The new interface has none. Deferred — purely documentation; has no runtime impact. Acceptable for review cycle; should be added before OS-4 when more providers implement it.
