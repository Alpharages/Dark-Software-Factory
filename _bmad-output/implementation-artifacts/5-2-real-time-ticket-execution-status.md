# Story 5.2: Real-Time Ticket Execution Status

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a PM,
I want to see real-time updates on AI execution for my tickets,
so that I know what's happening without constantly refreshing.

## Acceptance Criteria

1. **AC#1: Socket.IO Server Infrastructure**
   - Socket.IO server must emit events for each status transition: `QUEUED` → `IN_PROGRESS` → `QA_REVIEW` → `GITHUB_PUSH` → `DEPLOYED`.
   - Events must include: `executionId`, `ticketId`, `status`, `timestamp`, and `aiProvider`.
2. **AC#2: Real-Time UI Updates**
   - The PM Dashboard UI (separate repo `dsf-dashboard`) must update in real-time without requiring a page refresh.
3. **AC#3: Progress Visualization**
   - Progress indicators must show the current step, estimated remaining time (if available), and the AI provider icon.
   - Status color coding: Gray (Queued), Blue (In Progress), Yellow (QA Review), Purple (GitHub Push), Green (Deployed), Red (Failed).
4. **AC#4: Error Handling & Actions**
   - Failed executions must display a clear error message.
   - UI must provide "Retry" and "Escalate to TL" options for failed steps.
5. **AC#5: Polling Fallback**
   - If Socket.IO connection is unavailable, the system must automatically fall back to HTTP polling (every 5 seconds) to maintain status visibility.

## Tasks / Subtasks

- [ ] **Socket.IO Infrastructure (DSF Builds)**
  - [ ] Implement `ExecutionGateway` for real-time ticket status updates.
  - [ ] Define shared event contracts (`execution-progress-update`, `execution-completed`).
  - [ ] Integrate gateway into `ExecutionService` to emit events on state changes.
  - [ ] Implement Socket.IO security (check JWT on connection).
- [ ] **Status Polling Fallback**
  - [ ] Create `GET /api/v1/executions/:id/status` endpoint for polling fallback.
  - [ ] Implement logic in `dsf-dashboard` to detect Socket.IO failure and start polling.
- [ ] **AI-Generated UI (AI Delegates)**
  - [ ] Generate React hooks (`useTicketProgress`) to handle Socket.IO/Polling event logic.
  - [ ] Create `ExecutionStatusCard` component with progress bars and status badges.
  - [ ] Create `ExecutionActionOverlay` for retry/escalate buttons on failure.
- [ ] **Verification & Testing**
  - [ ] Unit tests for `ExecutionGateway` and status transition logic.
  - [ ] E2E tests for socket connection and event delivery.
  - [ ] Manual verification of UI responsiveness and status color coding.

## Dev Notes

- **AI Delegation Pattern:** Follow [ADR-008](../architecture/adr-008-ai-delegation-pattern.md). DSF owns the WebSocket server and business logic; AI builds the React componentry and client hooks.
- **Source Tree:**
  - Backend: `src/modules/execution/` (Gateway, Service updates)
  - Frontend: `../dsf-dashboard/src/components/execution/`
- **Testing Standards:** Minimum 80% test coverage for new backend logic. Use existing NestJS WebSocket testing patterns.

### Project Structure Notes

- Frontend is in a separate repository at `../dsf-dashboard`.
- Real-time updates should be non-blocking; failed socket emissions should not crash the execution flow (wrap in try-catch with logging).

### References

- [Epic 5 Redesign Approved](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/epic-5-redesign-approved.md)
- [ADR-008: AI Delegation Pattern](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/architecture/adr-008-ai-delegation-pattern.md)
- [System Flow Diagram V3](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/system-flow-diagram-v3.md)

## Dev Agent Record

### Agent Model Used

Antigravity

### Debug Log References

### Completion Notes List

### File List
