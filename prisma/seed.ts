import { PrismaClient } from '../src/prisma/client';
import { TicketStatus, AIProvider, ExecutionStatus } from '../src/prisma/enums';
import { seedAdminUser } from './seeds/admin.seeder';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import 'dotenv/config';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('🌱 Seeding database...');

    // Seed Admin User
    await seedAdminUser(prisma);

    // Create sample project
    await prisma.project.upsert({
        where: { id: 'sample-project' },
        update: {},
        create: {
            id: 'sample-project',
            name: 'Sample Project',
            github_repository_url: 'https://github.com/sample/project',
            pm_id: 'admin-001', // Using the admin we just created (or random)
            // status: 'active', // Default is active
        },
    });

    // Create sample ticket
    const ticket = await prisma.ticket.create({
        data: {
            clickup_task_id: 'SAMPLE-001',
            project_id: 'sample-project',
            title: 'Sample Ticket: Add User Authentication',
            description: 'Implement JWT-based authentication for the API',
            acceptance_criteria: '- Users can login\n- Users can logout\n- JWT tokens expire after 1 hour',
            ticket_quality_score: 85,
            status: TicketStatus.RECEIVED,
        },
    });

    console.log('✅ Created ticket:', ticket.id);

    // Create sample execution
    const execution = await prisma.execution.create({
        data: {
            ticket_id: ticket.id,
            ai_provider: AIProvider.CURSOR_HEADLESS,
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

    // Create sample cost record
    const costRecord = await prisma.costRecord.create({
        data: {
            ticket_id: ticket.id,
            ai_provider: AIProvider.CURSOR_HEADLESS,
            operation_type: 'code_generation',
            tokens_used: 1500,
            api_calls: 1,
            cost_in_cents: 45, // $0.45
        },
    });

    console.log('✅ Created cost record:', costRecord.id);

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
