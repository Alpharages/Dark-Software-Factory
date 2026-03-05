# Story 25.5: Workload Capacity Page Auth Fix

Status: done

... (rest of the file remains same, but wait, I should replace specific lines)

## Story

As a PM or Manager,
I want the Workload Capacity page to load my actual workload data using my real authenticated user ID,
so that the page works correctly without generating 404 or 400 API errors.

## Acceptance Criteria

1. **Given** an authenticated user navigates to `/capacity-monitor`
   **When** `WorkloadCapacityPage` mounts
   **Then** `pmId` is read from `useAuth().user?.id` — NOT `localStorage.getItem('userId')`
   **And** `userRole` is read from `useAuth().user?.role` — NOT `localStorage.getItem('userRole')`
   **And** queries for `pmWorkload`, `trends`, and `teamWorkload` (if manager) use `enabled: !!user?.id` to prevent invalid API calls.
   **And** `GET /api/v1/workload/pm/{realUUID}` returns `200` with the user's real workload data
   **And** `GET /api/v1/workload/trends/{realUUID}?days=30` returns `200`
   **And** zero 404 or 400 errors appear in the network tab for workload endpoints

2. **Given** an ADMIN or MANAGER user is on `/capacity-monitor`
   **When** `isManager` is evaluated
   **Then** it is derived from `user?.role` being `MANAGER` or `ADMIN`
   **And** the "Team Capacity" chart is displayed for those roles

## Tasks / Subtasks

- [x] Import `useAuth` and `useHasRole` hooks in `WorkloadCapacityPage.tsx`
- [x] Replace `localStorage` calls with `useAuth` and `user` state
  - [x] Replace `const pmId = localStorage.getItem('userId') || 'usr-1'` with `const { user } = useAuth(); const pmId = user?.id || ''`.
  - [x] Replace `const userRole = localStorage.getItem('userRole') || 'USER'` with `const userRole = user?.role || 'USER'`.
  - [x] Replace `isManager` derivation with `const isManager = useHasRole('MANAGER')`.
  - [x] Update `useSocket` to use the correct `accessToken` (check `AuthContext` token management or central `apiClient` config).
- [x] Refactor `useQuery` and `useMutation` calls
  - [x] Update `pmWorkload` query: Add `enabled: !!user?.id`.
  - [x] Update `trends` query: Add `enabled: !!user?.id`.
  - [x] Update `teamWorkload` query: Add `enabled: !!user?.id && isManager`.
  - [x] Ensure `updateCapacityMutation` uses the reactive `pmId` from state.
- [x] Add auth loading guard
  - [x] In the render method, ensure the page doesn't fire queries or render partial UI until `user` is defined (e.g., return the existing pulse loading state if `!user`).
- [x] Update child component props
  - [x] Ensure `ReassignmentModal` receives reactive `currentPmName` (or handle in modal).

## Dev Notes

### Technical Requirements

- Ensure the `useAuth` hook from `@/hooks/useAuth` (or similar path) is used correctly.
- Use the `enabled` property in TanStack Query to prevent fire-on-mount with invalid IDs.
- Handle the case where `user` might be null during initial load (show loading spinner or safe state).

### Architecture Compliance

- Maintain the existing `useQuery` patterns.
- Do not introduce breaking changes to the `workloadApi` service.
- Follow the "Auth state must be fully resolved before child components fire any API requests" rule (QA-NFR5).

### File Structure Requirements

- Modify `src/pages/WorkloadCapacityPage.tsx`.
- The frontend is in the `dsf-dasbhoard` directory.

### References

- [Source: docs/QA-REPORT-2026-02-27.md#FE-13]
- [Source: docs/QA-REPORT-2026-02-27.md#BE-11]
- [Source: docs/QA-REPORT-2026-02-27.md#BE-12]

## Dev Agent Record

### Agent Model Used

Antigravity v1.0.0

### Debug Log References

N/A

### Completion Notes List

Code review (2026-02-28) found and fixed 4 issues:

- H1: Split loading guard — unauthenticated users now redirect to `/login` via `<Navigate>` instead of showing an infinite skeleton
- M1: Exported `getAccessToken` from `AuthContext.tsx`; component now imports and uses it instead of duplicating `localStorage`/`sessionStorage` logic inline
- M2: Added 8-test suite in `WorkloadCapacityPage.test.tsx` covering auth loading, unauthenticated redirect, `enabled` guards, PM vs Manager view, and team workload isolation
- M3: Fixed `teamWorkload` query key from `['workload', 'team']` to `['workload', 'team', pmId]` to prevent cross-user cache contamination

### File List

- `../dsf-dasbhoard/src/pages/WorkloadCapacityPage.tsx`
- `../dsf-dasbhoard/src/contexts/AuthContext.tsx`
- `../dsf-dasbhoard/src/__tests__/pages/WorkloadCapacityPage.test.tsx`
