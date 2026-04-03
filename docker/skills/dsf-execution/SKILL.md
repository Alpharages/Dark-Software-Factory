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
| QA_MAX_RETRIES    | NO       | 3       | Maximum QA self-healing retries (≥1)    |

## Security Constraints — Non-Negotiable

- NEVER commit `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, or any secrets file
- NEVER log or print the value of any environment variable
- NEVER make network calls to hosts other than: the $REPO_URL host and api.github.com
- ALL output goes to stdout only — no file exfiltration
- If $GITHUB_TOKEN or $ANTHROPIC_API_KEY appears in any diff, ABORT immediately
- NEVER embed tokens in git remote URLs — use `gh auth setup-git` for push authentication

## Execution Workflow

### Step 0: Validate Environment

Set up an exit trap so that any unexpected failure emits a result JSON before the process dies:

```bash
_on_exit() {
  echo "{\"type\":\"result\",\"prUrl\":null,\"commitSha\":\"\",\"branchName\":\"${FEATURE_BRANCH:-}\",\"qaStatus\":\"failed\",\"qaRetryCount\":0}"
}
trap '_on_exit' ERR
```

Check required env vars, format, and safety:

```bash
# 1. Required presence — exit on any missing variable
for var in REPO_URL FEATURE_BRANCH TASK_DESCRIPTION GITHUB_TOKEN ANTHROPIC_API_KEY; do
  if [ -z "${!var:-}" ]; then
    echo '{"type":"result","prUrl":null,"commitSha":"","branchName":"","qaStatus":"failed","qaRetryCount":0}'
    exit 1
  fi
done

