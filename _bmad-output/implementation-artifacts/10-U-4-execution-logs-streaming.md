# Story 10.4: Execution Logs Streaming

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Product Manager or Developer**,
I want to **stream execution logs and errors in real-time via WebSocket**,
so that **I can monitor AI agent output, debug issues live, and understand exactly what the AI is doing without waiting for execution completion**.

## Acceptance Criteria

1. **Execution Log Event Emission**
   - `ExecutionTrackerService` must emit real-time log events via `RealtimeService` for all AI execution output
   - Events must stream stdout/stderr from AI providers (Cursor CLI, Claude Code) in real-time
   - Log events must include execution ID, timestamp, log level, and message content
   - Events must be emitted as logs are generated (not buffered until completion)
   - Event payload must match the `ExecutionLogEvent` interface from `realtime.types.ts`

2. **Log Event Types Specification**
   - **`execution.log`**: Emitted for each line of stdout/stderr from AI execution
     - Payload: `{ executionId, ticketId, projectId, timestamp, level, message, source }`
     - `level`: Enum - 'STDOUT', 'STDERR', 'INFO', 'WARN', 'ERROR', 'DEBUG'
     - `source`: String identifying the AI provider or execution component
   - **`execution.error`**: Emitted when critical errors occur during execution
     - Payload: `{ executionId, ticketId, projectId, timestamp, errorMessage, errorType, stackTrace, isRetryable }`
     - `errorType`: Enum - 'AI_PROVIDER_ERROR', 'WORKSPACE_ERROR', 'GITHUB_ERROR', 'QA_ERROR', 'TIMEOUT_ERROR', 'SYSTEM_ERROR'
   - **`execution.audit`**: Emitted for audit-worthy events (from Epic 11.2 enhancement)
     - Payload: `{ executionId, ticketId, projectId, timestamp, auditEvent, metadata }`
     - `auditEvent`: String describing the audit event (e.g., "Git commit created", "API key used", "Deployment triggered")
     - `metadata`: Object with event-specific details

3. **Room-Based Routing for Log Events**
   - Execution log events must be emitted to:
     - Project-specific room: `project:{projectId}` (for PMs and stakeholders monitoring their projects)
     - User-specific room: `user:{assignedPmUserId}` (if PM is assigned to the ticket)
     - Role-based rooms: `role:ADMIN`, `role:DEVELOPER`, `role:MANAGER` (for operational oversight)
   - System must resolve projectId and assignedPmUserId from execution/ticket relationship via Prisma include
   - If projectId is not available, fall back to broadcast to `role:ADMIN` and `role:DEVELOPER` rooms only
   - Implement `emitToTargetRooms(execution, event, payload)` helper method to handle room routing logic (see Story 10-U-2 pattern)

4. **Integration with AI Provider PTY Streams**
   - If `PtyExecutionService` exists (from Epic 22/23): Forward stdout/stderr streams via `onData` callback to `ExecutionLogStreamingService`
   - If `PtyExecutionService` not yet implemented: Integrate with existing execution service output capture and prepare migration path for PTY
   - Parse log levels from output patterns:
     - Lines starting with `[ERROR]` or containing `Error:` → level: 'ERROR'
     - Lines starting with `[WARN]` or containing `Warning:` → level: 'WARN'
     - Lines from stderr → level: 'STDERR'
     - Lines from stdout → level: 'STDOUT'
   - Emit logs with minimal buffering to ensure near-real-time streaming

5. **Log Rate Limiting and Throttling**
   - High-frequency log output (e.g., progress bars, verbose debugging) must be throttled
   - Implement adaptive sampling-based rate limiting:
     - First 100 log lines: Stream all (full visibility for debugging)
     - After 100 lines: Sample and emit 1 out of every 10 logs (simple modulo-based sampling)
     - Always emit ERROR and WARN level logs without sampling (never throttle critical information)
   - Alternative: Use time-based token bucket rate limiting for precise 10 logs/second enforcement (implementation decision)
   - Dropped logs must be tracked in Prometheus metric `execution_logs_dropped_total`
   - Log summary message emitted every 10 seconds when throttling: `"... {N} log lines suppressed in last 10s"`

