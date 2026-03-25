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

## Deferred from: code review of os-1-4-sandbox-prometheus-metrics-concurrency-leak-prevention (2026-03-24)

- **T26 semaphore concurrency test is timing-dependent** — Uses `setTimeout(resolve, 50)` to assert queued state; flaky under CI load. Should hook into semaphore queue state directly via spy. [`sandbox.service.spec.ts:533`]
- **`checkForLeakedSandboxes()` makes two `listActiveSandboxes()` SDK calls when sandboxes are killed** — Could optimise to `activeSandboxes.length - killedCount` to avoid the second paginated list call. Acceptable at current scale. [`sandbox.service.ts:352–353`]
- **`Semaphore` has no guard against `maxConcurrent ≤ 0` or `NaN`** — Both values deadlock all executions (acquire() queues forever, release() count < max guard always false for NaN). Joi startup validation in OS-1.2 is the only guard. Add `Math.max(1, maxConcurrent)` clamp in onModuleInit() for defense-in-depth. [`sandbox.service.ts:58–59`]
- **`?? 3600` does not protect against NaN `sandboxTimeoutS`** — NaN is not null/undefined so `NaN ?? 3600 = NaN`; `ageMs > NaN` is always false, silently disabling leak prevention. Protected by Joi validation but `Number.isFinite()` check would be safer. [`sandbox.service.ts:321`]
