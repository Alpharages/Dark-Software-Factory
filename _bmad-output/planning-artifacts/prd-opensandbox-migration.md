# PRD: OpenSandbox Migration — Replace DooD with Provider-Agnostic Sandbox Platform

**Version:** 1.2
**Date:** 2026-03-21
**Status:** Draft
**Author:** Product
**Epic ID:** OS (OpenSandbox)

---

## 1. Problem Statement

### 1.1 DooD Security Risk

The current sandbox implementation uses the **Docker-outside-of-Docker (DooD)** pattern: the NestJS application container mounts the host Docker socket (`/var/run/docker.sock`) with read-write access. Any process inside the app container with access to this socket can start, stop, inspect, and modify **all containers on the host** — effectively granting root-level host privileges. This is an unacceptable security posture for a production platform that executes AI-generated code from external AI providers.

### 1.2 Only Two Providers, No Expansion Path

The current system supports only two coding agent providers: **Cursor Headless** and **Claude Code**. Both are hardcoded to the DooD execution layer via `PtyExecutionService`. Adding a new provider (Gemini, Codex, Kimi, or any future CLI tool) requires:

- Building a new PTY wrapper service
- Managing a new TTY/stdin stream
- Updating the resource profile logic
- Integrating a new workspace management path

There is no provider-agnostic interface. Each provider is a one-off implementation.

### 1.3 PTY/TTY Complexity Is Unnecessary

The current execution model spawns interactive terminal sessions (PTY) for Claude CLI and Cursor CLI because both tools were initially assumed to require interactive input. This adds ~1,500 lines of complex stream management code (`PtyExecutionService`, `DockerService`, `WorkspaceService`). In practice, both CLIs — and all other modern coding agent CLIs — support non-interactive headless execution via prompt arguments. The PTY layer is solving a problem that does not exist.

### 1.4 No Network Isolation Per Execution

Docker containers spawned by the current DooD system inherit the bridge network with no per-sandbox egress controls. A compromised or malicious AI agent execution can make arbitrary outbound network requests. There is no per-execution domain allowlist or blocklist.

### 1.5 Dead Environment Variables Accumulate Technical Debt

Over multiple epics (CS1, CS4, CS5, Story 22–23), environment variables have been added and later abandoned without cleanup. The current `.env.example` and `env.validation.ts` contain **22+ variables that are either no longer used or will be entirely replaced** by the OpenSandbox migration. These dead variables confuse new developers, inflate `.env` files, and cause false expectations about what the system does.

### 1.6 Resource Limit Logic Is Hand-Rolled

The current `DockerService` implements its own resource profile system (small/medium/large) by manually calculating `Memory`, `MemorySwap`, `CpuQuota`, and `CpuPeriod` values for Docker `HostConfig`. This duplicates what container orchestration platforms already provide natively.

### 1.7 Cursor Headless Provider Is Not Viable Long-Term

`CURSOR_HEADLESS` depends on a locally installed Cursor binary and undocumented headless mode behavior. It has no official SDK or stable CLI contract. OpenSandbox does not have an official Cursor integration example. This provider should be retired in this migration.

---

## 2. Goals

| #   | Goal                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | Replace the DooD Docker socket mount with OpenSandbox as the exclusive sandbox management layer — NestJS never touches Docker directly     |
| G2  | Add four production-ready coding agent providers: Claude Code, Gemini CLI, OpenAI Codex CLI, and Kimi CLI — all running inside OpenSandbox |
| G3  | Define a single `ICodingAgentProvider` interface so any future AI CLI can be added in ~50 lines of code                                    |
| G4  | Remove all DooD-specific environment variables and dead cursor/workspace variables — clean `.env.example` with only live variables         |
| G5  | Eliminate `PtyExecutionService`, `DockerService`, and `WorkspaceService` — reduce sandbox-related code by ~1,500 lines                     |
| G6  | Add per-sandbox network egress policies to isolate AI execution network access                                                             |
| G7  | Support gVisor or Kata secure container runtime via OpenSandbox for stronger sandbox isolation                                             |

---

## 3. Non-Goals

| #   | Non-Goal                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------ |
| NG1 | Migrating QA automation (linting, testing, security scanning) to OpenSandbox — QA runs separately and is not affected          |
| NG2 | Replacing RabbitMQ queue architecture — queues, consumers, and producers are unchanged                                         |
| NG3 | Changing the execution state machine — states, transitions, and `ExecutionTrackerService` are unchanged                        |
| NG4 | Migrating GitHub integration — `GitHubService` and branch/PR logic are unchanged                                               |
| NG5 | Adding VS Code, browser, or desktop sandboxes — only coding agent CLI execution is in scope                                    |
| NG6 | Kubernetes deployment of OpenSandbox — Docker mode only for this epic; Kubernetes support is future work                       |
| NG7 | OpenAI GPT-4 / Whisper API replacement — `OPENAI_API_KEY` is kept for conversation intelligence (Story 5.5), Codex is separate |
| NG8 | Cursor Headless provider migration — Cursor Headless is retired, not migrated                                                  |
| NG9 | LangGraph or Google ADK workflow integration — future epic                                                                     |

---

## 4. Users & Roles

This is a backend infrastructure migration. There is no direct UI change. However:

| Stakeholder                        | Impact                                                                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Platform Engineer / DevOps**     | Must deploy and operate the **standalone OpenSandbox server** on a dedicated machine; must build and push the `dsf-agents` custom image to a container registry accessible by that server |
| **Developer / AI Engineer**        | Benefits from simplified provider code; can add new providers quickly using `ICodingAgentProvider`                                                                                        |
| **PM / Manager**                   | Indirect benefit: more AI provider options become available in the routing layer                                                                                                          |
| **End User (PM creating tickets)** | No visible change — execution still happens automatically when a ticket reaches the trigger status                                                                                        |

---

## 5. Functional Requirements

### 5.1 OpenSandbox Server — Standalone Deployment

> **Architecture Decision:** OpenSandbox runs on a **dedicated standalone server**, not as a Docker Compose sidecar alongside DSF. DSF connects to it over HTTP/HTTPS via `OPENSANDBOX_DOMAIN`. This means the Docker daemon is entirely on the OpenSandbox server — the DSF server has **zero Docker dependency**.

**FR-OS1:** The OpenSandbox server must be deployed as a standalone service on a dedicated machine (VPS, bare metal, or separate VM). It must:

- Run the official `opensandbox-server` (installed via `uv pip install opensandbox-server`)
- Have Docker Engine installed and running locally on that machine
- Be initialized with a `.sandbox.toml` config file (see FR-OS3)
- Expose its API on a configured port (default: `8080`) reachable from the DSF server
- Be secured with an API key (`OPENSANDBOX_API_KEY`) — no unauthenticated access in production
- Be documented in `docs/ops/opensandbox-server.md` with setup, configuration, and health check instructions

**FR-OS2:** The DSF `app` service Docker Compose definition must have the `/var/run/docker.sock` volume mount **permanently removed**. The DSF application server must have zero Docker socket access. This is enforced by the standalone deployment model — Docker only exists on the OpenSandbox server.

**FR-OS3:** The OpenSandbox server `~/.sandbox.toml` configuration must include:

```toml
[server]
api_key = "<OPENSANDBOX_API_KEY>"
host = "0.0.0.0"
port = 8080

[runtime]
type = "docker"

[docker]
network_mode = "bridge"   # Each sandbox gets an isolated bridge network

[sandbox]
max_timeout_seconds = 3600  # 1 hour max per execution

[secure_container]
# Options: "" (standard Docker), "gvisor", "kata-qemu", "firecracker"
runtime = ""
```

**FR-OS4:** The NestJS `SandboxModule` must connect to the remote OpenSandbox server on startup and validate connectivity via a health ping. Behavior:

- `NODE_ENV=production`: fail startup immediately with a descriptive error if the server is unreachable
- `NODE_ENV=development` / `test`: log a warning and continue (allows local dev without a running sandbox server)

---

### 5.2 Sandbox Base Image

**FR-OS5:** All providers must use `opensandbox/code-interpreter:v1.0.2` as the sandbox image. This image is provided by OpenSandbox and already includes Node.js, npm, Python, and all required build tools. No custom image is needed.

