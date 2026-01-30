# Story 19.3: Autonomous Workspace Management

Status: ready-for-dev

<!-- Note: Validation of this story was performed by the create-story workflow. -->

## Story

As an AI Agent,
I want to operate within a persistent, isolated workspace where I can navigate directories, read/write files, and execute git commands,
so that I can autonomously manage the repository state without external hand-holding or context limits.

## Acceptance Criteria

1. **System MUST** provision a dedicated workspace via `WorkspaceService` before starting the PTY session.
2. **System MUST** set the PTY process `cwd` to the provisioned workspace path.
3. **System MUST** ensure the workspace contains the cloned repository (if configured) or an empty directory `chmod`'d for the agent.
4. **System MUST** allow the AI agent (e.g. Claude) to execute file system operations (`ls`, `cd`, `mkdir`, `touch`) within the workspace.
5. **System MUST** persist the workspace state between execution steps (if the agent interaction is multi-step).
6. **System MUST** prevent the agent from breaking out of the workspace root (though `node-pty` runs as the host user, we rely on the container/agent isolation, but we should ensure `cwd` starts correctly).
7. **System MUST** log the initial workspace state (branch, commit) for reproducibility.

## Tasks / Subtasks

- [ ] Verify `WorkspaceService` integration in `ClaudeCodeProvider` (covered partly by 19.2, but focus here is on environment) <!-- id: 1 -->
- [ ] Implement `prepareEnvironment()` method in `ClaudeCodeProvider` <!-- id: 2 -->
  - [ ] Call `workspaceService.createWorkspace()`
  - [ ] Extract `workspace.path`
  - [ ] Verify directory exists
- [ ] Add `cwd` validation <!-- id: 3 -->
  - [ ] Ensure PTY spawn receives the correct `cwd`
- [ ] Test Workspace Persistence <!-- id: 4 -->
  - [ ] Verify that files created by the agent in step N are available in step N+1 (if applicable)
- [ ] Implement Safety Checks <!-- id: 5 -->
  - [ ] Warn if `repositoryUrl` is missing but agent expects to code (allow "empty workspace" mode).

## Dev Notes

### Architecture Patterns & Constraints

- **Service Reuse:** Heavily rely on `src/ai-routing/providers/workspace.service.ts`. Do not reinvent workspace creation.
- **Isolation:** The primary isolation is the _directory_. Docker isolation is handled at a higher level (deployment), but here we are just isolating the CWD.
- **Statefulness:** The PTY session itself is stateful. If `claude` CLI runs as a daemon/repl, the workspace naturally persists. If we restart `claude`, we must point to the _same_ workspace directory (reusing `executionId` or `ticketId` mapping).

### Source Tree Components

- `src/ai-routing/providers/claude-code.provider.ts` (MODIFY)
- `src/ai-routing/providers/workspace.service.ts` (REFERENCE/MINOR UPDATE if needed)

### Testing Standards

- **Integration Test:**
  1.  Request Workspace for Ticket X.
  2.  Write a file "test.txt".
  3.  Request Workspace for Ticket X again (should reuse).
  4.  Verify "test.txt" exists.

## Dev Agent Record

### Agent Model Used

Antigravity (simulated Create-Story Workflow)

### Completion Notes List

- Validated against `architecture.md`.
- Confirmed `WorkspaceService` capabilities.
- Defined integration points.

### File List

- src/ai-routing/providers/claude-code.provider.ts
