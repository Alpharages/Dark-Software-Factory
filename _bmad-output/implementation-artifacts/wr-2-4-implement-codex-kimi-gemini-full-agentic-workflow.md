# Story WR-2.4: Implement Codex, Kimi & Gemini Full Agentic Workflow

Status: ready-for-dev

## Story

As a **platform engineer**,
I want Codex, Kimi, and Gemini providers to inject the full delivery workflow as a structured system prompt and parse the same structured stdout output as `ClaudeCodeProvider`,
So that all 4 providers reach execution parity and any provider can complete the full clone→implement→QA→commit→push→PR lifecycle.

## Acceptance Criteria

**AC-1: Workflow injected as structured system prompt (FR-WR5)**
**Given** each of Codex, Kimi, and Gemini has an `execute()` method
**When** it is updated
**Then** each provider constructs a `workflowPrompt` string that specifies the same 8-step workflow as the `dsf-execution` SKILL.md:

1. Clone `$REPO_URL` → create feature branch `$FEATURE_BRANCH`
2. Implement the task described in `$TASK_DESCRIPTION`
3. Run QA (lint + tests); on failure, self-heal and retry up to `$QA_MAX_RETRIES` times
4. Commit with message referencing the task
5. Push branch via `git push origin $FEATURE_BRANCH`
6. Open a PR via `gh pr create`; if QA exhausted, skip PR, push branch only
7. Emit JSON progress markers at each milestone to stdout
8. Emit a final `{"type":"result",...}` JSON line as the last stdout line
   **And** the prompt embeds `REPO_URL`, `FEATURE_BRANCH`, `TASK_DESCRIPTION`, `GITHUB_TOKEN`, and `QA_MAX_RETRIES` as env var references used by the agent

**AC-2: Stdout parsed identically to ClaudeCodeProvider (NFR-WR4)**
**Given** each provider is running in the sandbox and emitting stdout
**When** stdout lines are received via `onStdoutLine`
**Then** progress marker parsing (`type:"progress"`) calls `ExecutionTrackerService.emitProgress()` (fire-and-forget)
**And** result line parsing (`type:"result"`) captures `prUrl`, `commitSha`, `branchName`, `qaStatus`, `qaRetryCount`
**And** non-JSON lines are logged at debug level and silently skipped — execution NEVER crashes (NFR-WR4)
**And** `sandboxService.runAgentCommand()` is called with the `onStdoutLine` callback

**AC-3: IAIExecutionResult populated with agentic fields (FR-WR13)**
**Given** each provider completes successfully
**When** the final result line is parsed
**Then** `prUrl`, `commitSha`, `branchName`, `qaStatus`, and `qaRetryCount` are populated in `IAIExecutionResult` — identical contract to WR-2.3's ClaudeCodeProvider

**AC-4: Hard QA failure returns correct result shape**
**Given** the agent exhausted all QA retries
**When** result line contains `{ "type": "result", "qaStatus": "failed", "prUrl": null }`
**Then** provider returns `success: false`, `qaStatus: 'failed'`, `branchName` populated
**And** execution never throws — returns a result with `success: false`

**AC-5: Env vars correct per provider**
**Given** each provider's `execute()` runs
**Then** sandbox env contains:

- Provider API key under the provider-specific key (`OPENAI_API_KEY` for Codex, `KIMI_API_KEY` for Kimi, `GEMINI_API_KEY` for Gemini)
- `REPO_URL`, `FEATURE_BRANCH`, `TASK_DESCRIPTION`, `GITHUB_TOKEN`, `QA_MAX_RETRIES=3`
- Provider model var (`CODEX_MODEL` / `KIMI_MODEL` / `GEMINI_MODEL`)
- `IS_SANDBOX: '1'` (add to Codex and Kimi — Gemini already has it)
- Optional `baseURL` var (conditionally) — unchanged logic

**AC-6: Build clean**
**Given** all changes applied
**When** `pnpm build` runs
**Then** zero TypeScript compilation errors

## Tasks / Subtasks

- [ ] Task 0: Verify WR-2.3 is complete (BLOCKING PREREQUISITE)
  - [ ] 0.1 Confirm `onStdoutLine?: (line: string) => void` exists in `src/sandbox/interfaces/agent-command-options.interface.ts` — if absent, WR-2.3 must be implemented first before continuing
  - [ ] 0.2 Confirm `SandboxService.runAgentCommand()` in `src/sandbox/sandbox.service.ts` calls `onStdoutLine` per complete stdout line — if absent, same blocker

