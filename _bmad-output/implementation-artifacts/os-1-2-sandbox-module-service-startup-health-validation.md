# Story OS-1.2: SandboxModule and SandboxService with Startup Health Validation

Status: ready-for-dev

## Story

As a **Developer**,
I want a NestJS `SandboxModule` with `SandboxService` that wraps the `@alibaba-group/opensandbox` SDK and validates connectivity on startup,
so that all coding agent providers can use a single, well-tested abstraction without managing SDK details directly.

## Acceptance Criteria

1. **Given** `@alibaba-group/opensandbox@^0.1.5` is added to `package.json` dependencies
   **When** `SandboxModule` is registered as a global module in `AppModule`
   **Then** `SandboxService` is injectable across all modules without additional imports

2. **Given** `NODE_ENV=production` and the OpenSandbox server is unreachable
   **When** the NestJS application starts (`onModuleInit` runs)
   **Then** startup fails immediately with a descriptive error message identifying `OPENSANDBOX_DOMAIN` as the unreachable target, within 10 seconds total

3. **Given** `NODE_ENV=development` or `test` and the OpenSandbox server is unreachable
   **When** the NestJS application starts
   **Then** a warning is logged and startup continues normally (no exception thrown)

4. **Given** `OPENSANDBOX_AGENT_IMAGE` env var is not set
   **When** `SandboxService` is initialized
   **Then** it defaults to `opensandbox/code-interpreter:v1.0.2`

5. **Given** the `AgentCommandOptions` and `AgentCommandResult` TypeScript interfaces are defined
   **When** a developer inspects them
   **Then** `AgentCommandOptions` has: `executionId`, `image`, `command`, `env`, `timeoutSeconds`, `cpuLimit`, `memoryLimit` (required); `networkPolicy`, `metadata` (optional)
   **And** `AgentCommandResult` has: `sandboxId`, `stdout`, `stderr`, `exitCode`, `durationMs`, `timedOut`

6. **Given** `SandboxService` is instantiated and the OpenSandbox server is reachable
   **When** `getSandboxInfo()`, `killSandbox()`, and `listActiveSandboxes()` are called
   **Then** they delegate to the OpenSandbox SDK correctly and return typed results

6b. **Given** `SandboxService.isHealthy()` is called
**When** the OpenSandbox server is reachable → returns `true`
**When** the OpenSandbox server is unreachable → returns `false` (does NOT throw)
_(Required by OS-2.2: `ClaudeCodeProvider.isHealthy()` calls this method per FR-OS18)_

7. **Given** new env vars `OPENSANDBOX_DOMAIN`, `OPENSANDBOX_API_KEY`, `OPENSANDBOX_AGENT_IMAGE`, `OPENSANDBOX_MAX_CONCURRENT`, `OPENSANDBOX_SANDBOX_TIMEOUT_S`, `OPENSANDBOX_DEFAULT_CPU_LIMIT`, `OPENSANDBOX_DEFAULT_MEMORY_LIMIT`, `OPENSANDBOX_PROTOCOL`, `OPENSANDBOX_REQUEST_TIMEOUT_MS`, `OPENSANDBOX_SECURE_RUNTIME`, `OPENSANDBOX_NETWORK_DEFAULT_ACTION` are added to `env.validation.ts` and `configuration.ts`
   **When** the app starts without them set
   **Then** they fall back to documented defaults (no startup crash for optional vars)

8. **Given** `pnpm typecheck` and `pnpm lint` are run after the module is created
   **When** the commands complete
   **Then** zero errors are reported

9. **Given** `SandboxService` unit tests run with `pnpm test`
   **When** the tests complete
   **Then** all 10 tests pass — including production-fail, dev-warn-and-continue, `isHealthy()` true/false branches, and SDK delegation methods

## Tasks / Subtasks

