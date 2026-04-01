# Story WR-2.3: Implement ClaudeCodeProvider Full Agentic Workflow

Status: done

## Story

As a **platform engineer**,
I want `ClaudeCodeProvider.execute()` to run the complete agentic delivery loop via the `dsf-execution` SKILL.md and parse the structured stdout output,
So that a Claude Code sandbox execution produces a real PR on GitHub with no backend pipeline orchestration.

## Acceptance Criteria

**AC-1: Sandbox launched with all required env vars and dsf-agents image**
**Given** `ClaudeCodeProvider.execute()` is called for a ticket
**When** it launches the sandbox
**Then** the sandbox uses image `dsf-agents:latest` (from `opensandbox.agentImage` config key — set `OPENSANDBOX_AGENT_IMAGE=dsf-agents:latest` in `.env`)
**And** the command is `claude --dangerously-skip-permissions -p "/dsf-execution"` (no `npm install` prefix — Claude Code is pre-installed in `dsf-agents:latest`)
**And** all required env vars are passed: `REPO_URL`, `FEATURE_BRANCH`, `TASK_DESCRIPTION`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `QA_MAX_RETRIES=3`
**And** `ANTHROPIC_MODEL` is still passed (Claude Code CLI respects it)
**And** optional `ANTHROPIC_BASE_URL` is still conditionally passed if configured

**AC-2: Stdout parsed line-by-line in real time (NFR-WR4)**
**Given** the sandbox is running and emitting stdout
**When** each complete line of stdout is received
**Then** the provider attempts `JSON.parse` on each line
**And** if the line parses as `{ "type": "progress", "pct": number, "msg": string }`, `ExecutionTrackerService.emitProgress(executionId, ticketId, projectId, msg, pct)` is called (fire-and-forget — never blocks execution)
**And** if the line does NOT parse as valid JSON, it is logged at debug level and silently skipped — the execution NEVER crashes (NFR-WR4)
**And** raw stdout continues streaming via `ExecutionGateway.emitLog()` concurrently and unchanged (FR-WR8 preservation — handled by `SandboxService`)

**AC-3: Final result line parsed and IAIExecutionResult populated**
**Given** the sandbox completes successfully
**When** a line parses as `{ "type": "result", ... }` during `onStdoutLine` processing
**Then** `prUrl`, `commitSha`, `branchName`, `qaStatus`, and `qaRetryCount` are captured
**And** after `runAgentCommand` returns, these values populate the returned `IAIExecutionResult` (FR-WR13)
**And** `success: true` is returned when `exitCode === 0` AND `resultLine.qaStatus !== 'failed'`

**AC-4: Hard QA failure returns correct result shape**
**Given** the agent exhausted all QA retries and pushed the branch without opening a PR
**When** the result line contains `{ "type": "result", "qaStatus": "failed", "prUrl": null }`
**Then** the provider returns `success: false`, `qaStatus: 'failed'`, `branchName` populated, `prUrl: undefined`
**And** the execution never throws — it returns a result with `success: false` (the consumer handles QA_FAILED state transition in WR-4)

**AC-5: Concurrency limits respected (NFR-WR3)**
**Given** the existing `SandboxService` semaphore (`OPENSANDBOX_MAX_CONCURRENT`) is in place
**When** `ClaudeCodeProvider.execute()` runs
**Then** it calls `sandboxService.runAgentCommand()` exactly as before — no new semaphore, no new timeout layer

**AC-6: Build clean**
**Given** all changes applied
**When** `pnpm build` runs
**Then** zero TypeScript compilation errors exist

## Tasks / Subtasks

- [ ] Task 1: Extend `AgentCommandOptions` with `onStdoutLine` callback (AC: 2, 6)
  - [ ] 1.1 Open `src/sandbox/interfaces/agent-command-options.interface.ts`
  - [ ] 1.2 Add this field after `ticketId?`:
    ```typescript
    /**
     * Optional per-line stdout callback for structured output parsing.
     * Called synchronously for each complete newline-terminated line.
     * Errors thrown inside this callback are swallowed — never crash the execution.
     */
    onStdoutLine?: (line: string) => void;
    ```

