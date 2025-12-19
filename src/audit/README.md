# AI Decision Audit Logger

## Overview
This module implements the AI Decision Logger service (Story 11.2) for capturing complete audit trails of AI decisions.

## Components
- `AIDecisionLoggerService`: Core service for logging AI decisions
- `AIDecisionLoggerModule`: NestJS module configuration

## Features
- **Full Decision Logging**: Captures agent name, action, reasoning, confidence, input/output data
- **Low-Confidence Alerts**: Triggers Sentry alerts when confidence < threshold (default: 0.5)
- **Prometheus Metrics**: Tracks total audit logs and low-confidence decisions
- **Error Handling**: Graceful degradation if database/metrics/Sentry fail
- **Timeline Queries**: Get chronological decision history for any ticket

## Usage
```typescript
// Inject the service
constructor(private readonly auditLogger: AIDecisionLoggerService) {}

// Log an AI decision
await this.auditLogger.logDecision({
  agentName: 'CursorCLI',
  action: 'code_generation',
  reasoning: 'Generated REST API endpoint',
  ticketId: 'DSF-123',
  executionId: 'exec-456',
  inputData: { prompt: 'Create endpoint' },
  outputData: { filesModified: 2 },
  confidence: 0.85,
});

// Get decision timeline
const timeline = await this.auditLogger.getDecisionTimeline('DSF-123');

// Get low-confidence decisions for review
const risky = await this.auditLogger.getLowConfidenceDecisions(0.6);
```

## Configuration
Set `AI_CONFIDENCE_THRESHOLD` environment variable (default: 0.5)

## Dependencies
- `PrismaService`: Database operations
- `SentryService`: Error tracking & alerts
- `MetricsService`: Prometheus metrics

## Integration
Exported for use in Story 11.4 (Service Integration)
