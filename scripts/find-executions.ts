/**
 * Find Available Executions
 * Helper script to find valid execution IDs for testing
 */

import 'dotenv/config';
import { Client } from 'pg';

async function main() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        await client.connect();
        console.log('✅ Connected to database\n');

        // Find recent executions
        const result = await client.query(`
            SELECT e.id, e.status, e.ai_provider, t.title, e.created_at
            FROM "executions" e
            JOIN "tickets" t ON e.ticket_id = t.id
            ORDER BY e.created_at DESC
            LIMIT 10
        `);

        console.log(`📋 Found ${result.rows.length} executions:\n`);

        result.rows.forEach((row, index) => {
            console.log(`${index + 1}. ID: ${row.id}`);
            console.log(`   Title: ${row.title}`);
            console.log(`   Status: ${row.status}`);
            console.log(`   AI Provider: ${row.ai_provider}`);
            console.log(`   Created: ${row.created_at}`);
            console.log('');
        });

        // Check if workspace exists for executions
        console.log('\n🗂️  Checking workspace status:\n');

        for (const row of result.rows) {
            const wsResult = await client.query(
                'SELECT workspace_id, status FROM "workspaces" WHERE execution_id = $1',
                [row.id]
            );

            if (wsResult.rows.length > 0) {
                console.log(`✅ ${row.id}: Has workspace (${wsResult.rows[0].status})`);
            } else {
                console.log(`❌ ${row.id}: No workspace`);
            }
        }

    } catch (error) {
        console.error('❌ Error:', (error as Error).message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

main();
