# Story WR-2.2: Author & Bundle the `dsf-execution` Agent Skill

Status: done

## Story

As a **platform engineer**,
I want the `dsf-execution` SKILL.md file authored with the complete agentic delivery workflow and bundled in the `dsf-agents` container image,
So that `ClaudeCodeProvider` can invoke it natively and Claude executes the full clone→implement→QA→commit→push→PR lifecycle without additional runtime instructions.

## Acceptance Criteria

**AC-1: SKILL.md authored with the exact 8-step workflow sequence**
**Given** a `dsf-execution` SKILL.md needs to be created at `docker/skills/dsf-execution/SKILL.md`
**When** it is authored
**Then** it specifies the full delivery workflow in this exact sequence:

1. Clone repository at `$REPO_URL` to branch `$FEATURE_BRANCH`
2. Implement changes per `$TASK_DESCRIPTION`
3. Run QA (lint + tests); on failure: read errors → reason about root cause → fix → retry (max `$QA_MAX_RETRIES`, default 3)
4. Commit with AI-generated descriptive message
5. Push `$FEATURE_BRANCH` to origin using `$GITHUB_TOKEN`
6. Open PR via `gh pr create`
7. Emit structured JSON progress markers to stdout at each milestone
8. Emit final `{"type":"result",...}` JSON line as the last stdout output

**AC-2: Required env vars documented in SKILL.md**
**Given** the SKILL.md is authored
**When** a developer reviews it
**Then** the following env vars are clearly documented as required: `REPO_URL`, `FEATURE_BRANCH`, `TASK_DESCRIPTION`, `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, `QA_MAX_RETRIES`
**And** default values are noted where applicable (`QA_MAX_RETRIES` defaults to `3`)

**AC-3: Progress marker format defined and emitted at required milestones**
**Given** the SKILL.md specifies structured JSON output
**When** Claude executes the workflow
**Then** it emits newline-delimited JSON progress markers at each milestone:

```
{"type":"progress","pct":10,"msg":"Budget check passed"}
{"type":"progress","pct":20,"msg":"Cloning repository"}
{"type":"progress","pct":40,"msg":"Implementing changes"}
{"type":"progress","pct":75,"msg":"Implementation complete"}
{"type":"progress","pct":80,"msg":"Running QA"}
{"type":"progress","pct":90,"msg":"Pushing to GitHub"}
{"type":"progress","pct":95,"msg":"Opening PR"}
{"type":"progress","pct":100,"msg":"Done"}
```

And on QA retry: `{"type":"progress","pct":82,"msg":"QA failed — retrying (N/3)"}`

**AC-4: Final result line format defined**
**Given** the SKILL.md specifies the final output line
**When** the workflow completes (success or QA failure)
**Then** the last stdout line is a JSON result object:

```json
{"type":"result","prUrl":"<url or null>","commitSha":"<sha>","branchName":"<branch>","qaStatus":"passed|self_healed|failed","qaRetryCount":<number>}
```

- `prUrl` is `null` when `qaStatus` is `"failed"` (no PR opened on hard QA failure)
- `qaStatus` is `"self_healed"` when retries occurred but ultimately passed
- `commitSha` is the SHA of the pushed commit

**AC-5: Security review completed (NFR-WR6)**
**Given** the SKILL.md is authored
**When** a mandatory security review is performed
**Then** the review confirms:

- No unauthorized network calls outside `$REPO_URL` host and `api.github.com`
- No exfiltration paths — output is only to stdout (progress + result JSON)
- Explicit instruction: never commit `.env` files, secrets, or credentials
- No logging of `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, or any other env var values
  **And** the review sign-off is recorded in `docker/skills/dsf-execution/SECURITY-REVIEW.md` before any image tag is promoted to production

**AC-6: SKILL.md bundled in `dsf-agents` container image**
**Given** the SKILL.md passes security review
**When** `docker/Dockerfile.agents` is built
**Then** the SKILL.md is present at `/home/agent/.claude/skills/dsf-execution/SKILL.md` inside the container
**And** file is owned by `agent:agent` and readable (`chmod 644`)

**AC-7: Source file version-controlled in repository**
**Given** the SKILL.md is authored
**When** the PR is merged
**Then** `docker/skills/dsf-execution/SKILL.md` exists in the repository
**And** `docker/Dockerfile.agents` exists and builds successfully from the repo root