- [ ] Task 2: Update `SandboxService` to call `onStdoutLine` per complete line (AC: 2, 6)
  - [ ] 2.1 Open `src/sandbox/sandbox.service.ts`
  - [ ] 2.2 In `runAgentCommand()`, add a line buffer BEFORE `sandbox.commands.run(...)`:
    ```typescript
    let lineBuffer = '';
    ```
  - [ ] 2.3 In the `onStdout` callback, append line buffering AFTER the existing `emitLog` call:
    ```typescript
    onStdout: (msg: OutputMessage) => {
      stdoutBuffer += msg.text;
      this.executionGateway?.emitLog(          // ← existing, do NOT change
        options.executionId,
        options.ticketId ?? '',
        msg.text,
        'stdout',
      );
      // NEW: per-line callback (only if caller needs structured parsing)
      if (options.onStdoutLine) {
        lineBuffer += msg.text;
        const parts = lineBuffer.split('\n');
        lineBuffer = parts.pop() ?? ''; // keep incomplete trailing chunk
        for (const line of parts) {
          if (line.trim()) {
            try {
              options.onStdoutLine(line);
            } catch {
              // Never crash execution from callback errors
            }
          }
        }
      }
    },
    ```
  - [ ] 2.4 Confirm `onStderr` callback is NOT changed
  - [ ] 2.5 Confirm no other logic in `runAgentCommand()` changes

- [ ] Task 3: Rewrite `ClaudeCodeProvider.execute()` for full agentic workflow (AC: 1–5)
  - [ ] 3.1 Add `ExecutionTrackerService` to constructor imports and injections:
    ```typescript
    import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
    ```
    ```typescript
    constructor(
      private readonly config: ConfigService,
      private readonly sandboxService: SandboxService,
      private readonly resourceProfileService: SandboxResourceProfileService,
      private readonly executionTracker: ExecutionTrackerService,  // ← ADD
    ) {}
    ```
  - [ ] 3.2 Add a `Logger` (the existing providers use it — follow the pattern):
    ```typescript
    private readonly logger = new Logger(ClaudeCodeProvider.name);
    ```
  - [ ] 3.3 Add the local `SandboxResultLine` interface at the top of the file (private — no export needed):
    ```typescript
    interface SandboxResultLine {
      type: 'result';
      prUrl: string | null;
      commitSha: string;
      branchName: string;
      qaStatus: 'passed' | 'self_healed' | 'failed';
      qaRetryCount: number;
    }
    ```
  - [ ] 3.4 Replace `execute()` body with the full agentic implementation (see Dev Notes for exact code)
  - [ ] 3.5 Verify: `CLAUDE_PROMPT` env var is REMOVED (no longer needed — SKILL.md is the prompt)
  - [ ] 3.6 Verify: `npm install -g @anthropic-ai/claude-code` prefix is REMOVED from command

