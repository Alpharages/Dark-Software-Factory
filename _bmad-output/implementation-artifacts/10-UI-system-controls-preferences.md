# Story 10.UI: System Controls & Preferences

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **Product Manager, Tech Lead, QA Lead, or Manager**,
I want to **view and control AI executions through a unified dashboard with real-time updates and configurable notification preferences**,
so that **I can monitor execution progress, pause/resume executions, and customize my notification settings without leaving the dashboard interface**.

## Acceptance Criteria

1. **Real-Time Execution Monitoring Dashboard**
   - Create a React component `ExecutionMonitoringDashboard` in the `dsf-dashboard` repository
   - Display active executions with real-time progress updates via Socket.IO connection
   - Show execution status (QUEUED, IN_PROGRESS, PAUSED, COMPLETED, FAILED, TIMEOUT)
   - Display progress bar with percentage and current step description
   - Show execution metadata: ticket ID, project name, AI provider, start time, duration
   - Auto-refresh data from `GET /api/v1/executions/active` endpoint
   - Subscribe to Socket.IO execution events: `execution.started`, `execution.progress`, `execution.completed`, `execution.failed`, `execution.timeout`, `execution.cancelled`
   - Subscribe to control confirmation events: `execution.paused`, `execution.resumed`, `execution.emergency_stopped`
   - Update UI in real-time when Socket.IO events are received (update status, progress, metadata)
   - Display empty state when no active executions: "No active executions at this time" with icon
   - Integrate with existing dashboard layout (sidebar navigation, header)

2. **Execution Control Panel**
   - Add action buttons to each execution item: Pause, Resume, Emergency Stop
   - Pause button → calls `POST /api/v1/executions/:id/pause` endpoint (Story 10-U-5)
   - Resume button → calls `POST /api/v1/executions/:id/resume` endpoint (Story 10-U-5)
   - Emergency Stop button → calls `POST /api/v1/executions/:id/emergency-stop` endpoint (Story 10-U-5)
   - Show/hide buttons based on execution status per visibility matrix:
     - QUEUED: Only Emergency Stop enabled
     - IN_PROGRESS: Pause and Emergency Stop enabled
     - PAUSED: Only Resume and Emergency Stop enabled
     - COMPLETED/FAILED/TIMEOUT: All buttons hidden
   - Show confirmation dialog for Emergency Stop (destructive action)
   - Display success/error toast notifications after control actions
   - Use optimistic UI updates: Update button states immediately, revert if API call fails
   - Handle authorization errors (only PMs/TLs/Managers can control executions)

3. **Execution Logs Viewer**
   - Create a modal or side-panel component `ExecutionLogsViewer`
   - Load logs from `GET /api/v1/executions/:id/logs` endpoint (Story 10-U-4)
   - Subscribe to Socket.IO `execution.log` events for real-time log streaming (Story 10-U-4)
   - Display logs in a scrollable code block with syntax highlighting
   - Display maximum 10,000 log lines in viewer (use virtual scrolling for performance)
   - Show warning banner if logs exceed 10,000 lines: "Showing first 10,000 lines. Export for full logs."
   - Auto-scroll to bottom when new logs arrive (disable auto-scroll if user scrolls up manually)
   - Add filtering controls: log level (DEBUG, INFO, WARN, ERROR), timestamp range
   - Support search/filter within logs (client-side)
   - Add export button to download complete logs as `.txt` file (no line limit)

4. **Notification Preferences UI**
   - Create a page or modal `NotificationPreferences` in the dashboard
   - Load current preferences from `GET /api/v1/notifications/preferences` endpoint (Story 10-U-7)
   - Display table of notification preferences with columns: Event Type, Channels (Slack/Email/In-App), Enabled, Filters
   - Allow users to create new preferences via `POST /api/v1/notifications/preferences`
   - Allow users to edit existing preferences via `PATCH /api/v1/notifications/preferences/:id`
   - Allow users to delete preferences via `DELETE /api/v1/notifications/preferences/:id`
   - Form fields:
     - Event Type dropdown: `execution.started`, `execution.completed`, `execution.failed`, etc. (from Story 10-U-7)
     - Channel checkboxes: Slack, Email, In-App
     - Enabled toggle switch
     - Filter criteria: Project selector (multi-select), Severity selector (multi-select), Provider selector (multi-select)
   - Validate form inputs before submission
   - Show success/error feedback after save