Each provider installs its CLI at runtime as part of the sandbox command sequence:

```
npm i -g @anthropic-ai/claude-code@latest && claude "{{prompt}}"
npm i -g @google/gemini-cli@latest && gemini "{{prompt}}"
npm i -g @openai/codex@latest && codex "{{prompt}}"
```

**FR-OS6:** The `OPENSANDBOX_AGENT_IMAGE` env var must default to `opensandbox/code-interpreter:v1.0.2`. It can be overridden to point to a custom pre-baked image when the team decides to pursue that optimization (see section 15).

> **Why not a custom image yet?** The `code-interpreter` base image covers all needs. A custom pre-baked image is a performance optimization (eliminates ~30–60s CLI install per execution) that is deferred until scale justifies the added complexity of a build/push/registry pipeline. See section 15 for the future optimization spec.

---

### 5.3 SandboxService — Core Abstraction

**FR-OS8:** A new `SandboxService` must be created at `src/sandbox/sandbox.service.ts`. It wraps the `@alibaba-group/opensandbox` JavaScript SDK and exposes methods used by all providers:

```typescript
// Create a sandbox and run a single command, return stdout/stderr
runAgentCommand(options: AgentCommandOptions): Promise<AgentCommandResult>

// Get SandboxInfo for an existing sandbox
getSandboxInfo(sandboxId: string): Promise<SandboxInfo>

// Kill a sandbox forcefully (cleanup on error)
killSandbox(sandboxId: string): Promise<void>

// List all running sandboxes (for monitoring/admin)
listActiveSandboxes(): Promise<SandboxInfo[]>
```

**FR-OS9:** `AgentCommandOptions` interface must include:

```typescript
interface AgentCommandOptions {
  executionId: string; // Used for logging and tracking
  image: string; // Sandbox image (default: opensandbox/code-interpreter:v1.0.2)
  command: string; // Shell command to run (e.g. 'claude "implement feature X"')
  env: Record<string, string>; // Provider-specific env vars (API keys, model names)
  timeoutSeconds: number; // Per-execution TTL
  cpuLimit: string; // Kubernetes-style (e.g. "1", "0.5", "2")
  memoryLimit: string; // Kubernetes-style (e.g. "512Mi", "1Gi", "2Gi")
  networkPolicy?: {
    defaultAction: 'ALLOW' | 'DENY';
    egressRules?: Array<{ target: string }>;
  };
  metadata?: Record<string, string>; // Attached to sandbox for observability
}
```

**FR-OS10:** `AgentCommandResult` interface must include:

```typescript
interface AgentCommandResult {
  sandboxId: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  timedOut: boolean;
}
```

**FR-OS11:** `SandboxService.runAgentCommand()` must:

1. Create a sandbox via `Sandbox.create()` with the provided options
2. Run the command via `sandbox.commands.run()` streaming stdout/stderr via `onStdout` / `onStderr` handlers
3. Stream log lines in real-time to `ExecutionGateway` (WebSocket) using the existing `executionId`
4. On completion, capture full stdout + stderr, exit code, and duration
5. Always kill and close the sandbox in a `finally` block — no sandbox leaks
6. Return `AgentCommandResult`

**FR-OS12:** `SandboxService` must emit Prometheus metrics:

- `opensandbox_executions_total` — counter, labels: `provider`, `status` (success/failed/timeout)
- `opensandbox_execution_duration_seconds` — histogram, labels: `provider`
- `opensandbox_active_sandboxes` — gauge (from `listActiveSandboxes()` on interval)

**FR-OS13:** `SandboxModule` must be a global NestJS module, imported once in `AppModule`. All providers inject `SandboxService` without circular imports.

---

### 5.4 ICodingAgentProvider Interface

**FR-OS14:** A new interface `ICodingAgentProvider` must be defined at `src/ai-routing/interfaces/coding-agent-provider.interface.ts`:

```typescript
interface ICodingAgentProvider {
  readonly providerName: ProviderName;
  readonly isEnabled: boolean;
  isHealthy(): Promise<boolean>;
  execute(payload: IAIExecutionPayload): Promise<IAIExecutionResult>;
}
```

**FR-OS15:** `ProviderName` enum must be updated to:

```typescript
enum ProviderName {
  CLAUDE_CODE = 'CLAUDE_CODE',
  GEMINI = 'GEMINI',
  CODEX = 'CODEX',
  KIMI = 'KIMI',
}
```

The `CURSOR_HEADLESS` value must be removed from the enum. Any existing database rows or RabbitMQ messages referencing `CURSOR_HEADLESS` must be handled by the migration (see FR-OS33).

**FR-OS16:** All four providers must implement `ICodingAgentProvider` and be registered in `ProviderFactoryService` via a provider map keyed by `ProviderName`. `ProviderFactoryService` must no longer hardcode provider selection logic — it reads from the map and filters by `isEnabled`.

---

### 5.5 Claude Code Provider

**FR-OS17:** `ClaudeCodeProvider` must be rewritten to implement `ICodingAgentProvider`. It must:

- Inject `SandboxService` and `ConfigService`
- Read `isEnabled` from `CLAUDE_CODE_ENABLED` env var
- Call `SandboxService.runAgentCommand()` with:
  - `command: claude "${escapedPrompt}"` where `escapedPrompt` is the ticket prompt with double quotes escaped
  - `env.ANTHROPIC_AUTH_TOKEN` = `ANTHROPIC_API_KEY` config value
  - `env.ANTHROPIC_BASE_URL` = `ANTHROPIC_BASE_URL` config value (if set)
  - `env.ANTHROPIC_MODEL` = `ANTHROPIC_MODEL` config value
  - `env.IS_SANDBOX` = `"1"`
  - Resource limits derived from complexity score (see FR-OS28)

**FR-OS18:** `ClaudeCodeProvider.isHealthy()` must call `SandboxService` to check OpenSandbox server connectivity (via `manager.listSandboxInfos({ limit: 0 })`). It must not make any Anthropic API calls for health checks.

---

### 5.6 Gemini CLI Provider

**FR-OS19:** A new `GeminiProvider` must be created at `src/ai-routing/providers/gemini.provider.ts`. It must implement `ICodingAgentProvider` and:

- Read `isEnabled` from `GEMINI_ENABLED` env var (default: `false`)
- Call `SandboxService.runAgentCommand()` with:
  - `command: gemini "${escapedPrompt}"`
  - `env.GEMINI_API_KEY` = `GEMINI_API_KEY` config value
  - `env.GEMINI_BASE_URL` = `GEMINI_BASE_URL` config value (if set)
  - `env.GEMINI_MODEL` = `GEMINI_MODEL` config value (default: `gemini-2.5-pro`)
  - Resource limits derived from complexity score

**FR-OS20:** `GeminiProvider.isHealthy()` must check that `GEMINI_API_KEY` is configured and OpenSandbox is reachable. It must return `false` (not throw) if not configured.

---

### 5.7 OpenAI Codex CLI Provider

**FR-OS21:** A new `CodexProvider` must be created at `src/ai-routing/providers/codex.provider.ts`. It must implement `ICodingAgentProvider` and:

- Read `isEnabled` from `CODEX_ENABLED` env var (default: `false`)
- Call `SandboxService.runAgentCommand()` with:
  - `command: codex "${escapedPrompt}"`
  - `env.OPENAI_API_KEY` = `OPENAI_API_KEY` config value
  - `env.OPENAI_BASE_URL` = `OPENAI_BASE_URL` config value (if set)
  - `env.CODEX_MODEL` = `CODEX_MODEL` config value (default: `codex-1`)
  - Resource limits derived from complexity score

**FR-OS22:** `CodexProvider.isHealthy()` must check that `OPENAI_API_KEY` is configured and OpenSandbox is reachable.

---

### 5.8 Kimi CLI Provider

**FR-OS23:** A new `KimiProvider` must be created at `src/ai-routing/providers/kimi.provider.ts`. It must implement `ICodingAgentProvider` and:

- Read `isEnabled` from `KIMI_ENABLED` env var (default: `false`)
- Call `SandboxService.runAgentCommand()` with:
  - `command: kimi "${escapedPrompt}"`
  - `env.KIMI_API_KEY` = `KIMI_API_KEY` config value
  - `env.KIMI_BASE_URL` = `KIMI_BASE_URL` config value (if set)
  - `env.KIMI_MODEL` = `KIMI_MODEL` config value (default: `kimi-k2`)
  - Resource limits derived from complexity score

