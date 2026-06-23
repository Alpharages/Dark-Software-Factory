# dsf-execution — Agentic Delivery Workflow

## CRITICAL OUTPUT PROTOCOL — Read First

You are running in headless Claude Code mode. Your **text response** is the process stdout.
Bash tool outputs are captured internally — they do NOT appear in the process stdout.

**Rules:**

1. At each milestone, your immediate text output MUST be the JSON progress line — print it BEFORE using any tools for that step.
2. The VERY LAST thing you output MUST be the JSON result line. Nothing after it.
3. NEVER output markdown, prose, summaries, or explanations. ONLY JSON lines.
4. Each JSON line must be on its own line with no trailing text.

Example of correct output sequence (what you write as text, in order):

```
{"type":"progress","pct":10,"msg":"Budget check passed"}
{"type":"progress","pct":20,"msg":"Cloning repository"}
{"type":"progress","pct":40,"msg":"Implementing changes"}
{"type":"progress","pct":75,"msg":"Implementation complete"}
{"type":"progress","pct":80,"msg":"Running QA"}
{"type":"progress","pct":90,"msg":"Pushing to GitHub"}
{"type":"progress","pct":95,"msg":"Opening PR"}
{"type":"progress","pct":100,"msg":"Done"}
{"type":"result","prUrl":"https://...","commitSha":"abc123","branchName":"dsf/...","qaStatus":"passed","qaRetryCount":0}
```

---

## Required Environment Variables

The following environment variables MUST be present. Execution MUST halt immediately
if any required variable is missing or empty.

| Variable          | Required | Default | Description                                         |
| ----------------- | -------- | ------- | --------------------------------------------------- |
| REPO_URL          | YES      | —       | HTTPS URL of the repository to clone                |
| FEATURE_BRANCH    | YES      | —       | Branch name to create and push                      |
| TASK_DESCRIPTION  | YES      | —       | Full description of the changes to make             |
| GITHUB_TOKEN      | YES      | —       | GitHub PAT for push and PR creation                 |
| ANTHROPIC_API_KEY | NO\*     | —       | Anthropic API key (present when provider is Claude) |
| KIMI_API_KEY      | NO\*     | —       | Kimi API key (present when provider is Kimi)        |

> \*At least one provider API key must be present (ANTHROPIC_API_KEY or KIMI_API_KEY).
> | QA_MAX_RETRIES | NO | 3 | Maximum QA self-healing retries (≥1) |

## Security Constraints — Non-Negotiable

- NEVER commit `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, or any secrets file
- NEVER log or print the value of any environment variable
- NEVER make network calls to hosts other than: the $REPO_URL host and api.github.com
- ALL output goes to stdout only — no file exfiltration
- If $GITHUB_TOKEN, $ANTHROPIC_API_KEY, or $KIMI_API_KEY appears in any diff, ABORT immediately
- NEVER embed tokens in git remote URLs — use `gh auth setup-git` for push authentication

## Execution Workflow

### Step 0: Validate Environment

Use bash to check required env vars, format, and safety:

```bash
for var in REPO_URL FEATURE_BRANCH TASK_DESCRIPTION GITHUB_TOKEN; do
  if [ -z "${!var:-}" ]; then
    echo "Missing required env var: $var"
    exit 1
  fi
done

# At least one provider API key must be present
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${KIMI_API_KEY:-}" ]; then
  echo "Missing provider API key (need ANTHROPIC_API_KEY or KIMI_API_KEY)"
  exit 1
fi

