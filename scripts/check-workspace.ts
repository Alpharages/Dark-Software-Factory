/**
 * Check Workspace Contents
 * Verifies if a workspace has any changes to commit
 */

import 'dotenv/config';
import { Client } from 'pg';
import * as fs from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const EXECUTION_ID = process.argv[2];

if (!EXECUTION_ID) {
    console.error('Usage: pnpm exec ts-node -r tsconfig-paths/register scripts/check-workspace.ts <execution-id>');
    process.exit(1);
}

async function main() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        await client.connect();

        // Get workspace info
        const wsResult = await client.query(
            'SELECT workspace_id, workspace_path, status FROM "workspaces" WHERE execution_id = $1',
            [EXECUTION_ID]
        );

        if (wsResult.rows.length === 0) {
            console.error(`❌ No workspace found for execution: ${EXECUTION_ID}`);
            process.exit(1);
        }

        const workspace = wsResult.rows[0];
        console.log(`📂 Workspace: ${workspace.workspace_path}`);
        console.log(`   Status: ${workspace.status}\n`);

        // Check if directory exists
        try {
            await fs.access(workspace.workspace_path);
            console.log('✅ Workspace directory exists');

            // Check for git changes
            const statusResult = await execFileAsync('git', ['status', '--porcelain'], {
                cwd: workspace.workspace_path,
            });

            if (statusResult.stdout.trim()) {
                console.log('\n📝 Changes found:');
                console.log(statusResult.stdout);
            } else {
                console.log('\n⚠️  No changes to commit');
            }

            // List files
            const files = await fs.readdir(workspace.workspace_path);
            console.log(`\n📁 Files in workspace (${files.length} total):`);
            files.slice(0, 10).forEach(file => console.log(`   - ${file}`));
            if (files.length > 10) {
                console.log(`   ... and ${files.length - 10} more`);
            }

        } catch (error) {
            console.error(`❌ Workspace directory not accessible: ${(error as Error).message}`);
        }

    } catch (error) {
        console.error('❌ Error:', (error as Error).message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

main();
