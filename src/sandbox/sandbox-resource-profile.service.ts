import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ResourceProfile {
  cpuLimit: string;
  memoryLimit: string;
}

@Injectable()
export class SandboxResourceProfileService {
  // Small: scores 0-3
  private readonly SMALL: ResourceProfile = { cpuLimit: '0.5', memoryLimit: '256Mi' };
  // Large: scores 8-10
  private readonly LARGE: ResourceProfile = { cpuLimit: '2', memoryLimit: '1Gi' };

  constructor(private readonly config: ConfigService) {}

  getProfile(score: number): ResourceProfile {
    if (!Number.isFinite(score) || score <= 3) return this.SMALL;
    if (score >= 8) return this.LARGE;
    // Medium (4-7): check env overrides
    return {
      cpuLimit: this.config.get<string>('opensandbox.defaultCpuLimit', '1'),
      memoryLimit: this.config.get<string>('opensandbox.defaultMemoryLimit', '512Mi'),
    };
  }
}
