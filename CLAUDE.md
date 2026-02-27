# CLAUDE.md — Dark Software Factory

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
- **Framework:** NestJS 11 with Fastify adapter
- **Database:** PostgreSQL 16+ via Prisma 7
- **Message Queue:** RabbitMQ 3.13+ (amqplib)
- **Real-time:** Socket.IO 4.8
- **Testing:** Jest 30 + ts-jest
- **Linting:** ESLint 9 (flat config) + Prettier
- **Monitoring:** Sentry, Prometheus, Winston logging

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
pnpm db:seed            # Seed database
pnpm db:studio          # Open Prisma Studio GUI

# Docker services (PostgreSQL, RabbitMQ, etc.)
pnpm docker:up          # Start services
pnpm docker:down        # Stop services
pnpm docker:logs        # View logs
pnpm docker:clean       # Remove volumes
```

### Project Structure

```
src/
├── main.ts                    # App bootstrap (Fastify + Sentry init)
├── app.module.ts              # Root module
├── ai-routing/                # AI provider selection & fallback
├── execution/                 # AI execution lifecycle (state machine)
├── qa-automation/             # Testing, linting, security scanning
├── github/                    # GitHub commits, PRs, branches
├── clickup/                   # ClickUp integration (sync/polling)
├── ticket-intake/             # ClickUp webhook processing
├── webhooks/                  # External webhook handlers
├── auth/                      # JWT auth, user management, invitations
├── projects/                  # Project management
├── dashboards/                # Real-time dashboard data (PM, TL, QA, Manager)
├── realtime/                  # Socket.IO gateway
├── rabbitmq/                  # Message queue consumers/publishers
├── databases/                 # Prisma module setup
├── config/                    # Configuration & env validation (Joi)
├── common/                    # Shared: encryption, logger, metrics, guards, decorators
├── cost-tracking/             # Budget & cost logging
├── notifications/             # Email (SendGrid) & Slack
├── production-monitoring/     # Sentry integration, auto-fix loop
├── architecture-review/       # ADR generation & review
├── conversations/             # Client communication, audio transcription
├── docker/                    # Container execution (DooD pattern)
├── cleanup/                   # Workspace cleanup
├── dependencies/              # Circular dependency detection
├── file-locks/                # Concurrency control
├── system-settings/           # Global settings
├── integrations/              # AetherFlow, third-party APIs
└── git-mirror/                # Local git operations
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
- Follow existing NestJS patterns: modules, controllers, services, DTOs with class-validator

### API Documentation

- Swagger UI available at `http://localhost:3000/api/v1/docs` when server is running
- Bearer JWT authentication

### Key Environment Variables

Config is validated via Joi at startup. Copy `.env.example` to `.env`. Key vars:

- `DATABASE_URL` — PostgreSQL connection string
- `RABBITMQ_URL` — RabbitMQ connection string
- `JWT_SECRET` / `ENCRYPTION_KEY` — Auth secrets
- `ANTHROPIC_API_KEY` — Claude API key
- `GITHUB_TOKEN` — GitHub access token
- `CLICKUP_API_KEY` — ClickUp API key
- `SENTRY_DSN` — Error tracking (optional)

### Architecture Patterns

- **Message-driven:** RabbitMQ queues for async processing (ai-routing, ai-execution, qa-check, github-push, orchestrator)
- **State machine:** ExecutionStateMachine for ticket lifecycle (QUEUED → IN_PROGRESS → COMPLETED/FAILED)
- **Multi-provider AI routing:** Provider factory + fallback strategy for Claude/Cursor/Windsurf
- **JWT auth:** Passport.js with bcrypt password hashing
- **Correlation IDs:** Middleware for request tracing across services

---

## Frontend (dsf-dasbhoard)

### Tech Stack

- **Runtime:** Node.js 22+
- **Package Manager:** pnpm 10.27+
- **Language:** TypeScript 5.9 (strict mode)
- **Framework:** React 19 + Vite 7
- **Styling:** Tailwind CSS 4 + shadcn/ui (Radix primitives)
- **State:** TanStack Query (server state), React Context (auth/theme), React Hook Form + Zod
- **Real-time:** Socket.IO Client
- **HTTP:** Axios with auth interceptors and token refresh
- **Testing:** Vitest + React Testing Library
- **Routing:** React Router DOM 7
- **Charts:** Recharts, XYFlow (architecture diagrams), React Gauge

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
│   ├── ui/                    # 26 shadcn/Radix primitives
│   ├── layout/                # Sidebar, Header
│   ├── common/                # RoleBadge, StatusBadge
│   └── <feature>/             # Feature-specific components
├── features/                  # Self-contained feature modules
│   └── <feature>/
│       ├── api/
│       ├── components/
│       ├── hooks/
│       └── types/
├── pages/                     # Route-level page components (~26 pages)
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
pnpm docker:up          # PostgreSQL + RabbitMQ
pnpm start:dev          # NestJS on port 3000

# Terminal 2: Start frontend
cd /Volumes/Data/project/products/alpharages/dsf-dasbhoard
pnpm dev                # Vite on port 5173
```
