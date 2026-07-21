/**
 * Set a project's per-tenant Lore credentials (OHP-4.1 memory isolation).
 * Encrypts the key with the app's EncryptionService so the runner can decrypt it.
 *
 *   pnpm exec ts-node -r tsconfig-paths/register scripts/set-lore-key.ts \
 *     <projectId> <lore_api_key> [lore_server_url]
 *
 * Needs ENCRYPTION_KEY + DATABASE_URL in the environment (the app's .env).
 */
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { EncryptionService } from '@/common/encryption/encryption.service';
import { PrismaClient } from '@/prisma/client';

async function main() {
  const [projectId, loreApiKey, loreServerUrl] = process.argv.slice(2);
  if (!projectId || !loreApiKey) {
    throw new Error('usage: set-lore-key.ts <projectId> <lore_api_key> [lore_server_url]');
  }

  const encryption = new EncryptionService(new ConfigService(process.env));
  const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })) });
  try {
    const project = await prisma.project.update({
      where: { id: projectId },
      data: {
        lore_api_key: encryption.encrypt(loreApiKey),
        ...(loreServerUrl ? { lore_server_url: loreServerUrl } : {}),
      },
      select: { id: true, name: true, lore_server_url: true },
    });
    console.log(`Lore key set for "${project.name}" (${project.id})`);
    console.log(`  lore_server_url: ${project.lore_server_url ?? '(inherits global LORE_SERVER_URL)'}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
