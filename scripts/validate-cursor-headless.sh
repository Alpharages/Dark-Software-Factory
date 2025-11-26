#!/bin/bash

###############################################################################
# Cursor Headless Validation Script
# Dark Software Factory - Critical Path Validation
#
# Purpose: Validate that Cursor CLI headless mode works as documented
# Status: CRITICAL - Must run before any Phase 1 development
# Date: 2025-11-25
###############################################################################

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║   🧪 CURSOR HEADLESS VALIDATION                               ║"
echo "║   Dark Software Factory - Critical Path Check                  ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test results
ALL_TESTS_PASSED=true

###############################################################################
# Test 1: Check Cursor CLI Installation
###############################################################################
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1️⃣  TEST: Cursor CLI Installation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if command -v cursor &> /dev/null; then
    CURSOR_PATH=$(which cursor)
    CURSOR_VERSION=$(cursor --version 2>&1 | head -n 1)
    echo -e "${GREEN}✅ PASS${NC}: Cursor CLI found"
    echo "   Path: $CURSOR_PATH"
    echo "   Version: $CURSOR_VERSION"
else
    echo -e "${RED}❌ FAIL${NC}: Cursor CLI not found"
    echo ""
    echo "ACTION REQUIRED:"
    echo "1. Install Cursor from https://cursor.com"
    echo "2. Enable CLI in Cursor settings"
    echo "3. Run this script again"
    ALL_TESTS_PASSED=false
    exit 1
fi

echo ""

###############################################################################
# Test 2: Check for --headless Flag
###############################################################################
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2️⃣  TEST: --headless Flag Availability"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cursor --help > /tmp/cursor-help.txt 2>&1

if grep -qi "headless" /tmp/cursor-help.txt; then
    echo -e "${GREEN}✅ PASS${NC}: --headless flag exists"
    echo ""
    echo "Documentation:"
    grep -i "headless" /tmp/cursor-help.txt | head -n 3
else
    echo -e "${YELLOW}⚠️  UNCERTAIN${NC}: --headless not found in help output"
    echo ""
    echo "This might mean:"
    echo "- Flag exists but not documented in --help"
    echo "- Flag has different name (e.g., --no-gui, --server)"
    echo "- Cursor version doesn't support headless mode"
    echo ""
    echo "ACTION: Check https://cursor.com/docs/cli/overview"
    ALL_TESTS_PASSED=false
fi

echo ""

###############################################################################
# Test 3: Check for --apply Flag
###############################################################################
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3️⃣  TEST: --apply Flag Availability"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if grep -qi "apply" /tmp/cursor-help.txt; then
    echo -e "${GREEN}✅ PASS${NC}: --apply flag exists"
    echo ""
    echo "Documentation:"
    grep -i "apply" /tmp/cursor-help.txt | head -n 3
else
    echo -e "${YELLOW}⚠️  UNCERTAIN${NC}: --apply not found in help output"
    echo ""
    echo "Alternatives to check:"
    echo "- cursor compose (for Composer feature)"
    echo "- cursor ai (for AI commands)"
    echo "- cursor --prompt"
    echo ""
    echo "ACTION: Check Cursor documentation for correct syntax"
fi

echo ""

###############################################################################
# Test 4: Actual Headless Execution
###############################################################################
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4️⃣  TEST: Headless Execution (Real Test)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Setup test directory
TEST_DIR="/tmp/cursor-validation-test-$(date +%s)"
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR" || exit 1

echo "Setting up test project in: $TEST_DIR"

# Initialize git repo
git init > /dev/null 2>&1
git config user.email "test@darkfactory.com"
git config user.name "Dark Factory Test"

# Create simple test file
cat > index.js << 'EOF'
console.log("Hello World");
EOF

# Initial commit
git add .
git commit -m "Initial commit" > /dev/null 2>&1

echo "✅ Test project initialized"
echo ""

# Try headless execution
echo "Executing Cursor headless command..."
echo "Command: cursor --headless --dir $TEST_DIR --apply 'Add a function that adds two numbers' --wait"
echo ""

# Execute with timeout
timeout 60s cursor --headless \
  --dir "$TEST_DIR" \
  --apply "Add a function that adds two numbers" \
  --wait > /tmp/cursor-execution.log 2>&1

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ PASS${NC}: Cursor headless execution successful!"
    echo ""
    
    # Check if any changes were made
    if git diff HEAD --quiet; then
        echo -e "${YELLOW}⚠️  WARNING${NC}: No changes detected in git"
        echo "Cursor ran but didn't modify any files"
        ALL_TESTS_PASSED=false
    else
        echo "📝 Changes detected:"
        echo ""
        git diff HEAD --stat
        echo ""
        echo "Detailed diff:"
        git diff HEAD | head -n 20
        echo ""
        echo -e "${GREEN}✅ SUCCESS${NC}: Code was generated!"
    fi
    
elif [ $EXIT_CODE -eq 124 ]; then
    echo -e "${RED}❌ FAIL${NC}: Cursor execution timed out (>60s)"
    echo ""
    echo "This might indicate:"
    echo "- Cursor is waiting for user input (GUI prompt)"
    echo "- Headless mode not working correctly"
    echo "- Large operation taking too long"
    ALL_TESTS_PASSED=false
    
else
    echo -e "${RED}❌ FAIL${NC}: Cursor execution failed (exit code: $EXIT_CODE)"
    echo ""
    echo "Output:"
    cat /tmp/cursor-execution.log
    echo ""
    echo "Possible issues:"
    echo "- Headless mode not supported in this version"
    echo "- Incorrect command syntax"
    echo "- Missing dependencies"
    echo "- Authentication required"
    ALL_TESTS_PASSED=false
fi

echo ""

###############################################################################
# Test 5: Check Available Flags
###############################################################################
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5️⃣  INFO: Available Cursor CLI Flags"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "Full help output saved to: /tmp/cursor-help.txt"
echo ""
echo "Relevant flags found:"
cat /tmp/cursor-help.txt | grep -E "^\s*-" | grep -v "^Binary" | head -n 20

echo ""

###############################################################################
# Final Results
###############################################################################
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                                                                ║"
echo "║   📊 VALIDATION RESULTS                                        ║"
echo "║                                                                ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

if [ "$ALL_TESTS_PASSED" = true ]; then
    echo -e "${GREEN}✅✅✅ ALL TESTS PASSED ✅✅✅${NC}"
    echo ""
    echo "CONCLUSION: Cursor headless mode is WORKING!"
    echo ""
    echo "✅ Ready to proceed with Dark Factory Phase 1"
    echo "✅ Architecture is validated"
    echo "✅ Can start building orchestrator"
    echo ""
    echo "NEXT STEPS:"
    echo "1. Document results in docs/cursor-validation-results.md"
    echo "2. Begin Epic 1: Foundation (NestJS setup)"
    echo "3. Begin Epic 2: AI Routing (Cursor integration)"
    echo ""
    exit 0
else
    echo -e "${RED}❌ VALIDATION FAILED ❌${NC}"
    echo ""
    echo "Some tests did not pass. Review output above."
    echo ""
    echo "NEXT ACTIONS:"
    echo "1. Check Cursor documentation: https://cursor.com/docs/cli/overview"
    echo "2. Update command syntax if needed"
    echo "3. Consider fallback options:"
    echo "   - MCP (Model Context Protocol) integration"
    echo "   - Aider (proven alternative)"
    echo "   - Hybrid model (manual Cursor + orchestration)"
    echo ""
    echo "CRITICAL: Do NOT proceed with Phase 1 until validation passes"
    echo ""
    exit 1
fi

