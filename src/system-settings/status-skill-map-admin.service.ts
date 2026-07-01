import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import {
  DEFAULT_STATUS_SKILL_MAP,
  parseStatusSkillMap,
  StatusSkillMapConfig,
  StatusSkillMapEntry,
} from '@/config/status-skill-map.config';
import {
  GLOBAL_STATUS_SKILL_MAP_CONFIG_KEY,
  StatusSkillMapService,
} from '@/openharness/status-skill-map.service';

export interface GlobalStatusSkillMap {
  entries: StatusSkillMapEntry[];
  loopTerminalStatuses: string[];
  loopMaxIterations: number;
}

@Injectable()
export class StatusSkillMapAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly statusSkillMap: StatusSkillMapService,
  ) {}

  async getGlobalMap(): Promise<GlobalStatusSkillMap> {
    const row = await this.prisma.systemConfig.findUnique({
      where: { key: GLOBAL_STATUS_SKILL_MAP_CONFIG_KEY },
      select: { value: true },
    });
    const entries = row ? parseStatusSkillMap(row.value) : DEFAULT_STATUS_SKILL_MAP;

    // Namespace is guaranteed to be loaded — StatusSkillMapService's constructor
    // already throws at boot if it isn't, so this map is never in a running process.
    const config = this.configService.get<StatusSkillMapConfig>('statusSkillMap')!;

    return {
      entries,
      loopTerminalStatuses: config.loopTerminalStatuses,
      loopMaxIterations: config.loopMaxIterations,
    };
  }

  async setGlobalMap(
    entries: StatusSkillMapEntry[],
    userId?: string,
  ): Promise<StatusSkillMapEntry[]> {
    const validated = this.validate(entries);

    await this.prisma.systemConfig.upsert({
      where: { key: GLOBAL_STATUS_SKILL_MAP_CONFIG_KEY },
      update: { value: JSON.stringify(validated), updated_by: userId },
      create: {
        key: GLOBAL_STATUS_SKILL_MAP_CONFIG_KEY,
        value: JSON.stringify(validated),
        updated_by: userId,
      },
    });
    this.statusSkillMap.invalidateGlobalCache();

    return validated;
  }

  private validate(entries: StatusSkillMapEntry[]): StatusSkillMapEntry[] {
    // Reuse the config-parse authority for shape/enum/duplicate-normalized-status
    // checks (architecture guardrail: parseStatusSkillMap stays the single source
    // of truth). It also rejects an empty array — kept deliberately: an empty
    // global map would make every future globalMap() read throw (see A1 review
    // finding F4), which would break dispatch platform-wide, not just this project.
    let parsed: StatusSkillMapEntry[];
    try {
      parsed = parseStatusSkillMap(JSON.stringify(entries));
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }

    const terminalCollision = parsed.find((entry) =>
      this.statusSkillMap.isLoopTerminal(entry.status),
    );
    if (terminalCollision) {
      throw new BadRequestException(
        `status "${terminalCollision.status}" is a loop-terminal status and cannot also map to a skill`,
      );
    }

    return parsed;
  }
}
