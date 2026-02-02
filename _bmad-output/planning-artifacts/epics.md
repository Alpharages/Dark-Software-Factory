---
stepsCompleted:
  [
    'hero-step',
    'step-01-validate-prerequisites',
    'step-02-design-epics',
    'step-03-create-stories',
    'step-04-final-validation',
  ]
inputDocuments: ['prd.md', 'architecture.md', 'ux-design-specification.md']
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
