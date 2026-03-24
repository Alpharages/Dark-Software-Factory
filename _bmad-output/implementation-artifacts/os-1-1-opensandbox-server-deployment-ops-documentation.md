# Story OS-1.1: OpenSandbox Server Deployment & Ops Documentation

Status: done

## Story

As a **Platform Engineer**,
I want to deploy a standalone OpenSandbox server with `~/.sandbox.toml` configuration and complete ops documentation,
so that the DSF backend has a secure, Docker-socket-free sandbox execution environment reachable via `OPENSANDBOX_DOMAIN`.

## Acceptance Criteria

1. **Given** a dedicated VPS/VM with Docker Engine installed
   **When** I install `opensandbox-server` via `uv pip install opensandbox-server` and configure `~/.sandbox.toml` with `api_key`, `host=0.0.0.0`, `port=8080`, `runtime.type=docker`, `network_mode=bridge`, `max_timeout_seconds=3600`
   **Then** the server starts and its API is reachable from the DSF server at the configured `OPENSANDBOX_DOMAIN`

2. **Given** the OpenSandbox server is running
   **When** I run `docker pull opensandbox/code-interpreter:v1.0.2` on the OpenSandbox server
   **Then** the image is cached locally and a test container can be launched successfully

3. **Given** the `docker-compose.yml` and `docker-compose.dev.yml` app service definitions
   **When** a developer inspects the volumes section of the `app` service
   **Then** `/var/run/docker.sock` is not present (deleted, not commented out)

4. **Given** `docs/ops/opensandbox-server.md` exists
   **When** a new platform engineer follows its instructions
   **Then** they can: provision the server, write the correct `~/.sandbox.toml`, start the server, verify health via the API, and restart it if needed — with no other reference required

## Tasks / Subtasks

