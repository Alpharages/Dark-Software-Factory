# Architecture Document: AI Dev Tool Orchestrator
## Dark Software Factory

**Date:** 2025-11-20  
**Version:** 1.0  
**Author:** BMad  
**Project:** Dark Software Factory - AI-Augmented Software House Transformation

---

## Executive Summary

The AI Dev Tool Orchestrator is a **separate NestJS microservice** that extends AetherFlow (existing 80% infrastructure) by automating the complete pipeline from PM-created tickets to deployed code. It acts as the "orchestration brain" connecting ClickUp webhooks → AI development tools (Cursor, Windsurf, Antigravity) → automated QA → GitHub → CI/CD deployment → production monitoring. The architecture prioritizes clean separation from AetherFlow to protect existing infrastructure, systematic validation through phase gates, and observability for data-driven GO/NO-GO decisions.

**Architecture Philosophy:** "Integrate, don't disrupt" - the orchestrator extends AetherFlow's capabilities without modifying its proven 80% foundation.

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

| Category | Decision | Version | Rationale | Affects FRs | Provided By |
|----------|----------|---------|-----------|-------------|-------------|
| **Foundation** | Separate NestJS Microservice | 10.x | Clean separation from AetherFlow, enterprise structure, protects 80% infrastructure | All 136 FRs | User Decision |
| **Language** | TypeScript (Strict Mode) | 5.x | Type safety critical for multi-system integration, consistency with AetherFlow | All FRs | NestJS Starter |
| **Database** | Separate PostgreSQL | 16.x | Service independence, data encapsulation, scalable | FR56-95 (System) | User Decision |
| **ORM** | Prisma | 5.x | Type-safe queries, migrations, excellent DX | FR56-95 (System) | Recommended |
| **Message Queue** | RabbitMQ | 3.13.x | Robust message broker, reliable async communication, retry logic | FR60-78, Jobs | User Decision |
| **Real-time** | Socket.IO | 4.x | Dashboard real-time updates, matches AetherFlow pattern | FR96-115 (Dashboards) | Recommended |
| **HTTP Client** | Axios | 1.x | AI provider API calls, GitHub, ClickUp integration | FR60-78 (Integration) | Recommended |
| **Logging** | Winston | 3.x | Structured JSON logging, audit trail | NFR-O1-4 (Observability) | Recommended |
| **Monitoring** | Prometheus + Grafana | Latest | Metrics exposure, dashboard visualization | NFR-O5-11 (Monitoring) | Recommended |
| **Error Tracking** | Sentry | Latest | Production error monitoring, alerting | NFR-R4-7 (Reliability) | Recommended |
| **Testing** | Jest + Supertest | NestJS built-in | Test coverage >80% requirement | NFR-M1 (Maintainability) | NestJS Starter |
| **Authentication** | Separate Auth Service (JWT) | Custom | Service independence, dedicated auth management | NFR-S1-2 (Security) | User Decision |
| **Config Management** | @nestjs/config + dotenv | NestJS built-in | Environment-based configuration | NFR-M4 (Maintainability) | NestJS Starter |
| **Validation** | class-validator + class-transformer | NestJS built-in | Request validation, DTO transformation | NFR-S4 (Security) | NestJS Starter |
| **API Documentation** | Swagger/OpenAPI | @nestjs/swagger | Internal API documentation for AetherFlow integration | Integration | Recommended |
| **Deployment** | Docker + Docker Compose | Latest | Containerization, runs alongside AetherFlow | NFR-M7 (Operations) | Recommended |
| **Code Style** | ESLint + Prettier | NestJS built-in | Code consistency across AI-generated code | NFR-M2 (Maintainability) | NestJS Starter |

**Key Architectural Decisions:**
- ✅ **Separate Database:** Own PostgreSQL instance (not shared with AetherFlow) for service independence
- ✅ **RabbitMQ:** Message broker for async AI execution, job queuing, retry logic
- ✅ **Separate Auth:** Dedicated authentication service (not shared with AetherFlow) using JWT
- ✅ **Socket.IO:** Real-time dashboard updates (consistent with AetherFlow)
- ✅ **Prometheus:** Metrics and observability for GO/NO-GO decision gates

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
│   │   ├── webhooks.controller.ts       # POST /webhooks/clickup
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
│   ├── ai-routing/                      # AI tool routing engine (FR60-65)
│   │   ├── ai-routing.module.ts
│   │   ├── ai-routing.service.ts        # Route to Cursor/Windsurf/Antigravity
│   │   ├── prompt-builder.service.ts    # Convert tickets to AI prompts
│   │   ├── providers/
│   │   │   ├── base-ai.provider.ts      # Abstract base class
│   │   │   ├── cursor.provider.ts       # Cursor API client
│   │   │   ├── windsurf.provider.ts     # Windsurf API client
│   │   │   └── antigravity.provider.ts  # Antigravity API client
│   │   └── strategies/
│   │       └── routing-strategy.ts      # Task type → AI tool mapping
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

