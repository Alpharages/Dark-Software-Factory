# Story 27.4: Notification Bell Badge

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As any authenticated user,
I want the notification bell in the header to display a badge showing my unread notification count,
So that I know at a glance when I have pending actions or alerts requiring attention.

## Acceptance Criteria

1. **Given** a user has one or more unread notifications
   **When** the Header renders
   **Then** a red badge appears on the notification bell icon displaying the unread count from `GET /api/v1/notifications/in-app/unread-count`
   **And** the badge number is correct and not hidden by any CSS issue

2. **Given** the unread count is `0`
   **When** the Header renders
   **Then** no badge is shown on the notification bell icon

3. **Given** the unread count exceeds `99`
   **When** the badge renders
   **Then** it displays `"99+"` instead of the raw number

4. **Given** the notification staleTime is set to 30 seconds (from Story 25.8)
   **When** the user reads a notification
   **Then** the badge count decrements accordingly on the next polling cycle (within 30 seconds)

## Tasks / Subtasks

- [x] Task 1: Verify and Fix Existing Badge CSS
  - [x] The badge UI and the "99+" logic are ALREADY implemented in `src/components/notifications/NotificationCenter.tsx` (added/fixed during Story 25.8). DO NOT reinvent or duplicate this code!
  - [x] Investigate why the existing `<span className="absolute top-1.5 right-1.5 ...">` might be hidden or rendering incorrectly as reported in QA-FR28.
  - [x] Update the badge's CSS classes to use theme-aware borders (e.g., `border-background` instead of hardcoded `border-slate-900`) so it contrasts correctly in both light and dark modes.
  - [x] Ensure the badge is not clipped by any `overflow-hidden` properties in parent containers.
- [x] Task 2: Verify React Query Integration
  - [x] Verify the existing `useUnreadNotificationCount` hook correctly passes the `unreadCount` number to the badge.
  - [x] Validate that the badge updates correctly when socket events invalidate the cache. (Logic exists in `NotificationCenter.tsx`).
- [x] Task 3: Manual Verification
  - [x] Render the header with `unreadCount = 0` (badge hidden).
  - [x] Render the header with `unreadCount > 0` (badge visible and correctly positioned).
  - [x] Verify light mode and dark mode visibility.

## Dev Notes

### Technical Requirements & Anti-Patterns

- **Real-time Synchronization**: Story 25.8 established that React Query is the single source of truth. Do NOT introduce new local state for the unread count. Rely entirely on the data from `useUnreadNotificationCount()`.
- **CSS Issues**: QA-FR28 noted that the badge might have been hidden previously due to a CSS issue. Double-check positioning (`relative` on parent, `absolute` on badge) and z-index to ensure visibility.

### Project Structure Notes

- Relevant hooks: `src/hooks/queries/useNotifications.ts`
- Relevant components: `src/components/notifications/NotificationCenter.tsx`, `src/components/layout/Header.tsx`

### References

- QA Functional Requirement: QA-FR28 (Notification bell badge missing) [Source: docs/QA-REPORT-2026-02-27.md]
- Previous work: Story 25.8 (Notification Stability) for real-time invalidation background.

## Dev Agent Record

### Agent Model Used

Antigravity

### Debug Log References

- Addressed Task 1 (CSS CSS) by adjusting absolute positioning (`top-0 right-0`) and enabling theme-aware `border-background` in `NotificationCenter.tsx`.
- Verified Task 2 (React Query Integration) which natively consumes the unread count appropriately without duplicating requests or state.

### Completion Notes List

- **CSS Issues Fixed:** Modified positioning of notification badge and added `z-10` layer.
- **Theme Support:** Altered raw slate borders to semantic `border-background` for light/dark layout.
- **Component Tests:** Created new component test specification in `src/__tests__/notifications/NotificationCenter.test.tsx` verifying all visibility conditions.

### File List

- `src/components/notifications/NotificationCenter.tsx` (modified)
- `src/__tests__/notifications/NotificationCenter.test.tsx` (modified)
- `src/hooks/queries/useNotifications.ts` (modified — refetchInterval fix)

### Senior Developer Review (AI)

**Reviewer:** Khakanali on 2026-03-03
**Outcome:** ✅ Approved — All HIGH and MEDIUM issues fixed

#### Findings Fixed (6 total)

| #   | Severity | Issue                                                                   | Fix Applied                                                                                     |
| --- | -------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| H1  | 🔴 HIGH  | `refetchInterval: 300_000` (5 min) violated AC4 "within 30 seconds"     | Changed to `30 * 1000` in `useUnreadNotificationCount`                                          |
| H2  | 🔴 HIGH  | No interaction/mutation tests; Task 3 manual verifications unautomated  | Added 7 new tests: aria-label ×2, error badge ×2, disconnect indicator ×2, dropdown interaction |
| M1  | 🟡 MED   | Dead code — `formatBadgeCount(0)` branch unreachable due to outer guard | Removed `count === 0` branch                                                                    |
| M2  | 🟡 MED   | Silent error swallowing — API failure shows zero badge                  | Added `isError: countFetchFailed` + yellow `?` badge with `aria-hidden`                         |
| M3  | 🟡 MED   | Missing `aria-label` on bell trigger button (WCAG 2.1 AA)               | Added dynamic `aria-label` (e.g. "Notifications, 3 unread")                                     |
| M4  | 🟡 MED   | Fragile `/[0-9]+/` regex matched any digit in DOM                       | Replaced with `/^\d+$\|^99\+$/` scoped to badge text                                            |

#### Remaining Low Issues (not fixed — acceptable)

- **L1**: Two `// TODO: Navigate...` comments not in backlog (documentation gap)
- **L2**: Badge loading flash while `isLoading` (minor UX, no AC requirement)

#### Change Log

| Date       | Author         | Change                                                                                           |
| ---------- | -------------- | ------------------------------------------------------------------------------------------------ |
| 2026-03-03 | AI Code Review | Fixed H1: refetchInterval 5min→30s in useNotifications.ts                                        |
| 2026-03-03 | AI Code Review | Fixed H2: Added 7 tests (aria-label, error state, disconnection indicator, dropdown interaction) |
| 2026-03-03 | AI Code Review | Fixed M1: Removed unreachable count===0 branch in formatBadgeCount                               |
| 2026-03-03 | AI Code Review | Fixed M2: Added countFetchFailed error state with yellow ? badge                                 |
| 2026-03-03 | AI Code Review | Fixed M3: Added aria-label to notification bell trigger button                                   |
| 2026-03-03 | AI Code Review | Fixed M4: Replaced fragile /[0-9]+/ test regex                                                   |
