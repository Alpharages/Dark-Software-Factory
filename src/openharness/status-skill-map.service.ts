import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeStatus, StatusSkillMapConfig } from '@/config/status-skill-map.config';
import { OpenHarnessSkill } from './skills.enum';

@Injectable()
export class StatusSkillMapService {
  private readonly skillsByStatus: Map<string, OpenHarnessSkill>;

  constructor(configService: ConfigService) {
    const config = configService.get<StatusSkillMapConfig>('statusSkillMap');
    // Fail loud if the namespace did not load — silently re-reading process.env
    // here would mask broken ConfigModule wiring and could throw deep inside DI.
    if (!config?.entries) {
      throw new Error(
        'statusSkillMap config namespace is not loaded — register status-skill-map.config in ConfigModule before using StatusSkillMapService',
      );
    }
    this.skillsByStatus = new Map(
      config.entries.map((entry) => [normalizeStatus(entry.status), entry.skill]),
    );
  }

  resolveSkill(status: string | null | undefined): OpenHarnessSkill | null {
    if (!status) {
      return null;
    }

    return this.skillsByStatus.get(normalizeStatus(status)) ?? null;
  }
}
