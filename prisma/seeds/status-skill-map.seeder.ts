import { PrismaClient } from '@prisma/client';
import { OpenHarnessSkill } from '../../src/openharness/skills.enum';

export const GLOBAL_STATUS_SKILL_MAP_CONFIG_KEY = 'status_skill_map.global';

const DEFAULT_GLOBAL_STATUS_SKILL_MAP = [
  { status: 'in review', skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW },
  { status: 'ready for qa', skill: OpenHarnessSkill.CLICKUP_QA },
  { status: 'changes requested', skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT },
  { status: 'failed', skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT },
  { status: 'approved', skill: OpenHarnessSkill.CLICKUP_QA },
];

export async function seedStatusSkillMap(prisma: PrismaClient) {
  console.log('  Seeding global status skill map...');

  await prisma.systemConfig.upsert({
    where: { key: GLOBAL_STATUS_SKILL_MAP_CONFIG_KEY },
    update: {},
    create: {
      key: GLOBAL_STATUS_SKILL_MAP_CONFIG_KEY,
      value: JSON.stringify(DEFAULT_GLOBAL_STATUS_SKILL_MAP),
      description: 'Global default status to OpenHarness skill map.',
    },
  });

  console.log('  ✅ Global status skill map seeded');
}
