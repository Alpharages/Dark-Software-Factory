import { registerAs } from '@nestjs/config';
import { OpenHarnessSkill } from '@/openharness/skills.enum';

export interface StatusSkillMapEntry {
  status: string;
  skill: OpenHarnessSkill;
}

export interface StatusSkillMapConfig {
  entries: StatusSkillMapEntry[];
}

export const DEFAULT_STATUS_SKILL_MAP: StatusSkillMapEntry[] = [
  { status: 'to do', skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT },
  { status: 'in review', skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW },
  { status: 'ready for qa', skill: OpenHarnessSkill.CLICKUP_QA },
];

function isSkill(value: string): value is OpenHarnessSkill {
  return Object.values(OpenHarnessSkill).includes(value as OpenHarnessSkill);
}

function entryFromUnknown(value: unknown, index: number): StatusSkillMapEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`STATUS_SKILL_MAP entry ${index} must be an object`);
  }

  const entry = value as Record<string, unknown>;
  if (typeof entry.status !== 'string' || entry.status.trim() === '') {
    throw new Error(`STATUS_SKILL_MAP entry ${index} needs a non-empty status`);
  }
  if (typeof entry.skill !== 'string' || !isSkill(entry.skill)) {
    throw new Error(`STATUS_SKILL_MAP entry ${index} has unknown skill: ${String(entry.skill)}`);
  }

  return { status: entry.status, skill: entry.skill };
}

export function parseStatusSkillMap(raw = process.env.STATUS_SKILL_MAP): StatusSkillMapEntry[] {
  if (raw === undefined) {
    return DEFAULT_STATUS_SKILL_MAP.map((entry) => ({ ...entry }));
  }

  if (raw.trim() === '') {
    throw new Error('STATUS_SKILL_MAP must be non-empty JSON when set');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('STATUS_SKILL_MAP must be valid JSON');
  }

  const entries = Array.isArray(parsed)
    ? parsed.map(entryFromUnknown)
    : Object.entries(parsed as Record<string, unknown>).map(([status, skill], index) =>
        entryFromUnknown({ status, skill }, index),
      );

  if (entries.length === 0) {
    throw new Error('STATUS_SKILL_MAP must include at least one entry');
  }

  return entries;
}

export default registerAs('statusSkillMap', (): StatusSkillMapConfig => {
  return {
    entries: parseStatusSkillMap(),
  };
});