**FR-OS24:** `KimiProvider.isHealthy()` must check that `KIMI_API_KEY` is configured and OpenSandbox is reachable.

---

### 5.9 Resource Profile Selection

**FR-OS25:** A `SandboxResourceProfileService` must be created at `src/sandbox/sandbox-resource-profile.service.ts`. It must:

- Accept a complexity score (0–10)
- Return `{ cpuLimit, memoryLimit }` in Kubernetes resource string format

| Complexity Score | Profile  | CPU Limit | Memory Limit |
| ---------------- | -------- | --------- | ------------ |
| 0–3              | `small`  | `"0.5"`   | `"256Mi"`    |
| 4–7              | `medium` | `"1"`     | `"512Mi"`    |
| 8–10             | `large`  | `"2"`     | `"1Gi"`      |

**FR-OS26:** All providers must call `SandboxResourceProfileService.getProfile(complexityScore)` to get CPU and memory limits. No provider hardcodes resource values.

**FR-OS27:** The `OPENSANDBOX_DEFAULT_CPU_LIMIT` and `OPENSANDBOX_DEFAULT_MEMORY_LIMIT` env vars override the `medium` profile defaults, allowing operators to tune without code changes.

---

### 5.10 AI Routing Updates

**FR-OS28:** `AIRoutingService` must be updated to route across all four providers. Routing strategy:

1. **Enabled check** — only route to providers where `isEnabled = true`
2. **Health check** — skip providers returning `isHealthy() = false`
3. **Complexity routing** (default strategy):
   - Score 0–3: prefer `KIMI` (fastest/cheapest) → fallback `CLAUDE_CODE`
   - Score 4–7: prefer `CLAUDE_CODE` → fallback `GEMINI`
   - Score 8–10: prefer `CLAUDE_CODE` → fallback `CODEX`
4. **Override** — `AI_PRIMARY_PROVIDER` env var forces a specific primary provider regardless of score

**FR-OS29:** `FallbackStrategyService` must work with any `ICodingAgentProvider`. It must not contain any provider-specific logic. The existing fallback loop (primary → fallback → DLQ) is unchanged.

**FR-OS30:** `ProviderHealthService` circuit breaker must work with the new provider names. Any `ProviderName` value is valid input — no hardcoded checks for `CURSOR_HEADLESS` or `CLAUDE_CODE`.

---

### 5.11 Cursor Headless Provider — Retirement

**FR-OS31:** `CursorHeadlessProvider` and all supporting files must be deleted:

- `src/ai-routing/providers/cursor-headless.provider.ts`
- `src/ai-routing/services/cursor-headless.service.ts` (if exists)
- Any cursor-specific workspace or process management services

**FR-OS32:** `CURSOR_HEADLESS` must be removed from `ProviderName` enum and from all switch statements, routing maps, and factory registries.

**FR-OS33:** A Prisma migration must be created to handle existing database rows:

- `Execution` records with `provider = 'CURSOR_HEADLESS'` must be updated to `provider = 'CLAUDE_CODE'` (best equivalent)
- This is a one-time data migration, not a schema change

---

### 5.12 Code Deletion — DooD Layer

**FR-OS34:** The following files must be deleted in their entirety:

| File                                                           | Reason                                      |
| -------------------------------------------------------------- | ------------------------------------------- |
| `src/docker/docker.service.ts`                                 | Replaced by `SandboxService`                |
| `src/docker/docker.module.ts`                                  | Replaced by `SandboxModule`                 |
| `src/docker/workspace.service.ts`                              | OpenSandbox manages workspace lifecycle     |
| `src/docker/interfaces/resource-profile.interface.ts`          | Replaced by `SandboxResourceProfileService` |
| `src/docker/interfaces/run-container-options.interface.ts`     | No longer needed                            |
| `src/docker/interfaces/exec-in-container-options.interface.ts` | No longer needed                            |
| `src/ai-routing/services/pty-execution.service.ts`             | No PTY needed                               |

**FR-OS35:** `DockerModule` must be removed from `AppModule` imports. All NestJS module files that import `DockerModule` must be updated to import `SandboxModule` instead.

**FR-OS36:** All Prometheus metric providers for the old DooD metrics must be removed:

- `sandbox_container_memory_limit_bytes`
- `sandbox_container_cpu_limit_percent`
- `sandbox_container_oom_events_total`
- `sandbox_container_cpu_throttled_seconds_total`
- `sandbox_container_memory_usage_bytes`

These are replaced by the new OpenSandbox metrics defined in FR-OS12.

---

### 5.13 Environment Variable Cleanup

#### 5.13.1 Variables to REMOVE

The following environment variables must be removed from `.env.example`, `env.validation.ts`, and `src/config/configuration.ts`. They are no longer used after the DooD removal and Cursor retirement.

**DooD / Docker Direct Variables (all removed):**

| Variable                           | Reason for Removal                                                 |
| ---------------------------------- | ------------------------------------------------------------------ |
| `DOCKER_SOCKET_PATH`               | NestJS no longer connects to Docker daemon directly                |
| `DOCKER_CONNECTION_RETRY_ATTEMPTS` | DooD connection retry logic deleted                                |
| `DOCKER_CONNECTION_RETRY_DELAY_MS` | DooD connection retry logic deleted                                |
| `ENABLE_CONTAINER_EXECUTION`       | DooD feature flag — all execution now goes through OpenSandbox     |
| `DOCKER_CONTAINER_TIMEOUT_MS`      | Replaced by `OPENSANDBOX_SANDBOX_TIMEOUT_S`                        |
| `DOCKER_MAX_CONCURRENT`            | Replaced by `OPENSANDBOX_MAX_CONCURRENT`                           |
| `SANDBOX_WORKSPACES_ROOT`          | OpenSandbox manages workspace directories internally               |
| `SANDBOX_LOGS_ROOT`                | OpenSandbox manages log directories internally                     |
| `SANDBOX_ENABLE_RESOURCE_LIMITS`   | OpenSandbox always enforces resource limits; master switch removed |
| `SANDBOX_MEMORY_LIMIT_MB`          | Replaced by `OPENSANDBOX_DEFAULT_MEMORY_LIMIT`                     |
| `SANDBOX_CPU_LIMIT_PERCENT`        | Replaced by `OPENSANDBOX_DEFAULT_CPU_LIMIT`                        |
| `SANDBOX_MEMORY_SWAP_LIMIT_MB`     | OpenSandbox handles swap policy internally                         |

**Cursor Headless Variables (all removed — provider retired):**

| Variable                            | Reason for Removal                                                 |
| ----------------------------------- | ------------------------------------------------------------------ |
| `CURSOR_HEADLESS_ENABLED`           | Provider retired                                                   |
| `CURSOR_HEADLESS_HEALTH_URL`        | Provider retired                                                   |
| `CURSOR_HEADLESS_TIMEOUT`           | Provider retired                                                   |
| `CURSOR_HEADLESS_TIMEOUT_MS`        | Provider retired                                                   |
| `CURSOR_MAX_CONCURRENT`             | Provider retired                                                   |
| `CURSOR_MAX_CONCURRENT_WORKSPACES`  | Provider retired                                                   |
| `CURSOR_CLI_PATH`                   | Provider retired                                                   |
| `CURSOR_WORKSPACES_ROOT`            | Provider retired                                                   |
| `CURSOR_PRESERVE_FAILED_WORKSPACES` | Provider retired                                                   |
| `CURSOR_WORKSPACE_CLEANUP_AGE_MS`   | Provider retired                                                   |
| `CURSOR_GIT_USER_NAME`              | Provider retired                                                   |
| `CURSOR_GIT_USER_EMAIL`             | Provider retired                                                   |
| `CURSOR_API_KEY`                    | Was already dead (Cursor OAuth not implemented); now fully removed |

**Dead Variables (pre-existing, never wired up):**

| Variable                 | Reason for Removal                                                           |
| ------------------------ | ---------------------------------------------------------------------------- |
| `WINDSURF_API_KEY`       | Windsurf provider was never implemented; variable has been dead since Epic 2 |
| `LOG_STREAM_THROTTLE_MS` | WebSocket throttle for DooD log streaming — no longer applicable             |

