# Story 27.2: Per-Page Document Titles

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As any user,
I want each page to display a descriptive and unique browser tab title,
so that I can identify open tabs, navigate browser history, and share links meaningfully with teammates.

## Acceptance Criteria

1. **Given** a user navigates to any of the application's routes
   **When** the page component mounts
   **Then** `document.title` is updated to `"{Page Name} — DSF"`
2. **And** dynamic routes show contextually relevant titles (e.g., `/conversations/:id` → `"Conversation Details — DSF"`, `/register/:inviteToken` → `"Registration — DSF"`)
3. **And** the browser tab updates dynamically on every route change without requiring a full page reload
4. **And** the title reverts to `"DSF Dashboard"` when the component unmounts.

## Tasks / Subtasks

- [x] Create a custom hook `useDocumentTitle` (`src/hooks/useDocumentTitle.ts`)
  - [x] Implement `export function useDocumentTitle(title: string)`
  - [x] Implement `useEffect` to set `document.title` on mount/change, and return a cleanup function restoring `"DSF Dashboard"` on unmount.
- [x] Apply `useDocumentTitle` to Core / Auth Pages:
  - [x] `DashboardPage` ("PM Dashboard — DSF")
  - [x] `LoginPage` ("Login — DSF")
  - [x] `RegistrationPage` ("Registration — DSF")
  - [x] `ProfilePage` ("Profile — DSF")
  - [x] `NotFoundPage` ("404 Not Found — DSF")
  - [x] `ForbiddenPage` ("403 Forbidden — DSF")
- [x] Apply `useDocumentTitle` to Feature Dashboards:
  - [x] `ExecutionMonitoringDashboard` ("Execution Monitoring — DSF")
  - [x] `PmApprovalDashboardPage` ("PM Approvals — DSF")
  - [x] `ProductionErrorDashboard` ("Production Errors — DSF")
  - [x] `AuditLogsDashboard` ("Audit Logs — DSF")
  - [x] `DecisionDashboard` ("Decisions — DSF")
  - [x] `FinancialMetricsPage` ("Financial Metrics — DSF")
  - [x] `CostAnalysisPage` ("Cost Analysis — DSF")
  - [x] `WorkloadCapacityPage` ("Capacity Monitor — DSF")
  - [x] `ResourceManagerPage` ("Resource Manager — DSF")
  - [x] `CapabilityManagementPage` ("Capabilities — DSF")
  - [x] `ProjectsSyncPage` ("Projects Sync — DSF")
  - [x] `ObservabilityPage` ("Observability — DSF")
- [x] Apply `useDocumentTitle` to Admin & QA Pages:
  - [x] `UsersPage` ("Users — DSF")
  - [x] `InvitationsPage` ("Invitations — DSF")
  - [x] `LeadQaReviewDashboardPage` ("QA Review — DSF")
- [x] Apply `useDocumentTitle` to Architecture Pages (`src/pages/architecture-review/`):
  - [x] `ArchitectureReviewQueuePage` ("Architecture Queue — DSF")
  - [x] `ConstraintsPage` ("Architecture Constraints — DSF")
  - [x] `EscalationAnalyticsPage` ("Escalations — DSF")
  - [x] `ArchitectureMetricsPage` ("Architecture Metrics — DSF")
- [x] Apply `useDocumentTitle` to Conversation Pages (`src/components/conversations/`):
  - [x] `ConversationSearchInterface` ("Conversations — DSF")
  - [x] `ConversationUploadForm` ("Upload Conversation — DSF")
  - [x] `ConversationDetailView` ("Conversation Details — DSF")
- [x] Apply `useDocumentTitle` to Settings & Profile (`src/pages/settings/`):
  - [x] `NotificationPreferences` ("Notification Preferences — DSF")
  - [x] `GithubCallback` ("GitHub Auth — DSF")
  - [x] `CleanupPanel` ("Settings: Cleanup — DSF")
  - [x] `SelfHealingPanel` ("Settings: Self-Healing — DSF")
  - [x] `DependencyPanel` ("Settings: Dependencies — DSF")
  - [x] `AutoMergePanel` ("Settings: Auto-Merge — DSF")
  - [x] `CostPanel` ("Settings: Cost Control — DSF")
  - [x] `AuditPanel` ("Settings: Audit — DSF")
  - [x] `HealthPanel` ("Settings: Integration Health — DSF")