| FR Range | Capability Area | Architecture Components |
|----------|----------------|------------------------|
| FR1-7 | Ticket Creation & Management | `integration/aetherflow.service.ts`, `integration/clickup.service.ts`, `dashboards/pm-dashboard.controller.ts` |
| FR8-14 | AI Project Orchestration | `execution/execution.service.ts`, `dashboards/pm-dashboard.controller.ts`, `realtime/realtime.gateway.ts` |
| FR15-19 | Workload & Capacity Management | `metrics/metrics.service.ts`, `dashboards/pm-dashboard.controller.ts`, Alert system |
| FR20-23 | Client Communication | `integration/clickup.service.ts`, PM dashboard API endpoints |

**Implementation Notes:**
- PM dashboard APIs expose data aggregated from multiple services
- Real-time Socket.IO updates push execution status to PM dashboards
- AetherFlow service handles BMAD PM Agent interactions

---

### Technical Lead Capabilities (FR24-33) → Review Queues & Validation

| FR Range | Capability Area | Architecture Components |
|----------|----------------|------------------------|
| FR24-29 | Architecture Validation | `dashboards/orchestrator-dashboard.controller.ts`, Review queue APIs, ADR logging |
| FR30-33 | AI Capability Management | `ai-routing/routing-strategy.ts`, `execution/execution-tracker.service.ts`, Escalation handlers |

**Implementation Notes:**
- Architecture Decision Records (ADRs) logged in database with AI rationale
- Review queue prioritization based on risk scoring
- Escalation triggers when AI confidence score below threshold

---

### Lead QA Capabilities (FR34-43) → Quality Automation & Dashboards

| FR Range | Capability Area | Architecture Components |
|----------|----------------|------------------------|
| FR34-40 | Quality Review & Gates | `qa-automation/quality-gates.service.ts`, `dashboards/qa-dashboard.controller.ts`, Sampling service |
| FR41-43 | QA Metrics & Analysis | `metrics/metrics.service.ts`, `dashboards/qa-dashboard.controller.ts`, Prometheus metrics |

**Implementation Notes:**
- Statistical sampling implemented with configurable percentage (default 20%)
- Quality gates configured per project type
- Bug escape rate tracked via production monitoring integration

---

### Manager/Leadership Capabilities (FR44-55) → Business Dashboards

| FR Range | Capability Area | Architecture Components |
|----------|----------------|------------------------|
| FR44-48 | Business Oversight | `cost-tracking/cost-tracker.service.ts`, `dashboards/cost-dashboard.controller.ts`, Project portfolio APIs |
| FR49-52 | Workforce Management | `metrics/metrics.service.ts`, Early warning system, `dashboards/decision-dashboard.controller.ts` |
| FR53-55 | Client Relationship | Client health scoring service, CRM integration endpoints |

**Implementation Notes:**
- GO/NO-GO decision dashboard pulls from all metrics services
- Early warning indicators match Pre-mortem analysis risks
- Cost caps enforced via `cost-tracking/budget-monitor.service.ts`

---

### AI Orchestrator System (FR56-95) → Core Orchestration Engine

| FR Range | Capability Area | Architecture Components |
|----------|----------------|------------------------|
| FR56-59 | Webhook & Task Intake | `webhooks/webhooks.controller.ts`, `ticket-intake/ticket-intake.service.ts`, RabbitMQ publisher |
| FR60-65 | AI Tool Routing & Execution | `ai-routing/ai-routing.service.ts`, `providers/cursor.provider.ts`, etc., `execution/execution.service.ts` |
| FR66-71 | Automated QA & Quality Gates | `qa-automation/qa-orchestrator.service.ts`, All QA subservices, RabbitMQ consumer |
| FR72-78 | GitHub Integration & Deployment | `github/github.service.ts`, `deployment/deployment.service.ts`, CI/CD providers |
| FR79-84 | Self-Healing & Production Monitoring | `production-monitoring/monitoring.service.ts`, `log-analyzer.service.ts`, Auto-ticket creation |
| FR85-90 | Cost Tracking & Optimization | `cost-tracking/cost-tracker.service.ts`, `budget-monitor.service.ts`, Real-time cost calculation |
| FR91-95 | Execution Metrics & Logging | `metrics/metrics.service.ts`, `prometheus.service.ts`, Winston logger, Audit trail |

**Implementation Notes:**
- RabbitMQ queues for: `ai-tasks`, `qa-tasks`, `deployment-tasks`, `monitoring-tasks`
- Each queue has dedicated consumer with retry logic (3 attempts with exponential backoff)
- All state transitions logged to database and Prometheus metrics
- Cost tracking hooks into all AI provider API calls

---

### Dashboard & Monitoring (FR96-115) → Real-Time Interfaces

