# Story 7.3: Risk-Based Review Prioritization

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a TL,
I want high-risk architecture decisions flagged for thorough review,
So that I can focus my time on decisions that matter most.

## Acceptance Criteria

1. **Given** ADRs are created
   **When** risk level is calculated
   **Then** decisions are classified:
   - **High-risk:** New dependencies, database schema changes, security patterns, infrastructure changes (require TL review)
   - **Medium-risk:** Design pattern changes, significant refactoring (recommend TL review)
   - **Low-risk:** Minor refactoring, code organization, style improvements (spot-check acceptable)

2. **And** risk indicators are based on:
   - Scope of impact (how many files/modules affected)
   - Reversibility (easy to undo or requires migration)
   - AI confidence (low confidence = higher risk)
   - Domain complexity (security, data, API contracts = high risk)

3. **And** high-risk decisions:
   - Block deployment until TL approves
   - Send immediate notification to TL
   - Escalate to architect if TL unavailable >4 hours

## Tasks / Subtasks

  - [x] Task 1: Create Risk Assessment Service (AC: #1, #2)
    - [x] Implement `RiskAssessmentService` in `src/architecture-review/risk-assessment.service.ts`
    - [x] Define `RiskFactors` interface:
    - [x] Implement `calculateRiskLevel(factors: RiskFactors): RiskLevel`
    - [x] Implement scoring logic:
      - [x] High: Schema/Security/Infra changes, Irreversible, or Confidence < 0.7
      - [x] Medium: Cross-module impact, or Confidence < 0.9
      - [x] Low: Single-file, Easy reversibility, Confidence >= 0.9

- [x] Task 2: Database Schema & Integration (AC: #1)
  - [x] Update `prisma/schema.prisma` to add `risk_factors` field to `Adr` model (type: `Json?`)
  - [x] Run migration: `npm run migration:generate --name add_adr_risk_factors`
  - [x] Update `AdrService` to call `RiskAssessmentService` during ADR creation
  - [x] Populate `risk_level` and `risk_factors` in `Adr` entity

- [x] Task 3: Implement Escalation Workflow (AC: #3)
  - [x] Implement `EscalationService` in `src/architecture-review/escalation.service.ts`
  - [x] Install `@nestjs/schedule` if missing
  - [x] Create Cron job `@Cron(CronExpression.EVERY_HOUR)` to check for stuck High Risk ADRs
  - [x] Logic: If `status === PROPOSED` AND `risk_level === HIGH` AND `created_at > 4 hours ago`:
    - [x] Trigger escalation notification

- [x] Task 4: Notification System Integration (AC: #3)
  - [x] Create `ArchitectureReviewNotificationService`
  - [x] Implement `notifyTL(adr: Adr)` using `ClickUpService` (create high-priority task) or Logger (if ClickUp unavailable)
  - [x] Implement `notifyArchitect(adr: Adr)` for escalation
  - [x] Ensure notifications function without blocking main thread

- [x] Task 5: Unit Tests
  - [x] Test `calculateRiskLevel` with various sets of `RiskFactors`
  - [x] Test integration with `AdrService` (mocking risk service)
  - [x] Test escalation Cron job logic (simulate time passing)
  - [x] Test notification triggers

## Dev Notes

### V3 Enhancements
- **Epic 14.1 Integration:** Leverage PR Risk Assessor scoring if available.
- **Reference:** `v3-epic-impact-analysis.md`

### Architecture Compliance
- **Module:** `ArchitectureReviewModule`
- **Services:**
  - `RiskAssessmentService` (Risk logic)
  - `EscalationService` (Cron jobs)
- **Database:** Prisma `Json` type for `risk_factors` to strictly match the defined interface.
- **Security:** Ensure risk calculation cannot be bypassed.

### Testing Standards
- Unit tests for all scoring logic.
- Mock external dependencies (Notification, ClickUp).

### Project Structure Notes
- Place services in `src/architecture-review/` to maintain flat structure.
- DTOs in `src/architecture-review/dto/`

### References
- [Source: docs/epics.md#Story 7.3](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/epics.md)
- [Source: Story 7.2](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/7-2-tl-architecture-review-queue.md)

## Dev Agent Record

### Agent Model Used
Antigravity (Planning)

### Completion Notes List
- 2026-01-01: Implementation completed. Fixed all code review issues:
  - Implemented `ArchitectureReviewNotificationService` with `ClickUpService` integration for creating high-priority review tasks.
  - Added `createTask` method to `ClickUpService` (Backported form Story 7-3 requirement).
  - Wired all components in `ArchitectureReviewModule`.
  - All unit tests passing.

### File List
- src/architecture-review/risk-assessment.service.ts
- src/architecture-review/risk-assessment.service.spec.ts
- src/architecture-review/escalation.service.ts
- src/architecture-review/escalation.service.spec.ts
- src/architecture-review/architecture-review-notification.service.ts
- src/architecture-review/architecture-review.module.ts
- src/clickup/clickup.service.ts
- prisma/schema.prisma
- prisma/migrations/20251231204333_add_adr_risk_factors/migration.sql