5. **In-App Notification Center**
   - Create a `NotificationCenter` component in the dashboard header/toolbar
   - Display notification bell icon with unread count badge
   - Badge displays actual count when ≤99, displays "99+" when unread count exceeds 99
   - Load notifications from `GET /api/v1/notifications/in-app` endpoint (Story 10-U-7)
   - Subscribe to Socket.IO `notification.new` events to update badge count in real-time
   - Show dropdown list of recent notifications (max 10 most recent) when bell icon is clicked
   - Display notification title, message, timestamp, and read/unread status
   - Clicking a notification → marks it as read via `PATCH /api/v1/notifications/in-app/:id/read`
   - Add "Mark all as read" button → calls `PATCH /api/v1/notifications/in-app/read-all`
   - Show "View all notifications" link → navigates to full notifications page
   - Auto-fetch new notifications every 30 seconds (polling fallback if Socket.IO fails)

6. **Socket.IO Connection Management**
   - Create a `useSocketIO` React hook to manage WebSocket connection
   - Connect to Socket.IO server at backend URL (from environment variable `VITE_API_URL`)
   - Authenticate connection with JWT token from user session
   - Subscribe to relevant rooms based on user role and project membership:
     - `role:{userRole}` (ADMIN, MANAGER, PM, TL, QA)
     - `project:{projectId}` for each project user has access to
     - `user:{userId}` for personal notifications
   - Handle connection/disconnection events (log reconnection attempts)
   - Auto-reconnect on connection loss (Socket.IO built-in retry logic)
   - Provide event subscription methods for components to register listeners
   - Clean up event listeners on component unmount

7. **Error Handling & Loading States**
   - Display loading spinner while fetching initial data (executions, preferences, notifications)
   - Show error messages when API calls fail (with retry option)
   - Handle 401 Unauthorized errors → redirect to login page
   - Handle 403 Forbidden errors → display "Access denied" message
   - Handle Socket.IO connection failures → show "Real-time updates unavailable" banner
   - Gracefully degrade to polling mode if Socket.IO connection fails
   - Toast notifications for transient errors (e.g., "Failed to pause execution, please try again")

8. **Responsive Design & Accessibility**
   - Dashboard must be responsive (desktop, tablet, mobile)
   - Use shadcn/ui components and Tailwind CSS for consistent styling (per `dashboard-ui-engineering` skill)
   - Follow existing dashboard design system (colors, typography, spacing)
   - Ensure WCAG 2.1 AA compliance: keyboard navigation, screen reader support, color contrast
   - Add ARIA labels for action buttons and accessibility landmarks
   - Support dark mode (if existing dashboard supports it)

9. **Performance Optimization**
   - Implement virtual scrolling for large lists (execution logs, notifications)
   - Debounce Socket.IO event handlers to prevent UI flooding (max 1 update per 500ms)
   - Memoize expensive computations (e.g., filtering logs, sorting executions)
   - Lazy-load components (ExecutionLogsViewer, NotificationPreferences) using React.lazy
   - Optimize re-renders with React.memo for list items
   - Use TanStack Query for API data fetching and caching with following strategy:
     - `['executions', 'active']`: Invalidate on any execution event, staleTime: 30s
     - `['executions', id, 'logs']`: staleTime: 60s, no auto-refetch (real-time via Socket.IO)
     - `['notifications', 'preferences']`: staleTime: 5 minutes
     - `['notifications', 'in-app']`: staleTime: 30s, invalidate on `notification.new` event
   - Use optimistic updates for control actions (pause/resume/emergency-stop) with automatic rollback on error

10. **Authorization & Role-Based UI**
    - Show/hide execution control buttons based on user role:
      - PM, TL, Manager: Can pause, resume, emergency stop executions for their projects
      - QA: View-only (no control buttons)
      - Admin: Can control all executions
    - Disable control buttons if user doesn't have permission for that execution
    - Hide notification preferences that user can't configure (e.g., admin-only event types)
    - Display appropriate error messages for unauthorized actions

## Tasks / Subtasks