| FR Range | Capability Area | Architecture Components |
|----------|----------------|------------------------|
| FR96-99 | PM Dashboard | `dashboards/pm-dashboard.controller.ts`, Socket.IO events, Dashboard DTOs |
| FR100-104 | Orchestrator Monitoring | `dashboards/orchestrator-dashboard.controller.ts`, System health endpoints, Queue metrics |
| FR105-108 | Cost Monitoring Dashboard | `dashboards/cost-dashboard.controller.ts`, Cost aggregation, Trend analysis |
| FR109-111 | Quality Dashboard | `dashboards/qa-dashboard.controller.ts`, Quality metrics aggregation, Bug rate tracking |
| FR112-115 | GO/NO-GO Decision Dashboard | `dashboards/decision-dashboard.controller.ts`, Phase gate criteria, Success metrics |

**Implementation Notes:**
- All dashboard controllers expose REST APIs consumed by AetherFlow frontend
- Socket.IO gateway (`realtime/realtime.gateway.ts`) pushes updates to connected clients
- Dashboard data refreshes: Real-time (Socket.IO) + Polling fallback (every 30s)

---

### Knowledge Base (FR116-120) → Phase 2 - Future Architecture

| FR Range | Capability Area | Architecture Components (Phase 2) |
|----------|----------------|-----------------------------------|
| FR116-120 | Knowledge Base System | `knowledge-base` module (to be built), Vector database integration, AI context injection |

**Phase 2 Design Notes:**
- Consider Pinecone or Weaviate for vector storage
- Automatic knowledge extraction from successful tickets
- Context injection into AI prompts before execution

---

### Client Portal (FR121-127) → Phase 3 - Future Architecture

| FR Range | Capability Area | Architecture Components (Phase 3) |
|----------|----------------|-----------------------------------|
| FR121-127 | Client Portal | `client-portal` module (to be built), Separate client-facing API, Transparency views |

**Phase 3 Design Notes:**
- Separate client-facing REST API with different auth
- Read-only access to project status, metrics, AI involvement transparency
- Client preference management (opt-in/opt-out AI)

---

### Advanced Capabilities (FR128-136) → Phase 3 - Future Architecture

| FR Range | Capability Area | Architecture Components (Phase 3) |
|----------|----------------|-----------------------------------|
| FR128-130 | Predictive Analytics | ML models, Historical data analysis, Cost/complexity prediction |
| FR131-133 | Multi-Provider Strategy | Enhanced routing logic, Fallback providers, Performance comparison |
| FR134-136 | Advanced Self-Healing | Autonomous fix generation, Testing sandbox, Auto-deployment with rollback |

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

### HTTP Client & External APIs
- **Axios 1.x** - Promise-based HTTP client
  - Interceptors for auth, logging, retries
  - Request/response transformation
  - Timeout configuration
  - Support for cancellation tokens

**AI Provider APIs:**
- Cursor API (HTTP/REST)
- Windsurf API (HTTP/REST)
- Google Antigravity API (HTTP/REST)

**Other External APIs:**
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

### 3. AI Provider Integration

**Communication:** HTTP/REST APIs

**Cursor API:**
- Endpoint: `{{cursor_api_url}}/v1/execute`
- Auth: API key in header
- Payload: Prompt, context, configuration
- Response: Generated code, confidence score, execution logs

**Windsurf API:**
- Similar structure to Cursor
- Provider-specific configuration options

**Antigravity API:**
- Similar structure to Cursor
- Provider-specific configuration options

**Common Integration Pattern:**
- Abstract base class: `BaseAIProvider`
- Concrete implementations: `CursorProvider`, `WindsurfProvider`, `AntigravityProvider`
- Factory pattern for provider selection

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
```

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
  currentStep: 'Running tests'
});

// Cost alert
socket.emit('cost-alert', {
  projectId: 'uuid',
  currentCostCents: number,
  budgetCents: number,
  percentOfBudget: number
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

| Resource | ADMIN | MANAGER | PM | TL | QA | VIEWER |
|----------|-------|---------|----|----|----|----|
| Create Ticket | ✓ | ✓ | ✓ | - | - | - |
| Approve Code | ✓ | ✓ | ✓ | - | - | - |
| Review Architecture | ✓ | - | - | ✓ | - | - |
| Approve Deployment | ✓ | - | - | - | ✓ | - |
| View Dashboards | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Configure System | ✓ | - | - | - | - | - |

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
- Allow: AetherFlow frontend origin
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
    volumes: [ './data:/var/lib/postgresql/data' ]

  rabbitmq:
    image: rabbitmq:3.13-management
    volumes: [ './rabbitmq-data:/var/lib/rabbitmq' ]
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

### ADR-003: RabbitMQ for Message Queue

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

### ADR-004: Separate Authentication Service

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

### ADR-005: Socket.IO for Real-Time Updates

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

**Document Status:** ✅ Complete  
**Version:** 1.0  
**Last Updated:** 2025-11-20  
**Next Review:** After Phase 1 MVP completion

**Approval Required:** BMad (Founder/CEO)

---

_This architecture document provides the complete technical foundation for implementing the AI Dev Tool Orchestrator. All 136 functional requirements are architecturally supported, and all integration points are defined._