- [ ] Task 1: Update `CodexProvider.execute()` for full agentic workflow (AC: 1–6)
  - [ ] 1.1 Add `ExecutionTrackerService` import and inject into constructor
  - [ ] 1.2 Add `private readonly logger = new Logger(CodexProvider.name)`
  - [ ] 1.3 Add the private `SandboxResultLine` interface (same shape as WR-2.3 — no export needed)
  - [ ] 1.4 Replace `execute()` body with full agentic implementation (see Dev Notes for exact code)
  - [ ] 1.5 Remove `CODEX_PROMPT` from env — replace with `TASK_DESCRIPTION`
  - [ ] 1.6 Add `REPO_URL`, `FEATURE_BRANCH`, `GITHUB_TOKEN`, `QA_MAX_RETRIES`, `IS_SANDBOX: '1'` to env
  - [ ] 1.7 Verify `DSF_AGENTIC_PROMPT` env var is built from workflow constant + task description

- [ ] Task 2: Update `KimiProvider.execute()` for full agentic workflow (AC: 1–6)
  - [ ] 2.1 Add `ExecutionTrackerService` import and inject into constructor
  - [ ] 2.2 Add `private readonly logger = new Logger(KimiProvider.name)`
  - [ ] 2.3 Add the private `SandboxResultLine` interface
  - [ ] 2.4 Replace `execute()` body with full agentic implementation (see Dev Notes)
  - [ ] 2.5 Remove `KIMI_PROMPT` from env — replace with `TASK_DESCRIPTION`
  - [ ] 2.6 Add `REPO_URL`, `FEATURE_BRANCH`, `GITHUB_TOKEN`, `QA_MAX_RETRIES`, `IS_SANDBOX: '1'` to env
  - [ ] 2.7 Verify `DSF_AGENTIC_PROMPT` env var is built from workflow constant + task description

- [ ] Task 3: Update `GeminiProvider.execute()` for full agentic workflow (AC: 1–6)
  - [ ] 3.1 Add `ExecutionTrackerService` import and inject into constructor
  - [ ] 3.2 Add `private readonly logger = new Logger(GeminiProvider.name)`
  - [ ] 3.3 Add the private `SandboxResultLine` interface
  - [ ] 3.4 Replace `execute()` body with full agentic implementation (see Dev Notes)
  - [ ] 3.5 Remove `GEMINI_PROMPT` from env — replace with `TASK_DESCRIPTION`
  - [ ] 3.6 Add `REPO_URL`, `FEATURE_BRANCH`, `GITHUB_TOKEN`, `QA_MAX_RETRIES` to env (`IS_SANDBOX: '1'` already present)
  - [ ] 3.7 Verify `DSF_AGENTIC_PROMPT` env var is built from workflow constant + task description

- [ ] Task 4: Update `CodexProvider` spec (AC: 1–6)
  - [ ] 4.1 Add `ExecutionTrackerService` import and mock: `{ emitProgress: jest.fn().mockResolvedValue(undefined) }`
  - [ ] 4.2 Add `{ provide: ExecutionTrackerService, useValue: mockExecutionTracker }` to **all** `createTestingModule` calls (main `beforeEach`, `isEnabled: false` test, `baseURL omitted` test) — missing from any one causes NestJS DI error
  - [ ] 4.3 Add `'github.token': 'ghp_test-token'` to the `config` map in **all** `mockConfigService` objects
  - [ ] 4.4 **Fix the main `execute` success test** — replace `runAgentCommand` mock to invoke `onStdoutLine` with valid result JSON (see Dev Notes example pattern)
  - [ ] 4.5 **Fix env var assertions**: remove `CODEX_PROMPT`, add `TASK_DESCRIPTION`, `REPO_URL`, `GITHUB_TOKEN`, `QA_MAX_RETRIES`, `IS_SANDBOX`
  - [ ] 4.6 **Fix command assertion**: remove `'codex "$CODEX_PROMPT"'`, replace with correct agentic command
  - [ ] 4.7 **Fix `codeDiff` assertion**: `expect(result.codeDiff).toBeNull()`, add `qaStatus`, `prUrl` assertions
  - [ ] 4.8 Add test: progress line calls `emitProgress` (see Dev Notes)
  - [ ] 4.9 Add test: non-JSON stdout line is silently skipped
  - [ ] 4.10 Add test: `qaStatus: 'failed'` result → `success: false`, `branchName` populated

