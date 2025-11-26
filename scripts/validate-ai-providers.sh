#!/bin/bash
#=============================================================================
# validate-ai-providers.sh
#
# Tests both Cursor CLI (headless mode) and Claude CLI to validate
# multi-provider AI strategy for Dark Software Factory.
#
# Usage: ./validate-ai-providers.sh
#
# Exit codes:
#   0 - At least one provider available
#   1 - No providers available
#=============================================================================

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║   🧪 MULTI-PROVIDER AI VALIDATION                             ║"
echo "║   Dark Software Factory - AI Dev Tool Orchestrator             ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

ALL_TESTS_PASSED=true
CURSOR_AVAILABLE=false
CLAUDE_AVAILABLE=false

# ==================== Test Cursor CLI ====================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1️⃣  TESTING: Cursor CLI Headless Mode"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if command -v cursor &> /dev/null; then
    echo "✅ Cursor CLI found: $(which cursor)"
    cursor --version 2>&1 | head -1
    echo ""
    
    # Check for headless flag
    if cursor --help 2>&1 | grep -q "headless"; then
        echo "✅ --headless flag is available"
    else
        echo "⚠️  --headless flag not found in help"
        echo "   Check: https://cursor.com/docs/cli/overview"
    fi
    
    # Test simple headless execution
    echo ""
    echo "Testing headless execution..."
    TEST_DIR="/tmp/cursor-test-$(date +%s)"
    mkdir -p "$TEST_DIR"
    cd "$TEST_DIR" || exit 1
    
    # Initialize test repo
    git init > /dev/null 2>&1
    echo 'console.log("test");' > index.js
    git add . && git commit -m "init" > /dev/null 2>&1
    
    echo "Running: cursor --headless --dir $TEST_DIR --apply 'Add a hello world function' --wait"
    if timeout 60s cursor --headless --dir "$TEST_DIR" --apply "Add a function that returns 'Hello World'" --wait 2>&1; then
        echo ""
        echo "✅ Cursor headless execution successful!"
        
        # Check if files changed
        if git diff --name-only | grep -q .; then
            echo "✅ Files were modified by Cursor"
            git diff --stat
        else
            echo "⚠️  No files changed (might be expected behavior)"
        fi
        
        CURSOR_AVAILABLE=true
    else
        EXIT_CODE=$?
        echo ""
        echo "❌ Cursor headless failed (exit code: $EXIT_CODE)"
        echo "   This might be due to:"
        echo "   - Cursor not installed properly"
        echo "   - License required for headless mode"
        echo "   - Feature not yet available"
        CURSOR_AVAILABLE=false
        ALL_TESTS_PASSED=false
    fi
    
    # Cleanup
    cd / && rm -rf "$TEST_DIR"
else
    echo "❌ Cursor CLI not found"
    echo ""
    echo "Installation instructions:"
    echo "  1. Install Cursor: https://cursor.com"
    echo "  2. Add CLI to PATH (usually automatic)"
    echo "  3. Verify: cursor --version"
    CURSOR_AVAILABLE=false
fi

echo ""
echo ""

# ==================== Test Claude CLI ====================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2️⃣  TESTING: Claude CLI (Anthropic)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if command -v claude &> /dev/null; then
    echo "✅ Claude CLI found: $(which claude)"
    claude --version 2>&1 | head -1 || echo "v?.?.?"
    echo ""
    
    # Check API key
    if [ -z "$ANTHROPIC_API_KEY" ]; then
        echo "❌ ANTHROPIC_API_KEY environment variable not set"
        echo ""
        echo "Required actions:"
        echo "  1. Get API key: https://console.anthropic.com"
        echo "  2. Set env var: export ANTHROPIC_API_KEY='sk-ant-...'"
        echo "  3. Add to shell profile for persistence"
        CLAUDE_AVAILABLE=false
        ALL_TESTS_PASSED=false
    else
        echo "✅ ANTHROPIC_API_KEY is set (${#ANTHROPIC_API_KEY} chars)"
        echo ""
        
        # Test Claude execution
        echo "Testing Claude code generation..."
        echo "Prompt: 'Write a TypeScript hello world function'"
        echo ""
        
        CLAUDE_OUTPUT=$(timeout 30s claude --prompt "Write a TypeScript function named 'hello' that returns 'Hello, World!'. Only output the code, no explanation." --model claude-3-5-sonnet 2>&1)
        CLAUDE_EXIT=$?
        
        if [ $CLAUDE_EXIT -eq 0 ] && echo "$CLAUDE_OUTPUT" | grep -q "function"; then
            echo "✅ Claude CLI works!"
            echo ""
            echo "Sample output:"
            echo "$CLAUDE_OUTPUT" | head -10
            CLAUDE_AVAILABLE=true
        else
            echo "❌ Claude execution failed (exit code: $CLAUDE_EXIT)"
            echo ""
            echo "Output:"
            echo "$CLAUDE_OUTPUT"
            CLAUDE_AVAILABLE=false
            ALL_TESTS_PASSED=false
        fi
    fi
