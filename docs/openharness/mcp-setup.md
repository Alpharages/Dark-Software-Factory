# OpenHarness MCP Setup

This repo keeps the OpenHarness MCP wiring in `openharness/mcp-config.json`.
It defines two MCP servers:

- `bmad` connects to the HTTP MCP endpoint exposed by `bmad-mcp-server-http` with ClickUp
  write mode enabled through per-user headers.
- `lore` connects to the HTTP MCP endpoint exposed by the Lore server configured by
  `@alpharages/lore`.

## Prerequisites

Install OpenHarness and select the Codex subscription profile:

```bash
pipx install openharness-ai
oh auth codex-login
oh provider use codex
oh --version
```

The spike validated `openharness 0.1.9`.

## Environment

Set these values in your shell or local `.env` loader before running the smoke script:

```bash
export CLICKUP_API_KEY="pk_..."
export CLICKUP_TEAM_ID="9018612026"
export BMAD_SERVER_URL="https://your-bmad-server.example.com"
export BMAD_API_KEY="your-bmad-http-key"
export LORE_SLUG="dark-software-factory"
export LORE_SERVER_URL="https://your-lore-server.example.com"
export LORE_API_KEY="lore_..."
```

No secrets belong in `openharness/mcp-config.json`. The checked-in file uses placeholders
only. `scripts/oh-mcp-smoke.sh` materializes those placeholders into a temporary
OpenHarness config directory at runtime.

## Dry Run

OpenHarness 0.1.9 declares `--mcp-config`, but the installed 0.1.9 CLI does not pass that
option into dry-run or print-mode execution. The smoke script still attempts the direct
command first:

```bash
oh --dry-run --mcp-config openharness/mcp-config.json -p "List configured MCP servers."
```

If that output does not list both servers, the script falls back to an isolated config:

```bash
export OPENHARNESS_CONFIG_DIR="$(mktemp -d)"
oh mcp add bmad '<materialized bmad JSON>'
oh mcp add lore '<materialized lore JSON>'
oh --dry-run -p "List configured MCP servers."
```

The fallback keeps the smoke test reproducible without mutating `~/.openharness/settings.json`.

## Smoke Test

Run:

```bash
scripts/oh-mcp-smoke.sh
```

The script checks:

1. `openharness/mcp-config.json` has `mcpServers.bmad` and `mcpServers.lore`.
2. Required environment variables are present and not hardcoded in the config.
3. OpenHarness dry-run sees both MCP servers in an isolated config.
4. A live BMAD read-only call reaches `bmad({ operation: "list", query: "workflows" })`.
5. A live Lore read-only call reaches `search_similar`.

For CI or offline validation that should not start MCP servers or call a model, run:

```bash
OH_MCP_SMOKE_LIVE=0 scripts/oh-mcp-smoke.sh
```

## Troubleshooting

- Missing `oh`: install with `pipx install openharness-ai`.
- Missing env var: the script exits with the exact variable name.
- `--mcp-config` dry-run shows zero servers on OpenHarness 0.1.9: use the smoke script
  fallback; this is expected for the installed 0.1.9 build.
- BMAD connection failures: run `bmad-mcp-server-http` behind a reachable URL, ensure
  `BMAD_SERVER_URL` points at the base server URL, set `BMAD_API_KEY` to the HTTP
  transport key, and keep `CLICKUP_API_KEY` / `CLICKUP_TEAM_ID` available for the
  `X-ClickUp-*` headers.
- Lore connection failures: install/configure Lore with `npm install -g @alpharages/lore`,
  ensure `LORE_SERVER_URL` points at the base server URL from `lore.yaml` (`mcp.server`), and
  set `LORE_API_KEY` to the project key printed by `lore init`.
- BMAD must receive `X-ClickUp-Mode: write`; downstream `clickup-dev-implement` requires
  write mode for comments and status transitions.