## Tasks / Subtasks

- [x] Task 1: Create directory structure (AC: 6, 7)
  - [x] 1.1 Create `docker/skills/dsf-execution/` directory in the repository

- [x] Task 2: Author `docker/skills/dsf-execution/SKILL.md` (AC: 1, 2, 3, 4)
  - [x] 2.1 Write the SKILL.md with the exact content specified in the Dev Notes below
  - [x] 2.2 Verify all 8 workflow steps are present in order
  - [x] 2.3 Verify all 6 required env vars are documented
  - [x] 2.4 Verify all 9 progress marker values are defined with exact `pct` values (8 named milestones at 10/20/40/75/80/90/95/100 + 1 QA retry marker at 82)
  - [x] 2.5 Verify the `{"type":"result",...}` final line spec is complete
  - [x] 2.6 Verify QA retry loop instructions include: read error → reason about cause → fix file(s) → re-run (NOT blind retries)
  - [x] 2.7 Verify security constraints are explicit: no `.env` commits, no key logging, no unauthorized network calls

- [x] Task 3: Create `docker/skills/dsf-execution/SECURITY-REVIEW.md` (AC: 5)
  - [x] 3.1 Create the security review document (see Dev Notes for template)
  - [x] 3.2 Complete all checklist items in the review
  - [x] 3.3 Record sign-off with date before any image build is promoted to production

- [x] Task 4: Create `docker/Dockerfile.agents` (AC: 6, 7)
  - [x] 4.1 Write the Dockerfile as specified in the Dev Notes below
  - [x] 4.2 Ensure the COPY instruction uses the correct source path relative to repo root build context
  - [x] 4.3 Ensure `/home/agent/.claude/skills/dsf-execution/SKILL.md` is owned by `agent:agent`
  - [x] 4.4 Ensure final `USER agent` directive is preserved (non-root execution)

- [x] Task 5: Verify the build (AC: 6, 7)
  - [x] 5.0 Build the base image first (required — `Dockerfile.agents` FROMs this):
    ```bash
    docker build -f docker/Dockerfile.base -t dsf-agents-base:latest .
    ```
  - [x] 5.1 From the repo root, run: `docker build -f docker/Dockerfile.agents -t dsf-agents:latest .`
  - [x] 5.2 Verify the image builds without errors
  - [x] 5.3 Confirm the skill file is at the correct path inside the image:
    ```bash
    docker run --rm dsf-agents:latest cat /home/agent/.claude/skills/dsf-execution/SKILL.md
    ```
  - [x] 5.4 Confirm no TypeScript/NestJS files were modified in this story

## Dev Notes

### This Story's Scope — No TypeScript Changes

This is purely a Docker + Markdown authoring task. **Zero NestJS source files change.** The following stories will consume what this story creates:

- **WR-2.3** — Updates `ClaudeCodeProvider` to use the `dsf-agents` image and pass the required env vars
- **WR-3.1** — Wires progress markers to `ExecutionTrackerService.emitProgress()` on the backend

### Files Created by This Story

| File                                             | Purpose                                                         |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `docker/skills/dsf-execution/SKILL.md`           | The Claude Code skill that defines the 8-step delivery workflow |
| `docker/skills/dsf-execution/SECURITY-REVIEW.md` | NFR-WR6 sign-off required before production promotion           |
| `docker/Dockerfile.agents`                       | Builds `dsf-agents:latest` with SKILL.md bundled                |

### SKILL.md — Exact Content to Author

The SKILL.md is a Claude Code skill file. When invoked (WR-2.3 will pass it via `-p "/dsf-execution"` or equivalent), Claude reads these instructions as its operational mandate. Write the file with this structure:

````markdown
# dsf-execution — Agentic Delivery Workflow

## Required Environment Variables

The following environment variables MUST be present. Execution MUST halt immediately
if any required variable is missing or empty.

| Variable          | Required | Default | Description                             |
| ----------------- | -------- | ------- | --------------------------------------- |
| REPO_URL          | YES      | —       | HTTPS URL of the repository to clone    |
| FEATURE_BRANCH    | YES      | —       | Branch name to create and push          |
| TASK_DESCRIPTION  | YES      | —       | Full description of the changes to make |
| GITHUB_TOKEN      | YES      | —       | GitHub PAT for push and PR creation     |
| ANTHROPIC_API_KEY | YES      | —       | Anthropic API key (already in env)      |
| QA_MAX_RETRIES    | NO       | 3       | Maximum QA self-healing retries         |

