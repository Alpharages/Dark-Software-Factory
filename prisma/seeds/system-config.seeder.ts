import { PrismaClient } from '@prisma/client';

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
    // Story 9-U-4: Error Context Extraction & Linking
    {
      key: 'CONTEXT_EXTRACTION_ENABLED',
      value: 'true',
      description: 'Enable automatic error context extraction (stack traces, commits, deployments)',
    },
    {
      key: 'DEPLOYMENT_LOOKUP_WINDOW_MINUTES',
      value: '60',
      description: 'Time window in minutes to look for related deployments around error occurrence',
    },
    {
      key: 'COMMIT_HISTORY_DAYS',
      value: '7',
      description: 'Number of days to look back in git history for related commits',
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
