# Story 19.2: Implement Claude Code Provider Strategy

Status: ready-for-dev

<!-- Note: Validation of this story was performed by the create-story workflow. -->

## Story

As a System,
I want a `ClaudeCodeProvider` that implements the `AIProvider` interface using `PtyExecutionService`,
so that I can execute tasks using the Claude CLI without changing the Orchestrate Service logic.

## Acceptance Criteria

1. **System MUST** update `ClaudeCodeProvider` to inject and use `PtyExecutionService`.
2. **System MUST** construct the `claude` CLI command with appropriate arguments (e.g. `--print`).
3. **System MUST** pass the ticket Description and Acceptance Criteria as the initial prompt to the CLI via PTY.
4. **System MUST** stream real-time output from the PTY to the `ExecutionService` / `ExecutionTracker`.
5. **System MUST NOT** try to manually read files or build a context map (legacy logic removal).
6. **System MUST** handle interactive prompts from Claude (e.g. "Do you want to run this command?") by automatically approving or delegating to user (if applicable). _Note: For MVP, auto-approve or use flags if available._
7. **System MUST** handle errors and timeouts gracefully via the PTY service.

## Tasks / Subtasks

- [ ] Refactor `ClaudeCodeProvider` in `src/ai-routing/providers/claude-code.provider.ts` <!-- id: 1 -->
  - [ ] Inject `PtyExecutionService`
  - [ ] Remove `child_process` usage
  - [ ] Implement `executeTask` using `pty.spawn()`
  - [ ] Construct initial prompt from ticket details
- [ ] Implement Output Handling <!-- id: 2 -->
  - [ ] Subscribe to PTY output stream
  - [ ] Parse relevant events (if needed) or pass through logs
- [ ] Remove Legacy Context Logic <!-- id: 3 -->
  - [ ] Remove code that manually reads files and appends to prompt
- [ ] Update Unit Tests (`src/ai-routing/providers/claude-code.provider.spec.ts`) <!-- id: 4 -->
  - [ ] Mock `PtyExecutionService`
  - [ ] Verify command construction
  - [ ] Verify interaction flow

## Dev Notes

### Architecture Patterns & Constraints

- **Provider Interface:** Must adhere to `AIProvider` interface.
- **PTY Usage:** Use the service created in Story 19.1.
- **Legacy Cleanup:** This story actively removes old "context stuffing" logic. Ensure `generateContext` or similar methods are removed or deprecated.
- **Configuration:** Ensure `anthropic` / `claude` binary path is configurable via `ConfigService`.

### Source Tree Components

- `src/ai-routing/providers/claude-code.provider.ts` (MODIFY)
- `src/ai-routing/providers/claude-code.provider.spec.ts` (MODIFY)

### Testing Standards

- **Unit Tests:** Verify that `PtyExecutionService.spawn` is called with correct arguments.
- **Integration Tests:** (Deferred to E2E) Run a real Claude CLI command (mocked binary) to verify flow.

### Security

- **API Keys:** Ensure `ANTHROPIC_API_KEY` is passed to the PTY environment variables, NOT logged in commands.
- **Output Sanitization:** Be careful logging full PTY output if it contains secrets (Claude output usually safe, but user input might not always be).

## Dev Agent Record

### Agent Model Used

Antigravity (simulated Create-Story Workflow)

### Completion Notes List

- Validated against `epics.md` and `architecture.md`.
- Identified dependency on Story 19.1.

### File List

- src/ai-routing/providers/claude-code.provider.ts
- src/ai-routing/providers/claude-code.provider.spec.ts
