import { envValidationSchema } from './env.validation';
import {
  DEFAULT_LOOP_MAX_ITERATIONS,
  DEFAULT_LOOP_TERMINAL_STATUSES,
  DEFAULT_STATUS_SKILL_MAP,
  parseLoopMaxIterations,
  parseLoopTerminalStatuses,
  parseStatusSkillMap,
} from './status-skill-map.config';
import { OpenHarnessSkill } from '@/openharness/skills.enum';

const validEnv = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test_db',
  RABBITMQ_URL: 'amqp://test:test@localhost:5672',
  JWT_SECRET: 'test-secret-at-least-32-characters-long',
  GITHUB_TOKEN: 'ghp_testtoken',
  GITHUB_DEFAULT_REPOSITORY: 'https://github.com/test/repo',
};

describe('status skill map config', () => {
  it('uses default loop entries when STATUS_SKILL_MAP is unset', () => {
    expect(parseStatusSkillMap()).toEqual(DEFAULT_STATUS_SKILL_MAP);
  });

  it('includes loop entries in the default map', () => {
    expect(DEFAULT_STATUS_SKILL_MAP).toEqual([
      { status: 'in review', skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW },
      { status: 'ready for qa', skill: OpenHarnessSkill.CLICKUP_QA },
      { status: 'changes_requested', skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT },
      { status: 'failed', skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT },
      { status: 'approved', skill: OpenHarnessSkill.CLICKUP_QA },
    ]);
  });

  it('parses loop terminal statuses and max iteration defaults', () => {
    expect(parseLoopTerminalStatuses()).toEqual(DEFAULT_LOOP_TERMINAL_STATUSES);
    expect(parseLoopTerminalStatuses('passed, done')).toEqual(['passed', 'done']);
    expect(parseLoopMaxIterations()).toBe(DEFAULT_LOOP_MAX_ITERATIONS);
    expect(parseLoopMaxIterations('3')).toBe(3);
  });

  it('rejects bad loop settings', () => {
    expect(() => parseLoopTerminalStatuses('')).toThrow('LOOP_TERMINAL_STATUSES');
    expect(() => parseLoopTerminalStatuses('passed, Passed')).toThrow('duplicate');
    expect(() => parseLoopMaxIterations('0')).toThrow('LOOP_MAX_ITERATIONS');
  });

  it('parses STATUS_SKILL_MAP overrides from a JSON array', () => {
    expect(
      parseStatusSkillMap(
        JSON.stringify([{ status: 'custom review', skill: OpenHarnessSkill.CLICKUP_QA }]),
      ),
    ).toEqual([{ status: 'custom review', skill: OpenHarnessSkill.CLICKUP_QA }]);
  });

  it('parses STATUS_SKILL_MAP overrides from a JSON object', () => {
    expect(
      parseStatusSkillMap(JSON.stringify({ 'ready for qa': OpenHarnessSkill.CLICKUP_CODE_REVIEW })),
    ).toEqual([{ status: 'ready for qa', skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW }]);
  });

  it('rejects empty or malformed map values', () => {
    expect(() => parseStatusSkillMap('')).toThrow('STATUS_SKILL_MAP');
    expect(() => parseStatusSkillMap('not-json')).toThrow('valid JSON');
    expect(() => parseStatusSkillMap('[]')).toThrow('at least one entry');
  });

  it('rejects non-collection JSON with a clear message', () => {
    // null, primitives, and bare strings parse as valid JSON but are not maps —
    // each must fail with the same descriptive error, not a TypeError or a
    // nonsensical per-character "unknown skill" message.
    for (const raw of ['null', '42', 'true', JSON.stringify('hello')]) {
      expect(() => parseStatusSkillMap(raw)).toThrow('must be a JSON array');
    }
  });

  it('rejects duplicate statuses that collide after normalization', () => {
    expect(() =>
      parseStatusSkillMap(
        JSON.stringify([
          { status: 'In Review', skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW },
          { status: 'in review', skill: OpenHarnessSkill.CLICKUP_QA },
        ]),
      ),
    ).toThrow('duplicate status');
  });

  it('rejects unknown skills through Joi startup validation', () => {
    const { error } = envValidationSchema.validate(
      {
        ...validEnv,
        STATUS_SKILL_MAP: JSON.stringify([{ status: 'x', skill: 'not-a-skill' }]),
      },
      { abortEarly: false, allowUnknown: true },
    );

    expect(error?.message).toContain('not-a-skill');
  });

  it('rejects bad loop settings through Joi startup validation', () => {
    const { error } = envValidationSchema.validate(
      {
        ...validEnv,
        LOOP_TERMINAL_STATUSES: '',
        LOOP_MAX_ITERATIONS: 0,
      },
      { abortEarly: false, allowUnknown: true },
    );

    expect(error?.message).toContain('LOOP_TERMINAL_STATUSES');
    expect(error?.message).toContain('LOOP_MAX_ITERATIONS');
  });
});
