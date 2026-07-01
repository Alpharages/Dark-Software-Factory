import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { OpenHarnessSkill } from './skills.enum';
import { SkillModelMapService } from './skill-model-map.service';

describe('SkillModelMapService', () => {
  let service: SkillModelMapService;
  let prisma: { skillModelMap: { findMany: jest.Mock } };
  let config: { get: jest.Mock };

  const configValues: Record<string, unknown> = {
    'openharness.model': 'gpt-5.4',
    'openharness.runtime': 'oh',
    'openharness.claudeModel': 'sonnet',
  };

  beforeEach(async () => {
    prisma = { skillModelMap: { findMany: jest.fn().mockResolvedValue([]) } };
    config = { get: jest.fn((key: string) => configValues[key]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillModelMapService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get<SkillModelMapService>(SkillModelMapService);
  });

  describe('resolveModel', () => {
    it('returns the DB row when a mapping exists for the skill', async () => {
      prisma.skillModelMap.findMany.mockResolvedValue([
        {
          skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW,
          model: 'opus',
          provider: 'claude',
          runtime: 'claude',
        },
      ]);

      const result = await service.resolveModel(OpenHarnessSkill.CLICKUP_CODE_REVIEW);

      expect(result).toEqual({ model: 'opus', provider: 'claude', runtime: 'claude' });
    });

    it('falls back to static config when no row exists for the skill (AC4)', async () => {
      prisma.skillModelMap.findMany.mockResolvedValue([
        {
          skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW,
          model: 'opus',
          provider: 'claude',
          runtime: 'claude',
        },
      ]);

      const result = await service.resolveModel(OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT);

      expect(result).toEqual({ model: 'gpt-5.4', provider: 'openai', runtime: 'oh' });
    });

    it('falls back to static config for every skill when the table is empty (AC4)', async () => {
      prisma.skillModelMap.findMany.mockResolvedValue([]);

      const result = await service.resolveModel(OpenHarnessSkill.CLICKUP_QA);

      expect(result).toEqual({ model: 'gpt-5.4', provider: 'openai', runtime: 'oh' });
    });

    it('falls back to the claude static config when configured runtime is claude', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'openharness.runtime' ? 'claude' : configValues[key],
      );
      prisma.skillModelMap.findMany.mockResolvedValue([]);

      const result = await service.resolveModel(OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT);

      expect(result).toEqual({ model: 'sonnet', provider: 'claude', runtime: 'claude' });
    });

    it('caches the map for subsequent calls within the TTL', async () => {
      prisma.skillModelMap.findMany.mockResolvedValue([]);

      await service.resolveModel(OpenHarnessSkill.CLICKUP_QA);
      await service.resolveModel(OpenHarnessSkill.CLICKUP_QA);

      expect(prisma.skillModelMap.findMany).toHaveBeenCalledTimes(1);
    });

    it('re-reads the map after invalidateCache()', async () => {
      prisma.skillModelMap.findMany.mockResolvedValue([]);

      await service.resolveModel(OpenHarnessSkill.CLICKUP_QA);
      service.invalidateCache();
      await service.resolveModel(OpenHarnessSkill.CLICKUP_QA);

      expect(prisma.skillModelMap.findMany).toHaveBeenCalledTimes(2);
    });

    it('throws when a row has an unknown skill (integrity guard, AC5)', async () => {
      prisma.skillModelMap.findMany.mockResolvedValue([
        { skill: 'not-a-skill', model: 'gpt-5.4', provider: 'openai', runtime: 'oh' },
      ]);

      await expect(service.resolveModel(OpenHarnessSkill.CLICKUP_QA)).rejects.toThrow(
        /unknown skill/,
      );
    });

    it('throws when a row has provider/runtime mismatch (integrity guard, AC5)', async () => {
      prisma.skillModelMap.findMany.mockResolvedValue([
        {
          skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
          model: 'gpt-5.4',
          provider: 'claude',
          runtime: 'oh',
        },
      ]);

      await expect(service.resolveModel(OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT)).rejects.toThrow(
        /provider\/runtime mismatch/,
      );
    });
  });
});
