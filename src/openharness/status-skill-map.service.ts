import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseStatusSkillMap, StatusSkillMapConfig } from '@/config/status-skill-map.config';
import { OpenHarnessSkill } from './skills.enum';

@Injectable()
export class StatusSkillMapService {
  private readonly skillsByStatus: Map<string, OpenHarnessSkill>;

  constructor(configService: ConfigService) {
    const config = configService.get<StatusSkillMapConfig>('statusSkillMap');
    const entries = config?.entries ?? parseStatusSkillMap();
    this.skillsByStatus = new Map(
      entries.map((entry) => [this.normalize(entry.status), entry.skill]),
    );
  }

  resolveSkill(status: string | null | undefined): OpenHarnessSkill | null {
    if (!status) {
      return null;
    }

    return this.skillsByStatus.get(this.normalize(status)) ?? null;
  }

  private normalize(status: string): string {
    return status.trim().toLowerCase();
  }
}
