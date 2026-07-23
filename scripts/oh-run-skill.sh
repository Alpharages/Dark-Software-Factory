#!/usr/bin/env bash
set -euo pipefail

TASK_ID="${1:-}"
OUTPUT_PATH="${2:-}"
WORKFLOW="${OH_RUN_WORKFLOW:-clickup-dev-implement}"
CONFIG_PATH="${OH_RUN_MCP_CONFIG:-openharness/mcp-config.json}"
MODEL="${OH_RUN_MODEL:-gpt-5.4}"
MAX_TURNS="${OH_RUN_MAX_TURNS:-200}"

required_commands=(node oh)
# Lore is optional: when LORE_SERVER_URL + LORE_API_KEY are unset the lore MCP
# server is skipped and the run proceeds without Lore memory (see node block below).
required_env=(BMAD_SERVER_URL BMAD_API_KEY CLICKUP_API_KEY CLICKUP_TEAM_ID)
# OPENAI_API_KEY is injected per-run by the DSF runner (the selected account's
# token) — scrub it from the persisted stream alongside the MCP secrets.
secret_env=(BMAD_API_KEY CLICKUP_API_KEY LORE_API_KEY OPENAI_API_KEY)

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -n "$TASK_ID" ]] || fail "usage: scripts/oh-run-skill.sh <clickup-task-id> [output-stream-json]"
[[ "$TASK_ID" =~ ^[[:alnum:]]+$ ]] || fail "task id must be alphanumeric"

if [[ -z "$OUTPUT_PATH" ]]; then
  OUTPUT_PATH="docs/openharness/runs/ohp-1.2-${TASK_ID}.stream.json"
fi

for command_name in "${required_commands[@]}"; do
  command -v "$command_name" >/dev/null 2>&1 || fail "missing command '$command_name'"
done

[[ -f "$CONFIG_PATH" ]] || fail "MCP config not found: $CONFIG_PATH"

for env_name in "${required_env[@]}"; do
  [[ -n "${!env_name:-}" ]] || fail "missing required environment variable: $env_name"
done

TMP_DIR="$(mktemp -d)"
SETTINGS_EXISTED=0
SETTINGS_RESTORED=0
cleanup() {
  oh mcp remove bmad >/dev/null 2>&1 || true
  oh mcp remove lore >/dev/null 2>&1 || true
  if [[ $SETTINGS_RESTORED -eq 0 ]]; then
    if [[ $SETTINGS_EXISTED -eq 1 ]]; then
      cp "$SETTINGS_BACKUP" "$SETTINGS_FILE" 2>/dev/null || true
    else
      rm -f "$SETTINGS_FILE" 2>/dev/null || true
    fi
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

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
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, materialize(nested)]));
  }
  return value;
}

if (!config.mcpServers?.bmad) throw new Error("missing mcpServers.bmad");

fs.writeFileSync(bmadPath, JSON.stringify(materialize(config.mcpServers.bmad)));

// Lore is optional: register it only if configured AND its env (LORE_*) resolves.
// If not, leave lorePath unwritten — the shell skips registration when it's absent.
if (config.mcpServers?.lore) {
  try {
    fs.writeFileSync(lorePath, JSON.stringify(materialize(config.mcpServers.lore)));
  } catch {
    // Optional server with unresolved env — skip it.
  }
}
NODE

DEFAULT_CONFIG_DIR="${OPENHARNESS_CONFIG_DIR:-$HOME/.openharness}"
SETTINGS_FILE="$DEFAULT_CONFIG_DIR/settings.json"
SETTINGS_BACKUP="$TMP_DIR/settings.json.bak"
if [[ -f "$SETTINGS_FILE" ]]; then
  cp "$SETTINGS_FILE" "$SETTINGS_BACKUP"
  SETTINGS_EXISTED=1
fi

oh mcp remove bmad >/dev/null 2>&1 || true
oh mcp remove lore >/dev/null 2>&1 || true
if ! oh mcp add bmad "$(cat "$TMP_DIR/bmad.json")" >"$TMP_DIR/bmad-add.log" 2>&1; then
  fail "failed to register bmad MCP server"
fi
if [[ -s "$TMP_DIR/lore.json" ]]; then
  if ! oh mcp add lore "$(cat "$TMP_DIR/lore.json")" >"$TMP_DIR/lore-add.log" 2>&1; then
    fail "failed to register lore MCP server"
  fi
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"
TEMP_OUTPUT="$TMP_DIR/run.stream.json"
PROMPT="Execute the BMAD workflow ${WORKFLOW} for ClickUp ticket ${TASK_ID}. First call the MCP tool mcp__bmad__bmad with {\"operation\":\"execute\",\"workflow\":\"${WORKFLOW}\",\"message\":\"${TASK_ID}\"}. Continue from the returned workflow instructions until completion. Keep work scoped to the ClickUp task. Format only files changed by this run. Use the valid review status for this list when complete. Do not call configuration-inspection tools or print environment/configuration values."

set +e
if [[ "${OH_RUN_STREAM_STDOUT:-}" == "1" ]]; then
  # Live mode: tee the stream-json to stdout AS IT IS PRODUCED so the DSF runner
  # parses events in real time (live dashboard feed) while still capturing the
  # full run to TEMP_OUTPUT for the secret scan + log. PIPESTATUS[0] preserves
  # oh's real exit code (tee would otherwise mask it).
  oh -p "$PROMPT" \
    --model "$MODEL" \
    --output-format stream-json \
    --permission-mode full_auto \
    --disallowed-tools config \
    --max-turns "$MAX_TURNS" | tee "$TEMP_OUTPUT"
  OH_STATUS=${PIPESTATUS[0]}
else
  oh -p "$PROMPT" \
    --model "$MODEL" \
    --output-format stream-json \
    --permission-mode full_auto \
    --disallowed-tools config \
    --max-turns "$MAX_TURNS" >"$TEMP_OUTPUT"
  OH_STATUS=$?
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
# via `tee` as it was produced, so nothing is replayed here. The non-streaming
# path intentionally writes only the log file (no stdout), as before.

oh mcp remove bmad >/dev/null 2>&1 || true
oh mcp remove lore >/dev/null 2>&1 || true
if [[ $SETTINGS_EXISTED -eq 1 ]]; then
  cp "$SETTINGS_BACKUP" "$SETTINGS_FILE"
else
  rm -f "$SETTINGS_FILE"
fi
SETTINGS_RESTORED=1

exit "$OH_STATUS"
