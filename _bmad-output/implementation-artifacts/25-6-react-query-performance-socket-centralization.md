# Story 25-6: React Query Performance & Socket Centralization

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Developer,
I want the application to be performant and respect rate limits by centralizing socket connections and using efficient data fetching defaults,
So that the system remains stable and responsive under load.

## Acceptance Criteria

1. **Given** the application is running
   **When** navigating between different pages
   **Then** duplicate API calls for the same data endpoint are prevented by a global `staleTime` of at least 60 seconds (QA-FR12, QA-NFR3)

2. **Given** multiple components require real-time updates
   **When** the dashboard is open
   **Then** only a single WebSocket connection is established and shared via a centralized `SocketProvider` context (QA-FR13)

3. **Given** background polling is enabled
   **When** the user is authenticated
   **Then** polling requests (Notifications, Approvals, Executions) do not exceed one request per 30 seconds per endpoint (QA-NFR2)

## Tasks / Subtasks

- [x] Task 1: Centralize Socket.IO Connection (AC: 2)
  - [x] Create `src/contexts/SocketContext.tsx` with `SocketProvider` that handles token-refresh/auth-state changes.
  - [x] Refactor `src/hooks/useSocket.ts` to consume the context.
  - [x] Refactor `src/lib/socket/useSocketIO.ts` to consume the context-based socket.
  - [x] Update `App.tsx` to provide `SocketProvider` within `AuthProvider`.
- [x] Task 3: Normalize Polling Intervals (AC: 3)
  - [x] Update `src/hooks/useApprovals.ts` to use 30s polling (currently 15s).
  - [x] Audit `useExecutions.ts` and `useNotifications.ts` for compliance (both already at 30s).
  - [x] Apply `staleTime: 0` overrides for components requiring immediate freshness without socket coverage.
- [x] Task 4: Cleanup & Validation (AC: 1, 2)
  - [x] Verify single WebSocket connection in Network tab.
  - [x] Verify page navigation does not trigger immediate refetching of stale-but-not-expired data.

## Dev Notes

### Technical Requirements & Anti-Patterns

- **Avoid Double Providers**: Ensure `SocketProvider` is placed correctly in the component tree (within `AuthProvider` to access the token).
- **StaleTime Caution**: Global `staleTime` might affect some real-time data if not handled; use overrides where immediate freshness is critical.
- **Socket Lifecycle**: The socket connection should be established only once per session and properly cleaned up on logout or token change.

### Project Structure Notes

- New context goes to `src/contexts/SocketContext.tsx`.
- Central initialization is in `src/App.tsx`.

### References

- QA Functional Requirement: QA-FR12, QA-FR13 [Source: docs/QA-REPORT-2026-02-27.md]
- QA Non-Functional Requirement: QA-NFR2, QA-NFR3 [Source: docs/QA-REPORT-2026-02-27.md]
- Epic 25: QA Stabilization [Source: _bmad-output/planning-artifacts/epics.md]

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (Code Review + Fix Pass)

### Change Log

- 2026-02-28: Code review by claude-sonnet-4-6. Fixed 8 HIGH/MEDIUM issues:
  - H-1: SocketContext.Provider was passing `socketRef.current` (non-reactive); replaced with `useState<Socket>` so consumers re-render on socket change.
  - H-2: `subscribe`, `joinRoom`, `leaveRoom`, `joinProjectRooms` had empty `[]` dep arrays capturing stale null socket; added `sharedSocket`/`sharedConnected` deps.
  - H-3: Token refresh was not handled; added `tokenRefreshed` custom event dispatch in AuthContext and listener in SocketContext so socket reconnects on silent token rotation.
  - H-4: Story File List falsely labelled `useNotifications.ts` as "Modified"; corrected to "Verified — no changes needed".
  - M-1: `joinedRoomsRef.current.add(room)` was never called; added after every emit + `.delete(room)` on leave to fix broken dedup.
  - M-2: `useApprovals.ts` (polling 15s→30s) and `AuthContext.tsx` were modified but not in File List; both added.
  - M-3: Dead SocketState fields `connecting`/`error`/`reconnectAttempts` marked `@deprecated`.
  - M-4: `useSocket` now warns in dev when a non-/dashboard namespace is requested.
  - L-3: `console.log` calls in SocketContext wrapped with `isDev` guard.
  - L-4: Removed redundant `token` variable in Dashboard component.

### File List

- `src/App.tsx` (Modified)
- `src/contexts/AuthContext.tsx` (Modified)
- `src/contexts/SocketContext.tsx` (New)
- `src/hooks/useSocket.ts` (Modified)
- `src/hooks/useApprovals.ts` (Modified)
- `src/lib/socket/useSocketIO.ts` (Modified)
- `src/hooks/queries/useNotifications.ts` (Verified — already compliant at 30s, no changes needed)
- `src/hooks/queries/useExecutions.ts` (Verified — already compliant at 30s, no changes needed)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (Modified)
