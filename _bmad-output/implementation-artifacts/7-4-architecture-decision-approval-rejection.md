# Story 7.4: Architecture Decision Approval/Rejection

- **Status**: review
- **Priority**: High
- **Effort**: 3 Story Points

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a TL,
I want to approve, reject, or request modifications to AI decisions,
so that I maintain technical quality standards and provide feedback to the AI.

## Acceptance Criteria

1. **Given** I'm reviewing an ADR
   **When** I make a decision (APPROVE, REJECT, MODIFY, DEFER)
   **Then** the decision is logged to the audit trail with `AIDecisionLoggerService` (AC#1)
   - Audit log includes: user_id, action, adr_id, ticket_id, comments/notes.

2. **And** notifications are sent (AC#2):
   - **Approve:** Notify PM (Ticket Owner) that architecture is approved.
   - **Reject/Modify:** Notify PM and update Ticket context with feedback.

3. **And** Ticket/Execution status is updated (AC#3):
   - **Reject:** Marks current Execution as FAILED/REJECTED. Updates Ticket to "NEEDS_REVISION" (or similar).
   - **Approve:** Updates Ticket/Execution to "APPROVED" (if applicable) or allows pipeline to proceed.

4. **And** re-execution is triggered for adjustments (AC#4):
   - **Reject/Modify:** Triggers a new> [!NOTE]
> **Dev Agent Record:**
> - Verified AC 1, 2, and 4 compliance.
> - Identified missing Ticket Status update in AC 3 (High Issue). Fixed by implementing `AWAITING_REWORK` status update in `AdrReviewListener`.
> - Identified missing tests (Medium Issue). Fixed by creating `adr-review.listener.spec.ts` and `architecture-review.controller.spec.ts`.
> - All tests verified passing.
 the TL's feedback injected into the prompt context.
   - The feedback must be explicitly passed to the `PromptGeneratorService` or stored in `Execution` context for the next retry.

5. **And** the API endpoint `POST /api/v1/architecture-review/:id/review` is updated to orchestrate these side effects (it currently only updates DB status).

## Tasks / Subtasks

- [x] Implement Audit Logging Logic (AC 1)
    - [x] Integrate `AIDecisionLoggerService` into `AdrService.reviewAdr`
    - [x] Ensure all review actions (Approve, Reject, Modify) are logged
- [x] Implement Notification Logic (AC 2)
    - [x] Create `ArchitectureReviewNotificationService` (or enhance existing)
    - [x] Implement notification trigger on ADR review
- [x] Implement Status Update Logic (AC 3)
    - [x] Update ADR status in DB
    - [x] Update Ticket/Execution status (e.g. `NEEDS_REVISION` for rejections)
- [x] Implement Retry Logic with Feedback (AC 4)
    - [x] Create `AdrReviewedEvent`
    - [x] Implement Event Listener to handle 'REJECT'/'MODIFY'
    - [x] Trigger `ExecutionService.startExecution` with feedback payload
- [x] Update API Endpoint (AC 5)
    - [x] Ensure `POST /review` handles the new logic pipeline
- [x] E2E Verification
    - [x] Verify full flow: User Review -> DB Update -> Log -> Notification -> AI Retry with Feedback (AC: #4)

## Dev Notes

- **Existing Codebase:** `AdrService` and `ArchitectureReviewController` already exist but lack side effects.
- **Modules involved:** `ArchitectureReviewModule`, `AuditModule`, `NotificationModule`, `ExecutionModule`, `AiRoutingModule`.
- **Circular Dependency Risk:** `ArchitectureReview` -> `Execution` -> `ArchitectureReview`.
  - **Recommended Pattern:** Use `EventEmitter2` (@nestjs/event-emitter).
  - Describe event `AdrReviewedEvent` (adrId, action, notes, ticketId).
  - Create a listener in `ExecutionModule` (e.g., `AdrReviewListener`) to handle retries.
  - Create a listener in `NotificationModule` to handle alerts.
- **Audit Logging:** Use `AIDecisionLoggerService` (Story 11.2).

### Project Structure Notes

- `src/architecture-review/` should remain the home for this logic.
- Create `src/architecture-review/events/adr-reviewed.event.ts`.
- Update `src/ai-routing/interfaces/prompt-generation.interface.ts` (or similar) for the feedback field.

### References

- [Source: AdrService](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/src/architecture-review/adr.service.ts)
- [Source: Epic 7](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/docs/epics.md)
- [Source: Story 11.2 (Audit Logger)](file:///Volumes/Data/project/products/alpharages/Dark%20Software%20Factory/_bmad-output/implementation-artifacts/11-2-ai-decision-audit-logger.md)

## Dev Agent Record

### Agent Model Used

Antigravity (Planning)

### Debug Log References

### Completion Notes List

### File List