- [ ] Task 4: Update `ClaudeCodeProvider` spec (AC: 1–6)
  - [ ] 4.1 Open `src/ai-routing/providers/claude-code.provider.spec.ts`
  - [ ] 4.2 Add `ExecutionTrackerService` import and declare a shared mock at the top of the `describe` block:
    ```typescript
    import { ExecutionTrackerService } from '@/execution/execution-tracker.service';
    // ...
    let mockExecutionTracker: { emitProgress: jest.Mock };
    // In beforeEach:
    mockExecutionTracker = { emitProgress: jest.fn().mockResolvedValue(undefined) };
    ```
  - [ ] 4.3 Add `{ provide: ExecutionTrackerService, useValue: mockExecutionTracker }` to the `TestingModule.providers` array in **all three** `createTestingModule` calls in the file (main `beforeEach`, `isEnabled: false` test, and `ANTHROPIC_BASE_URL omitted` test) — missing it from any one causes a NestJS DI error
  - [ ] 4.4 Add `'github.token': 'ghp_test-token'` to the `config` map in **all** `mockConfigService` objects — the new `execute()` calls `config.get('github.token', '')` and tests should assert a non-empty value
  - [ ] 4.5 **Fix the main `execute` success test** — the current mock returns `stdout: 'Successfully fixed bug'` (no JSON), causing `success: false`. Replace the `mockSandboxService.runAgentCommand` mock in the success test with one that invokes `onStdoutLine` with a valid result line:
    ```typescript
    mockSandboxService.runAgentCommand.mockImplementation(async (opts) => {
      const resultLine = JSON.stringify({
        type: 'result',
        prUrl: 'https://github.com/org/repo/pull/42',
        commitSha: 'deadbeef',
        branchName: 'dsf/ticket-123/exec-456',
        qaStatus: 'passed',
        qaRetryCount: 0,
      });
      opts.onStdoutLine?.(resultLine);
      return {
        exitCode: 0,
        stdout: resultLine + '\n',
        stderr: '',
        durationMs: 1500,
        timedOut: false,
        sandboxId: 'sbx-123',
      };
    });
    ```
  - [ ] 4.6 **Fix the existing env var assertions** in the main success test:
    - Remove: `expect(callArgs.env['CLAUDE_PROMPT']).toBe('Fix the bug in main.ts')`
    - Add: `expect(callArgs.env['TASK_DESCRIPTION']).toBe('Fix the bug in main.ts')`
    - Add: `expect(callArgs.env['REPO_URL']).toBe('https://github.com/test/repo')`
    - Add: `expect(callArgs.env['GITHUB_TOKEN']).toBe('ghp_test-token')`
    - Add: `expect(callArgs.env['QA_MAX_RETRIES']).toBe('3')`
    - Verify: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `IS_SANDBOX` assertions remain unchanged
  - [ ] 4.7 **Fix the existing command assertion** in the `execute` success test:
    - Remove the old command string `'npm install -g @anthropic-ai/claude-code...'`
    - Replace with: `expect(callArgs.command).toBe('claude --dangerously-skip-permissions -p "/dsf-execution"')`
  - [ ] 4.8 **Fix the `codeDiff` assertion** in the success test:
    - Remove: `expect(result.codeDiff).toBe('Successfully fixed bug')`
    - Add: `expect(result.codeDiff).toBeNull()`
    - Add: `expect(result.qaStatus).toBe('passed')`
    - Add: `expect(result.prUrl).toBe('https://github.com/org/repo/pull/42')`
  - [ ] 4.9 **Fix the `'should pass prompt via CLAUDE_PROMPT'` test** — rename and rewrite it:
    - Old: tests that `CLAUDE_PROMPT` env var is set with special chars
    - New: tests that `TASK_DESCRIPTION` is set with the prompt (special chars are safe — passed via env, not shell interpolation)
  - [ ] 4.10 Add test: progress line calls `emitProgress` (see example in Dev Notes)
  - [ ] 4.11 Add test: non-JSON stdout line is silently skipped — `emitProgress` not called, no throw
  - [ ] 4.12 Add test: `qaStatus: 'failed'` result line → `success: false`, `branchName` populated, `error.code === AIErrorCode.PROCESS_CRASH`

- [ ] Task 5: Set `OPENSANDBOX_AGENT_IMAGE` in `.env` (AC: 1)
  - [ ] 5.1 Update `.env` (and `.env.example` if the value changed): `OPENSANDBOX_AGENT_IMAGE=dsf-agents:latest`
  - [ ] 5.2 Verify `GITHUB_TOKEN` is set in `.env` — it is validated as required at startup (`env.validation.ts:92`) and the SKILL.md uses it for `git push` and `gh pr create`. Without it the server won't start, but confirm the token has `repo` scope (push + PR creation require it).
  - [ ] 5.3 Build `dsf-agents:latest` from repo root (requires WR-2.2 files to be merged first):
    ```bash
    docker build -f docker/Dockerfile.base -t dsf-agents-base:latest .
    docker build -f docker/Dockerfile.agents -t dsf-agents:latest .
    ```
  - [ ] 5.4 Push to container registry used by OpenSandbox (deployment concern — coordinate with ops)

