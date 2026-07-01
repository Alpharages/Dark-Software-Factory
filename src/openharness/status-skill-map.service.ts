import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  normalizeStatus,
  parseStatusSkillMap,
  StatusSkillMapConfig,
} from '@/config/status-skill-map.config';
import { PrismaService } from '@/database/prisma.service';
import { OpenHarnessSkill } from './skills.enum';

const GLOBAL_STATUS_SKILL_MAP_CONFIG_KEY = 'status_skill_map.global';
const CACHE_TTL_MS = 30_000;

type SkillMapCache = {
  expiresAt: number;
  value: Map<string, OpenHarnessSkill>;
};

type ProjectStatusSkillMapRow = {
  status: string;
  normalized_status: string;
  skill: string;
};

@Injectable()
export class StatusSkillMapService {
  private readonly configSkillsByStatus: Map<string, OpenHarnessSkill>;
  private readonly loopTerminalStatuses: Set<string>;
  private globalCache: SkillMapCache | null = null;
  private readonly projectCache = new Map<string, SkillMapCache>();
  readonly loopMaxIterations: number;

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const config = configService.get<StatusSkillMapConfig>('statusSkillMap');
    // Fail loud if the namespace did not load — silently re-reading process.env
    // here would mask broken ConfigModule wiring and could throw deep inside DI.
    if (!config?.entries) {
      throw new Error(
        'statusSkillMap config namespace is not loaded — register status-skill-map.config in ConfigModule before using StatusSkillMapService',
      );
    }
    this.configSkillsByStatus = new Map(
      config.entries.map((entry) => [normalizeStatus(entry.status), entry.skill]),
    );
    this.loopTerminalStatuses = new Set(
      config.loopTerminalStatuses.map((status) => normalizeStatus(status)),
    );

    // A status must be EITHER a skill trigger OR a loop terminal, never both.
    // resolveSkill() is consulted before isLoopTerminal() in the dispatcher, so an
    // overlapping status would dispatch a skill and the loop would never terminate
    // on it. Fail loud at startup rather than loop unbounded at runtime.
    this.assertNoLoopTerminalOverlap(this.configSkillsByStatus, 'statusSkillMap config');

    this.loopMaxIterations = config.loopMaxIterations;
  }

  async resolveSkill(
    status: string | null | undefined,
    projectId?: string | null,
  ): Promise<OpenHarnessSkill | null> {
    if (!status) {
      return null;
    }

    const skillsByStatus = projectId
      ? await this.effectiveProjectMap(projectId)
      : await this.globalMap();
    return skillsByStatus.get(normalizeStatus(status)) ?? null;
  }

  isLoopTerminal(status: string | null | undefined): boolean {
    return !!status && this.loopTerminalStatuses.has(normalizeStatus(status));
  }

  private async effectiveProjectMap(projectId: string): Promise<Map<string, OpenHarnessSkill>> {
    const now = Date.now();
    const cached = this.projectCache.get(projectId);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const globalMap = await this.globalMap();
    const rows = await this.prisma.projectStatusSkillMap.findMany({
      where: { project_id: projectId },
      select: { status: true, normalized_status: true, skill: true },
    });

    if (rows.length === 0) {
      return globalMap;
    }

    const effective = new Map(globalMap);
    for (const row of rows) {
      const status = this.normalizedRowStatus(row);
      const skill = this.rowSkill(row);
      effective.set(status, skill);
    }
    this.assertNoLoopTerminalOverlap(effective, `project statusSkillMap for ${projectId}`);

    // ponytail: in-process TTL, swap to Redis if multi-instance config staleness matters.
    this.projectCache.set(projectId, { expiresAt: now + CACHE_TTL_MS, value: effective });
    return effective;
  }

  private async globalMap(): Promise<Map<string, OpenHarnessSkill>> {
    const now = Date.now();
    if (this.globalCache && this.globalCache.expiresAt > now) {
      return this.globalCache.value;
    }

    const dbConfig = await this.prisma.systemConfig.findUnique({
      where: { key: GLOBAL_STATUS_SKILL_MAP_CONFIG_KEY },
      select: { value: true },
    });

    const value = dbConfig
      ? this.entriesToMap(parseStatusSkillMap(dbConfig.value))
      : this.configSkillsByStatus;
    this.assertNoLoopTerminalOverlap(value, 'global statusSkillMap');
    this.globalCache = { expiresAt: now + CACHE_TTL_MS, value };
    return value;
  }

  private entriesToMap(entries: StatusSkillMapConfig['entries']): Map<string, OpenHarnessSkill> {
    return new Map(entries.map((entry) => [normalizeStatus(entry.status), entry.skill]));
  }

  private normalizedRowStatus(row: ProjectStatusSkillMapRow): string {
    const normalized = normalizeStatus(row.status);
    if (!normalized) {
      throw new Error('project statusSkillMap row has an empty status');
    }
    if (row.normalized_status !== normalized) {
      throw new Error(
        `project statusSkillMap row normalized_status mismatch for "${row.status}": expected "${normalized}", got "${row.normalized_status}"`,
      );
    }
    return normalized;
  }

  private rowSkill(row: ProjectStatusSkillMapRow): OpenHarnessSkill {
    if (!Object.values(OpenHarnessSkill).includes(row.skill as OpenHarnessSkill)) {
      throw new Error(`project statusSkillMap row has unknown skill: ${row.skill}`);
    }
    return row.skill as OpenHarnessSkill;
  }

  private assertNoLoopTerminalOverlap(map: Map<string, OpenHarnessSkill>, source: string): void {
    const overlap = [...this.loopTerminalStatuses].filter((status) => map.has(status));
    if (overlap.length > 0) {
      throw new Error(
        `${source} invalid: status(es) mapped to a skill AND marked loop-terminal: ${overlap.join(', ')}`,
      );
    }
  }
}
