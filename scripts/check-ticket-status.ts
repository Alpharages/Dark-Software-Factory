
import { PrismaClient } from '../src/prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

async function main() {
    const ticketId = 'baf762d7-8066-42f3-acef-23c9f2ea877e';

    console.log(`Checking for ticket with ID: ${ticketId}`);

    if (!process.env.DATABASE_URL) {
        console.error('DATABASE_URL is missing in environment variables.');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });
    const adapter = new PrismaPg(pool);

    // @ts-ignore
    const prisma = new PrismaClient({ adapter });

    try {
        await prisma.$connect();
        console.log('Connected to database.');

        // Check as internal ID
        let ticket = await prisma.ticket.findUnique({
            where: { id: ticketId },
            include: { executions: true, project: true },
        });

        if (!ticket) {
            console.log('Not found as internal ID. Checking as ClickUp Task ID...');
            ticket = await prisma.ticket.findUnique({
                where: { clickup_task_id: ticketId },
                include: { executions: true, project: true },
            });
        }

        if (ticket) {
            console.log('Ticket found:');
            console.log(JSON.stringify(ticket, null, 2));

            if (ticket.executions && ticket.executions.length > 0) {
                console.log('\nExecutions found:');
                ticket.executions.forEach((exec: any) => {
                    console.log(`- Execution ID: ${exec.id}, Provider: ${exec.ai_provider}, Status: ${exec.status}`);
                });
            } else {
                console.log('\nNo executions found for this ticket.');
            }
        } else {
            console.log('Ticket NOT found in database.');
        }
    } catch (error) {
        console.error('Error querying database:', error);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
