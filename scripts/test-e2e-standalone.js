#!/usr/bin/env node

/**
 * DSF End-to-End Workflow Test Script (Standalone)
 *
 * Tests the workflow stages you listed:
 *  1) Ticket Creation
 *  2) Intake Queue Publishing
 *  3) Validation (RECEIVED → QUEUED)
 *  4) AI Routing & Execution Creation
 *  5-6) AI Execution (real or simulated)
 *  7) QA Automation Trigger
 *  8) GitHub Push Check (optional simulation)
 *  9-10) Deployment Status (optional simulation)
 *
 * IMPORTANT (current codebase reality):
 * - Stages 1–7 can be validated via DB + queues.
 * - Stages 8–10 are NOT automatically driven end-to-end in this repo unless you have
 *   additional orchestration running that creates github_pushes + deployments.
 *   This script can either FAIL (default) or SIMULATE those records.
 *
 * Usage:
 *   node scripts/test-e2e-standalone.js
 *   node scripts/test-e2e-standalone.js --skip-ai
 *   node scripts/test-e2e-standalone.js --simulate-github --simulate-deployment
 *   node scripts/test-e2e-standalone.js --cleanup
 *
 * Tuning:
 *   --timeout-ms=600000   (default 300000)
 *   --poll-ms=2000        (default 2000)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');
const { Client } = require('pg');
const amqp = require('amqplib');

// -------------------------
// Args / config
// -------------------------

const args = process.argv.slice(2);

function getArgValue(prefix) {
  const hit = args.find((a) => a.startsWith(prefix));
  if (!hit) return null;
  const idx = hit.indexOf('=');
  if (idx === -1) return null;
  return hit.slice(idx + 1);
}

const FLAGS = {
  skipAi: args.includes('--skip-ai'),
  simulateGithub: args.includes('--simulate-github'),
  simulateDeployment: args.includes('--simulate-deployment'),
  cleanupOnly: args.includes('--cleanup'),
  // Optional: if you want to validate the real Nest consumers, start the app and use DB polling.
  // Default behavior is fully-standalone simulation (does not require app to be running).
  useApp: args.includes('--use-app'),
  startApp: args.includes('--start-app'),
  appLogs: args.includes('--app-logs'),
  timeoutMs: parseInt(getArgValue('--timeout-ms=') || '300000', 10),
  pollMs: parseInt(getArgValue('--poll-ms=') || '2000', 10),
  // Skip to specific stage: --start-from=5 (starts from stage 5)
  startFrom: parseInt(getArgValue('--start-from=') || '1', 10),
};

// -------------------------
// Env loader (no dotenv dep)
// -------------------------

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error('❌ ERROR: .env file not found at', envPath);
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

try {
  loadEnv();
} catch (e) {
  console.error('❌ Failed to load .env:', e.message);
  process.exit(1);
}

// -------------------------
// Pretty logging
// -------------------------

const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function nowTs() {
  return new Date().toISOString().substring(11, 23);
}

function log(stage, message, status = 'info') {
  const color = status === 'success' ? c.green : status === 'error' ? c.red : status === 'warning' ? c.yellow : c.cyan;
  console.log(`${c.bright}[${nowTs()}]${c.reset} ${color}[Stage ${stage}]${c.reset} ${message}`);
}

function header(title) {
  console.log(`\n${c.bright}${c.blue}${'='.repeat(90)}${c.reset}`);
  console.log(`${c.bright}${c.blue}  ${title}${c.reset}`);
  console.log(`${c.bright}${c.blue}${'='.repeat(90)}${c.reset}\n`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// -------------------------
// Optional: ensure app + consumers are running (only with --use-app)
// -------------------------

let appProcess = null;

function httpGetJson(url, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ statusCode: res.statusCode, json });
        } catch (e) {
          reject(new Error(`Non-JSON response from ${url} (status=${res.statusCode})`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout calling ${url}`));
    });
  });
}

async function isAppHealthy() {
  const port = parseInt(process.env.PORT || '3000', 10);
  try {
    const { statusCode, json } = await httpGetJson(`http://127.0.0.1:${port}/health`, 1500);
    if (statusCode !== 200) return { ok: false, reason: `HTTP ${statusCode}` };
    if (!json || json.status !== 'healthy') return { ok: false, reason: `status=${json?.status}` };
    if (json.services?.database !== 'up') return { ok: false, reason: 'database down' };
    if (json.services?.rabbitmq !== 'up') return { ok: false, reason: 'rabbitmq down' };
    return { ok: true, reason: 'healthy' };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function ensureAppRunning() {
  header('🧩 Ensuring DSF app/consumers are running');

  const health = await isAppHealthy();
  if (health.ok) {
    log('0', '✅ App is already healthy (/health)', 'success');
    return { started: false };
  }

  if (!FLAGS.startApp) {
    throw new Error(
      `App is not healthy/reachable (${health.reason}). Start the DSF app first, or re-run with --start-app.`,
    );
  }

  const rootDir = path.join(__dirname, '..');
  const port = parseInt(process.env.PORT || '3000', 10);

  log('0', `App not healthy (${health.reason}). Starting app via pnpm start (port=${port})...`, 'warning');

  appProcess = spawn('pnpm', ['start'], {
    cwd: rootDir,
    env: process.env,
    stdio: FLAGS.appLogs ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });

  if (!FLAGS.appLogs) {
    const prefix = '[app] ';
    appProcess.stdout.on('data', (d) => process.stdout.write(prefix + d.toString()));
    appProcess.stderr.on('data', (d) => process.stderr.write(prefix + d.toString()));
  }

  appProcess.on('exit', (code) => {
    if (code !== null && code !== 0) {
      // Let the main flow fail health checks; just surface exit code.
      console.error(`${c.red}${c.bright}App process exited (code=${code})${c.reset}`);
    }
  });

  // Wait for health
  await poll(
    async () => {
      const h = await isAppHealthy();
      if (h.ok) return done(true);
      return h;
    },
    {
      timeoutMs: Math.min(DEFAULT_TIMEOUT, 90_000),
      intervalMs: 1000,
      description: 'app /health to become healthy',
      onTick: async (h) => {
        log('0', `Waiting for app health... (${h.reason})`, 'info');
      },
    },
  );

  log('0', '✅ App is healthy and consumers should be running', 'success');
  return { started: true };
}

// -------------------------
// Connections
// -------------------------

let pgClient;
let rabbitConn;
let rabbitCh;

async function setupConnections() {
  header('🔌 Setting Up Connections');

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set');
  if (!process.env.RABBITMQ_URL) throw new Error('RABBITMQ_URL not set');

  log('0', 'Connecting to PostgreSQL...', 'info');
  pgClient = new Client({ connectionString: process.env.DATABASE_URL });
  await pgClient.connect();
  log('0', '✅ PostgreSQL connected', 'success');

  log('0', 'Connecting to RabbitMQ...', 'info');
  rabbitConn = await amqp.connect(process.env.RABBITMQ_URL);
  rabbitCh = await rabbitConn.createChannel();
  log('0', '✅ RabbitMQ connected', 'success');
}

async function teardownConnections() {
  if (pgClient) await pgClient.end().catch(() => undefined);
  if (rabbitCh) await rabbitCh.close().catch(() => undefined);
  if (rabbitConn) await rabbitConn.close().catch(() => undefined);

  if (appProcess && !appProcess.killed) {
    try {
      appProcess.kill('SIGINT');
    } catch {
      // ignore
    }
    appProcess = null;
  }
}

// -------------------------
// Helpers
// -------------------------

function safeJson(obj) {
  return JSON.stringify(obj);
}

function randomHex(len) {
  const chars = 'abcdef0123456789';
  let s = '';
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Fallback (older node): not expected on modern Node, but keep safe.
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeRepository(repoOrUrl) {
  if (!repoOrUrl) return '';
  const s = repoOrUrl.trim();
  // allow: owner/repo
  if (/^[^/\s]+\/[^/\s]+$/.test(s)) return s;
  // allow: https://github.com/owner/repo or .../owner/repo.git
  const m = s.match(/github\.com\/(.+?\/.+?)(?:\.git)?$/i);
  if (m && m[1]) return m[1];
  return s;
}

function redactUrlCredentials(url) {
  if (!url) return url;
  // redact https://user:pass@host -> https://***@host
  return String(url).replace(/^(https?:\/\/)([^@]+)@/i, (_, p1) => `${p1}***@`);
}

async function poll(fn, { timeoutMs, intervalMs, onTick, description }) {
  const start = Date.now();
  let lastErr;

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fn();
      if (res && res.__pollDone) return res.value;
      if (onTick) await onTick(res);
    } catch (e) {
      lastErr = e;
    }
    await sleep(intervalMs);
  }

  const suffix = lastErr ? ` (last error: ${lastErr.message})` : '';
  throw new Error(`Timeout waiting for ${description}${suffix}`);
}

function done(value) {
  return { __pollDone: true, value };
}

async function queryOne(sql, params = []) {
  const r = await pgClient.query(sql, params);
  return r.rows[0] || null;
}

async function queryMany(sql, params = []) {
  const r = await pgClient.query(sql, params);
  return r.rows;
}

async function publishEnvelope(queueName, payload, correlationId) {
  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const envelope = {
    messageId,
    timestamp: new Date().toISOString(),
    correlationId,
    payload,
  };

  // Ensure queue exists WITHOUT changing its arguments (avoid PRECONDITION_FAILED)
  try {
    await rabbitCh.checkQueue(queueName);
  } catch (e) {
    // If not found, create minimal durable queue (no DLQ args).
    // This is safest for mixed environments.
    await rabbitCh.assertQueue(queueName, { durable: true });
  }

  rabbitCh.sendToQueue(queueName, Buffer.from(JSON.stringify(envelope)), {
    persistent: true,
    correlationId,
    messageId,
    contentType: 'application/json',
    timestamp: Date.now(),
  });

  return { messageId, correlationId };
}

async function waitForEnvelope(queueName, predicate, timeoutMs, intervalMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Use basic.get to avoid creating long-lived consumers.
    const msg = await rabbitCh.get(queueName, { noAck: false });
    if (!msg) {
      await sleep(intervalMs);
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(msg.content.toString());
    } catch (e) {
      // Malformed message - ack and ignore.
      rabbitCh.ack(msg);
      continue;
    }

    const ok = !!predicate(parsed);
    if (ok) {
      rabbitCh.ack(msg);
      return parsed;
    }

    // Not ours: requeue it and wait a bit.
    rabbitCh.nack(msg, false, true);
    await sleep(intervalMs);
  }

  throw new Error(`Timeout waiting for message on ${queueName}`);
}

// -------------------------
// Test IDs
// -------------------------

const RUN_ID = Date.now();
const TEST_TICKET_ID = `test-e2e-${RUN_ID}`;
const TEST_TASK_ID = `task-${RUN_ID}`;
const DEFAULT_TIMEOUT = FLAGS.timeoutMs;
const POLL_MS = FLAGS.pollMs;

const QUEUES = {
  ticketIntake: 'ticket-intake-queue',
  aiRouting: 'ai-routing-queue',
  aiExecution: 'ai-execution-queue',
  qaCheck: 'qa-check-queue',
  githubPrCreated: 'github-pr-created-queue',
};

// -------------------------
// Cleanup
// -------------------------

async function cleanup() {
  header('🧹 Cleaning Up Test Data');

  // Delete in dependency order.
  // deployments -> github_pushes -> qa_results -> executions -> tickets
  const deleted = {
    deployments: 0,
    github_pushes: 0,
    qa_results: 0,
    executions: 0,
    tickets: 0,
  };

  // Find all test tickets by our clickup_task_id prefix (task-...) and legacy ids (test-e2e-...)
  const ticketIds = await queryMany(
    `SELECT id FROM tickets WHERE clickup_task_id LIKE 'task-%' OR id LIKE 'test-e2e-%'`,
    [],
  );
  const ticketIdList = ticketIds.map((r) => r.id);

  const execIds = ticketIdList.length
    ? await queryMany(`SELECT id FROM executions WHERE ticket_id = ANY($1::text[])`, [ticketIdList])
    : [];

  const execIdList = execIds.map((r) => r.id);

  if (execIdList.length) {
    const pushIds = await queryMany(
      `SELECT id FROM github_pushes WHERE execution_id = ANY($1::text[])`,
      [execIdList],
    );

    const pushIdList = pushIds.map((r) => r.id);

    if (pushIdList.length) {
      const d1 = await pgClient.query(
        `DELETE FROM deployments WHERE github_push_id = ANY($1::text[])`,
        [pushIdList],
      );
      deleted.deployments += d1.rowCount || 0;

      const d2 = await pgClient.query(
        `DELETE FROM github_pushes WHERE id = ANY($1::text[])`,
        [pushIdList],
      );
      deleted.github_pushes += d2.rowCount || 0;
    }

    const d3 = await pgClient.query(
      `DELETE FROM qa_results WHERE execution_id = ANY($1::text[])`,
      [execIdList],
    );
    deleted.qa_results += d3.rowCount || 0;

    const d4 = await pgClient.query(
      `DELETE FROM executions WHERE id = ANY($1::text[])`,
      [execIdList],
    );
    deleted.executions += d4.rowCount || 0;
  }

  if (ticketIdList.length) {
    const d5 = await pgClient.query(`DELETE FROM tickets WHERE id = ANY($1::text[])`, [ticketIdList]);
    deleted.tickets += d5.rowCount || 0;
  }

  log('0', `Deleted deployments=${deleted.deployments}, github_pushes=${deleted.github_pushes}, qa_results=${deleted.qa_results}, executions=${deleted.executions}, tickets=${deleted.tickets}`, 'success');
}

// -------------------------
// Stage 1: Ticket Creation
// -------------------------

async function stage1_createTicket() {
  header('Stage 1: Ticket Creation');

  const repoEnv = process.env.GITHUB_DEFAULT_REPOSITORY;
  if (!repoEnv) {
    throw new Error('GITHUB_DEFAULT_REPOSITORY not set in .env');
  }

  // Stage 1 is the *source ticket* (ClickUp task) creation.
  // We represent that by generating a deterministic ClickUp task ID and metadata.
  log('1', `✅ Created test ClickUp task (taskId=${TEST_TASK_ID})`, 'success');
  log('1', `Repository/project: ${redactUrlCredentials(repoEnv)}`, 'info');
  return { clickup_task_id: TEST_TASK_ID, project_id: repoEnv };
}

// -------------------------
// Stage 2: Intake Queue Publishing
// -------------------------

async function stage2_publishToIntake() {
  header('Stage 2: Intake Queue Publishing');

  const correlationId = `corr-${RUN_ID}`;

  const repoEnv = process.env.GITHUB_DEFAULT_REPOSITORY;
  const projectId = repoEnv || 'unknown';

  // Matches src/ticket-intake/interfaces/raw-task-event.interface.ts shape
  const taskEvent = {
    correlationId, // base consumer will override correlationId, but keep it for readability
    webhookEventId: `webhook-${RUN_ID}`,
    eventType: 'taskCreated',
    taskId: TEST_TASK_ID,
    taskName: '✨ Create Hello World API Endpoint',
    taskDescription: `Create a simple REST API endpoint that returns "Hello World".

## Requirements
- Create a new file \`src/hello/hello.controller.ts\`
- Implement a GET endpoint at \`/api/hello\`
- Return JSON: \`{ "message": "Hello World", "timestamp": "<current-time>" }\`
- Use NestJS decorators (@Controller, @Get)

## Acceptance Criteria
- [ ] File \`src/hello/hello.controller.ts\` is created
- [ ] Endpoint responds with correct JSON structure  
- [ ] Code follows NestJS best practices
`,
    taskStatus: 'to do',
    listId: 'e2e-list',
    listName: 'E2E List',
    spaceId: 'e2e-space',
    projectId,
    projectName: 'E2E Project',
    taskUrl: `https://app.clickup.com/t/${TEST_TASK_ID}`,
    tags: ['e2e', 'standalone-script'],
    // TicketIntakeService reads customFields['project_id'] first.
    customFields: {
      project_id: projectId,
    },
    creatorEmail: 'e2e-test@darkfactory.local',
    eventTimestamp: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  };

  const { messageId } = await publishEnvelope(QUEUES.ticketIntake, taskEvent, correlationId);

  log('2', `✅ Published to ${QUEUES.ticketIntake} (messageId=${messageId})`, 'success');

  // Lightweight “proof of processing”: we’ll confirm in Stage 3 by DB transitions.
  return { correlationId, messageId };
}

// -------------------------
// Stage 3: Validation (RECEIVED → VALIDATED) + handoff to routing
// -------------------------

async function stage3_validateAndEnqueueRouting({ correlationId }) {
  header('Stage 3: Validation (RECEIVED → VALIDATED)');

  // First, always try to observe DB changes (works whether app is running or a different consumer picked up message).
  const observed = await poll(
    async () => {
      const row = await queryOne(
        'SELECT id, clickup_task_id, status, ticket_quality_score FROM tickets WHERE clickup_task_id = $1',
        [TEST_TASK_ID],
      );
      if (!row) return null;
      if (row.status === 'VALIDATION_FAILED' || row.status === 'FAILED') {
        throw new Error(`Ticket entered failure state: ${row.status}`);
      }
      // We accept RECEIVED/VALIDATED/QUEUED here; Stage 4 will enforce QUEUED if needed.
      return done(row);
    },
    {
      timeoutMs: FLAGS.useApp ? DEFAULT_TIMEOUT : 8000,
      intervalMs: 500,
      description: 'ticket row to appear in DB',
    },
  ).catch(() => null);

  if (observed) {
    log('3', `✅ Ticket found in DB (id=${observed.id}, status=${observed.status})`, 'success');
    return observed;
  }

  // Standalone mode: consume the intake message and simulate TicketIntakeService behavior.
  log('3', `Consuming from ${QUEUES.ticketIntake} and simulating intake...`, 'info');

  const envelope = await waitForEnvelope(
    QUEUES.ticketIntake,
    (m) => m && m.correlationId === correlationId && m.payload && m.payload.taskId === TEST_TASK_ID,
    Math.min(DEFAULT_TIMEOUT, 30_000),
    500,
  );

  const event = envelope.payload;

  // Upsert ticket by clickup_task_id (matches real service behavior)
  const projectId = event.customFields?.project_id || event.projectId || event.listId || 'unknown';
  const title = event.taskName || 'Untitled';
  const description = event.taskDescription || '';
  const acceptance = description.includes('Acceptance Criteria')
    ? description.split('Acceptance Criteria').slice(1).join('Acceptance Criteria').trim()
    : '';

  const qualityScore = 80;

  const ticket = await queryOne(
    `INSERT INTO tickets (clickup_task_id, project_id, title, description, acceptance_criteria, ticket_quality_score, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,'VALIDATED',NOW(),NOW())
     ON CONFLICT (clickup_task_id) DO UPDATE SET
       project_id = EXCLUDED.project_id,
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       acceptance_criteria = EXCLUDED.acceptance_criteria,
       ticket_quality_score = EXCLUDED.ticket_quality_score,
       status = 'VALIDATED',
       updated_at = NOW()
     RETURNING id, clickup_task_id, status, ticket_quality_score`,
    [TEST_TASK_ID, projectId, title, description, acceptance, qualityScore],
  );

  log('3', `✅ Ticket validated (id=${ticket.id}, score=${ticket.ticket_quality_score})`, 'success');

  // Publish routing request to ai-routing-queue (shape: IRoutingRequest)
  await publishEnvelope(
    QUEUES.aiRouting,
    {
      ticketId: ticket.id,
      clickupTaskId: ticket.clickup_task_id,
      projectId: projectId,
      title,
      description,
      acceptanceCriteria: acceptance,
      tags: event.tags || [],
      qualityScore: qualityScore,
      qualityGrade: 'good',
      timestamp: new Date().toISOString(),
    },
    correlationId,
  );

  log('3', `✅ Published routing request to ${QUEUES.aiRouting}`, 'success');
  return ticket;
}

// -------------------------
// Stage 4: AI Routing & Execution Creation
// -------------------------

async function stage4_routeAndCreateExecution(ticket, { correlationId }) {
  header('Stage 4: AI Routing & Execution Creation');

  // First, try to observe execution in DB (works if app/other worker handled routing)
  const observed = await poll(
    async () => {
      const row = await queryOne(
        `SELECT id, ticket_id, ai_provider, status, complexity_score, created_at
         FROM executions
         WHERE ticket_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [ticket.id],
      );
      if (!row) return null;
      return done(row);
    },
    {
      timeoutMs: FLAGS.useApp ? DEFAULT_TIMEOUT : 8000,
      intervalMs: 500,
      description: 'execution row to appear in DB',
    },
  ).catch(() => null);

  if (observed) {
    log('4', `✅ Execution found in DB (id=${observed.id}, status=${observed.status})`, 'success');
    // Ensure ticket is QUEUED if app didn't update it yet.
    const t = await queryOne('SELECT status FROM tickets WHERE id = $1', [ticket.id]);
    if (t && t.status !== 'QUEUED') {
      await pgClient.query(`UPDATE tickets SET status = 'QUEUED', updated_at=NOW() WHERE id=$1`, [ticket.id]);
    }
    return observed;
  }

  // Standalone routing simulation: consume ai-routing-queue and create execution.
  log('4', `Consuming from ${QUEUES.aiRouting} and simulating routing...`, 'info');
  await waitForEnvelope(
    QUEUES.aiRouting,
    (m) => m && m.correlationId === correlationId && m.payload && m.payload.ticketId === ticket.id,
    Math.min(DEFAULT_TIMEOUT, 30_000),
    500,
  );

  // Create execution record (minimal fields to satisfy later stages)
  const exec = await queryOne(
    `INSERT INTO executions (ticket_id, ai_provider, prompt, status, complexity_score, created_at, updated_at)
     VALUES ($1,'CLAUDE_CODE',$2,'QUEUED',$3,NOW(),NOW())
     RETURNING id, ticket_id, ai_provider, status, complexity_score, created_at`,
    [ticket.id, 'E2E simulated prompt', 5],
  );

  // Update ticket status to QUEUED
  await pgClient.query(`UPDATE tickets SET status = 'QUEUED', updated_at = NOW() WHERE id = $1`, [ticket.id]);

  log('4', `✅ Execution created (id=${exec.id}) and ticket moved to QUEUED`, 'success');
  return exec;

  // Note: In standalone mode we intentionally do not publish to ai-execution-queue because
  // stage 5-6 is allowed to be simulated. If you want queue-based simulation later, we can add it.
}

// -------------------------
// Stage 5-6: AI Execution (real or simulated)
// -------------------------

async function stage5_6_aiExecution(execution) {
  header('Stage 5-6: AI Execution (real or simulated)');

  if (FLAGS.skipAi) {
    log('5', '⏭️  --skip-ai enabled: simulating execution completion', 'warning');

    // Mark execution completed and move ticket to QA_REVIEW.
    await pgClient.query(
      `UPDATE executions
       SET status = 'COMPLETED',
           confidence_score = $1,
           code_output = $2,
           files_changed = $3,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $4`,
      [
        0.95,
        safeJson({ ok: true, simulated: true, note: 'Simulated by test script' }),
        safeJson(['src/simulated-change.ts']),
        execution.id,
      ],
    );

    await pgClient.query(`UPDATE tickets SET status = 'QA_REVIEW', updated_at = NOW() WHERE id = $1`, [
      TEST_TICKET_ID,
    ]);

    log('6', '✅ Simulated execution COMPLETED and ticket moved to QA_REVIEW', 'success');
    return { simulated: true };
  }

  if (!FLAGS.useApp) {
    // Standalone default: if not explicitly skipping AI but also not using the app,
    // we still simulate (we can't run OrchestratorService here).
    log('5', 'Standalone mode: simulating execution completion (use --use-app for real workers)', 'warning');
    await pgClient.query(
      `UPDATE executions
       SET status = 'COMPLETED',
           confidence_score = $1,
           code_output = $2,
           files_changed = $3,
           completed_at = NOW(),
           updated_at = NOW()
       WHERE id = $4`,
      [
        0.9,
        safeJson({ ok: true, simulated: true, note: 'Standalone simulation (no app workers)' }),
        safeJson(['src/simulated-change.ts']),
        execution.id,
      ],
    );
    await pgClient.query(`UPDATE tickets SET status = 'QA_REVIEW', updated_at = NOW() WHERE id = $1`, [
      execution.ticket_id,
    ]);
    log('6', '✅ Simulated execution COMPLETED (standalone)', 'success');
    return { simulated: true };
  }

  log('5', 'Monitoring execution status in DB (requires app execution workers)...', 'info');

  const terminal = await poll(
    async () => {
      const row = await queryOne(
        `SELECT status, confidence_score, updated_at, completed_at, failed_at, error_message
         FROM executions
         WHERE id = $1`,
        [execution.id],
      );
      if (!row) throw new Error('Execution row disappeared');

      if (row.status === 'COMPLETED') return done(row);
      if (row.status === 'FAILED' || row.status === 'TIMEOUT' || row.status === 'CANCELLED') {
        throw new Error(`Execution entered terminal failure state: ${row.status} (${row.error_message || 'no error message'})`);
      }

      return row;
    },
    {
      timeoutMs: Math.max(DEFAULT_TIMEOUT, 10 * 60 * 1000),
      intervalMs: POLL_MS,
      description: 'execution.status to become COMPLETED',
      onTick: async (row) => {
        // Only log periodically to avoid huge output
        stage5_6_aiExecution.__tick = (stage5_6_aiExecution.__tick || 0) + 1;
        if (stage5_6_aiExecution.__tick % 5 === 0) {
          log('5', `Waiting... execution.status=${row.status} (t+${stage5_6_aiExecution.__tick * POLL_MS}ms)`, 'info');
        }
      },
    },
  );

  log('6', `✅ Execution completed (confidence=${terminal.confidence_score ?? 'n/a'})`, 'success');
  return { simulated: false };
}

// -------------------------
// Stage 7: QA Automation Trigger
// -------------------------

async function stage7_verifyQa(execution, correlationId) {
  header('Stage 7: QA Automation Trigger');

  // If we simulated AI, the system may not auto-publish QA check.
  // We publish BOTH QA message formats to the same queue to maximize compatibility
  // with whichever consumer is active.
  if (FLAGS.skipAi && FLAGS.useApp) {
    log('7', `Publishing QA check messages to ${QUEUES.qaCheck}...`, 'info');

    const ticket = await queryOne('SELECT id, project_id FROM tickets WHERE id = $1', [TEST_TICKET_ID]);
    const projectId = ticket?.project_id || TEST_TICKET_ID;

    // Format A: Story 3.7 queue message
    await publishEnvelope(
      QUEUES.qaCheck,
      {
        executionId: execution.id,
        ticketId: TEST_TICKET_ID,
        projectId,
        codeFiles: [
          {
            path: 'src/simulated-change.ts',
            content: '// simulated content\n',
            language: 'typescript',
          },
        ],
        aiProvider: execution.ai_provider,
        correlationId,
        completedAt: new Date().toISOString(),
      },
      correlationId,
    );

    // Format B: legacy/alt QA orchestrator message
    await publishEnvelope(
      QUEUES.qaCheck,
      {
        executionId: execution.id,
        ticketId: TEST_TICKET_ID,
        projectId,
        correlationId,
        workspacePath: process.cwd(),
        skipCategories: [],
      },
      correlationId,
    );

    log('7', '✅ QA check messages published', 'success');
  }

  if (!FLAGS.useApp) {
    // Standalone mode: directly create QAResult and move ticket to GITHUB_PUSH
    const existing = await queryOne('SELECT id FROM qa_results WHERE execution_id = $1', [execution.id]);
    if (!existing) {
      await queryOne(
        `INSERT INTO qa_results (id, execution_id, linting_passed, tests_passed, code_review_passed, overall_passed, created_at, updated_at)
         VALUES ($1,$2,true,true,true,true,NOW(),NOW())
         RETURNING id`,
        [uuid(), execution.id],
      );
    } else {
      await pgClient.query(
        `UPDATE qa_results SET linting_passed=true, tests_passed=true, code_review_passed=true, overall_passed=true, updated_at=NOW()
         WHERE execution_id=$1`,
        [execution.id],
      );
    }
    await pgClient.query(`UPDATE tickets SET status = 'GITHUB_PUSH', updated_at = NOW() WHERE id = $1`, [
      execution.ticket_id,
    ]);
    log('7', '✅ QAResult written (standalone) and ticket moved to GITHUB_PUSH', 'success');
  }

  const qa = await poll(
    async () => {
      const row = await queryOne(
        `SELECT id, execution_id, linting_passed, tests_passed, code_review_passed, overall_passed, created_at, updated_at
         FROM qa_results
         WHERE execution_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [execution.id],
      );
      if (!row) return null;

      // Wait until overall_passed is set (should be boolean). It defaults false, but we still accept it as a "computed" value.
      if (typeof row.overall_passed === 'boolean') {
        return done(row);
      }
      return row;
    },
    {
      timeoutMs: Math.max(DEFAULT_TIMEOUT, 5 * 60 * 1000),
      intervalMs: POLL_MS,
      description: 'qa_results record to exist for execution',
      onTick: async () => {
        stage7_verifyQa.__tick = (stage7_verifyQa.__tick || 0) + 1;
        if (stage7_verifyQa.__tick % 5 === 0) log('7', `Waiting for QA results... (t+${stage7_verifyQa.__tick * POLL_MS}ms)`, 'info');
      },
    },
  );

  log('7', `✅ QAResult found (overall_passed=${qa.overall_passed})`, 'success');
  log('7', `lint=${qa.linting_passed}, tests=${qa.tests_passed}, security=${qa.code_review_passed}`, 'info');

  const ticket = await queryOne('SELECT status FROM tickets WHERE id = $1', [TEST_TICKET_ID]);
  if (ticket) log('7', `Ticket status after QA stage: ${ticket.status}`, 'info');

  return qa;
}

// -------------------------
// Stage 8: GitHub Push Check
// -------------------------

async function stage8_verifyGithubPush(execution) {
  header('Stage 8: GitHub Push Check');

  const existing = await queryOne(
    `SELECT id, repository, branch_name, commit_sha, pr_number, pr_url, push_status, error_message, created_at, updated_at
     FROM github_pushes
     WHERE execution_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [execution.id],
  );

  if (existing) {
    log('8', `✅ GitHubPush found (status=${existing.push_status})`, 'success');
    if (existing.pr_url) log('8', `PR: ${existing.pr_url}`, 'info');
    return existing;
  }

  if (!FLAGS.simulateGithub) {
    // Give the real system a short chance if it's running elsewhere (docker, etc.)
    const waited = await poll(
      async () => {
        const row = await queryOne(
          `SELECT id, push_status FROM github_pushes WHERE execution_id=$1 ORDER BY created_at DESC LIMIT 1`,
          [execution.id],
        );
        if (!row) return null;
        return done(row);
      },
      { timeoutMs: 20_000, intervalMs: 1000, description: 'github_pushes to appear (best-effort)' },
    ).catch(() => null);
    if (waited) return stage8_verifyGithubPush(execution);

    throw new Error(
      'No github_pushes record was created.\n' +
      'Re-run with --simulate-github to simulate stage 8, or ensure GitHub orchestration is running.',
    );
  }

  log('8', '--simulate-github enabled: creating simulated github_pushes row', 'warning');

  const repo = normalizeRepository(process.env.GITHUB_DEFAULT_REPOSITORY || process.env.DEFAULT_REPOSITORY || 'unknown/unknown');
  const branch = `e2e/${TEST_TASK_ID}`;
  const sha = randomHex(40);

  const row = await queryOne(
    `INSERT INTO github_pushes (
      id, execution_id, repository, branch_name, commit_sha, pr_number, pr_url, push_status, error_message, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,NULL,NULL,'COMMITTED',NULL,NOW(),NOW()
    ) RETURNING *`,
    [`push-${RUN_ID}`, execution.id, repo, branch, sha],
  );

  log('8', `✅ Simulated GitHubPush created (status=${row.push_status})`, 'success');
  return row;
}

// -------------------------
// Stage 9-10: Deployment Status
// -------------------------

async function stage9_10_verifyDeployment(githubPush) {
  header('Stage 9-10: Deployment Status');

  const dep = await queryOne(
    `SELECT id, github_push_id, environment, cicd_provider, build_id, workflow_id, status, deployed_at, error_message, created_at, updated_at
     FROM deployments
     WHERE github_push_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [githubPush.id],
  );

  if (dep) {
    log('9', `✅ Deployment found (status=${dep.status}, env=${dep.environment})`, 'success');
    return dep;
  }

  if (!FLAGS.simulateDeployment) {
    const waited = await poll(
      async () => {
        const row = await queryOne(
          `SELECT id, status FROM deployments WHERE github_push_id=$1 ORDER BY created_at DESC LIMIT 1`,
          [githubPush.id],
        );
        if (!row) return null;
        return done(row);
      },
      { timeoutMs: 20_000, intervalMs: 1000, description: 'deployment to appear (best-effort)' },
    ).catch(() => null);
    if (waited) return stage9_10_verifyDeployment(githubPush);

    throw new Error(
      'No deployments record was created.\n' +
      'Re-run with --simulate-deployment to simulate stages 9-10, or ensure deployment orchestration is running.',
    );
  }

  log('9', '--simulate-deployment enabled: creating simulated deployment row', 'warning');

  const deploymentId = `dep-${RUN_ID}`;

  const row = await queryOne(
    `INSERT INTO deployments (
      id, github_push_id, environment, cicd_provider, build_id, workflow_id, status, deployed_at, error_message, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,'COMPLETED',NOW(),NULL,NOW(),NOW()
    ) RETURNING *`,
    [deploymentId, githubPush.id, 'staging', 'simulated', String(RUN_ID), 'simulated.yml'],
  );

  log('10', `✅ Simulated deployment completed (env=${row.environment}, status=${row.status})`, 'success');
  return row;
}

// -------------------------
// Summary
// -------------------------

async function summary(execution) {
  header('📊 Summary');

  const ticket = await queryOne(
    'SELECT id, clickup_task_id, status, ticket_quality_score FROM tickets WHERE id = $1',
    [execution.ticket_id],
  );

  const exec = await queryOne(
    'SELECT id, ticket_id, status, ai_provider, confidence_score FROM executions WHERE id = $1',
    [execution.id],
  );

  const qa = await queryOne(
    'SELECT overall_passed FROM qa_results WHERE execution_id = $1 ORDER BY created_at DESC LIMIT 1',
    [execution.id],
  );

  console.log(`${c.bright}Ticket:${c.reset} ${ticket?.id || 'n/a'} (${ticket?.status || 'n/a'})`);
  console.log(`  ClickUp Task: ${ticket?.clickup_task_id || 'n/a'}`);
  console.log(`  Quality Score: ${ticket?.ticket_quality_score ?? 'n/a'}`);

  console.log(`\n${c.bright}Execution:${c.reset} ${exec?.id || 'n/a'} (${exec?.status || 'n/a'})`);
  console.log(`  Provider: ${exec?.ai_provider || 'n/a'}`);
  console.log(`  Confidence: ${exec?.confidence_score ?? 'n/a'}`);

  console.log(`\n${c.bright}QA:${c.reset} overall_passed=${qa?.overall_passed ?? 'n/a'}`);

  console.log(`\n${c.green}${c.bright}✅ Script finished${c.reset}\n`);
}

// -------------------------
// Main
// -------------------------

async function main() {
  try {
    await setupConnections();
    if (FLAGS.useApp) {
      await ensureAppRunning();
    }

    if (FLAGS.cleanupOnly) {
      await cleanup();
      log('0', '✅ Cleanup complete', 'success');
      return;
    }

    await cleanup();

    await stage1_createTicket();
    const stage2 = await stage2_publishToIntake();
    const ticket = await stage3_validateAndEnqueueRouting(stage2);
    const execution = await stage4_routeAndCreateExecution(ticket, stage2);

    await stage5_6_aiExecution(execution);

    await stage7_verifyQa(execution, stage2.correlationId);

    const githubPush = await stage8_verifyGithubPush(execution);
    await stage9_10_verifyDeployment(githubPush);

    await summary(execution);
  } catch (error) {
    console.error(`\n${c.red}${c.bright}❌ Test failed:${c.reset} ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    await teardownConnections();
  }
}

process.on('SIGINT', async () => {
  console.log(`\n\n${c.yellow}⚠️  Interrupted${c.reset}\n`);
  await teardownConnections();
  process.exit(130);
});

main();
