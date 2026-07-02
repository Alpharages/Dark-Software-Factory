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
# the accounts dir (no '/' or '..').
[[ "$ACCOUNT_ID" =~ ^[[:alnum:]-]+$ ]] || fail "account id must be alphanumeric/hyphen only"
command -v claude >/dev/null 2>&1 || fail "missing command 'claude' (install Claude Code first)"

CONFIG_DIR="$ACCOUNTS_DIR/$ACCOUNT_ID"
mkdir -p "$CONFIG_DIR"

echo "Logging in Claude account '$ACCOUNT_ID'"
echo "  config dir: $CONFIG_DIR"
echo "A browser window will open — sign in with THIS account's Anthropic subscription."
echo

CLAUDE_CONFIG_DIR="$CONFIG_DIR" claude login

echo
echo "✅ Session saved to $CONFIG_DIR"
echo "Runs routed to this account will now reuse it automatically."