**Claude API Variables Superseded by CLI Execution:**

| Variable                 | Reason for Removal                                                                                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE_WORKSPACES_ROOT` | Workspace directories managed by OpenSandbox, not NestJS                                                                                                                            |
| `ANTHROPIC_MAX_TOKENS`   | Direct SDK token limit — Claude Code CLI manages its own token usage. Note: if direct Anthropic SDK calls remain for commit messages / complexity scoring, retain this; see FR-OS43 |
| `ANTHROPIC_TIMEOUT_MS`   | Replaced by `OPENSANDBOX_SANDBOX_TIMEOUT_S` for CLI execution. Same note as above                                                                                                   |

> **Note on `ANTHROPIC_MAX_TOKENS` and `ANTHROPIC_TIMEOUT_MS`:** If `AICostTrackerService`, `ComplexityScorerService`, or any other service makes direct Anthropic SDK calls (not via CLI), these variables must be retained under the `anthropic.direct` config namespace. This is determined during implementation.

#### 5.13.2 Variables to ADD

**OpenSandbox Server Connection:**

| Variable                             | Type          | Required   | Default                               | Description                                                                                                                        |
| ------------------------------------ | ------------- | ---------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `OPENSANDBOX_DOMAIN`                 | `string`      | Yes        | `localhost:8080`                      | OpenSandbox server address (host:port, no scheme)                                                                                  |
| `OPENSANDBOX_API_KEY`                | `string`      | Yes (prod) | `""`                                  | API key for OpenSandbox server authentication                                                                                      |
| `OPENSANDBOX_PROTOCOL`               | `http\|https` | No         | `http`                                | Protocol for OpenSandbox server communication                                                                                      |
| `OPENSANDBOX_REQUEST_TIMEOUT_MS`     | `number`      | No         | `60000`                               | HTTP request timeout for sandbox management calls                                                                                  |
| `OPENSANDBOX_AGENT_IMAGE`            | `string`      | No         | `opensandbox/code-interpreter:v1.0.2` | Docker image used for all agent sandbox executions. Override with a custom pre-baked image for faster cold-starts (see section 15) |
| `OPENSANDBOX_SANDBOX_TIMEOUT_S`      | `number`      | No         | `3600`                                | Maximum sandbox lifetime in seconds (default: 1 hour)                                                                              |
| `OPENSANDBOX_MAX_CONCURRENT`         | `number`      | No         | `10`                                  | Maximum number of sandboxes running simultaneously                                                                                 |
| `OPENSANDBOX_DEFAULT_CPU_LIMIT`      | `string`      | No         | `"1"`                                 | Default CPU limit for `medium` resource profile                                                                                    |
| `OPENSANDBOX_DEFAULT_MEMORY_LIMIT`   | `string`      | No         | `"512Mi"`                             | Default memory limit for `medium` resource profile                                                                                 |
| `OPENSANDBOX_SECURE_RUNTIME`         | `string`      | No         | `""`                                  | Secure container runtime: `""` (standard), `gvisor`, `kata-qemu`, `firecracker`                                                    |
| `OPENSANDBOX_NETWORK_DEFAULT_ACTION` | `ALLOW\|DENY` | No         | `ALLOW`                               | Default egress policy for sandboxes                                                                                                |

**Gemini Provider:**

| Variable          | Type      | Required    | Default          | Description                                               |
| ----------------- | --------- | ----------- | ---------------- | --------------------------------------------------------- |
| `GEMINI_ENABLED`  | `boolean` | No          | `false`          | Enable Gemini CLI provider                                |
| `GEMINI_API_KEY`  | `string`  | Conditional | `""`             | Google Gemini API key (required if `GEMINI_ENABLED=true`) |
| `GEMINI_BASE_URL` | `string`  | No          | `""`             | Custom Gemini API endpoint (optional, for proxies)        |
| `GEMINI_MODEL`    | `string`  | No          | `gemini-2.5-pro` | Gemini model to use                                       |

**OpenAI Codex Provider:**

| Variable          | Type      | Required | Default   | Description                                        |
| ----------------- | --------- | -------- | --------- | -------------------------------------------------- |
| `CODEX_ENABLED`   | `boolean` | No       | `false`   | Enable OpenAI Codex CLI provider                   |
| `OPENAI_BASE_URL` | `string`  | No       | `""`      | Custom OpenAI API endpoint (optional, for proxies) |
| `CODEX_MODEL`     | `string`  | No       | `codex-1` | Codex model to use                                 |

> **Note:** `OPENAI_API_KEY` already exists (Story 5.5 for Whisper/GPT-4). It is reused for Codex. No new API key variable is added.

**Kimi Provider:**

| Variable           | Type      | Required    | Default   | Description                                                     |
| ------------------ | --------- | ----------- | --------- | --------------------------------------------------------------- |
| `KIMI_ENABLED`     | `boolean` | No          | `false`   | Enable Kimi CLI provider                                        |
| `KIMI_API_KEY`     | `string`  | Conditional | `""`      | Moonshot AI Kimi API key (required if `KIMI_ENABLED=true`)      |
| `KIMI_BASE_URL`    | `string`  | No          | `""`      | Custom Kimi API endpoint (optional)                             |
| `KIMI_MODEL`       | `string`  | No          | `kimi-k2` | Kimi model to use                                               |
| `KIMI_CLI_PACKAGE` | `string`  | No          | TBD       | npm package name for Kimi CLI (used in Dockerfile.agents build) |

**AI Routing:**

| Variable              | Type     | Required | Default | Description                                                                                                                            |
| --------------------- | -------- | -------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_PRIMARY_PROVIDER` | `string` | No       | `""`    | Force a specific primary provider regardless of complexity score (`CLAUDE_CODE`, `GEMINI`, `CODEX`, `KIMI`). Empty = use routing logic |

#### 5.13.3 Variables to KEEP (Unchanged)

The following variables are kept as-is. They are either still needed for their original purpose or are passed through to sandbox environments as provider credentials:

| Variable                                         | Kept Because                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                              | Passed to Claude Code sandbox as `ANTHROPIC_AUTH_TOKEN`; may also be used for direct Anthropic SDK calls            |
| `ANTHROPIC_BASE_URL`                             | Passed to Claude Code sandbox; also used by direct SDK calls                                                        |
| `ANTHROPIC_MODEL`                                | Passed to Claude Code sandbox; also used by direct SDK calls                                                        |
| `ANTHROPIC_COMMIT_MESSAGE_MODEL`                 | Used by `GitHubService` for commit message generation via direct Anthropic SDK                                      |
| `CLAUDE_CODE_ENABLED`                            | Kept — now means "enable Claude Code as a sandbox provider"                                                         |
| `CLAUDE_CODE_TIMEOUT`                            | Kept as the timeout hint for Claude execution (maps to sandbox TTL if shorter than `OPENSANDBOX_SANDBOX_TIMEOUT_S`) |
| `CLAUDE_MAX_CONCURRENT`                          | Kept as a per-provider concurrency cap within the global `OPENSANDBOX_MAX_CONCURRENT`                               |
| `OPENAI_API_KEY`                                 | Kept for Story 5.5 (Whisper/GPT-4) and reused for Codex                                                             |
| `AI_COMPLEXITY_THRESHOLD`                        | Kept — routing threshold unchanged                                                                                  |
| `AI_CONFIDENCE_THRESHOLD`                        | Kept — decision audit unchanged                                                                                     |
| `AI_COST_OPTIMIZATION_ENABLED`                   | Kept — cost optimization unchanged                                                                                  |
| All `DATABASE_URL`, `RABBITMQ_URL`, `JWT_SECRET` | Core infrastructure, unchanged                                                                                      |
| All `GITHUB_*` variables                         | GitHub integration unchanged                                                                                        |
| All `CLICKUP_*` variables                        | ClickUp integration unchanged                                                                                       |
| All `QA_*`, `QG_*`, `SECURITY_*` variables       | QA automation unchanged                                                                                             |
| All `SENTRY_*`, `LOG_*` variables                | Monitoring unchanged                                                                                                |
| All `SMTP_*` variables                           | Email unchanged                                                                                                     |
| All `WEBHOOK_*` variables                        | Webhook handling unchanged                                                                                          |
| All `GIT_MIRROR_*` variables                     | Git mirroring unchanged                                                                                             |
| All `CLEANUP_*` variables                        | Container cleanup (used by `CleanupService`) — check if still relevant post-migration                               |
| `REDIS_URL`, `REDIS_*`                           | Redis caching unchanged                                                                                             |

