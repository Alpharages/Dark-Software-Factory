# Deferred Work Log

## Deferred from: code review of wr-3-1-wire-all-execution-milestones-to-progress-bar (2026-04-02)

- **W1: Multiple sequential `type:'result'` lines merge via spread accumulation** — second partial line with missing keys does not overwrite prior values via spread semantics, but behavior is undocumented and untested. Revisit if agent protocol ever emits incremental result lines. [`codex.provider.ts`, `gemini.provider.ts`, `kimi.provider.ts`]
- **W2: `agentResult.branchName || featureBranch` — empty-string branchName silently replaced by local fallback** — theoretical edge case; agent protocol does not emit empty branchName in practice. Revisit if agent output contract changes. [`codex.provider.ts`, `gemini.provider.ts`, `kimi.provider.ts`]
- **W3: Fourth error message branch (`'Agent process exited with non-zero code after emitting result'`) is dead code** — requires exitCode≠0 with a valid result line; no test exercises this combination. Pre-existing pattern unchanged by this story. [`codex.provider.ts`, `gemini.provider.ts`, `kimi.provider.ts`]
- **W4: ClaudeCode lacks stdout buffered fallback; Codex/Kimi/Gemini have it** — pre-existing architectural divergence; ClaudeCode is strictly dependent on `onStdoutLine` delivery. Undocumented cross-provider difference. [`claude-code.provider.ts` vs others]
- **W5: `isRetryable:false` for crash-with-no-result path not explicitly asserted in Codex/Kimi/Gemini crash tests** — asymmetric coverage vs timeout/QA paths which now assert `isRetryable:true`. Minor gap; add assertion if retry orchestration logic is hardened. [`codex.provider.spec.ts`, `kimi.provider.spec.ts`, `gemini.provider.spec.ts`]

## Deferred from: code review of wr-2-5-extend-api-key-redaction-to-all-provider-keys (2026-04-02)

- **`.flat()` single-level flatten is structurally fragile for nested log args** — `mock.calls.flat().join(' ')` only flattens one level; if a future `logger.debug` call passes an object argument, the raw value inside it would survive as `[object Object]` and elude the absence assertions. Spec mandated this approach; revisit if logger call signatures change. [`src/sandbox/sandbox.service.spec.ts`]
- **AUTH regex over-matches legitimate non-sensitive vars** — `/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i` will silently redact vars like `AUTHOR`, `OAUTH_REDIRECT_URI`, or `FEATURE_AUTH_LOGGING` in debug output. Pre-existing behavior not changed by this story. [`src/sandbox/sandbox.service.ts:redactEnvForLogging`]
- **ANTHROPIC_API_KEY named in JSDoc but has no dedicated test** — AC-2 specifies 4 keys (OPENAI, KIMI, GEMINI, CODEX); ANTHROPIC is covered by the regex `KEY` branch but is never exercised in T16 or T16b. Add an explicit test value if ANTHROPIC redaction becomes a compliance requirement. [`src/sandbox/sandbox.service.spec.ts`]
- **No test verifies redaction at warn/error/verbose log levels** — Spec Dev Notes confirm `logger.debug` is the only call that touches env vars; checking other severity levels is out of scope. Revisit if additional logger calls are added to `runAgentCommand`. [`src/sandbox/sandbox.service.spec.ts`]
- **Value-based secret leakage — secrets under non-sensitive key names not redacted** — Redaction is key-name-based; a secret stored under e.g. `CLAUDE_PROVIDER_TOKEN_VALUE` would appear unredacted in logs. Pre-existing design scope limitation. [`src/sandbox/sandbox.service.ts:redactEnvForLogging`]

## Deferred from: code review of wr-2-4-implement-codex-kimi-gemini-full-agentic-workflow (2026-04-01)

