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
