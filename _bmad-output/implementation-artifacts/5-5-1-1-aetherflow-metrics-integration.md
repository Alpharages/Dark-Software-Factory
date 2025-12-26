# Story 5.5.1.1: AetherFlow Metrics Integration

**Status:** ✅ Done  
**Parent Story:** 5.5.1 (AetherFlow ClickUp Integration)  
**Epic:** 5 - PM Dashboard & Intelligence  
**Priority:** Low  
**Effort:** 0.5 days  
**Story Points:** 2

**Dependencies:**
- Story 5.5.1 (AetherFlow ClickUp Integration) - **DONE**

---

## Story

**As a PM/Manager,**  
I want to monitor AetherFlow API health and ticket creation success rates,  
So that I can identify integration issues before they impact user workflows.

---

## Context

**Story 5-5-1** implemented the core AetherFlow ClickUp integration but deferred **AC#5 (Metrics tracking)** to keep the MVP focused on functionality. The current implementation only uses the existing `incrementTicketsCreatedFromConversations()` metric from Story 5.5, which doesn't provide AetherFlow-specific observability.

This follow-up story implements the 4 metrics originally specified in Story 5-5-1 AC#5:
1. `aetherflow_api_calls_total` - Track API invocations by endpoint and status
2. `aetherflow_api_duration_seconds` - Monitor API response times
3. `conversation_tickets_created_total` - Count successful ticket creations
4. `conversation_ticket_creation_failures_total` - Track failures by reason

---

## Acceptance Criteria

- [x] **AC#1:** Prometheus metrics implemented in `MetricsService`
  - `incrementAetherFlowApiCall(endpoint: string, status: string): void`
  - `recordAetherFlowApiDuration(endpoint: string, duration: number): void`
  - `incrementConversationTicketCreationSuccess(count: number): void`
  - `incrementConversationTicketCreationFailure(reason: string): void`

- [x] **AC#2:** Metrics integrated into `AetherFlowClientService`
  - Record API call count and status for each request
  - Record response duration using histogram
  - Track retry attempts separately

- [x] **AC#3:** Metrics integrated into `ConversationsService`
  - Increment success counter when tickets created
  - Increment failure counter with reason classification

- [x] **AC#4:** Metric providers registered in `AppMetricsModule`
  - All 4 metric providers added to module
  - Metrics exposed on `/metrics` endpoint

- [x] **AC#5:** Unit tests for metrics integration
  - Test metric incrementation in AetherFlowClientService (Success, Error, Retry)
  - Test metric incrementation in ConversationsService
  - Verify metrics exposed via Prometheus endpoint

### Metric Refactoring
- [x] Replace generic `incrementTicketsCreatedFromConversations()` with:
  - `incrementConversationTicketCreationSuccess(result.tasks.length)` on success
  - `incrementConversationTicketCreationFailure(reason)` on failure
- [x] Classify failure reasons:
  - `aetherflow_unavailable`
  - `clickup_authentication_failed`
  - `invalid_list_name`
  - `unknown`

### Module Registration
- [x] Update `AppMetricsModule` or `BusinessCollector`:
  - Register 4 new metric providers
  - Verify metrics appear in `/metrics` endpoint output

### Testing
- [x] Unit tests for `MetricsService` methods (4 tests)
- [x] Unit tests for `AetherFlowClientService` metrics (3 tests: success, failure, retry)
- [x] Unit tests for `ConversationsService` metrics (2 tests: success, failure)
- [x] Integration test: Verify metrics exposed on `/metrics` endpoint

### Documentation
- [x] Update Story 5-5-1 to mark AC#5 as complete with reference to this story
- [x] Document metrics in `docs/observability.md` (if exists)
- [x] Add metrics to Grafana dashboard queries (if applicable)

---

## Technical Notes

### Metric Definitions

```typescript
// Counter: Total API calls
aetherflow_api_calls_total{endpoint="/api/integrations/clickup/create-tasks", status="success"}
aetherflow_api_calls_total{endpoint="/api/integrations/clickup/create-tasks", status="error"}
aetherflow_api_calls_total{endpoint="/api/integrations/clickup/create-tasks", status="retry"}

// Histogram: API response time (seconds)
aetherflow_api_duration_seconds{endpoint="/api/integrations/clickup/create-tasks"}

// Counter: Successful ticket creations (increment by count)
conversation_tickets_created_total

// Counter: Failed ticket creations by reason
conversation_ticket_creation_failures_total{reason="aetherflow_unavailable"}
conversation_ticket_creation_failures_total{reason="clickup_authentication_failed"}
conversation_ticket_creation_failures_total{reason="invalid_list_name"}
conversation_ticket_creation_failures_total{reason="unknown"}
```

### Implementation Example

```typescript
// In AetherFlowClientService.createTasks()
const startTime = Date.now();
this.metrics.incrementAetherFlowApiCall('/api/integrations/clickup/create-tasks', 'pending');

try {
  const result = await this.executeWithRetry(...);
  const duration = (Date.now() - startTime) / 1000;
  
  this.metrics.recordAetherFlowApiDuration('/api/integrations/clickup/create-tasks', duration);
  this.metrics.incrementAetherFlowApiCall('/api/integrations/clickup/create-tasks', 'success');
  
  return result;
} catch (error) {
  const duration = (Date.now() - startTime) / 1000;
  this.metrics.recordAetherFlowApiDuration('/api/integrations/clickup/create-tasks', duration);
  this.metrics.incrementAetherFlowApiCall('/api/integrations/clickup/create-tasks', 'error');
  throw error;
}
```

---

## Files to Modify

- `src/common/metrics/metrics.service.ts` - Add 4 new methods
- `src/common/metrics/collectors/business.collector.ts` - Register metric providers
- `src/integrations/aetherflow/aetherflow-client.service.ts` - Add metrics tracking
- `src/conversations/conversations.service.ts` - Replace generic metrics with specific ones
- `src/common/metrics/app-metrics.module.ts` - Verify provider registration

**Estimated Files:** 5 modified, 0 new

---

## Definition of Done

- [ ] All 4 metrics implemented in `MetricsService`
- [ ] Metrics integrated into `AetherFlowClientService` (API calls tracked)
- [ ] Metrics integrated into `ConversationsService` (success/failure tracked)
- [ ] Metric providers registered in `AppMetricsModule`
- [ ] Unit tests written and passing (9+ tests)
- [ ] Build passes (`pnpm build`)
- [ ] Metrics visible on `/metrics` endpoint
- [ ] Story 5-5-1 updated to mark AC#5 complete
- [ ] Code review completed

---

## Non-Functional Requirements

- **Performance (NFR-P4):** Metric recording must complete <5ms (async if needed)
- **Observability:** All metrics must be Prometheus-compatible
- **Consistency:** Use existing metric naming conventions from Story 1.8

---

## Future Enhancements (Out of Scope)

- Grafana dashboard with AetherFlow health panels
- Alerting rules for high failure rates (>10%)
- SLO tracking for AetherFlow API uptime
