/**
 * Resource Limit Configuration Interface
 * Story 23.3: Resource Limit Enforcement
 *
 * Type-safe configuration for sandbox resource limits.
 */

/**
 * Resource limit configuration for sandbox containers
 */
export interface ResourceLimitConfig {
  /** Master switch to enable/disable resource limits */
  enabled: boolean;
  /** Default memory limit in megabytes */
  defaultMemoryLimitMB: number;
  /** Default CPU limit as percentage of single core */
  defaultCpuLimitPercent: number;
  /** Default swap limit in megabytes (0 to disable swap) */
  defaultSwapLimitMB: number;
}

/**
 * Complete sandbox configuration including resource limits
 */
export interface SandboxConfig {
  /** Resource limit settings */
  resourceLimits: ResourceLimitConfig;
  /** Root directory for sandbox workspaces */
  workspacesRoot: string;
  /** Container execution timeout in milliseconds */
  containerTimeoutMs: number;
  /** Feature flag for container execution */
  containerExecutionEnabled: boolean;
}

/**
 * Docker-specific resource limit settings for HostConfig
 */
export interface DockerResourceLimits {
  /** Memory limit in bytes */
  memoryBytes: number;
  /** CPU quota in microseconds */
  cpuQuota: number;
  /** CPU period in microseconds */
  cpuPeriod: number;
  /** Swap limit in bytes (0 to disable) */
  swapBytes: number;
  /** Whether OOM killer is disabled (false = allow OOM kill) */
  oomKillDisable: boolean;
}
