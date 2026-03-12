# Story CS0.2: IPMProvider Interface & PMProviderFactory

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **developer adding a new PM tool integration**,
I want a well-defined interface that all PM providers must implement,
so that Epics 1–3 never need to know which provider they are talking to. (Factory and Refresh logic covered in CS0-4).

## Acceptance Criteria

1. **IPMProvider Interface Definition**:
   - Defined in `src/integrations/providers/pm-provider.interface.ts`.
   - Includes methods from FR-CS0B: `getSelf`, `getStatuses`, `getTask`, `updateStatus`, `addComment`, `assignTask`, `getRequiredFields`, `setFieldValue`, `registerWebhook`, `deregisterWebhook`, `normalizeEvent`.
   - `normalizeEvent(payload: any): IRawTaskEvent` must return the standard intake event structure.
   - Each method has explicit TypeScript parameter and return types using normalized DTOs.

2. **Normalized DTOs**:
   - A set of shared DTOs exists in `src/integrations/providers/dto/`:
     - `NormalizedTask`: Basic task info (ID, name, description, status, URL).
     - `NormalizedStatus`: Workflow status details (ID, name, color, type).
     - `NormalizedField`: Field definition (ID, name, type, required, options).
     - `NormalizedFieldValue`: Field value container.

3. **Type Safety**:
   - `pnpm typecheck` passes with zero errors.

## Tasks / Subtasks

- [ ] Task 1: Define Normalized DTOs (AC: 2)
  - [ ] Create `src/integrations/providers/dto/normalized-task.dto.ts`
  - [ ] Create `src/integrations/providers/dto/normalized-status.dto.ts`
  - [ ] Create `src/integrations/providers/dto/normalized-field.dto.ts`
- [ ] Task 2: Implement IPMProvider Interface (AC: 1)
  - [ ] Define interface in `src/integrations/providers/pm-provider.interface.ts`
  - [ ] Import and use normalized DTOs for method signatures
- [ ] Task 3: Run `pnpm typecheck` (AC: 3)

## Dev Notes

- **Relevant architecture patterns and constraints:**
  - **Interface Segregation**: The `IPMProvider` is the core abstraction. Avoid adding provider-specific methods to the interface.
  - **DTO Mapping**: Current ClickUp DTOs (`TaskEventDto`, `ClickUpTaskDto`) should be used as references for what data needs to be captured in normalized forms.
- **Source tree components to touch:**
  - `src/integrations/providers/pm-provider.interface.ts`
  - `src/integrations/providers/dto/*`
- **Testing standards summary:**
  - Mock provider implementations to test the Factory's registration and selection logic.
  - Test token refresh logic by mocking time and the integration service.

### Project Structure Notes

- New components go under `src/integrations/providers/` to aggregate all provider-related abstractions.
- DTOs are isolated in `src/integrations/providers/dto/`.

### References

- [Source: docs/planning-artifacts/epics-clickup-smart-sync.md#Story 0.2: IPMProvider Interface & PMProviderFactory]
- [Architecture: docs/planning-artifacts/architecture.md#AI Delegation Pattern]
- [Interface: src/ticket-intake/interfaces/ticket-intake.interface.ts#IRawTaskEvent]

## Dev Agent Record

### Agent Model Used

Antigravity

### Debug Log References

N/A

### Completion Notes List

### File List
