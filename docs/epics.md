# Dark Software Factory - Epic Breakdown

**Author:** BMad  
**Date:** 2025-11-21  
**Project Level:** HIGH Complexity  
**Target Scale:** Enterprise AI Transformation

---

## Overview

This document provides the complete epic and story breakdown for Dark Software Factory, decomposing the requirements from the [PRD](./prd.md) into implementable stories.

**Living Document Notice:** This version incorporates complete context from PRD + Architecture. Ready for Phase 4 implementation.

---

## Functional Requirements Inventory

**Total FRs:** 136 across 9 capability areas

**Phase Distribution:**

- MVP Phase 1: 63 FRs
- Growth Phase 2: 38 FRs
- Vision Phase 3: 35 FRs

**By Role:**

- PM Capabilities: FR1-FR23 (23 FRs)
- TL Capabilities: FR24-FR33 (10 FRs)
- Lead QA Capabilities: FR34-FR43 (10 FRs)
- Manager Capabilities: FR44-FR55 (12 FRs)
- AI Orchestrator System: FR56-FR95 (40 FRs)
- Dashboard & Reporting: FR96-FR115 (20 FRs)
- Knowledge Base: FR116-FR120 (5 FRs)
- Client Portal: FR121-FR127 (7 FRs)
- Advanced Capabilities: FR128-FR136 (9 FRs)

---

## Proposed Epic Structure

**Analysis:** Examined 136 FRs to find natural groupings that deliver user value incrementally.

**Epic Strategy:** Each epic delivers something USERS can actually use, not just technical infrastructure. Foundation epic is necessary exception for greenfield project setup.

### Epic Summary

**Phase 1 MVP Epics** (10 Epics, ~100 stories):

1. **Epic 1: Foundation & Development Environment**
   - **User Value:** Development team can build, test, and deploy the orchestrator
   - **Scope:** Project initialization, NestJS setup, database, auth, CI/CD basics
   - **FRs Covered:** Infrastructure foundation for all subsequent FRs

2. **Epic 2: Ticket Intake & AI Routing Engine**
   - **User Value:** PMs can create tickets in AetherFlow and see them automatically routed to appropriate AI tools
   - **Scope:** ClickUp webhook integration, ticket parsing, AI tool selection logic, prompt generation
   - **FRs Covered:** FR56-FR65 (Webhook, Task Intake, AI Routing & Execution)

3. **Epic 3: Automated QA & Quality Gates**
   - **User Value:** AI-generated code is automatically validated (linting, testing, security) before human review
   - **Scope:** Linting integration, test execution, code review checks, quality gate enforcement
   - **FRs Covered:** FR66-FR71 (Automated QA & Quality Gates)

4. **Epic 4: GitHub Integration & CI/CD Pipeline**
   - **User Value:** Validated code is automatically pushed to GitHub and deployed via CI/CD
   - **Scope:** Branch management, code push, PR creation, CI/CD triggers, deployment monitoring
   - **FRs Covered:** FR72-FR78 (GitHub Integration & Deployment)

5. **Epic 5: PM Dashboard & Project Orchestration**
   - **User Value:** PMs can monitor all their AI projects, approve code, and manage workload in unified interface
   - **Scope:** PM dashboard, project list, ticket timeline, approval workflows, quick actions
   - **FRs Covered:** FR8-FR14, FR96-FR99 (PM Orchestration, PM Dashboard)

6. **Epic 6: Cost Tracking & Budget Monitoring**
   - **User Value:** Managers can track AI costs in real-time and prevent budget overruns
   - **Scope:** Cost calculation per project/ticket, real-time dashboard, budget alerts, cost caps
   - **FRs Covered:** FR85-FR88, FR105-FR108 (Cost Tracking, Cost Dashboard)

7. **Epic 7: TL Architecture Review Workflows**
   - **User Value:** TLs can review and approve AI architecture decisions before implementation
   - **Scope:** Architecture review queue, ADR viewing, approval/rejection, pattern constraints
   - **FRs Covered:** FR24-FR29 (TL Architecture Validation)

8. **Epic 8: QA Review & Quality Approval Gates**
   - **User Value:** Lead QA can review code samples and approve/reject for production
   - **Scope:** QA review queue, sampling configuration, quality metrics, approval workflows
   - **FRs Covered:** FR34-FR40, FR109-FR111 (Lead QA Capabilities, Quality Dashboard)

9. **Epic 9: Self-Healing & Production Monitoring**
   - **User Value:** System detects production issues and automatically creates fix tickets
   - **Scope:** Production error monitoring, bug detection, auto-ticket creation, severity prioritization
   - **FRs Covered:** FR79-FR83 (Self-Healing & Production Monitoring)

10. **Epic 10: Real-Time Updates & Orchestrator Monitoring**
    - **User Value:** Users get live updates on AI execution progress and system health
    - **Scope:** Socket.IO real-time events, execution progress updates, cost alerts, system monitoring dashboard
    - **FRs Covered:** FR9-FR10 (Real-time notifications), FR100-FR104 (Orchestrator Monitoring)

**Phase 2 Growth Epics** (TBD - After Phase 1 validation)

**Phase 3 Vision Epics** (TBD - After Phase 2 scale)

---

## FR Coverage Map

**Epic 1 (Foundation):** Infrastructure foundation for all FRs - enables subsequent epics

**Epic 2 (Ticket Intake & Routing):**

- FR56: Receive ClickUp webhook events
- FR57: Parse ticket details
- FR58: Validate ticket quality
- FR59: Extract project context
- FR60: Route to appropriate AI tool
- FR61: Convert to AI prompts
- FR62: Monitor AI execution
- FR63: Retry failed executions
- FR65: Execute AI code generation

**Epic 3 (Automated QA):**

- FR66: Run linting checks
- FR67: Execute automated tests
- FR68: Perform code review checks
- FR69: Calculate test coverage
- FR70: Block deployment on failures

**Epic 4 (GitHub & CI/CD):**

- FR72: Create feature branches
- FR73: Push code to GitHub
- FR74: Generate commit messages
- FR75: Create pull requests
- FR76: Trigger CI/CD pipelines
- FR77: Monitor deployment status
- FR78: Update ClickUp status

**Epic 5 (PM Dashboard):**

- FR8: View all AI projects
- FR9: Monitor real-time AI status
- FR10: Receive completion notifications
- FR11: Approve AI-generated code
- FR12: Request AI rework
- FR13: View AI confidence scores
- FR14: Escalate blocked tickets
- FR96-FR99: PM Dashboard interface

**Epic 6 (Cost Tracking):**

- FR85: Track AI API usage
- FR86: Calculate cost per ticket/project
- FR87: Alert on budget exceeded
- FR88: Pause on cost cap
- FR105-FR108: Cost monitoring dashboard

**Epic 7 (TL Architecture Review):**

- FR24: Review AI architecture decisions
- FR25: Approve/reject/modify proposals
- FR26: View ADRs
- FR27: Flag high-risk decisions
- FR28: Set architecture constraints
- FR29: Receive AI escalations

**Epic 8 (QA Review & Approval):**

- FR34: View sample queue
- FR35: Configure sampling
- FR36: Approve for production
- FR37: Reject with findings
- FR38: View automated QA results
- FR39: Define quality gates
- FR40: Track bug escape rates
- FR109-FR111: Quality dashboard

**Epic 9 (Self-Healing):**

- FR79: Monitor production errors
- FR80: Detect critical failures
- FR81: Auto-create fix tickets
- FR82: Analyze error logs
- FR83: Prioritize by severity

**Epic 10 (Real-Time & Monitoring):**

- FR9: Real-time status updates (Socket.IO)
- FR10: Completion notifications (Socket.IO)
- FR100: Orchestrator status dashboard
- FR101: Queue depth monitoring
- FR102: AI provider status
- FR103: Execution logs
- FR104: Manual intervention

**Additional MVP FRs (Distributed across epics):**

- FR1-FR7: PM ticket creation (integrated with AetherFlow - Epic 2)
- FR15-FR19: PM workload management (Epic 5 dashboard)
- FR20-FR23: Client communication (Epic 5)
- FR30-FR33: TL capability management (Epic 7)
- FR41-FR43: QA metrics (Epic 8)
- FR44-FR48: Manager business oversight (Epic 6)
- FR49-FR52: Manager workforce management (Epic 6)
- FR53-FR55: Manager client relationship (Epic 5/6)
- FR91-FR95: Execution metrics & logging (Epic 6/10)
- FR112-FR115: GO/NO-GO dashboard (Epic 6)

**Validation Check:** ✅ All 63 MVP Phase 1 FRs mapped to 10 epics

---

## Epic 1: Foundation & Development Environment

**ClickUp Epic ID:** `86evnjw6h`  
**ClickUp Epic URL:** https://app.clickup.com/t/86evnjw6h

**Epic Goal:** Establish the complete development foundation for the AI Dev Tool Orchestrator, enabling the development team to build, test, and deploy all subsequent features. This epic creates the project structure, core infrastructure, and deployment pipeline that supports the entire transformation.

**User Value:** Development team can build, test, and deploy the orchestrator with confidence. All foundational services (database, message queue, auth, monitoring, CI/CD) are operational and documented.

**Architecture Reference:** See `architecture.md` sections on Project Structure, Technology Stack, Deployment Architecture, and Development Environment.

---

### Story 1.1: NestJS Project Initialization

**ClickUp ID:** `86evnjw87` | **URL:** https://app.clickup.com/t/86evnjw87

As a developer,
I want a properly initialized NestJS project with TypeScript configuration,
So that I can start building the orchestrator with a solid foundation.

**Acceptance Criteria:**

**Given** I have Node.js 20.x LTS installed
**When** I run the project initialization command from architecture.md
**Then** the NestJS project is created with the following structure:

- `/src` directory with main.ts entry point
- `/test` directory for e2e tests
- `tsconfig.json` configured for strict TypeScript
- `nest-cli.json` configured per architecture spec
- `.eslintrc.js` and `.prettierrc` for code quality
- `.gitignore` excluding node_modules, dist, .env
- `package.json` with core NestJS dependencies

**And** TypeScript compilation succeeds without errors
**And** `npm run start:dev` launches the application successfully
**And** Health check endpoint returns 200 OK at `/health`

**Prerequisites:** None (first story)

**Technical Notes:**

- Use exact command from architecture.md: `npx @nestjs/cli new ai-dev-orchestrator --package-manager npm`
- Set up strict TypeScript (`strict: true`, `noImplicitAny: true`)
- Configure path aliases per architecture: `@/` maps to `src/`
- Install core dependencies: @nestjs/core, @nestjs/common, @nestjs/platform-express, reflect-metadata, rxjs
- Set up ESLint with NestJS recommended rules
- Architecture reference: Section "Project Initialization Command"

---

### Story 1.2: Project Structure & Module Organization

**ClickUp ID:** `86evnjw88` | **URL:** https://app.clickup.com/t/86evnjw88

As a developer,
I want a well-organized module structure following NestJS and architecture best practices,
So that the codebase is maintainable and scalable as we add features.

**Acceptance Criteria:**

**Given** the NestJS project is initialized
**When** I create the complete folder structure per architecture.md
**Then** the following directories exist with placeholder modules:

- `/src/modules/ticket-intake/` (module, service, dto folders)
- `/src/modules/ai-routing/` (module, service, dto folders)
- `/src/modules/qa-automation/` (module, service, dto folders)
- `/src/modules/github-integration/` (module, service, dto folders)
- `/src/modules/cost-tracking/` (module, service, dto folders)
- `/src/modules/monitoring/` (module, service, dto folders)
- `/src/common/` (shared utilities, guards, interceptors)
- `/src/config/` (configuration modules)
- `/prisma/` (schema and migrations)

**And** each module has a `*.module.ts` file importing required dependencies
**And** `app.module.ts` imports all feature modules
**And** the application starts without module resolution errors

**Prerequisites:** Story 1.1 (Project initialization)

**Technical Notes:**

- Follow architecture naming conventions: kebab-case for files/folders
- Each module should be self-contained with its own DTOs and services
- Use NestJS CLI to generate modules: `nest g module ticket-intake`
- Create barrel exports (index.ts) in common folders
- Architecture reference: Section "Complete Project Structure"

---

### Story 1.3: PostgreSQL Database Setup with Prisma

**ClickUp ID:** `86evnjw8e` | **URL:** https://app.clickup.com/t/86evnjw8e

As a developer,
I want a PostgreSQL database configured with Prisma ORM,
So that I can persist tickets, executions, and metrics reliably.

**Acceptance Criteria:**

**Given** PostgreSQL 16 is available (local or Docker)
**When** I set up Prisma with the schema from architecture.md
**Then** the following is configured:

- `prisma/schema.prisma` matches architecture data model exactly
- DATABASE_URL environment variable is configured
- `npx prisma generate` creates TypeScript client successfully
- `npx prisma migrate dev` creates all tables without errors

**And** the database contains these tables (per architecture):

- `tickets` (with enums for TicketStatus)
- `executions` (with enums for AIProvider, ExecutionStatus)
- `qa_results`
- `github_pushes` (with GitHubStatus enum)
- `deployments` (with DeploymentStatus enum)
- `cost_records`
- `production_errors` (with ErrorSeverity enum)
- `metrics`
- `audit_logs`

**And** all foreign key relationships are established
**And** indexes are created per architecture specification
**And** Prisma client is injectable via `@Injectable()` PrismaService

**Prerequisites:** Story 1.1 (Project initialization)

**Technical Notes:**

- Install dependencies: `npm install @prisma/client` and `npm install -D prisma`
- Initialize Prisma: `npx prisma init`
- Copy complete schema from architecture.md Section "Prisma Schema Design"
- Create PrismaService in `src/common/prisma/prisma.service.ts`
- Register PrismaModule globally for dependency injection
- Set up connection pooling: max 20 connections per architecture
- Architecture reference: Section "Data Architecture"

---

### Story 1.4: Environment Configuration & Secrets Management

**ClickUp ID:** `86evnjw8f` | **URL:** https://app.clickup.com/t/86evnjw8f

As a developer,
I want environment-based configuration with secure secrets management,
So that the application can run in different environments (dev, staging, prod) securely.

**Acceptance Criteria:**

**Given** the project structure is set up
**When** I implement configuration management
**Then** the following configuration is available:

- `.env.example` template with all required variables
- `.env` file for local development (git-ignored)
- `@nestjs/config` module configured globally
- ConfigService injectable in any module
- Environment validation on application startup

**And** these environment variables are defined:

- `NODE_ENV` (development, staging, production)
- `PORT` (default 3000)
- `DATABASE_URL` (PostgreSQL connection string)
- `RABBITMQ_URL` (RabbitMQ connection string)
- `JWT_SECRET` (for authentication)
- `CURSOR_API_KEY`, `WINDSURF_API_KEY`, `ANTIGRAVITY_API_KEY`
- `GITHUB_TOKEN`
- `CLICKUP_WEBHOOK_SECRET`

**And** application fails fast if required variables are missing
**And** secrets are never logged or exposed in error messages (per NFR-S4)

**Prerequisites:** Story 1.1 (Project initialization)

**Technical Notes:**

- Install: `npm install @nestjs/config`
- Use Joi schema validation for environment variables
- Create `src/config/configuration.ts` for typed config
- Encrypt sensitive values at rest (per NFR-S3: AES-256-GCM)
- Document all env vars in README.md
- Architecture reference: Section "Security Architecture"

---

### Story 1.5: RabbitMQ Message Queue Integration

**ClickUp ID:** `86evnjw8g` | **URL:** https://app.clickup.com/t/86evnjw8g

As a developer,
I want RabbitMQ integrated as the message queue,
So that I can process AI executions, QA checks, and deployments asynchronously.

**Acceptance Criteria:**

**Given** RabbitMQ 3.13 is available (local or Docker)
**When** I integrate RabbitMQ with NestJS
**Then** the following is configured:

- `@nestjs/microservices` with RabbitMQ transport installed
- RabbitMQ connection established via RABBITMQ_URL
- Connection health check succeeds

**And** these queues are created (per architecture):

- `ai-execution-queue` (for AI task processing)
- `qa-check-queue` (for quality gate checks)
- `deployment-queue` (for CI/CD triggers)
- `monitoring-queue` (for production events)

**And** dead letter queue is configured for failed messages
**And** RabbitMQ management UI is accessible at http://localhost:15672
**And** Message acknowledgment is configured (manual ack for reliability)

**Prerequisites:** Story 1.1 (Project initialization)

**Technical Notes:**

- Install: `npm install @nestjs/microservices amqplib`
- Create RabbitMQModule in `src/common/rabbitmq/`
- Configure exchanges and routing keys per architecture (dot notation)
- Set up retry logic: 3 attempts with exponential backoff
- Use durable queues for message persistence
- Architecture reference: Section "Message Queue" decision (ADR-003)

---

### Story 1.6: JWT Authentication Service Integration

**ClickUp ID:** `86evnjw8k` | **URL:** https://app.clickup.com/t/86evnjw8k

As a developer,
I want JWT-based authentication integrated with the separate auth service,
So that all endpoints are secured with role-based access control.

**Acceptance Criteria:**

**Given** the separate auth service is available (or mocked for dev)
**When** I implement JWT authentication
**Then** the following is configured:

- `@nestjs/jwt` and `@nestjs/passport` installed
- JWT strategy validates tokens using shared secret
- AuthGuard protects all routes by default
- JWT tokens contain claims: userId, role, permissions, exp

**And** these roles are defined (per architecture):

- ADMIN (full access)
- MANAGER (business oversight)
- PM (ticket creation, approval)
- TL (architecture review)
- QA (quality approval)
- VIEWER (read-only)

**And** RolesGuard enforces role-based permissions
**And** `@CurrentUser()` decorator extracts user from JWT
**And** Invalid/expired tokens return 401 Unauthorized
**And** Missing tokens on protected routes return 401 Unauthorized

**Prerequisites:** Story 1.4 (Environment config with JWT_SECRET)

**Technical Notes:**

- Install: `npm install @nestjs/jwt @nestjs/passport passport passport-jwt`
- Create JwtStrategy in `src/auth/strategies/jwt.strategy.ts`
- Create AuthGuard and RolesGuard in `src/common/guards/`
- Create CurrentUser decorator in `src/common/decorators/`
- Implement RBAC permission matrix from architecture.md
- Architecture reference: Section "Security Architecture" (Authentication Flow, ADR-004)

---

### Story 1.7: Winston Structured Logging Setup

**ClickUp ID:** `86evnjw8m` | **URL:** https://app.clickup.com/t/86evnjw8m

As a developer,
I want structured JSON logging with Winston,
So that all logs are searchable, traceable, and comply with observability requirements (NFR-O1-O4).

**Acceptance Criteria:**

**Given** the application is running
**When** I implement Winston logging
**Then** the following is configured:

- Winston logger with JSON format
- Log levels: error, warn, info, debug
- Correlation IDs auto-generated for each request
- Request IDs propagated across async operations

**And** all logs contain these fields:

- `level` (error/warn/info/debug)
- `timestamp` (ISO 8601)
- `requestId` (UUID)
- `correlationId` (UUID for tracing)
- `service` (ai-dev-orchestrator)
- `message` (human-readable)
- `context` (structured data object)
- `error` (stack trace if level === 'error')

**And** sensitive data is redacted from logs (passwords, tokens, PII)
**And** logs are written to console (dev) and file (prod)
**And** log rotation is configured (daily, 90-day retention per NFR-O3)

**Prerequisites:** Story 1.1 (Project initialization)

**Technical Notes:**

- Install: `npm install winston nest-winston`
- Create LoggerModule in `src/common/logger/`
- Use global interceptor to add requestId to all requests
- Create correlation ID middleware for tracing
- Format: architecture.md Section "Logging Format"
- Architecture reference: Section "Observability & Monitoring Requirements"

---

### Story 1.8: Prometheus Metrics Endpoints

