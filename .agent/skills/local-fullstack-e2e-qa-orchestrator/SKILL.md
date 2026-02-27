---
name: local-fullstack-e2e-qa-orchestrator
description: |
  Senior-level QA Orchestrator for locally cloned frontend and backend repositories.
  Starts both services, performs human-like UI automation, API validation,
  regression testing, and generates a comprehensive QA report with go/no-go decision.

version: 2.0.0

triggers:
  - 'Run full QA locally'
  - 'Test my frontend and backend'
  - 'Run E2E testing'
  - 'Perform full system QA'
  - 'Generate QA report'
  - 'Run regression suite'

tools:
  - filesystem
  - terminal
  - process-manager
  - browser
  - test-runner
  - coverage
---

# Local Full-Stack E2E QA Orchestrator

## Purpose

This skill acts as a Senior QA Engineer and performs full end-to-end system validation
across two locally cloned repositories (frontend and backend). It launches both services,
simulates real user behavior in a browser, validates API integrity, executes regression
testing, and produces a professional QA report.

---

# Required Inputs

frontend_path: string  
backend_path: string

Optional:

frontend_start_command: string  
backend_start_command: string  
frontend_port: number  
backend_port: number  
health_endpoint: string  
env_variables: key-value map  
test_seed_script: optional

---

# Operating Assumptions

- Both repositories already exist locally
- Agent has full terminal access
- Agent can start background processes
- Browser automation runtime (Playwright preferred) is available
- Execution is performed in a safe dev/test environment

---

# Execution Workflow

---

## Phase 1 — Repository Validation

1. Verify frontend_path exists
2. Verify backend_path exists
3. Detect technology stack in both
4. Detect package managers (npm, yarn, pnpm, pip, maven, etc.)
5. Validate configuration files
6. Install dependencies if missing

If installation fails:

- Capture logs
- Stop execution
- Report root cause

---

## Phase 2 — Environment Preparation

- Inject environment variables if provided
- Setup test database if required
- Run seed script if provided
- Validate configuration consistency

---

## Phase 3 — Backend Startup

1. Navigate to backend_path
2. Run install if necessary
3. Start backend using detected or provided command
4. Run backend as background process
5. Wait for:
   - Port readiness OR
   - Health endpoint response
6. Validate no critical startup errors

If backend fails:

- Capture logs
- Classify root cause
- Abort safely

---

## Phase 4 — Frontend Startup

1. Navigate to frontend_path
2. Install dependencies if required
3. Start frontend server
4. Run as background process
5. Wait until:
   - Port responds
   - UI loads successfully
6. Verify frontend connects to backend

If frontend fails:

- Capture build errors
- Detect proxy/baseURL issues
- Abort safely

---

## Phase 5 — Smoke Testing

Validate:

- Backend running
- Frontend accessible
- Health endpoint OK
- Core route loads
- Authentication endpoint responds
- No fatal runtime errors

---

## Phase 6 — Human-Like UI Automation Testing

Using Playwright or Cypress (auto-detected):

Simulated behaviors:

- Page navigation
- Authentication flows
- Form submission
- CRUD operations
- Search and filtering
- Pagination
- Role-based access
- Logout flow
- Session expiration
- Error message validation

Human-like characteristics:

- Realistic typing delay
- Scroll simulation
- Wait for DOM stability
- Retry transient failures
- Validate visual state changes

Screenshots captured on failure.

---

## Phase 7 — Positive Testing

- Valid credentials login
- Valid form submission
- Successful record creation
- Correct success notifications
- Data persistence validation

---

## Phase 8 — Negative Testing

- Invalid credentials
- Missing required fields
- Invalid payload structure
- Unauthorized access attempt
- Expired token handling
- Invalid URL access

---

## Phase 9 — Edge Case Testing

- Boundary value inputs
- Empty state rendering
- Large payload handling
- Concurrent actions
- Network delay simulation
- Unexpected user flow transitions

---

## Phase 10 — API Validation Layer

- Validate status codes
- Validate response schema
- Validate error structure
- Validate auth enforcement
- Measure response time
- Detect unprotected endpoints

---

## Phase 11 — Regression Testing

- Run backend unit tests
- Run frontend unit tests
- Run integration tests
- Identify coverage gaps
- Detect flaky tests
- Aggregate coverage metrics

Target coverage goal: ≥ 80% if feasible

---

## Phase 12 — Data Integrity Validation

- Create via UI → verify via API
- Update via UI → verify persistence
- Delete via UI → verify removal
- Validate relational consistency

---

# Process Lifecycle Management

The agent must:

- Start backend in background
- Wait for readiness
- Start frontend in background
- Execute tests
- Collect logs
- Gracefully terminate both processes
- Ensure no orphan processes remain

If interruption occurs:

- Kill child processes safely
- Cleanup temp files

---

# Security Sanity Checks

- Missing authentication guards
- Exposed admin routes
- Basic injection payload detection (non-destructive)
- CORS misconfiguration
- Sensitive data exposure

---

# Performance Snapshot

- Initial page load time
- Slowest API endpoints
- Bundle size detection (frontend)
- Blocking synchronous operations

---

# Defect Classification

Critical — System unusable  
Major — Core feature broken  
Medium — Functional issue with workaround  
Minor — Cosmetic issue

Each defect includes:

- Title
- Severity
- Steps to reproduce
- Expected result
- Actual result
- Logs
- Screenshot
- API trace (if applicable)

---

# Generated Outputs

## 1. QA Report (Markdown)

Includes:

- Executive Summary
- System Health Matrix
- Smoke Results
- UI Test Results
- API Validation Results
- Regression Summary
- Coverage Metrics
- Bug List
- Security Findings
- Performance Observations
- Risk Assessment
- Go / No-Go Recommendation

---

## 2. Machine-Readable JSON

{
"summary": {},
"frontend_status": {},
"backend_status": {},
"integration_status": {},
"coverage": {},
"bugs": [],
"security_findings": [],
"performance_metrics": {},
"recommendation": "GO | NO_GO"
}

---

# Success Criteria

- Both services start successfully
- Core flows validated
- No Critical defects
- Major defects documented
- Coverage ≥ 80% where feasible
- Clear deployment recommendation

---

# When To Use

- Before production release
- After feature integration
- During release freeze
- Before investor demo
- Before client delivery

---

# When Not To Use

- Production penetration testing
- Destructive DB testing
- High-scale load testing
- Live production environments

---

# Example Usage

User:

Run full QA locally with:

frontend_path: /projects/app/frontend  
backend_path: /projects/app/backend

Agent:

- Validates repos
- Starts backend
- Starts frontend
- Runs browser automation
- Executes regression tests
- Generates QA report
- Provides Go / No-Go decision
- Shuts down services safely
