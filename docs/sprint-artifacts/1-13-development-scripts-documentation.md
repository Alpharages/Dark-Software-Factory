# Story 1.13: Development Scripts & Documentation

**Epic:** 1 - Foundation & Development Environment  
**Status:** ready-for-dev  
**Priority:** P2 - MEDIUM (Improves developer onboarding - NFR-UX9)  
**Effort:** 3 story points  
**ClickUp ID:** `86evnjw90`  
**ClickUp URL:** https://app.clickup.com/t/86evnjw90

---

## ⚠️ CRITICAL ARCHITECTURE NOTES

**Current State:**
- NestJS 11.x with **Fastify adapter** (using pnpm)
- Package manager: **pnpm** (NOT npm)
- Most development scripts already exist in `package.json`
- README.md is comprehensive but has **32+ `npm` references** that need changing to `pnpm`
- **NO `.env.example` file exists** - must be created
- No dedicated SETUP.md or CONTRIBUTING.md files
- docs/architecture.md exists with detailed technical documentation
- Docker Compose configured with database `ai_orchestrator` (not `dark_factory`)
- GitHub Actions CI/CD configured (Story 1-11)
- Swagger/OpenAPI configured (Story 1-12)
- Shell scripts exist in `scripts/` folder (undocumented)

**This Story Creates:**
1. `.env.example` - Environment template (**CREATE**, not modify)
2. `SETUP.md` - Dedicated step-by-step setup guide
3. `CONTRIBUTING.md` - Contribution guidelines and PR process
4. Script aliases + missing scripts for architecture consistency
5. README.md updates (npm→pnpm, fix non-existent script references)

**Architecture Reference:** Section "Development Environment" in architecture.md

**CRITICAL:** 
- All commands use `pnpm` NOT `npm`
- Database name is `ai_orchestrator` (per docker-compose.yml)
- Database password is `postgres` (per docker-compose.yml)

---

## Story

As a developer,
I want comprehensive npm scripts and README documentation,
So that new developers can onboard quickly (NFR-UX9: productive within 1 week).

---

## Acceptance Criteria

**Given** a new developer joins the team  
**When** they read the README and run setup commands  
**Then** the following documentation exists:

1. README.md with: project overview, architecture overview, tech stack ✅ (exists, needs npm→pnpm fix)
2. SETUP.md with: prerequisites, installation steps, environment config ❌ (create)
3. CONTRIBUTING.md with: code standards, PR process, testing guidelines ❌ (create)
4. ARCHITECTURE.md reference linked ✅ (already exists)

**And** these npm scripts are available:

| Required Script | Current Status | Action |
|-----------------|----------------|--------|
| `pnpm run start:dev` | ✅ Exists | None |
| `pnpm run start:debug` | ✅ Exists | None |
| `pnpm run build` | ✅ Exists | None |
| `pnpm run test` | ✅ Exists | None |
| `pnpm run test:watch` | ✅ Exists | None |
| `pnpm run test:cov` | ✅ Exists | None |
| `pnpm run test:e2e` | ✅ Exists | None |
| `pnpm run lint` | ✅ Exists (includes --fix) | None |
| `pnpm run format` | ✅ Exists | None |
| `pnpm run migration:dev` | ❌ Missing | Add alias to `db:migrate` |
| `pnpm run migration:deploy` | ❌ Missing | Add alias to `db:migrate:deploy` |
| `pnpm run seed` | ❌ Missing | Add alias to `db:seed` |
| `pnpm run format:check` | ❌ Missing | Add (Prettier check only) |
| `pnpm run docker:up` | ❌ Missing | Add |
| `pnpm run docker:down` | ❌ Missing | Add |
| `pnpm run check:versions` | ❌ Missing | Add (verify prerequisites) |

**And** a developer can complete setup within 1 hour  
**And** all commands work without manual file edits

---

## Technical Requirements

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `.env.example` | **CREATE** | Environment template (does not exist!) |
| `SETUP.md` | **CREATE** | Setup guide for new developers |
| `CONTRIBUTING.md` | **CREATE** | Contribution guidelines, PR process |
| `package.json` | **MODIFY** | Add script aliases + missing scripts |
| `README.md` | **MODIFY** | Fix 32+ npm→pnpm references, fix non-existent script refs |