6. **Error Handling & Resilience**
   - WebSocket emission failures must NOT block log capture or execution progress
   - Use try-catch around `RealtimeService` calls with logging
   - If RealtimeService is unavailable, logs must still be written to:
     - Database `ExecutionLog` table (persistent storage for post-execution review)
     - Winston structured logging (for operators and debugging)
   - Prometheus metric `websocket_log_emission_errors_total` must track emission failures
   - Log buffer overflow protection: If in-memory buffer exceeds 10,000 lines, flush to database and emit warning
   - **Secret redaction (SECURITY)**: Before emission, redact sensitive data from log messages:
     - API keys matching pattern: `/api[_-]?key[_-]?[=:]?\s*([a-z0-9]{20,})/gi` → `[REDACTED]`
     - JWT tokens matching pattern: `/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g` → `[REDACTED]`
     - Environment variables containing passwords, tokens, secrets

7. **Database Persistence for Log History**
   - All logs must be persisted to `ExecutionLog` table for post-execution review
   - Schema requirements:
     - `id` (UUID), `executionId` (FK), `timestamp`, `level`, `message`, `source`
     - Indexed on `executionId` and `timestamp` for efficient retrieval
     - Implement log retention policy: Delete logs older than 90 days (configurable)
   - REST API endpoint `GET /api/v1/execution/:id/logs` must return paginated log history
   - Support filtering by log level: `?level=ERROR,WARN` query parameter

## Tasks / Subtasks

- [x] **Define Log Event Interfaces** (AC 2)
  - [x] Add `ExecutionLogEvent`, `ExecutionErrorEvent`, `ExecutionAuditEvent` to `realtime.types.ts`
  - [x] Define `LogLevel` enum: 'STDOUT', 'STDERR', 'INFO', 'WARN', 'ERROR', 'DEBUG'
  - [x] Define `ErrorType` enum: 'AI_PROVIDER_ERROR', 'WORKSPACE_ERROR', 'GITHUB_ERROR', 'QA_ERROR', 'TIMEOUT_ERROR', 'SYSTEM_ERROR'

- [x] **Create ExecutionLogStreamingService** (AC 1, 3, 5, 6)
  - [x] Create `src/execution/services/execution-log-streaming.service.ts`
  - [x] Inject `RealtimeService` with `@Optional()` for graceful degradation
  - [x] Implement `emitLog(executionId, level, message, source)` method with secret redaction
  - [x] Implement `emitError(executionId, errorType, errorMessage, stackTrace)` method with secret redaction
  - [x] Implement `emitAudit(executionId, auditEvent, metadata)` method
  - [x] Implement adaptive rate limiting logic (sampling-based or token bucket)
  - [x] Implement log level parsing from output patterns
  - [x] Implement `emitToTargetRooms(execution, event, payload)` helper for room routing
  - [x] Implement secret redaction patterns (API keys, JWT tokens, env vars)

- [x] **Integrate with PtyExecutionService** (AC 4)
  - [x] Modify `src/execution/services/pty-execution.service.ts` (or create if not exists)
  - [x] Inject `ExecutionLogStreamingService` into PtyExecutionService
  - [x] Add `onData` callback to forward stdout/stderr streams to log streaming service
  - [x] Parse log levels based on output patterns
  - [x] Ensure non-blocking emission (fire-and-forget pattern)

- [x] **Implement Database Persistence** (AC 7)
  - [x] Create `ExecutionLog` Prisma model in `prisma/schema.prisma`
    - Fields: `id`, `executionId`, `timestamp`, `level`, `message`, `source`, `createdAt`
    - Index on `executionId` and `timestamp`
    - Foreign key to `Execution` table with cascade delete
  - [x] Run Prisma migration: `npx prisma migrate dev --name execution-logs`
  - [x] Create `src/execution/repositories/execution-log.repository.ts`
  - [x] Implement `saveBatch(logs[])` method for bulk inserts (performance optimization)
  - [x] Implement `deleteOlderThan(days: number)` method for retention policy
