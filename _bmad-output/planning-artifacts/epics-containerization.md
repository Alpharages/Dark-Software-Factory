---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories']
inputDocuments: [dsf-deployment-strategy.md, containerized-execution-design.md]
---

# Dark Software Factory - Containerization Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the **Containerized Sandbox Strategy**, decomposing requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR-C1: Orchestrator must execute all AI tasks within isolated Docker containers (Sandbox).
FR-C2: Orchestrator must utilize the host's Docker daemon (via socket mount) to spawn these containers (Docker-outside-of-Docker).
FR-C3: Orchestrator must create a host directory for the workspace and bind-mount it into the container at runtime.
FR-C4: System must maintain a local bare git mirror on the host to accelerate container cloning operations.
FR-C5: System must use a standardized Docker image pre-loaded with agent tools (Node, Python, Git, CLI) for all tasks.
FR-C6: Orchestrator must automatically remove containers and cleanup host workspace volumes after task completion.
FR-C7: Orchestrator must stream container logs (stdout/stderr) to the execution tracker in real-time.
FR-C8: System must support resource limits (CPU/Memory) for each sandbox container.

### NonFunctional Requirements

NFR-C1: Sandbox startup time must be < 2 seconds.
NFR-C2: Containers must not run as root.
NFR-C3: Complete filesytem isolation (except workspace).
NFR-C4: Graceful crash handling.

### Additional Requirements

- Deploy on AWS EC2.
- Use `dockerode` library.
- Use `docker -v /var/run/docker.sock` pattern.

### FR Coverage Map

FR-C1: Epic 1 - Core sandbox execution logic
FR-C2: Epic 1 - Docker socket integration
FR-C3: Epic 1 - Workspace bind-mounting
FR-C4: Epic 2 - Optimization via Git Mirroring
FR-C5: Epic 1 - Agent Image usage
FR-C6: Epic 2 - Cleanup and lifecycle management
FR-C7: Epic 1 - Log streaming integration
FR-C8: Epic 2 - Resource limits enforcing

## Epic List

### Epic 1: Docker-Controlled Execution Engine

**User Value:** As an operator, I want the system to execute AI tasks inside isolated containers so that the host server remains clean and secure.
**Goal:** Transform the Orchestrator into a "Docker Controller" that can spawn, monitor, and stream logs from sibling containers using the DooD pattern.
**FRs covered:** FR-C1, FR-C2, FR-C3, FR-C5, FR-C7

### Epic 2: Intelligent Sandbox Lifecycle & Optimization

**User Value:** As an operator, I want efficient and safe execution, where workspaces are cleaned up automatically and cloning is instant.
**Goal:** Implement advanced sandbox features including local git mirroring for speed, auto-cleanup for hygiene, and resource limits for safety.
**FRs covered:** FR-C4, FR-C6, FR-C8

## Epic 1: Docker-Controlled Execution Engine

### Story 1.1: Docker Client Integration

As a Developer,
I want to integrate `dockerode` into the NestJS Orchestrator,
So that I can programmically control the host Docker daemon.

**Acceptance Criteria:**
**Given** the Orchestrator Service is running
**When** the `DockerService` is initialized
**Then** it should successfully connect to `/var/run/docker.sock`
**And** it should be able to list running containers (proving connection)
**And** it should fail gracefully if the socket is missing

### Story 1.2: Base Agent Image Management

As a System Admin,
I want a standardized `dsf-agent` Docker image defined and buildable,
So that every AI task runs in a consistent environment with all tools pre-installed.

**Acceptance Criteria:**
**Given** the `docker/agent` directory
**When** I run `docker build`
**Then** it should create an image containing Node.js, Python, Git, and generic CLI tools
**And** the image should act as the base for all future executions

### Story 1.3: Sandbox Workspace Mounting

As the Orchestrator,
I want to create a host directory and bind-mount it into the container at `/workspace`,
So that file changes made by the AI persist after the container dies.

**Acceptance Criteria:**
**Given** a new task request
**When** spawning a container
**Then** a `tmp` directory on the host must be created
**And** it must be mounted with Read/Write permissions to `/workspace` inside the container
**And** the container must have the correct User ID map to write to it

### Story 1.4: Container Execution & Log Streaming

As an Operator,
I want to see the real-time logs of the agent running inside the container,
So that I can debug issues and track progress.

**Acceptance Criteria:**
**Given** a running sandbox container
**When** the agent prints to `stdout` or `stderr`
**Then** the Orchestrator must capture these logs streams
**And** forward them to the existing `ExecutionTrackerService`

## Epic 2: Intelligent Sandbox Lifecycle & Optimization

### Story 2.1: Local Git Mirror Service

As a Performance Engineer,
I want the system to maintain a local "bare" cache of the target repository,
So that creating a new workspace takes milliseconds instead of seconds/minutes.

**Acceptance Criteria:**
**Given** a frequent repository
**When** a new task starts
**Then** the system should check for a local mirror
**And** if present, `git clone` from the mirror to the workspace
**And** if missing, fetch from GitHub and create the mirror first

### Story 2.2: Automated Container Cleanup

As an Operator,
I want containers and volumes to be deleted automatically after execution,
So that the host server disk never fills up.

**Acceptance Criteria:**
**Given** a completed task (success or failure)
**When** the execution finishes
**Then** the specific Docker container must be removed
**And** the temporary workspace folder on the host must be deleted (unless debug mode is on)

### Story 2.3: Resource Limit Enforcement

As a Security Engineer,
I want to strictly limit the CPU and RAM of each sandbox,
So that one runaway agent cannot crash the entire Host Orchestrator.

**Acceptance Criteria:**
**Given** a container configuration
**When** spawning the container
**Then** `HostConfig` must include memory limits (e.g. 512MB)
**And** CPU quotas must be applied