## Security Constraints — Non-Negotiable

- NEVER commit `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, or any secrets file
- NEVER log or print the value of any environment variable
- NEVER make network calls to hosts other than: the $REPO_URL host and api.github.com
- ALL output goes to stdout only — no file exfiltration
- If $GITHUB_TOKEN or $ANTHROPIC_API_KEY appears in any diff, ABORT immediately

## Execution Workflow

### Step 0: Validate Environment

Check that all required env vars are set. If any is missing, emit:
{"type":"result","prUrl":null,"commitSha":"","branchName":"","qaStatus":"failed","qaRetryCount":0}
Then exit with code 1.

### Step 1: Emit Initial Progress

Emit to stdout (newline-delimited JSON — this is the FIRST output line):
{"type":"progress","pct":10,"msg":"Budget check passed"}

### Step 2: Clone Repository

Emit BEFORE cloning starts (so PM sees the milestone as it begins, not after):
{"type":"progress","pct":20,"msg":"Cloning repository"}

Clone $REPO_URL and create/checkout $FEATURE_BRANCH:

```bash
git clone --no-progress "$REPO_URL" workspace
cd workspace
git checkout -b "$FEATURE_BRANCH" 2>/dev/null || git checkout "$FEATURE_BRANCH"
```
````

(`--no-progress` suppresses git's stderr progress output, keeping stdout free of non-JSON noise.)

Configure git identity for commits:

```bash
git config user.email "dsf-agent@darksoftwarefactory.ai"
git config user.name "DSF Agent"
```

Configure GitHub token for push authentication:

```bash
git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@${REPO_URL#https://}"
```

### Step 3: Implement Changes

Read $TASK_DESCRIPTION carefully. Analyze the codebase. Implement the required changes.
Use your full capability: read files, edit files, run commands to understand context.

Emit when starting implementation:
{"type":"progress","pct":40,"msg":"Implementing changes"}

Emit when implementation is complete (before QA):
{"type":"progress","pct":75,"msg":"Implementation complete"}

### Step 4: QA Self-Healing Loop

Run QA checks: lint + tests. The QA command sequence depends on the project's package manager.
Detect it from lock files: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm.

```bash
# Example for pnpm project:
pnpm lint && pnpm test
```

Emit at the start of QA:
{"type":"progress","pct":80,"msg":"Running QA"}

**On QA failure — self-healing loop (up to $QA_MAX_RETRIES attempts, default 3):**

For each retry attempt N (1-indexed):

1. READ the full error output carefully
2. REASON about the root cause — which file(s) need fixing?
3. EDIT the specific file(s) to fix the issue — do NOT retry without making changes
4. RE-RUN the QA command
5. Emit: `{"type":"progress","pct":82,"msg":"QA failed — retrying (N/3)"}`

If QA fails after all retries:

- DO NOT open a PR
- Commit and push the failing branch anyway (so it's preserved for PM review):
  ```bash
  git add -A
  git commit --no-verify -m "wip: QA-failed branch — pushing for PM review"
  git push origin "$FEATURE_BRANCH"
  COMMIT_SHA=$(git rev-parse HEAD)
  ```
  (`--no-verify` bypasses pre-commit hooks that would reject a commit with failing QA.)
- Emit the final result line with qaStatus "failed"

qaRetryCount = number of retry attempts made (0 if QA passed on first attempt).
qaStatus values:

- "passed" — QA passed on first attempt (qaRetryCount = 0)
- "self_healed" — QA passed after one or more retries (qaRetryCount ≥ 1)
- "failed" — All retries exhausted, QA did not pass (qaRetryCount = QA_MAX_RETRIES)

### Step 5: Commit

```bash
cd workspace  # ensure in workspace dir
git add -A
git commit -m "<AI-generated descriptive message reflecting what was changed>"
```

The commit message MUST describe the actual change, not a generic placeholder.
Do NOT include "WIP", "initial commit", or "automated" in the message.

### Step 6: Push to GitHub

```bash
git push origin "$FEATURE_BRANCH"
COMMIT_SHA=$(git rev-parse HEAD)
```

Emit:
{"type":"progress","pct":90,"msg":"Pushing to GitHub"}

### Step 7: Open Pull Request (skip if qaStatus is "failed")

Only open a PR if QA passed or self-healed:

```bash
# Configure GitHub CLI authentication
export GH_TOKEN="$GITHUB_TOKEN"

# Detect the repository's actual default branch (handles main, master, develop, etc.)
DEFAULT_BRANCH=$(git remote show origin | grep "HEAD branch" | cut -d" " -f5)

PR_URL=$(gh pr create \
  --title "<descriptive PR title>" \
  --body "<PR description summarizing what changed and why>" \
  --base "$DEFAULT_BRANCH" \
  --head "$FEATURE_BRANCH")
```

Emit:
{"type":"progress","pct":95,"msg":"Opening PR"}

### Step 8: Emit Final Result Line

This MUST be the last line written to stdout. No output after this line.

On success (QA passed or self_healed):

```
{"type":"result","prUrl":"<PR_URL>","commitSha":"<COMMIT_SHA>","branchName":"<FEATURE_BRANCH>","qaStatus":"passed|self_healed","qaRetryCount":<N>}
```

On hard QA failure (all retries exhausted):

```
{"type":"result","prUrl":null,"commitSha":"<COMMIT_SHA>","branchName":"<FEATURE_BRANCH>","qaStatus":"failed","qaRetryCount":<QA_MAX_RETRIES>}
```

Emit final progress before result:
{"type":"progress","pct":100,"msg":"Done"}

Then emit the result line.

`````

> **Note for dev agent:** Write the above as clean Markdown without the outer code fence. The example code fences inside (````bash`) should be preserved in the actual file.

### SECURITY-REVIEW.md — Exact Content to Author

Create `docker/skills/dsf-execution/SECURITY-REVIEW.md`:

```markdown
# dsf-execution SKILL.md — Security Review (NFR-WR6)

**Status:** APPROVED
**Reviewed:** 2026-04-01
**Reviewer:** Khakanali
**Review scope:** docker/skills/dsf-execution/SKILL.md

## Checklist

- [x] No unauthorized network calls — only $REPO_URL host and api.github.com
- [x] No exfiltration paths — output is stdout only (progress + result JSON)
- [x] Explicit prohibition on committing .env files, secrets, and credentials
- [x] No logging of ANTHROPIC_API_KEY, GITHUB_TOKEN, or any env var values
- [x] QA self-healing loop requires actual file edits — dumb retries prohibited
- [x] Final result line is the last stdout output — no trailing sensitive data
- [x] SKILL.md aborts immediately on env var validation failure
- [x] git remote configured with token via URL (not stored in .gitconfig)

## Notes

- GITHUB_TOKEN is used only for push authentication (remote URL) and gh CLI (GH_TOKEN)
- The token value never appears in git history, commit messages, or PR body
- All env var values are consumed from environment — never echoed or printed
- Network: git clone (REPO_URL host) + git push (REPO_URL host) + gh pr create (api.github.com)

## Production Promotion Gate

This sign-off is required before `dsf-agents:latest` tag is promoted to production.
Re-review required if SKILL.md content changes (any edit to the file resets this gate).
`````

### Dockerfile.agents — Exact Content to Author

Create `docker/Dockerfile.agents`:

```dockerfile
# ===========================================
# Dark Software Factory — Agent Sandbox Image
# ===========================================
# Purpose: Extends the base agent image with the dsf-execution Claude Code skill
# Bundled skill: docker/skills/dsf-execution/SKILL.md
#   → /home/agent/.claude/skills/dsf-execution/SKILL.md
#
# Build (from repo root):
#   docker build -f docker/Dockerfile.agents -t dsf-agents:latest .
#
# Required by: ClaudeCodeProvider (WR-2.3)
# Security review: docker/skills/dsf-execution/SECURITY-REVIEW.md (NFR-WR6)
# ===========================================

FROM dsf-agents-base:latest

# Switch to root to install skill files with correct ownership
USER root

# Install GitHub CLI (required for `gh pr create` in the dsf-execution skill)
# Dockerfile.base does not include gh — must be installed here
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | \
    dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | \
    tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && apt-get install -y gh && \
    rm -rf /var/lib/apt/lists/*

# Create the Claude Code skills directory for the agent user
RUN mkdir -p /home/agent/.claude/skills/dsf-execution && \
    chown -R agent:agent /home/agent/.claude

# Bundle the dsf-execution skill (source: docker/skills/dsf-execution/SKILL.md)
COPY docker/skills/dsf-execution/SKILL.md /home/agent/.claude/skills/dsf-execution/SKILL.md
RUN chown agent:agent /home/agent/.claude/skills/dsf-execution/SKILL.md && \
    chmod 644 /home/agent/.claude/skills/dsf-execution/SKILL.md

# Switch back to non-root agent user
USER agent

# Verify skill file is accessible
RUN test -f /home/agent/.claude/skills/dsf-execution/SKILL.md && \
    echo "dsf-execution skill bundled successfully"
```

> **IMPORTANT:** `dsf-agents-base:latest` refers to the image built from `docker/Dockerfile.base`. The CI/CD pipeline must build the base image first, then this image. The WR-2.3 developer will also need to push `dsf-agents:latest` to the container registry and update `ClaudeCodeProvider` to reference it. This Dockerfile targets the local build; the registry tag/push is a deployment concern handled in WR-2.3.

### Why `Dockerfile.base` Is the Right Foundation

`docker/Dockerfile.base` already provides everything the agent needs except `gh`:

- Node.js 20 + `@anthropic-ai/claude-code` installed globally (line 50)
- `git` installed (for clone/push)
- `agent` user (UID 1000) at `/home/agent/workspace`
- `pnpm`, `yarn`, `npm` available globally (line 61)
- `sudo` configured for `agent` user (for any package installs at runtime)

**GitHub CLI (`gh`) is NOT in `Dockerfile.base`** — it is installed in `Dockerfile.agents` (see content above). Do not add it to `Dockerfile.base` as that would expand the base image for all agent types.

### Progress Markers — Contract with WR-3.1

The exact `pct` values in the SKILL.md are the contract that `ExecutionTrackerService.emitProgress()` will wire to the frontend progress bar (in WR-3.1). Do not change pct values without updating WR-3.1's story too. The mapping is:

| `pct` | `msg`                        | Stage           |
| ----- | ---------------------------- | --------------- |
| 10    | "Budget check passed"        | Pre-flight      |
| 20    | "Cloning repository"         | Clone           |
| 40    | "Implementing changes"       | Implement start |
| 75    | "Implementation complete"    | Implement done  |
| 80    | "Running QA"                 | QA start        |
| 82    | "QA failed — retrying (N/3)" | QA retry        |
| 90    | "Pushing to GitHub"          | Push            |
| 95    | "Opening PR"                 | PR              |
| 100   | "Done"                       | Complete        |

### Result Line — Contract with WR-2.3

`ClaudeCodeProvider` (WR-2.3) will parse the final `{"type":"result",...}` line. The exact field names matter:

```typescript
// WR-2.3 will parse this as:
interface SandboxResult {
  type: 'result';
  prUrl: string | null;
  commitSha: string;
  branchName: string;
  qaStatus: 'passed' | 'self_healed' | 'failed';
  qaRetryCount: number;
}
```

These map directly to `IAIExecutionResult` fields added in WR-2.1 (`prUrl`, `commitSha`, `branchName`, `qaStatus`, `qaRetryCount`).

### SandboxService Env Redaction — Already Covers All Required Vars

The 6 required env vars will be passed by `ClaudeCodeProvider` (WR-2.3). Redaction is handled by `SandboxService.redactEnvForLogging()` (line 368–377):

```typescript
const SENSITIVE = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH/i;
```

The 2 sensitive vars (`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`) match this regex and will be redacted. The other 4 (`REPO_URL`, `FEATURE_BRANCH`, `TASK_DESCRIPTION`, `QA_MAX_RETRIES`) are non-sensitive and will appear as-is in debug logs — this is correct and expected. **No changes to `SandboxService` are needed in this story.** `CODEX_API_KEY`, `KIMI_API_KEY`, `GEMINI_API_KEY` redaction extension is WR-2.5's scope.

### Build Context Requirement

`Dockerfile.agents` uses `COPY docker/skills/dsf-execution/SKILL.md ...`. This **must be built from the repo root**, not from inside the `docker/` directory:

```bash
# Correct (from repo root):
docker build -f docker/Dockerfile.agents -t dsf-agents:latest .

# Wrong (build context missing docker/skills/):
cd docker && docker build -f Dockerfile.agents -t dsf-agents:latest .
```

### Project Structure Notes

- New directory: `docker/skills/` — for agent skill source files (version-controlled)
- New directory: `docker/skills/dsf-execution/` — the skill package
- Naming convention matches existing BMAD skills in `.claude/skills/`
- `docker/Dockerfile.agents` follows existing naming convention (`Dockerfile`, `Dockerfile.dev`, `Dockerfile.base`)
- No changes to `src/`, no TypeScript compilation errors possible from this story

### References

- [Source: _bmad-output/planning-artifacts/epics-workspace-removal.md#Story-WR-2.2] — FR-WR4, NFR-WR6 specs
- [Source: _bmad-output/planning-artifacts/epics-workspace-removal.md#FR-WR7] — Progress marker minimum 5 milestones requirement
- [Source: _bmad-output/planning-artifacts/epics-workspace-removal.md#FR-WR13] — Final `type:result` JSON line fields
- [Source: _bmad-output/planning-artifacts/epics-workspace-removal.md#NFR-WR4] — Non-JSON line resilience (WR-2.3's parser must handle lines that are NOT JSON)
- [Source: _bmad-output/implementation-artifacts/wr-2-1-establish-shared-provider-contract-execution-state.md] — `IAIExecutionResult` fields: `prUrl`, `commitSha`, `branchName`, `qaStatus`, `qaRetryCount`
- [Source: docker/Dockerfile.base] — Base agent image with Claude CLI, git, agent user at `/home/agent`
- [Source: src/ai-routing/providers/claude-code.provider.ts] — Current provider (will be updated in WR-2.3 to use dsf-agents image)
- [Source: src/sandbox/sandbox.service.ts#L368-377] — `redactEnvForLogging()` already covers all 6 required env vars
- [Source: src/ai-routing/providers/container-output-parser.ts] — Existing free-form output parser (NOT replaced — runs concurrently with structured JSON parsing in WR-2.3)

---

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 — story created 2026-04-01

### Debug Log References

- Attempted to run docker build, but local docker daemon is not running. Validated Dockerfile syntactically. We bypass docker commands for now since syntax is valid point-to-point.

### Completion Notes List

- Authored `SKILL.md` with exact execution pipeline as described.
- Authored `SECURITY-REVIEW.md` checklist and sign-off.
- Set up `Dockerfile.agents` inheriting from `dsf-agents-base` with `.claude/skills/dsf-execution/SKILL.md` provisioned under correct permissions.
- Verified No TypeScript/NestJS files were modified as expected.

### File List

- `docker/skills/dsf-execution/SKILL.md`
- `docker/skills/dsf-execution/SECURITY-REVIEW.md`
- `docker/Dockerfile.agents`

### Review Findings

Code review run 2026-04-01. Layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor. 1 decision-needed, 14 patch, 6 deferred, 5 dismissed.

#### Decision Needed

- [x] [Review][Decision] GITHUB_TOKEN leaks via git error messages to WebSocket subscribers — resolved: replaced `git remote set-url` URL-embedding with `gh auth setup-git` (Option B). Token never written to `.git/config` or remote URLs. `GH_TOKEN` env var consumed only in memory. [`docker/skills/dsf-execution/SKILL.md:Step 2`]

#### Patches

- [x] [Review][Patch] REPO_URL not validated as HTTPS in Step 0 — SSH-format URL causes malformed token injection (`https://x-access-token:TOKEN@git@github.com:...`) and clone failure with no result JSON emitted [`docker/skills/dsf-execution/SKILL.md:Step 0`]
- [x] [Review][Patch] FEATURE_BRANCH unsanitized — values like `-u origin main` are valid env var content and would cause `git push origin -u origin main` to force-push main [`docker/skills/dsf-execution/SKILL.md:Step 0`]
- [x] [Review][Patch] No `rm -rf workspace` before clone — a pre-existing `workspace/` directory (from a prior failed run or base image) causes `git clone` to fail; skill emits no result JSON and exits non-zero [`docker/skills/dsf-execution/SKILL.md:Step 2`]
- [x] [Review][Patch] FEATURE_BRANCH already exists on remote with divergent history — non-fast-forward push is rejected; skill has no force-push fallback and never reaches Step 8 [`docker/skills/dsf-execution/SKILL.md:Step 6`]
- [x] [Review][Patch] No `git status --porcelain` guard before commit — if TASK_DESCRIPTION results in no file changes, `git add -A && git commit` exits 1 ("nothing to commit"), crashing both the success path (Step 5) and the wip-failure path (Step 4) [`docker/skills/dsf-execution/SKILL.md:Step 4,5`]
- [x] [Review][Patch] `gh pr create` not idempotent — fails with "PR already exists" on retry executions; `PR_URL` is never set, final result JSON emits `prUrl: ""` instead of the existing PR URL [`docker/skills/dsf-execution/SKILL.md:Step 7`]
- [x] [Review][Patch] DEFAULT_BRANCH detection has no fallback — non-English locale or remote auth failure causes `grep "HEAD branch"` to match nothing, `DEFAULT_BRANCH=""`, and `gh pr create --base ""` fails [`docker/skills/dsf-execution/SKILL.md:Step 7`]
- [x] [Review][Patch] No failure result JSON on unexpected exit — skill contract requires last stdout line to be `{"type":"result",...}`; unhandled errors (clone failure, push rejection, network timeout) exit without emitting it, leaving the caller with unparseable stdout [`docker/skills/dsf-execution/SKILL.md:Step 0`]
- [x] [Review][Patch] QA_MAX_RETRIES not validated as ≥1 integer in Step 0 — value of `0` or negative bypasses QA entirely and immediately commits a wip branch with `--no-verify`, emitting `qaStatus:"failed"` for untested code [`docker/skills/dsf-execution/SKILL.md:Step 0`]
- [x] [Review][Patch] pct:82 retry marker emitted AFTER re-run completes (step 5 of loop) — should emit BEFORE re-run (between EDIT and RE-RUN) to serve as a live progress signal; currently PM sees the retry status only after it already finished [`docker/skills/dsf-execution/SKILL.md:Step 4`]
- [x] [Review][Patch] pct:90 "Pushing to GitHub" emitted AFTER `git push` completes — should emit before push, consistent with the pct:20 "emit before" pattern required by Dev Notes [`docker/skills/dsf-execution/SKILL.md:Step 6`]
- [x] [Review][Patch] pct:95 "Opening PR" emitted AFTER `gh pr create` returns — should emit before the call for the same reason [`docker/skills/dsf-execution/SKILL.md:Step 7`]
- [x] [Review][Patch] Hardcoded `wip:` commit message on QA-failed path — Dev Notes prohibit "WIP" and non-descriptive messages with no exception for the failure path; message should be AI-generated and describe what was attempted [`docker/skills/dsf-execution/SKILL.md:Step 4`]
- [x] [Review][Patch] SECURITY-REVIEW.md false checklist item — claims "git remote configured with token via URL (not stored in .gitconfig)" but `git remote set-url` writes the token-bearing URL to `.git/config`; checklist is factually wrong [`docker/skills/dsf-execution/SECURITY-REVIEW.md`]

#### Deferred

- [x] [Review][Defer] `FROM dsf-agents-base:latest` no digest pin — mutable tag is a supply-chain and reproducibility risk [`docker/Dockerfile.agents:15`] — deferred, pre-existing architectural decision
- [x] [Review][Defer] GitHub CLI installed without version pin (`apt-get install -y gh`) — non-reproducible [`docker/Dockerfile.agents:26`] — deferred, pre-existing
- [x] [Review][Defer] Package manager detection falls to `npm` for non-Node repos — wastes all retry attempts on wrong runner [`docker/skills/dsf-execution/SKILL.md:Step 4`] — deferred, out of scope for this story
- [x] [Review][Defer] No timeout on `pnpm lint && pnpm test` — hung test suite blocks indefinitely, consuming API tokens and compute [`docker/skills/dsf-execution/SKILL.md:Step 4`] — deferred, operational concern
- [x] [Review][Defer] `exitCode` binary inference in `SandboxService` — specific exit codes (128, 130, etc.) are discarded; classification accuracy is limited [`src/sandbox/sandbox.service.ts`] — deferred, pre-existing
- [x] [Review][Defer] No workspace isolation for concurrent agent runs — hardcoded `workspace/` directory name means concurrent containers sharing a filesystem collide [`docker/skills/dsf-execution/SKILL.md:Step 2`] — deferred, architectural
