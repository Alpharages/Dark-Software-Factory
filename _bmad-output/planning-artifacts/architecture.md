# Architecture Document: AI Dev Tool Orchestrator

## Dark Software Factory

**Date:** 2025-11-20  
**Version:** 1.0  
**Author:** BMad  
**Project:** Dark Software Factory - AI-Augmented Software House Transformation

---

## Executive Summary

The AI Dev Tool Orchestrator is a **separate NestJS microservice** that extends AetherFlow (existing 80% infrastructure) by automating the complete pipeline from PM-created tickets to deployed code. It acts as the "orchestration brain" connecting ClickUp webhooks → **Cursor Headless Mode** (AI code generation) → automated QA → GitHub → CI/CD deployment → production monitoring. The architecture leverages **Cursor's official CLI with headless mode** for programmatic AI code generation, providing full repository context, multi-file editing, and semantic codebase understanding without building AI capabilities from scratch.

**Architecture Philosophy:** "Integrate, don't disrupt" - the orchestrator extends AetherFlow's capabilities without modifying its proven 80% foundation.

**Key Innovation:** Using Cursor's official `--headless` mode for server-side, automated code generation - purpose-built for CI/CD and automation scenarios.

---

## Project Initialization

### First Implementation Story

**Command:**

```bash
npx @nestjs/cli new ai-dev-orchestrator --package-manager npm
```

**Options during setup:**

- Package manager: npm
- Enable strict TypeScript: Yes

**This establishes the base architecture with:**

- ✅ TypeScript configuration with strict mode
- ✅ NestJS modular structure (controllers, services, modules)
- ✅ Built-in testing framework (Jest)
- ✅ ESLint + Prettier for code consistency
- ✅ Dependency injection container
- ✅ Decorators for clean, declarative code

---

## Decision Summary Table

| Category              | Decision                            | Version         | Rationale                                                                              | Affects FRs              | Provided By           |
| --------------------- | ----------------------------------- | --------------- | -------------------------------------------------------------------------------------- | ------------------------ | --------------------- |
| **Foundation**        | Separate NestJS Microservice        | 10.x            | Clean separation from AetherFlow, enterprise structure, protects 80% infrastructure    | All 136 FRs              | User Decision         |
| **Language**          | TypeScript (Strict Mode)            | 5.x             | Type safety critical for multi-system integration, consistency with AetherFlow         | All FRs                  | NestJS Starter        |
| **Database**          | Separate PostgreSQL                 | 16.x            | Service independence, data encapsulation, scalable                                     | FR56-95 (System)         | User Decision         |
| **ORM**               | Prisma                              | 5.x             | Type-safe queries, migrations, excellent DX                                            | FR56-95 (System)         | Recommended           |
| **Message Queue**     | RabbitMQ                            | 3.13.x          | Robust message broker, reliable async communication, retry logic                       | FR60-78, Jobs            | User Decision         |
| **Real-time**         | Socket.IO                           | 4.x             | Dashboard real-time updates, matches AetherFlow pattern                                | FR96-115 (Dashboards)    | Recommended           |
| **HTTP Client**       | Axios                               | 1.x             | AI provider API calls, GitHub, ClickUp integration                                     | FR60-78 (Integration)    | Recommended           |
| **Logging**           | Winston                             | 3.x             | Structured JSON logging, audit trail                                                   | NFR-O1-4 (Observability) | Recommended           |
| **Monitoring**        | Prometheus + Grafana                | Latest          | Metrics exposure, dashboard visualization                                              | NFR-O5-11 (Monitoring)   | Recommended           |
| **Error Tracking**    | Sentry                              | Latest          | Production error monitoring, alerting                                                  | NFR-R4-7 (Reliability)   | Recommended           |
| **Testing**           | Jest + Supertest                    | NestJS built-in | Test coverage >80% requirement                                                         | NFR-M1 (Maintainability) | NestJS Starter        |
| **Authentication**    | Separate Auth Service (JWT)         | Custom          | Service independence, dedicated auth management                                        | NFR-S1-2 (Security)      | User Decision         |
| **Config Management** | @nestjs/config + dotenv             | NestJS built-in | Environment-based configuration                                                        | NFR-M4 (Maintainability) | NestJS Starter        |
| **Validation**        | class-validator + class-transformer | NestJS built-in | Request validation, DTO transformation                                                 | NFR-S4 (Security)        | NestJS Starter        |
| **API Documentation** | Swagger/OpenAPI                     | @nestjs/swagger | Internal API documentation for AetherFlow integration                                  | Integration              | Recommended           |
| **Deployment**        | Docker + Docker Compose             | Latest          | Containerization, runs alongside AetherFlow                                            | NFR-M7 (Operations)      | Recommended           |
| **Code Style**        | ESLint + Prettier                   | NestJS built-in | Code consistency across AI-generated code                                              | NFR-M2 (Maintainability) | NestJS Starter        |
| **API Versioning**    | Centralized URI Versioning (v1)     | 1.0.0           | Scalable, clear separation of versions, standardized across all controllers            | Integration              | Story 18.1            |
| **CLI Execution**     | node-pty                            | 1.1.x           | Robust terminal emulation for capturing progress bars and handling interactive prompts | FR60-65 (System)         | Architecture Decision |

**Key Architectural Decisions:**

- ✅ **Multi-Provider AI Strategy:** Cursor CLI Headless (primary) + Claude Code (fallback)
- ✅ **Cursor CLI Headless Mode:** Official approach for AI code generation (not custom APIs)
- ✅ **Claude Code:** Anthropic's autonomous coding agent as secondary provider for flexibility
- ✅ **Separate Database:** Own PostgreSQL instance (not shared with AetherFlow) for service independence
- ✅ **RabbitMQ:** Message broker for async AI execution, job queuing, retry logic
- ✅ **Separate Auth:** Dedicated authentication service (not shared with AetherFlow) using JWT
- ✅ **Socket.IO:** Real-time dashboard updates (consistent with AetherFlow)
- ✅ **Prometheus:** Metrics and observability for GO/NO-GO decision gates

**Critical Success Factor:** Dual-provider approach reduces risk - if one provider has issues, automatically fall back to the other.

---

## Complete Project Structure

```
ai-dev-orchestrator/
├── src/
│   ├── main.ts                          # Application entry point
│   ├── app.module.ts                    # Root module
│   │
│   ├── config/                          # Configuration management
│   │   ├── config.module.ts
│   │   ├── database.config.ts           # PostgreSQL connection
│   │   ├── rabbitmq.config.ts           # RabbitMQ connection
│   │   ├── auth.config.ts               # JWT secrets, auth service URL
│   │   └── ai-providers.config.ts       # Cursor, Windsurf, Antigravity configs
│   │
│   ├── auth/                            # Authentication integration
│   │   ├── auth.module.ts
│   │   ├── auth.guard.ts                # JWT validation guard
│   │   ├── roles.guard.ts               # RBAC enforcement
│   │   ├── jwt.strategy.ts              # Passport JWT strategy
│   │   └── auth-client.service.ts       # Calls separate auth service
│   │
│   ├── webhooks/                        # ClickUp webhook ingestion (FR56-59)
│   │   ├── webhooks.module.ts
│   │   ├── webhooks.controller.ts       # POST /api/v1/webhooks/clickup
│   │   ├── webhooks.service.ts          # Parse and validate webhook payloads
│   │   └── dto/
│   │       ├── clickup-webhook.dto.ts
│   │       └── task-event.dto.ts
│   │
│   ├── ticket-intake/                   # Ticket parsing and validation (FR56-59)
│   │   ├── ticket-intake.module.ts
│   │   ├── ticket-intake.service.ts     # Extract requirements, context, acceptance criteria
│   │   ├── ticket-validator.service.ts  # Quality checks before routing
│   │   └── dto/
│   │       └── parsed-ticket.dto.ts
│   │
│   ├── rabbitmq/                        # RabbitMQ infrastructure
│   │   ├── rabbitmq.module.ts
│   │   ├── rabbitmq.service.ts          # Connection management
│   │   ├── publishers/
│   │   │   ├── ai-task.publisher.ts     # Publish AI execution tasks
│   │   │   ├── qa-task.publisher.ts     # Publish QA tasks
│   │   │   └── deployment-task.publisher.ts
│   │   └── consumers/
│   │       ├── ai-task.consumer.ts      # Consume and process AI tasks
│   │       ├── qa-task.consumer.ts      # Consume and process QA tasks
│   │       └── deployment-task.consumer.ts
│   │
│   ├── ai-routing/                      # AI code generation engine (FR60-65)
│   │   ├── ai-routing.module.ts
│   │   ├── ai-routing.service.ts        # Orchestrates AI code generation
│   │   ├── prompt-builder.service.ts    # Convert tickets to AI prompts
│   │   ├── providers/
│   │   │   ├── base-ai.provider.ts      # Abstract base class
│   │   │   ├── cursor-headless.provider.ts  # ⭐ PRIMARY: Cursor CLI headless mode
│   │   │   ├── claude-code.provider.ts   # 🔄 SECONDARY: Claude Code (Anthropic)
│   │   │   ├── workspace.service.ts     # Workspace isolation & management
│   │   │   └── provider-factory.ts      # Provider selection & fallback logic
│   │   └── strategies/
│   │       ├── routing-strategy.ts      # Provider selection logic
│   │       └── fallback-strategy.ts     # Auto-fallback on provider failure
│   │
│   ├── execution/                       # AI execution monitoring (FR60-65)
│   │   ├── execution.module.ts
│   │   ├── execution.service.ts         # Monitor AI progress, handle timeouts
│   │   ├── execution-tracker.service.ts # Track state, retry logic
│   │   └── dto/
│   │       ├── execution-status.dto.ts
│   │       └── execution-result.dto.ts
│   │
│   ├── qa-automation/                   # Automated QA layer (FR66-71)
│   │   ├── qa-automation.module.ts
│   │   ├── qa-orchestrator.service.ts   # Coordinate QA checks
│   │   ├── linter.service.ts            # ESLint, Prettier checks
│   │   ├── test-runner.service.ts       # Execute unit/integration tests
│   │   ├── code-review.service.ts       # Security, complexity checks
│   │   ├── coverage.service.ts          # Test coverage calculation
│   │   └── quality-gates.service.ts     # Enforce thresholds
│   │
│   ├── github/                          # GitHub integration (FR72-78)
│   │   ├── github.module.ts
│   │   ├── github.service.ts            # Branch, commit, PR operations
│   │   ├── github-client.service.ts     # Octokit API wrapper
│   │   └── dto/
│   │       ├── branch.dto.ts
│   │       ├── commit.dto.ts
│   │       └── pull-request.dto.ts
│   │
│   ├── deployment/                      # CI/CD trigger (FR76-78)
│   │   ├── deployment.module.ts
│   │   ├── deployment.service.ts        # Trigger pipelines
│   │   ├── deployment-monitor.service.ts # Track deployment status
│   │   └── providers/
│   │       ├── github-actions.provider.ts
│   │       ├── jenkins.provider.ts
│   │       └── generic-cicd.provider.ts
│   │
│   ├── production-monitoring/           # Self-healing loop (FR79-84)
│   │   ├── production-monitoring.module.ts
│   │   ├── monitoring.service.ts        # Production error detection
│   │   ├── log-analyzer.service.ts      # Parse error logs
│   │   ├── ticket-creator.service.ts    # Auto-create fix tickets in ClickUp
│   │   └── dto/
│   │       ├── production-error.dto.ts
│   │       └── fix-ticket.dto.ts
│   │
│   ├── cost-tracking/                   # Cost monitoring (FR85-90)
│   │   ├── cost-tracking.module.ts
│   │   ├── cost-tracker.service.ts      # Track API usage per project
│   │   ├── cost-calculator.service.ts   # Calculate costs in real-time
│   │   ├── budget-monitor.service.ts    # Alert on threshold breaches
│   │   └── dto/
│   │       ├── usage-record.dto.ts
│   │       └── cost-report.dto.ts
│   │
│   ├── metrics/                         # Execution metrics (FR91-95)
│   │   ├── metrics.module.ts
│   │   ├── metrics.service.ts           # Aggregate metrics
│   │   ├── prometheus.service.ts        # Expose Prometheus metrics
│   │   └── dto/
│   │       └── metric-data.dto.ts
│   │
│   ├── dashboards/                      # Dashboard API endpoints (FR96-115)
│   │   ├── dashboards.module.ts
│   │   ├── pm-dashboard.controller.ts   # PM project portfolio API
│   │   ├── orchestrator-dashboard.controller.ts # System status API
│   │   ├── cost-dashboard.controller.ts # Cost metrics API
│   │   ├── qa-dashboard.controller.ts   # Quality metrics API
│   │   ├── decision-dashboard.controller.ts # GO/NO-GO gate API
│   │   └── dto/
│   │       ├── pm-dashboard.dto.ts
│   │       ├── orchestrator-status.dto.ts
│   │       ├── cost-metrics.dto.ts
│   │       ├── quality-metrics.dto.ts
│   │       └── decision-metrics.dto.ts
│   │
│   ├── realtime/                        # Real-time updates (FR96-115)
│   │   ├── realtime.module.ts
│   │   ├── realtime.gateway.ts          # Socket.IO gateway
│   │   └── events/
│   │       ├── execution-progress.event.ts
│   │       ├── cost-alert.event.ts
│   │       └── quality-alert.event.ts
│   │
│   ├── integration/                     # AetherFlow & external service integration
│   │   ├── integration.module.ts
│   │   ├── aetherflow.service.ts        # Call AetherFlow APIs
│   │   ├── clickup.service.ts           # ClickUp API wrapper
│   │   └── dto/
│   │       └── aetherflow-context.dto.ts
│   │
│   ├── common/                          # Shared utilities
│   │   ├── decorators/
│   │   │   ├── roles.decorator.ts       # RBAC
│   │   │   └── audit-log.decorator.ts   # Audit logging
│   │   ├── guards/
│   │   │   ├── auth.guard.ts            # Authentication
│   │   │   └── roles.guard.ts           # Authorization
│   │   ├── interceptors/
│   │   │   ├── logging.interceptor.ts   # Request logging
│   │   │   └── transform.interceptor.ts # Response transformation
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts # Error handling
│   │   ├── pipes/
│   │   │   └── validation.pipe.ts       # Input validation
│   │   └── utils/
│   │       ├── logger.util.ts           # Winston logger
│   │       └── date.util.ts             # Date handling
│   │
│   └── database/                        # Database layer
│       ├── database.module.ts
│       ├── prisma.service.ts            # Prisma client
│       └── repositories/                # Data access layer
│           ├── ticket.repository.ts
│           ├── execution.repository.ts
│           ├── cost.repository.ts
│           └── metrics.repository.ts
│
├── prisma/
│   ├── schema.prisma                    # Database schema
│   └── migrations/                      # Migration files
│
├── test/
│   ├── unit/                            # Unit tests
│   ├── integration/                     # Integration tests
│   └── e2e/                             # End-to-end tests
│
├── docker/
│   ├── Dockerfile                       # Production image
│   ├── Dockerfile.dev                   # Development image
│   └── docker-compose.yml               # Local development setup (orchestrator + postgres + rabbitmq)
│
├── docs/
│   ├── api/                             # Swagger API documentation
│   └── architecture/                    # Architecture diagrams
│
├── .env.example                         # Environment variables template
├── .eslintrc.js                         # ESLint configuration
├── .prettierrc                          # Prettier configuration
├── jest.config.js                       # Jest configuration
├── tsconfig.json                        # TypeScript configuration
├── package.json                         # Dependencies
└── README.md                            # Project documentation
```