- [x] Task 1: Remove DooD references from Docker Compose and `.env.example` (AC: #3)
  - [x] 1.1 In `docker-compose.yml`, delete both lines from the `app` service `volumes` section (currently lines 127-128):
    ```
    # Docker socket mount for DooD (Docker-outside-of-Docker) pattern - Story 22.1
    - /var/run/docker.sock:/var/run/docker.sock
    ```
    Hard delete — not commented out (FR-OS2 requires permanent removal).
  - [x] 1.2 Confirm `docker-compose.dev.yml` does not contain `/var/run/docker.sock` (it currently does not — verify only)
  - [x] 1.3 In `.env.example`, delete the `DOCKER_SOCKET_PATH` block (lines 50-52):
    ```
    # Path to Docker socket (default: /var/run/docker.sock)
    # For DooD (Docker-outside-of-Docker) pattern — will be removed in Epic OS (OpenSandbox migration)
    DOCKER_SOCKET_PATH=/var/run/docker.sock
    ```
    Hard delete — this var is only used by DooD code being eliminated.

- [x] Task 2: Create `docs/ops/opensandbox-server.md` (AC: #4)
  - [x] 2.1 Create `docs/ops/` directory if it does not exist
  - [x] 2.2 Write the ops doc with the following required sections (details in Dev Notes):
    - Server Requirements
    - Installation
    - Configuration (`~/.sandbox.toml` full reference)
    - Starting the server (systemd service or manual)
    - Health check procedure (curl the API)
    - Restart procedure
    - Pre-pull required Docker image
    - Troubleshooting

- [ ] Task 3: Ops — Deploy OpenSandbox server on a dedicated VPS (AC: #1, #2) [Platform Engineer / Manual]
  - [ ] 3.1 Provision a VPS/VM (minimum 2 vCPU, 4 GB RAM) with Docker Engine installed and running
  - [ ] 3.2 Install `uv` (`curl -Ls https://astral.sh/uv/install.sh | sh`)
  - [ ] 3.3 Install `opensandbox-server` via `uv pip install opensandbox-server`
  - [ ] 3.4 Write `~/.sandbox.toml` with the exact configuration from the PRD (see Dev Notes)
  - [ ] 3.5 Start the server: `opensandbox-server` (or as a systemd service)
  - [ ] 3.6 Verify health: `curl http://localhost:8080/health` returns 200 with API key header
  - [ ] 3.7 Pre-pull the image: `docker pull opensandbox/code-interpreter:v1.0.2`
  - [ ] 3.8 Verify `OPENSANDBOX_DOMAIN` and `OPENSANDBOX_API_KEY` are set in the DSF `.env` and point to the server

## Dev Notes

### Scope Clarity

This story has **two distinct deliverables**:

1. **Code change** (developer): Remove `docker.sock` mount from `docker-compose.yml` + create `docs/ops/opensandbox-server.md`
2. **Ops task** (platform engineer): Physically deploy and configure the OpenSandbox server on a dedicated machine

The code changes are small and verifiable via git. The ops deployment is a manual infrastructure step.

### Code Changes

#### `docker-compose.yml` — Remove docker.sock

Current state (lines 127-128 in `docker-compose.yml`):

```yaml
# Docker socket mount for DooD (Docker-outside-of-Docker) pattern - Story 22.1
- /var/run/docker.sock:/var/run/docker.sock
```

Action: Delete both lines entirely (not commented out — hard delete per FR-OS2 requirement).

`docker-compose.dev.yml` does NOT currently contain a docker.sock mount — no action needed there.

#### `docs/ops/opensandbox-server.md` — Required Content

The document must allow a new platform engineer to complete the entire setup with zero external references. Required sections:

**1. Server Requirements**

- OS: Ubuntu 22.04 LTS or Debian 12 (recommended)
- CPU: 2+ vCPU (4+ recommended for concurrent sandboxes)
- RAM: 4 GB minimum (8 GB recommended)
- Disk: 20 GB minimum (Docker image storage)
- Docker Engine: installed and running (`docker --version`)
- Python + uv: for installing opensandbox-server
- **Firewall:** Port `8080` must be open inbound **only from the DSF server IP** — never from `0.0.0.0/0`. Example (ufw):
  ```bash
  sudo ufw allow from <DSF_SERVER_IP> to any port 8080
  sudo ufw deny 8080
  ```
  Or configure your cloud security group / VPC firewall rule equivalently.

**2. Installation**

```bash
# Install uv (Python package manager)
curl -Ls https://astral.sh/uv/install.sh | sh
source ~/.bashrc

# Install opensandbox-server
uv pip install opensandbox-server

# Verify
opensandbox-server --version
```

**3. Configuration — `~/.sandbox.toml`**

Full required configuration (from FR-OS3):

```toml
[server]
api_key = "<OPENSANDBOX_API_KEY>"   # Generate a strong random key, copy to DSF OPENSANDBOX_API_KEY
host = "0.0.0.0"
port = 8080

[runtime]
type = "docker"

[docker]
network_mode = "bridge"   # Each sandbox gets an isolated bridge network

[sandbox]
max_timeout_seconds = 3600  # 1 hour max per execution

[secure_container]
# Options: "" (standard Docker), "gvisor", "kata-qemu", "firecracker"
runtime = ""
```

> Generate `api_key` with: `openssl rand -hex 32`

**4. Starting the Server**

Manual (dev/test):

```bash
opensandbox-server
```

As a systemd service (production):

```ini
# /etc/systemd/system/opensandbox.service
[Unit]
Description=OpenSandbox Server
After=docker.service
Requires=docker.service

[Service]
User=opensandbox
ExecStart=/home/opensandbox/.local/bin/opensandbox-server
Restart=always
RestartSec=5
Environment=HOME=/home/opensandbox

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable opensandbox
sudo systemctl start opensandbox
sudo systemctl status opensandbox
```

**5. Health Check**

> **Note for doc author:** Before writing the health endpoint into this runbook, verify the exact path from the `@alibaba-group/opensandbox` package documentation or by inspecting `opensandbox-server --help`. The endpoint shown below (`/health`) is based on the PRD spec — confirm it matches the actual server behavior.

From the OpenSandbox server itself:

```bash
curl -H "Authorization: Bearer <OPENSANDBOX_API_KEY>" http://localhost:8080/health
# Expected: {"status":"ok"}
```

From the DSF server (verify network reachability):

```bash
curl -H "Authorization: Bearer <OPENSANDBOX_API_KEY>" http://<OPENSANDBOX_DOMAIN>/health
# Expected: {"status":"ok"}
```

**6. Pre-pull Required Docker Image**

Must be done on the OpenSandbox server (not the DSF server):

```bash
docker pull opensandbox/code-interpreter:v1.0.2
docker run --rm opensandbox/code-interpreter:v1.0.2 node --version
# Expected: v22.x.x or similar
```

**7. Restart Procedure**

```bash
sudo systemctl restart opensandbox
# Wait for health check to succeed before re-enabling traffic
```

**8. DSF Environment Variables**

The following must be set in the DSF backend `.env`:

```dotenv
OPENSANDBOX_DOMAIN=http://<your-opensandbox-server-ip>:8080
OPENSANDBOX_API_KEY=<same-api_key-from-sandbox.toml>
OPENSANDBOX_AGENT_IMAGE=opensandbox/code-interpreter:v1.0.2
OPENSANDBOX_MAX_CONCURRENT=5
```

### Architecture Context

- **Architecture Decision:** OpenSandbox runs on a dedicated standalone server — NOT as a Docker Compose sidecar alongside DSF. This is the core security win: the DSF server has zero Docker dependency.
- **Connection model:** DSF NestJS backend connects over HTTP/HTTPS via `OPENSANDBOX_DOMAIN` env var.
- **Epic sequence:** This story (OS-1.1) is a prerequisite for OS-1.2 (SandboxModule/SandboxService implementation). OS-1.2 will add the `@alibaba-group/opensandbox` SDK and NestJS module that connects to the server provisioned here.
- **DooD elimination:** The docker.sock removal in this story completes the first step of eliminating the Docker-outside-of-Docker pattern. Full DooD code removal (deleting `DockerService`, `WorkspaceService`, `PtyExecutionService`, and all their env vars) happens in OS-3.
- **Scope boundary — do NOT touch in this story:**
  - `src/config/env.validation.ts` legacy DooD vars (`SANDBOX_*`, `DOCKER_*`, `ENABLE_CONTAINER_EXECUTION`) — removed in OS-3
  - `src/config/configuration.ts` sandbox config block — replaced in OS-1.2
  - `.env.example` Cursor/DooD AI provider vars (`CURSOR_HEADLESS_ENABLED`, `CURSOR_WORKSPACES_ROOT`, etc.) — cleaned up in OS-5
  - Any `src/` code — no NestJS code changes in this story

### Env Vars — Deferred to OS-1.2

`OPENSANDBOX_DOMAIN`, `OPENSANDBOX_API_KEY`, `OPENSANDBOX_AGENT_IMAGE`, and `OPENSANDBOX_MAX_CONCURRENT` do **NOT** yet exist in `src/config/env.validation.ts` or `src/config/configuration.ts`. Do **not** add them in this story — that is the responsibility of story OS-1.2 (SandboxModule creation), when the code that actually consumes them is written.

Current state of `env.validation.ts` and `configuration.ts` (verified):

- `env.validation.ts` contains legacy DooD entries: `SANDBOX_WORKSPACES_ROOT`, `SANDBOX_LOGS_ROOT`, `ENABLE_CONTAINER_EXECUTION`, `DOCKER_CONTAINER_TIMEOUT_MS`, `SANDBOX_MEMORY_LIMIT_MB`, `SANDBOX_CPU_LIMIT_PERCENT`, `DOCKER_MAX_CONCURRENT`, etc.
- `configuration.ts` has a `sandbox:` config block with the comment _"Note: Will be replaced by opensandbox config block in Epic OS migration."_

**Do NOT touch these legacy DooD vars** — their removal is scoped to Epic OS-3 (DooD Elimination). Removing them now would break the build since the legacy services that reference them (`DockerService`, `WorkspaceService`, etc.) are still present until OS-3.

### Source References

- [Source: _bmad-output/planning-artifacts/prd-opensandbox-migration.md#5.1 OpenSandbox Server — Standalone Deployment]
- [Source: _bmad-output/planning-artifacts/prd-opensandbox-migration.md#FR-OS1, FR-OS2, FR-OS3]
- [Source: _bmad-output/planning-artifacts/epics.md#Story OS-1.1]
- [Source: docker-compose.yml#line 127-128]

### Project Structure Notes

- New file: `docs/ops/opensandbox-server.md` — ops runbook for the OpenSandbox server
- Modified: `docker-compose.yml` — remove docker.sock mount from `app` service
- No changes to `src/` in this story — SandboxService implementation is OS-1.2

### Testing Notes

This story is primarily ops + documentation. Testing verification:

1. **Grep check (pre-merge):** `grep -r "docker.sock" docker-compose.yml docker-compose.dev.yml` → zero results
2. **Grep check (pre-merge):** `grep "DOCKER_SOCKET_PATH" .env.example` → zero results
3. **Doc review:** `docs/ops/opensandbox-server.md` must exist and contain all 8 required sections
4. **pnpm build** must pass — no `src/` changes in this story so no compilation risk, but verify

No unit tests needed for this story. The next story (OS-1.2) adds the NestJS SandboxModule and will have comprehensive unit tests for the health ping and SDK integration.

## Dev Agent Record

### Agent Model Used

antigravity

### Debug Log References

- Verified `docker-compose.yml` has no `docker.sock` (`grep -r "docker.sock" docker-compose.yml docker-compose.dev.yml`)
- Verified `.env.example` has no `DOCKER_SOCKET_PATH` (`grep "DOCKER_SOCKET_PATH" .env.example`)
- Built project successfully (`pnpm build`)

### Completion Notes List

- Removed `docker.sock` from `docker-compose.yml`
- Removed `DOCKER_SOCKET_PATH` from `.env.example`
- Verified `docker-compose.dev.yml` does not exist / no socket
- Created `docs/ops/opensandbox-server.md` with all required OpenSandbox deployment instructions
- Fixed missing Troubleshooting section in `docs/ops/opensandbox-server.md`

### File List

- `docker-compose.yml`
- `.env.example`
- `docs/ops/opensandbox-server.md`
- `_bmad-output/implementation-artifacts/os-1-2-sandbox-module-service-startup-health-validation.md`
- `_bmad-output/implementation-artifacts/os-1-3-sandbox-command-execution-real-time-log-streaming.md`
- `_bmad-output/implementation-artifacts/os-1-4-sandbox-prometheus-metrics-concurrency-leak-prevention.md`
