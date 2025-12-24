# Story 13.1: AI Cost Tracking Service

Status: done

## Story

As a Project Lead,
I want to track the financial cost of every AI invocation,
so that I can manage our AI budget effectively and prevent cost explosions.

## Acceptance Criteria

1.  **Centralized Cost Logging**: Every AI call must be logged in the `AICostLog` table via a centralized hook in `AIProvider` or `AIExecutionService`. Manual logging in every service is prohibited to prevent coverage gaps.
2.  **Model Pricing (Current 2024 Rates)**: Implement the following rates (per 1M tokens):
    - **GPT-4o**: $5.00 input / $15.00 output
    - **Claude 3.5 Sonnet**: $3.00 input / $15.00 output
    - **GPT-4o-mini / GPT-3.5-turbo**: $0.15 input / $0.60 output
3.  **Metrics Integration**: Record costs in Prometheus via `MetricsService` using updated labels: `agent_name`, `operation_type`, and `project_id`.
4.  **Token Detail Expansion**: Separate `ai_tokens_input_total` and `ai_tokens_output_total` counters must be implemented in the Prometheus schema to match the database.
5.  **Budget Alerts**: Integrate with `ALERT_THRESHOLDS` in `src/common/metrics/metrics.constants.ts`. Log a CRITICAL Sentry alert when project or daily budget exceeds 100%.

## Tasks / Subtasks

- [x] **Core Service & Module** (AC: #1)
  - [x] Initialize `CostTrackingModule` and `AICostTrackerService` in `src/cost-tracking`
  - [x] Implement `calculateUSD(model, input, output)` using current 2024 rates
- [x] **Centralized Hook Integration** (AC: #1, #2)
  - [x] Add `afterCall` hook to `BaseAIProvider` (or equivalent) to trigger cost logging automatically
  - [x] Ensure `tokens_input` and `tokens_output` are extracted from provider-specific responses
- [x] **Observability Upgrade** (AC: #3, #4)
  - [x] Update `MetricsService` and `BusinessCollector` to support `agent_name` and `operation_type` labels
  - [x] Split `ai_tokens_used` into input/output counters in `metrics.constants.ts`
- [x] **Alerting Integration** (AC: #5)
  - [x] Implement `checkThresholds()` using constant values from `ALERT_THRESHOLDS`
  - [x] Connect to `SentryService` for critical budget notifications
- [x] **Verification**
  - [x] Unit tests for pricing logic and threshold checks
  - [x] Integration test verifying a mock AI call results in a correctly populated `AICostLog` record

## Dev Notes

- **Architecture**: Follow the **Observability Pattern** ([ADR-008](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/architecture/adr-008-ai-delegation-pattern.md)).
- **Reinvention Prevention**: Reuse `MetricsService` from `src/common/metrics`. Do NOT create a new metrics collector.
- **Precision**: Store `cost_usd` as a `Decimal` in the database to prevent floating-point errors (matching [schema.prisma](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/prisma/schema.prisma)).

### References

- [Epic 13 Context](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/epic-13-14-15-v3-remaining.md)
- [Metrics Constants](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/common/metrics/metrics.constants.ts)
- [Prisma Schema](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/prisma/schema.prisma)

### Dev Agent Record

- Review Date: 2025-12-24
- Identified 6 issues (1 Critical, 1 High, 3 Medium, 1 Low).
- Fixed: Actual budget lookup (Schema + Service), Redundant logging in Claude, Centralized model tracking, Path aliases.
- Verified: `src/cost-tracking/ai-cost-tracker.service.spec.ts` passing.

### File List

- [NEW] `src/cost-tracking/ai-cost-tracker.service.ts`
- [MODIFY] `src/cost-tracking/cost-tracking.module.ts`
- [MODIFY] `src/common/metrics/metrics.constants.ts`
- [MODIFY] `src/common/metrics/collectors/business.collector.ts`
- [NEW] `src/cost-tracking/ai-cost-tracker.service.spec.ts`
- [MODIFY] `src/ai-routing/ai-execution.service.ts`
- [MODIFY] `src/ai-routing/providers/claude-code.provider.ts`
- [MODIFY] `src/ai-routing/providers/cursor-headless.provider.ts`
- [MODIFY] `src/ai-routing/interfaces/ai-provider.interface.ts`
- [MODIFY] `src/common/metrics/metrics.module.ts`
- [MODIFY] `src/common/metrics/metrics.service.ts`
- [MODIFY] `prisma/schema.prisma`