- **`void this.executionTracker.emitProgress(...)` silently swallows errors** — fire-and-forget is intentional per AC-2; consistent with WR-2.3 ClaudeCodeProvider pattern. Revisit if progress tracking reliability becomes a requirement. [`codex.provider.ts`, `gemini.provider.ts`, `kimi.provider.ts`]
- **`QA_MAX_RETRIES = '3'` hardcoded in each provider** — intentional per AC-5 spec. Make configurable via `ConfigService` if retry policy needs to vary per project or environment in a future story.
- **`parsed as SandboxResultLine` unsafe cast** — no runtime validation that required fields (`commitSha`, `branchName`, etc.) are present. Same accepted pattern from ClaudeCodeProvider (WR-2.3). Add Zod/schema validation if agent output reliability becomes a concern.
- **DEBUG log of non-JSON stdout lines may surface partial sensitive content** — truncated to 120 chars; consistent with ClaudeCodeProvider. Consider redacting at the SandboxService layer instead. [`codex.provider.ts`, `gemini.provider.ts`, `kimi.provider.ts`]
- **Fallback stdout scan: `reverse()` + full array iteration with no size guard** — for very large stdout (50MB+) this creates a transient ~100MB allocation. Add `maxChars` guard on stdout before splitting if large-output agents become common. [`codex.provider.ts`, `gemini.provider.ts`, `kimi.provider.ts`]
- **`sandboxResult` silently overwritten on multiple `type:'result'` lines** — last-wins is safe behavior; requires an agent-side bug to trigger. Log a warning if a second result line is seen.
- **Dockerfile `chmod 644` after `COPY --chown` creates a redundant layer** — cosmetic; consolidate with `--chmod=644` on the COPY instruction (requires BuildKit). [`docker/Dockerfile.agents`]
- **`onStdoutLine` partial-line flush scenario not covered in provider tests** — SandboxService owns flush logic; this should be tested in sandbox service unit tests, not provider tests.
- **`rawOutput` in error objects includes full stdout+stderr** — may contain prompt content. Pre-existing pattern from the old error path.
- **Dockerfile skill directory paths for Codex/Gemini/Kimi unverified** — `~/.codex/skills/`, `~/.gemini/skills/`, `~/.kimi/skills/` are assumed conventions; if wrong, skill bundles silently but agent invocation fails at runtime. Will verify in staging smoke test. [`docker/Dockerfile.agents`]

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

## Deferred from: code review of wr-2-2-author-bundle-dsf-execution-agent-skill (2026-04-01)

- **`FROM dsf-agents-base:latest` no digest pin** — mutable base tag is a supply-chain and reproducibility risk; any base image update silently changes the sandbox environment. Pin to a `sha256:` digest when the base image lifecycle is stabilised. [`docker/Dockerfile.agents:15`]
- **GitHub CLI no version pin** — `apt-get install -y gh` pulls latest CLI on every rebuild; breaking or compromised releases are auto-adopted. Add `gh=<version>` pin alongside the base image digest fix. [`docker/Dockerfile.agents:26`]
- **Package manager detection falls to `npm` for non-Node repos** — the SKILL.md detects pnpm/yarn from lockfiles but falls through to `npm` for Python, Go, Rust, or any non-Node project; all QA retries are wasted. Extend detection or add a `QA_COMMAND` override env var in a future story.
- **No timeout on QA commands** — `pnpm lint && pnpm test` can hang indefinitely on a stuck test suite; no `timeout` wrapper or wall-clock circuit breaker is specified. Add `QA_TIMEOUT_SECONDS` env var support in a future story.
- **`exitCode` binary inference in SandboxService** — `exitCode = execResult.error ? 1 : 0` discards specific exit codes (128 git fatal, 130 SIGINT, etc.). Downstream retry logic cannot distinguish failure classes. Fix in a dedicated SandboxService improvement story. [`src/sandbox/sandbox.service.ts`]
- **No workspace isolation for concurrent agent runs** — hardcoded `workspace/` directory name means two agent containers sharing a filesystem collide on `git clone`. Requires either per-execution temp dirs (e.g., `$(mktemp -d)`) or Docker volume isolation enforced by the orchestrator.

## Deferred from: code review of wr-1-2-delete-legacy-dood-pipeline-components (2026-04-01)

- **`--dangerously-skip-permissions` + unpinned `npm install` in ClaudeCodeProvider** — OS-2 scope change bundled into this diff. Security flag disables permission prompts inside container; unpinned install is non-deterministic. Revisit in OS-2 retrospective or a dedicated security story.
- **`ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` rename** — OS-2 scope. Deployment environments, secret managers, and Docker Compose files must be updated to use new var name or Claude Code provider will silently have no API key.
- **`pr-risk-assessor.service.ts` workspace removal may degrade AI output** — WR-1.1 scope. `executePrompt` no longer receives `workspacePath`; if provider uses workspace files for context, the risk assessment will produce hollow results. Verify provider implementations don't depend on this field.
- **`workspacePath` optional/removed from AI interfaces** — WR-1.1 scope. `IAIExecutionResult.workspacePath` now optional; `IAIPromptExecutionInput.workspacePath` removed. Any provider implementation reading `input.workspacePath` will get `undefined`. Build + integration tests must verify.
- **RabbitMQ `github-push-trigger-queue` binding persists with no consumer** — Intentional gap: WR-2 will wire a new agentic consumer. Messages published by `approval.service.ts` will accumulate until WR-2 lands. Monitor queue depth in staging.
- **`WorkspaceModel`/`WorkspaceArchiveModel` type exports removed without grep** — WR-1.1 scope. `pnpm build` will catch any remaining callers; run and confirm before deploying.

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