- [ ] Task 6: Add `SandboxService` line-buffering test and verify no regressions (AC: 2, 6)
  - [ ] 6.1 Open `src/sandbox/sandbox.service.spec.ts` and add one test for `onStdoutLine` line-buffering — the key behaviour to verify is that a stdout chunk containing multiple lines fires `onStdoutLine` once per line, not once per chunk:

    ```typescript
    it('should call onStdoutLine once per complete line even when chunk contains multiple lines', async () => {
      const onStdoutLine = jest.fn();
      // Simulate chunk with two complete lines + one incomplete
      const chunk1 = '{"type":"progress","pct":10}\n{"type":"progr';
      const chunk2 = 'ess","pct":20}\n';

      // Mock sandbox.commands.run to fire onStdout callbacks then resolve
      mockSandbox.commands.run.mockImplementation(async (_cmd, _opts, callbacks) => {
        callbacks.onStdout({ text: chunk1 });
        callbacks.onStdout({ text: chunk2 });
        return { error: null };
      });

      await service.runAgentCommand({ ...baseOptions, onStdoutLine });

      expect(onStdoutLine).toHaveBeenCalledTimes(2);
      expect(onStdoutLine).toHaveBeenNthCalledWith(1, '{"type":"progress","pct":10}');
      expect(onStdoutLine).toHaveBeenNthCalledWith(2, '{"type":"progress","pct":20}');
    });
    ```

    > Note: adapt mock setup to match the existing spec's sandbox mock pattern (`mockSandbox`, `baseOptions`, etc.)

  - [ ] 6.2 `pnpm build` → zero errors
  - [ ] 6.3 `pnpm test -- --testPathPattern="claude-code.provider|sandbox.service"` → all pass

## Dev Notes

### Files Changed in This Story

| File                                                        | Change                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| `src/sandbox/interfaces/agent-command-options.interface.ts` | Add `onStdoutLine?: (line: string) => void`                    |
| `src/sandbox/sandbox.service.ts`                            | Add line buffer + call `onStdoutLine` per complete stdout line |
| `src/ai-routing/providers/claude-code.provider.ts`          | Full rewrite of `execute()`, add `ExecutionTrackerService` dep |
| `src/ai-routing/providers/claude-code.provider.spec.ts`     | Add mock for `ExecutionTrackerService`, add new test cases     |
| `.env` / `.env.example`                                     | Set `OPENSANDBOX_AGENT_IMAGE=dsf-agents:latest`                |

**No other files need to change.** `ExecutionTrackerService` is already exported from `ExecutionModule`, which is already imported in `ai-routing.module.ts` (line 42). No module wiring changes required.

### Full `execute()` Implementation

Replace the entire `execute()` method body in `claude-code.provider.ts` with:

