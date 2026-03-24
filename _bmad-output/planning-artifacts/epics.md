---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - _bmad-output/planning-artifacts/prd-opensandbox-migration.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
---

# Dark Software Factory — Epic Breakdown (OpenSandbox Migration)

## Overview

This document provides the complete epic and story breakdown for the OpenSandbox Migration (Epic ID: OS), decomposing the requirements from the PRD, Architecture, and UX Design into implementable stories. This is a backend infrastructure migration replacing the Docker-outside-of-Docker (DooD) pattern with a provider-agnostic sandbox platform.

## Requirements Inventory

### Functional Requirements

FR-OS1: The OpenSandbox server must be deployed as a standalone service on a dedicated machine. It must run `opensandbox-server` (via `uv pip install opensandbox-server`), have Docker Engine installed locally, be initialized with `~/.sandbox.toml`, expose its API on a configured port (default 8080) reachable from the DSF server, be secured with `OPENSANDBOX_API_KEY`, and be documented in `docs/ops/opensandbox-server.md`.

FR-OS2: The DSF `app` service Docker Compose definition must have the `/var/run/docker.sock` volume mount permanently removed. The DSF application server must have zero Docker socket access.

FR-OS3: The OpenSandbox server `~/.sandbox.toml` configuration must include the server, runtime (docker), docker (bridge network), sandbox (max_timeout_seconds=3600), and secure_container sections as specified in the PRD.

FR-OS4: The NestJS `SandboxModule` must connect to the remote OpenSandbox server on startup and validate connectivity via a health ping. In production: fail startup immediately if unreachable. In development/test: log warning and continue.

FR-OS5: All providers must use `opensandbox/code-interpreter:v1.0.2` as the sandbox image. Each provider installs its CLI at runtime as part of the sandbox command sequence.

FR-OS6: The `OPENSANDBOX_AGENT_IMAGE` env var must default to `opensandbox/code-interpreter:v1.0.2` and be overridable for custom pre-baked images.

FR-OS8: A new `SandboxService` must be created at `src/sandbox/sandbox.service.ts` wrapping the `@alibaba-group/opensandbox` JavaScript SDK, exposing: `runAgentCommand()`, `getSandboxInfo()`, `killSandbox()`, `listActiveSandboxes()`.

FR-OS9: `AgentCommandOptions` interface must include: `executionId`, `image`, `command`, `env`, `timeoutSeconds`, `cpuLimit`, `memoryLimit`, optional `networkPolicy`, optional `metadata`.

FR-OS10: `AgentCommandResult` interface must include: `sandboxId`, `stdout`, `stderr`, `exitCode`, `durationMs`, `timedOut`.

FR-OS11: `SandboxService.runAgentCommand()` must: create sandbox via `Sandbox.create()`, run command streaming stdout/stderr to `ExecutionGateway`, capture full output on completion, always kill/close sandbox in `finally` block, return `AgentCommandResult`.

FR-OS12: `SandboxService` must emit Prometheus metrics: `opensandbox_executions_total` (counter, labels: provider/status), `opensandbox_execution_duration_seconds` (histogram, labels: provider), `opensandbox_active_sandboxes` (gauge from `listActiveSandboxes()` on interval).

FR-OS13: `SandboxModule` must be a global NestJS module, imported once in `AppModule`. All providers inject `SandboxService` without circular imports.

FR-OS14: A new interface `ICodingAgentProvider` must be defined at `src/ai-routing/interfaces/coding-agent-provider.interface.ts` with: `readonly providerName`, `readonly isEnabled`, `isHealthy(): Promise<boolean>`, `execute(payload): Promise<IAIExecutionResult>`.

FR-OS15: `ProviderName` enum must be updated to: `CLAUDE_CODE`, `GEMINI`, `CODEX`, `KIMI`. `CURSOR_HEADLESS` must be removed.

FR-OS16: All four providers must implement `ICodingAgentProvider` and be registered in `ProviderFactoryService` via a provider map keyed by `ProviderName`. Factory reads from map and filters by `isEnabled`.

