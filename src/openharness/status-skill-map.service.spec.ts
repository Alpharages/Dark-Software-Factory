import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import {
  DEFAULT_LOOP_TERMINAL_STATUSES,
  DEFAULT_STATUS_SKILL_MAP,
} from '@/config/status-skill-map.config';
import { StatusSkillMapService } from './status-skill-map.service';
import { OpenHarnessSkill } from './skills.enum';

describe('StatusSkillMapService', () => {
  const service = new StatusSkillMapService({
    get: jest.fn().mockReturnValue({
      entries: [
        { status: 'in review', skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW },
        { status: 'ready for qa', skill: OpenHarnessSkill.CLICKUP_QA },
      ],
      loopTerminalStatuses: ['passed', 'done'],
      loopMaxIterations: 5,
    }),
  } as unknown as ConfigService);

  it('resolves mapped statuses', () => {
    expect(service.resolveSkill('in review')).toBe(OpenHarnessSkill.CLICKUP_CODE_REVIEW);
  });

  it('returns null for unmapped statuses', () => {
    expect(service.resolveSkill('unknown')).toBeNull();
  });

  it('normalizes casing and whitespace', () => {
    expect(service.resolveSkill(' In Review ')).toBe(OpenHarnessSkill.CLICKUP_CODE_REVIEW);
  });

  it('collapses internal whitespace when resolving', () => {
    expect(service.resolveSkill('ready  for\tqa')).toBe(OpenHarnessSkill.CLICKUP_QA);
  });

  it('recognizes loop-terminal statuses', () => {
    expect(service.isLoopTerminal(' Passed ')).toBe(true);
    expect(service.isLoopTerminal('unknown')).toBe(false);
  });

  it('exposes loop max iterations from config', () => {
    expect(service.loopMaxIterations).toBe(5);
  });

  it('resolves the default loop entries from real ClickUp status forms', () => {
    // Regression guard: the loopback keys must be in the space-separated, lower-cased
    // form normalizeStatus produces from a raw ClickUp display status. An underscore
    // key would silently never match "Changes Requested" and break the core loop.
    const defaultService = new StatusSkillMapService({
      get: jest.fn().mockReturnValue({
        entries: DEFAULT_STATUS_SKILL_MAP,
        loopTerminalStatuses: DEFAULT_LOOP_TERMINAL_STATUSES,
        loopMaxIterations: 5,
      }),
    } as unknown as ConfigService);

    expect(defaultService.resolveSkill('changes requested')).toBe(
      OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
    );
    expect(defaultService.resolveSkill('Changes Requested')).toBe(
      OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
    );
    expect(defaultService.resolveSkill('approved')).toBe(OpenHarnessSkill.CLICKUP_QA);
    expect(defaultService.isLoopTerminal('passed')).toBe(true);
  });

  it('throws when a status is both skill-mapped and loop-terminal', () => {
    expect(
      () =>
        new StatusSkillMapService({
          get: jest.fn().mockReturnValue({
            entries: [{ status: 'done', skill: OpenHarnessSkill.CLICKUP_QA }],
            loopTerminalStatuses: ['done'],
            loopMaxIterations: 5,
          }),
        } as unknown as ConfigService),
    ).toThrow('loop-terminal');
  });

  it('throws when the statusSkillMap namespace is not loaded', () => {
    expect(
      () =>
        new StatusSkillMapService({
          get: jest.fn().mockReturnValue(undefined),
        } as unknown as ConfigService),
    ).toThrow('statusSkillMap config namespace is not loaded');
  });

  it('lets later duplicate statuses win', () => {
    const duplicateService = new StatusSkillMapService({
      get: jest.fn().mockReturnValue({
        entries: [
          { status: 'same', skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT },
          { status: 'same', skill: OpenHarnessSkill.CLICKUP_QA },
        ],
        loopTerminalStatuses: ['passed'],
        loopMaxIterations: 5,
      }),
    } as unknown as ConfigService);

    expect(duplicateService.resolveSkill('same')).toBe(OpenHarnessSkill.CLICKUP_QA);
  });

  it('keeps ClickUp status literals out of lookup logic', () => {
    const source = readFileSync(__dirname + '/status-skill-map.service.ts', 'utf8');

    expect(source).not.toMatch(/to do|in review|ready for qa/i);
  });
});
