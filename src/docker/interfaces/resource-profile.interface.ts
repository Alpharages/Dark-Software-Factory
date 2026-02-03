/**
 * Resource Profile Types
 * Story 23.3: Resource Limit Enforcement
 *
 * Defines resource profiles for sandbox containers with different
 * complexity levels.
 */

/**
 * Resource profile type for container execution
 */
export type ResourceProfile = 'small' | 'medium' | 'large' | 'custom';

/**
 * Configuration for a specific resource profile
 */
export interface ResourceProfileConfig {
  /** Memory limit in megabytes */
  memoryLimitMB: number;
  /** CPU limit as percentage of single core (100 = 1 core) */
  cpuLimitPercent: number;
  /** Swap limit in megabytes (0 to disable swap) */
  swapLimitMB: number;
}

/**
 * Default resource profiles for different task complexities
 */
export const DEFAULT_RESOURCE_PROFILES: Record<ResourceProfile, ResourceProfileConfig> = {
  small: { memoryLimitMB: 256, cpuLimitPercent: 50, swapLimitMB: 256 },
  medium: { memoryLimitMB: 512, cpuLimitPercent: 100, swapLimitMB: 512 },
  large: { memoryLimitMB: 1024, cpuLimitPercent: 200, swapLimitMB: 1024 },
  custom: { memoryLimitMB: 0, cpuLimitPercent: 0, swapLimitMB: 0 }, // Use env defaults
};

/**
 * Get resource profile config by name
 * Falls back to 'medium' if profile not found
 */
export function getResourceProfile(profile: ResourceProfile): ResourceProfileConfig {
  // Use a switch statement for type-safe access (avoiding object injection risk)
  switch (profile) {
    case 'small':
      return DEFAULT_RESOURCE_PROFILES.small;
    case 'medium':
      return DEFAULT_RESOURCE_PROFILES.medium;
    case 'large':
      return DEFAULT_RESOURCE_PROFILES.large;
    case 'custom':
      return DEFAULT_RESOURCE_PROFILES.custom;
    default:
      return DEFAULT_RESOURCE_PROFILES.medium;
  }
}

/**
 * Convert megabytes to bytes for Docker API
 */
export function mbToBytes(mb: number): number {
  return mb * 1024 * 1024;
}

/**
 * Convert CPU percentage to Docker quota/period values
 * Docker uses microseconds for quota/period
 * @param percent CPU percentage (100 = 1 core, 200 = 2 cores)
 * @returns Object with CpuQuota and CpuPeriod
 */
export function cpuPercentToQuota(percent: number): { cpuQuota: number; cpuPeriod: number } {
  const cpuPeriod = 100000; // 100ms in microseconds
  const cpuQuota = Math.round((percent / 100) * cpuPeriod);
  return { cpuQuota, cpuPeriod };
}