FR-OS17: `ClaudeCodeProvider` must be rewritten to implement `ICodingAgentProvider`, inject `SandboxService`, read `isEnabled` from `CLAUDE_CODE_ENABLED`, call `SandboxService.runAgentCommand()` with Claude-specific command and env vars (`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, `IS_SANDBOX=1`).

FR-OS18: `ClaudeCodeProvider.isHealthy()` must check OpenSandbox server connectivity only — no Anthropic API calls for health checks.

FR-OS19: A new `GeminiProvider` must be created at `src/ai-routing/providers/gemini.provider.ts`, implementing `ICodingAgentProvider`, reading `isEnabled` from `GEMINI_ENABLED` (default: false), calling `SandboxService.runAgentCommand()` with Gemini CLI command and env vars.

FR-OS20: `GeminiProvider.isHealthy()` must check `GEMINI_API_KEY` is configured and OpenSandbox is reachable. Must return `false` (not throw) if not configured.

FR-OS21: A new `CodexProvider` must be created at `src/ai-routing/providers/codex.provider.ts`, implementing `ICodingAgentProvider`, reading `isEnabled` from `CODEX_ENABLED` (default: false), calling `SandboxService.runAgentCommand()` with Codex CLI command and env vars.

FR-OS22: `CodexProvider.isHealthy()` must check `OPENAI_API_KEY` is configured and OpenSandbox is reachable.

FR-OS23: A new `KimiProvider` must be created at `src/ai-routing/providers/kimi.provider.ts`, implementing `ICodingAgentProvider`, reading `isEnabled` from `KIMI_ENABLED` (default: false), calling `SandboxService.runAgentCommand()` with Kimi CLI command and env vars.

FR-OS24: `KimiProvider.isHealthy()` must check `KIMI_API_KEY` is configured and OpenSandbox is reachable.

FR-OS25: A `SandboxResourceProfileService` must be created at `src/sandbox/sandbox-resource-profile.service.ts`, accepting a complexity score (0–10) and returning `{ cpuLimit, memoryLimit }` per the profile table (small: 0–3, medium: 4–7, large: 8–10).

FR-OS26: All providers must call `SandboxResourceProfileService.getProfile(complexityScore)` — no provider hardcodes resource values.

FR-OS27: `OPENSANDBOX_DEFAULT_CPU_LIMIT` and `OPENSANDBOX_DEFAULT_MEMORY_LIMIT` env vars must override the `medium` profile defaults.

FR-OS28: `AIRoutingService` must be updated for multi-provider routing: enabled check → health check → complexity routing (0–3: KIMI→CLAUDE_CODE, 4–7: CLAUDE_CODE→GEMINI, 8–10: CLAUDE_CODE→CODEX) → `AI_PRIMARY_PROVIDER` override.

FR-OS29: `FallbackStrategyService` must work with any `ICodingAgentProvider` — no provider-specific logic; existing fallback loop (primary → fallback → DLQ) unchanged.

FR-OS30: `ProviderHealthService` circuit breaker must work with all new provider names — no hardcoded checks for `CURSOR_HEADLESS` or `CLAUDE_CODE`.

FR-OS31: `CursorHeadlessProvider` and all supporting files must be deleted: `cursor-headless.provider.ts`, cursor-specific workspace/process management services.

FR-OS32: `CURSOR_HEADLESS` must be removed from `ProviderName` enum and from all switch statements, routing maps, and factory registries.

FR-OS33: A Prisma migration must update `Execution` records with `provider = 'CURSOR_HEADLESS'` to `provider = 'CLAUDE_CODE'` (one-time data migration, not schema change).

FR-OS34: Files to delete: `src/docker/docker.service.ts`, `docker.module.ts`, `workspace.service.ts`, all docker interfaces, `src/ai-routing/services/pty-execution.service.ts`.

FR-OS35: `DockerModule` must be removed from `AppModule` imports. All NestJS module files importing `DockerModule` must import `SandboxModule` instead.

FR-OS36: All Prometheus metric providers for old DooD metrics must be removed: `sandbox_container_memory_limit_bytes`, `sandbox_container_cpu_limit_percent`, `sandbox_container_oom_events_total`, `sandbox_container_cpu_throttled_seconds_total`, `sandbox_container_memory_usage_bytes`.

FR-OS37: `env.validation.ts` must be updated: remove all deleted variables' Joi schemas; add Joi schemas for all new `OPENSANDBOX_*`, `GEMINI_*`, `CODEX_*`, `KIMI_*` variables with appropriate types, defaults, and conditional requirements.

FR-OS38: `configuration.ts` must be updated: remove `cursor` config block and old sandbox config keys; add `opensandbox`, `gemini`, `codex`, `kimi` config blocks.

FR-OS39: `.env.example` must be regenerated with `# OPENSANDBOX CONFIGURATION` section replacing the old Docker/sandbox sections; `# GEMINI PROVIDER`, `# CODEX PROVIDER`, `# KIMI PROVIDER` sections added; all removed variables deleted; zero dead variables remaining.

FR-OS40: `CleanupService` must be reviewed: remove Docker container/workspace cleanup calling `DockerService`; preserve non-Docker cleanup responsibilities; evaluate which `CLEANUP_*` env vars remain relevant.

### NonFunctional Requirements

NFR-OS1: On `onModuleInit`, `SandboxService` must ping the OpenSandbox server with total startup wait ≤10 seconds. If ping fails: production → throw and abort startup; development/test → log warning and continue.

NFR-OS2: Every `SandboxService.runAgentCommand()` call must use `try/finally` ensuring `sandbox.kill()` and `sandbox.close()` are always called, even on exceptions. No orphaned sandboxes.

NFR-OS3: A background job (every 5 minutes) must list running sandboxes and kill any sandbox older than `OPENSANDBOX_SANDBOX_TIMEOUT_S * 1.5` seconds as a safety net for leaked sandboxes.

NFR-OS4: `SandboxService` must enforce `OPENSANDBOX_MAX_CONCURRENT` using a `Semaphore`. New requests must queue (not reject) when limit is reached. Queue depth must be logged and emitted as a Prometheus metric.

NFR-OS5: API keys passed to sandbox environments must never appear in logs — they must be redacted in all `SandboxService` log output.

NFR-OS6: `OPENSANDBOX_API_KEY` must be treated as a secret — sourced from environment/Docker secrets, never committed to version control.

NFR-OS7: The DSF `app` service must have zero Docker socket access. The `/var/run/docker.sock` volume mount must be permanently deleted from `docker-compose.yml` — not commented out.

NFR-OS8: The `opensandbox/code-interpreter:v1.0.2` image must be pre-pulled on the OpenSandbox server before go-live. CLI install cold-start (~30–60s) is accepted as initial implementation cost.

NFR-OS9: Every sandbox execution must log: sandbox ID, provider name, execution ID, duration (ms), exit code, timeout status, stdout/stderr length in bytes (not content — avoid logging sensitive code).

### Additional Requirements

- **npm Dependencies:** Add `@alibaba-group/opensandbox@^0.1.5`; remove `dockerode`, `node-pty`, `@types/dockerode` after DooD code deletion.
- **Docker Compose Changes:** Remove `/var/run/docker.sock` from both `docker-compose.yml` and `docker-compose.dev.yml`. No opensandbox sidecar in compose — DSF connects to remote server via `OPENSANDBOX_DOMAIN` URL.
- **Phased Migration Order:** Implementation must follow the 7-phase sequence: Phase 1 (OpenSandbox server setup — ops), Phase 2 (SandboxModule creation), Phase 3 (ClaudeCode provider migration), Phase 4 (DooD dead code removal), Phase 5 (New providers: Gemini/Codex/Kimi), Phase 6 (Cursor retirement + env cleanup), Phase 7 (Full validation). Phases 3–4 are the critical path.
- **Dead Code Verification:** All 8 grep checks from PRD section 5.16.7 must return zero results before migration is complete.
- **Ops Documentation:** `docs/ops/opensandbox-server.md` must cover: setup instructions, `.sandbox.toml` config reference, health check procedure, and restart procedure.
- **No UX Changes:** This is a backend infrastructure migration with zero frontend impact.
- **Backward Compatibility for Direct SDK Calls:** `ANTHROPIC_MAX_TOKENS` and `ANTHROPIC_TIMEOUT_MS` must be evaluated during implementation — retain if direct Anthropic SDK calls remain in `AICostTrackerService` or `ComplexityScorerService`.

### FR Coverage Map

FR-OS1: Epic OS-1 — Standalone OpenSandbox server deployment and docs
FR-OS2: Epic OS-1 (initiate) / OS-3 (confirm zero) — Docker socket removal from compose
FR-OS3: Epic OS-1 — sandbox.toml configuration
FR-OS4: Epic OS-1 — SandboxModule startup health ping
FR-OS5: Epic OS-1 — Base image selection (code-interpreter:v1.0.2)
FR-OS6: Epic OS-1 — OPENSANDBOX_AGENT_IMAGE env var with default
FR-OS8: Epic OS-1 — SandboxService creation (core abstraction)
FR-OS9: Epic OS-1 — AgentCommandOptions interface
FR-OS10: Epic OS-1 — AgentCommandResult interface
FR-OS11: Epic OS-1 — SandboxService.runAgentCommand() implementation
FR-OS12: Epic OS-1 — Prometheus metrics for OpenSandbox
FR-OS13: Epic OS-1 — SandboxModule as global NestJS module
FR-OS14: Epic OS-2 — ICodingAgentProvider interface definition
FR-OS15: Epic OS-2 (partial: Claude entry) / OS-4 (full: all providers) — ProviderName enum update
FR-OS16: Epic OS-2 — ProviderFactoryService provider map
FR-OS17: Epic OS-2 — ClaudeCodeProvider rewrite
FR-OS18: Epic OS-2 — ClaudeCodeProvider.isHealthy()
FR-OS19: Epic OS-4 — GeminiProvider creation
FR-OS20: Epic OS-4 — GeminiProvider.isHealthy()
FR-OS21: Epic OS-4 — CodexProvider creation
FR-OS22: Epic OS-4 — CodexProvider.isHealthy()
FR-OS23: Epic OS-4 — KimiProvider creation
FR-OS24: Epic OS-4 — KimiProvider.isHealthy()
FR-OS25: Epic OS-2 — SandboxResourceProfileService creation
FR-OS26: Epic OS-2 — All providers use SandboxResourceProfileService
FR-OS27: Epic OS-2 — Override env vars for medium profile defaults
FR-OS28: Epic OS-4 — AIRoutingService multi-provider routing strategy
FR-OS29: Epic OS-2 — FallbackStrategyService provider-agnostic
FR-OS30: Epic OS-2 — ProviderHealthService circuit breaker with new names
FR-OS31: Epic OS-4 — CursorHeadlessProvider deletion
FR-OS32: Epic OS-4 — CURSOR_HEADLESS removal from enum and routing
FR-OS33: Epic OS-4 — Prisma migration for CURSOR_HEADLESS execution records
FR-OS34: Epic OS-3 — Delete all DooD files (docker/, pty-execution.service.ts)
FR-OS35: Epic OS-3 — Remove DockerModule from AppModule; replace with SandboxModule
FR-OS36: Epic OS-3 — Remove old DooD Prometheus metrics
FR-OS37: Epic OS-5 — env.validation.ts cleanup (remove dead, add new Joi schemas)
FR-OS38: Epic OS-5 — configuration.ts cleanup (remove cursor/sandbox, add opensandbox/gemini/codex/kimi)
FR-OS39: Epic OS-5 — .env.example regeneration (zero dead variables)
FR-OS40: Epic OS-3 (Docker parts) / OS-5 (remaining env vars) — CleanupService review

## Epic List

### Epic OS-1: Secure Sandbox Infrastructure

The platform engineer can deploy a dedicated standalone OpenSandbox server and verify that the DSF backend connects to it with startup health validation — without any Docker socket on the DSF machine. The SandboxService abstraction is fully implemented and ready for providers to use.
**FRs covered:** FR-OS1, FR-OS2 (socket removal from compose), FR-OS3, FR-OS4, FR-OS5, FR-OS6, FR-OS8, FR-OS9, FR-OS10, FR-OS11, FR-OS12, FR-OS13
**NFRs covered:** NFR-OS1, NFR-OS2, NFR-OS3, NFR-OS4, NFR-OS5, NFR-OS6, NFR-OS7, NFR-OS8, NFR-OS9

### Epic OS-2: Claude Code Migrated to OpenSandbox

AI engineers and PMs can run end-to-end ticket executions using Claude Code inside an OpenSandbox container via a standardized provider interface — validating the full migration path works with a real provider.
**FRs covered:** FR-OS14, FR-OS15 (Claude Code entry), FR-OS16, FR-OS17, FR-OS18, FR-OS25, FR-OS26, FR-OS27, FR-OS29, FR-OS30

### Epic OS-3: DooD Elimination — Zero Docker Dependency

Platform engineers achieve zero Docker socket exposure on the DSF server: all DooD code, packages, and legacy metrics are purged from the codebase; all 8 mandatory grep checks pass.
**FRs covered:** FR-OS34, FR-OS35, FR-OS36, FR-OS40 (Docker/workspace parts)

### Epic OS-4: Multi-Provider AI Routing (Gemini, Codex, Kimi)

Platform engineers can enable Gemini, Codex, and Kimi providers via feature flags; PMs and managers benefit from intelligent complexity-based routing across all four providers; Cursor Headless is fully retired.
**FRs covered:** FR-OS15 (full enum), FR-OS19, FR-OS20, FR-OS21, FR-OS22, FR-OS23, FR-OS24, FR-OS28, FR-OS31, FR-OS32, FR-OS33

### Epic OS-5: Configuration Cleanup & Production Hardening

Developers see zero dead environment variables; `.env.example` is fully clean with only live variables; Cursor Headless is retired from all config files; the codebase has no config debt and is production-ready.
**FRs covered:** FR-OS37, FR-OS38, FR-OS39, FR-OS40 (remaining env var evaluation)

---

## Epic OS-1: Secure Sandbox Infrastructure

The platform engineer can deploy a dedicated standalone OpenSandbox server and verify that the DSF backend connects to it with startup health validation — without any Docker socket on the DSF machine. The SandboxService abstraction is fully implemented and ready for providers to use.

### Story OS-1.1: OpenSandbox Server Deployment & Ops Documentation

As a **Platform Engineer**,
I want to deploy a standalone OpenSandbox server with `~/.sandbox.toml` configuration and complete ops documentation,
So that the DSF backend has a secure, Docker-socket-free sandbox execution environment reachable via `OPENSANDBOX_DOMAIN`.

**Acceptance Criteria:**

**Given** a dedicated VPS/VM with Docker Engine installed
**When** I install `opensandbox-server` via `uv pip install opensandbox-server` and configure `~/.sandbox.toml` with `api_key`, `host=0.0.0.0`, `port=8080`, `runtime.type=docker`, `network_mode=bridge`, `max_timeout_seconds=3600`
**Then** the server starts and its API is reachable from the DSF server at the configured `OPENSANDBOX_DOMAIN`

**Given** the OpenSandbox server is running
**When** I run `docker pull opensandbox/code-interpreter:v1.0.2` on the OpenSandbox server
**Then** the image is cached locally and a test container can be launched successfully

**Given** the `docker-compose.yml` and `docker-compose.dev.yml` app service definitions
**When** a developer inspects the volumes section of the `app` service
**Then** `/var/run/docker.sock` is not present (deleted, not commented out)

**Given** `docs/ops/opensandbox-server.md` exists
**When** a new platform engineer follows its instructions
**Then** they can: provision the server, write the correct `~/.sandbox.toml`, start the server, verify health via the API, and restart it if needed — with no other reference required

### Story OS-1.2: SandboxModule and SandboxService with Startup Health Validation

As a **Developer**,
I want a NestJS `SandboxModule` with `SandboxService` that wraps the `@alibaba-group/opensandbox` SDK and validates connectivity on startup,
So that all coding agent providers can use a single, well-tested abstraction without managing SDK details directly.

**Acceptance Criteria:**

**Given** `@alibaba-group/opensandbox@^0.1.5` is added to `package.json` dependencies
**When** `SandboxModule` is registered as a global module in `AppModule`
**Then** `SandboxService` is injectable across all modules without additional imports

**Given** `NODE_ENV=production` and the OpenSandbox server is unreachable
**When** the NestJS application starts (`onModuleInit` runs)
**Then** startup fails immediately with a descriptive error message identifying `OPENSANDBOX_DOMAIN` as the unreachable target, within 10 seconds

**Given** `NODE_ENV=development` or `test` and the OpenSandbox server is unreachable
**When** the NestJS application starts
**Then** a warning is logged and startup continues normally

**Given** the `SandboxService` is initialized
**When** `OPENSANDBOX_AGENT_IMAGE` env var is not set
**Then** it defaults to `opensandbox/code-interpreter:v1.0.2`

**Given** the `AgentCommandOptions` and `AgentCommandResult` TypeScript interfaces
**When** a developer inspects them
**Then** `AgentCommandOptions` has all required fields (`executionId`, `image`, `command`, `env`, `timeoutSeconds`, `cpuLimit`, `memoryLimit`) and optional fields (`networkPolicy`, `metadata`); `AgentCommandResult` has `sandboxId`, `stdout`, `stderr`, `exitCode`, `durationMs`, `timedOut`

**Given** `SandboxService` is instantiated
**When** `getSandboxInfo()`, `killSandbox()`, and `listActiveSandboxes()` are called
**Then** they delegate to the OpenSandbox SDK correctly and return typed results

### Story OS-1.3: Sandbox Command Execution with Real-Time Log Streaming

As a **Developer**,
I want `SandboxService.runAgentCommand()` to execute commands inside OpenSandbox containers while streaming stdout/stderr to the `ExecutionGateway` in real time,
So that execution logs appear on the dashboard as the agent works and sandbox leaks are impossible.

**Acceptance Criteria:**

**Given** a valid `AgentCommandOptions` object with `executionId`, `image`, `command`, `env`, `timeoutSeconds`, `cpuLimit`, `memoryLimit`
**When** `runAgentCommand()` is called
**Then** a sandbox is created via `Sandbox.create()`, the command runs, stdout and stderr lines are streamed in real-time to `ExecutionGateway` using the provided `executionId`, and an `AgentCommandResult` is returned with `sandboxId`, `stdout`, `stderr`, `exitCode`, `durationMs`, `timedOut`

**Given** `runAgentCommand()` is in progress and an exception is thrown (e.g., timeout, SDK error)
**When** the error is caught
**Then** the `finally` block always calls `sandbox.kill()` and `sandbox.close()` — no orphaned sandboxes exist

**Given** `env` in `AgentCommandOptions` contains values like `ANTHROPIC_AUTH_TOKEN` or `GEMINI_API_KEY`
**When** `SandboxService` logs execution details
**Then** API key values are redacted and never appear in log output

**Given** a completed sandbox execution
**When** the execution log is written
**Then** it contains: sandbox ID, provider name (from metadata), execution ID, duration in ms, exit code, whether it timed out, stdout length in bytes, stderr length in bytes — but not stdout/stderr content

### Story OS-1.4: Sandbox Prometheus Metrics, Concurrency Enforcement, and Leak Prevention

As a **Platform Engineer**,
I want sandbox execution metrics emitted to Prometheus and concurrent sandbox count enforced via a semaphore,
So that I can monitor execution health, prevent resource exhaustion, and automatically recover from leaked sandboxes.

**Acceptance Criteria:**

**Given** a sandbox execution completes successfully
**When** the `/metrics` endpoint is scraped by Prometheus
**Then** `opensandbox_executions_total` counter is incremented with labels `provider` and `status=success`; `opensandbox_execution_duration_seconds` histogram has a new observation for that provider

**Given** a sandbox execution fails or times out
**When** the error is handled
**Then** `opensandbox_executions_total` is incremented with `status=failed` or `status=timeout` respectively

**Given** `OPENSANDBOX_MAX_CONCURRENT` is set (e.g., `10`)
**When** the number of active sandboxes reaches the limit and a new `runAgentCommand()` call arrives
**Then** the new call waits in a queue (does not reject); queue depth is logged at WARN level and emitted as a Prometheus gauge

**Given** the background leak-prevention job runs every 5 minutes
**When** it finds any running sandbox older than `OPENSANDBOX_SANDBOX_TIMEOUT_S * 1.5` seconds
**Then** it calls `sandbox.kill()` on each such sandbox and logs the cleanup action

**Given** `listActiveSandboxes()` is polled on an interval
**When** active sandboxes are counted
**Then** `opensandbox_active_sandboxes` gauge reflects the current count

---

## Epic OS-2: Claude Code Migrated to OpenSandbox

AI engineers and PMs can run end-to-end ticket executions using Claude Code inside an OpenSandbox container via a standardized provider interface — validating the full migration path works with a real provider.

### Story OS-2.1: ICodingAgentProvider Interface and Resource Profile Service

As a **Developer**,
I want a standardized `ICodingAgentProvider` interface and a `SandboxResourceProfileService` that maps complexity scores to resource limits,
So that all current and future providers share a single contract and no provider hardcodes CPU/memory values.

**Acceptance Criteria:**

**Given** `src/ai-routing/interfaces/coding-agent-provider.interface.ts` is created
**When** a developer inspects the interface
**Then** it exposes `readonly providerName: ProviderName`, `readonly isEnabled: boolean`, `isHealthy(): Promise<boolean>`, and `execute(payload: IAIExecutionPayload): Promise<IAIExecutionResult>`

**Given** `ProviderName` enum at `src/ai-routing/enums/provider-name.enum.ts`
**When** a developer views the enum
**Then** it contains `CLAUDE_CODE`, and `CURSOR_HEADLESS` is still present (removal deferred to Epic OS-4) — no regression

**Given** `SandboxResourceProfileService` at `src/sandbox/sandbox-resource-profile.service.ts`
**When** `getProfile(score)` is called with complexity score 0–3
**Then** it returns `{ cpuLimit: '0.5', memoryLimit: '256Mi' }` (small profile)

**When** `getProfile(score)` is called with complexity score 4–7
**Then** it returns `{ cpuLimit: '1', memoryLimit: '512Mi' }` (medium profile), unless overridden by `OPENSANDBOX_DEFAULT_CPU_LIMIT` / `OPENSANDBOX_DEFAULT_MEMORY_LIMIT`

**When** `getProfile(score)` is called with complexity score 8–10
**Then** it returns `{ cpuLimit: '2', memoryLimit: '1Gi' }` (large profile)

**Given** `OPENSANDBOX_DEFAULT_CPU_LIMIT=2` and `OPENSANDBOX_DEFAULT_MEMORY_LIMIT=1Gi` are set
**When** `getProfile(5)` is called (medium range)
**Then** it returns the env-var overrides instead of the hardcoded medium defaults

### Story OS-2.2: ClaudeCodeProvider Rewrite Using SandboxService

As a **PM / AI Engineer**,
I want `ClaudeCodeProvider` rewritten to execute Claude Code CLI inside an OpenSandbox container via `SandboxService`,
So that tickets processed by Claude Code run in an isolated, secure sandbox environment end-to-end.

**Acceptance Criteria:**

**Given** `ClaudeCodeProvider` implements `ICodingAgentProvider`
**When** it is registered in `ProviderFactoryService` via the provider map
**Then** `ProviderFactoryService` selects it by `ProviderName.CLAUDE_CODE` without any hardcoded selection logic

**Given** `CLAUDE_CODE_ENABLED=true`
**When** `ClaudeCodeProvider.isEnabled` is read
**Then** it returns `true`

**Given** `ClaudeCodeProvider.execute(payload)` is called with a ticket execution payload
**When** it calls `SandboxService.runAgentCommand()`
**Then** the command is `claude "${escapedPrompt}"` (double quotes in prompt escaped), env includes `ANTHROPIC_AUTH_TOKEN` from `ANTHROPIC_API_KEY` config, `ANTHROPIC_BASE_URL` if set, `ANTHROPIC_MODEL`, and `IS_SANDBOX=1`; resource limits come from `SandboxResourceProfileService.getProfile(payload.complexityScore)`

**Given** `ClaudeCodeProvider.isHealthy()` is called
**When** it checks health
**Then** it calls `SandboxService` to verify OpenSandbox connectivity — no Anthropic API calls are made

**Given** a ClickUp ticket reaches the AI execution queue with a valid prompt
**When** the full pipeline runs end-to-end (ClickUp webhook → AIRoutingConsumer → AIExecutionConsumer → OrchestratorService → ClaudeCodeProvider → SandboxService → OpenSandbox)
**Then** Claude Code CLI runs inside an OpenSandbox container, output is captured, and the execution state transitions to `COMPLETED` (or `FAILED` on error)

**Given** `pnpm typecheck` and `pnpm lint` are run after the rewrite
**When** the commands complete
**Then** zero TypeScript errors and zero ESLint errors

### Story OS-2.3: Provider Fallback and Health Circuit Breaker Compatibility

As a **Developer**,
I want `FallbackStrategyService` and `ProviderHealthService` updated to work generically with any `ICodingAgentProvider`,
So that the fallback loop and circuit breaker work correctly for Claude Code today and all future providers without modification.

**Acceptance Criteria:**

**Given** `FallbackStrategyService.executeWithFallback()` receives any `ICodingAgentProvider` implementation
**When** the primary provider fails
**Then** it falls back to the next available provider, then to DLQ — with no provider-specific logic inside the service

**Given** `ProviderHealthService` receives a `ProviderName` value (`CLAUDE_CODE`, `GEMINI`, `CODEX`, or `KIMI`)
**When** the circuit breaker evaluates provider health
**Then** it works correctly for any `ProviderName` value — no hardcoded checks for `CURSOR_HEADLESS` or `CLAUDE_CODE` specifically

**Given** unit tests for `FallbackStrategyService` and `ProviderHealthService`
**When** `pnpm test` is run
**Then** all tests pass with zero failures

---

## Epic OS-3: DooD Elimination — Zero Docker Dependency

Platform engineers achieve zero Docker socket exposure on the DSF server: all DooD code, packages, and legacy metrics are purged from the codebase; all 8 mandatory grep checks pass.

### Story OS-3.1: Delete DooD Files and Remove DockerModule

As a **Developer**,
I want all Docker-related source files deleted and `DockerModule` removed from the module graph,
So that the codebase has zero DooD code and any accidental re-introduction is immediately caught by the TypeScript compiler.

**Acceptance Criteria:**

**Given** the DooD deletion is complete
**When** the following files are checked
**Then** they do not exist: `src/docker/docker.service.ts`, `src/docker/docker.module.ts`, `src/docker/workspace.service.ts`, `src/docker/interfaces/resource-profile.interface.ts`, `src/docker/interfaces/run-container-options.interface.ts`, `src/docker/interfaces/exec-in-container-options.interface.ts`, `src/docker/interfaces/container-stream-options.interface.ts`, `src/ai-routing/services/pty-execution.service.ts`; and `src/docker/` directory is empty or removed

**Given** `src/app.module.ts` is updated
**When** a developer inspects it
**Then** `DockerModule` is not imported; `SandboxModule` is imported instead

**Given** the following files are updated to remove all Docker/workspace injection: `src/cleanup/cleanup.module.ts`, `src/cleanup/cleanup.service.ts`, `src/qa-automation/qa-orchestrator.service.ts`, `src/github/services/pr-risk-assessor.service.ts`, `src/github/services/github-commit-orchestrator.service.ts`, `src/github/services/github-push-trigger.consumer.ts`
**When** a developer inspects each file
**Then** `DockerService` and `WorkspaceService` are not imported, injected, or called anywhere

**Given** `pnpm remove dockerode node-pty @types/dockerode` is run
**When** `package.json` and `pnpm-lock.yaml` are inspected
**Then** `dockerode`, `node-pty`, and `@types/dockerode` are absent from all dependency sections

**Given** `pnpm typecheck` is run after all deletions
**When** the command completes
**Then** zero TypeScript errors — the module graph compiles cleanly without the deleted files

### Story OS-3.2: Remove Legacy DooD Metrics, Clean Up CleanupService, and Verify Zero Docker Dependency

As a **Platform Engineer**,
I want all DooD Prometheus metrics removed and `CleanupService` scrubbed of Docker-specific logic,
So that `/metrics` shows only OpenSandbox metrics and all 8 mandatory grep checks return zero results.

**Acceptance Criteria:**

**Given** `docker.module.ts` Prometheus metric providers are removed
**When** the `/metrics` endpoint is scraped
**Then** none of these appear: `sandbox_container_memory_limit_bytes`, `sandbox_container_cpu_limit_percent`, `sandbox_container_oom_events_total`, `sandbox_container_cpu_throttled_seconds_total`, `sandbox_container_memory_usage_bytes`

**Given** `CleanupService` is reviewed and updated
**When** a developer inspects `src/cleanup/cleanup.service.ts`
**Then** all methods calling `DockerService` for container cleanup are removed; any cleanup responsibilities unrelated to Docker (e.g., log file rotation, temp uploads) are preserved and still functional

**Given** the codebase after all OS-3 changes
**When** all 8 grep checks from PRD section 5.16.7 are run
**Then** every check returns zero results:

- `grep -r "DockerService" src/ --include="*.ts"` → 0
- `grep -r "WorkspaceService" src/ --include="*.ts"` → 0
- `grep -r "PtyExecutionService" src/ --include="*.ts"` → 0
- `grep -r "DockerModule" src/ --include="*.ts"` → 0
- `grep -r "docker.sock" docker-compose*.yml` → 0
- `grep -r "dockerode" src/ --include="*.ts"` → 0
- `grep -r "node-pty" src/ --include="*.ts"` → 0

_Note: The `CURSOR_HEADLESS` grep check is deferred to Story OS-5.2, as Cursor code is not removed until Epic OS-4._

**Given** `pnpm test` is run after all OS-3 changes
**When** the command completes
**Then** zero test failures

---

## Epic OS-4: Multi-Provider AI Routing (Gemini, Codex, Kimi)

Platform engineers can enable Gemini, Codex, and Kimi providers via feature flags; PMs and managers benefit from intelligent complexity-based routing across all four providers; Cursor Headless is fully retired.

### Story OS-4.1: Retire Cursor Headless Provider and Data Migration

As a **Developer**,
I want `CursorHeadlessProvider` deleted and existing `CURSOR_HEADLESS` execution records migrated to `CLAUDE_CODE`,
So that the codebase has no Cursor-specific code and the database is consistent with the new provider model before new providers are added.

**Acceptance Criteria:**

**Given** the Cursor Headless retirement is complete
**When** the codebase is inspected
**Then** `src/ai-routing/providers/cursor-headless.provider.ts` does not exist; `CURSOR_HEADLESS` does not appear in `ProviderName` enum, any switch statement, routing map, or factory registry; `ProviderName` enum contains exactly: `CLAUDE_CODE`, `GEMINI`, `CODEX`, `KIMI`

**Given** a Prisma migration is created and applied
**When** the migration runs against the database
**Then** all `Execution` records with `provider = 'CURSOR_HEADLESS'` are updated to `provider = 'CLAUDE_CODE'`; no schema columns are added or removed

**Given** `pnpm typecheck` is run after the deletion
**When** the command completes
**Then** zero TypeScript errors — nothing references `CURSOR_HEADLESS` or the deleted provider class

### Story OS-4.2: Gemini CLI Provider

As a **Platform Engineer**,
I want a `GeminiProvider` that executes Gemini CLI inside an OpenSandbox container when `GEMINI_ENABLED=true`,
So that I can dark-deploy the provider and enable it when a `GEMINI_API_KEY` is ready, without code changes.

**Acceptance Criteria:**

**Given** `GeminiProvider` is created at `src/ai-routing/providers/gemini.provider.ts` implementing `ICodingAgentProvider`
**When** `GEMINI_ENABLED=false` (default)
**Then** `GeminiProvider.isEnabled` returns `false` and it is skipped by `ProviderFactoryService`

**Given** `GEMINI_ENABLED=true` and `GEMINI_API_KEY` is set
**When** `GeminiProvider.execute(payload)` is called
**Then** `SandboxService.runAgentCommand()` is called with command `gemini "${escapedPrompt}"`, env includes `GEMINI_API_KEY`, `GEMINI_BASE_URL` (if set), `GEMINI_MODEL` (default: `gemini-2.5-pro`); resource limits from `SandboxResourceProfileService`

**Given** `GEMINI_API_KEY` is not configured
**When** `GeminiProvider.isHealthy()` is called
**Then** it returns `false` without throwing

**Given** `GEMINI_ENABLED=true` and `GEMINI_API_KEY` is set
**When** `GeminiProvider.isHealthy()` is called
**Then** it checks OpenSandbox server connectivity and returns `true` if reachable

### Story OS-4.3: OpenAI Codex and Kimi CLI Providers

As a **Platform Engineer**,
I want `CodexProvider` and `KimiProvider` created and dark-deployed behind `CODEX_ENABLED` and `KIMI_ENABLED` feature flags,
So that both providers are ready to activate via environment variable with no further code changes.

**Acceptance Criteria:**

**Given** `CodexProvider` at `src/ai-routing/providers/codex.provider.ts` implementing `ICodingAgentProvider`
**When** `CODEX_ENABLED=true` and `OPENAI_API_KEY` is set, and `execute(payload)` is called
**Then** command is `codex "${escapedPrompt}"`, env includes `OPENAI_API_KEY`, `OPENAI_BASE_URL` (if set), `CODEX_MODEL` (default: `codex-1`); resource limits from `SandboxResourceProfileService`

**Given** `CodexProvider.isHealthy()` is called with `OPENAI_API_KEY` not set
**Then** it returns `false` without throwing

**Given** `KimiProvider` at `src/ai-routing/providers/kimi.provider.ts` implementing `ICodingAgentProvider`
**When** `KIMI_ENABLED=true` and `KIMI_API_KEY` is set, and `execute(payload)` is called
**Then** command is `kimi "${escapedPrompt}"`, env includes `KIMI_API_KEY`, `KIMI_BASE_URL` (if set), `KIMI_MODEL` (default: `kimi-k2`); resource limits from `SandboxResourceProfileService`

**Given** `KimiProvider.isHealthy()` is called with `KIMI_API_KEY` not set
**Then** it returns `false` without throwing

**Given** both providers are registered in `ProviderFactoryService`
**When** `CODEX_ENABLED=false` and `KIMI_ENABLED=false` (defaults)
**Then** neither provider is selected by the factory — no routing impact until explicitly enabled

**Given** unit tests for `CodexProvider` and `KimiProvider`
**When** `pnpm test` is run
**Then** all tests pass with zero failures

### Story OS-4.4: Multi-Provider AIRoutingService with Complexity-Based Strategy

As a **PM / Manager**,
I want `AIRoutingService` updated to route tickets across all four providers based on complexity score and feature flags,
So that simple tickets go to the fastest/cheapest provider and complex tickets go to the most capable one — automatically.

**Acceptance Criteria:**

**Given** `AIRoutingService` is updated with the new routing strategy
**When** routing a ticket with complexity score 0–3 and `KIMI_ENABLED=true`
**Then** `KIMI` is selected as primary with `CLAUDE_CODE` as fallback

**When** routing a ticket with complexity score 4–7
**Then** `CLAUDE_CODE` is selected as primary with `GEMINI` as fallback (if enabled)

**When** routing a ticket with complexity score 8–10
**Then** `CLAUDE_CODE` is selected as primary with `CODEX` as fallback (if enabled)

**Given** `AI_PRIMARY_PROVIDER=GEMINI` is set
**When** routing any ticket regardless of complexity score
**Then** `GEMINI` is selected as primary (override mode)

**Given** a provider has `isEnabled=false` or `isHealthy()=false`
**When** `AIRoutingService` selects providers
**Then** that provider is skipped and the next eligible provider in the strategy is used

**Given** all four providers are registered in `ProviderFactoryService`
**When** `pnpm typecheck` and `pnpm test` are run
**Then** zero TypeScript errors and zero test failures

---

## Epic OS-5: Configuration Cleanup & Production Hardening

Developers see zero dead environment variables; `.env.example` is fully clean with only live variables; Cursor Headless is retired from all config files; the codebase has no config debt and is production-ready.

### Story OS-5.1: Env Validation and Configuration Module Cleanup

As a **Developer**,
I want `env.validation.ts` and `configuration.ts` updated to remove all dead variables and add all new OpenSandbox, Gemini, Codex, and Kimi config blocks,
So that the app fails fast on misconfiguration and no stale Joi schemas or config keys confuse future developers.

**Acceptance Criteria:**

**Given** `env.validation.ts` is updated
**When** a developer inspects it
**Then** Joi schemas for all deleted variables are absent: all `DOCKER_*`, `SANDBOX_*`, `CURSOR_*`, `WINDSURF_API_KEY`, `LOG_STREAM_THROTTLE_MS`, `CLAUDE_WORKSPACES_ROOT`; and Joi schemas exist for all new variables: `OPENSANDBOX_DOMAIN`, `OPENSANDBOX_API_KEY`, `OPENSANDBOX_PROTOCOL`, `OPENSANDBOX_REQUEST_TIMEOUT_MS`, `OPENSANDBOX_AGENT_IMAGE`, `OPENSANDBOX_SANDBOX_TIMEOUT_S`, `OPENSANDBOX_MAX_CONCURRENT`, `OPENSANDBOX_DEFAULT_CPU_LIMIT`, `OPENSANDBOX_DEFAULT_MEMORY_LIMIT`, `OPENSANDBOX_SECURE_RUNTIME`, `OPENSANDBOX_NETWORK_DEFAULT_ACTION`, `GEMINI_ENABLED`, `GEMINI_API_KEY`, `GEMINI_BASE_URL`, `GEMINI_MODEL`, `CODEX_ENABLED`, `OPENAI_BASE_URL`, `CODEX_MODEL`, `KIMI_ENABLED`, `KIMI_API_KEY`, `KIMI_BASE_URL`, `KIMI_MODEL`, `AI_PRIMARY_PROVIDER`

**Given** `configuration.ts` is updated
**When** a developer inspects it
**Then** the `cursor` config block is absent; old sandbox config keys (`sandbox.resourceLimits`, `sandbox.workspacesRoot`, `sandbox.logsRoot`, `sandbox.containerTimeoutMs`, `sandbox.containerExecutionEnabled`, `sandbox.maxConcurrent`) are absent; an `opensandbox` config block exists with all fields from PRD FR-OS38; `gemini`, `codex`, and `kimi` config blocks exist following the same pattern as the existing `anthropic` block

**Given** `ANTHROPIC_MAX_TOKENS` and `ANTHROPIC_TIMEOUT_MS` are evaluated during implementation
**When** the decision is made
**Then** if `AICostTrackerService` or `ComplexityScorerService` still makes direct Anthropic SDK calls, these variables are retained under `anthropic.direct` config namespace; otherwise they are removed — the decision is documented in a code comment

**Given** the updated `env.validation.ts` and `configuration.ts`
**When** `pnpm typecheck` is run
**Then** zero TypeScript errors

### Story OS-5.2: .env.example Regeneration and Final Production Audit

As a **Developer**,
I want `.env.example` fully regenerated with zero dead variables and a clean section structure,
So that any developer cloning the repo gets accurate configuration guidance with no confusion about what is actually used.

**Acceptance Criteria:**

**Given** `.env.example` is regenerated
**When** a developer inspects it
**Then** it contains a `# OPENSANDBOX CONFIGURATION` section replacing the old `# DOCKER CLIENT CONFIGURATION`, `# SANDBOX RESOURCE LIMIT ENFORCEMENT`, and `# AI PROVIDER CONTAINER EXECUTION` sections; it contains `# GEMINI PROVIDER`, `# CODEX PROVIDER`, and `# KIMI PROVIDER` sections with all new variables and explanatory comments

**Given** `.env.example` is regenerated
**When** checked against the removed variables list from PRD section 5.16.6
**Then** none of these appear: `DOCKER_SOCKET_PATH`, `DOCKER_CONNECTION_RETRY_ATTEMPTS`, `DOCKER_CONNECTION_RETRY_DELAY_MS`, `ENABLE_CONTAINER_EXECUTION`, `DOCKER_CONTAINER_TIMEOUT_MS`, `DOCKER_MAX_CONCURRENT`, `SANDBOX_WORKSPACES_ROOT`, `SANDBOX_LOGS_ROOT`, `SANDBOX_ENABLE_RESOURCE_LIMITS`, `SANDBOX_MEMORY_LIMIT_MB`, `SANDBOX_CPU_LIMIT_PERCENT`, `SANDBOX_MEMORY_SWAP_LIMIT_MB`, `CURSOR_HEADLESS_ENABLED`, `CURSOR_HEADLESS_HEALTH_URL`, `CURSOR_HEADLESS_TIMEOUT`, `CURSOR_HEADLESS_TIMEOUT_MS`, `CURSOR_MAX_CONCURRENT`, `CURSOR_MAX_CONCURRENT_WORKSPACES`, `CURSOR_CLI_PATH`, `CURSOR_WORKSPACES_ROOT`, `CURSOR_PRESERVE_FAILED_WORKSPACES`, `CURSOR_WORKSPACE_CLEANUP_AGE_MS`, `CURSOR_GIT_USER_NAME`, `CURSOR_GIT_USER_EMAIL`, `CURSOR_API_KEY`, `WINDSURF_API_KEY`, `LOG_STREAM_THROTTLE_MS`, `CLAUDE_WORKSPACES_ROOT`

**Given** all 5 epics are complete and a final production readiness audit is run
**When** the remaining grep check is run: `grep -r "CURSOR_HEADLESS" src/ --include="*.ts"`
**Then** it returns zero results

**Given** a final production readiness audit is run
**When** `pnpm check` (lint + test + build) completes
**Then** zero lint errors, zero test failures, build succeeds

**Given** the Prometheus `/metrics` endpoint is checked post-full-migration
**When** scraped after at least one successful execution
**Then** `opensandbox_executions_total` is present; none of the `sandbox_container_*` DooD metrics appear
