export { DockerModule } from './docker.module';
export { DockerService } from './docker.service';

// Story 23.3: Resource Limit Enforcement - Interfaces
export {
  ResourceProfile,
  ResourceProfileConfig,
  DEFAULT_RESOURCE_PROFILES,
  getResourceProfile,
  mbToBytes,
  cpuPercentToQuota,
} from './interfaces/resource-profile.interface';
export {
  ResourceLimitConfig,
  SandboxConfig,
  DockerResourceLimits,
} from './interfaces/resource-limit-config.interface';