---

### 5.14 Configuration Module Updates

**FR-OS37:** `env.validation.ts` must be updated:

- Remove all deleted variables' Joi schemas
- Add Joi schemas for all new `OPENSANDBOX_*`, `GEMINI_*`, `CODEX_*`, `KIMI_*` variables with appropriate types, defaults, and conditional requirements

**FR-OS38:** `configuration.ts` must be updated:

- Remove the `cursor` config block entirely
- Remove `sandbox.resourceLimits`, `sandbox.workspacesRoot`, `sandbox.logsRoot`, `sandbox.containerTimeoutMs`, `sandbox.containerExecutionEnabled`, `sandbox.maxConcurrent`
- Add a new `opensandbox` config block:

```typescript
opensandbox: {
  domain: process.env.OPENSANDBOX_DOMAIN || 'localhost:8080',
  apiKey: process.env.OPENSANDBOX_API_KEY || '',
  protocol: process.env.OPENSANDBOX_PROTOCOL || 'http',
  requestTimeoutMs: parseInt(process.env.OPENSANDBOX_REQUEST_TIMEOUT_MS || '60000', 10),
  agentImage: process.env.OPENSANDBOX_AGENT_IMAGE || 'opensandbox/code-interpreter:v1.0.2',
  sandboxTimeoutSeconds: parseInt(process.env.OPENSANDBOX_SANDBOX_TIMEOUT_S || '3600', 10),
  maxConcurrent: parseInt(process.env.OPENSANDBOX_MAX_CONCURRENT || '10', 10),
  defaultCpuLimit: process.env.OPENSANDBOX_DEFAULT_CPU_LIMIT || '1',
  defaultMemoryLimit: process.env.OPENSANDBOX_DEFAULT_MEMORY_LIMIT || '512Mi',
  secureRuntime: process.env.OPENSANDBOX_SECURE_RUNTIME || '',
  networkDefaultAction: process.env.OPENSANDBOX_NETWORK_DEFAULT_ACTION || 'ALLOW',
},
```

- Add `gemini`, `codex`, `kimi` config blocks following the same pattern as the existing `anthropic` block

**FR-OS39:** `.env.example` must be regenerated with:

- A clean `# OPENSANDBOX CONFIGURATION` section replacing the `# DOCKER CLIENT CONFIGURATION` and `# SANDBOX RESOURCE LIMIT ENFORCEMENT` and `# AI PROVIDER CONTAINER EXECUTION` sections
- A clean `# GEMINI PROVIDER`, `# CODEX PROVIDER`, `# KIMI PROVIDER` sections
- All removed variables deleted
- All new variables added with comments explaining each
- Zero dead variables remaining

---

### 5.15 Cleanup Service Review

**FR-OS40:** `CleanupService` (`src/cleanup/`) currently handles Docker container and workspace cleanup. It must be reviewed:

- Container cleanup logic that calls `DockerService` must be removed (OpenSandbox handles its own cleanup via TTL)
- Workspace directory cleanup that references `SANDBOX_WORKSPACES_ROOT` must be removed
- If `CleanupService` has other cleanup responsibilities unrelated to Docker (e.g., old log files, temp uploads), those must be preserved
- `ENABLE_AUTO_CLEANUP`, `CLEANUP_*` env vars must be evaluated — remove those that only applied to Docker containers; keep those that apply to remaining cleanup jobs

---

### 5.16 DooD Dead Code — Complete Removal Checklist

> **This section is mandatory.** Once OpenSandbox is confirmed working end-to-end (Phase 5 of the migration sequence), every item listed here must be deleted. No DooD code may remain in the codebase. This is not optional cleanup — leaving dead code creates confusion for future developers and risks someone accidentally re-enabling the old pattern.

#### 5.16.1 Files to Delete Entirely

