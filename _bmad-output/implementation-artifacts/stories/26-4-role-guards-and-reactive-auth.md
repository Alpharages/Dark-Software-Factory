# Story 26-4: Role Guards & Reactive Auth

Status: done

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

- [x] Implement FinancialMetrics Role Guard (AC: 1)
  - [x] Locate `<FinancialMetricsSection>` in `src/App.tsx` (around line 303).
  - [x] Import `canAccess` from `../../utils/roleHelpers`. Note `useAuth()` is already imported.
  - [x] Wrap `<FinancialMetricsSection>`: `canAccess(user?.role || 'VIEWER', 'MANAGER')`.
- [x] Fix Reactive Auth Dependency in Dashboard (AC: 2)
  - [x] Locate the data fetching `useEffect` in the `Dashboard` component (around line 248).
  - [x] Change dependency array from `[]` (current state) to `[user?.id]` for reactivity.

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
- Successfully added `canAccess` wrapper for `FinancialMetricsSection` in Dashboard.tsx
- Made data fetching `useEffect` reactive to `user?.id` inside Dashboard.tsx
- Added `DashboardAuth.test.tsx` to explicitly test new functionality: verifying role-based rendering of the financial metrics section and reactive refetching when the user session changes.

### File List

- `dsf-dasbhoard/src/pages/Dashboard.tsx` (Modified)
- `dsf-dasbhoard/src/components/financial/FinancialMetricsSection.tsx` (Modified)
- `dsf-dasbhoard/src/__tests__/components/DashboardAuth.test.tsx` (New)

## Senior Developer Review (AI)

**Reviewer:** Khakanali | **Date:** 2026-03-02 | **Outcome:** Changes Applied → done

### Findings Summary

| Severity | Count | Status |
| -------- | ----- | ------ |
| High     | 1     | Fixed  |
| Medium   | 3     | Fixed  |
| Low      | 3     | Noted  |

### 🔴 HIGH — Fixed

**H1: AC1 Partially Not Satisfied — `FinancialMetricsSection` blocked for MANAGER users**

- `FinancialMetricsSection.tsx:33-40` used `localStorage.getItem('userRole') || 'PM'` for role gating. Since no production code ever sets `localStorage.userRole`, the default was always `'PM'`, causing `hasAccess = false` and the component to return `null` even for MANAGER users. Dashboard-level guard was correct but component was still invisible.
- **Fix:** Replaced the broken localStorage check with `useAuth()` + `canAccess(user?.role || 'VIEWER', 'MANAGER')` in `FinancialMetricsSection.tsx`.

### 🟡 MEDIUM — Fixed

**M1: New test file had 3 `@typescript-eslint/no-explicit-any` ESLint errors**

- Lines 34, 42, 125 of original `DashboardAuth.test.tsx` used `as any` casts (`apiClient.get as any`, `socket: null as any`, `authHookMap as any`) that would fail CI lint gate.
- **Fix:** Replaced with `vi.mocked(apiClient.get)`, `socket: null` (valid per `Socket | null` type), and proper `makeAuthMock` helper factory.

**M2: Test file placed at wrong location**

- File was at `src/pages/DashboardAuth.test.tsx` instead of following project convention `src/__tests__/components/`.

**M3: Story File List documented incorrect path**

- Story claimed `src/pages/__tests__/DashboardAuth.test.tsx` (non-existent path).
- **Fix (M2+M3):** Moved to `src/__tests__/components/DashboardAuth.test.tsx`, updated all relative imports, and corrected File List.

### 🟢 LOW — Noted (no action required)

**L1:** Tests only covered VIEWER and PM for blocked roles — **Fixed:** Added TL and QA test cases.
**L2:** No test for null user (unauthenticated) — **Fixed:** Added `'does NOT render FinancialMetricsSection when user is null'` test case.
**L3:** Story task descriptions reference `src/App.tsx` as source file instead of `src/pages/Dashboard.tsx`. Documentation inaccuracy only, implementation was correct.

### Change Log

- 2026-03-02: Code review (claude-sonnet-4-6) — applied fixes for H1, M1, M2, M3; added TL/QA/null-user test cases; all 8 tests green.
