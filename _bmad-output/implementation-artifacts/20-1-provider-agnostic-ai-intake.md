# Story 20.1: Provider-Agnostic AI Intake for Sync and Updates

Status: ready-for-dev

## Story

As a Product Manager,
I want the AI provider to automatically pick up tasks from ANY connected project management tool (ClickUp, Asana, Jira) when they are synced or updated to an active state,
So that the workflow is consistent regardless of the underlying tool.

## Acceptance Criteria

1. **Manual Sync Trigger via Standardized Intake**
   - **Given** a task is manually synced via the Projects UI (from ClickUp or future providers)
   - **When** the task status maps to an actionable internal status (e.g., 'AI_PROCESSING')
   - **Then** the system MUST route the ticket to the `ticket-intake-queue` using a normalized internal format (`ITaskEvent`)
   - **And** the AI execution MUST start if not already running

2. **Webhook Trigger via Standardized Intake**
   - **Given** a task is updated via webhook (from any supported provider)
   - **When** the external status maps to the internal 'In Progress' status
   - **Then** the system MUST route the ticket to the `ticket-intake-queue` using the same normalized `ITaskEvent`
   - **And** the AI execution MUST start

3. **Abstract Intake Logic**
   - **Given** the system supports multiple providers
   - **Then** the intake logic in `ProjectService` and `TicketIntakeService` MUST be abstract
   - **And** MUST NOT rely on ClickUp-specific data structures in the core routing flow
   - **And** a common `ITaskEvent` interface/DTO MUST be used for all provider events before they reach the queue

4. **Idempotency & Safety**
   - **Given** a ticket is already being processed by AI
   - **When** a sync or update event occurs
   - **Then** the system MUST NOT interrupt the active execution
   - **And** MUST NOT start a duplicate execution

## Tasks / Subtasks

- [x] Define `ITaskEvent` Interface
  - [x] Create `ITaskEvent` interface/DTO in shared DTOs/interfaces (provider-agnostic)
  - [x] Ensure it covers required fields: `externalId`, `providerType`, `internalStatus`, `title`, `description`, `triggerSource` (SYNC | WEBHOOK).

- [x] Refactor Ticket Intake Service
  - [x] Update `TicketIntakeService.processTaskEvent` to accept `ITaskEvent`
  - [x] Remove ClickUp-specific payload types from method signatures in core service interface
  - [x] Implement early idempotency check within `processTaskEvent` (return success if active execution exists)

- [ ] Update Project Service (Manual Sync)
  - [ ] Locate `ProjectService.syncFromProvider` (or `syncFromClickUp`)
  - [ ] Map synced tasks to `ITaskEvent` objects
  - [ ] Filter for actionable status
  - [ ] Publish events to `ticket-intake-queue` (or call `TicketIntakeService` directly if preferred pattern, but Queue is safer for async)

- [ ] Update Webhook Consumers
  - [ ] Refactor `ClickUpTaskUpdateConsumer` to map incoming webhooks to `ITaskEvent`
  - [ ] Publish normalized event to `ticket-intake-queue`

- [ ] Verification Tests
  - [ ] Unit test `TicketIntakeService` with mock `ITaskEvent`
  - [ ] Unit test `ProjectService` sync emits events
  - [ ] Verify idempotency: Simulate duplicate event, ensure 2nd execution blocked

## Dev Notes

- **Architecture Pattern**: Provider Adapter -> Normalized Event (`ITaskEvent`) -> Core Intake (`TicketIntakeService`) -> Queue.
- **Project Structure**:
  - `src/ticket-intake/dto/task-event.dto.ts` (or interface)
  - `src/projects/project.service.ts`
  - `src/clickup/clickup-task-update.consumer.ts`
- **Avoid**: Passing raw ClickUp webhook payloads deep into `TicketIntakeService`. Normalize early (at the Consumer or Sync service level).

### References

- `src/projects/project.service.ts`
- `src/ticket-intake/ticket-intake.service.ts`
- `src/clickup/clickup-task-update.consumer.ts`
