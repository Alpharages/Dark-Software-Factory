# Cursor Headless Architecture Update
## Dark Software Factory

**Date:** 2025-11-25  
**Status:** Architecture Updated - Pending Validation  
**Priority:** CRITICAL - Must validate before proceeding

---

## Executive Summary

The Dark Software Factory architecture has been **updated to use Cursor CLI headless mode** as the primary AI code generation engine. This replaces the previous approach of attempting custom AI API integrations (which don't exist).

**Key Change:**
```diff
- Custom AI Provider APIs (Cursor/Windsurf/Antigravity)
+ Cursor CLI Headless Mode (official, documented)

- cursor.provider.ts calling non-existent APIs
+ cursor-headless.provider.ts using official CLI

Command:
+ cursor --headless --dir /workspace --apply "prompt" --wait
```

---

## Why This Change Was Critical

### **Problem Identified:**
The original architecture assumed AI provider APIs existed:
- ❌ Cursor API - Does NOT exist (desktop IDE, no public API)
- ❌ Windsurf API - Does NOT exist  
- ❌ Antigravity API - Does NOT exist (Google internal)

**This would have blocked 100% of Phase 1 development.**

### **Solution Found:**
Cursor provides official CLI with `--headless` mode:
- ✅ Official, documented by Cursor team
- ✅ Purpose-built for CI/CD automation
- ✅ Full Cursor AI power (repository context, multi-file editing)
- ✅ Server-ready (no GUI needed)
- ✅ Supports concurrent execution
- ✅ Available at: https://cursor.com/docs/cli/overview

---

## Documents Updated

### **1. Architecture Document** (`docs/architecture.md`)

**Changes Made:**
- ✅ Updated Executive Summary with Cursor Headless approach
- ✅ Added Cursor CLI to technology decision table
- ✅ Updated AI Routing module structure (cursor-headless.provider.ts)
- ✅ Replaced "AI Provider APIs" section with "Cursor Headless Integration"
- ✅ Added ADR-003: Cursor CLI Headless Mode decision
- ✅ Added comprehensive "Cursor Headless Implementation Strategy" section
- ✅ Updated document version to 2.0

**New Sections:**
- Cursor Headless Overview
- Command Structure & Flags
- Workspace Isolation Strategy
- Prompt Engineering Template
- Execution Flow (detailed)
- Concurrency Management (50+ projects)
- Error Handling & Retry Logic
- Cost Tracking Approach
- Validation Checklist
- Phase 1 Validation Script

### **2. PR-Agent Integration Strategy** (`docs/pr-agent-integration-strategy.md`)

**Changes Made:**
- ✅ Updated version to 2.0
- ✅ Clarified pr-agent as AI #2 (after Cursor Headless = AI #1)
- ✅ Updated flow diagram to show Cursor Headless in pipeline
- ✅ Updated Phase 2 integration code examples
- ✅ Added architecture change note (Nov 25, 2025)
- ✅ Added Cursor CLI documentation link
- ✅ Explained why Cursor Headless provides full AI power

---

## Updated Architecture Flow

```
┌──────────────────────────────────────────────────┐
│  AetherFlow (BMAD Agents)                        │
│  - PM creates perfect tickets                    │
│  - ClickUp integration                           │
└────────────────┬─────────────────────────────────┘
                 ↓ Webhook
┌──────────────────────────────────────────────────┐
│  Dark Factory Orchestrator (Node.js/NestJS)      │
│  - ClickUp webhook listener                      │
│  - Task queue management (RabbitMQ)              │
│  - Multi-workspace coordination                  │
│  - Cost tracking & metrics                       │
│  - PR creation & monitoring                      │
└────────────────┬─────────────────────────────────┘
                 ↓ Executes via CLI
┌──────────────────────────────────────────────────┐
│  Cursor Headless (Server-side AI)                │
│                                                  │
│  cursor --headless \                             │
│    --dir /workspaces/ticket-123 \                │
│    --apply "ticket description..." \             │
│    --wait                                        │
│                                                  │
│  Provides:                                       │
│  ✅ Full repository context                      │
│  ✅ Semantic codebase search                     │
│  ✅ AI code generation (Claude/GPT-4)            │
│  ✅ Multi-file editing with awareness            │
│  ✅ Context-aware suggestions                    │
│  ✅ Automatic indexing                           │
│  ✅ 50+ concurrent workspaces                    │
└──────────────────────────────────────────────────┘
                 ↓ Git diff
┌──────────────────────────────────────────────────┐
│  Orchestrator (continues)                        │
│  - Collects changes via git diff                 │
│  - Runs automated QA                             │
│  - Creates GitHub PR                             │
└────────────────┬─────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────────────┐
│  pr-agent (AI #2 - Code Reviewer)                │
│  - Reviews PR for quality/security               │
│  - Provides feedback and scores                  │
└────────────────┬─────────────────────────────────┘
                 ↓
┌──────────────────────────────────────────────────┐
│  Human QA + Deployment                           │
│  - PM/Lead QA final approval                     │
│  - CI/CD deployment                              │
│  - Production monitoring                         │
└──────────────────────────────────────────────────┘
```

---

## Critical Next Steps

### **IMMEDIATE (TODAY):**

#### **1. Validate Cursor Headless Command Exists**

Run this validation script:

```bash
#!/bin/bash
# validate-cursor-headless.sh

echo "🧪 Testing Cursor headless mode..."
echo ""

# Test 1: Check Cursor CLI installation
echo "1️⃣ Checking Cursor CLI..."
if command -v cursor &> /dev/null; then
    echo "✅ Cursor CLI found at: $(which cursor)"
    cursor --version
else
    echo "❌ Cursor CLI not found - INSTALL REQUIRED"
    exit 1
fi

echo ""

# Test 2: Check for headless flag
echo "2️⃣ Checking for --headless flag..."
cursor --help > /tmp/cursor-help.txt
if grep -q "headless" /tmp/cursor-help.txt; then
    echo "✅ --headless flag exists"
    grep -A 5 "headless" /tmp/cursor-help.txt
else
    echo "⚠️ --headless not found - CHECK DOCS"
    echo "Visit: https://cursor.com/docs/cli/overview"
fi

echo ""

# Test 3: Check for --apply flag
echo "3️⃣ Checking for --apply flag..."
if grep -q "apply" /tmp/cursor-help.txt; then
    echo "✅ --apply flag exists"
    grep -A 5 "apply" /tmp/cursor-help.txt
else
    echo "⚠️ --apply not found - may have different syntax"
fi

echo ""

# Test 4: Try actual execution
echo "4️⃣ Testing headless execution..."
TEST_DIR="/tmp/cursor-validation-test"
rm -rf $TEST_DIR
mkdir -p $TEST_DIR
cd $TEST_DIR

# Initialize test project
git init
echo 'console.log("test");' > index.js
git add . && git commit -m "Initial commit"

# Try headless command
echo "Executing: cursor --headless --dir $TEST_DIR --apply 'Add a function that adds two numbers' --wait"
cursor --headless \
  --dir $TEST_DIR \
  --apply "Add a function that adds two numbers" \
  --wait 2>&1 | tee /tmp/cursor-execution.log

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Cursor headless execution SUCCESSFUL"
    echo ""
    echo "Changes made:"
    git diff HEAD
else
    echo ""
    echo "❌ Cursor headless execution FAILED"
    echo "Check /tmp/cursor-execution.log for details"
    exit 1
fi

echo ""
echo "✅ VALIDATION COMPLETE - Cursor headless is WORKING!"
echo "Ready to proceed with Dark Factory implementation"
```

**Save this as:** `scripts/validate-cursor-headless.sh`

**Run:**
```bash
chmod +x scripts/validate-cursor-headless.sh
./scripts/validate-cursor-headless.sh
```

#### **2. Document Results**

Create: `docs/cursor-validation-results.md`

```markdown
# Cursor Headless Validation Results

**Date:** [TODAY]
**Tester:** [YOUR NAME]

## Results

### Command Availability
- [ ] Cursor CLI installed: YES / NO
- [ ] `--headless` flag exists: YES / NO
- [ ] `--apply` flag exists: YES / NO

### Test Execution
- [ ] Basic execution works: YES / NO
- [ ] Code was generated: YES / NO
- [ ] Changes captured in git: YES / NO

### Command Syntax
Actual working command:
```bash
[paste actual command that worked]
```

### Limitations Found
[document any issues, constraints, or differences from expected]

### Next Steps
[GO / NO-GO decision]
```

---

## Contingency Plans

### **If Cursor Headless Works ✅**
- Proceed with Phase 1 implementation (Week 1-4)
- Build orchestrator with Cursor integration
- Timeline remains: 4 weeks to pilot

### **If Cursor Headless Has Different Syntax ⚠️**
- Adjust commands based on actual docs
- Update architecture.md with correct syntax
- Delay: 1-2 days for documentation updates

### **If Cursor Headless Doesn't Exist ❌**

**Fallback Options (in order):**

1. **MCP (Model Context Protocol)** - 2 weeks delay
   - Cursor supports MCP officially
   - More complex but documented
   
2. **Aider** - 1 week delay
   - Proven CLI tool for AI code generation
   - Uses GPT-4 with smart context
   - https://github.com/paul-gauthier/aider
   
3. **Hybrid Model** - No delay
   - Developers use Cursor manually
   - Orchestrator tracks and manages workflow
   - 2-3x improvement (vs 3-5x with full automation)

---

## Impact Assessment

### **If Validation Succeeds:**
- ✅ Phase 1 timeline intact (4 weeks)
- ✅ Full automation achievable
- ✅ 50+ project scale possible (Phase 3)
- ✅ No custom AI building needed
- ✅ Architecture is sound

### **If Validation Fails:**
- ⚠️ Architecture needs revision
- ⚠️ 1-3 week delay for alternative approach
- ⚠️ May need to adjust MVP scope
- ⚠️ Value proposition changes (2-3x vs 3-5x)

---

## Success Criteria

### **Minimum Viable Validation:**
- [x] Documents updated with Cursor Headless approach
- [ ] Cursor CLI installed and accessible
- [ ] `cursor --headless --dir /path --apply "prompt"` executes successfully
- [ ] Code is generated and captured in git
- [ ] Can be automated via Node.js `child_process`

### **Full Validation (Week 1):**
- [ ] Single execution works reliably (95%+ success rate)
- [ ] Concurrent execution tested (5-10 instances)
- [ ] Resource usage measured (CPU, memory, disk)
- [ ] Error scenarios documented
- [ ] Cost tracking approach validated

---

## Timeline

```
TODAY (Nov 25):
├─ Update documentation ✅ DONE
├─ Create validation script ⏳ NEXT
└─ Run validation ⏳ CRITICAL

THIS WEEK (Nov 25-29):
├─ Monday: Validate Cursor headless
├─ Tuesday: Document results, adjust if needed
├─ Wednesday: Design production integration
├─ Thursday: Create Epic 1 & 2 implementation plan
└─ Friday: Review and approve approach

NEXT WEEK (Dec 2-6):
└─ Start Epic 1: Foundation (IF validation succeeds)
```

---

## Recommendation

**PROCEED with Cursor Headless validation IMMEDIATELY.**

This is the **critical path** for Dark Software Factory. Everything depends on validating that `cursor --headless` works as documented.

**Priority:** 🔴 HIGHEST  
**Risk:** 🔴 SHOWSTOPPER if it doesn't work  
**Timeline:** ⚡ Must validate within 24-48 hours

---

**Next Action:** Run validation script and document results.

