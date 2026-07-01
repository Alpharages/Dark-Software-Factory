import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { SkillModelMapService } from '@/openharness/skill-model-map.service';
import { OpenHarnessSkill } from '@/openharness/skills.enum';
import { UpdateSkillModelMapEntryDto } from './dto/skill-model-map.dto';

@Injectable()
export class SkillModelMapAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skillModelMap: SkillModelMapService,
  ) {}

  async listEntries() {
    return this.prisma.skillModelMap.findMany({ orderBy: { skill: 'asc' } });
  }

  async updateEntry(skill: string, dto: UpdateSkillModelMapEntryDto, userId?: string) {
    if (!Object.values(OpenHarnessSkill).includes(skill as OpenHarnessSkill)) {
      throw new BadRequestException(`Unknown skill: ${skill}`);
    }

    const expectedProvider = dto.runtime === 'oh' ? 'openai' : 'claude';
    if (dto.provider !== expectedProvider) {
      throw new BadRequestException(
        `provider "${dto.provider}" is inconsistent with runtime "${dto.runtime}" (expected "${expectedProvider}")`,
      );
    }

    const data = {
      model: dto.model,
      provider: dto.provider,
      runtime: dto.runtime,
      updated_by: userId,
    };
    const row = await this.prisma.skillModelMap.upsert({
      where: { skill },
      update: data,
      create: { skill, ...data },
    });
    this.skillModelMap.invalidateCache();

    return row;
  }
}
