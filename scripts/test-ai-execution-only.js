#!/usr/bin/env node

/**
 * Test AI Execution Stage Only
 * 
 * Tests just stage 5-6 (AI execution) by loading the most recent
 * test execution from the database and monitoring its progress.
 * 
 * NEW: Can also publish a test message to RabbitMQ to trigger execution
 * 
 * Usage - Monitor Mode (default):
 *   node scripts/test-ai-execution-only.js
 *   node scripts/test-ai-execution-only.js --execution-id=<uuid>
 *   node scripts/test-ai-execution-only.js --timeout-ms=600000
 * 
 * Usage - Publish & Monitor Mode:
 *   node scripts/test-ai-execution-only.js --publish
 *   node scripts/test-ai-execution-only.js --publish --prompt="Fix the login bug"
 *   node scripts/test-ai-execution-only.js --publish --repository-url="https://github.com/owner/repo"
 *   node scripts/test-ai-execution-only.js --publish --provider=CLAUDE_CODE
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const amqp = require('amqplib');

// Colors
const c = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

// Args
const args = process.argv.slice(2);
function getArgValue(prefix) {
    const hit = args.find((a) => a.startsWith(prefix));
    if (!hit) return null;
    const idx = hit.indexOf('=');
    if (idx === -1) return null;
    return hit.slice(idx + 1);
}

function hasFlag(flag) {
    return args.includes(flag);
}

const TIMEOUT_MS = parseInt(getArgValue('--timeout-ms=') || '600000', 10);
const POLL_MS = parseInt(getArgValue('--poll-ms=') || '2000', 10);
const EXECUTION_ID = getArgValue('--execution-id=') || null;

// Publish mode args
const PUBLISH_MODE = hasFlag('--publish');
const PROMPT = getArgValue('--prompt=') || 'Test AI execution: Create a simple hello world function in JavaScript with JSDoc comments.';
const REPOSITORY_URL = getArgValue('--repository-url=') || null;
const PROVIDER = getArgValue('--provider=') || 'CURSOR_HEADLESS';
const TICKET_ID = getArgValue('--ticket-id=') || `task-test-${Date.now()}`;
const PROJECT_ID = getArgValue('--project-id=') || 'test-project';

// Load .env
function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) {
        console.error('❌ ERROR: .env file not found');
        process.exit(1);
    }

    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach((line) => {
        line = line.trim();
        if (!line || line.startsWith('#')) return;
        const [key, ...valueParts] = line.split('=');
        if (!key || !valueParts.length) return;
        let value = valueParts.join('=').trim();
        value = value.replace(/^["']|["']$/g, '');
        process.env[key.trim()] = value;
    });
}

loadEnv();

function nowTs() {
    return new Date().toISOString().substring(11, 23);
}

function log(message) {
    console.log(`${c.bright}[${nowTs()}]${c.reset} ${message}`);
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * Publish a test message to RabbitMQ ai-execution-queue
 */