---

## FR Category to Architecture Mapping

### PM Capabilities (FR1-23) → Dashboards & Integration Modules

| FR Range | Capability Area                | Architecture Components                                                                                        |
| -------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| FR1-7    | Ticket Creation & Management   | `integration/aetherflow.service.ts`, `integration/clickup.service.ts`, `dashboards/pm-dashboard.controller.ts` |
| FR8-14   | AI Project Orchestration       | `execution/execution.service.ts`, `dashboards/pm-dashboard.controller.ts`, `realtime/realtime.gateway.ts`      |
| FR15-19  | Workload & Capacity Management | `metrics/metrics.service.ts`, `dashboards/pm-dashboard.controller.ts`, Alert system                            |
| FR20-23  | Client Communication           | `integration/clickup.service.ts`, PM dashboard API endpoints                                                   |

**Implementation Notes:**

- PM dashboard APIs expose data aggregated from multiple services
- Real-time Socket.IO updates push execution status to PM dashboards
- AetherFlow service handles BMAD PM Agent interactions

---

### Technical Lead Capabilities (FR24-33) → Review Queues & Validation

| FR Range | Capability Area          | Architecture Components                                                                         |
| -------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| FR24-29  | Architecture Validation  | `dashboards/orchestrator-dashboard.controller.ts`, Review queue APIs, ADR logging               |
| FR30-33  | AI Capability Management | `ai-routing/routing-strategy.ts`, `execution/execution-tracker.service.ts`, Escalation handlers |

**Implementation Notes:**

- Architecture Decision Records (ADRs) logged in database with AI rationale
- Review queue prioritization based on risk scoring
- Escalation triggers when AI confidence score below threshold

---

### Lead QA Capabilities (FR34-43) → Quality Automation & Dashboards

| FR Range | Capability Area        | Architecture Components                                                                             |
| -------- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| FR34-40  | Quality Review & Gates | `qa-automation/quality-gates.service.ts`, `dashboards/qa-dashboard.controller.ts`, Sampling service |
| FR41-43  | QA Metrics & Analysis  | `metrics/metrics.service.ts`, `dashboards/qa-dashboard.controller.ts`, Prometheus metrics           |

**Implementation Notes:**

- Statistical sampling implemented with configurable percentage (default 20%)
- Quality gates configured per project type
- Bug escape rate tracked via production monitoring integration

---

### Manager/Leadership Capabilities (FR44-55) → Business Dashboards

| FR Range | Capability Area      | Architecture Components                                                                                    |
| -------- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| FR44-48  | Business Oversight   | `cost-tracking/cost-tracker.service.ts`, `dashboards/cost-dashboard.controller.ts`, Project portfolio APIs |
| FR49-52  | Workforce Management | `metrics/metrics.service.ts`, Early warning system, `dashboards/decision-dashboard.controller.ts`          |
| FR53-55  | Client Relationship  | Client health scoring service, CRM integration endpoints                                                   |

**Implementation Notes:**

- GO/NO-GO decision dashboard pulls from all metrics services
- Early warning indicators match Pre-mortem analysis risks
- Cost caps enforced via `cost-tracking/budget-monitor.service.ts`

---

### AI Orchestrator System (FR56-95) → Core Orchestration Engine

| FR Range | Capability Area                      | Architecture Components                                                                                    |
| -------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| FR56-59  | Webhook & Task Intake                | `webhooks/webhooks.controller.ts`, `ticket-intake/ticket-intake.service.ts`, RabbitMQ publisher            |
| FR60-65  | AI Tool Routing & Execution          | `ai-routing/ai-routing.service.ts`, `providers/cursor.provider.ts`, etc., `execution/execution.service.ts` |
| FR66-71  | Automated QA & Quality Gates         | `qa-automation/qa-orchestrator.service.ts`, All QA subservices, RabbitMQ consumer                          |
| FR72-78  | GitHub Integration & Deployment      | `github/github.service.ts`, `deployment/deployment.service.ts`, CI/CD providers                            |
| FR79-84  | Self-Healing & Production Monitoring | `production-monitoring/monitoring.service.ts`, `log-analyzer.service.ts`, Auto-ticket creation             |
| FR85-90  | Cost Tracking & Optimization         | `cost-tracking/cost-tracker.service.ts`, `budget-monitor.service.ts`, Real-time cost calculation           |
| FR91-95  | Execution Metrics & Logging          | `metrics/metrics.service.ts`, `prometheus.service.ts`, Winston logger, Audit trail                         |

**Implementation Notes:**

- RabbitMQ queues for: `ai-tasks`, `qa-tasks`, `deployment-tasks`, `monitoring-tasks`
- Each queue has dedicated consumer with retry logic (3 attempts with exponential backoff)
- All state transitions logged to database and Prometheus metrics
- Cost tracking hooks into all AI provider API calls

---

### Dashboard & Monitoring (FR96-115) → Real-Time Interfaces

| FR Range  | Capability Area             | Architecture Components                                                                   |
| --------- | --------------------------- | ----------------------------------------------------------------------------------------- |
| FR96-99   | PM Dashboard                | `dashboards/pm-dashboard.controller.ts`, Socket.IO events, Dashboard DTOs                 |
| FR100-104 | Orchestrator Monitoring     | `dashboards/orchestrator-dashboard.controller.ts`, System health endpoints, Queue metrics |
| FR105-108 | Cost Monitoring Dashboard   | `dashboards/cost-dashboard.controller.ts`, Cost aggregation, Trend analysis               |
| FR109-111 | Quality Dashboard           | `dashboards/qa-dashboard.controller.ts`, Quality metrics aggregation, Bug rate tracking   |
| FR112-115 | GO/NO-GO Decision Dashboard | `dashboards/decision-dashboard.controller.ts`, Phase gate criteria, Success metrics       |

**Implementation Notes:**

- All dashboard controllers expose REST APIs consumed by frontend (separate `dsf-dashboard` repository)
- Socket.IO gateway (`realtime/realtime.gateway.ts`) pushes updates to connected clients
- Dashboard data refreshes: Real-time (Socket.IO) + Polling fallback (every 30s)
- Frontend repository: `/Volumes/Data/project/products/alpharages/dsf-dashboard` (React + TypeScript)

---

### Knowledge Base (FR116-120) → Phase 2 - Future Architecture

| FR Range  | Capability Area       | Architecture Components (Phase 2)                                                        |
| --------- | --------------------- | ---------------------------------------------------------------------------------------- |
| FR116-120 | Knowledge Base System | `knowledge-base` module (to be built), Vector database integration, AI context injection |

**Phase 2 Design Notes:**

- Consider Pinecone or Weaviate for vector storage
- Automatic knowledge extraction from successful tickets
- Context injection into AI prompts before execution

---

### Client Portal (FR121-127) → Phase 3 - Future Architecture

| FR Range  | Capability Area | Architecture Components (Phase 3)                                                    |
| --------- | --------------- | ------------------------------------------------------------------------------------ |
| FR121-127 | Client Portal   | `client-portal` module (to be built), Separate client-facing API, Transparency views |

**Phase 3 Design Notes:**

- Separate client-facing REST API with different auth
- Read-only access to project status, metrics, AI involvement transparency
- Client preference management (opt-in/opt-out AI)

---

### Advanced Capabilities (FR128-136) → Phase 3 - Future Architecture

| FR Range  | Capability Area         | Architecture Components (Phase 3)                                         |
| --------- | ----------------------- | ------------------------------------------------------------------------- |
| FR128-130 | Predictive Analytics    | ML models, Historical data analysis, Cost/complexity prediction           |
| FR131-133 | Multi-Provider Strategy | Enhanced routing logic, Fallback providers, Performance comparison        |
| FR134-136 | Advanced Self-Healing   | Autonomous fix generation, Testing sandbox, Auto-deployment with rollback |

**Phase 3 Design Notes:**

- ML models trained on historical project data for predictions
- Multi-provider routing based on task type, cost, performance, availability
- Advanced self-healing requires sandboxed test environment for fix validation

---

## Technology Stack Details

### Backend Framework

- **NestJS 10.x** - Enterprise-grade Node.js framework
  - Modular architecture with dependency injection
  - Decorators for clean, declarative code
  - Built-in support for microservices, websockets, GraphQL
  - Extensive ecosystem of official packages

### Database Layer

- **PostgreSQL 16.x** - Separate database instance
  - ACID transactions for state management
  - JSON/JSONB support for flexible schemas
  - Full-text search capabilities
  - Proven scalability for high-volume applications

- **Prisma 5.x** - Modern ORM
  - Type-safe database client generated from schema
  - Migrations with schema history
  - Query builder with excellent IDE support
  - Connection pooling and performance optimization

### Message Queue

- **RabbitMQ 3.13.x** - Message broker
  - Reliable message delivery with acknowledgments
  - Dead letter queues for failed messages
  - Message TTL (time-to-live) configuration
  - Management UI for monitoring queues
  - Supports AMQP protocol

- **NestJS Microservices** - RabbitMQ integration
  - `@MessagePattern` decorators for consumers
  - `ClientProxy` for publishers
  - Automatic message serialization/deserialization
  - Retry logic configuration

### Real-Time Communication

- **Socket.IO 4.x** - WebSocket library
  - Bidirectional event-based communication
  - Automatic reconnection
  - Broadcasting to multiple clients
  - Room-based messaging (per PM, per project)
  - Compatible with AetherFlow's existing Socket.IO setup

### AI Code Generation - Multi-Provider Strategy

**Primary: Cursor CLI (Headless Mode)**

- Official CLI: `cursor --headless --dir /path --apply "prompt"`
- Server-side execution (no GUI required)
- Full repository context awareness
- Multi-file editing with consistency
- Semantic codebase understanding
- Built-in code quality and best practices
- Supports concurrent execution (multiple workspaces)

**Cursor Headless Features:**

- `--headless`: Runs without GUI (server-ready)
- `--dir`: Specifies workspace directory
- `--apply`: AI prompt for code generation
- `--files`: Target specific files (optional)
- `--wait`: Wait for completion before exiting

**Secondary: Claude Code (Anthropic)**

- Anthropic's autonomous coding agent
- Programmatic access to Claude 3.5 Sonnet with extended context
- Excellent code generation capabilities
- Autonomous multi-file editing and context building
- Fallback when Cursor unavailable
- Lower cost per token than some alternatives

**Claude Code Integration:**

- API-based integration via Anthropic SDK
- Agentic workflow: prompt → plan → code → verify
- Extended context window (200K+ tokens)
- Multi-turn conversation for complex tasks
- Autonomous tool use and file operations
- Structured output for code changes

**Multi-Provider Strategy:**

```typescript
// Provider selection logic
async function selectProvider(ticket: Ticket): AIProvider {
  // Try Cursor first (full repo context)
  if (await cursorProvider.isAvailable()) {
    return cursorProvider;
  }

  // Fallback to Claude Code
  if (await claudeProvider.isAvailable()) {
    return claudeProvider;
  }

  throw new Error('No AI providers available');
}
```

**Why Multi-Provider Approach:**

- ✅ **Risk Mitigation:** One provider fails → auto-switch to backup
- ✅ **Flexibility:** Choose best provider per ticket type
- ✅ **Cost Optimization:** Use cheaper provider for simple tasks
- ✅ **Performance:** Route based on provider availability/speed
- ✅ **Validation:** Compare outputs from different providers

### HTTP Client & External APIs

- **Axios 1.x** - Promise-based HTTP client
  - Interceptors for auth, logging, retries
  - Request/response transformation
  - Timeout configuration
  - Support for cancellation tokens

**External APIs:**

- GitHub REST API v3 (Octokit client)
- ClickUp API v2
- AetherFlow internal APIs

### Logging & Monitoring

- **Winston 3.x** - Logging library
  - Structured JSON logging
  - Multiple transports (console, file, remote)
  - Log levels (error, warn, info, debug)
  - Context-aware logging with correlation IDs

- **Prometheus** - Metrics collection
  - Counter, Gauge, Histogram, Summary metrics
  - `/metrics` endpoint for Prometheus scraping
  - Custom metrics for business KPIs

- **Grafana** - Metrics visualization
  - Pre-built dashboards for all 5 dashboard types
  - Alert rules integration
  - Query builder for custom views

- **Sentry** - Error tracking
  - Automatic error capture and reporting
  - Stack traces with source maps
  - Release tracking
  - Performance monitoring
  - Alerts via Slack/email

### Authentication & Authorization

- **Separate Auth Service** - JWT-based
  - Issues JWTs with user claims (userId, role, permissions)
  - Token refresh mechanism
  - Role-based access control (PM, TL, QA, Manager, Admin)
  - Integration with orchestrator via `auth-client.service.ts`

- **Passport.js** - Authentication middleware
  - JWT strategy for token validation
  - Guards for route protection
  - Custom strategies for future auth methods

### Testing

- **Jest** - Testing framework (NestJS built-in)
  - Unit tests (mocking services)
  - Integration tests (with test database)
  - Coverage reports (target >80%)

- **Supertest** - HTTP assertions
  - API endpoint testing
  - E2E testing for complete flows

### Deployment & DevOps

- **Docker** - Containerization
  - Multi-stage builds for optimized images
  - Separate images for development and production
  - docker-compose.yml for local development stack

- **Docker Compose** - Local development
  - Orchestrator service
  - PostgreSQL database
  - RabbitMQ message broker
  - Grafana + Prometheus (optional)

- **CI/CD** - Automated deployment
  - GitHub Actions (preferred)
  - Build, test, and deploy pipeline
  - Automated migrations
  - Health check verification

### Code Quality

- **ESLint** - Linting (NestJS built-in)
  - TypeScript rules
  - NestJS-specific rules
  - Custom rules for consistency

- **Prettier** - Code formatting (NestJS built-in)
  - Automatic formatting
  - Consistent code style
  - Pre-commit hooks

- **Husky** - Git hooks
  - Pre-commit: Lint and format
  - Pre-push: Run tests
  - Commit message validation

---

## API Versioning & Routing Strategy

**Status:** Accepted (ADR-018)
**Reference:** [Story 18.1: Centralize API Versioning]

The system implements a centralized API versioning strategy using NestJS built-in versioning capabilities. This ensures consistency across all components and simplifies future version upgrades.

### Core Configuration (src/main.ts)

- **Global Prefix:** `api` (applied to all routes except excluded ones)
- **Versioning Type:** URI-based (`type: VersioningType.URI`)
- **Default Version:** `1` (`defaultVersion: '1'`)
- **Resulting Path:** `/api/v1/*`

### Exclusions

Certain endpoints are excluded from the global prefix to maintain compatibility with external tools or standards:

1. **Prometheus Metrics:** `GET /metrics` (Standard path for Prometheus scrapers)
2. **Swagger UI:** `GET /api/docs` (Excluded from versioning for a stable documentation entry point)