- [ ] Task 5: Update `KimiProvider` spec (AC: 1–6)
  - [ ] 5.1 Add `ExecutionTrackerService` import and declare `mockExecutionTracker = { emitProgress: jest.fn().mockResolvedValue(undefined) }`
  - [ ] 5.2 Add `{ provide: ExecutionTrackerService, useValue: mockExecutionTracker }` to **all** `createTestingModule` calls (main `beforeEach`, `isEnabled: false` test, `baseURL omitted` test)
  - [ ] 5.3 Add `'github.token': 'ghp_test-token'` to the config map in **all** `mockConfigService` objects
  - [ ] 5.4 Replace `runAgentCommand` mock in `beforeEach` to invoke `opts.onStdoutLine?.(resultLine)` (same pattern as Task 4.4)
  - [ ] 5.5 Fix env var assertions: remove `KIMI_PROMPT`, add `TASK_DESCRIPTION`, `REPO_URL`, `GITHUB_TOKEN`, `QA_MAX_RETRIES`, `IS_SANDBOX: '1'` — keep `KIMI_API_KEY`, `KIMI_MODEL`, `KIMI_BASE_URL`
  - [ ] 5.6 Fix command assertion: was `'kimi "$KIMI_PROMPT"'` → now `'kimi "$DSF_AGENTIC_PROMPT"'`
  - [ ] 5.7 Fix `codeDiff` assertion: `toBeNull()`, add `qaStatus: 'passed'`, `prUrl` assertions
  - [ ] 5.8 Add test: progress line calls `emitProgress` with kimi-specific mock payload (`aiProvider: AIProvider.KIMI`)
  - [ ] 5.9 Add test: non-JSON stdout line is silently skipped
  - [ ] 5.10 Add test: `qaStatus: 'failed'` → `success: false`, `branchName` populated

- [ ] Task 6: Update `GeminiProvider` spec (AC: 1–6)
  - [ ] 6.1 Add `ExecutionTrackerService` import and declare `mockExecutionTracker = { emitProgress: jest.fn().mockResolvedValue(undefined) }`
  - [ ] 6.2 Add `{ provide: ExecutionTrackerService, useValue: mockExecutionTracker }` to **all** `createTestingModule` calls (main `beforeEach`, `isEnabled: false` test, `baseURL omitted` test)
  - [ ] 6.3 Add `'github.token': 'ghp_test-token'` to the config map in **all** `mockConfigService` objects
  - [ ] 6.4 Replace `runAgentCommand` mock in `beforeEach` to invoke `opts.onStdoutLine?.(resultLine)` (same pattern as Task 4.4)
  - [ ] 6.5 Fix env var assertions: remove `GEMINI_PROMPT`, add `TASK_DESCRIPTION`, `REPO_URL`, `GITHUB_TOKEN`, `QA_MAX_RETRIES` — keep `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_BASE_URL`, `IS_SANDBOX: '1'` (already present)
  - [ ] 6.6 Fix command assertion: was `'gemini "$GEMINI_PROMPT"'` → now `'gemini "$DSF_AGENTIC_PROMPT"'`
  - [ ] 6.7 Fix `codeDiff` assertion: `toBeNull()`, add `qaStatus: 'passed'`, `prUrl` assertions
  - [ ] 6.8 Add test: progress line calls `emitProgress` with gemini-specific mock payload (`aiProvider: AIProvider.GEMINI`)
  - [ ] 6.9 Add test: non-JSON stdout line is silently skipped
  - [ ] 6.10 Add test: `qaStatus: 'failed'` → `success: false`, `branchName` populated

- [ ] Task 7: Validate build and tests
  - [ ] 7.1 `pnpm build` → zero TypeScript errors
  - [ ] 7.2 `pnpm test -- --testPathPattern="codex.provider|kimi.provider|gemini.provider"` → all pass

## Dev Notes

### Files Changed in This Story

