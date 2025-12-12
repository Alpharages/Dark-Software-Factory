# Scripts Directory - Quick Reference

## Available Scripts

### Testing & Validation

**verify-quick-start.js** - Pre-flight configuration check
```bash
node scripts/verify-quick-start.js
```
Validates environment setup before running tests (GITHUB_DEFAULT_REPOSITORY, etc.)

**test-e2e-standalone.js** - End-to-end workflow test
```bash
# Quick test (skip AI execution)
node scripts/test-e2e-standalone.js --skip-ai

# Full test with real AI
node scripts/test-e2e-standalone.js

# Cleanup test data
node scripts/test-e2e-standalone.js --cleanup
```
Tests all 10 workflow stages from ticket creation to deployment.

---

### Database Testing

**create-test-ticket.sql** - Create test ticket
```bash
psql "$DATABASE_URL" -f scripts/create-test-ticket.sql
```
Creates a test ticket in the database for manual testing.

**simulate-execution-complete.sql** - Simulate AI completion
```bash
psql "$DATABASE_URL" -f scripts/simulate-execution-complete.sql
```
Manually marks an execution as complete for testing downstream flows.

---

### Manual Triggers

**trigger-qa-check.js** - Trigger QA automation manually
```bash
node scripts/trigger-qa-check.js <ticket-id>
```
Manually triggers QA automation for a specific ticket/execution.

---

### AI Provider Validation

**validate-ai-providers.sh** - Validate all AI providers
```bash
./scripts/validate-ai-providers.sh
```
Comprehensive check of Cursor Headless and Claude Code setup.

**validate-cursor-headless.sh** - Cursor-specific validation
```bash
./scripts/validate-cursor-headless.sh
```
Deep validation of Cursor CLI installation and configuration.

---

### Development

**generate-modules.sh** - Scaffold new NestJS modules
```bash
./scripts/generate-modules.sh <module-name>
```
Generates boilerplate for new feature modules.

---

## Documentation

**README-TESTING.md** - Complete testing guide
Detailed instructions for testing workflows, troubleshooting, and understanding test scripts.

---

## Archived Scripts

Obsolete/duplicate scripts are in `scripts/.archive/`:
- test-complete-workflow.js (superseded by test-e2e-standalone.js)
- test-ticket-workflow.js (duplicate)
- test-ticket-workflow.ts (unused TypeScript version)
- publish-test-message.js (basic publisher, now in E2E test)
- quick-publish.js (hardcoded test, now in E2E test)
- trigger-workflow-test.sh (bash version, superseded)

---

## Quick Start

**1. First-time setup:**
```bash
node scripts/verify-quick-start.js
```

**2. Run E2E test:**
```bash
node scripts/test-e2e-standalone.js --skip-ai
```

**3. Validate AI providers:**
```bash
./scripts/validate-ai-providers.sh
```
