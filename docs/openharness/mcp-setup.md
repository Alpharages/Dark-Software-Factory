# OpenHarness MCP Setup

This repo keeps the OpenHarness MCP wiring in `openharness/mcp-config.json`.
It defines three MCP servers:

- `bmad` connects to the HTTP MCP endpoint exposed by `bmad-mcp-server-http` with ClickUp
  write mode enabled through per-user headers.
- `lore` connects to the HTTP MCP endpoint exposed by the Lore server configured by
  `@alpharages/lore`.
- `gitnexus` connects to the HTTP MCP endpoint for repo-mandated code intelligence.

## Prerequisites

Install OpenHarness and select the Codex subscription profile:

```bash
pipx install "openharness-ai==0.1.9"
oh auth codex-login
oh provider use codex
oh --version
```

The spike validated `openharness 0.1.9`. The version is **pinned** because this build's
`--mcp-config` behavior (see "Dry Run" below) is version-specific; when bumping OpenHarness,
re-run `scripts/oh-mcp-smoke.sh` and re-check whether the direct `--mcp-config` dry-run path
starts listing both servers (which would let it satisfy AC1 directly instead of via the
fallback).

## Environment

Set these values in your shell or local `.env` loader before running the smoke script:

```bash
export CLICKUP_API_KEY="pk_..."
export CLICKUP_TEAM_ID="9018612026"
export BMAD_SERVER_URL="https://your-bmad-server.example.com"
export BMAD_API_KEY="your-bmad-http-key"
export LORE_SERVER_URL="https://your-lore-server.example.com"
export LORE_API_KEY="lore_..."
export GITNEXUS_SERVER_URL="https://your-gitnexus-server.example.com"
export GITNEXUS_API_KEY="your-gitnexus-http-key"
export OPENHARNESS_RUN_TIMEOUT_MS=1800000
export OPENHARNESS_MANDATED_MCP_SERVERS="gitnexus"
export OPENHARNESS_MANDATED_TOOLS_MODE="warn"
export OPENHARNESS_FORMAT_ENABLED=true
export OPENHARNESS_FORMAT_COMMAND="pnpm exec prettier --write"
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

If that output does not list both servers, the script falls back to `oh mcp add`. The fallback
behaves differently per mode:

- **Offline (`OH_MCP_SMOKE_LIVE=0`)** — registers the servers in an **isolated**
  `OPENHARNESS_CONFIG_DIR` and runs the dry-run there. No provider auth and no mutation of
  `~/.openharness/settings.json`. Ideal for CI.
- **Live (`OH_MCP_SMOKE_LIVE=1`)** — registers the servers in the **default** config dir, runs
  the dry-run and the live calls, then **restores `settings.json`** (snapshot + trap) on exit.
  The default dir is required because the provider credentials the live `oh -p` calls need
  (e.g. the Codex subscription token) are only visible there — an isolated `OPENHARNESS_CONFIG_DIR`
  cannot see that auth and the run fails with `No API key configured` or a misleading
  `Network error: Connection error`.

```bash
# what the offline fallback does, conceptually:
export OPENHARNESS_CONFIG_DIR="$(mktemp -d)"
oh mcp add bmad '<materialized bmad JSON>'
oh mcp add lore '<materialized lore JSON>'
oh --dry-run -p "List configured MCP servers."
```

## Model & provider

OpenHarness print-mode (`oh -p`) defaults to a **Claude model alias**, which the Codex/ChatGPT
subscription provider cannot run. The smoke script therefore pins the model via
`OH_MCP_SMOKE_MODEL` (default `gpt-5.4`) on the live calls. The model must match the **active
provider** in your default config dir:

- On the Codex subscription (`oh provider use codex`), keep the default `gpt-5.4`.
- On a Claude profile (`oh provider use claude-api`), set `OH_MCP_SMOKE_MODEL=sonnet` (or another
  Anthropic alias).

A model that does not match the active provider (e.g. `gpt-5.4` sent to an Anthropic profile)
surfaces as `Network error: Connection error` — confirm `oh provider list` shows the expected
active profile before running the live smoke.

> **AC1 status:** On the pinned 0.1.9 build, AC1 ("`oh --dry-run` lists both `bmad` and `lore`")
> is satisfied through the **fallback** path (isolated `OPENHARNESS_CONFIG_DIR` + `oh mcp add` +
> `oh --dry-run`), not the direct `--mcp-config` invocation. The isolated dry-run reports
> `configured mcp servers: 2` and lists both servers — verified offline with placeholder env via
> `OH_MCP_SMOKE_LIVE=0 scripts/oh-mcp-smoke.sh` (no live servers or model calls needed for this
> check). If a future OpenHarness version wires `--mcp-config` into dry-run, the direct path will
> begin satisfying AC1 and the fallback becomes redundant but harmless.

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

### Capturing acceptance evidence (AC1–AC3)

AC2 and AC3 require the live BMAD list op and Lore query to actually reach their servers, so
they can only be closed on a machine with real credentials. To capture sign-off evidence:

```bash
export BMAD_SERVER_URL="https://<real-bmad-host>"
export BMAD_API_KEY="<real-bmad-http-key>"
export CLICKUP_API_KEY="pk_<real>"
export CLICKUP_TEAM_ID="9018612026"
export LORE_SERVER_URL="https://<real-lore-host>"
export LORE_API_KEY="lore_<real>"

