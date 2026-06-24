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

**OHP-2.6 validation: PASSED (2026-06-25).** Epic OHP-2 (status-driven dispatcher + loop +
approval gate) is validated end-to-end. Independent validation ticket `86ey22p7b`; evidence report
`docs/openharness/runs/ohp-2.6-86ey22p7b.report.md` with retained per-leg stream logs
(`ohp-2.6-86ey22p7b.green-{implement,review,qa}.stream.json` for the green run; the Run-A
`{implement,review1,reimplement,review2,qa}` set captures a real rejection loop-back). The full
loop ran hands-off: `to do → ready for review → ready for qa → Closed`, with QA PASSED, plus a
genuine `changes_requested → re-implement → approved` loop-back in the prior pass.

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