- [ ] **Setup Socket.IO Client** (AC 6)
  - [ ] Install `socket.io-client` package: `npm install socket.io-client`
  - [ ] Create `src/lib/socket/useSocketIO.ts` React hook
  - [ ] Implement connection logic with JWT authentication from user context
  - [ ] Subscribe to rooms based on user role and projects
  - [ ] Add error handling for connection failures
  - [ ] Create `src/lib/socket/socketEvents.ts` to define event type constants

- [ ] **Create Execution Monitoring Dashboard** (AC 1)
  - [ ] Create `src/pages/ExecutionMonitoringDashboard.tsx` page component
  - [ ] Fetch active executions from `GET /api/v1/executions/active` using TanStack Query
  - [ ] Subscribe to execution Socket.IO events: `execution.started`, `execution.progress`, `execution.completed`, `execution.failed`, `execution.timeout`
  - [ ] Create `ExecutionCard` component to display individual execution with progress bar and metadata
  - [ ] Add auto-refresh logic (poll every 30s as fallback if Socket.IO fails)
  - [ ] Integrate with dashboard layout (add route, sidebar nav item)

- [ ] **Create Execution Control Panel** (AC 2)
  - [ ] Add control buttons to `ExecutionCard` component (Pause, Resume, Emergency Stop)
  - [ ] Implement API calls to `/api/v1/executions/:id/pause`, `/api/v1/executions/:id/resume`, `/api/v1/executions/:id/emergency-stop`
  - [ ] Add button disable logic based on execution state
  - [ ] Create confirmation dialog for Emergency Stop using shadcn/ui Dialog
  - [ ] Add toast notifications for success/error feedback using shadcn/ui Toast
  - [ ] Handle authorization errors (display error toast if user lacks permission)

- [ ] **Create Execution Logs Viewer** (AC 3)
  - [ ] Create `src/components/execution/ExecutionLogsViewer.tsx` modal component
  - [ ] Fetch logs from `GET /api/v1/executions/:id/logs` using TanStack Query
  - [ ] Subscribe to `execution.log` Socket.IO events for real-time log streaming
  - [ ] Display logs in scrollable code block with syntax highlighting (use `react-syntax-highlighter` or similar)
  - [ ] Implement auto-scroll to bottom when new logs arrive
  - [ ] Add log filtering controls (log level, timestamp range)
  - [ ] Add search functionality (client-side filter)
  - [ ] Add export button to download logs as `.txt` file

- [ ] **Create Notification Preferences UI** (AC 4)
  - [ ] Create `src/pages/NotificationPreferences.tsx` page component
  - [ ] Fetch preferences from `GET /api/v1/notifications/preferences` using TanStack Query
  - [ ] Create form component `NotificationPreferenceForm` with fields: Event Type, Channels, Enabled, Filters
  - [ ] Implement create preference via `POST /api/v1/notifications/preferences`
  - [ ] Implement update preference via `PATCH /api/v1/notifications/preferences/:id`
  - [ ] Implement delete preference via `DELETE /api/v1/notifications/preferences/:id`
  - [ ] Add form validation using `react-hook-form` and `zod` (per `dashboard-ui-engineering` skill)
  - [ ] Display success/error feedback with Toast notifications

- [ ] **Create In-App Notification Center** (AC 5)
  - [ ] Create `src/components/notifications/NotificationCenter.tsx` component
  - [ ] Add notification bell icon to dashboard header with unread count badge
  - [ ] Fetch notifications from `GET /api/v1/notifications/in-app` using TanStack Query
  - [ ] Subscribe to `notification.new` Socket.IO events to update badge in real-time
  - [ ] Implement dropdown list to display recent notifications (use shadcn/ui Dropdown)
  - [ ] Add mark as read functionality via `PATCH /api/v1/notifications/in-app/:id/read`
  - [ ] Add "Mark all as read" button via `PATCH /api/v1/notifications/in-app/read-all`
  - [ ] Add "View all notifications" link to navigate to full notifications page
  - [ ] Implement polling fallback (fetch every 30s) if Socket.IO connection fails

