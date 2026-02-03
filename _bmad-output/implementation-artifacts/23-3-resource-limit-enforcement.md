# Story 23.3: Resource Limit Enforcement

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Security Engineer,
I want to strictly limit the CPU and RAM of each sandbox,
So that one runaway agent cannot crash the entire Host Orchestrator.

## Acceptance Criteria

1. **Given** a container configuration
   **When** spawning the container
   **Then** `HostConfig` must include memory limits (e.g., 512MB)
   **And** CPU quotas must be applied.

2. **Given** resource limit configuration is enabled
   **When** a sandbox container is created
   **Then** the memory limit must be enforced via Docker's cgroup
   **And** the container must be killed if it exceeds the memory limit (OOM).

3. **Given** CPU limit configuration is enabled
   **When** a sandbox container is running
   **Then** the CPU quota/period must restrict CPU usage to the configured percentage
   **And** the container cannot consume more than its allocated CPU share.

4. **Given** different execution types or complexities
   **When** spawning containers
   **Then** resource limits should be configurable per-execution or have sensible defaults
   **And** the system should support tiered limits (small/medium/large) based on task complexity.

5. **Given** resource limit enforcement is active
   **When** containers are running with limits applied
   **Then** Prometheus metrics must track: container OOM events, throttled CPU time, memory usage vs limit
   **And** alerts should be possible when containers hit resource limits.

## Tasks / Subtasks

- [x] Task 1: Add Resource Limit Configuration (AC: 1, 2, 3)
  - [x] Add to `env.validation.ts`:
    - `SANDBOX_MEMORY_LIMIT_MB` (default: 512) - Memory limit in MB per container
    - `SANDBOX_CPU_LIMIT_PERCENT` (default: 100) - CPU limit as percentage of single core
    - `SANDBOX_MEMORY_SWAP_LIMIT_MB` (default: 512) - Swap limit (0 to disable swap)
    - `SANDBOX_ENABLE_RESOURCE_LIMITS` (default: true) - Master switch
  - [x] Add configuration to `configuration.ts` under `sandbox` namespace
  - [x] Create `ResourceLimitConfig` interface for type safety

- [x] Task 2: Integrate Resource Limits into DockerService (AC: 1, 2, 3)
  - [x] Modify `DockerService.runContainer()` to read resource limits from config
  - [x] Map `memoryLimit` bytes to `HostConfig.Memory` (Docker expects bytes)
  - [x] Map `cpuLimit` to `HostConfig.CpuQuota` and `HostConfig.CpuPeriod`
  - [x] Add `HostConfig.MemorySwap` configuration (0 to disable swap for strict limits)
  - [x] Ensure resource limits are only applied when `SANDBOX_ENABLE_RESOURCE_LIMITS=true`
  - [x] Log resource limits at container creation for auditability

- [x] Task 3: Add Resource Limit Metrics (AC: 5)
  - [x] Add Prometheus metrics:
    - `sandbox_container_memory_limit_bytes` - Gauge showing configured memory limit
    - `sandbox_container_cpu_limit_percent` - Gauge showing configured CPU limit
    - `sandbox_container_oom_events_total` - Counter for OOM kills
    - `sandbox_container_cpu_throttled_seconds_total` - Counter for throttled CPU time
    - `sandbox_container_memory_usage_bytes` - Gauge with current usage
  - [x] Use `@InjectMetric` decorator pattern from previous stories
  - [x] Add metric providers to DockerModule

- [x] Task 4: Integrate with PTY Execution Service (AC: 1, 4)
  - [x] Modify `PtyExecutionService.spawnInContainer()` to pass resource options
  - [x] Support per-execution resource overrides via `ContainerSpawnOptions`
  - [x] Add `resourceProfile` option ('small', 'medium', 'large') with predefined limits
  - [x] Ensure backward compatibility - containers spawn without limits if feature disabled

- [x] Task 5: Create Resource Limit Validation & Testing (AC: 1, 2, 3, 4, 5)
  - [x] Unit tests for `DockerService.runContainer()` with resource limits
  - [x] Unit tests for resource limit calculation (MB to bytes, % to quota)
  - [x] Unit tests for resource profile selection
  - [x] Test metrics collection setup
  - [x] Test configuration loading and defaults