| File                                                           | What it does (was)                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/docker/docker.service.ts`                                 | Core dockerode wrapper — connects to `/var/run/docker.sock`, creates/starts/kills containers |
| `src/docker/docker.module.ts`                                  | NestJS module that registers DockerService                                                   |
| `src/docker/workspace.service.ts`                              | Creates `/workspaces/{ticketId}` directories with chmod 777                                  |
| `src/docker/interfaces/resource-profile.interface.ts`          | small/medium/large container resource profiles                                               |
| `src/docker/interfaces/run-container-options.interface.ts`     | Options for DockerService.runContainer()                                                     |
| `src/docker/interfaces/exec-in-container-options.interface.ts` | Options for DockerService.execInContainer()                                                  |
| `src/docker/interfaces/container-stream-options.interface.ts`  | TTY stream attachment options                                                                |
| `src/docker/` _(entire directory)_                             | If empty after above deletions, remove the directory                                         |
| `src/ai-routing/services/pty-execution.service.ts`             | PTY/TTY terminal spawning — the DooD execution core                                          |
| `src/ai-routing/providers/cursor-headless.provider.ts`         | Cursor Headless provider (retired)                                                           |

#### 5.16.2 npm Dependencies to Remove

| Package            | Used by               | Remove when                              |
| ------------------ | --------------------- | ---------------------------------------- |
| `dockerode`        | `DockerService`       | After `src/docker/` deleted              |
| `node-pty`         | `PtyExecutionService` | After `pty-execution.service.ts` deleted |
| `@types/dockerode` | TypeScript types      | After `dockerode` removed                |

Run `pnpm remove dockerode node-pty @types/dockerode` after deleting the files.

#### 5.16.3 Imports to Remove from Existing Files

| File                                                        | Import to remove                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------- |
| `src/app.module.ts`                                         | `DockerModule` import and registration                      |
| `src/cleanup/cleanup.module.ts`                             | `DockerModule` import                                       |
| `src/cleanup/cleanup.service.ts`                            | `DockerService`, `WorkspaceService` injection and all usage |
| `src/qa-automation/qa-orchestrator.service.ts`              | `WorkspaceService` injection and all usage                  |
| `src/github/services/pr-risk-assessor.service.ts`           | `WorkspaceService` injection and all usage                  |
| `src/github/services/github-commit-orchestrator.service.ts` | `WorkspaceService` injection and all usage                  |
| `src/github/services/github-push-trigger.consumer.ts`       | `WorkspaceService` injection and all usage                  |

#### 5.16.4 docker-compose.yml Changes

| Change                               | File                     | What to remove                                                    |
| ------------------------------------ | ------------------------ | ----------------------------------------------------------------- |
| Delete Docker socket mount           | `docker-compose.yml`     | `- /var/run/docker.sock:/var/run/docker.sock` under `app.volumes` |
| Delete Docker socket mount           | `docker-compose.dev.yml` | Same line                                                         |
| Remove `dockerode` healthcheck logic | Any compose healthcheck  | Any reference to Docker daemon from app container                 |

#### 5.16.5 Prometheus Metrics to Remove

These metrics are emitted by `DockerService` and will error once that service is deleted. Remove their metric providers from `docker.module.ts` before deleting the file:

| Metric name                                     | Remove from                             |
| ----------------------------------------------- | --------------------------------------- |
| `sandbox_container_memory_limit_bytes`          | `docker.module.ts` Prometheus providers |
| `sandbox_container_cpu_limit_percent`           | `docker.module.ts` Prometheus providers |
| `sandbox_container_oom_events_total`            | `docker.module.ts` Prometheus providers |
| `sandbox_container_cpu_throttled_seconds_total` | `docker.module.ts` Prometheus providers |
| `sandbox_container_memory_usage_bytes`          | `docker.module.ts` Prometheus providers |

#### 5.16.6 Environment Variables to Remove from All Config Files

These must be removed from `env.validation.ts`, `configuration.ts`, `.env.example`, and `.env.prod` once OpenSandbox is live:

**DooD / Docker vars:**
`DOCKER_SOCKET_PATH`, `ENABLE_CONTAINER_EXECUTION`, `DOCKER_CONTAINER_TIMEOUT_MS`, `DOCKER_MAX_CONCURRENT`, `SANDBOX_WORKSPACES_ROOT`, `SANDBOX_LOGS_ROOT`, `SANDBOX_MEMORY_LIMIT_MB`, `SANDBOX_CPU_LIMIT_PERCENT`

**Cursor vars (provider retired):**
`CURSOR_HEADLESS_ENABLED`, `CURSOR_HEADLESS_TIMEOUT_MS`, `CURSOR_MAX_CONCURRENT_WORKSPACES`, `CURSOR_CLI_PATH`, `CURSOR_WORKSPACES_ROOT`, `CURSOR_PRESERVE_FAILED_WORKSPACES`, `CURSOR_WORKSPACE_CLEANUP_AGE_MS`, `CURSOR_GIT_USER_NAME`, `CURSOR_GIT_USER_EMAIL`

**Claude workspace vars (workspace management moved to OpenSandbox):**
`CLAUDE_WORKSPACES_ROOT`, `ANTHROPIC_MAX_TOKENS` _(if no direct SDK calls remain)_, `ANTHROPIC_TIMEOUT_MS` _(if no direct SDK calls remain)_

#### 5.16.7 Verification — Definition of Done for Dead Code Removal

All of the following `grep` checks must return zero results before the dead code removal story is considered complete:

```bash
# Must find nothing
grep -r "DockerService"       src/ --include="*.ts"
grep -r "WorkspaceService"    src/ --include="*.ts"
grep -r "PtyExecutionService" src/ --include="*.ts"
grep -r "DockerModule"        src/ --include="*.ts"
grep -r "CURSOR_HEADLESS"     src/ --include="*.ts"
grep -r "docker.sock"         docker-compose*.yml
grep -r "dockerode"           src/ --include="*.ts"
grep -r "node-pty"            src/ --include="*.ts"
```

If any of these return results, the story is not complete.

---

## 6. Non-Functional Requirements

### 6.1 Startup Validation

**NFR-OS1:** On `onModuleInit`, `SandboxService` must ping the OpenSandbox server. Total startup wait must not exceed 10 seconds. If ping fails, behavior depends on `NODE_ENV`:

- `production`: throw, abort startup
- `development` / `test`: log warning, continue

### 6.2 Sandbox Leak Prevention

**NFR-OS2:** Every `SandboxService.runAgentCommand()` call must use a `try/finally` pattern ensuring `sandbox.kill()` and `sandbox.close()` are always called, even on exceptions. No orphaned sandboxes.

**NFR-OS3:** A background job (every 5 minutes) must call `manager.listSandboxInfos({ state: 'Running' })` and kill any sandbox older than `OPENSANDBOX_SANDBOX_TIMEOUT_S * 1.5` seconds — a safety net for leaked sandboxes.

### 6.3 Concurrency

**NFR-OS4:** `SandboxService` must enforce `OPENSANDBOX_MAX_CONCURRENT` using a `Semaphore`. If the limit is reached, new sandbox requests must wait (queue) rather than reject. Queue depth must be logged and emitted as a Prometheus metric.

### 6.4 Security

**NFR-OS5:** API keys passed to sandbox environments (`ANTHROPIC_AUTH_TOKEN`, `GEMINI_API_KEY`, etc.) must never appear in logs. They must be redacted in any log output from `SandboxService`.

**NFR-OS6:** The `OPENSANDBOX_API_KEY` must be treated as a secret — sourced from environment / Docker secrets, never committed to version control.

**NFR-OS7:** The DSF `app` service must have zero Docker socket access. Because OpenSandbox runs on a separate standalone server, Docker is not installed on the DSF server at all. The `/var/run/docker.sock` volume mount must be permanently deleted from `docker-compose.yml` — not commented out. This is a hard requirement: any future developer must not re-add it.

### 6.5 Performance

**NFR-OS8:** Using `opensandbox/code-interpreter:v1.0.2` with runtime CLI install, sandbox cold-start time (from `Sandbox.create()` to CLI binary ready) must be acceptable for production use. Expected durations:

- Image pull (first run): ~60–120 seconds (one-time; image cached after first pull)
- Container start + CLI install (`npm i -g @anthropic-ai/claude-code@latest`): ~30–60 seconds
- Container start with image already pulled + CLI already installed (warm image): ~3–5 seconds

The `opensandbox/code-interpreter:v1.0.2` image must be pre-pulled on the OpenSandbox server before go-live to eliminate the first-run pull delay. The CLI install time (~30–60s) is an accepted cost in the initial implementation. See section 15 for the custom pre-baked image optimization that eliminates this cost when scale justifies it.

### 6.6 Observability

**NFR-OS9:** Every sandbox execution must log:

- Sandbox ID
- Provider name
- Execution ID
- Duration (ms)
- Exit code
- Whether it timed out
- stdout/stderr length (bytes, not content — avoid logging sensitive code)

---

## 7. Architecture Overview

### Before (DooD)

```
DSF Server
└── NestJS App Container
    ├── /var/run/docker.sock (host socket, rw)  ← SECURITY RISK
    ├── DockerService (dockerode)
    │   └── spawns → dsf-agent-base container (per ticket)
    │       ├── PtyExecutionService (TTY stream)
    │       ├── ClaudeCodeProvider or CursorHeadlessProvider
    │       └── /workspaces/{ticketId} (bind mount)
    └── WorkspaceService (mkdir, chmod 777)
```

### After (OpenSandbox — Standalone Server)

```
DSF Server                                  OpenSandbox Server (standalone machine)
├── NestJS App                              ├── opensandbox-server (FastAPI)
│   └── SandboxService                      │   └── Docker Engine
│       └── HTTP/HTTPS ─────────────────────│       └── /var/run/docker.sock
│           OPENSANDBOX_DOMAIN=             │           └── spawns → code-interpreter (per ticket)
│           sandbox.company.com:8080        │               ├── npm i -g claude-code && claude "{{prompt}}"
│                                           │               ├── gemini "{{prompt}}"
│                                           │               ├── codex "{{prompt}}"
│                                           │               └── kimi "{{prompt}}"
│
└── No Docker installed. No socket. Ever.
```

**Key points:**

- DSF server has **no Docker dependency** — no Docker Engine, no socket, no dockerode npm package
- The OpenSandbox server is the only machine that runs containers
- DSF → OpenSandbox communication is HTTP/HTTPS over the network, secured by `OPENSANDBOX_API_KEY`
- The `opensandbox/code-interpreter:v1.0.2` base image must be pre-pulled on the OpenSandbox server
- CLIs are installed at runtime per execution (no custom image required)
- Network egress policies on OpenSandbox control what the agent containers can reach

### Provider Selection Flow (Updated)

```
ClickUp Webhook
  → ticket-intake-queue
  → AIRoutingConsumer
      → ComplexityScorerService (score: 0-10)
      → AIRoutingService
          ├── KIMI       (score 0-3, if enabled)    [cheapest]
          ├── CLAUDE_CODE (score 4-7, if enabled)   [balanced]
          └── CODEX/GEMINI (score 8-10, if enabled) [powerful]
      → ai-execution-queue
          → AIExecutionConsumer
              → OrchestratorService
                  → ProviderFactoryService.select(ProviderName)
                  → FallbackStrategyService.executeWithFallback()
                      → ClaudeCodeProvider / GeminiProvider / CodexProvider / KimiProvider
                          → SandboxService.runAgentCommand()
                              → OpenSandbox HTTP API
                                  → code-interpreter container
                                      → npm install CLI + claude/gemini/codex/kimi CLI
  → qa-check-queue (unchanged)
  → deployment-queue (unchanged)
```

---

## 8. File Change Summary

### Files to DELETE

```
src/docker/
  docker.service.ts
  docker.module.ts
  workspace.service.ts
  interfaces/resource-profile.interface.ts
  interfaces/run-container-options.interface.ts
  interfaces/exec-in-container-options.interface.ts
  interfaces/container-stream-options.interface.ts
  interfaces/ (entire directory if empty after deletion)

src/ai-routing/services/
  pty-execution.service.ts

src/ai-routing/providers/
  cursor-headless.provider.ts
