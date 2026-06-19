#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH="${1:-openharness/mcp-config.json}"
MAX_TURNS="${OH_MCP_SMOKE_MAX_TURNS:-20}"
LIVE_SMOKE="${OH_MCP_SMOKE_LIVE:-1}"

required_commands=(node oh)
required_env=(BMAD_SERVER_URL BMAD_API_KEY CLICKUP_API_KEY CLICKUP_TEAM_ID LORE_SERVER_URL LORE_API_KEY)

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

note() {
  printf '%s\n' "$*"
}

for command_name in "${required_commands[@]}"; do
  command -v "$command_name" >/dev/null 2>&1 || fail "missing command '$command_name'. Install OpenHarness with: pipx install openharness-ai"
done

[[ -f "$CONFIG_PATH" ]] || fail "MCP config not found: $CONFIG_PATH"

for env_name in "${required_env[@]}"; do
  [[ -n "${!env_name:-}" ]] || fail "missing required environment variable: $env_name"
done

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

node - "$CONFIG_PATH" "${required_env[*]}" <<'NODE'
const fs = require("node:fs");

const [configPath, requiredEnvRaw] = process.argv.slice(2);
const requiredEnv = requiredEnvRaw.split(/\s+/).filter(Boolean);
const raw = fs.readFileSync(configPath, "utf8");
const config = JSON.parse(raw);

if (!config.mcpServers || typeof config.mcpServers !== "object") {
  throw new Error("config must contain a top-level mcpServers object");
}

for (const name of ["bmad", "lore"]) {
  const server = config.mcpServers[name];
  if (!server) throw new Error(`missing mcpServers.${name}`);
  if (server.type !== "http") throw new Error(`mcpServers.${name}.type must be http`);
  if (!server.url) throw new Error(`mcpServers.${name}.url is required`);
  if (!server.headers?.Authorization) throw new Error(`mcpServers.${name}.headers.Authorization is required`);
}

const bmad = config.mcpServers.bmad;
if (!bmad.headers["X-ClickUp-API-Key"]) throw new Error("mcpServers.bmad.headers.X-ClickUp-API-Key is required");
if (!bmad.headers["X-ClickUp-Team-ID"]) throw new Error("mcpServers.bmad.headers.X-ClickUp-Team-ID is required");
if (!bmad.headers["X-ClickUp-Mode"]) throw new Error("mcpServers.bmad.headers.X-ClickUp-Mode is required");

const serialized = JSON.stringify(config);
for (const envName of requiredEnv) {
  const secret = process.env[envName];
  if (secret && serialized.includes(secret)) {
    throw new Error(`config contains the literal value of ${envName}; use a placeholder instead`);
  }
}
NODE

note "Validated $CONFIG_PATH schema and secret placeholders."

set +e
MCP_CONFIG_DRY_RUN_OUTPUT="$(oh --dry-run --mcp-config "$CONFIG_PATH" -p "List configured MCP servers." 2>&1)"
MCP_CONFIG_DRY_RUN_STATUS=$?
set -e
printf '%s\n' "$MCP_CONFIG_DRY_RUN_OUTPUT" >"$TMP_DIR/dry-run-mcp-config.txt"

if [[ $MCP_CONFIG_DRY_RUN_STATUS -eq 0 ]] \
  && grep -qi "configured mcp servers: 2" "$TMP_DIR/dry-run-mcp-config.txt" \
  && grep -qi "bmad" "$TMP_DIR/dry-run-mcp-config.txt" \
  && grep -qi "lore" "$TMP_DIR/dry-run-mcp-config.txt"; then
  note "OpenHarness --mcp-config dry-run lists bmad and lore."
else
  note "OpenHarness --mcp-config did not list bmad and lore in this installed build."
  note "Falling back to an isolated OPENHARNESS_CONFIG_DIR and oh mcp add for smoke validation."
fi

node - "$CONFIG_PATH" "$TMP_DIR/bmad.json" "$TMP_DIR/lore.json" <<'NODE'
const fs = require("node:fs");

const [configPath, bmadPath, lorePath] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