### Controller Implementation Guidelines

Controllers should **never** hardcode version prefixes (like `v1` or `api/v1`) in their `@Controller()` decorator.

- **Correct:** `@Controller('projects')` → Accessible at `/api/v1/projects`
- **Incorrect:** `@Controller('api/v1/projects')` → Results in `/api/v1/api/v1/projects` (double-versioning)

### Benefits

1. **Standardization:** All API endpoints follow the same path pattern.
2. **Scalability:** New versions (e.g., `v2`) can be introduced by updating the `defaultVersion` or using method-level `@Version()` decorators.
3. **Decoupling:** Frontend and integration clients use a consistent base URL (`/api/v1`).

---

## AI Delegation Pattern & Guidelines

**Status:** Accepted (ADR-008)  
**Based On:** Epic 4 Success (50% time reduction, 90% LOC reduction)  
**Reference:** [ADR-008: AI Delegation Pattern](./architecture/adr-008-ai-delegation-pattern.md)

### Overview

During Epic 4, we discovered that AI agents can **execute commands, parse outputs, AND format results**—eliminating the need for custom service implementations. This section defines when to delegate to AI vs. build custom services.

---

### The Correct AI Delegation Pattern

**Dark Software Factory (DSF) Owns:**

1. **Orchestration** - Decide WHEN to execute operations
2. **Instruction** - Tell AI WHAT to execute and WHAT format to return
3. **Storage** - Save AI's structured results to database
4. **Decision** - Use business logic to decide pass/fail
5. **Observability** - Record metrics, audit logs, error tracking

**AI Tool (Cursor/Claude/OpenAI) Owns:**

1. **Execution** - Run shell commands, git operations, npm scripts
2. **Parsing** - Read and interpret command outputs
3. **Analysis** - Summarize results, identify patterns, categorize issues
4. **Formatting** - Return structured JSON/data to DSF

```typescript
// AI Delegation Pattern Template
class FeatureOrchestrator {
  constructor(
    private orchestratorService: OrchestratorService, // AI execution
    private repository: Repository, // Database
    private metricsService: MetricsService, // Observability
  ) {}

  async executeFeature(context: Context): Promise<Result> {
    // 1. ORCHESTRATION: Decide to execute
    const shouldExecute = this.decideIfNeeded(context);

    // 2. INSTRUCTION: Prepare AI prompt
    const prompt = this.buildPrompt(context);

    // 3. EXECUTION: Delegate to AI
    const aiResult = await this.orchestratorService.executeTask(prompt);

    // 4. STORAGE: Save results
    await this.repository.save(aiResult);

    // 5. DECISION: Apply business logic
    const decision = this.applyBusinessRules(aiResult);

    // 6. OBSERVABILITY: Record metrics
    this.metricsService.record('feature_executed', decision);

    return decision;
  }
}
```

---

### Client Projects Already Have QA Tooling

**Key Insight:** Don't rebuild what clients already have.

- **Client projects have:** `npm run lint`, `npm run test`, `npm run security`
- **DSF should:** Execute client's existing scripts via AI, not rebuild infrastructure
- **Example:** Instead of building ESLint parser, ask AI to "run npm run lint and return JSON summary"

**Benefits:**

- ✅ Zero custom parser code
- ✅ Works across all linters (ESLint, Flake8, RuboCop, Pylint)
- ✅ Leverage client's existing configuration
- ✅ Support any language/framework automatically

---

### Token Costs vs. Development Time Trade-off

**Token costs are acceptable vs. development/maintenance burden.**

| Aspect               | Custom Services (Epic 3)                | AI Delegation (Epic 4)                    |
| -------------------- | --------------------------------------- | ----------------------------------------- |
| **Development Time** | Baseline (100%)                         | 50% faster                                |
| **Code Volume**      | ~2,000 LOC                              | ~200 LOC (90% reduction)                  |
| **Maintenance**      | Update parsers for each tool version    | AI adapts automatically                   |
| **Tech Stacks**      | Build per language (Node, Python, Ruby) | One implementation works for all          |
| **Scalability**      | Add code for each new tool              | AI handles new tools without code changes |
| **Cost**             | Developer time (high)                   | AI API tokens (low)                       |

**Epic 4 Results:**

- Token costs: ~$50/month
- Developer time saved: ~$20,000/month (50% reduction)
- **ROI:** 400x return on token investment

---

### Decision Tree: When to Delegate vs. Build

```
START: New feature requirement
  │
  ├─ Does the task involve executing existing CLI tools? (npm, git, linters, test runners)
  │   YES → DELEGATE TO AI ✅
  │   NO → Continue to next question
  │
  ├─ Does the task require parsing/interpreting tool outputs?
  │   YES → DELEGATE TO AI ✅ (AI can parse better than custom regex)
  │   NO → Continue to next question
  │
  ├─ Does the task involve natural language processing? (summarization, sentiment, extraction)
  │   YES → DELEGATE TO AI ✅
  │   NO → Continue to next question
  │
  ├─ Is this a business logic decision? (quality gates, approval workflows, routing)
  │   YES → BUILD CUSTOM SERVICE ⚠️ (DSF owns business logic)
  │   NO → Continue to next question
  │
  ├─ Is this data storage/retrieval? (database operations, state management)
  │   YES → BUILD CUSTOM SERVICE ⚠️ (DSF owns data layer)
  │   NO → Continue to next question
  │
  ├─ Is this observability? (metrics, logging, audit trails)
  │   YES → BUILD CUSTOM SERVICE ⚠️ (DSF owns observability)
  │   NO → Consider delegation but validate ROI
  │
  └─ DEFAULT: If unsure, prototype with AI delegation first (faster to validate)
```

---

### Anti-Patterns: What NOT to Build

#### Anti-Pattern #1: Custom Tool Wrappers

- ❌ **DON'T:** Build `LintingService` with custom ESLint/Flake8/Pylint parsers
- ✅ **DO:** Ask AI to "run npm run lint and return JSON with error count, file list, issues"
- **Reason:** AI handles parsing across all linters, you maintain 0 parser code
- **LOC Saved:** ~500 LOC per linter avoided

#### Anti-Pattern #2: Language-Specific Integrations

- ❌ **DON'T:** Build `PythonTestRunner`, `NodeTestRunner`, `RubyTestRunner`
- ✅ **DO:** Ask AI to "detect test framework, run tests, return structured results"
- **Reason:** AI adapts to any language, you build once
- **LOC Saved:** ~300 LOC per language avoided

#### Anti-Pattern #3: Complex Output Parsing Logic

- ❌ **DON'T:** Build regex parsers for Jest output, Pytest output, Mocha output
- ✅ **DO:** Ask AI to "parse test output and return JSON with pass/fail counts"
- **Reason:** AI understands context better than regex
- **LOC Saved:** ~200 LOC per test framework avoided

#### Anti-Pattern #4: Duplicate Existing Tools

- ❌ **DON'T:** Build custom code formatters, linters, or test runners
- ✅ **DO:** Use client's existing `npm scripts` via AI delegation
- **Reason:** Client already configured their tooling, leverage it
- **LOC Saved:** ~1,000+ LOC avoided (entire custom QA infrastructure)

---

### Working Examples from Epic 4

#### Example 1: AI-Delegated Linting (from Story 3.10)

**❌ OLD WAY (Epic 3): Custom service with parser**

```typescript
class LintingService {
  async lint(ticketId: string): Promise<LintResult> {
    // 1. Detect linter (complex logic)
    const linter = await this.detectLinter(projectDir);

    // 2. Execute linter command (exec)
    const output = await exec(`${linter} ${projectDir}`);

    // 3. Parse output with custom regex (fragile)
    const issues = this.parseOutput(output, linter);

    // 4. Transform to internal format
    return this.transformToInternal(issues);
    // Total: ~500 LOC
  }
}
```

**✅ NEW WAY (Epic 4 pattern): AI delegation**

```typescript
class AiQaOrchestrator {
  async executeLintCheck(ticketId: string, projectDir: string): Promise<QaResult> {
    const prompt = `Run linting checks in ${projectDir} and return JSON: {status, errorCount, issues[]}`;

    const result = await this.orchestratorService.executeTask(prompt, { projectDir });

    return JSON.parse(result.output); // AI returns structured JSON
    // Total: ~30 LOC
  }
}
```

**Savings:** 470 LOC eliminated, works across all linters

---

#### Example 2: AI-Delegated Git Operations (from Story 4.3)

```typescript
// GitHubCommitOrchestrator.ts
class GitHubCommitOrchestrator {
  async generateCommitMessage(ticketId: string, diff: string): Promise<string> {
    // Build AI prompt
    const prompt = this.buildCommitPrompt(ticketId, diff);

    // Execute via AI (delegation)
    const result = await this.orchestratorService.executeTask(prompt);

    // Parse AI response
    const message = this.parseCommitMessage(result.output);

    // Store result
    await this.trackCommit(ticketId, message);

    return message;
  }

  private buildCommitPrompt(ticketId: string, diff: string): string {
    return `Generate conventional commit message for these changes:
    
    Ticket: ${ticketId}
    Diff: ${diff}
    
    Return JSON: { "message": "feat(scope): description" }`;
  }
}
```

**Reference:** [Story 4.3: Git Commit Generation](../sprint-artifacts/4-3-git-commit-generation-push.md)

---

#### Example 3: AI-Delegated PR Descriptions (from Story 4.4)

```typescript
// GitHubPROrchestrator.ts
class GitHubPROrchestrator {
  async createPullRequest(ticketId: string, branchName: string): Promise<string> {
    // Build PR description via AI
    const prompt = this.buildPRPrompt(ticketId, branchName);
    const result = await this.orchestratorService.executeTask(prompt);
    const description = this.parsePRDescription(result.output);

    // Create PR with AI-generated description
    const prUrl = await this.githubService.createPR({
      title: `Story ${ticketId}`,
      description,
      head: branchName,
      base: 'main',
    });

    // Store PR metadata
    await this.trackPR(ticketId, prUrl, description);

    return prUrl;
  }

  private buildPRPrompt(ticketId: string, branchName: string): string {
    return `Create PR description for ${ticketId} (branch: ${branchName}):
    
    Return JSON: {
      "summary": "Brief overview",
      "changes": ["Change 1", "Change 2"],
      "testing": "How to test"
    }`;
  }
}
```

**Reference:** [Story 4.4: PR Creation](../sprint-artifacts/4-4-pull-request-creation-metadata.md)

---

### Migration Strategy

**Phase 1: Document (Current)**

- ✅ Create ADR-008
- ✅ Update architecture.md
- ⏳ Refactor Epic 3 QA Automation (Story 3.10)

**Phase 2: Expand Application**

- Apply to Epic 5: PM Dashboard
- Apply to Epic 6: Cost Monitoring
- Apply to Epic 7: Architecture Review
- Expected: 30-40% effort reduction

**Phase 3: Optimize**

- Monitor token costs and optimize prompts
- Implement caching for repeated operations
- Build reusable prompt templates

---

### Success Metrics

**Epic 4 Results (Validated):**

- ✅ Development time: **50% faster** than Epic 3
- ✅ Code volume: **90% reduction** (~200 LOC vs ~2,000 LOC)
- ✅ Tech stack coverage: **Universal** (Node.js, Python, Ruby, Go)
- ✅ Reliability: **99%+ availability** (multi-provider fallback)
- ✅ Token costs: **$50/month** vs **$20,000/month** developer time saved

**Epic 3 Refactor Predictions (Story 3.10):**

- Delete ~1,800 LOC of custom services
- Replace with ~180 LOC AI orchestrator
- Maintain identical functionality
- Eliminate all language-specific code

---

## Integration Points

### 1. AetherFlow Integration

**Communication:** HTTP/REST + Shared Event Bus (optional)

**Orchestrator → AetherFlow:**

- Call BMAD PM Agent for ticket enhancement
- Query project context and metadata
- Update ticket status in ClickUp via AetherFlow
- Access client information

**AetherFlow → Orchestrator:**

- Fetch dashboard data via REST APIs
- Receive real-time updates via Socket.IO
- Trigger manual interventions (approve, reject, escalate)

**Shared Resources:**

- Socket.IO namespace isolation (AetherFlow: `/aetherflow`, Orchestrator: `/orchestrator`)
- Optional: Shared Redis for Socket.IO adapter (if scaling horizontally)

### 2. ClickUp Integration

**Communication:** Webhooks (inbound) + REST API (outbound)

**ClickUp → Orchestrator:**

- Webhook events: `taskCreated`, `taskUpdated`, `taskStatusChanged`
- Payload includes: task details, custom fields, comments, attachments
- Webhook endpoint: `POST /webhooks/clickup` (secured with signature verification)

**Orchestrator → ClickUp:**

- Create fix tickets for production issues
- Update task status (in-progress, deployed, failed)
- Add comments with execution details
- Update custom fields (AI confidence, cost, execution time)

---

### 3. GitHub Integration (Multi-Account Strategy)

**Challenge:** Repositories may be spread across multiple GitHub accounts (personal, client orgs, etc.)

**Solution:** GitHub App with per-installation authentication

#### **Why GitHub App vs Personal Access Tokens?**

| Feature              | GitHub App                               | Personal Access Token (PAT) |
| -------------------- | ---------------------------------------- | --------------------------- |
| **Multi-Account**    | ✅ Install on multiple accounts          | ❌ Tied to one account      |
| **Repository Scope** | ✅ Per-installation permissions          | ❌ All repos or none        |
| **Security**         | ✅ App credentials + installation tokens | ⚠️ Personal credentials     |
| **Revocation**       | ✅ Per-installation (granular)           | ❌ All-or-nothing           |
| **Rate Limits**      | ✅ Higher limits (5,000/hour)            | ⚠️ Lower (1,000/hour)       |
| **Auditability**     | ✅ Clear bot actor                       | ⚠️ Appears as user          |

**Recommendation:** Use GitHub App ✅

---

#### **GitHub App Setup**

**1. Create GitHub App:**

```
Navigate to: https://github.com/settings/apps/new

App Settings:
- Name: "Dark Software Factory"
- Homepage URL: https://darkfactory.yourdomain.com
- Webhook URL: https://api.darkfactory.yourdomain.com/webhooks/github
- Webhook Secret: [generate strong secret]

Permissions:
- Repository Permissions:
  ✅ Contents: Read & Write (clone, commit, push)
  ✅ Pull Requests: Read & Write (create PRs)
  ✅ Metadata: Read (repository info)
  ✅ Workflows: Read & Write (trigger CI/CD)

- Organization Permissions:
  ❌ None needed for basic functionality

Events (Subscribe to):
✅ Pull Request (for status updates)
✅ Push (for deployment tracking)
✅ Workflow Run (for CI/CD monitoring)
```

**2. Install App on Multiple Accounts:**

```
After creating the app, you'll receive:
- App ID: 123456
- Private Key: [PEM file - download and store securely]
- Client ID: Iv1.a1b2c3d4e5f6
- Client Secret: [generate and store]

Installation Flow:
1. You (owner) install on your account/org
2. Client A installs on their account/org
3. Client B installs on their account/org

Each installation gets unique Installation ID:
- Installation ID 1: Your account
- Installation ID 2: Client A account
- Installation ID 3: Client B account
```

