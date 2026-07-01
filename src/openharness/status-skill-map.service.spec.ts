import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { PrismaService } from '@/database/prisma.service';
import {
  DEFAULT_LOOP_TERMINAL_STATUSES,
  DEFAULT_STATUS_SKILL_MAP,
} from '@/config/status-skill-map.config';
import { StatusSkillMapService } from './status-skill-map.service';
import { OpenHarnessSkill } from './skills.enum';

describe('StatusSkillMapService', () => {
  const makePrisma = () =>
    ({
      projectStatusSkillMap: { findMany: jest.fn().mockResolvedValue([]) },
      systemConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    }) as unknown as PrismaService;

  const service = new StatusSkillMapService(
    {
      get: jest.fn().mockReturnValue({
        entries: [
          { status: 'in review', skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW },
          { status: 'ready for qa', skill: OpenHarnessSkill.CLICKUP_QA },
        ],
        loopTerminalStatuses: ['passed', 'done'],
        loopMaxIterations: 5,
      }),
    } as unknown as ConfigService,
    makePrisma(),
  );

  it('resolves mapped statuses', async () => {
    await expect(service.resolveSkill('in review')).resolves.toBe(
      OpenHarnessSkill.CLICKUP_CODE_REVIEW,
    );
  });

  it('returns null for unmapped statuses', async () => {
    await expect(service.resolveSkill('unknown')).resolves.toBeNull();
  });

  it('normalizes casing and whitespace', async () => {
    await expect(service.resolveSkill(' In Review ')).resolves.toBe(
      OpenHarnessSkill.CLICKUP_CODE_REVIEW,
    );
  });

  it('collapses internal whitespace when resolving', async () => {
    await expect(service.resolveSkill('ready  for\tqa')).resolves.toBe(OpenHarnessSkill.CLICKUP_QA);
  });

  it('recognizes loop-terminal statuses', () => {
    expect(service.isLoopTerminal(' Passed ')).toBe(true);
    expect(service.isLoopTerminal('unknown')).toBe(false);
  });

  it('exposes loop max iterations from config', () => {
    expect(service.loopMaxIterations).toBe(5);
  });

  it('resolves the default loop entries from real ClickUp status forms', async () => {
    // Regression guard: the loopback keys must be in the space-separated, lower-cased
    // form normalizeStatus produces from a raw ClickUp display status. An underscore
    // key would silently never match "Changes Requested" and break the core loop.
    const defaultService = new StatusSkillMapService(
      {
        get: jest.fn().mockReturnValue({
          entries: DEFAULT_STATUS_SKILL_MAP,
          loopTerminalStatuses: DEFAULT_LOOP_TERMINAL_STATUSES,
          loopMaxIterations: 5,
        }),
      } as unknown as ConfigService,
      makePrisma(),
    );

    await expect(defaultService.resolveSkill('changes requested')).resolves.toBe(
      OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
    );
    await expect(defaultService.resolveSkill('Changes Requested')).resolves.toBe(
      OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
    );
    await expect(defaultService.resolveSkill('approved')).resolves.toBe(
      OpenHarnessSkill.CLICKUP_QA,
    );
    expect(defaultService.isLoopTerminal('passed')).toBe(true);
  });

  it('throws when a status is both skill-mapped and loop-terminal', () => {
    expect(
      () =>
        new StatusSkillMapService(
          {
            get: jest.fn().mockReturnValue({
              entries: [{ status: 'done', skill: OpenHarnessSkill.CLICKUP_QA }],
              loopTerminalStatuses: ['done'],
              loopMaxIterations: 5,
            }),
          } as unknown as ConfigService,
          makePrisma(),
        ),
    ).toThrow('loop-terminal');
  });

  it('throws when the statusSkillMap namespace is not loaded', () => {
    expect(
      () =>
        new StatusSkillMapService(
          {
            get: jest.fn().mockReturnValue(undefined),
          } as unknown as ConfigService,
          makePrisma(),
        ),
    ).toThrow('statusSkillMap config namespace is not loaded');
  });

  it('lets later duplicate statuses win', async () => {
    const duplicateService = new StatusSkillMapService(
      {
        get: jest.fn().mockReturnValue({
          entries: [
            { status: 'same', skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT },
            { status: 'same', skill: OpenHarnessSkill.CLICKUP_QA },
          ],
          loopTerminalStatuses: ['passed'],
          loopMaxIterations: 5,
        }),
      } as unknown as ConfigService,
      makePrisma(),
    );

    await expect(duplicateService.resolveSkill('same')).resolves.toBe(OpenHarnessSkill.CLICKUP_QA);
  });

  it('merges project rows over the global default', async () => {
    const prisma = makePrisma();
    (prisma.projectStatusSkillMap.findMany as jest.Mock).mockResolvedValue([
      {
        status: 'Rejected',
        normalized_status: 'rejected',
        skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
      },
    ]);
    const projectService = new StatusSkillMapService(
      {
        get: jest.fn().mockReturnValue({
          entries: DEFAULT_STATUS_SKILL_MAP,
          loopTerminalStatuses: DEFAULT_LOOP_TERMINAL_STATUSES,
          loopMaxIterations: 5,
        }),
      } as unknown as ConfigService,
      prisma,
    );

    await expect(projectService.resolveSkill('rejected', 'project-1')).resolves.toBe(
      OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
    );
    await expect(projectService.resolveSkill('in review', 'project-1')).resolves.toBe(
      OpenHarnessSkill.CLICKUP_CODE_REVIEW,
    );
  });

  it('rejects project rows that map loop terminals to skills', async () => {
    const prisma = makePrisma();
    (prisma.projectStatusSkillMap.findMany as jest.Mock).mockResolvedValue([
      { status: 'done', normalized_status: 'done', skill: OpenHarnessSkill.CLICKUP_QA },
    ]);
    const projectService = new StatusSkillMapService(
      {
        get: jest.fn().mockReturnValue({
          entries: DEFAULT_STATUS_SKILL_MAP,
          loopTerminalStatuses: DEFAULT_LOOP_TERMINAL_STATUSES,
          loopMaxIterations: 5,
        }),
      } as unknown as ConfigService,
      prisma,
    );

    await expect(projectService.resolveSkill('done', 'project-1')).rejects.toThrow('loop-terminal');
  });

  it('uses the SystemConfig global map when present', async () => {
    const prisma = makePrisma();
    (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue({
      value: JSON.stringify([{ status: 'custom review', skill: OpenHarnessSkill.CLICKUP_QA }]),
    });
    const dbGlobalService = new StatusSkillMapService(
      {
        get: jest.fn().mockReturnValue({
          entries: DEFAULT_STATUS_SKILL_MAP,
          loopTerminalStatuses: DEFAULT_LOOP_TERMINAL_STATUSES,
          loopMaxIterations: 5,
        }),
      } as unknown as ConfigService,
      prisma,
    );

    await expect(dbGlobalService.resolveSkill('custom review')).resolves.toBe(
      OpenHarnessSkill.CLICKUP_QA,
    );
    await expect(dbGlobalService.resolveSkill('in review')).resolves.toBeNull();
  });

  it('keeps ClickUp status literals out of lookup logic', () => {
    const source = readFileSync(__dirname + '/status-skill-map.service.ts', 'utf8');

    expect(source).not.toMatch(/to do|in review|ready for qa/i);
  });
});
