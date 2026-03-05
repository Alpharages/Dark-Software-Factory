---
stepsCompleted:
  [
    'hero-step',
    'step-01-validate-prerequisites',
    'step-02-design-epics',
    'step-03-create-stories',
    'step-04-final-validation',
    'qa-report-step-01-validate-prerequisites',
    'qa-report-step-02-design-epics',
    'qa-report-step-03-create-stories',
  ]
inputDocuments:
  ['prd.md', 'architecture.md', 'ux-design-specification.md', 'docs/QA-REPORT-2026-02-27.md']
---

# Dark Software Factory - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Dark Software Factory, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

**PM (Product Manager) Capabilities**

**Ticket Creation & Management:**
FR1: PMs can create feature tickets in AetherFlow with BMAD PM Agent assistance
FR2: PMs can define acceptance criteria for tickets using guided templates
FR3: PMs can attach context documents (client history, domain knowledge) to tickets
FR4: PMs can view ticket quality score before submitting (completeness, clarity metrics)
FR5: PMs can receive AI suggestions for missing details or edge cases in tickets (Phase 2)
FR6: PMs can approve or reject AI-generated ticket enhancements (Phase 2)
FR7: PMs can link tickets to client projects and set priority levels

**AI Project Orchestration:**
FR8: PMs can view all AI projects assigned to them in a unified dashboard
FR9: PMs can monitor real-time status of AI execution on their tickets (queued, in-progress, testing, deployed)
FR10: PMs can receive notifications when AI completes work or encounters issues
FR11: PMs can approve AI-generated code before deployment (final gate)
FR12: PMs can request AI rework with additional context or clarification
FR13: PMs can view AI confidence scores and uncertainty flags for each task
FR14: PMs can escalate blocked tickets to TL or Lead QA

**Workload & Capacity Management:**
FR15: PMs can view their current project load and utilization percentage
FR16: PMs can see burnout risk indicators (hours worked, ticket revision rates)
FR17: PMs can receive alerts when approaching capacity limits (>80% utilization)
FR18: Managers can view PM workload distribution across all PMs
FR19: Managers can reassign projects to balance PM capacity

**Client Communication:**
FR20: PMs can log client conversations with AI transcription integration
FR21: PMs can share project progress reports with clients (tickets completed, in-progress, blocked)
FR22: PMs can schedule sprint reviews and availability windows with clients
FR23: PMs can document client feedback and link to relevant tickets

**Technical Lead (TL) Capabilities**

**Architecture Validation:**
FR24: TLs can review AI-generated architecture decisions in a dedicated review queue
FR25: TLs can approve, reject, or request modifications to AI architecture proposals
FR26: TLs can view architecture decision records (ADRs) documenting AI's choices
FR27: TLs can flag high-risk architecture decisions for deep review vs. spot-check low-risk
FR28: TLs can set architecture patterns and constraints that AI must follow
FR29: TLs can receive AI escalations when it's uncertain about technical decisions

**AI Capability Management:**
FR30: TLs can identify when AI hits capability limits and manually intervene
FR31: TLs can provide technical guidance to AI for complex problems
FR32: TLs can review patterns of AI failures to identify systemic issues
FR33: TLs can document workarounds for known AI limitations

**Lead QA Capabilities**

**Quality Review & Gates:**
FR34: Lead QA can view a sample queue of AI-generated code for review (20% statistical sample)
FR35: Lead QA can configure sampling strategy (percentage, risk-based, random)
FR36: Lead QA can approve code for production deployment (final quality gate)
FR37: Lead QA can reject code with findings and send back to AI for fixes
FR38: Lead QA can view automated QA results (linting, testing, coverage) for each ticket
FR39: Lead QA can define quality gates that must pass before human review
FR40: Lead QA can track bug escape rates and quality trends over time

**QA Metrics & Analysis:**
FR41: Lead QA can view quality dashboards (bug rates, test coverage, review findings by AI tool)
FR42: Lead QA can identify which project types or AI tools have quality issues
FR43: Lead QA can generate quality reports for client transparency

**Manager/Leadership Capabilities**

**Business Oversight:**
FR44: Managers can view overall project portfolio (count, status, revenue)
FR45: Managers can monitor AI compute costs vs. budget in real-time
FR46: Managers can set cost caps per project with automatic alerts
FR47: Managers can view profitability metrics (revenue, costs, margins) per project
FR48: Managers can track progress toward phase goals (15 → 20 → 50 projects)

**Workforce Management:**
FR49: Managers can view team capacity and utilization (PMs, TLs, QA)
FR50: Managers can monitor early warning indicators from Pre-mortem analysis (burnout, costs, quality)
FR51: Managers can access GO/NO-GO decision dashboards at phase gates
FR52: Managers can configure alert thresholds for critical metrics

**Client Relationship:**
FR53: Managers can view client health scores (satisfaction, retention risk)
FR54: Managers can log strategic client meetings and relationship notes
FR55: Managers can segment clients by service tier (AI Express, Hybrid, Premium) (Phase 3)

**AI Dev Tool Orchestrator Capabilities (System)**

**Webhook & Task Intake:**
FR56: System can receive ClickUp webhook events (task created, updated)
FR57: System can parse ticket details (description, acceptance criteria, context documents)
FR58: System can validate ticket quality before routing (reject if incomplete)
FR59: System can extract project context and client information from ticket metadata

**AI Tool Routing & Execution:**
FR60: System can route tickets to appropriate AI tool (Cursor, Windsurf, Antigravity) based on task type
FR61: System can convert ticket requirements into AI-executable prompts
FR62: System can monitor AI execution progress and detect timeouts/failures
FR63: System can retry failed AI executions with error context
FR64: System can route to fallback AI provider if primary fails (Phase 2)
FR65: System can execute AI code generation based on ticket prompts

