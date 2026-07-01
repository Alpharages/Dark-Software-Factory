import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/database/prisma.service';
import { SkillModelMapService } from '@/openharness/skill-model-map.service';
import { OpenHarnessSkill } from '@/openharness/skills.enum';
import { SkillModelMapAdminService } from './skill-model-map-admin.service';

describe('SkillModelMapAdminService', () => {
  let service: SkillModelMapAdminService;
  let prisma: Record<string, unknown>;
  let skillModelMap: Record<string, jest.Mock>;

  beforeEach(async () => {
    prisma = {
      skillModelMap: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    skillModelMap = { invalidateCache: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkillModelMapAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: SkillModelMapService, useValue: skillModelMap },
      ],
    }).compile();

    service = module.get<SkillModelMapAdminService>(SkillModelMapAdminService);
  });

  describe('listEntries', () => {
    it('returns all rows ordered by skill', async () => {
      const rows = [{ skill: OpenHarnessSkill.CLICKUP_QA, model: 'opus' }];
      (prisma.skillModelMap as any).findMany.mockResolvedValue(rows);

      const result = await service.listEntries();

      expect(result).toEqual(rows);
      expect((prisma.skillModelMap as any).findMany).toHaveBeenCalledWith({
        orderBy: { skill: 'asc' },
      });
    });
  });

  describe('updateEntry', () => {
    it('upserts the row and invalidates the resolver cache (AC1 "no redeploy")', async () => {
      const row = {
        skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW,
        model: 'opus',
        provider: 'claude',
        runtime: 'claude',
      };
      (prisma.skillModelMap as any).upsert.mockResolvedValue(row);

      const result = await service.updateEntry(
        OpenHarnessSkill.CLICKUP_CODE_REVIEW,
        { model: 'opus', provider: 'claude', runtime: 'claude' },
        'user-1',
      );

      expect(result).toEqual(row);
      expect((prisma.skillModelMap as any).upsert).toHaveBeenCalledWith({
        where: { skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW },
        update: { model: 'opus', provider: 'claude', runtime: 'claude', updated_by: 'user-1' },
        create: {
          skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW,
          model: 'opus',
          provider: 'claude',
          runtime: 'claude',
          updated_by: 'user-1',
        },
      });
      expect(skillModelMap.invalidateCache).toHaveBeenCalled();
    });

    it('rejects an unknown skill', async () => {
      await expect(
        service.updateEntry('not-a-skill', { model: 'x', provider: 'openai', runtime: 'oh' }),
      ).rejects.toThrow(BadRequestException);
      expect((prisma.skillModelMap as any).upsert).not.toHaveBeenCalled();
    });

    it('rejects a provider/runtime mismatch (AC5)', async () => {
      await expect(
        service.updateEntry(OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT, {
          model: 'gpt-5.4',
          provider: 'claude',
          runtime: 'oh',
        }),
      ).rejects.toThrow(BadRequestException);
      expect((prisma.skillModelMap as any).upsert).not.toHaveBeenCalled();
    });
  });
});