```

### Files to CREATE

```
src/sandbox/
  sandbox.module.ts
  sandbox.service.ts
  sandbox-resource-profile.service.ts
  interfaces/
    agent-command-options.interface.ts
    agent-command-result.interface.ts

src/ai-routing/interfaces/
  coding-agent-provider.interface.ts

src/ai-routing/providers/
  gemini.provider.ts
  codex.provider.ts
  kimi.provider.ts

docs/ops/
  opensandbox-server.md

prisma/migrations/
  {timestamp}_retire_cursor_headless_provider/
    migration.sql
```

### Files to UPDATE

```
src/ai-routing/providers/claude-code.provider.ts     (rewrite)
src/ai-routing/services/provider-factory.service.ts  (add new providers, remove Cursor)
src/ai-routing/services/ai-routing.service.ts        (new routing strategy)
src/ai-routing/enums/provider-name.enum.ts           (remove CURSOR_HEADLESS, add GEMINI/CODEX/KIMI)
src/execution/services/execution-tracker.service.ts  (remove DockerModule dep if any)
src/app.module.ts                                     (replace DockerModule with SandboxModule)
src/config/configuration.ts                          (remove cursor/sandbox, add opensandbox/gemini/codex/kimi)
src/config/env.validation.ts                         (remove dead vars, add new vars)
.env.example                                          (full rewrite of sandbox/provider sections)
docker-compose.yml                                    (remove Docker socket from app — no opensandbox sidecar)
docker-compose.dev.yml                                (same change)
```

---

## 9. Dependencies

| Dependency                   | Action                                           | Version  |
| ---------------------------- | ------------------------------------------------ | -------- |
| `@alibaba-group/opensandbox` | **Add** to `dependencies`                        | `^0.1.5` |
| `dockerode`                  | **Remove** from `dependencies`                   | —        |
| `node-pty`                   | **Remove** from `dependencies` (if no other use) | —        |
| `rxjs`                       | **Keep** (used elsewhere)                        | —        |
| `semaphore` or equivalent    | **Keep** (reused in SandboxService)              | —        |

---

## 10. Migration Sequence

The implementation must proceed in this order to maintain a working system throughout:

### Phase 1 — Standalone OpenSandbox Server Setup (ops work, no DSF code change)

1. Provision a dedicated server (VPS or VM) for OpenSandbox
2. Install Docker Engine on the OpenSandbox server
3. Install `opensandbox-server` via `uv pip install opensandbox-server`
4. Configure `~/.sandbox.toml` with API key, Docker runtime, and bridge networking
5. Pull `opensandbox/code-interpreter:v1.0.2` on the OpenSandbox server — confirm it runs
6. Start `opensandbox-server` and verify it is reachable from the DSF server via `OPENSANDBOX_DOMAIN`
7. Write `docs/ops/opensandbox-server.md` — setup, config reference, health check, restart procedure

### Phase 2 — DSF SandboxModule (parallel with Phase 1, no provider change yet)

1. Add `@alibaba-group/opensandbox` npm dependency
2. Create `SandboxModule` + `SandboxService` (stub: validates connectivity, logs but doesn't execute)
3. Add all new `OPENSANDBOX_*`, `GEMINI_*`, `CODEX_*`, `KIMI_*` env vars to `env.validation.ts` and `configuration.ts`
4. Confirm `pnpm typecheck` and `pnpm lint` pass

### Phase 3 — ClaudeCode Provider Migration

1. Rewrite `ClaudeCodeProvider` to use `SandboxService` instead of `PtyExecutionService`
2. Test end-to-end: ClickUp ticket → Claude Code running in OpenSandbox container → output captured
3. Validate execution state machine transitions (IN_PROGRESS → COMPLETED) work correctly
4. Validate cost tracking still receives token data from stdout output

### Phase 4 — DooD Dead Code Removal

> **This phase is the most important cleanup phase. Do not skip or defer it.**

1. Delete all files listed in section 5.16.1 (`DockerService`, `WorkspaceService`, `PtyExecutionService`, etc.)
2. Remove all imports listed in section 5.16.3 from dependent files (`CleanupService`, `QAOrchestratorService`, GitHub services)
3. Run `pnpm remove dockerode node-pty @types/dockerode`
4. Remove `/var/run/docker.sock` mount from `docker-compose.yml` and `docker-compose.dev.yml`
5. Remove all DooD Prometheus metric providers (section 5.16.5)
6. Run all grep checks from section 5.16.7 — all must return zero results
7. Run `pnpm typecheck` and `pnpm test` — must pass with zero errors

### Phase 5 — New Providers

1. Add `GeminiProvider` (deploy with `GEMINI_ENABLED=false` — dark deploy, enable when ready)
2. Add `CodexProvider` (deploy with `CODEX_ENABLED=false` — dark deploy)
3. Add `KimiProvider` (deploy with `KIMI_ENABLED=false` — dark deploy)
4. Update `AIRoutingService` with new multi-provider routing strategy

### Phase 6 — Cursor Retirement + Full Env Cleanup

1. Delete `CursorHeadlessProvider` and all Cursor-specific service files
2. Create Prisma migration: `CURSOR_HEADLESS` execution records → `CLAUDE_CODE`
3. Remove `CURSOR_HEADLESS` from `ProviderName` enum, routing maps, and factory
4. Remove all dead env vars listed in section 5.16.6 from `env.validation.ts`, `configuration.ts`, `.env.example`, `.env.prod`
5. Final audit: confirm zero references to all deleted vars in codebase

### Phase 7 — Validation

1. Run E2E test with each enabled provider
2. Confirm Prometheus metric `opensandbox_executions_total` appears in `/metrics`
3. Confirm all DooD metrics (`sandbox_container_*`) are gone from `/metrics`
4. Confirm no Docker socket reference anywhere in `docker-compose*.yml`
5. Confirm `.env.example` has zero dead variables
6. Run all 8 grep checks from section 5.16.7 — all must return zero results

---

## 11. Risks & Mitigations

| Risk                                                              | Likelihood | Impact | Mitigation                                                                                                                                                                  |
| ----------------------------------------------------------------- | ---------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenSandbox JS SDK pre-1.0 breaking changes                       | Medium     | High   | Pin to exact version `0.1.5`; lock in `pnpm-lock.yaml`; upgrade only deliberately                                                                                           |
| `IS_SANDBOX=1` flag not supported in older CLI versions           | Low        | High   | Pin CLI versions in `Dockerfile.agents`; test each CLI in container before release                                                                                          |
| Long-running executions (50 min) hit sandbox TTL                  | Low        | Medium | Set `OPENSANDBOX_SANDBOX_TIMEOUT_S=3600` (1 hour); monitor P95 execution duration                                                                                           |
| Standalone OpenSandbox server becomes unavailable                 | Medium     | High   | Add health check to `SandboxService` with production startup guard; monitor server uptime; consider a warm standby; DSF degrades gracefully — queued tickets wait, not lost |
| Network latency between DSF server and OpenSandbox server         | Low        | Medium | Co-locate in same datacenter/region; latency should be <5ms on same LAN/VPC                                                                                                 |
| `dsf-agents` image not accessible from OpenSandbox server         | Low        | High   | Use a registry reachable from the OpenSandbox server; test `docker pull` from that server before go-live                                                                    |
| Existing `CURSOR_HEADLESS` execution records cause routing errors | Low        | Medium | Prisma migration (FR-OS33) converts old records before code deployment                                                                                                      |
| DooD dead code not fully removed after migration                  | Medium     | Medium | Section 5.16.7 grep checks are mandatory before closing the epic — enforced in acceptance criteria                                                                          |

---

## 12. Acceptance Criteria

**Standalone Server:**

- [ ] OpenSandbox server is running on a dedicated machine and reachable from DSF at `OPENSANDBOX_DOMAIN`
- [ ] `docs/ops/opensandbox-server.md` exists and covers setup, config, and restart procedure
- [ ] `opensandbox/code-interpreter:v1.0.2` image is pre-pulled on the OpenSandbox server and confirmed runnable

**DSF Application:**

- [ ] `docker-compose.yml` and `docker-compose.dev.yml` have **no** Docker socket mount under the `app` service
- [ ] `docker-compose.yml` has **no** opensandbox sidecar service — DSF connects to the remote server via URL
- [ ] `SandboxService` throws on startup in production if OpenSandbox is unreachable
- [ ] A ClickUp ticket creates an execution that runs Claude Code CLI inside an OpenSandbox container and captures the output
- [ ] `GEMINI_ENABLED=true` + `GEMINI_API_KEY` set → Gemini routes and executes successfully
- [ ] `CODEX_ENABLED=true` + `OPENAI_API_KEY` set → Codex routes and executes successfully
- [ ] `KIMI_ENABLED=true` + `KIMI_API_KEY` set → Kimi routes and executes successfully
- [ ] `pnpm typecheck` passes — zero TypeScript errors
- [ ] `pnpm lint` passes — zero ESLint errors

**DooD Dead Code — All 8 grep checks from section 5.16.7 return zero results:**

- [ ] `grep -r "DockerService" src/ --include="*.ts"` → 0 results
- [ ] `grep -r "WorkspaceService" src/ --include="*.ts"` → 0 results
- [ ] `grep -r "PtyExecutionService" src/ --include="*.ts"` → 0 results
- [ ] `grep -r "DockerModule" src/ --include="*.ts"` → 0 results
- [ ] `grep -r "CURSOR_HEADLESS" src/ --include="*.ts"` → 0 results
- [ ] `grep -r "docker.sock" docker-compose*.yml` → 0 results
- [ ] `grep -r "dockerode" src/ --include="*.ts"` → 0 results
- [ ] `grep -r "node-pty" src/ --include="*.ts"` → 0 results

**Environment Variables:**

- [ ] `.env.example` contains none of the removed variables listed in section 5.16.6
- [ ] All removed Joi schemas are gone from `env.validation.ts`
- [ ] All removed config keys are gone from `configuration.ts`

**Observability:**

- [ ] Prometheus metric `opensandbox_executions_total` appears in `/metrics` after a successful execution
- [ ] Prometheus metrics `sandbox_container_*` (old DooD metrics) no longer appear in `/metrics`

**Tests:**

- [ ] Unit tests pass for `SandboxService`, `ClaudeCodeProvider`, `GeminiProvider`, `CodexProvider`, `KimiProvider`
- [ ] `pnpm test` passes — zero test failures

---

## 13. Out of Scope for This Epic

- Kubernetes deployment of OpenSandbox
- VS Code Web, browser automation, desktop sandboxes
- Agent SDK / LangGraph integration
- gVisor/Kata secure runtime setup (infra config only; `OPENSANDBOX_SECURE_RUNTIME` env var is added but tested separately)
- Multi-region or multi-host OpenSandbox deployments
- OpenSandbox UI/dashboard
- Cost tracking per provider update (existing `AICostTrackerService` continues to work; per-provider cost model is a separate epic)

---

## 15. Future Optimizations

> **These items are explicitly OUT of scope for Epic OS.** They are documented here so the rationale is preserved and the team can decide when to pursue them based on scale.

### 15.1 Custom Pre-Baked Agent Image (`dsf-agents`)

**Problem it solves:** With runtime CLI install (`npm i -g @anthropic-ai/claude-code@latest`), each sandbox execution incurs ~30–60 seconds of cold-start time for the install step. At low ticket volume this is acceptable. At high volume (hundreds of executions per day), it becomes a meaningful UX delay and a repeated npm registry dependency.

**Trigger for consideration:** When P50 sandbox cold-start time consistently exceeds 45 seconds in production, or when ticket volume exceeds ~200/day.

**Solution overview:**

Build a custom Docker image with all CLI tools pre-installed. Push it to a container registry. Configure the OpenSandbox server to pull it. Set `OPENSANDBOX_AGENT_IMAGE=<registry>/dsf-agents:latest`.

**Proposed `docker/Dockerfile.agents`:**

```dockerfile
FROM opensandbox/code-interpreter:v1.0.2

