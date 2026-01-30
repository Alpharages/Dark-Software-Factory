# Story 20.2: Stale Execution Recovery

**Epic**: 20 - Provider-Agnostic AI Task Intake  
**Status**: ready-for-dev  
**Priority**: High  
**Complexity**: Medium

## User Story

As a **system administrator**,  
I want **the system to automatically recover from stuck AI executions after server restarts**,  
So that **tasks don't get permanently blocked due to crashes or restarts**.

## Problem Statement

With Story 20-1's idempotency check, tasks with `QUEUED` or `IN_PROGRESS` executions are skipped to prevent duplicate processing. However, if the server crashes or restarts while an execution is active, that execution remains stuck in the database, and the idempotency check will forever block the task from being retried.

**Current Gap**: No mechanism to detect and recover stale executions after restarts.

## Acceptance Criteria

- **AC#1**: Stale executions (> 30 min old in `QUEUED` or `IN_PROGRESS`) are detected on server startup
- **AC#2**: Stale executions are marked as `FAILED` with appropriate error message
- **AC#3**: Tasks with recovered executions are automatically republished to `ticket-intake-queue`
- **AC#4**: Recovery runs both on startup and as a periodic background job (every 15 minutes)
- **AC#5**: Recovery process is logged with metrics for monitoring
- **AC#6**: Configurable stale threshold via environment variable

## Tasks

- [ ] Create ExecutionRecoveryService
  - [ ] Implement `detectStaleExecutions()` method
  - [ ] Implement `recoverExecution()` to mark as FAILED and republish
  - [ ] Add configurable stale threshold (default 30 min)
  - [ ] Add metrics tracking for recovery operations
- [ ] Implement Startup Recovery
  - [ ] Add `onModuleInit()` hook to run recovery on startup
  - [ ] Log recovery summary (e.g., "Recovered 3 stale executions")
- [ ] Implement Periodic Recovery
  - [ ] Use `@Cron()` decorator for scheduled job (every 15 min)
  - [ ] Add configurable cron schedule via config
- [ ] Add Republish Logic
  - [ ] Fetch original task/ticket data
  - [ ] Recreate `ITaskEvent` from database record
  - [ ] Publish to `ticket-intake-queue` with new correlation ID
- [ ] Testing
  - [ ] Unit tests for stale detection logic
  - [ ] Unit tests for recovery process
  - [ ] Integration test simulating stuck execution + recovery
- [ ] Documentation
  - [ ] Update README with recovery mechanism docs
  - [ ] Add environment variable documentation

## Technical Notes

### Architecture

```
Server Startup/Cron Job
  ↓
ExecutionRecoveryService.detectStaleExecutions()
  ↓ Query DB for old QUEUED/IN_PROGRESS
Database (Prisma)
  ↓ Stale executions found
ExecutionRecoveryService.recoverExecution()
  ├─ Update execution.status = FAILED
  ├─ Recreate ITaskEvent from ticket record
  └─ Publish to ticket-intake-queue
```

### Relevant Files

- **New**: `src/execution/execution-recovery.service.ts`
- **New**: `src/execution/execution-recovery.service.spec.ts`
- **Update**: `src/execution/execution.module.ts` (register service)
- **Reference**: `src/ticket-intake/ticket-intake.service.ts` (idempotency check)

### Environment Variables

```env
# Add to .env
EXECUTION_STALE_THRESHOLD_MINUTES=30  # Default: 30
EXECUTION_RECOVERY_CRON=*/15 * * * *  # Default: every 15 min
```

### Example Recovery Query

```typescript
const staleThreshold = configService.get('EXECUTION_STALE_THRESHOLD_MINUTES', 30);
const cutoffTime = new Date(Date.now() - staleThreshold * 60 * 1000);

const staleExecutions = await prisma.execution.findMany({
  where: {
    status: { in: [ExecutionStatus.QUEUED, ExecutionStatus.IN_PROGRESS] },
    updated_at: { lt: cutoffTime },
  },
  include: { ticket: true },
});
```

## Dev Notes

1. **Idempotency**: Recovery must not interfere with legitimate in-progress executions (use timestamp threshold)
2. **Republishing**: New correlation ID needed to avoid deduplication issues
3. **Metrics**: Track `execution_recovery_total{status=recovered|skipped}`
4. **Error Handling**: If republish fails, log but don't crash recovery process
5. **Testing Strategy**: Mock Prisma + RabbitMQ, simulate various stale scenarios

## Related Stories

- **20-1**: Provider-Agnostic AI Intake (implements idempotency that needs recovery)
- **Future**: Add alert/notification when too many stale executions detected

## Definition of Done

- [ ] All tasks completed
- [ ] Unit tests passing (> 80% coverage)
- [ ] Integration test verifies recovery works
- [ ] Metrics dashboard shows recovery events
- [ ] Code review approved
- [ ] Documentation updated
