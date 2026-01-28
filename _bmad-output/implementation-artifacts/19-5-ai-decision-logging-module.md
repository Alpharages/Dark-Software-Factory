# Story 19-5: Implement AI Decision Logging Module

## Story

As a developer, I want to implement a dedicated `AIDecisionLoggerService` module so that key AI-driven actions (like project deletion, future automated assignments) are auditable and structured, replacing the temporary placeholder logging.

## Status

- **Status**: Ready for Dev
- **Priority**: Medium
- **Effort**: 1 day

## Context

During the implementation of Story 19-4 (Project Management Enhancements), we identified a gap where `AIDecisionLoggerService` was referenced but not implemented. A standard `Logger` was used as a temporary measure to enable project deletion logging. This story tracks the creation of the full module.

## Acceptance Criteria

1.  **Module Structure**:
    - [ ] Create `ai-decision-logging` module in `src/ai-decision-logging/`.
    - [ ] Export `AIDecisionLoggerService` from the module.

2.  **Database Traceability**:
    - [ ] Define `AIDecisionLog` model in Prisma schema (if not already present) or use structure JSON logging. _Note: Prefer structured DB logging if high volume isn't expected, or structured JSON logs if volume is high._
    - [ ] Fields should include: `decisionType`, `entityId`, `entityType`, `metadata` (JSON), `timestamp`, `triggerUser` (if applicable).

3.  **Service Implementation**:
    - [ ] Implement `logDecision(decisionType: string, metadata: any, user?: string)` method.
    - [ ] Ensure formatting aligns with observability standards (e.g., proper JSON structure for Grafana/Loki).

4.  **Integration**:
    - [ ] Refactor `ProjectService.deleteProject` to use `AIDecisionLoggerService` instead of `this.logger.log`.
    - [ ] Verify logs are correctly generated on project deletion.

## Tasks

- [ ] **Design**: Define schema for decision logs.
- [ ] **Scaffold**: Create module, controller/service, and register in `app.module.ts`.
- [ ] **Implement**: Write `logDecision` logic.
- [ ] **Refactor**: Update `ProjectService` to inject and use the new service.
- [ ] **Verify**: Run project deletion test and inspect logs/DB.

## Dev Notes

- **References**:
  - [See Story 19-4 Notes](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/19-4-project-management-enhancements.md)
