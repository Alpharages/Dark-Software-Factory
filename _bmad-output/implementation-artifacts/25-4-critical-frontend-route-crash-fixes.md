# Story 25.4: Critical Frontend Route & Crash Fixes

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Administrator,
I want `/cost`, `/admin/users`, and `/admin/invitations` to render without crashing,
so that I can access Cost Analysis and fully manage users and invitations from the admin panel.

## Acceptance Criteria

1. **Given** any authenticated user clicks "Cost Analysis" in the sidebar
   **When** the browser navigates to `/cost`
   **Then** the `CostAnalysisPage` component renders (or the route redirects to `/financial-metrics` if Cost Analysis is the same page)
   **And** the PM Dashboard is NOT rendered at `/cost`
   **And** the browser title reads "Cost Analysis — DSF" (not "PM Dashboard — DSF")

2. **Given** an authenticated ADMIN navigates to `/admin/users`
   **When** `GET /api/v1/users` returns a paginated response
   **Then** `UsersPage` correctly reads `totalPages` from the actual API response shape (e.g., `res.data.meta.totalPages`)
   **And** no `TypeError: Cannot read properties of undefined (reading 'totalPages')` is thrown
   **And** the users table renders (empty state if no users, populated list if users exist)

3. **Given** an authenticated ADMIN navigates to `/admin/invitations`
   **When** `GET /api/v1/auth/invitations` returns data
   **Then** `InvitationsTable` initializes with `data ?? []` as a safe fallback before the query resolves
   **And** no `TypeError: Cannot read properties of undefined (reading 'rows')` is thrown
   **And** the table renders a loading skeleton while the query is in-flight, then shows invitations or an empty state

## Tasks / Subtasks

- [x] Fix `/cost` route
  - [x] Add `<Route path="/cost" />` in `App.tsx` (inside the protected `DashboardLayout` routes).
  - [x] Create a simple `CostAnalysisPage.tsx` component in `src/pages/` that displays a title "Cost Analysis" and updates `document.title = "Cost Analysis — DSF"`.
- [x] Fix `/admin/users` crash
  - [x] In `src/pages/UsersPage.tsx`, reviewed `setMeta(response.meta)`. Root cause: backend returns `{ users, pagination }` not `{ data, meta }`. Fixed `UsersResponse` type and updated all field references.
  - [x] Apply safe fallback: `setMeta(response.pagination || { total: 0, page: 1, limit: 10, totalPages: 1 })` and fixed `setUsers(response.users)`.
- [x] Fix `/admin/invitations` crash
  - [x] In `src/components/invitations/InvitationsTable.tsx`, guarded both `useReactTable({ data: invitations ?? [] })` and the `invitations.length` display reference.
  - [x] Also fixed `InvitationsPage.tsx` to pass `invitations ?? []` as the prop, and removed conflicting `globalFilter` state.

### Review Follow-ups (AI)

- [ ] [AI-Review][LOW] `/cost` RBAC: verify sidebar visibility guard matches open `<ProtectedRoute>` — confirm VIEWER access is intentional [`App.tsx:479-486`]

## Dev Notes

### Technical Requirements

- Ensure React strict mode doesn't break.
- Add robust loading and error states to missing pages.

### Architecture Compliance

- Use Shadcn/UI for any layout modifications.
- Handle loading/empty states consistently.
- Do not introduce breaking dependencies. Keep changes lightweight.

### File Structure Requirements

- Modify `App.tsx` in `dsf-dasbhoard/src/App.tsx`.
- Modify `UsersPage.tsx` in `dsf-dasbhoard/src/pages/UsersPage.tsx`.
- Modify `InvitationsTable.tsx` in `dsf-dasbhoard/src/components/invitations/InvitationsTable.tsx`.
- Check `InvitationsPage.tsx` in `dsf-dasbhoard/src/pages/InvitationsPage.tsx`.
- Add `CostAnalysisPage.tsx` in `dsf-dasbhoard/src/pages/CostAnalysisPage.tsx`.

### Project Structure Notes

- The frontend is located in the `dsf-dasbhoard/` workspace, while the backend is in `Dark Software Factory`. Make sure you apply changes inside the frontend directory structure.

### References

- [Source: docs/QA-REPORT-2026-02-27.md#3.1-broken--missing-routes]
- [Source: docs/QA-REPORT-2026-02-27.md#3.2-react-crashes]

## Dev Agent Record

### Agent Model Used

Antigravity v1.0.0

### Debug Log References

N/A

### Completion Notes List

- Added `/cost` route in `App.tsx` with `CostAnalysisPage` component; sets `document.title = "Cost Analysis — DSF"`.
- Fixed `/admin/users` crash: corrected `UsersResponse` type to match backend `PaginatedUsersResponseDto` (`users`/`pagination` keys), updated `UsersPage.tsx` field references accordingly.
- Fixed `/admin/invitations` crash: guarded `InvitationsTable` `useReactTable` data and direct `invitations.length` JSX reference with `?? []`; removed conflicting `globalFilter` state; added `?? []` fallback at prop level in `InvitationsPage.tsx`.
- Added regression tests: `CostAnalysisPage.test.tsx`, `InvitationsTable.test.tsx`, `UsersPage.test.tsx` (9 tests, all passing).

### File List

- `../dsf-dasbhoard/src/App.tsx`
- `../dsf-dasbhoard/src/pages/UsersPage.tsx`
- `../dsf-dasbhoard/src/__tests__/pages/UsersPage.test.tsx`
- `../dsf-dasbhoard/src/components/invitations/InvitationsTable.tsx`
- `../dsf-dasbhoard/src/__tests__/components/invitations/InvitationsTable.test.tsx`
- `../dsf-dasbhoard/src/pages/InvitationsPage.tsx`
- `../dsf-dasbhoard/src/pages/CostAnalysisPage.tsx`
- `../dsf-dasbhoard/src/__tests__/pages/CostAnalysisPage.test.tsx`
- `../dsf-dasbhoard/src/types/user.ts`
