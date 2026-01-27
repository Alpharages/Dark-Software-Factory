---
id: '19-1-implement-claude-code-cli-provider'
title: 'Implement Claude Code CLI Provider'
status: 'done'
epic: 'epic-19'
priority: 'high'
story_points: 3
assignee: 'unassigned'
start_date: ''
end_date: ''
---

# Story 19.1: Implement Claude Code CLI Provider

## User Story

**As a** Developer,
**I want** the system to execute tasks using the `claude` CLI directly with the ticket description as the prompt,
**So that** the AI agent can autonomously manage its context and execution without manual setup.

## Acceptance Criteria

### AC 1: Direct CLI Invocation

**Given** a valid ticket with a description and acceptance criteria
**When** the `ClaudeCodeProvider.execute()` method is called
**Then** it MUST spawn the `claude` CLI process (e.g., `spawn('claude', [...])`)
**And** the prompt MUST contain the ticket title, description, and acceptance criteria
**And** it MUST NOT use the deprecated NPM-based or SDK-based execution method if one existed

### AC 2: Project Root Execution

**Given** the provider is configuring the execution environment
**When** spawning the process
**Then** the `cwd` (Current Working Directory) MUST be set to the project root
**And** the agent MUST be able to navigate the file system relative to this root

### AC 3: Autonomous Context (No Manual Loading)

**Given** a ticket that requires file changes
**When** the provider prepares the execution
**Then** it MUST NOT manually read or load context files (legacy behavior)
**And** it MUST NOT construct a massive context prompt manually
**And** it relies on the Claude Code agent to run commands (like `ls`, `grep`, `cat`) to discover context itself

### AC 4: Output Streaming & Logging

**Given** the `claude` process is running
**When** it emits data to `stdout` or `stderr`
**Then** the application MUST capture this output
**And** log it to the `AuditLogger` or system logs for traceability
**And** (Optional) stream it to the user interface if supported

### AC 5: Dynamic Environment Configuration

**Given** the provider is preparing the command
**When** spawning the process
**Then** it MUST inject environment variables (ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY) explicitly in the process environment
**And** it MUST NOT rely solely on global system environment variables
**And** the model should be configurable (e.g. `--model qwen3-coder`)
**Example:** `ANTHROPIC_AUTH_TOKEN=ollama ANTHROPIC_BASE_URL=http://localhost:11434 ANTHROPIC_API_KEY="" claude --model qwen3-coder` functionality equivalent

## Technical Implementation Notes

### Architecture

- **Service:** `src/ai-routing/providers/claude-code.provider.ts`
- **Method:** `execute(input: ExecutionInput): Promise<ExecutionResult>`
- **Tooling:** Use Node.js `child_process.spawn`.
- **Environment:** Pass `env` option to `spawn` merging `process.env` with dynamic vars:
  ```typescript
  const env = {
    ...process.env,
    ANTHROPIC_AUTH_TOKEN: 'ollama',
    ANTHROPIC_BASE_URL: 'http://localhost:11434',
    ANTHROPIC_API_KEY: ''
  };
  spawn('claude', ['--model', 'qwen3-coder', userPrompt], { env, cwd: ... });
  ```
  _Note:_ This prepares for future dynamic/project-based keys.

### Prompt Structure Pattern

The prompt passed to the CLI should be structured clearly:

```text
TASK: {ticket.title}

DESCRIPTION:
{ticket.description}

ACCEPTANCE CRITERIA:
{ticket.acceptanceCriteria}

INSTRUCTIONS:
You are an autonomous coding agent.
1. Explore the codebase to understand the context.
2. Implement the requested changes.
3. Verify your work.
```

### Security

- Ensure `ticket.description` is sanitized to prevent shell injection if passing via shell (prefer `spawn` with args array to avoid shell interpretation).

## Tasks

- [x] Create/Refactor `ClaudeCodeProvider` to use `child_process.spawn`
- [x] Implement prompt construction logic (Ticket -> text)
- [x] Configure `cwd` to `process.cwd()` or configured workspace root
- [x] Add event listeners for `stdout`, `stderr`, and `close`
- [x] Remove calls to `ContextLoader` (legacy)
- [x] Verify execution with a test ticket "Hello World file creation"

## Senior Developer Review (AI)

- **Date:** 2026-01-27
- **Reviewer:** BMad
- **Outcome:** Approved (Auto-Fixed)
- **Findings:**
  - CRITICAL: Logging was disabled (Fixed).
  - MEDIUM: Metrics not fully implemented (Acceptable for this iteration).
  - LOW: Status was outdated (Fixed).
- **Status:** Moved to 'done'.
