# Deferred Work Log

## Deferred from: code review of os-1-3-sandbox-command-execution-real-time-log-streaming (2026-03-24)

- **All egress rules hardcode `action: 'allow'`** — `egressRules` in `AgentCommandOptions` only has `target` (no `action` field), so per-rule deny is architecturally impossible in the current interface. Revisit when OS-2 refines network policy requirements and if per-rule deny becomes a need. [`sandbox.service.ts:123-127`]
- **`connectionConfigOptions` caches API key as class field** — The plaintext API key lives as a class-level field for the service lifetime. If key rotation is needed, the server must restart. Consider injecting a secrets-manager abstraction or re-reading config per execution in OS-1.4 or a future secrets-management story. [`sandbox.service.ts:12`]

## Deferred from: code review of os-2-2-claude-code-provider-rewrite-sandbox-service (2026-03-26)

- **Prometheus metrics removed for Claude (5 counters/gauges)** — `claude_executions_total`, `claude_execution_duration_seconds`, `claude_active_executions`, `claude_tokens_total`, `claude_cost_cents` removed from `AiRoutingModule`. Intentional per spec; `SandboxService` owns execution metrics for the sandbox path. Revisit if Claude-specific cost/token tracking is needed in a future story.
- **Empty API key classified as `PROCESS_CRASH` (retryable=false not enforced)** — A blank `ANTHROPIC_AUTH_TOKEN` causes Claude CLI to fail with auth error → `PROCESS_CRASH`. `PROCESS_CRASH` has `isRetryable: false`, so it won't retry. But if the retry policy upstream overrides this, the consumer would waste 3× sandbox slots on a permanently misconfigured credential. Fix: validate API key presence in `execute()` and return `AIErrorCode.CLI_NOT_FOUND` (non-retryable) early. [`claude-code.provider.ts:41`]
- **`complexityScore` / `preCalculatedComplexity` dual fields in `IOrchestrationInput`** — `input.complexityScore` is populated by `AIExecutionConsumer` from DB but the orchestrator uses `selection.complexityScore` (from live complexity scorer). Both fields coexist with overlapping semantics. Consolidate when the DB-fetched complexity score is meant to override the live scorer (likely OS-3+ when complexity tracking is stabilised). [`orchestration.interface.ts:71-74`]
- **Legacy adapter `complexityScore: 5` hardcoded** — `AIExecutionService` legacy adapter always passes complexity 5 (medium) to `ClaudeCodeProvider`, ignoring actual ticket complexity. Low/high tickets are mis-provisioned. Fix when legacy adapter is retired in OS-4+. [`ai-execution.service.ts`]
- **`cancel()` no-op in legacy adapter** — Calling `cancel()` on the Claude legacy adapter logs a message but does not stop the sandbox container. Container runs until `sandboxTimeoutS`. Fix by storing the sandbox ID returned by `runAgentCommand` and calling `SandboxService.killSandbox()` in a future story. [`ai-execution.service.ts`]
- **AC5 e2e tests do not exercise the real pipeline** — `test/claude-code.e2e-spec.ts` mocks `ClaudeCodeProvider` with a plain object; state machine transitions and OpenSandbox container execution are never tested end-to-end. Requires a full integration test environment with a running OpenSandbox instance. Deferred to OS-5 integration testing story.

## Deferred from: code review of os-2-3-provider-fallback-health-circuit-breaker-compatibility (2026-03-26)

- **Missing `CURSOR_HEADLESS` in `mapAIProviderToProviderName`** — `orchestrator.service.ts` maps only `AIProvider.CLAUDE_CODE`; CURSOR_HEADLESS returns `undefined` and falls through to the old path. Pre-existing from OS-2.2. Revisit when CURSOR_HEADLESS is promoted to the coding-provider path.
- **`estimateCost` retains hardcoded switch over AIProvider values** — New providers (GEMINI, CODEX) silently return 0 cost. Pre-existing. Fix when additional providers are onboarded.
- **Metrics labels use `ProviderName` strings instead of `AIProvider` enum values** — `fallbackCounter`, `fallbackDuration`, `fallbackSuccessCounter` emit `ProviderName` strings (e.g., `CLAUDE_CODE`) rather than the canonical Prisma `AIProvider` enum. Pre-existing architectural pattern across old and new paths.
- **`providerUsage` spread cast `as Record<AIProvider, number>` is a type lie** — Callers of `getStats()` may assume all `AIProvider` keys are present; missing keys return `undefined` at runtime. Pre-existing pattern.
- **No test for `primary.execute` throwing (rejecting promise) in `executeWithFallbackCodingProvider`** — Method has no try/catch; a thrown exception bypasses fallback entirely. Deferred — out of scope for OS-2.3.
- **`calculateAvgExecutionTimes` default estimate changed for CURSOR_HEADLESS (120_000 ms → 60_000 ms)** — Minor behavioral regression in scheduling estimates for CURSOR_HEADLESS when no execution data exists. Accept or restore per-provider defaults when needed.

