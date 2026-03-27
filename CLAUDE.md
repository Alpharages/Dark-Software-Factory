# CLAUDE.md — Dark Software Factory

## ⚠️ AI: Read Project Context First

Before writing or editing any code, **you MUST read `docs/AI-CONTEXT.md`** first.

It contains:

- What has already been built (completed epics and stories)
- The current sprint state (what's in-progress vs backlog)
- Critical architecture patterns that must not be broken
- Env vars that were intentionally removed (do NOT re-add them)
- Common mistake patterns from past code reviews
- The full document map (where to find PRDs, epics, retros)

Also available:

- `docs/CHANGELOG.md` — chronological history of all major decisions
- `docs/INDEX.md` — complete index of all documentation
- `docs/prd/README.md` — versioned PRD index
- `docs/epics/README.md` — epic completion status

**Why this matters:** DSF has 25+ completed epics. Many past bugs were caused by AI not knowing what was already built, re-implementing removed patterns, or conflicting with existing decisions. Reading AI-CONTEXT.md first prevents this.

---

## Project Overview

Dark Software Factory (DSF) is an AI-powered software development orchestration platform. This is the **backend** repository (NestJS API). The **frontend** dashboard lives at `/Volumes/Data/project/products/alpharages/dsf-dasbhoard`.

## Monorepo Layout

| Repo                | Path                                                              | Stack                                             |
| ------------------- | ----------------------------------------------------------------- | ------------------------------------------------- |
| Backend (this repo) | `/Volumes/Data/project/products/alpharages/Dark Software Factory` | NestJS + Fastify + Prisma + PostgreSQL + RabbitMQ |
| Frontend            | `/Volumes/Data/project/products/alpharages/dsf-dasbhoard`         | React 19 + Vite + Tailwind CSS + shadcn/ui        |

---

## Backend (This Repo)

### Tech Stack

- **Runtime:** Node.js 22.x LTS
- **Package Manager:** pnpm 10.27+ (not npm/yarn)
- **Language:** TypeScript 5.9 (strict mode)
- **Framework:** NestJS 11.1+ with Fastify 5 adapter
- **Database:** PostgreSQL 16+ via Prisma 7.1
- **Message Queue:** RabbitMQ 3.13+ (amqplib 0.10)
- **Cache:** Redis via ioredis 5
- **Real-time:** Socket.IO 4.8
- **Testing:** Jest 30 + ts-jest
- **Linting:** ESLint 9 (flat config) + Prettier 3.7
- **Monitoring:** Sentry 10, Prometheus (prom-client 15), Winston 3.18

### Common Commands

```bash
# Install dependencies
pnpm install

# Development
pnpm start:dev          # Watch mode
pnpm start:debug        # Debug with inspector

# Build
pnpm build

# Testing
pnpm test               # Unit tests
pnpm test:watch         # Watch mode
pnpm test:cov           # Coverage
pnpm test:e2e           # E2E tests (requires running services)

# Code quality
pnpm lint               # ESLint with auto-fix
pnpm format             # Prettier format
pnpm format:check       # Check formatting only
pnpm typecheck          # TypeScript type checking
pnpm check              # lint + test + build (full CI check)

# Database
pnpm db:generate        # Generate Prisma client
pnpm db:migrate         # Create/apply migrations
pnpm db:migrate:deploy  # Deploy migrations in production
pnpm db:migrate:reset   # Reset dev database
pnpm db:push            # Push schema changes (dev only)
pnpm db:pull            # Pull schema from DB
pnpm db:seed            # Seed database
pnpm db:studio          # Open Prisma Studio GUI
pnpm db:validate        # Validate Prisma schema
pnpm db:format          # Format Prisma schema

# Docker services (PostgreSQL, RabbitMQ, Redis, etc.)
pnpm docker:up          # Start services
pnpm docker:down        # Stop services
pnpm docker:logs        # View logs
pnpm docker:logs:app    # View app logs only
pnpm docker:clean       # Remove volumes
pnpm docker:rebuild     # Rebuild containers
pnpm docker:shell       # Shell into app container
pnpm docker:migrate     # Run migrations in Docker
pnpm docker:seed        # Seed DB in Docker
pnpm docker:studio      # Prisma Studio in Docker
pnpm docker:monitoring  # Start monitoring stack
```

### Project Structure

```
src/
├── main.ts                    # App bootstrap (Fastify + Sentry init)
├── app.module.ts              # Root module
├── ai-routing/                # AI provider selection & fallback
├── ai-monitoring/             # AI progress validation & decision logging
├── execution/                 # AI execution lifecycle (state machine)
├── qa-automation/             # Testing, linting, security scanning
├── github/                    # GitHub commits, PRs, branches
├── clickup/                   # ClickUp integration (sync/polling)
├── ticket-intake/             # ClickUp webhook processing
├── webhooks/                  # External webhook handlers
├── auth/                      # JWT auth, user management, invitations
├── projects/                  # Project management
├── dashboards/                # Real-time dashboard data (PM, TL, QA, Manager, Decision, Observability)
├── realtime/                  # Socket.IO gateway
├── rabbitmq/                  # Message queue consumers/publishers
├── database/                  # Prisma module setup
├── prisma/                    # Prisma client re-exports
├── config/                    # Configuration & env validation (Joi)
├── common/                    # Shared: encryption, logger, metrics, guards, decorators
├── cost-tracking/             # Budget & cost logging
├── financial-metrics/         # Financial KPIs and metrics
├── notifications/             # Email (SendGrid) & Slack
├── production-monitoring/     # Sentry integration, auto-fix loop
├── architecture-review/       # ADR generation & review
├── conversations/             # Client communication, audio transcription
├── docker/                    # Container execution (DooD pattern)
├── deployment/                # Deployment management
├── cleanup/                   # Workspace cleanup
├── dependencies/              # Circular dependency detection
├── file-locks/                # Concurrency control
├── system-settings/           # Global settings
├── integrations/              # AetherFlow, third-party APIs
├── git-mirror/                # Local git operations
├── audit/                     # Audit log controller & DTOs
├── metrics/                   # Prometheus metrics module
├── reports/                   # Reports aggregation & export
└── storage/                   # File storage management
```

### Database

- Schema: `prisma/schema.prisma`
- Migrations: `prisma/migrations/`
- Seed: `prisma/seed.ts`
- After schema changes: run `pnpm db:generate` then `pnpm db:migrate`

### Code Style

- **Prettier:** single quotes, trailing commas, 100 char width, 2-space indent, LF line endings
- **ESLint:** strict TypeScript, security plugin, unused vars with `_` prefix allowed
- **Pre-commit hooks:** Husky + lint-staged runs ESLint + Prettier on staged `.ts` files
- **Imports:** Use `@/` path aliases (e.g. `@/common/logger`) — never relative paths (e.g. `../../common/logger`)
- Follow existing NestJS patterns: modules, controllers, services, DTOs with class-validator

### API Documentation

- Swagger UI available at `http://localhost:3000/api/v1/docs` when server is running
- Bearer JWT authentication

### Key Environment Variables

Config is validated via Joi at startup. Copy `.env.example` to `.env`. Key vars:

- `DATABASE_URL` — PostgreSQL connection string
- `RABBITMQ_URL` — RabbitMQ connection string
- `REDIS_URL` — Redis connection string
- `JWT_SECRET` / `ENCRYPTION_KEY` — Auth secrets
- `ANTHROPIC_API_KEY` — Claude API key
- `GITHUB_TOKEN` — GitHub access token
- `CLICKUP_CLIENT_ID` / `CLICKUP_CLIENT_SECRET` / `CLICKUP_REDIRECT_URI` — ClickUp OAuth app (per-project)
- `SENTRY_DSN` — Error tracking (optional)

### Architecture Patterns

- **Message-driven:** RabbitMQ queues for async processing (ai-routing, ai-execution, qa-check, github-push, orchestrator)
- **State machine:** ExecutionStateMachine for ticket lifecycle (QUEUED → IN_PROGRESS → COMPLETED/FAILED)
- **Multi-provider AI routing:** Provider factory + fallback strategy for Claude/Cursor/Windsurf
- **JWT auth:** Passport.js with bcrypt password hashing
- **Correlation IDs:** Middleware for request tracing across services
- **Caching:** Redis via ioredis for session and data caching

---

## Frontend (dsf-dasbhoard)

### Tech Stack

- **Runtime:** Node.js 22+
- **Package Manager:** pnpm 10.27+
- **Language:** TypeScript 5.9 (strict mode)
- **Framework:** React 19 + Vite 7
- **Styling:** Tailwind CSS 4 + shadcn/ui (Radix primitives)
- **State:** TanStack Query 5 (server state), React Context (auth/theme), React Hook Form + Zod 4
- **Real-time:** Socket.IO Client 4.8
- **HTTP:** Axios 1.13 with auth interceptors and token refresh
- **Testing:** Vitest 4 + React Testing Library
- **Routing:** React Router DOM 7
- **Charts:** Recharts 3, XYFlow (architecture diagrams), react-gauge-component

### Common Commands

```bash
cd /Volumes/Data/project/products/alpharages/dsf-dasbhoard

pnpm install            # Install dependencies
pnpm dev                # Start dev server (port 5173)
pnpm build              # Type-check + production build
pnpm preview            # Preview production build
pnpm lint               # ESLint
pnpm test               # Vitest (run once)
```

### Project Structure

```
src/
├── main.tsx                   # React DOM entry
├── App.tsx                    # Routing & layout
├── api/                       # Axios API clients (client.ts = base instance)
├── components/
│   ├── ui/                    # shadcn/Radix primitives
│   ├── layout/                # Sidebar, Header
│   ├── common/                # RoleBadge, StatusBadge
│   └── <feature>/             # Feature-specific components
├── config/                    # App-level config (navigation, etc.)
├── features/                  # Self-contained feature modules
│   ├── audit-logs/
│   ├── observability/
│   ├── projects/
│   └── resource-manager/
│       ├── api/
│       ├── components/
│       ├── hooks/
│       └── types/
├── pages/                     # Route-level page components (~27 pages)
├── hooks/                     # Custom hooks (useSocket, useApprovals, etc.)
├── contexts/                  # AuthContext, ThemeContext
├── types/                     # Shared TypeScript types
├── utils/                     # Utility functions (roleHelpers, etc.)
├── lib/                       # Library utils (formatting, permissions, socket)
└── styles/                    # Theme CSS, animations
```

### Key Environment Variables

- `VITE_API_BASE_URL` — Backend API URL (default: `http://localhost:3000`)
- `VITE_WS_URL` — WebSocket URL (default: `http://localhost:3000`)

### Code Patterns

- **RBAC:** Roles are ADMIN, MANAGER, PM, TL, QA, VIEWER — check with `roleHelpers.ts`
- **API layer:** All API calls go through `api/client.ts` (Axios with auth interceptors)
- **Path alias:** `@/` maps to `./src/`
- **Component variants:** Use `class-variance-authority` + `clsx` + `tailwind-merge`
- **Feature modules:** New features should follow the `features/<name>/{api,components,hooks,types}` pattern
- **Dark mode:** Supported via `.dark` class and CSS variables (oklch colors)

---

## Working with Both Repos

When making cross-cutting changes (e.g., new API endpoint + UI):

1. **Backend first:** Add the NestJS controller/service/DTO, run `pnpm check`
2. **Frontend second:** Add the API client function in `api/`, hook in `hooks/`, then the UI component
3. **Types must stay in sync:** Backend DTOs (class-validator) ↔ Frontend types (TypeScript interfaces + Zod)
4. **API base path:** All backend routes are under `/api/v1/`
5. **Real-time:** Backend emits via Socket.IO gateway → Frontend listens via `useSocket` hook

### Running Both Locally

```bash
# Terminal 1: Start backend services
cd "/Volumes/Data/project/products/alpharages/Dark Software Factory"
pnpm docker:up          # PostgreSQL + RabbitMQ + Redis
pnpm start:dev          # NestJS on port 3000

# Terminal 2: Start frontend
cd /Volumes/Data/project/products/alpharages/dsf-dasbhoard
pnpm dev                # Vite on port 5173
```

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **dsf-backend** (5873 symbols, 14594 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/dsf-backend/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool             | When to use                   | Command                                                                 |
| ---------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `query`          | Find code by concept          | `gitnexus_query({query: "auth validation"})`                            |
| `context`        | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})`                              |
| `impact`         | Blast radius before editing   | `gitnexus_impact({target: "X", direction: "upstream"})`                 |
| `detect_changes` | Pre-commit scope check        | `gitnexus_detect_changes({scope: "staged"})`                            |
| `rename`         | Safe multi-file rename        | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher`         | Custom graph queries          | `gitnexus_cypher({query: "MATCH ..."})`                                 |

## Impact Risk Levels

| Depth | Meaning                               | Action                |
| ----- | ------------------------------------- | --------------------- |
| d=1   | WILL BREAK — direct callers/importers | MUST update these     |
| d=2   | LIKELY AFFECTED — indirect deps       | Should test           |
| d=3   | MAY NEED TESTING — transitive         | Test if critical path |

## Resources

| Resource                                     | Use for                                  |
| -------------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/dsf-backend/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/dsf-backend/clusters`       | All functional areas                     |
| `gitnexus://repo/dsf-backend/processes`      | All execution flows                      |
| `gitnexus://repo/dsf-backend/process/{name}` | Step-by-step execution trace             |

## Self-Check Before Finishing

Before completing any code modification task, verify:

1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## CLI

- Re-index: `npx gitnexus analyze`
- Check freshness: `npx gitnexus status`
- Generate docs: `npx gitnexus wiki`

<!-- gitnexus:end -->