## Deferred from: code review of os-4-4-multi-provider-ai-routing-service-complexity-strategy (2026-03-27)

- **Override path uses hardcoded `MEDIUM` grade for `getFallbackFor`** — When `AI_PRIMARY_PROVIDER` overrides routing, `getFallbackFor(provider, ComplexityGrade.MEDIUM)` is called regardless of actual ticket complexity. A `CLAUDE_CODE` override on a HIGH-complexity ticket gets `GEMINI` as fallback instead of `CODEX`. Addressing this requires surfacing complexity grade into the override path, which would require interface changes out of scope for OS-4. Consider in OS-5 config/routing cleanup. [`src/ai-routing/provider-factory.service.ts:92`]

## Deferred from: code review of os-4-5-ai-routing-config-global-and-project-overrides (2026-03-27)

- **Unrelated seed change — `CURSOR_HEADLESS` → `CLAUDE_CODE` in sample execution/cost records** — This change is outside OS-4.5 scope and modifies sample data seeded for demonstration. Should be reviewed and reconciled in a dedicated seed cleanup story or OS-5.1 config cleanup. [`prisma/seed.ts:66,82`]

## Deferred from: code review of os-4-6-ui-ai-routing-config-settings-panels (2026-03-27)

- **No automated tests for new UI panels** — Spec explicitly excludes tests in this story (manual smoke only). Hook unit tests (mutation invalidation paths) and panel role-gate tests should be added in a dedicated test story. [`src/hooks/queries/useAiRoutingConfig.ts`, `src/pages/settings/panels/*`]
- **`parseInt` without explicit radix on number inputs** — `parseInt(e.target.value) || 0` omits radix 10. Low risk for `type="number"` inputs in modern browsers but not technically correct. [`GlobalAiRoutingPanel.tsx`, `ProjectAiRoutingPanel.tsx`]
- **Ad-hoc error shape instead of `AxiosError`** — Mutation `onError` handlers use hand-rolled `{ response?: { data?: { message?: string } } }` instead of the Axios error type. Matches existing codebase pattern but will drop non-message error payloads. [`GlobalAiRoutingPanel.tsx`, `ProjectAiRoutingPanel.tsx`]
- **`useEffect` for seeding form state from query data** — Uses `eslint-disable react-hooks/set-state-in-effect`. Mirrors the canonical `GeneralSettingsPanel` pattern intentionally; revisit if React upgrades this to a hard error. [`GlobalAiRoutingPanel.tsx`, `ProjectAiRoutingPanel.tsx`]
- **`getProjectAiRoutingConfig` returns `data ?? {}`** — Conflates empty HTTP response with "no overrides". Downstream code treats `{}` as valid config. Consider returning `data ?? null` and handling null explicitly. [`src/api/aiRoutingConfigApi.ts:getProjectAiRoutingConfig`]
- **Save button positioned under second card** — "Save Strategy" lives inside the Provider Tier Mapping card, not after both cards. Admin editing only threshold fields may not visually associate Save with their changes. [`GlobalAiRoutingPanel.tsx`]
- **Relative imports in `App.tsx`** — Dev notes mandate `@/` aliases. `App.tsx` pre-exists with relative imports throughout; the new imports follow existing convention. Standardize as part of a future import cleanup pass. [`src/App.tsx`]
- **Tier primary `ProviderSelect` silently drops null via `v && setForm(...)`** — If Radix Select emits a null/falsy for a required tier-primary field (not possible under current allowNull=false config but possible after future refactor), the update is silently ignored. [`GlobalAiRoutingPanel.tsx`]

## Deferred from: code review of os-5-1-env-validation-configuration-module-cleanup (2026-03-27)

- **Magic Number `1.2` in `RiskScoringService` tests** — Expectation uses hardcoded value instead of referencing the `DEFAULT_RISK_RULES` constant from the service. Pre-existing pattern across risk tests; revisit for standardization. [`qa-sampling.service.spec.ts:260`]
- **Architecture constraints typed as `any[]`** — `prompt-generator.service.ts` uses `let constraints: any[]` with `eslint-disable-line` to bypass the return type of `ArchitectureConstraintsService.findAll()`. Accessing `c.type`, `c.scope`, `c.rules` without type safety. Pre-existing pattern in codebase; replace with proper entity type in a future type-hardening pass. [`src/ai-routing/prompt-generator.service.ts`]
- **No caching for `architectureConstraintsService.findAll()` in `generatePrompt` hot path** — Every AI prompt generation now hits the DB for architecture constraints. Under concurrent ticket execution this adds per-call DB pressure. Requires TTL and cache-invalidation design decision before implementing. [`src/ai-routing/prompt-generator.service.ts`]

## Deferred from: code review of os-5-2-env-example-regeneration-final-production-audit (2026-03-27)