# 2. REPO_URL must be an HTTPS URL (SSH format breaks gh auth setup-git authentication)
if [[ "$REPO_URL" != https://* ]]; then
  echo '{"type":"result","prUrl":null,"commitSha":"","branchName":"","qaStatus":"failed","qaRetryCount":0}'
  exit 1
fi

# 3. FEATURE_BRANCH must be a safe git ref name — no leading dashes, no shell metacharacters
if [[ ! "$FEATURE_BRANCH" =~ ^[a-zA-Z0-9._/-]+$ ]] || [[ "$FEATURE_BRANCH" == -* ]]; then
  echo '{"type":"result","prUrl":null,"commitSha":"","branchName":"","qaStatus":"failed","qaRetryCount":0}'
  exit 1
fi

# 4. QA_MAX_RETRIES must be a positive integer (default 3 if unset or invalid)
QA_MAX_RETRIES="${QA_MAX_RETRIES:-3}"
if ! [[ "$QA_MAX_RETRIES" =~ ^[1-9][0-9]*$ ]]; then
  QA_MAX_RETRIES=3
fi
```

### Step 1: Emit Initial Progress

Emit to stdout (newline-delimited JSON — this is the FIRST output line):
{"type":"progress","pct":10,"msg":"Budget check passed"}

### Step 2: Clone Repository

Emit BEFORE cloning starts (so PM sees the milestone as it begins, not after):
{"type":"progress","pct":20,"msg":"Cloning repository"}

Remove any pre-existing workspace directory to ensure a clean clone:

```bash
rm -rf workspace
```

Clone $REPO_URL and create/checkout $FEATURE_BRANCH:

```bash
git clone --no-progress "$REPO_URL" workspace
cd workspace
git checkout -b "$FEATURE_BRANCH" 2>/dev/null || git checkout "$FEATURE_BRANCH"
```

(`--no-progress` suppresses git's stderr progress output, keeping stdout free of non-JSON noise.)

Configure git identity for commits:

```bash
git config user.email "dsf-agent@darksoftwarefactory.ai"
git config user.name "DSF Agent"
```

Configure GitHub CLI for push authentication (token stays out of `.git/config` and git remote URLs):

```bash
export GH_TOKEN="$GITHUB_TOKEN"
gh auth setup-git
```

(`gh auth setup-git` registers the GitHub CLI as a git credential helper for github.com, so `git push` authenticates via `GH_TOKEN` without embedding the token in the remote URL.)

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

**CRITICAL: Run lint and tests as separate commands** so you can determine each outcome independently:

1. Record the attempt start time: `QA_START_MS=$(date +%s%3N)`
2. Run the lint command (e.g., `pnpm lint`). Capture whether it passed and the error count.
3. Run the test command (e.g., `pnpm test`). Capture whether it passed, the pass count, and the fail count.

Emit at the start of QA:
`{"type":"progress","pct":80,"msg":"Running QA"}`

**After EACH QA attempt completes (initial run AND each retry):**

Compute `QA_DURATION_MS = $(date +%s%3N) - QA_START_MS`.
Emit a `qa_attempt` JSON line to stdout with this exact shape:

```json
{
  "type": "qa_attempt",
  "attempt": 1,
  "lintPassed": true,
  "lintErrors": { "count": 0, "details": [] },
  "testsPassed": false,
  "testResults": { "passed": 12, "failed": 1, "details": [] },
  "durationMs": 4200
}
```

- `attempt`: Current attempt number (1-based: first run = 1, first retry = 2, etc.)
- `lintPassed/testsPassed`: JSON booleans.
- `lintErrors`: `count` = 0 if passed.
- `testResults`: `passed`/`failed` counts. If tests were skipped (e.g., due to fatal lint), set `testsPassed: false` and counts to 0.

**On QA failure — self-healing loop (up to $QA_MAX_RETRIES attempts, default 3):**

For each retry attempt N (1-indexed start):

1. READ the full error output carefully
2. REASON about the root cause — which file(s) need fixing?
3. EDIT the specific file(s) to fix the issue — do NOT retry without making changes
4. Emit: `{"type":"progress","pct":82,"msg":"QA failed — retrying (N/3)"}` ← emit BEFORE re-running
5. Reset `QA_START_MS=$(date +%s%3N)`, then RE-RUN the QA sequence (separate lint/test calls)
6. Emit the `qa_attempt` marker for attempt N+1 after it completes

If QA fails after all retries:

- DO NOT open a PR
- Commit and push the failing branch anyway:
  ```bash
  if git status --porcelain | grep -q .; then
    git add -A
    git commit --no-verify -m "<AI-generated message describing what was attempted and what QA errors remain>"
  fi
  git push origin "$FEATURE_BRANCH"
  COMMIT_SHA=$(git rev-parse HEAD)
  ```
- Emit the final result line with `qaStatus` "failed"

`qaRetryCount` = Number of retry attempts made (0 if QA passed on first attempt).
`qaStatus` values:

- "passed" — QA passed on first attempt (qaRetryCount = 0)
- "self_healed" — QA passed after one or more retries (qaRetryCount ≥ 1)
- "failed" — All retries exhausted, QA did not pass (qaRetryCount = QA_MAX_RETRIES)

### Step 5: Commit

Only commit if there are staged changes — guard against empty commits:

```bash
git add -A
if git status --porcelain | grep -q .; then
  git commit -m "<AI-generated descriptive message reflecting what was changed>"
else
  echo '{"type":"result","prUrl":null,"commitSha":"","branchName":"'"$FEATURE_BRANCH"'","qaStatus":"failed","qaRetryCount":0}'
  exit 1
fi
```

The commit message MUST describe the actual change, not a generic placeholder.
Do NOT include "WIP", "initial commit", or "automated" in the message.

### Step 6: Push to GitHub

Emit BEFORE pushing starts:
{"type":"progress","pct":90,"msg":"Pushing to GitHub"}

```bash
git push --force-with-lease origin "$FEATURE_BRANCH"
COMMIT_SHA=$(git rev-parse HEAD)
```

(`--force-with-lease` handles the case where the remote branch already exists: it pushes if the remote tip matches what was cloned, but refuses if someone else pushed in the meantime — preventing silent overwrites.)

### Step 7: Open Pull Request (skip if qaStatus is "failed")

Only open a PR if QA passed or self-healed.

Emit BEFORE creating the PR:
{"type":"progress","pct":95,"msg":"Opening PR"}

```bash
# Detect the repository's actual default branch (handles main, master, develop, etc.)
DEFAULT_BRANCH=$(git remote show origin | grep "HEAD branch" | cut -d" " -f5)
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"  # fallback to "main" if detection fails

# Create PR, or retrieve URL if one already exists for this branch
PR_URL=$(gh pr create \
  --title "<descriptive PR title>" \
  --body "<PR description summarizing what changed and why>" \
  --base "$DEFAULT_BRANCH" \
  --head "$FEATURE_BRANCH" 2>/dev/null) || \
PR_URL=$(gh pr view "$FEATURE_BRANCH" --json url --jq '.url' 2>/dev/null)
```

(If `gh pr create` fails because a PR already exists for this branch, `gh pr view` retrieves the existing PR URL so `PR_URL` is always populated on success.)

### Step 8: Emit Final Result Line

This MUST be the last line written to stdout. No output after this line.

Emit final progress before result:
{"type":"progress","pct":100,"msg":"Done"}

On success (QA passed or self_healed):

```
{"type":"result","prUrl":"<PR_URL>","commitSha":"<COMMIT_SHA>","branchName":"<FEATURE_BRANCH>","qaStatus":"passed|self_healed","qaRetryCount":<N>}
```

On hard QA failure (all retries exhausted):

```
{"type":"result","prUrl":null,"commitSha":"<COMMIT_SHA>","branchName":"<FEATURE_BRANCH>","qaStatus":"failed","qaRetryCount":<QA_MAX_RETRIES>}
```

Then emit the result line.
