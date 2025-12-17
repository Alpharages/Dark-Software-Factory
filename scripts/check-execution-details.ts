/**
 * Detailed Execution Check
 * Shows all information about an execution
 */

import 'dotenv/config';
import { Client } from 'pg';

const EXECUTION_ID = process.argv[2] || 'fca05565-c481-48f8-8b81-1d4813103121';

async function main() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        await client.connect();
        console.log('🔍 Checking execution:', EXECUTION_ID, '\n');

        // Get execution details
        const execResult = await client.query(`
            SELECT e.*, t.title, t.description, t.clickup_task_id
            FROM "executions" e
            LEFT JOIN "tickets" t ON e.ticket_id = t.id
            WHERE e.id = $1
        `, [EXECUTION_ID]);

        if (execResult.rows.length === 0) {
            console.error('❌ Execution not found');
            process.exit(1);
        }

        const exec = execResult.rows[0];
        console.log('📋 Execution Details:');
        console.log(`   ID: ${exec.id}`);
        console.log(`   Ticket ID: ${exec.ticket_id}`);
        console.log(`   Title: ${exec.title || 'N/A'}`);
        console.log(`   Status: ${exec.status}`);
        console.log(`   AI Provider: ${exec.ai_provider}`);
        console.log(`   Files Changed: ${exec.files_changed ? JSON.stringify(exec.files_changed).substring(0, 100) : 'None'}`);
        console.log('');

        // Check workspace
        const wsResult = await client.query(`
            SELECT * FROM "workspaces" WHERE execution_id = $1
        `, [EXECUTION_ID]);

        if (wsResult.rows.length > 0) {
            const ws = wsResult.rows[0];
            console.log('📂 Workspace:');
            console.log(`   ID: ${ws.workspace_id}`);
            console.log(`   Path: ${ws.workspace_path}`);
            console.log(`   Status: ${ws.status}`);
            console.log(`   Branch: ${ws.branch_name}`);
            console.log('');
        } else {
            console.log('❌ No workspace record found\n');
        }

        // Check github_pushes
        const pushResult = await client.query(`
            SELECT * FROM "github_pushes" WHERE execution_id = $1
        `, [EXECUTION_ID]);

        if (pushResult.rows.length > 0) {
            console.log('📤 GitHub Pushes:');
            pushResult.rows.forEach((push, i) => {
                console.log(`   ${i + 1}. ID: ${push.id}`);
                console.log(`      Repository: ${push.repository}`);
                console.log(`      Branch: ${push.branch_name}`);
                console.log(`      Status: ${push.push_status}`);
                console.log(`      Commit SHA: ${push.commit_sha || 'None'}`);
                console.log('');
            });
        } else {
            console.log('📤 No GitHub push records\n');
        }

        // Summary
        console.log('━'.repeat(60));
        console.log('\n💡 Summary:');

        if (exec.status !== 'COMPLETED') {
            console.log(`   ⚠️  Execution status is ${exec.status}, not COMPLETED`);
            console.log('   → This execution may not have generated code successfully');
        }

        if (wsResult.rows.length === 0) {
            console.log('   ⚠️  No workspace exists for this execution');
            console.log('   → Cannot test commit without a workspace');
            console.log('\n💡 Recommendation:');
            console.log('   1. Run the app and complete a successful execution');
            console.log('   2. Use that execution ID to test the commit workflow');
        } else if (wsResult.rows[0].status === 'CLEANED') {
            console.log('   ⚠️  Workspace has been cleaned up');
            console.log('   → Cannot test commit on cleaned workspace');
        }

    } catch (error) {
        console.error('❌ Error:', (error as Error).message);
        console.error((error as Error).stack);
        process.exit(1);
    } finally {
        await client.end();
    }
}

main();
