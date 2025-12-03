# Dark Software Factory - AI Dev Tool Orchestrator

> Transforming software development through AI augmentation: The orchestration brain that connects ticket creation to deployed code.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-green.svg)](https://nodejs.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10.x-red.svg)](https://nestjs.com/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![CI](https://github.com/alpharages/dark-software-factory/actions/workflows/ci.yml/badge.svg)](https://github.com/alpharages/dark-software-factory/actions/workflows/ci.yml)
[![Deploy](https://github.com/alpharages/dark-software-factory/actions/workflows/deploy.yml/badge.svg)](https://github.com/alpharages/dark-software-factory/actions/workflows/deploy.yml)
[![codecov](https://codecov.io/gh/alpharages/dark-software-factory/branch/main/graph/badge.svg)](https://codecov.io/gh/alpharages/dark-software-factory)

---

## 🎯 Vision

The **Dark Software Factory** is an AI-driven transformation that enables exceptional PMs to orchestrate AI agents for code generation, replacing the traditional developer-heavy model with an AI-augmented approach. This orchestrator is the critical missing piece that connects [AetherFlow](https://github.com/alpharages/AetherFlow) (our existing AI-powered product/engineering workspace) with AI development tools (Cursor, Windsurf, Google Antigravity) to create a fully automated software delivery pipeline.

### The Goal

- **Growth Liberation:** Scale from 15 → 50+ projects without proportional hiring
- **24/7 Execution:** AI works continuously while humans orchestrate during business hours
- **Instant Scalability:** New project = new ticket, not new hire
- **Quality Assurance:** Multi-layer AI review + human oversight ensures production-ready code

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           DARK SOFTWARE FACTORY                                   │
└─────────────────────────────────────────────────────────────────────────────────┘

┌──────────────┐     ┌──────────────────┐     ┌────────────────────────┐
│              │     │                  │     │                        │
│  AetherFlow  │────▶│  AI Dev Tool     │────▶│  AI Development Tools  │
│  (Existing)  │     │  Orchestrator    │     │                        │
│              │     │  (This Project)  │     │  • Cursor              │
│  • ClickUp   │     │                  │     │  • Windsurf            │
│  • GitHub    │     │  Core Services:  │     │  • Antigravity         │
│  • BMAD™ PM  │     │  ───────────────│     │                        │
│              │     │  • Ticket Intake │     └────────────────────────┘
└──────────────┘     │  • AI Routing    │                │
                     │  • Prompt Gen    │                │
                     │  • Execution     │                ▼
                     │  • QA Automation │     ┌────────────────────────┐
                     │  • GitHub Push   │     │                        │
                     │  • Cost Tracking │────▶│  GitHub Repository     │
                     │  • Self-Healing  │     │                        │
                     │  • Monitoring    │     │  • Feature Branches    │
                     │                  │     │  • Pull Requests       │
                     └──────────────────┘     │  • CI/CD Pipeline      │
                              │                │  • Deployments         │
                              │                │                        │
                              ▼                └────────────────────────┘
                     ┌──────────────────┐                │
                     │                  │                │
                     │  Dashboards      │                ▼
                     │                  │     ┌────────────────────────┐
                     │  • PM            │     │                        │
                     │  • TL            │     │  Production            │
                     │  • Lead QA       │     │                        │
                     │  • Manager       │     │  • Monitoring          │
                     │  • Operator      │     │  • Error Detection     │
                     │                  │     │  • Auto-Fix Tickets    │
                     └──────────────────┘     │  • Self-Healing Loop   │
                                              │                        │
                                              └────────────────────────┘
```

### Key Components

| Component              | Purpose                                         | Technology                      |
| ---------------------- | ----------------------------------------------- | ------------------------------- |
| **Ticket Intake**      | ClickUp webhook listener, ticket validation     | NestJS, ClickUp API             |
| **AI Routing**         | Intelligent routing to optimal AI provider      | Custom algorithm, health checks |
| **Prompt Generation**  | Convert tickets to AI-executable prompts        | LLM-powered, context-aware      |
| **Execution Tracking** | State management, progress monitoring           | PostgreSQL, RabbitMQ            |
| **QA Automation**      | Lint, test, coverage, security scanning         | Multi-language support          |
| **GitHub Integration** | Branch creation, commits, PRs, CI/CD            | Octokit, GitHub Actions         |
| **Cost Tracking**      | Real-time AI API cost monitoring, budget alerts | PostgreSQL, Prometheus          |
| **Self-Healing**       | Production error detection, auto-fix generation | Sentry, AI-powered analysis     |
| **Dashboards**         | Real-time monitoring for all roles              | Next.js, Socket.IO, React       |

---

## ✨ Key Features

### 🎯 **For PMs**

- ✅ Create tickets in AetherFlow → AI generates code automatically
- ✅ Real-time execution progress monitoring (Received → Validated → Generating → Review Ready)
- ✅ Code review and approval workflow with confidence scores
- ✅ Workload monitoring and burnout prevention (target: 10-15 projects/PM)
- ✅ Client communication logs and sprint reporting

### 🏛️ **For Technical Leads**

- ✅ Architecture decision review queue (ADRs generated by AI)
- ✅ Approve/reject/modify AI architecture proposals
- ✅ Set architecture patterns and constraints
- ✅ AI escalation handling (when AI hits capability limits)
- ✅ Architecture quality metrics and trends

### 🔍 **For Lead QA**

- ✅ Automated QA pipeline (lint, test, coverage, security)
- ✅ Configurable quality gates (min 80% test coverage)
- ✅ Sampling-based code review (20% statistical sampling)
- ✅ Bug escape rate tracking (target: <5%)
- ✅ Production approval workflow

### 💼 **For Managers**

- ✅ Real-time cost tracking and budget alerts
- ✅ GO/NO-GO decision dashboard with transformation metrics
- ✅ Team capacity monitoring (PM/TL/QA workload)
- ✅ Financial metrics (revenue, costs, margins, ROI)
- ✅ Business oversight across all projects

### ⚙️ **For Operators**

- ✅ System health monitoring (API, database, queues, AI providers)
- ✅ Queue depth visualization (RabbitMQ)
- ✅ AI provider status and performance tracking
- ✅ Execution logs viewer with search
- ✅ Manual intervention controls (pause, resume, cancel)

### 🔧 **Self-Healing Capabilities**

- ✅ Production error detection via Sentry
- ✅ Automatic fix ticket creation with root cause analysis
- ✅ AI-generated fixes with testing
- ✅ SLA-based prioritization (Critical: 1h, High: 4h, Medium: 24h, Low: 1 week)
- ✅ Auto-deployment to staging → canary → production

---

## 🚀 Quick Start

### Prerequisites

**Required:**

- **Node.js:** 20.x LTS ([Download](https://nodejs.org/))
- **PostgreSQL:** 16+ ([Download](https://www.postgresql.org/download/))
- **RabbitMQ:** 3.13+ ([Download](https://www.rabbitmq.com/download.html))
- **Docker & Docker Compose:** Latest ([Download](https://www.docker.com/get-started))

**Optional (for production):**

- Redis 7+ (for Socket.IO scaling)
- GitHub account with API access
- ClickUp workspace with API access
- AI Provider accounts (Cursor, Windsurf, Antigravity)

### Docker Development Environment

#### Quick Start

```bash
# Start all services (PostgreSQL, RabbitMQ, App)
docker-compose up -d

# ⚠️ IMPORTANT: Run initial migration after FIRST start
docker-compose exec app npx prisma migrate deploy

# View logs
docker-compose logs -f

# Stop all services
docker-compose down

# Clean restart (removes volumes)
docker-compose down -v && docker-compose up -d
```

#### Available Services

| Service     | Port  | URL                    | Description              |
| ----------- | ----- | ---------------------- | ------------------------ |
| App         | 3000  | http://localhost:3000  | AI Dev Orchestrator      |
| PostgreSQL  | 5432  | -                      | Database                 |
| RabbitMQ    | 5672  | -                      | Message Queue            |
| RabbitMQ UI | 15672 | http://localhost:15672 | Management (guest/guest) |

#### Optional Monitoring Stack

```bash
# Start with Prometheus + Grafana
docker-compose --profile monitoring up -d
```

| Service    | Port | URL                   | Credentials |
| ---------- | ---- | --------------------- | ----------- |
| Prometheus | 9090 | http://localhost:9090 | -           |
| Grafana    | 3001 | http://localhost:3001 | admin/admin |

#### Common Commands

```bash
# Run database migrations
pnpm run docker:migrate

# Seed database
pnpm run docker:seed

# Open Prisma Studio
pnpm run docker:studio

# Shell into app container
pnpm run docker:shell

# Rebuild containers
pnpm run docker:rebuild
```

#### Hot Reload

Source code changes are automatically detected. The app restarts within 2-3 seconds.

### Additional Resources

- **[SETUP.md](./SETUP.md)** - Detailed setup guide with troubleshooting
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** - Development guidelines

### Installation (Development)

#### Option 1: Docker Compose (Recommended)

```bash
# Clone the repository
git clone https://github.com/alpharages/dark-software-factory.git
cd dark-software-factory

# Copy environment template
cp .env.example .env

# Edit .env with your API keys (see Configuration section)
nano .env

# Start all services (PostgreSQL, RabbitMQ, Orchestrator)
docker-compose up -d

# View logs
docker-compose logs -f orchestrator

# Access services:
# - API: http://localhost:3000
# - Swagger UI: http://localhost:3000/api/docs
# - RabbitMQ Management: http://localhost:15672 (guest/guest)
# - Health Check: http://localhost:3000/health
```

#### Option 2: Local Development

```bash
# Clone the repository
git clone https://github.com/alpharages/dark-software-factory.git
cd dark-software-factory

# Install dependencies
pnpm install

# Start PostgreSQL (ensure it's running on port 5432)
# Start RabbitMQ (ensure it's running on port 5672)

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
nano .env

# Run database migrations
pnpm run migration:deploy

# Start in development mode (hot reload)
pnpm run start:dev

# API will be available at http://localhost:3000
```

### Verify Installation

```bash
# Check health endpoint
curl http://localhost:3000/health

# Expected response:
# {
#   "status": "ok",
#   "info": {
#     "database": { "status": "up" },
#     "rabbitmq": { "status": "up" }
#   }
# }

# Check Swagger API documentation
open http://localhost:3000/api/docs
```

### Environment Setup

**IMPORTANT:** Before starting the application, you MUST configure environment variables.

#### Step 1: Copy the environment template

```bash
cp .env.example .env
```

#### Step 2: Generate secure secrets

```bash
# Generate JWT Secret (minimum 32 characters required)
openssl rand -base64 32

# Generate ClickUp Webhook Secret (minimum 16 characters required)
openssl rand -hex 16
```

#### Step 3: Edit `.env` and fill in the required variables

```bash
# Open .env in your editor
nano .env  # or code .env, or vim .env
```

**Required variables (application will fail to start if missing):**

- `DATABASE_URL` - PostgreSQL connection string
- `RABBITMQ_URL` - RabbitMQ connection string
- `JWT_SECRET` - At least 32 characters (use `openssl rand -base64 32`)
- `AUTH_SERVICE_URL` - Authentication service URL
- `GITHUB_TOKEN` - GitHub personal access token (must start with `ghp_`, `ghs_`, or `github_pat_`)
- `CLICKUP_API_KEY` - ClickUp API key
- `CLICKUP_WEBHOOK_SECRET` - At least 16 characters (use `openssl rand -hex 16`)
- **At least ONE AI provider key:** `CURSOR_API_KEY`, `WINDSURF_API_KEY`, or `ANTIGRAVITY_API_KEY`

**Validation:**  
The application validates all environment variables on startup. If any required variable is missing or invalid, you'll see a detailed error message explaining what's needed.

```bash
# Example validation error
Config validation error: JWT_SECRET is required. Generate with: openssl rand -base64 32
```

#### Step 4: Verify configuration

```bash
# Start the application
pnpm run start:dev

# If successful, you should see:
# ✅ Database connected
# ✅ Config loaded successfully
# 🚀 Application is running on: http://localhost:3000
```

**Security Note:** NEVER commit the `.env` file to git. It contains secrets and is already excluded in `.gitignore`.

---

## ⚙️ Configuration

### Environment Variables

Create a `.env` file in the project root with the following variables:

```bash
# ============================================
# APPLICATION
# ============================================
NODE_ENV=development          # development | staging | production
PORT=3000                     # API server port
LOG_LEVEL=debug              # error | warn | info | debug

# ============================================
# DATABASE
# ============================================
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_orchestrator?schema=public"

# ============================================
# MESSAGE QUEUE
# ============================================
RABBITMQ_URL="amqp://guest:guest@localhost:5672"

# ============================================
# AUTHENTICATION
# ============================================
JWT_SECRET="your-super-secret-jwt-key-change-in-production"
JWT_EXPIRATION="24h"

# ============================================
# AI PROVIDERS
# ============================================
CURSOR_API_KEY="your-cursor-api-key"
WINDSURF_API_KEY="your-windsurf-api-key"
ANTIGRAVITY_API_KEY="your-antigravity-api-key"

# ============================================
# GITHUB
# ============================================
GITHUB_TOKEN="ghp_your_github_personal_access_token"
GITHUB_ORG="your-organization"           # Optional: default organization

# ============================================
# CLICKUP
# ============================================
CLICKUP_API_KEY="pk_your_clickup_api_key"
CLICKUP_WEBHOOK_SECRET="your-webhook-secret"
CLICKUP_WORKSPACE_ID="your-workspace-id"

# ============================================
# MONITORING
# ============================================
SENTRY_DSN="https://your-sentry-dsn@sentry.io/project-id"  # Optional
PROMETHEUS_PORT=9090                                         # Optional

# ============================================
# COST TRACKING
# ============================================
DAILY_BUDGET_DEFAULT=100      # Default daily AI budget (USD)
COST_CAP_ENABLED=true         # Enable automatic cost cap enforcement

# ============================================
# REDIS (for Socket.IO scaling)
# ============================================
REDIS_URL="redis://localhost:6379"    # Optional for single instance
```

### Obtaining API Keys

#### ClickUp

1. Go to [ClickUp Settings → Apps](https://app.clickup.com/settings/apps)
2. Generate API token
3. Create webhook pointing to `https://your-domain.com/api/v1/webhooks/clickup`

#### GitHub

1. Go to [GitHub Settings → Developer settings → Personal access tokens](https://github.com/settings/tokens)
2. Generate token with `repo` and `workflow` scopes
3. Save token securely

#### AI Providers

- **Cursor:** [Cursor Settings](https://cursor.sh/settings)
- **Windsurf:** [Windsurf Console](https://windsurf.ai/console)
- **Antigravity:** [Google Cloud Console](https://console.cloud.google.com/)

---

## 🛠️ Development Workflow

### Project Structure

```
dark-software-factory/
├── src/
│   ├── modules/
│   │   ├── ticket-intake/        # ClickUp webhook, ticket validation
│   │   ├── ai-routing/           # AI provider selection, prompt generation
│   │   ├── qa-automation/        # Linting, testing, quality gates
│   │   ├── github-integration/   # Branch, commit, PR, deployment
│   │   ├── cost-tracking/        # AI cost monitoring, budget alerts
│   │   ├── monitoring/           # System health, WebSocket events
│   │   └── self-healing/         # Production errors, auto-fix
│   ├── common/                   # Shared utilities, guards, interceptors
│   ├── config/                   # Configuration modules
│   ├── main.ts                   # Application entry point
│   └── app.module.ts             # Root module
├── prisma/
│   ├── schema.prisma             # Database schema (9 tables)
│   └── migrations/               # Database migration history
├── test/
│   ├── unit/                     # Unit tests
│   └── e2e/                      # End-to-end tests
├── docs/
│   ├── architecture.md           # Complete architecture documentation
│   ├── prd.md                    # Product Requirements Document
│   ├── epics.md                  # Epic and story breakdown
│   └── brainstorming-session-results-2025-11-18.md
├── docker-compose.yml            # Local development environment
├── Dockerfile                    # Production container
├── .github/workflows/            # CI/CD pipelines
└── README.md                     # This file
```

### Available Scripts

```bash
# Development
pnpm run start:dev           # Start with hot reload
pnpm run start:debug         # Start with debugger attached
pnpm run build               # Production build
pnpm run start:prod          # Start production build

# Testing
pnpm run test                # Run unit tests
pnpm run test:watch          # Tests in watch mode
pnpm run test:cov            # Generate coverage report (target: >80%)
pnpm run test:e2e            # Run end-to-end tests

# Code Quality
pnpm run lint                # ESLint check & fix
pnpm run format              # Prettier format
pnpm run format:check        # Prettier check only
pnpm run check               # Full quality check (lint + test + build)

# Database
pnpm run migration:dev       # Create & apply migration (dev)
pnpm run migration:deploy    # Apply migrations (prod/CI)
pnpm run db:seed             # Seed database with test data
pnpm run db:studio           # Open Prisma Studio

# Docker
pnpm run docker:up           # Start services
pnpm run docker:down         # Stop services
pnpm run docker:logs         # View logs
```

### Development Guidelines

#### Code Style

- **TypeScript:** Strict mode enabled
- **Naming:** camelCase for variables/functions, PascalCase for classes
- **Formatting:** Prettier (automatic on save)
- **Linting:** ESLint with NestJS recommended rules

#### Git Workflow

```bash
# Feature development
git checkout -b feature/DSF-123-ticket-description
# ... make changes ...
git add .
git commit -m "feat: implement ticket intake webhook"
git push origin feature/DSF-123-ticket-description
# Create PR in GitHub
```

#### Git Hooks (Husky)

This project uses [Husky](https://typicode.github.io/husky/) for automated quality checks:

| Hook           | Trigger      | Actions                                                |
| -------------- | ------------ | ------------------------------------------------------ |
| **pre-commit** | `git commit` | Runs `lint-staged` (ESLint + Prettier on staged files) |
| **pre-push**   | `git push`   | Runs full `pnpm lint` and `pnpm test`                  |

**What gets checked on commit:**

- `.ts` files: ESLint auto-fix + Prettier formatting
- `.json` files: Prettier formatting
- `.md` files: Prettier formatting

**What gets checked on push:**

- Full project linting (all TypeScript files)
- Complete unit test suite

**ESLint Security Plugin:**
The project includes `eslint-plugin-security` to catch dangerous patterns:

- `security/detect-child-process` — Flags command injection risks (exec, spawn)
- `security/detect-eval-with-expression` — Flags eval() and Function() usage
- `security/detect-non-literal-fs-filename` — Warns about dynamic file paths
- `security/detect-object-injection` — Warns about prototype pollution

See [CONTRIBUTING.md](./CONTRIBUTING.md) for bypass instructions (emergencies only).

#### Commit Message Format (Conventional Commits)

```
feat: add ticket validation logic
fix: correct AI routing algorithm
docs: update architecture diagram
test: add unit tests for cost tracking
refactor: simplify QA pipeline
perf: optimize database queries
chore: update dependencies
```

---

## 🧪 Testing

### Running Tests

```bash
# Unit tests (target: >80% coverage)
pnpm run test

# Watch mode (for TDD)
pnpm run test:watch

# Coverage report
pnpm run test:cov
open coverage/lcov-report/index.html

# E2E tests (integration tests)
pnpm run test:e2e

# Specific test file
pnpm run test -- ticket-intake.service.spec.ts
```

### Test Structure

```typescript
// Example: src/modules/ticket-intake/ticket-intake.service.spec.ts
describe('TicketIntakeService', () => {
  let service: TicketIntakeService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TicketIntakeService, PrismaService],
    }).compile();

    service = module.get<TicketIntakeService>(TicketIntakeService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('validateTicket', () => {
    it('should pass validation for complete ticket', async () => {
      const ticket = {
        title: 'Add user authentication',
        description: 'Implement JWT-based auth',
        acceptanceCriteria: ['User can login', 'Token expires after 24h'],
      };

      const result = await service.validateTicket(ticket);
      expect(result.isValid).toBe(true);
    });

    it('should fail validation for incomplete ticket', async () => {
      const ticket = { title: 'Short' }; // Missing description

      const result = await service.validateTicket(ticket);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Description is required');
    });
  });
});
```

### Quality Gates

All code must pass:

- ✅ **Linting:** ESLint with no errors
- ✅ **Testing:** All tests passing
- ✅ **Coverage:** Minimum 80% code coverage
- [ ] **Security:** No critical vulnerabilities (pnpm audit)
- ✅ **Type Safety:** TypeScript compilation with no errors

---

## 🚢 Deployment

### Production Checklist

Before deploying to production, ensure:

- [ ] All environment variables configured in production environment
- [ ] Database migrations applied (`pnpm run migration:deploy`)
- [ ] SSL/TLS certificates configured for HTTPS
- [ ] GitHub webhooks pointing to production URL
- [ ] ClickUp webhooks pointing to production URL
- [ ] Sentry DSN configured for error tracking
- [ ] Prometheus/Grafana dashboards set up
- [ ] Backup strategy configured for PostgreSQL
- [ ] CI/CD pipeline tested in staging
- [ ] Load testing completed (NFR-P2: handle 1000 concurrent executions)
- [ ] Security scan completed (NFR-S1: OWASP Top 10 protection)
- [ ] Monitoring alerts configured

### Deployment Options

#### Option 1: Docker (Recommended)

```bash
# Build production image
docker build -t dark-factory:latest .

# Run container
docker run -d \
  --name dark-factory \
  -p 3000:3000 \
  --env-file .env.production \
  dark-factory:latest

# Check logs
docker logs -f dark-factory
```

#### Option 2: Kubernetes

```bash
# Apply Kubernetes manifests
kubectl apply -f k8s/

# Check deployment status
kubectl get pods -l app=dark-factory
kubectl logs -f deployment/dark-factory

# Scale horizontally
kubectl scale deployment/dark-factory --replicas=3
```

#### Option 3: Cloud Platforms

- **AWS:** Deploy via ECS/EKS with RDS and ElastiCache
- **GCP:** Deploy via Cloud Run with Cloud SQL and Memorystore
- **Azure:** Deploy via App Service with Azure Database for PostgreSQL

### CI/CD Pipeline (GitHub Actions)

The project includes automated CI/CD in `.github/workflows/ci.yml`:

1. **Lint & Test** (on every PR)
   - Run ESLint
   - Run unit tests
   - Check coverage (>80%)
   - Security scan

2. **Build** (on merge to main)
   - Build Docker image
   - Push to container registry
   - Tag with commit SHA

3. **Deploy to Staging** (automatic)
   - Deploy to staging environment
   - Run smoke tests
   - Monitor for 10 minutes

4. **Deploy to Production** (manual approval)
   - Requires approval from Manager
   - Blue-green deployment
   - Automatic rollback on failure

---

## 📚 Documentation

### Core Documentation

| Document              | Description                                      | Link                                                                                              |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **Architecture**      | Complete system architecture, ADRs, tech stack   | [architecture.md](./docs/architecture.md)                                                         |
| **PRD**               | Product Requirements Document (136 FRs, 69 NFRs) | [prd.md](./docs/prd.md)                                                                           |
| **Epic Breakdown**    | 10 epics, 94 stories with acceptance criteria    | [epics.md](./docs/epics.md)                                                                       |
| **Brainstorming**     | Vision, risks, SWOT, transformation strategy     | [brainstorming-session-results-2025-11-18.md](./docs/brainstorming-session-results-2025-11-18.md) |
| **API Documentation** | Interactive Swagger UI                           | http://localhost:3000/api/docs                                                                    |
| **ClickUp Tasks**     | Implementation roadmap                           | [ClickUp Workspace](https://app.clickup.com/9018612026/v/li/901813518753)                         |

### Additional Resources

- **API Documentation:** http://localhost:3000/api/docs (Swagger UI)
- **Health Check:** http://localhost:3000/health
- **Metrics:** http://localhost:9090/metrics (Prometheus format)
- **RabbitMQ Management:** http://localhost:15672 (guest/guest)

---

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

### Contribution Workflow

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/DSF-XXX-description`)
3. **Make your changes** (follow code style guidelines)
4. **Write/update tests** (maintain >80% coverage)
5. **Run quality checks** (`pnpm run lint && pnpm run test`)
6. **Commit your changes** (use conventional commits)
7. **Push to your fork** (`git push origin feature/DSF-XXX-description`)
8. **Create a Pull Request** with detailed description

### Code Review Process

All PRs require:

- ✅ **PM Review:** Feature aligns with requirements
- ✅ **TL Review:** Architecture decisions are sound
- ✅ **QA Review:** Code quality meets standards
- ✅ **Automated Checks:** All CI/CD checks pass

### Issue Reporting

Found a bug? Have a feature request?

1. Check [existing issues](https://github.com/alpharages/dark-software-factory/issues)
2. Create new issue with:
   - Clear title and description
   - Steps to reproduce (for bugs)
   - Expected vs. actual behavior
   - Environment details (Node version, OS, etc.)
   - Screenshots/logs if applicable

---

## 📊 Project Status

### Current Phase: **Phase 1 - MVP Development**

| Epic                       | Status         | Progress | Stories        |
| -------------------------- | -------------- | -------- | -------------- |
| Epic 1: Foundation         | 🟡 In Progress | 30%      | 4/13 completed |
| Epic 2: Ticket Intake      | ⚪ Not Started | 0%       | 0/12 completed |
| Epic 3: QA Automation      | ⚪ Not Started | 0%       | 0/8 completed  |
| Epic 4: GitHub Integration | ⚪ Not Started | 0%       | 0/8 completed  |
| Epic 5: PM Dashboard       | ⚪ Not Started | 0%       | 0/10 completed |
| Epic 6: Cost Tracking      | ⚪ Not Started | 0%       | 0/8 completed  |
| Epic 7: TL Review          | ⚪ Not Started | 0%       | 0/8 completed  |
| Epic 8: QA Review          | ⚪ Not Started | 0%       | 0/8 completed  |
| Epic 9: Self-Healing       | ⚪ Not Started | 0%       | 0/8 completed  |
| Epic 10: Real-Time         | ⚪ Not Started | 0%       | 0/10 completed |

### Key Metrics (GO/NO-GO Criteria)

| Metric              | Target                          | Current | Status        |
| ------------------- | ------------------------------- | ------- | ------------- |
| PM Capacity         | 1 PM handles 10-15 projects     | TBD     | 🟡 Testing    |
| Cost Predictability | AI compute <30% project revenue | TBD     | 🟡 Monitoring |
| Quality             | Bug escape rate <5%             | TBD     | 🟡 Tracking   |
| Client Acceptance   | NPS >7/10                       | TBD     | 🟡 Surveying  |
| Operational Freedom | BMad time reduced >50%          | TBD     | 🟡 Measuring  |

---

## 🌟 Success Metrics

### Business Impact

- **Project Capacity:** Target 50+ concurrent projects (vs. 15 current)
- **Hiring Constraint Removed:** New project = new ticket, not months of hiring
- **24/7 Execution:** AI works continuously, humans orchestrate during business hours
- **Cost Optimization:** Developer salary budget reallocated to AI compute

### Technical Excellence

- **Zero-Defect Goal:** <5% bug escape rate (NFR-Q1)
- **Test Coverage:** >80% across all modules (NFR-Q2)
- **Performance:** API response <2s for 95% of requests (NFR-P1)
- **Reliability:** 99.9% uptime for orchestrator (NFR-R4)
- **Security:** OWASP Top 10 protection (NFR-S1)

### Transformation Validation

- **Phase 1 (Validate):** 5 pilot projects, prove model works
- **Phase 2 (Scale):** 20 projects, refine processes
- **Phase 3 (Transform):** 50+ projects, full transformation

---

## 🔒 Security

### Security Best Practices

- **Authentication:** JWT-based with role-based access control (6 roles)
- **Secrets Management:** All secrets in environment variables (never committed)
- **Data Encryption:** AES-256-GCM for sensitive data at rest (NFR-S3)
- **API Security:** Rate limiting, CORS, helmet.js protection
- **Dependency Scanning:** Automated pnpm audit in CI/CD
- **Code Scanning:** Semgrep security rules in QA pipeline
- **Error Handling:** No sensitive data in error messages (NFR-S4)

### Reporting Security Issues

**Do NOT create public GitHub issues for security vulnerabilities.**

Email security concerns to: security@alpharages.com

---

## 📝 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

### Built With

- [NestJS](https://nestjs.com/) - Progressive Node.js framework
- [Prisma](https://www.prisma.io/) - Next-generation ORM
- [RabbitMQ](https://www.rabbitmq.com/) - Reliable message broker
- [PostgreSQL](https://www.postgresql.org/) - Powerful open-source database
- [Socket.IO](https://socket.io/) - Real-time bidirectional communication
- [Prometheus](https://prometheus.io/) - Monitoring and alerting
- [Sentry](https://sentry.io/) - Error tracking and performance monitoring

### Inspired By

- **China's Dark Factories:** Lights-out manufacturing concept
- **AetherFlow:** Our existing AI-powered product/engineering workspace
- **BMAD™ Method:** Business Model Agile Development methodology

---

## 📞 Support & Contact

- **Project Lead:** BMad (khakan.ali@alpharages.com)
- **Documentation:** [docs/](./docs/)
- **Issue Tracker:** [GitHub Issues](https://github.com/alpharages/dark-software-factory/issues)
- **ClickUp Workspace:** [Dark Software Factory](https://app.clickup.com/9018612026/v/li/901813518753)
- **Company:** [Alpharages](https://alpharages.com)

---

## 🚀 Roadmap

### Phase 1: MVP (Current - Months 1-3)

- ✅ 10 epics defined with 94 stories
- 🟡 Epic 1: Foundation & Development Environment (in progress)
- ⚪ Epics 2-10: Core orchestration features
- ⚪ Pilot with 1 small project
- ⚪ Measure: PM capacity, costs, quality, speed

### Phase 2: Scale (Months 4-6)

- ⚪ Scale to 20 projects
- ⚪ Refine cost model and pricing
- ⚪ Build knowledge base
- ⚪ Begin workforce transition

### Phase 3: Transform (Months 7-12)

- ⚪ Scale to 50+ projects
- ⚪ Complete workforce transformation
- ⚪ Launch industry thought leadership
- ⚪ Introduce tiered service offerings

### Future Innovations (Phase 4+)

- AI-generated software house (sell orchestration platform)
- Predictive project management (AI predicts complexity, cost, timeline)
- Cross-company AI worker marketplace
- Industry transformation leadership

---

**Ready to transform software development?** Start with the [Quick Start](#-quick-start) guide above! 🚀

---

<div align="center">
  <strong>Dark Software Factory</strong> - Where AI augments human creativity
  <br>
  <sub>Built with ❤️ by the Alpharages team</sub>
</div>