- **LOG_LEVEL default change lacks local dev guidance** — `.env.example` changed from `"debug"` to `"info"` to align with Joi schema default. No comment added to guide developers to use `"debug"` for local development. Low-impact cosmetic gap; add `# Use 'debug' for local development` in a future .env.example maintenance pass. [`.env.example`]

## Deferred from: code review of wr-2-1-establish-shared-provider-contract-execution-state (2026-04-01)

- **DTO missing `tokensInput`/`tokensOutput`/`model` fields** — `AIExecutionResultDto` does not expose `tokensInput`, `tokensOutput`, or `model` from `IAIExecutionResult`. These fields exist in the interface but are omitted from the Swagger DTO, creating a documentation drift. Consolidate in a future DTO-hardening pass. [`src/ai-routing/dto/ai-execution.dto.ts`]
- **`IWorkspaceInfo.branchName` vs `IAIExecutionResult.branchName` naming collision** — Both interfaces have a `branchName` field in the same file (`ai-provider.interface.ts`), with different semantics (workspace feature branch vs agent-produced branch). No runtime conflict but cosmetically confusing. Add JSDoc disambiguation comments (`/** Feature branch pushed by sandbox agent */` vs `/** Current feature branch in workspace */`) in a future cleanup pass. [`src/ai-routing/interfaces/ai-provider.interface.ts:237`]
- **DTO file header references stale "Story 2.6: Cursor CLI Headless Mode"** — The top-of-file comment in `ai-execution.dto.ts` references the original Cursor headless story. Update to reflect the file's expanded responsibility for sandbox provider contracts. [`src/ai-routing/dto/ai-execution.dto.ts:1-5`]
- **`success: true` + `qaStatus: 'failed'` is a structurally valid but self-contradictory result** — The type system permits `{ success: true, qaStatus: 'failed' }`. WR-2.3 provider implementation must ensure this combination never occurs. Consider adding a runtime assertion or validation comment when WR-2.3 lands. [`src/ai-routing/interfaces/ai-provider.interface.ts`]
- **`QA_FAILED` phase wired in PHASE_DESCRIPTIONS but not yet handled in the consumer** — `ai-execution.consumer.ts` only handles `STARTED`, `COMPLETED`, `FAILED` phases. `QA_FAILED` status transitions will be wired by WR-4 stories. Confirm WR-4.1 adds the `QA_FAILED` call path in `ai-execution.consumer.ts`. [`src/execution/ai-execution.consumer.ts`]
- **`commitSha?: string` allows empty string in the interface and DTO** — Empty string is falsy but not cleanly distinguishable from absent (`undefined`). WR-2.3 stdout parser should either populate a valid 40-char SHA or omit the field entirely. Add a validation note to the WR-2.3 story. [`src/ai-routing/interfaces/ai-provider.interface.ts:81`]
- **No enforced default for `qaStatus: 'skipped'` in the shared contract** — AC-3 states consumers should default `qaStatus` to `'skipped'` when absent. This is a documented consumer responsibility, not enforced by the interface. WR-2.3 and WR-2.4 providers must apply this default when legacy providers omit the field. [`src/execution/ai-execution.consumer.ts`]

## Deferred from: code review of wr-2-3-implement-claude-code-provider-full-agentic-workflow (2026-04-01)

- **`agentResult` spread merges all JSON fields without schema whitelist** — `agentResult = { ...agentResult, ...parsed }` accepts any fields from agent stdout. Low risk in controlled sandbox context; post-MVP hardening. [`claude-code.provider.ts`]
- **Truncated JSON result line (multi-chunk) silently dropped** — If `result:{...}` spans two SDK chunks with `\n` inside the JSON body, `JSON.parse` fails on the first half and the remainder is ignored. Requires SDK-level stream contract change to fix robustly. [`sandbox.service.ts`]
- **`TASK_DESCRIPTION: prompt` no max-length guard** — Oversized prompts could exceed Linux ARG_MAX (~128KB) in container env. Pre-existing concern, not in WR-2.3 scope. [`claude-code.provider.ts`]
- **`agentResult` spread mutation theoretical race** — If SDK ever batches `onStdout` callbacks via microtasks, two in-flight spreads could interleave. JS single-threaded model makes this safe in practice. [`claude-code.provider.ts`]
- **`emitProgress .catch()` logs error message only, loses stack trace** — Logging quality improvement; non-critical for progress indicators. [`claude-code.provider.ts`]
- **QA failure + simultaneous timeout → `error.code` would be TIMEOUT instead of PROCESS_CRASH** — Edge case: if sandbox times out and the agent had already emitted a `qaStatus: failed` result line, the error code is TIMEOUT not PROCESS_CRASH. Highly unlikely in practice. [`claude-code.provider.ts`]