- [x] Task 6: Documentation & DevOps
  - [x] Update `.env.example` with new configuration variables
  - [x] Document in `DOCKER_ENV_SETUP.md`
  - [x] Add resource limit section with tuning guidance

## Dev Notes

### Docker Resource Limit Mapping

The Docker API uses specific fields in `HostConfig` for resource limits:

```typescript
// Memory limits
HostConfig.Memory = memoryLimitBytes; // Hard memory limit
HostConfig.MemorySwap = swapLimitBytes; // Swap limit (0 = disable swap)
HostConfig.MemoryReservation = softLimitBytes; // Soft limit for reservation
HostConfig.KernelMemory = kernelMemBytes; // Kernel memory limit
HostConfig.OomKillDisable = false; // Allow OOM killer (security)

// CPU limits
HostConfig.CpuQuota = Math.round(cpuLimit * 100000); // Quota in microseconds (cpuLimit is % of 1 core)
HostConfig.CpuPeriod = 100000; // Period in microseconds (100ms)
HostConfig.CpuShares = 1024; // Relative share (default)
```

**Calculation Examples:**

- 512MB memory → `512 * 1024 * 1024 = 536870912` bytes
- 100% CPU (1 core) → `CpuQuota: 100000, CpuPeriod: 100000`
- 50% CPU (0.5 core) → `CpuQuota: 50000, CpuPeriod: 100000`
- 200% CPU (2 cores) → `CpuQuota: 200000, CpuPeriod: 100000`

### Current DockerService Implementation

The `DockerService.runContainer()` method already supports resource limits via the `RunContainerOptions` interface:

```typescript
// src/docker/docker.service.ts - lines 39-64
export interface RunContainerOptions {
  image: string;
  command?: string[];
  binds?: string[];
  env?: Record<string, string>;
  workingDir?: string;
  user?: string;
  tty?: boolean;
  autoRemove?: boolean;
  name?: string;
  networkMode?: string;
  memoryLimit?: number; // Already exists!
  cpuLimit?: number; // Already exists!
}
```

The current implementation (lines 251-264) already handles the HostConfig mapping:

```typescript
// Build HostConfig
const hostConfig: Dockerode.HostConfig = {
  Binds: binds,
  AutoRemove: autoRemove,
};

if (networkMode) {
  hostConfig.NetworkMode = networkMode;
}

if (memoryLimit) {
  hostConfig.Memory = memoryLimit;
}

if (cpuLimit) {
  hostConfig.CpuQuota = Math.round(cpuLimit * 100000);
  hostConfig.CpuPeriod = 100000;
}
```

### Integration Point: PTY Execution Service

The `PtyExecutionService.spawnInContainer()` calls `DockerService.runContainer()`:

```typescript
// src/ai-routing/services/pty-execution.service.ts:333-346
const { container, stream } = await this.dockerService.runContainer({
  image: 'dsf-agent-base',
  command: fullCommand,
  binds: [`${workspacePath}:/home/agent/workspace:rw`],
  workingDir: '/home/agent/workspace',
  user: 'agent',
  tty: true,
  autoRemove: true,
  env: {
    ...process.env,
    ...options.env,
    NODE_ENV: process.env.NODE_ENV || 'development',
  },
  // TODO: Add resource limits here
});
```

### Resource Profiles

Implement tiered resource profiles for different task complexities:

```typescript
// src/docker/interfaces/resource-profile.interface.ts
export type ResourceProfile = 'small' | 'medium' | 'large' | 'custom';

export interface ResourceProfileConfig {
  memoryLimitMB: number;
  cpuLimitPercent: number;
  swapLimitMB: number;
}

export const DEFAULT_RESOURCE_PROFILES: Record<ResourceProfile, ResourceProfileConfig> = {
  small: { memoryLimitMB: 256, cpuLimitPercent: 50, swapLimitMB: 256 },
  medium: { memoryLimitMB: 512, cpuLimitPercent: 100, swapLimitMB: 512 },
  large: { memoryLimitMB: 1024, cpuLimitPercent: 200, swapLimitMB: 1024 },
  custom: { memoryLimitMB: 0, cpuLimitPercent: 0, swapLimitMB: 0 }, // Use env defaults
};
```

### Configuration Structure

Add to `src/config/configuration.ts`:

```typescript
sandbox: {
  resourceLimits: {
    enabled: process.env.SANDBOX_ENABLE_RESOURCE_LIMITS !== 'false',
    defaultMemoryLimitMB: parseInt(process.env.SANDBOX_MEMORY_LIMIT_MB || '512', 10),
    defaultCpuLimitPercent: parseInt(process.env.SANDBOX_CPU_LIMIT_PERCENT || '100', 10),
    defaultSwapLimitMB: parseInt(process.env.SANDBOX_MEMORY_SWAP_LIMIT_MB || '512', 10),
  },
  // ... existing config
},
```

### Metrics Implementation

Use the pattern from Story 23.1 and 23.2:

```typescript
// In docker.module.ts
makeGaugeProvider({
  name: 'sandbox_container_memory_limit_bytes',
  help: 'Configured memory limit per container',
  labelNames: ['profile'],
}),
makeGaugeProvider({
  name: 'sandbox_container_cpu_limit_percent',
  help: 'Configured CPU limit percentage per container',
  labelNames: ['profile'],
}),
makeCounterProvider({
  name: 'sandbox_container_oom_events_total',
  help: 'Total number of container OOM events',
  labelNames: ['execution_id'],
}),
```

### Testing Strategy

**Unit Tests:**

- Test memory limit byte conversion
- Test CPU quota calculation
- Test configuration loading
- Test profile selection logic

**Integration Tests:**

- Start container with memory limit, verify via `docker inspect`
- Start CPU-intensive container, verify throttling via `docker stats`
- Trigger OOM by allocating more memory than limit, verify kill signal

**Manual Verification:**

```bash
# Check container limits
docker inspect <container_id> --format='{{.HostConfig.Memory}} {{.HostConfig.CpuQuota}}'

# Monitor during load
docker stats <container_id>
```

### Project Structure Notes

**Modified Files:**

- `src/config/env.validation.ts` - Add resource limit environment variables
- `src/config/configuration.ts` - Add sandbox resource limit config
- `src/docker/docker.service.ts` - Read config and apply to HostConfig
- `src/docker/docker.module.ts` - Add metric providers
- `src/ai-routing/services/pty-execution.service.ts` - Pass resource limits to runContainer
- `src/ai-routing/interfaces/container-spawn-options.interface.ts` - Add resource options
- `.env.example` - Document new variables

**New Files:**

- `src/docker/interfaces/resource-profile.interface.ts` - Profile type definitions
- `src/docker/interfaces/resource-limit-config.interface.ts` - Config interface

### Dependencies

- Uses `DockerService` (`src/docker/docker.service.ts`) for container creation
- Uses `ConfigService` for configuration access
- Uses `AppMetricsModule` for Prometheus metrics (pattern from Story 23.1, 23.2)
- Integrates with `PtyExecutionService` for execution-time resource profiles

### Key Architectural Decisions

- **Default Resource Limits**: Medium profile (512MB, 1 CPU) as conservative default
- **Swap Handling**: Match memory limit by default (prevent swap abuse), configurable
- **OOM Behavior**: Allow OOM killer (security > availability for sandbox containers)
- **CPU Throttling**: Use quota/period for hard limits, not shares (which are relative)
- **Profile-Based**: Simple string profiles (small/medium/large) for easy selection
- **Backward Compatible**: Feature can be disabled entirely via configuration

### Error Handling Strategy

| Error Scenario                 | Handling                                                          |
| ------------------------------ | ----------------------------------------------------------------- |
| Resource limit > host capacity | Log warning, clamp to host capacity, continue                     |
| Cgroup not supported           | Log warning, disable resource limits for this container, continue |
| Invalid resource profile       | Fall back to 'medium' profile, log error                          |
| OOM event during execution     | Record metric, allow cleanup to proceed normally                  |

### Interaction with Container Cleanup

Resource limits affect cleanup behavior:

- OOM-killed containers (exit code 137) should be handled gracefully by CleanupService
- CPU-throttled containers may take longer to exit - cleanup timeout should account for this
- See Story 23.2 for cleanup service integration details

### References

