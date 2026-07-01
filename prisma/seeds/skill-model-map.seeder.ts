import { PrismaClient } from '@prisma/client';
import { OpenHarnessSkill } from '../../src/openharness/skills.enum';

const DEFAULT_SKILL_MODEL_MAP = [
  {
    skill: OpenHarnessSkill.CLICKUP_DEV_IMPLEMENT,
    model: process.env.OPENHARNESS_MODEL || 'gpt-5.4',
    provider: 'openai',
    runtime: 'oh',
  },
  {
    skill: OpenHarnessSkill.CLICKUP_CODE_REVIEW,
    model: process.env.OPENHARNESS_CLAUDE_MODEL || 'sonnet',
    provider: 'claude',
    runtime: 'claude',
  },
  {
    skill: OpenHarnessSkill.CLICKUP_QA,
    model: process.env.OPENHARNESS_CLAUDE_MODEL || 'sonnet',
    provider: 'claude',
    runtime: 'claude',
  },
];

export async function seedSkillModelMap(prisma: PrismaClient) {
  console.log('  Seeding global skill model map...');

  for (const entry of DEFAULT_SKILL_MODEL_MAP) {
    await prisma.skillModelMap.upsert({
      where: { skill: entry.skill },
      update: {},
      create: entry,
    });
  }

  console.log('  ✅ Global skill model map seeded');
}