function materialize(value) {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_placeholder, envName) => {
      const envValue = process.env[envName];
      if (!envValue) throw new Error(`missing required environment variable: ${envName}`);
      return envValue;
    });
  }
  if (Array.isArray(value)) return value.map(materialize);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      const materialized = materialize(nested);
      if (materialized !== undefined) out[key] = materialized;
    }
    return out;
  }
  return value;
}

fs.writeFileSync(bmadPath, JSON.stringify(materialize(config.mcpServers.bmad)));
fs.writeFileSync(lorePath, JSON.stringify(materialize(config.mcpServers.lore)));
NODE

export OPENHARNESS_CONFIG_DIR="$TMP_DIR/openharness-config"
export OPENHARNESS_DATA_DIR="$TMP_DIR/openharness-data"
export OPENHARNESS_LOGS_DIR="$TMP_DIR/openharness-logs"

set +e
BMAD_ADD_OUTPUT="$(oh mcp add bmad "$(cat "$TMP_DIR/bmad.json")" 2>&1)"
BMAD_ADD_STATUS=$?
LORE_ADD_OUTPUT="$(oh mcp add lore "$(cat "$TMP_DIR/lore.json")" 2>&1)"
LORE_ADD_STATUS=$?
set -e
[[ $BMAD_ADD_STATUS -eq 0 ]] || fail "failed to register bmad MCP server\n$BMAD_ADD_OUTPUT"
[[ $LORE_ADD_STATUS -eq 0 ]] || fail "failed to register lore MCP server\n$LORE_ADD_OUTPUT"

ISOLATED_DRY_RUN_OUTPUT="$(oh --dry-run -p "List configured MCP servers." 2>&1)"
printf '%s\n' "$ISOLATED_DRY_RUN_OUTPUT" >"$TMP_DIR/dry-run-isolated.txt"

grep -qi "configured mcp servers: 2" "$TMP_DIR/dry-run-isolated.txt" || fail "dry-run did not report two configured MCP servers"
grep -qi "bmad" "$TMP_DIR/dry-run-isolated.txt" || fail "dry-run did not list bmad"
grep -qi "lore" "$TMP_DIR/dry-run-isolated.txt" || fail "dry-run did not list lore"
note "Isolated dry-run lists bmad and lore."

if [[ "$LIVE_SMOKE" == "0" ]]; then
  note "Skipping live MCP calls because OH_MCP_SMOKE_LIVE=0."
  exit 0
fi

BMAD_PROMPT='Call the MCP tool mcp__bmad__bmad with {"operation":"list","query":"workflows"}. If the tool returns without an error, reply exactly BMAD_SMOKE_OK and nothing else.'
LORE_PROMPT='Call the MCP tool mcp__lore__search_similar with {"text":"openharness smoke test","limit":1}. If the tool returns without an error, reply exactly LORE_SMOKE_OK and nothing else.'

set +e
BMAD_OUTPUT="$(oh -p "$BMAD_PROMPT" --allowed-tools mcp__bmad__bmad --permission-mode full_auto --max-turns "$MAX_TURNS" 2>&1)"
BMAD_STATUS=$?
set -e
printf '%s\n' "$BMAD_OUTPUT" >"$TMP_DIR/bmad-smoke.txt"
[[ $BMAD_STATUS -eq 0 ]] || fail "bmad smoke failed; see output below\n$BMAD_OUTPUT"
grep -q "BMAD_SMOKE_OK" "$TMP_DIR/bmad-smoke.txt" || fail "bmad smoke did not confirm success; see output below\n$BMAD_OUTPUT"
note "BMAD MCP smoke passed."

set +e
LORE_OUTPUT="$(oh -p "$LORE_PROMPT" --allowed-tools mcp__lore__search_similar --permission-mode full_auto --max-turns "$MAX_TURNS" 2>&1)"
LORE_STATUS=$?
set -e
printf '%s\n' "$LORE_OUTPUT" >"$TMP_DIR/lore-smoke.txt"
[[ $LORE_STATUS -eq 0 ]] || fail "lore smoke failed; see output below\n$LORE_OUTPUT"
grep -q "LORE_SMOKE_OK" "$TMP_DIR/lore-smoke.txt" || fail "lore smoke did not confirm success; see output below\n$LORE_OUTPUT"
note "Lore MCP smoke passed."

note "OpenHarness MCP smoke complete."
