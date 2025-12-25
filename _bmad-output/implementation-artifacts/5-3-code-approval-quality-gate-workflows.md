# Story 5.3: Code Approval & Quality Gate Workflows

**Status:** ready-to-start

## Story
**As a PM,**  
I want to review AI-generated code with QA results and confidence scores before deployment,  
So that I maintain control over production quality.

## Merged From
- Original Story 5.4 (Code Approval Workflow Interface)
- Original Story 5.5 (AI Confidence Scores & Uncertainty Flags)

## Acceptance Criteria
- [ ] **AC#1:** PMs can view code diff with syntax highlighting and line numbers (integrate `diff2html` or `react-diff-viewer`).
- [ ] **AC#2:** QA summary displays lint status, test pass/fail counts, coverage %, security scan results.
- [ ] **AC#3:** Confidence score prominently displayed (90-100% green, 70-89% yellow, <70% red).
- [ ] **AC#4:** Low confidence (<70%) automatically escalates to TL and requires PM approval (cannot auto-deploy).
- [ ] **AC#5:** Approval decision logged to audit trail with timestamp, PM ID, reasoning.
- [ ] **AC#6:** Original ticket and acceptance criteria displayed side-by-side with code for context.

## Tasks

### Backend (DSF BUILDS)
- [ ] Implement approval state machine (approve/reject/rework/escalate logic).
- [ ] Create API endpoints:
    - [ ] `POST /api/v1/executions/{id}/approve`
    - [ ] `POST /api/v1/executions/{id}/reject`
    - [ ] `POST /api/v1/executions/{id}/rework`
    - [ ] `POST /api/v1/executions/{id}/escalate`
- [ ] Database persistence for approval decisions and audit trail.
- [ ] RabbitMQ integration: Trigger GitHub push on approval.
- [ ] Implement auto-escalation logic for low confidence.

### Frontend (AI DELEGATES)
- [ ] Code diff viewer UI implementation.
- [ ] QA results summary dashboard/component.
- [ ] Confidence score visualization (gauge/badge).
- [ ] Uncertainty flags expandable list.
- [ ] Approval action forms with validation.

## Dev Notes
- **Dependencies:** Epic 3 (QA results), Epic 4 (Code ready), Story 2.3 (Confidence scores).
- **FRs Covered:** FR11, FR12, FR13, FR14.
- **Effort:** 3.5 days.
