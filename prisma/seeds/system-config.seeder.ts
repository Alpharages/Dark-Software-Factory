import { PrismaClient } from '../../src/prisma/client';

export async function seedSystemConfig(prisma: PrismaClient) {
  console.log('  Seeding system configurations...');

  const configs = [
    {
      key: 'AUTO_TICKET_SEVERITY_THRESHOLD',
      value: 'HIGH',
      description: 'Minimum severity required to automatically create a ClickUp ticket (CRITICAL, HIGH, MEDIUM, LOW)',
    },
    {
      key: 'DEFAULT_PRODUCTION_ERRORS_LIST_ID',
      value: '901201201201', // Example List ID
      description: 'Default ClickUp List ID for production error tickets',
    },
    {
      key: 'DEFAULT_OPS_ASSIGNEE_ID',
      value: '1234567', // Example User ID
      description: 'Default ClickUp User ID to assign production error tickets to',
    },
    {
      key: 'FRONTEND_URL',
      value: 'http://localhost:3001',
      description: 'URL of the DSF Frontend for deep linking',
    },
  ];

  for (const config of configs) {
    await prisma.systemConfig.upsert({
      where: { key: config.key },
      update: {},
      create: config,
    });
  }

  console.log('  ✅ System configurations seeded');
}
