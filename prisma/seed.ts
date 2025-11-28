import { PrismaClient, TicketStatus, AIProvider, ExecutionStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding database...');

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
            ai_provider: AIProvider.CURSOR,
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
            ai_provider: AIProvider.CURSOR,
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
