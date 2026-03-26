import { PrismaClient, AIProvider } from '@prisma/client';

export async function seedAiRoutingConfig(prisma: PrismaClient, adminId: string) {
  console.log('  Seeding AI routing configurations...');

  // update: {} is intentional — never overwrite admin customizations on re-seed.
  // The create block establishes the default baseline; subsequent re-seeds are no-ops.
  await prisma.aiRoutingConfig.upsert({
    where: { projectId: null as unknown as string },
    update: {},
    create: {
      projectId: null,
      primaryProviderOverride: null,
      complexityThresholdMedium: 10,
      complexityThresholdHigh: 40,
      tierLowPrimary: AIProvider.KIMI,
      tierLowFallback: AIProvider.CLAUDE_CODE,
      tierMediumPrimary: AIProvider.CLAUDE_CODE,
      tierMediumFallback: AIProvider.GEMINI,
      tierHighPrimary: AIProvider.CLAUDE_CODE,
      tierHighFallback: AIProvider.CODEX,
      updatedById: adminId,
    },
  });

  console.log('  ✅ AI routing configurations seeded');
}