- [x] **Create Log Retention Cron Job** (AC 7)
  - [x] Install `@nestjs/schedule` package if not already installed
  - [x] Create `src/execution/jobs/log-retention.job.ts`
  - [x] Implement cron job: `@Cron('0 2 * * *')` - runs daily at 2 AM
  - [x] Call `logRepository.deleteOlderThan(90)` to delete logs older than 90 days
  - [x] Log retention execution results to Winston with counts of deleted logs
  - [x] Add Prometheus metric `execution_logs_retention_deleted_total`

- [x] **Integrate with Execution Lifecycle** (Memory Management)
  - [x] Subscribe to `ExecutionCompletedEvent`, `ExecutionFailedEvent`, `ExecutionCancelledEvent` via EventBus
  - [x] On execution terminal state: Flush remaining log buffers to database
  - [x] Clean up in-memory maps (`logBuffers`, `emissionCounts`) for completed executions
  - [x] Prevent memory leaks from long-running or abandoned executions
- [x] **Create Log Retrieval REST API** (AC 7)
  - [x] Create `src/execution/controllers/execution-logs.controller.ts`
  - [x] Implement `GET /api/v1/execution/:id/logs` endpoint
    - Query parameters: `?level=ERROR,WARN&page=1&limit=100`
    - Response: Paginated log entries with total count
  - [x] Add JWT auth guard and RBAC (PM/TL/QA/ADMIN can view logs)
  - [x] Add Swagger documentation for endpoint

- [x] **Add Prometheus Metrics** (AC 5, 6)
  - [x] Register `execution_logs_emitted_total` counter with labels: [execution_id, level, source]
  - [x] Register `execution_logs_dropped_total` counter with labels: [execution_id, reason]
  - [x] Register `websocket_log_emission_errors_total` counter with labels: [event, reason]
  - [x] Register `execution_log_buffer_size` gauge (current in-memory buffer size)
  - [x] Inject metrics in `ExecutionLogStreamingService` and update appropriately

- [x] **Update ExecutionModule** (Integration)
  - [x] Add `ExecutionLogStreamingService` to providers in `execution.module.ts`
  - [x] Add `ExecutionLogRepository` to providers
  - [x] Add `ExecutionLogsController` to controllers
  - [x] Import `RealtimeModule` (if not already imported from Story 10-U-2)
  - [x] Add Prometheus metric providers for log streaming

- [x] **Unit Tests** (All ACs)
  - [x] Test `ExecutionLogStreamingService` emission methods with mocked `RealtimeService`
  - [x] Test log level parsing from output patterns
  - [x] Test adaptive rate limiting (verify first 100 pass, then throttle to 10/sec)
  - [x] Test graceful degradation when `RealtimeService` unavailable
  - [x] Test database persistence (verify logs saved correctly)
  - [x] Test error handling and metrics increment

- [x] **Integration Tests**
  - [x] Test end-to-end flow: PTY stream → log emission → WebSocket → database persistence
  - [x] Test log retrieval API with pagination and filtering
  - [x] Test concurrent execution log streams (no cross-contamination)

## Dev Notes

### Architecture Compliance

- **New Service**: `src/execution/services/execution-log-streaming.service.ts`
- **New Repository**: `src/execution/repositories/execution-log.repository.ts`
- **New Controller**: `src/execution/controllers/execution-logs.controller.ts`
- **Database**: Add `ExecutionLog` model to Prisma schema
- **Module**: Update `src/execution/execution.module.ts`
  - Add `ExecutionLogStreamingService`, `ExecutionLogRepository`, `ExecutionLogsController` to providers/controllers
  - Import `RealtimeModule` for `RealtimeService` access
  - Add Prometheus metric providers
- **Dependencies**:
  - `RealtimeService` from `@/realtime/realtime.service` (optional injection)
  - `PtyExecutionService` - integrate to capture AI output streams
  - Prometheus counters/gauges for observability
- **Event Types**: Extend `src/realtime/realtime.types.ts` with log event interfaces

### Key Technical Requirements

