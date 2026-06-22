import { registerAs } from '@nestjs/config';
import { OpenHarnessSkill } from '@/openharness/skills.enum';

export interface StatusSkillMapEntry {
  status: string;
  skill: OpenHarnessSkill;
}

export interface StatusSkillMapConfig {
  entries: StatusSkillMapEntry[];
}

/**
 * Default status→skill map for the OHP-2 loop.
 *
 * The implement-trigger leg is intentionally NOT encoded here. The status that
 * triggers `clickup-dev-implement` is per-project — the PM-configured
 * `integration.ai_trigger_status`, enforced at runtime by `DevelopmentGateService`
 * (CS1-2/CS1-6 removed all hardcoded status maps in favour of that gate). There is
 * no global default trigger status, so baking a literal like `'to do'` would
 * silently no-op the implement leg for any project whose trigger differs. OHP-2.2
 * dispatches the implement leg via that per-project gate + `OPENHARNESS_DEFAULT_SKILL`.
 *
 * This map therefore carries only the fixed downstream transitions, which ARE
 * global loop constants. Operators who run a single global implement trigger can
 * still add it through the `STATUS_SKILL_MAP` override (config swap, not code change).
 */
export const DEFAULT_STATUS_SKILL_MAP: StatusSkillMapEntry[] = [
  { status: 'in review', skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW },
  { status: 'ready for qa', skill: OpenHarnessSkill.CLICKUP_QA },
];

/**
 * Canonical normalization for status keys — case-insensitive, outer-trimmed, and
 * internal-whitespace-collapsed so ClickUp display formatting (mixed case, double
 * spaces, tabs) resolves consistently. Shared by the config parser (duplicate
 * detection) and the lookup service so both sides key the map identically.
 */
export function normalizeStatus(status: string): string {
  return status.trim().toLowerCase().replace(/\s+/g, ' ');
}

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

  // Guard non-collection JSON (null, numbers, booleans, bare strings) before
  // branching — otherwise `Object.entries(null)` throws a raw TypeError and
  // primitives/strings yield nonsensical per-character "unknown skill" errors.
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error(
      'STATUS_SKILL_MAP must be a JSON array of { status, skill } entries or a JSON object mapping status → skill',
    );
  }

  const entries = Array.isArray(parsed)
    ? parsed.map(entryFromUnknown)
    : Object.entries(parsed as Record<string, unknown>).map(([status, skill], index) =>
        entryFromUnknown({ status, skill }, index),
      );

  if (entries.length === 0) {
    throw new Error('STATUS_SKILL_MAP must include at least one entry');
  }

  // Reject duplicate statuses (case/whitespace-insensitive) rather than silently
  // collapsing them last-wins in the lookup Map — a config typo should fail fast,
  // not resolve to an unexpected skill.
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = normalizeStatus(entry.status);
    if (seen.has(key)) {
      throw new Error(
        `STATUS_SKILL_MAP has a duplicate status (case/whitespace-insensitive): ${entry.status}`,
      );
    }
    seen.add(key);
  }

  return entries;
}

export default registerAs('statusSkillMap', (): StatusSkillMapConfig => {
  return {
    entries: parseStatusSkillMap(),
  };
});
