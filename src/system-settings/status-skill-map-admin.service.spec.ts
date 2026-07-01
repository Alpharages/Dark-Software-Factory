import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/database/prisma.service';
import { StatusSkillMapService } from '@/openharness/status-skill-map.service';
import { OpenHarnessSkill } from '@/openharness/skills.enum';
import { DEFAULT_STATUS_SKILL_MAP } from '@/config/status-skill-map.config';
import { StatusSkillMapAdminService } from './status-skill-map-admin.service';

describe('StatusSkillMapAdminService', () => {
  let service: StatusSkillMapAdminService;
  let prisma: Record<string, unknown>;
  let config: Record<string, unknown>;
  let statusSkillMap: Record<string, unknown>;

  beforeEach(async () => {
    prisma = {
      systemConfig: {
        findUnique: jest.fn(),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    config = {
      get: jest.fn().mockReturnValue({
        loopTerminalStatuses: ['passed', 'done'],
        loopMaxIterations: 5,
      }),
    };
    statusSkillMap = {
      isLoopTerminal: jest.fn().mockReturnValue(false),
      invalidateGlobalCache: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatusSkillMapAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: StatusSkillMapService, useValue: statusSkillMap },
      ],
    }).compile();

    service = module.get<StatusSkillMapAdminService>(StatusSkillMapAdminService);
  });

  describe('getGlobalMap', () => {
    it('returns the persisted map, loop terminals, and max iterations when a DB row exists', async () => {
      (prisma.systemConfig as any).findUnique.mockResolvedValue({
        value: JSON.stringify([{ status: 'approved', skill: OpenHarnessSkill.CLICKUP_QA }]),
      });

      const result = await service.getGlobalMap();

      expect(result.entries).toEqual([{ status: 'approved', skill: OpenHarnessSkill.CLICKUP_QA }]);
      expect(result.loopTerminalStatuses).toEqual(['passed', 'done']);
      expect(result.loopMaxIterations).toBe(5);
    });

    it('falls back to DEFAULT_STATUS_SKILL_MAP when no DB row exists', async () => {
      (prisma.systemConfig as any).findUnique.mockResolvedValue(null);

      const result = await service.getGlobalMap();

      expect(result.entries).toEqual(DEFAULT_STATUS_SKILL_MAP);
    });
  });

  describe('setGlobalMap', () => {
    const validEntries = [
      { status: 'approved', skill: OpenHarnessSkill.CLICKUP_QA },
      { status: 'in review', skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW },
    ];

    it('upserts the SystemConfig row and invalidates the resolver cache (AC4)', async () => {
      const result = await service.setGlobalMap(validEntries, 'user-1');

      expect(result).toEqual(validEntries);
      expect((prisma.systemConfig as any).upsert).toHaveBeenCalledWith({
        where: { key: 'status_skill_map.global' },
        update: { value: JSON.stringify(validEntries), updated_by: 'user-1' },
        create: {
          key: 'status_skill_map.global',
          value: JSON.stringify(validEntries),
          updated_by: 'user-1',
        },
      });
      expect(statusSkillMap.invalidateGlobalCache).toHaveBeenCalled();
    });

    it('rejects an unknown skill', async () => {
      await expect(
        service.setGlobalMap([{ status: 'approved', skill: 'not-a-skill' as OpenHarnessSkill }]),
      ).rejects.toThrow(BadRequestException);
      expect((prisma.systemConfig as any).upsert).not.toHaveBeenCalled();
    });

    it('rejects an empty status', async () => {
      await expect(
        service.setGlobalMap([{ status: '  ', skill: OpenHarnessSkill.CLICKUP_QA }]),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate normalized status', async () => {
      await expect(
        service.setGlobalMap([
          { status: 'In Review', skill: OpenHarnessSkill.CLICKUP_QA },
          { status: ' in   review ', skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows multiple distinct statuses to map to the same skill', async () => {
      const entries = [
        { status: 'rejected', skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT },
        { status: 'in progress', skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT },
      ];

      await expect(service.setGlobalMap(entries)).resolves.toEqual(entries);
    });

    it('rejects an empty entries array', async () => {
      await expect(service.setGlobalMap([])).rejects.toThrow(BadRequestException);
      expect((prisma.systemConfig as any).upsert).not.toHaveBeenCalled();
    });

    it('rejects a status that collides with a loop-terminal status', async () => {
      (statusSkillMap.isLoopTerminal as jest.Mock).mockImplementation(
        (status: string) => status === 'passed',
      );

      await expect(
        service.setGlobalMap([{ status: 'passed', skill: OpenHarnessSkill.CLICKUP_QA }]),
      ).rejects.toThrow(BadRequestException);
      expect((prisma.systemConfig as any).upsert).not.toHaveBeenCalled();
    });
  });
});
