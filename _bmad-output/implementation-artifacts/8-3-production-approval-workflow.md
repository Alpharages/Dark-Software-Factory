# Story 8-3: Production Approval Workflow

**Epic:** 8 - Lead QA Manual Review Workflow
**Story:** 8-3
**Status:** done
**Priority:** High
**Estimation:** 3 days

## Description

Implement the Production Approval Workflow that acts as the final gate before deployment. This workflow enables the Lead QA (or Product Manager) to review aggregated QA results, AI self-healing attempts, and risk analysis before authorizing a release to the production environment. It serves as the authoritative "Green Button" for go-live, ensuring that no unreviewed code reaches production.

## Context

As defined in the Architecture (Decision Dashboard) and PRD (FR11), human oversight is critical for the final production release. While the pipeline is automated, the decision to deploy to production requires a signed-off approval step, especially for the "Hybrid Orchestration" model. This story builds the backend logic and API surfaces to support this decision gate.

## Acceptance Criteria

1.  **Approval API:** Implement secure endpoints for approving (`POST /approve`) and rejecting (`POST /reject`) a production release candidate.
2.  **RBAC Enforcement:** Only users with `LEAD_QA`, `PM`, or `ADMIN` roles can execute these actions.
3.  **Pre-Approval Validation:** The system must verify that all automated Quality Gates (Story 3.5) have passed. If gates failed, approval requires an explicit "Emergency Override" flag with mandatory justification.
4.  **Deployment Trigger:** Upon valid approval, the system must trigger the `DeploymentOrchestrator` (Story 4.5/4.6) to initiate the actual production deployment (e.g., promote to `main` or trigger release workflow).
5.  **Rejection Handling:** Rejection must update the ticket status in ClickUp (via `ClickUpService`) AND add a detailed comment with the rejection reason to ensure visibility.
6.  **Audit Logging:** All decisions (Approve/Reject) must be logged via `AIDecisionLogger` (Story 11.2) with the user ID, timestamp, decision, and any override justification.
7.  **API Response:** The approval endpoint must return the `approval_id` and updated status to support the Frontend "Decision Dashboard" confirmation UI.

## Technical Design & Architecture

- **Service:** Create `ProductionApprovalService` in the `qa-automation` module.
- **Controller:** `ProductionApprovalController` exposed at `/api/v1/production-approval`.
- **Dependencies:**
  - `QaOrchestratorService` (to check gate status).
  - `DeploymentOrchestrator` (NOT DeploymentService - see Story 4.5) to trigger deployment.
  - `AIDecisionLoggerService` (for audit).
  - `ClickUpService` (for status updates and comments).
- **Database:** Create a dedicated `ProductionApproval` model to ensure a distinct audit trail separate from Execution logs.
  - Fields: `id`, `ticketId`, `approverId`, `decision` (APPROVE/REJECT), `overrideReason` (nullable), `createdAt`.
  - Relations: Link to `Ticket` and `User`.

## Tasks

- [x] **Database Schema:** Create `ProductionApproval` model in Prisma schema with relations to `Ticket` and `User`. [Backend]
- [x] **Approval Service:** Implement `ProductionApprovalService` with methods `approveRelease(ticketId, userId)` and `rejectRelease(ticketId, userId, reason)`. [Backend]
- [x] **Gate Verification:** Implement logic to check `QaResults` before allowing approval. Handle "Override" logic. [Backend]
- [x] **Deployment Hook:** Wire up `approveRelease` to call `DeploymentOrchestrator.triggerProductionDeployment()`. [Integration]
- [x] **API Controller:** Implement REST endpoints with `RolesGuard` and `JwtAuthGuard`. [API]
- [x] **Audit Integration:** logging of all actions. [Backend]
- [x] **Unit Tests:** Write comprehensive tests for approval logic, permission checks, and gate verification. [Testing]

## Dependencies

- Story 3.5: Quality Gate Decision Engine (Completed)
- Story 4.5/4.6: Deployment Orchestrator & Status Sync (Completed)
- Story 11.2: AI Decision Audit Logger (Completed)

## References

- `architecture.md` (Decision Dashboard, GO/NO-GO gates)
- `prd.md` (FR11: Signal final approval)

## Dev Agent Record

### File List

- `prisma/schema.prisma`
- `src/prisma/models/ProductionApproval.ts`
- `src/qa-automation/production-approval/production-approval.controller.ts`
- `src/qa-automation/production-approval/production-approval.service.ts`
- `src/qa-automation/production-approval/production-approval.module.ts`
- `src/qa-automation/production-approval/production-approval.service.spec.ts`
- `src/qa-automation/qa-automation.module.ts`
