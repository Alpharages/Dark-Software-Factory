---
id: 19.4
title: Implement Cursor Headless PTY Integration
status: done
epic: 19
priority: high
---

# Story 19.4: Implement Cursor Headless PTY Integration

## Description

Refactor `CursorHeadlessProvider` to use `PtyExecutionService` instead of `child_process`. This ensures consistent CLI execution, support for interactive-ready terminals, and proper streaming of stdout/stderr.

## Acceptance Criteria

1. [x] Remove all `child_process` usage from `CursorHeadlessProvider`.
2. [x] Inject and utilize `PtyExecutionService` for Cursor CLI calls.
3. [x] Properly handle `.output$` and `.exit$` observables.
4. [x] Support real-time streaming to the execution tracker.
5. [x] Ensure `checkCliAvailability` uses the same PTY mechanism.
6. [x] Pass explicit environment variables (NODE_ENV, etc.) to the PTY process.
7. [x] Unit tests cover new PTY-based execution logic and health checks.

## Tasks

- [x] Refactor `executeCursorCli` to use `ptyService.spawn`.
- [x] Refactor `checkCliAvailability` to use `ptyService.spawn`.
- [x] Implement real-time output streaming.
- [x] Standardize environment variable passing.
- [x] Update unit tests to mock `PtyExecutionService`.
- [x] Verify all tests pass and health checks are accurate.
- [x] Sync documentation and status files.