---

### Step 1: Create .env.example

**File:** `.env.example` (CREATE - file does not exist)

```bash
# ============================================
# DARK SOFTWARE FACTORY - ENVIRONMENT CONFIG
# ============================================
# Copy to .env: cp .env.example .env
# NEVER commit .env to version control
# ============================================

# APPLICATION
NODE_ENV=development
PORT=3000

# DATABASE (REQUIRED)
# Must match docker-compose.yml: ai_orchestrator database, postgres password
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_orchestrator?schema=public"

# MESSAGE QUEUE (REQUIRED)
RABBITMQ_URL="amqp://guest:guest@localhost:5672"

# AUTHENTICATION (REQUIRED)
# Generate: openssl rand -base64 32
JWT_SECRET="REPLACE_ME_GENERATE_WITH_openssl_rand_base64_32"
JWT_EXPIRES_IN="24h"
AUTH_SERVICE_URL="http://localhost:3001"

# GITHUB (for GitHub integration)
# Must start with: ghp_, ghs_, or github_pat_
GITHUB_TOKEN=""

# CLICKUP (for ticket integration)
CLICKUP_API_KEY=""
# Generate: openssl rand -hex 16
CLICKUP_WEBHOOK_SECRET=""

# AI PROVIDERS (at least ONE required for AI features)
CURSOR_API_KEY=""
ANTHROPIC_API_KEY=""
WINDSURF_API_KEY=""

# MONITORING (optional)
SENTRY_DSN=""
LOG_LEVEL="debug"

# COST TRACKING (optional)
DAILY_BUDGET_DEFAULT=100
COST_CAP_ENABLED=true
```

---

### Step 2: Add Scripts to package.json

**File:** `package.json`

Add these scripts to the "scripts" section:

```json
{
  "scripts": {
    // ... existing scripts remain unchanged ...
    
    // Migration aliases (clearer naming)
    "migration:dev": "pnpm run db:migrate",
    "migration:deploy": "pnpm run db:migrate:deploy", 
    "migration:reset": "pnpm run db:migrate:reset",
    "seed": "pnpm run db:seed",
    
    // Code quality
    "format:check": "prettier --check \"src/**/*.ts\" \"test/**/*.ts\"",
    
    // Docker helpers
    "docker:up": "docker compose up -d",
    "docker:down": "docker compose down",
    "docker:logs": "docker compose logs -f",
    
    // Utilities
    "clean": "rm -rf dist node_modules/.cache",
    "check": "pnpm run lint && pnpm run test && pnpm run build",
    "check:versions": "echo 'Node:' && node -v && echo 'pnpm:' && pnpm -v && echo 'Docker:' && docker -v"
  }
}
```

**Note:** Script naming uses `migration:dev` and `migration:deploy` (not `migration:generate`/`migration:run`) because:
- `db:migrate` runs `prisma migrate dev` which creates AND applies migrations
- Prisma doesn't have a separate "generate-only" migration command
- Names now accurately reflect what the commands do

---

### Step 3: Create SETUP.md

**File:** `SETUP.md`

```markdown
# Setup Guide

> Target: Working environment in **under 1 hour**

## Prerequisites

| Software | Version | Verify |
|----------|---------|--------|
| Node.js | 20.x LTS | `node -v` |
| pnpm | 8.x+ | `pnpm -v` |
| Docker | Latest | `docker -v` |
| Docker Compose | v2+ | `docker compose version` |

```bash
# Verify all at once
pnpm run check:versions
```

## Quick Start (Docker)

```bash
# Clone & install
git clone https://github.com/alpharages/dark-software-factory.git
cd dark-software-factory
pnpm install

# Environment setup
cp .env.example .env
# Edit .env: Generate JWT_SECRET with: openssl rand -base64 32

# Start services & database
docker compose up -d
pnpm run db:generate
pnpm run db:migrate:deploy

# Start dev server
pnpm run start:dev

# Verify
curl http://localhost:3000/health
open http://localhost:3000/api/docs
```

## Environment Variables

**Required** (minimum for local dev):
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_orchestrator?schema=public"
RABBITMQ_URL="amqp://guest:guest@localhost:5672"
JWT_SECRET="<generate with: openssl rand -base64 32>"
AUTH_SERVICE_URL="http://localhost:3001"
```

