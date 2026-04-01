# Story WR-2.5: Extend API Key Redaction to All Provider Keys

Status: ready-for-dev

## Story

As a **security-conscious platform engineer**,
I want `SandboxService`'s log redaction pattern extended to explicitly cover `CODEX_API_KEY`, `KIMI_API_KEY`, and `GEMINI_API_KEY`, and to have test coverage proving zero raw key values appear in logs,
So that no raw API key values for any provider can ever appear in logs, Sentry captures, or debug traces.

## Acceptance Criteria

**AC-1: Provider key names explicitly covered by redaction (FR-WR12)**
**Given** `SandboxService.redactEnvForLogging()` is called with an env map containing any of `CODEX_API_KEY`, `KIMI_API_KEY`, `GEMINI_API_KEY`
**When** the result is logged
**Then** all three key names produce `[REDACTED]` values — never raw key values

**AC-2: Zero raw key matches in logs at all severity levels (NFR-WR5)**
**Given** a test execution is run with all 4 provider keys set to known test values (`OPENAI_API_KEY`, `KIMI_API_KEY`, `GEMINI_API_KEY`, `CODEX_API_KEY`)
**When** the logger.debug output is captured
**Then** zero matches exist for any raw key value string at debug, warn, info, or error level

**AC-3: redactEnvForLogging comment documents covered keys**
**Given** the `redactEnvForLogging` method comment (NFR-OS5)
**When** a developer reads the method
**Then** the comment explicitly lists the provider-specific key names covered: `OPENAI_API_KEY`, `KIMI_API_KEY`, `GEMINI_API_KEY`, `CODEX_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`

**AC-4: Build clean**
**Given** all changes applied
**When** `pnpm build` runs
**Then** zero TypeScript compilation errors

## Tasks / Subtasks

- [ ] Task 1: Update `redactEnvForLogging` comment to document provider keys (AC: 1, 3)
  - [ ] 1.1 In `src/sandbox/sandbox.service.ts:L368`, update the method comment from `/** NFR-OS5: Redact sensitive values from env before logging */` to list the covered keys explicitly (see Dev Notes)
  - [ ] 1.2 Verify the existing regex `/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i` covers all provider keys — it does, no regex change required

- [ ] Task 2: Expand T16 redaction test to cover all provider key names (AC: 1, 2)
  - [ ] 2.1 In `src/sandbox/sandbox.service.spec.ts`, update test `'T16: should redact API keys in logger.debug'`
  - [ ] 2.2 Pass an env containing all 4 provider API key env var names with distinct raw values: `OPENAI_API_KEY`, `KIMI_API_KEY`, `GEMINI_API_KEY`, `CODEX_API_KEY`, plus a `NORMAL_VAR` (see Dev Notes for exact test body)
  - [ ] 2.3 Assert that `logger.debug` output contains `[REDACTED]` and does NOT contain any of the raw key values
  - [ ] 2.4 Assert `NORMAL_VAR` value still appears unredacted

- [ ] Task 3: Add a dedicated NFR-WR5 test (AC: 2)
  - [ ] 3.1 Add test `'T16b: NFR-WR5 — no raw provider API key value appears in any debug output'` (see Dev Notes)
  - [ ] 3.2 Verify logger.debug was never called with any raw key value string for all 4 key names

- [ ] Task 4: Validate build and tests (AC: 4)
  - [ ] 4.1 `pnpm build` → zero TypeScript errors
  - [ ] 4.2 `pnpm test -- --testPathPattern="sandbox.service"` → all pass including T16 and T16b

## Dev Notes

### Why No Regex Change is Needed

The existing regex in `sandbox.service.ts:L371`:

```typescript
const SENSITIVE = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i;
```

Already matches:

- `CODEX_API_KEY` → contains "KEY" ✓
- `KIMI_API_KEY` → contains "KEY" ✓
- `GEMINI_API_KEY` → contains "KEY" ✓
- `OPENAI_API_KEY` → contains "KEY" ✓
- `ANTHROPIC_API_KEY` → contains "KEY" ✓
- `GITHUB_TOKEN` → contains "TOKEN" ✓
- `DSF_AGENTIC_PROMPT` → NOT matched — intentional, it's the prompt text, not a credential

