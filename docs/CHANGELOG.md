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
