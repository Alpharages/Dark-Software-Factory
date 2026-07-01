import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { OpenHarnessSkill } from './skills.enum';

export interface ResolvedSkillModel {
  model: string;
  provider: string;
  runtime: string;
}

type SkillModelMapRow = {
  skill: string;
  model: string;
  provider: string;
  runtime: string;
};

const CACHE_TTL_MS = 30_000;

@Injectable()
export class SkillModelMapService {
  private cache: { expiresAt: number; value: Map<string, ResolvedSkillModel> } | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async resolveModel(skill: string): Promise<ResolvedSkillModel> {
    const map = await this.loadMap();
    return map.get(skill) ?? this.staticFallback();
  }

  /** Drops the cached map so the next resolveModel() re-reads the DB (AC1 "no redeploy"). */
  invalidateCache(): void {
    this.cache = null;
  }

  private async loadMap(): Promise<Map<string, ResolvedSkillModel>> {
    const now = Date.now();
    if (this.cache && this.cache.expiresAt > now) {
      return this.cache.value;
    }

    const rows: SkillModelMapRow[] = await this.prisma.skillModelMap.findMany();
    const map = new Map<string, ResolvedSkillModel>();
    for (const row of rows) {
      map.set(row.skill, this.rowToResolved(row));
    }

    // ponytail: in-process TTL, swap to Redis if multi-instance staleness matters.
    this.cache = { expiresAt: now + CACHE_TTL_MS, value: map };
    return map;
  }

  private rowToResolved(row: SkillModelMapRow): ResolvedSkillModel {
    if (!Object.values(OpenHarnessSkill).includes(row.skill as OpenHarnessSkill)) {
      throw new Error(`SkillModelMap row has unknown skill: ${row.skill}`);
    }
    if (row.runtime !== 'oh' && row.runtime !== 'claude') {
      throw new Error(
        `SkillModelMap row for skill ${row.skill} has invalid runtime: ${row.runtime}`,
      );
    }
    if (row.provider !== 'openai' && row.provider !== 'claude') {
      throw new Error(
        `SkillModelMap row for skill ${row.skill} has invalid provider: ${row.provider}`,
      );
    }
    const expectedProvider = row.runtime === 'oh' ? 'openai' : 'claude';
    if (row.provider !== expectedProvider) {
      throw new Error(
        `SkillModelMap row for skill ${row.skill} has provider/runtime mismatch: provider=${row.provider} runtime=${row.runtime}`,
      );
    }
    return { model: row.model, provider: row.provider, runtime: row.runtime };
  }

  private staticFallback(): ResolvedSkillModel {
    const runtime = this.configService.get<string>('openharness.runtime') ?? 'oh';
    if (runtime === 'claude') {
      const model = this.configService.get<string>('openharness.claudeModel') ?? 'sonnet';
      return { model, provider: 'claude', runtime: 'claude' };
    }
    const model = this.configService.get<string>('openharness.model') ?? 'gpt-5.4';
    return { model, provider: 'openai', runtime: 'oh' };
  }
}