- [ ] **Implement Role-Based UI Access** (AC 10)
  - [ ] Create `src/lib/auth/permissions.ts` to define permission checks
  - [ ] Implement `canControlExecution(userId, execution, userRole)` function
  - [ ] Hide/disable control buttons based on permission check results
  - [ ] Filter notification preferences based on user role
  - [ ] Display appropriate error messages for unauthorized actions

- [ ] **Add Error Handling & Loading States** (AC 7)
  - [ ] Add loading spinners for API data fetching (use shadcn/ui Skeleton for placeholder)
  - [ ] Display error messages when API calls fail with retry button
  - [ ] Handle 401 errors → redirect to `/login` page
  - [ ] Handle 403 errors → display "Access denied" message
  - [ ] Add "Real-time updates unavailable" banner when Socket.IO connection fails
  - [ ] Implement polling fallback for critical data when Socket.IO fails

- [ ] **Optimize Performance** (AC 9)
  - [ ] Implement virtual scrolling for execution logs using `react-virtuoso` or `@tanstack/react-virtual`
  - [ ] Debounce Socket.IO event handlers (500ms) to prevent UI flooding
  - [ ] Memoize expensive computations with `React.useMemo` and `React.useCallback`
  - [ ] Lazy load components with `React.lazy` and `Suspense`
  - [ ] Apply `React.memo` to list item components (ExecutionCard, NotificationItem)

- [ ] **Ensure Responsive Design & Accessibility** (AC 8)
  - [ ] Test dashboard on desktop, tablet, mobile breakpoints
  - [ ] Use Tailwind responsive utilities (`sm:`, `md:`, `lg:`) for layout adjustments
  - [ ] Add ARIA labels to control buttons and interactive elements
  - [ ] Test keyboard navigation (Tab, Enter, Escape)
  - [ ] Verify screen reader compatibility with NVDA/JAWS
  - [ ] Check color contrast ratios meet WCAG 2.1 AA standards

- [ ] **Unit Tests** (All ACs)
  - [ ] Test `useSocketIO` hook with mocked socket connection
  - [ ] Test `ExecutionMonitoringDashboard` component rendering and event handling
  - [ ] Test execution control button click handlers and API calls
  - [ ] Test `ExecutionLogsViewer` log filtering and search functionality
  - [ ] Test `NotificationPreferenceForm` validation and submission
  - [ ] Test `NotificationCenter` real-time updates and mark as read
  - [ ] Test permission checks in `permissions.ts`
  - [ ] Test error handling and fallback behavior
  - [ ] **Target: ≥80% code coverage** for all components and hooks
  - [ ] Run coverage report: `npm run test:coverage`

- [ ] **Integration Tests**
  - [ ] Test end-to-end flow: Connect Socket.IO → receive event → update UI
  - [ ] Test execution control flow: Click pause → call API → update UI → Socket.IO event confirms state change
  - [ ] Test notification flow: Backend sends notification → Socket.IO event → badge updates → dropdown shows notification
  - [ ] Test fallback behavior: Socket.IO connection fails → polling mode activates → UI still updates
  - [ ] Test optimistic updates: Control action triggers immediate UI update, verify rollback on API error

- [ ] **Visual Regression Tests** (Optional)
  - [ ] Use Chromatic or Percy for UI snapshot testing
  - [ ] Capture snapshots for: ExecutionCard (all states), NotificationCenter (empty/with items), LogsViewer
  - [ ] Verify responsive layouts at breakpoints: 320px, 768px, 1024px, 1920px

## Dev Notes

### Architecture Compliance

- **Frontend Repository**: `/Volumes/Data/project/products/alpharages/dsf-dashboard` (React + TypeScript + Vite)
- **UI Stack**: React 19, Tailwind CSS v4, shadcn/ui (Radix + CVA), TanStack Query, TanStack Table (per `dashboard-ui-engineering` skill)
- **Backend Integration**: All API endpoints from Epic 10-U stories (10-U-1 through 10-U-7)
- **Socket.IO Events**: Subscribe to events defined in Stories 10-U-1, 10-U-2, 10-U-4, 10-U-5, 10-U-7
- **Authentication**: JWT token from user session, passed in Socket.IO handshake auth and API request headers
- **State Management**: TanStack Query for server state, React Context for global UI state (user, theme)
- **Form Handling**: `react-hook-form` + `zod` for validation (per `dashboard-ui-engineering` skill)

