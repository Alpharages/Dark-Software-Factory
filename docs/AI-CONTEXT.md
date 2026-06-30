# AI Context

## OpenHarness Pivot

DSF is pivoting away from bespoke AI execution runtime code toward a thin control shell over
OpenHarness, BMAD skills, and Lore memory. The current single-tenant integration point is:

- `openharness/mcp-config.json` for BMAD and Lore HTTP MCP server definitions.
- `scripts/oh-mcp-smoke.sh` for local dry-run and read-only MCP reachability checks.
- `docs/openharness/mcp-setup.md` for setup and troubleshooting.
- `scripts/oh-run-skill.sh` for the OHP-1.2 headless real-ticket wrapper.
- `docs/openharness/runs/ohp-1.2-86ewke7gg.stream.json` and
  `docs/openharness/runs/ohp-1.2-report.md` for the captured OHP-1.2 evidence run. The validation
  was run against an independent low-risk ticket (`86ewke7gg`), not OHP-1.2 itself — the earlier
  self-referential run was discarded.

For OHP-1.1/OHP-1.2, do not touch NestJS `src/` execution, `ai-routing/`, RabbitMQ, or
dispatcher code. The work here is docs/scripts/evidence only (the validation ticket's `src/` diff
was reverted, never committed). OAuth/per-tenant credential injection is deferred to OHP-4; this
phase uses one ClickUp token, one ClickUp team, and one Lore project key. The successful OHP-1.2
`gpt-5.4` run used `scripts/oh-run-skill.sh` because direct `oh --mcp-config` was unreliable on
OpenHarness `0.1.9`; keep using the wrapper until that CLI path is upgraded and revalidated. Note:
Lore lesson-saving is **AI-discretionary** — the skill saves a lesson only when a run yields
genuinely reusable signal, not on every run. The OHP-1.2 validation change (a trivial one-line log)
had none, so zero Lore writes is the correct outcome, not a gap; AC3 ("lessons saved to Lore")
means saved-when-warranted.

**Epic OHP-1 closed (✅ Done, QA-verified 2026-06-25).** All five stories (MCP wiring, headless
skill run, per-ticket runner, stream→realtime adapter, local MVP `POST /api/v1/executions/test`)
are implemented and exercised end-to-end by the OHP-2 dispatcher loop. QA gate green: typecheck,
lint, `nest build`, full Jest suite (170 suites / 1726 tests). ClickUp epic `86ey07087` (+ all 5
subtasks) Closed; durable record is the OHP-1 Outcome block in `docs/epics.md`.

**OHP-2.6 validation: PASSED (2026-06-25). Epic OHP-2 closed (✅ Done).** Epic OHP-2
(status-driven dispatcher + loop + approval gate) is validated end-to-end on independent throwaway
ticket `86ey22p7b`. The full loop ran hands-off: `to do → ready for review → ready for qa →
Closed`, with QA PASSED, plus a genuine `changes_requested → re-implement → approved` loop-back in
the prior pass (Run A). The per-leg `oh`/Claude stream logs and report were **not** retained in-repo
(intentionally removed, like the OHP-1.2 artifacts); the durable record is the live ClickUp trail on
`86ey22p7b` plus the OHP-2 Outcome block in `docs/epics.md`. _Residual:_ AC3's manual approval hold
was not exercised in the live run (auto-approve was on) — the gate logic is covered by unit tests
(`approval-gate.service.spec.ts`, `approval-gate.controller.spec.ts`).

Two things future agents must know:

1. **Agent-runtime selector (`OPENHARNESS_RUNTIME`).** `oh` is the default, but it is a _third-party_
   app and CANNOT use a Claude subscription on plan limits (Anthropic routes third-party apps to
   "extra usage"; with none on the account every request 400s). For subscription-backed runs use
   `OPENHARNESS_RUNTIME=claude`, which spawns `scripts/claude-run-skill.sh` (first-party Claude Code
   CLI, plan limits). That wrapper unsets `ANTHROPIC_API_KEY` so `claude` uses the subscription login,
   not the `.env` key. The stream parser handles both `oh` and Claude `result` event shapes.

