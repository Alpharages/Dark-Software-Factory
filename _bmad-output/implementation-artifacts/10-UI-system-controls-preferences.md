# Story 10.UI: System Controls & User Preferences

**Status:** backlog  
**Epic:** Epic 10 (Real-time Monitoring & Notifications)  
**Priority:** Low  
**Repository:** `dsf-dashboard`

## Story
As a User of the Dark Software Factory,
I want to manage my notification preferences and system-wide real-time settings,
So that I only receive relevant alerts and can control dashboard live-update behavior.

## Acceptance Criteria

1. **Given** I am logged into the dashboard
   **When** I go to `/settings/notifications`
   **Then** I can toggle:
   - **Channel Preferences**: ClickUp, Email, or Browser Push.
   - **Event Frequency**: Instant, Daily Digest, or Off for different event types (Success, Failure, Escalation).

2. **And** I can manage system-wide controls:
   - **Real-time Engine**: Enable/Disable Socket.IO streaming vs. Polling.
   - **Global Circuit Breaker Status**: View (and if Admin, Toggle) the system-wide execution lock.

3. **And** notification history:
   - View a 'Notification Bell' list with the last 20 system alerts.

## Tasks
- [ ] Implement `/settings/notifications` page.
- [ ] Create `NotificationPreferenceGrid` with switch toggles.
- [ ] Implement `SystemHealthControls` (Admin only).
- [ ] Create `NotificationBell` component for the TopBar.
- [ ] Integrate with `GET /api/v1/users/me/preferences` and `PUT`.

## References
- [Epic 10 Strategy](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/epics.md#Epic-10)