```typescript
async execute(payload: IAIExecutionPayload): Promise<IAIExecutionResult> {
  const profile = this.resourceProfileService.getProfile(payload.complexityScore ?? 5);

  const apiKey = this.config.get<string>('anthropic.apiKey', '');
  const baseURL = this.config.get<string>('anthropic.baseURL', '');
  const model = this.config.get<string>('anthropic.model', 'claude-sonnet-4-20250514');
  const githubToken = this.config.get<string>('github.token', '');
  // QA_MAX_RETRIES is hardcoded at 3 — "configurable max retry limit in DB is post-MVP" (epics PRD)
  const QA_MAX_RETRIES = '3';

  // Generate a git-safe feature branch name from ticket + execution ID
  const sanitizedTicket = payload.ticketId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const featureBranch = `dsf/${sanitizedTicket}/${payload.executionId.slice(0, 8)}`;

  const env: Record<string, string> = {
    ANTHROPIC_API_KEY: apiKey,
    ANTHROPIC_MODEL: model,
    IS_SANDBOX: '1',
    // dsf-execution SKILL.md required env vars (FR-WR4)
    REPO_URL: payload.repositoryUrl,
    FEATURE_BRANCH: payload.targetBranch ?? featureBranch,
    TASK_DESCRIPTION: payload.prompt,
    GITHUB_TOKEN: githubToken,
    QA_MAX_RETRIES,
  };
  if (baseURL) {
    env['ANTHROPIC_BASE_URL'] = baseURL;
  }

  // Capture the final result line from the agent's structured stdout (FR-WR13)
  let sandboxResult: SandboxResultLine | null = null;

  const onStdoutLine = (line: string): void => {
    try {
      const parsed = JSON.parse(line) as { type?: string; pct?: number; msg?: string };
      if (parsed.type === 'progress' && typeof parsed.pct === 'number') {
        // Real-time progress emission (fire-and-forget — NFR-WR3: never blocks)
        void this.executionTracker.emitProgress(
          payload.executionId,
          payload.ticketId,
          payload.projectId,
          parsed.msg ?? '',
          parsed.pct,
        );
      } else if (parsed.type === 'result') {
        sandboxResult = parsed as SandboxResultLine;
      }
    } catch {
      // NFR-WR4: Non-JSON line — log at debug, never crash
      this.logger.debug(
        `[ClaudeCodeProvider] Non-JSON stdout line (skipped): ${line.substring(0, 120)}`,
      );
    }
  };

  const result = await this.sandboxService.runAgentCommand({
    executionId: payload.executionId,
    image: this.config.get<string>('opensandbox.agentImage', 'dsf-agents:latest'),
    // dsf-agents:latest has claude-code pre-installed; SKILL.md invoked via /dsf-execution
    command: 'claude --dangerously-skip-permissions -p "/dsf-execution"',
    env,
    timeoutSeconds: this.config.get<number>('opensandbox.sandboxTimeoutS', 3600),
    cpuLimit: profile.cpuLimit,
    memoryLimit: profile.memoryLimit,
    ticketId: payload.ticketId,
    onStdoutLine,  // ← structured parsing callback
    metadata: {
      providerName: ProviderName.CLAUDE_CODE,
      executionId: payload.executionId,
      ticketId: payload.ticketId,
    },
  });

  // Fallback: if no result line was captured by onStdoutLine, scan buffered stdout in reverse.
  // This handles the rare case where the agent's final stdout chunk had no trailing '\n',
  // so the line buffer never flushed it during streaming (parts.pop() held it as an incomplete chunk).
  if (!sandboxResult) {
    const lines = result.stdout.split('\n').reverse();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { type?: string };
        if (parsed.type === 'result') {
          sandboxResult = parsed as SandboxResultLine;
          break;
        }
      } catch {
        // skip
      }
    }
  }

  const exitedClean = result.exitCode === 0 && !result.timedOut;
  const qaFailed = sandboxResult?.qaStatus === 'failed';
  const success = exitedClean && sandboxResult !== null && !qaFailed;

  if (!success) {
    const errorMessage = result.timedOut
      ? 'Claude Code sandbox execution timed out'
      : sandboxResult === null
        ? 'Agent did not emit a final result line — execution may have crashed'
        : 'Agent completed with QA failures after all retries';

    return {
      success: false,
      codeDiff: null,
      filesChanged: [],
      confidenceScore: 0.0,
      durationMs: result.durationMs,
      workspacePath: '',
      prUrl: sandboxResult?.prUrl ?? undefined,
      commitSha: sandboxResult?.commitSha,
      branchName: sandboxResult?.branchName ?? (payload.targetBranch ?? featureBranch),
      qaStatus: sandboxResult?.qaStatus ?? 'skipped',
      qaRetryCount: sandboxResult?.qaRetryCount ?? 0,
      error: {
        code: result.timedOut ? AIErrorCode.TIMEOUT : AIErrorCode.PROCESS_CRASH,
        message: errorMessage,
        isRetryable: result.timedOut,
        rawOutput: `${result.stdout}\n${result.stderr}`.trim(),
        exitCode: result.exitCode,
      },
    };
  }

  return {
    success: true,
    codeDiff: null,          // Agent handled diff internally — not available post-hoc
    filesChanged: [],         // Agent handled file changes internally
    confidenceScore: sandboxResult.qaStatus === 'passed' ? 0.95 : 0.80,
    durationMs: result.durationMs,
    workspacePath: '',
    prUrl: sandboxResult.prUrl ?? undefined,
    commitSha: sandboxResult.commitSha,
    branchName: sandboxResult.branchName,
    qaStatus: sandboxResult.qaStatus,
    qaRetryCount: sandboxResult.qaRetryCount,
  };
}
```