2. **Workspace isolation + persistent per-ticket branch (`OPENHARNESS_ISOLATE_WORKSPACE`).** When on,
   each leg runs in a per-run git worktree on a persistent branch `ohp/<taskId>` — never the live
   working tree, and the branch survives across legs so review/QA see the implement diff. Leave it on
   for any real run; running in-place on `main` is the old unsafe behaviour OHP-2.6 fixed.

OHP-2.6 fixed three dispatch-path defects (all with tests): no workspace isolation, double-dispatch
(provider didn't dedupe by task id + non-atomic dispatch guard), and cross-leg diff loss. The
earlier `86ey21q2a` attempt (`ohp-2.6-86ey21q2a.report.md`) is superseded — it was blocked on the
`oh`/Codex network/usage path, not DSF code.

## Removed env var: `ANTHROPIC_API_KEY` (QA F8, 2026-06-26) — do NOT re-add

DSF has **zero pay-per-token Anthropic usage**. `ANTHROPIC_API_KEY` (and the `@anthropic-ai/sdk`
dependency) were removed. The three former direct-API consumers — PM field auto-fill
(`integrations/pm-field-auto-fill.service.ts`), PR title/body generation
(`github/services/github-pr-orchestrator.service.ts`), and file-conflict prediction
(`file-locks/file-prediction.provider.ts`) — now go through `SubscriptionCompletionService`
(`common/ai/subscription-completion.service.ts`), a one-shot `claude -p … --output-format json
--max-turns 1` helper that runs on the **Claude subscription** (CLI auth, plan limits), the same
zero-marginal-cost path as the agent runtime. It unsets `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`
for the child. Consumers gate on `subscription.isAvailable()` and fail open to their existing
heuristic/fallback behaviour. Config moved from `anthropic.apiKey`/`model`/`maxTokens` to
`anthropic.subscriptionModel`/`subscriptionCliPath`/`subscriptionTimeoutMs`. If a new feature needs
an LLM call, use `SubscriptionCompletionService` — never `new Anthropic()` / an API key.

## GitHub auth is DB-token-only; `GITHUB_TOKEN` is an optional legacy fallback (2026-06-30)

GitHub authentication is sourced from the **linked `GitHubAccount` row in the DB** (per project via
`project.github_account_id` → OAuth `access_token` + `installationId`), not a global PAT. The app
boots and runs with **no `GITHUB_TOKEN` set**; the env var is now an optional, blank-allowed legacy
fallback in `env.validation.ts` (was `.required()` — it is no longer). Do NOT re-add the `.required()`
rule, and do NOT introduce new GitHub calls that depend on a global PAT.

Two token mechanisms, both DB-sourced — use the right one:

- **git clone/fetch/push** (`git` over HTTPS): build an authenticated URL via
  `GitHubTokenResolverService.resolveForProject(projectId, url)` (decrypts the account token into
  `https://x-access-token:<token>@…`). This is what `GitHubBranchPushService` uses; it never relies on
  the local machine's `gh`/SSH credential helper, so it works on a live server.
- **GitHub REST API** (`Octokit`, i.e. PR create/merge/comment): pass the project's `installationId`
  to the `GitHubService` method. `GitHubAuthService.getAuthenticatedClient(installationId)` looks the
  account up by `installationId` and uses its DB token. Resolve it from
  `execution → ticket → project → gitHubAccount.installationId` (see
  `github-pr-orchestrator.service.ts`, `approval-gate.service.ts`, `pr-auto-merge.service.ts`,
  `pr-reminder.service.ts`). **Pitfall fixed 2026-06-30:** `pr-auto-merge` and `pr-reminder` were
  passing `executionId` into the `installationId` parameter, so Octokit silently fell back to the
  global PAT — which would have broken the instant `GITHUB_TOKEN` was removed. Always pass a real
  `installationId`, never the executionId/correlationId.

Note: the agent's OWN `git push` inside the bmad skill is a separate concern — its worktree `origin`
has the token stripped (`project-workspace.service.ts`), so on a server with no `gh`/SSH it cannot
push. DSF's `GitHubBranchPushService` is the authoritative pusher and covers delivery regardless; the
only residual risk is a bmad skill that treats its own push failure as fatal.