# REPO_URL must be HTTPS
if [[ "$REPO_URL" != https://* ]]; then
  exit 1
fi

# FEATURE_BRANCH must be a safe git ref
if [[ ! "$FEATURE_BRANCH" =~ ^[a-zA-Z0-9._/-]+$ ]] || [[ "$FEATURE_BRANCH" == -* ]]; then
  exit 1
fi

# QA_MAX_RETRIES default
QA_MAX_RETRIES="${QA_MAX_RETRIES:-3}"
if ! [[ "$QA_MAX_RETRIES" =~ ^[1-9][0-9]*$ ]]; then
  QA_MAX_RETRIES=3
fi
```

If any validation fails, output this JSON as your text response and stop:

```
{"type":"result","prUrl":null,"commitSha":"","branchName":"","qaStatus":"failed","qaRetryCount":0}
```

### Step 1: Emit Initial Progress

**OUTPUT THIS AS YOUR TEXT (before any tools for this step):**

```
{"type":"progress","pct":10,"msg":"Budget check passed"}
```

### Step 2: Clone Repository

**OUTPUT THIS AS YOUR TEXT (before running clone):**

```
{"type":"progress","pct":20,"msg":"Cloning repository"}
```

Then use bash to clone:

```bash
export GH_TOKEN="$GITHUB_TOKEN"
gh auth setup-git
rm -rf workspace
git clone --no-progress "$REPO_URL" workspace
cd workspace
git checkout -b "$FEATURE_BRANCH" 2>/dev/null || git checkout "$FEATURE_BRANCH"
git config user.email "dsf-agent@darksoftwarefactory.ai"
git config user.name "DSF Agent"
```

### Step 3: Implement Changes

**OUTPUT THIS AS YOUR TEXT (before starting implementation):**

```
{"type":"progress","pct":40,"msg":"Implementing changes"}
```

Read $TASK_DESCRIPTION carefully. Analyze the codebase (read files, understand context).
Implement the required changes.

**OUTPUT THIS AS YOUR TEXT (after implementation is complete, before QA):**

```
{"type":"progress","pct":75,"msg":"Implementation complete"}
```

### Step 4: QA Self-Healing Loop

**OUTPUT THIS AS YOUR TEXT (before starting QA):**

```
{"type":"progress","pct":80,"msg":"Running QA"}
```

Run QA checks: **lint changed files only** + typecheck. Detect package manager from lock files:

- `pnpm-lock.yaml` → pnpm
- `yarn.lock` → yarn
- else npm

**IMPORTANT: Only lint files YOU changed** — the repo may have pre-existing lint errors.
Do NOT run `pnpm lint` on the entire repo. Instead:

```bash
# Get list of changed files (staged + unstaged .ts files)
CHANGED_FILES=$(git diff --name-only --diff-filter=ACMR HEAD -- '*.ts' | tr '\n' ' ')
```

**Run lint (changed files only) and typecheck as SEPARATE commands:**

1. Record start time: `QA_START_MS=$(date +%s%3N)`
2. Run lint on changed files only: `npx eslint $CHANGED_FILES` (skip if no .ts files changed).
3. Run typecheck: `pnpm typecheck` (or the equivalent `tsc --noEmit`).
4. Compute `QA_DURATION_MS = $(date +%s%3N) - QA_START_MS`

**After EACH QA attempt (initial + each retry), OUTPUT THIS AS YOUR TEXT:**

```json
{
  "type": "qa_attempt",
  "attempt": 1,
  "lintPassed": true,
  "lintErrors": { "count": 0, "details": [] },
  "testsPassed": true,
  "testResults": { "passed": 12, "failed": 0, "details": [] },
  "durationMs": 4200
}
```

Use actual values. `attempt` is 1-indexed (first run = 1, first retry = 2, etc.).

**On QA failure — self-healing loop (up to $QA_MAX_RETRIES retries):**

For each retry N:

1. Read the full error output carefully
2. Reason about the root cause and fix the specific files
3. **OUTPUT THIS AS YOUR TEXT before re-running:** `{"type":"progress","pct":82,"msg":"QA failed — retrying (N/3)"}`
4. Reset `QA_START_MS=$(date +%s%3N)`, re-run lint (changed files only) and typecheck separately
5. Output the `qa_attempt` JSON for attempt N+1

If QA fails after all retries — commit and push anyway:

```bash
if git status --porcelain | grep -q .; then
  git add -A
  git commit --no-verify -m "<AI-generated message describing what was attempted>"
fi
git push origin "$FEATURE_BRANCH"
COMMIT_SHA=$(git rev-parse HEAD)
```

Then go to Step 8 with `qaStatus: "failed"`.

### Step 5: Commit

Only if QA passed or self-healed:

```bash
git add -A
if git status --porcelain | grep -q .; then
  git commit -m "<AI-generated descriptive message reflecting what was changed>"
else
  # Nothing to commit — output failure result and stop
```

If nothing to commit, output failure result and stop:

```
{"type":"result","prUrl":null,"commitSha":"","branchName":"<FEATURE_BRANCH>","qaStatus":"failed","qaRetryCount":0}
```

### Step 6: Push to GitHub

**OUTPUT THIS AS YOUR TEXT (before pushing):**

```
{"type":"progress","pct":90,"msg":"Pushing to GitHub"}
```

```bash
git push --force-with-lease origin "$FEATURE_BRANCH"
COMMIT_SHA=$(git rev-parse HEAD)
```

### Step 7: Open Pull Request (skip if qaStatus is "failed")

**OUTPUT THIS AS YOUR TEXT (before creating PR):**

```
{"type":"progress","pct":95,"msg":"Opening PR"}
```

```bash
DEFAULT_BRANCH=$(git remote show origin | grep "HEAD branch" | cut -d" " -f5)
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"

PR_URL=$(gh pr create \
  --title "<descriptive PR title>" \
  --body "<PR description summarizing what changed and why>" \
  --base "$DEFAULT_BRANCH" \
  --head "$FEATURE_BRANCH" 2>/dev/null) || \
PR_URL=$(gh pr view "$FEATURE_BRANCH" --json url --jq '.url' 2>/dev/null)
```

### Step 8: Emit Final Result Line

**OUTPUT THIS AS YOUR TEXT (100% progress):**

```
{"type":"progress","pct":100,"msg":"Done"}
```

**Then OUTPUT THIS AS YOUR TEXT — this MUST be the ABSOLUTE LAST thing you output:**

On success (QA passed or self_healed):

```
{"type":"result","prUrl":"<PR_URL>","commitSha":"<COMMIT_SHA>","branchName":"<FEATURE_BRANCH>","qaStatus":"passed","qaRetryCount":<N>}
```

On QA failure (all retries exhausted):

```
{"type":"result","prUrl":null,"commitSha":"<COMMIT_SHA>","branchName":"<FEATURE_BRANCH>","qaStatus":"failed","qaRetryCount":<QA_MAX_RETRIES>}
```

`qaStatus` values:

- `"passed"` — QA passed on first attempt (qaRetryCount = 0)
- `"self_healed"` — QA passed after retries (qaRetryCount ≥ 1)
- `"failed"` — All retries exhausted

**STOP. Do not output anything after the result JSON line.**
