# Story 8.UI: Lead QA Review Dashboard

**Status:** backlog  
**Epic:** Epic 8 (QA Review & Quality Approval Gates)  
**Priority:** High  
**Repository:** `dsf-dashboard`

## Story
As a Lead QA,
I want a unified dashboard to review AI-generated code samples,
So that I can verify quality and approve deployments to production without digging into raw JSON or logs.

## Acceptance Criteria

1. **Given** I am a Lead QA
   **When** I navigate to `/qa-review/dashboard`
   **Then** I see:
   - **Sampling Queue**: List of executions selected for review (Risk, Provider, Project).
   - **Automated QA Summary**: Snapshot of Linting, Tests, Coverage, and Security results.
   - **Quality Score**: AI-generated quality score for the ticket.

2. **And** I can perform reviews:
   - **Code Diff**: View original vs. AI-changed code in a readable diff view.
   - **Requirement Context**: View original ClickUp ticket/PRD description alongside code.
   - **Action Buttons**: 'Approve for Prod', 'Reject with Findings', 'Request Rework'.

3. **And** rejection workflow includes:
   - Text area for 'Remediation Guidance'.
   - Mandatory 'Severity' selection (Blocker, Critical, Major, Minor).

4. **And** metrics visualization:
   - **Bug Escape Rate** trend (from production errors).
   - **QA Throughput** (Reviews per day).

## Tasks
- [ ] Create `/qa-review/dashboard` route and Sidebar link.
- [ ] Implement `QaReviewQueueTable` with status filters.
- [ ] Implement `CodeDiffViewer` component (monaco-editor or react-diff-viewer).
- [ ] Implement `QaDecisionForm` modal for approval/rejection.
- [ ] Integrate with `GET /api/v1/qa-review/samples` and `POST /api/v1/qa-review/:id/decision`.

## References
- [Epic 8 Strategy](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/epics.md#Epic-8)
