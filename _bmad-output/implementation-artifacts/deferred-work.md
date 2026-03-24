# Deferred Work Log

## Deferred from: code review of os-1-3-sandbox-command-execution-real-time-log-streaming (2026-03-24)

- **All egress rules hardcode `action: 'allow'`** — `egressRules` in `AgentCommandOptions` only has `target` (no `action` field), so per-rule deny is architecturally impossible in the current interface. Revisit when OS-2 refines network policy requirements and if per-rule deny becomes a need. [`sandbox.service.ts:123-127`]
- **`connectionConfigOptions` caches API key as class field** — The plaintext API key lives as a class-level field for the service lifetime. If key rotation is needed, the server must restart. Consider injecting a secrets-manager abstraction or re-reading config per execution in OS-1.4 or a future secrets-management story. [`sandbox.service.ts:12`]

## Deferred from: code review of os-1-4-sandbox-prometheus-metrics-concurrency-leak-prevention (2026-03-24)

- **T26 semaphore concurrency test is timing-dependent** — Uses `setTimeout(resolve, 50)` to assert queued state; flaky under CI load. Should hook into semaphore queue state directly via spy. [`sandbox.service.spec.ts:533`]
- **`checkForLeakedSandboxes()` makes two `listActiveSandboxes()` SDK calls when sandboxes are killed** — Could optimise to `activeSandboxes.length - killedCount` to avoid the second paginated list call. Acceptable at current scale. [`sandbox.service.ts:352–353`]
- **`Semaphore` has no guard against `maxConcurrent ≤ 0` or `NaN`** — Both values deadlock all executions (acquire() queues forever, release() count < max guard always false for NaN). Joi startup validation in OS-1.2 is the only guard. Add `Math.max(1, maxConcurrent)` clamp in onModuleInit() for defense-in-depth. [`sandbox.service.ts:58–59`]
- **`?? 3600` does not protect against NaN `sandboxTimeoutS`** — NaN is not null/undefined so `NaN ?? 3600 = NaN`; `ageMs > NaN` is always false, silently disabling leak prevention. Protected by Joi validation but `Number.isFinite()` check would be safer. [`sandbox.service.ts:321`]
