# Story CS0.2: IPMProvider Interface & PMProviderFactory

Status: done

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

- [x] Task 1: Define Normalized DTOs (AC: 2)
  - [x] Create `src/integrations/providers/dto/normalized-task.dto.ts`
  - [x] Create `src/integrations/providers/dto/normalized-status.dto.ts`
  - [x] Create `src/integrations/providers/dto/normalized-field.dto.ts`
- [x] Task 2: Implement IPMProvider Interface (AC: 1)
  - [x] Define interface in `src/integrations/providers/pm-provider.interface.ts`
  - [x] Import and use normalized DTOs for method signatures
- [x] Task 3: Run `pnpm typecheck` (AC: 3)

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

- Defined the `IPMProvider` interface with all required methods.
- Created normalized DTOs for tasks, statuses, and fields.
- Verified type safety via `tsc --noEmit`.
- Added mock interface tests (Review Fix).
- Code Review (2026-03-12): Fixed 2 HIGH + 5 MEDIUM issues:
  - H1: Added `NormalizedSelf` and `WebhookRegistrationResult` DTOs; `getSelf` and `registerWebhook` now return named types (not inline anonymous objects).
  - H2: Added JSDoc on `normalizeEvent` documenting IRawTaskEvent ClickUp-field coupling and CS1+ migration path.
  - M1: Added barrel exports (`dto/index.ts`, `providers/index.ts`).
  - M2: Expanded spec from 5 → 11 tests covering all interface methods; added email assertion to getSelf.
  - M3: `NormalizedTask.customFields` changed to `Record<string, unknown>` (matches IRawTaskEvent.customFields directly).
  - M4: `NormalizedTask` date fields changed from `Date` to `string | null` (matches PM API responses).
  - M5: `NormalizedFieldValue.value` changed from `any` to `FieldValue` union type (`string | number | boolean | string[] | null`).

### File List

- `src/integrations/providers/pm-provider.interface.ts`
- `src/integrations/providers/dto/normalized-task.dto.ts`
- `src/integrations/providers/dto/normalized-status.dto.ts`
- `src/integrations/providers/dto/normalized-field.dto.ts`
- `src/integrations/providers/dto/normalized-self.dto.ts`
- `src/integrations/providers/dto/index.ts`
- `src/integrations/providers/index.ts`
- `src/integrations/providers/pm-provider.interface.spec.ts`