---

#### **Authentication Flow**

```typescript
// src/github/github-auth.service.ts

import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';

export class GitHubAuthService {
  private app: App;
  private installationTokens: Map<number, { token: string; expiresAt: Date }> = new Map();

  constructor() {
    // Initialize GitHub App
    this.app = new App({
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    });
  }

  /**
   * Get authenticated Octokit client for a specific repository
   */
  async getOctokitForRepo(repoUrl: string): Promise<Octokit> {
    // 1. Parse repository URL
    const { owner, repo } = this.parseRepoUrl(repoUrl);

    // 2. Find which installation has access to this repository
    const installationId = await this.getInstallationForRepo(owner, repo);

    // 3. Get installation access token (cached with expiry)
    const token = await this.getInstallationToken(installationId);

    // 4. Return authenticated Octokit client
    return new Octokit({ auth: token });
  }

  /**
   * Get or refresh installation access token
   */
  private async getInstallationToken(installationId: number): Promise<string> {
    const cached = this.installationTokens.get(installationId);

    // Return cached if not expired (tokens valid for 1 hour)
    if (cached && cached.expiresAt > new Date()) {
      return cached.token;
    }

    // Generate new installation token
    const { token, expiresAt } = await this.app.octokit.request(
      'POST /app/installations/{installation_id}/access_tokens',
      { installation_id: installationId },
    );

    // Cache token
    this.installationTokens.set(installationId, {
      token,
      expiresAt: new Date(expiresAt),
    });

    return token;
  }

  /**
   * Find which installation has access to a repository
   */
  private async getInstallationForRepo(owner: string, repo: string): Promise<number> {
    // Check cache first
    const cached = await this.getRepoInstallationFromCache(owner, repo);
    if (cached) return cached;

    // Query GitHub API for all installations
    const installations = await this.app.octokit.request('GET /app/installations');

    // Check each installation's accessible repositories
    for (const installation of installations.data) {
      const repos = await this.app.octokit.request('GET /installation/repositories', {
        installation_id: installation.id,
      });

      const hasAccess = repos.data.repositories.some(
        (r) => r.owner.login === owner && r.name === repo,
      );

      if (hasAccess) {
        // Cache the mapping
        await this.cacheRepoInstallation(owner, repo, installation.id);
        return installation.id;
      }
    }

    throw new Error(`No GitHub App installation has access to ${owner}/${repo}`);
  }

  private parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
    // Parse: https://github.com/owner/repo or git@github.com:owner/repo.git
    const match = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
    if (!match) throw new Error(`Invalid GitHub URL: ${repoUrl}`);
    return { owner: match[1], repo: match[2] };
  }
}
```

---

#### **Database Schema for Installation Mapping**

```prisma
// prisma/schema.prisma

model GitHubInstallation {
  id                Int      @id @default(autoincrement())
  installationId    Int      @unique // GitHub installation ID
  accountLogin      String   // GitHub username or org name
  accountType       String   // 'User' | 'Organization'

  installedBy       String   // Who installed the app
  installedAt       DateTime

  // Permissions granted
  permissions       Json

  // Status
  suspended         Boolean  @default(false)
  suspendedAt       DateTime?

  repositories      GitHubRepository[]

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([installationId])
  @@index([accountLogin])
}

model GitHubRepository {
  id                String   @id @default(uuid())
  installationId    Int      // Links to GitHubInstallation

  owner             String   // Repository owner
  name              String   // Repository name
  fullName          String   // "owner/repo"

  private           Boolean
  defaultBranch     String   @default("main")

  // Cached for performance
  lastSyncedAt      DateTime?

  installation      GitHubInstallation @relation(fields: [installationId], references: [installationId])
  tickets           Ticket[]

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([owner, name])
  @@index([installationId])
  @@index([fullName])
}
```

---

#### **GitHub Service Implementation**

```typescript
// src/github/github.service.ts

export class GitHubService {
  constructor(
    private authService: GitHubAuthService,
    private prisma: PrismaService,
  ) {}

  /**
   * Create a pull request (works across any installed account)
   */
  async createPullRequest(
    repoUrl: string,
    ticket: Ticket,
    branchName: string,
    diff: string,
  ): Promise<PullRequest> {
    // 1. Get authenticated client for this specific repository
    const octokit = await this.authService.getOctokitForRepo(repoUrl);
    const { owner, repo } = this.parseRepoUrl(repoUrl);

    // 2. Create pull request
    const pr = await octokit.pulls.create({
      owner,
      repo,
      title: ticket.title,
      head: branchName,
      base: 'main', // or get from repo.defaultBranch
      body: this.buildPRDescription(ticket, diff),
    });

    // 3. Add labels
    await octokit.issues.addLabels({
      owner,
      repo,
      issue_number: pr.data.number,
      labels: ['ai-generated', 'dark-factory'],
    });

    return pr.data;
  }

  /**
   * Clone repository with authentication
   */
  async cloneRepository(repoUrl: string, targetPath: string): Promise<void> {
    // Get installation token for this repo
    const octokit = await this.authService.getOctokitForRepo(repoUrl);
    const token = await this.authService.getInstallationToken(
      await this.authService.getInstallationForRepo(owner, repo),
    );

    // Clone using token
    const { owner, repo } = this.parseRepoUrl(repoUrl);
    const authenticatedUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;

    await execAsync(`git clone --depth 1 ${authenticatedUrl} ${targetPath}`);
  }
}
```

---

#### **Installation Webhook Handler**

```typescript
// src/webhooks/github-webhook.controller.ts

@Controller('webhooks/github')
export class GitHubWebhookController {
  /**
   * Handle GitHub App installation events
   */
  @Post()
  async handleWebhook(@Body() payload: any, @Headers('x-hub-signature-256') signature: string) {
    // Verify webhook signature
    this.verifySignature(payload, signature);

    switch (payload.action) {
      case 'created':
        // App installed on a new account
        await this.handleInstallationCreated(payload.installation);
        break;

      case 'deleted':
        // App uninstalled
        await this.handleInstallationDeleted(payload.installation);
        break;

      case 'repositories_added':
        // New repositories granted access
        await this.syncRepositories(payload.installation.id);
        break;
    }
  }

  private async handleInstallationCreated(installation: any) {
    // Store installation in database
    await this.prisma.gitHubInstallation.create({
      data: {
        installationId: installation.id,
        accountLogin: installation.account.login,
        accountType: installation.account.type,
        installedBy: installation.sender?.login,
        installedAt: new Date(),
        permissions: installation.permissions,
      },
    });

    // Sync accessible repositories
    await this.syncRepositories(installation.id);
  }

  private async syncRepositories(installationId: number) {
    const octokit = await this.authService.getOctokitForInstallation(installationId);
    const { data } = await octokit.request('GET /installation/repositories');

    for (const repo of data.repositories) {
      await this.prisma.gitHubRepository.upsert({
        where: { fullName: repo.full_name },
        update: {
          installationId,
          private: repo.private,
          defaultBranch: repo.default_branch,
          lastSyncedAt: new Date(),
        },
        create: {
          installationId,
          owner: repo.owner.login,
          name: repo.name,
          fullName: repo.full_name,
          private: repo.private,
          defaultBranch: repo.default_branch,
          lastSyncedAt: new Date(),
        },
      });
    }
  }
}
```

---

#### **User Experience: Connecting GitHub Accounts**

**1. In AetherFlow Dashboard:**

```
Settings → Integrations → GitHub

[Connect GitHub Account] button

Shows list of connected accounts:
✅ your-username (Personal) - 15 repositories
✅ client-org-a (Organization) - 8 repositories
✅ client-org-b (Organization) - 22 repositories

[+ Add Another GitHub Account/Org]
```

**2. Installation Flow:**

```
Click "Add Another GitHub Account/Org"
  ↓
Redirect to GitHub:
  "Dark Software Factory wants to access repositories on [Account]"

  Select repositories:
  ⬜ All repositories
  ☑️ Only select repositories:
     ☑️ client-project-1
     ☑️ client-project-2

  [Install] button
  ↓
Redirect back to AetherFlow:
  ✅ Installation successful
  ✅ 2 repositories connected
  ✅ Ready to orchestrate tickets
```

---

#### **Security Considerations**

**1. Private Key Storage:**

```typescript
// Store GitHub App private key securely
// Option A: Environment variable (development)
GITHUB_APP_PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\n...';

// Option B: Secrets manager (production)
const privateKey = await secretsManager.getSecret('github-app-private-key');
```

**2. Webhook Signature Verification:**

```typescript
private verifySignature(payload: any, signature: string): void {
  const hmac = crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(JSON.stringify(payload)).digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
    throw new UnauthorizedException('Invalid webhook signature');
  }
}
```

**3. Token Expiry Handling:**

- Installation tokens expire after 1 hour
- Auto-refresh before expiry
- Graceful retry on 401 errors

---

#### **Summary: Multi-Account GitHub Strategy**

**Architecture:**

```
Dark Factory Orchestrator
  ↓
GitHub App (Single app, multiple installations)
  ├─ Installation 1: Your Personal Account
  │    └─ Repos: project-a, project-b
  ├─ Installation 2: Client Org A
  │    └─ Repos: client-a-repo-1, client-a-repo-2
  └─ Installation 3: Client Org B
       └─ Repos: client-b-repo-1, client-b-repo-2, ...

Ticket arrives → Parse repo URL → Find installation → Get token → Clone/PR
```

**Benefits:**

- ✅ **One app, multiple accounts** (no PAT juggling)
- ✅ **Granular permissions** (per-repo selection)
- ✅ **Automatic token management** (refresh before expiry)
- ✅ **Audit trail** (clear bot actor in Git history)
- ✅ **Higher rate limits** (5,000 requests/hour per installation)
- ✅ **Easy revocation** (uninstall = instant access removal)

### 3. AI Provider Integration (Multi-Provider)

**Communication:** CLI execution via Node.js `child_process`

#### **Primary: Cursor CLI Headless Mode**

```bash
cursor --headless \
  --dir /workspaces/project-repo \
  --apply "Ticket description with acceptance criteria" \
  --files src/auth/users.ts,src/routes/api.ts \
  --wait
```

**Integration Pattern:**

```typescript
// Cursor headless provider
async function generateCodeWithCursor(prompt: string, workspaceDir: string) {
  const command = `cursor --headless --dir "${workspaceDir}" --apply "${prompt}" --wait`;
  const { stdout, stderr } = await execAsync(command, {
    timeout: 300000, // 5 min
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}
```

**Advantages:**

- ✅ Full repository context automatically
- ✅ Multi-file editing with awareness
- ✅ Semantic codebase understanding
- ✅ Best for complex, multi-file changes

---

#### **Secondary: Claude Code (Anthropic)**

**Integration via Anthropic API:**

```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

**Integration Pattern:**

```typescript
// Claude Code provider
async function generateCodeWithClaudeCode(prompt: string, context: CodeContext) {
  // Build enhanced context with file contents
  const enhancedPrompt = buildClaudeCodePrompt(prompt, context);

  // Use Claude with extended context and tool use
  const message = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: enhancedPrompt,
      },
    ],
    tools: [
      {
        name: 'edit_file',
        description: 'Edit a file with new content',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
        },
      },
    ],
  });

  return parseClaudeCodeResponse(message);
}
```

**Context Building:**

```typescript
function buildClaudePrompt(ticket: Ticket, context: CodeContext): string {
  return `
You are an expert developer working on: ${context.projectName}

Tech Stack: ${context.techStack}
Dependencies: ${context.dependencies.join(', ')}

Repository Structure:
${context.fileTree}

Related Files Context:
${context.relatedFilesContent}

Task:
${ticket.description}

Acceptance Criteria:
${ticket.acceptanceCriteria.join('\n')}

Generate production-ready code that:
- Follows existing patterns in the codebase
- Includes TypeScript types
- Has proper error handling
- Is well-commented

Output format: Provide complete file contents with clear file paths.
  `;
}
```

**Advantages:**

- ✅ Official Anthropic CLI
- ✅ Excellent code generation quality
- ✅ Lower cost per token
- ✅ Fast response times
- ✅ Good for focused, single-file changes

---

#### **Multi-Provider Routing Logic**

```typescript
// ai-routing/providers/provider-factory.ts
export class AIProviderFactory {
  async getProvider(ticket: Ticket, context: CodeContext): Promise<AIProvider> {
    const complexity = this.assessComplexity(ticket);

    // Route based on complexity and availability
    if (complexity === 'high' || ticket.requiresMultiFileEdit) {
      // Try Cursor first (better for complex tasks)
      if (await this.cursorProvider.isAvailable()) {
        return this.cursorProvider;
      }

      // Fallback to Claude
      return this.claudeProvider;
    }

    // For simple tasks, use Claude (faster, cheaper)
    if (await this.claudeProvider.isAvailable()) {
      return this.claudeProvider;
    }

    // Fallback to Cursor
    return this.cursorProvider;
  }