See `.env.example` for all variables.

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `pnpm run start:dev` | Development with hot reload |
| `pnpm run test` | Unit tests |
| `pnpm run test:cov` | Coverage report |
| `pnpm run lint` | ESLint check & fix |
| `pnpm run db:migrate:deploy` | Apply migrations |
| `pnpm run db:studio` | Prisma GUI |
| `pnpm run docker:up` | Start Docker services |
| `pnpm run check` | Full quality check |

## Troubleshooting

**"Cannot connect to database"**
```bash
docker compose ps  # Check postgres is healthy
docker compose up -d postgres
```

**"Prisma client not generated"**
```bash
pnpm run db:generate
```

**"JWT_SECRET validation error"**
```bash
openssl rand -base64 32  # Generate & add to .env
```

**"Port 3000 in use"**
```bash
lsof -i :3000 && kill -9 <PID>
```

## Utility Scripts

Shell scripts in `scripts/` folder:
- `generate-modules.sh` - Generate NestJS module scaffolding
- `validate-ai-providers.sh` - Validate AI provider configuration
- `validate-cursor-headless.sh` - Validate Cursor headless setup

## Next Steps

1. Read `docs/architecture.md`
2. Explore API: http://localhost:3000/api/docs
3. See `CONTRIBUTING.md` for development guidelines
```

---

### Step 4: Create CONTRIBUTING.md

**File:** `CONTRIBUTING.md`

```markdown
# Contributing Guide

## Quick Reference

| Topic | Standard |
|-------|----------|
| Language | TypeScript (strict) |
| Package Manager | **pnpm** (not npm) |
| Framework | NestJS 11.x + Fastify |
| Database | PostgreSQL 16 + Prisma |
| Testing | Jest, >80% coverage |
| Formatting | Prettier |
| Linting | ESLint |

## Workflow

```bash
# 1. Branch from main
git checkout -b feature/DSF-XXX-description

# 2. Make changes with tests

# 3. Quality check
pnpm run check  # lint + test + build

# 4. Commit (Conventional Commits)
git commit -m "feat(module): description"

# 5. Push & create PR
git push origin feature/DSF-XXX-description
```

## Commit Format

```
type(scope): description

Types: feat|fix|docs|style|refactor|test|perf|chore
```

Examples:
- `feat(auth): add JWT refresh tokens`
- `fix(db): correct migration order`
- `docs(readme): update setup instructions`

## Code Style

```typescript
// ✅ Explicit types
function process(ticket: TicketDto): Promise<Result> { }

// ✅ NestJS decorators
@Injectable()
export class TicketService {
  constructor(private readonly prisma: PrismaService) {}
}

// ✅ DTOs with validation
export class CreateTicketDto {
  @IsString() @MinLength(10)
  title: string;
}
```

## Testing

**>80% coverage required**

```bash
pnpm run test        # Run tests
pnpm run test:cov    # Coverage report
```

## PR Checklist

- [ ] Tests pass: `pnpm run test`
- [ ] Coverage >80%: `pnpm run test:cov`
- [ ] Lint passes: `pnpm run lint`
- [ ] Build succeeds: `pnpm run build`
- [ ] ClickUp task linked

## Security

- **Never commit secrets** - use `.env` (gitignored)
- **Run security check**: `pnpm audit`
- **No sensitive data in logs** - redact PII

## Architecture

See `docs/architecture.md` for:
- Module structure patterns
- Database schema
- API design conventions
```

---

### Step 5: Update README.md

**Modifications required:**

1. **Replace ALL `npm` references with `pnpm`** (~32 occurrences):
   - `npm install` → `pnpm install`
   - `npm run X` → `pnpm run X`
   - `npm audit` → `pnpm audit`

2. **Fix non-existent script references:**

| In README | Fix To |
|-----------|--------|
| `npm run migration:generate` | `pnpm run migration:dev` |
| `npm run migration:run` | `pnpm run migration:deploy` |
| `npm run migration:revert` | Remove (doesn't exist in Prisma) |
| `npm run logs` | Remove or `docker compose logs` |
| `npm run metrics` | Remove (not implemented) |
| `npm run lint:fix` | `pnpm run lint` (already has --fix) |
| `npm run format:check` | `pnpm run format:check` (will exist) |

3. **Add links after Quick Start section:**

```markdown
### Additional Resources

