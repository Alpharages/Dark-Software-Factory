---
stepsCompleted: ['step-01', 'step-02', 'step-03', 'step-04']
inputDocuments:
  - prd.md
  - architecture.md
---

# Dark Software Factory - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Dark Software Factory, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

**AI Dev Tool Orchestrator Capabilities:**

- **FR56:** System can receive ClickUp webhook events (task created, updated)
- **FR57:** System can parse ticket details (description, acceptance criteria, context documents)
- **FR58:** System can validate ticket quality before routing (reject if incomplete)
- **FR59:** System can extract project context and client information from ticket metadata
- **FR60:** System can route tickets to appropriate AI tool (Cursor, Windsurf, Antigravity) based on task type
- **FR61:** System can convert ticket requirements into AI-executable prompts
- **FR62:** System can monitor AI execution progress and detect timeouts/failures
- **FR63:** System can retry failed AI executions with error context
- **FR64:** System can route to fallback AI provider if primary fails (Phase 2)
- **FR65:** System can execute AI code generation based on ticket prompts
- **FR66:** System can run linting checks (ESLint, Prettier, language-specific) on AI-generated code
- **FR67:** System can execute automated tests (unit, integration) and report results
- **FR68:** System can perform basic code review checks (complexity, security patterns, best practices)
- **FR69:** System can calculate test coverage and enforce minimum thresholds
- **FR70:** System can block deployment if quality gates fail
- **FR71:** System can trigger multi-layer AI review (AI #2 reviews AI #1's code) (Phase 2)
- **FR72:** System can create feature branches per ticket following naming conventions
- **FR73:** System can push AI-generated code to GitHub repository
- **FR74:** System can generate meaningful commit messages from ticket context
- **FR75:** System can create pull requests with traceability links to ClickUp tickets
- **FR76:** System can trigger CI/CD pipelines for automated deployment
- **FR77:** System can monitor deployment status and detect failures
- **FR78:** System can update ClickUp ticket status based on deployment results
- **FR79:** System can monitor production applications for errors and anomalies
- **FR80:** System can detect critical failures requiring immediate attention
- **FR81:** System can automatically create fix tickets in ClickUp when bugs detected
- **FR82:** System can analyze error logs to provide context for fix tickets
- **FR83:** System can prioritize fix tickets by severity and impact
- **FR84:** System can attempt autonomous bug fixes for simple issues (Phase 3)

**Claude Code Integration (Detailed):**

- **FR137:** Claude Code provider MUST use the `claude` CLI tool directly for execution via node-pty.
- **FR138:** Claude Code provider MUST accept a task description and acceptance criteria as a "ticket" input.
- **FR139:** Claude Code provider MUST NOT manually construct context files or prompts; it should rely on Claude Code's agentic capabilities.
- **FR140:** Claude Code provider MUST allow the agent to manage its own workspace (cloning, file navigation) without external pre-loading of context.
- **FR141:** Remove legacy/junk code related to manual context loading and complex prompt building.

**Task Intake Reliability:**

- **FR142:** System must support re-triggering AI intake for existing tickets when status matches actionable state.
- **FR143:** System must trigger AI intake when ClickUp tasks are synced manually from the UI.
- **FR144:** System must trigger AI intake when ClickUp tasks are updated via webhook to an actionable status.
- **FR145:** System must prevent duplicate AI executions for the same task state.

**(Note: FR1-55 and FR85-136 excluded for brevity but present in PRD)**

### NonFunctional Requirements

- **NFR-P1:** Orchestrator must process ClickUp webhook events within 5 seconds of receipt
- **NFR-R1:** Orchestrator must maintain 99% uptime (some downtime acceptable for MVP)
- **NFR-R4:** AI timeouts must escalate to human review (not silently fail)
- **NFR-I4:** Must support Cursor, Windsurf, Antigravity APIs via standardized interface
- **NFR-I5:** Must handle AI provider API changes gracefully (versioning, deprecation)
- **NFR-I10:** Monitoring tools must integrate via standard APIs (Datadog, Prometheus, etc.)
- **NFR-I11:** Integration must use the locally installed `claude` CLI available in the environment.
- **NFR-I12:** Integration must maintain the existing `AIProvider` interface for compatibility with the Orchestrator.

### Additional Requirements

**From Architecture:**

- **CLI Execution:** Use `node-pty` for robust terminal emulation, capturing progress bars, and handling interactive prompts (verified in Architecture Decision).
- **Service Structure:** AI Dev Tool Orchestrator is a separate NestJS microservice.
- **AI Strategy:** Multi-provider (Cursor + Claude Code).
- **Execution Pattern:** Delegate execution to AI, Orchestrator handles instruction/storage/decision.

### FR Coverage Map

FR56: Epic 20 - Webhook Intake
FR57: Epic 21 - Ticket Parsing
FR58: Epic 21 - Ticket Validation
FR59: Epic 21 - Context Extraction
FR60: Epic 21 - AI Routing
FR61: Epic 21 - Prompt Conversion
FR62: Epic 21 - Execution Monitoring
FR63: Epic 21 - Retry Logic
FR64: Epic 21 - Fallback Routing
FR65: Epic 19/21 - AI Code Generation
FR66-70: Epic 21 - Automated QA
FR71: Future Epic - Multi-layer Review
FR72-78: Epic 21 - GitHub/CI Deployment
FR79-84: Future Epic - Production Monitoring/Self Healing
FR137-141: Epic 19 - Claude Code CLI
FR142-145: Epic 20 - Task Intake Reliability

## Epic List

### Epic 19: Claude Code CLI Integration

Enable autonomous task execution using Claude Code CLI via node-pty by passing high-level ticket descriptions, eliminating manual context management.
**FRs covered:** FR137, FR138, FR139, FR140, FR141, FR65 (Partial), NFR-I11, NFR-I12

### Epic 20: AI Task Pickup Reliability

Ensure consistent AI task pickup from both automated webhooks and manual syncs, handling status transitions correctly without duplication.
**FRs covered:** FR56, FR142, FR143, FR144, FR145, NFR-P1

### Epic 21: AI Orchestrator Core (MVP) [COMPLETED]

Establish the core routing, execution, and QA pipeline for the Orchestrator, ensuring tickets flow from intake to deployment.
**Status:** All requirements covered by existing Epics 2 (Core) and 4 (GitHub).
**FRs covered:** FR57-70, FR72-78 (Implemented)

## Epic 19: Claude Code CLI Integration

Enable autonomous task execution using Claude Code CLI via node-pty by passing high-level ticket descriptions, eliminating manual context management. This approach leverages Claude Code's agentic capabilities to find files and understand context, rather than pre-stuffing context.

### Story 19.1: Implement Node-PTY Layout Service

As a Developer,
I want a service that wraps `node-pty` to execute shell commands with pseudo-terminal support,
So that the orchestrator can interact with CLI tools (like Claude) that require a TTY, capture color output/progress bars, and handle interactive prompts.

**Acceptance Criteria:**

**Given** The Orchestrator is running and `node-pty` is installed
**When** A command is executed via `PtyExecutionService.execute(command, args)`
**Then** The service MUST spawn the process using a pseudo-terminal
**And** The service MUST stream stdout/stderr events in real-time
**And** The service MUST allow writing to stdin (for answering prompts)
**And** The service MUST capture the exit code upon completion.

### Story 19.2: Implement Claude Code Provider Strategy

As a System,
I want a `ClaudeCodeProvider` that implements the `AIProvider` interface using `PtyExecutionService`,
So that I can execute tasks using the Claude CLI without changing the Orchestrate Service logic.

**Acceptance Criteria:**

**Given** A ticket is routed to the "Claude Code" provider
**When** The `executeTask` method is called
**Then** It MUST construct a command string invoking `claude` (or the configured binary)
**And** It MUST pass the ticket Description and Acceptance Criteria as the initial prompt
**And** It MUST NOT try to manually read files or build a context map (relying on Claude to do it)
**And** It MUST use `PtyExecutionService` to run the command.

### Story 19.3: Autonomous Workspace Management

As a System,
I want the Claude Code execution to run in the correct project directory,
So that the agent can see the files, run git commands, and manage its own context.

**Acceptance Criteria:**

**Given** A ticket for Project X (which corresponds to a git repo)
**When** `ClaudeCodeProvider` starts execution
**Then** It MUST set the Current Working Directory (CWD) of the PTY session to the root of Project X
**And** If the repository is not present, it should clone it (or error if not configured)
**And** It MUST ensure the environment variables (API keys) are passed to the PTY session.
**And** Legacy code that manually loads context files MUST be removed/bypassed.

## Epic 20: AI Task Pickup Reliability

Ensure consistent AI task pickup from both automated webhooks and manual syncs, handling status transitions correctly without duplication.

### Story 20.1: Implement Robust Webhook Handler

As an Orchestrator,
I want to process ClickUp webhooks reliably,
So that I never miss a task update even if I receive duplicate events or network blips occur.

**Acceptance Criteria:**

**Given** A valid webhook payload from ClickUp
**When** The `WebhookController` receives it
**Then** It MUST validate the signature (if applicable) and extract the Task ID and Status
**And** It MUST idempotently queue a job for processing (ignoring duplicates within a short window)
**And** It MUST return 200 OK immediately to ClickUp (NFR-P1).

### Story 20.2: Unified Intake Status Check

As a System,
I want a centralized logic to determine if a task is "Ready for AI",
So that both manual syncs and webhooks use the exact same rules.

**Acceptance Criteria:**

**Given** A task is being checked (via synced list or webhook)
**When** The system evaluates its status
**Then** It MUST trigger execution IF status is "Ready for AI" (or configured equivalent)
**And** It MUST triggers execution IF status is "In Progress" AND the assignee is "AI Agent"
**And** It MUST NOT trigger if the task is "Done" or "Blocked"
**And** This logic MUST be in a shared service utilized by both Webhook and Sync modules.

### Story 20.3: Prevent Duplicate Executions

As a Manager,
I want the system to prevent starting a new AI agent if one is already working on the same ticket,
So that I don't waste money on redundant processing.

**Acceptance Criteria:**

**Given** A task execution is requested
**When** The system checks the `Execution` database
**Then** It MUST check if there is an active (RUNNING) execution for this Task ID
**And** It MUST reject the new request if one exists
**And** It MUST allow re-execution if the previous one is FAILED or COMPLETED.

## Epic 21: AI Orchestrator Core (MVP)

Establish the core routing, execution, and QA pipeline for the Orchestrator, ensuring tickets flow from intake to deployment.

### Story 21.1: Basic Provider Routing

As a System,
I want to route tasks to the correct AI Provider based on configuration,
So that I can switch between Cursor, Windsurf, or Claude Code.

**Acceptance Criteria:**

**Given** A validated task
**When** The `RoutingService` evaluates it
**Then** It MUST select the provider specified in the Project Config
**And** It MUST instantiate the correct Provider Strategy
**And** It MUST log the routing decision (FR91).

### Story 21.2: GitHub Feature Branch Creation

As a Developer,
I want the system to create a new branch for each ticket,
So that changes are isolated and traceable.

**Acceptance Criteria:**

**Given** A ticket `TASK-123`
**When** Before execution starts
**Then** The system MUST verify the repo is clean/up-to-date
**And** It MUST create and checkout a branch named `feature/TASK-123-short-description`
**And** It MUST push this branch to origin.

### Story 21.3: Pull Request Automation

As a TL,
I want the system to open a PR when the AI is finished,
So that I can review the code and merge it.

**Acceptance Criteria:**

**Given** An AI execution has completed successfully
**When** The `PostExecutionService` runs
**Then** It MUST push all commits to the feature branch
**And** It MUST create a Pull Request on GitHub
**And** The PR body MUST link to the ClickUp task
**And** It MUST add the "AI-Generated" label.