async function publishTestMessage(client) {
    const { v4: uuidv4 } = require('uuid');

    // Validate required args
    if (!REPOSITORY_URL) {
        if (!process.env.GITHUB_DEFAULT_REPOSITORY) {
            console.error('❌ ERROR: --repository-url required or GITHUB_DEFAULT_REPOSITORY env var must be set');
            process.exit(1);
        }
    }

    const correlationId = uuidv4();
    const messageId = uuidv4();
    const executionId = uuidv4();
    const repositoryUrl = REPOSITORY_URL || process.env.GITHUB_DEFAULT_REPOSITORY;

    log(`📝 Creating execution record...`);
    log(`   Correlation ID: ${correlationId}`);
    log(`   Execution ID: ${executionId}`);
    log(`   Ticket ID: ${TICKET_ID}`);
    log(`   Provider: ${PROVIDER}`);
    log(`   Repository: ${repositoryUrl}`);
    log(`   Prompt: ${PROMPT.substring(0, 60)}...`);

    // 1. Create ticket record first (required for foreign key)
    await client.query(
        `INSERT INTO tickets (
            id, clickup_task_id, project_id, title, description, 
            acceptance_criteria, ticket_quality_score, status,
            created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        ON CONFLICT (clickup_task_id) DO NOTHING`,
        [
            TICKET_ID,
            TICKET_ID,
            PROJECT_ID,
            `Test Ticket: ${PROMPT.substring(0, 50)}...`,
            PROMPT,
            'Execution completes successfully',
            80, // Good quality score
            'QUEUED'
        ]
    );

    log(`✅ Ticket record created: ${TICKET_ID}`);

    // 2. Create execution record in database
    const result = await client.query(
        `INSERT INTO executions (
            id, ticket_id, ai_provider, status, 
            prompt, complexity_score,
            created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        RETURNING id`,
        [
            executionId,
            TICKET_ID,
            PROVIDER,
            'QUEUED',
            PROMPT,
            6 // Medium complexity
        ]
    );

    log(`✅ Execution record created: ${result.rows[0].id}`);

    // 2. Build RabbitMQ message
    const message = {
        messageId,
        timestamp: new Date().toISOString(),
        correlationId,
        payload: {
            ticketId: TICKET_ID,
            executionId,
            aiProvider: PROVIDER,
            priority: 3, // Medium priority
            prompt: PROMPT,
            repositoryUrl,
            projectId: PROJECT_ID,
            allowFallback: true
        }
    };

    // 3. Connect to RabbitMQ and publish
    const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
    log(`🐰 Connecting to RabbitMQ: ${rabbitmqUrl}`);

    const connection = await amqp.connect(rabbitmqUrl);
    const channel = await connection.createChannel();

    const queueName = 'ai-execution-queue';

    // Check queue exists (don't try to modify existing configuration)
    try {
        await channel.checkQueue(queueName);
        log(`✅ Queue verified: ${queueName}`);
    } catch (error) {
        // Queue doesn't exist - this is fine, it will be created by the consumer
        log(`⚠️  Queue not found, but message will be published anyway`);
    }

    // Publish message
    const published = channel.sendToQueue(
        queueName,
        Buffer.from(JSON.stringify(message)),
        {
            persistent: true,
            contentType: 'application/json',
            correlationId,
            messageId,
            timestamp: Date.now(),
            appId: 'test-ai-execution-script'
        }
    );

    if (!published) {
        await client.query(
            `UPDATE executions SET status = 'FAILED', error_message = 'Failed to publish to queue', 
             failed_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [executionId]
        );
        throw new Error('Failed to publish message to queue');
    }

    await channel.close();
    await connection.close();

    log(`${c.green}${c.bright}✅ Message published to queue!${c.reset}`);
    log(`   Queue: ${queueName}`);
    log(`   Message ID: ${messageId}\n`);

    return executionId;
}

// Main
async function main() {
    console.log(`\n${c.bright}${c.cyan}${'='.repeat(80)}${c.reset}`);
    console.log(`${c.bright}${c.cyan}  TEST: AI Execution Stage ${PUBLISH_MODE ? '(Publish & Monitor)' : '(Monitor Only)'}${c.reset}`);
    console.log(`${c.bright}${c.cyan}${'='.repeat(80)}${c.reset}\n`);

    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL not set');
        process.exit(1);
    }

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    log(`✅ Connected to database`);

    try {
        // Find or create execution to test
        let executionId = EXECUTION_ID;

        // If publish mode, create and publish a new test message
        if (PUBLISH_MODE) {
            log(`\n${c.yellow}📤 PUBLISH MODE: Creating and publishing test message...${c.reset}\n`);
            executionId = await publishTestMessage(client);
            log(`${c.green}✅ Ready to monitor execution: ${executionId}${c.reset}\n`);
        } else if (!executionId) {
            // Monitor mode: find existing execution
            const result = await client.query(
                `SELECT id, ticket_id, ai_provider, status, created_at
         FROM executions
         WHERE ticket_id IN (SELECT id FROM tickets WHERE clickup_task_id LIKE 'task-%')
         ORDER BY created_at DESC
         LIMIT 1`
            );

            if (result.rows.length === 0) {
                console.error('❌ No test executions found. Run full E2E test first or use --publish flag.');
                process.exit(1);
            }

            executionId = result.rows[0].id;
            log(`📋 Found most recent test execution: ${executionId}`);
            log(`   Provider: ${result.rows[0].ai_provider}`);
            log(`   Status: ${result.rows[0].status}`);
            log(`   Created: ${result.rows[0].created_at}`);
        }

        // Monitor execution
        log(`\n${c.yellow}⏳ Monitoring execution progress...${c.reset}`);
        log(`   Timeout: ${TIMEOUT_MS}ms`);
        log(`   Poll interval: ${POLL_MS}ms\n`);

        const startTime = Date.now();
        let tickCount = 0;

        while (Date.now() - startTime < TIMEOUT_MS) {
            const result = await client.query(
                `SELECT id, status, ai_provider, error_message, confidence_score, 
                completed_at, failed_at, updated_at
         FROM executions
         WHERE id = $1`,
                [executionId]
            );

            if (result.rows.length === 0) {
                console.error('❌ Execution not found!');
                process.exit(1);
            }

            const exec = result.rows[0];
            const elapsed = Date.now() - startTime;

            // Check terminal states
            if (exec.status === 'COMPLETED') {
                log(`${c.green}${c.bright}\u2705 Execution COMPLETED!${c.reset}`);
                log(`   Confidence: ${exec.confidence_score ?? 'n/a'}`);
                log(`   Duration: ${elapsed}ms`);

                // Show files changed
                const filesResult = await client.query(
                    `SELECT files_changed FROM executions WHERE id = $1`,
                    [executionId]
                );
                if (filesResult.rows[0]?.files_changed) {
                    try {
                        const files = JSON.parse(filesResult.rows[0].files_changed);
                        log(`   Files changed: ${files.length}`);
                        files.forEach(f => log(`     - ${f}`));
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
                process.exit(0);
            }

            if (exec.status === 'FAILED' || exec.status === 'TIMEOUT' || exec.status === 'CANCELLED') {
                console.error(`${c.red}${c.bright}\u274c Execution ${exec.status}!${c.reset}`);
                console.error(`   Error: ${exec.error_message || 'none'}`);
                console.error(`   Duration: ${elapsed}ms`);
                process.exit(1);
            }

            // Log progress every 5 polls
            tickCount++;
            if (tickCount % 5 === 0) {
                log(`\ud83d\udd04 Status: ${exec.status} (t+${elapsed}ms)`);
            }

            await sleep(POLL_MS);
        }

        // Timeout
        console.error(`${c.red}${c.bright}\u23f1\ufe0f  Test timed out after ${TIMEOUT_MS}ms${c.reset}`);
        const finalResult = await client.query(
            `SELECT status FROM executions WHERE id = $1`,
            [executionId]
        );
        console.error(`   Final status: ${finalResult.rows[0]?.status || 'unknown'}`);
        process.exit(1);

    } finally {
        await client.end();
    }
}

process.on('SIGINT', () => {
    console.log(`\n${c.yellow}\u26a0\ufe0f  Interrupted${c.reset}\n`);
    process.exit(130);
});

main().catch(err => {
    console.error(`${c.red}${c.bright}\u274c Error:${c.reset} ${err.message}`);
    process.exit(1);
});
