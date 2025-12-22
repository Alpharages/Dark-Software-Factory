# Prometheus Metrics Verification - Story 11.4

## Metrics Configuration

### Audit Logging Metric

**Metric Name:** `audit_logs_total`  
**Type:** Counter  
**Purpose:** Track all AI decision logging events across the system

**Labels:**
- `agent_name`: Name of the service logging the decision (e.g., 'TicketIntakeService', 'AIExecutionConsumer')
- `action`: Type of decision being logged (e.g., 'quality_score_calculation', 'ai_provider_selection')

**Implementation Location:**
- Service: [`ai-decision-logger.service.ts:50`](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/audit/ai-decision-logger.service.ts#L50)

```typescript
this.metrics.incrementCounter('audit_logs_total', {
  agent_name: data.agentName,
  action: data.action,
});
```

---

## Metrics Integration Points

### 1. Ticket Intake Service
**Agent Name:** `TicketIntakeService`

**Actions Tracked:**
- `quality_score_calculation` - Every ticket quality assessment
- `ticket_acceptance` - Successful ticket validation
- `ticket_rejection` - Failed validation

**Expected Metrics:**
```
audit_logs_total{agent_name="TicketIntakeService",action="quality_score_calculation"} N
audit_logs_total{agent_name="TicketIntakeService",action="ticket_acceptance"} N
audit_logs_total{agent_name="TicketIntakeService",action="ticket_rejection"} N
```

### 2. AI Execution Consumer
**Agent Name:** `AIExecutionConsumer`

**Actions Tracked:**
- `ai_provider_selection` - Provider routing decisions
- `prompt_generation` - Prompt creation events
- `ai_execution_complete` - Successful executions
- `ai_execution_failed` - Failed executions

**Expected Metrics:**
```
audit_logs_total{agent_name="AIExecutionConsumer",action="ai_provider_selection"} N
audit_logs_total{agent_name="AIExecutionConsumer",action="prompt_generation"} N
audit_logs_total{agent_name="AIExecutionConsumer",action="ai_execution_complete"} N
audit_logs_total{agent_name="AIExecutionConsumer",action="ai_execution_failed"} N
```

### 3. QA Orchestrator Service
**Agent Name:** `QaOrchestrator`

**Actions Tracked:**
- `quality_gate_decision` - Pass/fail decisions for QA gates

**Expected Metrics:**
```
audit_logs_total{agent_name="QaOrchestrator",action="quality_gate_decision"} N
```

### 4. GitHub Commit Orchestrator
**Agent Name:** `GitHubCommitOrchestrator`

**Actions Tracked:**
- `commit_message_generation` - AI-generated commit messages

**Expected Metrics:**
```
audit_logs_total{agent_name="GitHubCommitOrchestrator",action="commit_message_generation"} N
```

---

## Verification Steps

### Manual Verification

To verify metrics are working:

1. **Start the application:**
   ```bash
   pnpm start:dev
   ```

2. **Access the metrics endpoint:**
   ```bash
   curl http://localhost:3000/metrics | grep audit_logs_total
   ```

3. **Expected Output Format:**
   ```prometheus
   # HELP audit_logs_total Total AI decision logs created
   # TYPE audit_logs_total counter
   audit_logs_total{agent_name="TicketIntakeService",action="quality_score_calculation"} 0
   audit_logs_total{agent_name="TicketIntakeService",action="ticket_acceptance"} 0
   audit_logs_total{agent_name="TicketIntakeService",action="ticket_rejection"} 0
   audit_logs_total{agent_name="AIExecutionConsumer",action="ai_provider_selection"} 0
   # ... etc
   ```

4. **Trigger a ticket flow** and watch counters increment:
   ```bash
   # Send a test ticket to ClickUp webhook
   # Then check metrics again
   curl http://localhost:3000/metrics | grep audit_logs_total
   ```

### Automated Verification

The metric configuration is tested in:
- [`ai-decision-logger.service.spec.ts`](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/audit/ai-decision-logger.service.spec.ts#L122)

Test verifies:
- Counter is called with correct metric name
- Labels include agent_name and action
- Metrics failures don't crash the service

---

## Metric Properties

### Counter Characteristics
- **Monotonic:** Only increases, never decreases
- **Reset:** Only on application restart
- **Persistence:** In-memory (not persisted across restarts)

### Labels Best Practices
- `agent_name`: Service-level identifier for source tracing
- `action`: Decision granularity for detailed analytics

### Query Examples

**Total audit logs across all services:**
```promql
sum(audit_logs_total)
```

**Logs by service:**
```promql
sum by (agent_name) (audit_logs_total)
```

**Logs by action type:**
```promql
sum by (action) (audit_logs_total)
```

**Rate of logging (per minute):**
```promql
rate(audit_logs_total[1m])
```

---

## Integration Status

✅ **Metric Defined:** `audit_logs_total`  
✅ **Service Integration:** AIDecisionLoggerService  
✅ **Module Import:** AppMetricsModule  
✅ **Error Handling:** Wrapped in try-catch  
✅ **Test Coverage:** Unit tests verify metric calls  

⏳ **Pending:** Live endpoint verification (requires running application)

---

## Troubleshooting

### Metric Not Appearing
1. Check application is running: `pnpm ps | grep nest`
2. Verify metrics endpoint accessible: `curl http://localhost:3000/metrics`
3. Check logs for metric registration errors

### Counter Not Incrementing
1. Verify audit logging calls are executing (check database `AIDecisionLog` table)
2. Check for errors in application logs
3. Verify MetricsService is properly injected

### Missing Labels
- Ensure both `agent_name` and `action` are passed to `incrementCounter`
- Check service implementations include labels in log calls

---

## Next Steps

1. **Deploy application** to dev/staging environment
2. **Access `/metrics` endpoint** to confirm metric registration
3. **Run ticket flow** to verify counters increment
4. **Set up Grafana dashboard** to visualize audit log metrics
5. **Configure Prometheus alerts** for low-confidence decisions (threshold-based)

---

## Related Documentation

- [AIDecisionLoggerService Implementation](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/audit/ai-decision-logger.service.ts)
- [Story 11.2 - AI Decision Logger](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/sprint-artifacts/11-2-ai-decision-logger.md)
- [Story 11.4 - Integration Walkthrough](file:///Users/khakanali/.gemini/antigravity/brain/50675ba2-fb46-4f16-92c1-e311e0c21255/walkthrough.md)
