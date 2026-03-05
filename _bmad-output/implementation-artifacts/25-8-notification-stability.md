# Story 25.8: Notification Stability

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a User,
I want the Notification Preferences page to load reliably without crashing,
and I want the notification system to update in real-time without exceeding API rate limits,
so that I can manage my alerts effectively without service interruptions.

## Acceptance Criteria

1. **Given** a user navigates to `/notification-preferences`
   **When** the user is logged in
   **Then** the page renders correctly and displays the user's preferences without crashing even during initial loading states.

2. **Given** the notification system is running
   **When** multiple browser tabs are open
   **Then** the application does not hit the `429 Too Many Requests` limit due to notification polling (QA-FR12, QA-NFR7).
   **And** polling intervals for notifications are increased to at least 5 minutes.

3. **Given** a new notification is received via WebSocket
   **When** the `notification.new` event is emitted
   **Then** the `unreadCount` and `inAppNotifications` queries are automatically invalidated and refetched.
   **And** the UI reflects the new notification immediately.

4. **Given** the permission check in `canAccessEventType`
   **When** the user object is malformed or properties are missing
   **Then** the function returns `false` gracefully instead of throwing a `TypeError`.

## Tasks / Subtasks

- [x] Task 1: Fix Notification Preferences Crash (AC: 1, 4)
  - [x] Audit `src/lib/auth/permissions.ts` and harden `canAccessEventType` with defensive property checks.
  - [x] Update `src/pages/NotificationPreferences.tsx` to ensure filter logic only runs when `user` and `preferences` are fully loaded.
  - [x] Verify `NotificationPreferenceForm.tsx` similarly handles the `user` object.

- [x] Task 2: Optimize Polling & Rate Limiting (AC: 2)
  - [x] Update `src/hooks/queries/useNotifications.ts`.
  - [x] Change `refetchInterval` to 300,000ms (5m) for all notification queries.
  - [x] Add `refetchOnWindowFocus: false` to notification queries to prevent 429 bursts on tab switching.
  - [x] Ensure `staleTime` remains at 30s.

- [x] Task 3: Centralize Real-Time Synchronization (AC: 3)
  - [x] Modify `src/components/notifications/NotificationCenter.tsx`.
  - [x] DEPRECATE and remove local `realTimeNotifications` state to prevent UI duplication.
  - [x] Update `useNotificationEvents` to trigger `queryClient.invalidateQueries` for all notification keys on _any_ update.
  - [x] Rely solely on the refetched query results as the single source of truth.

- [x] Task 4: Verification (AC: 1, 2, 3)
  - [x] Open Notification Preferences page and verify it loads.
  - [x] Inspect Network tab to confirm polling has slowed down to once every 5 minutes.
  - [x] Trigger a test notification (manual or via API) and verify React Query cache is invalidated and refetched.

## Dev Notes

### Technical Requirements & Anti-Patterns

- **Query Invalidation vs State Duplication**: Currently, `NotificationCenter.tsx` maintains a `realTimeNotifications` state and combines it with the queried `notifications`. This can lead to duplication or inconsistency. Preferred pattern: Invalidate the query on socket event so React Query remains the single source of truth.
- **Defensive Role Checks**: Always use `user?.role === 'ADMIN'` or similar optional chaining, but also check for the existence of `user` before entering business logic loops like `.filter()`.

### Project Structure Notes

- Frontend code is in `/Volumes/Data/project/products/alpharages/dsf-dasbhoard/src`.
- Permissions logic is in `src/lib/auth/permissions.ts`.
- Hooks are in `src/hooks/queries/useNotifications.ts`.

### References

- QA Functional Requirement: QA-FR12 (Rate Limiting) [Source: docs/QA-REPORT-2026-02-27.md]
- QA Non-Functional Requirement: QA-NFR7 (Notification Latency) [Source: docs/QA-REPORT-2026-02-27.md]
- Epic 25: QA Stabilization [Source: _bmad-output/planning-artifacts/epics.md]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Implementation Plan

1. **Task 1 — Crash prevention**: Added `typeof user.role !== 'string'` defensive guard to `canAccessEventType`. Added `!isLoading && user` guard before `filteredPreferences` filter in `NotificationPreferences.tsx`. Added `user ? ... : AVAILABLE_EVENT_TYPES` fallback in `NotificationPreferenceForm.tsx`.
2. **Task 2 — Rate limiting**: Changed `refetchInterval` from 30s to 300,000ms (5 min) and added `refetchOnWindowFocus: false` to `useInAppNotifications` and `useUnreadNotificationCount` hooks. `staleTime` left at 30s as required.
3. **Task 3 — Real-time sync**: Removed `realTimeNotifications` local state from `NotificationCenter.tsx`. Added `useQueryClient` + `notificationKeys` imports. All three socket event handlers (`onNew`, `onRead`, `onReadAll`) now call `queryClient.invalidateQueries` with targeted keys (`notificationKeys.inApp()` + `notificationKeys.unreadCount()`), making React Query the single source of truth. Badge count simplified to use only `unreadCount` from the query.

### File List

- `src/lib/auth/permissions.ts`
- `src/hooks/queries/useNotifications.ts`
- `src/pages/NotificationPreferences.tsx`
- `src/components/notifications/NotificationPreferenceForm.tsx`
- `src/components/notifications/NotificationCenter.tsx`
- `src/__tests__/notifications/notification-stability.test.ts` (new)
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Completion Notes

- All 4 tasks completed; all 4 ACs satisfied.
- 18 unit tests total: 6 `canAccessEventType` defensive hardening, 5 polling config spy-based regression guards, 1 `notificationKeys` structure, 3 socket-invalidation targeting (component-level), 3 loading guard smoke tests. All 18 pass.
- TypeScript `tsc --noEmit` exits 0 — no type errors introduced.
- Zero new lint errors introduced (2 pre-existing issues in `NotificationPreferenceForm.tsx` untouched).

**Code Review Fixes (2026-02-28):**

- H2 fixed: `NotificationCenter.tsx` socket handlers changed from `notificationKeys.all` to targeted `notificationKeys.inApp()` + `notificationKeys.unreadCount()` to prevent spurious preferences API calls on every socket event.
- M1 fixed: `useNotificationPreferences` now includes `refetchOnWindowFocus: false` to close the 429-burst gap that was left open by the original implementation.
- H1/M2/M3 fixed: Test file fully rewritten — vacuous polling test replaced with `vi.mock`-intercepted spy tests; component-level tests added for socket-to-invalidation wiring and preferences loading guard.

### Change Log

- 2026-02-28: Implemented Story 25.8 — Notification Stability (Tasks 1-4). Hardened `canAccessEventType`, increased polling to 5 min, centralized real-time sync via query invalidation.
- 2026-02-28: Code review fixes — targeted socket invalidation (H2), `useNotificationPreferences` tab-focus guard (M1), full test rewrite with real regression coverage (H1/M2/M3). All 18 tests pass.
