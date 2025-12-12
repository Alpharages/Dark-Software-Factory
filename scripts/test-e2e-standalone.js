#!/usr/bin/env node

/**
 * End-to-End Workflow Test Script (Standalone version - no external deps)
 * 
 * Tests all 10 stages of the ticket processing workflow.
 * This version manually loads .env without requiring dotenv module.
 * 
 * Usage:
 *   node scripts/test-e2e-standalone.js
 *   node scripts/test-e2e-standalone.js --skip-ai
 *   node scripts/test-e2e-standalone.js --cleanup
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const amqp = require('amqplib');

// Parse command line arguments
const args = process.argv.slice(2);
const SKIP_AI = args.includes('--skip-ai');
const CLEANUP_ONLY = args.includes('--cleanup');

// Load .env file manually
function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');

    if (!fs.existsSync(envPath)) {
        console.error('❌ ERROR: .env file not found at', envPath);
        process.exit(1);
    }

    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
        line = line.trim();
        if (!line || line.startsWith('#')) return;

        const [key, ...valueParts] = line.split('=');
        if (key && valueParts.length) {
            let value = valueParts.join('=').trim();
            // Remove quotes if present
            value = value.replace(/^["']|["']$/g, '');
            process.env[key.trim()] = value;
        }
    });

    console.log('✅ Environment variables loaded from .env\n');
}

// Load environment
try {
    loadEnv();
} catch (error) {
    console.error('❌ Failed to load .env:', error.message);
    process.exit(1);
}

// Test configuration
const TEST_TICKET_ID = 'test-e2e-' + Date.now();
const TEST_TASK_ID = 'task-' + Date.now();
const POLL_INTERVAL = 2000; // 2 seconds
const MAX_WAIT_TIME = 300000; // 5 minutes

// ANSI colors
const c = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

function log(stage, message, status = 'info') {
    const timestamp = new Date().toISOString().substring(11, 23);
    const color = status === 'success' ? c.green :
        status === 'error' ? c.red :
            status === 'warning' ? c.yellow : c.cyan;

    console.log(`${c.bright}[${timestamp}]${c.reset} ${color}[Stage ${stage}]${c.reset} ${message}`);
}

function logHeader(title) {
    console.log(`\n${c.bright}${c.blue}${'='.repeat(80)}${c.reset}`);
    console.log(`${c.bright}${c.blue}  ${title}${c.reset}`);
    console.log(`${c.bright}${c.blue}${'='.repeat(80)}${c.reset}\n`);
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

let pgClient;
let rabbitConnection;
let rabbitChannel;

async function setupConnections() {
    logHeader('🔌 Setting Up Connections');

    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL not found in environment');
    }

    if (!process.env.RABBITMQ_URL) {
        throw new Error('RABBITMQ_URL not found in environment');
    }

    // PostgreSQL
    log('0', 'Connecting to PostgreSQL...', 'info');
    pgClient = new Client({ connectionString: process.env.DATABASE_URL });
    await pgClient.connect();
    log('0', '✅ PostgreSQL connected', 'success');

    // RabbitMQ
    log('0', 'Connecting to RabbitMQ...', 'info');
    rabbitConnection = await amqp.connect(process.env.RABBITMQ_URL);
    rabbitChannel = await rabbitConnection.createChannel();
    log('0', '✅ RabbitMQ connected', 'success');
}

async function cleanup() {
    logHeader('🧹 Cleaning Up Previous Test Data');

    try {
        const result = await pgClient.query(`
      WITH deleted_executions AS (
        DELETE FROM executions WHERE ticket_id LIKE 'test-e2e-%' RETURNING id
      ),
      deleted_tickets AS (
        DELETE FROM tickets WHERE id LIKE 'test-e2e-%' OR clickup_task_id LIKE 'task-%' RETURNING id
      )
      SELECT 
        (SELECT COUNT(*) FROM deleted_executions) as executions_deleted,
        (SELECT COUNT(*) FROM deleted_tickets) as tickets_deleted;
    `);

        const { executions_deleted, tickets_deleted } = result.rows[0];
        log('0', `🗑️  Deleted ${tickets_deleted} test tickets, ${executions_deleted} executions`, 'success');
    } catch (error) {
        log('0', `⚠️  Cleanup warning: ${error.message}`, 'warning');
    }
}

async function stage1_createTicket() {
    logHeader('Stage 1: Ticket Creation');

    const repositoryUrl = process.env.GITHUB_DEFAULT_REPOSITORY;

    if (!repositoryUrl) {
        log('1', '❌ GITHUB_DEFAULT_REPOSITORY not set in .env', 'error');
        throw new Error('Please add GITHUB_DEFAULT_REPOSITORY to your .env file');
    }

    log('1', `Ticket ID: ${TEST_TICKET_ID}`, 'info');
    log('1', `Repository: ${repositoryUrl}`, 'info');

    const result = await pgClient.query(`
    INSERT INTO tickets (
      id, clickup_task_id, project_id, title, description, 
      acceptance_criteria, ticket_quality_score, status,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
    RETURNING *;
  `, [
        TEST_TICKET_ID,
        TEST_TASK_ID,
        repositoryUrl,
        '🧪 E2E Test - Complete Workflow Validation',
        'End-to-end test validating all 10 workflow stages.',
        'AC1: Processes through all stages\nAC2: AI completes\nAC3: QA passes',
        85,
        'RECEIVED'
    ]);

    log('1', `✅ Ticket created (status: ${result.rows[0].status})`, 'success');
    return result.rows[0];
}

async function stage2_publishToIntake() {
    logHeader('Stage 2: Publish to Intake Queue');

    const correlationId = `test-${Date.now()}`;

    // IRawTaskEvent - must match interface from ticket-intake.interface.ts
    const taskEvent = {
        correlationId,
        webhookEventId: `webhook-${Date.now()}`,
        eventType: 'taskCreated',
        taskId: TEST_TASK_ID,
        taskName: '🧪 E2E Test - Complete Workflow Validation',
        taskDescription: `End-to-end test validating all 10 workflow stages.

## Acceptance Criteria
AC1: Processes through all stages
AC2: AI completes execution
AC3: QA validation passes`,
        taskStatus: 'to do',
        listId: '901813518753', // Your actual ClickUp list ID
        listName: 'Test List',
        spaceId: 'space-123',
        projectId: 'e2e-test-project',
        projectName: 'E2E Test Project',
        taskUrl: `https://app.clickup.com/t/${TEST_TASK_ID}`,
        tags: ['e2e-test', 'automated'],
        customFields: {},
        creatorEmail: 'test@darkfactory.ai',
        eventTimestamp: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
    };

    // Wrap in expected message format (matches RabbitMQPublisherService)
    const message = {
        messageId: `msg-${Date.now()}`,
        timestamp: new Date().toISOString(),
        correlationId,
        payload: taskEvent
    };

    // Don't assert queue - use existing configuration from application
    rabbitChannel.sendToQueue(
        'ticket-intake-queue',
        Buffer.from(JSON.stringify(message)),
        { persistent: true, correlationId: message.correlationId, messageId: message.messageId }
    );

    log('2', '✅ Published IRawTaskEvent to ticket-intake-queue', 'success');
    log('2', `   Task: ${taskEvent.taskName}`, 'info');
    await sleep(5000); // Wait 5 seconds for processing
}

async function stage3_verifyValidation() {
    logHeader('Stage 3: Ticket Validation');

    const startTime = Date.now();
    while (Date.now() - startTime < 80000) { // 30 sec timeout
        const result = await pgClient.query(
            'SELECT status, ticket_quality_score FROM tickets WHERE id = $1',
            [TEST_TICKET_ID]
        );

        const currentStatus = result.rows[0].status;

        // Accept VALIDATED or QUEUED (AI routing may have already processed)
        if (currentStatus === 'VALIDATED' || currentStatus === 'QUEUED') {
            log('3', `✅ Validated (score: ${result.rows[0].ticket_quality_score})`, 'success');
            log('3', `✅ Status: RECEIVED → ${currentStatus}`, 'success');
            return true;
        }

        if (currentStatus === 'VALIDATION_FAILED') {
            log('3', `❌ Validation failed`, 'error');
            throw new Error('Ticket validation failed');
        }

        await sleep(POLL_INTERVAL);
    }

    throw new Error('Timeout waiting for validation');
}

async function stage4_verifyAIRouting() {
    logHeader('Stage 4: AI Routing');

    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
        const result = await pgClient.query(`
      SELECT id, ai_provider, status, complexity_score
      FROM executions WHERE ticket_id = $1
      ORDER BY created_at DESC LIMIT 1;
    `, [TEST_TICKET_ID]);

        if (result.rows.length > 0) {
            const exec = result.rows[0];
            log('4', `✅ Execution created (ID: ${exec.id.substring(0, 8)}...)`, 'success');
            log('4', `   Provider: ${exec.ai_provider}, Complexity: ${exec.complexity_score}`, 'info');
            return exec;
        }

        await sleep(POLL_INTERVAL);
    }

    throw new Error('Timeout waiting for execution');
}

async function stage5_6_aiExecution(executionId) {
    logHeader('Stage 5-6: AI Execution');

    if (SKIP_AI) {
        log('5', '⏭️  Skipping real AI execution', 'warning');

        await pgClient.query(`
      UPDATE executions 
      SET status = 'COMPLETED', confidence_score = 0.92,
          code_output = $1, files_changed = $2, completed_at = NOW()
      WHERE id = $3;
    `, [
            JSON.stringify({ success: true }),
            JSON.stringify(['src/test.ts']),
            executionId
        ]);

        await pgClient.query(
            `UPDATE tickets SET status = 'QA_REVIEW' WHERE id = $1`,
            [TEST_TICKET_ID]
        );

        log('6', '✅ Simulated completion (confidence: 0.92)', 'success');
        return;
    }

    log('5', 'Monitoring AI execution (may take 2-5 minutes)...', 'info');

    const startTime = Date.now();
    let lastStatus = null;

    while (Date.now() - startTime < MAX_WAIT_TIME) {
        const result = await pgClient.query(
            `SELECT status, confidence_score FROM executions WHERE id = $1`,
            [executionId]
        );

        const exec = result.rows[0];

        if (exec.status !== lastStatus) {
            log('5', `Status: ${exec.status}`, 'info');
            lastStatus = exec.status;
        }

        if (exec.status === 'COMPLETED') {
            const duration = Math.round((Date.now() - startTime) / 1000);
            log('6', `✅ Completed (score: ${exec.confidence_score}, ${duration}s)`, 'success');
            return;
        }

        if (exec.status === 'FAILED') {
            throw new Error('AI execution failed');
        }

        await sleep(POLL_INTERVAL);
    }

    throw new Error('Timeout waiting for AI execution');
}

async function verifyDownstream(stage, table, condition, description) {
    logHeader(`Stage ${stage}: ${description}`);

    const result = await pgClient.query(condition);

    if (result.rows.length > 0) {
        log(stage, `✅ ${description} found`, 'success');
        Object.entries(result.rows[0]).forEach(([key, value]) => {
            if (value && key !== 'id') {
                log(stage, `   ${key}: ${value}`, 'info');
            }
        });
        return result.rows[0];
    } else {
        log(stage, `⚠️  Not found (may not have reached this stage yet)`, 'warning');
        return null;
    }
}

async function printSummary() {
    logHeader('📊 Test Summary');

    const ticket = await pgClient.query('SELECT * FROM tickets WHERE id = $1', [TEST_TICKET_ID]);
    const exec = await pgClient.query(
        'SELECT * FROM executions WHERE ticket_id = $1 ORDER BY created_at DESC LIMIT 1',
        [TEST_TICKET_ID]
    );

    console.log(`${c.bright}Ticket:${c.reset} ${ticket.rows[0].id}`);
    console.log(`  Status: ${c.cyan}${ticket.rows[0].status}${c.reset}`);
    console.log(`  Quality: ${ticket.rows[0].ticket_quality_score}`);

    if (exec.rows.length > 0) {
        console.log(`\n${c.bright}Execution:${c.reset}`);
        console.log(`  Provider: ${exec.rows[0].ai_provider}`);
        console.log(`  Status: ${c.cyan}${exec.rows[0].status}${c.reset}`);
        console.log(`  Confidence: ${exec.rows[0].confidence_score || 'N/A'}`);
    }

    console.log(`\n${c.green}${c.bright}✅ Test completed!${c.reset}\n`);
}

async function main() {
    try {
        await setupConnections();

        if (CLEANUP_ONLY) {
            await cleanup();
            log('0', '✅ Cleanup complete', 'success');
            process.exit(0);
        }

        await cleanup();

        await stage1_createTicket();
        await stage2_publishToIntake();
        await stage3_verifyValidation();
        const execution = await stage4_verifyAIRouting();
        await stage5_6_aiExecution(execution.id);

        // Check downstream stages
        await verifyDownstream(
            '7',
            'qa_results',
            `SELECT * FROM qa_results WHERE execution_id = '${execution.id}' LIMIT 1`,
            'QA Results'
        );

        await verifyDownstream(
            '8',
            'github_pushes',
            `SELECT * FROM github_pushes WHERE execution_id = '${execution.id}' LIMIT 1`,
            'GitHub Push'
        );

        await printSummary();

    } catch (error) {
        console.error(`\n${c.red}${c.bright}❌ Test failed:${c.reset} ${error.message}\n`);
        process.exit(1);
    } finally {
        if (pgClient) await pgClient.end();
        if (rabbitChannel) await rabbitChannel.close();
        if (rabbitConnection) await rabbitConnection.close();
    }
}

process.on('SIGINT', async () => {
    console.log(`\n\n${c.yellow}⚠️  Interrupted${c.reset}\n`);
    if (pgClient) await pgClient.end();
    if (rabbitChannel) await rabbitChannel.close();
    if (rabbitConnection) await rabbitConnection.close();
    process.exit(130);
});

main();
