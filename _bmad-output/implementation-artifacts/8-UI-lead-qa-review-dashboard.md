# Story 8.UI: Lead QA Review Dashboard

**Status:** done  
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

- [x] Create `/qa-review/dashboard` route and Sidebar link.
- [x] Implement `QaReviewQueueTable` with status filters.
- [x] Implement `CodeDiffViewer` component (monaco-editor or react-diff-viewer).
- [x] Implement `QaDecisionForm` modal for approval/rejection.
- [x] Integrate with `GET /api/v1/qa-review/samples` and `POST /api/v1/qa-review/:id/decision`.

## References

- [Epic 8 Strategy](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/epics.md#Epic-8)

## Implementation Notes

- **Dashboard Page**: Created `LeadQaReviewDashboardPage` integrating metrics and queue.
- **Diff Viewer**: Implemented `CodeDiffViewer` using `react-diff-viewer-continued` for side-by-side analysis.
- **Workflow**: `QaDecisionForm` provides Approve/Reject/Rework actions with severity and guidance fields.
- **API Integration**: Added `useQaReview` hooks for fetching queue samples and submitting decisions.
- **Build Fixes**: Resolved pre-existing type errors in `auth.ts`, `ConversationSearchInterface.tsx`, and `InvitationsTable.tsx`.

## Verification Results

- [x] Application builds successfully (`pnpm run build`).
- [x] Components verified for property access and type safety.
- [x] Sidebar navigation correctly routes to `/qa-review/dashboard`.