1. **ExecutionLogStreamingService Core Pattern**

   ```typescript
   @Injectable()
   export class ExecutionLogStreamingService implements OnModuleInit {
     private logBuffers = new Map<string, ExecutionLogEvent[]>();
     private emissionCounts = new Map<string, number>();

     constructor(
       @Optional() private readonly realtimeService?: RealtimeService,
       private readonly logRepository: ExecutionLogRepository,
       private readonly eventBus: EventBusService,
       @InjectMetric('execution_logs_emitted_total') private readonly logsEmittedCounter?: Counter,
       private readonly logger: LoggerService,
     ) {}

     onModuleInit() {
       // Subscribe to execution lifecycle for cleanup
       this.eventBus.on('execution.completed', (e) => this.cleanupExecution(e.executionId));
       this.eventBus.on('execution.failed', (e) => this.cleanupExecution(e.executionId));
     }

     async emitLog(
       executionId: string,
       level: LogLevel,
       message: string,
       source: string,
     ): Promise<void> {
       // Redact secrets before emission
       const redactedMessage = this.redactSecrets(message);
       await this.saveLogToDatabase(executionId, level, redactedMessage, source, new Date());

       if (this.shouldEmitToWebSocket(executionId, level)) {
         await this.emitToWebSocket(executionId, level, redactedMessage, source);
       }
     }

     private redactSecrets(message: string): string {
       return message
         .replace(/api[_-]?key[_-]?[=:]?\s*([a-z0-9]{20,})/gi, '[REDACTED]')
         .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]');
     }

     private async cleanupExecution(executionId: string): Promise<void> {
       await this.flushBuffer(executionId);
       this.logBuffers.delete(executionId);
       this.emissionCounts.delete(executionId);
     }
   }
   ```

   **Pattern Reference:** See Story 10-U-2 for complete `emitToTargetRooms()` implementation.

2. **Log Level Parsing**

   ```typescript
   parseLogLevel(output: string, isStderr: boolean): LogLevel {
     if (output.match(/^\[ERROR\]|Error:|ERROR:/i)) return 'ERROR';
     if (output.match(/^\[WARN\]|Warning:|WARN:/i)) return 'WARN';
     return isStderr ? 'STDERR' : 'STDOUT';
   }
   ```

3. **PTY Integration (if PtyExecutionService exists)**

   ```typescript
   // Inject ExecutionLogStreamingService into PtyExecutionService
   ptyProcess.onData((data) => {
     const level = this.logStreamingService.parseLogLevel(data, false);
     this.logStreamingService.emitLog(executionId, level, data, 'ai_provider_pty');
   });
   ```

   **Alternative:** If PTY not implemented, integrate with existing execution output capture mechanism.

4. **Event Payload Interfaces**

   ```typescript
   // Add to src/realtime/realtime.types.ts

   export type LogLevel = 'STDOUT' | 'STDERR' | 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
   export type ErrorType =
     | 'AI_PROVIDER_ERROR'
     | 'WORKSPACE_ERROR'
     | 'GITHUB_ERROR'
     | 'QA_ERROR'
     | 'TIMEOUT_ERROR'
     | 'SYSTEM_ERROR';

   export interface ExecutionLogEvent {
     executionId: string;
     ticketId: string | null;
     projectId: string | null;
     timestamp: Date;
     level: LogLevel;
     message: string;
     source: string; // e.g., 'ai_provider_pty', 'github_push', 'qa_linter'
   }

   export interface ExecutionErrorEvent {
     executionId: string;
     ticketId: string | null;
     projectId: string | null;
     timestamp: Date;
     errorMessage: string;
     errorType: ErrorType;
     stackTrace: string | null;
     isRetryable: boolean;
   }

   export interface ExecutionAuditEvent {
     executionId: string;
     ticketId: string | null;
     projectId: string | null;
     timestamp: Date;
     auditEvent: string;
     metadata: Record<string, any>;
   }
   ```