### Why `codeDiff: null` in the Success Case

The old provider returned `codeDiff: result.stdout` (the raw Claude output). In the agentic workflow, stdout contains JSON progress markers and text mixed together — it's NOT a code diff. The actual diff exists on the GitHub branch/PR. Returning `null` is correct. Downstream consumers of `codeDiff` should handle `null` gracefully (they already receive `null` for other error cases).

### `FEATURE_BRANCH` Generation Logic

The generated branch follows the pattern `dsf/{sanitized-ticket-id}/{execution-id-prefix-8}`.
Example: ticket `CU-abc123`, execution `exec-9f2a4b6c...` → `dsf/cu-abc123/9f2a4b6c`

If `payload.targetBranch` is set, it takes precedence (allows the consumer to pre-set a deterministic branch name).

### Why `ExecutionTrackerService` Is Already Available

`ai-routing.module.ts` line 42 imports `ExecutionModule`. `ExecutionModule` exports `ExecutionTrackerService` (see `src/execution/execution.module.ts` line 285). NestJS DI resolves this automatically — no `forwardRef` needed, no module change required.

### `onStdoutLine` Design: Sync Callback + Fire-and-Forget Async

The `onStdout` callback in `SandboxService` is synchronous (OpenSandbox SDK does not await it). We keep `onStdoutLine` sync (`(line: string) => void`) and use `void this.executionTracker.emitProgress(...)` inside it. This is correct behavior for a real-time progress indicator:

- Progress updates are best-effort; a delayed or failed emit does not break the execution
- The result line capture (`sandboxResult = parsed`) is synchronous and safe — no async needed

**NEVER** make `onStdoutLine` async or try to await it inside `SandboxService` — the SDK callback is not awaited.

### `emitProgress` Signature (5 Args)

The actual signature is:

```typescript
ExecutionTrackerService.emitProgress(
  executionId: string,
  ticketId: string,
  projectId: string | null,  // null → tracker resolves from DB
  step: string,
  percent: number,
): Promise<void>
```

**Pass `payload.projectId`** (not `null`) — it's available in `IAIExecutionPayload` and avoids a DB lookup.

### `SandboxService` Change Is Backward-Compatible

`onStdoutLine` is optional in `AgentCommandOptions`. Every existing call site that does NOT pass it is unaffected — the `if (options.onStdoutLine)` guard ensures zero overhead for callers that don't use it. The existing `SandboxService` spec continues to pass without modification.

### Image Tag Strategy

`dsf-agents:latest` is the local dev tag. In CI/CD:

- Build both images from repo root (base first, then agents)
- Push with a version tag (e.g., `dsf-agents:v1.0.0`)
- Set `OPENSANDBOX_AGENT_IMAGE=registry.example.com/dsf-agents:v1.0.0` in production

For local dev: build `dsf-agents:latest` locally. Coordinate with the person who completed WR-2.2.

### Contract with WR-3.1 (Progress Bar)

WR-2.3 calls `emitProgress` — this is what WR-3.1 wires to the frontend progress bar. The `pct` values emitted by the SKILL.md (10/20/40/75/80/82/90/95/100) come through this mechanism. **Do not change pct values** — they match the WR-3.1 story contract.

### Contract with WR-4 (QA Failure State Machine)

When `qaStatus: 'failed'` is returned:

- This story returns `success: false` with the branch info
- The **consumer** (`ai-execution.consumer.ts`) is responsible for setting execution state to `QA_FAILED` (that's WR-4's scope)
- This story does NOT touch `ai-execution.consumer.ts`

### `qaStatus: 'skipped'` for Non-Sandbox Fallback

If the sandbox exits with no result line (crash case), `qaStatus` defaults to `'skipped'`. This is consistent with WR-2.1's backward-compat contract where non-sandbox providers return `qaStatus: undefined` (consumers default to `'skipped'`).