**ClickUp ID:** `86evnjw8t` | **URL:** https://app.clickup.com/t/86evnjw8t

As a developer,
I want Prometheus-compatible metrics exposed,
So that we can monitor system health and make GO/NO-GO decisions (NFR-O5).

**Acceptance Criteria:**

**Given** the application is running
**When** I expose Prometheus metrics
**Then** the following is available:

- `/metrics` endpoint returns Prometheus-formatted metrics
- HTTP metrics: request count, duration, status codes
- Business metrics: tickets processed, executions count, cost totals
- System metrics: memory usage, CPU, active connections

**And** custom metrics are registered:

- `tickets_received_total` (counter)
- `ai_executions_total` (counter by provider)
- `qa_checks_total` (counter by result)
- `deployment_success_rate` (gauge)
- `cost_per_project` (histogram)
- `pm_utilization_percent` (gauge per PM)

**And** metrics are tagged with labels (project, AI provider, status)
**And** Prometheus can scrape `/metrics` every 15 seconds
**And** Grafana dashboards can query these metrics

**Prerequisites:** Story 1.1 (Project initialization)

**Technical Notes:**

- Install: `npm install @willsoto/nestjs-prometheus prom-client`
- Create MetricsModule in `src/common/metrics/`
- Register custom metrics per architecture spec
- Use @InjectMetric() decorator to access metrics in services
- Architecture reference: Section "Observability" (NFR-O5)

---

### Story 1.9: Sentry Error Tracking Integration

**ClickUp ID:** `86evnjw8v` | **URL:** https://app.clickup.com/t/86evnjw8v

As a developer,
I want Sentry integrated for error tracking and alerting,
So that critical failures trigger immediate alerts (NFR-O6) and we can debug production issues.

**Acceptance Criteria:**

**Given** Sentry account is configured
**When** I integrate Sentry error tracking
**Then** the following is configured:

- `@sentry/node` captures all unhandled exceptions
- Errors include full context (user, request, environment)
- Stack traces are source-mapped for TypeScript
- Sentry DSN is configured via environment variable

**And** these errors are automatically captured:

- Unhandled promise rejections
- Uncaught exceptions
- HTTP 5xx errors
- Database connection failures
- AI provider API failures

**And** errors include contextual data:

- User ID and role (from JWT)
- Request ID and correlation ID
- Ticket ID (if applicable)
- AI provider (if AI-related error)
- Environment (dev/staging/prod)

**And** alerts are configured for critical errors (Slack, email)
**And** Error breadcrumbs show recent actions leading to error

**Prerequisites:** Story 1.7 (Logging for error context)

**Technical Notes:**

- Install: `npm install @sentry/node`
- Initialize Sentry in main.ts before app bootstrap
- Create Sentry interceptor for request context
- Configure sample rate: 100% in dev, 10% in prod (cost control)
- Set up error grouping rules to reduce noise
- Architecture reference: Section "Error Tracking" (Monitoring stack)

---

### Story 1.10: Docker Compose Development Environment

**ClickUp ID:** `86evnjw8x` | **URL:** https://app.clickup.com/t/86evnjw8x

As a developer,
I want a Docker Compose setup for local development,
So that I can run PostgreSQL, RabbitMQ, and the orchestrator together easily.

**Acceptance Criteria:**

**Given** Docker and Docker Compose are installed
**When** I run `docker-compose up`
**Then** the following services start:

- PostgreSQL 16 on port 5432 with persistent volume
- RabbitMQ 3.13-management on port 5672 (AMQP) and 15672 (UI)
- Orchestrator application on port 3000 (dev mode with hot reload)

**And** services are networked (orchestrator can reach PostgreSQL and RabbitMQ)
**And** data persists across container restarts (volumes mounted)
**And** RabbitMQ management UI is accessible at http://localhost:15672
**And** Application logs stream to console in real-time

**Prerequisites:** Stories 1.3 (PostgreSQL), 1.5 (RabbitMQ)

**Technical Notes:**

- Create `docker-compose.yml` with services per architecture
- Use volumes for data persistence: `./data/postgres`, `./data/rabbitmq`
- Set up depends_on for service startup order
- Configure health checks for services
- Document in README: startup, shutdown, troubleshooting
- Architecture reference: Section "Deployment Architecture"

---

### Story 1.11: GitHub Actions CI/CD Pipeline

**ClickUp ID:** `86evnjw8z` | **URL:** https://app.clickup.com/t/86evnjw8z

As a developer,
I want a GitHub Actions pipeline for automated testing and deployment,
So that every commit is validated and deployments are automated (NFR-M5-M7).

**Acceptance Criteria:**

**Given** code is pushed to GitHub
**When** the CI/CD pipeline runs
**Then** the following jobs execute:

- **Lint Job:** ESLint checks pass, Prettier formatting verified
- **Test Job:** Unit tests run with >80% coverage (NFR-M1)
- **Build Job:** TypeScript compilation succeeds, Docker image built
- **E2E Test Job:** End-to-end tests run against test environment

**And** pull requests are blocked if checks fail
**And** main branch deployments trigger automatic staging deploy
**And** production deployments require manual approval
**And** failed deployments rollback automatically within 5 minutes (NFR-M6)

**And** the pipeline includes:

- Dependency caching for faster builds
- Test result reporting (coverage, failures)
- Docker image tagged with commit SHA
- Deployment status updates to ClickUp

**Prerequisites:** Story 1.1 (Project with tests)

**Technical Notes:**

- Create `.github/workflows/ci.yml` for continuous integration
- Create `.github/workflows/deploy.yml` for deployments
- Use GitHub Actions cache for node_modules
- Configure test coverage reporting (upload to Codecov or similar)
- Set up GitHub environments: staging, production
- Use secrets for deployment credentials
- Architecture reference: Section "CI/CD Pipeline" (ADR, Deployment Architecture)

---

### Story 1.12: API Documentation with Swagger/OpenAPI

**ClickUp ID:** `86evnjw8y` | **URL:** https://app.clickup.com/t/86evnjw8y

As a developer,
I want automatic API documentation with Swagger,
So that frontend developers and integrators can understand endpoints easily.

**Acceptance Criteria:**

**Given** API endpoints are implemented
**When** I access `/api/docs`
**Then** Swagger UI displays complete API documentation:

- All endpoints grouped by module
- Request/response schemas with examples
- Authentication requirements (JWT bearer token)
- HTTP status codes with descriptions
- DTO validation rules visible

**And** documentation is auto-generated from code decorators
**And** OpenAPI 3.0 JSON spec is available at `/api/docs-json`
**And** Try-it-out feature works with authentication
**And** Examples show realistic sample data

**Prerequisites:** Story 1.1 (Project initialization)

**Technical Notes:**

- Install: `npm install @nestjs/swagger`
- Set up Swagger in main.ts with `DocumentBuilder`
- Use decorators: @ApiTags, @ApiOperation, @ApiResponse, @ApiProperty
- Configure JWT bearer auth in Swagger UI
- Add examples to DTOs with @ApiProperty({ example: '...' })
- Architecture reference: Section "API Documentation"

---

### Story 1.13: Development Scripts & Documentation

**ClickUp ID:** `86evnjw90` | **URL:** https://app.clickup.com/t/86evnjw90

As a developer,
I want comprehensive npm scripts and README documentation,
So that new developers can onboard quickly (NFR-UX9: productive within 1 week).

**Acceptance Criteria:**

**Given** a new developer joins the team
**When** they read the README and run setup commands
**Then** the following documentation exists:

- README.md with: project overview, architecture overview, tech stack
- SETUP.md with: prerequisites, installation steps, environment config
- CONTRIBUTING.md with: code standards, PR process, testing guidelines
- ARCHITECTURE.md reference linked (already exists)

**And** these npm scripts are available:

- `npm run start:dev` - Start with hot reload
- `npm run start:debug` - Start with debugger attached
- `npm run build` - Production build
- `npm run test` - Run unit tests
- `npm run test:watch` - Tests in watch mode
- `npm run test:cov` - Coverage report
- `npm run test:e2e` - End-to-end tests
- `npm run lint` - ESLint check
- `npm run format` - Prettier format
- `npm run migration:generate` - Create Prisma migration
- `npm run migration:run` - Apply migrations
- `npm run seed` - Seed database with test data

**And** a developer can complete setup within 1 hour
**And** All commands work without manual file edits

**Prerequisites:** All previous Epic 1 stories

**Technical Notes:**

- Document exact versions of Node.js, npm, PostgreSQL, RabbitMQ
- Include troubleshooting section for common issues
- Add quick start for Docker Compose path
- Document environment variables in detail
- Link to architecture.md for technical deep-dive
- Architecture reference: Section "Development Environment Setup"

---

## Epic 1 Summary

**Total Stories:** 13  
**Prerequisites Flow:** Sequential from 1.1 → 1.13  
**Estimated Complexity:** Foundation epic (largest in Phase 1)

**Deliverables:**

- ✅ Complete NestJS project with TypeScript
- ✅ PostgreSQL database with Prisma ORM and full schema
- ✅ RabbitMQ message queue with 4 queues configured
- ✅ JWT authentication with RBAC (6 roles)
- ✅ Winston structured logging with correlation IDs
- ✅ Prometheus metrics endpoints
- ✅ Sentry error tracking
- ✅ Docker Compose dev environment
- ✅ GitHub Actions CI/CD pipeline
- ✅ Swagger API documentation
- ✅ Complete developer documentation

**Enables:** All subsequent epics (Epic 2-10) can build on this foundation

**Architecture Coverage:** Implements decisions from:

- ADR-001: NestJS microservice
- ADR-002: Separate PostgreSQL
- ADR-003: RabbitMQ message queue
- ADR-004: Separate auth with JWT
- Complete data model from Prisma schema
- All infrastructure patterns and naming conventions

---

## Epic 2: Ticket Intake & AI Routing Engine

**ClickUp Epic ID:** `86evnjw9b`  
**ClickUp Epic URL:** https://app.clickup.com/t/86evnjw9b

**Epic Goal:** Enable PMs to create tickets in AetherFlow and have them automatically routed to appropriate AI tools (Cursor CLI Headless or Claude Code) for code generation. This epic implements the core orchestration intelligence that connects ticket creation to AI execution using a multi-provider strategy.

**User Value:** PMs can create tickets and watch them automatically flow to the right AI tool without manual routing. The system intelligently parses requirements, validates quality, and generates optimal prompts. Multi-provider approach ensures reliability with automatic fallback if one provider fails.

**FRs Covered:** FR1-FR7 (PM ticket creation), FR56-FR65 (Webhook, Task Intake, AI Routing & Execution)

**Architecture Reference:** Multi-Provider AI Strategy (ADR-003: Cursor CLI Headless, ADR-006: Claude Code)

### Story 2.1: ClickUp Webhook Endpoint & Event Handling

**ClickUp ID:** `86evnjwa0` | **URL:** https://app.clickup.com/t/86evnjwa0

As a PM,
I want my ClickUp task creation to trigger the orchestrator automatically,
So that I don't need to manually start AI execution for each ticket.

**Acceptance Criteria:**

**Given** ClickUp webhooks are configured to point to our orchestrator  
**When** I create a task in ClickUp (via AetherFlow or directly)  
**Then** the orchestrator receives a webhook POST request at `/api/v1/webhooks/clickup`

**And** the webhook signature is validated using CLICKUP_WEBHOOK_SECRET (NFR-S11)  
**And** webhook events are logged with correlation ID (NFR-O2)  
**And** invalid signatures are rejected with 401 Unauthorized  
**And** successful webhooks return 200 OK within 5 seconds (NFR-P1)  
**And** duplicate events are deduplicated (idempotency based on event ID)  
**And** event payload is parsed into TypeScript DTO

**Prerequisites:** Story 1.6 (Auth for endpoint security), 1.7 (Logging)

**Technical Notes:**

- Create webhook controller in `src/modules/ticket-intake/`
- Implement HMAC SHA-256 signature validation
- Use ClickUp webhook event types: `taskCreated`, `taskUpdated`
- Store raw webhook payload in audit_logs table
- Architecture reference: NFR-I7 (reliable webhook handling with retries/duplicates)

### Story 2.2: Ticket Data Parsing & Validation

**ClickUp ID:** `86evnjwa2` | **URL:** https://app.clickup.com/t/86evnjwa2

As the system,
I want to parse ClickUp task data into our ticket model,
So that I can validate and process tickets consistently.

**Acceptance Criteria:**

**Given** a ClickUp webhook event is received  
**When** the system parses the task payload  
**Then** the following data is extracted:

- `clickup_task_id` (unique identifier)
- `project_id` (from ClickUp custom field or list)
- `title` (task name)
- `description` (task description - may contain markdown)
- `acceptance_criteria` (from description section or custom field)

**And** validation checks are performed:

- Title is not empty (min 10 characters)
- Description exists and is not empty
- Acceptance criteria are present and well-formed
- Project ID is valid and matches active project

**And** if validation fails:

- Ticket status set to `VALIDATION_FAILED`
- ClickUp task is commented with failure reasons
- PM is notified via ClickUp notification
- Ticket is NOT queued for AI processing

**And** if validation succeeds:

- Ticket record created in database with status `RECEIVED`
- Ticket quality score calculated (0-100 based on completeness)
- Correlation ID propagated from webhook

**Prerequisites:** Story 2.1 (Webhook handling), 1.3 (Database)

**Technical Notes:**

- Create ParseTicketDto and ValidateTicketDto
- Use class-validator decorators for validation rules
- Implement ticket quality scoring algorithm
- FR58: System validates ticket quality before routing
- Store parsed ticket in `tickets` table (Prisma schema)

### Story 2.3: AI Tool Selection & Routing Logic (Multi-Provider)

**ClickUp ID:** `86evnjwa3` | **URL:** https://app.clickup.com/t/86evnjwa3

As the system,
I want to intelligently route tickets to the most appropriate AI tool,
So that each task complexity level is handled by the optimal AI provider.

**Acceptance Criteria:**

**Given** a validated ticket exists  
**When** the routing engine analyzes the ticket  
**Then** the system selects an AI provider based on:

- **Task complexity assessment:**
  - Files to modify count (1 file vs 3+ files)
  - Architecture changes required (yes/no)
  - Cross-file dependencies (low/medium/high)
  - Estimated lines of code (<100 vs >100)
  - Ticket tags (architecture, refactor, complex, simple, bugfix)
- **Provider availability** (health check status)
- **Cost optimization** (prefer Claude Code for simple tasks)
- **Fallback readiness** (if primary fails, use secondary)

**And** routing rules are:

- **High complexity (score ≥10)** → Cursor CLI Headless (full repo context)
- **Low/Medium complexity (score <10)** → Claude Code (faster, cheaper)
- **If primary unavailable** → Automatic fallback to secondary provider

**And** routing decision is logged with:

- Justification (complexity score breakdown)
- Selected provider (CURSOR_HEADLESS | CLAUDE_CODE)
- Routing reason (complexity, availability, cost)
- Timestamp of routing decision

**And** if no provider is available:

- Ticket remains in `VALIDATED` status
- Retry scheduled after 5 minutes
- Alert sent to operators if downtime > 15 minutes

**Prerequisites:** Story 2.2 (Parsed tickets)

**Technical Notes:**

- Create AIRoutingService in `src/modules/ai-routing/`
- Implement complexity scoring algorithm (see architecture doc)
- FR60: System routes to appropriate AI tool based on task complexity
- Check provider health via API status check
- Architecture reference: Multi-Provider AI Strategy, ADR-003, ADR-006
- Create AIProviderFactory for provider selection

### Story 2.4: AI Prompt Generation from Ticket Context (Multi-Provider)

**ClickUp ID:** `86evnjwa4` | **URL:** https://app.clickup.com/t/86evnjwa4

As the system,
I want to convert ticket requirements into AI-executable prompts,
So that AI tools receive clear, complete instructions for code generation.

**Acceptance Criteria:**

**Given** a ticket is routed to an AI provider  
**When** the system generates the AI prompt  
**Then** the prompt includes:

- Clear task description from ticket title
- Complete requirements from ticket description
- Acceptance criteria in executable format (test scenarios)
- Project context (tech stack, coding standards, file structure)
- Relevant code files to modify (if specified in ticket)
- Technical requirements (types, error handling, best practices)

**And** prompt follows structured format with sections for:

- Task Title
- Description
- Acceptance Criteria
- Technical Requirements
- Context (tech stack, related files, dependencies)

**And** prompt is optimized per AI provider:

- **Cursor CLI Headless:** Include file paths, emphasize repository context (Cursor auto-indexes)
- **Claude Code:** Include file contents inline, emphasize autonomous coding, tool use for file operations

**And** prompt generation handles provider-specific limits:

- Cursor: Standard context window
- Claude Code: Extended context (200K+ tokens)

**And** prompt generation metrics are tracked (length, complexity, provider)

**Prerequisites:** Story 2.3 (Routing decision), FR3 (Context documents)

**Technical Notes:**

- Create PromptGeneratorService with provider-specific builders
- FR61: System converts tickets to AI-executable prompts
- Load context documents from ticket attachments
- Use provider-specific prompt templates:
  - `buildCursorPrompt()` - For Cursor CLI Headless
  - `buildClaudeCodePrompt()` - For Claude Code (include file contents)
- Limit prompt size to provider limits
- Architecture reference: Multi-Provider Prompt Engineering section

### Story 2.5: AI Execution Tracking & State Management

**ClickUp ID:** `86evnjwaa` | **URL:** https://app.clickup.com/t/86evnjwaa

As the system,
I want to track AI execution state throughout the process,
So that PMs can monitor progress and we can handle failures gracefully.

**Acceptance Criteria:**

**Given** an AI prompt is generated  
**When** execution is started  
**Then** an `Execution` record is created with id, ticket_id, ai_provider, prompt, status (QUEUED initially), started_at

**And** execution state transitions are tracked: QUEUED → IN_PROGRESS → COMPLETED/FAILED/TIMEOUT

**And** each state change:

- Updates `executions` table
- Logs to audit_logs
- Emits event to RabbitMQ
- Updates ticket status accordingly

**And** execution metadata is captured: confidence_score, retry_count, completed_at/failed_at, error_message

**Prerequisites:** Story 2.4 (Prompt generation), 1.5 (RabbitMQ)

**Technical Notes:**

- Use Prisma `executions` table
- Implement state machine pattern for transitions
- FR62: System monitors AI execution progress
- Emit events to `ai-execution-queue` for async processing

### Story 2.6: AI Provider Integration - Cursor CLI Headless Mode

**ClickUp ID:** `86evnjwab` | **URL:** https://app.clickup.com/t/86evnjwab

As the system,
I want to integrate with Cursor CLI in headless mode for code generation,
So that complex, multi-file tickets can generate code with full repository context.

**Acceptance Criteria:**

**Given** a ticket is routed to Cursor CLI Headless  
**When** the system executes Cursor headless  
**Then** the integration:

- Prepares isolated workspace (git clone to `/tmp/cursor-workspaces/ticket-{id}`)
- Creates feature branch (`feature/ticket-{id}`)
- Executes: `cursor --headless --dir /workspace --apply "prompt" --wait`
- Sets appropriate timeout (configurable, default 5 minutes)
- Monitors execution via process status
- Collects changes via `git diff HEAD`
- Parses files modified and change summary

**And** successful generation:

- Captures generated code via git diff
- Parses files changed from git
- Updates execution status to COMPLETED
- Tracks execution time for cost estimation
- Stores workspace path for debugging

**And** failed generation:

- Captures error output (stdout/stderr)
- Updates status to FAILED
- Determines if retryable (timeout, crash, vs invalid prompt)
- Schedules retry if appropriate
- Preserves workspace for debugging

**And** workspace management:

- One workspace per ticket execution
- Automatic cleanup after PR creation (or archive for 7 days)
- Supports concurrent executions (10+ workspaces)