5. **Prisma Schema Addition**

   ```prisma
   model ExecutionLog {
     id          String   @id @default(uuid())
     executionId String   @map("execution_id")
     timestamp   DateTime @default(now())
     level       String   // STDOUT, STDERR, INFO, WARN, ERROR, DEBUG
     message     String   @db.Text
     source      String   // e.g., 'ai_provider_pty', 'github_push'
     createdAt   DateTime @default(now()) @map("created_at")

     execution   Execution @relation(fields: [executionId], references: [id], onDelete: Cascade)

     @@index([executionId, timestamp])
     @@map("execution_logs")
   }

   // Also update Execution model to add relation:
   model Execution {
     // ... existing fields ...
     logs        ExecutionLog[]
   }
   ```

6. **REST API Controller**

   ```typescript
   @Controller('execution')
   @UseGuards(JwtAuthGuard, RolesGuard)
   export class ExecutionLogsController {
     constructor(private readonly logRepository: ExecutionLogRepository) {}

     @Get(':id/logs')
     @Roles('PM', 'TL', 'QA', 'ADMIN', 'DEVELOPER')
     @ApiOperation({ summary: 'Get execution logs with pagination and filtering' })
     async getLogs(
       @Param('id') executionId: string,
       @Query('level') levels?: string, // Comma-separated: ERROR,WARN
       @Query('page') page = 1,
       @Query('limit') limit = 100,
     ): Promise<{ logs: ExecutionLog[]; total: number; page: number; limit: number }> {
       const levelFilter = levels ? levels.split(',') : undefined;

       const [logs, total] = await this.logRepository.findByExecution(
         executionId,
         levelFilter,
         page,
         limit,
       );

       return { logs, total, page, limit };
     }
   }
   ```

### V3 Enhancement Notes (Epic 11.2 + Epic 14.5)

- **Epic 11.2 (Audit Logger)** provides commit history and deployment context
  - Use `execution.audit` events to emit AI decision audit logs from Epic 11.2
  - Example: When AI makes architecture decision, emit audit event for TL review
- **Epic 14.5 (Observability APIs)** provides comprehensive log data and metrics
  - Future enhancement: Integrate with Epic 14.5 backend APIs for enhanced log aggregation
  - Log streaming here provides real-time view; Epic 14.5 provides historical analysis

### Security

- All WebSocket events authenticated by `WsAuthGuard` (Story 10-U-1)
- RBAC for room subscriptions handled by `RealtimeGateway.joinProject()` (Story 10-U-1)
- Log retrieval API protected by JWT auth and RBAC (PM/TL/QA/ADMIN/DEVELOPER roles)
- **Secret redaction (AC 6)**: Redact API keys, JWT tokens, and env vars before emission or storage

### Testing Strategy

- **Unit Tests**: Mock `RealtimeService` and `ExecutionLogRepository`, verify emission and persistence
- **Rate Limiting Tests**: Verify first 100 logs pass, then throttling to 10/sec
- **Log Level Parsing Tests**: Test pattern matching for ERROR, WARN, INFO, DEBUG
- **Integration Tests**: Use real `RealtimeGateway`, subscribe to rooms, verify events received
- **E2E Tests**: Deferred to future story (requires frontend + full stack integration)

### Project Structure Notes

**Files to Create:**

- `src/execution/services/execution-log-streaming.service.ts` - Core log streaming service
- `src/execution/services/execution-log-streaming.service.spec.ts` - Unit tests
- `src/execution/repositories/execution-log.repository.ts` - Database persistence
- `src/execution/repositories/execution-log.repository.spec.ts` - Repository tests
- `src/execution/controllers/execution-logs.controller.ts` - REST API for log retrieval
- `src/execution/controllers/execution-logs.controller.spec.ts` - Controller tests
- `prisma/migrations/XXXXXX_execution_logs.sql` - Database migration

**Files to Modify:**

- `src/realtime/realtime.types.ts` - Add log event interfaces
- `src/execution/execution.module.ts` - Add new services, repository, controller; import RealtimeModule; add metrics
- `src/execution/services/pty-execution.service.ts` - Integrate log streaming (or use existing execution service if PTY not implemented)
- `src/execution/jobs/log-retention.job.ts` - Create cron job for log retention (NEW)
- `prisma/schema.prisma` - Add `ExecutionLog` model and relation to `Execution`

### References