LABEL maintainer="Dark Software Factory <platform@darkfactory.ai>"
LABEL description="DSF pre-baked agents image — all coding CLIs pre-installed"

# Install coding agent CLIs globally
RUN npm i -g \
    @anthropic-ai/claude-code@latest \
    @google/gemini-cli@latest \
    @openai/codex@latest \
    && npm cache clean --force

# Install Kimi CLI (update package name once stable)
# RUN npm i -g kimi-cli@latest

# Verify installations
RUN claude --version && gemini --version && codex --version

# OpenSandbox requires IS_SANDBOX=1 for non-interactive headless mode
ENV IS_SANDBOX=1

# Working directory used by OpenSandbox
WORKDIR /workspace
```

**Registry push pipeline:**

Add to CI/CD (GitHub Actions or equivalent):

```yaml
# .github/workflows/build-agents-image.yml
name: Build and Push dsf-agents image
on:
  push:
    paths:
      - 'docker/Dockerfile.agents'
  schedule:
    - cron: '0 2 * * 1' # Weekly rebuild to pick up CLI updates

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: docker/
          file: docker/Dockerfile.agents
          push: true
          tags: |
            ghcr.io/<org>/dsf-agents:latest
            ghcr.io/<org>/dsf-agents:${{ github.sha }}
```

**How to activate once the image is ready:**

1. Push `dsf-agents` image to a registry accessible from the OpenSandbox server
2. On the OpenSandbox server, run `docker pull ghcr.io/<org>/dsf-agents:latest`
3. Set `OPENSANDBOX_AGENT_IMAGE=ghcr.io/<org>/dsf-agents:latest` in DSF env
4. Restart DSF application — all new sandbox executions will use the pre-baked image

**Expected cold-start improvement:**

- Without pre-baked image: ~30–60s (CLI install) + ~3–5s (container start) = **35–65s total**
- With pre-baked image: ~3–5s (container start only) = **3–5s total**
- Target: P95 cold-start under **10 seconds** with pre-baked image

**NFR target (when implemented):** Sandbox cold-start from `Sandbox.create()` to first CLI stdout line must be under **5 seconds** in production. Measure using `opensandbox_execution_duration_seconds` histogram P5 bucket.

---

### 15.2 Kubernetes Deployment of OpenSandbox

**Problem it solves:** Single standalone server is a single point of failure. At scale, one server may become a bottleneck.

**Solution:** Deploy OpenSandbox as a Kubernetes `Deployment` with horizontal pod autoscaling. Each pod runs `opensandbox-server` + Docker-in-Docker (DinD) sidecar.

**Trigger for consideration:** When sandbox queue depth (`opensandbox_queue_depth` metric) consistently exceeds 20 pending executions, or when standalone server availability SLA is below 99.5%.

---

### 15.3 gVisor / Kata Secure Container Runtime

**Problem it solves:** Standard Docker containers share the host kernel. A kernel exploit inside an AI-generated code execution could escape the container.

**Solution:** Configure OpenSandbox server to use `gvisor` or `kata-qemu` as the container runtime (set in `~/.sandbox.toml` `[secure_container] runtime = "gvisor"`). The `OPENSANDBOX_SECURE_RUNTIME` env var in DSF already passes this through to the sandbox config — no DSF code change needed, only OpenSandbox server setup.

**Trigger for consideration:** When compliance requirements demand kernel-level isolation, or when a security audit flags shared-kernel container execution.

---

## 14. Document History

| Version | Date       | Author  | Changes                                                                                                                                                                                                                                                                                                                                                      |
| ------- | ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.0     | 2026-03-20 | Product | Initial draft covering full OpenSandbox migration, multi-provider expansion, and env var cleanup                                                                                                                                                                                                                                                             |
| 1.1     | 2026-03-21 | Product | Updated architecture to standalone server model (not docker-compose sidecar); added section 5.16 DooD dead code removal checklist with 8 mandatory grep checks; updated migration sequence to 7 phases with explicit dead code removal phase; updated risks, acceptance criteria, and architecture diagram                                                   |
| 1.2     | 2026-03-21 | Product | Moved custom `dsf-agents` image requirements (FR-OS5/OS6/OS7) from core scope to Section 15 Future Optimizations; updated all references to use `opensandbox/code-interpreter:v1.0.2` base image with runtime CLI install; updated NFR-OS8 cold-start expectations; updated acceptance criteria, architecture diagram, and `OPENSANDBOX_AGENT_IMAGE` default |