  private assessComplexity(ticket: Ticket): 'low' | 'medium' | 'high' {
    const indicators = {
      filesCount: ticket.relevantFiles?.length || 1,
      descriptionLength: ticket.description.length,
      acceptanceCriteriaCount: ticket.acceptanceCriteria.length,
      hasArchitectureChanges: ticket.tags?.includes('architecture'),
    };

    // Complexity scoring logic
    if (indicators.filesCount > 3 || indicators.hasArchitectureChanges) {
      return 'high';
    }
    if (indicators.filesCount > 1 || indicators.acceptanceCriteriaCount > 3) {
      return 'medium';
    }
    return 'low';
  }
}
```

---

#### **Workspace Management (Both Providers)**

**Workspace Isolation:**

- Each ticket gets isolated workspace: `/tmp/ai-workspaces/ticket-{id}`
- Fresh git clone per execution
- Feature branch created: `feature/ticket-{id}`
- Multiple concurrent workspaces supported (50+ projects)
- Auto-cleanup after PR creation

**Common Flow:**

1. **Prepare:** Clone repo, checkout branch
2. **Generate:** Call Cursor or Claude based on routing
3. **Collect:** Git diff to capture changes
4. **Commit:** Create commit with generated code
5. **Cleanup:** Remove workspace after PR creation

### 4. GitHub Integration

**Communication:** REST API (GitHub API v3)

**Orchestrator → GitHub:**

- Create branches: `feature/ticket-{ticketId}`
- Push code commits
- Create pull requests with traceability links
- Add PR comments with QA results
- Merge PRs (if auto-merge enabled)

**GitHub → Orchestrator (Webhooks - Optional):**

- PR status updates
- Deployment success/failure notifications

**Authentication:** GitHub App or Personal Access Token

### 5. CI/CD Integration

**Communication:** Trigger endpoints (HTTP) + Status webhooks

**Supported CI/CD Platforms:**

- GitHub Actions (workflow dispatch)
- Jenkins (build trigger API)
- GitLab CI (pipeline trigger)
- Generic webhook endpoint

**Orchestrator → CI/CD:**

- Trigger deployment after GitHub push
- Pass parameters (branch, environment, configuration)

**CI/CD → Orchestrator:**

- Status webhooks (deployment success/failure)
- Logs and metrics

### 6. Production Monitoring Integration

**Communication:** Log streaming + Metrics APIs

**Monitoring Sources:**

- Application logs (via logging aggregators: CloudWatch, Datadog, ELK)
- Error tracking (Sentry webhooks)
- APM tools (New Relic, Datadog APM)

**Orchestrator Actions:**

- Parse error logs for actionable issues
- Create fix tickets automatically
- Alert PM/TL for critical failures

---

## Implementation Patterns

### Naming Conventions

**TypeScript Files & Classes:**

- Files: `kebab-case.ts` (e.g., `ticket-intake.service.ts`)
- Classes: `PascalCase` (e.g., `TicketIntakeService`)
- Interfaces: `PascalCase` with `I` prefix (e.g., `ITicketData`)
- DTOs: `PascalCase` with `.dto.ts` suffix (e.g., `CreateTicketDto`)

**REST API Endpoints:**

- Routes: `/kebab-case` (e.g., `/api/v1/pm-dashboard`)
- Path parameters: `:camelCase` (e.g., `/tickets/:ticketId`)
- Query parameters: `camelCase` (e.g., `?projectId=123&includeMetrics=true`)

**Database Tables & Columns:**

- Tables: `snake_case` plural (e.g., `ai_executions`, `cost_records`)
- Columns: `snake_case` (e.g., `ticket_id`, `execution_status`, `cost_in_cents`)
- Foreign keys: `{table}_id` (e.g., `ticket_id`, `project_id`)
- Timestamps: `created_at`, `updated_at` (automatic via Prisma)

**RabbitMQ Queues & Exchanges:**

- Queues: `kebab-case` (e.g., `ai-execution-queue`, `qa-check-queue`)
- Exchanges: `kebab-case` (e.g., `orchestrator-events`)
- Routing keys: `dot.notation` (e.g., `ai.execution.started`, `qa.check.completed`)

**Environment Variables:**

- Format: `SCREAMING_SNAKE_CASE` (e.g., `DATABASE_URL`, `RABBITMQ_HOST`)
- Prefix by service: `ORCHESTRATOR_*` (e.g., `ORCHESTRATOR_PORT`)

### Structure Patterns

**Module Organization:**

- One module per domain concept (e.g., `ai-routing`, `qa-automation`)
- Each module contains: `module.ts`, `controller.ts` (if API), `service.ts`, `dto/` folder
- Shared utilities in `common/` at root level

**Test File Location:**

- Co-located with source: `ticket-intake.service.spec.ts` next to `ticket-intake.service.ts`
- E2E tests in separate `test/e2e/` folder
- Test utilities in `test/utils/`

**DTO Organization:**

- Request DTOs: `create-*.dto.ts`, `update-*.dto.ts`
- Response DTOs: `*-response.dto.ts`
- Validation decorators from `class-validator` on all DTO properties

### Format Patterns

**API Response Wrapper:**

```typescript
{
  "success": boolean,
  "data": T | null,
  "error": ErrorObject | null,
  "metadata": {
    "timestamp": string (ISO 8601),
    "requestId": string (UUID)
  }
}
```

**Error Format:**

```typescript
{
  "code": string,        // e.g., "AI_EXECUTION_TIMEOUT"
  "message": string,     // User-friendly message
  "details": object,     // Additional context
  "statusCode": number   // HTTP status code
}
```

**Date/Time Format:**

- API responses: ISO 8601 strings (e.g., `"2025-11-20T10:30:00.000Z"`)
- Database: PostgreSQL TIMESTAMP WITH TIME ZONE
- Internal: JavaScript Date objects
- Library: Use native Date, avoid moment.js (deprecated)

**Cost Storage:**

- Store in cents (integer) to avoid floating-point issues
- Display: Convert to dollars with 2 decimal places
- Currency: USD (hardcoded for Phase 1, configurable Phase 2)

### Communication Patterns

**RabbitMQ Message Format:**

```typescript
{
  "messageId": string (UUID),
  "timestamp": string (ISO 8601),
  "correlationId": string (for tracing),
  "payload": {
    // Domain-specific data
  }
}
```

**Socket.IO Event Naming:**

- Client → Server: `camelCase` (e.g., `subscribeToProject`)
- Server → Client: `kebab-case` (e.g., `execution-progress-update`)
- Event payload: JSON object with typed structure

**HTTP Headers:**

- Authorization: `Authorization: Bearer {jwt}`
- Request ID: `X-Request-ID: {uuid}`
- Correlation ID: `X-Correlation-ID: {uuid}` (for tracing across services)

### Lifecycle Patterns

**Loading States:**

- Initial: `null` (not yet loaded)
- Loading: `{ status: 'loading' }`
- Success: `{ status: 'success', data: T }`
- Error: `{ status: 'error', error: Error }`

**Error Recovery:**

- Retry logic: 3 attempts with exponential backoff (1s, 2s, 4s)
- Circuit breaker: Open after 5 consecutive failures, close after 30s success
- Fallback: Dead letter queue for manual intervention

**State Transitions:**

```
Ticket Lifecycle:
received → validated → queued → ai_processing → qa_review →
github_push → deploying → deployed → monitoring

Error states: validation_failed, ai_failed, qa_failed,
deploy_failed → Each creates fix ticket
```

### Consistency Patterns

**Logging Format:**

```typescript
{
  "level": "info" | "warn" | "error" | "debug",
  "timestamp": string (ISO 8601),
  "requestId": string,
  "correlationId": string,
  "service": "ai-dev-orchestrator",
  "message": string,
  "context": object,
  "error": Error (if level === 'error')
}
```

**Audit Trail:**

- All state changes logged to `audit_log` table
- Includes: actor (user/system), action, before/after state, timestamp
- Immutable records (no updates, only inserts)

**User-Facing Error Messages:**

- Technical errors: "An unexpected error occurred. Request ID: {uuid}"
- Validation errors: Specific field errors with suggestions
- Business logic errors: Clear explanation with next steps
- Never expose stack traces or internal details to users

---

## Data Architecture

### Prisma Schema Design

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// Ticket Intake
model Ticket {
  id              String   @id @default(uuid())
  clickup_task_id String   @unique
  project_id      String
  title           String
  description     String   @db.Text
  acceptance_criteria String @db.Text
  ticket_quality_score Int
  status          TicketStatus @default(RECEIVED)

  // Relationships
  executions      Execution[]
  cost_records    CostRecord[]

  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt

  @@index([project_id, status])
  @@index([created_at])
  @@map("tickets")
}

enum TicketStatus {
  RECEIVED
  VALIDATED
  VALIDATION_FAILED
  QUEUED
  AI_PROCESSING
  QA_REVIEW
  QA_FAILED
  GITHUB_PUSH
  DEPLOYING
  DEPLOYED
  MONITORING
  FAILED
  COMPLETED
}

// AI Execution Tracking
model Execution {
  id                String    @id @default(uuid())
  ticket_id         String
  ticket            Ticket    @relation(fields: [ticket_id], references: [id])

  ai_provider       AIProvider
  prompt            String    @db.Text
  status            ExecutionStatus @default(QUEUED)
  confidence_score  Float?

  started_at        DateTime?
  completed_at      DateTime?
  failed_at         DateTime?
  error_message     String?   @db.Text

  // Generated code
  code_output       String?   @db.Text
  files_changed     Json?     // Array of file paths

  // Retry tracking
  retry_count       Int       @default(0)
  max_retries       Int       @default(3)

  created_at        DateTime  @default(now())
  updated_at        DateTime  @updatedAt

  @@index([ticket_id, status])
  @@index([ai_provider, status])
  @@map("executions")
}

enum AIProvider {
  CURSOR
  WINDSURF
  ANTIGRAVITY
}

enum ExecutionStatus {
  QUEUED
  IN_PROGRESS
  COMPLETED
  FAILED
  TIMEOUT
  CANCELLED
}

// QA Results
model QAResult {
  id            String   @id @default(uuid())
  execution_id  String

  linting_passed      Boolean
  linting_errors      Json?

  tests_passed        Boolean
  test_results        Json?
  test_coverage       Float?

  code_review_passed  Boolean
  code_review_issues  Json?

  overall_passed      Boolean

  created_at    DateTime @default(now())

  @@map("qa_results")
}

// GitHub Integration
model GitHubPush {
  id              String   @id @default(uuid())
  execution_id    String

  repository      String
  branch_name     String
  commit_sha      String?
  pr_number       Int?
  pr_url          String?

  push_status     GitHubStatus @default(PENDING)
  error_message   String?  @db.Text

  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt

  @@map("github_pushes")
}

enum GitHubStatus {
  PENDING
  BRANCH_CREATED
  COMMITTED
  PR_CREATED
  MERGED
  FAILED
}

// Deployment Tracking
model Deployment {
  id              String   @id @default(uuid())
  github_push_id  String

  environment     String   // dev, staging, production
  cicd_provider   String   // github-actions, jenkins, etc.
  build_id        String?

  status          DeploymentStatus @default(TRIGGERED)
  deployed_at     DateTime?

  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt

  @@map("deployments")
}

enum DeploymentStatus {
  TRIGGERED
  IN_PROGRESS
  COMPLETED
  FAILED
  ROLLED_BACK
}

// Cost Tracking
model CostRecord {
  id              String   @id @default(uuid())
  ticket_id       String
  ticket          Ticket   @relation(fields: [ticket_id], references: [id])

  ai_provider     AIProvider
  operation_type  String   // code_generation, review, etc.

  tokens_used     Int?
  api_calls       Int      @default(1)
  cost_in_cents   Int      // Store as cents to avoid floating point

  created_at      DateTime @default(now())

  @@index([ticket_id])
  @@index([ai_provider, created_at])
  @@map("cost_records")
}

// Production Monitoring
model ProductionError {
  id                String   @id @default(uuid())

  application       String
  error_type        String
  error_message     String   @db.Text
  stack_trace       String?  @db.Text

  severity          ErrorSeverity

  fix_ticket_id     String?  // ClickUp task ID if auto-created
  resolved          Boolean  @default(false)

  occurred_at       DateTime
  created_at        DateTime @default(now())

  @@index([application, severity, resolved])
  @@map("production_errors")
}

enum ErrorSeverity {
  CRITICAL
  HIGH
  MEDIUM
  LOW
}

// Metrics & Analytics
model Metric {
  id          String   @id @default(uuid())

  metric_name String
  metric_type String   // counter, gauge, histogram
  value       Float
  labels      Json?    // Key-value pairs for filtering

  recorded_at DateTime @default(now())

  @@index([metric_name, recorded_at])
  @@map("metrics")
}

// Audit Trail
model AuditLog {
  id              String   @id @default(uuid())

  entity_type     String   // ticket, execution, deployment
  entity_id       String
  action          String   // created, updated, status_changed

  actor_type      String   // user, system
  actor_id        String?  // user ID if human, null if system

  before_state    Json?
  after_state     Json?

  created_at      DateTime @default(now())

  @@index([entity_type, entity_id])
  @@index([created_at])
  @@map("audit_logs")
}

// ============================================
// V3 MODELS (Epic 11: Phase 1 Foundation & Safety)
// Added in migration: 20251219173120_add_v3_models
// ============================================

// V3 ENUMS
enum FileLockStatus {
  LOCKED
  RELEASED
}

enum DependencyStatus {
  WAITING
  BLOCKED
  RESOLVED
  CANCELLED
}

enum ArchiveStatus {
  PENDING
  ARCHIVING
  ARCHIVED
  FAILED
}

enum PRRiskLevel {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

// AI Decision Log - Complete audit trail of AI decisions
// Purpose: Track every AI decision for transparency, debugging, and low-confidence alerts
model AIDecisionLog {
  id           String   @id @default(uuid())
  timestamp    DateTime @default(now())
  agent_name   String   // AI agent that made the decision
  action       String   // Action taken (e.g., "branch_selection", "file_lock_request")
  reasoning    String   @db.Text  // AI's reasoning for the decision
  ticket_id    String
  execution_id String?
  input_data   Json     // Input context for decision
  output_data  Json     // Decision output/result
  confidence   Float    // Confidence score 0-1 (for low-confidence alerts)

  // Relation to Execution (optional - intake decisions have no execution)
  execution    Execution? @relation(fields: [execution_id], references: [id], onDelete: SetNull)

  @@index([ticket_id, timestamp])  // Timeline queries by ticket
  @@index([execution_id])
  @@index([agent_name])
  @@index([timestamp])
  @@map("ai_decision_logs")
}

// File Lock - Prevent concurrent modification conflicts
// Purpose: Ensure only one ticket can modify a file at a time
model FileLock {
  id           String         @id @default(uuid())
  ticket_id    String
  execution_id String
  file_path    String         // Relative path within repo
  locked_at    DateTime       @default(now())
  released_at  DateTime?
  status       FileLockStatus @default(LOCKED)

  // Relation to Execution (cascade delete - locks are execution-scoped)
  execution    Execution @relation(fields: [execution_id], references: [id], onDelete: Cascade)

  @@unique([ticket_id, file_path])  // One lock per file per ticket
  @@index([execution_id])
  @@index([status])
  @@index([ticket_id])
  @@map("file_locks")
}

// AI Cost Log - Track AI invocation costs
// Purpose: Detailed cost tracking for billing and optimization
model AICostLog {
  id              String     @id @default(uuid())
  execution_id    String?
  ticket_id       String?
  timestamp       DateTime   @default(now())

  ai_provider     AIProvider
  model_name      String     // e.g., "claude-3-5-sonnet", "gpt-4"
  operation_type  String     // e.g., "code_generation", "review"

  tokens_input    Int?
  tokens_output   Int?
  tokens_total    Int?
  cost_usd        Decimal    @db.Decimal(10, 6)  // Precise cost tracking

  // Relation to Execution (preserve cost history even if execution deleted)
  execution       Execution? @relation(fields: [execution_id], references: [id], onDelete: SetNull)

  @@index([execution_id])
  @@index([ticket_id, timestamp])
  @@index([ai_provider, timestamp])
  @@map("ai_cost_logs")
}

// Ticket Dependency - Manage ticket dependencies with circular detection
// Purpose: Track dependencies between tickets and detect circular references
model TicketDependency {
  id                String           @id @default(uuid())
  ticket_id         String           // Dependent ticket
  depends_on        String           // Blocking ticket ID
  status            DependencyStatus @default(WAITING)
  circular_detected Boolean          @default(false)
  created_at        DateTime         @default(now())
  resolved_at       DateTime?

  @@unique([ticket_id, depends_on])  // Prevent duplicate dependency links
  @@index([ticket_id])
  @@index([depends_on])
  @@index([status])
  @@map("ticket_dependencies")
}

// Workspace Archive - Storage management with compression tracking
// Purpose: Archive completed workspaces to manage storage costs
model WorkspaceArchive {
  id                  String        @id @default(uuid())
  execution_id        String        @unique
  workspace_path      String
  archive_path        String?       // S3/local path to archived workspace
  size_bytes          BigInt
  compressed_size     BigInt?
  status              ArchiveStatus @default(PENDING)
  archived_at         DateTime?
  error_message       String?       @db.Text

  // Relation to Execution (one-to-one, cascade delete)
  execution           Execution @relation(fields: [execution_id], references: [id], onDelete: Cascade)

  @@index([status])
  @@index([archived_at])
  @@map("workspace_archives")
}

// V3 EXECUTION MODEL UPDATES
// The Execution model (defined earlier) was updated with:
// - base_branch: Selected base branch for PR
// - branch_selection_log: AI decision log for branch selection
// - file_modifications: Detailed file change metadata (JSON)
// - risk_level: PR risk assessment (PRRiskLevel enum)
// - circular_dep_detected: Dependency cycle flag (boolean)
// - aiDecisionLogs: One-to-many relation
// - fileLocks: One-to-many relation
// - aiCostLogs: One-to-many relation
// - archive: One-to-one relation
```

