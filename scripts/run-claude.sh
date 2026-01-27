#!/bin/bash

# Universal Claude CLI Launcher
# Usage:
#   npm run claude -- [args]
#
# Logic:
#   1. Loads .env file (if present)
#   2. Checks if ANTHROPIC_API_KEY is set (shell var takes precedence)
#   3. If Key starts with "sk-": Runs official Claude API
#   4. If Key is missing/empty: Runs in Ollama mode (configuring Docker networking if needed)

# Capture existing shell variable to allow override
EXISTING_KEY="$ANTHROPIC_API_KEY"

# Load .env file if present
if [ -f .env ]; then
  # verification: export variables from .env to current environment
  set -a
  source .env
  set +a
fi

# Restore shell override if it was provided
if [ -n "$EXISTING_KEY" ]; then
  ANTHROPIC_API_KEY="$EXISTING_KEY"
fi

# Logic Switch: Official Config vs Ollama Config
if [[ "$ANTHROPIC_API_KEY" == sk-* ]]; then
  echo "🤖 Starting Claude Code (Official API Mode)"
  echo "   - Using API Key: ${ANTHROPIC_API_KEY:0:15}..."
  
  # Run directly - SDK will read ANTHROPIC_API_KEY from env
  claude "$@"
  
else
  echo "🦙 Starting Claude Code (Ollama Mode)"
  echo "   - No official API key detected (sk-*)"
  
  # Determine Base URL
  TARGET_URL="${ANTHROPIC_BASE_URL}"
  
  if [ -z "$TARGET_URL" ]; then
    if [ -f /.dockerenv ]; then
      TARGET_URL="http://host.docker.internal:11434"
      echo "   - Docker environment detected: Using host gateway"
    else
      TARGET_URL="http://localhost:11434"
      echo "   - Local environment detected: Using localhost"
    fi
  fi
  
  echo "   - Base URL: $TARGET_URL"

  # Run with inline variables specific to Ollama
  ANTHROPIC_AUTH_TOKEN="${ANTHROPIC_AUTH_TOKEN:-ollama}" \
  ANTHROPIC_BASE_URL="$TARGET_URL" \
  ANTHROPIC_API_KEY="" \
  claude "$@"
fi