### Redaction Unchanged

`SandboxService.redactEnvForLogging()` already matches `GITHUB_TOKEN` and `ANTHROPIC_API_KEY` via the `KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH` regex. All sensitive vars in the new env set are already covered. **Do not change the regex.**

### Test Mock Setup for `ExecutionTrackerService`

```typescript
const mockExecutionTracker = {
  emitProgress: jest.fn().mockResolvedValue(undefined),
};

// In TestingModule.providers:
{ provide: ExecutionTrackerService, useValue: mockExecutionTracker },
```

### Example Test: Progress Line Parsing

```typescript
it('should call emitProgress for type:progress stdout lines', async () => {
  const progressLine = JSON.stringify({ type: 'progress', pct: 20, msg: 'Cloning repository' });
  const resultLine = JSON.stringify({
    type: 'result',
    prUrl: 'https://github.com/org/repo/pull/1',
    commitSha: 'abc123',
    branchName: 'dsf/ticket-1/exec0001',
    qaStatus: 'passed',
    qaRetryCount: 0,
  });

  mockSandboxService.runAgentCommand.mockImplementation(async (opts) => {
    opts.onStdoutLine?.(progressLine);
    opts.onStdoutLine?.('not json at all'); // should be silently skipped
    opts.onStdoutLine?.(resultLine);
    return {
      exitCode: 0,
      stdout: `${progressLine}\nnot json at all\n${resultLine}\n`,
      stderr: '',
      durationMs: 1000,
      timedOut: false,
      sandboxId: 'sb-1',
    };
  });

  const result = await provider.execute(mockPayload);

  expect(mockExecutionTracker.emitProgress).toHaveBeenCalledWith(
    mockPayload.executionId,
    mockPayload.ticketId,
    mockPayload.projectId,
    'Cloning repository',
    20,
  );
  expect(result.success).toBe(true);
  expect(result.qaStatus).toBe('passed');
  expect(result.prUrl).toBe('https://github.com/org/repo/pull/1');
});
```

### Project Structure Notes

- `src/sandbox/interfaces/` — sandbox interface files; `agent-command-options.interface.ts` follows existing pattern
- `src/ai-routing/providers/claude-code.provider.ts` — add `Logger` and `ExecutionTrackerService`; do NOT extend `BaseAIProvider` (different progress model — BaseAIProvider uses `ExecutionStage` enum, not raw pct values)
- `@/` path alias maps to `./src/` — all new imports must use it

### References