## Dev Notes

- **Architecture Compliance:**
  - **Hook Signature:** `export function useDocumentTitle(title: string)`
  - Avoid third-party dependencies like `react-helmet`. Native `document.title` manipulation via a hook is lightweight and standard.
- **Dependencies:** React (`useEffect`)
- **Testing Requirements:** Add `src/hooks/__tests__/useDocumentTitle.test.ts`. Test that calling the hook updates `document.title`, and unmounting the component restores it to the previous value or `"DSF Dashboard"`.
- **Previous Story Learnings:** Story 27.1 implemented a 404 page and set its title inline natively. Use a hook to scale this pattern easily to all routes.

### Project Structure Notes

- Add the new hook to the `src/hooks/` directory.
- Affects almost all components in `src/pages/` mapped to routes in `src/App.tsx`.

### References

- [Source: epics.md#Story-27.2](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/epics.md)
- [Source: QA-REPORT-2026-02-27.md (QA-FR26 / UI-5 / UI-10)](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/QA-REPORT-2026-02-27.md)

## Dev Agent Record

### Agent Model Used

GPT-5 Codex (CLI)

### Debug Log References

- Added reusable `useDocumentTitle` hook and wired it into all story-specified pages/components.
- Removed legacy inline `document.title` updates from `NotFoundPage` and `CostAnalysisPage`.
- Validation commands run in frontend repo:
  - `pnpm exec vitest run src/hooks/__tests__/useDocumentTitle.test.ts src/__tests__/pages/NotFoundPage.test.ts src/__tests__/pages/CostAnalysisPage.test.ts`
  - `pnpm exec eslint src/hooks/useDocumentTitle.ts src/hooks/__tests__/useDocumentTitle.test.ts`

### Completion Notes List

- Implemented `useDocumentTitle(title: string)` with `useEffect` mount/update behavior and cleanup to `"DSF Dashboard"`.
- Applied standardized titles to all required core/auth, feature, admin/QA, architecture, conversation, and settings/profile screens.
- Ensured dynamic-route coverage for `/register/:inviteToken` and `/conversations/:id` via component-level title hooks.
- Added unit tests verifying title set/update and unmount reset behavior.

### File List

- src/hooks/useDocumentTitle.ts
- src/hooks/**tests**/useDocumentTitle.test.ts
- src/pages/Dashboard.tsx
- src/pages/LoginPage.tsx
- src/pages/RegistrationPage.tsx
- src/pages/ProfilePage.tsx
- src/pages/NotFoundPage.tsx
- src/pages/ForbiddenPage.tsx
- src/pages/ExecutionMonitoringDashboard.tsx
- src/pages/PmApprovalDashboardPage.tsx
- src/pages/ProductionErrorDashboard.tsx
- src/pages/AuditLogsDashboard.tsx
- src/pages/DecisionDashboard.tsx
- src/pages/FinancialMetricsPage.tsx
- src/pages/CostAnalysisPage.tsx
- src/pages/WorkloadCapacityPage.tsx
- src/features/resource-manager/components/ResourceManagerPage.tsx
- src/pages/CapabilityManagementPage.tsx
- src/pages/ProjectsSyncPage.tsx
- src/pages/observability/ObservabilityPage.tsx
- src/pages/UsersPage.tsx
- src/pages/InvitationsPage.tsx
- src/pages/QaReviewDashboardPage.tsx
- src/pages/ArchitectureReviewQueuePage.tsx
- src/pages/architecture-review/constraints/ConstraintsPage.tsx
- src/components/architecture-review/EscalationAnalyticsPage.tsx
- src/pages/architecture-review/ArchitectureMetricsPage.tsx
- src/components/conversations/ConversationSearchInterface.tsx
- src/components/conversations/ConversationUploadForm.tsx
- src/components/conversations/ConversationDetailView.tsx
- src/pages/NotificationPreferences.tsx
- src/pages/settings/GithubCallback.tsx
- src/pages/settings/panels/AllPanels.tsx

## Change Log

- 2026-03-02: Implemented per-page title hook across all story-listed components and added hook unit tests.