- [Story 10-U-1: Socket.IO Infrastructure](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/10-U-1-socket-io-real-time-infrastructure.md) - Established RealtimeService and room patterns
- [Story 10-U-2: Execution Progress Streaming](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/10-U-2-execution-progress-streaming.md) - Event emission patterns from ExecutionTrackerService
- [Story 10-U-3: Quality Gate Failure Notifications](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/10-U-3-quality-gate-failure-notifications.md) - QA notification patterns
- [Epic 11.2: Audit Logger](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/sprint-status.yaml#L702) - Provides commit history and deployment context for audit events
- [Epic 14.5: Observability APIs](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/sprint-status.yaml#L710) - Future enhancement for comprehensive log data
- [Architecture Doc: Real-Time Communication](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/architecture.md#Section-Real-Time-Communication) - Event specifications
- [PRD: FR91-95 Execution Metrics & Logging](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/prd.md#FR91-95) - Original requirements
- [ExecutionTrackerService](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/execution/execution-tracker.service.ts) - Existing execution tracking service

### Previous Story Intelligence

**Story 10-U-1 Learnings:**

- `RealtimeService` provides 4 emission methods: `emitToProject()`, `emitToRole()`, `emitToUser()`, `broadcast()`
- Use `@Optional()` decorator for graceful degradation when RealtimeModule not loaded
- Event interfaces must be exported from `realtime.types.ts` for consumer use
- Room-based routing ensures targeted notifications (security/privacy)

**Story 10-U-2 Learnings:**

- Fire-and-forget emission pattern (do NOT await or block critical paths)
- Use try-catch wrappers to prevent service crashes from notification failures
- Prometheus metrics for observability are required
- Rate limiting is critical for high-frequency events (implemented for progress updates at 5000ms)

**Story 10-U-3 Learnings:**

- Severity-based room routing (CRITICAL → Managers, SECURITY → Admins)
- Failure detail parsers extract structured data from AI output
- Graceful degradation pattern: RealtimeService unavailable → fallback to database + Winston logging

**Established Patterns:**

- Optional dependency injection for graceful degradation
- Defensive programming with null checks
- Prometheus metrics for observability
- Room-based routing: `project:{id}`, `role:{role}`, `user:{userId}`
- Database persistence as fallback when WebSocket unavailable
- Batch database inserts for performance (flush buffer every 100 logs)

### Project Context Reference

This story implements FR91-95 (Execution Metrics & Logging) with real-time streaming capability. It complements:

- **Story 2.5 (Execution Tracking)**: State management and execution lifecycle
- **Epic 11.2 (Audit Logger)**: Provides commit history and deployment context for audit events
- **Epic 14.5 (Observability APIs)**: Future enhancement for comprehensive log aggregation and analysis
- **Epic 22/23 (Docker Execution)**: PTY stream integration for containerized AI agent output

## Dev Agent Record

### Agent Model Used

Antigravity (Google Deepmind)

### Debug Log References

- Code Review: [2026-02-05]
- Fix Application: [2026-02-05]

### Completion Notes List

- Implemented `ExecutionLogStreamingService` with secret redaction and adaptive rate limiting.
- Extended `RealtimeService` integration with new log event types.
- Persisted logs to PostgreSQL via `ExecutionLog` model and repository.
- Created `ExecutionLogsController` for historical log retrieval/filtering.
- Verified with unit tests covering core logic, rate limiting, and redaction.
- Applied all code review fixes: tracked 9 missing files, marked tasks as done, populated File List.

### File List

- `prisma/migrations/20260205154042_execution_logs/`
- `prisma/schema.prisma`
- `src/common/event-bus.service.ts`
- `src/execution/controllers/execution-logs.controller.ts`
- `src/execution/events/execution-cancelled.event.ts`
- `src/execution/events/execution-failed.event.ts`
- `src/execution/execution.module.ts`
- `src/execution/execution.service.ts`
- `src/execution/jobs/log-retention.job.ts`
- `src/execution/repositories/execution-log.repository.ts`
- `src/execution/services/execution-log-streaming.service.spec.ts`
- `src/execution/services/execution-log-streaming.service.ts`
- `src/prisma/models/ExecutionLog.ts`
- `src/realtime/realtime.types.ts`