| File                                               | Change                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/ai-routing/providers/codex.provider.ts`       | Full rewrite of `execute()`, add `ExecutionTrackerService` dep, `Logger`, workflow prompt |
| `src/ai-routing/providers/kimi.provider.ts`        | Full rewrite of `execute()`, add `ExecutionTrackerService` dep, `Logger`, workflow prompt |
| `src/ai-routing/providers/gemini.provider.ts`      | Full rewrite of `execute()`, add `ExecutionTrackerService` dep, `Logger`, workflow prompt |
| `src/ai-routing/providers/codex.provider.spec.ts`  | Add `ExecutionTrackerService` mock, rewrite success test, add new test cases              |
| `src/ai-routing/providers/kimi.provider.spec.ts`   | Same as codex spec updates                                                                |
| `src/ai-routing/providers/gemini.provider.spec.ts` | Same as codex spec updates                                                                |

**No module changes needed.** `ai-routing.module.ts` already imports `ExecutionModule` with `forwardRef(() => ExecutionModule)` at line 60 — this is already wired. Just add `ExecutionTrackerService` to the constructor. No new `forwardRef` or module import required.

**No `SandboxService` changes needed — AFTER WR-2.3 is merged.** WR-2.3 adds `onStdoutLine` to `AgentCommandOptions` and the line-buffer logic to `SandboxService`. These providers just pass the callback. Verify Task 0 before starting implementation.

### Shared Interfaces (define locally in each file — no cross-file sharing)

```typescript
// Private to each provider file — NOT exported
interface SandboxResultLine {
  type: 'result';
  prUrl: string | null;
  commitSha: string;
  branchName: string;
  qaStatus: 'passed' | 'self_healed' | 'failed';
  qaRetryCount: number;
}
```

### Workflow Prompt Constant

Each provider defines a private static workflow constant. The agent reads env vars directly from its sandbox environment.

```typescript
// Add as a module-level const (not class member) — identical in all 3 providers
const DSF_AGENTIC_WORKFLOW = `You are a software delivery agent. Complete the following 8-step workflow using the environment variables available to you:

ENVIRONMENT VARIABLES:
- REPO_URL: Git repository to clone
- FEATURE_BRANCH: Branch name to create and push
- TASK_DESCRIPTION: The specific task to implement
- GITHUB_TOKEN: GitHub auth token for push and PR creation
- QA_MAX_RETRIES: Maximum number of QA self-healing retries (default: 3)

WORKFLOW STEPS:
1. CLONE: git clone $REPO_URL into a temp directory; git checkout -b $FEATURE_BRANCH
2. IMPLEMENT: Read the codebase, understand context, implement changes for: $TASK_DESCRIPTION
3. QA LOOP: Run linting and tests; if failures, analyze errors, fix code, and retry (up to $QA_MAX_RETRIES times). Each retry MUST edit relevant files based on the error output — dumb retries without edits are not allowed.
4. COMMIT: git add -A && git commit -m "feat: $TASK_DESCRIPTION"
5. PUSH: git push origin $FEATURE_BRANCH (use GITHUB_TOKEN for auth via HTTPS)
6. PR: If QA passed, run: gh pr create --title "$TASK_DESCRIPTION" --body "Automated implementation by DSF agent" --head $FEATURE_BRANCH. If QA exhausted, skip PR creation.
7. PROGRESS MARKERS: Output JSON progress markers to stdout at each major milestone in this exact format:
   {"type":"progress","pct":10,"msg":"Cloning repository"}
   {"type":"progress","pct":30,"msg":"Implementing changes"}
   {"type":"progress","pct":60,"msg":"Running QA checks"}
   {"type":"progress","pct":80,"msg":"Committing and pushing"}
   {"type":"progress","pct":90,"msg":"Opening pull request"}
8. RESULT LINE: Output a single JSON result line as the LAST line of stdout (after all other output):
   {"type":"result","prUrl":"<pr_url or null>","commitSha":"<sha>","branchName":"<branch>","qaStatus":"passed|self_healed|failed","qaRetryCount":<number>}

CRITICAL RULES:
- Output ONLY valid JSON for progress and result lines — no extra text on those lines
- The result line MUST be the absolute last output
- If QA fails after all retries: set prUrl to null, qaStatus to "failed", still emit result line
- Never commit .env files or secrets
`;
```

### Full `execute()` Implementation (Codex — adapt for Kimi/Gemini)

```typescript
async execute(payload: IAIExecutionPayload): Promise<IAIExecutionResult> {
  const profile = this.resourceProfileService.getProfile(payload.complexityScore ?? 5);

  const apiKey = this.config.get<string>('codex.apiKey', '');
  const baseURL = this.config.get<string>('codex.baseURL', '');
  const model = this.config.get<string>('codex.model', 'codex-1');
  const githubToken = this.config.get<string>('github.token', '');
  const QA_MAX_RETRIES = '3';

  const sanitizedTicket = payload.ticketId
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const featureBranch = `dsf/${sanitizedTicket}/${payload.executionId.slice(0, 8)}`;

  // Embed workflow instructions + task description as a single prompt env var
  const agenticPrompt = `${DSF_AGENTIC_WORKFLOW}\n\nTASK: ${payload.prompt}`;

  const env: Record<string, string> = {
    OPENAI_API_KEY: apiKey,   // ← Codex CLI reads OPENAI_API_KEY
    CODEX_MODEL: model,
    IS_SANDBOX: '1',
    // Agentic workflow env vars (FR-WR4/WR5)
    REPO_URL: payload.repositoryUrl,
    FEATURE_BRANCH: payload.targetBranch ?? featureBranch,
    TASK_DESCRIPTION: payload.prompt,
    GITHUB_TOKEN: githubToken,
    QA_MAX_RETRIES,
    // Full agentic prompt for the CLI invocation
    DSF_AGENTIC_PROMPT: agenticPrompt,
  };
  if (baseURL) {
    env['OPENAI_BASE_URL'] = baseURL;
  }

  let sandboxResult: SandboxResultLine | null = null;

  const onStdoutLine = (line: string): void => {
    try {
      const parsed = JSON.parse(line) as { type?: string; pct?: number; msg?: string };
      if (parsed.type === 'progress' && typeof parsed.pct === 'number') {
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
      this.logger.debug(
        `[CodexProvider] Non-JSON stdout line (skipped): ${line.substring(0, 120)}`,
      );
    }
  };

  const result = await this.sandboxService.runAgentCommand({
    executionId: payload.executionId,
    image: this.config.get<string>('opensandbox.agentImage', 'opensandbox/code-interpreter:v1.0.2'),
    command: 'codex "$DSF_AGENTIC_PROMPT"',
    env,
    timeoutSeconds: this.config.get<number>('opensandbox.sandboxTimeoutS', 3600),
    cpuLimit: profile.cpuLimit,
    memoryLimit: profile.memoryLimit,
    ticketId: payload.ticketId,
    onStdoutLine,
    metadata: {
      providerName: ProviderName.CODEX,
      executionId: payload.executionId,
      ticketId: payload.ticketId,
    },
  });

  // Fallback: scan buffered stdout if onStdoutLine never captured a result line
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
      ? 'Codex sandbox execution timed out'
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
    codeDiff: null,
    filesChanged: [],
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

### Provider-Specific Adaptations

**KimiProvider differences:**

- Config keys: `kimi.apiKey`, `kimi.baseURL`, `kimi.model`
- API key env var: `KIMI_API_KEY` (not `OPENAI_API_KEY`)
- Model env var: `KIMI_MODEL`
- Base URL env var: `KIMI_BASE_URL`
- Command: `'kimi "$DSF_AGENTIC_PROMPT"'`
- Logger: `new Logger(KimiProvider.name)`
- Error messages: `'Kimi sandbox execution timed out'` etc.

**GeminiProvider differences:**

- Config keys: `gemini.apiKey`, `gemini.baseURL`, `gemini.model`
- API key env var: `GEMINI_API_KEY` (not `OPENAI_API_KEY`)
- Model env var: `GEMINI_MODEL`
- Base URL env var: `GEMINI_BASE_URL`
- Command: `'gemini "$DSF_AGENTIC_PROMPT"'`
- `IS_SANDBOX: '1'` is already present in the old env — keep it
- Logger: `new Logger(GeminiProvider.name)`
- Error messages: `'Gemini sandbox execution timed out'` etc.

### Constructor Change Pattern (same for all 3 providers)

```typescript
import { Logger } from '@nestjs/common';
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';

// In class body:
private readonly logger = new Logger(CodexProvider.name);  // or KimiProvider / GeminiProvider

constructor(
  private readonly config: ConfigService,
  private readonly sandboxService: SandboxService,
  private readonly resourceProfileService: SandboxResourceProfileService,
  private readonly executionTracker: ExecutionTrackerService,  // ← ADD
) {}
```

### Test Mock Pattern for All 3 Specs

```typescript
import { ExecutionTrackerService } from '@/execution/execution-tracker.service';

// In describe block:
let mockExecutionTracker: { emitProgress: jest.Mock };

// In beforeEach (main module):
mockExecutionTracker = { emitProgress: jest.fn().mockResolvedValue(undefined) };
// Add to TestingModule.providers:
{ provide: ExecutionTrackerService, useValue: mockExecutionTracker }

// Config map — add to ALL createTestingModule calls:
'github.token': 'ghp_test-token'
```

### Success Test Mock (same pattern for all 3 specs)

```typescript
// Replace the default mockSandboxService.runAgentCommand mock in beforeEach:
mockSandboxService.runAgentCommand.mockImplementation(async (opts) => {
  const resultLine = JSON.stringify({
    type: 'result',
    prUrl: 'https://github.com/org/repo/pull/42',
    commitSha: 'deadbeef',
    // branchName matches the featureBranch formula:
    // ticketId='ticket-123' → sanitized='ticket-123'; executionId='exec-456' → slice(0,8)='exec-456'
    // → 'dsf/ticket-123/exec-456'
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

> Note: `executionId: 'exec-456'` in `mockPayload` is intentionally 8 characters so `.slice(0, 8)` produces `'exec-456'` exactly. Keep it at 8 chars.

### Example Test: Progress Line Parsing

```typescript
it('should call emitProgress for type:progress stdout lines', async () => {
  const progressLine = JSON.stringify({ type: 'progress', pct: 30, msg: 'Implementing changes' });
  const resultLine = JSON.stringify({
    type: 'result',
    prUrl: 'https://github.com/org/repo/pull/1',
    commitSha: 'abc123',
    branchName: 'dsf/ticket-123/exec0001',
    qaStatus: 'passed',
    qaRetryCount: 0,
  });

  sandboxService.runAgentCommand.mockImplementation(async (opts) => {
    opts.onStdoutLine?.(progressLine);
    opts.onStdoutLine?.('not json at all');
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
    'Implementing changes',
    30,
  );
  expect(result.success).toBe(true);
  expect(result.qaStatus).toBe('passed');
  expect(result.prUrl).toBe('https://github.com/org/repo/pull/1');
  expect(result.codeDiff).toBeNull();
});
```

### Key Design Decisions

**Why `codeDiff: null`:** The old providers returned `codeDiff: result.stdout`. In the agentic workflow, stdout contains JSON progress markers mixed with output — not a diff. The actual diff is on the GitHub branch/PR. Return `null` (same as WR-2.3).

**Why `DSF_AGENTIC_PROMPT` env var:** Passing the workflow as an env var avoids shell injection. The `$()`, backticks, and `$VAR` patterns inside a string passed via env are not re-interpreted by the shell — the env var value is used verbatim.

**Why `IS_SANDBOX: '1'` added to Codex/Kimi:** Gemini already had it (kept). Codex and Kimi did not — add for consistency since all 3 now run agentic workloads.

**`TASK_DESCRIPTION` vs `DSF_AGENTIC_PROMPT`:** Both are set. `TASK_DESCRIPTION` is a clean plain-text version (for the agent to reference in commit messages). `DSF_AGENTIC_PROMPT` is the full prompt with workflow instructions. The CLI command uses `"$DSF_AGENTIC_PROMPT"`.

**`github.token` config key:** Same key as WR-2.3 (`src/config/configuration.ts:L59`). Already required at startup via `env.validation.ts:L92`.

**`onStdoutLine` is sync:** The `onStdout` callback in `SandboxService` is synchronous. Keep `onStdoutLine` as `(line: string) => void`. Use `void this.executionTracker.emitProgress(...)` inside for fire-and-forget. NEVER make it async.

**Fallback result scan:** If `onStdoutLine` never fires (edge case: agent's last line lacks trailing `\n` so the line buffer holds it as incomplete), scan `result.stdout` in reverse. Identical to WR-2.3 pattern.

**No CODEX_API_KEY in this story:** The current codex provider uses `OPENAI_API_KEY`. Keep this for CLI compatibility. WR-2.5 is responsible for adding redaction of provider-specific key names — do NOT change env var names here.

### Config Key Reference

| Provider | API Key config                         | Model config   | Base URL config  |
| -------- | -------------------------------------- | -------------- | ---------------- |
| Codex    | `codex.apiKey` → `OPENAI_API_KEY` env  | `codex.model`  | `codex.baseURL`  |
| Kimi     | `kimi.apiKey` → `KIMI_API_KEY` env     | `kimi.model`   | `kimi.baseURL`   |
| Gemini   | `gemini.apiKey` → `GEMINI_API_KEY` env | `gemini.model` | `gemini.baseURL` |

### Previous Story Intelligence (from WR-2.3)

- `onStdoutLine` callback is added to `AgentCommandOptions` by WR-2.3 — **verify it exists before coding** (Task 0.1); use it exactly as shown above
- `SandboxService` line-buffer is added by WR-2.3 — **verify it exists before coding** (Task 0.2); do NOT re-implement buffering
- `ExecutionTrackerService.emitProgress()` takes exactly 5 args: `(executionId, ticketId, projectId, step, percent)`
- `ai-routing.module.ts:L42` imports `ExecutionModule` — no module changes needed
- `ExecutionModule` exports `ExecutionTrackerService` (see `src/execution/execution.module.ts:L285`)
- The `SandboxService.redactEnvForLogging()` regex already covers `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `KIMI_API_KEY`, `GEMINI_API_KEY` via `KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH` pattern — no change needed here

### Project Structure Notes

- All 3 provider files are in `src/ai-routing/providers/` — keep them there
- Use `@/` path alias for all imports: `@/execution/execution-tracker.service`, `@/sandbox/sandbox.service`, etc.
- Do NOT extend `BaseAIProvider` — these providers use `ExecutionStage`-based progress tracking differently; the `onStdoutLine` approach uses raw `pct` values from stdout, NOT `BaseAIProvider.reportProgress()`
- The `SandboxResultLine` interface is defined locally in each provider file (3 separate copies) — this is intentional, not code smell

### References

- [Source: epics-workspace-removal.md#Story-WR-2.4] — FR-WR5, FR-WR13, NFR-WR4 specs
- [Source: epics-workspace-removal.md#FR-WR5] — "structured system prompt within execute()"
- [Source: wr-2-3-implement-claude-code-provider-full-agentic-workflow.md] — onStdoutLine, SandboxResultLine, execute() pattern to replicate
- [Source: wr-2-1-establish-shared-provider-contract-execution-state.md] — IAIExecutionResult fields: prUrl, commitSha, branchName, qaStatus, qaRetryCount
- [Source: src/ai-routing/providers/codex.provider.ts] — current provider (full rewrite of execute())
- [Source: src/ai-routing/providers/kimi.provider.ts] — current provider (full rewrite of execute())
- [Source: src/ai-routing/providers/gemini.provider.ts] — current provider (full rewrite of execute())
- [Source: src/ai-routing/providers/claude-code.provider.ts] — execute() implementation to mirror
- [Source: src/sandbox/interfaces/agent-command-options.interface.ts] — onStdoutLine callback signature (added in WR-2.3)
- [Source: src/execution/execution-tracker.service.ts#L1178] — emitProgress 5-arg signature
- [Source: src/execution/execution.module.ts#L285] — ExecutionTrackerService exported from ExecutionModule
- [Source: src/ai-routing/ai-routing.module.ts#L42] — ExecutionModule already imported
- [Source: src/config/configuration.ts#L59] — github.token config key
- [Source: src/config/configuration.ts#L164-L185] — codex/kimi/gemini config keys
- [Source: src/config/env.validation.ts#L92] — GITHUB_TOKEN required at startup
- [Source: src/ai-routing/interfaces/ai-provider.interface.ts] — IAIExecutionResult (prUrl, commitSha, branchName, qaStatus, qaRetryCount fields)

---

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 — story created 2026-04-01

### Debug Log References

### Completion Notes List

### File List