### Control Button Visibility Matrix

Reference for AC 2: Which control buttons to show/enable based on execution status:

| Execution Status | Pause Button | Resume Button | Emergency Stop Button |
| ---------------- | ------------ | ------------- | --------------------- |
| QUEUED           | ❌ Hidden    | ❌ Hidden     | ✅ Enabled            |
| IN_PROGRESS      | ✅ Enabled   | ❌ Hidden     | ✅ Enabled            |
| PAUSED           | ❌ Hidden    | ✅ Enabled    | ✅ Enabled            |
| COMPLETED        | ❌ Hidden    | ❌ Hidden     | ❌ Hidden             |
| FAILED           | ❌ Hidden    | ❌ Hidden     | ❌ Hidden             |
| TIMEOUT          | ❌ Hidden    | ❌ Hidden     | ❌ Hidden             |
| CANCELLED        | ❌ Hidden    | ❌ Hidden     | ❌ Hidden             |

**Implementation Note:** Use conditional rendering rather than disabled state for better UX.

### Key Technical Requirements

1. **Socket.IO Connection Hook**

   ```typescript
   // src/lib/socket/useSocketIO.ts
   import { useEffect, useRef } from 'react';
   import { io, Socket } from 'socket.io-client';
   import { useAuth } from '@/lib/auth/AuthContext';

   export function useSocketIO() {
     const { user, token } = useAuth();
     const socketRef = useRef<Socket | null>(null);

     useEffect(() => {
       if (!token) return;

       // Connect to Socket.IO server
       const socket = io(import.meta.env.VITE_API_URL, {
         auth: { token },
         reconnection: true,
         reconnectionDelay: 1000,
         reconnectionAttempts: 5,
       });

       // Join rooms based on user role and projects
       socket.on('connect', () => {
         socket.emit('joinRoom', { room: `role:${user.role}` });
         socket.emit('joinRoom', { room: `user:${user.id}` });
         user.projectIds?.forEach((projectId) => {
           socket.emit('joinRoom', { room: `project:${projectId}` });
         });
       });

       socket.on('connect_error', (error) => {
         console.error('Socket.IO connection error:', error);
       });

       socketRef.current = socket;

       return () => {
         socket.disconnect();
       };
     }, [token, user]);

     return socketRef.current;
   }
   ```

2. **Execution Monitoring Dashboard Component**

   ```typescript
   // src/pages/ExecutionMonitoringDashboard.tsx
   import { useQuery } from '@tanstack/react-query';
   import { useSocketIO } from '@/lib/socket/useSocketIO';
   import { ExecutionCard } from '@/components/execution/ExecutionCard';

   export function ExecutionMonitoringDashboard() {
     const socket = useSocketIO();

     // Fetch active executions
     const { data: executions, refetch } = useQuery({
       queryKey: ['executions', 'active'],
       queryFn: () => fetch('/api/v1/executions/active').then((res) => res.json()),
       refetchInterval: 30000, // Polling fallback every 30s
     });

     // Subscribe to Socket.IO events
     useEffect(() => {
       if (!socket) return;

       const handleExecutionEvent = (event: ExecutionEvent) => {
         // Update UI based on event type
         refetch(); // Simple approach: refetch all executions
       };

       socket.on('execution.started', handleExecutionEvent);
       socket.on('execution.progress', handleExecutionEvent);
       socket.on('execution.completed', handleExecutionEvent);
       socket.on('execution.failed', handleExecutionEvent);

       return () => {
         socket.off('execution.started', handleExecutionEvent);
         socket.off('execution.progress', handleExecutionEvent);
         socket.off('execution.completed', handleExecutionEvent);
         socket.off('execution.failed', handleExecutionEvent);
       };
     }, [socket, refetch]);

     return (
       <div className="p-6">
         <h1 className="text-2xl font-bold mb-4">Active Executions</h1>
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
           {executions?.map((execution) => (
             <ExecutionCard key={execution.id} execution={execution} />
           ))}
         </div>
       </div>
     );
   }
   ```