- [Source: _bmad-output/planning-artifacts/epics-containerization.md#Story 2.3 - Resource Limit Enforcement AC]
- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml#epic-023 - Epic status]
- [Story 23-1: Local Git Mirror Service - Patterns for @InjectMetric and metrics]
- [Story 23-2: Automated Container Cleanup - Patterns for configuration and Docker integration]
- [Source: src/docker/docker.service.ts:251-264 - Existing resource limit implementation in runContainer]
- [Source: src/ai-routing/services/pty-execution.service.ts:333-346 - Container spawn integration point]
- [Docker Docs: Runtime constraints on resources](https://docs.docker.com/config/containers/resource_constraints/)

## Dev Agent Record

### Agent Model Used

Kimi Code CLI

### Debug Log References

N/A - All tests passing, no critical issues encountered.

### Completion Notes List

✅ **Task 1 Complete**: Added resource limit configuration variables to env.validation.ts with proper Joi validation (min/max bounds). Added sandbox namespace to configuration.ts with proper type-safe parsing.

✅ **Task 2 Complete**: Updated DockerService.runContainer() to apply resource limits from config. Implemented `buildResourceLimits()` method with priority: explicit values > profile > config defaults. Added OomKillDisable=false for security. Added logging for auditability.

✅ **Task 3 Complete**: Added 5 Prometheus metrics to DockerModule using makeGaugeProvider/makeCounterProvider. Injected metrics into DockerService with @InjectMetric decorator. Added helper methods: recordOomEvent(), recordCpuThrottled(), updateMemoryUsage().

✅ **Task 4 Complete**: Updated ContainerSpawnOptions interface to include resourceProfile, memoryLimit, cpuLimit. Modified spawnInContainer() to pass options to DockerService. Added selectResourceProfile() helper for complexity-based selection. Added spawnWithProfile() method.

✅ **Task 5 Complete**: Created resource-profile.interface.spec.ts with comprehensive tests for conversion functions and profile selection. Updated docker.service.spec.ts with metric mocks and resource limit tests. Updated pty-execution.service.spec.ts with resource profile tests.

✅ **Task 6 Complete**: Added resource limit section to .env.example with documentation. Updated DOCKER_ENV_SETUP.md with resource limit configuration table and tuning guidance.

### File List

**New Files:**

- `src/docker/interfaces/resource-profile.interface.ts` - Profile types, default profiles, conversion utilities
- `src/docker/interfaces/resource-limit-config.interface.ts` - Config interfaces for type safety
- `src/docker/interfaces/resource-profile.interface.spec.ts` - Unit tests for profile utilities

**Modified Files:**

- `src/config/env.validation.ts` - Added SANDBOX\_\* environment variable validation
- `src/config/configuration.ts` - Added sandbox namespace with resourceLimits config
- `src/docker/docker.service.ts` - Integrated resource limits into runContainer(), added metric tracking methods
- `src/docker/docker.module.ts` - Added 5 Prometheus metric providers
- `src/docker/index.ts` - Exported new interfaces
- `src/ai-routing/services/pty-execution.service.ts` - Added resource profile support to container spawning
- `src/ai-routing/services/pty-execution.service.spec.ts` - Added resource profile selection tests
- `src/docker/docker.service.spec.ts` - Added metric mocks and resource limit tests
- `.env.example` - Added resource limit configuration section
- `DOCKER_ENV_SETUP.md` - Added resource limit documentation with tuning guidance

**Metrics Added:**

- `sandbox_container_memory_limit_bytes` - Gauge with profile label
- `sandbox_container_cpu_limit_percent` - Gauge with profile label
- `sandbox_container_oom_events_total` - Counter with execution_id label
- `sandbox_container_cpu_throttled_seconds_total` - Counter with execution_id label
- `sandbox_container_memory_usage_bytes` - Gauge with execution_id label

## Change Log

| Date       | Version | Changes                                                                  |
| ---------- | ------- | ------------------------------------------------------------------------ |
| 2026-02-03 | 1.0.0   | Initial implementation - Story 23.3 Resource Limit Enforcement           |
| 2026-02-03 | 1.0.0   | Added resource limit configuration (env.validation.ts, configuration.ts) |
| 2026-02-03 | 1.0.0   | Integrated resource limits into DockerService.runContainer()             |
| 2026-02-03 | 1.0.0   | Added 5 Prometheus metrics for resource tracking                         |
| 2026-02-03 | 1.0.0   | Integrated with PTYExecutionService for per-execution resource profiles  |
| 2026-02-03 | 1.0.0   | Added comprehensive unit tests                                           |
| 2026-02-03 | 1.0.0   | Updated documentation (.env.example, DOCKER_ENV_SETUP.md)                |
