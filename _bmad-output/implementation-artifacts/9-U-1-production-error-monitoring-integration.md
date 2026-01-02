# Story 9.1: Production Error Monitoring Integration

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the system,
I want to integrate with production monitoring tools,
so that I can detect errors and anomalies in deployed applications.

## Acceptance Criteria

1. **Given** applications are deployed to production, **When** errors occur, **Then** the system receives error events from monitoring tools (Sentry, Datadog, CloudWatch, etc.).
2. Captures error details: type, message, stack trace, timestamp, application/service name, environment (staging, production).
3. Links error to originating ticket/execution by extracting `x-correlation-id` from headers or metadata (e.g., Sentry tags, Datadog tracing context).
4. Stores in `production_errors` table in the database.
5. Error ingestion supports multiple sources via webhooks (Sentry: `/api/v1/monitoring/sentry-webhook`, custom: `/api/v1/monitoring/errors`).
6. Tracks user impact (affected users count) and occurrence count for frequency analysis.

## Tasks / Subtasks

- [ ] Create `ProductionMonitoringModule` and `ProductionMonitoringController` <!-- id: 0 -->
  - [ ] Implement Sentry webhook endpoint (`/api/v1/monitoring/sentry-webhook`) <!-- id: 1 -->
  - [ ] Implement custom error ingestion endpoint (`/api/v1/monitoring/errors`) <!-- id: 2 -->
- [ ] Implement `ProductionMonitoringService` <!-- id: 3 -->
  - [ ] Parse error payloads and extract stack traces using `stack-trace-parser` <!-- id: 4 -->
  - [ ] Implement correlation ID extraction logic for Sentry and Datadog payloads <!-- id: 5 -->
  - [ ] Logic to link errors to executions/tickets in the database <!-- id: 6 -->
  - [ ] Persist errors to `production_errors` table using Prisma <!-- id: 7 -->
- [ ] Integrate with `MetricsService` and `SentryService` <!-- id: 7 -->
  - [ ] Record Prometheus metrics for ingested errors <!-- id: 8 -->
  - [ ] Trigger Sentry alerts for critical ingestion failures <!-- id: 9 -->
- [ ] Add unit and E2E tests for monitoring endpoints <!-- id: 10 -->

## Dev Notes

- **V3 Enhancement:** Use `Epic 14.4` (Post-deployment health monitoring) as a guide for data contracts.
- **Architecture Pattern:** Follow the same webhook pattern used in `Epic 2.1` (ClickUp webhooks).
- **Library:** Use `stack-trace-parser` for consistent stack trace analysis as per `docs/epics.md`.
- **Security:** Ensure webhook secrets are validated for all external monitoring tools.
- **Deduplication:** Check for existing errors of the same type/service within a time window to prevent ticket flood.

### Project Structure Notes

- New module `src/modules/production-monitoring/` should be created (aligns with `architecture.md`).
- Align with `src/modules/ticket-intake/` for parsing patterns.

### References

- [Epic 9: Self-Healing & Production Monitoring](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/epics.md#L3592-L3647)
- [V3 Epic Impact Analysis](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/v3-epic-impact-analysis.md)
- [ADR-004: Security Architecture](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/architecture.md)

## Dev Agent Record

### Agent Model Used

Antigravity v1.0

### Debug Log References

### Completion Notes List

- Ultimate context engine analysis completed - comprehensive developer guide created.

### File List