## Deferred from: code review of os-3-1-delete-dood-files-remove-docker-module (2026-03-26)

- **Prometheus metrics `sandbox_container_*` go dark** — 5 Prometheus metrics (`sandbox_container_memory_limit_bytes`, `sandbox_container_cpu_limit_percent`, `sandbox_container_oom_events_total`, `sandbox_container_cpu_throttled_seconds_total`, `sandbox_container_memory_usage_bytes`) removed with `DockerModule`. No replacement in `SandboxModule`. Grafana dashboards/alerts on these names will silently go dark. OS-3.2 is responsible for verifying the `/metrics` endpoint shows none of these names.
- **WorkspaceService replacement contract is implicit** — All 4 callers (`QaOrchestratorService`, `CleanupService`, `GitHubCommitOrchestratorService`, `GithubPushTriggerConsumer`) comment "handled by OpenSandbox TTL" with no interface contract or runtime guard. If OpenSandbox TTL-based cleanup fails, there is no local fallback and no compile-time safety net.
- **No surviving code writes to `workspace` Prisma table** — `WorkspaceService` was the sole writer of `workspace` rows (`prisma.workspace.upsert/create/update`). Four surviving services (`qa-orchestrator`, `github-commit-orchestrator`, `pr-risk-assessor`, `storage-manager`) all read `prisma.workspace.findUnique()` and throw/fail on `null`. OpenSandbox workspace lifecycle ownership needs to be confirmed and a workspace-row writer established before the full pipeline is exercised. Revisit in OS-3.2.
- **`WorkspaceService.recoverWorkspaces()` startup reconciliation removed** — Stale `CREATING/IN_USE` workspace rows from a crash will never be cleared, eventually blocking all new executions once phantom rows reach `maxConcurrent`. Address in OS-3.2 or a dedicated recovery story.
- **`injectAIInstructions` deleted with no replacement** — Logic that copied `.ai/instructions.md` → `CLAUDE.md`/`.cursorrules` into the workspace is gone. AI agents will receive no project-specific system instructions. Needs equivalent in the OpenSandbox workspace-setup flow.
- **`preserveFailedWorkspaces` guard deleted** — Failed workspaces that should be preserved for post-mortem debugging will be silently discarded. Needs equivalent config-gated guard in OS-3.2+.
- **`CostTrackingModule` imported twice in `AiRoutingModule` imports array** — `src/ai-routing/ai-routing.module.ts:55-56` has two consecutive `CostTrackingModule,` entries. Pre-existing. NestJS emits a startup warning; may cause double-initialization of cost tracking state in edge cases. Clean up in a future story.
- **Dead `run*Check` methods in `QaOrchestratorService`** — Lines 987–1227 of `qa-orchestrator.service.ts` are currently unreachable stubs. When re-enabled, any execution where the workspace row doesn't exist will silently return `passed: false` (swallowed by the outer try/catch) rather than surfacing an error. The TODO comment gives no completion criteria. Ensure workspace rows are created before re-enabling.
- **`cleanupAfterExecution` always returns `containerRemoved: true, workspaceCleaned: true`** — The no-op CleanupService now reports success regardless of sandbox TTL outcome. Any monitoring/alerting based on these fields will never see a cleanup failure. Consider a more meaningful return value once OS-3.2 determines what cleanup observability looks like.
- **`debug_mode` workspace preservation eliminated** — Previously `workspaceCleaned: false` when `preserveWorkspace=true` (debug mode). Now always `true`. Debug-workspace traceability needs an equivalent in OS-3.2+.
- **`CleanupModule` imports `AiRoutingModule` unnecessarily** — After `WorkspaceService` removal, nothing in `CleanupService` or `CleanupSchedulerService` uses any symbol from `AiRoutingModule`. The module import is dead weight (heavyweight eager instantiation). Safe to remove after verifying no transitive dependency exists.
- **`WorkspaceModel` type alias orphaned in `src/prisma/client.ts:79`** — `export type WorkspaceModel = Workspace;` has zero consumers after `workspace.service.ts` deletion. Safe to remove in a future cleanup pass.
- **SandboxResourceProfileService behavioral equivalence to deleted `getResourceProfile` is untested** — Deleted `resource-profile.interface.ts` defined `getResourceProfile('small'|'medium'|'large')`. Surviving `SandboxResourceProfileService` uses a structurally different `ResourceProfile` interface. Equivalence of mapping semantics is untested. Revisit when OS-3.2 verifies the full QA cycle passes.

## Deferred from: code review of os-3-1-delete-dood-files-remove-docker-module (2026-03-26)