3. **Notification Center Component**

   ```typescript
   // src/components/notifications/NotificationCenter.tsx
   import { useQuery, useMutation } from '@tanstack/react-query';
   import { useSocketIO } from '@/lib/socket/useSocketIO';
   import { Bell } from 'lucide-react';
   import { Badge } from '@/components/ui/badge';
   import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

   export function NotificationCenter() {
     const socket = useSocketIO();

     const { data: notifications, refetch } = useQuery({
       queryKey: ['notifications', 'in-app'],
       queryFn: () => fetch('/api/v1/notifications/in-app?unreadOnly=true').then((res) => res.json()),
       refetchInterval: 30000,
     });

     const markAsRead = useMutation({
       mutationFn: (notificationId: string) =>
         fetch(`/api/v1/notifications/in-app/${notificationId}/read`, {
           method: 'PATCH',
         }),
       onSuccess: () => refetch(),
     });

     useEffect(() => {
       if (!socket) return;

       socket.on('notification.new', (notification) => {
         refetch(); // Refetch to update badge count
       });

       return () => {
         socket.off('notification.new');
       };
     }, [socket, refetch]);

     const unreadCount = notifications?.unread || 0;

     return (
       <DropdownMenu>
         <DropdownMenuTrigger asChild>
           <button className="relative p-2">
             <Bell className="w-6 h-6" />
             {unreadCount > 0 && (
               <Badge variant="destructive" className="absolute -top-1 -right-1">
                 {unreadCount}
               </Badge>
             )}
           </button>
         </DropdownMenuTrigger>
         <DropdownMenuContent className="w-80">
           {notifications?.notifications.map((notification) => (
             <DropdownMenuItem
               key={notification.id}
               onClick={() => markAsRead.mutate(notification.id)}
             >
               <div>
                 <p className="font-semibold">{notification.title}</p>
                 <p className="text-sm text-muted-foreground">{notification.message}</p>
               </div>
             </DropdownMenuItem>
           ))}
         </DropdownMenuContent>
       </DropdownMenu>
     );
   }
   ```

### Security

- All API calls use JWT token from user session (sent in `Authorization: Bearer <token>` header)
- Socket.IO connection authenticated with same JWT token in handshake auth
- Role-based UI: Hide/disable features based on user role and permissions
- Client-side permission checks are for UX only - backend always validates authorization
- No sensitive data exposed in Socket.IO events (only IDs and safe metadata)

### Testing Strategy

- **Unit Tests**: Test components in isolation with mocked dependencies (Socket.IO, TanStack Query, API calls)
- **Integration Tests**: Test component interactions with real Socket.IO connection (use test server)
- **E2E Tests**: Test full user flows in Cypress or Playwright (connect → view executions → pause execution → verify UI update)
- **Accessibility Tests**: Automated a11y tests with `axe-core` or `jest-axe`

### Project Structure Notes

**Frontend Repository Location:**

```
/Volumes/Data/project/products/alpharages/dsf-dashboard/
├── src/
│   ├── pages/
│   │   ├── ExecutionMonitoringDashboard.tsx (new)
│   │   ├── NotificationPreferences.tsx (new)
│   ├── components/
│   │   ├── execution/
│   │   │   ├── ExecutionCard.tsx (new)
│   │   │   ├── ExecutionLogsViewer.tsx (new)
│   │   ├── notifications/
│   │   │   ├── NotificationCenter.tsx (new)
│   │   │   ├── NotificationPreferenceForm.tsx (new)
│   ├── lib/
│   │   ├── socket/
│   │   │   ├── useSocketIO.ts (new)
│   │   │   ├── socketEvents.ts (new)
│   │   ├── auth/
│   │   │   ├── permissions.ts (new)
```

**Files to Create:**

- `src/pages/ExecutionMonitoringDashboard.tsx` - Main execution monitoring page
- `src/pages/NotificationPreferences.tsx` - Notification preference management page
- `src/components/execution/ExecutionCard.tsx` - Individual execution item component
- `src/components/execution/ExecutionLogsViewer.tsx` - Logs viewer modal
- `src/components/notifications/NotificationCenter.tsx` - Notification bell dropdown
- `src/components/notifications/NotificationPreferenceForm.tsx` - Preference form
- `src/lib/socket/useSocketIO.ts` - Socket.IO connection hook
- `src/lib/socket/socketEvents.ts` - Event type constants
- `src/lib/auth/permissions.ts` - Permission check utilities