- [ ] Task 1: Install the OpenSandbox SDK (AC: #1)
  - [ ] 1.1 Run `pnpm add @alibaba-group/opensandbox@^0.1.5`
  - [ ] 1.2 Verify it appears in `package.json` `dependencies` (not devDependencies)
  - [ ] 1.3 Run `pnpm install` to update the lockfile
  - [ ] 1.4 **Verify SDK API surface before writing any code:** run `ls node_modules/@alibaba-group/opensandbox/` and inspect the TypeScript declarations (e.g., `cat node_modules/@alibaba-group/opensandbox/dist/index.d.ts` or equivalent). Confirm the exact: constructor signature of `SandboxManager`, method names (`listSandboxInfos` vs `listSandboxes`), how to kill a sandbox (`sandbox.kill()` vs `manager.killSandbox()`), and the `SandboxInfo` type shape. Document any discrepancies from the PRD in Dev Agent Record completion notes.

- [ ] Task 2: Create the `src/sandbox/` module structure (AC: #1, #5, #6)
  - [ ] 2.1 Create directory `src/sandbox/` and `src/sandbox/interfaces/`
  - [ ] 2.2 Create `src/sandbox/interfaces/agent-command-options.interface.ts` with the `AgentCommandOptions` interface (all fields per AC #5)
  - [ ] 2.3 Create `src/sandbox/interfaces/agent-command-result.interface.ts` with the `AgentCommandResult` interface (all fields per AC #5)
  - [ ] 2.4 Create `src/sandbox/sandbox.service.ts` implementing `OnModuleInit` with:
    - Class field `private readonly logger = new Logger(SandboxService.name)` (NOT injected `LoggerService`)
    - Constructor injecting only `ConfigService`
    - `onModuleInit()` — initializes SDK manager, runs health ping with production-fail / dev-warn branching (AC: #2, #3)
    - `isHealthy(): Promise<boolean>` — calls `pingServer()` internally, returns `true`/`false` (never throws) — used by providers in OS-2
    - `getSandboxInfo(sandboxId: string): Promise<SandboxInfo>` — delegates to SDK
    - `killSandbox(sandboxId: string): Promise<void>` — delegates to SDK
    - `listActiveSandboxes(): Promise<SandboxInfo[]>` — delegates to SDK
    - `runAgentCommand(options: AgentCommandOptions): Promise<AgentCommandResult>` — stubbed; throws `new Error('[OS-1.3] runAgentCommand not yet implemented — awaiting streaming support')` — full implementation in OS-1.3
    - `private async pingServer(): Promise<void>` — extracted health ping logic reused by both `onModuleInit` and `isHealthy`
  - [ ] 2.5 Create `src/sandbox/sandbox.module.ts` as a `@Global()` `@Module()` exporting `SandboxService`
  - [ ] 2.6 Create `src/sandbox/index.ts` barrel re-exporting `SandboxModule`, `SandboxService`, and both interfaces

- [ ] Task 3: Register `SandboxModule` in `AppModule` (AC: #1)
  - [ ] 3.1 Add `SandboxModule` import to `src/app.module.ts`
  - [ ] 3.2 Do **NOT** remove `DockerModule` — it stays until Epic OS-3
  - [ ] 3.3 Verify `pnpm typecheck` passes after this change

- [ ] Task 4: Add OpenSandbox env vars to config (AC: #7)
  - [ ] 4.1 In `src/config/env.validation.ts`, add Joi schemas for all 11 new OPENSANDBOX\_\* vars (see Dev Notes for exact schemas)
  - [ ] 4.2 In `src/config/configuration.ts`, add an `opensandbox:` config block below the existing `sandbox:` block (do NOT replace the legacy block — that is removed in OS-3)
  - [ ] 4.3 In `.env.example`, add a new `# OpenSandbox Server (Epic OS-1)` section with all 11 OPENSANDBOX\_\* vars. Insert it after the existing `# AI Providers` block (which contains `CLAUDE_CODE_ENABLED`, `ANTHROPIC_API_KEY`, etc.) and before any `# Monitoring` section.

- [ ] Task 5: Write unit tests (AC: #9)
  - [ ] 5.1 Create `src/sandbox/sandbox.service.spec.ts` with:
    - T1: `onModuleInit()` in production — when health ping throws → `onModuleInit` re-throws (startup fails)
    - T2: `onModuleInit()` in development — when health ping throws → logs warning, does NOT throw
    - T3: `onModuleInit()` in test env — when health ping throws → logs warning, does NOT throw
    - T4: `onModuleInit()` — when health ping succeeds → logs info "OpenSandbox connected" and does NOT throw in any env
    - T5: `listActiveSandboxes()` — delegates to SDK's `manager.listSandboxInfos()`
    - T6: `getSandboxInfo(id)` — delegates to SDK's `manager.getSandboxInfo(id)`
    - T7: `killSandbox(id)` — delegates to SDK's kill method after getting sandbox by ID
    - T8: `runAgentCommand()` — throws with `[OS-1.3]` prefix message (stub contract)
    - T9: Default image — when `OPENSANDBOX_AGENT_IMAGE` not set, `config.opensandbox.agentImage` equals `opensandbox/code-interpreter:v1.0.2`
    - T10: `isHealthy()` — returns `true` when ping succeeds; returns `false` (does NOT throw) when ping fails

- [ ] Task 6: Verify the build (AC: #8)
  - [ ] 6.1 Run `pnpm typecheck` — zero errors
  - [ ] 6.2 Run `pnpm lint` — zero errors
  - [ ] 6.3 Run `pnpm test -- sandbox.service` — all tests green
  - [ ] 6.4 Run `pnpm build` — zero compilation errors

## Dev Notes

### Scope Boundaries — What NOT to Do in This Story

**DO NOT touch these in OS-1.2:**

- Do not delete `DockerModule`, `DockerService`, `WorkspaceService`, or `PtyExecutionService` — that is Epic OS-3 scope
- Do not remove `DockerModule` from `AppModule` — that is OS-3 scope
- Do not implement `runAgentCommand()` for real — that is OS-1.3 (streaming) scope
- Do not implement `SandboxResourceProfileService` — that is OS-2.1 scope
- Do not define or implement `ICodingAgentProvider` — that is OS-2.1 scope
- Do not remove any existing SANDBOX*\*, DOCKER*_, or CURSOR\__ env vars from `env.validation.ts` or `configuration.ts` — those legacy vars are still consumed by `DockerService` and `WorkspaceService` until OS-3 removes those files
- Do not add Prometheus metrics counters/histograms/gauges for sandbox execution — that is OS-1.4 scope
- Do not add the background job (semaphore / leak cleanup) — that is OS-1.4 scope
- Do not update `OPENSANDBOX_DOMAIN` format from the OS-1.1 ops doc (which uses `host:port`) — the config must accept the domain string and construct the full URL internally using `OPENSANDBOX_PROTOCOL`

### OpenSandbox SDK Usage

The SDK package is `@alibaba-group/opensandbox`. Based on the PRD (FR-OS4, FR-OS8, NFR-OS1), the health ping pattern is:

```typescript
import { SandboxManager } from '@alibaba-group/opensandbox';

// Initialize manager
const manager = new SandboxManager({
  domain: configService.get('opensandbox.domain'),
  apiKey: configService.get('opensandbox.apiKey'),
  protocol: configService.get('opensandbox.protocol'),
  requestTimeout: configService.get('opensandbox.requestTimeoutMs'),
});

// Health ping (used in onModuleInit)
await manager.listSandboxInfos({ limit: 0 });

// SDK methods for getSandboxInfo / killSandbox / listActiveSandboxes
await manager.getSandboxInfo(sandboxId); // getSandboxInfo()
await manager.listSandboxInfos(); // listActiveSandboxes()
// For killSandbox: may need to get sandbox instance then call .kill() — verify from SDK docs
```

> **Important:** Verify the exact SDK API surface by inspecting `node_modules/@alibaba-group/opensandbox` after installation. The PRD was written based on the expected API. If the actual method names differ (e.g., `listSandboxInfos` vs `listSandboxes`), use the actual SDK methods and document the discrepancy in Dev Agent Record completion notes.

### Startup Health Check Implementation

The `onModuleInit` pattern (NOT `OnApplicationBootstrap`) per FR-OS4 and NFR-OS1:

```typescript
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SandboxManager } from '@alibaba-group/opensandbox'; // verify exact export name after install

@Injectable()
export class SandboxService implements OnModuleInit {
  // Use the standard NestJS Logger class field — NOT injected LoggerService.
  // This matches DockerService and all ai-routing services in this codebase.
  private readonly logger = new Logger(SandboxService.name);
  private manager: SandboxManager;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.manager = new SandboxManager({
      domain: this.config.get<string>('opensandbox.domain'),
      apiKey: this.config.get<string>('opensandbox.apiKey'),
      protocol: this.config.get<string>('opensandbox.protocol'),
      requestTimeout: this.config.get<number>('opensandbox.requestTimeoutMs'),
    });

    const isProd = process.env.NODE_ENV === 'production';
    const domain = this.config.get<string>('opensandbox.domain');

    try {
      await this.pingServer();
      this.logger.log(`OpenSandbox connected successfully at ${domain}`);
    } catch (err) {
      const message =
        `SandboxService: OpenSandbox server unreachable at ${domain}. ` +
        `Set OPENSANDBOX_DOMAIN to point to a running opensandbox-server. ` +
        `Error: ${(err as Error).message}`;

      if (isProd) {
        throw new Error(message); // Aborts startup in production
      } else {
        this.logger.warn(message); // Warn-and-continue in dev/test
      }
    }
  }

  /** Used by onModuleInit and isHealthy(). Throws on failure. */
  private async pingServer(): Promise<void> {
    await Promise.race([
      this.manager.listSandboxInfos({ limit: 0 }), // verify method name from SDK types
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OpenSandbox health ping timed out after 10s')), 10_000),
      ),
    ]);
  }

  /** Called by providers (e.g. ClaudeCodeProvider.isHealthy()) to check connectivity. Never throws. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.pingServer();
      return true;
    } catch {
      return false;
    }
  }
}
```

The `≤10 seconds` constraint (NFR-OS1) is enforced by the `Promise.race` timeout in `pingServer()`.

### Env Var Joi Schemas for `env.validation.ts`

Add these after the existing `SANDBOX_CPU_LIMIT_PERCENT` entry:

```typescript
// Epic OS-1: OpenSandbox server connection
OPENSANDBOX_DOMAIN: Joi.string()
  .default('localhost:8080')
  .description('OpenSandbox server address (host:port, no scheme)'),
OPENSANDBOX_API_KEY: Joi.string()
  .allow('')
  .default('')
  .description('API key for OpenSandbox server authentication (required in production)'),
OPENSANDBOX_PROTOCOL: Joi.string()
  .valid('http', 'https')
  .default('http')
  .description('Protocol for OpenSandbox server communication'),
OPENSANDBOX_REQUEST_TIMEOUT_MS: Joi.number()
  .integer()
  .min(1000)
  .max(300000)
  .default(60000)
  .description('HTTP request timeout for sandbox management calls (ms)'),
OPENSANDBOX_AGENT_IMAGE: Joi.string()
  .default('opensandbox/code-interpreter:v1.0.2')
  .description('Docker image for sandbox executions'),
OPENSANDBOX_SANDBOX_TIMEOUT_S: Joi.number()
  .integer()
  .min(60)
  .max(7200)
  .default(3600)
  .description('Maximum sandbox lifetime in seconds (default: 1 hour)'),
OPENSANDBOX_MAX_CONCURRENT: Joi.number()
  .integer()
  .min(1)
  .max(50)
  .default(10)
  .description('Maximum number of sandboxes running simultaneously'),
OPENSANDBOX_DEFAULT_CPU_LIMIT: Joi.string()
  .default('1')
  .description('Default CPU limit for medium resource profile (Kubernetes-style: "0.5", "1", "2")'),
OPENSANDBOX_DEFAULT_MEMORY_LIMIT: Joi.string()
  .default('512Mi')
  .description('Default memory limit for medium resource profile (e.g., "512Mi", "1Gi")'),
OPENSANDBOX_SECURE_RUNTIME: Joi.string()
  .allow('')
  .valid('', 'gvisor', 'kata-qemu', 'firecracker')
  .default('')
  .description('Secure container runtime ("" = standard Docker, "gvisor", "kata-qemu", "firecracker")'),
OPENSANDBOX_NETWORK_DEFAULT_ACTION: Joi.string()
  .valid('ALLOW', 'DENY')
  .default('ALLOW')
  .description('Default egress policy for sandboxes'),
```

### `configuration.ts` — New `opensandbox:` Block

Add after the existing `sandbox:` config block (do NOT replace it):

```typescript
// Epic OS-1: OpenSandbox server connection config
opensandbox: {
  domain: process.env.OPENSANDBOX_DOMAIN || 'localhost:8080',
  apiKey: process.env.OPENSANDBOX_API_KEY || '',
  protocol: process.env.OPENSANDBOX_PROTOCOL || 'http',
  requestTimeoutMs: parseInt(process.env.OPENSANDBOX_REQUEST_TIMEOUT_MS || '60000', 10),
  agentImage: process.env.OPENSANDBOX_AGENT_IMAGE || 'opensandbox/code-interpreter:v1.0.2',
  sandboxTimeoutS: parseInt(process.env.OPENSANDBOX_SANDBOX_TIMEOUT_S || '3600', 10),
  maxConcurrent: parseInt(process.env.OPENSANDBOX_MAX_CONCURRENT || '10', 10),
  defaultCpuLimit: process.env.OPENSANDBOX_DEFAULT_CPU_LIMIT || '1',
  defaultMemoryLimit: process.env.OPENSANDBOX_DEFAULT_MEMORY_LIMIT || '512Mi',
  secureRuntime: process.env.OPENSANDBOX_SECURE_RUNTIME || '',
  networkDefaultAction: process.env.OPENSANDBOX_NETWORK_DEFAULT_ACTION || 'ALLOW',
},
```

### File Structure Created in This Story

```
src/sandbox/
├── interfaces/
│   ├── agent-command-options.interface.ts
│   └── agent-command-result.interface.ts
├── sandbox.module.ts        # @Global() @Module({ providers: [SandboxService], exports: [SandboxService] })
├── sandbox.service.ts       # SandboxService (OnModuleInit, wraps SDK)
├── sandbox.service.spec.ts  # Unit tests
└── index.ts                 # Barrel exports
```

Also modified:

- `src/app.module.ts` — add `SandboxModule` import (DockerModule stays)
- `src/config/env.validation.ts` — add 11 OPENSANDBOX\_\* Joi schemas
- `src/config/configuration.ts` — add `opensandbox:` config block
- `.env.example` — add OPENSANDBOX\_\* vars with comments

### `SandboxModule` Global Declaration

```typescript
import { Global, Module } from '@nestjs/common';
import { SandboxService } from './sandbox.service';

@Global()
@Module({
  providers: [SandboxService],
  exports: [SandboxService],
})
export class SandboxModule {}
```

The `@Global()` decorator satisfies FR-OS13: "injectable across all modules without additional imports". No need for other modules to import `SandboxModule` explicitly — they just inject `SandboxService`.

> **Note:** `SandboxModule` does NOT import `ConfigModule`. Unlike `DockerModule` (which explicitly imports it), `SandboxModule` can rely on `ConfigService` being globally available because `ConfigModule.forRoot({ isGlobal: true })` is already registered in `AppModule`. Re-importing `ConfigModule` would be redundant.

### Interface Definitions

`agent-command-options.interface.ts`:

```typescript
export interface AgentCommandOptions {
  executionId: string; // Used for logging and tracking
  image: string; // Sandbox image (default: opensandbox/code-interpreter:v1.0.2)
  command: string; // Shell command to run (e.g., 'claude "implement feature X"')
  env: Record<string, string>; // Provider-specific env vars (API keys, model names)
  timeoutSeconds: number; // Per-execution TTL
  cpuLimit: string; // Kubernetes-style (e.g., "1", "0.5", "2")
  memoryLimit: string; // Kubernetes-style (e.g., "512Mi", "1Gi", "2Gi")
  networkPolicy?: {
    defaultAction: 'ALLOW' | 'DENY';
    egressRules?: Array<{ target: string }>;
  };
  metadata?: Record<string, string>; // Attached to sandbox for observability
}
```

`agent-command-result.interface.ts`:

```typescript
export interface AgentCommandResult {
  sandboxId: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}
```

### Previous Story Intelligence (OS-1.1)

OS-1.1 was a pure ops/documentation story with minimal code changes:

- Removed `/var/run/docker.sock` mount from `docker-compose.yml` (lines 127-128)
- Removed `DOCKER_SOCKET_PATH` block from `.env.example`
- Created `docs/ops/opensandbox-server.md`
- No `src/` code was changed in OS-1.1

**What this means for OS-1.2:**

- The DSF app service no longer mounts the Docker socket (already done in OS-1.1)
- `src/config/env.validation.ts` still has the legacy `SANDBOX_MEMORY_LIMIT_MB`, `SANDBOX_CPU_LIMIT_PERCENT`, etc. — these remain until OS-3
- `src/config/configuration.ts` still has the legacy `sandbox:` block — remains until OS-3
- No `SandboxModule` or `SandboxService` exists yet in `src/` — we create them from scratch here

### Git Intelligence

Recent commits show the OpenSandbox migration is underway:

- `2029f7e` — `chore: prune obsolete DooD artifacts post migration to OpenSandbox` (pruned planning docs)
- `2202fc0` — `feat: replace DooD with OpenSandbox for secure, provider-agnostic sandbox execution` (updated config files and env.example)
- `5dada1c` — `feat: add agent skill framework with provider-agnostic runner and foundational skills`

The `2202fc0` commit touched `src/config/configuration.ts` and `src/config/env.validation.ts`. Before editing these files, verify current state — particularly:

1. Check if `OPENSANDBOX_*` vars were already partially added in `2202fc0`
2. Check if the `configuration.ts` `sandbox:` block already has an `opensandbox:` note

Run `grep -n "OPENSANDBOX" src/config/env.validation.ts src/config/configuration.ts` before editing to avoid duplicate entries.

### Architecture Context

- **Architecture Decision:** `SandboxModule` is a `@Global()` module — registered once in `AppModule`, injectable everywhere. This mirrors the pattern used by `DatabaseModule` and `LoggerModule`.
- **No provider implementation yet:** `SandboxService` is the infrastructure layer. Provider-specific code (ClaudeCodeProvider, GeminiProvider) comes in OS-2. `runAgentCommand()` is stubbed here with a clear `[OS-1.3]` error message.
- **DockerModule coexists:** Both `DockerModule` and `SandboxModule` exist in `AppModule` until OS-3 deletes the DooD files. `DockerService` still runs and handles execution during OS-1.x — `SandboxService` is added but not yet wired to the execution path.
- **Import alias:** Use `@/sandbox` for cross-module imports (`import { SandboxService } from '@/sandbox'`). The `@/*` wildcard in `tsconfig.json` maps to `src/*` — no tsconfig changes needed.
- **Logger pattern:** Use `private readonly logger = new Logger(SandboxService.name)` from `@nestjs/common` — same as `DockerService`, `ClaudeCodeProvider`, and every service in `src/ai-routing/`. Do NOT inject `LoggerService`; that pattern is reserved for common infrastructure (filters, middleware, interceptors).
- **ConfigService keys:** Use dot-notation with the `configuration.ts` namespace (e.g., `this.config.get<string>('opensandbox.domain')`) — not `process.env` directly in the service.
- **`isHealthy()` method:** Expose this as a public method on `SandboxService` now. `ClaudeCodeProvider.isHealthy()` (OS-2.2, FR-OS18) calls it to verify OpenSandbox connectivity without making Anthropic API calls. It must return `false` on failure, never throw.

### Testing Requirements

**Unit test file:** `src/sandbox/sandbox.service.spec.ts`

Pattern to follow for mocking (no `LoggerService` — use `jest.spyOn` on `Logger.prototype`):

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SandboxService } from './sandbox.service';

// Mock the @alibaba-group/opensandbox SDK (verify exact exports after install)
const mockListSandboxInfos = jest.fn();
const mockGetSandboxInfo = jest.fn();
jest.mock('@alibaba-group/opensandbox', () => ({
  SandboxManager: jest.fn().mockImplementation(() => ({
    listSandboxInfos: mockListSandboxInfos,
    getSandboxInfo: mockGetSandboxInfo,
    // add other methods as needed after inspecting SDK types
  })),
}));

// Spy on Logger — no need to mock the whole class
let warnSpy: jest.SpyInstance;
let logSpy: jest.SpyInstance;

beforeEach(() => {
  warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
});

afterEach(() => {
  jest.restoreAllMocks();
});
```

For `NODE_ENV` branching tests:

```typescript
describe('onModuleInit — production', () => {
  const originalEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });
  // T1: mockListSandboxInfos.mockRejectedValue(new Error('ECONNREFUSED'))
  //     await expect(service.onModuleInit()).rejects.toThrow('OPENSANDBOX_DOMAIN')
});

describe('onModuleInit — development', () => {
  const originalEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });
  // T2: mockListSandboxInfos.mockRejectedValue(new Error('ECONNREFUSED'))
  //     await expect(service.onModuleInit()).resolves.not.toThrow()
  //     expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('OPENSANDBOX_DOMAIN'))
});
```

**Minimum test coverage:** All 10 test cases listed in Task 5.1 must pass. Use `jest.restoreAllMocks()` in `afterEach`.

### Source References

- [Source: _bmad-output/planning-artifacts/prd-opensandbox-migration.md#5.3 SandboxService — Core Abstraction, FR-OS8 through FR-OS13]
- [Source: _bmad-output/planning-artifacts/prd-opensandbox-migration.md#5.1 FR-OS4]
- [Source: _bmad-output/planning-artifacts/prd-opensandbox-migration.md#5.13.2 Variables to ADD]
- [Source: _bmad-output/planning-artifacts/epics.md#Story OS-1.2]
- [Source: _bmad-output/planning-artifacts/epics.md#NFR-OS1, NFR-OS2, NFR-OS9]
- [Source: _bmad-output/implementation-artifacts/os-1-1-opensandbox-server-deployment-ops-documentation.md#Env Vars — Deferred to OS-1.2]
- [Source: src/app.module.ts — DockerModule import pattern to mirror for SandboxModule]
- [Source: src/common/startup/startup-checks.service.ts — OnApplicationBootstrap vs OnModuleInit pattern]
- [Source: src/config/env.validation.ts#line 328 — insertion point for new Joi schemas]
- [Source: src/config/configuration.ts#line 321 — insertion point for new config block]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

### File List