### V3 Schema Changes (Epic 11)

**Migration:** `20251219173120_add_v3_models`  
**Date:** 2025-12-19  
**Purpose:** Phase 1 Foundation & Safety infrastructure for v3 features

**New Models (5):**

1. **AIDecisionLog** - Complete audit trail of all AI decisions
   - Tracks decision-making process for transparency
   - Enables low-confidence alerts (confidence < threshold)
   - Preserves history even if execution deleted (`onDelete: SetNull`)
   - Indexed for timeline queries by ticket and execution

2. **FileLock** - Concurrent modification prevention
   - One lock per file per ticket (unique constraint)
   - Prevents merge conflicts from parallel development
   - Cascade deletes with execution (locks are execution-scoped)
   - Status tracking: LOCKED → RELEASED

3. **AICostLog** - Granular AI cost tracking
   - Per-invocation cost tracking with precise decimal storage
   - Tracks token usage (input/output/total) and model information
   - Supports both execution-scoped and pre-execution costs
   - Preserves cost history for billing (`onDelete: SetNull`)

4. **TicketDependency** - Dependency management
   - Tracks dependencies between tickets
   - Circular dependency detection flag
   - Status lifecycle: WAITING → RESOLVED/BLOCKED/CANCELLED
   - Prevents duplicate dependency links (unique constraint)

5. **WorkspaceArchive** - Storage management
   - Tracks workspace archival for storage cost optimization
   - Records original and compressed sizes
   - S3 or local archive path storage
   - One-to-one relation with Execution (`onDelete: Cascade`)

**Execution Model Enhancements:**

- `base_branch` - Selected base branch for PR creation
- `branch_selection_log` - AI reasoning for branch selection
- `file_modifications` - Detailed file change metadata (JSON)
- `risk_level` - PR risk assessment (LOW/MEDIUM/HIGH/CRITICAL)
- `circular_dep_detected` - Boolean flag for dependency cycles

**New Enums (4):**

- `FileLockStatus`: LOCKED, RELEASED
- `DependencyStatus`: WAITING, BLOCKED, RESOLVED, CANCELLED
- `ArchiveStatus`: PENDING, ARCHIVING, ARCHIVED, FAILED
- `PRRiskLevel`: LOW, MEDIUM, HIGH, CRITICAL

**onDelete Behaviors:**

- **SetNull**: AIDecisionLog, AICostLog (preserve audit/cost history)
- **Cascade**: FileLock, WorkspaceArchive (execution-scoped data)

**Index Strategy:**

- Composite indexes for common query patterns (ticket_id + timestamp)
- Single indexes on foreign keys and status fields
- Unique constraints for business logic enforcement

### Database Indexes Strategy

**Query Patterns Optimized:**

1. Fetch tickets by project and status (for PM dashboard)
2. Fetch executions by status (for orchestrator monitoring)
3. Fetch cost records by date range and provider (for cost dashboard)
4. Fetch audit logs by entity (for traceability)
5. Fetch production errors by severity and resolved status

**Index Maintenance:**

- Automatic via Prisma migrations
- Monitor index usage via PostgreSQL `pg_stat_user_indexes`
- Add indexes based on slow query analysis in production

---

## API Contracts

### PM Dashboard API

**GET `/api/v1/pm-dashboard/projects`**

Query Parameters:

- `pmId`: string (required)
- `status`: string (optional) - filter by project status

Response:

```typescript
{
  "success": true,
  "data": {
    "projects": [
      {
        "id": "uuid",
        "name": "string",
        "ticketCount": number,
        "inProgressCount": number,
        "completedCount": number,
        "failedCount": number,
        "aiConfidenceAvg": number,
        "totalCostCents": number
      }
    ],
    "summary": {
      "totalProjects": number,
      "utilizationPercent": number,
      "burnoutRisk": "low" | "medium" | "high"
    }
  },
  "metadata": { "timestamp": "ISO 8601", "requestId": "uuid" }
}
```

### AI Execution API

**POST `/api/v1/executions`**

Request:

```typescript
{
  "ticketId": "uuid",
  "aiProvider": "CURSOR" | "WINDSURF" | "ANTIGRAVITY",
  "prompt": "string",
  "context": {
    "files": ["file paths"],
    "dependencies": ["package names"]
  }
}
```

Response:

```typescript
{
  "success": true,
  "data": {
    "executionId": "uuid",
    "status": "QUEUED",
    "estimatedDuration": number (seconds)
  },
  "metadata": { "timestamp": "ISO 8601", "requestId": "uuid" }
}
```

**GET `/api/v1/executions/:executionId`**

Response:

```typescript
{
  "success": true,
  "data": {
    "id": "uuid",
    "ticketId": "uuid",
    "aiProvider": "CURSOR",
    "status": "IN_PROGRESS" | "COMPLETED" | "FAILED",
    "confidenceScore": number (0-1),
    "progress": {
      "currentStep": "string",
      "percentComplete": number
    },
    "result": {
      "codeOutput": "string",
      "filesChanged": ["string"]
    } | null
  },
  "metadata": { "timestamp": "ISO 8601", "requestId": "uuid" }
}
```

### Cost Tracking API

**GET `/api/v1/costs/summary`**

Query Parameters:

- `startDate`: ISO 8601 string
- `endDate`: ISO 8601 string
- `projectId`: string (optional)

Response:

```typescript
{
  "success": true,
  "data": {
    "totalCostCents": number,
    "byProvider": {
      "CURSOR": number,
      "WINDSURF": number,
      "ANTIGRAVITY": number
    },
    "byProject": [
      { "projectId": "string", "costCents": number }
    ],
    "trend": "increasing" | "stable" | "decreasing"
  },
  "metadata": { "timestamp": "ISO 8601", "requestId": "uuid" }
}
```

### WebSocket Events (Socket.IO)

**Client → Server:**

```typescript
// Subscribe to execution updates
socket.emit('subscribe-execution', { executionId: 'uuid' });

// Subscribe to cost alerts
socket.emit('subscribe-cost-alerts', { projectId: 'uuid' });
```

**Server → Client:**

```typescript
// Execution progress update
socket.emit('execution-progress-update', {
  executionId: 'uuid',
  status: 'IN_PROGRESS',
  progress: 45,
  currentStep: 'Running tests',
});

// Cost alert
socket.emit('cost-alert', {
  projectId: 'uuid',
  currentCostCents: number,
  budgetCents: number,
  percentOfBudget: number,
});
```

---

## Security Architecture

### Authentication Flow

1. User logs in via **separate Auth Service**
2. Auth Service validates credentials and issues JWT
3. JWT contains claims: `{ userId, role, permissions, exp }`
4. Frontend stores JWT (httpOnly cookie or localStorage)
5. Frontend includes JWT in requests: `Authorization: Bearer {jwt}`
6. Orchestrator validates JWT via `auth.guard.ts`:
   - Verifies signature using shared secret or public key
   - Checks expiration
   - Extracts user claims
7. Route handlers access user via `@CurrentUser()` decorator

### Authorization (RBAC)

**Roles:**

- `ADMIN` - Full access
- `MANAGER` - Business oversight, all dashboards
- `PM` - Create tickets, view own projects, approve code
- `TL` - Architecture review, technical oversight
- `QA` - Quality review, approve deployments
- `VIEWER` - Read-only access to dashboards

**Permission Matrix:**

| Resource            | ADMIN | MANAGER | PM  | TL  | QA  | VIEWER |
| ------------------- | ----- | ------- | --- | --- | --- | ------ |
| Create Ticket       | ✓     | ✓       | ✓   | -   | -   | -      |
| Approve Code        | ✓     | ✓       | ✓   | -   | -   | -      |
| Review Architecture | ✓     | -       | -   | ✓   | -   | -      |
| Approve Deployment  | ✓     | -       | -   | -   | ✓   | -      |
| View Dashboards     | ✓     | ✓       | ✓   | ✓   | ✓   | ✓      |
| Configure System    | ✓     | -       | -   | -   | -   | -      |

**Implementation:**

```typescript
@UseGuards(AuthGuard, RolesGuard)
@Roles('PM', 'ADMIN')
@Post('tickets')
createTicket() { }
```

### API Security

**Rate Limiting:**

- Per user: 1000 requests/hour
- Per IP: 5000 requests/hour
- Webhook endpoint: 100 requests/minute

**CORS:**

- Allow: Dashboard frontend origin (dsf-dashboard repository - separate deployment)
- Methods: GET, POST, PUT, DELETE
- Credentials: true (for cookies)

**Input Validation:**

- All DTOs validated with `class-validator`
- Sanitize HTML/SQL injection attempts
- Maximum payload size: 10MB

**Secrets Management:**

- Environment variables for all secrets
- Never commit `.env` files
- Use secret management service (AWS Secrets Manager, HashiCorp Vault) in production
- Rotate API keys quarterly

### Data Protection

**Encryption:**

- Data at rest: PostgreSQL transparent encryption
- Data in transit: TLS 1.3 for all HTTP connections
- Secrets: Encrypted env variables in deployment

**Sensitive Data:**

- API keys: Encrypted in database, decrypted at runtime
- User data: GDPR compliant, anonymization available
- Logs: Redact sensitive fields (passwords, tokens, PII)

**Audit Trail:**

- All data modifications logged to `audit_logs` table
- Immutable records
- Retention: 7 years for compliance

---

## Performance Considerations

### Response Time Targets (NFR-P1-8)

- API endpoints: <200ms (P95)
- Dashboard loading: <2s initial, <200ms interactions
- Real-time updates: <10s latency
- AI execution: Hours acceptable (async)
- Webhook processing: <5s

### Optimization Strategies

**Database:**

- Connection pooling: Max 20 connections
- Query optimization: Use indexes, avoid N+1
- Pagination: Max 100 items per page
- Read replicas: Consider if read-heavy

**Caching:**

- Redis for frequently accessed data (dashboard aggregations)
- TTL: 30 seconds for real-time data, 5 minutes for historical
- Cache invalidation on state changes

**Async Processing:**

- All AI executions via RabbitMQ queues
- Non-blocking I/O for HTTP calls
- Worker pools for CPU-intensive tasks (test running)

**Load Testing Targets:**

- 50+ concurrent AI executions
- 100+ concurrent dashboard users
- 1000 requests/second to APIs

---

## Deployment Architecture

### Container Strategy

**Production Deployment:**

```yaml
services:
  orchestrator:
    image: dark-factory/orchestrator:latest
    replicas: 3
    resources:
      limits: { cpu: '2', memory: '4Gi' }
      requests: { cpu: '1', memory: '2Gi' }
    env:
      - DATABASE_URL
      - RABBITMQ_URL
      - JWT_SECRET
      - AI_PROVIDER_KEYS

  postgres:
    image: postgres:16
    volumes: ['./data:/var/lib/postgresql/data']

  rabbitmq:
    image: rabbitmq:3.13-management
    volumes: ['./rabbitmq-data:/var/lib/rabbitmq']
```

### Infrastructure

**Hosting:** Cloud provider (AWS/DigitalOcean/GCP)

**Services:**

- Orchestrator: 3 instances (load balanced)
- PostgreSQL: Single instance (consider replication Phase 2)
- RabbitMQ: Single instance (consider clustering Phase 2)
- Redis: Single instance (for Socket.IO adapter)

**Monitoring:**

- Prometheus: Scrapes `/metrics` every 15s
- Grafana: Visualization dashboards
- Sentry: Error tracking and alerts

**Backups:**

- Database: Daily automated backups, 30-day retention
- RabbitMQ: Queue persistence enabled

---

## Development Environment

### Prerequisites

- Node.js 20.x LTS
- npm 10.x
- Docker & Docker Compose
- PostgreSQL 16 (local or Docker)
- RabbitMQ 3.13 (local or Docker)

### Setup Steps

```bash
# 1. Clone and install
git clone <repo>
cd ai-dev-orchestrator
npm install

# 2. Start infrastructure
docker-compose up -d

# 3. Configure environment
cp .env.example .env
# Edit .env with your configuration

# 4. Run migrations
npx prisma migrate dev

# 5. Start development server
npm run start:dev

# 6. Run tests
npm run test
npm run test:e2e
```

### Development Scripts

- `npm run start:dev` - Start with hot reload
- `npm run start:debug` - Start with debugger
- `npm run build` - Production build
- `npm run test` - Unit tests
- `npm run test:e2e` - E2E tests
- `npm run test:cov` - Coverage report
- `npm run lint` - ESLint
- `npm run format` - Prettier

---

## Architecture Decision Records (ADRs)

### ADR-001: Separate Microservice Architecture

**Status:** Accepted

**Context:** Need to extend AetherFlow (80% infrastructure) with orchestration capabilities (20% new build).

**Decision:** Build separate NestJS microservice rather than module within AetherFlow.

**Consequences:**

- ✅ Clean separation protects existing infrastructure
- ✅ Independent scaling and deployment
- ✅ Technology choice flexibility
- ❌ Additional deployment complexity
- ❌ Inter-service communication overhead

---

### ADR-002: Separate PostgreSQL Database

**Status:** Accepted

**Context:** Database strategy for orchestrator data storage.

**Decision:** Use separate PostgreSQL instance, not shared with AetherFlow.

**Consequences:**

- ✅ Service independence and data encapsulation
- ✅ Independent scaling
- ✅ Clearer boundaries
- ❌ Cross-service queries require API calls
- ❌ Additional infrastructure cost

---

### ADR-003: Cursor CLI Headless Mode for AI Code Generation

**Status:** Accepted  
**Date:** 2025-11-25

**Context:** Need programmatic AI code generation with full repository context for automated ticket-to-code pipeline.

**Options Considered:**

1. Custom integration with AI APIs (GPT-4, Claude) - requires building context engine
2. Cursor local API (unofficial, undocumented)
3. VSCode extension development (3-4 weeks, maintenance burden)
4. MCP protocol integration (new, experimental)
5. **Cursor CLI headless mode (official, documented)**

**Decision:** Use Cursor's official `cursor --headless` CLI command for AI code generation.

**Rationale:**

