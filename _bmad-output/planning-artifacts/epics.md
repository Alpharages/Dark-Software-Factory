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

FR60: System can route tickets to appropriate AI tool (Cursor, Windsurf, Antigravity) based on task type
FR64: System can route to fallback AI provider if primary fails (Phase 2)
FR65: System can execute AI code generation based on ticket prompts
FR-NEW-1: Claude Code provider MUST use the `claude` CLI tool directly for execution.
FR-NEW-2: Claude Code provider MUST accept a task description and acceptance criteria as a "ticket" input.
FR-NEW-3: Claude Code provider MUST NOT manually construct context files or prompts; it should rely on Claude Code's agentic capabilities.
FR-NEW-4: Claude Code provider MUST allow the agent to manage its own workspace (cloning, file navigation) without external pre-loading of context.
FR-NEW-5: Remove legacy/junk code related to manual context loading and complex prompt building.

### NonFunctional Requirements

NFR-I4: Must support Cursor, Windsurf, Antigravity APIs via standardized interface
NFR-I5: Must handle AI provider API changes gracefully (versioning, deprecation)
NFR-NEW-1: Integration must use the locally installed `claude` CLI available in the environment.
NFR-NEW-2: Integration must maintain the existing `AIProvider` interface for compatibility with the Orchestrator.

### Additional Requirements

- Architecture: "AI Dev Tool Orchestrator is a separate NestJS microservice"
- Architecture: "Claude Code (Anthropic) as secondary provider"
- Architecture: "Use AetherFlow's existing infrastructure where possible"
- User Request: "I don't want to use that explicit method: 1. Load context file... 2. Load context itself..."
- User Request: "I will just give the Claude Code the task description and acceptance criteria, just like a ticket."

### FR Coverage Map

FR60: Epic 19 - Routing to Claude Code verified
FR64: Epic 19 - Fallback capability preserved
FR65: Epic 19 - Ticket-based execution enabled
FR-NEW-1: Epic 19 - Use `claude` CLI directly
FR-NEW-2: Epic 19 - Accept ticket input
FR-NEW-3: Epic 19 - Autonomous context handling
FR-NEW-4: Epic 19 - Workspace management by agent
FR-NEW-5: Epic 19 - Legacy code removal
NFR-I4: Epic 19 - Standardized interface
NFR-I5: Epic 19 - API compatibility
NFR-NEW-1: Epic 19 - Local CLI usage
NFR-NEW-2: Epic 19 - Interface compatibility

## Epic List

### Epic 19: Claude Code CLI Integration

**Goal:** Enable autonomous task execution using Claude Code CLI by passing high-level ticket descriptions, eliminating manual context management.
**FRs covered:** FR60, FR64, FR65, FR-NEW-1, FR-NEW-2, FR-NEW-3, FR-NEW-4, FR-NEW-5, NFR-NEW-1, NFR-NEW-2
**User Value:** Users can assign complex tasks to Claude Code just like a human developer (ticket description + criteria) without tedious manual setup.

<!-- Repeat for each epic in epics_list (N = 1, 2, 3...) -->

## Epic 19: Claude Code CLI Integration

Enable autonomous task execution using Claude Code CLI by passing high-level ticket descriptions, eliminating manual context management.

### Story 19.1: Implement Claude Code CLI Provider

As a Developer,
I want the system to execute tasks using the `claude` CLI directly with the ticket description as the prompt,
So that the AI agent can autonomously manage its context and execution without manual setup.
**Note:** Execution must pass environment variables (Auth Token, Base URL, API Key) inline/explicitly to support future dynamic configuration.

**Acceptance Criteria:**

**Given** a valid ticket with a description and acceptance criteria
**When** the `ClaudeCodeProvider` is invoked
**Then** it MUST spawn the `claude` CLI process using the ticket content as the prompt
**And** the configured `cwd` MUST be the project root
**And** the provider MUST NOT attempt to load context files manually
**And** the output process MUST be streamed or captured for audit logs

### Story 19.2: Remove Legacy Context Management Code

As a Maintainer,
I want to remove unused context loading and prompt construction logic from the provider,
So that the codebase remains clean and aligned with the new agentic workflow.

**Acceptance Criteria:**

**Given** the new CLI-based implementation is verified (Story 19.1)
**When** I review the `ClaudeCodeProvider` code
**Then** any logic related to `ContextLoader` or manual file reading for prompt construction MUST be removed
**And** the `PromptGeneratorService` integration for Claude Code MUST be simplified or removed
**And** the provider MUST strictly adhere to the `AIProvider` interface