else
    echo "⚠️  Claude CLI not found"
    echo ""
    echo "Installation instructions:"
    echo "  Option 1 (npm):"
    echo "    npm install -g @anthropic-ai/claude-cli"
    echo ""
    echo "  Option 2 (pip):"
    echo "    pip install anthropic-cli"
    echo ""
    echo "  After installation:"
    echo "    export ANTHROPIC_API_KEY='your-key'"
    CLAUDE_AVAILABLE=false
fi

echo ""
echo ""

# ==================== Results & Recommendations ====================
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║   📊 VALIDATION RESULTS                                        ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

echo "Provider Status:"
echo "  Cursor CLI:  $([ "$CURSOR_AVAILABLE" = true ] && echo '✅ AVAILABLE' || echo '❌ NOT AVAILABLE')"
echo "  Claude CLI:  $([ "$CLAUDE_AVAILABLE" = true ] && echo '✅ AVAILABLE' || echo '❌ NOT AVAILABLE')"
echo ""

# Determine recommendation
if [ "$CURSOR_AVAILABLE" = true ] && [ "$CLAUDE_AVAILABLE" = true ]; then
    echo "╭────────────────────────────────────────────────────────────────╮"
    echo "│ ✅✅✅ BOTH PROVIDERS AVAILABLE - OPTIMAL CONFIGURATION ✅✅✅  │"
    echo "╰────────────────────────────────────────────────────────────────╯"
    echo ""
    echo "🎯 RECOMMENDATION:"
    echo "  ✅ Proceed with multi-provider strategy"
    echo "  ✅ Use Cursor for complex, multi-file tasks"
    echo "  ✅ Use Claude for simple, focused tasks"
    echo "  ✅ Auto-fallback enabled if one provider fails"
    echo ""
    echo "Next steps:"
    echo "  1. Run POC: npm run test:cursor-poc"
    echo "  2. Run POC: npm run test:claude-poc"
    echo "  3. Implement multi-provider routing logic"
    echo "  4. Deploy orchestrator with both providers"
    exit 0
    
elif [ "$CURSOR_AVAILABLE" = true ]; then
    echo "╭────────────────────────────────────────────────────────────────╮"
    echo "│ ✅ CURSOR AVAILABLE - CAN PROCEED (No Fallback)               │"
    echo "╰────────────────────────────────────────────────────────────────╯"
    echo ""
    echo "🎯 RECOMMENDATION:"
    echo "  ✅ Proceed with Cursor only"
    echo "  ⚠️  No fallback provider (single point of failure)"
    echo "  📝 Consider installing Claude CLI for redundancy"
    echo ""
    echo "Next steps:"
    echo "  1. Run POC: npm run test:cursor-poc"
    echo "  2. Deploy orchestrator with Cursor provider"
    echo "  3. (Optional) Install Claude CLI later for fallback"
    exit 0
    
elif [ "$CLAUDE_AVAILABLE" = true ]; then
    echo "╭────────────────────────────────────────────────────────────────╮"
    echo "│ ✅ CLAUDE AVAILABLE - CAN PROCEED (Limited Context)           │"
    echo "╰────────────────────────────────────────────────────────────────╯"
    echo ""
    echo "🎯 RECOMMENDATION:"
    echo "  ✅ Proceed with Claude only"
    echo "  ⚠️  Manual context building required (no auto repo context)"
    echo "  ⚠️  Limited multi-file editing capabilities"
    echo "  📝 Consider installing Cursor for better repo context"
    echo ""
    echo "Next steps:"
    echo "  1. Run POC: npm run test:claude-poc"
    echo "  2. Implement context-building service"
    echo "  3. Deploy orchestrator with Claude provider"
    echo "  4. (Optional) Install Cursor CLI later for better context"
    exit 0
    
else
    echo "╭────────────────────────────────────────────────────────────────╮"
    echo "│ ❌ NO PROVIDERS AVAILABLE - CANNOT PROCEED                    │"
    echo "╰────────────────────────────────────────────────────────────────╯"
    echo ""
    echo "🚨 REQUIRED ACTIONS:"
    echo "  1. Install at least one AI provider:"
    echo "     • Cursor CLI: https://cursor.com"
    echo "     • Claude CLI: npm i -g @anthropic-ai/claude-cli"
    echo ""
    echo "  2. Configure credentials:"
    echo "     • Cursor: Automatic with account login"
    echo "     • Claude: export ANTHROPIC_API_KEY='your-key'"
    echo ""
    echo "  3. Re-run this validation script"
    echo ""
    echo "  4. Proceed once at least one provider is available"
    exit 1
fi

