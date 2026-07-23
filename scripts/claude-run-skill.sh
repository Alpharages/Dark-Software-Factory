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
# Lore is optional: unset LORE_* → the lore MCP server is skipped (see REQUIRED below).
required_env=(BMAD_SERVER_URL BMAD_API_KEY CLICKUP_API_KEY CLICKUP_TEAM_ID)
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
const REQUIRED = new Set(["bmad"]); // lore is optional — skipped if its env is unset

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
if [[ "${OH_RUN_STREAM_STDOUT:-}" == "1" ]]; then
  # Live mode: tee the stream-json to stdout AS IT IS PRODUCED so the DSF runner
  # parses events in real time and the dashboard shows a live activity feed —
  # while still capturing the full run to TEMP_OUTPUT for the secret check + log.
  # PIPESTATUS[0] preserves claude's exit code (tee would otherwise mask it).
  # Note: in live mode events reach stdout before the post-hoc secret scan below;
  # the prompt forbids printing env/config values and this is a single-tenant MVP,
  # so the file scan remains as defense-in-depth on the persisted artifact.
  claude -p "$PROMPT" \
    --model "$MODEL" \
    --output-format stream-json \
    --verbose \
    --permission-mode bypassPermissions \
    --mcp-config "$MCP_FILE" \
    --strict-mcp-config \
    --max-turns "$MAX_TURNS" | tee "$TEMP_OUTPUT"
  CLAUDE_STATUS=${PIPESTATUS[0]}
else
  claude -p "$PROMPT" \
    --model "$MODEL" \
    --output-format stream-json \
    --verbose \
    --permission-mode bypassPermissions \
    --mcp-config "$MCP_FILE" \
    --strict-mcp-config \
    --max-turns "$MAX_TURNS" >"$TEMP_OUTPUT"
  CLAUDE_STATUS=$?
fi
set -e

# Redact any secret value that leaked into the stream (e.g. a Lore MCP error
# echoing its Authorization header) instead of discarding the run. The run has
# already done its work — failing here would waste all its time and tokens while
# still leaving the on-disk log safe. Fixed-string replace via node (a required
# command) avoids sed regex-escaping traps; empty vars are skipped.
node -e '
  const fs = require("node:fs");
  const [file, ...names] = process.argv.slice(1);
  let s = fs.readFileSync(file, "utf8");
  let changed = false;
  for (const n of names) {
    const v = process.env[n];
    if (v && s.includes(v)) {
      s = s.split(v).join(`[REDACTED_${n}]`);
      changed = true;
      process.stderr.write(`WARN: redacted leaked ${n} from stream output\n`);
    }
  }
  if (changed) fs.writeFileSync(file, s);
' "$TEMP_OUTPUT" "${secret_env[@]}"

mv "$TEMP_OUTPUT" "$OUTPUT_PATH"

# In live mode (OH_RUN_STREAM_STDOUT=1) the stream was already emitted to stdout
# via `tee` as it was produced, so there is nothing left to replay here. The
# non-streaming path intentionally writes only the log file (no stdout), matching
# the prior behaviour.

exit "$CLAUDE_STATUS"
