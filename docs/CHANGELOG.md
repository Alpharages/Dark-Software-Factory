# Changelog

## 2026-06-19

- Added OpenHarness MCP wiring for the OHP-1 single-tenant spike in
  `openharness/mcp-config.json`.
- Added `scripts/oh-mcp-smoke.sh` to validate BMAD and Lore MCP visibility and read-only
  smoke calls from OpenHarness.
- Documented OpenHarness MCP setup and the OpenHarness 0.1.9 `--mcp-config` limitation in
  `docs/openharness/mcp-setup.md`.
- Updated Lore wiring to match the `@alpharages/lore` package: HTTP MCP endpoint plus
  `LORE_API_KEY` bearer auth.
- Updated BMAD wiring to use the `bmad-mcp-server` HTTP transport (`/mcp`) with
  `BMAD_API_KEY` bearer auth and per-run `X-ClickUp-*` headers.
- Code-review follow-up (OHP-1.1): pinned the install to `openharness-ai==0.1.9` and
  documented that AC1 is satisfied via the isolated `oh mcp add` fallback (the 0.1.9
  `--mcp-config` flag is not wired into dry-run). Verified offline that `oh mcp add` accepts
  the `{type:"http",…}` config shape and the isolated dry-run reports two configured servers.
- Code-review follow-up (OHP-1.1): removed the unused `LORE_SLUG` env var from `.env.example`
  and the runbook (Lore is wired via `LORE_SERVER_URL` + `LORE_API_KEY`; the slug was never
  consumed). Added a "Capturing acceptance evidence (AC1–AC3)" runbook section for the
  credentialed live smoke run.
- Live-smoke fixes (OHP-1.1, AC2/AC3 now passing): pinned the smoke model via
  `OH_MCP_SMOKE_MODEL` (default `gpt-5.4`) because `oh -p` otherwise defaults to a Claude alias
  the Codex provider cannot run; and reworked the live path to register the MCP servers in the
  **default** OpenHarness config dir (with `settings.json` snapshot + restore) instead of an
  isolated dir, because the Codex subscription auth is only visible in the default dir. Offline
  mode (`OH_MCP_SMOKE_LIVE=0`) still uses an isolated dir with no auth and no mutation.
- Verified live on `openharness 0.1.9` + Codex subscription (2026-06-19): AC1 (dry-run lists both
  servers via fallback), AC2 (`BMAD MCP smoke passed.`), AC3 (`LORE MCP smoke passed.`).
- Added `scripts/oh-run-skill.sh` as the thin OHP-1.2 headless wrapper for driving
  `clickup-dev-implement`, capturing `stream-json`, and restoring OpenHarness MCP settings.
- Captured the first OHP-1.2 real-ticket evidence run in
  `docs/openharness/runs/ohp-1.2-86ey07n48.stream.json` plus
  `docs/openharness/runs/ohp-1.2-report.md`. Direct `oh --mcp-config` attempts were unreliable on
  OpenHarness `0.1.9`, but the wrapper-driven `gpt-5.4` run successfully invoked
  `bmad({operation:"execute", workflow:"clickup-dev-implement"})`, posted completion evidence,
  moved the task to the list-valid review status, and saved a Lore lesson.