- **[SETUP.md](./SETUP.md)** - Detailed setup guide with troubleshooting
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** - Development guidelines
```

4. **Update Available Scripts section** to match actual package.json scripts.

---

## Tasks / Subtasks

- [ ] **Task 1: Create .env.example** (AC: env template exists)
  - [ ] Create file at project root
  - [ ] Include all variables with correct database name (`ai_orchestrator`)
  - [ ] Add generation commands in comments
  - [ ] Verify cp .env.example .env works

- [ ] **Task 2: Add scripts to package.json** (AC: scripts available)
  - [ ] Add `migration:dev`, `migration:deploy`, `seed` aliases
  - [ ] Add `format:check` for Prettier check-only
  - [ ] Add `docker:up`, `docker:down`, `docker:logs`
  - [ ] Add `check` and `check:versions` utilities
  - [ ] Verify all scripts work: `pnpm run <script>`

- [ ] **Task 3: Create SETUP.md** (AC: setup docs exist)
  - [ ] Prerequisites with version check command
  - [ ] Quick Start (Docker path)
  - [ ] Environment variables (matching docker-compose.yml)
  - [ ] Scripts reference table
  - [ ] Troubleshooting section
  - [ ] Document scripts/ folder utilities

- [ ] **Task 4: Create CONTRIBUTING.md** (AC: contribution docs exist)
  - [ ] Quick reference table
  - [ ] Development workflow
  - [ ] Commit format (Conventional Commits)
  - [ ] Code style examples
  - [ ] Testing requirements (>80%)
  - [ ] PR checklist
  - [ ] Security guidelines

- [ ] **Task 5: Update README.md** (AC: README accurate)
  - [ ] Replace ~32 `npm` references with `pnpm`
  - [ ] Fix/remove non-existent script references
  - [ ] Add links to SETUP.md and CONTRIBUTING.md
  - [ ] Verify all documented commands work

- [ ] **Task 6: Verification** (AC: setup in 1 hour)
  - [ ] Fresh clone, follow SETUP.md
  - [ ] Complete setup in <1 hour
  - [ ] All scripts work
  - [ ] Health endpoint responds
  - [ ] Swagger UI loads

---

## Dev Notes

### Database Configuration (CRITICAL)

**docker-compose.yml uses:**
```yaml
POSTGRES_DB: ai_orchestrator
POSTGRES_PASSWORD: postgres
```

**All documentation must use:**
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_orchestrator?schema=public"
```

**NOT** `dark_factory` or `password` - those will cause connection failures!

### Package Manager

This project uses **pnpm**:
```bash
# ✅ Correct
pnpm install
pnpm run start:dev

# ❌ Wrong
npm install
npm run start:dev
```

### Script Naming Rationale

| Script | Actual Command | Why This Name |
|--------|----------------|---------------|
| `migration:dev` | `prisma migrate dev` | Creates + applies in dev |
| `migration:deploy` | `prisma migrate deploy` | Applies only (production-safe) |

Prisma doesn't have separate "generate migration" command - `migrate dev` does both.

### Existing Shell Scripts

Located in `scripts/` folder:
- `generate-modules.sh` - NestJS module scaffolding
- `validate-ai-providers.sh` - AI provider config validation
- `validate-cursor-headless.sh` - Cursor headless setup check

### README npm→pnpm Changes

README.md has approximately **32 occurrences** of `npm` that need changing:
- Lines 182, 194, 197, 270, 409-435, 476-490, 537, 549, 659, 745

Use find/replace but verify each change makes sense in context.

---

## References

- [Source: docs/architecture.md#Development Environment]
- [Source: docs/epics.md#Story 1.13]
- [Source: docker-compose.yml] - Database configuration
- [NFR-UX9: New developers productive within 1 week]
- [Prisma CLI Reference](https://www.prisma.io/docs/reference/api-reference/command-reference)
- [Conventional Commits](https://www.conventionalcommits.org/)

---

## Dev Agent Record

### Context Reference

### Agent Model Used

### Completion Notes List

### File List