- [Source: epics-workspace-removal.md#Story-WR-2.3] — FR-WR4, FR-WR8, FR-WR13, NFR-WR3, NFR-WR4 specs
- [Source: wr-2-1-establish-shared-provider-contract-execution-state.md] — `IAIExecutionResult` new fields: `prUrl`, `commitSha`, `branchName`, `qaStatus`, `qaRetryCount`
- [Source: wr-2-2-author-bundle-dsf-execution-agent-skill.md] — SKILL.md stdout contract, progress marker format, result line format, `dsf-agents:latest` image details
- [Source: src/ai-routing/providers/claude-code.provider.ts] — current provider (full rewrite of `execute()`)
- [Source: src/sandbox/sandbox.service.ts#L198-L222] — `onStdout` callback location; add `onStdoutLine` call after `emitLog`
- [Source: src/sandbox/interfaces/agent-command-options.interface.ts] — add `onStdoutLine` field
- [Source: src/execution/interfaces/queue.interface.ts#L28-L61] — `IAIExecutionPayload` fields (`repositoryUrl`, `projectId`, `targetBranch`, `executionId`, `ticketId`, `prompt`)
- [Source: src/execution/execution-tracker.service.ts#L1178] — `emitProgress(executionId, ticketId, projectId, step, percent)` 5-arg signature
- [Source: src/execution/execution.module.ts#L285] — `ExecutionTrackerService` exported from `ExecutionModule`
- [Source: src/ai-routing/ai-routing.module.ts#L42] — `ExecutionModule` already imported → no module changes needed
- [Source: src/config/configuration.ts#L59] — `github.token` config key for `GITHUB_TOKEN`
- [Source: src/config/env.validation.ts#L92] — `GITHUB_TOKEN` validated as required at startup (safe to use — always present)
- [Source: src/ai-routing/providers/container-output-parser.ts] — NOT replaced; runs concurrently in `SandboxService.emitLog()` pipeline; completely unrelated to structured JSON parsing

---

### Review Findings

- [x] [Review][Patch] P1: Wrong FEATURE_BRANCH fallback pattern — uses `dsf/fix-${ticketId}-${Date.now()}` but spec requires `dsf/{sanitized-ticket-id}/{execution-id-prefix-8}` [claude-code.provider.ts]
- [x] [Review][Patch] P2: Progress lines parsed via colon-delimited `pct:` format instead of JSON `{"type":"progress","pct":N,"msg":"..."}` — explicit AC-2 violation per spec dev notes [claude-code.provider.ts]
- [x] [Review][Patch] P3: Result lines parsed via `result:` prefix instead of JSON `{"type":"result",...}` — explicit AC-3 violation per spec dev notes [claude-code.provider.ts]
- [x] [Review][Patch] P4: `qaStatus` comparisons use uppercase `'PASSED'`/`'FAILED'` but SKILL.md emits lowercase `'passed'`/`'failed'` — makes `success` always `false` and QA failure detection never trigger [claude-code.provider.ts]
- [x] [Review][Patch] P5: `lineBuffer` in SandboxService never flushed at stream end — if result line has no trailing `\n`, `onStdoutLine` is never called for it, `agentResult` stays `{}`, `success` always `false` [sandbox.service.ts]
- [x] [Review][Patch] P6: `confidenceScore` uses process-level `success` (exitCode check only) but returned `result.success` uses stricter agentic check — returns `{success: false, confidenceScore: 0.9}` on QA failure [claude-code.provider.ts]
- [x] [Review][Patch] P7: Removed `isEnabled=false` and `ANTHROPIC_BASE_URL omission` test cases — both code paths still exist but are now untested [claude-code.provider.spec.ts]
- [x] [Review][Patch] P8: `qaStatus: agentResult.qaStatus as any` — should use a proper union type `'passed' | 'self_healed' | 'failed'` [claude-code.provider.ts]
- [x] [Review][Patch] P9: Missing result line (no JSON result emitted) returns generic error message — should explicitly state "Agent did not emit a final result line" [claude-code.provider.ts]
- [x] [Review][Patch] P10: Test T33 title typo: "should swallowed errors" → "should swallow errors" [claude-code.provider.spec.ts]
- [x] [Review][Defer] D1: `agentResult = { ...agentResult, ...parsed }` no schema whitelist — arbitrary fields from agent stdout merged in [claude-code.provider.ts] — deferred, pre-existing pattern; low risk in controlled sandbox context; post-MVP hardening
- [x] [Review][Defer] D2: Truncated JSON result line (multi-chunk) silently dropped — complex to fix without SDK-level stream guarantees [sandbox.service.ts] — deferred, edge case requires SDK contract change
- [x] [Review][Defer] D3: `TASK_DESCRIPTION: prompt` no max-length guard — oversized prompts could exceed Linux ARG_MAX in container env [claude-code.provider.ts] — deferred, pre-existing concern, not in scope for WR-2.3
- [x] [Review][Defer] D4: `agentResult` spread mutation theoretical race if SDK batches callbacks via microtasks [claude-code.provider.ts] — deferred, JS single-threaded guarantees make this safe in practice
- [x] [Review][Defer] D5: `emitProgress .catch()` logs message only, loses stack trace [claude-code.provider.ts] — deferred, logging quality improvement
- [x] [Review][Defer] D6: QA failure + simultaneous timeout → `error.code` would be TIMEOUT instead of PROCESS_CRASH — highly unlikely concurrent condition [claude-code.provider.ts] — deferred, edge case

---

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 — story created 2026-04-01

### Debug Log References

### Completion Notes List

### File List
