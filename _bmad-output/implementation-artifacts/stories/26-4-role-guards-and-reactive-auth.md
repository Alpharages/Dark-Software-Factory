# Story 26-4: Role Guards & Reactive Auth

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Developer,
I want to implement proper role guards on the PM Dashboard and make authentication bindings reactive,
so that sensitive widgets are only accessible to authorized roles and the dashboard reliably refreshes when the user session changes.

## Acceptance Criteria

1. **Financial Metrics Role Guard (FE-15 / QA-FR20)**:
   **Given** a user is logged into the PM Dashboard
   **When** their role does not have `MANAGER` level access (e.g. they are a standard `USER` or `VIEWER`)
   **Then** the `FinancialMetricsSection` is not rendered on the PM Dashboard
   **And When** their role has `MANAGER` or higher access (e.g., `ADMIN`)
   **Then** the `FinancialMetricsSection` is rendered correctly
2. **Reactive Auth Dependency (FE-16 / QA-FR21)**:
   **Given** the PM Dashboard is mounted
   **When** the user's authentication context changes (e.g., new login, session refresh)
   **Then** the dashboard data fetching reacts to the new user state rather than relying on a static `localStorage` token read during render
   **And** the `useEffect` hook correctly depends on the `user.id` from `useAuth()` (or uses React Query with proper auth headers) to trigger data re-fetching reliably.

## Tasks / Subtasks

- [ ] Implement FinancialMetrics Role Guard (AC: 1)
  - [ ] Locate `<FinancialMetricsSection>` in `src/App.tsx` (around line 303).
  - [ ] Import `canAccess` from `../../utils/roleHelpers`. Note `useAuth()` is already imported.
  - [ ] Wrap `<FinancialMetricsSection>`: `canAccess(user?.role || 'VIEWER', 'MANAGER')`.
- [ ] Fix Reactive Auth Dependency in Dashboard (AC: 2)
  - [ ] Locate the data fetching `useEffect` in the `Dashboard` component (around line 248).
  - [ ] Change dependency array from `[]` (current state) to `[user?.id]` for reactivity.

## Dev Notes

- **Architecture Patterns**: Use React Context hooks (`useAuth`) and established RBAC utilities (`canAccess`).
- **Source Files**: `src/App.tsx` (Dashboard component).
- **Reference**: QA Report (FE-15, FE-16, QA-FR20, QA-FR21).

### Project Structure Notes

- Alignment with unified frontend structure (`dsf-dashboard`).
- Follow established precedent from Story 25-5 where `localStorage.getItem` was replaced with `useAuth().user`.

### References

- [Source: docs/QA-REPORT-2026-02-27.md#FE-15-FinancialMetricsSection-Visible-for-All-Roles-on-PM-Dashboard]
- [Source: docs/QA-REPORT-2026-02-27.md#FE-16-useEffecttoken-Dependency-Is-Not-Reactive]

## Dev Agent Record

### Agent Model Used

gemini-2.5-pro

### Debug Log References

Ultimate context engine analysis completed - comprehensive developer guide created.

### Completion Notes List

- Addressed FE-15 and FE-16
- Included Acceptance Criteria based on BDD format
- Detailed Tasks and Subtasks

### File List