**Prerequisites:** Story 2.5 (Execution tracking), 1.4 (Env config)

**Technical Notes:**

- Create CursorHeadlessProvider implementing AIProviderInterface
- Use Node.js `child_process.exec` for CLI execution
- FR65: Execute AI code generation
- Implement circuit breaker pattern
- Architecture reference: ADR-003 (Cursor CLI Headless Mode)
- Validation script: `scripts/validate-ai-providers.sh`
- Cursor CLI docs: https://cursor.com/docs/cli/overview

### Story 2.7: AI Provider Integration - Claude Code (Anthropic)

**ClickUp ID:** `86evnjwad` | **URL:** https://app.clickup.com/t/86evnjwad

As the system,
I want to integrate with Claude Code (Anthropic's autonomous coding agent) via API,
So that simple-to-medium complexity tickets can be handled cost-effectively with autonomous coding capabilities.

**Acceptance Criteria:**

**Given** a ticket is routed to Claude Code  
**When** the system calls the Anthropic API  
**Then** the integration:

- Authenticates using ANTHROPIC_API_KEY from environment
- Prepares isolated workspace (git clone to `/tmp/claude-workspaces/ticket-{id}`)
- Creates feature branch (`feature/ticket-{id}`)
- Loads relevant file contents into extended context
- Calls Anthropic API with:
  - Model: `claude-3-5-sonnet-20241022`
  - Extended context (200K+ tokens with file contents)
  - Tool use enabled for file operations
  - Max tokens: 8000
- Processes tool use responses (file edits, creates)
- Applies changes to workspace files
- Collects changes via `git diff HEAD`

**And** successful generation:

- Parses tool use calls for file operations
- Writes generated code to workspace files
- Captures git diff
- Updates execution status to COMPLETED
- Tracks API cost (input/output tokens)

**And** failed generation:

- Captures API error (rate limit, invalid request, etc.)
- Updates status to FAILED
- Determines if retryable
- Schedules retry if appropriate

**And** autonomous coding features:

- Multi-turn conversation support for complex tasks
- Tool use for file operations
- Extended context for large codebases
- Autonomous planning and execution

**And** cost tracking:

- Track input tokens (~$3/1M tokens)
- Track output tokens (~$15/1M tokens)
- Estimated cost per ticket (~$0.10-$0.50)

**Prerequisites:** Story 2.5 (Execution tracking), 1.4 (Env config)

**Technical Notes:**

- Create ClaudeCodeProvider implementing AIProviderInterface
- Install `@anthropic-ai/sdk` package
- FR65: Execute AI code generation
- Implement circuit breaker pattern
- Architecture reference: ADR-006 (Claude Code as Secondary Provider)
- Claude Code docs: https://www.claude.com/product/claude-code
- Tool schema for file operations: `edit_file`, `create_file`, `read_file`

### Story 2.8: Multi-Provider Orchestration & Fallback Logic

**ClickUp ID:** `86evnjwaf` | **URL:** https://app.clickup.com/t/86evnjwaf

As the system,
I want to implement intelligent provider selection and automatic fallback,
So that ticket processing continues even if one AI provider fails.

**Acceptance Criteria:**

**Given** a ticket needs AI code generation  
**When** the system selects a provider via AIProviderFactory  
**Then** provider selection follows these rules:

- Assess ticket complexity (0-100 score)
- **High complexity (≥10):** Try Cursor first → fallback to Claude Code
- **Low/Medium complexity (<10):** Try Claude Code first → fallback to Cursor
- Check provider availability before selection

**And** fallback logic handles failures:

- If primary provider fails with retryable error → fallback to secondary
- If secondary also fails → mark as FAILED, escalate to human
- Log fallback events with reason
- Track fallback frequency for monitoring

**And** provider availability checks:

- Health check before routing
- Circuit breaker pattern (open after 5 failures in 1 minute)
- Automatic circuit closer after 30 seconds
- Status monitoring for dashboard

**And** complexity assessment algorithm:

```typescript
score =
  (filesCount > 3 ? 5 : filesCount * 2) +
  (descriptionLength > 500 ? 3 : 0) +
  (hasTag('architecture') ? 5 : 0) +
  (hasTag('refactor') ? 4 : 0) +
  (acceptanceCriteria > 5 ? 2 : 0);

if (score >= 10) return 'high';
if (score >= 5) return 'medium';
return 'low';
```

**And** fallback metrics tracked:

- Fallback trigger count per provider
- Success rate after fallback
- Cost comparison (primary vs fallback)
- Time to completion comparison

**Prerequisites:** Story 2.6 (Cursor), Story 2.7 (Claude Code), Story 2.3 (Routing)

**Technical Notes:**

- Create AIProviderFactory in `src/modules/ai-routing/providers/`
- Implement BaseAIProvider interface for both providers
- Create FallbackStrategy service
- Architecture reference: Multi-Provider Routing Logic
- Circuit breaker library: `opossum` or custom implementation

### Story 2.9: AI Execution Retry Logic & Error Handling

**ClickUp ID:** `86evnjwag` | **URL:** https://app.clickup.com/t/86evnjwag

As the system,
I want to automatically retry failed AI executions with context,
So that transient failures don't require manual intervention.

**Acceptance Criteria:**

**Given** an AI execution fails  
**When** the system evaluates if retry is appropriate  
**Then** retry logic determines: is failure retryable? has max retries been reached? should we wait before retry? (exponential backoff)

**And** if retry is warranted: increment retry_count, schedule retry via RabbitMQ with delay, log retry attempt

**And** if retry limit exceeded or non-retryable: set FAILED permanently, notify PM, log to Sentry, update ticket

**And** error context is preserved across retries

**Prerequisites:** Stories 2.6-2.8 (AI providers), 1.9 (Sentry)

**Technical Notes:**

- FR63: System retries failed executions with error context
- Exponential backoff: 1s, 2s, 4s
- NFR-R3: Failed AI executions must be recoverable

### Story 2.10: RabbitMQ AI Execution Queue Processing

**ClickUp ID:** `86evnjwam` | **URL:** https://app.clickup.com/t/86evnjwam

As the system,
I want AI executions to be processed asynchronously via message queue,
So that webhook responses are fast and execution can scale independently.

**Acceptance Criteria:**

**Given** a ticket is validated and routed  
**When** execution is queued  
**Then** a message is published to `ai-execution-queue` with ticket_id, execution_id, ai_provider, priority, correlation_id

**And** a worker process consumes messages with manual acknowledgment, processes one execution at a time, updates execution status, handles crashes gracefully

**And** queue management: dead letter queue after 3 retries, queue depth monitoring, processing rate tracking

**Prerequisites:** Story 1.5 (RabbitMQ), Story 2.5 (Execution tracking)

**Technical Notes:**

- Create AIExecutionConsumer in `src/modules/ai-routing/consumers/`
- Use @MessagePattern decorator
- Architecture reference: RabbitMQ message format

### Story 2.11: Ticket Quality Scoring Algorithm

**ClickUp ID:** `86evnjwan` | **URL:** https://app.clickup.com/t/86evnjwan

As a PM,
I want to see a quality score for my tickets before submission,
So that I can improve ticket clarity and completeness.

**Acceptance Criteria:**

**Given** a ticket is created or updated  
**When** the quality scoring algorithm runs  
**Then** a score from 0-100 is calculated based on: Title clarity (15 pts), Description completeness (25 pts), Acceptance criteria (30 pts), Context documents (10 pts), Task complexity (10 pts), Prerequisites (10 pts)

**And** score feedback is provided: 90-100 Excellent, 70-89 Good, 50-69 Fair, 0-49 Poor

**And** specific improvement suggestions are shown

**And** score is stored in tickets.ticket_quality_score

**Prerequisites:** Story 2.2 (Ticket parsing)

**Technical Notes:**

- FR4: PMs can view ticket quality score before submitting
- Implement scoring algorithm in TicketQualityService

### Story 2.12: Project Context Extraction & Attachment

**ClickUp ID:** `86evnjwap` | **URL:** https://app.clickup.com/t/86evnjwap

As a PM,
I want to attach context documents to tickets,
So that AI has the necessary background to generate appropriate code.

**Acceptance Criteria:**

**Given** I'm creating a ticket in ClickUp/AetherFlow  
**When** I attach context documents  
**Then** the system: accepts common formats (PDF, MD, TXT, DOCX), validates file size (<10MB), extracts text content, stores references

**And** context is included in AI prompts: full text extracted, document titles included, project metadata auto-attached

**And** project context is cached for reuse

**Prerequisites:** Story 2.2, Story 2.4

**Technical Notes:**

- FR3: PMs can attach context documents
- FR59: System extracts project context
- Use libraries for file parsing

**Epic 2 Summary:**

**Total Stories:** 12  
**Deliverables:**

- ClickUp webhook integration
- Ticket parsing & validation
- Multi-provider AI routing algorithm (complexity-based)
- Provider-specific prompt generation
- Execution tracking
- **2 AI provider integrations:**
  - Cursor CLI Headless (primary - complex tasks)
  - Claude Code/Anthropic API (secondary - simple tasks)
- Multi-provider orchestration & fallback logic
- Retry logic with error handling
- RabbitMQ async processing
- Quality scoring algorithm
- Context extraction & attachment

**Architecture Impact:**

- Multi-provider strategy reduces single-point-of-failure risk
- Complexity-based routing optimizes cost and quality
- Automatic fallback ensures reliability
- Official tools (Cursor CLI + Anthropic SDK) eliminate custom AI integration

---

## Epic 3: Automated QA & Quality Gates

**ClickUp Epic ID:** `86evnjwb1`  
**ClickUp Epic URL:** https://app.clickup.com/t/86evnjwb1

**Epic Goal:** Ensure AI-generated code meets quality standards through automated validation (linting, testing, security checks) before human review. This epic implements the first line of defense against AI errors.

**User Value:** Teams can trust AI-generated code has passed basic quality gates. Lead QA can focus on strategic review instead of checking every syntax error and test failure.

**FRs Covered:** FR66-FR71 (Automated QA & Quality Gates)

### Story 3.1: Linting Integration for Multiple Languages

**ClickUp ID:** `86evnjwb4` | **URL:** https://app.clickup.com/t/86evnjwb4

As the system,
I want to run language-specific linters on AI-generated code,
So that code style and syntax errors are caught automatically.

**Acceptance Criteria:**

**Given** AI generates code for a ticket  
**When** QA automation runs  
**Then** appropriate linters execute based on file types:

- JavaScript/TypeScript: ESLint with project config
- Python: Pylint or Flake8
- Other languages: Corresponding linters (Go: golint, Ruby: RuboCop, etc.)

**And** linting results include:

- Error count and warning count
- Line numbers for each issue
- Error descriptions and suggested fixes
- Overall pass/fail status

**And** linting configuration uses project-specific rules (from codebase `.eslintrc`, `.pylintrc`, etc.)

**And** if linting fails: execution marked as QA_FAILED, results stored in qa_results table, PM notified with specific line numbers

**Prerequisites:** Story 2.6-2.8 (AI code generation complete), 1.3 (Database)

**Technical Notes:**

- FR66: System runs linting checks on AI-generated code
- Create QAAutomationService in `src/modules/qa-automation/`
- Use eslint Node.js API for programmatic execution
- Support multiple languages via plugin architecture
- Store results in `qa_results` table

### Story 3.2: Automated Test Execution Framework

**ClickUp ID:** `86evnjwb5` | **URL:** https://app.clickup.com/t/86evnjwb5

As the system,
I want to run existing project tests against AI-generated code,
So that regressions and broken functionality are detected automatically.

**Acceptance Criteria:**

**Given** AI code is pushed to a feature branch  
**When** test automation runs  
**Then** the system:

- Identifies test framework (Jest, Mocha, PyTest, etc.)
- Runs unit tests affected by code changes
- Runs integration tests if configured
- Captures test results (pass/fail, duration, coverage)

**And** test results include:

- Total tests run, passed, failed, skipped
- Failed test names and error messages
- Stack traces for failures
- Test execution time
- Coverage delta (if coverage changed)

**And** if tests fail: execution marked as QA_FAILED, detailed results stored, PM notified with failing test names

**Prerequisites:** Story 3.1 (Linting), Epic 2 (Code generated)

**Technical Notes:**

- FR67: System executes automated tests and reports results
- Use framework-specific CLI commands (jest, pytest, go test, etc.)
- Parse test output (TAP, JUnit XML, JSON reporters)
- Run tests in isolated environment (Docker container)
- Timeout tests after configurable duration (default: 5 minutes)

### Story 3.3: Test Coverage Calculation & Enforcement

**ClickUp ID:** `86evnjwb6` | **URL:** https://app.clickup.com/t/86evnjwb6

As the system,
I want to calculate test coverage and enforce minimum thresholds,
So that AI-generated code doesn't reduce overall project quality.

**Acceptance Criteria:**

**Given** tests have executed  
**When** coverage is calculated  
**Then** the system:

- Measures line coverage, branch coverage, function coverage
- Compares to previous coverage baseline
- Calculates coverage delta (increase/decrease %)
- Enforces minimum coverage threshold (configurable per project, default 80% per NFR-M1)

**And** coverage results include:

- Overall coverage % (lines, branches, functions)
- Coverage delta compared to main branch
- Uncovered lines in new code
- Files with coverage below threshold

**And** if coverage fails threshold: QA marked as failed, coverage report stored, PM notified with specific uncovered lines

**Prerequisites:** Story 3.2 (Test execution)

**Technical Notes:**

- FR69: System calculates test coverage and enforces minimum thresholds
- Use coverage tools: nyc/istanbul (JS), coverage.py (Python), etc.
- Store baseline coverage for comparison
- Generate HTML coverage reports for review
- NFR-M1: Orchestrator codebase must maintain >80% test coverage

### Story 3.4: Basic Security & Code Quality Checks

**ClickUp ID:** `86evnjwb7` | **URL:** https://app.clickup.com/t/86evnjwb7

As the system,
I want to run security scans on AI-generated code,
So that vulnerabilities and code smells are detected early.

**Acceptance Criteria:**

**Given** AI code is generated  
**When** security checks run  
**Then** the system performs:

- **Dependency vulnerability scanning** (npm audit, pip-audit, Snyk)
- **Secrets detection** (GitGuardian, TruffleHog) - prevents accidental credential commits
- **Code complexity analysis** (cyclomatic complexity, function length)
- **Security pattern checking** (SQL injection patterns, XSS vulnerabilities, OWASP Top 10)

**And** security results include:

- Vulnerability severity (critical, high, medium, low)
- Affected dependencies and versions
- Recommended fixes or patches
- Detected secrets (masked in logs per NFR-S4)

**And** if critical vulnerabilities found: QA fails, security report stored, alert sent to security team

**Prerequisites:** Story 3.1 (Linting)

**Technical Notes:**

- FR68: System performs basic code review checks (complexity, security patterns)
- NFR-S9: AI-generated code must pass security scanning (OWASP)
- NFR-S10: Secrets detection must prevent accidental commit
- Use multiple tools: ESLint security plugins, Snyk, npm audit
- Store findings in qa_results table

### Story 3.5: Quality Gate Decision Engine

**ClickUp ID:** `86evnjwb8` | **URL:** https://app.clickup.com/t/86evnjwb8

As the system,
I want to enforce quality gates that block deployment if standards aren't met,
So that only validated code proceeds to human review.

**Acceptance Criteria:**

**Given** all QA checks have completed  
**When** the quality gate evaluates results  
**Then** the system:

- Aggregates results from linting, testing, coverage, security checks
- Applies configurable rules per project or globally
- Determines overall pass/fail status
- Calculates quality score (0-100)

**And** quality gate rules include:

- **Blocking issues:** Critical security vulnerabilities, test failures, linting errors (not warnings)
- **Warning issues:** Code complexity > threshold, coverage below target, dependency vulnerabilities (low severity)
- **Threshold configuration:** Per project settings override defaults

**And** if quality gate fails: execution blocked from GitHub push, ticket status set to QA_FAILED, PM notified with actionable summary

**And** if quality gate passes: execution proceeds to GitHub integration (Epic 4), ticket status updated to QA_REVIEW

**Prerequisites:** Stories 3.1-3.4 (All QA checks)

**Technical Notes:**

- FR70: System blocks deployment if quality gates fail
- Create QualityGateService with rule engine
- Store gate configuration in database (configurable per project)
- Support override mechanism for emergency deployments (with audit trail)
- Architecture reference: NFR-O6 (Critical failures trigger alerts)

### Story 3.6: QA Results Storage & Retrieval

**ClickUp ID:** `86evnjwb9` | **URL:** https://app.clickup.com/t/86evnjwb9

As a Lead QA,
I want QA results stored and accessible,
So that I can review quality trends and make informed decisions.

**Acceptance Criteria:**

**Given** QA checks complete  
**When** results are stored  
**Then** the `qa_results` table contains:

- execution_id (link to execution)
- linting_passed (boolean), linting_errors (JSON array)
- tests_passed (boolean), test_results (JSON with pass/fail details)
- test_coverage (float %)
- code_review_passed (boolean), code_review_issues (JSON array)
- overall_passed (boolean)
- created_at (timestamp)

**And** results are queryable by:

- Execution ID
- Ticket ID
- Project
- Date range
- Pass/fail status

**And** API endpoints exist:

- GET `/api/v1/qa-results/:executionId` - Get results for execution
- GET `/api/v1/qa-results?ticketId={id}` - Get results by ticket
- GET `/api/v1/qa-results?projectId={id}&status=failed` - Query with filters

**Prerequisites:** Stories 3.1-3.5 (QA checks generating results), 1.3 (Database with qa_results table)

**Technical Notes:**

- Prisma schema includes `qa_results` model
- Create QAResultsController and QAResultsService
- Use JSON columns for detailed error storage
- Index by execution_id for fast lookups
- Architecture reference: Data Architecture section

### Story 3.7: RabbitMQ QA Queue Processing

**ClickUp ID:** `86evnjwba` | **URL:** https://app.clickup.com/t/86evnjwba

As the system,
I want QA checks to run asynchronously after AI code generation,
So that the pipeline remains responsive and scalable.

**Acceptance Criteria:**

**Given** AI execution completes successfully  
**When** code is ready for QA  
**Then** a message is published to `qa-check-queue` with execution_id, ticket_id, code_files, correlation_id

**And** QA worker consumes messages:

- Retrieves code from execution record
- Runs all QA checks (linting, testing, coverage, security)
- Stores results in qa_results table
- Updates execution status based on quality gate
- Publishes result to next queue (GitHub integration if pass)

**And** QA processing is tracked:

- Queue depth monitored
- Processing time per execution measured
- Failed QA messages retry with exponential backoff
- Dead letter queue for persistent failures

**Prerequisites:** Story 1.5 (RabbitMQ), Stories 3.1-3.6 (QA checks)

**Technical Notes:**

- Create QACheckConsumer in `src/modules/qa-automation/consumers/`
- Implement parallel QA check execution (lint + test + security run concurrently)
- Use Bull queues or native RabbitMQ delayed messages for retries
- Architecture reference: RabbitMQ queue structure

### Story 3.8: QA Metrics & Prometheus Integration

**ClickUp ID:** `86evnjwbe` | **URL:** https://app.clickup.com/t/86evnjwbe

As an operator,
I want QA metrics exposed to Prometheus,
So that I can monitor quality trends and system health.

**Acceptance Criteria:**

**Given** QA checks are running  
**When** metrics are collected  
**Then** Prometheus metrics include:

- `qa_checks_total{status="passed|failed", check_type="linting|testing|security"}`
- `qa_check_duration_seconds{check_type}`
- `qa_test_coverage_percent{project_id}`
- `qa_security_vulnerabilities_total{severity="critical|high|medium|low"}`
- `qa_queue_depth` (current items in queue)
- `qa_processing_rate` (checks per minute)

**And** metrics are tagged with labels: project_id, ai_provider, check_type, status

**And** Grafana dashboards can visualize:

- QA pass rate over time
- Average QA processing time
- Security vulnerabilities detected
- Test coverage trends

**Prerequisites:** Story 1.8 (Prometheus metrics), Stories 3.1-3.7 (QA checks)

**Technical Notes:**

- Use @InjectMetric() to access Prometheus counters/histograms
- Increment metrics in QAAutomationService
- FR109-111: Quality metrics dashboard requirements
- Architecture reference: Observability section (NFR-O5)

**Epic 3 Summary:**

**Total Stories:** 8  
**Deliverables:** Linting integration (multi-language), Automated test execution, Coverage calculation & enforcement, Security & quality checks, Quality gate engine, QA results storage, RabbitMQ async processing, Prometheus metrics

---

## Epic 4: GitHub Integration & CI/CD Pipeline

**ClickUp Epic ID:** `86evnjwbg`  
**ClickUp Epic URL:** https://app.clickup.com/t/86evnjwbg

**Epic Goal:** Automatically push validated AI-generated code to GitHub and trigger CI/CD deployments. This epic completes the automated pipeline from ticket to production.

**User Value:** Validated code flows automatically to GitHub and deploys without manual git commands. Teams get deployed features faster with full traceability.

**FRs Covered:** FR72-FR78 (GitHub Integration & Deployment)

### Story 4.1: GitHub API Client & Authentication

**ClickUp ID:** `86evnjwbj` | **URL:** https://app.clickup.com/t/86evnjwbj

As the system,
I want to authenticate with GitHub API securely,
So that I can perform git operations programmatically.

**Acceptance Criteria:**

**Given** GITHUB_TOKEN is configured in environment  
**When** the system initializes GitHub client  
**Then** authentication is configured:

- Fine-grained personal access token or GitHub App (NFR-S11)
- Minimal required permissions (read/write code, create PRs)
- Token rotation supported (load from env on each request)
- Rate limit handling (detect 429 responses, back off)

**And** client operations include:

- Get repository details
- Create branches
- Push commits
- Create pull requests
- Update commit status
- Add PR comments

**And** errors are handled gracefully: auth failures log to Sentry, rate limits trigger backoff, network errors retry with exponential backoff

**Prerequisites:** Story 1.4 (Env config with GITHUB_TOKEN), 1.9 (Sentry)

**Technical Notes:**

- FR72-78: GitHub operations foundation
- Use Octokit (official GitHub API client)
- Create GitHubService in `src/modules/github-integration/`
- NFR-S11: GitHub integration must use fine-grained tokens
- Architecture reference: GitHub Integration section

### Story 4.2: Feature Branch Creation

**ClickUp ID:** `86evnjwbk` | **URL:** https://app.clickup.com/t/86evnjwbk

As the system,
I want to create feature branches for each ticket automatically,
So that AI code changes are isolated and reviewable.

**Acceptance Criteria:**

**Given** QA checks pass for an execution  
**When** GitHub integration begins  
**Then** the system:

- Creates unique branch name following convention: `ai/{ticket_id}-{slugified-title}`
- Creates branch from main/master (or configured default branch)
- Verifies branch doesn't already exist
- Records branch name in `github_pushes` table

**And** branch naming follows architecture conventions: lowercase, kebab-case, max 63 characters

**And** if branch creation fails: log error, update execution status to FAILED, notify PM

**Prerequisites:** Story 4.1 (GitHub client), Story 3.5 (QA passed)

**Technical Notes:**

- FR72: System creates feature branches per ticket
- Use GitHub API: POST `/repos/{owner}/{repo}/git/refs`
- Get base branch SHA before creating ref
- Handle race conditions (branch already exists)
- Store branch_name in `github_pushes` table

### Story 4.3: Git Commit Generation & Push

**ClickUp ID:** `86evnjwbm` | **URL:** https://app.clickup.com/t/86evnjwbm

As the system,
I want to commit AI-generated code and push to GitHub,
So that code changes are versioned and traceable.

**Acceptance Criteria:**

**Given** a feature branch is created  
**When** the system commits code  
**Then** the commit:

- Includes all AI-generated files from execution.code_output
- Has meaningful commit message generated from ticket context
- Follows conventional commit format: `feat(scope): description` or `fix(scope): description`
- Includes ticket reference in message: `Implements #TICKET-123`
- Is signed (GPG) if configured

**And** commit message format:

```
{type}({scope}): {short description}

{longer description from ticket}

Implements: TICKET-{id}
AI-Generated: {ai_provider}
Execution-ID: {execution_id}
```

**And** push operation:

- Pushes commit to feature branch
- Records commit SHA in github_pushes table
- Handles push failures (conflicts, auth issues)

**Prerequisites:** Story 4.2 (Branch created)

**Technical Notes:**

- FR73: System pushes AI-generated code to GitHub
- FR74: System generates meaningful commit messages
- Use GitHub API: Create tree → Create commit → Update ref
- Parse execution.files_changed to determine scope
- Architecture reference: API Contracts section

### Story 4.4: Pull Request Creation & Metadata

**ClickUp ID:** `86evnjwbn` | **URL:** https://app.clickup.com/t/86evnjwbn

As the system,
I want to create pull requests automatically with rich context,
So that reviewers understand what was changed and why.

**Acceptance Criteria:**

**Given** code is pushed to feature branch  
**When** PR is created  
**Then** the PR includes:

- **Title:** Auto-generated from ticket title
- **Description:** Includes ticket description, acceptance criteria, AI provider used, execution ID
- **Labels:** Auto-tagged with `ai-generated`, `needs-review`, project name
- **Linked Issues:** References ClickUp ticket URL
- **Reviewers:** Auto-assigned based on project configuration (TL for architecture, QA for quality)

**And** PR description template:

```markdown
## Ticket Reference

ClickUp: [TICKET-{id}](url)

## Changes

{AI-generated description of changes}

## Acceptance Criteria

- [ ] {criterion 1}
- [ ] {criterion 2}

## AI Context

- Provider: {CURSOR_HEADLESS | CLAUDE_CODE}
- Complexity Score: {score}/100
- Confidence: {score}%
- Execution ID: {id}
- Fallback Used: {yes/no}

## QA Results

- Linting: ✅ Passed
- Tests: ✅ 45/45 passed
- Coverage: ✅ 87% (+2%)
- Security: ✅ No vulnerabilities
```

**And** PR metadata is stored in github_pushes table: pr_number, pr_url, created_at

**Prerequisites:** Story 4.3 (Code pushed)

**Technical Notes:**

- FR75: System creates PRs with traceability links
- Use GitHub API: POST `/repos/{owner}/{repo}/pulls`
- Load PR template from project .github/pull_request_template.md
- Request reviewers via API
- Update github_pushes.pr_number and pr_url

### Story 4.5: CI/CD Pipeline Trigger & Monitoring

**ClickUp ID:** `86evnjwbq` | **URL:** https://app.clickup.com/t/86evnjwbq

As the system,
I want to trigger CI/CD pipelines automatically when code is pushed,
So that deployments happen without manual intervention.

**Acceptance Criteria:**

**Given** a PR is created  
**When** CI/CD should trigger  
**Then** the system:

- Detects CI/CD provider (GitHub Actions, Jenkins, CircleCI, etc.)
- Triggers pipeline via webhook or API
- Monitors pipeline status (pending, running, success, failure)
- Records deployment in `deployments` table

**And** for GitHub Actions specifically:

- Pipeline triggers on push to feature branch (configured in workflow)
- Status checks appear on PR automatically
- Deployment environments are selected (dev, staging)

**And** pipeline monitoring:

- Polls for status updates every 30 seconds
- Updates deployment.status: TRIGGERED → IN_PROGRESS → COMPLETED/FAILED
- Records build_id, deployed_at timestamp

**Prerequisites:** Story 4.3 (Code pushed), 1.11 (CI/CD pipeline exists)

**Technical Notes:**

- FR76: System triggers CI/CD pipelines
- FR77: System monitors deployment status
- NFR-I9: CI/CD triggers must be provider-agnostic
- Use GitHub Checks API or Deployments API
- Create `deployments` table record linked to github_pushes

### Story 4.6: Deployment Status Synchronization

**ClickUp ID:** `86evnjwbt` | **URL:** https://app.clickup.com/t/86evnjwbt

As a PM,
I want ClickUp ticket status updated when deployment completes,
So that I know when my ticket is live in production.

**Acceptance Criteria:**

**Given** a deployment completes  
**When** the system receives deployment status  
**Then** the ticket status is updated:

- **Deployment success** → ClickUp status: `Deployed` or `Done`
- **Deployment failure** → ClickUp status: `Deployment Failed`, comment added with logs
- **Rollback** → ClickUp status: `Rolled Back`, comment with reason

**And** ClickUp comment is added:

```
🚀 Deployment Status: {Success/Failed}
Environment: {dev/staging/prod}
Deployed at: {timestamp}
Commit: {sha}
Build: {build_id}
{Deployment logs link}
```

**And** deployment events are logged to audit_logs

**Prerequisites:** Story 4.5 (Deployment monitoring)

**Technical Notes:**

- FR78: System updates ClickUp ticket status based on deployment results
- Use ClickUp API to update task status
- Use ClickUp API to add comments
- Handle ClickUp API rate limits
- NFR-O6: Deployment failures trigger real-time alerts

### Story 4.7: GitHub Push Error Handling & Rollback

**ClickUp ID:** `86evnjwbw` | **URL:** https://app.clickup.com/t/86evnjwbw

As the system,
I want to handle GitHub push failures gracefully,
So that failed pushes don't block the pipeline permanently.

**Acceptance Criteria:**

**Given** a GitHub push operation fails  
**When** the error handler processes the failure  
**Then** the system:

- Categorizes error type (auth, conflicts, rate limit, network)
- Determines if retryable
- Logs detailed error to Sentry with full context
- Notifies PM immediately via ClickUp comment (NFR-R5)

**And** for specific error types:

- **Merge conflicts:** Mark as non-retryable, escalate to TL for manual resolution
- **Auth failures:** Check token validity, alert operators
- **Rate limits:** Back off and retry after limit resets
- **Network errors:** Retry with exponential backoff (3 attempts)

**And** deployment failures trigger:

- Automatic rollback if configured
- Status update to deployments table (status: ROLLED_BACK)
- Incident logged for post-mortem

**Prerequisites:** Stories 4.3-4.6 (GitHub operations)

**Technical Notes:**

- NFR-R5: GitHub push failures must alert PM immediately
- NFR-R6: Deployment failures must trigger rollback and notification
- Implement rollback via GitHub Deployments API
- Architecture reference: Error Handling section

### Story 4.8: GitHub Integration Metrics & Monitoring

**ClickUp ID:** `86evnjwbx` | **URL:** https://app.clickup.com/t/86evnjwbx

As an operator,
I want GitHub integration metrics exposed,
So that I can monitor git operations and deployment success rates.

**Acceptance Criteria:**

**Given** GitHub operations are running  
**When** metrics are collected  
**Then** Prometheus metrics include:

- `github_push_total{status="success|failed", error_type}`
- `github_push_duration_seconds`
- `github_pr_created_total`
- `deployment_total{environment, status="completed|failed|rolled_back"}`
- `deployment_duration_seconds{environment}`
- `deployment_success_rate{environment}`

**And** metrics enable alerting:

- GitHub push failure rate > 10% (alert operations)
- Deployment failure rate > 5% (alert team)
- GitHub rate limit approaching (alert to throttle)

**Prerequisites:** Story 1.8 (Prometheus), Stories 4.1-4.7 (GitHub operations)

**Technical Notes:**

- Increment metrics in GitHubService
- FR96-99: PM dashboard shows deployment timelines
- Architecture reference: Observability (NFR-O5, NFR-O6)

**Epic 4 Summary:**

**Total Stories:** 8  
**Deliverables:** GitHub API client & auth, Feature branch creation, Commit generation & push, PR creation with metadata, CI/CD trigger & monitoring, Deployment status sync, Error handling & rollback, GitHub metrics

---

## Epic 5: PM Dashboard & Project Orchestration

**ClickUp Epic ID:** `86evnjwc0`  
**ClickUp Epic URL:** https://app.clickup.com/t/86evnjwc0

**Epic Goal:** Provide PMs with a unified dashboard to monitor all their AI projects, approve code, manage workload, and communicate with clients. This is the primary PM interface for orchestrating the Dark Factory.

**User Value:** PMs can see all their projects at a glance, take quick actions (approve, reject, escalate), monitor their workload to prevent burnout, and maintain client relationships efficiently.

**FRs Covered:** FR8-FR23 (PM Orchestration), FR96-FR99 (PM Dashboard interface), FR15-FR19 (Workload management), FR20-FR23 (Client communication)

### Story 5.1: PM Dashboard Frontend Foundation

**ClickUp ID:** `86evnjwc3` | **URL:** https://app.clickup.com/t/86evnjwc3

As a PM,
I want a responsive dashboard that loads quickly and works on desktop and mobile,
So that I can monitor projects from anywhere.

**Acceptance Criteria:**

**Given** I'm authenticated as a PM  
**When** I access `/dashboard/pm`  
**Then** the dashboard:

- Loads within 2 seconds (NFR-P2)
- Is responsive (desktop primary, mobile monitoring per NFR-UX1)
- Shows personalized data (my projects only, unless I'm a Manager)
- Uses real-time updates via Socket.IO (FR9)

**And** dashboard layout includes:

- Header with user name, role, notifications icon
- Sidebar navigation (Projects, Workload, Clients, Settings)
- Main content area (project cards/list view)
- Quick action buttons (<3 clicks per NFR-UX2)

**And** UI follows design system: colors, typography, spacing from UX guidelines

**Prerequisites:** Story 1.6 (Auth), Epic 2 (Data to display)

**Technical Notes:**

- Use React/Vue/Angular (choose based on team preference)
- FR96: PMs can view dashboard with project portfolio
- NFR-UX1: Dashboards must be responsive
- NFR-UX6: PM dashboard shows all projects at-a-glance
- **Frontend Repository:** Separate repository at `/Volumes/Data/project/products/alpharages/dsf-dashboard` (React + TypeScript)

### Story 5.2: Project List & Status Overview

**ClickUp ID:** `86evnjwc4` | **URL:** https://app.clickup.com/t/86evnjwc4

As a PM,
I want to see all my assigned projects with current status,
So that I can quickly identify what needs attention.

**Acceptance Criteria:**

**Given** I'm on the PM dashboard  
**When** I view my projects list  
**Then** each project shows:

- Project name and client
- Ticket counts (Total, In Progress, Completed, Blocked)
- Overall status indicator (green=healthy, yellow=attention needed, red=blocked)
- Latest activity timestamp
- Quick action buttons (View Details, Add Ticket)

**And** projects can be:

- Filtered (by status, client, date range)
- Sorted (by activity, ticket count, alphabetically)
- Searched (by name, client)

**And** empty states are handled gracefully: "No projects assigned yet"

**Prerequisites:** Story 5.1 (Dashboard foundation), Epic 2 (Ticket data)

**Technical Notes:**

- FR8: PMs can view all AI projects assigned to them
- Call API: GET `/api/v1/pm-dashboard/projects?pmId={id}`
- Use pagination for large project lists
- Architecture reference: PM Dashboard API contracts

### Story 5.3: Real-Time Ticket Execution Status

**ClickUp ID:** `86evnjwc5` | **URL:** https://app.clickup.com/t/86evnjwc5

As a PM,
I want to see real-time updates on AI execution for my tickets,
So that I know what's happening without constantly refreshing.

**Acceptance Criteria:**

**Given** an AI is processing my ticket  
**When** I'm viewing the project or ticket detail  
**Then** status updates appear in real-time:

- **QUEUED** → "Waiting for AI" (gray)
- **IN_PROGRESS** → "AI generating code..." with spinner (blue)
- **QA_REVIEW** → "Running quality checks..." (yellow)
- **GITHUB_PUSH** → "Pushing to GitHub..." (purple)
- **DEPLOYED** → "Deployed successfully" with checkmark (green)
- **FAILED** → "Failed - Review needed" with error icon (red)

**And** progress indicators show:

- Current step in pipeline
- Estimated time remaining (if available)
- AI provider being used (Cursor CLI Headless or Claude Code icon)
- Fallback status (if secondary provider was used)

**And** Socket.IO events update UI without page refresh

**Prerequisites:** Story 5.2 (Project list), Epic 10 (Real-time Socket.IO)

**Technical Notes:**

- FR9: PMs monitor real-time status of AI execution
- Subscribe to Socket.IO event: `execution-progress-update`
- Update UI reactively using state management (Redux, Zustand, etc.)
- Architecture reference: Socket.IO Event Naming

### Story 5.4: Code Approval Workflow Interface

**ClickUp ID:** `86evnjwc6` | **URL:** https://app.clickup.com/t/86evnjwc6

As a PM,
I want to review and approve AI-generated code before deployment,
So that I maintain control over what goes to production.

**Acceptance Criteria:**

**Given** AI code generation completes and passes QA  
**When** I receive approval request notification  
**Then** I can:

- View code diff (files changed, additions/deletions highlighted)
- See QA results summary (linting passed, 45/45 tests passed, 87% coverage)
- Read AI confidence score and any uncertainty flags
- Review original ticket and acceptance criteria side-by-side

**And** approval actions available:

- **Approve** → Proceeds to GitHub push and deployment
- **Reject** → Sends back to AI with rejection reason
- **Request Rework** → Add specific feedback/clarifications for AI retry
- **Escalate to TL** → Flags for technical lead review

**And** approval decision is:

- Logged to audit trail
- Notified to team via Socket.IO
- Recorded in execution record

**Prerequisites:** Story 5.3 (Status updates), Epic 3 (QA results), Epic 4 (Code ready)

**Technical Notes:**

- FR11: PMs can approve AI-generated code before deployment
- FR12: PMs can request AI rework with additional context
- FR14: PMs can escalate blocked tickets
- Use code diff library (diff2html, react-diff-viewer)
- POST `/api/v1/executions/{id}/approve` with decision

### Story 5.5: AI Confidence Scores & Uncertainty Flags

**ClickUp ID:** `86evnjwc7` | **URL:** https://app.clickup.com/t/86evnjwc7

As a PM,
I want to see AI confidence levels for each task,
So that I can prioritize review of uncertain outputs.

**Acceptance Criteria:**

**Given** AI completes code generation  
**When** I view the execution details  
**Then** I see:

- **Confidence score** (0-100%) displayed prominently
- **Confidence interpretation:**
  - 90-100%: High confidence (green) - AI is very certain
  - 70-89%: Medium confidence (yellow) - Review recommended
  - Below 70%: Low confidence (red) - Thorough review required

**And** uncertainty flags highlight:

- Ambiguous requirements AI couldn't fully understand
- Multiple valid implementation approaches AI considered
- Edge cases AI is unsure how to handle
- Missing context or dependencies AI detected

**And** low confidence scores:

- Automatically escalate to TL for review
- Require PM approval before deployment (can't auto-deploy)
- Prompt PM to add clarifying context for retry

**Prerequisites:** Story 5.3 (Status display), Epic 2 (Confidence scores from AI)

**Technical Notes:**

- FR13: PMs can view AI confidence scores and uncertainty flags
- Store confidence_score in executions table (already in schema)
- AI providers may or may not provide confidence - if not, use heuristics (test pass rate, QA results)
- Display uncertainty flags as expandable list

### Story 5.6: Workload & Capacity Dashboard

**ClickUp ID:** `86evnjwc8` | **URL:** https://app.clickup.com/t/86evnjwc8

As a PM,
I want to monitor my workload and capacity,
So that I can prevent burnout and request help before overload.

**Acceptance Criteria:**

**Given** I'm viewing my workload dashboard  
**When** the system calculates my utilization  
**Then** I see:

- **Current project count** (e.g., 12 projects)
- **Active tickets in progress** (e.g., 23 tickets)
- **Utilization percentage** (e.g., 75% of capacity)
- **Burnout risk indicator:**
  - Green (0-60%): Healthy workload
  - Yellow (61-80%): Approaching capacity
  - Red (81-100%): Burnout risk - reduce load

**And** workload metrics include:

- Tickets created this week
- Tickets approved/rejected this week
- Average ticket revision rate (lower = better ticket quality)
- Hours worked estimate (based on activity)

**And** alerts trigger:

- > 80% utilization → Alert PM and Manager
- Ticket revision rate >30% → "Your tickets need improvement" feedback
- No activity for 2+ days → "Check pending approvals" reminder

**Prerequisites:** Story 5.1 (Dashboard), Epic 2 (Ticket data)

**Technical Notes:**

- FR15: PMs can view current project load and utilization %
- FR16: PMs see burnout risk indicators
- FR17: PMs receive alerts when approaching capacity limits
- Calculate utilization: (active_tickets / max_tickets_per_pm) \* 100
- NFR-UX8: Workload indicators use visual cues (red/yellow/green)
- NFR-O8: PM burnout indicators alert manager

### Story 5.7: Manager View - Team Capacity Overview

**ClickUp ID:** `86evnjwc9` | **URL:** https://app.clickup.com/t/86evnjwc9

As a Manager,
I want to see all PMs' workload distribution,
So that I can balance capacity and prevent team burnout.

**Acceptance Criteria:**

**Given** I'm a Manager  
**When** I access the team capacity dashboard  
**Then** I see all PMs with:

- Name and current utilization % (bar chart)
- Project count per PM
- Ticket backlog per PM
- Burnout risk flags (red/yellow/green)

**And** I can:

- Reassign projects between PMs (drag-and-drop)
- View PM availability calendars
- See capacity trends over time (weekly chart)
- Filter by team, location, skill set

**And** alerts show:

- Any PM over 80% utilization
- Unbalanced workload (one PM at 90%, another at 40%)
- Vacation/PTO affecting capacity

**Prerequisites:** Story 5.6 (Workload data), Story 1.6 (RBAC for Manager role)

**Technical Notes:**

- FR18: Managers can view PM workload distribution
- FR19: Managers can reassign projects to balance capacity
- Use role guard: @Roles('MANAGER', 'ADMIN')
- POST `/api/v1/projects/{id}/reassign` with new PM ID

### Story 5.8: Client Communication Log

**ClickUp ID:** `86evnjwca` | **URL:** https://app.clickup.com/t/86evnjwca

As a PM,
I want to log client conversations with AI transcription,
So that I have searchable history of all client interactions.

**Acceptance Criteria:**

**Given** I have a client meeting  
**When** I log the conversation  
**Then** I can:

- Record meeting details (date, duration, attendees)
- Upload meeting transcripts (from Zoom, Google Meet, etc.)
- Link conversation to specific projects/tickets
- Tag conversation topics (requirements, feedback, escalation)

**And** AI assistance provides:

- Auto-generated summary of key points
- Action items extracted from transcript
- Sentiment analysis (client satisfied/concerned)
- Automatic ticket creation from action items

**And** conversation history is:

- Searchable by keyword, client, date, project
- Accessible to other team members (with permissions)
- Used as context for future AI code generation

**Prerequisites:** Story 5.1 (Dashboard), Epic 2 (Context extraction)

**Technical Notes:**

- FR20: PMs can log client conversations with AI transcription
- FR23: PMs can document client feedback and link to tickets
- Integrate with transcription APIs (Whisper, Rev, Otter.ai)
- Store in new table: client_conversations (add to Prisma schema)
- Use conversation content as context for future tickets

### Story 5.9: Sprint Review & Progress Reporting

**ClickUp ID:** `86evnjwcb` | **URL:** https://app.clickup.com/t/86evnjwcb

As a PM,
I want to generate progress reports for client sprint reviews,
So that I can share transparent updates efficiently.

**Acceptance Criteria:**

**Given** I need to present sprint review to client  
**When** I generate progress report  
**Then** the report includes:

- **Sprint summary:** Dates, goals, completed tickets
- **Ticket breakdown:** Completed, in-progress, blocked with visual indicators
- **Velocity metrics:** Tickets completed vs. planned, trend chart
- **Quality metrics:** Test pass rate, coverage, defects
- **Upcoming sprint:** Planned tickets, estimated completion

**And** report formats available:

- PDF download for email
- Web view shareable via link
- PowerPoint export for presentations

**And** report is generated in <5 seconds

**Prerequisites:** Story 5.2 (Project data), Epic 3 (QA metrics)

**Technical Notes:**

- FR21: PMs can share project progress reports with clients
- FR22: PMs can schedule sprint reviews and availability windows
- Use reporting library (puppeteer for PDF, chart.js for graphs)
- Template-based reports (configurable per client)

### Story 5.10: Quick Actions & Keyboard Shortcuts

**ClickUp ID:** `86evnjwcc` | **URL:** https://app.clickup.com/t/86evnjwcc

As a PM,
I want keyboard shortcuts and quick actions,
So that I can work efficiently without excessive clicking.

**Acceptance Criteria:**

**Given** I'm using the PM dashboard  
**When** I use keyboard shortcuts  
**Then** common actions are accessible:

- `A` - Approve current execution
- `R` - Request rework
- `E` - Escalate to TL
- `/` - Focus search bar
- `N` - Create new ticket
- `Esc` - Close modal/dialog

**And** quick actions menu (`Cmd+K` or `Ctrl+K`):

- Searchable command palette
- Recent projects
- Jump to ticket by ID
- Common actions (Approve, Reject, Escalate)

**And** tooltips show shortcuts on hover

**Prerequisites:** Story 5.1 (Dashboard foundation)

**Technical Notes:**

- NFR-UX2: Critical actions must be <3 clicks from dashboard
- Use keyboard shortcut library (Mousetrap, React HotKeys)
- Command palette component (cmdk, kbar)
- NFR-UX9: New PMs productive within 1 week (shortcuts help)

**Epic 5 Summary:**

**Total Stories:** 10  
**Deliverables:** Responsive dashboard foundation, Project list with status, Real-time execution updates, Code approval workflow, Confidence scores display, Workload monitoring, Manager team capacity view, Client communication log, Sprint reporting, Quick actions & keyboard shortcuts

---

## Epic 6: Cost Tracking & Budget Monitoring

**ClickUp Epic ID:** `86evnjwce`  
**ClickUp Epic URL:** https://app.clickup.com/t/86evnjwce

**Epic Goal:** Track AI compute costs in real-time, prevent budget overruns, and provide financial visibility for GO/NO-GO decisions. This epic addresses the Risk #3 (Cost Explosion) from the brainstorming session.

**User Value:** Managers can see exactly how much each project costs, prevent runaway AI spending, and make data-driven financial decisions about the transformation.

**FRs Covered:** FR85-FR90 (Cost Tracking & Optimization), FR105-FR108 (Cost Dashboard), FR44-FR48 (Manager business oversight), FR112-FR115 (GO/NO-GO dashboard)

### Story 6.1: AI API Usage Tracking

**ClickUp ID:** `86evnjwch` | **URL:** https://app.clickup.com/t/86evnjwch

As the system,
I want to track every AI API call with associated costs,
So that we have accurate cost data per project and provider.

**Acceptance Criteria:**

**Given** an AI execution completes (Cursor CLI Headless or Claude Code)  
**When** the execution finishes  
**Then** a cost record is created with:

- ticket_id and execution_id (traceability)
- ai_provider (CURSOR | WINDSURF | ANTIGRAVITY)
- operation_type (code_generation, review, etc.)
- tokens_used (if provider reports it)
- api_calls count (integer)
- cost_in_cents (calculated from provider pricing)
- created_at (timestamp)

**And** cost calculation uses:

- Provider-specific pricing models (per token, per call, per minute)
- Real-time pricing from provider APIs (if available)
- Cached pricing table (updated daily)

**And** costs are stored in cents (not dollars) to avoid floating-point errors per architecture

**Prerequisites:** Stories 2.6-2.8 (AI provider integrations), 1.3 (Database with cost_records table)

**Technical Notes:**

- FR85: System tracks AI API usage (calls, tokens, costs) per project
- Create CostTrackingService in `src/modules/cost-tracking/`
- **Pricing models:**
  - **Cursor CLI Headless:** Fixed license cost (~$2,500/month) / execution time
  - **Claude Code:** Pay-per-use ($3/1M input tokens, $15/1M output tokens)
  - Typical Claude Code ticket: $0.10-$0.50
  - Estimated blended cost: ~$29.50/ticket (100 tickets/month)
- Store in `cost_records` table per Prisma schema
- Architecture reference: Cost Storage section (cents, not dollars)
- Track execution time for Cursor, tokens for Claude Code

### Story 6.2: Real-Time Cost Calculation Per Ticket/Project

**ClickUp ID:** `86evnjwcj` | **URL:** https://app.clickup.com/t/86evnjwcj

As a Manager,
I want to see costs accumulate in real-time as AI works,
So that I can stop execution if costs exceed expectations.

**Acceptance Criteria:**

**Given** AI is executing a ticket  
**When** API calls are made  
**Then** costs are:

- Calculated immediately after each API call
- Aggregated at ticket level (sum of all executions for that ticket)
- Aggregated at project level (sum of all tickets in project)
- Updated in real-time via Socket.IO events

**And** cost metrics available:

- Cost per ticket (individual ticket view)
- Cost per project (project dashboard)
- Cost per AI provider (compare Cursor CLI Headless vs Claude Code)
- Cost per PM (track which PMs create efficient tickets)
- Provider utilization (% of tickets routed to each provider)
- Fallback cost impact (cost when using fallback provider)

**And** API endpoint provides:

- GET `/api/v1/costs/ticket/{ticketId}` - Ticket cost details
- GET `/api/v1/costs/project/{projectId}` - Project cost summary
- GET `/api/v1/costs/summary?startDate={}&endDate={}` - Time-based summary

**Prerequisites:** Story 6.1 (Cost tracking), Story 5.3 (Real-time updates)

**Technical Notes:**

- FR86: System calculates cost per ticket and per project in real-time
- NFR-P8: Cost calculation must occur in real-time (not batch)
- Use Prisma aggregations for sums
- Emit Socket.IO event `cost-update` when costs change
- Architecture reference: Cost Tracking API contracts

### Story 6.3: Budget Alerts & Thresholds

**ClickUp ID:** `86evnjwck` | **URL:** https://app.clickup.com/t/86evnjwck

As a Manager,
I want automated alerts when projects exceed cost budgets,
So that I can take action before costs spiral out of control.

**Acceptance Criteria:**

**Given** cost budgets are configured per project  
**When** project costs cross thresholds  
**Then** alerts are sent:

- **50% budget** → Info notification to PM
- **75% budget** → Warning to PM and Manager
- **90% budget** → Urgent alert to PM, Manager, and leadership
- **100% budget** → Critical alert + execution paused automatically

**And** alert channels include:

- In-app notification (dashboard)
- Email to responsible parties
- Slack webhook (if configured)
- Socket.IO real-time push

**And** alert contains:

- Current cost vs. budget (e.g., "$487 of $500 used - 97%")
- Trend (spending $X/day → will exceed in Y days)
- Top cost drivers (which tickets/AI providers costing most)
- Action buttons (Increase Budget, Pause Project)

**Prerequisites:** Story 6.2 (Cost calculation), Story 5.3 (Real-time notifications)

**Technical Notes:**

- FR87: System alerts when project exceeds cost budget
- NFR-O7: Cost threshold breaches alert immediately
- Create budget configuration in projects table (add budget_cents column)
- Check threshold after each cost_record insert
- Use notification service for multi-channel alerts

### Story 6.4: Automatic Cost Cap Enforcement

**ClickUp ID:** `86evnjwcm` | **URL:** https://app.clickup.com/t/86evnjwcm

As a Manager,
I want execution to pause automatically if hard cost cap is reached,
So that we never accidentally spend beyond approved limits.

**Acceptance Criteria:**

**Given** a project has a hard cost cap configured  
**When** costs reach 100% of cap  
**Then** the system:

- Pauses all AI executions for that project
- Sets project status to COST_CAP_EXCEEDED
- Cancels queued tickets (moves to PAUSED state)
- Sends critical alert to Manager and leadership

**And** execution resume requires:

- Manager approval (explicit action)
- Budget increase (update cost cap)
- Both logged to audit trail

**And** while paused:

- New tickets for project are rejected with cost cap message
- Existing tickets remain in database (not deleted)
- PMs receive clear explanation when creating tickets

**Prerequisites:** Story 6.3 (Alerts)

**Technical Notes:**

- FR88: System pauses AI execution if hard cost cap reached
- NFR-R7: Cost cap exceeded must pause execution (not continue)
- Add cost cap check before queuing AI execution
- Update ticket status to COST_PAUSED (new enum value)
- Require Manager role to resume

### Story 6.5: Cost Monitoring Dashboard

**ClickUp ID:** `86evnjwcn` | **URL:** https://app.clickup.com/t/86evnjwcn

As a Manager,
I want a dedicated cost dashboard with trends and breakdowns,
So that I can understand spending patterns and optimize costs.

**Acceptance Criteria:**

**Given** I'm viewing the cost dashboard  
**When** I select a time period (daily, weekly, monthly)  
**Then** I see:

- **Total spend** (big number with trend arrow)
- **Spend by AI provider** (pie chart showing Cursor CLI Headless vs Claude Code distribution)
  - Example: Cursor 55%, Claude Code 45%
- **Spend by project** (bar chart: top 10 projects)
- **Spend by PM** (helps identify which PMs create cost-efficient tickets)
- **Trend chart** (line graph over time)
- **Provider utilization** (tickets processed per provider)
- **Fallback frequency** (% of tickets that required fallback)

**And** interactive features:

- Drill down into specific project/provider/PM
- Date range picker (last 7 days, last 30 days, custom)
- Export to CSV/Excel
- Compare periods (this month vs. last month)

**And** cost insights displayed:

- Average cost per ticket (target: ~$29.50/ticket)
- Most expensive tickets (outliers)
- Cost optimization suggestions:
  - "Claude Code is 95% cheaper for simple tasks - route more tickets to it"
  - "Improve ticket quality to reduce AI retries (saves 15% on cost)"
  - "Complex tickets benefit from Cursor's repo context - maintain current routing"

**Prerequisites:** Story 6.2 (Cost data), Story 5.1 (Dashboard foundation)

**Technical Notes:**

- FR105-108: Cost monitoring dashboard requirements
- Use charting library (Chart.js, Recharts, D3)
- API: GET `/api/v1/costs/summary` with filters
- Architecture reference: Cost Dashboard API contracts

### Story 6.6: GO/NO-GO Decision Dashboard

**ClickUp ID:** `86evnjwcp` | **URL:** https://app.clickup.com/t/86evnjwcp

As Leadership,
I want a dashboard showing all critical success metrics for phase gates,
So that we can make data-driven GO/NO-GO decisions.

**Acceptance Criteria:**

**Given** we're at a phase gate (end of Phase 1, Phase 2, etc.)  
**When** I access the GO/NO-GO dashboard  
**Then** I see all criteria from PRD:

**Phase 1 → Phase 2 Gate:**

- ✅/❌ PM capacity proven: 1 PM handles 10+ projects (current: 12 ✅)
- ✅/❌ Costs predictable: AI compute <30% revenue (current: 22% ✅)
- ✅/❌ Quality acceptable: Bug escape rate <5% (current: 3.2% ✅)
- ✅/❌ Client acceptance: NPS >7/10 (current: 8.1 ✅)

**And** each metric shows:

- Current value
- Target value
- Trend (improving/declining)
- Status (green=pass, yellow=borderline, red=fail)

**And** dashboard provides:

- Overall GO/NO-GO recommendation (all criteria green → GO)
- Historical data (track metrics over time)
- Export report for stakeholder presentation

**Prerequisites:** Story 6.5 (Cost data), Epic 3 (Quality data), Epic 5 (PM workload data)

**Technical Notes:**

- FR112-115: GO/NO-GO decision dashboard
- Pull metrics from multiple sources:
  - Cost data from cost_records
  - Quality data from qa_results
  - PM workload from tickets + projects
  - Client satisfaction (manual input or from surveys)
- Success criteria defined in PRD (Phase-Specific Success Criteria section)

### Story 6.7: Cost Optimization Recommendations

**ClickUp ID:** `86evnjwcq` | **URL:** https://app.clickup.com/t/86evnjwcq

As a Manager,
I want AI-powered cost optimization suggestions,
So that I can reduce spending without sacrificing quality.

**Acceptance Criteria:**

**Given** cost data is analyzed  
**When** optimization engine runs  
**Then** recommendations are generated:

- "Route more simple tasks to Claude Code (95% cheaper than Cursor for single-file changes)"
- "Improve ticket quality (reduces failed executions and rework by 30%)"
- "Project X has high complexity tickets → ensure Cursor is used for best results"
- "Claude Code fallback success rate is 85% → reliable secondary option"
- "Batch similar tickets together (reduces workspace setup overhead by 15%)"

**And** recommendations include:

- Estimated savings (e.g., "Save ~$500/month by routing 20% more to Claude Code")
- Provider performance metrics (success rate, average time)
- Ticket quality improvements needed
- Implementation difficulty (Easy, Medium, Hard)
- Risk assessment (Low, Medium, High)

**And** Manager can:

- Apply recommendation (one-click implementation)
- Dismiss recommendation (with reason)
- Schedule recommendation (implement next sprint)

**Prerequisites:** Story 6.5 (Cost data and patterns)

**Technical Notes:**

- FR89-90: Cost optimization (Phase 2) - caching, batching
- Analyze patterns: which provider cheapest for which task types
- Track execution success rate per provider
- Calculate opportunity cost of failed executions
- Use ML or rule-based engine for recommendations

### Story 6.8: Financial Metrics for Business Oversight

**ClickUp ID:** `86evnjwct` | **URL:** https://app.clickup.com/t/86evnjwct

As a Manager,
I want comprehensive financial metrics,
So that I can evaluate overall business impact of the transformation.

**Acceptance Criteria:**

**Given** I'm viewing business metrics dashboard  
**When** financial data is displayed  
**Then** I see:

- **Revenue:** Total revenue from projects (manual input or from billing system)
- **Costs:** Total AI compute costs + infrastructure costs
- **Gross Margin:** (Revenue - Costs) / Revenue × 100%
- **Cost per Project:** Average AI cost per completed project
- **Profitability by Project Type:** Which project types most profitable

**And** trend analysis shows:

- Margin trends over time (improving/declining)
- Cost trends vs. project volume (scaling efficiency)
- Breakeven analysis (when transformation pays for itself)

**And** comparisons available:

- Current (AI-augmented) vs. previous (human developers) cost structure
- Projected vs. actual costs (are we on target?)

**Prerequisites:** Story 6.5 (Cost dashboard), Story 5.7 (Project volume data)

**Technical Notes:**

- FR44-48: Manager business oversight capabilities
- Integrate with billing/accounting system for revenue data
- Calculate metrics per PRD success criteria
- Track toward goals: 15 → 20 → 50 projects, 40% → 50% margins
- NFR-SC9: Infrastructure costs scale sub-linearly with volume

**Epic 6 Summary:**

**Total Stories:** 8  
**Deliverables:** AI API usage tracking, Real-time cost calculation, Budget alerts & thresholds, Automatic cost cap enforcement, Cost monitoring dashboard, GO/NO-GO decision dashboard, Cost optimization recommendations, Financial metrics dashboard

---

## Epic 7: TL Architecture Review Workflows

**ClickUp Epic ID:** `86evnjwcw`  
**ClickUp Epic URL:** https://app.clickup.com/t/86evnjwcw

**Epic Goal:** Enable Technical Leads to review and approve AI architecture decisions before implementation, preventing technical debt and ensuring system quality. This epic addresses the TL Validation Bottleneck risk (R7).

**User Value:** TLs can efficiently review AI's architecture proposals, approve sound decisions quickly, and intervene when AI makes poor technical choices - maintaining system quality at scale.

**FRs Covered:** FR24-FR33 (TL Architecture Validation, AI Capability Management)

### Story 7.1: Architecture Decision Records (ADR) Generation

**ClickUp ID:** `86evnjwcz` | **URL:** https://app.clickup.com/t/86evnjwcz

As the system,
I want AI to document its architecture decisions in ADR format,
So that TLs can review the reasoning behind technical choices.

**Acceptance Criteria:**

**Given** AI makes an architecture decision during code generation  
**When** the decision is significant (new dependencies, design patterns, infrastructure changes)  
**Then** an ADR is created with:

- **Title:** Short desc

riptive name (e.g., "Use Redis for Session Storage")

- **Status:** Proposed (awaiting TL review)
- **Context:** Why this decision is needed
- **Decision:** What was chosen
- **Consequences:** Positive and negative impacts
- **Alternatives Considered:** Other options AI evaluated
- **AI Confidence:** How certain AI is about this choice

**And** ADR is stored in database (add adrs table to Prisma schema)  
**And** ADR is linked to execution and ticket  
**And** ADR follows standard ADR format (Michael Nygard template)

**Prerequisites:** Epic 2 (AI code generation with architecture awareness)

**Technical Notes:**

- FR26: TLs can view ADRs documenting AI's choices
- Create ADRService in `src/modules/architecture-review/`
- Parse AI output for architecture decisions (may require AI provider support)
- Store in new `architecture_decisions` table
- ADR format: https://adr.github.io/

### Story 7.2: TL Architecture Review Queue

**ClickUp ID:** `86evnjwd0` | **URL:** https://app.clickup.com/t/86evnjwd0

As a TL,
I want a dedicated queue of architecture decisions requiring my review,
So that I can efficiently approve/reject AI's technical choices.

**Acceptance Criteria:**

**Given** ADRs are generated by AI  
**When** I access my TL review queue  
**Then** I see:

- List of pending ADRs (status: Proposed)
- Priority indicators (high-risk vs. low-risk decisions)
- Ticket context (what feature is this for)
- AI confidence level for each decision

**And** I can filter/sort by:

- Risk level (high-risk decisions first)
- Project
- Date created
- AI confidence (review low-confidence first)

**And** each ADR shows:

- Quick preview of decision
- "Review" button (<3 clicks per NFR-UX2)
- Time estimated for review (based on complexity)

**Prerequisites:** Story 7.1 (ADRs exist), Story 1.6 (TL role auth)

**Technical Notes:**

- FR24: TLs can review AI-generated architecture decisions in dedicated queue
- API: GET `/api/v1/architecture-review/queue?status=proposed`
- Use role guard: @Roles('TL', 'ADMIN')
- Sort by risk level (calculated from impact + confidence)

### Story 7.3: Risk-Based Review Prioritization

**ClickUp ID:** `86evnjwd1` | **URL:** https://app.clickup.com/t/86evnjwd1

As a TL,
I want high-risk architecture decisions flagged for thorough review,
So that I can focus my time on decisions that matter most.

**Acceptance Criteria:**

**Given** ADRs are created  
**When** risk level is calculated  
**Then** decisions are classified:

- **High-risk:** New dependencies, database schema changes, security patterns, infrastructure changes (require TL review)
- **Medium-risk:** Design pattern changes, significant refactoring (recommend TL review)
- **Low-risk:** Minor refactoring, code organization, style improvements (spot-check acceptable)

**And** risk indicators are based on:

- Scope of impact (how many files/modules affected)
- Reversibility (easy to undo or requires migration)
- AI confidence (low confidence = higher risk)
- Domain complexity (security, data, API contracts = high risk)

**And** high-risk decisions:

- Block deployment until TL approves
- Send immediate notification to TL
- Escalate to architect if TL unavailable >4 hours

**Prerequisites:** Story 7.1 (ADRs), Story 7.2 (Review queue)

**Technical Notes:**

- FR27: TLs can flag high-risk decisions for deep review vs. spot-check low-risk
- Create risk scoring algorithm in RiskAssessmentService
- Consider factors: files_changed count, types of changes, AI confidence
- Store risk_level (HIGH | MEDIUM | LOW) in architecture_decisions table

### Story 7.4: Architecture Decision Approval/Rejection

**ClickUp ID:** `86evnjwd2` | **URL:** https://app.clickup.com/t/86evnjwd2

As a TL,
I want to approve, reject, or request modifications to AI decisions,
So that I maintain technical quality standards.

**Acceptance Criteria:**

**Given** I'm reviewing an ADR  
**When** I make a decision  
**Then** I can:

- **Approve:** Accept the decision, allow execution to proceed
- **Reject:** Block the decision, send back to AI with explanation
- **Request Modification:** Suggest alternative approach for AI to implement
- **Defer:** Needs more investigation or discussion with team

**And** for each action:

- I provide comments/reasoning (required for reject/modify)
- Decision is logged to audit trail
- Ticket status is updated accordingly
- PM is notified of outcome

**And** rejection triggers:

- AI retry with TL's feedback incorporated
- New ADR generated with modifications
- Returns to TL queue for re-review

**Prerequisites:** Story 7.2 (Review queue), Story 7.3 (Risk assessment)

**Technical Notes:**

- FR25: TLs can approve, reject, or request modifications to AI proposals
- POST `/api/v1/architecture-review/{adrId}/decision` with {action, comments}
- Update ADR status: Proposed → Approved/Rejected/Modified/Deferred
- If rejected: create new execution with TL feedback in prompt

### Story 7.5: Architecture Patterns & Constraints

**ClickUp ID:** `86evnjwd3` | **URL:** https://app.clickup.com/t/86evnjwd3

As a TL,
I want to define architecture patterns and constraints that AI must follow,
So that AI makes consistent decisions aligned with our standards.

**Acceptance Criteria:**

**Given** I'm defining project architecture rules  
**When** I create patterns and constraints  
**Then** I can specify:

- **Allowed technologies:** Approved dependencies, frameworks, libraries
- **Forbidden technologies:** Banned dependencies (security issues, licensing, etc.)
- **Design patterns:** Required patterns (repository, factory, strategy, etc.)
- **Coding standards:** Style guides, naming conventions, file structure
- **Performance requirements:** Response time limits, resource constraints

**And** constraints are enforced:

- AI checks constraints before generating code
- Violations flagged automatically in ADR
- AI provides justification if constraint must be violated

**And** patterns are reusable:

- Defined at organization level (apply to all projects)
- Overridable at project level (project-specific rules)
- Versioned (track changes over time)

**Prerequisites:** Story 7.1 (ADRs), Epic 2 (AI prompt generation)

**Technical Notes:**

- FR28: TLs can set architecture patterns and constraints that AI must follow
- Create `architecture_constraints` table in Prisma schema
- Include constraints in AI prompts (FR61)
- Validate AI decisions against constraints automatically
- Store as JSON for flexibility: {allowed_deps: [], forbidden_deps: [], patterns: []}

### Story 7.6: AI Escalation & Uncertainty Handling

**ClickUp ID:** `86evnjwd4` | **URL:** https://app.clickup.com/t/86evnjwd4

As an AI agent,
I want to escalate architecture decisions to TL when I'm uncertain,
So that I don't make poor choices that create technical debt.

**Acceptance Criteria:**

**Given** AI is making an architecture decision  
**When** AI confidence is below threshold (e.g., <70%)  
**Then** AI:

- Creates ADR with "Needs TL Review" flag
- Provides multiple alternatives considered
- Explains why uncertain (missing context, conflicting requirements, etc.)
- Blocks execution until TL provides guidance

**And** TL escalation includes:

- Specific questions AI needs answered
- Trade-offs AI is weighing
- Recommendation with caveats

**And** TL can:

- Provide guidance (update constraints/patterns for future)
- Make decision for this specific case
- Delegate to architect for complex cases

**Prerequisites:** Story 7.4 (TL decisions), Epic 2 (AI execution)

**Technical Notes:**

- FR29: TLs can receive AI escalations when uncertain about technical decisions
- AI provider APIs may support confidence scores
- If not available: use heuristics (multiple valid approaches = low confidence)
- Create escalation workflow in ADR status: Proposed → Escalated → Guidance Provided → Resolved

### Story 7.7: TL Capability Management & AI Limitations

**ClickUp ID:** `86evnjwd5` | **URL:** https://app.clickup.com/t/86evnjwd5

As a TL,
I want to identify when AI hits capability limits,
So that I can manually intervene or provide guidance.

**Acceptance Criteria:**

**Given** AI attempts a task and fails repeatedly  
**When** I review the failures  
**Then** I can:

- See failure pattern (same type of task always fails)
- Identify AI limitations (e.g., "AI struggles with GraphQL schema generation")
- Document workarounds (e.g., "TL must handle database migrations manually")
- Update constraints to prevent AI from attempting known-failing tasks

**And** AI capability tracking includes:

- Success rate by task type
- Common failure modes
- Tasks that require human intervention
- Improvements over time (AI learning)

**And** capability limits are:

- Documented in knowledge base
- Shared with PMs (so they know what to avoid putting in tickets)
- Updated as AI improves

**Prerequisites:** Story 7.6 (Escalations), Epic 2 (Execution tracking)

**Technical Notes:**

- FR30-33: TL AI capability management
- Track execution failures by task characteristics
- Pattern detection: If task type X fails >50%, mark as AI limitation
- Store in `ai_capabilities` table (task_type, success_rate, known_issues)
- Share with PMs via dashboard insights

### Story 7.8: Architecture Review Metrics & Insights

**ClickUp ID:** `86evnjwd6` | **URL:** https://app.clickup.com/t/86evnjwd6

As a TL,
I want metrics on architecture review patterns,
So that I can optimize the review process and identify AI improvement areas.

**Acceptance Criteria:**

**Given** architecture reviews are happening  
**When** I view TL metrics dashboard  
**Then** I see:

- **Review volume:** ADRs per week, review time per ADR
- **Approval rate:** % approved vs. rejected vs. modified
- **Risk distribution:** High-risk vs. low-risk decisions
- **Common rejection reasons:** Why AI decisions get rejected (helps training)
- **TL workload:** Current queue depth, estimated review time

**And** insights show:

- "AI makes fewer database decisions after TL feedback on schema design" (learning)
- "High-risk decisions take 15 minutes average to review" (capacity planning)
- "90% of low-risk decisions approved without changes" (spot-check validation)

**And** alerts trigger:

- TL queue depth >20 (need more TLs or review process improvement)
- Approval rate <50% (AI needs better training/constraints)
- High-risk decisions waiting >4 hours (escalation needed)

**Prerequisites:** Stories 7.1-7.7 (Architecture review workflow), Story 1.8 (Prometheus)

**Technical Notes:**

- Track ADR lifecycle: Created → In Review → Approved/Rejected
- Calculate metrics from architecture_decisions table
- Expose Prometheus metrics: `adr_reviews_total{status, risk_level}`
- NFR-O5: Metrics exposed for monitoring

**Epic 7 Summary:**

**Total Stories:** 8  
**Deliverables:** ADR generation, TL review queue, Risk-based prioritization, Approval/rejection workflow, Architecture patterns & constraints, AI escalation handling, Capability management, Architecture review metrics

---

## Epic 8: QA Review & Quality Approval Gates

**ClickUp Epic ID:** `86evnjwd8`  
**ClickUp Epic URL:** https://app.clickup.com/t/86evnjwd8

**Epic Goal:** Enable Lead QA to review code samples, configure quality gates, and approve deployments to production. This epic ensures quality standards are maintained while scaling to 50+ projects.

**User Value:** Lead QA can focus on strategic quality oversight (sampling, trends, gates) instead of reviewing every line of code - making quality scalable.

**FRs Covered:** FR34-FR43 (Lead QA Capabilities, QA Metrics), FR109-FR111 (Quality Dashboard)

### Story 8.1: QA Review Queue & Sampling Configuration

**ClickUp ID:** `86evnjwdb` | **URL:** https://app.clickup.com/t/86evnjwdb

As a Lead QA,
I want to configure what percentage of AI code I review,
So that I can balance thoroughness with scalability.

**Acceptance Criteria:**

**Given** I'm configuring QA sampling strategy  
**When** I set sampling parameters  
**Then** I can choose:

- **Sampling percentage:** 5%, 10%, 20%, 50%, 100%
- **Sampling strategy:**
  - Random sampling (statistically representative)
  - Risk-based sampling (high-risk projects/providers get higher %)
  - New provider sampling (100% for first 10 executions, then reduce)
  - Failed-test sampling (100% review if automated tests failed)

**And** sampling is applied:

- Automatically when execution completes QA checks
- Selected executions added to Lead QA review queue
- Non-sampled executions proceed to deployment (with auto-QA pass)

**And** sampling configuration is:

- Per project (different projects have different risk)
- Per AI provider (new providers reviewed more thoroughly)
- Adjustable based on quality trends

**Prerequisites:** Epic 3 (Automated QA complete), Story 1.3 (Database)

**Technical Notes:**

- FR34: Lead QA can view sample queue of AI-generated code
- FR35: Lead QA can configure sampling strategy
- Create QASamplingService with configurable rules
- Store config in `qa_sampling_config` table (add to Prisma)
- Default: 20% random sampling per PRD

### Story 8.2: QA Code Review Interface

**ClickUp ID:** `86evnjwdc` | **URL:** https://app.clickup.com/t/86evnjwdc

As a Lead QA,
I want to review AI-generated code with context and QA results,
So that I can efficiently assess quality.

**Acceptance Criteria:**

**Given** an execution is selected for QA review  
**When** I open the review interface  
**Then** I see:

- **Code diff:** Side-by-side original vs. AI-generated
- **Automated QA results:**
  - Linting: ✅ Passed (0 errors, 2 warnings)
  - Tests: ✅ 45/45 passed
  - Coverage: ✅ 87% (+2%)
  - Security: ⚠️ 1 medium vulnerability
- **Ticket context:** Original requirements and acceptance criteria
- **AI confidence:** 92% (high confidence)
- **Architecture review:** TL approved

**And** I can:

- View full code changes
- See test results in detail
- Review security scan findings
- Check coverage report

**And** review interface is optimized:

- Loads in <2 seconds (NFR-P2)
- Keyboard shortcuts for quick navigation
- Split view for comparing files

**Prerequisites:** Story 8.1 (Sampling), Epic 3 (QA results), Epic 4 (Code available)

**Technical Notes:**

- FR38: Lead QA can view automated QA results for each ticket
- Use code diff viewer component
- API: GET `/api/v1/qa-review/{executionId}`
- Display data from qa_results table
- Architecture reference: QA Review interface requirements

### Story 8.3: Production Approval Workflow

**ClickUp ID:** `86evnjwdd` | **URL:** https://app.clickup.com/t/86evnjwdd

As a Lead QA,
I want to approve or reject code for production deployment,
So that I serve as the final quality gate.

**Acceptance Criteria:**

**Given** I've reviewed AI-generated code  
**When** I make my decision  
**Then** I can:

- **Approve:** Code proceeds to GitHub push and deployment
- **Reject with Findings:** Code blocked, findings documented, PM notified
- **Conditional Approve:** Approve with notes (e.g., "Monitor for X in production")

**And** rejection requires:

- Documented findings (what issues found)
- Severity classification (blocker, critical, major, minor)
- Remediation guidance (how to fix)

**And** approval is logged:

- Who approved (Lead QA user)
- When approved (timestamp)
- Any conditions or notes
- Stored in audit trail

**And** rejected code:

- Blocks GitHub push
- Sends findings to PM and AI for remediation
- Creates new execution attempt with findings as context

**Prerequisites:** Story 8.2 (Review interface), Epic 3 (QA system)

**Technical Notes:**

- FR36: Lead QA can approve code for production deployment
- FR37: Lead QA can reject code with findings and send back to AI
- POST `/api/v1/qa-review/{executionId}/decision` with {action, findings}
- Update execution status based on decision
- Architecture reference: Quality gates section

### Story 8.4: Quality Gate Configuration

**ClickUp ID:** `86evnjwde` | **URL:** https://app.clickup.com/t/86evnjwde

As a Lead QA,
I want to define quality gates that must pass before my review,
So that I only review code that meets basic standards.

**Acceptance Criteria:**

**Given** I'm configuring quality gates  
**When** I set gate thresholds  
**Then** I can define:

- **Linting:** Must pass with 0 errors (warnings allowed up to threshold)
- **Testing:** Minimum test pass rate (e.g., 95%)
- **Coverage:** Minimum coverage % (e.g., 80%)
- **Security:** No critical vulnerabilities allowed (medium/low with limits)
- **Performance:** Response time limits (if performance tests exist)

**And** gates can be:

- Global defaults (apply to all projects)
- Project-specific overrides
- Temporarily relaxed (with approval and audit trail)

**And** gate failures:

- Block code from reaching QA review queue
- Automatically reject execution
- Provide clear failure reasons to PM
- Don't consume QA review time

**Prerequisites:** Story 8.1 (QA system), Epic 3 (Automated QA)

**Technical Notes:**

- FR39: Lead QA can define quality gates that must pass before human review
- Create QualityGateConfigService
- Store config in `quality_gate_config` table
- Evaluate gates in Epic 3 Story 3.5 (Quality Gate Decision Engine)
- Architecture reference: Quality Gates section

### Story 8.5: Bug Escape Tracking & Analysis

**ClickUp ID:** `86evnjwdg` | **URL:** https://app.clickup.com/t/86evnjwdg

As a Lead QA,
I want to track bugs that escaped to production,
So that I can identify patterns and improve quality processes.

**Acceptance Criteria:**

**Given** bugs are reported in production  
**When** I link them to original executions  
**Then** bug escape tracking captures:

- Which execution/ticket introduced the bug
- Which AI provider generated the code
- Whether code was sampled for QA review
- QA results at time of approval (did automated checks miss it?)
- Bug severity and impact

**And** bug escape metrics show:

- Bug escape rate: (production bugs / deployed tickets) \* 100
- Escape rate by AI provider (which provider has more bugs?)
- Escape rate by QA sampling strategy (is 20% enough?)
- Common bug types (what do we miss most?)

**And** insights guide improvements:

- "Increase sampling to 30% for Provider X" (if escape rate high)
- "Add security gate for SQL injection" (if multiple SQL bugs escaped)
- "Provider Y has 0.5% escape rate" (better quality)

**Prerequisites:** Story 8.3 (Approvals tracked), Epic 9 (Production monitoring)

**Technical Notes:**

- FR40: Lead QA can track bug escape rates and quality trends
- Link production_errors to original execution_id
- Calculate escape rate: Count production bugs / Count deployed tickets
- Expose metric: `bug_escape_rate{ai_provider, sampling_strategy}`
- Architecture reference: Bug tracking in production_errors table

### Story 8.6: Quality Metrics Dashboard

**ClickUp ID:** `86evnjwdh` | **URL:** https://app.clickup.com/t/86evnjwdh

As a Lead QA,
I want a comprehensive quality dashboard,
So that I can monitor quality trends and make data-driven decisions.

**Acceptance Criteria:**

**Given** I'm viewing the quality dashboard  
**When** quality data is displayed  
**Then** I see:

- **Overall quality score:** Aggregate of all quality factors (0-100)
- **Test pass rate:** % of tickets where tests pass (target: >95%)
- **Code coverage:** Average coverage across all projects (target: >80%)
- **Bug escape rate:** Production bugs per 100 deployed tickets (target: <5)
- **Security vulnerabilities:** Count by severity (critical, high, medium, low)
- **QA approval rate:** % of reviewed code that passes (target: >90%)

**And** trend charts show:

- Quality improving or declining over time
- Impact of process changes (e.g., "Sampling increase improved escape rate")
- Provider comparison (which AI has best quality)

**And** drill-down available:

- By project (which projects have quality issues)
- By AI provider
- By time period

**Prerequisites:** Stories 8.1-8.5 (Quality data), Story 5.1 (Dashboard foundation)

**Technical Notes:**

- FR109-111: Quality metrics dashboard
- Aggregate data from qa_results, executions, production_errors tables
- API: GET `/api/v1/quality/metrics?startDate={}&endDate={}`
- Use charting library for visualizations
- Architecture reference: Quality Dashboard API contracts

### Story 8.7: Quality Trends & Anomaly Detection

**ClickUp ID:** `86evnjwdk` | **URL:** https://app.clickup.com/t/86evnjwdk

As a Lead QA,
I want automatic detection of quality anomalies,
So that I can investigate issues before they escalate.

**Acceptance Criteria:**

**Given** quality metrics are tracked over time  
**When** anomalies are detected  
**Then** alerts are sent for:

- **Sudden drop in test pass rate** (e.g., 95% → 75% in one day)
- **Coverage decline** (e.g., 85% → 70% over a week)
- **Bug escape spike** (e.g., 2% → 8% in current sprint)
- **Security vulnerability increase** (e.g., 3 critical vulns found vs. 0 average)

**And** anomaly detection uses:

- Statistical thresholds (2 standard deviations from mean)
- Trend analysis (declining over 3+ consecutive periods)
- Baseline comparison (current vs. historical average)

**And** alerts include:

- What anomaly detected
- Current vs. expected values
- Possible causes (e.g., "New AI provider introduced")
- Recommended actions

**Prerequisites:** Story 8.6 (Quality metrics), Story 1.8 (Monitoring)

**Technical Notes:**

- Implement anomaly detection algorithm
- Run daily analysis of quality metrics
- Use time-series analysis for trend detection
- NFR-O6: Critical quality failures trigger real-time alerts
- Send alerts via configured channels (email, Slack, in-app)

### Story 8.8: Quality Review Metrics & QA Workload

**ClickUp ID:** `86evnjwdm` | **URL:** https://app.clickup.com/t/86evnjwdm

As a Lead QA,
I want to track my review workload and efficiency,
So that I can optimize the review process.

**Acceptance Criteria:**

**Given** I'm reviewing code samples  
**When** I view my QA workload metrics  
**Then** I see:

- **Review queue depth:** Current items waiting for review
- **Average review time:** Time spent per review
- **Review throughput:** Reviews completed per day/week
- **Utilization:** % of capacity used (prevent Lead QA burnout too!)

**And** efficiency metrics show:

- Which types of reviews take longest (helps set sampling strategy)
- Rejection rate (high rejection = automated QA needs improvement)
- Time saved by automated QA (estimate of time if 100% manual review)

**And** capacity planning shows:

- Current sampling rate sustainable? (can I handle queue depth?)
- What happens if we scale to 50 projects? (will I be overwhelmed?)
- When do we need additional Lead QA? (proactive hiring)

**Prerequisites:** Stories 8.1-8.7 (QA workflow), Story 1.8 (Metrics)

**Technical Notes:**

- Track QA review timestamps (start, end)
- Calculate queue depth from qa_results WHERE needs_manual_review = true
- Expose Prometheus metrics: `qa_review_duration_seconds`, `qa_review_queue_depth`
- Alert if queue depth >50 or Lead QA utilization >80%
- Architecture reference: QA Overwhelm risk (R9) mitigation

**Epic 8 Summary:**

**Total Stories:** 8  
**Deliverables:** QA review queue & sampling, Code review interface, Production approval workflow, Quality gate configuration, Bug escape tracking, Quality metrics dashboard, Anomaly detection, QA workload metrics

---

## Epic 9: Self-Healing & Production Monitoring

**ClickUp Epic ID:** `86evnjwdp`  
**ClickUp Epic URL:** https://app.clickup.com/t/86evnjwdp

**Epic Goal:** Automatically detect production issues and create fix tickets, enabling the system to "self-heal" by generating fixes for bugs without manual intervention. This epic begins the journey toward autonomous operations.

**User Value:** Production issues are detected immediately and automatically queued for AI to fix - reducing downtime and manual firefighting.

**FRs Covered:** FR79-FR84 (Self-Healing & Production Monitoring)

### Story 9.1: Production Error Monitoring Integration

**ClickUp ID:** `86evnjwds` | **URL:** https://app.clickup.com/t/86evnjwds

As the system,
I want to integrate with production monitoring tools,
So that I can detect errors and anomalies in deployed applications.

**Acceptance Criteria:**

**Given** applications are deployed to production  
**When** errors occur  
**Then** the system:

- Receives error events from monitoring tools (Sentry, Datadog, CloudWatch, etc.)
- Captures error details: type, message, stack trace, timestamp
- Links error to originating ticket/execution (via tags or metadata)
- Stores in `production_errors` table

**And** error ingestion supports multiple sources:

- Sentry webhook (error reported → POST to `/api/v1/monitoring/sentry-webhook`)
- Datadog webhook
- Custom application logging (POST `/api/v1/monitoring/errors`)
- Log aggregation platforms (Elasticsearch, Splunk)

**And** error data includes:

- Application/service name
- Environment (staging, production)
- Error type and message
- Stack trace
- User impact (how many users affected)
- Occurrence count (is this happening repeatedly?)

**Prerequisites:** Story 1.9 (Sentry integration), Story 1.4 (Webhook endpoints)

**Technical Notes:**

- FR79: System monitors production applications for errors and anomalies
- Create ProductionMonitoringService
- Prisma schema includes `production_errors` table
- Support multiple monitoring tool integrations
- Architecture reference: Production Monitoring section

### Story 9.2: Error Severity Classification & Prioritization

**ClickUp ID:** `86evnjwdt` | **URL:** https://app.clickup.com/t/86evnjwdt

As the system,
I want to classify production errors by severity,
So that critical issues are fixed first.

**Acceptance Criteria:**

**Given** a production error is detected  
**When** severity is classified  
**Then** errors are categorized:

- **CRITICAL:** Application down, data loss, security breach (fix immediately)
- **HIGH:** Major feature broken, many users affected (fix within hours)
- **MEDIUM:** Minor feature broken, some users affected (fix within days)
- **LOW:** Cosmetic issue, rare occurrence (fix when convenient)

**And** severity is determined by:

- Error type (500 server errors → HIGH, 404 not found → LOW)
- Occurrence frequency (happening every minute → CRITICAL)
- User impact (% of users affected)
- Business impact (payment processing → CRITICAL, analytics → LOW)

**And** prioritization queue orders by:

1. Severity (CRITICAL first)
2. Occurrence count (frequent errors first)
3. Age (older errors first within same severity)

**Prerequisites:** Story 9.1 (Error ingestion)

**Technical Notes:**

- FR80: System detects critical failures requiring immediate attention
- FR83: System prioritizes fix tickets by severity and impact
- Create SeverityClassificationService
- Store severity in production_errors.severity enum
- Auto-calculate or allow manual override

### Story 9.3: Automatic Fix Ticket Creation

**ClickUp ID:** `86evnjwdw` | **URL:** https://app.clickup.com/t/86evnjwdw

As the system,
I want to automatically create ClickUp fix tickets for production errors,
So that bugs get queued for AI resolution without manual intervention.

**Acceptance Criteria:**

**Given** a production error reaches severity threshold  
**When** automatic fix ticket creation triggers  
**Then** a ClickUp task is created with:

- **Title:** "Fix: {error_type} in {service}"
- **Description:** Error message, stack trace, reproduction steps (if available)
- **Priority:** Based on severity (CRITICAL → Urgent in ClickUp)
- **Labels:** `bug`, `production`, `ai-fix-candidate`, severity level
- **Linked to:** Original ticket that introduced the bug (if traceable)

**And** ticket includes debugging context:

- Error logs (last 100 lines before error)
- Request parameters (if web request)
- User actions leading to error (if tracked)
- Environment details (OS, browser, app version)

**And** ticket creation is:

- Throttled (don't create 100 tickets for same error → deduplicate)
- Configurable (can disable auto-creation per project)
- Logged to audit trail

**Prerequisites:** Story 9.2 (Severity classification), Story 2.1 (ClickUp integration)

**Technical Notes:**

- FR81: System automatically creates fix tickets in ClickUp when bugs detected
- Use ClickUp API to create task
- Link via production_errors.fix_ticket_id
- Deduplication: Check if ticket already exists for same error type + service
- Architecture reference: Self-Healing loop in brainstorming doc

### Story 9.4: Error Log Analysis & Context Extraction

**ClickUp ID:** `86evnjwdx` | **URL:** https://app.clickup.com/t/86evnjwdx

As the system,
I want to analyze error logs to provide fix context,
So that AI has enough information to generate a proper fix.

**Acceptance Criteria:**

**Given** an error occurred in production  
**When** logs are analyzed  
**Then** the system extracts:

- **Root cause hypothesis:** What likely caused the error (based on stack trace)
- **Affected code location:** File, function, line number
- **Recent changes:** Was this file changed recently? (link to execution/commit)
- **Related errors:** Are there similar errors in logs?
- **User journey:** What was user doing before error?

**And** analysis uses:

- Stack trace parsing (identify exception origin)
- Log correlation (events before error)
- Code blame (who/what changed this code recently - AI execution?)
- Pattern matching (similar errors in history)

**And** extracted context is:

- Included in fix ticket description
- Used in AI prompt for fixing
- Stored in production_errors.context (JSON field)

**Prerequisites:** Story 9.1 (Error ingestion), Story 9.3 (Fix tickets)

**Technical Notes:**

- FR82: System analyzes error logs to provide context for fix tickets
- Parse stack traces with stack-trace-parser library
- Query executions table for recent changes to affected files
- Use regex patterns to extract relevant log lines
- Store structured context for AI prompt generation

### Story 9.5: AI Fix Generation & Testing

**ClickUp ID:** `86evnjwdy` | **URL:** https://app.clickup.com/t/86evnjwdy

As the system,
I want AI to generate fixes for production errors,
So that bugs are resolved automatically without human coding.

**Acceptance Criteria:**

**Given** a fix ticket is created  
**When** AI attempts to fix the bug  
**Then** the fix workflow:

1. AI reads fix ticket with error context
2. AI analyzes code that caused the error
3. AI generates fix (code changes)
4. AI writes test that reproduces the bug (proves fix works)
5. AI runs test to verify fix resolves the error
6. If test passes → proceeds to QA
7. If test fails → AI retries with new approach

**And** fix attempts are:

- Limited (max 3 attempts per fix ticket)
- Tracked (store all attempts in execution history)
- Reviewable (PM/TL can review fix before deployment)

**And** fix quality ensured by:

- Test proves bug is fixed
- No new tests broken by fix
- Code coverage maintained or improved
- TL review for critical bugs

**Prerequisites:** Story 9.4 (Error analysis), Epic 2 (AI execution), Epic 3 (QA)

**Technical Notes:**

- Use same AI routing as feature development
- Include error context in AI prompt: "Here's the bug: {error}. Fix it."
- Require AI to write regression test that fails before fix, passes after
- Flow through normal pipeline: AI → QA → GitHub → Deploy
- Architecture reference: Self-healing loop design

### Story 9.6: Fix Verification & Deployment

**ClickUp ID:** `86evnjwdz` | **URL:** https://app.clickup.com/t/86evnjwdz

As the system,
I want to verify fixes resolve the error before full deployment,
So that we don't deploy ineffective or breaking fixes.

**Acceptance Criteria:**

**Given** AI generates a fix  
**When** fix is ready for deployment  
**Then** verification includes:

- **Regression test passes:** Test that reproduced bug now passes
- **Existing tests pass:** Fix doesn't break other functionality
- **Canary deployment:** Deploy to small % of traffic first (5%)
- **Monitor for error recurrence:** Watch for same error in canary
- **Gradual rollout:** If canary succeeds, roll out to 100%

**And** if fix fails verification:

- Canary deployment rolled back immediately
- Error marked as "fix_failed"
- Escalate to human (PM/TL) for manual investigation
- AI attempts another fix approach (if attempts remaining)

**And** successful fix:

- Error marked as resolved in production_errors table
- ClickUp fix ticket status updated to "Done"
- Metrics tracked (time to fix, attempts needed)

**Prerequisites:** Story 9.5 (AI fix generation), Epic 4 (Deployment)

**Technical Notes:**

- Implement canary deployment strategy
- Monitor error occurrence rate in canary vs. main deployment
- Use deployment platform features (Kubernetes, AWS, etc.) for gradual rollout
- NFR-R6: Deployment failures trigger rollback
- Architecture reference: Deployment monitoring section

### Story 9.7: Self-Healing Metrics & Success Tracking

**ClickUp ID:** `86evnjwe0` | **URL:** https://app.clickup.com/t/86evnjwe0

As an operator,
I want metrics on self-healing effectiveness,
So that I can evaluate if autonomous fixing is working.

**Acceptance Criteria:**

**Given** self-healing is operational  
**When** metrics are collected  
**Then** Prometheus metrics include:

- `production_errors_detected_total{severity}`
- `fix_tickets_created_total{auto_created}`
- `fixes_attempted_total{result="success|failed|escalated"}`
- `fix_success_rate{ai_provider}` (% of fixes that worked)
- `time_to_fix_seconds{severity}` (how fast bugs get fixed)
- `errors_resolved_autonomously_total` (no human intervention needed)

**And** dashboard shows:

- Self-healing success rate (target: >60% for Phase 1)
- Average time from error detection to fix deployed
- Errors requiring human escalation (identifies AI limitations)
- Cost of self-healing (AI compute for fixes)

**And** insights guide improvement:

- "Cursor CLI Headless has 75% fix success rate for complex bugs"
- "Claude Code has 82% success rate for simple bug fixes"
- "Multi-provider fallback improved fix success from 75% to 88%"
- "Critical errors fixed in 23 minutes average (target: <30 min)"
- "Self-healing saved 120 hours of manual debugging this month"

**Prerequisites:** Stories 9.1-9.6 (Self-healing workflow), Story 1.8 (Prometheus)

**Technical Notes:**

- Track entire self-healing lifecycle
- Calculate time_to_fix: error.occurred_at → fix deployed timestamp
- Expose metrics for Grafana dashboards
- Compare self-healing vs. manual fix time (ROI calculation)

### Story 9.8: Production Error Dashboard for Ops Team

**ClickUp ID:** `86evnjwe1` | **URL:** https://app.clickup.com/t/86evnjwe1

As an operator,
I want a production error dashboard,
So that I can monitor application health and self-healing status.

**Acceptance Criteria:**

**Given** I'm monitoring production health  
**When** I view the error dashboard  
**Then** I see:

- **Active errors:** Current unresolved production errors (count by severity)
- **Error rate trend:** Errors per hour over time (line chart)
- **Self-healing queue:** Fix tickets being processed by AI
- **Resolution status:** Fixed vs. escalated vs. in-progress

**And** real-time updates via Socket.IO show:

- New error detected (alert notification)
- Fix ticket created automatically
- AI fix attempt in progress
- Fix deployed successfully
- Error resolved (disappears from active errors)

**And** filtering and drill-down:

- By severity (show only CRITICAL)
- By application/service
- By resolution status (unresolved, fixing, resolved)
- By time range

**Prerequisites:** Stories 9.1-9.7 (Error monitoring + self-healing), Story 5.1 (Dashboard)

**Technical Notes:**

- Real-time dashboard using Socket.IO
- API: GET `/api/v1/monitoring/errors?status=active`
- Subscribe to Socket.IO events: `error-detected`, `fix-in-progress`, `error-resolved`
- Similar UI pattern to PM dashboard (reuse components)

**Epic 9 Summary:**

**Total Stories:** 8  
**Deliverables:** Production error monitoring integration, Error severity classification, Automatic fix ticket creation, Error log analysis, AI fix generation & testing, Fix verification & deployment, Self-healing metrics, Production error dashboard

---

## Epic 10: Real-Time Updates & Orchestrator Monitoring

**ClickUp Epic ID:** `86evnjwe3`  
**ClickUp Epic URL:** https://app.clickup.com/t/86evnjwe3

**Epic Goal:** Provide real-time visibility into AI execution progress, system health, and orchestrator operations. This epic ensures users get immediate feedback and operators can monitor system health.

**User Value:** Users see live updates without refreshing, operators can monitor system health in real-time, and issues are detected before they become critical.

**FRs Covered:** FR9-FR10 (Real-time notifications via Socket.IO), FR100-FR104 (Orchestrator Monitoring Dashboard)

### Story 10.1: Socket.IO Real-Time Infrastructure

**ClickUp ID:** `86evnjwe6` | **URL:** https://app.clickup.com/t/86evnjwe6

As the system,
I want Socket.IO configured for real-time bidirectional communication,
So that clients receive live updates without polling.

**Acceptance Criteria:**

**Given** the orchestrator is running  
**When** Socket.IO is initialized  
**Then** the server:

- Listens for Socket.IO connections on configured port
- Authenticates clients using JWT tokens
- Maintains connection pool (track connected clients)
- Handles disconnections and reconnections gracefully

**And** namespaces are configured:

- `/pm` - PM dashboard events
- `/manager` - Manager dashboard events
- `/tl` - TL architecture review events
- `/qa` - QA review events
- `/ops` - Operations monitoring events

**And** rooms are used for:

- Project-specific events (join room `project:{id}`)
- User-specific events (join room `user:{id}`)
- Role-specific broadcasts (all PMs, all TLs, etc.)

**Prerequisites:** Story 1.1 (NestJS project), Story 1.6 (JWT auth)

**Technical Notes:**

- Architecture decision: Socket.IO for real-time (ADR-005)
- Install: `npm install @nestjs/websockets @nestjs/platform-socket.io socket.io`
- Create WebSocketGateway in `src/gateways/`
- Use JWT middleware for Socket.IO authentication
- Configure Redis adapter if multiple orchestrator instances (scalability)
- Architecture reference: Socket.IO Event Naming conventions

### Story 10.2: Execution Progress Updates

**ClickUp ID:** `86evnjwe7` | **URL:** https://app.clickup.com/t/86evnjwe7

As a PM,
I want real-time updates on AI execution progress,
So that I see what's happening without refreshing the page.

**Acceptance Criteria:**

**Given** I'm viewing a ticket or project dashboard  
**When** AI execution progresses  
**Then** I receive Socket.IO events:

- `execution-started`: {executionId, ticketId, aiProvider, timestamp}
- `execution-progress-update`: {executionId, status, progress%, currentStep}
- `execution-completed`: {executionId, status: "COMPLETED", confidenceScore}
- `execution-failed`: {executionId, status: "FAILED", errorMessage}

**And** events trigger UI updates:

- Status badge changes color/icon
- Progress bar animates
- Notifications appear (toast messages)
- Dashboard counters update

**And** events are:

- Sent only to relevant users (PM assigned to project)
- Persisted if user offline (replay on reconnect)
- Deduplicated (don't send duplicate events)

**Prerequisites:** Story 10.1 (Socket.IO infrastructure), Epic 2 (AI execution)

**Technical Notes:**

- FR9: PMs monitor real-time status of AI execution
- Emit events from AIExecutionService at state transitions
- Use rooms for targeting: `socket.to(`project:${projectId}`).emit(...)`
- Architecture reference: Socket.IO Event Naming (kebab-case for server→client)

### Story 10.3: Cost Alert Real-Time Notifications

**ClickUp ID:** `86evnjwe8` | **URL:** https://app.clickup.com/t/86evnjwe8

As a Manager,
I want immediate alerts when costs cross thresholds,
So that I can take action before budget is exhausted.

**Acceptance Criteria:**

**Given** I'm monitoring cost dashboards  
**When** costs cross thresholds  
**Then** I receive Socket.IO events:

- `cost-warning`: {projectId, currentCost, budgetCost, percentUsed: 75%}
- `cost-critical`: {projectId, currentCost, budgetCost, percentUsed: 90%}
- `cost-cap-reached`: {projectId, executionsPaused: true}

**And** notifications include:

- Visual alert (red banner on dashboard)
- Audio alert (optional, configurable)
- Action buttons (View Project, Increase Budget, Acknowledge)

**And** alerts are:

- Sent to all Managers
- Logged to notification history
- Acknowledged to dismiss (but remain in history)

**Prerequisites:** Story 10.1 (Socket.IO), Epic 6 (Cost tracking)

**Technical Notes:**

- Emit from CostTrackingService when thresholds crossed
- Use role-based rooms: `socket.to('role:MANAGER').emit(...)`
- Store acknowledgment in database (notification_acknowledgments table)
- Architecture reference: Cost alerts (NFR-O7)

### Story 10.4: Quality Gate Failure Notifications

**ClickUp ID:** `86evnjwe9` | **URL:** https://app.clickup.com/t/86evnjwe9

As a PM/TL,
I want immediate notification when QA checks fail,
So that I can review and take corrective action quickly.

**Acceptance Criteria:**

**Given** automated QA runs on AI-generated code  
**When** quality gates fail  
**Then** relevant users receive events:

- `qa-failed`: {executionId, ticketId, failureType, details}
- `architecture-review-needed`: {adrId, riskLevel: "HIGH", executionId}
- `qa-review-required`: {executionId, samplingReason: "failed-tests"}

**And** notifications are targeted:

- QA failures → PM (ticket owner)
- Architecture issues → TL (architecture reviewer)
- Security vulnerabilities → QA + Security team

**And** notification includes:

- Quick summary of failure
- Link to detailed view
- Suggested actions

**Prerequisites:** Story 10.1 (Socket.IO), Epic 3 (QA), Epic 7 (Architecture review)

**Technical Notes:**

- Emit from QAAutomationService on gate failures
- Target specific users based on ticket ownership and roles
- Include actionable data in event payload
- NFR-O6: Critical failures trigger real-time alerts

### Story 10.5: Orchestrator System Health Dashboard

**ClickUp ID:** `86evnjwea` | **URL:** https://app.clickup.com/t/86evnjwea

As an operator,
I want a real-time system health dashboard,
So that I can monitor orchestrator operational status.

**Acceptance Criteria:**

**Given** I'm viewing the ops monitoring dashboard  
**When** system status is displayed  
**Then** I see:

- **Overall health:** Healthy / Degraded / Failed (green/yellow/red)
- **Component status:**
  - Database: Connected (latency: 12ms)
  - RabbitMQ: Connected (queue depth: 5)
  - **AI Providers:**
    - Cursor CLI Headless: ✅ Available (avg response: 45s)
    - Claude Code API: ✅ Available (avg response: 18s)
    - Fallback system: ✅ Operational
  - GitHub API: ✅ (rate limit: 4500/5000 remaining)
  - ClickUp API: ✅

**And** real-time metrics:

- Requests per second
- Active AI executions
- Queue depths (ai-execution-queue: 5, qa-check-queue: 2, deployment-queue: 0)
- Memory usage (2.1GB / 4GB)
- CPU usage (45%)

**And** updates via Socket.IO (every 5 seconds)

**Prerequisites:** Story 10.1 (Socket.IO), Story 1.8 (Prometheus metrics)

**Technical Notes:**

- FR100: Operators can view real-time orchestrator status
- FR102: Operators can view AI provider status
- Create HealthMonitoringService that checks all components
- Emit `system-health-update` event every 5 seconds
- Use `/ops` Socket.IO namespace
- Architecture reference: Observability requirements

### Story 10.6: Queue Depth Monitoring & Alerts

**ClickUp ID:** `86evnjweb` | **URL:** https://app.clickup.com/t/86evnjweb

As an operator,
I want to monitor queue depths in real-time,
So that I can detect bottlenecks before they cause delays.

**Acceptance Criteria:**

**Given** RabbitMQ queues are processing messages  
**When** queue depths are monitored  
**Then** I see:

- **ai-execution-queue:** Depth, processing rate (msgs/min), avg processing time
- **qa-check-queue:** Depth, processing rate, avg processing time
- **deployment-queue:** Depth, processing rate, avg processing time
- **monitoring-queue:** Depth, processing rate, avg processing time

**And** alerts trigger:

- Queue depth >50 → Warning (check worker capacity)
- Queue depth >100 → Critical (workers overwhelmed)
- Processing rate dropping → Warning (workers slow or failing)
- Queue depth growing >10 min → Critical (backlog building)

**And** dashboard shows:

- Queue depth trend (chart over time)
- Worker count (how many consumers active)
- Oldest message age (are messages getting stale?)

**Prerequisites:** Story 10.5 (System health dashboard), Story 1.5 (RabbitMQ)

**Technical Notes:**

- FR101: Operators can see current queue depth and processing rate
- Query RabbitMQ Management API for queue stats
- Emit `queue-stats-update` via Socket.IO
- Alert via `queue-depth-critical` event
- Architecture reference: Queue monitoring

### Story 10.7: Execution Logs & Error Details

**ClickUp ID:** `86evnjwec` | **URL:** https://app.clickup.com/t/86evnjwec

As an operator,
I want to view execution logs and errors in real-time,
So that I can debug issues as they happen.

**Acceptance Criteria:**

**Given** I'm monitoring a specific execution  
**When** logs are generated  
**Then** I see:

- Structured log stream (real-time)
- Log level filtering (show only errors/warnings)
- Search within logs (keyword search)
- Correlation ID linking (trace requests across services)

**And** for errors:

- Full stack trace
- Request context (user, project, ticket)
- Related logs (before/after error)
- Link to Sentry for deep investigation

**And** log viewer features:

- Auto-scroll (follows latest logs)
- Pause/resume streaming
- Download logs (export to file)
- Share log snippet (permalink)

**Prerequisites:** Story 10.5 (Ops dashboard), Story 1.7 (Winston logging)

**Technical Notes:**

- FR103: Operators can access execution logs and error details
- Stream logs via Socket.IO (avoid overwhelming with high volume)
- Use log aggregation if available (Elasticsearch, Loki)
- Filter logs by correlation_id or execution_id
- Architecture reference: Logging Format (structured JSON)

### Story 10.8: Manual Intervention & Circuit Breaker

**ClickUp ID:** `86evnjwed` | **URL:** https://app.clickup.com/t/86evnjwed

As an operator,
I want to manually pause/resume execution or trigger circuit breakers,
So that I can control system behavior during incidents.

**Acceptance Criteria:**

**Given** I'm on the ops dashboard  
**When** I need to intervene  
**Then** I can:

- **Pause all executions:** Stop new AI executions from starting
- **Resume executions:** Allow executions to continue
- **Cancel specific execution:** Abort a running AI execution
- **Retry failed execution:** Manually trigger retry (bypass retry limit)
- **Open circuit breaker:** Block specific AI provider (e.g., if provider is down)
- **Close circuit breaker:** Re-enable AI provider

**And** interventions are:

- Logged to audit trail (who, when, why)
- Require confirmation (prevent accidental actions)
- Reversible (can undo pause/circuit breaker)
- Notified to team (Socket.IO broadcast)

**And** circuit breaker status visible:

- Which providers are open (blocked)
- When circuit opened (timestamp)
- Why circuit opened (reason)
- When auto-close (if time-based)

**Prerequisites:** Story 10.5 (Ops dashboard), Epic 2 (AI execution)

**Technical Notes:**

- FR104: Operators can manually intervene or pause execution
- Create OperatorActionsService for intervention logic
- Store circuit breaker state in Redis (fast access)
- Emit `operator-intervention` event to notify team
- Architecture reference: Circuit breaker pattern (30s auto-close)

### Story 10.9: System Metrics Export & Integration

**ClickUp ID:** `86evnjwee` | **URL:** https://app.clickup.com/t/86evnjwee

As an operator,
I want to export metrics to external monitoring tools,
So that I can integrate with existing infrastructure.

**Acceptance Criteria:**

**Given** external monitoring tools are configured  
**When** metrics are exported  
**Then** integrations support:

- **Prometheus:** `/metrics` endpoint scraping (already in Epic 1)
- **Grafana:** Pre-built dashboard templates (JSON export)
- **Datadog:** StatsD or API integration
- **CloudWatch:** Metrics stream (if AWS)
- **Webhook:** Push metrics to custom endpoints

**And** metrics include all domains:

- Ticket intake (received, validated, failed)
- AI execution (queued, in-progress, completed, failed)
- QA checks (passed, failed, coverage)
- Deployments (triggered, succeeded, failed)
- Costs (by provider, by project)
- System health (CPU, memory, queue depths)

**And** metric formats:

- Prometheus format (default)
- JSON over HTTP (for webhooks)
- StatsD protocol (for Datadog)

**Prerequisites:** Story 1.8 (Prometheus metrics), Story 10.5 (System health)

**Technical Notes:**

- NFR-O10: Metrics must be exportable for external reporting
- Provide Grafana dashboard JSON templates
- Document integration guides for each monitoring tool
- Support custom metric webhooks for flexibility
- Architecture reference: Observability stack (Prometheus + Grafana)

### Story 10.10: Notification Preferences & Channels

**ClickUp ID:** `86evnjweg` | **URL:** https://app.clickup.com/t/86evnjweg

As a user,
I want to configure my notification preferences,
So that I only receive relevant alerts via my preferred channels.

**Acceptance Criteria:**

**Given** I'm configuring notification settings  
**When** I set preferences  
**Then** I can:

- Choose channels: In-app, Email, Slack, SMS (if configured)
- Set notification types: All, Critical only, None
- Configure per event type:
  - Execution completed: In-app only
  - Cost alerts: Email + Slack
  - QA failures: In-app + Email
  - Production errors: All channels (critical)

**And** notification frequency:

- Immediate (real-time)
- Digest (batched hourly/daily)
- Quiet hours (don't disturb 10pm-8am)

**And** preferences are:

- Stored per user in database (user_notification_preferences table)
- Applied to all notification services
- Overridable for critical alerts (always send CRITICAL regardless of preferences)

**Prerequisites:** Story 10.1-10.8 (Notification system), Story 1.6 (User auth)

**Technical Notes:**

- Create user notification preferences UI
- Store preferences in database
- Check preferences before sending notifications
- Critical alerts (cost cap, production down) always sent
- Support multiple notification channels (requires channel integrations)

**Epic 10 Summary:**

**Total Stories:** 10  
**Deliverables:** Socket.IO real-time infrastructure, Execution progress updates, Cost alert notifications, QA failure notifications, System health dashboard, Queue depth monitoring, Execution logs viewer, Manual intervention controls, Metrics export, Notification preferences

---

## Complete Epic Breakdown Summary

**Phase 1 MVP: 10 Epics, 94 Total Stories**

**Epic 1: Foundation (13 stories)** - Development environment  
**Epic 2: Ticket Intake & AI Routing (12 stories)** - Core orchestration  
**Epic 3: Automated QA (8 stories)** - Quality gates  
**Epic 4: GitHub & CI/CD (8 stories)** - Deployment pipeline  
**Epic 5: PM Dashboard (10 stories)** - Primary PM interface  
**Epic 6: Cost Tracking (8 stories)** - Financial control  
**Epic 7: TL Architecture Review (8 stories)** - Technical oversight  
**Epic 8: QA Review & Approval (8 stories)** - Quality approval  
**Epic 9: Self-Healing (8 stories)** - Autonomous fixing  
**Epic 10: Real-Time & Monitoring (10 stories)** - Live visibility

**Total FR Coverage:** All 136 FRs mapped to stories  
**Total NFR Coverage:** All 69 NFRs addressed across epics  
**Architecture Alignment:** Complete implementation of all architectural decisions

**Ready for:** Sprint Planning, Story estimation, Implementation

---

## Complete FR Coverage Matrix

**Validation:** Every FR from PRD is mapped to at least one epic/story.

| FR Range    | Description                     | Epic(s)    | Stories            |
| ----------- | ------------------------------- | ---------- | ------------------ |
| FR1-FR7     | PM Ticket Creation & Management | Epic 2     | 2.2, 2.11, 2.12    |
| FR8-FR14    | PM AI Project Orchestration     | Epic 5     | 5.2, 5.3, 5.4, 5.5 |
| FR15-FR19   | PM Workload & Capacity          | Epic 5     | 5.6, 5.7           |
| FR20-FR23   | PM Client Communication         | Epic 5     | 5.8, 5.9           |
| FR24-FR29   | TL Architecture Validation      | Epic 7     | 7.1-7.6            |
| FR30-FR33   | TL AI Capability Management     | Epic 7     | 7.7                |
| FR34-FR40   | Lead QA Review & Gates          | Epic 8     | 8.1-8.5            |
| FR41-FR43   | QA Metrics & Analysis           | Epic 8     | 8.6-8.8            |
| FR44-FR48   | Manager Business Oversight      | Epic 6     | 6.5, 6.6, 6.8      |
| FR49-FR52   | Manager Workforce Management    | Epic 5     | 5.7                |
| FR53-FR55   | Manager Client Relationship     | Epic 5     | 5.8, 5.9           |
| FR56-FR59   | System Webhook & Task Intake    | Epic 2     | 2.1, 2.2           |
| FR60-FR65   | System AI Routing & Execution   | Epic 2     | 2.3-2.10           |
| FR66-FR71   | System Automated QA             | Epic 3     | 3.1-3.7            |
| FR72-FR78   | System GitHub & Deployment      | Epic 4     | 4.1-4.7            |
| FR79-FR84   | System Self-Healing             | Epic 9     | 9.1-9.6            |
| FR85-FR90   | System Cost Tracking            | Epic 6     | 6.1-6.4, 6.7       |
| FR91-FR95   | System Execution Metrics        | Epic 6, 10 | 6.2, 10.5-10.7     |
| FR96-FR99   | PM Dashboard Interface          | Epic 5     | 5.1-5.5, 5.10      |
| FR100-FR104 | Orchestrator Monitoring         | Epic 10    | 10.5-10.8          |
| FR105-FR108 | Cost Monitoring Dashboard       | Epic 6     | 6.5                |
| FR109-FR111 | Quality Dashboard               | Epic 8     | 8.6                |
| FR112-FR115 | GO/NO-GO Dashboard              | Epic 6     | 6.6                |
| FR116-FR120 | Knowledge Base (Phase 2)        | Future     | Not in MVP         |
| FR121-FR127 | Client Portal (Phase 3)         | Future     | Not in MVP         |
| FR128-FR136 | Advanced Capabilities (Phase 3) | Future     | Not in MVP         |

**Phase 1 MVP Coverage:** 115 FRs (out of 136 total) ✅  
**Phase 2/3 Coverage:** 21 FRs deferred to future phases

---

## Implementation Roadmap

### Sprint Structure Recommendation

**Assumption:** 2-week sprints, 1 dev team (4-5 developers)

**Sprint 1-2: Foundation (Epic 1)**

- Goal: Complete development environment and infrastructure
- Deliverable: Running NestJS project with database, auth, CI/CD
- Complexity: High (foundational work, many moving parts)

**Sprint 3-4: Core Orchestration (Epic 2)**

- Goal: Tickets flow from ClickUp to AI providers
- Deliverable: First AI-generated code from ticket
- Complexity: High (core business logic, 3 AI integrations)

**Sprint 5: Quality Gates (Epic 3)**

- Goal: Automated QA validates AI code
- Deliverable: Code must pass linting, tests, security before proceeding
- Complexity: Medium (integrating existing tools)

**Sprint 6: GitHub & Deployment (Epic 4)**

- Goal: Code automatically pushed and deployed
- Deliverable: Complete ticket→code→production pipeline
- Complexity: Medium (GitHub API, CI/CD integration)

**Sprint 7-8: PM Dashboard (Epic 5)**

- Goal: PMs can monitor and manage AI projects
- Deliverable: Full PM interface with real-time updates
- Complexity: High (UI/UX, multiple views, real-time)

**Sprint 9: Cost Control (Epic 6)**

- Goal: Track costs and prevent overruns
- Deliverable: Cost dashboard with alerts and GO/NO-GO metrics
- Complexity: Medium (calculations, alerts, dashboards)

**Sprint 10: TL & QA Reviews (Epics 7-8)**

- Goal: TL and QA can review and approve
- Deliverable: Review queues, approval workflows
- Complexity: Medium (workflow UI, approval logic)

**Sprint 11: Self-Healing (Epic 9)**

- Goal: Auto-detect and fix production errors
- Deliverable: Production monitoring → auto-fix tickets
- Complexity: High (complex logic, AI fix generation)

**Sprint 12: Real-Time & Polish (Epic 10)**

- Goal: Real-time visibility and system monitoring
- Deliverable: Socket.IO updates, ops dashboard, notification system
- Complexity: Medium (WebSocket infrastructure, monitoring)

**Total MVP Timeline:** ~24 weeks (6 months) with 1 team

**Parallel Team Strategy:** If 2 teams available, reduce to 16 weeks (4 months):

- Team A: Epics 1, 2, 3, 4, 9 (backend heavy)
- Team B: Epics 5, 6, 7, 8, 10 (frontend/dashboard heavy)

---

## Document Completion Checklist

✅ **All 10 Phase 1 MVP Epics defined**  
✅ **94 total stories created** (13+12+8+8+10+8+8+8+8+10)  
✅ **Every story has:** User story format, BDD acceptance criteria, Prerequisites, Technical notes  
✅ **Architecture integration:** All stories reference architecture decisions, API contracts, data models  
✅ **FR coverage:** All 115 MVP FRs mapped to specific stories  
✅ **NFR coverage:** All 69 NFRs addressed (security, performance, scalability, etc.)  
✅ **Risk mitigation:** All 8 Priority 1 risks from brainstorming addressed  
✅ **Vertical slicing:** Each epic delivers user value, not just technical layers  
✅ **Story sizing:** All stories scoped for single dev session completion  
✅ **Sequential dependencies:** Prerequisites only reference earlier stories

---

## Next Steps

**Immediate (This Week):**

1. **Review & Approve Epics:** BMad reviews this breakdown
2. **Estimate Stories:** Dev team estimates each story (story points/hours)
3. **Sprint 1 Planning:** Select Epic 1 stories for first sprint
4. **Team Assignment:** Assign developers to first sprint stories

**Sprint 0 Preparation (Before Sprint 1):**

1. Set up repositories (monorepo or separate repos)
2. Configure ClickUp space for project
3. Set up GitHub organization/repositories
4. Provision cloud infrastructure (databases, RabbitMQ)
5. Obtain credentials:
   - Cursor CLI installed and configured
   - Anthropic API key for Claude Code (`ANTHROPIC_API_KEY`)
   - GitHub Personal Access Token
   - ClickUp API key and webhook secret
6. Run validation: `./scripts/validate-ai-providers.sh`
7. Set up development environments for team

**Ongoing:**

1. **Backlog Refinement:** Break down any unclear stories further
2. **Spike Stories:** Add technical investigation stories if needed
3. **UX Design Parallel Track:** Design dashboards while backend builds
4. **Testing Strategy:** Define test coverage expectations per story

---

**Document Status:** ✅ COMPLETE  
**Version:** 1.0  
**Total Pages:** ~100+  
**Total Stories:** 94  
**Total FRs Mapped:** 115/136 (MVP), 21 deferred to Phase 2/3  
**Ready For:** Sprint Planning & Implementation  
**Created:** 2025-11-21  
**Author:** BMad (via BMAD Method Analyst workflow)

---

_This epic breakdown provides complete implementation guidance for the Dark Software Factory MVP. Every story is actionable, architecturally aligned, and sized for agile development. Ready to transform your software house!_ 🚀
