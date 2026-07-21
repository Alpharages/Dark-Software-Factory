#!/usr/bin/env bash
set -euo pipefail

# One-time interactive login for a pooled Claude AiAccount.
#
# The DSF runner drives each selected Claude account by pointing the `claude` CLI at that
# account's own config dir (CLAUDE_CONFIG_DIR=<accounts-dir>/<account-id>) — the only headless
# way to switch between Claude subscription accounts (the CLI has no email/password login).
# This script performs the ONE-TIME, human, browser-based login that seeds that config dir.
# After it succeeds, every future run for that account reuses the saved session automatically.
#
# Usage: scripts/claude-account-login.sh <account-id>
#   <account-id> is the AiAccount.id (UUID) shown in the admin "Claude sessions" view.
#   Base dir defaults to ~/.dsf/claude-accounts; override with OPENHARNESS_CLAUDE_ACCOUNTS_DIR
#   (must match the backend's openharness.claudeAccountsDir).

ACCOUNT_ID="${1:-}"
ACCOUNTS_DIR="${OPENHARNESS_CLAUDE_ACCOUNTS_DIR:-$HOME/.dsf/claude-accounts}"

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

[[ -n "$ACCOUNT_ID" ]] || fail "usage: scripts/claude-account-login.sh <account-id>"
# Account ids are UUIDs — alnum + hyphen only. Rejecting other chars keeps the id from escaping
# the accounts dir (no '/' or '..') and makes it safe to interpolate into the SQL check below.
[[ "$ACCOUNT_ID" =~ ^[[:alnum:]-]+$ ]] || fail "account id must be alphanumeric/hyphen only"
command -v claude >/dev/null 2>&1 || fail "missing command 'claude' (install Claude Code first)"

# The runner selects accounts from `ai_accounts` independently of this script — provisioning a
# config dir for an id that isn't a registered, enabled claude row is exactly how a dir/DB
# mismatch happens (the original failure mode this script must not reproduce).
# DATABASE_URL usually lives in .env, not the shell env — load it from there when unset so the
# script works out of the box. ponytail: grep one key, not a full dotenv parser; unquoted values only.
ENV_FILE="$(dirname "$0")/../.env"
if [[ -z "${DATABASE_URL:-}" && -f "$ENV_FILE" ]]; then
  DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | tail -1 | cut -d= -f2-)
  export DATABASE_URL
fi
: "${DATABASE_URL:?DATABASE_URL must be set (in .env or the environment) to validate the account id against ai_accounts}"
command -v psql >/dev/null 2>&1 || fail "missing command 'psql' (needed to validate the account id against ai_accounts)"
# Prisma URLs carry a ?schema=... param that libpq rejects ("invalid URI query parameter"). Strip
# the query string — psql defaults to the search_path, and ai_accounts is in the default schema.
PSQL_URL="${DATABASE_URL%%\?*}"
ENABLED=$(psql "$PSQL_URL" -tAc \
  "SELECT enabled FROM ai_accounts WHERE id = '$ACCOUNT_ID' AND provider = 'claude'") ||
  fail "could not query ai_accounts for id '$ACCOUNT_ID' — check DATABASE_URL"
[[ -n "$ENABLED" ]] ||
  fail "account id '$ACCOUNT_ID' is not registered in ai_accounts (provider='claude') — import/create it first, then re-run with that id"
[[ "$ENABLED" == "t" ]] ||
  fail "account id '$ACCOUNT_ID' is registered but disabled in ai_accounts — enable it first, then re-run"

CONFIG_DIR="$ACCOUNTS_DIR/$ACCOUNT_ID"
mkdir -p "$CONFIG_DIR"

echo "Logging in Claude account '$ACCOUNT_ID'"
echo "  config dir: $CONFIG_DIR"
echo "A browser window will open — sign in with THIS account's Anthropic subscription."
echo

# `claude login` is not a subcommand on current Claude Code CLIs (moved under `auth`);
# passing it verbatim gets swallowed as a chat prompt to an unauthenticated session and
# silently produces no credentials — the exact failure mode this script exists to prevent.
# Clear any credential left by a prior attempt so the check below can only pass if THIS
# `claude auth login` invocation produced it — otherwise a stale file from an earlier,
# cancelled, or now-expired session would make a failed re-login look like success.
CRED_FILE="$CONFIG_DIR/.credentials.json"
rm -f "$CRED_FILE"

CLAUDE_CONFIG_DIR="$CONFIG_DIR" claude auth login

# The runner (probeClaudeSession, ai-accounts.service.ts) reads credentials straight from
# "$CONFIG_DIR/.credentials.json" — not from `claude auth status`, which also reflects a
# macOS-Keychain-only session that the isolated, non-interactive runner can never see. The CLI
# has no flag to force file-based storage, so on macOS it often saves the session to the login
# Keychain and leaves no file. Recover it: pull the blob from the Keychain and write the
# `.credentials.json` the runner expects. ponytail: keychain-only fallback, drop it if the CLI
# ever gains a file-storage flag.
if [[ ! -s "$CRED_FILE" ]] && command -v security >/dev/null 2>&1; then
  security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); json.dump({'claudeAiOauth': d['claudeAiOauth']}, open('$CRED_FILE','w'))" 2>/dev/null &&
    chmod 600 "$CRED_FILE" &&
    echo "  (recovered session from macOS Keychain)"
fi

[[ -s "$CRED_FILE" ]] ||
  fail "login did not produce a file-based credential at '$CRED_FILE' — on macOS this usually means the session was saved to Keychain instead of the account dir, which the isolated runner can't read"

echo
echo "✅ Session saved to $CONFIG_DIR"
echo "Runs routed to this account will now reuse it automatically."
