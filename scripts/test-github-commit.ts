/**
 * Test GitHub Commit Operation
 *
 * Usage: pnpm exec ts-node -r tsconfig-paths/register scripts/test-github-commit.ts <execution-id>
 *
 * This script tests the GitHub commit workflow by:
 * 1. Finding an existing execution by ID
 * 2. Publishing a GITHUB_PUSH message to trigger commit workflow
 * 3. Monitoring the process
 */

import 'dotenv/config'; // Load .env file
import { Client } from 'pg';
import * as amqp from 'amqplib';
import { v4 as uuidv4 } from 'uuid';

const EXECUTION_ID = process.argv[2];

if (!EXECUTION_ID) {
    console.error(
        '❌ Usage: pnpm exec ts-node -r tsconfig-paths/register scripts/test-github-commit.ts <execution-id>',
    );
    process.exit(1);
}

async function main() {
    // Use pg client directly
    console.log(process.env.DATABASE_URL);
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        await client.connect();
        console.log('✅ Connected to database');

        console.log(`🔍 Looking up execution: ${EXECUTION_ID}`);

        // 1. Find the execution with ticket
        const executionResult = await client.query(
            `SELECT e.*, t.* 
       FROM "executions" e 
       JOIN "tickets" t ON e.ticket_id = t.id 
       WHERE e.id = $1`,
            [EXECUTION_ID],
        );

        if (executionResult.rows.length === 0) {
            console.error(`❌ Execution not found: ${EXECUTION_ID}`);
            process.exit(1);
        }

        const execution = executionResult.rows[0];

        console.log(`✅ Found execution for ticket: ${execution.title}`);
        console.log(`   Status: ${execution.status}`);
        console.log(`   AI Provider: ${execution.ai_provider}`);

        // 2. Create GitHubPush record
        console.log('\n📝 Creating GitHub push record...');

        const githubPushId = uuidv4();
        const repository = process.env.GITHUB_DEFAULT_REPOSITORY || 'owner/repo';
        const branchName = `feature/ticket-${execution.ticket_id}`;

        await client.query(
            `INSERT INTO "github_pushes" (id, execution_id, repository, branch_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
            [githubPushId, EXECUTION_ID, repository, branchName],
        );

        console.log(`✅ Created GitHubPush record: ${githubPushId}`);

        // 3. Publish message to RabbitMQ
        console.log('\n📨 Publishing GITHUB_PUSH message to RabbitMQ...');

        const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost:5672');
        const channel = await connection.createChannel();

        const exchange = 'orchestrator-events'; // Must match EXCHANGE_NAMES.ORCHESTRATOR_EVENTS
        const routingKey = 'github.push.trigger'; // Must match ROUTING_KEYS.GITHUB_PUSH_TRIGGER

        await channel.assertExchange(exchange, 'topic', { durable: true });

        const message = {
            messageId: githubPushId, // Unique message ID
            correlationId: EXECUTION_ID, // For tracking
            payload: {
                executionId: EXECUTION_ID,
                ticketId: execution.ticket_id,
                correlationId: EXECUTION_ID,
                timestamp: Date.now(),
            },
        };

        channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)), {
            persistent: true,
            contentType: 'application/json',
        });

        console.log(`✅ Published message to ${exchange} with routing key: ${routingKey}`);
        console.log(`   Message:`, JSON.stringify(message, null, 2));

        // Cleanup
        await channel.close();
        await connection.close();

        console.log('\n🎉 Test message sent successfully!');
        console.log('\n📊 Monitor the logs to see:');
        console.log('   1. GitHubPushTriggerConsumer receiving the message');
        console.log('   2. GitHubCommitOrchestrator processing commit');
        console.log('   3. AI generating commit message (no clone!)');
        console.log('   4. Git commit and push operations');
        console.log('\n💡 Check GitHub push status:');
        console.log(`   SELECT * FROM "GitHubPush" WHERE id = '${githubPushId}';`);
    } catch (error) {
        console.error('❌ Error:', (error as Error).message);
        console.error((error as Error).stack);
        process.exit(1);
    } finally {
        await client.end();
        console.log('🔌 Database disconnected');
    }
}

main();