**No regex change required.** This story is about making the coverage explicit via comment documentation and comprehensive test assertions.

### Updated Comment for `redactEnvForLogging` (Task 1.1)

Replace:

```typescript
/** NFR-OS5: Redact sensitive values from env before logging */
private redactEnvForLogging(env?: Record<string, string>): Record<string, string> {
```

With:

```typescript
/**
 * NFR-OS5 / NFR-WR5: Redact sensitive env var values before logging.
 * Covers: OPENAI_API_KEY, ANTHROPIC_API_KEY, CODEX_API_KEY, KIMI_API_KEY,
 *         GEMINI_API_KEY, GITHUB_TOKEN, and any env var whose name contains
 *         KEY | TOKEN | SECRET | PASSWORD | CREDENTIAL | AUTH (case-insensitive).
 * Raw key values must NEVER appear in logs, Sentry captures, or debug traces.
 */
private redactEnvForLogging(env?: Record<string, string>): Record<string, string> {
```

### Test Assertion Pattern Explanation

T16 and T16b use `.mock.calls.flat().join(' ')` to aggregate all debug output into one string for absence checks. This differs from the simpler `.toHaveBeenCalledWith()` pattern used in other tests because:

- We're asserting **absence** (no raw value anywhere) — not a specific call signature
- The env object is spread across one debug call, but we need a single scan across all calls
- `.toHaveBeenCalledWith()` would require knowing exact call arguments; `.mock.calls.flat()` catches any call

`defaultOptions` is the base fixture in the spec:

```typescript
const defaultOptions = {
  executionId: 'exec1',
  ticketId: 't1',
  image: 'i1',
  command: 'echo test',
  env: { NORMAL_VAR: 'val' },
  timeoutSeconds: 30,
  cpuLimit: '1',
  memoryLimit: '1Gi',
};
```

When you spread `...defaultOptions` and then set `env: { ... }`, the explicit `env` overwrites the spread — the `NORMAL_VAR: 'val'` from defaultOptions is NOT included unless you add it explicitly in the new env object.

### Updated T16 Test Body (Task 2.2–2.4)

Replace the existing T16 test in `sandbox.service.spec.ts`:

```typescript
it('T16: should redact API keys in logger.debug', async () => {
  mockSandbox.commands.run.mockResolvedValue({});

  await service.runAgentCommand({
    ...defaultOptions,
    env: {
      OPENAI_API_KEY: 'sk-openai-secret',
      KIMI_API_KEY: 'km-kimi-secret',
      GEMINI_API_KEY: 'gm-gemini-secret',
      CODEX_API_KEY: 'cdx-codex-secret',
      NORMAL_VAR: 'val',
    },
  });

  const debugCalls = ((service as any).logger.debug as jest.Mock).mock.calls.flat().join(' ');

  // All raw key values must be absent
  expect(debugCalls).not.toContain('sk-openai-secret');
  expect(debugCalls).not.toContain('km-kimi-secret');
  expect(debugCalls).not.toContain('gm-gemini-secret');
  expect(debugCalls).not.toContain('cdx-codex-secret');

  // [REDACTED] marker must be present
  expect(debugCalls).toContain('[REDACTED]');

  // Non-sensitive vars still appear
  expect(debugCalls).toContain('val');
});
```

### New T16b Test Body (Task 3.1–3.2)

Add after T16:

```typescript
it('T16b: NFR-WR5 — no raw provider API key value appears in any debug output', async () => {
  mockSandbox.commands.run.mockResolvedValue({});

  const sensitiveValues = [
    'sk-openai-secret',
    'km-kimi-secret',
    'gm-gemini-secret',
    'cdx-codex-secret',
  ];

  await service.runAgentCommand({
    ...defaultOptions,
    env: {
      OPENAI_API_KEY: sensitiveValues[0],
      KIMI_API_KEY: sensitiveValues[1],
      GEMINI_API_KEY: sensitiveValues[2],
      CODEX_API_KEY: sensitiveValues[3],
    },
  });

  const allDebugOutput = ((service as any).logger.debug as jest.Mock).mock.calls.flat().join(' ');

  for (const rawValue of sensitiveValues) {
    expect(allDebugOutput).not.toContain(rawValue);
  }
});
```

### Sentry Coverage Note

No Sentry calls exist in `sandbox.service.ts` (confirmed by grep). The existing logger-level redaction is sufficient. No Sentry `beforeSend` scrubbing change is needed at the sandbox level.

**The only logging call that touches env vars is `logger.debug` at L157–161** — it calls `redactEnvForLogging()` before serializing. There are two other logger calls in `runAgentCommand` that do NOT involve env vars:

- `logger.log()` at ~L239 — logs byte counts and timing only (no env values)
- `logger.error()` at ~L272 — logs SDK error message only (no env values)

If Sentry captures an unhandled error thrown inside `runAgentCommand`, the error message will not contain raw env values because the SDK error messages are API-level (sandbox ID, HTTP status), not env var dumps.

### Important Context from WR-2.4

From `wr-2-4-implement-codex-kimi-gemini-full-agentic-workflow.md` Dev Notes:

> "No CODEX_API_KEY in this story: The current codex provider uses OPENAI_API_KEY. Keep this for CLI compatibility. WR-2.5 is responsible for adding redaction of provider-specific key names — do NOT change env var names here."

**Implication:** The Codex provider (WR-2.4) passes `OPENAI_API_KEY` to the sandbox env — not `CODEX_API_KEY`. The `CODEX_API_KEY` name is a future-proofing coverage added by this story (the regex covers it, tests now assert it). Do NOT change any provider env var names in this story.

### Files Changed in This Story

| File                                  | Change                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `src/sandbox/sandbox.service.ts`      | Update `redactEnvForLogging` JSDoc comment only — no logic change        |
| `src/sandbox/sandbox.service.spec.ts` | Expand T16 test to cover all 4 provider key names; add T16b NFR-WR5 test |

**No other files change.** This story touches only the sandbox service and its spec.

### Project Structure Notes

- All changes are confined to `src/sandbox/` — no module, provider, or config changes
- Use the existing mock pattern: `(service as any).logger.debug` (private field access already used in T16)
- The `mockSandbox.commands.run.mockResolvedValue({})` is the same stub as existing T16 setup — keep it
- Do NOT add or change any `describe` groupings — add T16b directly after T16 in the existing `runAgentCommand` describe block

### References

- [Source: epics-workspace-removal.md#Story-WR-2.5] — FR-WR12, NFR-WR5 requirements
- [Source: epics-workspace-removal.md#FR-WR12] — "CODEX_API_KEY, KIMI_API_KEY, GEMINI_API_KEY redaction"
- [Source: epics-workspace-removal.md#NFR-WR5] — "Zero raw key value matches in logs/Sentry at all severity levels"
- [Source: src/sandbox/sandbox.service.ts#L368-L378] — `redactEnvForLogging()` method — regex, loop
- [Source: src/sandbox/sandbox.service.ts#L156-L161] — only logging call that uses env vars (L239 logs sizes only; L272 logs error message only)
- [Source: src/sandbox/sandbox.service.spec.ts#L342-L354] — existing T16 test to expand
- [Source: wr-2-4-implement-codex-kimi-gemini-full-agentic-workflow.md#Dev-Notes] — "WR-2.5 is responsible for adding redaction of provider-specific key names"
- [Source: wr-2-4-implement-codex-kimi-gemini-full-agentic-workflow.md#Dev-Notes] — "SandboxService.redactEnvForLogging() regex already covers KIMI_API_KEY, GEMINI_API_KEY via KEY pattern"

---

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 — story created 2026-04-01

### Debug Log References

### Completion Notes List

### File List