**Files to Modify:**

- `src/App.tsx` - Add routes for new pages
- `src/components/layout/Sidebar.tsx` - Add navigation links
- `src/components/layout/Header.tsx` - Integrate NotificationCenter component

### References

- [Story 10-U-1: Socket.IO Infrastructure](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/10-U-1-socket-io-real-time-infrastructure.md) - Backend Socket.IO setup, event types, room patterns
- [Story 10-U-2: Execution Progress Streaming](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/10-U-2-execution-progress-streaming.md) - Execution events specification
- [Story 10-U-4: Execution Logs Streaming](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/10-U-4-execution-logs-streaming.md) - Log events and API endpoints
- [Story 10-U-5: Manual Intervention Circuit Breaker](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/10-U-5-manual-intervention-circuit-breaker.md) - Control endpoints (pause, resume, emergency stop)
- [Story 10-U-7: Notification Preferences & Channels](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/10-U-7-notification-preferences-channels.md) - Notification preference API endpoints
- [Architecture Doc: Real-Time Communication](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/planning-artifacts/architecture.md#Section-Real-Time-Communication) - Architecture overview
- [Dashboard UI Engineering Skill](file:///Volumes/Data/project/products/alpharages/dsf-dasbhoard/.agent/skills/ui-styling/SKILL.md) - UI stack guidelines (React 19, Tailwind v4, shadcn/ui)

### Previous Story Intelligence

**Story 10-U-1 Backend Learnings:**

- Socket.IO server exposes `emitToProject()`, `emitToRole()`, `emitToUser()`, `broadcast()` methods
- Room pattern: `project:{id}`, `role:{role}`, `user:{userId}`
- Frontend clients join rooms via `socket.emit('joinRoom', { room: 'project:123' })`
- Authentication via JWT token in Socket.IO handshake: `io(url, { auth: { token } })`

**Story 10-U-2 Backend Learnings:**

- Execution events: `execution.started`, `execution.progress`, `execution.completed`, `execution.failed`, `execution.timeout`, `execution.cancelled`
- Event payloads include: `executionId`, `ticketId`, `projectId`, `status`, `currentStep`, `percentComplete`, `errorMessage`
- Progress updates emitted every 5 seconds (rate-limited on backend)

**Story 10-U-4 Backend Learnings:**

- Log endpoint: `GET /api/v1/executions/:id/logs` (paginated with query params)
- Socket.IO event: `execution.log` with payload `{ executionId, ticketId, logLine, timestamp, level }`
- Logs stored in database with retention policy

**Story 10-U-5 Backend Learnings:**

- Control endpoints: `POST /api/v1/executions/:id/pause`, `/resume`, `/emergency-stop`
- Authorization: Only PM/TL/Manager for their projects, ADMIN for all
- Events emitted after control actions: `execution.paused`, `execution.resumed`, `execution.emergency_stopped`

**Story 10-U-7 Backend Learnings:**

- Preference endpoints: `GET`, `POST`, `PATCH`, `DELETE /api/v1/notifications/preferences`
- In-app notification endpoints: `GET /api/v1/notifications/in-app`, `PATCH /:id/read`, `PATCH /read-all`
- Socket.IO event: `notification.new` with payload `{ notificationId, title, message, eventType, createdAt }`
- Supported channels: `slack`, `email`, `in_app`

### Project Context Reference

This story implements the **UI Gateway** for Epic 10-U (Real-time Notifications & Controls), bringing together all backend capabilities into a unified dashboard experience:

- **Real-Time Monitoring**: View active AI executions with live progress updates
- **Execution Control**: Pause, resume, and emergency stop executions directly from the UI
- **Log Streaming**: View real-time execution logs in a dedicated viewer
- **Notification Preferences**: Configure multi-channel notification delivery (Slack, email, in-app)
- **In-App Notifications**: Receive instant notifications via Socket.IO with notification center UI

This story completes Epic 10-U by providing the user interface that consumes all backend services from Stories 10-U-1 through 10-U-7.

## Dev Agent Record

### Agent Model Used

_To be filled by dev agent_

### Debug Log References

_To be filled by dev agent_

### Completion Notes List

_To be filled by dev agent_

### File List

_To be filled by dev agent_
