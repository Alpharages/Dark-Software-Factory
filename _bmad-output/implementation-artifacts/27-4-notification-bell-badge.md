# Story 27.4: Notification Bell Badge

Status: ready-for-dev

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

- [ ] Task 1: Verify and Fix Existing Badge CSS
  - [ ] The badge UI and the "99+" logic are ALREADY implemented in `src/components/notifications/NotificationCenter.tsx` (added/fixed during Story 25.8). DO NOT reinvent or duplicate this code!
  - [ ] Investigate why the existing `<span className="absolute top-1.5 right-1.5 ...">` might be hidden or rendering incorrectly as reported in QA-FR28.
  - [ ] Update the badge's CSS classes to use theme-aware borders (e.g., `border-background` instead of hardcoded `border-slate-900`) so it contrasts correctly in both light and dark modes.
  - [ ] Ensure the badge is not clipped by any `overflow-hidden` properties in parent containers.
- [ ] Task 2: Verify React Query Integration
  - [ ] Verify the existing `useUnreadNotificationCount` hook correctly passes the `unreadCount` number to the badge.
  - [ ] Validate that the badge updates correctly when socket events invalidate the cache. (Logic exists in `NotificationCenter.tsx`).
- [ ] Task 3: Manual Verification
  - [ ] Render the header with `unreadCount = 0` (badge hidden).
  - [ ] Render the header with `unreadCount > 0` (badge visible and correctly positioned).
  - [ ] Verify light mode and dark mode visibility.

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

### Debug Log References

### Completion Notes List

### File List
