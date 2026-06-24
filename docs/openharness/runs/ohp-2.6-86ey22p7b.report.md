# OHP-2.6 Validation Report — 86ey22p7b

Status: **PASS — full status-driven loop validated end-to-end, including a real rejection loop-back and a clean green convergence.**

Validation ticket: https://app.clickup.com/t/86ey22p7b — `OHP-2.6 loop validation — docs marker (2026-06-25)`
Parent / OHP-2.6 story: https://app.clickup.com/t/86ey154gz
List: Dark Software Factory (`901813518753`), team `9018612026`.

> Independent throwaway ticket — **not** OHP-2.6 itself (per the AC1 / OHP-1.2 rule). The diff was intentionally trivial (a single docs marker file) so the **loop**, not the code, is under test. Stream logs are the retained proof.

## Runtime deviation (material — read first)

This run drives the loop through the **first-party Claude Code CLI (`claude`)**, not OpenHarness (`oh`). Forced by an external blocker, not a preference:

- `oh` is a **third-party app**. Using a Claude subscription through it returns `400 — "Third-party apps now draw from your extra usage, not your plan limits."` The account had no extra-usage balance.
- The Codex subscription (`oh`'s configured provider) was **usage-capped** (`API error: The usage limit has been reached`).
- An API key was explicitly out of scope.
- The official `claude` CLI **is** first-party and draws from the subscription's plan limits legitimately (verified with a `PONG` smoke).

A new agent-runtime selector lets the dispatcher spawn either runtime:

- `OPENHARNESS_RUNTIME=claude` → `scripts/claude-run-skill.sh` (this run); `oh` remains the default.
- `scripts/claude-run-skill.sh` mirrors `scripts/oh-run-skill.sh` (same prompt, MCP via `--mcp-config`, `--output-format stream-json`, secret-leak guard) and **unsets `ANTHROPIC_API_KEY`** so `claude` uses the subscription login, not the (invalid) key in `.env`.
- The stream parser learned Claude Code's `result` event shape (`{subtype, is_error, result}`).

Every leg below ran on `selected_model = sonnet` via the subscription — **zero extra-usage, zero API-key spend.**

## Environment

- Docker Postgres on `5433` (host `5432` was occupied), RabbitMQ on `5672`.
- Backend run locally (`pnpm start:dev`) against the Docker services; migrations + seed applied.
- ClickUp wired via a seeded `project_integrations` row (personal token, polling every minute, `ai_trigger_status = 'to do'`); project `sample-project` mapped to list `901813518753` via `clickup_list_id`.
- `STATUS_SKILL_MAP` overridden for this list's real statuses (it has **no** `in review`/`changes requested`/`approved`): `ready for review → clickup-code-review`, `rejected → clickup-dev-implement` (loop-back), `ready for qa → clickup-qa`.
- `OPENHARNESS_ISOLATE_WORKSPACE=true` — each leg runs in a per-run git worktree on a persistent per-ticket branch.

## The validation arc — two runs

The loop was driven twice. **Run A** surfaced the loop-back behaviour and a cross-leg persistence defect (Finding 3). After fixing it, **Run B** converged green.

### Run A — loop-back proven, blocked from green by Finding 3 (UTC)

| Time  | Execution  | Leg         | Outcome                                                         | ClickUp status       |
| ----- | ---------- | ----------- | --------------------------------------------------------------- | -------------------- |
| 20:00 | `325144d0` | implement   | created marker in worktree, committed locally (lost on cleanup) | → `ready for review` |
| 20:04 | `f4705aa1` | code-review | **CHANGES REQUESTED** — marker not persisted                    | → `rejected`         |
| 20:10 | `28180aec` | implement   | **loop-back**; re-created, commit `180d74e` (dangling)          | → `ready for review` |
| 20:14 | `0631acb9` | code-review | **APPROVED** — found `180d74e`, flagged it dangling             | → `ready for qa`     |
| 20:18 | `3bc24d32` | qa          | **FAILED** — `180d74e` unreachable (worktree gone)              | → `rejected`         |

Evidence: `ohp-2.6-86ey22p7b.{implement,review1,reimplement,review2,qa}.stream.json`

### Run B — green convergence (after Finding 3 fix) (UTC)

| Time  | Execution  | Leg         | Outcome                                                                           | ClickUp status          |
| ----- | ---------- | ----------- | --------------------------------------------------------------------------------- | ----------------------- |
| 20:40 | —          | (operator)  | moved to trigger                                                                  | `to do`                 |
| 20:41 | `89d83137` | implement   | commit `636e49c` on persistent branch `ohp/86ey22p7b`, **pushed to origin**       | → `ready for review`    |
| 20:45 | `9113aca4` | code-review | **APPROVED ✅** — diff visible on branch, all 3 adversarial layers, zero findings | → `ready for qa`        |
| 20:49 | `a2cfd6e1` | qa          | **PASSED ✅** — 4 pass / 0 fail, commit reachable                                 | → **Closed** (terminal) |

Evidence: `ohp-2.6-86ey22p7b.green-{implement,review,qa}.stream.json`
Branch pushed: `origin/ohp/86ey22p7b` @ `636e49c` (`feat(ohp-2.6): add loop validation marker file`).

## AC-by-AC

- **AC1 — implement → review hands-off, real diff + PR:** ✅ The trigger fired the dispatcher → `clickup-dev-implement` → real diff (marker file) committed to `ohp/86ey22p7b` and **pushed to origin** (a real, PR-able branch), then auto-advanced to review. No manual invocation.
- **AC2 — auto loop-back + idempotency:** ✅ Run A produced a genuine `changes_requested → re-implement → re-review → approved` cycle. Dispatch is idempotent — one run per status event (verified after the Finding 2 fix; the pre-fix attempt double-dispatched).
- **AC3 — approval gate blocks until recorded:** Not exercised by choice — `FEATURE_AUTO_APPROVE_AFTER_QA=true`, so QA-pass auto-advanced to terminal without the manual gate. The gate code path (`ApprovalGateService.openGate` / `recordDecision`) is unit-tested separately; this run deliberately validated the hands-off loop, not the manual hold.
- **AC4 — documented passing run + full trail:** ✅ This report + retained per-leg stream logs for both runs. Run B reached a green terminal (`to do → ready for review → ready for qa → Closed`, QA PASSED).

## Findings (the validation did its job)

The loop surfaced three real dispatch/loop defects. **All three are now fixed**, with tests.

### Finding 1 — No workspace isolation (FIXED)

`openharness.workspaceDir` defaulted to `process.cwd()` — agents ran **in the live repo on `main`**, and concurrent runs collided there. **Fix:** `OpenHarnessRunnerService` provisions a per-run git worktree (`OPENHARNESS_ISOLATE_WORKSPACE`), used as the child cwd and torn down on every terminal path. Verified: across all legs of Run B the live working tree was never mutated.

### Finding 2 — Double-dispatch / idempotency gap (FIXED)

One status event produced two concurrent executions. Two stacked causes: (a) `ClickUpProvider.getUpdatedTasks` didn't dedupe by `task.id` (ClickUp returned the task 3× with `subtasks:true`); (b) the dispatcher's active-execution check was a non-atomic check-then-create. **Fix:** dedupe by `task.id` in the provider + an in-process per-ticket dispatch lock in `DispatcherService`. New unit tests cover both.

### Finding 3 — Cross-leg diff persistence (FIXED)

With per-run isolation (Finding 1's fix), a detached worktree discarded each leg's commit, so review/QA started from a clean HEAD and couldn't see the implement diff (Run A: review then QA failed on the missing-but-approved diff). **Fix:** the runner provisions worktrees on a **persistent per-ticket branch** (`ohp/<taskId>`) — created from HEAD on the first leg, reused by every later leg — so a prior leg's commit is visible to the next. `node_modules` is symlinked into the worktree so legs can run tests/typecheck. Run B confirms: implement committed to `ohp/86ey22p7b`, review and QA checked out the same branch, saw the diff, and passed.

## Fixes made (code, with tests)

- `scripts/claude-run-skill.sh` (new) — first-party Claude runtime wrapper.
- `OpenHarnessRunnerService` — runtime selector (`oh`/`claude`); per-run worktree isolation on a persistent per-ticket branch; model recorded per runtime.
- `openharness-stream.parser.ts` — parse Claude Code `result` events.
- `ClickUpProvider.getUpdatedTasks` — dedupe by `task.id`.
- `DispatcherService` — in-process per-ticket dispatch lock (idempotency).
- `configuration.ts` — `openharness.runtime`, `claudeModel`, `isolateWorkspace`.
- Tests added/updated: parser (Claude result shapes), dispatcher (concurrent-dispatch), provider (dedupe). `pnpm run typecheck` clean; affected suites green.

## Notes / residual

- **AC3** (manual approval hold) was intentionally not exercised; auto-approve was left on to validate the hands-off loop. A follow-up could disable auto-approve and drive the gate via `POST /executions/:id/gate-decision` for explicit AC3 evidence.
- The throwaway validation branch `ohp/86ey22p7b` (marker file only) is evidence-bearing; per the OHP-1.2 retention rule, stream logs are retained and the throwaway diff/branch can be deleted once this report is accepted.
- Loop-cap (`LOOP_MAX_ITERATIONS=5`) held throughout; no runaway dispatch.
