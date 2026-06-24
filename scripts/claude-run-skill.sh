#!/usr/bin/env bash
set -euo pipefail

# First-party Claude Code runtime for DSF agent legs.
#
# Mirrors scripts/oh-run-skill.sh but drives the official `claude` CLI instead of
# `oh`. Used when the configured agent runtime is `claude` (OPENHARNESS_RUNTIME=claude).
# The Claude subscription is the first-party Anthropic client and draws from plan
# limits legitimately, whereas `oh` (a third-party app) is routed to extra usage.
# See docs/openharness/runs/ohp-2.6-*.report.md for the runtime-deviation rationale.

TASK_ID="${1:-}"
OUTPUT_PATH="${2:-}"
WORKFLOW="${OH_RUN_WORKFLOW:-clickup-dev-implement}"
CONFIG_PATH="${OH_RUN_MCP_CONFIG:-openharness/mcp-config.json}"
MODEL="${CLAUDE_RUN_MODEL:-sonnet}"
MAX_TURNS="${OH_RUN_MAX_TURNS:-200}"

required_commands=(node claude)
required_env=(BMAD_SERVER_URL BMAD_API_KEY CLICKUP_API_KEY CLICKUP_TEAM_ID LORE_SERVER_URL LORE_API_KEY)
secret_env=(BMAD_API_KEY CLICKUP_API_KEY LORE_API_KEY)

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -n "$TASK_ID" ]] || fail "usage: scripts/claude-run-skill.sh <clickup-task-id> [output-stream-json]"
[[ "$TASK_ID" =~ ^[[:alnum:]]+$ ]] || fail "task id must be alphanumeric"

if [[ -z "$OUTPUT_PATH" ]]; then
  OUTPUT_PATH="docs/openharness/runs/ohp-2.6-${TASK_ID}.stream.json"
fi

for command_name in "${required_commands[@]}"; do
  command -v "$command_name" >/dev/null 2>&1 || fail "missing command '$command_name'"
done

[[ -f "$CONFIG_PATH" ]] || fail "MCP config not found: $CONFIG_PATH"

for env_name in "${required_env[@]}"; do
  [[ -n "${!env_name:-}" ]] || fail "missing required environment variable: $env_name"
done

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# Materialize a Claude-Code-compatible --mcp-config file: substitute ${ENV}
# placeholders in the shared openharness/mcp-config.json. bmad + lore are
# required (hard-fail if their env is missing); any other server (e.g. gitnexus)
# is included only when its env fully resolves, otherwise dropped.
MCP_FILE="$TMP_DIR/mcp.json"
node - "$CONFIG_PATH" "$MCP_FILE" <<'NODE'
const fs = require("node:fs");

const [configPath, outPath] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const REQUIRED = new Set(["bmad", "lore"]);

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
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, materialize(nested)]));
  }
  return value;
}

const out = { mcpServers: {} };
for (const [name, def] of Object.entries(config.mcpServers || {})) {
  try {
    out.mcpServers[name] = materialize(def);
  } catch (error) {
    if (REQUIRED.has(name)) throw new Error(`mcpServers.${name}: ${error.message}`);
    // Optional server with unresolved env — skip it.
  }
}
for (const name of REQUIRED) {
  if (!out.mcpServers[name]) throw new Error(`missing mcpServers.${name}`);
}
fs.writeFileSync(outPath, JSON.stringify(out));
NODE

mkdir -p "$(dirname "$OUTPUT_PATH")"
TEMP_OUTPUT="$TMP_DIR/run.stream.json"

# Force Claude Code onto the first-party subscription login. If ANTHROPIC_API_KEY
# (or an auth token) is present in the inherited environment — DSF sets one in
# .env for its own NestJS Anthropic client — `claude` would prefer it and bill
# the API key instead of the subscription's plan limits. Unset for the child only.
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN
PROMPT="Execute the BMAD workflow ${WORKFLOW} for ClickUp ticket ${TASK_ID}. First call the MCP tool mcp__bmad__bmad with {\"operation\":\"execute\",\"workflow\":\"${WORKFLOW}\",\"message\":\"${TASK_ID}\"}. Continue from the returned workflow instructions until completion. Keep work scoped to the ClickUp task. Format only files changed by this run. Use the valid review status for this list when complete. Do not print environment or configuration values."

set +e
claude -p "$PROMPT" \
  --model "$MODEL" \
  --output-format stream-json \
  --verbose \
  --permission-mode bypassPermissions \
  --mcp-config "$MCP_FILE" \
  --strict-mcp-config \
  --max-turns "$MAX_TURNS" >"$TEMP_OUTPUT"
CLAUDE_STATUS=$?
set -e

for env_name in "${secret_env[@]}"; do
  if grep -Fq "${!env_name}" "$TEMP_OUTPUT"; then
    rm -f "$TEMP_OUTPUT"
    fail "stream output contained the literal value of $env_name; refusing to write unsafe log"
  fi
done

mv "$TEMP_OUTPUT" "$OUTPUT_PATH"

if [[ "${OH_RUN_STREAM_STDOUT:-}" == "1" ]]; then
  cat "$OUTPUT_PATH"
fi

exit "$CLAUDE_STATUS"