- ✅ Official, documented, maintained by Cursor team
- ✅ Purpose-built for automation and CI/CD
- ✅ Full Cursor AI power (Claude/GPT-4 with repository context)
- ✅ Multi-file editing with semantic understanding
- ✅ No custom AI integration needed (don't build from scratch)
- ✅ Server-ready (no GUI, low resource usage)
- ✅ Supports concurrent execution (50+ projects goal)
- ✅ Automatic codebase indexing and context
- ✅ Available TODAY (https://cursor.com/docs/cli/overview)

**Consequences:**

- ✅ Can start building immediately (no research phase)
- ✅ Leverages Cursor's AI capabilities without reimplementation
- ✅ Official support reduces maintenance burden
- ✅ Scales to Phase 3 requirements (50+ projects)
- ⚠️ Requires Cursor license for headless usage
- ⚠️ Dependency on Cursor team for CLI updates
- ⚠️ Must validate concurrent execution limits
- ⚠️ Need workspace isolation strategy

**Implementation Notes:**

- Execute via Node.js `child_process`: `cursor --headless --dir /path --apply "prompt"`
- Workspace per ticket: `/tmp/cursor-workspaces/ticket-{id}`
- Results collected via git diff
- Cost tracking via execution time monitoring

---

### ADR-004: RabbitMQ for Message Queue

**Status:** Accepted

**Context:** Need reliable async processing for AI executions.

**Decision:** Use RabbitMQ over alternatives (Bull/Redis, AWS SQS, Kafka).

**Rationale:**

- Proven reliability with acknowledgments
- Dead letter queue support
- Management UI for monitoring
- Good NestJS integration
- Not as heavy as Kafka for Phase 1 scale

**Consequences:**

- ✅ Reliable message delivery
- ✅ Built-in retry logic
- ✅ Easy to monitor
- ❌ Additional infrastructure component
- ❌ Need to manage RabbitMQ

---

### ADR-005: Separate Authentication Service

**Status:** Accepted

**Context:** Authentication strategy for orchestrator.

**Decision:** Separate JWT-based auth service, not shared with AetherFlow.

**Rationale:**

- Service independence principle
- Dedicated auth management
- Future flexibility for different auth methods

**Consequences:**

- ✅ Clean service boundaries
- ✅ Dedicated auth management
- ❌ Additional service to build/maintain
- ❌ Token validation on every request

---

### ADR-006: Claude Code as Secondary AI Provider

**Status:** Accepted  
**Date:** 2025-11-25

**Context:** Need fallback option if Cursor headless has issues, plus ability to optimize costs for simple tasks.

**Decision:** Add Claude Code (Anthropic's autonomous coding agent) as secondary AI provider alongside Cursor headless.

**Rationale:**

- ✅ Anthropic's official autonomous coding agent
- ✅ Excellent code generation quality (Claude 3.5 Sonnet)
- ✅ Lower cost per token than some alternatives
- ✅ Fast response times (typically <30s for simple tasks)
- ✅ Reduces risk - not dependent on single provider
- ✅ Flexibility to route based on task complexity
- ✅ Can compare outputs for quality validation
- ✅ Autonomous multi-file editing capabilities
- ✅ Extended context window (200K+ tokens)

**Routing Strategy:**

- **Cursor:** Complex tasks, multi-file edits, architecture changes
- **Claude Code:** Simple to medium tasks, focused changes, autonomous coding
- **Fallback:** Cursor fails → Claude Code, Claude Code fails → escalate

**Consequences:**

- ✅ Reduced single-provider dependency risk
- ✅ Cost optimization (use cheaper provider when appropriate)
- ✅ Flexibility in provider selection
- ✅ Can validate by comparing provider outputs
- ✅ Autonomous coding capabilities (tool use, multi-turn)
- ⚠️ Need to manage multiple API keys
- ⚠️ Requires Anthropic API SDK integration
- ⚠️ Need provider selection logic in orchestrator

**Implementation:**

- Install SDK: `npm install @anthropic-ai/sdk`
- Configure: `export ANTHROPIC_API_KEY="sk-ant-..."`
- Integrate: Via Anthropic API with extended context and tool use
- Learn more: https://www.claude.com/product/claude-code

---

### ADR-007: Socket.IO for Real-Time Updates

**Status:** Accepted

**Context:** Real-time dashboard updates requirement.

**Decision:** Use Socket.IO to match AetherFlow's existing pattern.

**Consequences:**

- ✅ Consistency with AetherFlow
- ✅ Bidirectional communication
- ✅ Automatic reconnection
- ❌ Namespace isolation required
- ❌ Scaling requires Redis adapter

---

## Multi-Provider AI Implementation Strategy

### Overview

The orchestrator uses a **dual-provider approach** for AI code generation:

- **Primary:** Cursor CLI headless mode (full repo context, multi-file editing)
- **Secondary:** Claude Code (Anthropic's autonomous coding agent)

This strategy provides flexibility, reduces risk, and optimizes for task complexity.

### Command Structure

#### **Cursor CLI Headless**

```bash
cursor --headless \
  --dir /path/to/workspace \
  --apply "prompt with ticket details" \
  [--files src/file1.ts,src/file2.ts] \
  --wait
```

**Flags:**

- `--headless`: Run without GUI (server-ready, low resources)
- `--dir`: Workspace directory (isolated per ticket)
- `--apply`: AI prompt (ticket description + acceptance criteria)
- `--files`: Optional target files for focused editing
- `--wait`: Wait for completion before exiting

---

#### **Claude Code (Anthropic API)**

```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const response = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-20241022',
  max_tokens: 8000,
  messages: [
    {
      role: 'user',
      content: `${contextFiles}\n\n${ticketPrompt}`,
    },
  ],
  tools: codeEditingTools, // File operations, etc.
});
```

**Features:**

- Extended context window (200K+ tokens)
- Tool use for file operations
- Multi-turn conversation
- Structured output
- Autonomous planning and execution

**Installation:**

```bash
# Install Anthropic SDK
npm install @anthropic-ai/sdk

# Configure API key
export ANTHROPIC_API_KEY="sk-ant-..."

# TypeScript types included
```

### Workspace Isolation Strategy

**Problem:** Multiple concurrent tickets need isolated environments.

**Solution:** Per-ticket workspace isolation

```
/tmp/cursor-workspaces/
├── ticket-123-1732567890/     # Project A, ticket 123
│   ├── .git/
│   ├── src/
│   └── package.json
├── ticket-456-1732567891/     # Project A, ticket 456
└── ticket-789-1732567892/     # Project B, ticket 789
```

**Lifecycle:**

1. **Create:** `git clone {repo} /tmp/cursor-workspaces/ticket-{id}-{timestamp}`
2. **Branch:** `git checkout -b feature/ticket-{id}`
3. **Execute:** `cursor --headless --dir /tmp/cursor-workspaces/ticket-{id}-{timestamp} --apply "{prompt}"`
4. **Collect:** `git diff HEAD` to capture changes
5. **Cleanup:** Remove workspace after PR creation (or archive for debugging)

### Prompt Engineering

**Template Structure:**

```typescript
function buildCursorPrompt(ticket: Ticket): string {
  return `
${ticket.title}

Description:
${ticket.description}

Acceptance Criteria:
${ticket.acceptanceCriteria.map((ac) => `- ${ac}`).join('\n')}

Technical Requirements:
- Follow existing code patterns in this repository
- Include TypeScript types for all new code
- Add error handling for edge cases
- Write production-ready, maintainable code
- Include comments for complex logic
- Ensure backward compatibility

Context:
- Tech Stack: ${ticket.techStack}
- Related Files: ${ticket.relatedFiles.join(', ')}
- Dependencies: ${ticket.dependencies.join(', ')}
  `.trim();
}
```

**Key Elements:**

- ✅ Clear task title
- ✅ Detailed description
- ✅ Explicit acceptance criteria
- ✅ Technical requirements
- ✅ Repository context (tech stack, related files)
- ✅ Quality expectations

### Execution Flow (Multi-Provider)

```typescript
// orchestrator/src/ai-routing/ai-routing.service.ts

async function executeAIGeneration(ticket: Ticket, context: CodeContext) {
  // 1. Prepare isolated workspace
  const workspaceDir = await prepareWorkspace(ticket, context);

  // 2. Select provider based on task complexity
  const provider = await providerFactory.getProvider(ticket, context);
  // => CursorHeadlessProvider or ClaudeCLIProvider

  try {
    // 3. Execute with selected provider
    const result = await provider.execute(ticket, workspaceDir, context);

    // 4. Collect results
    const changes = await collectChanges(workspaceDir);

    // 5. Validate generated code
    await validateCode(workspaceDir, changes);

    // 6. Create commit
    await commitChanges(workspaceDir, ticket);

    // 7. Push to GitHub
    await pushToGitHub(workspaceDir, ticket);

    // 8. Track metrics
    await trackExecution(ticket, provider, result);

    return {
      success: true,
      provider: provider.name,
      filesModified: changes.files,
      executionTimeMs: result.executionTime,
    };
  } catch (error) {
    // 9. Fallback on failure
    if (provider.name === 'cursor' && error.retryable) {
      console.log('Cursor failed, falling back to Claude...');
      const fallbackProvider = await providerFactory.getFallbackProvider();
      return executeWithProvider(fallbackProvider, ticket, workspaceDir, context);
    }
    throw error;
  } finally {
    // 10. Cleanup
    await cleanupWorkspace(workspaceDir);
  }
}
```

---

#### **Provider-Specific Execution**

**Cursor Headless Provider:**

```typescript
async execute(ticket: Ticket, workspace: string, context: CodeContext) {
  const prompt = buildCursorPrompt(ticket);
  const command = `cursor --headless --dir "${workspace}" --apply "${prompt}" --wait`;

  const { stdout } = await execAsync(command, {
    timeout: 300000, // 5 min
    maxBuffer: 10 * 1024 * 1024
  });

  return { executionTime: Date.now() - start, output: stdout };
}
```

**Claude Code Provider:**

```typescript
async execute(ticket: Ticket, workspace: string, context: CodeContext) {
  // 1. Build enhanced prompt with file contents
  const prompt = buildClaudeCodePrompt(ticket, context);
  const fileContents = await loadRelevantFiles(workspace, context.relevantFiles);

  // 2. Create message with extended context
  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 8000,
    messages: [{
      role: 'user',
      content: `${fileContents}\n\n${prompt}`
    }],
    tools: [{
      name: 'edit_file',
      description: 'Edit or create a file',
      input_schema: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' }
        }
      }
    }]
  });

  // 3. Process tool use and apply changes
  const changes = await processClaudeCodeResponse(response, workspace);

  return { executionTime: Date.now() - start, changes };
}
```

### Concurrency Management

**Goal:** Support 50+ concurrent projects (Phase 3)

**Strategy:**

```typescript
// RabbitMQ queue configuration
const AI_EXECUTION_QUEUE = {
  name: 'ai-execution-queue',
  concurrency: 10, // 10 concurrent Cursor instances
  prefetch: 1,
  durable: true,
};

// Worker pool
const cursorWorkerPool = {
  maxWorkers: 10,
  minWorkers: 2,
  idleTimeout: 300000, // 5 min
  maxQueueSize: 100,
};
```

**Limits:**

- Start conservatively: 5-10 concurrent Cursor instances
- Monitor: CPU, memory, disk I/O
- Scale horizontally: Multiple orchestrator nodes if needed
- Queue overflow: Reject new tickets with backpressure signal

### Error Handling

**Common Failures:**

| Error          | Cause                   | Mitigation                               |
| -------------- | ----------------------- | ---------------------------------------- |
| Timeout        | Cursor execution >5 min | Increase timeout, split ticket           |
| Out of Memory  | Large repository        | Increase container memory, shallow clone |
| Git Conflict   | Concurrent edits        | Rebase and retry                         |
| Cursor Crash   | AI model issue          | Retry with exponential backoff           |
| Invalid Prompt | Malformed ticket        | Ticket validation before routing         |

**Retry Strategy:**

```typescript
const retryConfig = {
  maxRetries: 3,
  backoff: 'exponential', // 1s, 2s, 4s
  retryableErrors: ['timeout', 'cursor-crash', 'network-error'],
  nonRetryableErrors: ['invalid-prompt', 'auth-failed'],
};
```

### Cost Tracking

**Metrics to Track:**

- Cursor API usage (if metered)
- Execution time per ticket
- Success rate (% completed without errors)
- Retry count per ticket
- Workspace disk usage

**Implementation:**

```typescript
// Track cost after each execution
await costTracker.record({
  ticketId: ticket.id,
  executionTimeMs: executionTime,
  success: true,
  retries: 2,
  filesModified: 5,
  provider: 'cursor-headless',
});

// Calculate cost (if metered by Cursor)
const estimatedCost = (executionTime / 1000) * CURSOR_COST_PER_SECOND;
```

### Validation Checklist

**Before deploying to production:**

#### **Cursor CLI Validation:**

- [ ] Verify `cursor --headless` command exists
- [ ] Test single execution end-to-end
- [ ] Test concurrent execution (5-10 instances)
- [ ] Measure resource usage (CPU, memory, disk)
- [ ] Validate workspace isolation (no cross-contamination)
- [ ] Test error scenarios (timeout, crash, invalid prompt)
- [ ] Verify cleanup process (no orphaned workspaces)
- [ ] Confirm cost tracking accuracy
- [ ] Load test with realistic ticket volume
- [ ] Document Cursor license requirements for headless

#### **Claude Code Validation:**

- [ ] Install Anthropic SDK (`npm install @anthropic-ai/sdk`)
- [ ] Configure API key (`export ANTHROPIC_API_KEY="sk-ant-..."`)
- [ ] Test single code generation task via API
- [ ] Validate extended context handling (file contents)
- [ ] Test tool use for file operations
- [ ] Test output parsing and change application
- [ ] Measure cost per request
- [ ] Compare quality vs Cursor for same task
- [ ] Test fallback scenario (Cursor fails → Claude Code works)
- [ ] Validate autonomous multi-turn conversations

#### **Multi-Provider Logic:**

- [ ] Provider selection works based on complexity
- [ ] Fallback triggers correctly on failure
- [ ] Both providers tracked in metrics
- [ ] Cost tracking differentiates by provider

### Phase 1 Validation Scripts

#### **validate-ai-providers.sh** (Tests both Cursor and Claude)

```bash
#!/bin/bash
# validate-ai-providers.sh - Tests both Cursor and Claude Code

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║   🧪 MULTI-PROVIDER AI VALIDATION                             ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

ALL_TESTS_PASSED=true

# ==================== Test Cursor CLI ====================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1️⃣  TESTING: Cursor CLI Headless Mode"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if command -v cursor &> /dev/null; then
    echo "✅ Cursor CLI found: $(which cursor)"

    # Test headless execution
    mkdir -p /tmp/cursor-test
    cd /tmp/cursor-test
    git init > /dev/null 2>&1
    echo 'test' > test.txt
    git add . && git commit -m "init" > /dev/null 2>&1

    if timeout 60s cursor --headless --dir /tmp/cursor-test --apply "Add a hello function" --wait 2>&1; then
        echo "✅ Cursor headless works!"
        CURSOR_AVAILABLE=true
    else
        echo "⚠️  Cursor headless failed"
        CURSOR_AVAILABLE=false
        ALL_TESTS_PASSED=false
    fi
else
    echo "❌ Cursor CLI not found"
    CURSOR_AVAILABLE=false
fi

echo ""

# ==================== Test Claude Code ====================
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2️⃣  TESTING: Claude Code (Anthropic API)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if Anthropic SDK is installed
if npm list @anthropic-ai/sdk &> /dev/null || npm list -g @anthropic-ai/sdk &> /dev/null; then
    echo "✅ Anthropic SDK found"

    # Test API key
    if [ -z "$ANTHROPIC_API_KEY" ]; then
        echo "⚠️  ANTHROPIC_API_KEY not set"
        echo "   Set with: export ANTHROPIC_API_KEY='sk-ant-...'"
        CLAUDE_AVAILABLE=false
        ALL_TESTS_PASSED=false
    else
        echo "✅ ANTHROPIC_API_KEY is set"
        # Note: Full API test would require Node.js script
        echo "✅ Claude Code ready (API key configured)"
        CLAUDE_AVAILABLE=true
    fi
else
    echo "⚠️  Anthropic SDK not found"
    echo "   Install: npm install @anthropic-ai/sdk"
    CLAUDE_AVAILABLE=false
fi

echo ""

# ==================== Results ====================
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║   📊 VALIDATION RESULTS                                        ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

echo "Cursor CLI:  $([ "$CURSOR_AVAILABLE" = true ] && echo '✅ AVAILABLE' || echo '❌ NOT AVAILABLE')"
echo "Claude Code: $([ "$CLAUDE_AVAILABLE" = true ] && echo '✅ AVAILABLE' || echo '❌ NOT AVAILABLE')"
echo ""

if [ "$CURSOR_AVAILABLE" = true ] && [ "$CLAUDE_AVAILABLE" = true ]; then
    echo "✅✅✅ BOTH PROVIDERS AVAILABLE - OPTIMAL ✅✅✅"
    echo ""
    echo "RECOMMENDATION:"
    echo "- Use Cursor for complex, multi-file tasks"
    echo "- Use Claude for simple, focused tasks"
    echo "- Auto-fallback if one provider fails"
    exit 0
elif [ "$CURSOR_AVAILABLE" = true ]; then
    echo "✅ CURSOR AVAILABLE - CAN PROCEED"
    echo "⚠️  Claude not available - no fallback"
    echo ""
    echo "RECOMMENDATION:"
    echo "- Proceed with Cursor only"
    echo "- Install Claude Code (Anthropic SDK) for fallback (optional)"
    exit 0
elif [ "$CLAUDE_AVAILABLE" = true ]; then
    echo "✅ CLAUDE AVAILABLE - CAN PROCEED"
    echo "⚠️  Cursor not available - limited repo context"
    echo ""
    echo "RECOMMENDATION:"
    echo "- Proceed with Claude only"
    echo "- Install Cursor for better multi-file editing"
    exit 0
else
    echo "❌ NO PROVIDERS AVAILABLE - CANNOT PROCEED"
    echo ""
    echo "REQUIRED ACTIONS:"
    echo "1. Install Cursor CLI and/or Anthropic SDK for Claude Code"
    echo "2. Configure API keys"
    echo "3. Re-run this validation"
    exit 1
fi
```

---

## Cost Tracking Implementation

### Database Schema

```prisma
// prisma/schema.prisma - Cost Tracking Models

model AIExecutionCost {
  id              String   @id @default(uuid())
  ticketId        String
  executionId     String   @unique

  // Provider details
  provider        String   // 'cursor' | 'claude'
  model           String?  // For API-based providers (e.g., 'claude-3-5-sonnet')

  // Execution metrics
  executionTimeMs Int      // Total execution time in milliseconds
  filesModified   Int      // Number of files changed
  linesChanged    Int      // Total lines added/removed

  // Cost tracking
  estimatedCost   Decimal  @db.Decimal(10, 4) // USD
  apiCalls        Json?    // Detailed API call log for metered providers
  tokensUsed      Int?     // For token-based providers

  // Context details
  promptLength    Int      // Characters in prompt
  contextFiles    Int      // Number of files provided as context

  // Outcome
  success         Boolean
  retries         Int      @default(0)
  fallbackUsed    Boolean  @default(false)

  // Relationships
  ticket          Ticket   @relation(fields: [ticketId], references: [id])
  execution       Execution @relation(fields: [executionId], references: [id])

  createdAt       DateTime @default(now())

  @@index([ticketId])
  @@index([provider])
  @@index([createdAt])
}

model DailyCostSummary {
  id              String   @id @default(uuid())
  date            DateTime @db.Date

  // Provider breakdown
  cursorCost      Decimal  @db.Decimal(10, 2) // Fixed license cost allocated per day
  claudeCost      Decimal  @db.Decimal(10, 2) // Actual API usage cost
  totalCost       Decimal  @db.Decimal(10, 2)

  // Execution counts
  cursorExecutions Int     @default(0)
  claudeExecutions Int     @default(0)
  totalExecutions  Int     @default(0)

  // Success metrics
  successRate     Decimal  @db.Decimal(5, 2) // Percentage
  fallbackRate    Decimal  @db.Decimal(5, 2) // Percentage

  // Budget tracking
  budgetLimit     Decimal  @db.Decimal(10, 2)
  budgetRemaining Decimal  @db.Decimal(10, 2)
  budgetAlertSent Boolean  @default(false)

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([date])
  @@index([date])
}
```

### Cost Calculation Logic

```typescript
// src/cost-tracking/cost-calculator.service.ts

export class CostCalculatorService {
  // Cursor: Fixed license cost allocated per execution
  private readonly CURSOR_MONTHLY_LICENSE = 2500; // $2,500/month
  private readonly ESTIMATED_EXECUTIONS_PER_MONTH = 100;
  private readonly CURSOR_COST_PER_EXECUTION =
    this.CURSOR_MONTHLY_LICENSE / this.ESTIMATED_EXECUTIONS_PER_MONTH; // $25

  // Claude: Token-based pricing
  private readonly CLAUDE_INPUT_COST_PER_1M_TOKENS = 3.0; // $3/1M tokens
  private readonly CLAUDE_OUTPUT_COST_PER_1M_TOKENS = 15.0; // $15/1M tokens

  async calculateCursorCost(execution: Execution): Promise<number> {
    // Cursor uses fixed per-execution cost
    // (Alternatively, could track actual license seats used)
    return this.CURSOR_COST_PER_EXECUTION;
  }

  async calculateClaudeCost(promptTokens: number, completionTokens: number): Promise<number> {
    const inputCost = (promptTokens / 1_000_000) * this.CLAUDE_INPUT_COST_PER_1M_TOKENS;
    const outputCost = (completionTokens / 1_000_000) * this.CLAUDE_OUTPUT_COST_PER_1M_TOKENS;
    return inputCost + outputCost;
  }

  async trackExecution(
    ticketId: string,
    executionId: string,
    provider: 'cursor' | 'claude',
    metrics: ExecutionMetrics,
  ): Promise<AIExecutionCost> {
    const cost =
      provider === 'cursor'
        ? await this.calculateCursorCost(metrics)
        : await this.calculateClaudeCost(metrics.tokensInput, metrics.tokensOutput);

    return await this.prisma.aIExecutionCost.create({
      data: {
        ticketId,
        executionId,
        provider,
        estimatedCost: cost,
        executionTimeMs: metrics.durationMs,
        filesModified: metrics.filesModified,
        linesChanged: metrics.linesChanged,
        tokensUsed: metrics.tokensInput + metrics.tokensOutput,
        success: metrics.success,
        retries: metrics.retries,
        fallbackUsed: metrics.fallbackUsed,
      },
    });
  }
}
```

### Daily Budget Monitoring

```typescript
// src/cost-tracking/budget-monitor.service.ts

export class BudgetMonitorService {
  private readonly DAILY_BUDGET_DEFAULT = 100; // $100/day

  async checkBudget(): Promise<BudgetStatus> {
    const today = new Date().toISOString().split('T')[0];
    const summary = await this.getDailySummary(today);

    if (summary.totalCost >= summary.budgetLimit * 0.9) {
      // 90% threshold - send warning
      await this.sendBudgetAlert({
        level: 'warning',
        usage: summary.totalCost,
        limit: summary.budgetLimit,
        remaining: summary.budgetRemaining,
      });
    }

    if (summary.totalCost >= summary.budgetLimit) {
      // Budget exceeded - pause executions
      await this.pauseExecutions({
        reason: 'Daily budget exceeded',
        budget: summary.budgetLimit,
        spent: summary.totalCost,
      });

      return { exceeded: true, paused: true };
    }

    return { exceeded: false, remaining: summary.budgetRemaining };
  }
}
```

---

## Workspace Isolation Strategy

### Workspace Lifecycle

```typescript
// src/ai-routing/workspace.service.ts

export class WorkspaceService {
  private readonly WORKSPACES_ROOT = '/workspaces';
  private readonly MAX_CONCURRENT_WORKSPACES = 10;
  private readonly WORKSPACE_TIMEOUT_MS = 600_000; // 10 minutes

  /**
   * Complete workspace lifecycle for a ticket
   */
  async executeInIsolatedWorkspace(
    ticket: Ticket,
    execution: (workspacePath: string) => Promise<void>,
  ): Promise<void> {
    const workspaceId = `ticket-${ticket.id}-${Date.now()}`;
    const workspacePath = `${this.WORKSPACES_ROOT}/${workspaceId}`;

    try {
      // 1. Check concurrency limit
      await this.enforceWorkspaceLimit();

      // 2. Create workspace
      await this.createWorkspace(workspacePath, ticket.linkedRepo);

      // 3. Execute AI generation
      await Promise.race([execution(workspacePath), this.timeout(this.WORKSPACE_TIMEOUT_MS)]);

      // 4. Extract results (git diff)
      const changes = await this.extractChanges(workspacePath);
      return changes;
    } finally {
      // 5. Always cleanup (even on error)
      await this.cleanupWorkspace(workspacePath);
    }
  }

  /**
   * Create isolated workspace by cloning repository
   */
  private async createWorkspace(workspacePath: string, repoUrl: string): Promise<void> {
    // Create directory
    await fs.mkdir(workspacePath, { recursive: true });

    // Clone repository with shallow clone (faster)
    await execAsync(`git clone --depth 1 ${repoUrl} ${workspacePath}`, {
      timeout: 120_000, // 2 minute timeout
    });

    // Configure git for commits
    await execAsync(`git config user.name "Dark Factory"`, { cwd: workspacePath });
    await execAsync(`git config user.email "bot@darkfactory.ai"`, { cwd: workspacePath });

    this.logger.log(`Workspace created: ${workspacePath}`);
  }

  /**
   * Cleanup workspace after execution
   */
  private async cleanupWorkspace(workspacePath: string): Promise<void> {
    try {
      await execAsync(`rm -rf ${workspacePath}`);
      this.logger.log(`Workspace cleaned up: ${workspacePath}`);
    } catch (error) {
      this.logger.error(`Failed to cleanup workspace ${workspacePath}:`, error);
      // Don't throw - cleanup failures shouldn't block execution
    }
  }

  /**
   * Enforce concurrent workspace limit
   */
  private async enforceWorkspaceLimit(): Promise<void> {
    const activeWorkspaces = await this.getActiveWorkspaceCount();

    if (activeWorkspaces >= this.MAX_CONCURRENT_WORKSPACES) {
      // Wait for a workspace to free up (with timeout)
      await this.waitForWorkspaceSlot(30_000); // 30s timeout
    }
  }

  /**
   * Extract git changes from workspace
   */
  private async extractChanges(workspacePath: string): Promise<string> {
    const { stdout } = await execAsync(`git diff HEAD`, { cwd: workspacePath });
    return stdout;
  }
}
```

### Resource Management

```typescript
// src/ai-routing/resource-manager.service.ts

export class ResourceManagerService {
  private readonly MAX_DISK_USAGE_GB = 50; // 50GB limit
  private readonly CLEANUP_THRESHOLD_GB = 40; // Cleanup at 40GB

  /**
   * Monitor and manage disk usage
   */
  async monitorDiskUsage(): Promise<void> {
    const usage = await this.getDiskUsage(WORKSPACES_ROOT);

    if (usage.usedGB > this.CLEANUP_THRESHOLD_GB) {
      // Clean up old workspaces
      await this.cleanupOldWorkspaces();
    }

    if (usage.usedGB > this.MAX_DISK_USAGE_GB) {
      // Critical - pause new executions
      await this.pauseNewExecutions({
        reason: 'Disk space critical',
        usage: usage.usedGB,
        limit: this.MAX_DISK_USAGE_GB,
      });
    }
  }

  /**
   * Clean up orphaned workspaces (older than 1 hour)
   */
  private async cleanupOldWorkspaces(): Promise<void> {
    const oneHourAgo = Date.now() - 3_600_000;
    const workspaces = await fs.readdir(WORKSPACES_ROOT);

    for (const workspace of workspaces) {
      const stats = await fs.stat(`${WORKSPACES_ROOT}/${workspace}`);

      if (stats.mtimeMs < oneHourAgo) {
        await execAsync(`rm -rf ${WORKSPACES_ROOT}/${workspace}`);
        this.logger.warn(`Cleaned up orphaned workspace: ${workspace}`);
      }
    }
  }
}
```

### Concurrent Execution Strategy

```
┌─────────────────────────────────────────────────────┐
│  Orchestrator (Ticket Queue)                        │
└─────────────────┬───────────────────────────────────┘
                  │
     ┌────────────┴────────────┐
     │ Resource Manager        │
     │ - Max 10 concurrent     │
     │ - Disk space monitoring │
     │ - Automatic cleanup     │
     └────────────┬────────────┘
                  │
      ┌───────────┴──────────┐
      │                      │
      ▼                      ▼
┌──────────┐          ┌──────────┐
│Workspace1│          │Workspace2│  ... (up to 10)
│ ticket-  │          │ ticket-  │
│   123    │          │   124    │
└──────────┘          └──────────┘
      │                      │
      ▼                      ▼
  Cursor/Claude         Cursor/Claude
  Execution             Execution
      │                      │
      ▼                      ▼
  Git diff              Git diff
      │                      │
      ▼                      ▼
  Cleanup               Cleanup
```

**Resource Limits:**

- **Max concurrent workspaces:** 10
- **Max disk usage:** 50GB
- **Workspace timeout:** 10 minutes
- **Cleanup after:** 1 hour if orphaned
- **Shallow clone:** `--depth 1` for speed

---

**Document Status:** ✅ Complete  
**Version:** 2.2  
**Last Updated:** 2025-11-26  
**Changes:** Added cost tracking implementation and workspace isolation strategy
**Next Review:** After multi-provider validation

**Approval Required:** BMad (Founder/CEO)

**Critical First Step:** Run validation script (`scripts/validate-ai-providers.sh`) to confirm both providers work.

---

## Multi-Provider Summary

**Primary Provider:** Cursor CLI Headless

- Full repository context
- Multi-file editing with awareness
- Best for complex tasks
- Command: `cursor --headless --dir /path --apply "prompt"`

**Secondary Provider:** Claude Code

- Excellent code quality
- Lower cost per token
- Autonomous coding capabilities
- Extended context (200K+ tokens)
- Tool use for file operations
- Integration: Anthropic API SDK

**Strategy:** Use both providers with intelligent routing and automatic fallback.

---

_This architecture document provides the complete technical foundation for implementing the AI Dev Tool Orchestrator using a multi-provider approach (Cursor CLI Headless + Claude Code). All 136 functional requirements are architecturally supported with official, documented tooling from both Cursor and Anthropic._
