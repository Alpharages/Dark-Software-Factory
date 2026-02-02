# Story 22.3: Sandbox Workspace Mounting

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the Orchestrator,
I want to create a host directory and bind-mount it into the container at `/workspace`,
so that file changes made by the AI persist after the container dies.

## Acceptance Criteria

1. **Given** a new task request for execution
   **When** the Orchestrator prepares the environment
   **Then** it must resolve the Host Workspace Root from `SANDBOX_WORKSPACES_ROOT` (default: `./workspaces`)
   **And** create a temporary directory using a unique identifier (e.g., `{root}/{ticketId}`)
   **And** ensure the path is absolute using `path.resolve()`.

2. **Given** the host directory is created
   **When** spawning the Docker container
   **Then** the host directory must be bind-mounted with Read/Write permissions to `/home/agent/workspace` inside the container
   **And** the mount string must follow `/absolute/host/path:/home/agent/workspace:rw`
   **And** the mapping (Ticket ID → Host Path) must be logged for debugging.

3. **Given** the container runs as a non-root user (UID 1000)
   **When** the agent attempts to write files to `/home/agent/workspace`
   **Then** the write operation must succeed (no `EACCES` or permission denied errors)
   **And** the Orchestrator must pre-verify host directory permissions before spawning.

4. **Given** a Docker bind mount failure (e.g., path not found, daemon permission denied)
   **When** attempting to start the container
   **Then** the system must catch the specific Docker error
   **And** throw a typed `InfrastructureException` with clear details used for debugging.

5. **Given** the container finishes execution
   **When** the container is removed
   **Then** the files in the host directory must remain intact
   **And** be available for the cleanup service (Story 23.2) to mitigate disk exhaustion.

## Tasks / Subtasks

- [x] Task 1: Implement Workspace Directory Management (AC: 1, 3)
  - [x] Add `SANDBOX_WORKSPACES_ROOT` to `ConfigService` with validation
  - [x] Implement `WorkspaceService.createWorkspace(ticketId)` using `fs.promises.mkdir(path, { recursive: true })`
  - [x] Implement `verifyPermissions(path)` helper to fail fast if Node process lacks access
- [x] Task 2: Implement Docker Bind Mounting (AC: 2, 4)
  - [x] Update `DockerService.createContainer` to accept `HostConfig.Binds` array
  - [x] Construct bind string using `path.resolve()` for host path robustness
  - [x] Log: `Creating workspace mount: ${hostPath} -> /home/agent/workspace`
  - [x] Wrap Docker calls in try/catch to rethrow `InfrastructureException` on mount failure
- [x] Task 3: Unit Tests
  - [x] Test `createWorkspace` respects config and creates absolute paths
  - [x] Test permission verification throws on restricted paths
  - [x] Test DockerService properly formats bind strings
  - [x] Test error handling maps Docker errors to InfrastructureExceptions

## Dev Notes

- **Configuration:**
  - Define `SANDBOX_WORKSPACES_ROOT` key in `env.validation.ts`. Default to `path.join(process.cwd(), 'workspaces')` for dev convenience.

- **Docker Type Safety:**
  - Use `Docker.ContainerCreateOptions` (from `@types/dockerode`) to ensure `HostConfig.Binds` is typed correctly. Avoid magic strings where possible.

- **Path Handling:**
  - Docker requires absolute paths for binds. Always use `path.resolve()` even if the config is relative.
  - Be aware of path formatting differences if running on Windows (though target is usually Linux/Mac per project "Dark Software Factory" context).

- **Permissions:**
  - Host User vs Docker User: The container runs as UID 1000. Ensure the Node process creating the directory sets permissions (e.g., `fs.chmod`) if the host environment is strict, ensuring UID 1000 or Group 1000 can write.

- **Dependencies:**
  - Extends `DockerService` (Story 22-1).
  - Precedes `CleanerService` (Story 23-2) which will handle the deletion of these folders.

### Project Structure Notes

- `src/docker/workspace.service.ts` (Service)
- `src/common/exceptions/infrastructure.exception.ts` (New Exception Type if missing)

### References

- [Source: planning-artifacts/epics-containerization.md#Story 1.3]
- [Source: architecture.md#Containerization]
- [Predecessor: Story 22-2 (Base Agent Image)]
- [Follow-up: Story 23-2 (Automated Container Cleanup)]

## Dev Agent Record

### Agent Model Used

Antigravity

### Debug Log References

- None

### Completion Notes List

- Implemented `InfrastructureException` for typed error handling.
- Added `SANDBOX_WORKSPACES_ROOT` to `env.validation.ts`.
- Implemented `WorkspaceService` with secure directory creation (`fs.chmod(0o777)` ensures container user access).
- Enhanced `DockerService` with `createContainer` method supporting bind mounts and detailed logging.
- Added `formatBindMount` helper to `DockerService` to safe-guard bind string construction (Code Review Fix).
- Fully unit tested both services, including error scenarios and permission checks.

### File List

- src/common/exceptions/infrastructure.exception.ts
- src/config/env.validation.ts
- src/docker/docker.module.ts
- src/docker/docker.service.ts
- src/docker/docker.service.spec.ts
- src/docker/workspace.service.ts
- src/docker/workspace.service.spec.ts
