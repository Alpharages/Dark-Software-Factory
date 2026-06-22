import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeStatus, StatusSkillMapConfig } from '@/config/status-skill-map.config';
import { OpenHarnessSkill } from './skills.enum';

@Injectable()
export class StatusSkillMapService {
  private readonly skillsByStatus: Map<string, OpenHarnessSkill>;
  private readonly loopTerminalStatuses: Set<string>;
  readonly loopMaxIterations: number;

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
    this.loopTerminalStatuses = new Set(
      config.loopTerminalStatuses.map((status) => normalizeStatus(status)),
    );

    // A status must be EITHER a skill trigger OR a loop terminal, never both.
    // resolveSkill() is consulted before isLoopTerminal() in the dispatcher, so an
    // overlapping status would dispatch a skill and the loop would never terminate
    // on it. Fail loud at startup rather than loop unbounded at runtime.
    const overlap = [...this.loopTerminalStatuses].filter((status) =>
      this.skillsByStatus.has(status),
    );
    if (overlap.length > 0) {
      throw new Error(
        `statusSkillMap config invalid: status(es) mapped to a skill AND marked loop-terminal: ${overlap.join(', ')}`,
      );
    }

    this.loopMaxIterations = config.loopMaxIterations;
  }

  resolveSkill(status: string | null | undefined): OpenHarnessSkill | null {
    if (!status) {
      return null;
    }

    return this.skillsByStatus.get(normalizeStatus(status)) ?? null;
  }

  isLoopTerminal(status: string | null | undefined): boolean {
    return !!status && this.loopTerminalStatuses.has(normalizeStatus(status));
  }
}