oh provider use codex             # ensure the active provider matches OH_MCP_SMOKE_MODEL
scripts/oh-mcp-smoke.sh           # LIVE defaults on; OH_MCP_SMOKE_LIVE=1
```

Paste into the ClickUp ticket: the `Dry-run lists bmad and lore.` line (AC1 via fallback), plus
`BMAD MCP smoke passed.` / `LORE MCP smoke passed.` (AC2/AC3). A successful run ends with
`OpenHarness MCP smoke complete.` The live run temporarily registers the two servers in your
default OpenHarness config and restores `settings.json` on exit.

Verified on `openharness 0.1.9` + Codex subscription (`gpt-5.4`) on 2026-06-19: all three lines
emitted and `settings.json` restored clean.

## Driving a skill on a real ticket

Use the thin wrapper below to run `clickup-dev-implement` headlessly against a real ClickUp task
while keeping the MCP registration/cleanup and stream-log capture consistent:

```bash
scripts/oh-run-skill.sh <CLICKUP_TASK_ID>
```

Behavior:

- materializes `openharness/mcp-config.json` with the current shell env,
- registers `bmad` and `lore` for the duration of the run,
- executes `oh -p` with `--output-format stream-json`, `--permission-mode full_auto`, and the
  task-scoped prompt used by OHP-1.2,
- writes the log to `docs/openharness/runs/ohp-1.2-<TASK_ID>.stream.json` by default,
- refuses to persist the log if any required secret literal appears in the stream.

This is still a CLI spike helper, not the OHP-1.3 production runner.

## Local MVP HTTP trigger

Start local infrastructure and the NestJS backend with one command:

```bash
pnpm start:mvp
```

`start:mvp` runs `docker compose up -d --wait` (waits for the Postgres healthcheck so the DB is
actually accepting connections), applies pending migrations with `pnpm db:migrate:deploy`, then
launches the backend with `pnpm start:dev`. No hidden manual migrate/seed step is required.

The backend exposes the guarded local MVP endpoint at `POST /api/v1/executions/test`. It reuses
the standard JWT/RBAC posture from `ExecutionController`: callers need a valid JWT with `PM`,
`TL`, or `ADMIN`.

Defaults come from validated env/config:

```bash
OPENHARNESS_BINARY_PATH=oh
OPENHARNESS_MODEL=gpt-5.4
OPENHARNESS_DEFAULT_SKILL=clickup-dev-implement
OPENHARNESS_WORKSPACE_DIR=/Volumes/Data/project/products/alpharages/dsf-backend
OPENHARNESS_MAX_TURNS=200
OPENHARNESS_RUN_TIMEOUT_MS=1800000
OPENHARNESS_MANDATED_MCP_SERVERS=gitnexus
OPENHARNESS_MANDATED_TOOLS_MODE=warn
OPENHARNESS_FORMAT_ENABLED=true
OPENHARNESS_FORMAT_COMMAND="pnpm exec prettier --write"
OPENHARNESS_MCP_CONFIG_PATH=./openharness/mcp-config.json
```

Minimal request:

```bash
curl -X POST http://localhost:3000/api/v1/executions/test \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"ticketId":"86ey08c75"}'
```

Override the run profile when needed:

```bash
curl -X POST http://localhost:3000/api/v1/executions/test \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "ticketId": "86ey08c75",
    "skill": "clickup-dev-implement",
    "workspaceDir": "/Volumes/Data/project/products/alpharages/dsf-backend",
    "maxTurns": 200,
    "mcpConfigPath": "./docs/openharness/mcp-config.json"
  }'
```

The endpoint blocks until the run reaches a terminal state, then returns the persisted execution
id, terminal status/summary, changed files, a polling URL, and a Socket.IO stream hint. The HTTP
status mirrors the terminal execution status (AC5): `200` when the run completes, `504` when the
run hits its wall-clock budget (`TIMEOUT`), and `5xx` when the run fails (`FAILED`/`CANCELLED`) or
the runner errors before producing an execution id. In every case the response body still carries
the persisted execution, so a failure is never a silent `2xx` or a dangling request.

Live activity is emitted through the existing Socket.IO execution namespace: connect to
`/execution`, send `subscribe-to-execution-logs` with the returned execution id, and listen for
`execution-activity` / `execution-log` while the runner processes OpenHarness stream events.

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
- `Network error: Connection error` on the live calls (MCP servers are reachable): the pinned
  model does not match the active provider, or the provider is unauthenticated. Run
  `oh provider list`, confirm the active profile, and set `OH_MCP_SMOKE_MODEL` to a model that
  profile supports (`gpt-5.4` for Codex, `sonnet` for a Claude profile).
- `No API key configured` on the live calls: you are running with an isolated
  `OPENHARNESS_CONFIG_DIR` that cannot see the subscription auth. The live path deliberately uses
  the default config dir; do not export `OPENHARNESS_CONFIG_DIR` when running the live smoke.