- **`CursorHeadlessProvider` injects removed `cursor_*` metric tokens** — `cursor-headless.provider.ts:59,63` uses `@InjectMetric('cursor_executions_total')` and `@InjectMetric('cursor_active_executions')` which were removed from `AiRoutingModule`. Currently safe (not registered as provider), but will fail with a token-not-found error if accidentally re-registered before OS-4 cleanup. OS-4 story should delete the file entirely.
- **Stale model name `claude-3-5-sonnet-20240620` hardcoded in AIExecutionService** — `ai-execution.service.ts:~120` falls back to `'claude-3-5-sonnet-20240620'` when `result.model` is absent. This model name is outdated. Update when model naming policy is reviewed.
- **`ClaudeCodeProvider.cancel()` behavior untested** — `ai-execution.service.spec.ts:~242` has the cancel-provider assertion commented out. If/when `ClaudeCodeProvider` gains a `cancel()` method, add a coverage assertion here.

## Deferred from: code review of os-3-2-remove-legacy-dood-metrics-cleanup-service-verify (2026-03-26)

- **WorkspaceService grep check returns 5 comment-only hits** — `src/config/configuration.ts:165,175` have stale Story 2.6 comments referencing `WorkspaceService`; three spec files from OS-3.1 (`github-commit-orchestrator.service.spec.ts`, `pr-risk-assessor.service.spec.ts`, `qa-orchestrator.service.spec.ts`) have `// WorkspaceService removed` documentation comments. All are comment-only (no actual imports or calls) but technically fail the AC3 zero-result grep check. Clean up in OS-5.2 final grep-clean pass.
- **`timeoutHandle!` non-null assertion in `runWithTimeout`** — `src/cleanup/cleanup.service.ts:~155` uses `clearTimeout(timeoutHandle!)` in the `finally` block; TypeScript can't prove the executor ran synchronously but it always does. Standard pattern; harmless at runtime. If strict linting is tightened in OS-5, add a `: NodeJS.Timeout | undefined` annotation and guard.

## Deferred from: code review of os-1-4-sandbox-prometheus-metrics-concurrency-leak-prevention (2026-03-24)

- **T26 semaphore concurrency test is timing-dependent** — Uses `setTimeout(resolve, 50)` to assert queued state; flaky under CI load. Should hook into semaphore queue state directly via spy. [`sandbox.service.spec.ts:533`]
- **`checkForLeakedSandboxes()` makes two `listActiveSandboxes()` SDK calls when sandboxes are killed** — Could optimise to `activeSandboxes.length - killedCount` to avoid the second paginated list call. Acceptable at current scale. [`sandbox.service.ts:352–353`]
- **`Semaphore` has no guard against `maxConcurrent ≤ 0` or `NaN`** — Both values deadlock all executions (acquire() queues forever, release() count < max guard always false for NaN). Joi startup validation in OS-1.2 is the only guard. Add `Math.max(1, maxConcurrent)` clamp in onModuleInit() for defense-in-depth. [`sandbox.service.ts:58–59`]
- **`?? 3600` does not protect against NaN `sandboxTimeoutS`** — NaN is not null/undefined so `NaN ?? 3600 = NaN`; `ageMs > NaN` is always false, silently disabling leak prevention. Protected by Joi validation but `Number.isFinite()` check would be safer. [`sandbox.service.ts:321`]

## Deferred from: code review of os-4-1-retire-cursor-headless-provider-data-migration (2026-03-26)

- **Hardcoded threshold `10` in `determineRoutingReason`** — `src/ai-routing/ai-routing.service.ts` uses `complexityScore >= 10` instead of reading from config. Acknowledged as intentional simplification for OS-4.1; full routing reinstated in OS-4.4.

## Deferred from: code review of os-4-2-gemini-cli-provider (2026-03-26)

- **Whitespace API key bypasses `isHealthy()` guard** — `GEMINI_API_KEY='   '` passes `!!apiKey` check; Gemini CLI would fail auth at runtime. Same gap exists in `ClaudeCodeProvider`. No spec requirement to trim. [`src/ai-routing/providers/gemini.provider.ts:28`]
- **Hardcoded `confidenceScore: 0.8` on success** — Both `GeminiProvider` and `ClaudeCodeProvider` always return `0.8`. No dynamic confidence scoring implemented. Pre-existing from `ClaudeCodeProvider`. [`src/ai-routing/providers/gemini.provider.ts:75`]
- **`filesChanged: []` and `workspacePath: ''` always empty** — Callers cannot know which files changed without parsing `codeDiff`. Pre-existing from `ClaudeCodeProvider`. [`src/ai-routing/providers/gemini.provider.ts:73-74`]

## Deferred from: code review of os-4-3-openai-codex-kimi-cli-providers (2026-03-26)

- **Story 5.5 `OPENAI_API_KEY` Joi description silently dropped** — The original Joi definition (line ~347 of `env.validation.ts`) included `.messages()` and `.description()` documenting its use for Whisper transcription and GPT-4 analysis (Story 5.5). The new definition added by OS-4.3 is functionally equivalent but loses that context. The env var is now shared between two features (Codex provider and Conversations). Document intent and consolidate in OS-5.1 config cleanup. [`src/config/env.validation.ts`]
