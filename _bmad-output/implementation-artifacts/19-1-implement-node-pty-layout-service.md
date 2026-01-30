# Story 19.1: Implement Node-PTY Layout Service

Status: done

<!-- Note: Validation of this story was performed by the create-story workflow. -->

## Story

As a Developer,
I want a service that wraps `node-pty` to execute shell commands with pseudo-terminal support,
so that the orchestrator can interact with CLI tools (like Claude) that require a TTY, capture color output/progress bars, and handle interactive prompts.

## Acceptance Criteria

1. **System MUST** wrap `node-pty` in a NestJS Service (`PtyExecutionService`).
2. **System MUST** spawn processes with a pseudo-terminal (TTY) to support interactive CLI tools.
3. **System MUST** stream `stdout` and `stderr` data in real-time via RxJS Observables or event emitters.
4. **System MUST** provide a method to write to the process `stdin` to support interactive prompts (e.g. answering "y/n").
5. **System MUST** capture and return the exit code upon process completion.
6. **System MUST** handle process termination and cleanup of PTY resources.
7. **System MUST** support configurable working directory and environment variables.

## Tasks / Subtasks

- [x] Install `node-pty` and `@types/node-pty` <!-- id: 1 -->
- [x] Create `PtyExecutionService` in `src/ai-routing/services/pty-execution.service.ts` <!-- id: 2 -->
  - [x] Implement `spawn()` method accepting command, args, cwd, env
  - [x] Implement event streaming (data, exit)
  - [x] Implement `write()` method for stdin
  - [x] Implement `kill()` method
- [x] Create `PtyExecutionService.spec.ts` unit tests <!-- id: 3 -->
  - [x] Test spawning a simple echo command
  - [x] Test capturing output
  - [x] Test sending input (e.g. to a script that reads input)
  - [x] Test exit code capture
- [x] Export service from `AiRoutingModule` <!-- id: 4 -->

## Dev Notes

### Architecture Patterns & Constraints

- **Library:** Use `node-pty` (v1.1.x or latest stable) as per Architecture Decision.
- **Service Scope:** This service should be generic enough for any local CLI tool, but optimized for Claude/Cursor.
- **Async Handling:** Use NestJS standard async patterns. For streaming, consider returning an Observable or exposing EventEmitters.
- **OS Compatibility:** Ensure basic compatibility with Mac/Linux (production target). `node-pty` has native bindings, ensure build environment supports it.

### Source Tree Components

- `src/ai-routing/services/pty-execution.service.ts` (NEW)
- `src/ai-routing/ai-routing.module.ts` (MODIFY - register provider)

### Testing Standards

- **Unit Tests:** Mock `node-pty` interactions. Use a wrapper or factory if necessary to make `node-pty` testable without actual native spawning in unit (or use integration tests for actual spawning).
- **Integration Tests:** Actually spawn a `bash` or `sh` process to verify PTY behavior.

### Security

- **Input Sanitization:** While this service executes commands, the caller (Provider) is responsible for ensuring command safety. Usage of `node-pty` avoids shell injection if arguments are passed as array (ensure `node-pty` supports this, otherwise careful escaping is needed).
- **Resource Limits:** Ensure processes are killed if they timeout (handled by Orchestrator, but PTY service needs `kill` capability).

## Dev Agent Record

### Agent Model Used

Antigravity (simulated Create-Story Workflow)

### Completion Notes List

- Validated against `architecture.md`.
- Confirmed `node-pty` requirement.
- Implemented `PtyExecutionService` with `node-pty`.
- Registered service in `AiRoutingModule`.
- Added robust unit tests verifying PTY interactions.
- Verified installation of `node-pty`.
- **Code Review (2026-01-31):** Fixed uncommitted/untracked files. Updated File List to reflect all modified files.

### File List

- src/ai-routing/services/pty-execution.service.ts
- src/ai-routing/services/pty-execution.service.spec.ts
- src/ai-routing/ai-routing.module.ts
- package.json
- pnpm-lock.yaml
- src/ai-routing/providers/claude-code.provider.ts
- src/common/logger/transports/console.transport.ts
- scripts/test-ai-execution-only.js
