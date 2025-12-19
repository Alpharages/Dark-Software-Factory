# Epic 11: v3 Foundation & Safety

**Epic Key:** DSF-11  
**Status:** Backlog  
**Priority:** High  
**Phase:** Phase 1 (Week 1-2)  
**Dependencies:** Epic 4 (GitHub Integration)  
**Blocks:** Epic 12, 13, 14, 15

## Epic Overview

Implement the foundational infrastructure for System Flow Diagram v3, including database schema changes, AI decision audit logging, and progress validation mechanisms to prevent infinite loops and provide full traceability.

## Business Value

- **Accountability:** Full audit trail of all AI decisions for debugging and compliance
- **Cost Efficiency:** Prevent wasted AI costs on unfixable issues via progress validation
- **Reliability:** Fast-fail to human review when AI gets stuck
- **Safety:** Core mechanisms that all v3 features depend on

## Success Metrics

- 100% of AI decisions logged with reasoning and confidence scores
- 50% reduction in "stuck" AI executions via progress validation
- Zero infinite loops in AI self-healing
- Full audit trail available for all tickets

## Technical Scope

### Database Changes

- 4 new Prisma models: `AIDecisionLog`, `FileLock`, `AICostLog`, `TicketDependency`, `WorkspaceArchive`
- Updates to `Execution` model for v3 fields
- Database migration scripts

### New Services

- `AIDecisionLoggerService` - Comprehensive audit logging
- `ProgressValidatorService` - Prevents infinite AI loops
- Foundation for all subsequent v3 features

## Stories

### 11.1: Database Schema & Migrations

**Effort:** 1 day  
**Story Points:** 3

Create Prisma schema for v3 models and run migrations.

**Acceptance Criteria:**

- AC#1: Prisma schema updated with 5 new models
- AC#2: Migration script created and tested
- AC#3: Database schema documentation updated
- AC#4: All foreign key relationships validated

**Tasks:**

- [ ] Update `prisma/schema.prisma` with new models
- [ ] Create migration: `pnpm prisma migrate dev --name add_v3_models`
- [ ] Generate Prisma client: `pnpm prisma generate`
- [ ] Verify migration in dev database
- [ ] Document schema changes in architecture.md

---

### 11.2: AI Decision Audit Logger

**Effort:** 2 days  
**Story Points:** 5

Implement comprehensive AI decision logging service.

**Acceptance Criteria:**

- AC#1: `AIDecisionLoggerService` created with CRUD operations
- AC#2: All AI decisions logged with: agent name, action, reasoning, confidence
- AC#3: Low-confidence decisions (<0.5) trigger alerts
- AC#4: Prometheus metrics for audit events
- AC#5: Unit tests >80% coverage

**Tasks:**

- [ ] Create `src/audit/ai-decision-logger.service.ts`
- [ ] Create `src/audit/ai-decision-logger.module.ts`
- [ ] Implement `logDecision()` method
- [ ] Implement `getDecisionTimeline()` for ticket history
- [ ] Implement `getLowConfidenceDecisions()` for review queue
- [ ] Add Prometheus metrics for audit logs
- [ ] Add Sentry integration for low-confidence alerts
- [ ] Write unit tests (target: >80% coverage)

---

### 11.3: AI Progress Validator Service

**Effort:** 2 days  
**Story Points:** 5

Prevent infinite loops in AI self-healing by tracking progress.

**Acceptance Criteria:**

- AC#1: `ProgressValidatorService` validates fix attempts
- AC#2: Escalates to human if errors not decreasing
- AC#3: Escalates to human if time limit exceeded (10 minutes)
- AC#4: Tracks metrics: error count before/after, total fix time
- AC#5: Integration with AI Execution Consumer
- AC#6: Unit tests >80% coverage

**Tasks:**

- [ ] Create `src/ai-monitoring/progress-validator.service.ts`
- [ ] Create `src/ai-monitoring/progress-validator.module.ts`
- [ ] Implement `validateProgress()` method
- [ ] Implement `trackFixAttempt()` for metrics
- [ ] Add Prometheus metrics for progress tracking
- [ ] Write unit tests with edge cases
- [ ] Document escalation logic in ADR

---

### 11.4: Integrate Audit Logging into Existing Services

**Effort:** 2 days  
**Story Points:** 5

Wire audit logging into ticket intake, AI execution, and QA processes.

**Acceptance Criteria:**

- AC#1: Ticket Intake Consumer logs validation decisions
- AC#2: AI Execution Consumer logs all AI invocations
- AC#3: QA Orchestrator logs quality decisions
- AC#4: GitHub services log commit/PR decisions
- AC#5: All logs include correlation IDs
- AC#6: E2E test verifies audit trail for full ticket flow

**Tasks:**

- [ ] Update `TicketIntakeConsumer` with audit logging
- [ ] Update `AIExecutionConsumer` with audit logging
- [ ] Update `QaOrchestrator` with audit logging
- [ ] Update GitHub services with audit logging
- [ ] Create E2E test for full audit trail
- [ ] Verify Prometheus metrics flowing correctly

---

### 11.5: Dashboard API for Audit Logs

**Effort:** 1 day  
**Story Points:** 3

Create REST API to query audit logs for dashboard.

**Acceptance Criteria:**

- AC#1: `GET /api/audit/timeline/:ticketId` returns decision history
- AC#2: `GET /api/audit/low-confidence` returns review queue
- AC#3: `GET /api/audit/search` supports filtering by agent/action/date
- AC#4: Responses paginated (50 items per page)
- AC#5: JWT authentication required
- AC#6: Swagger documentation complete

**Tasks:**

- [ ] Create `src/audit/audit.controller.ts`
- [ ] Implement timeline endpoint
- [ ] Implement low-confidence endpoint
- [ ] Implement search endpoint with filters
- [ ] Add pagination support
- [ ] Add JWT guards
- [ ] Write unit tests for controller
- [ ] Update Swagger docs

---

## Technical Debt

- Integration tests require end-to-end ticket processing (deferred to Epic 15)
- Performance optimization for large audit log queries (deferred)

## Definition of Done

- [ ] All 5 stories completed
- [ ] Database migration successful in staging
- [ ] All unit tests passing (>80% coverage)
- [ ] Prometheus metrics verified in Grafana
- [ ] Audit logs visible in dashboard
- [ ] Documentation updated (architecture.md, README)
- [ ] Code review completed
- [ ] Epic retrospective conducted

## References

- Implementation Plan: `/docs/implementation-plan-v3.md`
- System Flow Diagram: `/docs/system-flow-diagram-v3.md`
- Database Schema: `/prisma/schema.prisma`
