# Story 22.2: Base Agent Image Management

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Technical Lead,
I want a standardized Docker image for AI agents,
so that all AI execution happens in a consistent, controlled environment matching production constraints.

## Acceptance Criteria

1. **Given** the project `docker/` directory exists
   **When** I inspect the `Dockerfile.base`
   **Then** it should attempt to build a Node.js based image (likely `node:20-slim` or similar)
   **And** it should install essential system tools: `git`, `python3` (for node-pty), `make`, `g++`, `curl`
   **And** it should configure a non-root user `agent` with correct UID/GID mapping capabilities
   **And** it should set the working directory to `/home/agent/workspace`
   **And** the build command `docker build -t dsf-agent-base -f docker/Dockerfile.base .` should complete successfully
   **And** I should be able to run `docker run --rm dsf-agent-base node -v` and see the version output.

## Tasks / Subtasks

- [x] Task 1: Create Docker Infrastructure (AC: 1.1)
  - [x] Create `docker/` directory in project root
  - [x] Create `docker/Dockerfile.base`
  - [x] Define Node.js 20-slim base image
- [x] Task 2: Install System Dependencies (AC: 1.2)
  - [x] Add `apt-get update && apt-get install` commands for git, python3, make, g++, curl
  - [x] Ensure cleanup of apt cache to reduce image size
- [x] Task 3: Configure Agent User (AC: 1.3, 1.4)
  - [x] Create non-root user `agent`
  - [x] Setup workspace directory `/home/agent/workspace` with correct permissions
  - [x] Set default USER `agent`
  - [x] Set WORKDIR `/home/agent/workspace`
- [x] Task 4: Verification (AC: 1.5, 1.6)
  - [x] Verify build command success
  - [x] Verify container execution and node version availability

## Dev Notes

- **Architecture Pattern:** Use multi-stage builds if necessary to keep image size small, though for a dev tool orchestrator, a single stage with cleanup is likely sufficient.
- **Node-PTY Requirement:** `node-pty` requires native compilation modules (`make`, `g++`, `python3`) which are NOT in `slim` images by default. This is critical for `PtyExecutionService`.
- **User Permission Strategy:** The `agent` user inside Docker should ideally mapped to the host user's UID/GID to avoid file permission issues on mounted volumes (Story 22-3 preparation). For this story, setting up the user and ensuring `workspace` is owned by them is the goal.
- **Reference:** `architecture.md` specifies "Containerization: Use Docker (Dockerfile, Dockerfile.dev, docker-compose.yml)".

### Project Structure Notes

- New directory: `docker/` at project root.
- No changes to existing source code (this is infrastructure).

### References

- [Source: planning-artifacts/epics.md#Epic 22]
- [Source: architecture.md#Containerization]

## Dev Agent Record

### Code Review (2026-02-02)

- **Reviewer:** Antigravity (Step 60)
- **Status:** APPROVED (Fixes Applied)
- **Findings:**
  - 🟡 **Untracked File:** `docker/Dockerfile.base` was untracked. Fixed.
  - 🟡 **Missing python alias:** Added `ln -sf /usr/bin/python3 /usr/bin/python`. Fixed.
  - 🟢 **Docker Optimization:** Added `--no-install-recommends` to apt-get. Fixed.

### Agent Model Used

Antigravity (Step 5 - Create Story)

### Debug Log References

- None

### Completion Notes

- Implemented `docker/Dockerfile.base` with Node.js 20-slim.
- Added essential build tools: `git`, `python3`, `make`, `g++`, `curl`.
- Configured non-root `agent` user (UID 1000) and workspace.
- Verification: Docker build command verified (slow execution noted).

### Completion Notes List

- Story created via `create-story` workflow.
- Prepares foundation for Story 22-3 (Mounting) and 22-4 (Execution).

### File List

- docker/Dockerfile.base
