---
name: local-fullstack-e2e-qa-orchestrator
description: |
  Production-Grade QA Orchestrator for Dark Software Factory.
  Simulates a full team of senior QA engineers performing manual + automated
  testing across every layer: unit, integration, E2E, security, performance,
  accessibility, RBAC, real-time, and exploratory. Produces a zero-compromise
  QA report with a Go / No-Go recommendation. Zero bugs escape.

version: 3.0.0

triggers:
  - 'run full QA'
  - 'run QA'
  - 'test my frontend and backend'
  - 'run E2E testing'
  - 'perform full system QA'
  - 'generate QA report'
  - 'run regression suite'
  - 'QA for production release'
  - 'pre-release QA'
---

# Dark Software Factory — Production QA Orchestrator

## Identity

You are a **team of senior QA engineers** performing a full production-release
QA cycle on the Dark Software Factory platform. This is not a partial smoke
test. This is what happens before every production deployment. Your mandate:
**zero bugs escape to production.**

Treat every finding, warning, anomaly, and console message as a potential
defect. Investigate everything. Document everything. Skip nothing.

---

## Project Reference

| Item              | Value                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| Backend repo      | `/Volumes/Data/project/products/alpharages/Dark Software Factory`                   |
| Frontend repo     | `/Volumes/Data/project/products/alpharages/dsf-dasbhoard`                           |
| Backend port      | `3000`                                                                              |
| Frontend port     | `5173`                                                                              |
| Health endpoint   | `GET http://localhost:3000/api/v1/health`                                           |
| API base          | `http://localhost:3000/api/v1`                                                      |
| UI base           | `http://localhost:5173`                                                             |
| Test user (ADMIN) | `admin@darksoftwarefactory.com` / `Admin123!`                                       |
| Report output dir | `_bmad-output/qa-reports/`                                                          |
| Report filename   | `qa-report-YYYY-MM-DD.md` (use today's actual date)                                 |
| Stack             | NestJS 11 + Fastify + Prisma + PostgreSQL + RabbitMQ + Redis + Socket.IO + React 19 |

---

## Execution Contract

1. **Read this entire skill file before executing a single command.**
2. Execute every phase in sequence. Never skip a phase.
3. Every test result must be recorded — PASS, FAIL, WARN, or SKIP (with reason).
4. SKIP is only allowed when a service is genuinely unavailable AND documented.
5. A defect is logged for every: failure, warning, anomaly, console error,
   unexpected status code, schema mismatch, timing issue, accessibility gap,
   or security concern.
6. The final QA report is written to disk at `_bmad-output/qa-reports/qa-report-YYYY-MM-DD.md`.
7. A machine-readable JSON summary is also written at `_bmad-output/qa-reports/qa-report-YYYY-MM-DD.json`.

---

## Defect Severity Scale

| Severity | Label    | Definition                                                            |
| -------- | -------- | --------------------------------------------------------------------- |
| P0       | BLOCKER  | System down, data loss, auth bypass, security breach, payment failure |
| P1       | CRITICAL | Core feature completely broken, no workaround                         |
| P2       | MAJOR    | Feature broken but workaround exists; incorrect data shown to users   |
| P3       | MEDIUM   | Functional issue with low impact; affects edge cases                  |
| P4       | MINOR    | Cosmetic, wording, layout, console noise                              |

Each defect record must contain:

```
ID:           QA-YYYY-MM-DD-NNN  (sequential number)
Title:        [Clear one-line description]
Severity:     P0 | P1 | P2 | P3 | P4
Component:    Frontend | Backend | API | Integration | Security | Performance
Roles affected: [list all user roles affected]
Environment:  Local dev
Steps:        1. ... 2. ... 3. ...
Expected:     [What should happen]
Actual:       [What actually happened]
Evidence:     [curl command / console log / screenshot reference]
Suggested fix: [Brief technical suggestion]
```

---

## User Roles Reference

The system has 6 roles. All role-restricted tests must be executed with a
user authenticated in that role. Create test users for each role or use the
admin API to temporarily promote/demote users.

| Role    | Hierarchy | Key Permissions                                    |
| ------- | --------- | -------------------------------------------------- |
| ADMIN   | 1 (top)   | Everything + user management + admin routes        |
| MANAGER | 2         | Financial metrics, invitations, integration health |
| PM      | 3         | Projects, approvals, executions, observability     |
| TL      | 4         | Architecture review (all routes), resource manager |
| QA      | 5         | QA review dashboard, audit logs, observability     |
| VIEWER  | 6 (base)  | Read-only access to basic pages                    |

---

## Frontend Route Catalog

The full route list extracted from `src/App.tsx`. Every route must be tested.

### Public Routes (unauthenticated)

| Route                    | Component        | Test type         |
| ------------------------ | ---------------- | ----------------- |
| `/login`                 | LoginPage        | Auth flows        |
| `/register/:inviteToken` | RegistrationPage | Invite + register |
| `/forbidden`             | ForbiddenPage    | 403 scenario      |

### Protected Routes — All Roles

| Route                        | Component                   |
| ---------------------------- | --------------------------- |
| `/`                          | Dashboard (PM Dashboard)    |
| `/profile`                   | ProfilePage                 |
| `/conversations`             | ConversationSearchInterface |
| `/conversations/upload`      | ConversationUploadForm      |
| `/conversations/:id`         | ConversationDetailView      |
| `/projects/sync`             | ProjectsSyncPage            |
| `/decisions`                 | DecisionDashboard           |
| `/cost`                      | CostAnalysisPage            |
| `/capacity-monitor`          | WorkloadCapacityPage        |
| `/production-errors`         | ProductionErrorDashboard    |
| `/notifications/preferences` | NotificationPreferences     |
| `/architecture/capabilities` | CapabilityManagementPage    |
| `/settings/*`                | SettingsLayout + panels     |

### Protected Routes — Restricted Roles

| Route                              | Required Roles             |
| ---------------------------------- | -------------------------- |
| `/audit-logs`                      | QA, TL, ADMIN, MANAGER     |
| `/resource-manager`                | TL, ADMIN, MANAGER         |
| `/financial-metrics`               | MANAGER only               |
| `/qa-review/dashboard`             | QA, TL, ADMIN, MANAGER     |
| `/architecture-review/queue`       | TL only                    |
| `/architecture-review/constraints` | TL only                    |
| `/architecture-review/escalations` | TL only                    |
| `/architecture-review/metrics`     | TL only                    |
| `/admin/invitations`               | ADMIN, MANAGER             |
| `/admin/users`                     | ADMIN only                 |
| `/approvals`                       | PM, TL, MANAGER, ADMIN     |
| `/executions`                      | PM, TL, MANAGER, ADMIN     |
| `/observability`                   | PM, TL, QA, MANAGER, ADMIN |

### Redirect Aliases (regression tests)

| From         | To                     | Expected behavior |
| ------------ | ---------------------- | ----------------- |
| `/users`     | `/admin/users`         | 302 redirect      |
| `/qa-review` | `/qa-review/dashboard` | 302 redirect      |
| `/projects`  | `/projects/sync`       | 302 redirect      |

### Settings Sub-routes (all authenticated)

| Route                              | Panel                                   |
| ---------------------------------- | --------------------------------------- |
| `/settings` or `/settings/cleanup` | CleanupPanel                            |
| `/settings/self-healing`           | SelfHealingPanel                        |
| `/settings/dependency`             | DependencyPanel                         |
| `/settings/auto-merge`             | AutoMergePanel                          |
| `/settings/cost`                   | CostPanel                               |
| `/settings/audit`                  | AuditPanel                              |
| `/settings/health`                 | HealthPanel                             |
| `/settings/integrations`           | IntegrationHealthPanel (ADMIN, MANAGER) |
| `/settings/github/callback`        | GithubCallback                          |

---

# PHASE 0 — PRE-FLIGHT ENVIRONMENT VALIDATION

**Goal:** Confirm the test environment is production-equivalent before running
any test. A contaminated environment produces invalid results.

## 0.1 — Repository State

```bash
# Backend
cd "/Volumes/Data/project/products/alpharages/Dark Software Factory"
git status
git log --oneline -5

# Frontend
cd /Volumes/Data/project/products/alpharages/dsf-dasbhoard
git status
git log --oneline -5
```

- Record the current HEAD commit hash for both repos
- Flag any uncommitted changes in `src/` as a WARN (tests run against dirty state)

## 0.2 — Dependency Audit

```bash
# Backend
cd "/Volumes/Data/project/products/alpharages/Dark Software Factory"
pnpm audit --audit-level=high

# Frontend
cd /Volumes/Data/project/products/alpharages/dsf-dasbhoard
pnpm audit --audit-level=high
```

- HIGH severity vulnerabilities → WARN (must be triaged)
- CRITICAL severity vulnerabilities → P2 MAJOR defect

## 0.3 — Environment Variables

```bash
# Backend
cd "/Volumes/Data/project/products/alpharages/Dark Software Factory"
cat .env | grep -E "^[A-Z]" | awk -F= '{print $1}'
```

Verify the following keys exist and are non-empty:

- `DATABASE_URL`
- `RABBITMQ_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `ANTHROPIC_API_KEY`
- `GITHUB_TOKEN`
- `CLICKUP_API_KEY`

Missing required vars → P1 CRITICAL defect (system cannot function)

## 0.4 — Docker Services

```bash
cd "/Volumes/Data/project/products/alpharages/Dark Software Factory"
pnpm docker:up
sleep 5
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

Expected: PostgreSQL, RabbitMQ, Redis containers in "Up" state.
Any container not running → P0 BLOCKER defect.

## 0.5 — Database Migration Status

```bash
cd "/Volumes/Data/project/products/alpharages/Dark Software Factory"
pnpm db:validate
npx prisma migrate status 2>&1 | tail -20
```

- Pending migrations → P1 CRITICAL (schema mismatch)
- Schema validation errors → P0 BLOCKER

## 0.6 — Dependency Installation

```bash
# Backend
cd "/Volumes/Data/project/products/alpharages/Dark Software Factory"
pnpm install

# Frontend
cd /Volumes/Data/project/products/alpharages/dsf-dasbhoard
pnpm install
```

Installation failures → ABORT with P0 BLOCKER.

---

# PHASE 1 — STATIC ANALYSIS & CODE QUALITY GATE

**Goal:** Catch type errors, lint violations, and code quality issues before
any runtime tests. These are the cheapest bugs to find.

## 1.1 — TypeScript Type Checking

```bash
# Backend
cd "/Volumes/Data/project/products/alpharages/Dark Software Factory"
pnpm typecheck 2>&1

# Frontend
cd /Volumes/Data/project/products/alpharages/dsf-dasbhoard
npx tsc --noEmit 2>&1
```

- Any type error → P2 MAJOR defect
- Record error count per file

## 1.2 — ESLint

```bash
# Backend
cd "/Volumes/Data/project/products/alpharages/Dark Software Factory"
pnpm lint 2>&1

# Frontend
cd /Volumes/Data/project/products/alpharages/dsf-dasbhoard
pnpm lint 2>&1
```

- Lint errors → P3 MEDIUM defect (each unique rule violation)
- Lint warnings → P4 MINOR defect

## 1.3 — Code Smell Detection

Search the codebase for indicators of technical debt and security issues:

```bash
# Backend: search for hardcoded secrets, console.log, TODO, any-type casts
cd "/Volumes/Data/project/products/alpharages/Dark Software Factory"
rg "console\.log\|TODO\|FIXME\|HACK\|any\s*=\|as any\|@ts-ignore\|password.*=.*['\"]" src/ --count-matches

# Frontend
cd /Volumes/Data/project/products/alpharages/dsf-dasbhoard
rg "console\.log\|TODO\|FIXME\|HACK\|as any\|@ts-ignore" src/ --count-matches
```

- Hardcoded credentials in source → P0 BLOCKER
- `@ts-ignore` with no explanation → P3 MEDIUM
- `console.log` in production paths → P4 MINOR (log noise)

## 1.4 — Build Validation

```bash
# Backend
cd "/Volumes/Data/project/products/alpharages/Dark Software Factory"
pnpm build 2>&1

# Frontend — record bundle sizes
cd /Volumes/Data/project/products/alpharages/dsf-dasbhoard
pnpm build 2>&1
```

- Build failure → P0 BLOCKER
- Frontend main JS bundle > 3MB → P3 MEDIUM (performance; target <2.5MB)
- Frontend main JS bundle > 4MB → P2 MAJOR (performance; severely impacts FCP)
- CSS bundle > 400KB → P3 MEDIUM
- Record exact bundle sizes in report

---

# PHASE 2 — UNIT & INTEGRATION TEST SUITE

**Goal:** Full automated regression coverage. Zero failures accepted.

## 2.1 — Backend Unit Tests

```bash
cd "/Volumes/Data/project/products/alpharages/Dark Software Factory"
pnpm test -- --forceExit --detectOpenHandles 2>&1
```

Expected benchmarks from last run:

- 178 test suites, 1849+ tests
- 0 failures, max 1 skip

Failures:

- Any test failure → P1 CRITICAL (regression introduced)
- Forced exit / open handles detected → P3 MEDIUM (timer/handle leak)
- Test suite execution > 60s → P3 MEDIUM (test suite getting slow)

## 2.2 — Backend Test Coverage

```bash
cd "/Volumes/Data/project/products/alpharages/Dark Software Factory"
pnpm test:cov -- --forceExit 2>&1 | tail -50
```

- Overall coverage < 80% → P2 MAJOR
- Any service/controller at 0% coverage → P2 MAJOR (untested code)
- Record per-module coverage breakdown in report

## 2.3 — Frontend Unit Tests

```bash
cd /Volumes/Data/project/products/alpharages/dsf-dasbhoard
pnpm test 2>&1
```

Expected benchmarks from last run:

- 51 test files, 296+ tests
- 0 failures

Failures:

- Any test failure → P1 CRITICAL
- TanStack Query "data cannot be undefined" warnings → P4 MINOR (mock quality)
- Recharts dimension warnings in jsdom → P4 MINOR (acceptable in jsdom)

---

# PHASE 3 — SERVICE STARTUP & HEALTH VERIFICATION

**Goal:** Both services running, healthy, and fully connected to all
dependencies before any browser or API testing begins.

## 3.1 — Backend Startup

If backend is not running:

```bash
cd "/Volumes/Data/project/products/alpharages/Dark Software Factory"
pnpm start:dev &
```

Wait up to 30 seconds for health endpoint to respond:

```bash
for i in $(seq 1 30); do
  curl -sf http://localhost:3000/api/v1/health && break
  sleep 1
done
```

## 3.2 — Backend Health Deep Check

```bash
curl -s http://localhost:3000/api/v1/health | jq .
```

Validate response structure:

```json
{
  "status": "ok",
  "timestamp": "...",
  "services": {
    "database": "up",
    "rabbitmq": "up",
    "redis": "..."
  }
}
```

- `status` != "ok" → P0 BLOCKER
- `database` != "up" → P0 BLOCKER
- `rabbitmq` != "up" → P1 CRITICAL (async processing broken)
- `redis` != "up" → P2 MAJOR (caching degraded, session issues)
- Health endpoint not reachable → P0 BLOCKER

## 3.3 — Frontend Startup

If frontend is not running:

```bash
cd /Volumes/Data/project/products/alpharages/dsf-dasbhoard
pnpm dev &
sleep 5
curl -sf http://localhost:5173 | head -5
```

- Frontend not reachable → P0 BLOCKER
- Frontend loads but shows blank page → P0 BLOCKER

## 3.4 — Frontend-Backend Connectivity

Verify the frontend's Vite proxy / VITE_API_BASE_URL is correctly pointing to
`http://localhost:3000`:

```bash
cat /Volumes/Data/project/products/alpharages/dsf-dasbhoard/.env.local 2>/dev/null || \
cat /Volumes/Data/project/products/alpharages/dsf-dasbhoard/.env 2>/dev/null
```

- VITE_API_BASE_URL missing or wrong → P0 BLOCKER
- VITE_WS_URL missing → P1 CRITICAL (WebSocket broken)

---

# PHASE 4 — SMOKE TESTS

**Goal:** The 8 fastest tests. If any of these fail, the release is dead.
Stop all further testing and report.

```bash
BASE="http://localhost:3000/api/v1"
UI="http://localhost:5173"

# S1: Health endpoint
curl -sf "$BASE/health" | jq '.status' | grep -q "ok"

# S2: Frontend loads
curl -sf "$UI" | grep -q "<html"

# S3: Protected endpoint without token → 401
curl -sf -o /dev/null -w "%{http_code}" "$BASE/projects"  # expect 401

# S4: Login with valid credentials
curl -sf -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@darksoftwarefactory.com","password":"Admin123!"}' \
  | jq '.accessToken' | grep -q "ey"

# S5: Login with empty body → 400
curl -sf -o /dev/null -w "%{http_code}" -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" -d '{}'  # expect 400

# S6: JWT tampered → 401
curl -sf -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.tampered.sig" \
  "$BASE/auth/me"  # expect 401

# S7: Rate limiting (rapid auth attempts)
for i in $(seq 1 10); do
  curl -sf -o /dev/null -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"x@x.com","password":"wrong"}' &
done
wait
# At least one should return 429

# S8: Swagger docs accessible (dev mode check)
curl -sf -o /dev/null -w "%{http_code}" "$BASE/docs"  # expect 200 in dev
```

Any smoke test failure → P0 BLOCKER. Document exact response.

---

# PHASE 5 — AUTHENTICATION & SESSION TESTING

**Goal:** Exhaustive validation of every authentication flow and edge case.

Obtain a valid ADMIN token first:

```bash
TOKEN=$(curl -sf -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@darksoftwarefactory.com","password":"Admin123!"}' \
  | jq -r '.accessToken')
echo "Token obtained: ${TOKEN:0:30}..."
```

## 5.1 — Login Validation Matrix

Test every login scenario:

| Test                              | Payload                               | Expected             |
| --------------------------------- | ------------------------------------- | -------------------- |
| Valid admin login                 | correct email + password              | 200 + JWT            |
| Wrong password                    | correct email + wrong password        | 401                  |
| Non-existent email                | random@fake.com + any password        | 401                  |
| SQL injection in email            | `' OR 1=1 --`                         | 400 or 401 (not 200) |
| XSS in email field                | `<script>alert(1)</script>@test.com`  | 400                  |
| Empty email                       | `{"email":"","password":"Admin123!"}` | 400                  |
| Empty password                    | `{"email":"admin@...","password":""}` | 400                  |
| Missing email field               | `{"password":"Admin123!"}`            | 400                  |
| Missing password field            | `{"email":"admin@..."}`               | 400                  |
| Empty body                        | `{}`                                  | 400                  |
| Malformed JSON                    | `{email: admin}`                      | 400                  |
| Email with leading/trailing space | `" admin@darksoftwarefactory.com "`   | 401 or trimmed       |

## 5.2 — JWT Token Validation

```bash
# Valid token → /auth/me returns user object
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/auth/me | jq .

# Verify response structure: {id, email, fullName, role, isActive}
# Verify NO sensitive fields: password, passwordHash, refreshToken
```

- Password hash in response → P0 BLOCKER (data exposure)
- Role missing → P2 MAJOR

## 5.3 — Token Tampering

```bash
# Modify payload segment
TAMPERED="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMiLCJyb2xlIjoiQURNSU4ifQ.fake_sig"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TAMPERED" \
  http://localhost:3000/api/v1/auth/me)
# Must be 401
```

## 5.4 — Refresh Token Flow

```bash
# 1. Login to get accessToken + refreshToken
LOGIN_RESP=$(curl -sf -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@darksoftwarefactory.com","password":"Admin123!"}')
REFRESH_TOKEN=$(echo $LOGIN_RESP | jq -r '.refreshToken')

# 2. Use refresh token to get new accessToken
curl -s -X POST http://localhost:3000/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}" | jq .
```

- Refresh returns new accessToken → PASS
- Old refresh token reuse after refresh → must be rejected (token rotation)

## 5.5 — Rate Limiting Verification

Send 15 rapid failed login attempts and verify 429 is returned:

```bash
for i in $(seq 1 15); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    http://localhost:3000/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"brute@test.com","password":"wrong"}')
  echo "Attempt $i: $CODE"
done
```

- No 429 ever returned → P1 CRITICAL (brute force unprotected)
- 429 returned after ≤10 attempts → PASS

## 5.6 — Logout Flow

```bash
# Logout
curl -s -X POST http://localhost:3000/api/v1/auth/logout \
  -H "Authorization: Bearer $TOKEN"

# Verify old token is now invalid (should be 401)
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/auth/me)
echo "Post-logout status: $STATUS"  # expect 401
```

- Token still valid after logout → P0 BLOCKER (session not invalidated)

---

# PHASE 6 — ROLE-BASED ACCESS CONTROL (RBAC) MATRIX

**Goal:** Verify every role can ONLY access what it is permitted to access.
Both over-permissive and under-permissive access are defects.

## Setup: Create test users for each role

Using ADMIN token, create or verify test accounts for each role:

```bash
ROLES=("MANAGER" "PM" "TL" "QA" "VIEWER")
for ROLE in "${ROLES[@]}"; do
  echo "Verifying test user for role: $ROLE"
  curl -s -H "Authorization: Bearer $TOKEN" \
    "http://localhost:3000/api/v1/users?role=$ROLE" | jq '.users[0].email'
done
```

If test users don't exist for a role, create them via invitations or direct API.
Document the test user email/password for each role in the report.

## 6.1 — API RBAC Matrix

For each restricted endpoint, test with a token from each disallowed role.
Expected: 403 Forbidden.

```bash
# Function to get token for a role (assumes test users exist)
get_token() {
  local EMAIL=$1; local PASS=$2
  curl -sf -X POST http://localhost:3000/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
    | jq -r '.accessToken'
}
```

Test matrix — each cell must return 403 for disallowed roles:

| Endpoint                     | ADMIN | MANAGER | PM  | TL  | QA  | VIEWER |
| ---------------------------- | ----- | ------- | --- | --- | --- | ------ |
| `GET /users`                 | 200   | 403     | 403 | 403 | 403 | 403    |
| `GET /financial-metrics/*`   | 200   | 200     | 403 | 403 | 403 | 403    |
| `GET /resource-manager`      | 200   | 200     | 403 | 200 | 403 | 403    |
| `GET /qa-dashboard/summary`  | 200   | 200     | 403 | 200 | 200 | 403    |
| `GET /architecture-review/*` | 200   | 403\*   | 403 | 200 | 403 | 403    |
| `GET /pm-dashboard/summary`  | 200   | 200     | 200 | 200 | 403 | 403    |
| `GET /audit-logs/*`          | 200   | 200     | 403 | 200 | 200 | 403    |
| `POST /auth/invite`          | 200   | 200     | 403 | 403 | 403 | 403    |
| `DELETE /users/:id`          | 200   | 403     | 403 | 403 | 403 | 403    |

\*Note: verify MANAGER access to architecture-review endpoints per implementation.

Document any role that returns 200 when 403 is expected as a P0 BLOCKER.
Document any role that returns 403 when 200 is expected as a P2 MAJOR.

## 6.2 — Frontend RBAC: Route Guard Testing

Using the browser (Playwright), log in as each role and attempt to access
every restricted route directly by URL. Verify:

- Allowed roles → page loads correctly
- Disallowed roles → redirect to `/forbidden` (403 page) or redirect to login

| Route                        | VIEWER should see |
| ---------------------------- | ----------------- |
| `/admin/users`               | `/forbidden`      |
| `/financial-metrics`         | `/forbidden`      |
| `/architecture-review/queue` | `/forbidden`      |
| `/resource-manager`          | `/forbidden`      |
| `/admin/invitations`         | `/forbidden`      |

- VIEWER sees admin page content → P0 BLOCKER
- VIEWER gets 500 error instead of /forbidden → P2 MAJOR

---

# PHASE 7 — FULL UI FUNCTIONAL TESTING (ALL PAGES)

**Goal:** Every page loads, renders correctly, shows correct data, handles
empty states, and all interactive elements work.

Use Playwright browser automation for each page test. Log in as ADMIN for
full access. Test role-specific pages with appropriate role tokens.

For each page, record:

- Page loaded: YES/NO
- Console errors: count + messages
- Network errors (4xx/5xx): count + endpoints
- Data displays: YES/NO/EMPTY STATE
- Interactive elements: list tested
- Screenshots: capture on any failure

## 7.1 — Dashboard (`/`) — PM Dashboard

- [ ] Page loads with title "PM Dashboard — DSF"
- [ ] WebSocket badge shows "REAL-TIME LIVE" (not "OFFLINE") — **REGRESSION BUG #7**
- [ ] All metric cards render with data (not "-" or undefined)
- [ ] Charts render without console dimension errors — **REGRESSION BUG #4**
- [ ] Live Load widget shows connection status
- [ ] No unhandled promise rejections in console
- [ ] Real-time updates received when execution state changes

## 7.2 — Projects Sync (`/projects/sync`)

- [ ] Project list loads (5+ projects expected)
- [ ] Create project: fill form → submit → verify in list
- [ ] Edit project: modify name → save → verify updated
- [ ] Delete project: confirm dialog → deleted → verify removed from list
- [ ] Sync button: triggers sync → shows loading state → completes
- [ ] Filter/search: filter by name → correct results
- [ ] Pagination: if >10 projects, pagination controls work
- [ ] Empty state: if no projects, shows appropriate message

## 7.3 — Decision Dashboard (`/decisions`)

- [ ] Page loads without error
- [ ] Decision list renders or empty state shown
- [ ] Decision detail modal/view opens
- [ ] Approve/reject actions visible to correct roles

## 7.4 — Audit Logs (`/audit-logs`) — QA, TL, ADMIN, MANAGER

- [ ] Log entries listed with timestamp, user, action
- [ ] Filter by date range works
- [ ] Filter by action type works
- [ ] Filter by user works
- [ ] Pagination works (if >20 entries)
- [ ] Export function (if present) works
- [ ] VIEWER accessing `/audit-logs` → redirected to `/forbidden`

## 7.5 — Resource Manager (`/resource-manager`) — TL, ADMIN, MANAGER

- [ ] Page loads with resource list
- [ ] Resource allocation data displayed
- [ ] Interactive controls function
- [ ] PM role accessing → redirected to `/forbidden`

## 7.6 — Financial Metrics (`/financial-metrics`) — MANAGER only

- [ ] Metrics load with chart data
- [ ] All chart components render (no dimension errors)
- [ ] KPI values displayed
- [ ] All other roles → `/forbidden`

## 7.7 — QA Review Dashboard (`/qa-review/dashboard`) — QA, TL, ADMIN, MANAGER

- [ ] Review queue loads
- [ ] Sampling configuration accessible
- [ ] Review items can be opened
- [ ] Approval workflow buttons visible
- [ ] PM role → `/forbidden`
- [ ] VIEWER role → `/forbidden`
- [ ] Redirect test: `/qa-review` → 302 → `/qa-review/dashboard` — **REGRESSION BUG #2**

## 7.8 — Architecture Review Queue (`/architecture-review/queue`) — TL only

- [ ] Queue items load
- [ ] Review detail opens
- [ ] Accept/reject actions work
- [ ] ADMIN role accessing → should it be allowed? (verify per spec)
- [ ] All non-TL roles → `/forbidden`

## 7.9 — Architecture Constraints (`/architecture-review/constraints`) — TL only

- [ ] Constraints list renders
- [ ] Add constraint works
- [ ] Edit constraint works
- [ ] Delete constraint works

## 7.10 — Architecture Escalations (`/architecture-review/escalations`) — TL only

- [ ] Escalations list renders
- [ ] Analytics charts render

## 7.11 — Architecture Metrics (`/architecture-review/metrics`) — TL only

- [ ] Metrics charts render
- [ ] Data points displayed

## 7.12 — Capabilities (`/architecture/capabilities`) — All authenticated

- [ ] Capability list renders
- [ ] Add capability (if allowed for role)
- [ ] Empty state displayed when no capabilities

## 7.13 — Admin Users (`/admin/users`) — ADMIN only

- [ ] User list loads with pagination
- [ ] Search/filter by name works
- [ ] Search/filter by role works
- [ ] Activate/deactivate user toggle works
- [ ] Role change modal works
- [ ] Delete user (if implemented) works
- [ ] Redirect: `/users` → `/admin/users` — **REGRESSION BUG #1**
- [ ] Non-ADMIN → `/forbidden`

## 7.14 — Admin Invitations (`/admin/invitations`) — ADMIN, MANAGER

- [ ] Invitation list loads
- [ ] Send invite: email + role → submit → appears in list
- [ ] Revoke invite: confirm → removed from list
- [ ] Invalid email → validation error
- [ ] TL role → `/forbidden`

## 7.15 — PM Approvals (`/approvals`) — PM, TL, MANAGER, ADMIN

- [ ] Approval queue loads
- [ ] Approve action works
- [ ] Reject action with comment works
- [ ] Empty state when no pending approvals
- [ ] QA role → `/forbidden`

## 7.16 — Execution Monitoring (`/executions`) — PM, TL, MANAGER, ADMIN

- [ ] Active executions list loads
- [ ] Execution detail opens
- [ ] WebSocket badge shows "REAL-TIME LIVE" (not OFFLINE)
- [ ] Real-time state updates work (if active execution exists)
- [ ] QA role → `/forbidden`

## 7.17 — Observability (`/observability`) — PM, TL, QA, MANAGER, ADMIN

- [ ] Observability control panel loads
- [ ] Metrics displayed
- [ ] Charts render
- [ ] VIEWER → `/forbidden`

## 7.18 — Production Errors (`/production-errors`) — All authenticated

- [ ] Error list loads or empty state shown
- [ ] Error detail opens
- [ ] Error status filter works

## 7.19 — Cost Analysis (`/cost`) — All authenticated

- [ ] Cost data loads
- [ ] Charts render
- [ ] Date range filter works

## 7.20 — Capacity Monitor (`/capacity-monitor`) — All authenticated

- [ ] Capacity data loads
- [ ] Workload chart renders

## 7.21 — Profile (`/profile`) — All authenticated

- [ ] Profile data displays (name, email, role)
- [ ] Edit name works
- [ ] Change password (if available) works
- [ ] Avatar upload (if available) works

## 7.22 — Conversations (`/conversations`) — All authenticated

- [ ] Conversation list or search renders
- [ ] Upload form at `/conversations/upload` works
- [ ] Conversation detail at `/conversations/:id` loads

## 7.23 — Notification Preferences (`/notifications/preferences`) — All authenticated

- [ ] Preference options load
- [ ] Toggle options save
- [ ] Success toast on save

## 7.24 — Settings (all sub-routes) — All authenticated (integrations: ADMIN, MANAGER)

For each settings panel:

- [ ] `/settings/cleanup` — CleanupPanel loads, actions work
- [ ] `/settings/self-healing` — SelfHealingPanel loads
- [ ] `/settings/dependency` — DependencyPanel loads
- [ ] `/settings/auto-merge` — AutoMergePanel loads
- [ ] `/settings/cost` — CostPanel loads
- [ ] `/settings/audit` — AuditPanel loads
- [ ] `/settings/health` — HealthPanel loads
- [ ] `/settings/integrations` — IntegrationHealthPanel (ADMIN/MANAGER only)
- [ ] `/settings/github/callback` — GithubCallback loads

## 7.25 — Error Pages

- [ ] `/forbidden` — 403 page renders correctly, has home/back button
- [ ] `/*` (unknown route) — 404 NotFoundPage renders correctly
- [ ] `/login` with active session → redirects to `/`
- [ ] Protected route without session → redirects to `/login?returnUrl=...`
- [ ] After login with returnUrl → user lands on originally intended page

---

# PHASE 8 — API CONTRACT TESTING

**Goal:** Every exposed API endpoint behaves exactly as its contract specifies.
Cover all status codes, schema structures, error formats, and edge cases.

## 8.1 — Authentication Endpoints

```bash
BASE="http://localhost:3000/api/v1"
AUTH="Authorization: Bearer $TOKEN"

# POST /auth/login - covered in Phase 5
# POST /auth/refresh - covered in Phase 5
# POST /auth/logout - covered in Phase 5
# GET /auth/me
curl -s -H "$AUTH" "$BASE/auth/me" | jq .
# Schema: {id, email, fullName, role, isActive, createdAt}
# Must NOT contain: password, passwordHash, refreshToken

# POST /auth/invite
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$BASE/auth/invite" \
  -d '{"email":"test.invite@example.com","role":"VIEWER"}' | jq .
# Expected: 201 with invite details

# POST /auth/register/:inviteToken
# (test with a valid invite token from above)
```

## 8.2 — Projects Endpoints

```bash
# List projects
curl -s -H "$AUTH" "$BASE/projects" | jq 'length'

# Create project (with XSS payload)
CREATE_RESP=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$BASE/projects" \
  -d '{
    "name": "<script>alert(1)</script> Test Project",
    "description": "QA Test Project",
    "clickupListId": "test-123"
  }')
PROJECT_ID=$(echo $CREATE_RESP | jq -r '.id')
echo "Created: $PROJECT_ID"

# Read project
curl -s -H "$AUTH" "$BASE/projects/$PROJECT_ID" | jq .

# Verify XSS payload was sanitized
echo $CREATE_RESP | jq '.name' | grep -v "<script>"

# Update project status — REGRESSION BUG #3: field is isActive, not status
# Test WRONG payload (should get 400):
curl -s -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  "$BASE/projects/$PROJECT_ID/status" \
  -d '{"status": "inactive"}' | jq .
# Expected: 400 with clear error message about isActive

# Test CORRECT payload:
curl -s -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  "$BASE/projects/$PROJECT_ID/status" \
  -d '{"isActive": false}' | jq .
# Expected: 200

# Verify update persisted
curl -s -H "$AUTH" "$BASE/projects/$PROJECT_ID" | jq '.isActive'

# Delete project
curl -s -X DELETE -H "$AUTH" "$BASE/projects/$PROJECT_ID" | jq .

# Verify 404 after delete
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "$AUTH" "$BASE/projects/$PROJECT_ID")
echo "After delete: $STATUS"  # expect 404

# Invalid project ID
curl -s -o /dev/null -w "%{http_code}" \
  -H "$AUTH" "$BASE/projects/non-existent-id-00000"  # expect 404

# Create project without required fields
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$BASE/projects" -d '{}' | jq '.statusCode, .message'
# expect 400 with validation errors
```

## 8.3 — Users Endpoints

```bash
# List users
curl -s -H "$AUTH" "$BASE/users" | jq '{total: .pagination.total, users: (.users | length)}'

# Get specific user
USER_ID=$(curl -s -H "$AUTH" "$BASE/users" | jq -r '.users[0].id')
curl -s -H "$AUTH" "$BASE/users/$USER_ID" | jq .
# Verify no password hash in response

# Pagination
curl -s -H "$AUTH" "$BASE/users?page=1&limit=5" | jq '.pagination'

# Filter by role
curl -s -H "$AUTH" "$BASE/users?role=ADMIN" | jq '.users[].role'

# Non-admin trying to list users
PM_TOKEN="..." # get PM role token
STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer $PM_TOKEN" "$BASE/users")
echo "PM listing users: $STATUS"  # expect 403
```

## 8.4 — Dashboard Endpoints

```bash
# PM Dashboard
curl -s -H "$AUTH" "$BASE/pm-dashboard/summary" | jq 'keys'

# QA Dashboard
curl -s -H "$AUTH" "$BASE/qa-dashboard/summary" | jq 'keys'

# Decision Dashboard
curl -s -H "$AUTH" "$BASE/decisions" | jq 'type'

# Queue metrics
curl -s -H "$AUTH" "$BASE/dashboard/queue-metrics" | jq .

# TL Dashboard (if exists)
curl -s -H "$AUTH" "$BASE/tl-dashboard/summary" | jq 'keys'

# Manager Dashboard (if exists)
curl -s -H "$AUTH" "$BASE/manager-dashboard/summary" | jq 'keys'

# Observability dashboard
curl -s -H "$AUTH" "$BASE/observability" | jq 'keys'
```

## 8.5 — Security Endpoints (Regression)

```bash
# REGRESSION BUG #5: /metrics must be protected in production
METRICS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3000/metrics)
echo "/metrics status (no auth): $METRICS_STATUS"
# In dev: 200 is acceptable but document
# For production readiness: verify this will be IP-restricted or auth-protected

# REGRESSION BUG #6: /api/v1/docs-json should be gated in production
DOCS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  http://localhost:3000/api/v1/docs-json)
echo "/docs-json status (no auth): $DOCS_STATUS"
# Document in report with production recommendation
```

## 8.6 — Error Response Format Consistency

All 4xx and 5xx responses must follow NestJS standard error format:

```json
{
  "statusCode": 400,
  "message": "...",
  "error": "Bad Request"
}
```

Test 5 different error scenarios and verify consistent format.
Inconsistent error format → P3 MEDIUM (breaks frontend error handling)

## 8.7 — Response Time Benchmarks

Test all main endpoints and record response times. SLA thresholds:

| Endpoint Type          | P95 Target | Hard Limit |
| ---------------------- | ---------- | ---------- |
| Auth endpoints         | < 200ms    | < 500ms    |
| Simple GET (list)      | < 50ms     | < 200ms    |
| Dashboard aggregations | < 100ms    | < 500ms    |
| Heavy queries          | < 200ms    | < 1000ms   |

```bash
# Measure response times
for ENDPOINT in "health" "auth/me" "projects" "users" "pm-dashboard/summary"; do
  TIME=$(curl -s -o /dev/null -w "%{time_total}" \
    -H "$AUTH" "http://localhost:3000/api/v1/$ENDPOINT")
  echo "$ENDPOINT: ${TIME}s"
done
```

Any endpoint exceeding hard limit → P2 MAJOR
Any endpoint exceeding P95 target → P3 MEDIUM

---

# PHASE 9 — DATA INTEGRITY TESTING

**Goal:** Data created through one channel must be accurately readable through
all other channels. No data corruption, no phantom records, no silent failures.

## 9.1 — Create → Read → Update → Delete (Full Lifecycle)

```bash
# 1. Create project via API
PROJECT=$(curl -sf -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$BASE/projects" \
  -d '{"name":"Data Integrity Test Project QA-'$(date +%s)'","description":"QA Test"}')
ID=$(echo $PROJECT | jq -r '.id')
CREATED_AT=$(echo $PROJECT | jq -r '.createdAt')
echo "Created: $ID at $CREATED_AT"

# 2. Immediately read back
READ=$(curl -sf -H "$AUTH" "$BASE/projects/$ID")
echo "Read name: $(echo $READ | jq -r '.name')"
# Verify name matches exactly (no truncation, no encoding issues)

# 3. Update via API
curl -sf -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  "$BASE/projects/$ID" \
  -d '{"description":"Updated by QA integrity test"}' | jq '.description'

# 4. Read after update — verify change persisted
curl -sf -H "$AUTH" "$BASE/projects/$ID" | jq '.description'
# Must match "Updated by QA integrity test"

# 5. Verify updatedAt changed
UPDATED_AT=$(curl -sf -H "$AUTH" "$BASE/projects/$ID" | jq -r '.updatedAt')
echo "updatedAt changed: $([ "$CREATED_AT" != "$UPDATED_AT" ] && echo YES || echo NO)"

# 6. Delete
curl -sf -X DELETE -H "$AUTH" "$BASE/projects/$ID"

# 7. Verify 404
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$BASE/projects/$ID")
echo "Deleted project status: $STATUS"  # must be 404

# 8. Verify NOT in list
curl -sf -H "$AUTH" "$BASE/projects" | jq "[.[] | select(.id == \"$ID\")] | length"
# Must be 0
```

Any data mismatch → P1 CRITICAL
Any record visible after delete → P1 CRITICAL

## 9.2 — Boundary Value Testing

```bash
# Maximum length strings
LONG_NAME=$(python3 -c "print('A' * 500)")
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$BASE/projects" -d "{\"name\":\"$LONG_NAME\"}" | jq '.statusCode, .message'
# Must be 400 (if max length enforced) or truncated (if DB enforces)

# Unicode characters
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$BASE/projects" \
  -d '{"name":"Unicode: 🚀 测试 العربية النص"}' | jq '.name'
# Must preserve Unicode exactly

# Special characters
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$BASE/projects" \
  -d '{"name":"Special: & < > \" '"'"' / \\ \n \t"}' | jq '.name'
# Must not cause server error; must be properly escaped in response
```

## 9.3 — Concurrent Operations

```bash
# Create 5 projects simultaneously — verify all 5 created
for i in $(seq 1 5); do
  curl -sf -X POST -H "$AUTH" -H "Content-Type: application/json" \
    "$BASE/projects" \
    -d "{\"name\":\"Concurrent Test $i $(date +%s%N)\"}" &
done
wait
sleep 1
# Count projects with "Concurrent Test" in name
curl -s -H "$AUTH" "$BASE/projects" | \
  jq '[.[] | select(.name | startswith("Concurrent Test"))] | length'
# Must be 5 (not 3 or 4 due to race conditions)
```

Race condition resulting in missing records → P1 CRITICAL

---

# PHASE 10 — REAL-TIME / WEBSOCKET TESTING

**Goal:** Socket.IO connections, event delivery, reconnection, and UI updates
all work correctly.

## 10.1 — Socket.IO Connection Test

Using browser automation (Playwright):

```javascript
// Open browser to frontend
// Log in as ADMIN
// Navigate to / (PM Dashboard)
// Check for WebSocket connection badge
// Expected: "REAL-TIME LIVE" badge visible — REGRESSION BUG #7
// If "OFFLINE" badge visible → log defect
```

Navigate to `/executions` and verify WebSocket badge shows connected status.
Compare behavior between `/` (PM Dashboard) and `/executions`.

## 10.2 — Event Delivery

If an active execution exists, or simulate one:

- Trigger an action that causes a socket event
- Verify the UI updates without page refresh
- Verify event arrives within 2 seconds

## 10.3 — Reconnection Behavior

Using browser developer tools or Playwright:

1. Connect to application
2. Simulate network interruption (offline → online)
3. Verify socket reconnects automatically
4. Verify UI recovers without manual refresh

## 10.4 — Multi-Tab Behavior

Open same session in 2 browser tabs:

- Action in tab 1 → verify tab 2 updates via WebSocket
- No duplicate events in either tab

---

# PHASE 11 — SECURITY TESTING (OWASP TOP 10)

**Goal:** Validate every relevant OWASP Top 10 category against this specific
tech stack. This is not a penetration test; it is a pre-production security
review.

## A01 — Broken Access Control

- [x] RBAC matrix (Phase 6)
- [ ] Direct object reference: access another user's profile by ID
  ```bash
  # Attempt to read another user's data as VIEWER
  curl -s -H "Authorization: Bearer $VIEWER_TOKEN" \
    "http://localhost:3000/api/v1/users/$ADMIN_USER_ID"
  # Must be 403
  ```
- [ ] Horizontal privilege escalation: user modifying another user's data
- [ ] Admin endpoints accessible with MANAGER token (verify all admin-only routes)

## A02 — Cryptographic Failures

- [ ] Passwords stored as hashes (not plaintext): verify via DB query or API response
- [ ] JWT signed with strong secret (not "secret" or "password")
- [ ] Sensitive fields encrypted in DB (check `ENCRYPTION_KEY` usage in code)
- [ ] HTTPS enforced in production config (check `main.ts` for TLS settings)
- [ ] No sensitive data in URL parameters (no token in query string)

## A03 — Injection

```bash
# SQL injection via Prisma ORM (already tested in auth Phase 5)
# NoSQL injection patterns
# OS command injection (if any exec() calls exist in code)
# SSTI (if any template engines used)

# Test XSS payloads in all text inputs:
PAYLOADS=(
  '<script>alert(1)</script>'
  '"><img src=x onerror=alert(1)>'
  'javascript:alert(1)'
  '${7*7}'
  '{{7*7}}'
)
for PAYLOAD in "${PAYLOADS[@]}"; do
  RESP=$(curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
    "$BASE/projects" -d "{\"name\":\"$PAYLOAD\",\"description\":\"test\"}")
  echo "Payload: $PAYLOAD"
  echo "Response name: $(echo $RESP | jq -r '.name')"
  # Verify payload is not echoed back unescaped
done
```

Any successful injection → P0 BLOCKER

## A04 — Insecure Design

- [ ] Rate limiting active (tested in Phase 5)
- [ ] No mass assignment vulnerabilities (POST with extra fields like `role`)
  ```bash
  # Try to escalate role via project creation
  curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
    "$BASE/auth/login" \
    -d '{"email":"viewer@test.com","password":"test","role":"ADMIN"}' | jq '.role'
  # Role must not be "ADMIN" (mass assignment blocked)
  ```
- [ ] Account enumeration: does login return different errors for wrong email vs wrong password?
      (Should return same error for both to prevent enumeration)

## A05 — Security Misconfiguration

```bash
# REGRESSION BUGS #5, #6: unauthenticated endpoints
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/metrics
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/docs-json

# CORS headers
curl -s -I -H "Origin: http://evil.com" http://localhost:3000/api/v1/health | grep -i "access-control"
# Must NOT echo back http://evil.com

# Server version disclosure
curl -s -I http://localhost:3000/api/v1/health | grep -i "x-powered-by\|server:"
# Should not reveal framework version

# Stack traces in error responses
curl -s "$BASE/non-existent-endpoint" | jq '.stack'
# Must be null/undefined (no stack traces in production responses)
```

Stack traces in error responses → P2 MAJOR
CORS wildcard → P1 CRITICAL

## A06 — Vulnerable Components

```bash
# Already run in Phase 0.2 — reference results here
cd "/Volumes/Data/project/products/alpharages/Dark Software Factory"
pnpm audit --json 2>/dev/null | jq '.metadata.vulnerabilities'

cd /Volumes/Data/project/products/alpharages/dsf-dasbhoard
pnpm audit --json 2>/dev/null | jq '.metadata.vulnerabilities'
```

## A07 — Authentication Failures

- [x] Brute force protection (Phase 5.5)
- [x] Weak credentials rejected (Phase 5.1)
- [ ] Session token never exposed in URL
- [ ] Tokens have appropriate expiry (check JWT `exp` claim)
  ```bash
  echo $TOKEN | cut -d. -f2 | base64 -d 2>/dev/null | jq '.exp, .iat'
  # Verify exp - iat is a reasonable duration (e.g., 3600 for 1hr)
  ```
- [ ] Refresh token has longer expiry than access token

## A08 — Software and Data Integrity Failures

- [x] JWT signature verified (Phase 5.3)
- [ ] Dependency integrity (package-lock.json/pnpm-lock.yaml committed)
- [ ] No unsigned/unverified webhook processing

## A09 — Logging & Monitoring Failures

- [ ] Failed login attempts are logged
  ```bash
  # Attempt a failed login
  curl -s -X POST "$BASE/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"wrong"}'
  # Check if audit log captures this
  curl -s -H "$AUTH" "$BASE/audit-logs?action=LOGIN_FAILED" | jq 'length'
  ```
- [ ] Audit log records CRUD operations
- [ ] No sensitive data (passwords, tokens) in logs

## A10 — Server-Side Request Forgery (SSRF)

If any endpoint accepts URLs (webhooks, integrations):

```bash
# Test SSRF via any URL input field
# Attempt to reach internal services via server-side URL fetch
# e.g., if there's a "test webhook" feature
curl -s -X POST -H "$AUTH" -H "Content-Type: application/json" \
  "$BASE/webhooks/test" \
  -d '{"url":"http://169.254.169.254/latest/meta-data/"}' | jq .
# Must not return AWS metadata or internal service content
```

---

# PHASE 12 — PERFORMANCE TESTING

**Goal:** Validate that every performance metric meets production SLA thresholds.

## 12.1 — Frontend Bundle Analysis

```bash
cd /Volumes/Data/project/products/alpharages/dsf-dasbhoard
pnpm build 2>&1 | grep -E "dist/|\.js|\.css" | sort -k2 -rh
```

Thresholds:
| Asset | WARNING | CRITICAL |
|-------------------|------------|------------|
| Main JS bundle | > 2.5MB | > 4MB |
| Vendor chunks | > 1MB each | > 2MB each |
| CSS bundle | > 300KB | > 500KB |
| Any single chunk | > 500KB | > 1MB |

- No code splitting for routes → P3 MEDIUM (all code loads on first page)
- PDF library not lazy-loaded → P3 MEDIUM (1.5MB loaded for non-PDF pages)

## 12.2 — API Endpoint Performance

```bash
ENDPOINTS=(
  "health"
  "auth/me"
  "projects"
  "users"
  "pm-dashboard/summary"
  "qa-dashboard/summary"
  "dashboard/queue-metrics"
  "monitoring/errors"
  "financial-metrics/summary"
)

echo "Endpoint,P50(ms),P90(ms),P95(ms)"
for EP in "${ENDPOINTS[@]}"; do
  TIMES=()
  for i in $(seq 1 10); do
    T=$(curl -s -o /dev/null -w "%{time_total}" \
      -H "$AUTH" "http://localhost:3000/api/v1/$EP")
    TIMES+=($T)
  done
  # Calculate percentiles and output
  echo "$EP: ${TIMES[@]}"
done
```

## 12.3 — Frontend Core Web Vitals

Using Playwright with performance timing:

```javascript
// Measure FCP, LCP, TTI for PM Dashboard
const perfEntries = await page.evaluate(() => {
  return JSON.stringify(performance.getEntriesByType('navigation')[0]);
});
```

Thresholds:
| Metric | GOOD | NEEDS WORK | POOR |
|----------------|---------|------------|---------|
| FCP | < 1.8s | < 3s | > 3s |
| LCP | < 2.5s | < 4s | > 4s |
| TTI | < 3.8s | < 7.3s | > 7.3s |
| Page load (dev)| < 200ms | < 500ms | > 500ms |

Note: Vite dev server is slower than production build. Test against prod build
with `pnpm preview` for accurate metrics.

## 12.4 — Memory Leak Detection

Using browser:

1. Open application
2. Navigate through all pages 3 times in sequence
3. Check JS heap size after each cycle
4. A growing heap that does not stabilize → P3 MEDIUM

---

# PHASE 13 — ACCESSIBILITY TESTING (WCAG 2.1 AA)

**Goal:** The application must be usable by people with disabilities.

## 13.1 — Automated Accessibility Scan

Using Playwright with `@axe-core/playwright`:

```javascript
import AxeBuilder from '@axe-core/playwright';

// Run on each key page
const results = await new AxeBuilder({ page }).analyze();
console.log(results.violations);
```

Run on: `/`, `/projects/sync`, `/login`, `/admin/users`, `/executions`

Critical WCAG violations:

- Missing alt text on images → P3 MEDIUM
- Insufficient color contrast → P3 MEDIUM
- Form labels not associated → P3 MEDIUM
- Interactive elements not keyboard accessible → P2 MAJOR
- Focus traps in modals → P2 MAJOR

## 13.2 — Keyboard Navigation

Manually test (or automate via Playwright keyboard events):

- [ ] Tab order is logical on login page
- [ ] Modal dialogs trap focus correctly (tab stays within modal)
- [ ] Escape key closes modals
- [ ] Form submission via Enter key works
- [ ] Sidebar navigation usable via keyboard

## 13.3 — Color Contrast

In dark mode and light mode:

- [ ] Text on colored backgrounds meets 4.5:1 ratio (AA)
- [ ] Status badges (PASS/FAIL colors) are distinguishable without color alone
- [ ] Error states use more than just color to indicate error

---

# PHASE 14 — REGRESSION TEST BATTERY

**Goal:** Explicitly retest every known bug from the previous QA report to
verify they are resolved or still present.

## Regression: Bug #1 — `/users` route (FIXED in App.tsx v2)

```bash
# In browser: navigate to http://localhost:5173/users
# Expected: redirect to /admin/users (302)
# If: 404 page shown → REGRESSION REOPENED (P2 MAJOR)
```

Check App.tsx for: `<Route path="/users" element={<Navigate to="/admin/users" replace />} />`
This redirect exists in the code. Browser test to confirm it works at runtime.

## Regression: Bug #2 — `/qa-review` route (FIXED in App.tsx v2)

```bash
# In browser: navigate to http://localhost:5173/qa-review
# Expected: redirect to /qa-review/dashboard
# If: 404 page shown → REGRESSION REOPENED (P2 MAJOR)
```

## Regression: Bug #3 — PATCH /projects/:id/status field naming

```bash
# Test that sending {"status": "inactive"} returns 400 with helpful message
curl -s -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  "$BASE/projects/$ANY_PROJECT_ID/status" \
  -d '{"status": "inactive"}' | jq '.statusCode, .message'

# Test that sending {"isActive": false} works correctly
curl -s -X PATCH -H "$AUTH" -H "Content-Type: application/json" \
  "$BASE/projects/$ANY_PROJECT_ID/status" \
  -d '{"isActive": false}' | jq '.isActive'
```

- Wrong field still returns 400 without helpful message → P3 MEDIUM
- Wrong field causes 500 server error → P2 MAJOR

## Regression: Bug #4 — Recharts console errors on PM Dashboard

In browser on PM Dashboard (`/`):

- Open DevTools console
- Count messages matching: "The width(-1) and height(-1) of chart"
- If count > 0 → document as OPEN (P4 MINOR, existing)
- If count == 0 → RESOLVED ✅

## Regression: Bug #5 — `/metrics` unauthenticated exposure

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/metrics
```

- Returns 200 in dev: document as KNOWN (P4 MINOR in dev, must gate for production)
- Verify production config has protection plan documented

## Regression: Bug #6 — `/api/v1/docs-json` unauthenticated

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/docs-json
```

- Returns 200 in dev: KNOWN (acceptable in dev, must gate for production)

## Regression: Bug #7 — WebSocket "OFFLINE" on PM Dashboard

In browser at `/`:

- Check WebSocket connection badge
- If "OFFLINE" or "Disconnected" → BUG #7 STILL OPEN (P2 MAJOR)
- If "REAL-TIME LIVE" → RESOLVED ✅
- Also verify at `/executions` → should show connected

---

# PHASE 15 — EXPLORATORY TESTING (STRUCTURED SESSIONS)

**Goal:** Discover bugs that scripted tests cannot find. Each session has a
defined charter, time-box, and bug-hunting focus.

## Session 1 — New User Onboarding (30 minutes)

**Charter:** Can a brand new user get from invitation to first productive use?

Steps:

1. ADMIN sends invite to `newuser-qa-test@example.com` with role VIEWER
2. Check invite appears in invitations list
3. Navigate to registration URL (`/register/:inviteToken`)
4. Complete registration form
5. Log in as new user
6. Verify correct role (VIEWER)
7. Try to access ADMIN-only page → expect redirect to /forbidden
8. Update profile (name, optional avatar)
9. Change notification preferences
10. Log out

Look for: broken links in invite email, confusing UX, error messages that
expose system internals, missing loading states, form validation gaps.

## Session 2 — Project Lifecycle (30 minutes)

**Charter:** Full project from creation to deletion without errors.

Steps:

1. Create new project with all fields filled
2. Sync project with ClickUp
3. View project in project list
4. Edit project description
5. Change project status (active → inactive)
6. View project in executions list
7. Check project appears in dashboards
8. Delete project
9. Verify completely removed from all views

Look for: inconsistent state, stale data after mutations, missing real-time
updates, cascade delete issues.

## Session 3 — Cross-Role Workflow (30 minutes)

**Charter:** Simulate a real team workflow across multiple roles.

Steps:

1. As PM: create a project, request approval
2. As MANAGER: review and approve in /approvals
3. As TL: review architecture, set constraints
4. As QA: review in /qa-review/dashboard
5. As ADMIN: view audit log to verify all actions recorded

Look for: actions not appearing in audit log, approval state not updating
across sessions, role-specific data leaking to wrong roles.

## Session 4 — Error Recovery (20 minutes)

**Charter:** Does the system fail gracefully?

Steps:

1. Submit form with network offline → verify error toast appears
2. Navigate to non-existent project ID `/projects/sync?id=fake-uuid`
3. Submit invalid data on each form
4. Rapidly click buttons (double-submit prevention)
5. Open app in very narrow viewport (320px)
6. Open app on mobile user-agent

Look for: blank pages on error, unhandled exceptions, broken layouts,
double-submission creating duplicate records.

## Session 5 — Settings Deep Dive (20 minutes)

**Charter:** Every settings panel loads and saves correctly.

Steps:

1. Navigate through each settings panel
2. Toggle each setting on/off → verify saved
3. Verify settings persist after page refresh
4. Test integration health panel (ADMIN/MANAGER only)
5. Test GitHub OAuth callback flow

Look for: settings that silently fail to save, missing feedback toasts,
settings that reset on navigation.

---

# PHASE 16 — PRODUCTION READINESS CHECKLIST

**Goal:** Verify all non-functional requirements for production deployment.

## 16.1 — Environment Configuration

- [ ] All required environment variables documented in `.env.example`
- [ ] No `.env` or `.env.local` files committed to git
- [ ] Production database URL is NOT a dev/local connection string
- [ ] JWT_SECRET is at least 32 characters
- [ ] ENCRYPTION_KEY is at least 32 characters
- [ ] SENTRY_DSN configured for error tracking
- [ ] ANTHROPIC_API_KEY has sufficient quota

## 16.2 — Database

- [ ] No pending migrations (`prisma migrate status`)
- [ ] Database indexes on frequently queried columns (verify in schema)
- [ ] Connection pool size appropriate for expected load
- [ ] Backup/restore procedure documented

## 16.3 — Security (Production)

- [ ] `/metrics` endpoint protected (IP allowlist or auth)
- [ ] `/api/v1/docs` and `/api/v1/docs-json` protected or disabled
- [ ] CORS configured with explicit allowed origins (no wildcard)
- [ ] Rate limiting configured for production traffic volumes
- [ ] HTTPS enforced at load balancer/reverse proxy level
- [ ] Security headers: `Strict-Transport-Security`, `X-Content-Type-Options`,
      `X-Frame-Options`, `Content-Security-Policy`
  ```bash
  curl -s -I http://localhost:3000/api/v1/health | grep -i \
    "strict-transport\|x-content-type\|x-frame\|content-security"
  ```

## 16.4 — Monitoring & Observability

- [ ] Sentry initialized and test error reaching Sentry dashboard
- [ ] Prometheus metrics scraping working (`/metrics` returns prom format)
- [ ] Winston logger writing structured JSON logs
- [ ] Correlation IDs present in all log entries
- [ ] Health endpoint reflects real service status (not hardcoded)

## 16.5 — Rollback Plan

- [ ] Previous version container image tagged and stored
- [ ] Database migration rollback script exists for latest migration
- [ ] Rollback procedure documented and tested
- [ ] Feature flags to disable new features without deployment

## 16.6 — Load & Capacity

- [ ] Estimated RPS (requests per second) calculated for expected traffic
- [ ] Connection pool and worker thread counts sized appropriately
- [ ] Rate limiting thresholds won't trigger under normal production load
- [ ] Redis cache TTLs appropriate for data freshness requirements

---

# REPORT GENERATION

After all phases complete, write the following to disk.

## Primary Report: `_bmad-output/qa-reports/qa-report-YYYY-MM-DD.md`

The report must follow this exact structure:

```markdown
# Full-Stack QA Report

**Date:** [today's date]
**QA Orchestrator Version:** 3.0.0
**Backend:** [path + tech stack]
**Frontend:** [path + tech stack]
**Backend commit:** [git hash]
**Frontend commit:** [git hash]
**Test environment:** Local development

---

## Executive Summary

| Category | Status | Notes |
| -------- | ------ | ----- |

[one row per phase, color-coded: ✅ PASS / ⚠ WARN / ❌ FAIL]

**Overall Risk Level:** LOW | MEDIUM | HIGH | CRITICAL
**P0 Blockers:** N
**P1 Critical:** N
**P2 Major:** N
**P3 Medium:** N
**P4 Minor:** N

---

## System Health Matrix

[Service status table]

---

## Static Analysis Results

[TypeScript errors, lint violations, build output, bundle sizes]

---

## Test Suite Results

[Backend + frontend test counts, pass/fail, coverage %]

---

## Smoke Test Results

[8 smoke tests with status]

---

## RBAC Matrix Results

[Full role × route matrix with PASS/FAIL per cell]

---

## UI Functional Test Results

[Every page from Phase 7 with status + notes]

---

## API Contract Test Results

[Endpoint results with status codes + schema validation]

---

## Data Integrity Test Results

[CRUD lifecycle, boundary values, concurrent operations]

---

## Real-Time / WebSocket Test Results

[Socket.IO connection, event delivery, reconnection]

---

## Security Assessment (OWASP Top 10)

[Per-category findings]

---

## Performance Results

[Bundle sizes, API response times, Core Web Vitals]

---

## Accessibility Results

[Automated scan violations, keyboard navigation findings]

---

## Regression Test Results

[Known bug #1–#7 status: RESOLVED / OPEN / NEW REGRESSION]

---

## Exploratory Test Findings

[Bugs found during exploratory sessions]

---

## Production Readiness Checklist

[All items from Phase 16 with ✅/❌/⚠]

---

## Complete Defect Register

### P0 — Blockers

[Table with all P0 defects]

### P1 — Critical

[Table with all P1 defects]

### P2 — Major

[Table with all P2 defects]

### P3 — Medium

[Table with all P3 defects]

### P4 — Minor

[Table with all P4 defects]

---

## Risk Register

| Risk | Likelihood | Impact | Current Status | Mitigation |
| ---- | ---------- | ------ | -------------- | ---------- |

---

## Go / No-Go Recommendation

### [✅ GO | ❌ NO-GO | ⚠ CONDITIONAL GO]

**Justification:**
[Paragraph explaining the recommendation with evidence]

**Blocking conditions (NO-GO) or Required conditions before deploy:**
[Numbered list of mandatory fixes]

**Recommended fixes before next sprint:**
[Numbered list of non-blocking but important fixes]

---

_Report generated by Local Full-Stack E2E QA Orchestrator v3.0.0_
```

## Machine-Readable JSON: `_bmad-output/qa-reports/qa-report-YYYY-MM-DD.json`

```json
{
  "meta": {
    "version": "3.0.0",
    "date": "YYYY-MM-DD",
    "backend_commit": "...",
    "frontend_commit": "..."
  },
  "summary": {
    "total_phases": 16,
    "phases_passed": 0,
    "phases_warned": 0,
    "phases_failed": 0,
    "p0_blockers": 0,
    "p1_critical": 0,
    "p2_major": 0,
    "p3_medium": 0,
    "p4_minor": 0,
    "risk_level": "LOW | MEDIUM | HIGH | CRITICAL"
  },
  "static_analysis": {
    "typescript_errors_backend": 0,
    "typescript_errors_frontend": 0,
    "lint_errors_backend": 0,
    "lint_errors_frontend": 0,
    "bundle_size_main_js_mb": 0,
    "bundle_size_css_kb": 0
  },
  "test_suites": {
    "backend": {
      "suites": 0,
      "passed": 0,
      "failed": 0,
      "skipped": 0,
      "duration_s": 0,
      "coverage_pct": 0
    },
    "frontend": {
      "suites": 0,
      "passed": 0,
      "failed": 0,
      "duration_s": 0
    }
  },
  "services": {
    "backend": "up | down",
    "frontend": "up | down",
    "database": "up | down",
    "rabbitmq": "up | down",
    "redis": "up | down",
    "websocket": "connected | disconnected"
  },
  "pages_tested": 0,
  "pages_failed": 0,
  "api_endpoints_tested": 0,
  "api_endpoints_failed": 0,
  "rbac_checks": {
    "total": 0,
    "passed": 0,
    "failed": 0
  },
  "security": {
    "owasp_categories_checked": 10,
    "critical_findings": 0,
    "high_findings": 0,
    "medium_findings": 0
  },
  "performance": {
    "api_p95_ms": 0,
    "frontend_load_ms": 0
  },
  "regressions": {
    "bug1_users_redirect": "RESOLVED | OPEN",
    "bug2_qa_review_redirect": "RESOLVED | OPEN",
    "bug3_patch_status_field": "RESOLVED | OPEN",
    "bug4_recharts_errors": "RESOLVED | OPEN",
    "bug5_metrics_unauthed": "RESOLVED | OPEN",
    "bug6_docs_unauthed": "RESOLVED | OPEN",
    "bug7_websocket_dashboard": "RESOLVED | OPEN"
  },
  "defects": [],
  "recommendation": "GO | NO_GO | CONDITIONAL_GO",
  "blocking_conditions": []
}
```

---

# GO / NO-GO CRITERIA

## Automatic NO-GO (any single condition)

- Any P0 BLOCKER defect exists
- Any P1 CRITICAL defect exists and is unresolved
- Backend or frontend test suite has failures
- Database has pending migrations
- Security: any injection vulnerability (A03) confirmed
- Security: authentication bypass possible (A07)
- Security: CORS wildcard in production config (A05)

## Conditional GO (requires documented acceptance)

- 1–2 P2 MAJOR defects with documented workarounds
- Code coverage < 80% with explanation
- Performance metrics in WARN range (not CRITICAL)
- WebSocket issues on non-critical pages only
- Bundle size in WARN range with code-splitting plan

## Clean GO

- Zero P0/P1 defects
- All regression tests RESOLVED
- All test suites pass (100%)
- Coverage ≥ 80%
- All security checks PASS
- Performance within thresholds
- Production readiness checklist > 90% ✅

---

## When To Use This Skill

- Before every production deployment
- After any epic completion
- During release freeze
- After major dependency upgrades
- Before investor or client demos
- After any security-sensitive change

## When NOT To Use

- Active production environment (this is a local dev test only)
- Destructive database operations
- High-scale load testing (use k6/Locust for that)
- Actual penetration testing (use a dedicated security team)
