import { PrismaClient, TicketStatus, AIProvider, ExecutionStatus } from '@prisma/client';
import { seedAdminUser } from './seeds/admin.seeder';
import { seedSystemConfig } from './seeds/system-config.seeder';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// Strip Prisma-specific query params (e.g. ?schema=public) before passing to pg's
// Pool — pg's URL parser rejects unknown params and fails to extract the password.
const rawUrl = new URL(process.env.DATABASE_URL!);
rawUrl.search = '';
const pool = new Pool({ connectionString: rawUrl.toString() });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('🌱 Seeding database...');

    // Seed Admin User — returns the created or existing admin
    const admin = await seedAdminUser(prisma);

    // Seed System Configs
    await seedSystemConfig(prisma);

    // Create sample project (idempotent)
    await prisma.project.upsert({
        where: { id: 'sample-project' },
        update: {},
        create: {
            id: 'sample-project',
            name: 'Sample Project',
            github_repository_url: 'https://github.com/sample/project',
            pm_id: admin.id,
        },
    });

    // Create sample ticket (idempotent — clickup_task_id is unique)
    const ticket = await prisma.ticket.upsert({
        where: { clickup_task_id: 'SAMPLE-001' },
        update: {},
        create: {
            clickup_task_id: 'SAMPLE-001',
            project_id: 'sample-project',
            title: 'Sample Ticket: Add User Authentication',
            description: 'Implement JWT-based authentication for the API',
            acceptance_criteria: '- Users can login\n- Users can logout\n- JWT tokens expire after 1 hour',
            ticket_quality_score: 85,
            status: TicketStatus.RECEIVED,
        },
    });

    console.log('✅ Upserted ticket:', ticket.id);

    // Create sample execution only if none exists for this ticket
    const existingExecution = await prisma.execution.findFirst({
        where: { ticket_id: ticket.id },
    });

    if (!existingExecution) {
        const execution = await prisma.execution.create({
            data: {
                ticket_id: ticket.id,
                ai_provider: AIProvider.CLAUDE_CODE,
                prompt: 'Implement JWT authentication...',
                status: ExecutionStatus.COMPLETED,
                confidence_score: 0.92,
                code_output: '// Generated authentication code...',
                files_changed: ['src/auth/auth.service.ts', 'src/auth/jwt.strategy.ts'],
                started_at: new Date(),
                completed_at: new Date(),
            },
        });

        console.log('✅ Created execution:', execution.id);

        const costRecord = await prisma.costRecord.create({
            data: {
                ticket_id: ticket.id,
                ai_provider: AIProvider.CLAUDE_CODE,
                operation_type: 'code_generation',
                tokens_used: 1500,
                api_calls: 1,
                cost_in_cents: 45,
            },
        });

        console.log('✅ Created cost record:', costRecord.id);
    } else {
        console.log('ℹ️  Sample execution already exists, skipping.');
    }

    console.log('🎉 Seeding complete!');
}

main()
    .catch((e) => {
        console.error('❌ Seeding failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