**Automated QA & Quality Gates:**
FR66: System can run linting checks (ESLint, Prettier, language-specific) on AI-generated code
FR67: System can execute automated tests (unit, integration) and report results
FR68: System can perform basic code review checks (complexity, security patterns, best practices)
FR69: System can calculate test coverage and enforce minimum thresholds
FR70: System can block deployment if quality gates fail
FR71: System can trigger multi-layer AI review (AI #2 reviews AI #1's code) (Phase 2)

**GitHub Integration & Deployment:**
FR72: System can create feature branches per ticket following naming conventions
FR73: System can push AI-generated code to GitHub repository
FR74: System can generate meaningful commit messages from ticket context
FR75: System can create pull requests with traceability links to ClickUp tickets
FR76: System can trigger CI/CD pipelines for automated deployment
FR77: System can monitor deployment status and detect failures
FR78: System can update ClickUp ticket status based on deployment results

**Self-Healing & Production Monitoring:**
FR79: System can monitor production applications for errors and anomalies
FR80: System can detect critical failures requiring immediate attention
FR81: System can automatically create fix tickets in ClickUp when bugs detected
FR82: System can analyze error logs to provide context for fix tickets
FR83: System can prioritize fix tickets by severity and impact
FR84: System can attempt autonomous bug fixes for simple issues (Phase 3)

**Cost Tracking & Optimization:**
FR85: System can track AI API usage (calls, tokens, costs) per project
FR86: System can calculate cost per ticket and cost per project in real-time
FR87: System can alert when project exceeds cost budget
FR88: System can pause AI execution if hard cost cap reached
FR89: System can optimize AI usage through caching common responses (Phase 2)
FR90: System can batch API operations to reduce costs (Phase 2)

**Execution Metrics & Logging:**
FR91: System can log complete audit trail of all AI decisions and actions
FR92: System can track time metrics (ticket → code → deploy timeline)
FR93: System can calculate quality metrics (bug rates, test coverage, review findings)
FR94: System can measure PM productivity (tickets per PM, revision rates)
FR95: System can aggregate metrics across projects for trend analysis

**Dashboard & Reporting Capabilities (Phase 1 MVP)**

**PM Dashboard:**
FR96: PMs can view a dashboard showing their project portfolio with status indicators
FR97: PMs can see ticket execution timeline (from creation to deployment)
FR98: PMs can view AI confidence levels and uncertainty flags
FR99: PMs can access quick actions (approve, reject, escalate, rework)

**Orchestrator Monitoring Dashboard:**
FR100: Operators can view real-time orchestrator status (healthy, degraded, failed)
FR101: Operators can see current queue depth and processing rate
FR102: Operators can view AI provider status (Cursor, Windsurf, Antigravity availability)
FR103: Operators can access execution logs and error details
FR104: Operators can manually intervene or pause execution if needed

**Cost Monitoring Dashboard:**
FR105: Managers can view real-time cost dashboard (daily, weekly, monthly spend)
FR106: Managers can see cost breakdown by project, AI provider, and project type
FR107: Managers can view cost trends and projections
FR108: Managers can compare actual vs. budgeted costs

**Quality Dashboard:**
FR109: Lead QA can view quality metrics dashboard (bug rates, test coverage, deployment success)
FR110: Lead QA can see quality trends over time
FR111: Lead QA can filter quality data by AI tool, project type, or PM

**GO/NO-GO Decision Dashboard:**
FR112: Leadership can view phase gate criteria and current status (Phase 1 → 2 → 3)
FR113: Leadership can see all critical success metrics in one view
FR114: Leadership can access detailed metric history for analysis
FR115: Leadership can export reports for stakeholder communication

**Knowledge Base Capabilities (Phase 2)**
FR116: PMs can contribute client context and domain knowledge to searchable repository
FR117: System can automatically include relevant knowledge base context with tickets
FR118: AI can query knowledge base for client history, preferences, past decisions
FR119: System can identify knowledge gaps and prompt PMs to fill them
FR120: Admins can organize knowledge by client, domain, technology, pattern type

**Client Portal Capabilities (Phase 3)**
FR121: Clients can log in to view their project portfolio and status
FR122: Clients can see transparent progress tracking (tickets in-flight, completed, blocked)
FR123: Clients can schedule communication windows with PM/Manager
FR124: Clients can view AI involvement transparency (which tasks AI-driven vs. human-led)
FR125: Clients can opt-in or opt-out of AI-driven development for their projects
FR126: Clients can access project metrics (velocity, quality, timelines)
FR127: Clients can submit feedback and new requirements directly

**Advanced Capabilities (Phase 3)**
FR128: System can predict project complexity, risk, and cost before starting
FR129: System can recommend optimal AI tool mix for new projects
FR130: System can forecast PM capacity needs based on pipeline
FR131: System can intelligently route tasks across multiple AI providers for optimization
FR132: System can fail over to backup providers if primary unavailable
FR133: System can compare AI provider performance and costs for routing decisions
FR134: System can autonomously detect bugs, generate fixes, test, and deploy patches
FR135: System can learn from past fixes to improve future bug resolution
FR136: System can escalate only when autonomous fix fails

**Claude Code Integration (Detailed)**
FR137: Claude Code provider MUST use the `claude` CLI tool directly for execution via node-pty.
FR138: Claude Code provider MUST accept a task description and acceptance criteria as a "ticket" input.
FR139: Claude Code provider MUST NOT manually construct context files or prompts; it should rely on Claude Code's agentic capabilities.
FR140: Claude Code provider MUST allow the agent to manage its own workspace (cloning, file navigation) without external pre-loading of context.
FR141: Remove legacy/junk code related to manual context loading and complex prompt building.

**Task Intake Reliability:**
FR142: System must support re-triggering AI intake for existing tickets when status matches actionable state.
FR143: System must trigger AI intake when ClickUp tasks are synced manually from the UI.
FR144: System must trigger AI intake when ClickUp tasks are updated via webhook to an actionable status.
FR145: System must prevent duplicate AI executions for the same task state.

### NonFunctional Requirements

**Performance Requirements**
NFR-P1: Orchestrator must process ClickUp webhook events within 5 seconds of receipt
NFR-P2: Dashboard interfaces must load within 2 seconds for typical data volumes
NFR-P3: Real-time metrics must update with <10 second latency
NFR-P4: AI routing decision must complete within 10 seconds
NFR-P5: Quality gate checks (linting, testing) must complete within reasonable time for deployment velocity
NFR-P6: System must support ticket → deployed code pipeline completing in hours (not days)
NFR-P7: System must handle concurrent execution of 10+ AI tasks simultaneously
NFR-P8: Cost calculation and tracking must occur in real-time (not batch processed)

**Security Requirements**
NFR-S1: All human users must authenticate via OAuth (leverage AetherFlow existing auth)
NFR-S2: Role-based access control (RBAC) must enforce PM/TL/QA/Manager permissions
NFR-S3: API keys for AI providers must be encrypted at rest (AES-256-GCM minimum)
NFR-S4: Sensitive credentials never logged or exposed in error messages
NFR-S5: Complete audit trail must log all AI decisions, human approvals, code deployments
NFR-S6: Audit logs must be immutable and tamper-proof
NFR-S7: System must support compliance reporting for client requests
NFR-S8: Client data isolation must be maintained (no cross-contamination between projects)
NFR-S9: AI-generated code must pass security scanning (OWASP, dependency vulnerabilities)
NFR-S10: Secrets detection must prevent accidental commit of credentials
NFR-S11: GitHub integration must use fine-grained tokens with minimal permissions

**Scalability Requirements**
NFR-SC1: System must scale from 15 → 50+ projects without architecture changes
NFR-SC2: System must support 50+ concurrent AI executions (Phase 3 target)
NFR-SC3: Database must handle 100K+ tickets, executions, metrics records
NFR-SC4: Cost monitoring must scale to track hundreds of projects without performance degradation
NFR-SC5: System must support 5-7 PMs, 3-4 TLs, 2-3 QA, 2 Managers concurrently
NFR-SC6: Dashboards must handle 10+ simultaneous user sessions
NFR-SC7: Webhook ingestion must queue and process high volumes (100+ events/hour)
NFR-SC8: AI compute costs must remain <30% of project revenue as volume scales
NFR-SC9: Infrastructure costs must scale sub-linearly with project volume

**Reliability & Availability Requirements**
NFR-R1: Orchestrator must maintain 99% uptime (some downtime acceptable for MVP)
NFR-R2: System failures must not corrupt project data or lose ticket status
NFR-R3: Failed AI executions must be recoverable (retry with context)
NFR-R4: AI timeouts must escalate to human review (not silently fail)
NFR-R5: GitHub push failures must alert PM immediately
NFR-R6: Deployment failures must trigger rollback and notification
NFR-R7: Cost cap exceeded must pause execution (not continue accumulating charges)
NFR-R8: All ticket data, execution logs, and metrics must be persisted reliably
NFR-R9: System must support backup and recovery procedures
NFR-R10: No data loss acceptable for audit trails and client work

**Integration Requirements**
NFR-I1: Must integrate seamlessly with AetherFlow platform (80% existing infrastructure)
NFR-I2: Must use AetherFlow's authentication, database, and security infrastructure
NFR-I3: Must maintain AetherFlow's ClickUp and GitHub integration patterns
NFR-I4: Must support Cursor, Windsurf, Antigravity APIs via standardized interface
NFR-I5: Must handle AI provider API changes gracefully (versioning, deprecation)
NFR-I6: Must support adding new AI providers without code changes (Phase 2)
NFR-I7: ClickUp webhooks must be reliable (handle retries, duplicates)
NFR-I8: GitHub API must support automation (branch creation, PRs, pushes)
NFR-I9: CI/CD pipeline triggers must be provider-agnostic (GitHub Actions, Jenkins, etc.)
NFR-I10: Monitoring tools must integrate via standard APIs (Datadog, Prometheus, etc.)
NFR-I11: Integration must use the locally installed `claude` CLI available in the environment.
NFR-I12: Integration must maintain the existing `AIProvider` interface for compatibility with the Orchestrator.

**Observability & Monitoring Requirements**
NFR-O1: All system components must log structured JSON for analysis
NFR-O2: Logs must include correlation IDs to trace requests across systems
NFR-O3: Log retention must support 90+ days for debugging and compliance
NFR-O4: Sensitive data must be redacted from logs
NFR-O5: System must expose Prometheus-compatible metrics endpoints
NFR-O6: Critical failures must trigger real-time alerts (Slack, email, SMS)
NFR-O7: Cost threshold breaches must alert immediately
NFR-O8: PM burnout indicators must alert manager when thresholds crossed
NFR-O9: All dashboards must support drill-down for root cause analysis
NFR-O10: Metrics must be exportable for external reporting
NFR-O11: Dashboards must support filtering by project, PM, AI tool, time range

**Maintainability & Operations Requirements**
NFR-M1: Orchestrator codebase must maintain >80% test coverage
NFR-M2: Code must follow AetherFlow's style guides and patterns
NFR-M3: Architecture must be documented for future developers
NFR-M4: Configuration must be externalized (no hard-coded values)
NFR-M5: System must support zero-downtime deployments
NFR-M6: Rollback must be possible within 5 minutes
NFR-M7: Infrastructure must be defined as code (Terraform, CloudFormation, etc.)
NFR-M8: System must provide health check endpoints
NFR-M9: System must support feature flags for gradual rollout
NFR-M10: System must have runbooks for common failure scenarios

**Usability & User Experience Requirements**
NFR-UX1: All dashboards must be responsive (desktop primary, mobile monitoring)
NFR-UX2: Critical actions (approve, reject, escalate) must be <3 clicks from dashboard
NFR-UX3: Alert notifications must be actionable (include context and quick actions)
NFR-UX4: Complex workflows must provide progress indicators
NFR-UX5: Error messages must be clear and suggest remediation steps
NFR-UX6: PM dashboard must show all projects at-a-glance without scrolling
NFR-UX7: Ticket quality indicators must be visible before submission
NFR-UX8: Workload indicators must use visual cues (red/yellow/green)
NFR-UX9: New PMs must be productive within 1 week of training
NFR-UX10: System must provide contextual help and tooltips
NFR-UX11: Common tasks must be self-explanatory (minimal training needed)

**Compliance & Governance Requirements**
NFR-C1: System must clearly indicate which work was AI-generated vs. human-reviewed
NFR-C2: Clients must be able to request human-only development if needed
NFR-C3: System must provide traceability from client requirement → ticket → code → deployment
NFR-C4: Client code and data must not be used to train AI models (check AI provider terms)
NFR-C5: Client projects must be isolated (no data leakage between clients)
NFR-C6: System must support client data export and deletion requests
NFR-C7: System must log which AI provider generated each piece of code (liability attribution)
NFR-C8: System must support insurance reporting for AI-generated code claims
NFR-C9: Human approval gates must be documented for liability protection

### Additional Requirements

**From Architecture:**

- **NestJS Architecture**: Use NestJS CLI to initialize project: `npx @nestjs/cli new ai-dev-orchestrator`.
- **Primary AI Provider**: Use **Cursor CLI Headless** as the primary AI provider for code generation.
- **Fallback AI Provider**: Use **Claude Code** (via `claude` CLI and node-pty) as a fallback provider.
- **Database**: Use a separate **PostgreSQL 16.x** instance for the Orchestrator (service independence).
- **Asynchronous Processing**: Use **RabbitMQ** for task queues and event handling.
- **Input Mechanism**: Implement **ClickUp Webhooks** for reliable task intake.
- **Version Control**: Integrate with **GitHub** for repository management, branching, and PRs.
- **Logging**: Use **Winston** for structured JSON logging.
- **Monitoring**: Implement **Prometheus + Grafana** for metrics and dashboards.
- **Containerization**: Use Docker (Dockerfile, Dockerfile.dev, docker-compose.yml) for consistent environments.
- **Validation**: Strict TypeScript and class-validator for data integrity.

**From UX Design:**

- **Design System**: Use **shadcn/ui** (Tailwind CSS based) for a modern, accessible, and laptop-optimized interface.
- **PM Dashboard**: Implement a **Card-Based Project Gallery** (Approach 1) as the primary view, with an option to toggle to Kanban.
- **Real-Time Feedback**: Ensure AI execution updates happen every 2-3 seconds via Socket.IO.
- **Visualization**: Use color-coded status indicators (Slate, Electric Blue, Emerald/Success, Amber/Warning).
- **Architecture Review**: Implement a specific "Technical Lead Architecture Review Queue" with split-view for ADR analysis.
- **QA Sampling**: Create a "Lead QA Statistical Sampling" queue for random code verification.
- **Responsiveness**: Focus on Desktop layout (Three-column grid) but ensure functionality on Mobile (Single column, simplified metrics).

### FR Coverage Map

### Active & Backlog Coverage

**Docker & Execution (Epic 22/23):**

- **FR-ADD-1 (Containerization):** Epic 22 - Docker Client & Image Management
- **FR66 (Linting):** Epic 22 - Isolated Linting Environment
- **FR67 (Testing):** Epic 22 - Isolated Test Execution
- **NFR-S9 (Isolation):** Epic 22 - Sandbox Isolation
- **NFR-SC2 (Concurrency):** Epic 23 - Container Lifecycle & Resource Limits
- **NFR-P6 (Pipeline Speed):** Epic 23 - Warm Containers

**Reliability (Epic 20):**

- **FR56 (Webhooks):** Epic 20 - Robust Handling
- **FR142-145 (Intake Reliability):** Epic 20 - Deduplication & Sync status

**Completed Coverage (Summary):**

- **FR1-55 (Roles):** Epics 1-7, 16, 17 (PM/TL/QA/Mgr Capabilities)
- **FR56-78 (System):** Epics 1-6, 11-14 (Core Orchestrator, logs, git)
- **FR79-84 (Self Healing):** Epic 13 (AI Self-Healing)
- **FR85-90 (Cost):** Epic 13 (Cost Tracking)
- **FR91-95 (Metrics):** Epics 11, 14 (Audit & Observability)
- **FR96-127 (Dashboards):** Epics 7, 17, 18 (UI & Auth)
- **FR137-141 (Claude):** Epic 19 (Claude Code Integration)
- **FR146-149 (GitHub Accounts):** Epic 24 (Multi-Account Integration)

## Epic List

### Phase 1-3: Core Foundation (Completed)

_Epics 1-19, 21 covering the MVP Core, User Interfaces, AI Enhancements, and initial Reliability features are largely complete. See `sprint-status.yaml` for details._

### Epic 20: AI Task Pickup Reliability (Active Refactor)

**Goal:** Ensure 100% reliable task intake from ClickUp, preventing duplicates and ensuring no tickets are "lost".
**FRs Covered:** FR56, FR142-145, NFR-R2.

### Epic 22: Docker-Controlled Execution Engine (Active)

**Goal:** Implement a secure, isolated Docker-based execution environment for AI agents to ensure consistency, prevent system contamination, and manage dependencies effectively. This replaces the local process execution with containerized agents.
**User Value:**

- **Consistency:** "Works on my machine" issues eliminated by identical Docker environments.
- **Security:** AI agents (Claude/Cursor) run in isolated sandboxes, preventing host system damage.
- **Scalability:** Prerequisite for concurrent execution (Epic 23).
  **Stories:**
- **22-1:** Docker Client Integration (Done)
- **22-2:** Base Agent Image Management (Backlog - **Validation Target**)
- **22-3:** Sandbox Workspace Mounting (Backlog)
- **22-4:** Container Execution Log Streaming (Backlog)

### Epic 23: Intelligent Sandbox Lifecycle & Optimization (Backlog)

**Goal:** Optimize container management to handle high-concurrency (50+) AI tasks.
**User Value:** Enables scaling to multiple concurrent projects.
**FRs Covered:** NFR-SC2, NFR-P6, NFR-M6.

## Epic Details

### Epic 22: Docker-Controlled Execution Engine

**Goal:** Implement a secure, isolated Docker-based execution environment for AI agents to ensure consistency, prevent system contamination, and manage dependencies effectively.

#### Story 22-1: Docker Client Integration (Completed)

_Status: Done. Implemented DockerService with dockerode._

#### Story 22-2: Base Agent Image Management

As a Technical Lead,
I want a standardized Docker image for AI agents,
So that all AI execution happens in a consistent, controlled environment matching production constraints.

**Acceptance Criteria:**

**Given** the project `docker/` directory exists
**When** I inspect the `Dockerfile.base`
**Then** it should attempt to build a Node.js based image (likely `node:20-slim` or similar)
**And** it should install essential system tools: `git`, `python3` (for node-pty), `make`, `g++`, `curl`
**And** it should configure a non-root user `agent` with correct UID/GID mapping capabilities
**And** it should set the working directory to `/home/agent/workspace`
**And** the build command `docker build -t dsf-agent-base -f docker/Dockerfile.base .` should complete successfully
**And** I should be able to run `docker run --rm dsf-agent-base node -v` and see the version output.

#### Story 22-3: Sandbox Workspace Mounting

As a System Orchestrator,
I want to mount the ephemeral workspace into the Docker container,
So that the AI agent can read/write files that persist for the duration of the task but don't contaminate the host.

**Acceptance Criteria:**

**Given** a running `PtyExecutionService` and a workspace at `/tmp/dsf/workspaces/{id}`
**When** I request to spawn a Docker container for this task
**Then** the service should construct a `docker run` (or `docker create`) command
**And** it should include a bind mount `-v /tmp/dsf/workspaces/{id}:/home/agent/workspace`
**And** it should ensure the directory permissions allow the container user `agent` to write to it
**And** any file created inside the container should be visible on the host at the workspace path.

#### Story 22-4: Container Execution Log Streaming

As a Developer/Operator,
I want to stream the output of the containerized process (stdout/stderr),
So that I can see the AI's execution progress in real-time on the dashboard.

**Acceptance Criteria:**

**Given** a running Docker container executing an AI task
**When** the process emits output (logs, errors, CLI prompts)
**Then** the `PtyExecutionService` (wrapping `docker exec` or attached to the container) should capture this stream
**And** it should forward the data to the `ExecutionTracker` via the existing `onData` callback
**And** it should handle TTY resizing events (getting terminal rows/cols) passed to the Docker session.

---

### Epic 24: GitHub Multi-Account Integration & Repository Selection

**Goal:** Enable users to connect multiple GitHub accounts to their profile and assign specific repositories to projects, ensuring the AI execution engine has the correct authentication configuration for cloning and pushing to private repositories.

**User Value:** Solves the critical blocker of AI execution failing due to lack of authentication when projects span across multiple different client GitHub accounts.

**FRs Covered:** FR146-FR149, NFR-S3, NFR-S11.

#### Story 24-1: GitHub App Flow for Multiple Accounts

As a PM,
I want to connect multiple GitHub accounts securely,
So that I can eventually pick repositories from any of my client accounts.

**Acceptance Criteria:**

- Create GitHub App integration capable of requesting installation/user-to-server tokens.
- UI allows adding a new GitHub account.
- Successfully connected accounts are displayed with their username/avatar.

#### Story 24-2: Repository Selector in Project Setup

As a PM,
I want to select a specific repository from my connected GitHub accounts for a project,
So the orchestrator knows where to commit code.

**Acceptance Criteria:**

- Provide a UI on the Project page to select a connected GitHub account.
- Fetch and display the list of accessible repositories for that account.
- Save the selected Repository ID and associated Account ID to the project.

#### Story 24-3: Execution Token Retrieval

As the AI Orchestrator,
I need to securely retrieve the correct GitHub token based on the project's selected repository,
So I can perform git clone, fetch, and push without auth errors.

**Acceptance Criteria:**

- Orchestrator checks the `project.github_account_id`.
- Retrieves the correct OAuth or installation token from the secure vault/database.
- Injects the authenticated URL or token into the AI sandbox environment correctly.

---

## QA Stabilization Sprint — Requirements Inventory (Feb 27, 2026)

> Source: `docs/QA-REPORT-2026-02-27.md` — 46 issues discovered across backend, frontend, and UX.
> Overall grade: C+ → B+ once Critical and High items resolved.

### QA Functional Requirements

**Backend Fixes:**

QA-FR1: Backend must enforce GITHUB_WEBHOOK_SECRET HMAC validation on /webhooks/github — currently entirely bypassed (BE-1 CRITICAL)
QA-FR2: Wildcard route /api/* must be renamed to /api/*path for path-to-regexp v8 compatibility (BE-2 HIGH)
QA-FR3: ActionableStatusService must be removed and all usages replaced with StatusEvaluationService (BE-3 HIGH)
QA-FR4: PtyExecutionService.execution.update() must guard against non-existent records on startup (BE-4 HIGH)
QA-FR5: Backend must expose GET /api/v1/locks/active endpoint returning currently active file locks (BE-14 HIGH)
QA-FR6: POST /api/v1/telemetry/shortcut payload must match CreateShortcutTelemetryDto field contract (BE-13 MEDIUM)

**Frontend Critical Fixes:**

QA-FR7: /cost route must be registered in App.tsx and render CostAnalysisPage (FE-1 CRITICAL)
QA-FR8: /admin/users page must handle paginated API response shape without crashing on undefined totalPages (FE-2 HIGH)
QA-FR9: /admin/invitations page must guard against undefined data before passing to TanStack Table (FE-3 HIGH)
QA-FR10: WorkloadCapacityPage must use useAuth().user?.id and user?.role instead of localStorage keys (FE-13/BE-11/BE-12 HIGH)
QA-FR11: Recharts chart containers must have explicit height or minWidth:0 to prevent zero-dimension render errors on /financial-metrics, /observability, /production-errors (FE-5 HIGH)
QA-FR12: React QueryClient must be configured with global staleTime (≥60s) to prevent duplicate API calls on every mount (FE-14 HIGH)
QA-FR13: useSocket must be centralized in a single SocketProvider context app-wide (FE-14 HIGH)
QA-FR14: Notification queries must use staleTime:30000 + refetchInterval:30000 to prevent rate-limit 429 errors (FE-17 HIGH)
QA-FR15: /notifications/preferences page must handle undefined data gracefully with initialData guard (FE-4 MEDIUM)

**PM Dashboard Feature Completion:**

QA-FR16: PM Dashboard "New Project" button must open a creation dialog with fields: Name, Client, ClickUp Workspace, GitHub Repo (FE-6 HIGH)
QA-FR17: PM Dashboard Filter button must open a functional filter panel (Status, Date Range, Client) (FE-7 HIGH)
QA-FR18: PM Dashboard Sort button must open a functional sort dropdown (Last Activity, Name, Ticket Count, Blocked) (FE-8 HIGH)
QA-FR19: PM Dashboard Grid/List toggle must switch between card-grid and table-row layouts (FE-9 HIGH)
QA-FR20: FinancialMetricsSection widget on PM Dashboard must be wrapped with MANAGER/ADMIN role guard (FE-15 MEDIUM)
QA-FR21: Dashboard useEffect must use reactive auth state (useAuth user.id) not localStorage token string (FE-16 MEDIUM)

**Page Error States:**

QA-FR22: Observability page must show graceful degradation state when Docker is unavailable in dev (FE-10 MEDIUM)
QA-FR23: Architecture Constraints page must show only one state (empty OR error) — not both simultaneously (FE-11 MEDIUM)
QA-FR24: App.tsx catch-all route must render a proper 404 Not Found page with "Go to Dashboard" CTA (S-1 HIGH)

**UI Polish & Global UX:**

QA-FR25: Sidebar "Last sync" text must display a dynamic timestamp from the last successful API call (UI-1/FE-12 MEDIUM)
QA-FR26: All pages must set page-specific document.title (e.g., "Users — DSF", "Financial Metrics — DSF") (UI-5 MEDIUM)
QA-FR27: Application must implement mobile/tablet navigation (hamburger menu or bottom tab bar) — currently broken on all sub-1024px screens (UI-9/S-2 HIGH)
QA-FR28: Notification bell must display a badge/count reflecting the real unread count from the API (UI-6 MEDIUM)
QA-FR29: Real-time "Live" badge must be visible in both dark and light modes (contrast ratio fix) (UI-7 LOW)
QA-FR30: Sidebar collapse/expand must use a consistent icon pair (UI-4 LOW)

**PM Dashboard KPI Enhancements:**

QA-FR31: PM Dashboard must add AI Execution Success Rate metric (% completed vs failed/reworked) (STAT-1)
QA-FR32: PM Dashboard must add Avg Time to Complete a Ticket in hours (QUEUED → COMPLETED) (STAT-2)
QA-FR33: PM Dashboard must add Cost per Ticket for current month (AI spend ÷ completed tickets) (STAT-3)
QA-FR34: PM Dashboard must add Budget Burn Rate trend chart (daily spend vs monthly ceiling + forecast line) (STAT-4)
QA-FR35: PM Dashboard must add PR Merge Rate (% auto-generated PRs merged without manual rework) (STAT-5)
QA-FR36: PM Dashboard must add QA First-Pass Rate (% executions passing QA on first attempt) (STAT-6)
QA-FR37: PM Dashboard must add Live Active/Queued Executions real-time counter via Socket.IO (STAT-7)
QA-FR38: PM Dashboard must add AI Provider Distribution chart (Claude / Cursor / Windsurf % breakdown) (STAT-8)

### QA Non-Functional Requirements

QA-NFR1: GitHub webhook HMAC validation must be enforced on every inbound request to /webhooks/github
QA-NFR2: Notification polling must not exceed 1 request per 30s per endpoint to respect rate limits
QA-NFR3: Each page navigation must result in ≤1 API call per unique data endpoint (no duplicate component mounts)
QA-NFR4: All React pages must be wrapped in error boundaries — no blank white page crashes in production
QA-NFR5: Auth state must be fully resolved before child components fire any API requests (enabled: !!user guard pattern)
QA-NFR6: All dashboard charts must render correctly on first paint without requiring a resize or re-render event
QA-NFR7: In-memory webhook deduplication must be replaced with Redis-backed set for multi-instance safety (Phase 2 prerequisite)

### QA Additional Requirements

- **Auth race condition:** AppContent must render null (not spinner) during auth re-evaluation so child components never mount mid-check and fire premature 401 requests
- **Docker health endpoint:** /api/v1/health must explicitly surface Docker connectivity status so the UI can show a "Docker unavailable" degradation state
- **SENDGRID_API_KEY:** Missing state must surface in Settings UI (Notifications panel) — user invitations and password reset are silently broken without it
- **OPENAI_API_KEY:** Missing state must surface in Settings UI (Integrations panel) — Conversations transcription is disabled without it
- **SLACK_BOT_TOKEN:** Missing state must surface in Settings UI (Notifications panel) — all Slack alerts are silently dropped without it

### QA FR Coverage Map

QA-FR1: Epic 25 — GitHub webhook security hardening
QA-FR2: Epic 25 — Backend route compatibility fix
QA-FR3: Epic 25 — Dead code removal and service cleanup
QA-FR4: Epic 25 — Startup stability fix
QA-FR5: Epic 25 — Missing locks/active backend endpoint
QA-FR6: Epic 25 — Telemetry DTO contract fix
QA-FR7: Epic 25 — Missing /cost frontend route
QA-FR8: Epic 25 — Admin users page crash fix
QA-FR9: Epic 25 — Admin invitations page crash fix
QA-FR10: Epic 25 — WorkloadCapacityPage auth fix
QA-FR11: Epic 25 — Recharts zero-dimension fix
QA-FR12: Epic 25 — QueryClient global staleTime
QA-FR13: Epic 25 — SocketProvider centralization
QA-FR14: Epic 25 — Notification rate limit fix
QA-FR15: Epic 25 — Notification preferences guard
QA-FR16: Epic 26 — New Project creation dialog
QA-FR17: Epic 26 — Filter panel implementation
QA-FR18: Epic 26 — Sort dropdown implementation
QA-FR19: Epic 26 — Grid/List view toggle
QA-FR20: Epic 26 — Financial metrics role guard
QA-FR21: Epic 26 — Reactive auth in Dashboard useEffect
QA-FR22: Epic 26 — Observability graceful degradation
QA-FR23: Epic 26 — Constraints page mutual-exclusion state
QA-FR24: Epic 27 — Proper 404 page
QA-FR25: Epic 27 — Dynamic last sync timestamp
QA-FR26: Epic 27 — Per-page document.title
QA-FR27: Epic 27 — Mobile/tablet navigation
QA-FR28: Epic 27 — Notification bell badge
QA-FR29: Epic 27 — Live badge light-mode contrast
QA-FR30: Epic 27 — Sidebar icon consistency
QA-FR31: Epic 26 — AI Execution Success Rate KPI
QA-FR32: Epic 26 — Avg Ticket Completion Time KPI
QA-FR33: Epic 26 — Cost per Ticket KPI
QA-FR34: Epic 26 — Budget Burn Rate chart
QA-FR35: Epic 26 — PR Merge Rate KPI
QA-FR36: Epic 26 — QA First-Pass Rate KPI
QA-FR37: Epic 26 — Live Active/Queued executions counter
QA-FR38: Epic 26 — AI Provider Distribution chart

---

## QA Stabilization Sprint — Epic List

### Epic 25: QA Stabilization — Critical & High Bug Fixes

Every page loads without crashing. No backend startup errors. Security vulnerabilities are closed. Rate limits are respected. The system is reliable for all authenticated users.

**FRs covered:** QA-FR1, QA-FR2, QA-FR3, QA-FR4, QA-FR5, QA-FR6, QA-FR7, QA-FR8, QA-FR9, QA-FR10, QA-FR11, QA-FR12, QA-FR13, QA-FR14, QA-FR15
**NFRs covered:** QA-NFR1, QA-NFR2, QA-NFR3, QA-NFR4, QA-NFR5, QA-NFR6

### Epic 26: PM Dashboard Feature Completion & Operational KPIs

PMs can create projects, filter and sort their portfolio, and switch between grid and list views. Eight new operational KPI widgets give real-time insight into AI execution health, cost burn rate, quality trends, and provider distribution — all from a single dashboard.

**FRs covered:** QA-FR16, QA-FR17, QA-FR18, QA-FR19, QA-FR20, QA-FR21, QA-FR22, QA-FR23, QA-FR31, QA-FR32, QA-FR33, QA-FR34, QA-FR35, QA-FR36, QA-FR37, QA-FR38

### Epic 27: Platform Polish, Global UX & Mobile Navigation

The application works on tablets and phones. Every page has a descriptive browser tab title. A proper 404 page exists for unknown routes. Integration health (Docker, SendGrid, OpenAI, Slack) is visible in Settings so administrators know exactly what is configured.

**FRs covered:** QA-FR24, QA-FR25, QA-FR26, QA-FR27, QA-FR28, QA-FR29, QA-FR30
**Additional:** Auth race condition, Docker health endpoint, integration health panel

---

## Epic 25: QA Stabilization — Critical & High Bug Fixes

Every page in the application loads without crashing. No backend startup errors or security vulnerabilities. Rate limits are respected. The application is stable and reliable for all authenticated users.

### Story 25.1: Backend Startup Health

As a DevOps Engineer,
I want the NestJS backend to start cleanly without errors or deprecation warnings,
So that the production environment is reliable and startup logs are free of misleading noise.

**Acceptance Criteria:**

**Given** the backend starts with `pnpm start:dev`
**When** the server process completes initialization
**Then** no `ERROR` or `WARN` log entries appear for path-to-regexp, deprecated services, or Prisma record-not-found
**And** the `/api/*` wildcard route is renamed to `/api/*path` in whichever controller or middleware defines it
**And** `ActionableStatusService` class is deleted from the codebase and its module import removed
**And** all former call sites of `ActionableStatusService` now call `StatusEvaluationService` directly
**And** `PtyExecutionService.execution.update()` is wrapped in an existence check (try/catch or `updateMany` with `where`) that skips the update gracefully if the record does not exist
**And** running `pnpm start:dev` emits zero ERROR/WARN lines related to these three issues

---

### Story 25.2: GitHub Webhook Security Hardening

As a Security Engineer,
I want GitHub webhook requests to have their HMAC signature verified on every inbound request,
So that arbitrary actors cannot inject malicious payloads into the orchestration pipeline.

**Acceptance Criteria:**

**Given** `GITHUB_WEBHOOK_SECRET` is set correctly in `.env`
**When** a POST arrives at `/api/v1/webhooks/github`
**Then** `GitHubWebhookSignatureGuard` validates the `X-Hub-Signature-256` header against the raw request body using the configured secret
**And** requests with a valid signature are processed normally
**And** requests without a valid or matching signature receive `401 Unauthorized`
**And** the startup log no longer shows `GITHUB_WEBHOOK_SECRET is not configured!`

**Given** `GITHUB_WEBHOOK_SECRET` is NOT set in `.env`
**When** the server starts
**Then** a clear startup `WARN` appears: `"GITHUB_WEBHOOK_SECRET is not configured — webhook HMAC validation is disabled"`
**And** the application still starts (non-fatal) but all inbound webhook requests are logged as unverified

---

### Story 25.3: Missing Backend API Endpoints

As a Frontend Developer,
I want `GET /api/v1/locks/active` and a correctly-shaped `POST /api/v1/telemetry/shortcut` to exist on the backend,
So that the Resource Manager page and keyboard shortcut telemetry work without 404 or 400 errors.

**Acceptance Criteria:**

**Given** an authenticated user navigates to `/resource-manager`
**When** the page polls `GET /api/v1/locks/active`
**Then** the endpoint returns `HTTP 200` with an array of currently active file locks (empty array `[]` when none exist)
**And** no 404 errors appear in the browser network tab for this endpoint
**And** the Resource Manager page no longer shows a permanent "Request failed with status code 404" error banner

**Given** an authenticated user triggers a keyboard shortcut on the Dashboard
**When** the frontend fires `POST /api/v1/telemetry/shortcut` with `{ shortcut: "N" }` (or similar string)
**Then** the endpoint returns `HTTP 201`
**And** `CreateShortcutTelemetryDto` accepts `shortcut` as a required `string` field matching the frontend payload shape

---

### Story 25.4: Critical Frontend Route & Page Crash Fixes

As an Administrator,
I want `/cost`, `/admin/users`, and `/admin/invitations` to render without crashing,
So that I can access Cost Analysis and fully manage users and invitations from the admin panel.

**Acceptance Criteria:**

**Given** any authenticated user clicks "Cost Analysis" in the sidebar
**When** the browser navigates to `/cost`
**Then** the `CostAnalysisPage` component renders (or the route redirects to `/financial-metrics` if Cost Analysis is the same page)
**And** the PM Dashboard is NOT rendered at `/cost`
**And** the browser title reads "Cost Analysis — DSF" (not "PM Dashboard — DSF")

**Given** an authenticated ADMIN navigates to `/admin/users`
**When** `GET /api/v1/users` returns a paginated response
**Then** `UsersPage` correctly reads `totalPages` from the actual API response shape (e.g., `res.data.meta.totalPages`)
**And** no `TypeError: Cannot read properties of undefined (reading 'totalPages')` is thrown
**And** the users table renders (empty state if no users, populated list if users exist)

**Given** an authenticated ADMIN navigates to `/admin/invitations`
**When** `GET /api/v1/auth/invitations` returns data
**Then** `InvitationsTable` initializes with `data ?? []` as a safe fallback before the query resolves
**And** no `TypeError: Cannot read properties of undefined (reading 'rows')` is thrown
**And** the table renders a loading skeleton while the query is in-flight, then shows invitations or an empty state

---

### Story 25.5: Workload Capacity Page Auth Fix

As a PM or Manager,
I want the Workload Capacity page to load my actual workload data using my real authenticated user ID,
So that the page works correctly without generating 404 or 400 API errors.

**Acceptance Criteria:**

**Given** an authenticated user navigates to `/capacity-monitor`
**When** `WorkloadCapacityPage` mounts
**Then** `pmId` is read from `useAuth().user?.id` — NOT `localStorage.getItem('userId')`
**And** `userRole` is read from `useAuth().user?.role` — NOT `localStorage.getItem('userRole')`
**And** `GET /api/v1/workload/pm/{realUUID}` returns `200` with the user's real workload data
**And** `GET /api/v1/workload/trends/{realUUID}?days=30` returns `200`
**And** zero 404 or 400 errors appear in the network tab for workload endpoints

**Given** an ADMIN or MANAGER user is on `/capacity-monitor`
**When** `isManager` is evaluated
**Then** it is derived from `user?.role` being `MANAGER` or `ADMIN`
**And** the "Team Capacity" chart is displayed for those roles

---

### Story 25.6: React Query Performance & Socket Centralization

As a Frontend Developer,
I want duplicate API calls eliminated and Socket.IO connections centralized into a single provider,
So that the backend is not overloaded with redundant requests and the notification rate limiter is not triggered during normal navigation.

**Acceptance Criteria:**

**Given** the `QueryClient` is initialized in `main.tsx` or `App.tsx`
**When** `QueryClient` is configured
**Then** `defaultOptions.queries.staleTime` is set to at least `60_000` (60 seconds)
**And** `GET /api/v1/auth/me` fires no more than once per page navigation (down from 4–6×)
**And** `GET /api/v1/pm-dashboard/summary` and `GET /api/v1/pm-dashboard/projects` each fire no more than once per navigation

**Given** the application mounts
**When** a `SocketProvider` context wraps `AppContent`
**Then** a single Socket.IO connection is established app-wide and shared via React context
**And** neither `Dashboard` nor `WorkloadCapacityPage` nor any other component creates an independent second connection
**And** the browser network tab shows exactly one WebSocket connection to the backend at any time

---

### Story 25.7: Chart Rendering Fix

As a Manager or Lead QA,
I want charts on `/financial-metrics`, `/observability`, and `/production-errors` to render correctly on first load,
So that I see meaningful data visualizations without needing to resize my browser window.

**Acceptance Criteria:**

**Given** a user navigates to any page containing Recharts components
**When** the page first renders
**Then** no console errors reading `"The width(-1) and height(-1) of chart should be greater than 0"` appear
**And** all 4 charts on `/financial-metrics` render with correct positive dimensions on first paint
**And** all 4 charts on `/observability` render with correct positive dimensions on first paint
**And** both charts on `/production-errors` render with correct positive dimensions on first paint

**Given** the fix is applied
**When** a developer inspects the chart containers
**Then** flex parent containers have `minWidth: 0` applied, OR `<ResponsiveContainer>` components use an explicit `height` prop (e.g., `height={300}`) instead of `height="100%"` inside unsized containers

---

### Story 25.8: Notification Stability

As any authenticated user,
I want in-app notifications to load reliably without hitting rate limits,
So that the notification bell always shows accurate unread counts and the preferences page is usable.

**Acceptance Criteria:**

**Given** the Header component mounts (on every page)
**When** notification queries are configured
**Then** `GET /api/v1/notifications/in-app` uses `staleTime: 30_000` and `refetchInterval: 30_000`
**And** `GET /api/v1/notifications/in-app/unread-count` uses the same stale/refetch settings
**And** navigating through 5 or more pages in a session does NOT trigger a `429 Too Many Requests` response for notification endpoints
**And** the notification bell count updates at most once every 30 seconds

**Given** a user navigates to `/notifications/preferences`
**When** the preferences query resolves
**Then** the page renders the notification preferences form with populated fields
**And** if the query returns `undefined` or empty data, an `initialData` fallback renders a default preferences form instead of the error message `"Failed to load preferences — data is undefined"`

---

## Epic 26: PM Dashboard Feature Completion & Operational KPIs

PMs can create projects, filter and sort their portfolio, and switch between grid and list views. Eight new KPI widgets give real-time insight into AI execution health, cost, quality, and provider distribution from the dashboard.

### Story 26.1: New Project Creation Dialog

As a PM,
I want to create a new project directly from the PM Dashboard,
So that I can onboard a new client project without navigating away from my portfolio view.

**Acceptance Criteria:**

**Given** a PM is on the PM Dashboard
**When** they click the "New Project" button
**Then** a `<Dialog>` or slide-in `<Sheet>` opens with the following fields: Project Name (required text), Client Name (required text), ClickUp Workspace ID (required text), GitHub Repository URL (optional text)
**And** all required fields show inline validation errors if submitted empty

**Given** the PM fills in all required fields and clicks "Create Project"
**When** the form submits
**Then** `POST /api/v1/projects` is called with the form data
**And** on success the dialog closes and the new project card appears in the dashboard grid
**And** a success toast shows "Project created successfully"
**And** on failure an error message renders inside the dialog (dialog does not close)

**Given** the PM clicks the "New Project" button
**When** the dialog opens
**Then** no toast stub fires as the only response — the full dialog renders

---

### Story 26.2: Project Filter Panel

As a PM,
I want to filter my project portfolio by status, date range, and client,
So that I can focus on the subset of projects that need my attention right now.

**Acceptance Criteria:**

**Given** a PM is on the PM Dashboard
**When** they click the "Filter" button
**Then** a slide-in `<Sheet>` or dropdown panel opens with: Project Status multi-select (Active, Paused, Archived), Date Range date-picker (From / To), Client name text search
**And** the Filter button no longer does nothing on click

**Given** the PM selects one or more filter values and applies them
**When** filters are active
**Then** the project cards grid updates in real-time to show only matching projects (client-side filtering)
**And** a filter indicator badge on the Filter button shows the count of active filters (e.g., "Filter (2)")

**Given** the PM clicks "Clear filters" or removes all filter values
**When** filters are cleared
**Then** all project cards are shown again and the badge on the Filter button disappears

---

### Story 26.3: Project Sort & View Mode Toggle

As a PM,
I want to sort my projects and switch between a card grid and a compact list layout,
So that I can organize and view my portfolio in the way that best matches my current workflow.

**Acceptance Criteria:**

**Given** a PM clicks the "Sort" button
**When** the sort dropdown opens
**Then** it shows these options: Last Activity (default), Name A–Z, Ticket Count (desc), Blocked Count (desc)
**And** selecting an option re-orders the project cards immediately without a page reload
**And** the Sort button no longer does nothing on click

**Given** a PM clicks the List icon button in the view toggle
**When** the view mode switches to `'list'`
**Then** project cards render as compact table rows showing: Project Name, Status badge, Client, Ticket count, Blocked count, Last activity timestamp
**And** the List icon has the active visual state applied and the Grid icon does not
**And** clicking the Grid icon returns to the card-grid layout and restores Grid as the active state
**And** the Grid icon is no longer permanently styled as active regardless of current view mode

---

### Story 26.4: Role Guards & Reactive Auth

As a PM,
I want the dashboard to only show financial data I have permission to see, and for page data to reload correctly after a token refresh,
So that sensitive financial metrics are not exposed to my role and I always see up-to-date information.

**Acceptance Criteria:**

**Given** an authenticated user with role `PM`, `TL`, or `QA` is on the PM Dashboard
**When** the dashboard renders
**Then** `<FinancialMetricsSection>` is NOT visible — it is wrapped in `canAccess(user.role, 'MANAGER')` (or equivalent helper) and only renders for `MANAGER` and `ADMIN`

**Given** an authenticated user with role `MANAGER` or `ADMIN` is on the PM Dashboard
**When** the dashboard renders
**Then** `<FinancialMetricsSection>` IS visible with its full content

**Given** the auth token is silently refreshed by the Axios interceptor
**When** `useEffect` in the `Dashboard` component re-evaluates
**Then** the effect dependency is `user?.id` from `useAuth()` — NOT `localStorage.getItem('access_token')`
**And** dashboard data re-fetches correctly following a token refresh

---

### Story 26.5: Observability & Constraints Page Error States

As an Operator or Technical Lead,
I want the Observability and Architecture Constraints pages to show clear, non-contradictory states,
So that I understand at a glance whether data is unavailable due to missing configuration or a fetch failure.

**Acceptance Criteria:**

**Given** Docker is not running in the development environment
**When** a user navigates to `/observability`
**Then** the page renders a single graceful degradation banner: `"Metrics unavailable — Docker is not running. Start Docker Desktop to enable observability features."`
**And** no dual-error state ("Data Loading Error" AND "Connection Lost") appears simultaneously

**Given** the architecture constraints API fetch succeeds but returns an empty array
**When** `/architecture-review/constraints` renders
**Then** only the empty state shows: `"No constraints defined. Add your first constraint."`
**And** the "Failed to load constraints" error does NOT render at the same time

**Given** the architecture constraints API fetch fails with an error
**When** `/architecture-review/constraints` renders
**Then** only the error state shows: `"Failed to load constraints. Please try again."`
**And** the empty state does NOT render at the same time

---

### Story 26.6: AI Execution KPI Widgets

As a PM,
I want to see AI execution health metrics on my dashboard,
So that I can instantly assess whether the AI pipeline is performing well today.

**Acceptance Criteria:**

**Given** a PM is on the PM Dashboard
**When** the KPI widgets section renders
**Then** an "AI Execution Success Rate" widget shows the percentage of executions with status `COMPLETED` vs total (`COMPLETED` + `FAILED` + `REWORKED`) for the current calendar month, formatted as `"XX%"`
**And** an "Avg Ticket Completion Time" widget shows the mean elapsed hours from execution `QUEUED` to `COMPLETED`, formatted as `"X.X hrs"`
**And** a "Live: Active / Queued" widget shows real-time counts of `RUNNING` and `QUEUED` executions, updated via Socket.IO events without polling

**Given** no executions exist for the current month
**When** the KPI widgets render
**Then** all three widgets show a `"—"` placeholder value with a "No data yet" sub-label
**And** all three widgets show a loading skeleton while data is fetching

---

### Story 26.7: Financial KPI Widgets

As a Manager,
I want to see cost burn metrics on the PM Dashboard,
So that I can spot budget overruns before they become critical, without navigating to the Financial Metrics page.

**Acceptance Criteria:**

**Given** a user with role `MANAGER` or `ADMIN` is on the PM Dashboard
**When** the financial KPI widgets render
**Then** a "Cost per Ticket" widget shows: total AI token spend for the current calendar month divided by completed ticket count, formatted as `"$X.XX"`
**And** a "Budget Burn Rate" widget shows: a compact sparkline of daily spend over the past 14 days, with a horizontal line at the configured monthly budget ceiling, and a dashed linear forecast line projected to end of month

**Given** a user with role `PM`, `TL`, or `QA` is on the PM Dashboard
**When** the financial KPI widget area renders
**Then** the Cost per Ticket and Budget Burn Rate widgets are not shown (role-gated, consistent with the FinancialMetricsSection guard from Story 26.4)

---

### Story 26.8: Quality & Provider KPI Widgets

As a Lead QA or Manager,
I want to see PR merge rate, QA first-pass rate, and AI provider distribution on the dashboard,
So that I can identify quality bottlenecks and optimize provider selection without leaving the main dashboard.

**Acceptance Criteria:**

**Given** a user with role `QA`, `MANAGER`, or `ADMIN` is on the PM Dashboard
**When** the quality KPI section renders
**Then** a "PR Merge Rate" widget shows the percentage of AI-generated PRs merged without requiring manual rework (sourced from GitHub PR status data)
**And** a "QA First-Pass Rate" widget shows the percentage of executions that passed automated QA checks on their first attempt

**Given** a user with role `MANAGER` or `ADMIN` is on the PM Dashboard
**When** the provider distribution section renders
**Then** an "AI Provider Distribution" donut chart shows the percentage breakdown of Claude vs Cursor vs Windsurf executions for the current month
**And** a legend displays each provider's name, percentage, and absolute count

**Given** a user with role `PM` or `TL` is on the PM Dashboard
**When** the KPI section renders
**Then** PR Merge Rate and QA First-Pass Rate are visible (quality transparency)
**And** the AI Provider Distribution chart is NOT shown (cost-sensitive provider data is MANAGER/ADMIN only)

---

## Epic 27: Platform Polish, Global UX & Mobile Navigation

The application works on tablets and phones. Every page has a correct browser tab title. Unknown URLs show a proper 404 page. Integration health is visible in Settings so administrators know exactly what is configured.

### Story 27.1: Proper 404 Page & Route Catch-All Fix

As any user,
I want unknown URLs to display a clear 404 error page,
So that navigating to a broken or mistyped link makes the problem immediately obvious rather than silently rendering the wrong page.

**Acceptance Criteria:**

**Given** an authenticated user navigates to a URL that matches no defined route (e.g., `/unknown`, `/some-typo`)
**When** React Router evaluates the URL
**Then** the `path="*"` catch-all route renders a dedicated `<NotFoundPage>` component — NOT `<Dashboard />`
**And** the 404 page displays: a "404 — Page Not Found" heading, the requested URL, and a "Go to Dashboard" CTA button that navigates to `/`
**And** the browser tab title reads `"404 Not Found — DSF"`

**Given** the `/cost` route was previously caught by the catch-all (from Story 25.4)
**When** a user navigates to any remaining unregistered path
**Then** they always see the 404 page, never the PM Dashboard

---

### Story 27.2: Per-Page Document Titles

As any user,
I want each page to display a descriptive and unique browser tab title,
So that I can identify open tabs, navigate browser history, and share links meaningfully with teammates.

**Acceptance Criteria:**

**Given** a user navigates to any of the application's 30 routes
**When** the page component mounts
**Then** `document.title` is updated to `"{Page Name} — DSF"` following these examples:

- `/` → `"PM Dashboard — DSF"`
- `/financial-metrics` → `"Financial Metrics — DSF"`
- `/admin/users` → `"Users — DSF"`
- `/settings/self-healing` → `"Settings: Self-Healing — DSF"`
- `/capacity-monitor` → `"Capacity Monitor — DSF"`

**And** the Capacity Monitor page title matches the sidebar label exactly (both read "Capacity Monitor")
**And** the browser tab updates dynamically on every route change without requiring a full page reload
**And** the title reverts to `"DSF Dashboard"` only if a page does not define a specific title (fallback)

---

### Story 27.3: Mobile/Tablet Navigation

As a user on a tablet or phone,
I want to navigate the full application on screens narrower than 1024px,
So that I can monitor AI execution status and approve tasks from mobile devices in the field.

**Acceptance Criteria:**

**Given** a user is on a screen narrower than `1024px`
**When** the layout renders
**Then** the sidebar is hidden (`hidden lg:block` preserved) and a hamburger menu button (☰) is visible in the Header
**And** clicking the hamburger button opens a full-height slide-in drawer containing the complete navigation menu with all destinations
**And** clicking any navigation item inside the drawer navigates to that route and closes the drawer
**And** tapping/clicking outside the drawer closes it
**And** the existing Header "Open menu" button is connected to this drawer (currently non-functional per UI-9)

**Given** a user is on a screen between `768px` and `1023px` (tablet)
**When** the layout renders
**Then** a collapsed icon-only sidebar is shown with tooltips on hover for each navigation item
**And** all navigation destinations remain reachable from the icon sidebar

---

### Story 27.4: Notification Bell Badge

As any authenticated user,
I want the notification bell in the header to display a badge showing my unread notification count,
So that I know at a glance when I have pending actions or alerts requiring attention.

**Acceptance Criteria:**

**Given** a user has one or more unread notifications
**When** the Header renders
**Then** a red badge appears on the notification bell icon displaying the unread count from `GET /api/v1/notifications/in-app/unread-count`
**And** the badge number is correct and not hidden by any CSS issue

**Given** the unread count is `0`
**When** the Header renders
**Then** no badge is shown on the notification bell icon

**Given** the unread count exceeds `99`
**When** the badge renders
**Then** it displays `"99+"` instead of the raw number

**Given** the notification staleTime is set to 30 seconds (from Story 25.8)
**When** the user reads a notification
**Then** the badge count decrements accordingly on the next polling cycle (within 30 seconds)

---

### Story 27.5: Sidebar & Visual Polish

As any user,
I want the sidebar to show accurate sync timestamps and use consistent icons,
So that I can trust the interface reflects real data freshness and the UI feels professionally finished.

**Acceptance Criteria:**

**Given** the application has received at least one successful API response
**When** the sidebar bottom card renders
**Then** "Last sync" shows a relative timestamp (e.g., `"2 minutes ago"`) that reflects the most recent successful API call
**And** the timestamp updates on each successful query completion using React Query's `dataUpdatedAt` or a Zustand `lastSyncAt` atom
**And** the hardcoded static text `"2 minutes ago"` is removed

**Given** a user clicks the sidebar collapse toggle
**When** the sidebar state changes
**Then** the same logical icon pair is used for both collapse and expand (e.g., both use `PanelLeftClose` / `PanelLeftOpen`, or equivalent)
**And** the icon for "close" and the icon for "open" are visually consistent counterparts

**Given** a user is in light mode
**When** the PM Dashboard renders
**Then** the "Real-time Live" status badge meets WCAG AA contrast (minimum 4.5:1 text-to-background ratio)
**And** the badge is clearly visible in light mode (e.g., `text-emerald-700` on `bg-emerald-100` or equivalent passing combination)

---

### Story 27.6: Integration Health Panel in Settings

As an Administrator,
I want to see the health status of all third-party integrations in the Settings panel,
So that I immediately know which integrations are missing configuration without reading backend logs.

**Acceptance Criteria:**

**Given** an ADMIN navigates to `/settings/health` (or a new `/settings/integrations` panel)
**When** the Integration Health section renders
**Then** a status card is shown for each integration: Docker, SendGrid (email), OpenAI (transcription), Slack (notifications)
**And** each card displays: integration name, current status (`Configured ✅` or `Not Configured ⚠️`), and a short description of which features are disabled when not configured

**Given** the backend health check endpoint `GET /api/v1/health/integrations` is called
**When** it responds
**Then** it returns the Docker connectivity status (can connect to `/var/run/docker.sock`)
**And** it returns the presence (not the value) of `SENDGRID_API_KEY`, `OPENAI_API_KEY`, and `SLACK_BOT_TOKEN` environment variables as boolean flags
**And** no secret values are ever returned in the response

---

### Story 27.7: Auth Loading Flash & Race Condition Fix

As any user,
I want authentication checks to complete silently during page navigation,
So that I never see a jarring full-screen loading spinner between pages and no premature 401 errors appear in the backend logs.

**Acceptance Criteria:**

**Given** an already-authenticated user navigates between pages
**When** `AppContent` re-evaluates `isLoading`
**Then** during the brief `isLoading = true` window, `AppContent` renders `null` (transparent, invisible) instead of the full-screen `"Checking authentication…"` spinner
**And** no full-screen loading flash is visible between page navigations for authenticated users

**Given** any component inside a `ProtectedRoute` uses a React Query hook
**When** the component mounts
**Then** all data-fetching hooks use `enabled: !!user` to ensure API calls only fire after the user object is confirmed non-null
**And** the backend logs show zero `401 Authentication required` errors caused by components mounting before the auth check completes
**And** the existing intentional 401 errors (unauthenticated access attempts) are unaffected
